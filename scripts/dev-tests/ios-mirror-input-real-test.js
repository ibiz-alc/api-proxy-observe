#!/usr/bin/env node
// Dev-test แตะจริงบน iOS Simulator ผ่านหน้าเว็บ (ต้องมี idb + idb_companion จริง)
//   IDB=<venv>/bin/idb IDB_COMPANION_BIN=<path/idb_companion> PORT=3100 \
//     env -u NODE_OPTIONS node scripts/dev-tests/ios-mirror-input-real-test.js
// server ที่รันต้องเห็น env IDB/IDB_COMPANION_BIN ชุดเดียวกัน
// (อย่าใช้ชื่อ IDB_COMPANION — เป็น env ของ idb เองที่หมายถึง address ของ socket)
//
// วิธีพิสูจน์ว่าแตะติดจริง (ไม่ใช่แค่ยิงคำสั่งออกไป): อ่าน accessibility tree ของ sim
//   1 กด HOME → หา icon "Settings" เอา frame (หน่วย point) จาก idb ui describe-all
//   2 คลิกบน canvas ในเบราว์เซอร์ที่ตำแหน่งเดียวกัน (normalize เป็น 0..1)
//   3 อ่าน tree อีกครั้ง → ต้องเห็นของในแอป Settings (ไม่ใช่หน้า home แล้ว)
//   4 กด HOME คืนสภาพเดิม
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const IDB = process.env.IDB || 'idb';
const COMPANION = process.env.IDB_COMPANION_BIN;
const UDID = process.env.UDID;

let failed = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const idbEnv = COMPANION
  ? (() => { const e = { ...process.env, PATH: `${path.dirname(COMPANION)}:${process.env.PATH}` }; delete e.IDB_COMPANION; return e; })()
  : process.env;
const idb = (args, timeout = 60000) => execFileP(IDB, args, { timeout, env: idbEnv, maxBuffer: 8 * 1024 * 1024 });

async function udid() {
  if (UDID) return UDID;
  const { stdout } = await execFileP('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: 15000 });
  for (const arr of Object.values(JSON.parse(stdout).devices || {})) {
    for (const d of arr) if (d.state === 'Booted') return d.udid;
  }
  throw new Error('ไม่มี simulator ที่บูตอยู่');
}

async function tree(u) {
  const { stdout } = await idb(['ui', 'describe-all', '--udid', u, '--json']);
  return JSON.parse(stdout);
}

(async () => {
  const u = await udid();
  await idb(['ui', 'button', 'HOME', '--udid', u]);
  await sleep(2000);

  // หา icon Settings บนหน้า home (หน่วยเป็น point เท่ากับที่ idb ui tap ใช้)
  const home = await tree(u);
  const app = home.find((e) => e.role === 'AXApplication') || {};
  const scr = app.frame || { width: 402, height: 874 };
  const icon = home.find((e) => (e.AXLabel || '').trim() === 'Settings');
  check('1 เจอ icon Settings บนหน้า home', !!icon, icon ? JSON.stringify(icon.frame) : `element ${home.length} ตัว`);
  if (!icon) process.exit(1);
  const cx = (icon.frame.x + icon.frame.width / 2) / scr.width;
  const cy = (icon.frame.y + icon.frame.height / 2) / scr.height;

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
  await sleep(6000);
  const status = await page.evaluate(() => document.querySelector('.mirror-status-text')?.textContent || '');
  check('2 mirror ต่อแล้วและสั่งงานได้ (ไม่ใช่ "ดูอย่างเดียว")', !/ดูอย่างเดียว/.test(status), status);

  // คลิกบน canvas ตรงตำแหน่ง icon Settings
  const box = await page.evaluate(() => {
    const r = document.querySelector('.mirror-video canvas').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.mouse.click(box.x + box.w * cx, box.y + box.h * cy);
  await sleep(4000);

  // Settings เปิดแล้วหรือยัง — หน้าแรกของ Settings มีคำพวกนี้เสมอ
  const after = await tree(u);
  const labels = after.map((e) => (e.AXLabel || '').trim()).filter(Boolean);
  const opened = labels.some((l) => /General|Apple Account|Wi-Fi|Notifications|ทั่วไป/i.test(l));
  check('3 คลิกในเบราว์เซอร์ → sim เปิดแอป Settings จริง', opened, labels.slice(0, 8).join(' | ') || 'ไม่มี label');

  await page.screenshot({ path: 'ios-mirror-input.png' });
  await idb(['ui', 'button', 'HOME', '--udid', u]); // คืนสภาพ
  check('4 ไม่มี page error', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
