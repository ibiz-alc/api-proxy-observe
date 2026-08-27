#!/usr/bin/env node
// Dev-test: หน้า Map Local — group (render, toggle ทั้งกลุ่ม additive, rename, drag-drop, กลุ่มว่างรอด reload, ลบ=ungroup)
//   env -u NODE_OPTIONS PORT=3100 MAP_LOCAL_FILE=/tmp/ml-test.json MAP_GROUPS_FILE=/tmp/mg-test.json node server.js
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/maplocal-groups-test.js
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
const groups = async () => (await (await fetch(BASE + '/api/maplocal/groups')).json()).groups;
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const put = (p, b) => fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const ruleByName = async (n) => (await rules()).find((r) => r.name === n) || {};
const openMaplocal = async (page) => { await page.reload({ waitUntil: 'networkidle2' }); await page.click('button[data-tab="maplocal"]'); await sleep(300); };
// ค่าใน dropdown "กลุ่ม" ของ editor (select ที่มี option "(ไม่มีกลุ่ม)")
const groupSelVal = (page) => page.evaluate(() => {
  const gs = [...document.querySelectorAll('#maplocal-editor select')].find((s) => [...s.options].some((o) => o.textContent === '(ไม่มีกลุ่ม)'));
  return gs ? gs.value : null;
});

(async () => {
  // ล้างของค้าง
  for (const r of await rules()) await fetch(BASE + '/api/maplocal/' + r.id, { method: 'DELETE' });
  for (const g of await groups()) await fetch(BASE + '/api/maplocal/groups/' + encodeURIComponent(g.name), { method: 'DELETE' });
  // สร้าง 3 rule (A,B,C) + กลุ่ม G1 (มี A)
  await post('/api/maplocal', { name: 'A', method: 'GET', urlPattern: '/a', body: '{}' });
  await post('/api/maplocal', { name: 'B', method: 'GET', urlPattern: '/b', body: '{}' });
  await post('/api/maplocal', { name: 'C', method: 'GET', urlPattern: '/c', body: '{}' });
  await post('/api/maplocal/groups', { name: 'G1' });
  await put('/api/maplocal/' + (await ruleByName('A')).id, { scenario: 'G1' });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  let promptValue = '';
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? promptValue : undefined));
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 20000 });
  await openMaplocal(page);

  // 1) render: group header G1 + count 1/1 + ungrouped มี B,C
  const groupHeads = await page.$$eval('.map-group:not(.map-group-ungrouped) .map-group-name', (a) => a.map((n) => n.textContent));
  check('1 group header G1 โผล่', groupHeads.includes('G1'), JSON.stringify(groupHeads));
  const g1count = await page.$$eval('.map-group:not(.map-group-ungrouped) .map-group-count', (a) => a[0] && a[0].textContent);
  check('1 G1 count = 1/1', g1count === '1/1', g1count);
  const ungCount = await page.$eval('.map-group-ungrouped .map-item', () => true).catch(() => false);
  const ungItems = await page.$$eval('.map-group-ungrouped .map-item', (a) => a.length);
  check('1 ไม่ได้จัดกลุ่ม มี 2 (B,C)', ungItems === 2, `ung=${ungItems} hasItem=${ungCount}`);

  // 2) toggle ทั้งกลุ่ม (ปิดกลุ่ม) → A ปิด, B/C ไม่กระทบ (additive)
  await page.click('.map-group:not(.map-group-ungrouped) .map-group-toggle');
  await sleep(400);
  check('2 ปิดกลุ่ม G1 → A disabled', (await ruleByName('A')).enabled === false, '');
  check('2 additive: B,C ยัง enabled', (await ruleByName('B')).enabled !== false && (await ruleByName('C')).enabled !== false, '');
  // เปิดกลับ
  await page.click('.map-group:not(.map-group-ungrouped) .map-group-toggle');
  await sleep(400);
  check('2 เปิดกลุ่มกลับ → A enabled', (await ruleByName('A')).enabled !== false, '');

  // 3) rename G1 → Auth (ปุ่ม ✏️ → พิมพ์ → Enter)
  await page.click('.map-group:not(.map-group-ungrouped) .map-group-rename');
  await page.waitForSelector('.map-group-rename-input', { timeout: 3000 });
  await page.evaluate(() => { document.querySelector('.map-group-rename-input').value = ''; });
  await page.type('.map-group-rename-input', 'Auth');
  await page.keyboard.press('Enter');
  await sleep(400);
  const gnames = (await groups()).map((g) => g.name);
  check('3 rename G1→Auth (ชื่อกลุ่มเปลี่ยน)', gnames.includes('Auth') && !gnames.includes('G1'), JSON.stringify(gnames));
  check('3 rule A ย้าย scenario เป็น Auth', (await ruleByName('A')).scenario === 'Auth', (await ruleByName('A')).scenario);

  // 4) drag-drop: ลากอันแรกจาก ungrouped เข้า Auth → Auth total 1→2, ungrouped 2→1
  await page.evaluate(() => {
    const src = document.querySelector('.map-group-ungrouped .map-item');
    const target = document.querySelector('.map-group:not(.map-group-ungrouped) .map-group-head');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await sleep(500);
  const authG = (await groups()).find((g) => g.name === 'Auth') || {};
  check('4 drag-drop → Auth total=2', authG.total === 2, JSON.stringify(authG));
  const ungAfter = (await rules()).filter((r) => !r.scenario).length;
  check('4 ไม่ได้จัดกลุ่ม เหลือ 1', ungAfter === 1, `ung=${ungAfter}`);

  // 4b) multi-select (Shift+click) + ลากทั้งชุดเข้ากลุ่มทีเดียว
  await post('/api/maplocal', { name: 'M1', method: 'GET', urlPattern: '/m1', body: '{}' });
  await post('/api/maplocal', { name: 'M2', method: 'GET', urlPattern: '/m2', body: '{}' });
  await openMaplocal(page); // reload ให้ render ใหม่ (ตอนนี้ ungrouped มี 3)
  const ungBefore = (await rules()).filter((r) => !r.scenario).length;
  await page.evaluate(() => { document.querySelector('.map-group-ungrouped .map-item').dispatchEvent(new MouseEvent('click', { bubbles: true })); }); // plain = anchor
  await sleep(100);
  await page.evaluate(() => { const its = document.querySelectorAll('.map-group-ungrouped .map-item'); its[its.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); }); // Shift = ช่วง
  await sleep(120);
  const hl = await page.$$eval('.map-group-ungrouped .map-item.multi-selected', (a) => a.length);
  check('4b Shift+click ไฮไลต์ทั้งช่วง ungrouped', hl === ungBefore && ungBefore >= 3, `hl=${hl}/${ungBefore}`);
  await page.evaluate(() => {
    const src = document.querySelector('.map-group-ungrouped .map-item.multi-selected');
    const target = document.querySelector('.map-group:not(.map-group-ungrouped) .map-group-head');
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  });
  await sleep(600);
  check('4b ลากหลายอันทีเดียว → ไม่ได้จัดกลุ่มว่างหมด', (await rules()).filter((r) => !r.scenario).length === 0, `ung=${(await rules()).filter((r) => !r.scenario).length}`);

  // 5) กลุ่มว่างอยู่รอด reload: สร้างกลุ่มเปล่าผ่านปุ่ม + (prompt) แล้ว reload
  promptValue = 'EmptyG';
  await page.click('#maplocal-add-group');
  await sleep(400);
  check('5 สร้างกลุ่มเปล่า EmptyG (ผ่านปุ่ม + prompt)', (await groups()).some((g) => g.name === 'EmptyG' && g.total === 0), JSON.stringify((await groups()).map((g) => `${g.name}:${g.total}`)));
  await openMaplocal(page); // reload
  const headsAfterReload = await page.$$eval('.map-group:not(.map-group-ungrouped) .map-group-name', (a) => a.map((n) => n.textContent));
  check('5 กลุ่มว่าง EmptyG ยังอยู่หลัง reload', headsAfterReload.includes('EmptyG'), JSON.stringify(headsAfterReload));

  // 6) ลบกลุ่ม Auth (confirm) = ungroup ไม่ลบ rule + editor sync (dropdown กลุ่มไม่ค้างค่าเก่า)
  check('6a editor เปิด rule ในกลุ่ม Auth อยู่ (dropdown=Auth)', (await groupSelVal(page)) === 'Auth', String(await groupSelVal(page)));
  const beforeRules = (await rules()).length;
  const delBtnIdx = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.map-group:not(.map-group-ungrouped)')];
    const idx = groups.findIndex((g) => (g.querySelector('.map-group-name') || {}).textContent === 'Auth');
    if (idx >= 0) groups[idx].querySelector('.map-group-del').click();
    return idx;
  });
  await sleep(500);
  check('6 ลบกลุ่ม Auth (เจอปุ่มลบ)', delBtnIdx >= 0, `idx=${delBtnIdx}`);
  check('6 ไม่มีกลุ่ม Auth แล้ว', !(await groups()).some((g) => g.name === 'Auth'), JSON.stringify((await groups()).map((g) => g.name)));
  check('6 rule ไม่ถูกลบ (จำนวนเท่าเดิม) + กลับเป็น ungrouped', (await rules()).length === beforeRules && (await rules()).filter((r) => r.scenario === 'Auth').length === 0, `rules=${(await rules()).length}/${beforeRules}`);
  check('6b editor sync: dropdown กลุ่มไม่ค้าง "Auth" (กลับเป็น ไม่มีกลุ่ม)', (await groupSelVal(page)) === '', `val="${await groupSelVal(page)}"`);

  check('7 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'maplocal-groups.png' });
  console.log('screenshot: maplocal-groups.png');
  await browser.close();
  // เก็บกวาด
  for (const r of await rules()) await fetch(BASE + '/api/maplocal/' + r.id, { method: 'DELETE' });
  for (const g of await groups()) await fetch(BASE + '/api/maplocal/groups/' + encodeURIComponent(g.name), { method: 'DELETE' });
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
