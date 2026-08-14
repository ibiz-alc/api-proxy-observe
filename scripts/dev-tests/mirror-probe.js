// probe: ยิง control ทีละคำสั่งบน emulator ดูว่าค้างตรงไหน (คู่กับ MIRROR_DEBUG ฝั่ง server)
const path = require('path');
const WebSocket = require(path.join(process.env.WORKTREE, 'node_modules', 'ws'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const ws = new WebSocket('ws://localhost:3100/api/mirror');
  ws.binaryType = 'arraybuffer';
  let frames = 0;
  ws.on('message', (data, isBinary) => {
    if (isBinary || data instanceof ArrayBuffer) { frames++; return; }
    console.log('JSON:', data.toString());
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'start', serial: 'emulator-5554' }));
  await sleep(6000);
  console.log('frames so far:', frames);

  const fire = async (m, label) => {
    console.log('SEND', label);
    ws.send(JSON.stringify(m));
    await sleep(2500);
  };
  await fire({ type: 'touch', action: 'down', pointerId: 0, x: 0.5, y: 0.078, pressure: 1 }, 'touch down');
  await fire({ type: 'touch', action: 'up', pointerId: 0, x: 0.5, y: 0.078, pressure: 0 }, 'touch up (เปิด search)');
  await fire({ type: 'text', text: 'abc' }, 'text abc (clipboard paste)');
  await fire({ type: 'text', text: 'สวัสดี' }, 'text ไทย (clipboard paste)');
  await fire({ type: 'key', action: 'down', keycode: 67 }, 'backspace down');
  await fire({ type: 'key', action: 'up', keycode: 67 }, 'backspace up');
  await fire({ type: 'back' }, 'back (ปิดคีย์บอร์ด)');
  await fire({ type: 'back' }, 'back (ออกจาก search)');
  await fire({ type: 'rotate' }, 'rotate → landscape');
  await fire({ type: 'rotate' }, 'rotate → portrait');
  console.log('total frames:', frames);
  ws.send(JSON.stringify({ type: 'stop' }));
  await sleep(1500);
  process.exit(0);
})().catch((e) => { console.error('PROBE CRASH:', e); process.exit(2); });
