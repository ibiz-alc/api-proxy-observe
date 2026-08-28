#!/usr/bin/env node
// Dev-test เมนู ⋯ (kebab) + flyout "Copy as" ในแท็บ Proxy ต้องไม่โดน overflow ของ .detail-subtabs clip
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/proxy-kebab-menu-test.js
// รันจากนอก repo · ต้องมี puppeteer-core · bug เดิม: .detail-subtabs{overflow-y:hidden} clip เมนูที่ drop ลงมา
// fix: .kebab-menu เป็น position:fixed + ตั้งพิกัดจากปุ่มตอน mouseenter (หลุด overflow ทุกชั้น)
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));
const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failed = 0;
const check = (name, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? ' — ' + d : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOW = {
  id: 'f1', method: 'GET', url: 'https://claim-app-api.alpha.thaivivat.co.th/api/tasks/1029', path: '/api/tasks/1029',
  host: 'claim-app-api.alpha.thaivivat.co.th', status: 200, statusText: 'OK', durationMs: 15, resSize: 79600,
  reqHeaders: { Host: 'claim-app-api.alpha.thaivivat.co.th', Connection: 'keep-alive', 'Cache-Control': 'max-age=0', 'User-Agent': 'Mozilla/5.0' },
  reqBody: '', resHeaders: { 'Content-Type': 'application/json' }, resBody: JSON.stringify({ ok: true }), ts: 1,
};

// เมนูเปิดอยู่ → ทุกไอเทมต้อง "มองเห็นจริง" (elementFromPoint ที่กึ่งกลางไอเทม = ตัวไอเทมนั้น ไม่โดนของอื่นทับ)
const itemsVisible = (page, menuSel) => page.evaluate((sel) => {
  const menu = document.querySelector(sel);
  if (!menu || getComputedStyle(menu).display === 'none') return { ok: false, reason: 'menu ไม่โผล่' };
  const items = [...menu.children].filter((c) => c.offsetHeight > 4 && !c.className.includes('sep'));
  const bad = [];
  for (const it of items) {
    const r = it.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit || !menu.contains(hit)) bad.push((it.textContent || '').trim().slice(0, 20) + ` → ${hit ? (hit.className || hit.tagName) : 'null'}`);
  }
  return { ok: bad.length === 0, count: items.length, bad };
}, menuSel);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1035, height: 820 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="proxy"]');
  await page.evaluate((f) => window.renderFlowDetail(f), FLOW);
  await page.evaluate(() => { const w = document.getElementById('flow-list-wrap'); if (w) w.style.height = '160px'; });
  await sleep(200);

  const kebab = await page.$('#flow-detail .detail-pane .kebab-btn');
  check('พบปุ่ม ⋯ ใน Request pane', !!kebab);
  await kebab.evaluate((b) => b.scrollIntoView({ block: 'nearest' }));
  const box = await kebab.boundingBox();
  await page.mouse.move(10, 10);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await sleep(300);

  const kv = await itemsVisible(page, '#flow-detail .detail-pane .kebab-menu');
  check('เมนู ⋯ ทุกไอเทมมองเห็นจริง (ไม่โดน clip)', kv.ok, kv.bad && kv.bad.length ? kv.bad.join(' | ') : `${kv.count} items`);

  // เมนูล้นใต้แถบ subtabs (drop ลงมา) แต่ต้องไม่โดน clip เพราะ fixed
  const geo = await page.evaluate(() => {
    const m = document.querySelector('#flow-detail .detail-pane .kebab-menu').getBoundingClientRect();
    const st = document.querySelector('#flow-detail .detail-pane .detail-subtabs').getBoundingClientRect();
    const pos = getComputedStyle(document.querySelector('#flow-detail .detail-pane .kebab-menu')).position;
    return { dropsBelowBar: m.bottom > st.bottom + 20, position: pos, inViewport: m.bottom <= window.innerHeight + 0.5 };
  });
  check('เมนู position:fixed', geo.position === 'fixed', geo.position);
  check('เมนู drop ต่ำกว่าแถบ subtabs จริง (เคสที่เคยโดน clip)', geo.dropsBelowBar);
  check('เมนูอยู่ในจอ (ไม่ล้นล่าง)', geo.inViewport);

  // hover flyout "Copy as ▸"
  const copyTrigger = await page.$('#flow-detail .detail-pane .copy-as-trigger');
  check('พบ Copy as trigger', !!copyTrigger);
  if (copyTrigger) {
    const cb = await copyTrigger.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 3 });
    await sleep(300);
    const cv = await itemsVisible(page, '#flow-detail .detail-pane .copy-as-menu');
    check('flyout Copy as ทุกไอเทมมองเห็นจริง', cv.ok, cv.bad && cv.bad.length ? cv.bad.join(' | ') : `${cv.count} items`);
  }

  await page.screenshot({ path: 'proxy-kebab-menu.png' });
  check('ไม่มี page error', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nALL PASS ผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
