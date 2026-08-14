// สโม้คเทสต์ของ mirror (scrcpy web mirror)
// ต่อ WS ไปที่ /api/mirror แล้วตรวจ contract ตามลำดับ: start→ready, config, keyframe, ≥10 เฟรม, text, stop→stopped
// ใช้งาน: env -u NODE_OPTIONS node scripts/mirror-smoke.js <serial>
// พอร์ตปรับได้ผ่าน env PORT (ดีฟอลต์ 3100)
const WebSocket = require('ws');

const serial = process.argv[2] || 'RZCXB0AP8DZ';
const port = process.env.PORT || '3100';
const url = `ws://localhost:${port}/api/mirror`;

// ตัวช่วย: จบเทสต์ พร้อมข้อความและ exit code
let finished = false;
function done(ok, reason) {
  if (finished) return;
  finished = true;
  clearTimeout(overallTimer);
  try { ws.removeAllListeners(); } catch {}
  try { ws.close(); } catch {}
  if (ok) {
    console.log('SMOKE PASS');
    process.exit(0);
  } else {
    console.error('SMOKE FAIL: ' + reason);
    process.exit(1);
  }
}

// ทามเอาต์รวม 30 วินาที
const overallTimer = setTimeout(() => done(false, 'overall timeout 30s'), 30000);

// สถานะที่ต้องเช็ค
let gotReady = false;
let gotConfig = false;   // binary kind 0
let gotKeyframe = false; // binary kind 1
let binaryCount = 0;
let readyTimer = null;
let stopTimer = null;
let sentText = false;
let sentStop = false;

const ws = new WebSocket(url);

ws.on('open', () => {
  // 1) ส่ง start แล้วรอ ready ภายใน 15s
  ws.send(JSON.stringify({ type: 'start', serial, maxSize: 1024, bitRate: 4000000, maxFps: 30 }));
  readyTimer = setTimeout(() => {
    if (!gotReady) done(false, 'ไม่ได้รับ ready ภายใน 15s');
  }, 15000);
});

ws.on('message', (data, isBinary) => {
  if (finished) return;
  if (!isBinary) {
    // เฟรมข้อความ JSON
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    if (msg.type === 'ready') {
      gotReady = true;
      if (readyTimer) clearTimeout(readyTimer);
      console.log(`ready: width=${msg.width} height=${msg.height} codec=${msg.codec} serial=${msg.serial}`);
    } else if (msg.type === 'stopped') {
      // รอ WS ปิดต่อ (จับใน close handler) — แต่ถือว่า stopped มาถึงแล้ว
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      // ให้ close handler เป็นตัวสรุปผล; กันเหนียวถ้า close ไม่มา
      stopTimer = setTimeout(() => done(true, ''), 500);
    } else if (msg.type === 'error') {
      done(false, 'server error: ' + msg.message);
    }
    return;
  }

  // เฟรม binary (วิดีโอ) — header 12 ไบต์
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < 12) { done(false, 'binary frame สั้นกว่า header 12 ไบต์'); return; }
  const kind = buf[0];
  binaryCount++;
  if (kind === 0) gotConfig = true;
  if (kind === 1) gotKeyframe = true;

  // เช็คเงื่อนไข 2,3,4 → เมื่อครบและยังไม่ส่ง text ให้เดินหน้าต่อ
  if (gotReady && gotConfig && gotKeyframe && binaryCount >= 10 && !sentText) {
    sentText = true;
    // 5) ส่ง text (ปลอดภัย ไม่เห็นบนจอ = ใช้ setClipboard เพราะ ascii → injectText)
    ws.send(JSON.stringify({ type: 'text', text: 'apitester-mirror-smoke' }));
    // 6) ส่ง stop แล้วรอ stopped + ปิด WS ภายใน 5s
    setTimeout(() => {
      sentStop = true;
      ws.send(JSON.stringify({ type: 'stop' }));
      stopTimer = setTimeout(() => done(false, 'ไม่ได้รับ stopped/ปิด WS ภายใน 5s'), 5000);
    }, 100);
  }
});

ws.on('close', () => {
  if (finished) return;
  if (sentStop) {
    // ปิดหลังส่ง stop = ผ่าน (ผ่าน assertions ครบแล้ว)
    done(true, '');
  } else {
    done(false, 'WS ปิดก่อนกำหนด');
  }
});

ws.on('error', (err) => {
  done(false, 'ws error: ' + err.message);
});
