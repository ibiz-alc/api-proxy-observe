#!/usr/bin/env node
// Dev-test: backend ของ Map Local groups + bulk create (ไม่ต้องมี puppeteer/มือถือ)
// เริ่ม dev server แยกโดยชี้ไฟล์ temp เพื่อไม่แตะ map-local.json จริง:
//   env -u NODE_OPTIONS PORT=3100 MAP_LOCAL_FILE=/tmp/ml-test.json MAP_GROUPS_FILE=/tmp/mg-test.json node server.js
//   env -u NODE_OPTIONS PORT=3100 node scripts/dev-tests/maplocal-backend-test.js
// เช็ค: bulk create, groups CRUD (สร้างเปล่า/rename/merge/ลบ=ungroup), กลุ่มว่างอยู่รอด, activate/deactivate additive
const PORT = process.env.PORT || 3100;
const BASE = `http://127.0.0.1:${PORT}`;

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}
const jget = async (p) => (await fetch(BASE + p)).json();
const jsend = async (m, p, body) => (await fetch(BASE + p, {
  method: m, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
})).json();
const post = (p, b) => jsend('POST', p, b);
const put = (p, b) => jsend('PUT', p, b);
const del = (p) => jsend('DELETE', p);
const rules = () => jget('/api/maplocal');
const groups = async () => (await jget('/api/maplocal/groups')).groups;
const groupNames = async () => (await groups()).map((g) => g.name);
const findGroup = async (n) => (await groups()).find((g) => g.name === n) || {};

(async () => {
  // เริ่มจากศูนย์: ลบ rule ที่มีอยู่ทั้งหมด (server อาจโหลดไฟล์ temp เก่า)
  for (const r of await rules()) await del('/api/maplocal/' + r.id);
  for (const g of await groups()) await del('/api/maplocal/groups/' + encodeURIComponent(g.name));
  check('setup: เริ่มจากศูนย์', (await rules()).length === 0 && (await groups()).length === 0,
    `rules=${(await rules()).length} groups=${(await groups()).length}`);

  // 1) bulk create — สร้างหลาย rule ทีเดียว, ungrouped
  const bulk = await post('/api/maplocal/bulk', { rules: [
    { name: 'A', method: 'GET', urlPattern: '/a', body: '{"a":1}' },
    { name: 'B', method: 'POST', urlPattern: '/b', body: '{"b":2}' },
    { name: 'C', method: 'GET', urlPattern: '/c' },
  ] });
  check('1 bulk คืน count=3', bulk.ok && bulk.count === 3, `count=${bulk.count}`);
  const afterBulk = await rules();
  check('1 มี 3 rule ในสโตร์', afterBulk.length === 3, `len=${afterBulk.length}`);
  check('1 rule ที่ bulk สร้าง = ungrouped (scenario ว่าง)', afterBulk.every((r) => r.scenario === ''), JSON.stringify(afterBulk.map((r) => r.scenario)));
  check('1 คงลำดับที่ส่งมา (A บนสุด)', afterBulk[0].name === 'A', afterBulk.map((r) => r.name).join(','));

  // 2) สร้างกลุ่มเปล่า → ต้องโผล่ใน groups ทั้งที่ยังไม่มี rule
  await post('/api/maplocal/groups', { name: 'Login flow' });
  check('2 กลุ่มเปล่าโผล่ใน list (total=0)', (await findGroup('Login flow')).total === 0, JSON.stringify(await findGroup('Login flow')));
  const dup = await post('/api/maplocal/groups', { name: 'Login flow' });
  check('2 สร้างซ้ำชื่อเดิม → existed=true, ไม่เพิ่มซ้ำ', dup.existed === true && (await groupNames()).filter((n) => n === 'Login flow').length === 1, JSON.stringify(await groupNames()));
  const empty = await post('/api/maplocal/groups', { name: '   ' });
  check('2 ชื่อว่าง → error', empty.ok === false, JSON.stringify(empty));

  // 3) ย้าย rule เข้ากลุ่ม (PUT scenario) → group total เพิ่ม
  const ra = (await rules()).find((r) => r.name === 'A');
  const rb = (await rules()).find((r) => r.name === 'B');
  await put('/api/maplocal/' + ra.id, { scenario: 'Login flow' });
  await put('/api/maplocal/' + rb.id, { scenario: 'Login flow' });
  let g = await findGroup('Login flow');
  check('3 ย้าย 2 rule เข้า Login flow → total=2, enabled=2, active', g.total === 2 && g.enabled === 2 && g.active === true, JSON.stringify(g));

  // 4) deactivate ทั้งกลุ่ม (additive) → rule ในกลุ่มปิดหมด, กลุ่มอื่น/ungrouped ไม่กระทบ
  //    สร้างกลุ่มที่สองไว้ยืนยัน additive
  const rc = (await rules()).find((r) => r.name === 'C');
  await put('/api/maplocal/' + rc.id, { scenario: 'Other' });
  await post('/api/maplocal/scenarios/' + encodeURIComponent('Login flow') + '/deactivate');
  check('4 deactivate Login flow → rule ในกลุ่มปิดหมด', (await rules()).filter((r) => r.scenario === 'Login flow').every((r) => r.enabled === false), '');
  check('4 additive: กลุ่ม Other ไม่ถูกแตะ (ยังเปิด)', (await rules()).find((r) => r.name === 'C').enabled === true, '');
  // 5) activate กลับ (additive)
  await post('/api/maplocal/scenarios/' + encodeURIComponent('Login flow') + '/activate', { exclusive: false });
  check('5 activate Login flow → rule ในกลุ่มเปิดหมด', (await rules()).filter((r) => r.scenario === 'Login flow').every((r) => r.enabled === true), '');
  check('5 additive: กลุ่ม Other ยังเปิด (ไม่โดน exclusive)', (await rules()).find((r) => r.name === 'C').enabled === true, '');

  // 6) rename กลุ่ม → scenario ทุก rule ตาม + ชื่อกลุ่มเปลี่ยน
  const rn = await put('/api/maplocal/groups/' + encodeURIComponent('Login flow'), { newName: 'Auth' });
  check('6 rename → moved=2', rn.renamed && rn.renamed.moved === 2, JSON.stringify(rn.renamed));
  check('6 ไม่มีกลุ่มชื่อเก่า, มีชื่อใหม่', !(await groupNames()).includes('Login flow') && (await groupNames()).includes('Auth'), JSON.stringify(await groupNames()));
  check('6 rule ย้าย scenario เป็น Auth', (await rules()).filter((r) => r.scenario === 'Auth').length === 2, '');

  // 7) rename ชนชื่อกลุ่มเดิม = merge
  await put('/api/maplocal/groups/' + encodeURIComponent('Auth'), { newName: 'Other' });
  check('7 merge: เหลือกลุ่มเดียวชื่อ Other total=3', (await findGroup('Other')).total === 3 && !(await groupNames()).includes('Auth'), JSON.stringify(await findGroup('Other')));

  // 8) collapsed อยู่รอด (persist)
  await put('/api/maplocal/groups/' + encodeURIComponent('Other'), { collapsed: true });
  check('8 collapsed=true persist', (await findGroup('Other')).collapsed === true, JSON.stringify(await findGroup('Other')));

  // 9) ลบกลุ่ม = ungroup (ไม่ลบ rule)
  const before = (await rules()).length;
  const rmv = await del('/api/maplocal/groups/' + encodeURIComponent('Other'));
  check('9 ลบกลุ่ม → ungrouped=3, rule ยังอยู่ครบ', rmv.ungrouped === 3 && (await rules()).length === before, `ungrouped=${rmv.ungrouped} rules=${(await rules()).length}`);
  check('9 rule กลับเป็น ungrouped, ไม่มีกลุ่มเหลือ', (await rules()).every((r) => r.scenario === '') && (await groups()).length === 0, JSON.stringify(await groupNames()));

  // เก็บกวาด
  for (const r of await rules()) await del('/api/maplocal/' + r.id);

  console.log(failed ? `\n${failed} เช็คไม่ผ่าน` : '\nผ่านทั้งหมด');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
