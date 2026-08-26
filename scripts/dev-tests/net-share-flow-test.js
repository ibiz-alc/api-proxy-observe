#!/usr/bin/env node
// Dev-test: "แชร์เน็ต" ต้องแยกขาดจาก "เชื่อม proxy ที่บันทึก traffic"
//   env -u NODE_OPTIONS PORT=3101 SHARE_PORT=18899 ADB=<repo>/scripts/dev-tests/fake-adb.js \
//     FAKE_ADB_STATE=<tmp>/fake-adb.json node server.js
//   env -u NODE_OPTIONS PORT=3101 SHARE_PORT=18899 FAKE_ADB_STATE=<tmp>/fake-adb.json \
//     node scripts/dev-tests/net-share-flow-test.js
// ใช้ adb ปลอม → ไม่แตะมือถือจริงและ mitmproxy จริงที่กำลัง capture อยู่
// เช็ค: 1 เปิดแชร์ตอนไม่ได้เชื่อม → proxy ชี้พอร์ตส่งต่อ + มี reverse · 2 เชื่อม capture ทับ → ใช้ mitm
//        3 **ตัด capture แล้วเน็ตไม่ดับ** (proxy สลับกลับมาที่พอร์ตส่งต่อเอง) · 4 ปิดแชร์ → ล้างเกลี้ยง
//        5 ปิดแชร์ระหว่างเชื่อม capture อยู่ → ห้ามแตะ proxy ของ capture · 6 พร็อกซีส่งต่อใช้ได้จริง
const fs = require('fs');

const PORT = process.env.PORT || 3101;
const SHARE_PORT = Number(process.env.SHARE_PORT || 18899);
const STATE = process.env.FAKE_ADB_STATE || '/tmp/fake-adb-state.json';
const SERIAL = process.env.FAKE_ADB_SERIAL || 'FAKE123';
const BASE = `http://127.0.0.1:${PORT}`;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}
const post = async (p, body) => (await fetch(BASE + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})).json();
const devState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { settings: {}, reverse: [] }; } };
const proxyOf = () => devState().settings.http_proxy ?? '(ไม่ได้ตั้ง)';
const reverses = () => devState().reverse || [];
const statusDev = async () => {
  const d = await (await fetch(BASE + '/api/status')).json();
  return (d.devices || []).find((x) => x.serial === SERIAL) || {};
};

(async () => {
  // เริ่มจากศูนย์
  fs.writeFileSync(STATE, JSON.stringify({ settings: {}, reverse: [] }));

  // 1) เปิดแชร์เน็ตตอนยังไม่ได้เชื่อม capture → ต้องใช้ทางส่งต่อ
  let r = await post('/api/devices/share-net', { serial: SERIAL, on: true });
  let dev = await statusDev();
  check('1 เปิดแชร์ → proxy ชี้พอร์ตส่งต่อ', proxyOf() === `127.0.0.1:${SHARE_PORT}`, proxyOf());
  check('1 มี reverse ของพอร์ตส่งต่อ', reverses().includes(SHARE_PORT), JSON.stringify(reverses()));
  check('1 status: netShare=true, via=plain, ยังไม่นับว่าเชื่อม capture',
    dev.netShare === true && dev.shareVia === 'plain' && dev.connected === false,
    `netShare=${dev.netShare} via=${dev.shareVia} connected=${dev.connected} (api via=${r.via})`);

  // 2) เชื่อม capture ทับ → ต้องสลับไป mitmproxy (ได้เน็ตอยู่ในตัว) แต่สถานะแชร์เน็ตยังอยู่
  await post('/api/devices/connect', { serial: SERIAL, mode: 'usb' });
  dev = await statusDev();
  check('2 เชื่อม capture → proxy = mitmproxy 8888', proxyOf() === '127.0.0.1:8888', proxyOf());
  check('2 status: connected=true และ netShare ยังเปิดอยู่ (via=mitm)',
    dev.connected === true && dev.netShare === true && dev.shareVia === 'mitm',
    `connected=${dev.connected} netShare=${dev.netShare} via=${dev.shareVia}`);

  // 3) ★ ตัด capture → ต้องไม่ทำให้เน็ตดับ: สลับกลับมาที่พอร์ตส่งต่อเอง
  await post('/api/devices/disconnect', { serial: SERIAL });
  dev = await statusDev();
  check('3 ตัด capture แล้วเน็ตไม่ดับ — proxy กลับมาที่พอร์ตส่งต่อ', proxyOf() === `127.0.0.1:${SHARE_PORT}`, proxyOf());
  check('3 reverse ของ 8888 ถูกถอด แต่ของพอร์ตส่งต่อยังอยู่',
    !reverses().includes(8888) && reverses().includes(SHARE_PORT), JSON.stringify(reverses()));
  check('3 status: connected=false แต่ netShare ยัง true (via=plain)',
    dev.connected === false && dev.netShare === true && dev.shareVia === 'plain',
    `connected=${dev.connected} netShare=${dev.netShare} via=${dev.shareVia}`);

  // 4) ปิดแชร์ → ล้างทั้ง proxy และ reverse
  await post('/api/devices/share-net', { serial: SERIAL, on: false });
  dev = await statusDev();
  check('4 ปิดแชร์ → proxy ถูกล้าง', ['(ไม่ได้ตั้ง)', ':0', 'null'].includes(proxyOf()), proxyOf());
  check('4 ปิดแชร์ → reverse ของพอร์ตส่งต่อถูกถอด', !reverses().includes(SHARE_PORT), JSON.stringify(reverses()));
  check('4 status: netShare=false', dev.netShare === false, `netShare=${dev.netShare}`);

  // 5) อีกทิศทาง: กำลังเชื่อม capture อยู่แล้วปิดแชร์เน็ต → ห้ามไปแตะ proxy ของ capture
  await post('/api/devices/connect', { serial: SERIAL, mode: 'usb' });
  await post('/api/devices/share-net', { serial: SERIAL, on: true });
  check('5 เปิดแชร์ระหว่างเชื่อม capture → proxy ยังเป็น 8888 (ไม่ไปตัด capture)', proxyOf() === '127.0.0.1:8888', proxyOf());
  await post('/api/devices/share-net', { serial: SERIAL, on: false });
  dev = await statusDev();
  check('5 ปิดแชร์ระหว่างเชื่อม capture → capture ไม่กระทบ (proxy ยัง 8888, connected=true)',
    proxyOf() === '127.0.0.1:8888' && dev.connected === true, `${proxyOf()} connected=${dev.connected}`);
  check('5 netShare=false แล้วแต่ capture ยังทำงาน', dev.netShare === false, `netShare=${dev.netShare}`);

  // 6) พร็อกซีส่งต่อทำงานจริง (เปิดขึ้นตอนมีคนแชร์ → เปิดใหม่แล้วยิงผ่านได้)
  await post('/api/devices/share-net', { serial: SERIAL, on: true });
  let httpOk = false; let connectOk = false;
  try {
    const { execFileSync } = require('child_process');
    const code = execFileSync('curl', ['-s', '-o', '/dev/null', '-m', '12', '-w', '%{http_code}',
      '-x', `http://127.0.0.1:${SHARE_PORT}`, 'http://example.com/'], { encoding: 'utf8' });
    httpOk = code.startsWith('2') || code.startsWith('3');
    const code2 = execFileSync('curl', ['-s', '-o', '/dev/null', '-m', '12', '-w', '%{http_code}',
      '-x', `http://127.0.0.1:${SHARE_PORT}`, 'https://example.com/'], { encoding: 'utf8' });
    connectOk = code2.startsWith('2') || code2.startsWith('3');
  } catch (e) { /* ไม่มีเน็ต = ข้าม */ }
  check('6 พร็อกซีส่งต่อ: HTTP ผ่าน', httpOk, '');
  check('6 พร็อกซีส่งต่อ: HTTPS ผ่าน CONNECT (ไม่ต้องมี CA)', connectOk, '');

  // เก็บกวาด: ปิดทุกอย่างให้เหมือนตอนเริ่ม (data/net-share.json จะกลับเป็นว่าง)
  await post('/api/devices/share-net', { serial: SERIAL, on: false });
  await post('/api/devices/disconnect', { serial: SERIAL });

  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
