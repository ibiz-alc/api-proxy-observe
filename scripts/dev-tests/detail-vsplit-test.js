#!/usr/bin/env node
// Dev-test ตัวลากปรับขนาด บน(URL/Headers) / ล่าง(Response body) — แท็บ 📥 Inspector + 📤 Sender
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/detail-vsplit-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// เช็คต่อ pane: 1 ตัวลากอยู่ระหว่างบน/ล่าง · 2 ค่าเริ่มต้น top≈260 · 3 ลากลง → top สูงขึ้นตามเมาส์ + bottom ลดเท่ากัน
//   4 clamp บน/ล่าง (≥90) · 5 คงค่าหลัง re-render · 6 คงค่าหลัง reload · 7 ดับเบิลคลิกรีเซ็ต · 8 ไม่ overflow แนวนอน
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
  time: '2026-08-28T10:45:27', ip: 'sender (ยิงจากในเครื่อง)',
  query: {},
  headers: { Authorization: 'Bearer eyJhbGciOi.' + 'x'.repeat(300), 'X-Platform': 'android', 'X-Version': '1.0.0', Host: 'claim-app-api.alpha.thaivivat.co.th', Connection: 'Keep-Alive', 'Accept-Encoding': 'gzip', 'User-Agent': 'okhttp/5.3.2' },
  body: '', contentType: '', files: [],
  senderResponse: { status: 403, body: '<html>\n<head><title>403 Forbidden</title></head>\n<body>\n<center><h1>403 Forbidden</h1></center>\n<hr><center>cloudflare</center>\n</body>\n</html>' },
};
const SEND = {
  ok: true, status: 200, statusText: 'OK', durationMs: 123,
  headers: { 'content-type': 'application/json', server: 'cloudflare', 'x-a': '1', 'x-b': '2', 'x-c': '3' },
  body: JSON.stringify({ wines: [{ id: 1, name: 'reds', winery: 'a' }, { id: 2, name: 'x' }], ok: true }, null, 0),
};

const readGeom = (page, paneSel) => page.evaluate((sel) => {
  const pane = document.querySelector(sel);
  const top = pane.querySelector('.vsplit-top');
  const rz = pane.querySelector('.vsplit-resizer');
  const bottom = pane.querySelector('.vsplit-bottom');
  if (!top || !rz || !bottom) return null;
  const p = pane.getBoundingClientRect(), t = top.getBoundingClientRect(), r = rz.getBoundingClientRect(), b = bottom.getBoundingClientRect();
  return {
    paneH: p.height, paneClientH: pane.clientHeight, topH: t.height, botH: b.height,
    rzX: r.left + r.width / 2, rzY: r.top + r.height / 2, rzH: r.height,
    gapT: r.top - t.bottom, gapB: b.top - r.bottom,
    orderOk: t.bottom <= r.top + 0.5 && r.bottom <= b.top + 0.5,
  };
}, paneSel);

async function runPane(page, label, paneSel, storageKey, activate, render) {
  console.log(`\n===== ${label} (${paneSel}) =====`);
  await activate();
  await render();
  await sleep(150);

  // 1) ตัวลากอยู่ระหว่างบน/ล่าง
  const g0 = await readGeom(page, paneSel);
  if (!g0) { check(`${label} · สร้าง vsplit ได้`, false, 'ไม่พบ .vsplit-top/resizer/bottom'); return; }
  check(`${label} 1 ตัวลากอยู่ระหว่างบน/ล่าง`, g0.orderOk && g0.rzH >= 8, `rzH=${g0.rzH}`);

  // 2) ค่าเริ่มต้น top ≈ 260 · bottom ไม่ยุบ (มีความสูงจริง)
  check(`${label} 2 top เริ่มต้น ≈260px`, Math.abs(g0.topH - 260) <= 2, `topH=${g0.topH.toFixed(1)}`);
  check(`${label} 2 bottom มีความสูงจริง`, g0.botH >= 90, `botH=${g0.botH.toFixed(1)}`);

  // 3) ลากลง 150px → top สูงขึ้น ~150, bottom ลดลง ~150, ตัวลากตามเมาส์
  const x = g0.rzX, target = g0.rzY + 150;
  await page.mouse.move(x, g0.rzY); await page.mouse.down();
  await page.mouse.move(x, target, { steps: 12 }); await page.mouse.up();
  await sleep(100);
  const g1 = await readGeom(page, paneSel);
  check(`${label} 3 ลากลง → top +~150px`, Math.abs((g1.topH - g0.topH) - 150) <= 3, `Δ=${(g1.topH - g0.topH).toFixed(1)}`);
  check(`${label} 3 bottom ลดลงเท่าที่เพิ่ม`, Math.abs((g0.botH - g1.botH) - 150) <= 3, `Δ=${(g0.botH - g1.botH).toFixed(1)}`);
  check(`${label} 3 ตัวลากตามเมาส์`, Math.abs(g1.rzY - target) <= 3, `rzY=${g1.rzY.toFixed(1)} target=${target.toFixed(1)}`);
  // ช่องว่าง = margin ของตัวลาก (2px) เท่านั้น ต้องสมมาตรและไม่มีช่องว่างใหญ่
  check(`${label} 3 ช่องว่าง = margin ตัวลาก (สมมาตร ≤2px)`, g1.gapT <= 2.5 && g1.gapB <= 2.5 && Math.abs(g1.gapT - g1.gapB) < 1, `T=${g1.gapT.toFixed(2)} B=${g1.gapB.toFixed(2)}`);

  // 4) clamp — ลากขึ้นสุด/ลงสุด ต้องเหลือขั้นต่ำ ~90 ทั้งสองฝั่ง
  await page.mouse.move(g1.rzX, g1.rzY); await page.mouse.down();
  await page.mouse.move(g1.rzX, 40, { steps: 8 }); await page.mouse.up();
  const gTop = await readGeom(page, paneSel);
  check(`${label} 4 clamp บน (top ≥ 88)`, gTop.topH >= 88, `topH=${gTop.topH.toFixed(1)}`);
  await page.mouse.move(gTop.rzX, gTop.rzY); await page.mouse.down();
  await page.mouse.move(gTop.rzX, 1400, { steps: 8 }); await page.mouse.up();
  const gBot = await readGeom(page, paneSel);
  check(`${label} 4 clamp ล่าง (bottom ≥ 88)`, gBot.botH >= 88, `botH=${gBot.botH.toFixed(1)}`);

  // 5) ตั้งค่าไว้กลาง ๆ แล้ว re-render → คงความสูง
  await page.mouse.move(gBot.rzX, gBot.rzY); await page.mouse.down();
  await page.mouse.move(gBot.rzX, gBot.rzY - 260, { steps: 10 }); await page.mouse.up();
  const gSet = await readGeom(page, paneSel);
  await render();
  await sleep(150);
  const gRe = await readGeom(page, paneSel);
  check(`${label} 5 คงความสูงหลัง re-render`, Math.abs(gRe.topH - gSet.topH) <= 1.5, `${gSet.topH.toFixed(1)} → ${gRe.topH.toFixed(1)}`);

  // 6) reload → ยังจำค่าเดิม
  const saved = await page.evaluate((k) => localStorage.getItem(k), storageKey);
  await page.reload({ waitUntil: 'networkidle2' });
  await activate();
  await render();
  await sleep(150);
  const gReload = await readGeom(page, paneSel);
  check(`${label} 6 คงความสูงหลัง reload`, saved != null && Math.abs(gReload.topH - gSet.topH) <= 2, `saved=${saved} top=${gReload.topH.toFixed(1)} vs ${gSet.topH.toFixed(1)}`);

  // 7) ดับเบิลคลิก → รีเซ็ต 260
  await page.evaluate((sel) => document.querySelector(sel + ' .vsplit-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), paneSel);
  await sleep(100);
  const gReset = await readGeom(page, paneSel);
  check(`${label} 7 ดับเบิลคลิกรีเซ็ต ≈260`, Math.abs(gReset.topH - 260) <= 2, `topH=${gReset.topH.toFixed(1)}`);

  // 8) top + ช่องว่าง + ตัวลาก + bottom = พื้นที่ในกรอบ (clientHeight, ไม่รวม border)
  const sum = gReset.topH + gReset.gapT + gReset.rzH + gReset.gapB + gReset.botH;
  check(`${label} 8 top+ตัวลาก+bottom เต็มกรอบพอดี`, Math.abs(sum - gReset.paneClientH) <= 1.5,
    `${sum.toFixed(1)} vs client ${gReset.paneClientH.toFixed(1)}`);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.evaluate(() => { localStorage.removeItem('inspectorDetailH'); localStorage.removeItem('senderResultH'); });
  await page.reload({ waitUntil: 'networkidle2' });

  // ---- Inspector ----
  await runPane(page, 'Inspector', '#request-detail', 'inspectorDetailH',
    () => page.click('button[data-tab="inspector"]'),
    () => page.evaluate((r) => window.renderDetail(r), REQ));
  await page.click('button[data-tab="inspector"]');
  await page.evaluate((r) => window.renderDetail(r), REQ);
  await sleep(120);
  await page.screenshot({ path: 'detail-vsplit-inspector.png' });

  // ---- Sender ----
  await runPane(page, 'Sender', '#send-result', 'senderResultH',
    () => page.click('button[data-tab="sender"]'),
    () => page.evaluate((s) => window.renderSendResult(s), SEND));
  await page.click('button[data-tab="sender"]');
  await page.evaluate((s) => window.renderSendResult(s), SEND);
  await sleep(120);
  await page.screenshot({ path: 'detail-vsplit-sender.png' });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('ไม่มี horizontal overflow', overflow <= 0, `overflow=${overflow}`);
  check('ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nALL PASS ผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
