#!/usr/bin/env node
// Dev-test เส้นทาง input ของ mirror iOS — ใช้ "idb ปลอม" ที่บันทึก argv ลงไฟล์
// จึงเทสต์ได้ครบเส้นทาง client → WS → mirror.js → ios-mirror.js → argv ของ idb
// โดยไม่ต้องมี idb_companion จริง (ตัวจริงต้อง build ด้วย Xcode + Command Line Tools ใหม่)
//
//   IDB=<fake idb> IDB_FAKE_LOG=<log> PORT=3100 env -u NODE_OPTIONS node scripts/dev-tests/ios-mirror-input-test.js
// server ที่รันต้องเห็น env IDB/IDB_FAKE_LOG เดียวกัน
// เช็ค: 1 มี idb → status ไม่บอก "ดูอย่างเดียว" · 2 แตะกลางจอ → ui tap พิกัด point ถูก
//        3 ลาก → ui swipe · 4 พิมพ์ข้อความ → ui text · 5 ปุ่ม Home/Lock/Siri → ui button
const fs = require('fs');
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const LOG = process.env.IDB_FAKE_LOG || '/tmp/idb-fake.log';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readLog = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : []);

(async () => {
  try { fs.unlinkSync(LOG); } catch {}
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('#mirrorRailDevices');
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => document.querySelectorAll('.mirror-device-row').length)) break;
    await sleep(1000);
  }
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.mirror-device-row')].find((r) => r.textContent.includes('🍎'));
    row.querySelector('button').click();
  });
  await sleep(5000);

  // 1) เห็น idb → บอกว่าสั่งงานได้ (ไม่ขึ้น "ดูอย่างเดียว") + describe ถูกเรียกเอาขนาด point
  const status = await page.evaluate(() => document.querySelector('.mirror-status-text')?.textContent || '');
  check('1 มี idb → ไม่ขึ้น "ดูอย่างเดียว"', !/ดูอย่างเดียว|ติดตั้ง idb/.test(status), status);
  check('1 เรียก idb describe เอาขนาดจอ (point)', readLog().some((l) => l.startsWith('describe')),
    readLog().find((l) => l.startsWith('describe')) || 'ไม่มี describe ใน log');

  // 2) แตะกลาง canvas → ui tap ที่ ~กลางจอ (จอ 1206x2622 density 3 → 402x874 point)
  const box = await page.evaluate(() => {
    const c = document.querySelector('.mirror-video canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2);
  await sleep(1500);
  const tap = readLog().find((l) => l.startsWith('ui tap'));
  const tp = tap ? tap.match(/ui tap (\d+) (\d+)/) : null;
  check('2 แตะกลางจอ → ui tap พิกัดกลางจอ (point)',
    !!tp && Math.abs(Number(tp[1]) - 201) <= 12 && Math.abs(Number(tp[2]) - 437) <= 14, tap || 'ไม่มี ui tap');

  // 3) ลาก → ui swipe
  await page.mouse.move(box.x + box.w / 2, box.y + box.h * 0.7);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w / 2, box.y + box.h * 0.3, { steps: 8 });
  await page.mouse.up();
  await sleep(1500);
  const sw = readLog().find((l) => l.startsWith('ui swipe'));
  check('3 ลาก → ui swipe (จากล่างขึ้นบน)', !!sw && /ui swipe \d+ (\d+) \d+ (\d+)/.test(sw)
    && Number(sw.match(/ui swipe \d+ (\d+) \d+ (\d+)/)[1]) > Number(sw.match(/ui swipe \d+ (\d+) \d+ (\d+)/)[2]), sw || 'ไม่มี ui swipe');

  // 4) พิมพ์ข้อความจากช่องล่าง → ui text
  await page.type('.mirror-text-input', 'hello ios');
  await page.click('.mirror-bottom .mirror-btn');
  await sleep(1500);
  const tx = readLog().find((l) => l.startsWith('ui text'));
  check('4 ส่งข้อความ → ui text', !!tx && tx.includes('hello ios'), tx || 'ไม่มี ui text');

  // 5) ปุ่ม Home / Lock / Siri → ui button
  for (const title of ['หน้าหลัก', 'ปุ่ม power / ล็อกจอ', 'Siri']) {
    await page.evaluate((t) => [...document.querySelectorAll('.mirror-toolbar .mirror-tool')].find((b) => b.title === t).click(), title);
    await sleep(900);
  }
  const buttons = readLog().filter((l) => l.startsWith('ui button')).map((l) => l.split(' ')[2]);
  check('5 ปุ่ม Home/Lock/Siri → ui button', ['HOME', 'LOCK', 'SIRI'].every((b) => buttons.includes(b)), buttons.join(',') || 'ไม่มี ui button');

  check('6 ไม่มี page error', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
