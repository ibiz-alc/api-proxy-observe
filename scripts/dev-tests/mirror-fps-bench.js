#!/usr/bin/env node
// วัด fps/แบนด์วิดท์ของ mirror จากมุมเบราว์เซอร์จริง (ใช้ CDP นับ WS frame ที่รับเข้ามา)
//   PORT=3100 env -u NODE_OPTIONS node scripts/dev-tests/mirror-fps-bench.js <คำค้นชื่อเครื่อง> [วินาที]
// เช่น ... mirror-fps-bench.js emulator 10   /   ... mirror-fps-bench.js 🍎 10
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const MATCH = process.argv[2] || 'emulator';
const SECS = Number(process.argv[3] || 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// จอนิ่ง = ไม่มีเฟรมส่งมา (scrcpy ส่งเฉพาะตอนภาพเปลี่ยน · ลูป screenshot ของ iOS ก็ถูก
// ตัดเฟรมซ้ำเช่นกัน) → ต้องกวนจอให้ขยับตลอดช่วงที่วัด ไม่งั้นตัวเลขไม่มีความหมาย
function startMotion(kind, id) {
  if (kind === 'android') {
    execFile('adb', ['-s', id, 'shell', 'am', 'start', '-n', 'com.android.settings/.Settings'], () => {});
    let up = true;
    return setInterval(() => {
      const [y1, y2] = up ? [1500, 500] : [500, 1500];
      up = !up;
      // duration 1100ms ใกล้เคียงคาบ 1200ms → ลากแทบไม่มีช่วงหยุด
      execFile('adb', ['-s', id, 'shell', 'input', 'swipe', '500', String(y1), '500', String(y2), '1100'], () => {});
    }, 1200);
  }
  // ต้องเปิดแอปที่ "เลื่อนได้" ก่อน — หน้า home ของ sim มีหน้าเดียว ปัดแล้วภาพไม่เปลี่ยนเลย
  // (แล้วตัวข้ามเฟรมซ้ำจะไม่ส่งอะไรออกมา = วัดได้ 0 fps ทั้งที่ระบบทำงานถูก)
  execFile('xcrun', ['simctl', 'launch', id, 'com.apple.Preferences'], () => {});
  const idb = process.env.IDB || path.join(os.homedir(), '.apitester/idb-venv/bin/idb');
  const comp = process.env.IDB_COMPANION_BIN || path.join(os.homedir(), '.apitester/idb/idb_companion');
  const env = { ...process.env, PATH: `${path.dirname(comp)}:${process.env.PATH}` };
  delete env.IDB_COMPANION;
  let up = true;
  return setInterval(() => {
    const [y1, y2] = up ? [700, 250] : [250, 700];
    up = !up;
    spawn(idb, ['ui', 'swipe', '200', String(y1), '200', String(y2), '--duration', '1.1', '--udid', id],
      { env, stdio: 'ignore' }).on('error', () => {});
  }, 1300);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');
  let rx = 0, bytes = 0;
  cdp.on('Network.webSocketFrameReceived', (e) => {
    const r = e.response || {};
    if (r.opcode !== 2) return;            // 2 = binary (เฟรมวิดีโอ) · 1 = JSON control
    rx++;
    bytes += (r.payloadData || '').length * 0.75; // payloadData เป็น base64 → ประมาณขนาดจริง
  });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('#mirrorRailDevices');
  // รอ "แถวที่ตรงกับที่ขอ" ไม่ใช่แถวแรกที่โผล่ — /api/devices (adb) กับ /api/devices/ios-sims
  // (simctl) ตอบไม่พร้อมกัน ถ้ารีบอ่านจะยังไม่มีแถวของ sim
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate((m) =>
      [...document.querySelectorAll('.mirror-device-row')].some((r) => r.textContent.includes(m)), MATCH);
    if (ok) break;
    await sleep(1000);
  }
  const found = await page.evaluate((m) => {
    const row = [...document.querySelectorAll('.mirror-device-row')].find((r) => r.textContent.includes(m));
    if (!row) return null;
    row.querySelector('button').click();
    // id/platform เอาจาก dataset — แกะจากข้อความไม่ได้ (Android = serial แต่ iOS = runtime)
    return { name: row.querySelector('.mirror-device-name').textContent, id: row.dataset.deviceId, platform: row.dataset.platform };
  }, MATCH);
  if (!found) {
    const rows = await page.evaluate(() => [...document.querySelectorAll('.mirror-device-row')].map((r) => r.textContent.slice(0, 50)));
    console.log(`ไม่เจอเครื่องที่ตรงกับ "${MATCH}" · ในรายการมี: ${rows.join(' / ') || '(ว่าง)'}`);
    await browser.close(); process.exit(1);
  }
  const isIos = found.platform === 'ios';
  const id = found.id; // serial ของ Android / udid ของ sim
  await sleep(5000);           // รอ session นิ่งก่อนเริ่มนับ
  // NO_MOTION=1 = จอมีอะไรขยับเองอยู่แล้ว (เช่นเปิดหน้าเว็บอนิเมชันไว้) — ตัวกวนจอเองก็กิน CPU
  // (idb swipe = Python 1 process ต่อครั้ง) ทำให้เลขที่วัดเพี้ยน
  const motion = process.env.NO_MOTION ? null : startMotion(isIos ? 'ios' : 'android', id);
  await sleep(1500);
  rx = 0; bytes = 0;
  const t0 = Date.now();
  await sleep(SECS * 1000);
  if (motion) clearInterval(motion);
  const d = (Date.now() - t0) / 1000;
  const status = await page.evaluate(() => document.querySelector('.mirror-status-text')?.textContent || '');
  console.log(`${found.name} (${id}) → รับ ${(rx / d).toFixed(1)} เฟรม/วิ · ${(bytes / d / 1024 / 1024).toFixed(2)} MB/s · แถบสถานะ: "${status}"`);
  await browser.close();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
