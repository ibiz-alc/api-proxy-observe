#!/usr/bin/env node
// Dev-test: Map Local Response body — toggle ✏️แก้ไข/🌳Tree + hover ดู JSON path (เหมือน Proxy > Response)
//   env -u NODE_OPTIONS PORT=3100 MAP_LOCAL_FILE=/tmp/ml.json MAP_GROUPS_FILE=/tmp/mg.json node server.js
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/maplocal-body-tree-test.js
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));
const PORT = process.env.PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failed = 0;
function check(name, ok, detail) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rules = async () => (await (await fetch(BASE + '/api/maplocal')).json());
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const BODY = JSON.stringify({ user: { id: 42, name: 'neo', roles: ['admin', 'ops'] }, meta: { page: 1 } }, null, 2);

(async () => {
  for (const r of await rules()) await fetch(BASE + '/api/maplocal/' + r.id, { method: 'DELETE' });
  await post('/api/maplocal', { name: 'GET /users', method: 'GET', urlPattern: '/api/users', contentType: 'application/json', body: BODY });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 640 });
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="maplocal"]');
  await sleep(400);

  // 1) เริ่มต้น = โหมดแก้ไข (textarea โชว์, tree host ซ่อน)
  const initEdit = await page.evaluate(() => ({
    editActive: document.querySelector('.mb-view-btn.active').textContent.includes('แก้ไข'),
    treeHidden: getComputedStyle(document.querySelector('.mb-tree-host')).display === 'none',
    editorShown: getComputedStyle(document.querySelector('#maplocal-editor .je-wrap')).display !== 'none',
  }));
  check('1 เริ่มต้นโหมดแก้ไข (textarea โชว์, tree ซ่อน)', initEdit.editActive && initEdit.treeHidden && initEdit.editorShown, JSON.stringify(initEdit));

  // 2) คลิก 🌳 Tree → tree โผล่ + render โครง JSON
  await page.evaluate(() => [...document.querySelectorAll('.mb-view-btn')].find((x) => x.textContent.includes('Tree')).click());
  await sleep(200);
  const treeState = await page.evaluate(() => ({
    treeShown: getComputedStyle(document.querySelector('.mb-tree-host')).display !== 'none',
    editorHidden: getComputedStyle(document.querySelector('#maplocal-editor .je-wrap')).display === 'none',
    lines: document.querySelectorAll('.mb-tree-box .jt-line').length,
    hasCopy: !!document.querySelector('.mb-tree-box .jt-copy, .mb-tree-box .jt-line [class*="copy"]'),
  }));
  check('2 คลิก Tree → tree โผล่ + textarea ซ่อน + มีบรรทัด JSON', treeState.treeShown && treeState.editorHidden && treeState.lines > 3, JSON.stringify(treeState));

  // 3) hover บรรทัด → pathbar โชว์ JSON path
  const pb = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.mb-tree-box .jt-line')].find((l) => (l.dataset.jtpath || '').includes('roles'));
    if (!line) return { ok: false };
    line.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return { ok: true, bar: (document.querySelector('.mb-tree-host .jt-pathbar') || {}).textContent || '', dataPath: line.dataset.jtpath };
  });
  check('3 hover บรรทัด → pathbar โชว์ path (user.roles)', pb.ok && pb.bar === 'user.roles' && pb.dataPath === 'user.roles', JSON.stringify(pb));

  // 4) คลิก ✏️ แก้ไข กลับ → textarea โชว์อีกครั้ง (ค่าเดิมอยู่ครบ)
  await page.evaluate(() => [...document.querySelectorAll('.mb-view-btn')].find((x) => x.textContent.includes('แก้ไข')).click());
  await sleep(150);
  const backEdit = await page.evaluate(() => ({
    editorShown: getComputedStyle(document.querySelector('#maplocal-editor .je-wrap')).display !== 'none',
    treeHidden: getComputedStyle(document.querySelector('.mb-tree-host')).display === 'none',
    hasBody: (document.querySelector('#maplocal-editor .je-input, #maplocal-editor textarea') || {}).value.includes('neo'),
  }));
  check('4 กลับโหมดแก้ไข → textarea โชว์ + body เดิมอยู่ครบ', backEdit.editorShown && backEdit.treeHidden && backEdit.hasBody, JSON.stringify(backEdit));

  check('5 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'maplocal-body-tree.png' });
  await browser.close();
  for (const r of await rules()) await fetch(BASE + '/api/maplocal/' + r.id, { method: 'DELETE' });
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
