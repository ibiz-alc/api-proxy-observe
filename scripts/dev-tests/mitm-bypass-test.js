#!/usr/bin/env node
// Dev-test รายชื่อ host ที่ mitmproxy ปล่อยผ่านไม่ดัก TLS (mitm-bypass.sh)
//   env -u NODE_OPTIONS node <repo>/scripts/dev-tests/mitm-bypass-test.js
// ไม่ต้องมี server / มือถือ / puppeteer — เทสต์ regex + args ที่ส่งให้ mitmdump ล้วน ๆ
//
// ทำไมต้องมีเทสต์นี้: ถ้า regex กว้างไป → flow ของแอปที่กำลังเทสต์หายไปเงียบ ๆ (ไม่มี error ให้เห็น)
// ถ้าแคบไป → GMS handshake ไม่ผ่าน แล้ว FirebaseMessaging.getToken() พังเป็น SERVICE_NOT_AVAILABLE
// เช็ค: 1 host ของ GMS/Play ต้องถูก bypass · 2 host ของแอป/Firebase ฝั่งแอป ต้องยังถูกดัก(บันทึก)
//        3 ไม่ over-match โดเมนที่แค่มีคำว่า google อยู่ · 4 args ที่ส่งให้ mitmdump ถูกต้อง
//        5 ปิด bypass ด้วย MITM_IGNORE_HOSTS= ได้จริง (ต้องไม่ส่ง --ignore-hosts ว่าง = match ทุกอย่าง)
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const BYPASS = path.join(REPO, 'mitm-bypass.sh');

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

// รัน sh แล้วอ่านค่าที่ mitm-bypass.sh ตั้งไว้ (เทสต์ผ่าน /bin/sh เพราะ docker-entrypoint.sh ใช้ sh)
function readIgnoreRegex(env = {}) {
  return cp.execFileSync('/bin/sh', ['-c', `. "${BYPASS}"; printf %s "$MITM_IGNORE_HOSTS"`],
    { encoding: 'utf8', env: { ...process.env, ...env } });
}

// เรียก start_mitmdump ด้วย mitmdump ปลอม แล้วอ่าน argv ที่มันได้รับจริง
function captureArgs(shell, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitm-bypass-'));
  const fake = path.join(dir, 'fake-mitmdump');
  const out = path.join(dir, 'argv.txt');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > ${out}\n`);
  fs.chmodSync(fake, 0o755);
  cp.execFileSync(shell, ['-c', `. "${BYPASS}"; start_mitmdump /tmp/addon.py; wait`],
    { env: { ...process.env, ...env, MITMDUMP: fake }, stdio: 'ignore' });
  const argv = fs.readFileSync(out, 'utf8').split('\n').filter(Boolean);
  fs.rmSync(dir, { recursive: true, force: true });
  return argv;
}

const rx = new RegExp(readIgnoreRegex(), 'i');

// 1) host ของ Google Play Services — ถ้าโดนดัก GMS จะ handshake ไม่ผ่าน → FCM พัง
for (const h of ['www.google.com', 'android.apis.google.com', 'android.clients.google.com',
  'mtalk.google.com', 'mtalk.google.com:5228', 'google.com', 'play.google.com',
  'quake-pa.googleapis.com', 'people-pa.googleapis.com', 'play.googleapis.com',
  'digitalassetlinks.googleapis.com', 'connectivitycheck.gstatic.com', 'app-measurement.com',
  'lh3.googleusercontent.com']) {
  check(`1 bypass ${h}`, rx.test(h));
}

// 2) host ที่ต้องยังดัก/บันทึกได้เหมือนเดิม (ของแอปที่กำลังเทสต์ + Firebase ฝั่งแอปที่ทะลุ mitm ได้อยู่แล้ว)
for (const h of ['claim-app-api.alpha.thaivivat.co.th', 'firebaseinstallations.googleapis.com',
  'firebase-settings.crashlytics.com', 'api2.branch.io', 'graph.facebook.com',
  'maps.googleapis.com',
  // แอปยิงเอง ทะลุ mitm ได้อยู่แล้ว — ห้ามให้กฎ -pa กินไปด้วย ไม่งั้นหายจาก flow เงียบ ๆ
  'firebaselogging-pa.googleapis.com']) {
  check(`2 ยังดักอยู่ ${h}`, !rx.test(h));
}

// 3) กัน regex หลุดไป match โดเมนที่แค่มีคำว่า google/android ประกอบอยู่
for (const h of ['notgoogle.com', 'evilgoogle.com.attacker.net', 'google.com.evil.net',
  'myandroid.com.example.org']) {
  check(`3 ไม่ over-match ${h}`, !rx.test(h));
}

// 4) args จริงที่ส่งให้ mitmdump — เทสต์ทั้ง sh และ bash (docker ใช้ sh, start/restart ใช้ bash)
for (const shell of ['/bin/sh', '/bin/bash']) {
  const argv = captureArgs(shell);
  const i = argv.indexOf('--ignore-hosts');
  check(`4 ${shell}: มี --ignore-hosts`, i !== -1, argv.join(' '));
  check(`4 ${shell}: regex ไม่โดน shell แปลงร่าง`, i !== -1 && argv[i + 1] === readIgnoreRegex(), argv[i + 1]);
  check(`4 ${shell}: ยังโหลด addon + พอร์ต 8888`,
    argv.includes('-s') && argv.includes('/tmp/addon.py') && argv.includes('8888'), argv.join(' '));
  // พอร์ตต้องตรึง 8888 เสมอ — ที่อื่นในสคริปต์ (wait_port/adb reverse) กับ server.js hardcode ไว้
  check(`4 ${shell}: MITM_PORT ตั้งไม่ได้ (ตรึง 8888)`,
    captureArgs(shell, { MITM_PORT: '9999' }).includes('8888'));
}

// 5) ปิด bypass ได้ และต้อง "ไม่ส่ง" flag เลย — ส่ง --ignore-hosts "" = regex ว่าง = match ทุก host
//    (จะกลายเป็นปล่อยผ่านทั้งหมด = ไม่เหลือ flow ให้ดูสักอัน โดยไม่มี error อะไรฟ้อง)
for (const shell of ['/bin/sh', '/bin/bash']) {
  const argv = captureArgs(shell, { MITM_IGNORE_HOSTS: '' });
  check(`5 ${shell}: MITM_IGNORE_HOSTS= → ไม่มี --ignore-hosts`, !argv.includes('--ignore-hosts'), argv.join(' '));
}

// 6) override ด้วย env ได้
check('6 override ด้วย env ได้', readIgnoreRegex({ MITM_IGNORE_HOSTS: '^example\\.com$' }) === '^example\\.com$');

console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
process.exit(failed ? 1 : 0);
