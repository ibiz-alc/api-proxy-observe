// mini-test: เปิด panel ผ่าน browser → connect emulator → tap search bar → screencap
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require(path.join(process.env.WORKTREE, 'node_modules', 'puppeteer-core'));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync('adb', ['-s', 'emulator-5554', ...a], { encoding: 'utf8', timeout: 15000 });

(async () => {
  adb('shell', 'am', 'force-stop', 'com.android.settings');
  adb('shell', 'am', 'start', '-a', 'android.settings.SETTINGS');
  await sleep(3000);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--window-size=1600,1000'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto('http://localhost:3100', { waitUntil: 'networkidle2' });
  await page.click('#mirrorToggleBtn');
  await page.waitForFunction(() => [...document.querySelectorAll('.mirror-select option')].some((o) => o.value === 'emulator-5554'), { timeout: 20000 });
  await page.select('.mirror-select', 'emulator-5554');
  await page.click('.mirror-btn.primary');
  await page.waitForFunction(() => document.querySelector('.mirror-status-text').textContent === 'เชื่อมต่อแล้ว', { timeout: 20000 });
  await sleep(1500);
  const box = await page.$eval('.mirror-canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  console.log('canvas box:', JSON.stringify(box));
  const x = box.x + box.w * 0.5, y = box.y + box.h * 0.078;
  console.log('clicking page coords:', x, y);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await sleep(80);
  await page.mouse.up();
  await sleep(2500);
  const focus = adb('shell', 'dumpsys', 'window').split('\n').find((l) => l.includes('mCurrentFocus'));
  console.log('focus after tap:', (focus || '').trim());
  // เขียนภาพลง cwd — อย่ารันจากใน repo ไม่งั้นภาพเข้า git (รันจาก scratchpad เสมอ)
  await page.screenshot({ path: path.join(process.cwd(), 'tap-test-panel.png') });
  await page.click('.mirror-btn.danger');
  await sleep(1000);
  await browser.close();
})().catch((e) => { console.error('CRASH:', e); process.exit(2); });
