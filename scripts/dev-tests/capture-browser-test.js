#!/usr/bin/env node
// Dev-test: "ดักจับเว็บที่กำลังทำ" — endpoint /api/proxy/capture-browser + การ์ดในหน้า Status
// ⚠️ รันด้วย CAPTURE_BROWSER_DRYRUN=1 (ไม่งั้นจะเปิด Chrome จริง):
//   env -u NODE_OPTIONS PORT=3100 CAPTURE_BROWSER_DRYRUN=1 MAP_LOCAL_FILE=/tmp/ml.json MAP_GROUPS_FILE=/tmp/mg.json node server.js
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/capture-browser-test.js
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));
const PORT = process.env.PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failed = 0;
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const postJson = (body) => fetch(BASE + '/api/proxy/capture-browser', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch((e) => ({ err: e.message }));

(async () => {
  // 1) dry-run: สร้าง args ถูก (proxy เข้า mitm + ปิด loopback bypass + โปรไฟล์แยก + รับ cert + url)
  const r = await postJson({ url: 'http://localhost:5173' });
  const a = (r.args || []).join(' ');
  check('1 ok + dryRun', r.ok === true && r.dryRun === true, JSON.stringify(r).slice(0, 120));
  check('1 proxy ชี้เข้า mitmproxy', /--proxy-server=http:\/\/127\.0\.0\.1:\d+/.test(a), a.slice(0, 80));
  check('1 ปิด bypass localhost (<-loopback>)', a.includes('--proxy-bypass-list=<-loopback>'), '');
  check('1 โปรไฟล์แยก (--user-data-dir)', /--user-data-dir=\S*apitester-capture-profile/.test(a), '');
  check('1 รับ cert mitmproxy (--ignore-certificate-errors)', a.includes('--ignore-certificate-errors'), '');
  check('1 ส่ง url ที่ให้มา', a.includes('http://localhost:5173'), '');

  // 2) ไม่มี url ก็ได้ (เปิดเบราว์เซอร์เปล่า)
  const r2 = await postJson({});
  check('2 ไม่ใส่ url → ยัง ok', r2.ok === true, JSON.stringify(r2).slice(0, 80));

  // 3) url ผิดรูปแบบ → 400
  const r3 = await postJson({ url: 'localhost:5173' });
  check('3 url ไม่มี http:// → error', r3.ok === false, JSON.stringify(r3).slice(0, 80));

  // 4) UI: การ์ด "ดักจับเว็บที่กำลังทำ" + ช่อง url + ปุ่มเปิด
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="status"]');
  await sleep(600);
  const card = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#status-cards .st-card')];
    const c = cards.find((x) => /ดักจับเว็บที่กำลังทำ/.test(x.textContent));
    if (!c) return { found: false };
    return { found: true, hasInput: !!c.querySelector('.st-url-input'), hasBtn: /เปิดเบราว์เซอร์ดักจับ/.test(c.textContent) };
  });
  check('4 การ์ด "ดักจับเว็บที่กำลังทำ" โผล่', card.found, JSON.stringify(card));
  check('4 มีช่อง URL + ปุ่มเปิด', card.hasInput && card.hasBtn, JSON.stringify(card));
  check('5 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'capture-browser-card.png' });
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
