#!/usr/bin/env node
// Dev-test ตัวลากปรับความกว้างซ้าย/ขวาของแท็บ 📑 JSON — รันกับ dev server แยก
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/jv-splitter-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// เช็ค: 1 ตัวลากอยู่ระหว่างสอง pane · 2 เริ่มต้น 50/50 · 3 ลากแล้วกว้างเปลี่ยนตามเมาส์
//        4 clamp ซ้าย/ขวา (ทั้งสองฝั่งไม่แคบเกิน) · 5 คงค่าหลังสลับแท็บ · 6 คงค่าหลัง reload
//        7 ดับเบิลคลิก = 50/50 · 8 ไม่ overflow แนวนอน · 9 editor/tree ยังทำงานหลังลาก
//        10 ไม่มี page error
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

// geometry จริงของ pane ซ้าย/ขวา + ตัวลาก
const readGeom = (page) => page.evaluate(() => {
  const panes = document.querySelectorAll('.jv-layout > .jv-pane');
  const g = {
    l: panes[0].getBoundingClientRect(),
    r: panes[1].getBoundingClientRect(),
    rz: document.querySelector('.jv-resizer').getBoundingClientRect(),
    split: document.querySelector('.jv-layout').getBoundingClientRect(),
  };
  return {
    lW: g.l.width, rW: g.r.width, splitW: g.split.width,
    rzX: g.rz.left + g.rz.width / 2, rzW: g.rz.width,
    gapL: g.rz.left - g.l.right, gapR: g.r.left - g.rz.right,
    orderOk: g.l.right <= g.rz.left + 0.5 && g.rz.right <= g.r.left + 0.5,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
});
const rzCenterY = (page) => page.evaluate(() => {
  const r = document.querySelector('.jv-resizer').getBoundingClientRect();
  return r.top + r.height / 2;
});

async function drag(page, fromX, toX) {
  const y = await rzCenterY(page);
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 12 });
  await page.mouse.up();
  await sleep(100);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('jsonViewerSplit'); localStorage.removeItem('jsonViewerText'); });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('button[data-tab="jsonviewer"]');
  await sleep(200);

  // 1-2) ตำแหน่ง + ค่าเริ่มต้น
  const g0 = await readGeom(page);
  check('1 ตัวลากอยู่ระหว่างสอง pane', g0.orderOk && g0.rzW >= 8, `rzW=${g0.rzW}`);
  check('1 ไม่มีช่องว่างระหว่าง pane กับตัวลาก', Math.abs(g0.gapL) < 1 && Math.abs(g0.gapR) < 1, `L=${g0.gapL.toFixed(2)} R=${g0.gapR.toFixed(2)}`);
  check('2 เริ่มต้นแบ่งครึ่งพอดี', Math.abs(g0.lW - g0.rW) <= 1, `ซ้าย=${g0.lW.toFixed(1)} ขวา=${g0.rW.toFixed(1)}`);

  // 3) ลากไปทางซ้าย 250px
  const target = g0.rzX - 250;
  await drag(page, g0.rzX, target);
  const g1 = await readGeom(page);
  check('3 ลากซ้าย → pane ซ้ายแคบลง ~250px', Math.abs((g0.lW - g1.lW) - 250) <= 3, `Δ=${(g0.lW - g1.lW).toFixed(1)}`);
  check('3 pane ขวากว้างขึ้นเท่าที่หายไป', Math.abs((g1.rW - g0.rW) - 250) <= 3, `Δ=${(g1.rW - g0.rW).toFixed(1)}`);
  check('3 ตัวลากตามเมาส์', Math.abs(g1.rzX - target) <= 3, `rzX=${g1.rzX.toFixed(1)} target=${target.toFixed(1)}`);

  // 4) clamp — ลากสุดซ้าย/สุดขวาแล้วอีกฝั่งต้องไม่แคบกว่า min (180 หรือ 1/3 ของความกว้าง)
  const min = Math.min(180, g0.splitW / 3);
  await drag(page, g1.rzX, 0);
  const gL = await readGeom(page);
  check('4 clamp ซ้าย: ทั้งสองฝั่งไม่แคบกว่า min', gL.lW >= min - 1 && gL.rW >= min - 1, `ซ้าย=${gL.lW.toFixed(1)} ขวา=${gL.rW.toFixed(1)} min=${min}`);
  await drag(page, gL.rzX, 5000);
  const gR = await readGeom(page);
  check('4 clamp ขวา: ทั้งสองฝั่งไม่แคบกว่า min', gR.lW >= min - 1 && gR.rW >= min - 1, `ซ้าย=${gR.lW.toFixed(1)} ขวา=${gR.rW.toFixed(1)} min=${min}`);

  // ตั้งค่าที่ไม่ใช่ 50/50 ไว้ทดสอบความคงอยู่
  await drag(page, gR.rzX, g0.rzX - 200);
  const gSet = await readGeom(page);

  // 5) สลับไปแท็บอื่นแล้วกลับมา
  await page.click('button[data-tab="proxy"]');
  await sleep(150);
  await page.click('button[data-tab="jsonviewer"]');
  await sleep(200);
  const gTab = await readGeom(page);
  check('5 ค่าคงอยู่หลังสลับแท็บ', Math.abs(gTab.lW - gSet.lW) <= 1, `${gSet.lW.toFixed(1)} → ${gTab.lW.toFixed(1)}`);

  // 6) reload
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('button[data-tab="jsonviewer"]');
  await sleep(250);
  const gRe = await readGeom(page);
  check('6 ค่าคงอยู่หลัง reload', Math.abs(gRe.lW - gSet.lW) <= 2, `${gSet.lW.toFixed(1)} → ${gRe.lW.toFixed(1)}`);

  // 7) ดับเบิลคลิก = รีเซ็ต 50/50
  const y = await rzCenterY(page);
  await page.mouse.click(gRe.rzX, y, { clickCount: 2 });
  await sleep(150);
  const gDbl = await readGeom(page);
  check('7 ดับเบิลคลิกรีเซ็ต 50/50', Math.abs(gDbl.lW - gDbl.rW) <= 1, `ซ้าย=${gDbl.lW.toFixed(1)} ขวา=${gDbl.rW.toFixed(1)}`);

  // 8) ไม่ overflow + ผลรวมเท่ากับ split
  check('8 ไม่มี horizontal overflow', gDbl.docOverflow <= 0, `overflow=${gDbl.docOverflow}`);
  check('8 ซ้าย+ตัวลาก+ขวา = ความกว้าง split', Math.abs((gDbl.lW + gDbl.rzW + gDbl.rW) - gDbl.splitW) <= 1,
    `${(gDbl.lW + gDbl.rzW + gDbl.rW).toFixed(1)} vs ${gDbl.splitW.toFixed(1)}`);

  // 9) ลากแล้ว editor/tree ยังทำงาน (พิมพ์ JSON → tree ขึ้น + ปุ่ม Format ใช้ได้)
  await drag(page, gDbl.rzX, gDbl.rzX - 180);
  await page.click('.jv-editor-host textarea');
  await page.keyboard.type('{"a":[1,2],"b":{"c":"ทดสอบ"}}');
  await sleep(600);
  const tree = await page.evaluate(() => ({
    text: document.getElementById('jv-tree').innerText,
    err: document.getElementById('jv-error').style.display,
    fmtDisabled: document.getElementById('jv-format-btn').disabled,
  }));
  check('9 พิมพ์ JSON หลังลาก → tree ขึ้นถูกต้อง',
    tree.text.includes('"a"') && tree.text.includes('ทดสอบ') && tree.err === 'none' && !tree.fmtDisabled,
    tree.text.replace(/\n/g, ' ').slice(0, 80));

  // 10) ไม่มี JS error
  check('10 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await page.screenshot({ path: 'jv-splitter.png' });
  console.log('screenshot: jv-splitter.png');
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
