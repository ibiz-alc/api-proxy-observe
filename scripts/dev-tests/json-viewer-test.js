#!/usr/bin/env node
// Dev-test แท็บ 📑 JSON Viewer — รันกับ dev server แยก (อย่ารันกับ :3000 ที่ใช้งานจริง)
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/json-viewer-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// เช็คตาม spec docs/superpowers/specs/2026-08-17-json-viewer-design.md:
//   1 แท็บโผล่+เปิดได้ · 2 วาง JSON → tree · 3 ค้นหา+กระโดด+กางบล็อกที่พับ · 4 Format/Minify
//   5 JSON พัง → error ชี้บรรทัด + tree เก่าจาง · 6 เปิดไฟล์ · 7 localStorage รอด reload
//   8 pathbar hover · 9 layout ไม่ overflow แนวนอน
const path = require('path');
const fs = require('fs');
const os = require('os');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));

const PORT = process.env.PORT || 3100;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SAMPLE = { user: { name: 'สมชาย', age: 30, tags: ['alpha', 'beta'] }, items: [{ id: 1, price: 9.5 }, { id: 2, price: null }], active: true };

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setEditor(page, text) { // วางข้อความใน editor แล้วรอ debounce 300ms
  await page.evaluate((t) => {
    const ta = document.querySelector('#jv-editor-host textarea');
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await sleep(500);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });

  // 1) แท็บโผล่และเปิดได้
  const tabBtn = await page.$('button[data-tab="jsonviewer"]');
  check('1 ปุ่มแท็บ 📑 JSON อยู่ใน nav', !!tabBtn);
  await page.click('button[data-tab="jsonviewer"]');
  check('1 แท็บเปิด active', await page.evaluate(() => document.getElementById('tab-jsonviewer').classList.contains('active')));

  // 2) วาง JSON valid → tree render
  await setEditor(page, JSON.stringify(SAMPLE));
  const r2 = await page.evaluate(() => ({
    lines: document.querySelectorAll('#jv-tree .jt-line').length,
    err: document.getElementById('jv-error').style.display !== 'none',
    stale: document.getElementById('jv-tree').classList.contains('jv-stale'),
  }));
  check('2 tree render (21 บรรทัด)', r2.lines === 21 && !r2.err && !r2.stale, `lines=${r2.lines}`);

  // 3) ค้นหา: "price" มี 2 ตำแหน่ง — พับ items ก่อนแล้วกระโดดต้องกางให้เอง
  await page.evaluate(() => { // พับบล็อก items (head ที่มี key "items")
    const head = [...document.querySelectorAll('#jv-tree .jt-head')].find((h) => h.textContent.includes('"items"'));
    head.click();
  });
  const collapsedBefore = await page.evaluate(() => {
    const head = [...document.querySelectorAll('#jv-tree .jt-head')].find((h) => h.textContent.includes('"items"'));
    return head.parentElement.querySelector(':scope > .jt-children').style.display === 'none';
  });
  await page.type('#jv-search', 'price');
  await sleep(400);
  const r3 = await page.evaluate(() => {
    const cur = document.querySelector('#jv-tree .jt-hit-cur');
    const box = document.getElementById('jv-tree').getBoundingClientRect();
    const cr = cur ? cur.getBoundingClientRect() : null;
    return {
      hits: document.querySelectorAll('#jv-tree .jt-hit').length,
      count: document.getElementById('jv-search-count').textContent,
      curVisible: !!cr && cr.top >= box.top - 1 && cr.bottom <= box.bottom + 1,
      itemsExpanded: (() => {
        const head = [...document.querySelectorAll('#jv-tree .jt-head')].find((h) => h.textContent.includes('"items"'));
        return head.parentElement.querySelector(':scope > .jt-children').style.display !== 'none';
      })(),
    };
  });
  check('3 ค้นหา "price" เจอ 2 + ตัวนับถูก', r3.hits === 2 && r3.count === '1/2', `hits=${r3.hits} count=${r3.count}`);
  check('3 กระโดดแล้วกางบล็อกที่พับ + match อยู่ใน viewport', collapsedBefore && r3.itemsExpanded && r3.curVisible);
  const r3b = await page.evaluate(() => { document.getElementById('jv-next-btn').click(); return document.getElementById('jv-search-count').textContent; });
  check('3 ปุ่ม ▼ ไปตัวถัดไป (2/2)', r3b === '2/2', r3b);
  await page.evaluate(() => { const s = document.getElementById('jv-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(400);

  // 4) Format / Minify
  const mini = JSON.stringify(SAMPLE);
  await page.click('#jv-format-btn');
  const formatted = await page.evaluate(() => document.querySelector('#jv-editor-host textarea').value);
  check('4 Format เป็น pretty 2-space', formatted === JSON.stringify(SAMPLE, null, 2));
  await page.click('#jv-minify-btn');
  const minified = await page.evaluate(() => document.querySelector('#jv-editor-host textarea').value);
  check('4 Minify กลับเป็นบรรทัดเดียว', minified === mini);

  // 5) JSON พัง → error ชี้บรรทัด + tree เก่าจางแต่ยังอยู่
  await setEditor(page, '{\n  "a": 1,\n  "b": ,\n}');
  const r5 = await page.evaluate(() => ({
    err: document.getElementById('jv-error').textContent,
    shown: document.getElementById('jv-error').style.display !== 'none',
    stale: document.getElementById('jv-tree').classList.contains('jv-stale'),
    oldTree: document.querySelectorAll('#jv-tree .jt-line').length > 0,
    fmtDisabled: document.getElementById('jv-format-btn').disabled,
  }));
  check('5 แถบ error ขึ้น + ชี้บรรทัด 3', r5.shown && /บรรทัด 3/.test(r5.err), r5.err.slice(0, 60));
  check('5 tree เก่าคงไว้แบบจาง + Format disabled', r5.stale && r5.oldTree && r5.fmtDisabled);

  // 6) เปิดไฟล์
  const tmpFile = path.join(os.tmpdir(), 'jv-test-sample.json');
  fs.writeFileSync(tmpFile, JSON.stringify({ fromFile: true, n: 42 }));
  const fileInput = await page.$('#jv-file');
  await fileInput.uploadFile(tmpFile);
  await sleep(500);
  const r6 = await page.evaluate(() => ({
    lines: document.querySelectorAll('#jv-tree .jt-line').length,
    text: document.querySelector('#jv-editor-host textarea').value,
  }));
  check('6 เปิดไฟล์ → render', r6.lines === 4 && r6.text.includes('fromFile'), `lines=${r6.lines}`);

  // 7) localStorage รอด reload
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('button[data-tab="jsonviewer"]');
  await sleep(300);
  const r7 = await page.evaluate(() => ({
    text: document.querySelector('#jv-editor-host textarea').value,
    lines: document.querySelectorAll('#jv-tree .jt-line').length,
  }));
  check('7 reload แล้วข้อความ+tree กลับมา', r7.text.includes('fromFile') && r7.lines === 4);

  // 8) pathbar: hover บรรทัดใน tree → path โผล่
  await setEditor(page, JSON.stringify(SAMPLE));
  const r8 = await page.evaluate(() => {
    const line = [...document.querySelectorAll('#jv-tree .jt-line')].find((l) => l.textContent.includes('"name"'));
    line.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return document.querySelector('#tab-jsonviewer .jt-pathbar').textContent;
  });
  check('8 pathbar โชว์ path ตอน hover', r8 === 'user.name', r8);
  // 8b) หน้าอื่นที่ใช้ .detail-pane เดิมต้องยังหา pathbar เจอ (สคริปต์นี้เช็คแค่ selector ไม่พัง)
  const r8b = await page.evaluate(() => !!document.querySelector('.detail-pane, #tab-proxy'));
  check('8 โครง .detail-pane เดิมยังอยู่', r8b);

  // 9) layout: ไม่มี horizontal overflow ระดับหน้า
  const r9 = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    paneCount: document.querySelectorAll('#tab-jsonviewer .jv-pane').length,
  }));
  check('9 ไม่ overflow แนวนอน + สองฝั่งครบ', !r9.overflowX && r9.paneCount === 2);

  check('0 ไม่มี JS error บนหน้า', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 120));

  await page.screenshot({ path: './json-viewer-test.png' });
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})();
