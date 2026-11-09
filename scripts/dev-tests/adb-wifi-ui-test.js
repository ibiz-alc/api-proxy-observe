#!/usr/bin/env node
// เทสต์ UI แท็บ 🩺 Status ส่วน "ADB ผ่าน Wi-Fi" — ปลอม /api/status ด้วย request interception (ไม่ต้องมีมือถือ)
//   env -u NODE_OPTIONS PORT=3200 node scripts/dev-tests/adb-wifi-ui-test.js
// เช็ค: 1 สายอย่างเดียว → ปุ่ม 📡 Debug ผ่าน Wi-Fi (POST serial USB) · 2 สาย+Wi-Fi → บรรทัดบอก + ปุ่มเลิก
//   3 Wi-Fi อย่างเดียว → ปุ่ม "เชื่อมผ่าน adb", ไม่มีปุ่มแชร์เน็ต USB, ป้าย ADB Wi-Fi · 4 จำไว้แต่หลุด → การ์ด "Wi-Fi หลุด"
//   5 การ์ดจับคู่/เชื่อม: POST pair/connect ด้วยค่าที่พิมพ์ · 6 พิมพ์อยู่ → refresh 5 วิไม่ล้างช่อง · 7 ไม่มี JS error
const path = require('path');
const puppeteer = require(require.resolve('puppeteer-core', { paths: [path.join(__dirname, '..', '..'), process.cwd()] }));
const PORT = process.env.PORT || 3200;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const base = { serial: '', connected: false, proxy: null, mode: null, posternRunning: false, emulator: false, reverse: null, systemCa: null, ownNet: true, netShare: false, shareVia: null };
const STATUS = {
  ok: true,
  services: { apitester: { up: true, port: PORT }, mitmproxy: { up: true, port: 8888 }, mcp: { up: false, port: 7333, url: '' } },
  devices: [
    { ...base, serial: 'USBONLY', id: 'USBONLY', model: 'Phone USB', transport: 'usb', usbSerial: 'USBONLY', wifiSerial: null },
    { ...base, serial: 'BOTH1', id: 'BOTH1', model: 'Phone Both', transport: 'usb', usbSerial: 'BOTH1', wifiSerial: '192.168.1.110:5555', connected: true, proxy: '127.0.0.1:8888', mode: 'usb', reverse: true },
    { ...base, serial: '192.168.1.120:5555', id: 'WIFI1', model: 'Phone WiFi', transport: 'wifi', usbSerial: null, wifiSerial: '192.168.1.120:5555', connected: true, proxy: '127.0.0.1:8888', mode: 'usb', reverse: false },
  ],
  iosSims: [], iosProxy: { active: false, service: null, macCaTrusted: false },
  muted: false, mutedDropped: 0, flows: { count: 0, lastAt: null }, autoReconnect: {}, lanIp: '192.168.1.150',
  adbWifi: {
    remembered: [
      { id: 'BOTH1', host: '192.168.1.110:5555', model: 'Phone Both', connected: true, lastError: null },
      { id: 'WIFI1', host: '192.168.1.120:5555', model: 'Phone WiFi', connected: true, lastError: null },
      { id: 'GONE1', host: '192.168.1.130:5555', model: 'Phone Gone', connected: false, lastError: 'failed to connect\nmore' },
    ],
    macNets: [{ iface: 'en0', ip: '192.168.1.150', prefix: 24 }],
  },
};

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const posts = []; let statusHits = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.endsWith('/api/status')) { statusHits++; return req.respond({ contentType: 'application/json', body: JSON.stringify(STATUS) }); }
    if (u.includes('/api/devices/adb-wifi/')) {
      posts.push({ path: u.split('/adb-wifi/')[1], body: JSON.parse(req.postData() || '{}') });
      return req.respond({ contentType: 'application/json', body: JSON.stringify({ ok: true, host: '192.168.1.110:5555', ip: '192.168.1.110', iface: 'wlan0', macIp: '192.168.1.150', macIface: 'en0', connected: true }) });
    }
    req.continue();
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2' });
  await page.click('button[data-tab="status"]'); await sleep(600);
  const cards = await page.evaluate(() => [...document.querySelectorAll('#status-cards .st-card')].map((c) => ({
    title: c.querySelector('.st-title').textContent,
    lines: [...c.querySelectorAll('.st-line')].map((l) => l.textContent),
    btns: [...c.querySelectorAll('button')].map((b) => b.textContent),
  })));
  const card = (t) => cards.find((c) => c.title.includes(t)) || { lines: [], btns: [] };
  const usb = card('Phone USB'); const both = card('Phone Both'); const wifi = card('Phone WiFi');
  check('1 สายอย่างเดียว → ปุ่ม 📡 Debug ผ่าน Wi-Fi + บรรทัดชวน', usb.btns.includes('📡 Debug ผ่าน Wi-Fi') && usb.lines.some((l) => l.includes('USB อย่างเดียว')), JSON.stringify(usb));
  check('2 สาย+Wi-Fi → บรรทัดบอก + ปุ่มเลิก', both.lines.some((l) => l.includes('สาย USB + Wi-Fi (192.168.1.110:5555)')) && both.btns.includes('📡 เลิก Debug Wi-Fi') && !both.btns.includes('📡 Debug ผ่าน Wi-Fi'), JSON.stringify(both));
  check('3 Wi-Fi อย่างเดียว → ป้าย/ปุ่มถูก ไม่มีแชร์เน็ต USB', wifi.btns.includes('📡 เชื่อมผ่าน adb') && !wifi.btns.some((b) => b.includes('แชร์เน็ต')) && wifi.lines.some((l) => l.includes('ไม่ได้เสียบสาย')), JSON.stringify(wifi));
  check('3 สายอย่างเดียวยังมีปุ่มแชร์เน็ต USB', usb.btns.includes('🌍 แชร์เน็ต USB'));
  const gone = card('Phone Gone');
  check('4 จำไว้แต่หลุด → การ์ด Wi-Fi หลุด + ต่อใหม่/ลืม (เครื่องที่ต่ออยู่ไม่ซ้ำการ์ด)', gone.title.includes('Wi-Fi หลุด') && gone.btns.includes('🔄 ต่อใหม่') && gone.btns.includes('🗑 ลืมเครื่องนี้') && gone.lines.some((l) => l.includes('ล่าสุด: failed to connect')) && cards.filter((c) => c.title.includes('Phone Both')).length === 1, JSON.stringify(gone));
  const wl = card('ADB ผ่าน Wi-Fi');
  check('5 การ์ด Wireless debugging มีวงของ Mac', wl.lines.some((l) => l.includes('192.168.1.150/24 (en0)')), JSON.stringify(wl.lines));
  // 1) กดเปิด → POST enable ด้วย serial USB
  await page.evaluate(() => [...document.querySelectorAll('#status-cards button')].find((b) => b.textContent === '📡 Debug ผ่าน Wi-Fi').click());
  await sleep(300);
  check('1 กด → POST enable {serial: USBONLY}', posts.some((p) => p.path === 'enable' && p.body.serial === 'USBONLY'), JSON.stringify(posts));
  // 5) จับคู่ + เชื่อม ด้วยค่าที่พิมพ์ — รอ renderStatus หลังกดปุ่ม (stBtn re-render) ก่อนค่อยหยิบช่อง ไม่งั้นพิมพ์ลงช่องที่ถูกถอดไปแล้ว
  await sleep(1200);
  const inputs = await page.$$('.st-adbw-input');
  await inputs[0].type('192.168.1.120:41235'); await inputs[1].type('123456');
  // 6) พิมพ์ค้างอยู่ (โฟกัสในช่อง) → รอบ refresh 5 วิต้องไม่สร้างการ์ดใหม่
  const hitsBefore = statusHits;
  await inputs[2].type('192.168.1.120:3712'); await sleep(5600);
  const typed = await page.evaluate(() => document.activeElement.value);
  check('6 กำลังพิมพ์ → ไม่ refresh ทับ', statusHits === hitsBefore && typed === '192.168.1.120:3712', `hits ${hitsBefore}→${statusHits} value=${typed}`);
  await page.evaluate(() => [...document.querySelectorAll('#status-cards button')].find((b) => b.textContent === '🤝 จับคู่').click());
  await sleep(400);
  await page.evaluate(() => [...document.querySelectorAll('#status-cards button')].find((b) => b.textContent === '🔗 เชื่อม').click());
  await sleep(400);
  check('5 POST pair ด้วย host+code ที่พิมพ์', posts.some((p) => p.path === 'pair' && p.body.host === '192.168.1.120:41235' && p.body.code === '123456'), JSON.stringify(posts));
  check('5 POST connect ด้วย host ที่พิมพ์ (ค่ารอด re-render หลังจับคู่)', posts.some((p) => p.path === 'connect' && p.body.host === '192.168.1.120:3712'), JSON.stringify(posts));
  await page.evaluate(() => document.querySelector('.st-title') && [...document.querySelectorAll('.st-title')].find((t) => t.textContent.includes('ADB ผ่าน Wi-Fi')).scrollIntoView());
  await page.screenshot({ path: 'adb-wifi-status.png', fullPage: false });
  check('7 ไม่มี JS error', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
