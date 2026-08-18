#!/usr/bin/env node
// Dev-test ตัวลากปรับความกว้าง Request | Response (แท็บ 🌐 Proxy) — รันกับ dev server แยก
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/proxy-detail-splitter-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// เช็ค: 1 ตัวลากอยู่ระหว่างสอง pane · 2 ค่าเริ่มต้น 50/50 · 3 ลากแล้วกว้างเปลี่ยนตามเมาส์
//        4 clamp ซ้าย/ขวา · 5 ค่าคงอยู่หลัง re-render (สลับ subtab) · 6 คงอยู่หลัง reload
//        7 ดับเบิลคลิก = รีเซ็ต 50/50 · 8 ไม่ overflow แนวนอน · 9 ไม่มี page error
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

const FLOW = {
  id: 'test-flow-1', method: 'GET', url: 'https://example.test/api/tasks/1148', path: '/api/tasks/1148',
  host: 'example.test', status: 200, statusText: 'OK', durationMs: 429, resSize: 15000,
  reqHeaders: { Host: 'example.test', 'X-Platform': 'android', 'User-Agent': 'okhttp/5.3.2' },
  reqBody: '', resHeaders: { 'content-type': 'application/json' },
  resBody: JSON.stringify({ lossCodeDesc: 'รถประกันเป็นฝ่ายผิด', drivers: ['a', 'b'], items: [{ id: 1 }, { id: 2 }] }),
  ts: Date.now(),
};

// ความกว้างจริงของ pane ซ้าย/ขวา + ตำแหน่งตัวลาก
const readGeom = (page) => page.evaluate(() => {
  const g = {
    req: document.querySelectorAll('.detail-split > .detail-pane')[0].getBoundingClientRect(),
    res: document.querySelectorAll('.detail-split > .detail-pane')[1].getBoundingClientRect(),
    rz: document.querySelector('.detail-hresizer').getBoundingClientRect(),
    split: document.querySelector('.detail-split').getBoundingClientRect(),
  };
  return {
    reqW: g.req.width, resW: g.res.width, splitW: g.split.width,
    rzX: g.rz.left + g.rz.width / 2, rzW: g.rz.width,
    gapL: g.rz.left - g.req.right, gapR: g.res.left - g.rz.right,
    orderOk: g.req.right <= g.rz.left + 0.5 && g.rz.right <= g.res.left + 0.5,
  };
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.evaluate(() => localStorage.removeItem('proxyDetailSplit'));
  await page.reload({ waitUntil: 'networkidle2' });

  await page.click('button[data-tab="proxy"]');
  await page.evaluate((f) => window.renderFlowDetail(f), FLOW);
  await sleep(150);

  // 1) ตัวลากอยู่ระหว่าง Request / Response
  const g0 = await readGeom(page);
  check('1 ตัวลากอยู่ระหว่างสอง pane', g0.orderOk && g0.rzW >= 8, `rzW=${g0.rzW}`);

  // 2) ค่าเริ่มต้น 50/50 (คลาดได้เท่าความกว้างตัวลาก)
  check('2 เริ่มต้นแบ่งครึ่งพอดี', Math.abs(g0.reqW - g0.resW) <= 1, `req=${g0.reqW.toFixed(1)} res=${g0.resW.toFixed(1)}`);

  // 3) ลากไปทางซ้าย 300px → Request แคบลง ~300, Response กว้างขึ้น ~300, ตัวลากตามเมาส์
  const y = await page.evaluate(() => { const r = document.querySelector('.detail-hresizer').getBoundingClientRect(); return r.top + r.height / 2; });
  const targetX = g0.rzX - 300;
  await page.mouse.move(g0.rzX, y);
  await page.mouse.down();
  await page.mouse.move(targetX, y, { steps: 12 });
  await page.mouse.up();
  await sleep(100);
  const g1 = await readGeom(page);
  check('3 ลากซ้าย → Request แคบลง ~300px', Math.abs((g0.reqW - g1.reqW) - 300) <= 3, `Δ=${(g0.reqW - g1.reqW).toFixed(1)}`);
  check('3 Response กว้างขึ้นเท่าที่หายไป', Math.abs((g1.resW - g0.resW) - 300) <= 3, `Δ=${(g1.resW - g0.resW).toFixed(1)}`);
  check('3 ตัวลากตามเมาส์', Math.abs(g1.rzX - targetX) <= 3, `rzX=${g1.rzX.toFixed(1)} target=${targetX.toFixed(1)}`);
  check('3 ไม่มีช่องว่างระหว่าง pane กับตัวลาก', Math.abs(g1.gapL) < 1 && Math.abs(g1.gapR) < 1, `L=${g1.gapL.toFixed(2)} R=${g1.gapR.toFixed(2)}`);

  // 4) clamp — ลากเลยขอบซ้าย/ขวาไปไกล ๆ ต้องเหลือขั้นต่ำ 180px ทั้งสองฝั่ง
  await page.mouse.move(g1.rzX, y); await page.mouse.down();
  await page.mouse.move(10, y, { steps: 8 }); await page.mouse.up();
  const gL = await readGeom(page);
  check('4 clamp ซ้าย (Request ≥ 180)', gL.reqW >= 178, `reqW=${gL.reqW.toFixed(1)}`);
  await page.mouse.move(gL.rzX, y); await page.mouse.down();
  await page.mouse.move(1430, y, { steps: 8 }); await page.mouse.up();
  const gR = await readGeom(page);
  check('4 clamp ขวา (Response ≥ 180)', gR.resW >= 178, `resW=${gR.resW.toFixed(1)}`);

  // 5) ตั้งค่าไว้ที่ ~70/30 แล้วสลับ subtab (detail render ใหม่) → ต้องคงความกว้าง
  await page.mouse.move(gR.rzX, y); await page.mouse.down();
  await page.mouse.move(1000, y, { steps: 10 }); await page.mouse.up();
  const gSet = await readGeom(page);
  await page.evaluate(() => [...document.querySelectorAll('.detail-pane .subtab-btn')].find((b) => b.textContent.trim() === 'Raw').click());
  await sleep(150);
  const gAfterTab = await readGeom(page);
  check('5 คงความกว้างหลังสลับ subtab', Math.abs(gAfterTab.reqW - gSet.reqW) <= 1.5, `${gSet.reqW.toFixed(1)} → ${gAfterTab.reqW.toFixed(1)}`);

  // 6) reload แล้วยังจำค่าเดิม
  const savedPct = await page.evaluate(() => localStorage.getItem('proxyDetailSplit'));
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('button[data-tab="proxy"]');
  await page.evaluate((f) => window.renderFlowDetail(f), FLOW);
  await sleep(150);
  const gReload = await readGeom(page);
  check('6 คงความกว้างหลัง reload', savedPct != null && Math.abs(gReload.reqW - gSet.reqW) <= 2, `saved=${savedPct} req=${gReload.reqW.toFixed(1)} vs ${gSet.reqW.toFixed(1)}`);

  // 7) ดับเบิลคลิก → กลับไป 50/50
  await page.evaluate(() => {
    const rz = document.querySelector('.detail-hresizer');
    rz.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await sleep(100);
  const gReset = await readGeom(page);
  check('7 ดับเบิลคลิกรีเซ็ต 50/50', Math.abs(gReset.reqW - gReset.resW) <= 1, `req=${gReset.reqW.toFixed(1)} res=${gReset.resW.toFixed(1)}`);

  // 8) ไม่ overflow แนวนอน + รวมความกว้างพอดี split
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('8 ไม่มี horizontal overflow', overflow <= 0, `overflow=${overflow}`);
  check('8 req+rz+res = split', Math.abs(gReset.reqW + gReset.rzW + gReset.resW - gReset.splitW) <= 1.5,
    `${(gReset.reqW + gReset.rzW + gReset.resW).toFixed(1)} vs ${gReset.splitW.toFixed(1)}`);

  // screenshot ที่ 70/30 ให้ดูด้วยตา
  await page.mouse.move(gReset.rzX, y); await page.mouse.down();
  await page.mouse.move(1050, y, { steps: 10 }); await page.mouse.up();
  await sleep(150);
  await page.screenshot({ path: 'proxy-detail-splitter.png' });

  check('9 ไม่มี page error', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})();
