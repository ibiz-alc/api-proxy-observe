// E2E: mirror panel ควบคุม emulator ผ่านเว็บจริง (puppeteer-core + Chrome จริง)
// รัน: env -u NODE_OPTIONS node mirror-e2e.js  (dev server :3100 ต้องรันอยู่, emulator-5554 พร้อม)
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(path.join(process.env.WORKTREE, 'node_modules', 'puppeteer-core'));

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = 'http://localhost:3100';
const SERIAL = 'emulator-5554';
const OUT = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', ['-s', SERIAL, ...args], { encoding: 'utf8', timeout: 15000 });

let failures = 0;
const step = (name, ok, detail = '') => {
  console.log(`STEP ${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

(async () => {
  // reset state ของ Settings บน emulator ให้เริ่มจากหน้าหลักเสมอ (กัน state ปนจากรอบก่อน)
  adb('shell', 'am', 'force-stop', 'com.android.settings');
  try { adb('shell', 'am', 'force-stop', 'com.google.android.settings.intelligence'); } catch {}
  adb('shell', 'am', 'start', '-a', 'android.settings.SETTINGS');
  await sleep(3000);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle2' });

  // 1) เปิด panel + เลือก emulator + เชื่อมต่อ
  await page.click('#mirrorToggleBtn');
  await page.waitForSelector('#mirrorDrawer', { visible: true });
  // รอจน option ของ emulator โผล่ (endpoint /api/devices enrich ผ่าน adb ใช้เวลาหลายวิ)
  await page.waitForFunction(
    (serial) => [...document.querySelectorAll('.mirror-select option')].some((o) => o.value === serial),
    { timeout: 20000 }, SERIAL,
  );
  await page.select('.mirror-select', SERIAL).catch(() => {});
  const selVal = await page.$eval('.mirror-select', (s) => s.value);
  step('เลือก device emulator-5554', selVal === SERIAL, `select=${selVal}`);
  await page.click('.mirror-btn.primary');
  const status = async () => page.$eval('.mirror-status-text', (n) => n.textContent);
  const waitStatus = async (want, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if ((await status()) === want) return true; await sleep(300); }
    return false;
  };
  step('เชื่อมต่อสำเร็จ (status เชื่อมต่อแล้ว)', await waitStatus('เชื่อมต่อแล้ว', 20000), `status=${await status()}`);
  await sleep(1500);
  const canvasBox = await page.$eval('.mirror-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  step('canvas มีขนาดจริง', canvasBox.w > 100 && canvasBox.h > 200, JSON.stringify(canvasBox));
  await page.screenshot({ path: path.join(OUT, 'shot-1-connected.png') });

  // 2) แตะ search bar ของ Settings (0.5, 0.078) → คีย์บอร์ดต้องโผล่บนเครื่อง
  const tap = async (nx, ny) => {
    const x = canvasBox.x + canvasBox.w * nx, y = canvasBox.y + canvasBox.h * ny;
    await page.mouse.move(x, y); await page.mouse.down(); await sleep(60); await page.mouse.up();
  };
  await tap(0.5, 0.078);
  await sleep(2000);
  // ดูเฉพาะ mCurrentFocus — grep ทั้ง dumpsys จะเจอ SearchActivity ค้างใน recent tasks (false positive)
  const onSearch = () => {
    const focus = adb('shell', 'dumpsys', 'window').split('\n').find((l) => l.includes('mCurrentFocus')) || '';
    return /SearchActivity/.test(focus);
  };
  step('แตะ search bar แล้วหน้า search เปิด (tap ทำงานจริง)', onSearch());

  // 3) พิมพ์ ASCII ผ่าน keyboard บน canvas
  await page.click('.mirror-video'); // focus container
  await page.keyboard.type('wifi', { delay: 120 });
  await sleep(1500);
  execFileSync('bash', ['-c', `adb -s ${SERIAL} exec-out screencap -p > ${path.join(OUT, 'emu-2-ascii.png')}`]);
  console.log('(ตรวจภาพ emu-2-ascii.png: ต้องเห็น "wifi" ในช่อง search)');

  // 4) ลบข้อความ (Backspace x4) แล้วส่งภาษาไทยผ่านช่องข้อความ
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Backspace'); await sleep(150); }
  await page.$eval('.mirror-text-input', (inp) => { inp.value = 'สวัสดีครับ'; });
  await page.$$eval('.mirror-btn', (btns) => btns.find((b) => b.textContent === 'ส่งข้อความ').click());
  await sleep(2500);
  execFileSync('bash', ['-c', `adb -s ${SERIAL} exec-out screencap -p > ${path.join(OUT, 'emu-3-thai.png')}`]);
  console.log('(ตรวจภาพ emu-3-thai.png: ต้องเห็น "สวัสดีครับ" ในช่อง search)');

  // 5) ปุ่ม Back → คีย์บอร์ด/หน้า search ปิด
  const tools = await page.$$('.mirror-tool');
  // กด back ไปเรื่อยๆ จนหลุดจากหน้า search (คีย์บอร์ด/ข้อความค้างอาจกินไป 1-2 ครั้ง) สูงสุด 4 ครั้ง
  let backPresses = 0;
  while (onSearch() && backPresses < 4) { await tools[0].click(); backPresses++; await sleep(1500); }
  step('ปุ่ม Back ทำงาน (ออกจากหน้า search แล้ว)', !onSearch(), `กด ${backPresses} ครั้ง`);

  // 6) scroll ด้วย wheel บนกลาง canvas
  execFileSync('bash', ['-c', `adb -s ${SERIAL} exec-out screencap -p > ${path.join(OUT, 'emu-4a-before-scroll.png')}`]);
  await page.mouse.move(canvasBox.x + canvasBox.w * 0.5, canvasBox.y + canvasBox.h * 0.5);
  for (let i = 0; i < 5; i++) { await page.mouse.wheel({ deltaY: 300 }); await sleep(200); }
  await sleep(1200);
  execFileSync('bash', ['-c', `adb -s ${SERIAL} exec-out screencap -p > ${path.join(OUT, 'emu-4b-after-scroll.png')}`]);
  console.log('(ตรวจภาพ 4a/4b: รายการ Settings ต้องเลื่อนลง)');

  // 7) หมุนจอ → canvas เปลี่ยน aspect + rotation บนเครื่องเปลี่ยน
  await tools[3].click(); // rotate
  await sleep(3000);
  const rot1 = (adb('shell', 'dumpsys', 'window').match(/mCurrentRotation=\S+|rotation=\d/) || ['?'])[0];
  const box2 = await page.$eval('.mirror-canvas', (c) => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  step('หมุนจอ: canvas เป็นแนวนอน', box2.w > box2.h, `rot=${rot1} canvas=${JSON.stringify(box2)}`);
  await page.screenshot({ path: path.join(OUT, 'shot-2-landscape.png') });
  await tools[3].click(); // หมุนกลับ
  await sleep(3000);
  const box3 = await page.$eval('.mirror-canvas', (c) => { const r = c.getBoundingClientRect(); return { w: r.width, h: r.height }; });
  step('หมุนกลับ: canvas เป็นแนวตั้ง', box3.h > box3.w, JSON.stringify(box3));

  // 8) resilience: ฆ่า scrcpy บนเครื่อง → panel ต้อง auto-reconnect เอง (session ใหม่ = PID ใหม่)
  // ชื่อ process ของ scrcpy server คือ app_process — ต้องดูที่ ARGS ไม่ใช่ NAME
  const scrcpyPid = () => (adb('shell', 'ps', '-A', '-o', 'PID,ARGS').split('\n').find((l) => /scrcpy/i.test(l)) || '').trim().split(/\s+/)[0] || '';
  const pidBefore = scrcpyPid();
  adb('shell', 'pkill', '-f', 'com.genymobile.scrcpy');
  // ต้องเห็น "หลุด" ก่อน (status เปลี่ยนจากเชื่อมต่อแล้ว) — ไม่งั้นจะอ่าน status เก่าแล้วเข้าใจผิดว่าต่ออยู่
  const t0 = Date.now();
  let dropped = false;
  while (Date.now() - t0 < 12000) { if ((await status()) !== 'เชื่อมต่อแล้ว') { dropped = true; break; } await sleep(200); }
  const backOnline = await waitStatus('เชื่อมต่อแล้ว', 25000);
  await sleep(1500);
  const pidAfter = scrcpyPid();
  step('auto-reconnect หลัง scrcpy ตาย (เห็นหลุดจริง + PID ใหม่ + กลับมาต่อเอง)',
    dropped && Boolean(pidBefore) && Boolean(pidAfter) && pidBefore !== pidAfter && backOnline,
    `dropped=${dropped} pidBefore=${pidBefore} pidAfter=${pidAfter} backOnline=${backOnline}`);

  // 9) ซ่อน/แสดง โดย session ไม่หลุด
  await page.$$eval('.mirror-icon-btn', (btns) => btns.find((b) => b.title.includes('ซ่อน')).click());
  const hidden = await page.$eval('#mirrorDrawer', (d) => getComputedStyle(d).display === 'none' || d.offsetParent === null);
  await page.click('#mirrorToggleBtn');
  const shown = await page.$eval('#mirrorDrawer', (d) => getComputedStyle(d).display !== 'none');
  step('ซ่อน/แสดง panel โดยยังเชื่อมต่ออยู่', hidden && shown && (await status()) === 'เชื่อมต่อแล้ว', `hidden=${hidden} shown=${shown} status=${await status()}`);

  // 10) disconnect → scrcpy หายจากเครื่อง
  await page.click('.mirror-btn.danger');
  await sleep(2500);
  const psOut = adb('shell', 'ps', '-A', '-o', 'PID,ARGS').split('\n').filter((l) => /scrcpy/i.test(l));
  step('disconnect แล้วไม่มี scrcpy ค้างบนเครื่อง', psOut.length === 0, psOut.join(' | ') || 'clean');
  const st = await status();
  step('สถานะหลัง disconnect', st === 'ตัดการเชื่อมต่อแล้ว', `status=${st}`);

  // 11) ไม่มี JS error ทั้ง session
  step('ไม่มี pageerror ระหว่างทดสอบ', pageErrors.length === 0, pageErrors.join('; '));

  await browser.close();
  // คืนค่า rotation ของ emulator (rotate ของเราปิด auto-rotate ไว้)
  try { adb('shell', 'settings', 'put', 'system', 'user_rotation', '0'); adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '1'); } catch {}
  console.log(failures === 0 ? 'E2E ALL PASS' : `E2E FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('E2E CRASH:', e); process.exit(2); });
