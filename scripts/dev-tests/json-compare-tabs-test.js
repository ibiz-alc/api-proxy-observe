#!/usr/bin/env node
// Dev-test แท็บ 📑 JSON: sub-tab หลายเอกสาร + Compare ซ้าย/ขวา — รันกับ dev server แยก (อย่ารันกับ :3000)
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/json-compare-tabs-test.js
// เช็ค: 1 jdDiff ถูก · 2 เพิ่ม/สลับ sub-tab ข้อความแยกกัน · 3 compare นับ changed/added/removed
//   4 tree ไฮไลต์ + คลิกแถวกระโดด · 5 filter chip · 6 swap · 7 reload จำครบ · 8 rename/close · 9 ไม่ overflow / ไม่มี page error
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const A = { user: { name: 'สมชาย', age: 30, tags: ['a', 'b'] }, items: [{ id: 1 }, { id: 2 }], old: true };
const B = { user: { name: 'สมหญิง', age: 30, tags: ['a', 'b', 'c'] }, items: [{ id: 1 }, { id: 3 }], extra: null };

let failed = 0;
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const typeInto = (page, sel, text) => page.evaluate((s, t) => {
  const ta = document.querySelector(s); ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true }));
}, sel, text);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('jsonViewerDocs'); localStorage.removeItem('jsonViewerText'); });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('button[data-tab="jsonviewer"]');

  // 1) jdDiff
  const d1 = await page.evaluate((a, b) => window.jdDiff(a, b).map((x) => `${x.type}:${x.path.join('/')}`), A, B);
  const want = ['changed:user/name', 'added:user/tags/2', 'changed:items/1/id', 'removed:old', 'added:extra'];
  check('1 jdDiff ครบและถูกประเภท', JSON.stringify(d1) === JSON.stringify(want), d1.join(', '));
  const d1b = await page.evaluate(() => window.jdDiff({ a: [1] }, { a: { 0: 1 } }).map((x) => x.type + ':' + x.path.join('/')));
  check('1 array↔object = changed', d1b.join() === 'changed:a', d1b.join());

  // 2) sub-tab
  await typeInto(page, '#jv-editor-host textarea', '{"doc":1}'); await sleep(450);
  await page.click('#jv-add-view'); await sleep(100);
  const r2 = await page.evaluate(() => ({ tabs: document.querySelectorAll('.jv-doctab').length, text: document.querySelector('#jv-editor-host textarea').value, active: document.querySelector('.jv-doctab.active .jv-doctab-name').textContent }));
  check('2 เพิ่มแท็บ JSON ใหม่ = ว่าง', r2.tabs === 2 && r2.text === '' && r2.active === 'JSON 2', JSON.stringify(r2));
  await typeInto(page, '#jv-editor-host textarea', '{"doc":2}'); await sleep(100); // สลับก่อน debounce — ต้องไม่หาย
  await page.click('.jv-doctab:nth-child(1)'); await sleep(100);
  const t1 = await page.$eval('#jv-editor-host textarea', (t) => t.value);
  await page.click('.jv-doctab:nth-child(2)'); await sleep(450);
  const t2 = await page.$eval('#jv-editor-host textarea', (t) => t.value);
  const lines2 = await page.$$eval('#jv-tree .jt-line', (l) => l.length);
  check('2 สลับแท็บ ข้อความแยกกัน (ไม่หายแม้สลับก่อน debounce)', t1 === '{"doc":1}' && t2 === '{"doc":2}' && lines2 === 3, `${t1} | ${t2} | lines=${lines2}`);

  // 3) compare
  await page.click('#jv-add-compare'); await sleep(100);
  const vis = await page.evaluate(() => ({ view: getComputedStyle(document.getElementById('jv-view-mode')).display, cmp: getComputedStyle(document.getElementById('jv-compare-mode')).display }));
  check('3 แท็บ compare โชว์ layout compare', vis.view === 'none' && vis.cmp === 'flex', JSON.stringify(vis));
  await typeInto(page, '.jc-side[data-side="a"] textarea', JSON.stringify(A, null, 2));
  await typeInto(page, '.jc-side[data-side="b"] textarea', JSON.stringify(B, null, 2)); await sleep(450);
  const r3 = await page.evaluate(() => ({
    counts: [...document.querySelectorAll('.jc-chip b')].map((b) => b.textContent).join(','),
    rows: document.querySelectorAll('.jc-row').length,
    paths: [...document.querySelectorAll('.jc-path')].map((p) => p.textContent),
    stat: document.getElementById('jc-stat').textContent,
  }));
  check('3 นับ changed/added/removed = 2,2,1', r3.counts === '2,2,1' && r3.rows === 5, JSON.stringify(r3));
  check('3 path อ่านง่าย', r3.paths.includes('user.name') && r3.paths.includes('items[1].id') && r3.paths.includes('user.tags[2]'), r3.paths.join(' '));

  // 4) คลิกแถว → สลับ tree view + ไฮไลต์ + กระโดด
  await page.evaluate(() => [...document.querySelectorAll('.jc-row')].find((r) => r.textContent.includes('items[1].id')).click());
  await sleep(150);
  const r4 = await page.evaluate(() => {
    const side = (k) => document.querySelector(`.jc-side[data-side="${k}"]`);
    const cur = (k) => side(k).querySelector('.jt-hit-cur');
    return {
      treeShown: getComputedStyle(side('a').querySelector('.jc-tree')).display !== 'none',
      edHidden: getComputedStyle(side('a').querySelector('.jc-editor-host')).display === 'none',
      curA: cur('a') && cur('a').dataset.jtpath, curB: cur('b') && cur('b').dataset.jtpath,
      aRemoved: !!side('a').querySelector('.jt-node.jd-removed'), bRemoved: !!side('b').querySelector('.jt-node.jd-removed'),
      bAdded: side('b').querySelectorAll('.jt-node.jd-added').length, aChanged: side('a').querySelectorAll('.jt-node.jd-changed').length,
      anc: side('a').querySelectorAll('.jt-line.jd-anc').length,
    };
  });
  check('4 คลิกแถว → tree view + กระโดดทั้งสองฝั่ง', r4.treeShown && r4.edHidden && r4.curA === 'items[1].id' && r4.curB === 'items[1].id', JSON.stringify(r4));
  check('4 ไฮไลต์ถูกฝั่ง (removed แค่ซ้าย, added แค่ขวา)', r4.aRemoved && !r4.bRemoved && r4.bAdded === 2 && r4.aChanged === 2 && r4.anc >= 3, JSON.stringify(r4));
  await page.screenshot({ path: 'json-compare-tree.png' });
  // added path ไม่มีในฝั่งซ้าย → ซ้ายกระโดดไป parent
  await page.evaluate(() => [...document.querySelectorAll('.jc-row')].find((r) => r.querySelector('.jc-path').textContent === 'extra').click());
  await sleep(100);
  const cA = await page.$eval('.jc-side[data-side="a"] .jt-hit-cur', (l) => l.dataset.jtpath).catch(() => null);
  check('4 added → ฝั่งซ้ายกระโดดไป parent ($)', cA === '$', cA);

  // 5) filter chip
  await page.click('.jc-chip[data-type="changed"]'); await sleep(50);
  const r5 = await page.$$eval('.jc-row', (r) => r.length);
  await page.click('.jc-chip[data-type="changed"]'); await sleep(50);
  const r5b = await page.$$eval('.jc-row', (r) => r.length);
  check('5 chip ซ่อน/แสดงประเภท', r5 === 3 && r5b === 5, `${r5} → ${r5b}`);

  // 6) swap
  await page.click('#jc-swap-btn'); await sleep(100);
  const r6 = await page.$$eval('.jc-chip b', (b) => b.map((x) => x.textContent).join(','));
  check('6 swap แล้ว added↔removed สลับ', r6 === '2,1,2', r6);
  await page.click('#jc-swap-btn'); await sleep(100);

  // 7) reload
  await sleep(400);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('button[data-tab="jsonviewer"]'); await sleep(200);
  const r7 = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.jv-doctab-name')].map((n) => n.textContent),
    active: document.querySelector('.jv-doctab.active .jv-doctab-name').textContent,
    counts: [...document.querySelectorAll('.jc-chip b')].map((b) => b.textContent).join(','),
    tree: getComputedStyle(document.querySelector('.jc-side[data-side="a"] .jc-tree')).display !== 'none',
  }));
  check('7 reload จำแท็บ/แท็บที่เปิด/ข้อความ/โหมด tree', r7.tabs.join() === 'JSON 1,JSON 2,Compare 1' && r7.active === 'Compare 1' && r7.counts === '2,2,1' && r7.tree, JSON.stringify(r7));

  // 8) rename + close
  await page.evaluate(() => { const n = document.querySelector('.jv-doctab.active .jv-doctab-name'); n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  await page.evaluate(() => { const i = document.querySelector('.jv-doctab-rename'); i.value = 'API v1 vs v2'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const nm = await page.$eval('.jv-doctab.active .jv-doctab-name', (n) => n.textContent);
  await page.click('.jv-doctab:nth-child(2) .jv-doctab-close'); await sleep(100);
  const r8 = await page.$$eval('.jv-doctab-name', (n) => n.map((x) => x.textContent).join());
  check('8 rename + close', nm === 'API v1 vs v2' && r8 === 'JSON 1,API v1 vs v2', `${nm} | ${r8}`);
  // ปิดหมดแล้วต้องเหลือแท็บว่าง 1 อัน
  await page.click('.jv-doctab:nth-child(1) .jv-doctab-close'); await sleep(50);
  await page.click('.jv-doctab:nth-child(1) .jv-doctab-close'); await sleep(50);
  const r8b = await page.evaluate(() => ({ n: document.querySelectorAll('.jv-doctab').length, view: getComputedStyle(document.getElementById('jv-view-mode')).display }));
  check('8 ปิดหมด → เหลือแท็บ JSON ว่าง 1 อัน', r8b.n === 1 && r8b.view !== 'none', JSON.stringify(r8b));

  // 9) overflow + narrow
  await page.click('#jv-add-compare'); await sleep(50);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  await page.setViewport({ width: 480, height: 800 }); await sleep(200);
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check('9 ไม่ overflow แนวนอน (1440 / 480)', ov && ov2, `${ov} ${ov2}`);
  await page.setViewport({ width: 1440, height: 900 });
  check('9 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
