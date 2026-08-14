// ================= Mirror (scrcpy web mirror) =================
// รัน scrcpy-server บนอุปกรณ์ผ่าน adb แล้วรีเลย์วิดีโอ H.264 ผ่าน WebSocket ไปให้เบราว์เซอร์
// พร้อมรับ event ควบคุม (touch/scroll/key/text/back/home/...) ส่งกลับเข้าอุปกรณ์
// 1 WS = 1 scrcpy session (ไม่แชร์กัน); เปิดหลายเครื่อง/หลายเซสชันพร้อมกันได้ (แต่ละอันมี scid ของตัวเอง)
// โมดูลนี้เขียนแบบ CommonJS ตามสไตล์ proxy.js — โหลด ESM lib ของ @yume-chan ผ่าน dynamic import แบบ lazy
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

// พาธ jar ของ scrcpy-server ที่ vendor ไว้ (เวอร์ชัน 3.3.3)
const SERVER_JAR = path.join(__dirname, 'vendor', 'scrcpy-server-v3.3.3.bin');
const SERVER_VERSION = '3.3.3';

// ---- โหลด ESM ของ @yume-chan แบบ lazy แล้ว cache ไว้ใน promise เดียว (Node 22 CJS ใช้ top-level await ไม่ได้) ----
let libsPromise = null;
function loadLibs() {
  if (!libsPromise) {
    libsPromise = (async () => {
      const [adb, tcp, adbScrcpy, scrcpy] = await Promise.all([
        import('@yume-chan/adb'),
        import('@yume-chan/adb-server-node-tcp'),
        import('@yume-chan/adb-scrcpy'),
        import('@yume-chan/scrcpy'),
      ]);
      return {
        AdbServerClient: adb.AdbServerClient,
        Adb: adb.Adb,
        AdbServerNodeTcpConnector: tcp.AdbServerNodeTcpConnector,
        AdbScrcpyClient: adbScrcpy.AdbScrcpyClient,
        AdbScrcpyOptionsLatest: adbScrcpy.AdbScrcpyOptionsLatest,
        DefaultServerPath: scrcpy.DefaultServerPath,
        AndroidMotionEventAction: scrcpy.AndroidMotionEventAction,
        AndroidMotionEventButton: scrcpy.AndroidMotionEventButton,
        AndroidKeyEventAction: scrcpy.AndroidKeyEventAction,
        ScrcpyInstanceId: scrcpy.ScrcpyInstanceId,
        ScrcpyVideoCodecId: scrcpy.ScrcpyVideoCodecId,
      };
    })();
  }
  return libsPromise;
}

// สร้าง web ReadableStream จากไฟล์ (สำหรับ push jar เข้าอุปกรณ์) — enqueue ก้อนเดียวแล้วปิด
function fileToReadableStream(buf) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

// map รหัส codec ของ scrcpy → ชื่อที่ client ใช้
function codecName(codecId, ScrcpyVideoCodecId) {
  if (codecId === ScrcpyVideoCodecId.H265) return 'h265';
  if (codecId === ScrcpyVideoCodecId.AV1) return 'av1';
  return 'h264';
}

const MAX_BUFFERED = 4 * 1024 * 1024; // เกินนี้ = drop เฉพาะ delta (kind 2)

/**
 * เริ่มบริการ mirror — ผูก WS endpoint /api/mirror เข้ากับ http server เดียวกับ express
 * @param {object} opts
 * @param {import('http').Server} opts.httpServer  http server ที่ได้จาก app.listen(...)
 */
function initMirror({ httpServer }) {
  // ใช้ noServer แล้ว handle upgrade เองเฉพาะ path /api/mirror (path อื่น destroy socket ทิ้ง)
  const wss = new WebSocket.Server({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      pathname = '';
    }
    if (pathname !== '/api/mirror') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    handleConnection(ws).catch((err) => {
      // กันเหนียว: ทุก error ที่หลุดมาถึงตรงนี้ต้องไม่ทำ process ล้ม
      console.error('[mirror] handleConnection error:', err && err.message);
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: String(err && err.message || err) }));
        }
      } catch {}
      try { ws.close(); } catch {}
    });
  });

  console.log('[mirror] พร้อมให้บริการ WS ที่ /api/mirror (scrcpy web mirror)');
  return wss;
}

// จัดการ 1 การเชื่อมต่อ WS = 1 scrcpy session
async function handleConnection(ws) {
  // ---- state ต่อเซสชัน ----
  let started = false;      // รับ start แล้วหรือยัง
  let closed = false;       // เริ่มกระบวนการปิดแล้วหรือยัง
  let client = null;        // AdbScrcpyClient
  let controller = null;    // ScrcpyControlMessageWriter
  let adb = null;           // Adb (ไว้ปิด transport ตอน cleanup)
  let reader = null;        // reader ของ video stream (ไว้ cancel)
  let disposeSizeChanged = null; // ตัวถอด listener sizeChanged
  let curWidth = 0;         // ขนาดวิดีโอปัจจุบัน (ใช้สเกล touch/scroll)
  let curHeight = 0;
  let clipboardSeq = 0n;    // sequence สำหรับ setClipboard (ต้องเพิ่มขึ้นเรื่อยๆ)
  let libs = null;

  // ส่ง JSON ให้ client (เงียบถ้า WS ปิดไปแล้ว)
  function sendJson(obj) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(obj)); } catch {}
  }

  // ส่ง error แล้วปิด
  function fail(message) {
    sendJson({ type: 'error', message: String(message) });
    cleanup('error').finally(() => { try { ws.close(); } catch {} });
  }

  // ปิดทุกอย่างให้ครบ (idempotent) — kill scrcpy, ปิด transport, ถอด listener
  async function cleanup(reason) {
    if (closed) return;
    closed = true;
    if (disposeSizeChanged) { try { disposeSizeChanged(); } catch {} disposeSizeChanged = null; }
    if (reader) { try { await reader.cancel(); } catch {} reader = null; }
    if (client) { try { await client.close(); } catch {} client = null; }
    if (adb) { try { await adb.close(); } catch {} adb = null; }
    controller = null;
    if (reason) console.log(`[mirror] ปิดเซสชัน (${reason})`);
  }

  // ---- WS event handlers ----
  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // client ส่งเฉพาะ JSON text; binary ทิ้ง
    let msg;
    try {
      msg = JSON.parse(data.toString('utf8'));
    } catch {
      sendJson({ type: 'error', message: 'JSON ไม่ถูกต้อง' });
      return;
    }
    // ทุก handler ห่อ catch เพื่อไม่ให้ rejection หลุด
    onMessage(msg).catch((err) => {
      console.error('[mirror] onMessage error:', err && err.message);
      sendJson({ type: 'error', message: String(err && err.message || err) });
    });
  });

  ws.on('close', () => { cleanup('ws close'); });
  ws.on('error', (err) => {
    console.error('[mirror] ws error:', err && err.message);
    cleanup('ws error');
  });

  // ---- ประมวลผลข้อความจาก client ----
  async function onMessage(msg) {
    if (!msg || typeof msg.type !== 'string') {
      sendJson({ type: 'error', message: 'ไม่มี field type' });
      return;
    }

    // start ต้องมาก่อนเสมอ
    if (msg.type === 'start') {
      if (started) { sendJson({ type: 'error', message: 'start ซ้ำ' }); return; }
      started = true;
      await startSession(msg);
      return;
    }
    if (!started) {
      sendJson({ type: 'error', message: 'ต้องส่ง start ก่อน' });
      return;
    }
    if (msg.type === 'stop') {
      await cleanup('stop');
      sendJson({ type: 'stopped', reason: 'client stop' });
      try { ws.close(); } catch {}
      return;
    }
    // ต้องมี controller ถึงจะส่ง control ได้
    if (!controller) return;

    const A = libs.AndroidMotionEventAction;
    const B = libs.AndroidMotionEventButton;
    const K = libs.AndroidKeyEventAction;

    switch (msg.type) {
      case 'touch': {
        const action = msg.action === 'down' ? A.Down : msg.action === 'up' ? A.Up : A.Move;
        const pressed = msg.action !== 'up';
        await controller.injectTouch({
          action,
          pointerId: BigInt(msg.pointerId ?? 0),
          pointerX: clampPx((msg.x ?? 0) * curWidth, curWidth),
          pointerY: clampPx((msg.y ?? 0) * curHeight, curHeight),
          videoWidth: curWidth,
          videoHeight: curHeight,
          pressure: typeof msg.pressure === 'number' ? (pressed ? msg.pressure : 0) : (pressed ? 1 : 0),
          actionButton: B.Primary,
          buttons: pressed ? B.Primary : B.None,
        });
        break;
      }
      case 'scroll': {
        await controller.injectScroll({
          pointerX: clampPx((msg.x ?? 0) * curWidth, curWidth),
          pointerY: clampPx((msg.y ?? 0) * curHeight, curHeight),
          videoWidth: curWidth,
          videoHeight: curHeight,
          scrollX: Number(msg.hDelta ?? 0),
          scrollY: Number(msg.vDelta ?? 0),
          buttons: B.None,
        });
        break;
      }
      case 'key': {
        await controller.injectKeyCode({
          action: msg.action === 'up' ? K.Up : K.Down,
          keyCode: Number(msg.keycode ?? 0),
          repeat: 0,
          metaState: Number(msg.metaState ?? 0),
        });
        break;
      }
      case 'text': {
        const text = String(msg.text ?? '');
        if (/^[\x00-\x7F]*$/.test(text)) {
          // ascii ล้วน → พิมพ์ตรงๆ
          await controller.injectText(text);
        } else {
          // มี unicode → ผ่าน clipboard แล้วสั่ง paste (sequence ต้องเพิ่มขึ้น)
          clipboardSeq += 1n;
          await controller.setClipboard({ sequence: clipboardSeq, content: text, paste: true });
        }
        break;
      }
      case 'back': {
        // back = backOrScreenOn (down แล้ว up)
        await controller.backOrScreenOn(K.Down);
        await controller.backOrScreenOn(K.Up);
        break;
      }
      case 'home': { await tapKey(3); break; }       // KEYCODE_HOME
      case 'appswitch': { await tapKey(187); break; } // KEYCODE_APP_SWITCH
      case 'power': { await tapKey(26); break; }      // KEYCODE_POWER
      case 'rotate': { await controller.rotateDevice(); break; }
      case 'keyframe': { await controller.resetVideo(); break; }
      default: {
        sendJson({ type: 'error', message: 'ไม่รู้จัก type: ' + msg.type });
      }
    }
  }

  // กด key ครบจังหวะ down→up
  async function tapKey(keycode) {
    const K = libs.AndroidKeyEventAction;
    await controller.injectKeyCode({ action: K.Down, keyCode: keycode, repeat: 0, metaState: 0 });
    await controller.injectKeyCode({ action: K.Up, keyCode: keycode, repeat: 0, metaState: 0 });
  }

  // จำกัดพิกัดไม่ให้เกินขอบเฟรม
  function clampPx(v, max) {
    if (!(v >= 0)) return 0;
    if (v > max) return max;
    return Math.round(v);
  }

  // ---- เริ่ม scrcpy session ----
  async function startSession(msg) {
    libs = await loadLibs();
    const {
      AdbServerClient, Adb, AdbServerNodeTcpConnector,
      AdbScrcpyClient, AdbScrcpyOptionsLatest,
      DefaultServerPath, ScrcpyInstanceId, ScrcpyVideoCodecId,
    } = libs;

    const serial = String(msg.serial || '');
    if (!serial) { fail('ต้องระบุ serial'); return; }
    const maxSize = Number(msg.maxSize ?? 1024);
    const videoBitRate = Number(msg.bitRate ?? 4000000);
    const maxFps = Number(msg.maxFps ?? 30);

    // ต่อ adb server (127.0.0.1:5037) แล้วหาเครื่องตาม serial
    const connector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 });
    const serverClient = new AdbServerClient(connector);
    const devices = await serverClient.getDevices();
    const device = devices.find((d) => d.serial === serial && d.state === 'device');
    if (!device) { fail('ไม่พบอุปกรณ์ที่พร้อมใช้งาน: ' + serial); return; }

    const transport = await serverClient.createTransport({ serial });
    adb = new Adb(transport);

    // push jar เข้าอุปกรณ์
    const jar = await fs.promises.readFile(SERVER_JAR);
    await AdbScrcpyClient.pushServer(adb, fileToReadableStream(jar));

    // ตั้ง options — video เท่านั้น (ปิด audio), เปิด control, scid สุ่มต่อเซสชันเพื่อรันขนานได้
    const options = new AdbScrcpyOptionsLatest(
      {
        video: true,
        audio: false,
        control: true,
        maxSize,
        videoBitRate,
        maxFps,
        scid: ScrcpyInstanceId.random(),
      },
      { version: SERVER_VERSION },
    );

    client = await AdbScrcpyClient.start(adb, DefaultServerPath, options);

    if (closed) { await cleanup('closed ระหว่าง start'); return; }

    controller = client.controller;

    // เมื่อ scrcpy จบเอง (process ตาย) → แจ้ง stopped + ปิด
    client.exited
      .then(() => {
        if (closed) return;
        sendJson({ type: 'stopped', reason: 'scrcpy exited' });
        cleanup('scrcpy exited').finally(() => { try { ws.close(); } catch {} });
      })
      .catch((err) => {
        if (closed) return;
        sendJson({ type: 'error', message: 'scrcpy: ' + String(err && err.message || err) });
        cleanup('scrcpy error').finally(() => { try { ws.close(); } catch {} });
      });

    // ดึง video stream + metadata
    const video = await client.videoStream;
    if (!video) { fail('ไม่มี video stream'); return; }
    curWidth = video.width || video.metadata.width || 0;
    curHeight = video.height || video.metadata.height || 0;

    sendJson({
      type: 'ready',
      serial,
      width: curWidth,
      height: curHeight,
      codec: codecName(video.metadata.codec, ScrcpyVideoCodecId),
    });

    // ขนาดเปลี่ยน (หมุนจอ) → อัปเดตขนาดปัจจุบัน + แจ้ง meta
    disposeSizeChanged = video.sizeChanged((size) => {
      curWidth = size.width;
      curHeight = size.height;
      sendJson({ type: 'meta', width: size.width, height: size.height });
    });

    // อ่าน video stream เป็น loop แล้ว frame ตาม binary contract
    pumpVideo(video.stream).catch((err) => {
      if (closed) return;
      console.error('[mirror] pumpVideo error:', err && err.message);
      cleanup('pump error').finally(() => { try { ws.close(); } catch {} });
    });
  }

  // อ่าน packet วิดีโอทีละก้อน → หุ้ม header 12 ไบต์ → ส่งเป็น binary
  async function pumpVideo(stream) {
    reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (closed || ws.readyState !== WebSocket.OPEN) break;
        sendPacket(value);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  // ประกอบเฟรม binary: [kind(1)][reserved(3)][pts float64 LE(8)][payload]
  function sendPacket(packet) {
    let kind;
    let pts = 0;
    if (packet.type === 'configuration') {
      kind = 0;
    } else {
      // type === 'data'
      kind = packet.keyframe ? 1 : 2;
      pts = packet.pts != null ? Number(packet.pts) : 0; // pts เป็นไมโครวินาที (bigint) → number
    }

    // backpressure: ถ้าคิวส่งบวมเกิน 4MB ให้ทิ้งเฉพาะ delta (kind 2) — ห้ามทิ้ง config/keyframe
    if (kind === 2 && ws.bufferedAmount > MAX_BUFFERED) return;

    const payload = packet.data;
    const frame = Buffer.allocUnsafe(12 + payload.length);
    frame[0] = kind;
    frame[1] = 0; frame[2] = 0; frame[3] = 0;
    frame.writeDoubleLE(pts, 4);
    Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, 12);

    try { ws.send(frame); } catch {}
  }
}

module.exports = { initMirror };
