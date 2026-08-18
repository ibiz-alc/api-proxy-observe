#!/usr/bin/env node
// Dev-test mirror ของ iOS Simulator — ต้องมี sim บูตอยู่ก่อน (xcrun simctl boot <udid>)
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/ios-mirror-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core
// เช็ค: 1 sim โผล่ใน Device Manager · 2 กดดูจอแล้วได้ ready(platform=ios) · 3 มีเฟรมวาดจริง
//        4 fps > 3 · 5 ปุ่มเฉพาะ Android ถูกซ่อน · 6 หยุดแล้ว WS ปิด · 7 ไม่มี page error
const path = require('path');
const { execFile } = require('child_process');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 950 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });

  // เปิด Device Manager จาก rail
  await page.click('#mirrorRailDevices');
  // รอรายการโผล่ — /api/devices ต้องถาม adb ก่อน ตอน server เพิ่งสตาร์ทอาจใช้เวลาหลายวินาที
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.mirror-device-row').length);
    if (n) break;
    await sleep(1000);
  }

  // 1) sim โผล่ในรายการ
  const rows = await page.evaluate(() => [...document.querySelectorAll('.mirror-device-row')].map((r) => ({
    name: r.querySelector('.mirror-device-name')?.textContent || '',
    sub: r.querySelector('.mirror-device-sub')?.textContent || '',
  })));
  const iosRow = rows.find((r) => r.name.includes('🍎'));
  check('1 sim โผล่ใน Device Manager', !!iosRow, iosRow ? `${iosRow.name} · ${iosRow.sub}` : `เจอ ${rows.length} แถว: ${rows.map((r) => r.name).join(', ')}`);
  if (!iosRow) { await browser.close(); process.exit(1); }

  // 2) กด ▶ ดูจอ ของแถว iOS
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.mirror-device-row')].find((r) => r.textContent.includes('🍎'));
    row.querySelector('button').click();
  });
  await sleep(6000);

  const st = await page.evaluate(() => ({
    hasCanvas: !!document.querySelector('.mirror-video canvas'),
    w: document.querySelector('.mirror-video canvas')?.width || 0,
    h: document.querySelector('.mirror-video canvas')?.height || 0,
    status: document.querySelector('.mirror-status-text')?.textContent || '',
    // canvas ว่าง = ทุก pixel เป็น 0 → เช็คว่ามีภาพวาดจริง
    painted: (() => {
      const c = document.querySelector('.mirror-video canvas');
      if (!c) return false;
      const t = document.createElement('canvas'); t.width = 40; t.height = 40;
      const x = t.getContext('2d'); x.drawImage(c, 0, 0, 40, 40);
      const d = x.getImageData(0, 0, 40, 40).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) return true;
      return false;
    })(),
  }));
  // canvas ถูกย่อตอน decode (IOS_RENDER_W) — เช็คสัดส่วนว่าตรงกับจอ sim จริง (1206x2622 ≈ 0.46)
  const ratio = st.w && st.h ? st.w / st.h : 0;
  check('2 ต่อแล้วได้ canvas สัดส่วนตรงกับจอ sim', st.hasCanvas && st.w >= 320 && Math.abs(ratio - 1206 / 2622) < 0.02,
    `${st.w}x${st.h} ratio=${ratio.toFixed(3)}`);
  check('3 มีภาพวาดจริงบน canvas', st.painted, st.status);

  // 4) fps จากแถบสถานะ — ต้องทำให้จอเปลี่ยนก่อน เพราะเฟรมที่ซ้ำเดิมจะถูกข้าม (จอนิ่ง = 0 fps ถูกต้องแล้ว)
  //    สลับ light/dark ด้วย simctl = ทั้งจอเปลี่ยน ไม่ต้องพึ่ง idb และไม่ขึ้นกับว่าเปิดแอปอะไรอยู่
  const udid = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.mirror-device-row')].find((r) => r.textContent.includes('🍎'));
    return row.querySelector('.mirror-device-sub').textContent.split(' ')[0];
  });
  let best = 0, seen = '';
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => execFile('xcrun', ['simctl', 'ui', udid, 'appearance', i % 2 ? 'light' : 'dark'], () => r()));
    await sleep(1200);
    seen = await page.evaluate(() => document.querySelector('.mirror-status-text')?.textContent || '');
    const n = Number((seen.match(/(\d+)\s*fps/) || [])[1] || 0);
    if (n > best) best = n;
  }
  check('4 มีเฟรมเข้ามาเมื่อจอเปลี่ยน (fps > 0)', best > 0, `สูงสุด ${best} fps · ล่าสุด: "${seen}"`);

  // 5) ปุ่มเฉพาะ Android ถูกซ่อนตอน mirror iOS
  const tools = await page.evaluate(() => [...document.querySelectorAll('.mirror-toolbar .mirror-tool')]
    .map((b) => ({ t: b.title, hidden: b.style.display === 'none' })));
  const backHidden = tools.find((t) => t.t.includes('ย้อนกลับ'))?.hidden;
  const homeShown = tools.find((t) => t.t.includes('หน้าหลัก'))?.hidden === false;
  const siriShown = tools.find((t) => t.t.includes('Siri'))?.hidden === false;
  check('5 ซ่อนปุ่ม Android / โชว์ปุ่ม iOS', backHidden === true && homeShown && siriShown,
    tools.map((t) => `${t.t}:${t.hidden ? 'ซ่อน' : 'โชว์'}`).join(' | '));

  await page.screenshot({ path: 'ios-mirror.png' });

  // 6) กดหยุด → WS ปิด
  await page.click('#mirrorRailDevices');
  await sleep(600);
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.mirror-device-row')].find((r) => r.textContent.includes('🍎'));
    row.querySelector('button').click();
  });
  await sleep(1500);
  const stopped = await page.evaluate(() => document.querySelector('.mirror-status-text')?.textContent || '');
  check('6 หยุดแล้วสถานะกลับเป็น idle', /ตัดการเชื่อมต่อ|ยังไม่เชื่อมต่อ|สตรีมหยุด/.test(stopped), stopped);

  check('7 ไม่มี page error', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
