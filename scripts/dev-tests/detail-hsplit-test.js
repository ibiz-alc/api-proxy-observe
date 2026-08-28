#!/usr/bin/env node
// Dev-test ตัวลากปรับความกว้าง ซ้าย(URL/Headers) | ขวา(Response) — แท็บ 📥 Inspector + 📤 Sender
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/detail-hsplit-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// เช็คต่อ split: 1 ตัวลากอยู่ระหว่างซ้าย/ขวา · 2 default 50/50 · 3 ลากซ้าย → ซ้ายแคบลง N + ขว ากว้างขึ้น N + ตัวลากตามเมาส์
//   4 clamp ซ้าย/ขวา (≥180) · 5 คงค่าหลัง re-render/reload · 6 คงค่าหลัง reload · 7 ดับเบิลคลิกรีเซ็ต · 8 ไม่ overflow
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

const REQ = {
  id: 'req-1', method: 'GET', path: 'https://api.sampleapis.com/wines/reds',
  time: '2026-08-28T10:45:27', ip: 'sender (ยิงจากในเครื่อง)', query: {},
  headers: { Authorization: 'Bearer eyJ.' + 'x'.repeat(200), 'X-Platform': 'android', 'User-Agent': 'okhttp/5.3.2', Host: 'claim-app-api.alpha.thaivivat.co.th' },
  body: '', contentType: '', files: [],
  senderResponse: { status: 403, body: '<html>\n<head><title>403 Forbidden</title></head>\n<body>\n<center><h1>403 Forbidden</h1></center>\n<hr><center>cloudflare</center>\n</body>\n</html>' },
};
const SEND = {
  ok: true, status: 200, statusText: 'OK', durationMs: 123,
  headers: { 'content-type': 'application/json', server: 'cloudflare' },
  body: JSON.stringify({ wines: [{ id: 1, name: 'reds' }], ok: true }),
};

const readGeom = (page, sels) => page.evaluate((s) => {
  const split = document.querySelector(s.split);
  const left = document.querySelector(s.left);
  const rz = document.querySelector(s.rz);
  const right = document.querySelector(s.right);
  if (!split || !left || !rz || !right) return null;
  const sp = split.getBoundingClientRect(), l = left.getBoundingClientRect(), r = rz.getBoundingClientRect(), rr = right.getBoundingClientRect();
  return {
    splitW: sp.width, leftW: l.width, rightW: rr.width, rzW: r.width,
    rzX: r.left + r.width / 2, rzY: r.top + r.height / 2,
    gapL: r.left - l.right, gapR: rr.left - r.right,
    orderOk: l.right <= r.left + 0.5 && r.right <= rr.left + 0.5,
  };
}, sels);

async function runSplit(page, label, sels, storageKey, activate, render) {
  console.log(`\n===== ${label} =====`);
  await activate();
  await render();
  await sleep(150);

  const g0 = await readGeom(page, sels);
  if (!g0) { check(`${label} · สร้าง split ได้`, false, 'ไม่พบ split/left/rz/right'); return; }
  check(`${label} 1 ตัวลากอยู่ระหว่างซ้าย/ขวา`, g0.orderOk && g0.rzW >= 8, `rzW=${g0.rzW}`);
  check(`${label} 2 เริ่มต้นแบ่งครึ่งพอดี`, Math.abs(g0.leftW - g0.rightW) <= 1.5, `L=${g0.leftW.toFixed(1)} R=${g0.rightW.toFixed(1)}`);

  // 3) ลากซ้าย 300px
  const y = g0.rzY, target = g0.rzX - 300;
  await page.mouse.move(g0.rzX, y); await page.mouse.down();
  await page.mouse.move(target, y, { steps: 12 }); await page.mouse.up();
  await sleep(100);
  const g1 = await readGeom(page, sels);
  check(`${label} 3 ลากซ้าย → ซ้ายแคบลง ~300`, Math.abs((g0.leftW - g1.leftW) - 300) <= 3, `Δ=${(g0.leftW - g1.leftW).toFixed(1)}`);
  check(`${label} 3 ขวากว้างขึ้นเท่าที่หาย`, Math.abs((g1.rightW - g0.rightW) - 300) <= 3, `Δ=${(g1.rightW - g0.rightW).toFixed(1)}`);
  check(`${label} 3 ตัวลากตามเมาส์`, Math.abs(g1.rzX - target) <= 3, `rzX=${g1.rzX.toFixed(1)} target=${target.toFixed(1)}`);
  check(`${label} 3 ไม่มีช่องว่างระหว่าง pane กับตัวลาก`, Math.abs(g1.gapL) < 1 && Math.abs(g1.gapR) < 1, `L=${g1.gapL.toFixed(2)} R=${g1.gapR.toFixed(2)}`);

  // 4) clamp ซ้าย/ขวา (≥180)
  await page.mouse.move(g1.rzX, y); await page.mouse.down();
  await page.mouse.move(g0.rzX - g0.splitW, y, { steps: 8 }); await page.mouse.up();
  const gL = await readGeom(page, sels);
  check(`${label} 4 clamp ซ้าย (≥178)`, gL.leftW >= 178, `leftW=${gL.leftW.toFixed(1)}`);
  await page.mouse.move(gL.rzX, y); await page.mouse.down();
  await page.mouse.move(g0.rzX + g0.splitW, y, { steps: 8 }); await page.mouse.up();
  const gR = await readGeom(page, sels);
  check(`${label} 4 clamp ขวา (≥178)`, gR.rightW >= 178, `rightW=${gR.rightW.toFixed(1)}`);

  // 5) ตั้ง ~70/30 แล้ว re-render → คงความกว้าง
  await page.mouse.move(gR.rzX, y); await page.mouse.down();
  await page.mouse.move(g0.rzX + 250, y, { steps: 10 }); await page.mouse.up();
  const gSet = await readGeom(page, sels);
  await render();
  await sleep(150);
  const gRe = await readGeom(page, sels);
  check(`${label} 5 คงความกว้างหลัง re-render`, Math.abs(gRe.leftW - gSet.leftW) <= 2, `${gSet.leftW.toFixed(1)} → ${gRe.leftW.toFixed(1)}`);

  // 6) reload → จำค่า
  const saved = await page.evaluate((k) => localStorage.getItem(k), storageKey);
  await page.reload({ waitUntil: 'networkidle2' });
  await activate();
  await render();
  await sleep(150);
  const gReload = await readGeom(page, sels);
  check(`${label} 6 คงความกว้างหลัง reload`, saved != null && Math.abs(gReload.leftW - gSet.leftW) <= 2.5, `saved=${saved} L=${gReload.leftW.toFixed(1)} vs ${gSet.leftW.toFixed(1)}`);

  // 7) ดับเบิลคลิก → 50/50
  await page.evaluate((s) => document.querySelector(s.rz).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), sels);
  await sleep(100);
  const gReset = await readGeom(page, sels);
  check(`${label} 7 ดับเบิลคลิกรีเซ็ต 50/50`, Math.abs(gReset.leftW - gReset.rightW) <= 1.5, `L=${gReset.leftW.toFixed(1)} R=${gReset.rightW.toFixed(1)}`);

  // 8) left+rz+right = split
  check(`${label} 8 left+rz+right = split`, Math.abs(gReset.leftW + gReset.rzW + gReset.rightW - gReset.splitW) <= 1.5,
    `${(gReset.leftW + gReset.rzW + gReset.rightW).toFixed(1)} vs ${gReset.splitW.toFixed(1)}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('inspectorDetailSplit'); localStorage.removeItem('senderLayoutSplit'); });
  await page.reload({ waitUntil: 'networkidle2' });

  // ---- Inspector: #request-detail .detail-split (ซ้าย .hsplit-col | rz | ขวา .hsplit-col) ----
  await runSplit(page, 'Inspector', {
    split: '#request-detail .detail-split',
    left: '#request-detail .detail-split > .hsplit-col:first-child',
    rz: '#request-detail .detail-hresizer',
    right: '#request-detail .detail-split > .hsplit-col:last-child',
  }, 'inspectorDetailSplit',
    () => page.click('button[data-tab="inspector"]'),
    () => page.evaluate((r) => window.renderDetail(r), REQ));
  await page.click('button[data-tab="inspector"]');
  await page.evaluate((r) => window.renderDetail(r), REQ);
  await sleep(120);
  await page.screenshot({ path: 'detail-hsplit-inspector.png' });

  // ---- Sender: .sender-layout (ฟอร์ม | #sender-hresizer | #send-result) ----
  await runSplit(page, 'Sender', {
    split: '.sender-layout', left: '.sender-form', rz: '#sender-hresizer', right: '#send-result',
  }, 'senderLayoutSplit',
    () => page.click('button[data-tab="sender"]'),
    () => page.evaluate((s) => window.renderSendResult(s), SEND));
  await page.click('button[data-tab="sender"]');
  await page.evaluate((s) => window.renderSendResult(s), SEND);
  await sleep(120);
  await page.screenshot({ path: 'detail-hsplit-sender.png' });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('ไม่มี horizontal overflow', overflow <= 0, `overflow=${overflow}`);
  check('ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nALL PASS ผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
