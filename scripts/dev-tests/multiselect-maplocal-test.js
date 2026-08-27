#!/usr/bin/env node
// Dev-test: หน้า Proxy เลือกหลาย URL → bulk Map Local (dedupe เต็ม URL) — puppeteer
//   env -u NODE_OPTIONS PORT=3100 MAP_LOCAL_FILE=/tmp/ml-test.json MAP_GROUPS_FILE=/tmp/mg-test.json node server.js
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/multiselect-maplocal-test.js
// ต้องมี puppeteer-core · รันจากนอก repo (screenshot ลง cwd)
// เช็ค: checkbox เลือก · Shift=ช่วง · Cmd=ทีละอัน · action bar count · ล้าง · bulk POST dedupe เต็ม URL · ungrouped
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rules = async () => (await fetch(BASE + '/api/maplocal')).json();
const now = Date.now();
const FLOWS = [
  { id: 'f1', method: 'GET', host: 'api.x.com', path: '/users?p=1', url: 'https://api.x.com/users?p=1', scheme: 'https', status: 200, resContentType: 'application/json', resBody: '{"a":1}', time: now, durationMs: 10, resSize: 7, device: '' },
  { id: 'f2', method: 'GET', host: 'api.x.com', path: '/users?p=1', url: 'https://api.x.com/users?p=1', scheme: 'https', status: 200, resContentType: 'application/json', resBody: '{"a":1}', time: now, durationMs: 12, resSize: 7, device: '' }, // url ซ้ำ f1
  { id: 'f3', method: 'POST', host: 'api.x.com', path: '/login', url: 'https://api.x.com/login', scheme: 'https', status: 201, resContentType: 'application/json', resBody: '{"t":"x"}', time: now, durationMs: 20, resSize: 8, device: '' },
];
const selSize = (page) => page.evaluate(() => selectedFlowIds.size);
const barVisible = (page) => page.evaluate(() => document.getElementById('flow-select-bar').style.display !== 'none');
const barCount = (page) => page.evaluate(() => (document.getElementById('flow-select-count') || {}).textContent || '');
const injectFlows = (page) => page.evaluate((flows) => {
  allFlows.length = 0; for (const f of flows) allFlows.push(f);
  selectedFlowIds.clear(); lastClickedFlowId = null; renderFlowTable();
}, FLOWS);

(async () => {
  // เคลียร์ rule ที่ค้างในไฟล์ temp ก่อน
  for (const r of await rules()) await fetch(BASE + '/api/maplocal/' + r.id, { method: 'DELETE' });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="proxy"]');
  await sleep(150);
  await injectFlows(page);
  await sleep(100);

  // 1) render checkbox ครบทุกแถว
  const nItems = await page.$$eval('#flow-list-body .flow-item', (a) => a.length);
  const nChecks = await page.$$eval('#flow-list-body .flow-check', (a) => a.length);
  check('1 render 3 แถว + 3 checkbox', nItems === 3 && nChecks === 3, `items=${nItems} checks=${nChecks}`);

  // 2) checkbox เลือกอันแรก → size 1, action bar โผล่ + count
  await page.click('#flow-list-body .flow-item:nth-child(1) .flow-check');
  await sleep(60);
  check('2 checkbox เลือก 1 → size=1', (await selSize(page)) === 1, `size=${await selSize(page)}`);
  check('2 action bar โผล่', await barVisible(page), '');
  check('2 count = "เลือก 1 รายการ"', (await barCount(page)) === 'เลือก 1 รายการ', await barCount(page));

  // 3) Shift+click แถวที่ 3 → เลือกช่วง 1..3 = ทั้งหมด
  await page.evaluate(() => {
    const items = document.querySelectorAll('#flow-list-body .flow-item');
    items[2].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  });
  await sleep(60);
  check('3 Shift+click → เลือกช่วงครบ 3', (await selSize(page)) === 3, `size=${await selSize(page)}`);

  // 4) ปุ่มล้าง → size 0, bar หาย
  await page.click('#flow-select-clear');
  await sleep(60);
  check('4 ล้าง → size=0 + bar หาย', (await selSize(page)) === 0 && !(await barVisible(page)), `size=${await selSize(page)} vis=${await barVisible(page)}`);

  // 5) Cmd+click ทีละอันครบ 3 (2 อันแรก url ซ้ำกัน)
  await page.evaluate(() => {
    for (const it of document.querySelectorAll('#flow-list-body .flow-item')) {
      it.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    }
  });
  await sleep(60);
  check('5 Cmd+click เลือกครบ 3', (await selSize(page)) === 3, `size=${await selSize(page)}`);
  check('5 count = "เลือก 3 รายการ"', (await barCount(page)) === 'เลือก 3 รายการ', await barCount(page));

  // 6) กด Map Local → dedupe เต็ม URL: 3 เลือก (2 ซ้ำ) → สร้าง 2 rule, ข้ามซ้ำ 1
  await page.click('#flow-select-map');
  await sleep(500);
  const created = await rules();
  check('6 bulk สร้าง 2 rule (dedupe เต็ม URL)', created.length === 2, `len=${created.length}`);
  check('6 rule ที่สร้าง = ungrouped', created.every((r) => r.scenario === ''), JSON.stringify(created.map((r) => r.scenario)));
  const toast = await page.evaluate(() => (document.getElementById('copy-toast') || {}).textContent || '');
  check('6 toast บอก "สร้าง 2 · ข้ามซ้ำ 1"', /สร้าง Map Local 2/.test(toast) && /ข้ามซ้ำ 1/.test(toast), toast);
  check('6 หลังสร้างเสร็จ selection ถูกล้าง (bar หาย)', !(await barVisible(page)), '');

  check('7 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'multiselect-maplocal.png' });
  console.log('screenshot: multiselect-maplocal.png');
  await browser.close();
  // เก็บกวาด
  for (const r of await rules()) await fetch(BASE + '/api/maplocal/' + r.id, { method: 'DELETE' });
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
