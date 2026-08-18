'use strict';
// ios-mirror.js — mirror จอ iOS Simulator เข้าพาเนลเดียวกับ Android
//
// ทำไมไม่ใช้วิธีเดียวกับ Android: scrcpy เป็นของ Android ล้วน (adb + server jar ฝั่งเครื่อง)
// iOS Simulator ไม่มี protocol แบบนั้น ของที่ Apple ให้มามีแค่:
//   - `simctl io <udid> screenshot <file>` = ภาพนิ่งทีละเฟรม (เขียนลง stdout ไม่ได้ ลองแล้ว
//     ทั้ง `-` และ /dev/stdout → เป็นชื่อไฟล์จริง/NSCocoaError 513)
//   - `simctl io <udid> recordVideo` = อัดลงไฟล์ mp4 เท่านั้น สตรีมสดไม่ได้
//     (AVFoundation -11823 "Cannot Save" เมื่อชี้ /dev/stdout)
// → เลยใช้ลูปถ่าย screenshot เป็น JPEG แล้วยิงเข้า WS ทีละเฟรม
//   วัดจริงบนเครื่องนี้: ยิงทีละตัว ~7 fps · ยิงซ้อน 2 ตัว ~12 fps · ซ้อน 3 ตัว ~16 fps
//   (คอขวดคือเวลา spawn process ไม่ใช่ตัวถ่ายภาพ → ซ้อนแล้วได้ fps เพิ่มจริง)
//
// ส่วน input (แตะ/ปัด/พิมพ์) simctl ไม่มีคำสั่งเลย → ใช้ idb (facebook/idb) ถ้ามีในเครื่อง
// ไม่มีก็ยัง mirror ดูภาพได้ปกติ แค่สั่งงานไม่ได้ (บอกวิธีติดตั้งไปที่ client)
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const execFileP = promisify(execFile);

const MAX_PIPELINE = 6;   // จำนวนสายถ่ายภาพสูงสุด (มากกว่านี้ CPU แย่งกันเองไม่ได้ fps เพิ่ม)
const IDLE_MAX_MS = 500;  // พักได้นานสุดตอนจอนิ่ง — ปลอดภัยเพราะ input ปลุกให้เต็มสปีดทันที

// ---------- หา binary ----------
let _simctl; // path ของ simctl (resolve ครั้งเดียว — เรียก xcrun ทุกเฟรมเสียเวลา spawn ฟรีๆ)
async function simctlPath() {
  if (_simctl !== undefined) return _simctl;
  try {
    const { stdout } = await execFileP('xcrun', ['-f', 'simctl'], { timeout: 10000 });
    _simctl = stdout.trim() || null;
  } catch {
    _simctl = null;
  }
  return _simctl;
}

// ที่อยู่มาตรฐานของ idb ที่ ApiTester ติดตั้งไว้ให้ (ดูวิธีลงใน README)
// แยกเป็นโฟลเดอร์ของเราเองเพราะ fb-idb (client) รันได้แค่ Python <= 3.11 → ต้องอยู่ใน venv
// และ idb_companion ต้อง build เอง (ไม่มี bottle ใน brew)
const IDB_HOME = path.join(os.homedir(), '.apitester');
const DEFAULT_IDB = path.join(IDB_HOME, 'idb-venv', 'bin', 'idb');
const DEFAULT_COMPANION = path.join(IDB_HOME, 'idb', 'idb_companion');

let _idb; // path ของ idb CLI (null = ไม่ได้ติดตั้ง)
async function idbPath({ recheck = false } = {}) {
  if (_idb !== undefined && !recheck) return _idb;
  const candidates = [DEFAULT_IDB, 'idb', '/opt/homebrew/bin/idb', '/usr/local/bin/idb', path.join(os.homedir(), '.local/bin/idb')];
  if (process.env.IDB) candidates.unshift(process.env.IDB);
  for (const p of candidates) {
    try {
      await execFileP(p, ['--help'], { timeout: 8000 });
      _idb = p;
      return _idb;
    } catch { /* ตัวถัดไป */ }
  }
  _idb = null;
  return _idb;
}

// ---------- อ่านขนาดภาพจาก header ของ JPEG ----------
// ต้องอ่านเองเพราะไม่อยากลง lib รูปเพิ่ม — เดินทีละ marker หา SOF (ตัวที่บอก w/h)
function jpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }           // sync หา marker ตัวถัดไป
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    // SOF0..SOF15 ยกเว้น DHT(c4) JPG(c8) DAC(cc) — พวกนี้คือเฟรมจริงที่มี w/h
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * 1 เซสชัน mirror ของ sim หนึ่งเครื่อง
 * @param {object} o
 * @param {string} o.udid
 * @param {number} [o.pipeline]   จำนวน screenshot ที่ยิงซ้อนกัน (มาก = fps สูงขึ้น แต่กิน CPU)
 * @param {(buf: Buffer) => void} o.onFrame
 * @param {(meta: object) => void} o.onMeta
 * @param {(msg: string) => void} o.onError
 * @param {() => boolean} [o.shouldSend]  false = ข้ามเฟรมนี้ (client ตามไม่ทัน)
 */
class IosMirrorSession {
  constructor({ udid, pipeline = 4, maxWidth = 0, onFrame, onMeta, onError, shouldSend }) {
    this.udid = String(udid);
    this.pipeline = Math.max(1, Math.min(MAX_PIPELINE, Number(pipeline) || 4));
    // maxWidth = ย่อภาพด้วย sips ก่อนส่ง (0 = ไม่ย่อ = ค่าเริ่มต้น)
    // วัดจริง pipeline=3: ไม่ย่อ 17.1 fps @113KB · ย่อ 700px 10.6 fps @14KB
    // → sips กิน ~35ms/เฟรม แพงกว่าที่ประหยัดได้ เพราะ client ย่อตอน decode ได้ฟรีอยู่แล้ว
    //   (createImageBitmap + resizeWidth) เหลือไว้เป็นออปชันสำหรับเครื่องช้า/ต่อไกล
    this.maxW = Math.max(0, Number(maxWidth) || 0);
    this.onFrame = onFrame || (() => {});
    this.onMeta = onMeta || (() => {});
    this.onError = onError || (() => {});
    this.shouldSend = shouldSend || (() => true);
    this.stopped = false;
    this.procs = new Set();       // child ที่ยังวิ่ง (ไว้ kill ตอน stop)
    this.pxW = 0;                 // ขนาดภาพจริง (pixel)
    this.pxH = 0;
    this.ptW = 0;                 // ขนาดเชิง point ของ iOS (ใช้คุมพิกัดตอนสั่ง idb)
    this.ptH = 0;
    this.idb = null;
    this.ptReady = Promise.resolve();  // รอให้รู้ขนาดเชิง point ก่อนแปลงพิกัด input
    this.frameMs = 0;             // เวลาถ่าย 1 เฟรม (วัดจากเฟรมแรก)
    this.lastEmitAt = 0;          // เวลาเริ่มถ่ายของเฟรมล่าสุดที่ส่งออกไป (กันส่งเฟรมเก่าย้อนหลัง)
    this.lastBuf = null;          // เฟรมล่าสุดที่ส่งไป (ใช้เทียบว่าจอเปลี่ยนไหม)
    this.idleHits = 0;            // จำนวนเฟรมซ้ำติดกัน
    this.idleDelay = 0;           // ระยะพักระหว่างถ่าย (ms) ตอนจอนิ่ง
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apitester-ios-'));
  }

  slotFile(i) { return path.join(this.dir, `f${i}.jpg`); }

  // spawn แบบรอจบ — คืน true ถ้า exit 0 (ทุกตัวต้องมี on('error') ไม่งั้น ENOENT ล้ม process ทั้งเซิร์ฟเวอร์)
  _spawn(cmd, args) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawn(cmd, args, { stdio: 'ignore' });
      } catch {
        resolve(false);
        return;
      }
      this.procs.add(child);
      child.on('error', () => { this.procs.delete(child); resolve(false); });
      child.on('close', (code) => { this.procs.delete(child); resolve(code === 0); });
    });
  }

  // ถ่าย 1 เฟรม (คืน Buffer หรือ null ถ้าพัง) — ปล่อย slot คืนให้ลูปเสมอ
  async _shot(sc, slot) {
    const file = this.slotFile(slot);
    const ok = await this._spawn(sc, ['io', this.udid, 'screenshot', '--type=jpeg', file]);
    if (!ok) return { slot, buf: null };
    // ย่อทับไฟล์เดิม (sips -Z = ล็อกด้านยาวสุด สัดส่วนคงเดิม) — ย่อไม่สำเร็จก็ใช้ไฟล์เต็มไปก่อน
    if (this.maxW) await this._spawn('sips', ['-Z', String(this.maxW), file]);
    let buf = null;
    try {
      buf = fs.readFileSync(file);
      fs.unlinkSync(file);
    } catch { buf = null; }
    return { slot, buf: buf && buf.length ? buf : null };
  }

  async start() {
    const sc = await simctlPath();
    if (!sc) { this.onError('ไม่พบ simctl — ต้องติดตั้ง Xcode ก่อน'); return; }
    this.sc = sc;

    // เฟรมแรก: ใช้บอกขนาดจอให้ client ตั้ง aspect ratio + วัดเวลาถ่าย 1 เฟรม (ไว้คำนวณ stagger)
    const t0 = Date.now();
    const first = await this._shot(sc, 0);
    this.frameMs = Date.now() - t0;
    if (!first.buf) { this.onError(`ถ่ายจอ sim ไม่ได้ (udid=${this.udid}) — เครื่องบูตอยู่จริงไหม`); return; }
    const size = jpegSize(first.buf);
    this.pxW = (size && size.width) || 0;
    this.pxH = (size && size.height) || 0;

    // มี idb ไหม (เช็คเร็ว ~200ms) — ตัวที่ช้าคือ `idb describe` เพราะอาจต้องปลุก companion
    // ขึ้นมาก่อน (หลายวินาที) → **ห้ามรอ** ไม่งั้นพาเนลค้าง "กำลังเชื่อมต่อ…" ทั้งที่ภาพพร้อมแล้ว
    // โหลดขนาด point ไว้เบื้องหลัง แล้วให้ทาง input รอ this.ptReady เอาเอง (พิกัดต้องใช้ค่านี้)
    this.idb = await idbPath();
    this.ptReady = this.idb ? this._loadPointSize().catch(() => {}) : Promise.resolve();

    this.onMeta({
      width: this.pxW,
      height: this.pxH,
      input: Boolean(this.idb),
    });
    if (this.shouldSend()) this.onFrame(first.buf);
    // ลูปนี้ลอยอยู่ (ไม่ await) — ห้ามให้ rejection หลุด เพราะ Node ถือว่า unhandled rejection
    // = fatal แล้วดับ server ทั้งตัว (เคยเจอแนวเดียวกันกับ spawn ที่ไม่มี on('error'))
    this._loop().catch((e) => {
      this.onError('ลูปถ่ายจอหยุด: ' + (e && e.message ? e.message : e));
      this.stop();
    });
  }

  // idb describe บอก screen_dimensions มาให้ (pixel + density) → ได้ scale ไว้แปลงพิกัด
  async _loadPointSize() {
    try {
      let stdout;
      try {
        ({ stdout } = await execFileP(this.idb, ['describe', '--udid', this.udid, '--json'],
          { timeout: 30000, env: this._idbEnv() }));
      } catch (e) {
        // state ค้าง → ล้างแล้วลองใหม่ครั้งเดียว (เหมือน _idbRun)
        this._clearIdbState();
        ({ stdout } = await execFileP(this.idb, ['describe', '--udid', this.udid, '--json'],
          { timeout: 30000, env: this._idbEnv() }));
      }
      const j = JSON.parse(stdout);
      const d = j.screen_dimensions || {};
      // ตัวจริงคืน width_points/height_points มาให้ตรงๆ (เหลือ density ไว้เป็นทางสำรอง)
      const density = Number(d.density) || 1;
      this.ptW = Number(d.width_points) || Math.round((Number(d.width) || this.pxW) / density);
      this.ptH = Number(d.height_points) || Math.round((Number(d.height) || this.pxH) / density);
    } catch {
      // อ่านไม่ได้ก็เดาจาก scale 3x (iPhone รุ่นใหม่ทั้งหมด) ดีกว่าไม่มีพิกัดเลย
      this.ptW = Math.round(this.pxW / 3);
      this.ptH = Math.round(this.pxH / 3);
    }
  }

  // ลูปถ่ายเฟรม — แยกเป็น pipeline สายอิสระ สายละ 1 slot
  //
  // ทำไมต้องเหลื่อมเวลาเริ่ม: ถ้ายิงพร้อมกันทั้ง 3 สาย มันก็จบพร้อมกัน → เฟรมออกเป็น "ก้อนละ 3"
  // ทุก ~180ms ฝั่งเบราว์เซอร์ decode ทีละเฟรม เลยวาดได้แค่ก้อนละ 1 = 6 fps ทั้งที่ส่งไป 18
  // (วัดจริงด้วย CDP: rx=18 drop=12 draw=6) → หน่วงสายที่ i ออกไป i*(เวลาถ่าย/pipeline)
  // ทำให้เฟรมมาห่างเท่าๆ กัน แต่ละสายวนของตัวเอง จังหวะเหลื่อมจึงคงอยู่เอง
  async _loop() {
    const stagger = Math.max(20, Math.round((this.frameMs || 180) / this.pipeline));
    const chains = [];
    for (let i = 0; i < this.pipeline; i++) chains.push(this._chain(i, i * stagger));
    await Promise.all(chains);
  }

  async _chain(slot, delay) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    while (!this.stopped) {
      try {
        await this._chainStep(slot);
      } catch (e) {
        // สายเดียวพลาดไม่ควรทำสายอื่นหรือ server ล้ม — พักแล้วไปต่อ
        this.onError('ถ่ายจอพลาด: ' + (e && e.message ? e.message : e));
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  // 1 รอบของสายถ่ายภาพ (แยกออกมาให้ครอบ try ได้ทั้งก้อน)
  async _chainStep(slot) {
    if (this.idleDelay) await new Promise((r) => setTimeout(r, this.idleDelay));
    if (this.stopped) return;
    const startedAt = Date.now();
    const { buf } = await this._shot(this.sc, slot);
    if (this.stopped) return;
    if (!buf) {
      // ถ่ายไม่ได้ (sim ปิด/ค้าง) — หน่วงหน่อยกัน spawn รัวเปล่าๆ
      await new Promise((r) => setTimeout(r, 400));
      return;
    }
    // สายอื่นอาจแซงไปแล้ว — เฟรมที่เริ่มถ่ายก่อนเฟรมล่าสุดที่ส่งไป = ของเก่า ทิ้ง
    if (startedAt < this.lastEmitAt) return;
    this.lastEmitAt = startedAt;
    // จอนิ่ง = JPEG ออกมาไบต์ตรงกันเป๊ะ → ไม่ต้องส่งซ้ำ ประหยัดทั้งสายส่งและ decode ฝั่ง client
    // (Android ผ่าน scrcpy ส่งเฉพาะตอนภาพเปลี่ยนอยู่แล้ว ฝั่ง iOS ต้องทำเอง)
    if (this.lastBuf && this.lastBuf.length === buf.length && this.lastBuf.equals(buf)) {
      // จอนิ่งติดกันหลายเฟรม → ผ่อนสปีดถ่าย ไม่ต้องเผา CPU กับภาพเดิม
      // (ขยับขึ้นทีละ 60ms ถึงเพดาน IDLE_MAX_MS · ภาพเปลี่ยนเองหรือเราสั่ง input ก็ปลุกเต็มสปีดทันที)
      this.idleHits++;
      if (this.idleHits >= 4) this.idleDelay = Math.min(IDLE_MAX_MS, this.idleDelay + 60);
      return;
    }
    this._wake();
    this.lastBuf = buf;
    if (this.shouldSend()) this.onFrame(buf);
  }

  // กลับมาถ่ายเต็มสปีดทันที — เรียกทั้งตอนภาพเปลี่ยนเอง และตอนเราสั่ง input เข้าไป
  // (ไม่งั้นแตะแล้วต้องรอ idleDelay หมดก่อนจะเห็นผล = รู้สึกหนืด)
  _wake() {
    this.idleHits = 0;
    this.idleDelay = 0;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const p of this.procs) { try { p.kill('SIGKILL'); } catch {} }
    this.procs.clear();
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch {}
  }

  // ---------- input (ต้องมี idb) ----------
  get hasInput() { return Boolean(this.idb); }

  // 0..1 → point ของ iOS
  _pt(xN, yN) {
    const w = this.ptW || Math.round(this.pxW / 3) || 1;
    const h = this.ptH || Math.round(this.pxH / 3) || 1;
    const cl = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v * max)));
    return { x: cl(Number(xN) || 0, w), y: cl(Number(yN) || 0, h) };
  }

  // idb CLI จะ spawn idb_companion เองโดยหาจาก PATH เท่านั้น
  // ห้ามใช้ --companion-path / env IDB_COMPANION ชี้ตัว binary — สองอันนั้นคือ "address ของ
  // unix socket" ที่ให้ไปต่อกับ companion ที่รันอยู่แล้ว ใส่ path ของ binary ลงไปจะได้
  // "AF_UNIX path too long" → เราเลยใช้ env ของเราเอง IDB_COMPANION_BIN แล้วเสียบ
  // โฟลเดอร์ของมันเข้าหน้า PATH ของ child (พร้อมล้าง IDB_COMPANION ของ idb ออกกันชนกัน)
  _idbEnv() {
    const bin = process.env.IDB_COMPANION_BIN
      || (fs.existsSync(DEFAULT_COMPANION) ? DEFAULT_COMPANION : '');
    if (!bin) return process.env;
    const env = { ...process.env, PATH: `${path.dirname(bin)}:${process.env.PATH || ''}` };
    delete env.IDB_COMPANION;
    return env;
  }

  // ลบเฉพาะ socket ของ udid นี้ + ไฟล์ state ที่ทำให้ idb ดื้อไปต่อ socket เดิม
  // (ห้าม rm -rf /tmp/idb ทั้งก้อน — ในนั้นมี logs และ companion ของ udid อื่นที่คนอื่นอาจใช้อยู่)
  _clearIdbState() {
    for (const f of [`/tmp/idb/${this.udid}_companion.sock`, '/tmp/idb/state']) {
      try { fs.rmSync(f, { force: true }); } catch {}
    }
  }

  async _idbRun(args, timeout = 15000, retried = false) {
    if (!this.idb) return false;
    try {
      await execFileP(this.idb, [...args, '--udid', this.udid], { timeout, env: this._idbEnv() });
      return true;
    } catch (e) {
      const msg = (e && e.message) || '';
      // companion ตายแต่ socket/state ยังค้างใน /tmp/idb → idb จะพยายามต่อ socket เดิมแล้วพังทุกครั้ง
      // (ไม่ยอม spawn ตัวใหม่เอง) ล้าง state ทิ้งแล้วลองอีกครั้ง = กลับมาใช้ได้เลย
      if (!retried && /Failed to connect to companion|Connection refused|No such file or directory/i.test(msg)) {
        this._clearIdbState();
        return this._idbRun(args, timeout, true);
      }
      this.onError('idb: ' + (msg ? msg.split('\n')[0] : 'สั่งงานไม่สำเร็จ'));
      return false;
    }
  }

  async tap(xN, yN) {
    this._wake();
    await this.ptReady;
    const p = this._pt(xN, yN);
    return this._idbRun(['ui', 'tap', String(p.x), String(p.y)]);
  }

  // ลาก/ปัด — idb ทำเป็นคำสั่งเดียว (ไม่มี down/move/up แยก) จึงต้องรอ pointerup แล้วค่อยส่ง
  async swipe(x1N, y1N, x2N, y2N, durationSec) {
    this._wake();
    await this.ptReady;
    const a = this._pt(x1N, y1N);
    const b = this._pt(x2N, y2N);
    const args = ['ui', 'swipe', String(a.x), String(a.y), String(b.x), String(b.y)];
    if (durationSec > 0) args.push('--duration', String(Math.min(3, durationSec).toFixed(2)));
    return this._idbRun(args);
  }

  async text(s) {
    this._wake();
    const t = String(s || '');
    if (!t) return false;
    return this._idbRun(['ui', 'text', t]);
  }

  // HOME / LOCK / SIRI / APPLE_PAY
  async button(name) {
    this._wake();
    return this._idbRun(['ui', 'button', String(name || 'HOME').toUpperCase()]);
  }
}

module.exports = { IosMirrorSession, idbPath, simctlPath, jpegSize };
