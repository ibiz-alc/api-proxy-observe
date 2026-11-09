#!/usr/bin/env node
// เทสต์ฝั่ง server ของ "ADB ผ่าน Wi-Fi" กับ adb ปลอม (ไม่ต้องมีมือถือ)
//   S=<scratch>; echo '{}' > $S/fa.json
//   PORT=3200 PROXY_PORT=9299 SHARE_PORT=8999 ADB=<repo>/scripts/dev-tests/fake-adb-wifi.js FAKE_ADB_STATE=$S/fa.json node server.js &
//   FAKE_ADB_STATE=$S/fa.json PORT=3200 node scripts/dev-tests/adb-wifi-server-test.js
// เช็ค: 1 รวม USB+Wi-Fi เป็นเครื่องเดียว · 2 enable คืน reverse ที่ tcpip ทำหาย + ตั้งทาง Wi-Fi ด้วย
//   3 ถอดสาย → เครื่องยังอยู่ (serial หลัก = Wi-Fi) + auto-reconnect ใช้ key เดิมได้ · 4 คนละวง → error ชัด ไม่ tcpip
//   5 Wi-Fi หลุด → watcher ต่อกลับเอง · 6 pair+mdns · 7 disable ลืม + ตัด
const fs = require('fs');
const BASE = `http://localhost:${process.env.PORT || 3200}`;
const STATE = process.env.FAKE_ADB_STATE;
const withLock = (fn) => { // ล็อกเดียวกับ fake-adb-wifi.js (mkdir) — กัน update ชนกับ watcher ที่ยิง adb อยู่
  for (;;) { try { fs.mkdirSync(STATE + '.lock'); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); } }
  try { return fn(); } finally { fs.rmdirSync(STATE + '.lock'); }
};
const W = (patch) => withLock(() => { const s = JSON.parse(fs.readFileSync(STATE, 'utf8') || '{}'); fs.writeFileSync(STATE, JSON.stringify({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }, null, 2)); });
const R = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => (await fetch(BASE + p)).json();
const post = async (p, body) => { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
let failed = 0;
const check = (n, ok, d) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!ok) failed++; };

(async () => {
  withLock(() => fs.writeFileSync(STATE, JSON.stringify({ settings: {}, reverse: {}, log: [] })));
  // เชื่อม capture โหมด USB ก่อน (proxy 127.0.0.1:8888 + reverse) + เปิด auto-reconnect ด้วย key = serial USB เดิม
  await post('/api/devices/connect', { serial: 'FAKEHW1', mode: 'usb' });
  await post('/api/devices/auto-reconnect', { serial: 'FAKEHW1', on: true, mode: 'usb' });
  // 4) คนละวง → ต้องไม่สั่ง tcpip (ไม่ทำให้ USB สะดุดเปล่าๆ)
  W({ wlan: '10.0.0.5/24' });
  const e4 = await post('/api/devices/adb-wifi/enable', { serial: 'FAKEHW1' });
  check('4 คนละวง → 409 nosamenet + ไม่แตะ tcpip', e4.status === 409 && e4.code === 'nosamenet' && !R().log.some((l) => l.includes('tcpip')), e4.error && e4.error.split('\n')[0]);
  W({ wlan: '192.168.1.110/24' });
  // 2) enable
  const e2 = await post('/api/devices/adb-wifi/enable', { serial: 'FAKEHW1' });
  const st2 = R();
  check('2 enable สำเร็จ', e2.ok && e2.host === '192.168.1.110:5555' && e2.id === 'FAKEHW1', JSON.stringify(e2));
  check('2 reverse 8888 คืนให้ทาง USB (tcpip ทำหาย) + ตั้งทาง Wi-Fi ด้วย', (st2.reverse.FAKEHW1 || []).includes(8888) && (st2.reverse['192.168.1.110:5555'] || []).includes(8888), JSON.stringify(st2.reverse));
  check('2 จำไว้ใน data/adb-wifi.json', JSON.parse(fs.readFileSync(__dirname + '/../../data/adb-wifi.json', 'utf8')).FAKEHW1.host === '192.168.1.110:5555');
  // 1) รวมเป็นเครื่องเดียว
  const d1 = (await get('/api/devices')).devices;
  check('1 USB+Wi-Fi รวมเป็นการ์ดเดียว (serial หลัก = USB)', d1.length === 1 && d1[0].serial === 'FAKEHW1' && d1[0].wifiSerial === '192.168.1.110:5555' && d1[0].connected, JSON.stringify(d1));
  const s1 = await get('/api/status');
  check('1 status มี adbWifi.remembered (connected)', s1.adbWifi.remembered.length === 1 && s1.adbWifi.remembered[0].connected === true, JSON.stringify(s1.adbWifi.remembered));
  // 3) ถอดสาย
  W({ usb: false });
  const d3 = (await get('/api/devices')).devices;
  check('3 ถอดสาย → เครื่องยังอยู่ทาง Wi-Fi', d3.length === 1 && d3[0].serial === '192.168.1.110:5555' && d3[0].transport === 'wifi' && d3[0].id === 'FAKEHW1' && d3[0].usbSerial === null && d3[0].connected, JSON.stringify(d3));
  const s3 = await get('/api/status');
  check('3 capture ยังสุขภาพดี (reverse ทาง Wi-Fi อยู่)', s3.devices[0].reverse === true, JSON.stringify(s3.devices[0]));
  // reverse หายทาง Wi-Fi → auto-reconnect (key FAKEHW1) ต้องซ่อมผ่าน serial Wi-Fi
  W((s) => ({ reverse: { ...s.reverse, '192.168.1.110:5555': [] } }));
  await sleep(5500);
  check('3 auto-reconnect key เดิม ซ่อม reverse ผ่าน Wi-Fi', (R().reverse['192.168.1.110:5555'] || []).includes(8888), JSON.stringify(R().reverse));
  // 5) Wi-Fi หลุด (ไม่มีสาย) → watcher ต่อกลับ
  W((s) => ({ wifi: null, reverse: { ...s.reverse, '192.168.1.110:5555': [] } }));
  const s5a = await get('/api/status');
  check('5 หลุดแล้ว status บอก connected:false', s5a.devices.length === 0 && s5a.adbWifi.remembered[0].connected === false);
  await sleep(9500);
  const st5 = R();
  check('5 watcher ต่อ Wi-Fi กลับเอง + คืน reverse', st5.wifi === '192.168.1.110:5555' && (st5.reverse['192.168.1.110:5555'] || []).includes(8888), `wifi=${st5.wifi} rev=${JSON.stringify(st5.reverse)}`);
  // 5b) มือถือ reboot (tcpip หาย) + IP เปลี่ยน + เสียบสายกลับ → watcher เปิดใหม่ผ่านสาย ได้ IP ใหม่
  W({ wifi: null, tcpip: false, usb: true, wlan: '192.168.1.120/24' });
  await sleep(9500);
  const st5b = R();
  check('5 reboot+IP ใหม่+เสียบสาย → เปิด Wi-Fi ใหม่ IP ใหม่', st5b.wifi === '192.168.1.120:5555' && JSON.parse(fs.readFileSync(__dirname + '/../../data/adb-wifi.json', 'utf8')).FAKEHW1.host === '192.168.1.120:5555', `wifi=${st5b.wifi}`);
  // 7) disable
  const e7 = await post('/api/devices/adb-wifi/disable', { id: 'FAKEHW1' });
  check('7 disable → ตัด + ลืม', e7.ok && R().wifi === null && !JSON.parse(fs.readFileSync(__dirname + '/../../data/adb-wifi.json', 'utf8')).FAKEHW1);
  // 6) pair (ไม่มีสาย, Android 11+) → mdns หาพอร์ตเชื่อม → ต่อให้เอง
  W({ usb: false, mdnsPort: null, tcpip: false, wlan: '192.168.1.110/24' });
  const bad = await post('/api/devices/adb-wifi/pair', { host: '192.168.1.110:41235', code: '000000' });
  check('6 รหัสผิด → error', bad.status === 502 && /จับคู่ไม่สำเร็จ/.test(bad.error));
  const e6 = await post('/api/devices/adb-wifi/pair', { host: '192.168.1.110:41235', code: '123456' });
  check('6 จับคู่ → หาพอร์ตจาก mDNS → เชื่อมเอง', e6.ok && e6.connected && e6.host === '192.168.1.110:38211' && e6.id === 'FAKEHW1', JSON.stringify(e6));
  const e6c = await post('/api/devices/adb-wifi/connect', { host: '192.168.1.110' });
  check('6 connect IP ไม่มีพอร์ต → เติม 5555 (tcpip ปิด → error อ่านง่าย)', e6c.status === 502 && /5555/.test(e6c.error), e6c.error && e6c.error.split('\n')[0]);
  const e6x = await post('/api/devices/adb-wifi/connect', { host: 'abc' });
  check('6 host รูปแบบผิด → 400', e6x.status === 400);
  // disconnect ตั้งใจ → ปิด auto-reconnect ด้วย key id (ไม่ว่ากดจาก serial ไหน)
  await post('/api/devices/disconnect', { serial: '192.168.1.110:38211' });
  const s8 = await get('/api/status');
  check('8 disconnect ผ่าน serial Wi-Fi → ปิด auto-reconnect ของ id เครื่อง', !s8.autoReconnect.FAKEHW1, JSON.stringify(s8.autoReconnect));
  await post('/api/devices/adb-wifi/disable', { id: 'FAKEHW1' });
  console.log(failed ? `\n${failed} FAILED` : '\nALL PASS');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
