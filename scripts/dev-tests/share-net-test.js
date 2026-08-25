#!/usr/bin/env node
// Dev-test ปุ่ม "แชร์เน็ตจาก Mac ผ่าน USB" ในแท็บ ⚙️ Status (แยกรายเครื่อง)
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/share-net-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// ใช้ request interception ปลอม /api/status → คุมสถานะได้ทุกแบบโดยไม่ต้องมีมือถือจริง
// เช็ค: 1 ปุ่มแยกรายเครื่อง (การ์ดละ 1 ปุ่ม) · 2 ป้ายปุ่มตามสถานะ · 3 emulator ไม่มีปุ่ม
//        4 บรรทัดเตือน "ไม่มีเน็ตของตัวเอง" · 5 กำลังแชร์ → บอกว่าใช้เน็ต Mac อยู่
//        6 กดเปิด → POST /api/devices/connect {mode:'usb'} ของเครื่องนั้น
//        7 กดหยุด → POST /api/devices/disconnect ของเครื่องนั้น · 8 ไม่มี JS error
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 3 เครื่อง: A = ไม่มีเน็ตของตัวเอง + ยังไม่แชร์ · B = ไม่มีเน็ต + กำลังแชร์อยู่ · C = emulator
const STATUS = {
  ok: true,
  services: { apitester: { up: true, port: 3100 }, mitmproxy: { up: true, port: 8888 }, mcp: { up: false, port: 7333, url: '' } },
  devices: [
    { serial: 'DEV-A', model: 'Phone A', connected: false, proxy: null, mode: null, posternRunning: false, transport: 'usb', emulator: false, reverse: null, systemCa: null, ownNet: false },
    { serial: 'DEV-B', model: 'Phone B', connected: true, proxy: '127.0.0.1:8888', mode: 'usb', posternRunning: false, transport: 'usb', emulator: false, reverse: true, systemCa: null, ownNet: false },
    { serial: 'emulator-5554', model: 'Emulator', connected: true, proxy: '127.0.0.1:8888', mode: 'usb', posternRunning: false, transport: 'usb', emulator: true, reverse: true, systemCa: true, ownNet: null },
  ],
  iosSims: [], iosProxy: { active: false, service: null, macCaTrusted: false },
  muted: false, mutedDropped: 0, flows: { count: 0, lastAt: null }, autoReconnect: {}, lanIp: '192.168.1.10',
};

// การ์ด device ทั้งหมด: ชื่อ + ป้ายปุ่มแชร์เน็ต + บรรทัดที่เกี่ยวกับเน็ต
const readCards = (page) => page.evaluate(() => [...document.querySelectorAll('#status-cards .st-card')]
  .map((c) => ({
    title: c.querySelector('.st-title').textContent,
    lines: [...c.querySelectorAll('.st-line')].map((l) => l.textContent),
    shareBtns: [...c.querySelectorAll('.st-action')].filter((b) => b.textContent.includes('แชร์เน็ต')).map((b) => b.textContent),
  }))
  .filter((c) => c.title.includes('Phone') || c.title.includes('Emulator')));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  const posted = [];
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.endsWith('/api/status')) {
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(STATUS) });
    }
    if (url.includes('/api/devices/connect') || url.includes('/api/devices/disconnect')) {
      posted.push({ url: url.replace(/^https?:\/\/[^/]+/, ''), body: JSON.parse(req.postData() || '{}') });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, connected: true }) });
    }
    req.continue();
  });

  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="status"]');
  await sleep(600);

  const cards = await readCards(page);
  check('1 การ์ด device ครบ 3 ใบ', cards.length === 3, cards.map((c) => c.title).join(' | '));
  check('1 ปุ่มแชร์เน็ตแยกรายเครื่อง (การ์ดละ 1 ปุ่ม)',
    cards[0].shareBtns.length === 1 && cards[1].shareBtns.length === 1,
    JSON.stringify(cards.map((c) => c.shareBtns)));
  check('2 เครื่องที่ยังไม่แชร์ → ปุ่ม “แชร์เน็ต USB”', cards[0].shareBtns[0] === '🌍 แชร์เน็ต USB', cards[0].shareBtns[0]);
  check('2 เครื่องที่กำลังแชร์ → ปุ่ม “หยุดแชร์เน็ต”', cards[1].shareBtns[0] === '🌍 หยุดแชร์เน็ต', cards[1].shareBtns[0]);
  check('3 emulator ไม่มีปุ่มแชร์เน็ต (ใช้เน็ต Mac อยู่แล้ว)', cards[2].shareBtns.length === 0, JSON.stringify(cards[2].shareBtns));
  check('4 เครื่องไม่มีเน็ต + ยังไม่แชร์ → เตือนให้กดแชร์',
    cards[0].lines.some((l) => l.includes('ไม่มีเน็ตของตัวเอง') && l.includes('แชร์เน็ต USB')),
    cards[0].lines.join(' / '));
  check('5 เครื่องไม่มีเน็ต + กำลังแชร์ → บอกว่าใช้เน็ตของ Mac อยู่',
    cards[1].lines.some((l) => l.includes('ใช้เน็ตของ Mac ผ่านสาย USB อยู่')),
    cards[1].lines.join(' / '));

  // 6) กดเปิดแชร์ที่เครื่อง A → ต้องยิง connect ของ DEV-A โหมด usb (ไม่ใช่เครื่องอื่น)
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#status-cards .st-card')].find((c) => c.querySelector('.st-title').textContent.includes('Phone A'));
    [...card.querySelectorAll('.st-action')].find((b) => b.textContent.includes('แชร์เน็ต')).click();
  });
  await sleep(400);
  const p1 = posted[posted.length - 1] || {};
  check('6 กดแชร์ที่เครื่อง A → connect DEV-A โหมด usb',
    p1.url === '/api/devices/connect' && p1.body.serial === 'DEV-A' && p1.body.mode === 'usb', JSON.stringify(p1));

  // 7) กดหยุดแชร์ที่เครื่อง B → disconnect ของ DEV-B
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('#status-cards .st-card')].find((c) => c.querySelector('.st-title').textContent.includes('Phone B'));
    [...card.querySelectorAll('.st-action')].find((b) => b.textContent.includes('แชร์เน็ต')).click();
  });
  await sleep(400);
  const p2 = posted[posted.length - 1] || {};
  check('7 กดหยุดแชร์ที่เครื่อง B → disconnect DEV-B',
    p2.url === '/api/devices/disconnect' && p2.body.serial === 'DEV-B', JSON.stringify(p2));

  check('8 ไม่มี JS error บนหน้า', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'share-net-status.png', fullPage: true });
  console.log('screenshot: share-net-status.png');
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
