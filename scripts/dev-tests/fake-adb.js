#!/usr/bin/env node
// adb ปลอมสำหรับ dev-test — จำลองมือถือ 1 เครื่องที่ "ไม่มีเน็ตของตัวเอง"
// เก็บ state (http_proxy + reverse tunnel) ไว้ในไฟล์ JSON เพื่อให้ server อ่านค่าที่เพิ่งเขียนไปได้จริง
//
//   ADB=<ไฟล์นี้> FAKE_ADB_STATE=/tmp/x.json node server.js
//
// รองรับเท่าที่ server.js เรียกจริง: devices [-l] · shell settings get/put/delete global <k> ·
// shell ip route get · shell am broadcast/force-stop/start · shell dumpsys activity services ·
// reverse tcp:N tcp:N · reverse --list · reverse --remove tcp:N
const fs = require('fs');

const STATE = process.env.FAKE_ADB_STATE || '/tmp/fake-adb-state.json';
const SERIAL = process.env.FAKE_ADB_SERIAL || 'FAKE123';
const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { settings: {}, reverse: [] }; } };
const write = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2));

const argv = process.argv.slice(2);
let i = 0;
if (argv[0] === '-s') { i = 2; } // ข้าม -s <serial>
const cmd = argv[i];
const rest = argv.slice(i + 1);
const st = read();

function out(text) { process.stdout.write(text.endsWith('\n') ? text : text + '\n'); }

if (cmd === 'devices') {
  out(`List of devices attached\n${SERIAL}\tdevice product:fake model:Fake_Phone device:fake transport_id:1`);
  process.exit(0);
}

if (cmd === 'reverse') {
  if (rest[0] === '--list') { out(st.reverse.map((p) => `UsbFfs tcp:${p} tcp:${p}`).join('\n')); process.exit(0); }
  if (rest[0] === '--remove') {
    const port = Number(String(rest[1]).replace('tcp:', ''));
    st.reverse = st.reverse.filter((p) => p !== port);
    write(st); process.exit(0);
  }
  const port = Number(String(rest[0]).replace('tcp:', ''));
  if (!st.reverse.includes(port)) st.reverse.push(port);
  write(st); out(String(port)); process.exit(0);
}

if (cmd === 'shell') {
  const line = rest.join(' ');
  // settings get/put/delete global <key> [value]
  const m = /^settings (get|put|delete) global (\S+)\s*(.*)$/.exec(line);
  if (m) {
    const [, op, key, val] = m;
    if (op === 'get') { out(st.settings[key] === undefined ? 'null' : String(st.settings[key])); process.exit(0); }
    if (op === 'put') { st.settings[key] = val.trim(); write(st); process.exit(0); }
    delete st.settings[key]; write(st); process.exit(0);
  }
  // เครื่องนี้ไม่มีเน็ตของตัวเอง (เหมือน SM-A217F ที่ใช้ทดสอบจริง)
  if (line.startsWith('ip route get')) { out('RTNETLINK answers: Network is unreachable'); process.exit(0); }
  if (line.startsWith('dumpsys activity services')) { out('(nothing)'); process.exit(0); }
  if (line.startsWith('am ')) { process.exit(0); }
  process.exit(0);
}

process.exit(0);
