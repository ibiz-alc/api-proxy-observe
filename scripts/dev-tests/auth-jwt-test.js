#!/usr/bin/env node
// Dev-test แท็บ Auth ของ Request (แท็บ 🌐 Proxy) — ถอด JWT ที่ส่งมาใน header
//   env -u NODE_OPTIONS PORT=3100 node <repo>/scripts/dev-tests/auth-jwt-test.js
// รันจากนอก repo (screenshot ลง cwd) · ต้องมี puppeteer-core (npm i puppeteer-core@23 --no-save)
// เช็ค: 1 มีแท็บ Auth เมื่อมี Authorization · 2 อยู่ระหว่าง Header กับ Body · 3 ไม่มีแท็บเมื่อไม่มี auth
//        4 Data = token ดิบครบเส้น · 5 Header ถอดได้ · 6 Payload ถอดได้ (nested/array/UTF-8 ไทย)
//        7 Signature ตรงส่วนที่ 3 · 8 exp ยังไม่หมด → badge เขียว · 9 exp หมดแล้ว → badge แดง
//        10 Basic → user/pass · 11 x-auth-token + cookie ที่เป็น JWT · 12 token พังไม่ทำหน้าล่ม
//        12b opaque Bearer ไม่ถูกมองว่าพัง
//        13 ไม่มี page error
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
const b64url = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8')
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const NOW = Math.floor(Date.now() / 1000);
const SIG = 'PF5DflDsyCqvXKxD0tXIn7Hv_UoFvvHXWLehUlFltVQf9DWUg27OrpFD8Mri0X5uOZ7iJuC7rJtPp3NKrnZeqE3yqEr5Td';
const HEADER = { alg: 'RS256', typ: 'JWT' };
const PAYLOAD = {
  aud: '22ebddc6-add2-433e-b1d8-85b0bb5327bf',
  cus: '4945b4ca-0071-aa24-3531-cfd574a596d1',
  exp: NOW + 86400,
  iat: NOW - 60,
  iss: 'it:registry:key/450e00cd-37e3-49e7-9979-bc9bf9838f60',
  jti: '81538773-dfb0-4df7-b180-888267bdf822',
  profile: { kind: 'agent:saas', realm: 'thaivivatth-realm', region: 'us-east-1' },
  purpose: 'activity',
  scope: ['it:activity:createEventSet', 'it:activity:modifyEvent', 'it:activity:POST:events'],
  sub: '00c35fa0-7c3d-48f2-8c57-7a80276f555b',
  ten: 451780679,
  note: 'ทดสอบภาษาไทย · UTF-8', // กันบั๊ก base64url → utf8 (atob ตรง ๆ จะได้ตัวยึกยือ)
};
const JWT = `${b64url(HEADER)}.${b64url(PAYLOAD)}.${SIG}`;
const EXPIRED_JWT = `${b64url(HEADER)}.${b64url({ ...PAYLOAD, iat: NOW - 7200, exp: NOW - 3600 })}.${SIG}`;

const baseFlow = (reqHeaders) => ({
  id: 'auth-test', method: 'POST', url: 'https://example.test/api/events', path: '/api/events',
  host: 'example.test', status: 200, statusText: 'OK', durationMs: 120, resSize: 20,
  time: new Date().toISOString(),
  reqHeaders, reqBody: '{"a":1}', resHeaders: { 'content-type': 'application/json' }, resBody: '{"ok":true}',
});

// ชื่อ subtab ทั้งหมดของ pane ซ้าย (Request) + ข้อความในแท็บที่เปิดอยู่
const readPane = (page) => page.evaluate(() => {
  const pane = document.querySelectorAll('.detail-split > .detail-pane')[0];
  return {
    tabs: [...pane.querySelectorAll('.subtab-btn')].map((b) => b.textContent),
    text: pane.querySelector('.detail-pane-body').innerText,
    sections: [...pane.querySelectorAll('.auth-sec td')].map((td) => td.textContent),
    keys: [...pane.querySelectorAll('.auth-kv tr:not(.auth-sec) td:first-child')].map((td) => td.textContent),
    tokens: [...pane.querySelectorAll('.auth-token')].map((d) => d.textContent),
    // classList.contains — ห้ามใช้ className.includes('bad') เพราะคำว่า "auth-badge" มี "bad" อยู่ในตัว
    badges: [...pane.querySelectorAll('.auth-badge')].map((b) => `${b.classList.contains('bad') ? 'bad' : 'ok'}:${b.textContent}`),
  };
});

// render flow แล้วเปิดแท็บ Auth (ถ้ามี)
async function showAuth(page, flow) {
  await page.evaluate((f) => window.renderFlowDetail(f), flow);
  const opened = await page.evaluate(() => {
    const pane = document.querySelectorAll('.detail-split > .detail-pane')[0];
    const btn = [...pane.querySelectorAll('.subtab-btn')].find((b) => b.textContent === 'Auth');
    if (btn) btn.click();
    return !!btn;
  });
  await sleep(80);
  return opened;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2', timeout: 20000 });
  await page.click('button[data-tab="proxy"]');

  // ---- 1-2) มีแท็บ Auth และอยู่ระหว่าง Header กับ Body ----
  await showAuth(page, baseFlow({ Host: 'example.test', Authorization: `Bearer ${JWT}` }));
  let p = await readPane(page);
  check('1 มีแท็บ Auth เมื่อมี Authorization', p.tabs.includes('Auth'), p.tabs.join(' | '));
  check('2 Auth อยู่ระหว่าง Header กับ Body', p.tabs.indexOf('Auth') === 1 && p.tabs[0] === 'Header' && p.tabs[2] === 'Body', p.tabs.join(' | '));

  // ---- 4-7) เนื้อหาที่ถอดได้ ----
  check('4 Data = token ดิบครบทั้งเส้น', p.tokens.includes(JWT), `tokens=${p.tokens.length}`);
  check('4 section หัวข้อถูกต้อง', p.sections[0] === 'Bearer Authentication' && p.sections[1] === 'JWT Token', p.sections.join(' / '));
  check('5 Header ถอดได้ (alg/typ)', p.text.includes('RS256') && p.text.includes('"typ"'), '');
  const payloadOk = ['22ebddc6-add2-433e-b1d8-85b0bb5327bf', 'thaivivatth-realm', 'it:activity:POST:events', '451780679']
    .every((s) => p.text.includes(s));
  check('6 Payload ถอดครบ (nested profile + array scope + number)', payloadOk, '');
  check('6 UTF-8 ไทยถอดถูก', p.text.includes('ทดสอบภาษาไทย · UTF-8'), '');
  check('7 Signature = ส่วนที่ 3 ของ token', p.tokens.includes(SIG), '');
  check('7 มีแถว Header/Payload/Signature', ['Data', 'Header', 'Payload', 'Signature'].every((k) => p.keys.includes(k)), p.keys.join(', '));

  // ---- 8) exp ยังไม่หมด ----
  check('8 exp ยังไม่หมด → badge เขียว', p.badges.some((b) => b === 'ok:ยังไม่หมดอายุ') && !p.badges.some((b) => b.startsWith('bad')), p.badges.join(', '));
  check('8 มีแถวเวลา iat/exp + อายุ token', p.keys.some((k) => k.includes('(exp)')) && p.keys.some((k) => k.includes('(iat)')) && p.keys.includes('อายุรวมของ token'), '');

  // ---- 9) exp หมดแล้ว ----
  await showAuth(page, baseFlow({ Authorization: `Bearer ${EXPIRED_JWT}` }));
  p = await readPane(page);
  check('9 exp หมดแล้ว → badge แดง + บอกว่าหมดก่อนยิง request', p.badges.includes('bad:หมดอายุแล้ว') && p.badges.includes('bad:หมดอายุก่อนยิง request นี้'), p.badges.join(', '));

  // ---- 10) Basic auth ----
  const basic = Buffer.from('somchai:s3cr3t!', 'utf8').toString('base64');
  await showAuth(page, baseFlow({ Authorization: `Basic ${basic}` }));
  p = await readPane(page);
  check('10 Basic → แยก user/pass', p.sections[0] === 'Basic Authentication' && p.text.includes('somchai') && p.text.includes('s3cr3t!'), p.sections.join(' / '));
  check('10 Basic ไม่มี section JWT Token', !p.sections.includes('JWT Token'), p.sections.join(' / '));

  // ---- 11) header อื่น + cookie ที่เป็น JWT ----
  await showAuth(page, baseFlow({ 'X-Auth-Token': JWT, Cookie: `theme=dark; access_token=${JWT}; other=1` }));
  p = await readPane(page);
  check('11 เจอ JWT ใน header อื่น (X-Auth-Token)', p.sections.includes('X-Auth-Token'), p.sections.join(' / '));
  check('11 เจอ JWT ใน cookie', p.sections.includes('Cookie · access_token'), p.sections.join(' / '));
  check('11 ถอดทั้งสองอัน (2 × JWT Token)', p.sections.filter((s) => s === 'JWT Token').length === 2, p.sections.join(' / '));

  // ---- 12) token พัง ----
  await showAuth(page, baseFlow({ Authorization: 'Bearer not.a.jwt' }));
  p = await readPane(page);
  check('12 token พัง → บอก error ไม่ทำหน้าล่ม', p.keys.some((k) => k.includes('ถอดไม่สำเร็จ')) || p.text.includes('ไม่ใช่ JSON'), p.text.slice(0, 120).replace(/\n/g, ' '));

  // ---- 12b) opaque Bearer (ไม่ใช่ JWT) → ห้ามขึ้นเออเรอร์/หัวข้อ JWT Token ----
  await showAuth(page, baseFlow({ Authorization: 'Bearer 2YotnFZFEjr1zCsicMWpAA' }));
  p = await readPane(page);
  check('12b opaque token → ไม่มี section JWT Token และไม่มีเออเรอร์',
    !p.sections.includes('JWT Token') && !p.keys.some((k) => k.includes('ถอดไม่สำเร็จ')), p.sections.join(' / '));
  check('12b บอกว่าเป็น opaque token', p.text.includes('opaque token'), p.keys.join(', '));

  // ---- 3) ไม่มี auth → ไม่มีแท็บ ----
  const opened = await showAuth(page, baseFlow({ Host: 'example.test', 'User-Agent': 'okhttp/5.3.2' }));
  p = await readPane(page);
  check('3 ไม่มี auth header → ไม่มีแท็บ Auth', !opened && !p.tabs.includes('Auth'), p.tabs.join(' | '));

  // ---- 13) ไม่มี page error ----
  check('13 ไม่มี JS error บนหน้า', pageErrors.length === 0, pageErrors.join(' | '));

  await showAuth(page, baseFlow({ Authorization: `Bearer ${JWT}` }));
  await page.screenshot({ path: 'auth-jwt-tab.png' });
  console.log('screenshot: auth-jwt-tab.png');
  await browser.close();
  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
