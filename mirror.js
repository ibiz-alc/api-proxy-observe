// ================= Mirror (scrcpy web mirror) =================
// รัน scrcpy-server บนอุปกรณ์ผ่าน adb แล้วรีเลย์วิดีโอ H.264 ผ่าน WebSocket ไปให้เบราว์เซอร์
// พร้อมรับ event ควบคุม (touch/scroll/key/text/back/home/...) ส่งกลับเข้าอุปกรณ์
// 1 WS = 1 scrcpy session (ไม่แชร์กัน); เปิดหลายเครื่อง/หลายเซสชันพร้อมกันได้ (แต่ละอันมี scid ของตัวเอง)
// โมดูลนี้เขียนแบบ CommonJS ตามสไตล์ proxy.js — โหลด ESM lib ของ @yume-chan ผ่าน dynamic import แบบ lazy
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { IosMirrorSession } = require('./ios-mirror');

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
  let clipReader = null;    // reader ของ clipboard stream ที่ drain ทิ้ง (ไว้ cancel ตอน cleanup)
  let keyframePending = false; // กัน resetVideo รัวตอน drop delta เพราะ backpressure
  let disposeSizeChanged = null; // ตัวถอด listener sizeChanged
  let curWidth = 0;         // ขนาดวิดีโอปัจจุบัน (ใช้สเกล touch/scroll)
  let curHeight = 0;
  let libs = null;
  let ios = null;          // เซสชัน iOS Simulator (ใช้แทน scrcpy เมื่อ platform=ios)
  let iosDown = null;      // จุด+เวลาที่ pointer กดลง (iOS ไม่มี down/move/up ต้องรอ up แล้วสรุปเป็น tap/swipe)
  let iosScrollAt = 0;     // กันสั่ง scroll รัว (idb 1 คำสั่ง ~300ms)
  let iosSent = 0;         // นับเฟรม/วิ ที่ส่งจริง (เห็นเฉพาะตอน MIRROR_DEBUG=1)
  let iosSentAt = 0;

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
    if (ios) { try { ios.stop(); } catch {} ios = null; }
    if (disposeSizeChanged) { try { disposeSizeChanged(); } catch {} disposeSizeChanged = null; }
    if (reader) { try { await reader.cancel(); } catch {} reader = null; }
    if (clipReader) { try { await clipReader.cancel(); } catch {} clipReader = null; }
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
    if (process.env.MIRROR_DEBUG) console.log('[mirror] <<', msg.type);
    onMessage(msg).then(() => {
      if (process.env.MIRROR_DEBUG) console.log('[mirror] ok', msg.type);
    }).catch((err) => {
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
    // iOS Simulator — คนละชุดคำสั่งกับ scrcpy (ผ่าน idb)
    if (ios) { await onIosMessage(msg); return; }

    // ต้องมี controller ถึงจะส่ง control ได้
    if (!controller) return;

    const A = libs.AndroidMotionEventAction;
    const B = libs.AndroidMotionEventButton;
    const K = libs.AndroidKeyEventAction;

    switch (msg.type) {
      case 'touch': {
        const action = msg.action === 'down' ? A.Down : msg.action === 'up' ? A.Up : A.Move;
        const pressed = msg.action !== 'up';
        if (process.env.MIRROR_DEBUG) {
          console.log(`[mirror] touch ${msg.action} px=${Math.round((msg.x ?? 0) * curWidth)},${Math.round((msg.y ?? 0) * curHeight)} video=${curWidth}x${curHeight}`);
        }
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
        if (!text) break;
        // ส่งทุกข้อความผ่าน clipboard+paste เสมอ
        // เหตุผล: injectText ของ scrcpy แปลงตัวอักษรเป็น keycode แล้วโดน keyboard layout/IME
        // ของเครื่องตีความ → ตัวอักษรหาย/กลายเป็นตัวอื่น (เจอจริงตอน E2E: "wifi" เหลือ "wi"
        // และมีตัวไทยแปลกโผล่) — clipboard paste เป็น atomic ไม่ขึ้นกับ layout
        // sequence ต้องเป็น 0 เสมอ = ไม่รอ ack (ถ้า >0 lib จะ await ack จากเครื่อง
        // ซึ่งไม่มีวันมาเพราะเราปิด clipboardAutosync → ค้างตลอดกาล)
        await controller.setClipboard({ sequence: 0n, content: text, paste: true });
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
      case 'rotate': {
        // ไม่ใช้ controller.rotateDevice() เพราะบนเครื่องที่ auto-rotate เปิดอยู่
        // sensor (emulator รายงาน portrait ตลอด) จะดีดกลับทันที → หมุนไม่ติด
        // ใช้ user_rotation ตรงๆ แทน (ปิด auto-rotate ก่อน) — ทดสอบแล้วได้ผลชัวร์
        // toggle 0↔1 (portrait↔landscape) — ไม่วนครบ 4 ทิศเพราะหลายเครื่องปฏิเสธ 180° (user_rotation 2 เป็น no-op)
        // วิธีอ่าน rotation ปัจจุบันเป็นแบบ hybrid (ทุกทางเลือกอื่นพังมาแล้วจริงๆ ตอน E2E):
        // - ถ้า accelerometer_rotation=0 (เราคุมเองอยู่) → เชื่อ `settings get user_rotation`
        //   (authoritative, ห้ามใช้ dumpsys — ช่วงใกล้การหมุน ค่าใน dumpsys ไม่นิ่ง/มีบรรทัดค้าง)
        // - ถ้า accelerometer_rotation=1 (sensor คุม ครั้งแรกที่กด) → user_rotation เชื่อไม่ได้
        //   ต้องอ่านจอจริงจาก dumpsys: awk เอา match แรก แบบอ่านจนจบ stream
        //   (ห้าม grep -m1/head — ปิด pipe ก่อนจบ → Broken pipe → ค่าว่างเป็นพักๆ
        //    และห้ามเอา match สุดท้าย — เป็นค่าค้างของ window อื่น เป็น 0 เสมอ)
        await adb.subprocess.noneProtocol.spawnWaitText(
          "acc=$(settings get system accelerometer_rotation); "
          + "if [ \"$acc\" = \"0\" ]; then r=$(settings get system user_rotation); "
          + "else r=$(dumpsys window | awk '!d && match($0,/mRotation=[0-9]/){v=substr($0,RSTART+10,1); d=1} END{print v}'); fi; "
          + "settings put system accelerometer_rotation 0; "
          + "settings put system user_rotation $(( r == 1 ? 0 : 1 ))",
        );
        break;
      }
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

  // ---- คำสั่งควบคุมฝั่ง iOS Simulator ----
  // ต่างจาก Android ตรงที่ idb ไม่มี inject แบบ down/move/up ต่อเนื่อง มีแต่ tap/swipe ที่จบในคำสั่งเดียว
  // → เก็บจุดที่กดลงไว้ก่อน แล้วตอนปล่อยค่อยตัดสินว่าเป็น "แตะ" หรือ "ปัด"
  async function onIosMessage(msg) {
    if (!ios.hasInput) {
      // ไม่มี idb = ดูภาพได้อย่างเดียว บอก client ครั้งเดียวพอ (client ซ่อนปุ่มให้เอง)
      return;
    }
    switch (msg.type) {
      case 'touch': {
        if (msg.action === 'down') { iosDown = { x: msg.x, y: msg.y, t: Date.now() }; break; }
        if (msg.action === 'move') break; // ระหว่างลากทำอะไรไม่ได้ รอ up แล้วสรุปเป็น swipe
        if (msg.action === 'up') {
          const d = iosDown; iosDown = null;
          if (!d) break;
          const dx = (msg.x ?? d.x) - d.x;
          const dy = (msg.y ?? d.y) - d.y;
          const far = Math.hypot(dx, dy) > 0.02; // ขยับเกิน 2% ของจอ = ถือว่าปัด
          if (far) await ios.swipe(d.x, d.y, msg.x ?? d.x, msg.y ?? d.y, (Date.now() - d.t) / 1000);
          else await ios.tap(d.x, d.y);
        }
        break;
      }
      case 'scroll': {
        const now = Date.now();
        if (now - iosScrollAt < 350) break; // ล้อเมาส์ยิงรัวมาก — ปล่อยผ่านเป็นช่วงๆ
        iosScrollAt = now;
        const dy = Number(msg.vDelta ?? 0);
        if (!dy) break;
        // เลื่อนขึ้น = ปัดนิ้วขึ้น (เนื้อหาเลื่อนลง) — ระยะ 25% ของจอต่อครั้ง
        const x = msg.x ?? 0.5;
        const y = msg.y ?? 0.5;
        const step = Math.max(-0.35, Math.min(0.35, dy * 0.25));
        await ios.swipe(x, Math.min(0.9, Math.max(0.1, y)), x, Math.min(0.95, Math.max(0.05, y + step)), 0.1);
        break;
      }
      case 'text': { await ios.text(msg.text); break; }
      case 'home': { await ios.button('HOME'); break; }
      case 'power': { await ios.button('LOCK'); break; }
      case 'siri': { await ios.button('SIRI'); break; }
      default: break; // back/appswitch/rotate/keyframe ไม่มีบน iOS — เมินเงียบๆ
    }
  }

  // ---- เริ่ม session ของ iOS Simulator (ลูป screenshot + input ผ่าน idb) ----
  async function startIosSession(msg) {
    const udid = String(msg.udid || msg.serial || '');
    if (!udid) { fail('ต้องระบุ udid ของ simulator'); return; }
    ios = new IosMirrorSession({
      udid,
      pipeline: Number(msg.pipeline ?? 3),
      maxWidth: Number(msg.maxWidth ?? 0),
      shouldSend: () => ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED,
      onFrame: (buf) => {
        try { ws.send(buf); } catch {}
        if (process.env.MIRROR_DEBUG) {
          iosSent++;
          const now = Date.now();
          if (now - iosSentAt >= 1000) {
            console.log(`[mirror] ios ส่ง ${iosSent} เฟรม/วิ · buffered=${Math.round(ws.bufferedAmount / 1024)}KB`);
            iosSent = 0; iosSentAt = now;
          }
        }
      },
      onMeta: (m) => sendJson({ type: 'ready', platform: 'ios', ...m }),
      onError: (m) => sendJson({ type: 'ios-warn', message: m }),
    });
    try {
      await ios.start();
    } catch (e) {
      fail('เริ่ม mirror iOS ไม่สำเร็จ: ' + (e && e.message ? e.message : e));
    }
  }

  // ---- เริ่ม scrcpy session ----
  async function startSession(msg) {
    if (msg && msg.platform === 'ios') { await startIosSession(msg); return; }
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
        // หมายเหตุ: clipboardAutosync ต้องเป็น true (ค่า default) — ถ้าปิด lib จะไม่สร้าง
        // clipboard handler แล้ว setClipboard พังทันที ("reading 'serializeSetClipboard...'")
        // ผลข้างเคียงคือเครื่องส่ง clipboard message กลับมาทาง control socket
        // → ต้อง drain options.clipboard เสมอ (ดูหลัง start ด้านล่าง) กัน backpressure อุดตัน
      },
      { version: SERVER_VERSION },
    );

    client = await AdbScrcpyClient.start(adb, DefaultServerPath, options);

    if (closed) {
      // WS ปิดไประหว่างรอ start: cleanup() วิ่งไปแล้ว (closed=true) และเรียกซ้ำจะ return เฉยๆ
      // → ต้องปิด client ที่เพิ่งเกิดตรงนี้เอง ไม่งั้น scrcpy process ค้างบนเครื่อง (zombie)
      try { await client.close(); } catch {}
      client = null;
      console.log('[mirror] ปิด scrcpy ที่ start เสร็จหลัง WS ปิดไปแล้ว');
      return;
    }

    controller = client.controller;

    // drain clipboard stream ทิ้งเสมอ — ทุกครั้งที่ paste เครื่องจะ broadcast clipboard
    // กลับมาทาง control socket ถ้าไม่มีใครอ่าน queue เต็มแล้ว device message parser
    // อุดตันทั้งเส้น (ack/uhid ตามไปด้วย) — เจอจริงตอน E2E: control ตายเงียบหลังส่ง text หลายครั้ง
    if (options.clipboard) {
      clipReader = options.clipboard.getReader();
      (async () => {
        for (;;) {
          const { done } = await clipReader.read();
          if (done) break;
        }
      })().catch(() => { /* จบ/พังพร้อม session — ไม่ต้องทำอะไร */ });
    }

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
    let ended = false; // stream จบเอง = scrcpy ตาย (โดน kill / เครื่อง reboot)
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { ended = true; break; }
        if (closed || ws.readyState !== WebSocket.OPEN) break;
        sendPacket(value);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    // สำคัญ: stream จบแบบ done ต้องปิด session ด้วย — ไม่งั้นจะเป็น zombie
    // (WS เปิดค้าง client เห็นเฟรมสุดท้าย + status "เชื่อมต่อแล้ว" ตลอดกาล ไม่มี auto-reconnect)
    if (ended && !closed) {
      console.log('[mirror] video stream จบ (scrcpy ตาย?) — ปิด session ให้ client reconnect');
      sendJson({ type: 'stopped', reason: 'สตรีมวิดีโอจบ (scrcpy หยุดทำงาน)' });
      await cleanup('video ended');
      try { ws.close(); } catch {}
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
    // และเมื่อทิ้งไปแล้ว decoder ฝั่ง browser จะอ้างอิงเฟรมที่หายไป (ภาพแตกจนกว่าจะมี IDR ใหม่)
    // → ขอ keyframe อัตโนมัติหนึ่งครั้ง (debounce ด้วย flag เดียว) ให้ภาพซ่อมตัวเอง
    if (kind === 2 && ws.bufferedAmount > MAX_BUFFERED) {
      if (!keyframePending && controller) {
        keyframePending = true;
        controller.resetVideo()
          .then(() => { keyframePending = false; })
          .catch(() => { keyframePending = false; });
      }
      return;
    }

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
