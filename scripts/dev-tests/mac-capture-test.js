#!/usr/bin/env node
// Dev-test: ดักจับ traffic ของ Mac เอง (endpoint /api/devices/mac/* + การ์ดในหน้า Status)
// ⚠️ ต้องรันด้วย MAC_PROXY_DRYRUN=1 เท่านั้น — ไม่งั้นจะไปตั้ง macOS proxy จริงของเครื่อง!
//   env -u NODE_OPTIONS PORT=3100 MAC_PROXY_DRYRUN=1 MAP_LOCAL_FILE=/tmp/ml.json MAP_GROUPS_FILE=/tmp/mg.json node server.js
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/mac-capture-test.js
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));
const PORT = process.env.PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failed = 0;
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p) => fetch(BASE + p, { method: 'POST' }).then((r) => r.status).catch(() => 0);
const postJson = (p) => fetch(BASE + p, { method: 'POST' }).then((r) => r.json()).catch((e) => ({ err: e.message }));

(async () => {
  // 1) endpoint /api/devices/mac/connect wired (ไม่ใช่ 404) — ok:true (mitm up) หรือ mitmDown:true (mitm ปิด)
  const st = await post('/api/devices/mac/connect');
  check('1 /api/devices/mac/connect มีจริง (ไม่ 404)', st !== 404 && st !== 0, `http=${st}`);
  const cr = await postJson('/api/devices/mac/connect');
  check('1 connect ตอบถูกชนิด (ok+connected หรือ mitmDown)', cr.ok === true ? cr.connected === true : cr.mitmDown === true, JSON.stringify(cr));

  // 2) disconnect ตอบ ok + connected=false
  const dr = await postJson('/api/devices/mac/disconnect');
  check('2 /api/devices/mac/disconnect → ok + connected=false', dr.ok === true && dr.connected === false, JSON.stringify(dr));

  // 3) UI: การ์ด "เครื่องนี้ (Mac)" โผล่ในหน้า Status พร้อมปุ่มดักจับ
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="status"]');
  await sleep(600);
  const card = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#status-cards .st-card, #status-cards > *')];
    const macCard = cards.find((c) => /เครื่องนี้ \(Mac\)/.test(c.textContent));
    if (!macCard) return { found: false, titles: cards.map((c) => (c.textContent || '').slice(0, 24)) };
    return { found: true, hasCaptureBtn: /ดักจับเครื่องนี้|หยุดดักจับ/.test(macCard.textContent), hasTrustBtn: /trust CA/.test(macCard.textContent) };
  });
  check('3 การ์ด "เครื่องนี้ (Mac)" โผล่ในหน้า Status', card.found, JSON.stringify(card));
  check('3 มีปุ่มดักจับ + ปุ่ม trust CA', card.hasCaptureBtn && card.hasTrustBtn, JSON.stringify(card));
  check('4 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'mac-capture-card.png' });
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
