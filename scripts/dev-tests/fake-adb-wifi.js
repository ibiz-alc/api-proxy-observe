#!/usr/bin/env node
// adb ปลอมสำหรับเทสต์ "ADB ผ่าน Wi-Fi" — มือถือ 1 เครื่องที่ต่อได้ทั้งสาย USB และ Wi-Fi
//   ADB=<ไฟล์นี้> FAKE_ADB_STATE=/tmp/x.json node server.js
// state (แก้จากเทสต์ได้ตรงๆ): { usb, wlan, tcpip, wifi, pairCode, mdnsPort, settings:{}, reverse:{serial:[port]} }
//   usb=false = ถอดสาย · wlan='10.0.0.5/24' = คนละวงกับ Mac · tcpip=false = มือถือ reboot แล้ว
const fs = require('fs');
const STATE = process.env.FAKE_ADB_STATE || '/tmp/fake-adb-wifi.json';
const HW = 'FAKEHW1';
const def = { usb: true, wlan: '192.168.1.110/24', tcpip: false, wifi: null, pairCode: '123456', mdnsPort: null, settings: {}, reverse: {}, log: [] };
// หลาย process (watcher 2 ตัว + เทสต์) ยิงพร้อมกัน → read-modify-write ไฟล์เดียวต้องล็อก ไม่งั้น update หาย
const LOCK = STATE + '.lock';
const nap = new Int32Array(new SharedArrayBuffer(4));
for (let i = 0; ; i++) {
  try { fs.mkdirSync(LOCK); break; } catch { if (i > 400) { try { fs.rmdirSync(LOCK); } catch { /* stale */ } } Atomics.wait(nap, 0, 0, 5); }
}
process.on('exit', () => { try { fs.rmdirSync(LOCK); } catch { /* ignore */ } });
const read = () => { try { return { ...def, ...JSON.parse(fs.readFileSync(STATE, 'utf8')) }; } catch { return { ...def }; } };
const st = read();
const write = () => fs.writeFileSync(STATE, JSON.stringify(st, null, 2));
const out = (t) => process.stdout.write(t.endsWith('\n') ? t : t + '\n');
const ip = () => st.wlan.split('/')[0];

let argv = process.argv.slice(2);
let serial = null;
if (argv[0] === '-s') { serial = argv[1]; argv = argv.slice(2); }
const [cmd, ...rest] = argv;
if (cmd === 'tcpip') st.log.push([serial, cmd, ...rest].filter(Boolean).join(' ')); // เทสต์เช็คว่า tcpip ถูกสั่งไหม
const live = () => [st.usb && HW, st.wifi].filter(Boolean);
if (serial && !live().includes(serial)) { process.stderr.write(`adb: device '${serial}' not found\n`); process.exit(1); }

if (cmd === 'devices') {
  out(['List of devices attached', ...live().map((s) => `${s}\tdevice product:fake model:Fake_Phone device:fake transport_id:1`)].join('\n'));
} else if (cmd === 'tcpip') {
  st.tcpip = true; st.reverse[HW] = []; write(); out(`restarting in TCP mode port: ${rest[0]}`); // adbd restart → reverse หาย
} else if (cmd === 'wait-for-device') {
  // ok
} else if (cmd === 'connect') {
  const host = rest[0];
  const okHost = host === `${ip()}:5555` && st.tcpip || (st.mdnsPort && host === `${ip()}:${st.mdnsPort}`);
  if (okHost) { const already = st.wifi === host; st.wifi = host; write(); out(`${already ? 'already connected' : 'connected'} to ${host}`); }
  else out(`failed to connect to ${host}: Connection refused`);
} else if (cmd === 'disconnect') {
  if (st.wifi === rest[0]) { st.wifi = null; write(); }
  out(`disconnected ${rest[0]}`);
} else if (cmd === 'pair') {
  if (rest[1] === st.pairCode) { st.mdnsPort = 38211; write(); out(`Successfully paired to ${rest[0]} [guid=adb-${HW}-x]`); }
  else out('Failed: Wrong password or connection was dropped.');
} else if (cmd === 'mdns') {
  out(['List of discovered mdns services', ...(st.mdnsPort ? [`adb-${HW}-x\t_adb-tls-connect._tcp\t${ip()}:${st.mdnsPort}`] : [])].join('\n'));
} else if (cmd === 'reverse') {
  const list = st.reverse[serial] || (st.reverse[serial] = []);
  if (rest[0] === '--list') out(list.map((p) => `${serial} tcp:${p} tcp:${p}`).join('\n'));
  else if (rest[0] === '--remove') { st.reverse[serial] = list.filter((p) => `tcp:${p}` !== rest[1]); write(); }
  else { const p = +String(rest[0]).replace('tcp:', ''); if (!list.includes(p)) list.push(p); write(); out(String(p)); }
} else if (cmd === 'shell') {
  const line = rest.join(' ');
  const m = /^settings (get|put|delete) global (\S+)\s*(.*)$/.exec(line);
  if (m) {
    if (m[1] === 'get') out(st.settings[m[2]] === undefined ? 'null' : String(st.settings[m[2]]));
    else if (m[1] === 'put') { st.settings[m[2]] = m[3].trim(); write(); }
    else { delete st.settings[m[2]]; write(); }
  } else if (line === 'getprop ro.serialno') out(HW);
  else if (line === 'getprop ro.product.model') out('Fake Phone');
  else if (line.startsWith('ip -4 -o addr show')) out(`1: lo    inet 127.0.0.1/8 scope host lo\n47: wlan0    inet ${st.wlan} brd 0.0.0.0 scope global wlan0`);
  else if (line.startsWith('ip route get')) out('8.8.8.8 via 192.168.1.1 dev wlan0 src ' + ip());
  else if (line.startsWith('dumpsys')) out('(nothing)');
}
process.exit(0);
