const express = require('express');
const multer = require('multer');
const busboy = require('busboy');
const { Readable } = require('stream');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const exifr = require('exifr');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { startProxy } = require('./proxy');

const execFileP = promisify(execFile);
const ADB = process.env.ADB || 'adb';
const MITM_PORT = 8888;
const POSTERN_PKG = 'com.thaivivat.proxy.postern';

// safety net: อย่าให้ error ลอยๆ (เช่น spawn ล้ม) ทำให้เว็บล่มทั้ง process — log ไว้แล้วรันต่อ
process.on('uncaughtException', (e) => console.error('uncaughtException (ไม่ล้ม server):', e.message));
process.on('unhandledRejection', (e) => console.error('unhandledRejection (ไม่ล้ม server):', e && e.message ? e.message : e));

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_PORT = process.env.PROXY_PORT || 9099;
const CA_DIR = path.join(__dirname, '.proxy-ca');
const MAP_LOCAL_FILE = path.join(__dirname, 'map-local.json');

// ================= In-memory store =================
const MAX_REQUESTS = 200;
const requests = [];            // captured request entries (newest first)
const fileBuffers = new Map();  // entryId -> [{ buffer, mimetype, originalname }]
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

// เก็บ flow ที่ proxy ดักได้ (แยกจาก hook requests)
const proxyStore = { flows: [] };
const proxyImages = new Map(); // "<flowId>:<req|res>" หรือ "<flowId>:reqpart<idx>" -> { buf, ct }
const proxyRawReqBodies = new Map(); // "<flowId>" -> { buf, ct } — raw body ของ multipart ไว้ยิงซ้ำ (repeat) แบบ byte-exact

const MAX_PART = 25 * 1024 * 1024; // เก็บ bytes ของ file part สูงสุด/อัน 25MB (ไว้ดู/ดาวน์โหลด/preview)

// เดา mime จาก magic bytes — เผื่อ client ส่ง content-type เป็น octet-stream แต่จริงเป็นรูป/pdf
function sniffMime(b) {
  if (!b || b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp' && ['heic', 'heix', 'mif1', 'hevc', 'msf1'].includes(b.toString('ascii', 8, 12))) return 'image/heic';
  if (b.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

// แกะ multipart/form-data จาก Buffer ด้วย busboy → parts (field/file) + bytes ของทุก file (ไว้ดู/ดาวน์โหลด/preview)
function parseMultipart(buf, contentType) {
  return new Promise((resolve) => {
    const parts = [];
    const fileBufs = []; // { idx, buf, ct }
    let bb;
    try { bb = busboy({ headers: { 'content-type': contentType }, limits: { files: 50, fields: 200 } }); }
    catch { return resolve({ parts: [], fileBufs: [] }); }
    bb.on('file', (name, stream, info) => {
      // จอง slot ทันที (busboy ยิง 'file' หลายอันก่อน stream จะ end → parts.length ตอน end ไม่เสถียร/ชนกัน)
      const idx = parts.length;
      const part = { kind: 'file', name, filename: info.filename || null, contentType: info.mimeType || 'application/octet-stream', size: 0, isImage: false, isPdf: false, stored: false };
      parts.push(part);
      const chunks = [];
      stream.on('data', (d) => chunks.push(d));
      stream.on('limit', () => {}); // เกิน limit ก็ตัด — ไม่ throw
      stream.on('end', () => {
        const fbuf = Buffer.concat(chunks);
        const declared = info.mimeType || 'application/octet-stream';
        const fn = info.filename || '';
        const sniffed = sniffMime(fbuf);
        // ถ้า declared เป็น octet-stream แต่ magic bytes บอกชนิดจริง → ใช้ชนิดจริง (จะได้ preview/เปิดดูได้)
        const ct = (declared === 'application/octet-stream' && sniffed) ? sniffed : declared;
        part.contentType = ct;
        part.size = fbuf.length;
        part.isImage = /^image\//i.test(ct) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(fn);
        part.isPdf = ct === 'application/pdf' || /\.pdf$/i.test(fn);
        part.stored = fbuf.length <= MAX_PART;
        if (part.stored) fileBufs.push({ idx, buf: fbuf, ct }); // เก็บทุกไฟล์ ไม่ใช่แค่รูป → ดู/ดาวน์โหลดได้ทุกชนิด
      });
    });
    bb.on('field', (name, val) => {
      const s = String(val);
      parts.push({ kind: 'field', name, size: Buffer.byteLength(s), value: s.length > 4000 ? s.slice(0, 4000) + '…(ตัด)' : s });
    });
    bb.on('close', () => resolve({ parts, fileBufs }));
    bb.on('error', () => resolve({ parts, fileBufs }));
    Readable.from(buf).pipe(bb);
  });
}
let proxyCaPath = null;
// mute แบบหมดอายุเอง: เก็บ "เวลาที่ mute จะหมด" แทน boolean ค้าง
// - disconnect → mute สั้นๆ กลืน straggler จากแอปที่ยัง cache proxy แล้ว "ปลดเอง" อัตโนมัติ
// - เดิมเป็น boolean ค้าง true ตลอด → ตั้ง proxy เองบนมือถือ/เสียบสายใหม่โดยไม่กด connect ที่เว็บ
//   จะทำให้ server ทิ้งทุก flow เงียบๆ (ดูเหมือน "เชื่อมไม่ได้") — timebox แก้ตรงนี้
// disconnect → mute "ค้าง" จนกว่าจะ connect ใหม่/สั่งปลด/รีสตาร์ท server (ผู้ใช้ต้องการ "ตัดแล้วเงียบ")
// กัน bug เดิม (ทิ้ง flow เงียบๆ จนงง): นับจำนวน flow ที่ถูกทิ้งตอน mute แล้วโชว์ใน status ให้เห็น + มีปุ่มปลด
let muteUntil = 0;             // flow จะถูกทิ้งเมื่อ Date.now() < muteUntil (Infinity = ค้างจนสั่งปลด)
let mutedDropCount = 0;        // จำนวน flow ที่ถูกทิ้งระหว่าง mute (โชว์ให้ผู้ใช้เห็น ไม่ให้เงียบ)
const isMuted = () => Date.now() < muteUntil;
const unmute = () => { muteUntil = 0; mutedDropCount = 0; }; // เปิดรับ flow + รีเซ็ตตัวนับ

// ================= Map Local (mock rules) =================
let mapRules = [];
try {
  if (fs.existsSync(MAP_LOCAL_FILE)) mapRules = JSON.parse(fs.readFileSync(MAP_LOCAL_FILE, 'utf8'));
} catch (err) {
  console.error('โหลด map-local.json ไม่ได้:', err.message);
}
function saveMapRules() {
  try {
    fs.writeFileSync(MAP_LOCAL_FILE, JSON.stringify(mapRules, null, 2));
  } catch (err) {
    console.error('บันทึก map-local.json ไม่ได้:', err.message);
  }
}

// แปลง pattern -> ตัวเช็ค: มี * = wildcard (.*), ไม่มี * = ตรวจแบบ "มีคำนี้อยู่" (contains)
function patternMatches(pattern, url) {
  if (!pattern) return false;
  if (pattern.includes('*')) {
    const re = new RegExp(pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'));
    return re.test(url);
  }
  return url.includes(pattern);
}

// หา rule ที่ตรง (เจาะจง/ไม่มี * มาก่อน แล้ว pattern ยาวกว่าชนะ)
function findMapRule(method, url) {
  const matched = mapRules.filter((r) =>
    r.enabled !== false &&
    (!r.method || r.method === 'ANY' || r.method === method) &&
    patternMatches(r.urlPattern, url));
  if (!matched.length) return null;
  matched.sort((a, b) =>
    (a.urlPattern.includes('*') - b.urlPattern.includes('*')) ||
    (b.urlPattern.length - a.urlPattern.length));
  return matched[0];
}

// overrides = [{path, value, enabled}] — แก้เฉพาะบาง key ใน JSON body
function normalizeOverrides(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((o) => ({ path: String((o && o.path) || ''), value: (o && o.value != null) ? String(o.value) : '', enabled: !(o && o.enabled === false) }))
    .filter((o) => o.path);
}
// path รองรับ dot + [index] เช่น a.b[0].c
function parsePathSegs(path) {
  const segs = [];
  for (const part of String(path).split('.')) {
    const m = part.match(/^([^[]*)((?:\[\d+\])*)$/);
    if (!m) continue;
    if (m[1]) segs.push(m[1]);
    for (const idx of (m[2].match(/\d+/g) || [])) segs.push(Number(idx));
  }
  return segs;
}
// ทับค่าเฉพาะ key ที่ระบุลงบน JSON body (value ลองพาร์สเป็น JSON ก่อน ไม่ได้ = string) — body ไม่ใช่ JSON คืนเดิม
function applyOverrides(bodyStr, overrides) {
  if (!Array.isArray(overrides) || !overrides.length) return bodyStr;
  let obj;
  try { obj = JSON.parse(bodyStr); } catch { return bodyStr; }
  for (const ov of overrides) {
    if (!ov || ov.enabled === false || !ov.path) continue;
    let val = ov.value;
    try { val = JSON.parse(ov.value); } catch { /* เก็บเป็น string */ }
    const segs = parsePathSegs(ov.path);
    if (!segs.length) continue;
    let cur = obj;
    let ok = true;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i], next = segs[i + 1];
      if (cur == null || typeof cur !== 'object') { ok = false; break; }
      // สร้าง path ที่ยังไม่มี: segment ถัดไปเป็นตัวเลข → array, ไม่งั้น → object
      if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = (typeof next === 'number') ? [] : {};
      if (Array.isArray(cur[seg]) && typeof next === 'number') { while (cur[seg].length <= next) cur[seg].push(null); }
      cur = cur[seg];
    }
    if (ok && cur != null && typeof cur === 'object') {
      const lastKey = segs[segs.length - 1];
      if (Array.isArray(cur) && typeof lastKey === 'number') { while (cur.length <= lastKey) cur.push(null); }
      cur[lastKey] = val;
    }
  }
  try { return JSON.stringify(obj); } catch { return bodyStr; }
}

app.get('/api/maplocal', (req, res) => res.json(mapRules));

app.post('/api/maplocal', express.json({ limit: '5mb' }), (req, res) => {
  const b = req.body || {};
  const rule = {
    id: crypto.randomUUID(),
    enabled: b.enabled !== false,
    name: b.name || '',
    method: b.method || 'ANY',
    urlPattern: b.urlPattern || '',
    status: Number(b.status) || 200,
    contentType: b.contentType || 'application/json',
    body: b.body != null ? String(b.body) : '',
    scenario: b.scenario || '', // แท็กจัดกลุ่มเป็นชุด (scenario) — ว่าง = ไม่อยู่ชุดไหน
    mode: b.mode === 'passthrough' ? 'passthrough' : 'mock', // mock=ตอบ body ที่เก็บ / passthrough=ยิงจริงแล้วแก้เฉพาะ key
    overrides: normalizeOverrides(b.overrides),               // แก้เฉพาะบาง key: [{path,value,enabled}]
  };
  mapRules.unshift(rule);
  saveMapRules();
  res.json({ ok: true, rule });
});

app.put('/api/maplocal/:id', express.json({ limit: '5mb' }), (req, res) => {
  const rule = mapRules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: 'ไม่พบ rule' });
  const b = req.body || {};
  for (const k of ['enabled', 'name', 'method', 'urlPattern', 'contentType', 'body', 'scenario']) {
    if (b[k] !== undefined) rule[k] = k === 'body' ? String(b[k]) : b[k];
  }
  if (b.status !== undefined) rule.status = Number(b.status) || 200;
  if (b.mode !== undefined) rule.mode = b.mode === 'passthrough' ? 'passthrough' : 'mock';
  if (b.overrides !== undefined) rule.overrides = normalizeOverrides(b.overrides);
  saveMapRules();
  res.json({ ok: true, rule });
});

app.delete('/api/maplocal/:id', (req, res) => {
  const before = mapRules.length;
  mapRules = mapRules.filter((r) => r.id !== req.params.id);
  saveMapRules();
  res.json({ ok: true, removed: before - mapRules.length });
});

// ---- Scenario: จัดกลุ่ม mock เป็นชุด แล้วเปิด/ปิดทั้งชุด ----
app.get('/api/maplocal/scenarios', (req, res) => {
  const map = new Map();
  for (const r of mapRules) {
    if (!r.scenario) continue;
    const s = map.get(r.scenario) || { name: r.scenario, total: 0, enabled: 0 };
    s.total += 1;
    if (r.enabled) s.enabled += 1;
    map.set(r.scenario, s);
  }
  // active = ทุก rule ในชุดถูกเปิด
  const scenarios = [...map.values()].map((s) => ({ ...s, active: s.total > 0 && s.enabled === s.total }));
  res.json({ ok: true, scenarios });
});

// เปิดชุดนี้ (enable rule ในชุด) + option exclusive = ปิด rule ของชุดอื่นด้วย
app.post('/api/maplocal/scenarios/:name/activate', express.json(), (req, res) => {
  const name = req.params.name;
  const exclusive = (req.body || {}).exclusive === true;
  let changed = 0;
  for (const r of mapRules) {
    if (r.scenario === name) { if (!r.enabled) { r.enabled = true; changed++; } }
    else if (exclusive && r.scenario && r.enabled) { r.enabled = false; changed++; }
  }
  saveMapRules();
  res.json({ ok: true, scenario: name, exclusive, changed });
});

app.post('/api/maplocal/scenarios/:name/deactivate', (req, res) => {
  const name = req.params.name;
  let changed = 0;
  for (const r of mapRules) {
    if (r.scenario === name && r.enabled) { r.enabled = false; changed++; }
  }
  saveMapRules();
  res.json({ ok: true, scenario: name, changed });
});

// ================= Dynamic Test Cases (sequenced Map Local) =================
// ดูสเปค: docs/dynamic-test-cases-design.md
const TESTCASES_FILE = path.join(__dirname, 'test-cases.json');
let testCases = [];
try {
  if (fs.existsSync(TESTCASES_FILE)) testCases = JSON.parse(fs.readFileSync(TESTCASES_FILE, 'utf8'));
} catch (err) { console.error('โหลด test-cases.json ไม่ได้:', err.message); }
function saveTestCases() {
  try { fs.writeFileSync(TESTCASES_FILE, JSON.stringify(testCases, null, 2)); }
  catch (err) { console.error('บันทึก test-cases.json ไม่ได้:', err.message); }
}

// เคสแบบไฟล์: โฟลเดอร์ test-cases/<name>/case.json + ไฟล์ response แยกตามเคส (อ่าน read-only)
const TESTCASES_DIR = path.join(__dirname, 'test-cases');
let fileCases = [];
function readCaseFile(caseDir, rel) {
  const p = path.resolve(caseDir, rel);
  if (p !== path.resolve(caseDir) && !p.startsWith(path.resolve(caseDir) + path.sep)) {
    throw new Error('path นอกโฟลเดอร์เคส: ' + rel); // กัน path traversal
  }
  return fs.readFileSync(p, 'utf8');
}
function loadFileCases() {
  fileCases = [];
  let dirs = [];
  try {
    if (fs.existsSync(TESTCASES_DIR)) {
      dirs = fs.readdirSync(TESTCASES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    }
  } catch (e) { console.error('อ่าน test-cases/ ไม่ได้:', e.message); return; }
  for (const name of dirs) {
    const caseDir = path.join(TESTCASES_DIR, name);
    const manifestPath = path.join(caseDir, 'case.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      fileCases.push({
        id: 'file:' + name,
        source: 'file',
        dir: name,
        name: m.name || name,
        autoAdvance: m.autoAdvance !== false,
        endpoints: (Array.isArray(m.endpoints) ? m.endpoints : []).map((ep) => ({
          method: ep.method || 'ANY',
          urlPattern: ep.urlPattern || '',
          steps: (Array.isArray(ep.steps) ? ep.steps : []).map((s) => {
            let body = s.body != null ? String(s.body) : '';
            let ct = s.contentType;
            if (s.file) {
              body = readCaseFile(caseDir, s.file);
              if (!ct) ct = s.file.endsWith('.json') ? 'application/json' : 'text/plain';
            }
            return { label: s.label || s.file || '', status: Number(s.status) || 200, contentType: ct || 'application/json', body };
          }),
        })),
      });
    } catch (e) { console.error(`โหลดเคสไฟล์ ${name} ไม่ได้:`, e.message); }
  }
}
loadFileCases();

let activeCaseId = null;
let caseCursors = {}; // "<METHOD> <urlPattern>" -> index (state ของ case ที่ active, in-memory)
let caseHits = {};    // "<METHOD> <urlPattern>" -> จำนวนครั้งที่ step ปัจจุบันถูกเรียกแล้ว (สำหรับ times)
const cursorKey = (ep) => `${ep.method || 'ANY'} ${ep.urlPattern}`;
// รวมเคสจากไฟล์ (read-only) + เคส inline (store) เข้าด้วยกัน
const allCases = () => [...fileCases, ...testCases.map((c) => ({ ...c, source: 'store' }))];
const activeCase = () => allCases().find((c) => c.id === activeCaseId) || null;

function normalizeCase(b) {
  return {
    id: b.id || crypto.randomUUID(),
    name: b.name || '',
    autoAdvance: b.autoAdvance !== false, // default true
    loop: b.loop === true,                // จบ step สุดท้ายแล้ววนกลับ step 1 (default off)
    endpoints: Array.isArray(b.endpoints) ? b.endpoints.map((ep) => ({
      method: ep.method || 'ANY',
      urlPattern: ep.urlPattern || '',
      steps: Array.isArray(ep.steps) ? ep.steps.map((s) => ({
        label: s.label || '',
        status: Number(s.status) || 200,
        contentType: s.contentType || 'application/json',
        body: s.body != null ? String(s.body) : '',
        enabled: s.enabled !== false,               // ปิด step ได้โดยไม่ต้องลบ (ถูกข้ามใน sequence)
        mode: s.mode === 'passthrough' ? 'passthrough' : 'mock', // mock=ตอบ body / passthrough=ยิงจริงแล้ว override
        times: Math.max(1, Number(s.times) || 1),   // ต้องเรียก step นี้กี่ครั้งก่อนเลื่อนไป step ถัดไป (default 1)
        overrides: normalizeOverrides(s.overrides), // แก้เฉพาะบาง key (mock ทับ body / passthrough ทับ response จริง)
      })) : [],
    })) : [],
  };
}
function caseWithState(c) {
  const cursors = {}; const hits = {};
  if (c.id === activeCaseId) for (const ep of c.endpoints) { const k = cursorKey(ep); cursors[k] = caseCursors[k] || 0; hits[k] = caseHits[k] || 0; }
  return { ...c, source: c.source || 'store', active: c.id === activeCaseId, cursors, hits };
}
// เลือก endpoint ใน case ที่ตรง request (เจาะจง/ยาวกว่าชนะ เหมือน findMapRule)
function matchEndpoint(c, method, url) {
  const cands = (c.endpoints || []).filter((ep) => ep.steps.length &&
    (!ep.method || ep.method === 'ANY' || ep.method === method) &&
    patternMatches(ep.urlPattern, url || ''));
  cands.sort((a, b) => (a.urlPattern.includes('*') - b.urlPattern.includes('*')) || (b.urlPattern.length - a.urlPattern.length));
  return cands[0] || null;
}

app.get('/api/testcases', (req, res) => res.json({ ok: true, activeCaseId, cases: allCases().map(caseWithState) }));

// reload เคสแบบไฟล์จากดิสก์ (test-cases/<name>/case.json)
app.post('/api/testcases/reload', (req, res) => {
  loadFileCases();
  res.json({ ok: true, fileCases: fileCases.length });
});

app.post('/api/testcases', express.json({ limit: '10mb' }), (req, res) => {
  const c = normalizeCase(req.body || {});
  testCases.unshift(c); saveTestCases();
  res.json({ ok: true, case: caseWithState(c) });
});

app.put('/api/testcases/:id', express.json({ limit: '10mb' }), (req, res) => {
  if (req.params.id.startsWith('file:')) return res.status(400).json({ ok: false, error: 'เคสแบบไฟล์ แก้ที่ test-cases/<dir> แล้วกด reload' });
  const idx = testCases.findIndex((c) => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ ok: false, error: 'ไม่พบ test case' });
  testCases[idx] = normalizeCase({ ...req.body, id: req.params.id });
  saveTestCases();
  // ไม่ reset cursor ตอนบันทึก — คง current step เดิมไว้ (resolve/next clamp ให้อยู่ในช่วงอยู่แล้ว)
  res.json({ ok: true, case: caseWithState(testCases[idx]) });
});

app.delete('/api/testcases/:id', (req, res) => {
  if (req.params.id.startsWith('file:')) return res.status(400).json({ ok: false, error: 'เคสแบบไฟล์ ลบที่โฟลเดอร์ test-cases/<dir> เอง' });
  testCases = testCases.filter((c) => c.id !== req.params.id);
  if (activeCaseId === req.params.id) { activeCaseId = null; caseCursors = {}; caseHits = {}; }
  saveTestCases();
  res.json({ ok: true });
});

app.post('/api/testcases/:id/activate', express.json(), (req, res) => {
  const c = allCases().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: 'ไม่พบ test case' });
  activeCaseId = c.id; // exclusive: active ได้ทีละ case
  if ((req.body || {}).resetOnActivate !== false) { caseCursors = {}; caseHits = {}; } // default reset cursor+hits
  unmute();
  res.json({ ok: true, active: caseWithState(c) });
});

app.post('/api/testcases/deactivate', (req, res) => {
  activeCaseId = null; caseCursors = {}; caseHits = {};
  res.json({ ok: true });
});

app.post('/api/testcases/reset', (req, res) => {
  caseCursors = {}; caseHits = {};
  const c = activeCase();
  res.json({ ok: true, activeCaseId, cursors: c ? caseWithState(c).cursors : {} });
});

app.post('/api/testcases/next', express.json(), (req, res) => {
  const c = activeCase();
  if (!c) return res.status(400).json({ ok: false, error: 'ยังไม่มี case ที่ active' });
  const pat = (req.body || {}).pattern;
  for (const ep of c.endpoints) {
    if (pat && ep.urlPattern !== pat) continue;
    const enabledLen = ep.steps.filter((s) => s.enabled !== false).length;
    if (!enabledLen) continue;
    const k = cursorKey(ep);
    // ปุ่ม Next วนเสมอ (นับเฉพาะ step ที่เปิด): ถึงตัวสุดท้ายแล้วกดต่อ → กลับตัวแรก
    caseCursors[k] = ((caseCursors[k] || 0) + 1) % enabledLen;
    caseHits[k] = 0; // เปลี่ยน step → เริ่มนับ times ใหม่
  }
  res.json({ ok: true, cursors: caseWithState(c).cursors });
});

app.post('/api/testcases/goto', express.json(), (req, res) => {
  const c = activeCase();
  if (!c) return res.status(400).json({ ok: false, error: 'ยังไม่มี case ที่ active' });
  const { pattern, index } = req.body || {};
  const ep = c.endpoints.find((e) => e.urlPattern === pattern);
  if (!ep) return res.status(404).json({ ok: false, error: 'ไม่พบ endpoint pattern นี้ใน case' });
  // index = ตำแหน่งใน enabled-sublist (เหมือน cursor)
  const enabledLen = ep.steps.filter((s) => s.enabled !== false).length;
  caseCursors[cursorKey(ep)] = Math.max(0, Math.min(Number(index) || 0, Math.max(0, enabledLen - 1)));
  caseHits[cursorKey(ep)] = 0; // ตั้ง step ปัจจุบันเอง → เริ่มนับ times ใหม่
  res.json({ ok: true, cursors: caseWithState(c).cursors });
});

// addon เรียกต่อ request ที่ match pattern: คืน response ของ step ปัจจุบัน (+ advance ถ้า autoAdvance)
app.post('/api/testcase/resolve', express.json({ limit: '2mb' }), (req, res) => {
  const c = activeCase();
  if (!c) return res.json({ matched: false });
  const { method, url } = req.body || {};
  const ep = matchEndpoint(c, method, url);
  if (!ep) return res.json({ matched: false });
  const k = cursorKey(ep);
  const enabled = ep.steps.filter((s) => s.enabled !== false); // ข้าม step ที่ถูกปิด
  if (!enabled.length) return res.json({ matched: false });     // ทุก step ปิด → ไม่ mock (ปล่อยไป server จริง)
  const i = Math.min(caseCursors[k] || 0, enabled.length - 1);
  const step = enabled[i];
  if (c.autoAdvance !== false) {
    // นับครั้งที่ step นี้ถูกเรียก — ครบ times แล้วค่อยเลื่อนไป step ถัดไป (รีเซ็ตตัวนับ)
    const hits = (caseHits[k] || 0) + 1;
    const times = Math.max(1, Number(step.times) || 1);
    if (hits >= times) {
      const nx = i + 1;
      caseCursors[k] = c.loop ? nx % enabled.length : Math.min(nx, enabled.length - 1);
      caseHits[k] = 0;
    } else {
      caseHits[k] = hits; // ยังไม่ครบ times → อยู่ step เดิม
    }
  }
  const fullIdx = ep.steps.indexOf(step); // index จริงใน list เต็ม (ให้ frontend ไฮไลต์/เลื่อนถูกช่อง)
  const base = { matched: true, step: fullIdx, label: step.label, pattern: ep.urlPattern, caseId: c.id, caseName: c.name };
  if (step.mode === 'passthrough') { // ปล่อยไป server จริง แล้ว override ใน addon response()
    return res.json({ ...base, mode: 'passthrough', overrides: step.overrides || [] });
  }
  const body = applyOverrides(step.body, step.overrides); // mock: ทับเฉพาะ key ที่ตั้ง override ไว้
  res.json({ ...base, mode: 'mock', status: step.status, contentType: step.contentType, body });
});

// รายการ pattern ของ case active — ให้ addon cache ไว้ตัดสินใจว่าจะเรียก resolve ไหม
app.get('/api/testcase/patterns', (req, res) => {
  const c = activeCase();
  res.json({ active: !!c, patterns: c ? c.endpoints.filter((e) => e.steps.length).map((e) => ({ method: e.method, urlPattern: e.urlPattern })) : [] });
});

function addEntry(entry, files) {
  requests.unshift(entry);
  if (files && files.length) fileBuffers.set(entry.id, files);
  while (requests.length > MAX_REQUESTS) {
    const removed = requests.pop();
    fileBuffers.delete(removed.id);
  }
  broadcast('request', entry);
}

// ================= Middleware =================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
});

// ปิด cache ของไฟล์ static เพื่อให้ browser โหลดโค้ดใหม่เสมอ (กันปัญหา app.js ค้าง cache)
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));
app.get('/vendor/exifr.js', (req, res) => {
  res.sendFile(require.resolve('exifr/dist/full.umd.js'));
});

// ================= Hook endpoint (รับข้อมูลเข้ามาแสดง) =================
const hookParsers = [
  upload.any(),
  express.json({ limit: '10mb' }),
  express.urlencoded({ extended: true, limit: '10mb' }),
  express.text({ type: ['text/*', 'application/xml'], limit: '10mb' }),
  express.raw({
    // multer อ่าน stream ของ multipart ไปแล้ว ห้ามอ่านซ้ำ
    type: (req) => !(req.headers['content-type'] || '').includes('multipart/form-data'),
    limit: '25mb',
  }),
];

function serializeBody(req) {
  if (req.body === undefined || req.body === null) return null;
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length === 0) return null;
    const text = req.body.toString('utf8');
    // ถ้าแปลงเป็นข้อความอ่านได้ ให้แสดงเป็นข้อความ ไม่งั้นบอกว่าเป็น binary
    if (!text.includes('�')) return text;
    return `(binary ${req.body.length} bytes)`;
  }
  if (typeof req.body === 'object' && Object.keys(req.body).length === 0 && !(req.files || []).length) {
    return null;
  }
  return req.body;
}

app.all(/^\/hook(\/.*)?$/, hookParsers, (req, res) => {
  const id = crypto.randomUUID();
  const files = (req.files || []).map((f, i) => ({
    index: i,
    field: f.fieldname,
    name: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
  }));
  const entry = {
    id,
    time: new Date().toISOString(),
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    contentType: req.headers['content-type'] || null,
    headers: req.headers,
    query: req.query,
    body: serializeBody(req),
    files,
  };
  addEntry(entry, (req.files || []).map((f) => ({
    buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname,
  })));
  res.json({ ok: true, id, receivedAt: entry.time });
});

// ================= อ่าน metadata ของรูป (ใช้ร่วมกันหลาย endpoint) =================
// reverse geocode พิกัด -> ที่อยู่ ผ่าน OpenStreetMap Nominatim (ต้องต่ออินเทอร์เน็ต + ส่ง User-Agent)
async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=th`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'ApiTester/1.0 (local testing tool)' },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Nominatim ตอบกลับ ${resp.status}`);
  const data = await resp.json();
  return data.display_name || null;
}

// อ่าน EXIF จาก buffer แล้วคืนเฉพาะข้อมูลสำคัญ (ถ้า withAddress=true จะ reverse geocode หาที่อยู่ให้ด้วย)
async function extractImageMetadata(buffer, { withAddress = false } = {}) {
  const meta = await exifr.parse(buffer, { gps: true, exif: true, tiff: true });
  if (!meta) return null;
  const result = {
    dateTaken: meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate || null,
    latitude: meta.latitude ?? null,
    longitude: meta.longitude ?? null,
    address: null,
    camera: [meta.Make, meta.Model].filter(Boolean).join(' ') || null,
    width: meta.ExifImageWidth || meta.ImageWidth || null,
    height: meta.ExifImageHeight || meta.ImageHeight || null,
    imageDescription: meta.ImageDescription || null,
  };
  if (withAddress && result.latitude != null && result.longitude != null) {
    try {
      result.address = await reverseGeocode(result.latitude, result.longitude);
    } catch (err) {
      result.addressError = err.message;
    }
  }
  return result;
}

// ================= API สำหรับหน้าเว็บ =================
app.get('/api/requests', (req, res) => {
  res.json(requests);
});

app.delete('/api/requests', (req, res) => {
  requests.length = 0;
  fileBuffers.clear();
  broadcast('clear', {});
  res.json({ ok: true });
});

app.get('/api/requests/:id/files/:index', async (req, res) => {
  const files = fileBuffers.get(req.params.id);
  const file = files && files[Number(req.params.index)];
  if (!file) return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalname)}"`);

  // แนบ lat/lng/address มากับตัวภาพเลย ผ่าน response headers (มือถืออ่านได้ในรีเควสต์เดียว)
  // ค่าที่เป็นภาษาไทย/ข้อความ ต้อง URL-encode เพราะ HTTP header รองรับแค่ ASCII
  if (file.mimetype && file.mimetype.startsWith('image/')) {
    try {
      const meta = await extractImageMetadata(file.buffer, { withAddress: req.query.address === '1' });
      if (meta) {
        res.setHeader('Access-Control-Expose-Headers', 'X-Image-Latitude, X-Image-Longitude, X-Image-Address, X-Image-Date, X-Image-Camera');
        if (meta.latitude != null) res.setHeader('X-Image-Latitude', String(meta.latitude));
        if (meta.longitude != null) res.setHeader('X-Image-Longitude', String(meta.longitude));
        if (meta.dateTaken) res.setHeader('X-Image-Date', new Date(meta.dateTaken).toISOString());
        if (meta.camera) res.setHeader('X-Image-Camera', encodeURIComponent(meta.camera));
        if (meta.address) res.setHeader('X-Image-Address', encodeURIComponent(meta.address));
      }
    } catch { /* อ่าน metadata ไม่ได้ ก็ส่งแค่รูป */ }
  }
  res.send(file.buffer);
});

// อ่าน metadata (lat/lng/address/วันที่/กล้อง) ของไฟล์รูปที่รับไว้ เป็น JSON
// ?address=0 เพื่อข้ามการหาที่อยู่ (เร็วขึ้น ไม่ต้องต่อเน็ต)
app.get('/api/requests/:id/files/:index/metadata', async (req, res) => {
  const files = fileBuffers.get(req.params.id);
  const file = files && files[Number(req.params.index)];
  if (!file) return res.status(404).json({ ok: false, error: 'file not found' });
  if (!file.mimetype || !file.mimetype.startsWith('image/')) {
    return res.status(400).json({ ok: false, error: 'ไฟล์นี้ไม่ใช่รูปภาพ' });
  }
  const withAddress = req.query.address !== '0';
  try {
    const metadata = await extractImageMetadata(file.buffer, { withAddress });
    if (!metadata) return res.json({ ok: true, name: file.originalname, metadata: null, note: 'รูปนี้ไม่มี EXIF metadata ฝังอยู่' });
    res.json({ ok: true, name: file.originalname, mimetype: file.mimetype, size: file.buffer.length, metadata });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// อ่าน metadata ของรูปจาก URL ใดก็ได้ (server ดึงรูปมาแกะให้ เลี่ยงปัญหา CORS ฝั่ง browser)
app.get('/api/url-metadata', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, error: 'กรุณาระบุ ?url=' });
  const withAddress = req.query.address !== '0';
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return res.json({ ok: false, error: `ปลายทางตอบกลับ ${resp.status} ${resp.statusText}` });
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return res.json({ ok: false, error: `URL นี้ไม่ใช่รูปภาพ (Content-Type: ${contentType || 'ไม่ทราบ'})` });
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    let metadata = null;
    try {
      metadata = await extractImageMetadata(buffer, { withAddress });
    } catch { /* รูปไม่มี EXIF */ }
    res.json({ ok: true, contentType, size: buffer.length, metadata });
  } catch (err) {
    res.json({ ok: false, error: err.cause ? `${err.message}: ${err.cause.message || err.cause.code}` : err.message });
  }
});

// ================= Proxy (MITM) API =================
app.get('/api/proxy/flows', (req, res) => {
  res.json(proxyStore.flows);
});

// รับ flow ที่ถอดรหัสจาก mitmproxy (ผ่าน addon) มาแสดงในแท็บ Proxy — รองรับ HTTPS/h2 เต็มรูปแบบ
app.post('/api/proxy/ingest', express.json({ limit: '40mb' }), async (req, res) => {
  if (isMuted()) { mutedDropCount++; return res.json({ ok: true, muted: true, dropped: mutedDropCount }); } // mute อยู่ (หลัง disconnect) — ทิ้ง flow แต่ยังนับให้เห็น
  const b = req.body || {};
  const id = b.id || crypto.randomUUID();
  const flow = {
    id,
    time: b.time || new Date().toISOString(),
    scheme: b.scheme || 'https',
    device: b.device || 'mitmproxy',
    userAgent: b.userAgent || null,
    method: b.method || 'GET',
    host: b.host || '',
    path: b.path || '',
    url: b.url || '',
    reqHeaders: b.reqHeaders || {},
    reqBody: b.reqBody ?? null,
    reqSize: b.reqSize || 0,
    status: b.status ?? null,
    statusText: b.statusText || '',
    resHeaders: b.resHeaders || null,
    resBody: b.resBody ?? null,
    resContentType: b.resContentType || null,
    resSize: b.resSize || 0,
    durationMs: b.durationMs ?? null,
    mapped: b.mapped === true,
    mapLocal: b.mapLocal || null, // ใช้ Map Local rule ไหน — โชว์เป็น tag คลิกไปที่กฎได้
    testCase: b.testCase || null, // ใช้ test case ไหน/step ไหน (ถ้ามี) — โชว์เป็น tag ในแท็บ Proxy
    blocked: false,
  };
  // เก็บ media bytes (req/res) แยกไว้ — image แกะ EXIF, video ไว้ preview
  for (const side of ['req', 'res']) {
    const kind = b[`${side}MediaKind`]; // 'image' | 'video' | undefined
    if (!kind) continue;
    if (kind === 'image') flow[`${side}IsImage`] = true;
    if (kind === 'video') flow[`${side}IsVideo`] = true;
    if (kind === 'pdf') flow[`${side}IsPdf`] = true;
    if (b[`${side}MediaTooBig`]) { flow[`${side}MediaTooBig`] = true; continue; } // ใหญ่เกิน — ติด tag แต่ไม่มี preview
    const b64 = b[`${side}MediaB64`];
    if (!b64) continue;
    try {
      const buf = Buffer.from(b64, 'base64');
      // ใช้ mime ที่ addon sniff มา (กันกรณี S3 ตอบ octet-stream) แล้วค่อย fallback content-type จริง
      const ct = b[`${side}MediaType`] || (side === 'res' ? flow.resContentType : (flow.reqHeaders['content-type'] || 'application/octet-stream'));
      proxyImages.set(`${id}:${side}`, { buf, ct });
      if (kind === 'image') {
        try { flow[`${side}ImageMeta`] = await extractImageMetadata(buf, { withAddress: true }); } catch { flow[`${side}ImageMeta`] = null; }
      }
    } catch { /* ignore bad media */ }
  }
  // raw body ของ multipart — เก็บไว้ยิงซ้ำ (repeat) + แกะ parts ไว้แสดง/preview รูป
  if (b.reqBodyB64) {
    try {
      const rawBuf = Buffer.from(b.reqBodyB64, 'base64');
      const ct = flow.reqHeaders['content-type'] || flow.reqHeaders['Content-Type'] || '';
      proxyRawReqBodies.set(id, { buf: rawBuf, ct });
      if (ct.toLowerCase().includes('multipart/form-data')) {
        const { parts, fileBufs } = await parseMultipart(rawBuf, ct);
        flow.reqMultipart = { parts };
        for (const fb of fileBufs) proxyImages.set(`${id}:reqpart${fb.idx}`, { buf: fb.buf, ct: fb.ct });
        // แกะ EXIF ของ "รูปแรก" (ไม่ใช่ไฟล์แรก) — fileBufs ตอนนี้เก็บทุกไฟล์
        const firstImg = fileBufs.find((fb) => parts[fb.idx] && parts[fb.idx].isImage);
        if (firstImg) { try { flow.reqImageMeta = await extractImageMetadata(firstImg.buf, { withAddress: true }); } catch { /* ignore */ } }
      }
    } catch { /* ignore bad body */ }
  }
  proxyStore.flows.unshift(flow);
  while (proxyStore.flows.length > 300) {
    const removed = proxyStore.flows.pop();
    proxyImages.delete(`${removed.id}:req`);
    proxyImages.delete(`${removed.id}:res`);
    proxyRawReqBodies.delete(removed.id);
    for (const k of proxyImages.keys()) { if (k.startsWith(`${removed.id}:reqpart`)) proxyImages.delete(k); }
  }
  broadcast('proxy', flow);
  res.json({ ok: true, id });
});

// ส่งรูปที่ดักได้ (req/res) ให้หน้าเว็บโชว์
app.get('/api/proxy/flows/:id/image', (req, res) => {
  // side=req|res (media ปกติ) หรือ part=<idx> (ไฟล์รูปใน multipart request)
  let key;
  if (req.query.part != null && /^\d+$/.test(String(req.query.part))) key = `${req.params.id}:reqpart${req.query.part}`;
  else key = `${req.params.id}:${req.query.side === 'req' ? 'req' : 'res'}`;
  const img = proxyImages.get(key);
  if (!img) return res.status(404).json({ error: 'no image' });
  res.setHeader('Content-Type', img.ct || 'application/octet-stream');
  // ?dl=<filename> → บังคับดาวน์โหลด (แนบชื่อไฟล์); ไม่งั้นเปิดดู inline ตาม content-type
  if (req.query.dl) res.setHeader('Content-Disposition', `attachment; filename="${String(req.query.dl).replace(/[^\w.\-]/g, '_')}"`);
  res.send(img.buf);
});

// EXIF metadata ของไฟล์รูปใน multipart request (คำนวณตอนกด — ไม่ถ่วง ingest)
app.get('/api/proxy/flows/:id/partmeta', async (req, res) => {
  if (!/^\d+$/.test(String(req.query.part))) return res.status(400).json({ error: 'ต้องระบุ part' });
  const img = proxyImages.get(`${req.params.id}:reqpart${req.query.part}`);
  if (!img) return res.status(404).json({ error: 'no file' });
  try {
    const meta = await extractImageMetadata(img.buf, { withAddress: true });
    res.json({ ok: true, meta });
  } catch (e) {
    res.json({ ok: true, meta: null, error: e.message });
  }
});

app.delete('/api/proxy/flows', (req, res) => {
  proxyStore.flows.length = 0;
  broadcast('proxy-clear', {});
  res.json({ ok: true });
});

// ยิง request ซ้ำ 1 ครั้ง — คืน flow object. rawBuf = raw bytes (multipart) ส่งตรงแบบ byte-exact
// addToStore=false ใช้ตอน load test (times>1) เพื่อไม่ให้ flow ท่วมลิสต์ (คืนแค่สถิติ)
async function performReplay({ method = 'GET', url, headers = {}, body = null, rawBuf = null, addToStore = true }) {
  const u = new URL(url);
  // ตัด header ที่ทำให้ยิงพัง — ให้ fetch จัดการเอง (host/len/encoding/connection). *คง content-type ไว้* (boundary ของ multipart)
  const DROP = new Set(['host', 'content-length', 'accept-encoding', 'connection']);
  const outHeaders = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k && !DROP.has(k.toLowerCase())) outHeaders[k] = String(v);
  }
  const m = String(method).toUpperCase();
  const noBodyMethod = (m === 'GET' || m === 'HEAD');
  const hasRaw = !!rawBuf && rawBuf.length > 0 && !noBodyMethod; // multipart/binary → ส่ง Buffer ตรงๆ
  const hasText = !hasRaw && body != null && body !== '' && !noBodyMethod;
  const ct = outHeaders['content-type'] || outHeaders['Content-Type'] || '';
  const isMultipart = ct.toLowerCase().includes('multipart/form-data');
  const id = crypto.randomUUID();
  const started = Date.now();
  const flow = {
    id,
    time: new Date().toISOString(),
    scheme: u.protocol.replace(':', ''),
    device: 'replay',
    userAgent: outHeaders['user-agent'] || outHeaders['User-Agent'] || null,
    method: m,
    host: u.host,
    path: u.pathname + u.search,
    url,
    reqHeaders: outHeaders,
    reqBody: hasRaw ? `(binary ${rawBuf.length} bytes${isMultipart ? ', multipart/form-data' : ''})` : (hasText ? String(body) : null),
    reqSize: hasRaw ? rawBuf.length : (hasText ? Buffer.byteLength(String(body)) : 0),
    status: null, statusText: '',
    resHeaders: null, resBody: null, resContentType: null, resSize: 0,
    durationMs: null, mapped: false, blocked: false, replay: true,
  };
  // เก็บ raw + แกะ parts ไว้แสดง/preview รูป (เฉพาะตอนจะเก็บลงลิสต์)
  if (hasRaw && addToStore) {
    proxyRawReqBodies.set(id, { buf: rawBuf, ct });
    if (isMultipart) {
      const { parts, fileBufs } = await parseMultipart(rawBuf, ct);
      flow.reqMultipart = { parts };
      for (const fb of fileBufs) proxyImages.set(`${id}:reqpart${fb.idx}`, { buf: fb.buf, ct: fb.ct });
    }
  }
  const finalize = () => {
    if (addToStore) {
      proxyStore.flows.unshift(flow);
      while (proxyStore.flows.length > 300) {
        const removed = proxyStore.flows.pop();
        proxyImages.delete(`${removed.id}:req`); proxyImages.delete(`${removed.id}:res`);
        proxyRawReqBodies.delete(removed.id);
        for (const k of proxyImages.keys()) { if (k.startsWith(`${removed.id}:reqpart`)) proxyImages.delete(k); }
      }
      broadcast('proxy', flow);
    }
    return flow;
  };

  // repeat ให้เคารพ Map Local / Test Case เหมือน proxy จริง (priority: Map Local ก่อน)
  let tcPassthroughOverrides = null;
  const mlRule = findMapRule(m, url);
  if (mlRule) {
    flow.mapped = true;
    flow.mapLocal = { ruleId: mlRule.id, name: mlRule.name, mode: mlRule.mode || 'mock' };
    if (mlRule.mode !== 'passthrough') {
      flow.status = Number(mlRule.status) || 200; flow.statusText = 'OK';
      flow.resContentType = mlRule.contentType || 'application/json';
      flow.resHeaders = { 'content-type': flow.resContentType, 'x-api-tester': 'map-local' };
      flow.resBody = mlRule.body || '';
      flow.resSize = Buffer.byteLength(flow.resBody);
      flow.durationMs = Date.now() - started;
      return finalize();
    }
  } else {
    const tc = activeCase();
    const ep = tc && matchEndpoint(tc, m, url);
    if (ep) {
      const enabledSteps = ep.steps.filter((s) => s.enabled !== false);
      if (enabledSteps.length) {
        const cur = Math.min(caseCursors[cursorKey(ep)] || 0, enabledSteps.length - 1);
        const step = enabledSteps[cur];
        flow.testCase = { caseId: tc.id, caseName: tc.name, step: ep.steps.indexOf(step), label: step.label, pattern: ep.urlPattern };
        if (step.mode === 'passthrough') {
          tcPassthroughOverrides = step.overrides || [];
        } else {
          flow.status = Number(step.status) || 200; flow.statusText = 'OK';
          flow.resContentType = step.contentType || 'application/json';
          flow.resHeaders = { 'content-type': flow.resContentType, 'x-api-tester': 'test-case' };
          flow.resBody = applyOverrides(step.body, step.overrides);
          flow.resSize = Buffer.byteLength(flow.resBody);
          flow.durationMs = Date.now() - started;
          return finalize();
        }
      }
    }
  }

  try {
    const r = await fetch(url, { method: m, headers: outHeaders, body: hasRaw ? rawBuf : (hasText ? String(body) : undefined) });
    let text = await r.text();
    const resHeaders = {};
    r.headers.forEach((v, k) => { resHeaders[k] = v; });
    if (mlRule && mlRule.mode === 'passthrough' && (mlRule.overrides || []).length) text = applyOverrides(text, mlRule.overrides);
    if (tcPassthroughOverrides && tcPassthroughOverrides.length) text = applyOverrides(text, tcPassthroughOverrides);
    flow.status = r.status;
    flow.statusText = r.statusText || '';
    flow.resHeaders = resHeaders;
    flow.resBody = text;
    flow.resContentType = resHeaders['content-type'] || null;
    flow.resSize = Buffer.byteLength(text);
    flow.durationMs = Date.now() - started;
  } catch (e) {
    flow.error = e.message;
    flow.durationMs = Date.now() - started;
  }
  return finalize();
}

// resolve raw multipart body จาก bodyB64 (ส่งมาตรงๆ) หรือ fromFlowId (ใช้ที่ server เก็บไว้)
function resolveRawBody(b) {
  if (b.bodyB64) { try { return Buffer.from(b.bodyB64, 'base64'); } catch { return null; } }
  if (b.fromFlowId && proxyRawReqBodies.has(b.fromFlowId)) return proxyRawReqBodies.get(b.fromFlowId).buf;
  return null;
}

// ยิง request ซ้ำจากฝั่ง server (Repeat / Repeat & Edit) — ตรงไป target ไม่ผ่าน mitmproxy
app.post('/api/proxy/replay', express.json({ limit: '40mb' }), async (req, res) => {
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ ok: false, error: 'ต้องระบุ url' });
  try { new URL(b.url); } catch { return res.status(400).json({ ok: false, error: 'url ไม่ถูกต้อง' }); }
  const rawBuf = resolveRawBody(b);
  const flow = await performReplay({ method: b.method, url: b.url, headers: b.headers, body: b.body, rawBuf, addToStore: true });
  res.json({ ok: true, id: flow.id, flow });
});

// ยิงซ้ำหลายครั้งพร้อมกัน (load test) — คืนสถิติรวม ไม่เก็บ flow ทีละอันกันลิสต์ท่วม (ยกเว้น times=1)
app.post('/api/proxy/replay-batch', express.json({ limit: '40mb' }), async (req, res) => {
  const b = req.body || {};
  if (!b.url) return res.status(400).json({ ok: false, error: 'ต้องระบุ url' });
  try { new URL(b.url); } catch { return res.status(400).json({ ok: false, error: 'url ไม่ถูกต้อง' }); }
  const N = Math.max(1, Math.min(500, Number(b.times) || 1)); // cap 500 กันยิงถล่มตัวเอง
  const rawBuf = resolveRawBody(b);
  const started = Date.now();
  const results = await Promise.all(Array.from({ length: N }, () =>
    performReplay({ method: b.method, url: b.url, headers: b.headers, body: b.body, rawBuf, addToStore: N === 1 })
      .catch((e) => ({ error: e.message }))));
  const totalMs = Date.now() - started;
  const statuses = {}; let success = 0, failed = 0; const durs = [];
  for (const f of results) {
    if (!f || f.error) { failed++; continue; }
    statuses[f.status] = (statuses[f.status] || 0) + 1;
    if (f.status >= 200 && f.status < 400) success++; else failed++;
    if (f.durationMs != null) durs.push(f.durationMs);
  }
  durs.sort((a, b2) => a - b2);
  const pick = (p) => durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * p))] : null;
  const timing = durs.length ? {
    min: durs[0], max: durs[durs.length - 1],
    avg: Math.round(durs.reduce((a, c) => a + c, 0) / durs.length),
    p50: pick(0.5), p95: pick(0.95),
  } : null;
  res.json({ ok: true, times: N, success, failed, statuses, timing, totalMs, flow: N === 1 ? results[0] : null });
});

// ================= ควบคุมมือถือผ่าน adb (ตั้ง global http_proxy — ไม่ต้องใช้ Postern) =================
async function adb(args, timeout = 15000) {
  const { stdout } = await execFileP(ADB, args, { timeout, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

// IP วง LAN ของ Mac (IPv4 ตัวแรกที่ไม่ใช่ loopback)
function getLanIp() {
  const ifaces = require('os').networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

// อ่านรายการ device + สถานะ proxy (global http_proxy ตั้งอยู่ไหม)
async function listDevices() {
  let out = '';
  try { out = await adb(['devices', '-l']); } catch { return []; }
  const devices = [];
  for (const line of out.split('\n').slice(1)) {
    const m = line.match(/^(\S+)\s+device\b(.*)$/);
    if (!m) continue;
    const serial = m[1];
    const model = (m[2].match(/model:(\S+)/) || [])[1] || serial;
    let proxy = '';
    try { proxy = (await adb(['-s', serial, 'shell', 'settings', 'get', 'global', 'http_proxy'])).trim(); } catch { /* ignore */ }
    const connected = !!proxy && proxy !== ':0' && proxy !== 'null';
    let mode = null;
    if (connected) mode = proxy.startsWith('127.0.0.1') ? 'usb' : 'wifi';
    // แอป Proxy Postern (VPN) กำลังทำงานไหม — จับเฉพาะ record ที่ยัง active
    // ("* ServiceRecord{" = รันอยู่ / "* Destroy ServiceRecord{" = หยุดแล้ว)
    let posternRunning = false;
    try {
      const svc = await adb(['-s', serial, 'shell', 'dumpsys', 'activity', 'services', POSTERN_PKG]);
      posternRunning = /\*\s+ServiceRecord\{[^}]*PosternVpnService/.test(svc);
    } catch { /* ignore */ }
    // adb-over-wifi serial จะเป็น ip:port → เลือกเงื่อนไข Wi-Fi ให้อัตโนมัติ
    const transport = /^\d+\.\d+\.\d+\.\d+:\d+$/.test(serial) ? 'wifi' : 'usb';
    const emulator = /^emulator-/.test(serial); // emulator → รองรับติดตั้ง CA เข้า system store อัตโนมัติ
    devices.push({ serial, model: model.replace(/_/g, ' '), connected, proxy: connected ? proxy : null, mode, posternRunning, transport, emulator });
  }
  return devices;
}

app.get('/api/devices', async (req, res) => {
  try { res.json({ ok: true, devices: await listDevices(), lanIp: getLanIp(), port: MITM_PORT }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// เลือก host ให้ตรงเงื่อนไข: USB → 127.0.0.1 (+adb reverse), Wi-Fi → LAN IP ของ Mac
async function resolveTarget(S, mode) {
  if (mode === 'wifi') {
    const lan = getLanIp();
    if (!lan) throw new Error('หา LAN IP ของ Mac ไม่เจอ');
    return { host: lan, target: `${lan}:${MITM_PORT}` };
  }
  await adb([...S, 'reverse', `tcp:${MITM_PORT}`, `tcp:${MITM_PORT}`]);
  return { host: '127.0.0.1', target: `127.0.0.1:${MITM_PORT}` };
}

// โหมด Wi-Fi ต้องให้มือถืออยู่วง LAN เดียวกับ Mac — ทดสอบว่ามือถือยิงถึง host:MITM_PORT จริงไหม
// ใช้ nc บนมือถือ (มี /system/bin/nc). คืน: 'reachable' | 'unreachable' | 'unknown'(nc ไม่มี/สั่งไม่ได้)
async function wifiReachable(S, host) {
  try {
    const out = await adb(
      [...S, 'shell', `which nc >/dev/null 2>&1 && (nc -w 3 -z ${host} ${MITM_PORT} && echo REACHABLE || echo NOPE) || echo NONC`],
      8000
    );
    if (/REACHABLE/.test(out)) return 'reachable';
    if (/NOPE/.test(out)) return 'unreachable';
    return 'unknown';
  } catch { return 'unknown'; }
}

// เชื่อม: method=proxy → ตั้ง global http_proxy | method=postern → เปิดแอป Proxy Postern พร้อม auto-fill+connect
app.post('/api/devices/connect', express.json(), async (req, res) => {
  const { serial, mode = 'usb', method = 'proxy' } = req.body || {};
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  try {
    // Guard โหมด Wi-Fi: มือถือต้องอยู่วง LAN เดียวกับ Mac ไม่งั้นตั้ง proxy ไปก็ยิงไม่ถึง (เงียบๆ)
    // เช็คก่อนแตะ state ของเครื่อง — ถ้ายิงไม่ถึงคืน warning ทันที ไม่ตั้ง proxy ทิ้งค้าง
    if (mode === 'wifi') {
      const lan = getLanIp();
      if (!lan) return res.status(409).json({ ok: false, unreachable: true,
        error: 'หา LAN IP ของ Mac ไม่เจอ — ต่อ Wi-Fi/LAN ที่ Mac ก่อน' });
      const reach = await wifiReachable(S, lan);
      if (reach === 'unreachable') {
        return res.status(409).json({ ok: false, unreachable: true, host: lan,
          error: `มือถือยิงหา Mac (${lan}:${MITM_PORT}) ไม่ถึง — โหมด Wi-Fi ต้องให้มือถืออยู่ Wi-Fi วงเดียวกับ Mac\n`
            + '(ตอนนี้มือถือน่าจะอยู่บน 4G หรือคนละวง Wi-Fi) · ถ้าเสียบสาย USB อยู่ ให้ใช้โหมด USB แทน' });
      }
      // reach === 'unknown' → ตรวจไม่ได้ (nc ไม่มี) ปล่อยผ่านแบบ best-effort
    }
    if (method === 'postern') {
      // เลือก host: usb=127.0.0.1(+reverse) / wifi=IP Mac
      const phost = (await resolveTarget(S, mode)).host; // usb จะตั้ง adb reverse ให้ด้วย
      const pport = MITM_PORT;
      // กันชนกับโหมด proxy: ล้าง global http_proxy ทิ้งก่อน (อย่าให้สองโหมดซ้อนกัน)
      await adb([...S, 'shell', 'settings', 'delete', 'global', 'http_proxy']).catch(() => {});
      // ฆ่า instance เก่าให้หมดก่อน — process :vpn init เอนจิน (lwIP) ได้ครั้งเดียว/process
      // ถ้าไม่เคลียร์ process เก่าที่กำลังตาย จะชนกับ start ใหม่ → service ค้าง/ANR → tun ไม่ขึ้น
      await adb([...S, 'shell', 'am', 'force-stop', POSTERN_PKG]).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      // สั่งแอปผ่าน intent: auto-fill host/port แล้ว connect (VPN) ด้วย process ใหม่สด
      await adb([...S, 'shell', 'am', 'start', '-n', `${POSTERN_PKG}/.MainActivity`,
        '--es', 'apitester_host', phost,
        '--ei', 'apitester_port', String(pport),
        '--ez', 'apitester_connect', 'true']);
      unmute();
      return res.json({ ok: true, connected: true, method, mode, host: phost, port: pport });
    }
    const { target } = await resolveTarget(S, mode);
    // โหมด proxy: กันชนกับ Postern — ปิด VPN (force-stop แอป) ก่อน ไม่งั้น VPN จะ hijack
    // loopback/reverse tunnel ทำให้ http_proxy 127.0.0.1:8888 ส่งไม่ถึง mitmproxy
    await adb([...S, 'shell', 'am', 'force-stop', POSTERN_PKG]).catch(() => {});
    await adb([...S, 'shell', 'settings', 'put', 'global', 'http_proxy', target]);
    unmute(); // เปิดรับ flow อีกครั้ง
    res.json({ ok: true, connected: true, method, mode, proxy: target });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ตัด: method=proxy → ล้าง global http_proxy | method=postern → สั่งแอปหยุด VPN
app.post('/api/devices/disconnect', express.json(), async (req, res) => {
  const { serial, method = 'proxy' } = req.body || {};
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  try {
    if (method === 'postern') {
      await adb([...S, 'shell', 'am', 'start', '-n', `${POSTERN_PKG}/.MainActivity`,
        '--es', 'apitester_host', '127.0.0.1',
        '--ez', 'apitester_disconnect', 'true']);
    } else {
      // ตัด proxy จริงบนเครื่อง — เคลียร์ทุก key (global + split host/port + pac/exclusion) ให้เกลี้ยง
      // (ทั้ง USB และ Wi-Fi ใช้ global http_proxy เหมือนกัน; delete http_proxy ปกติล้าง split key ให้ด้วย
      //  แต่ลบตรงๆ ทุกตัวกันเหนียว เผื่อบางรุ่นค้าง)
      await adb([...S, 'shell', 'settings', 'put', 'global', 'http_proxy', ':0']);
      for (const k of ['http_proxy', 'global_http_proxy_host', 'global_http_proxy_port',
        'global_http_proxy_exclusion_list', 'global_proxy_pac_url']) {
        await adb([...S, 'shell', 'settings', 'delete', 'global', k]).catch(() => {});
      }
      // แจ้งแอปให้รับรู้ทันที ไม่ต้องรอ network reconfigure (Wi-Fi ที่ยัง cache proxy อยู่)
      await adb([...S, 'shell', 'am', 'broadcast', '-a', 'android.intent.action.PROXY_CHANGE']).catch(() => {});
      // ตัด reverse tunnel (USB/emulator) — path ไปหา mitmproxy ขาดทันที
      await adb([...S, 'reverse', '--remove', `tcp:${MITM_PORT}`]).catch(() => {});
    }
    // mute ค้าง (จนกว่าจะ connect ใหม่/สั่งปลด) + ล้าง flow list — "ตัดแล้วเงียบ"
    // ถ้าเครื่องยัง cache proxy แล้วยิงต่อ flow จะถูกทิ้ง (นับไว้ที่ mutedDropCount โชว์ใน status)
    muteUntil = Infinity;
    mutedDropCount = 0;
    proxyStore.flows.length = 0;
    proxyImages.clear();
    broadcast('proxy-clear', {});
    res.json({ ok: true, connected: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ตั้ง/ปลด mute ตรงๆ — จำเป็นสำหรับการเชื่อมต่อแบบ manual (ตั้ง proxy เองบนมือถือ
// โดยไม่กด connect ในเว็บ): ถ้าก่อนหน้ากด disconnect ไว้ mute จะค้าง true และ server
// จะทิ้งทุก flow เงียบๆ — ปลดด้วย POST {"muted":false}
app.post('/api/proxy/mute', express.json(), (req, res) => {
  // สั่งเอง: muted:true = mute ค้าง (Infinity), muted:false = ปลด + รีเซ็ตตัวนับ
  if ((req.body || {}).muted) muteUntil = Infinity; else unmute();
  res.json({ ok: true, muted: isMuted() });
});

// ดัน CA ของ mitmproxy เข้าเครื่อง (Downloads) + เปิดหน้า Settings ให้ติดตั้ง
// mitmproxy สร้าง CA ตอนรันครั้งแรกเท่านั้น — บนเครื่องใหม่ที่ยังไม่เคยรัน cert จะไม่มี
// ฟังก์ชันนี้ trigger การสร้างให้: รัน mitmdump บนพอร์ตชั่วคราวแป๊บเดียวจน cert โผล่แล้วปิด
// หา path เต็มของ mitmdump — bare 'mitmdump' อาจไม่อยู่ใน PATH ของ process node
// (เช่น node ที่ start จาก finder/launchd ไม่มี /opt/homebrew/bin) → คืน null ถ้าไม่เจอ
let _mitmdumpPath = null; // cache เฉพาะผลบวก (path ที่เจอ) — ผลลบไม่ cache เผื่อ user ลงทีหลัง
function resolveMitmdump() {
  if (_mitmdumpPath && require('fs').existsSync(_mitmdumpPath)) return _mitmdumpPath;
  const cp = require('child_process');
  const home = require('os').homedir();
  const exists = (p) => { try { return p && fs.existsSync(p); } catch { return false; } };

  // 1) env override — start.sh จะ export MITMDUMP ให้ (มาจาก shell ที่มี PATH เต็ม)
  if (exists(process.env.MITMDUMP)) return (_mitmdumpPath = process.env.MITMDUMP);

  // 2) probe ที่ลงบ่อยๆ: venv สำรองในโปรเจกต์ (สร้างเฉพาะเครื่องที่ Homebrew cask เพี้ยน —
  //    ดู RELEASE_NOTES 2026-07-14), homebrew (ARM/Intel), pipx/pip --user, MacPorts, ระบบ
  const candidates = [
    path.join(__dirname, '.venv-mitm', 'bin', 'mitmdump'),
    '/opt/homebrew/bin/mitmdump', '/usr/local/bin/mitmdump', '/usr/bin/mitmdump',
    '/opt/local/bin/mitmdump', path.join(home, '.local/bin/mitmdump'),
  ];
  // pip install --user: ~/Library/Python/3.x/bin/mitmdump
  try {
    const pyBase = path.join(home, 'Library/Python');
    if (fs.existsSync(pyBase)) for (const v of fs.readdirSync(pyBase)) candidates.push(path.join(pyBase, v, 'bin/mitmdump'));
  } catch { /* ignore */ }
  for (const c of candidates) if (exists(c)) return (_mitmdumpPath = c);

  // 3) which ด้วย PATH ปัจจุบันของ process
  try {
    const out = cp.execFileSync('/usr/bin/which', ['mitmdump'], { encoding: 'utf8' }).trim();
    if (exists(out)) return (_mitmdumpPath = out);
  } catch { /* ไม่เจอ */ }

  // 4) ทางสุดท้าย: ถาม login shell (source .zprofile/.zshrc) เพื่อได้ PATH เต็มของ user
  //    ครอบเคสที่ node ถูก start จาก GUI/launchd ที่ PATH ถูกตัด
  for (const sh of [process.env.SHELL, '/bin/zsh', '/bin/bash'].filter(Boolean)) {
    try {
      const out = cp.execFileSync(sh, ['-lic', 'command -v mitmdump'], { encoding: 'utf8', timeout: 5000 })
        .trim().split('\n').pop();
      if (exists(out)) return (_mitmdumpPath = out);
    } catch { /* ลอง shell ตัวถัดไป */ }
  }
  return (_mitmdumpPath = null);
}

function mitmCaPath() {
  return path.join(require('os').homedir(), '.mitmproxy', 'mitmproxy-ca-cert.cer');
}

async function ensureMitmCa() {
  const caPath = mitmCaPath();
  if (fs.existsSync(caPath)) return caPath;
  const cmd = resolveMitmdump();
  if (!cmd) throw new Error('ไม่พบ mitmdump — ติดตั้งก่อน: brew install mitmproxy');
  const { spawn } = require('child_process');
  // listen-port 0 = ให้ OS เลือกพอร์ตว่าง (ไม่ชนตัวจริงที่ 8888)
  const child = spawn(cmd, ['--listen-port', '0'], { stdio: 'ignore', detached: true });
  // ⚠️ ต้องมี 'error' listener เสมอ — ไม่งั้น spawn ล้ม (ENOENT ฯลฯ) จะเป็น uncaught → node ตายทั้ง process
  let spawnErr = null;
  child.on('error', (e) => { spawnErr = e; });
  try {
    for (let i = 0; i < 20 && !fs.existsSync(caPath) && !spawnErr; i++) {
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    try { if (child.pid) process.kill(child.pid, 'SIGTERM'); } catch { /* ปิดไปแล้ว */ }
  }
  if (spawnErr) throw new Error('รัน mitmdump ไม่สำเร็จ: ' + spawnErr.message);
  if (!fs.existsSync(caPath)) throw new Error('สร้าง CA ไม่สำเร็จ — เช็คว่าติดตั้ง mitmproxy แล้ว (brew install mitmproxy)');
  return caPath;
}

// สถานะ CA — เช็คว่ามีไฟล์แล้วหรือยัง + รายละเอียด cert (ไม่ gen ใหม่ ถ้ายังไม่มีก็บอกว่ายังไม่มี)
app.get('/api/devices/ca/status', (req, res) => {
  const caPath = mitmCaPath();
  if (!fs.existsSync(caPath)) return res.json({ exists: false, path: caPath });
  try {
    const buf = fs.readFileSync(caPath);
    const stat = fs.statSync(caPath);
    const info = { exists: true, path: caPath, size: stat.size, modified: stat.mtimeMs };
    try {
      const { X509Certificate } = require('crypto');
      const cert = new X509Certificate(buf);
      info.sha256 = cert.fingerprint256; // 'AB:CD:...'
      info.subject = cert.subject;
      info.validFrom = cert.validFrom;
      info.validTo = cert.validTo;
      info.expired = new Date(cert.validTo).getTime() < Date.now();
    } catch { /* parse ไม่ได้ก็ข้าม detail ไป — แค่มีไฟล์ก็พอ */ }
    res.json(info);
  } catch (e) {
    res.status(500).json({ exists: false, error: e.message });
  }
});

// ดาวน์โหลด mitmproxy CA แบบ Manual — ไม่พึ่ง adb/USB (ใช้กับ iOS, Android ไม่ต่อสาย, Docker)
// gen ให้อัตโนมัติถ้ายังไม่มี · ?format=pem|crt เลือกชื่อไฟล์ให้เหมาะกับ OS
app.get('/api/devices/ca', async (req, res) => {
  let caPath;
  try { caPath = await ensureMitmCa(); }
  catch (e) { return res.status(500).send('โหลด CA ไม่ได้: ' + e.message); }
  // ไฟล์ .cer ของ mitmproxy เป็น PEM อยู่แล้ว — เสิร์ฟตรงๆ ใช้ได้ทั้ง iOS/Android/desktop
  const fmt = req.query.format === 'pem' ? 'pem' : 'crt'; // Android ชอบ .crt, iOS รับ .pem/.crt ได้
  res.set('Content-Type', 'application/x-x509-ca-cert');
  res.set('Content-Disposition', `attachment; filename="mitmproxy-ca.${fmt}"`);
  fs.createReadStream(caPath).pipe(res);
});

app.post('/api/devices/install-ca', express.json(), async (req, res) => {
  const serial = (req.body || {}).serial;
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  let caPath;
  try {
    caPath = await ensureMitmCa(); // สร้างให้อัตโนมัติถ้ายังไม่มี
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
  try {
    await adb([...S, 'push', caPath, '/sdcard/Download/mitmproxy-ca.crt']);
    await adb([...S, 'shell', 'am', 'start', '-a', 'android.settings.SECURITY_SETTINGS']);
    res.json({ ok: true, file: 'Download/mitmproxy-ca.crt' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ===== iOS Simulator (macOS + Xcode) — ติดตั้ง CA อัตโนมัติ =====
// simctl keychain <udid> add-root-cert วาง cert ลง trusted root store ของ sim ให้เลย
// → ไม่ต้องเปิด Certificate Trust Settings เอง (ต่างจากเครื่องจริง) HTTPS ผ่านทันที
async function listBootedIosSims() {
  // ต้องมี Xcode command line tools — xcrun หาไม่เจอ/ยังไม่ได้ตั้ง developer dir จะ throw
  const { stdout } = await execFileP('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { timeout: 10000 });
  const data = JSON.parse(stdout);
  const sims = [];
  for (const runtime of Object.keys(data.devices || {})) {
    // นับเฉพาะ iOS runtime (ตัด watchOS/tvOS ออก)
    if (!/iOS/i.test(runtime)) continue;
    for (const d of data.devices[runtime]) {
      if (d.state === 'Booted') sims.push({ udid: d.udid, name: d.name, runtime: runtime.split('.').pop() });
    }
  }
  return sims;
}

// list booted sims — ให้ UI เช็คว่ามี sim เปิดอยู่ไหมก่อนโชว์ปุ่ม
app.get('/api/devices/ios-sims', async (req, res) => {
  try {
    res.json({ ok: true, sims: await listBootedIosSims() });
  } catch (e) {
    // xcrun ไม่มี/Xcode ไม่ได้ลง = ไม่มี sim ให้ทำ — ไม่ใช่ error ร้ายแรง
    res.json({ ok: true, sims: [], unavailable: true, error: e.message });
  }
});

// ติดตั้ง CA ลง iOS Simulator ที่ booted อยู่ทุกตัว (auto-trust) — ปุ่มเดียวจบ
app.post('/api/devices/ios-sim/install-ca', express.json(), async (req, res) => {
  let sims;
  try {
    sims = await listBootedIosSims();
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'เรียก xcrun/simctl ไม่ได้ — ติดตั้ง Xcode ก่อน (xcode-select --install): ' + e.message });
  }
  if (!sims.length) return res.status(400).json({ ok: false, error: 'ไม่พบ iOS Simulator ที่เปิดอยู่ — เปิด Simulator (บูตเครื่องสักตัว) ก่อนแล้วลองใหม่' });
  let caPath;
  try {
    caPath = await ensureMitmCa(); // .cer เป็น PEM — add-root-cert รับได้
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
  const done = [], failed = [];
  for (const s of sims) {
    try {
      await execFileP('xcrun', ['simctl', 'keychain', s.udid, 'add-root-cert', caPath], { timeout: 15000 });
      done.push(s.name);
    } catch (e) {
      failed.push(`${s.name} (${e.message.trim().split('\n').pop()})`);
    }
  }
  if (!done.length) return res.status(500).json({ ok: false, error: 'ติดตั้งไม่สำเร็จ: ' + failed.join(', ') });
  res.json({ ok: true, installed: done, failed });
});

// ===== Android Emulator — ติดตั้ง CA ลง SYSTEM trust store อัตโนมัติ (auto-trust) =====
// เครื่องจริง (ไม่ root) ลง CA ได้แค่ user store ซึ่งแอปส่วนใหญ่ไม่เชื่อ → HTTPS ไม่ผ่าน
// แต่ emulator แบบ userdebug root ได้ → ยัด CA เข้า system store ให้เลย HTTPS ทะลุทันที (ยกเว้นแอปที่ pin cert)
// เทคนิค Android 14+ (API 34+): trust store ย้ายไป Conscrypt APEX (/apex/.../cacerts) ซึ่ง read-only
//   → tmpfs ทับ /system/etc/security/cacerts (ใส่ CA ระบบเดิม+ตัวเรา ครบ) แล้ว bind ทับ apex
//   → propagate mount เข้า namespace ของ zygote + restart framework (stop;start) ให้ USAP pool/แอปเกิดใหม่เห็น mount
async function isEmulator(serial) {
  try {
    const qemu = (await adb(['-s', serial, 'shell', 'getprop', 'ro.boot.qemu'])).trim();
    const kqemu = (await adb(['-s', serial, 'shell', 'getprop', 'ro.kernel.qemu'])).trim();
    return serial.startsWith('emulator-') || qemu === '1' || kqemu === '1';
  } catch { return serial.startsWith('emulator-'); }
}

app.post('/api/devices/install-ca-emulator', express.json(), async (req, res) => {
  const serial = (req.body || {}).serial;
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  try {
    if (!(await isEmulator(serial))) {
      return res.status(400).json({ ok: false, error: 'ใช้ได้เฉพาะ Android Emulator — เครื่องจริงลง system CA ไม่ได้ (ไม่มี root) ใช้ปุ่ม "ติดตั้ง CA (คู่มือ)" แทน' });
    }
    const caPath = await ensureMitmCa();
    // Android เก็บ CA เป็นไฟล์ชื่อ <subject_hash_old>.0
    const { stdout: hashOut } = await execFileP('openssl', ['x509', '-inform', 'PEM', '-subject_hash_old', '-noout', '-in', caPath], { timeout: 8000 });
    const hash = hashOut.trim().split('\n')[0];
    if (!/^[0-9a-f]{8}$/.test(hash)) throw new Error('คำนวณ hash ของ CA ไม่ได้: ' + hash);

    // ต้อง root ก่อน (userdebug/emulator เท่านั้น) — Play image จะ fail ตรงนี้
    try { await adb([...S, 'root'], 20000); } catch (e) { /* already root or transient */ }
    await new Promise((r) => setTimeout(r, 1500));
    await adb([...S, 'wait-for-device'], 20000);
    const who = (await adb([...S, 'shell', 'id', '-u'])).trim();
    if (who !== '0') throw new Error('adb root ไม่สำเร็จ (ได้ uid=' + who + ') — emulator ต้องเป็น image แบบ userdebug/ไม่ใช่ Google Play');

    await adb([...S, 'push', caPath, `/data/local/tmp/${hash}.0`]);
    // สคริปต์ติดตั้ง (รันเป็น root) — ดูคอมเมนต์บล็อกด้านบน
    const script = [
      `HASH=${hash}`,
      'CERTS=/apex/com.android.conscrypt/cacerts',
      'SYS=/system/etc/security/cacerts',
      'TMP=/data/local/tmp/cacerts-work',
      'rm -rf $TMP; mkdir -p $TMP',
      'cp $CERTS/* $TMP/ 2>/dev/null || true',
      'cp /data/local/tmp/$HASH.0 $TMP/',
      'chown root:root $TMP/* 2>/dev/null; chmod 644 $TMP/*',
      'mount -t tmpfs tmpfs $SYS 2>/dev/null || true',
      'cp $TMP/* $SYS/',
      'chown root:root $SYS/* 2>/dev/null; chmod 644 $SYS/*',
      'chcon u:object_r:system_security_cacerts_file:s0 $SYS/* 2>/dev/null || true',
      'mount --bind $SYS $CERTS',
      'for pid in $(pgrep zygote) $(pgrep zygote64); do nsenter --mount=/proc/$pid/ns/mnt -- mount --bind $SYS $CERTS 2>/dev/null || true; done',
      'echo INSTALL_OK',
    ].join('\n');
    const out = await adb([...S, 'shell', 'su', '0', 'sh', '-c', script], 30000);
    // ยืนยันว่าไฟล์อยู่ใน apex store จริง
    const check = await adb([...S, 'shell', 'ls', `/apex/com.android.conscrypt/cacerts/${hash}.0`]).catch(() => '');
    if (!check.includes(`${hash}.0`)) throw new Error('ติดตั้งไม่สำเร็จ (ไม่พบไฟล์ใน apex store)\n' + out);

    // restart framework ให้ zygote + USAP pool + แอปทั้งหมดเกิดใหม่ภายใต้ mount ใหม่ (tmpfs อยู่ใน init ns → รอด)
    await adb([...S, 'shell', 'su', '0', 'stop'], 15000).catch(() => {});
    await adb([...S, 'shell', 'su', '0', 'start'], 15000).catch(() => {});
    // รอ boot_completed กลับมา
    let booted = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const b = (await adb([...S, 'shell', 'getprop', 'sys.boot_completed']).catch(() => '')).trim();
      if (b === '1') { booted = true; break; }
    }
    res.json({ ok: true, hash, booted,
      note: 'ติดตั้ง CA เข้า system store แล้ว (restart framework เรียบร้อย) — HTTPS ถอดรหัสได้เลย ยกเว้นแอปที่ทำ certificate pinning' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ติดตั้งแอป Proxy Postern (APK) ลงเครื่อง — build ให้ถ้ายังไม่มี แล้ว adb install -r
const POSTERN_DIR = path.join(__dirname, 'android', 'ProxyPostern');
const POSTERN_APK = path.join(POSTERN_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
app.post('/api/devices/install-apk', express.json(), async (req, res) => {
  const serial = (req.body || {}).serial;
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  try {
    if (!fs.existsSync(POSTERN_APK)) {
      if (!fs.existsSync(path.join(POSTERN_DIR, 'gradlew'))) {
        return res.status(500).json({ ok: false, error: 'ไม่พบ APK และ source (android/ProxyPostern)' });
      }
      // build debug APK ให้ก่อน (ครั้งแรกอาจนาน)
      await execFileP('./gradlew', [':app:assembleDebug', '-q'], {
        cwd: POSTERN_DIR, timeout: 600000, maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ANDROID_HOME: process.env.ANDROID_HOME || path.join(require('os').homedir(), 'Library/Android/sdk') },
      });
    }
    if (!fs.existsSync(POSTERN_APK)) return res.status(500).json({ ok: false, error: 'build APK ไม่สำเร็จ' });
    const out = await adb([...S, 'install', '-r', POSTERN_APK], 180000);
    const ok = /Success/i.test(out);
    res.json({ ok, output: out.trim().split('\n').filter(Boolean).pop() || 'installed', built: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================= Status dashboard (เช็คความพร้อม + สตาร์ท service ที่ดับ) =================
const MCP_PORT = parseInt(process.env.MCP_PORT || '7333', 10);
const MITM_ADDON = path.join(__dirname, 'mitm-to-apitester.py');
const MITM_LOG = '/tmp/mitmdump.log';
const MCP_LOG = '/tmp/apitester-mcp.log';

// เช็คว่ามีใครฟัง TCP พอร์ตนี้ไหม (ตัวจริงของ "service ขึ้นแล้ว" — ไม่เดาจาก process list)
function checkPort(port, host = '127.0.0.1', timeout = 800) {
  return new Promise((resolve) => {
    const s = require('net').connect({ port, host });
    const done = (up) => { s.destroy(); resolve(up); };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

async function hasReverseTunnel(serial) {
  try {
    const out = await adb(['-s', serial, 'reverse', '--list']);
    return out.includes(`tcp:${MITM_PORT}`);
  } catch { return false; }
}

app.get('/api/status', async (req, res) => {
  try {
    const [mitmUp, mcpUp, devices] = await Promise.all([
      checkPort(MITM_PORT), checkPort(MCP_PORT), listDevices(),
    ]);
    // reverse tunnel เช็คเฉพาะ device ที่ต่อโหมด usb (ใช้ 127.0.0.1 ผ่าน adb reverse)
    for (const d of devices) {
      d.reverse = d.mode === 'usb' ? await hasReverseTunnel(d.serial) : null;
    }
    let lastFlowAt = null;
    for (const f of proxyStore.flows) if (!lastFlowAt || f.time > lastFlowAt) lastFlowAt = f.time;
    res.json({
      ok: true,
      services: {
        apitester: { up: true, port: PORT },
        mitmproxy: { up: mitmUp, port: MITM_PORT },
        mcp: { up: mcpUp, port: MCP_PORT, url: `http://127.0.0.1:${MCP_PORT}/mcp` },
      },
      devices,
      muted: isMuted(),
      mutedDropped: mutedDropCount,
      flows: { count: proxyStore.flows.length, lastAt: lastFlowAt },
      lanIp: getLanIp(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// สตาร์ท service ที่ดับ: mitm | mcp — spawn แบบ detached แล้วยืนยันว่าพอร์ตขึ้นจริงก่อนตอบ
app.post('/api/status/start/:service', express.json(), async (req, res) => {
  const { spawn } = require('child_process');
  const svc = req.params.service;
  const defs = {
    mitm: {
      port: MITM_PORT, log: MITM_LOG,
      cmd: resolveMitmdump() || 'mitmdump',
      args: ['--listen-host', '0.0.0.0', '--listen-port', String(MITM_PORT), '-s', MITM_ADDON],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      cwd: __dirname,
    },
    mcp: {
      port: MCP_PORT, log: MCP_LOG,
      cmd: process.execPath, // node ตัวเดียวกับที่รัน server อยู่
      args: ['index.js'],
      env: { ...process.env, MCP_PORT: String(MCP_PORT) },
      cwd: path.join(__dirname, 'mcp'),
    },
  };
  const def = defs[svc];
  if (!def) return res.status(400).json({ ok: false, error: `ไม่รู้จัก service: ${svc}` });
  try {
    if (await checkPort(def.port)) return res.json({ ok: true, up: true, already: true });
    const logFd = fs.openSync(def.log, 'a');
    const child = spawn(def.cmd, def.args, {
      cwd: def.cwd, env: def.env, detached: true, stdio: ['ignore', logFd, logFd],
    });
    // ต้องมี 'error' listener — ไม่งั้น ENOENT (หา cmd ไม่เจอ) จะ uncaught → node ตายทั้ง process
    let spawnErr = null;
    child.on('error', (e) => { spawnErr = e; });
    child.unref();
    fs.closeSync(logFd);
    // รอพอร์ตขึ้นจริง (สูงสุด ~6 วิ) — spawn สำเร็จไม่ได้แปลว่า service รอด
    // ('error' emit แบบ async → เช็ค spawnErr ในลูปด้วย ไม่ใช่แค่ทันทีหลัง spawn)
    let up = false;
    for (let i = 0; i < 12 && !up && !spawnErr; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = await checkPort(def.port);
    }
    if (spawnErr) return res.status(500).json({ ok: false, error: `รัน ${svc} ไม่สำเร็จ: ${spawnErr.message} (เช็คว่าติดตั้ง mitmproxy แล้ว)` });
    if (up) return res.json({ ok: true, up: true, pid: child.pid });
    let tail = '';
    try { tail = fs.readFileSync(def.log, 'utf8').split('\n').slice(-8).join('\n'); } catch { /* ignore */ }
    res.status(500).json({ ok: false, up: false, error: `สตาร์ทแล้วแต่พอร์ต ${def.port} ไม่ขึ้น`, log: tail });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ปิด service: mitm | mcp — หา PID จากพอร์ตแล้ว SIGTERM (แม่นกว่า pkill ตามชื่อ)
app.post('/api/status/stop/:service', express.json(), async (req, res) => {
  const svc = req.params.service;
  const ports = { mitm: MITM_PORT, mcp: MCP_PORT };
  const port = ports[svc];
  if (!port) return res.status(400).json({ ok: false, error: `ไม่รู้จัก service: ${svc}` });
  try {
    if (!(await checkPort(port))) return res.json({ ok: true, up: false, already: true });
    const { stdout } = await execFileP('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']);
    for (const pid of stdout.split('\n').filter(Boolean)) {
      try { process.kill(parseInt(pid, 10), 'SIGTERM'); } catch { /* ตายไปแล้ว */ }
    }
    let down = false;
    for (let i = 0; i < 10 && !down; i++) {
      await new Promise((r) => setTimeout(r, 400));
      down = !(await checkPort(port));
    }
    if (down) return res.json({ ok: true, up: false });
    res.status(500).json({ ok: false, error: `สั่งปิดแล้วแต่พอร์ต ${port} ยังเปิดอยู่` });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// สร้าง QR เป็น PNG ที่ server (offline — ไม่ส่ง URL ออก third-party)
const QRCode = require('qrcode');
app.get('/api/qr', async (req, res) => {
  const data = req.query.data;
  if (!data) return res.status(400).send('ต้องระบุ ?data=');
  const size = Math.min(600, Math.max(100, parseInt(req.query.size, 10) || 200));
  try {
    const buf = await QRCode.toBuffer(String(data), { width: size, margin: 1, errorCorrectionLevel: 'M' });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (e) {
    res.status(500).send('สร้าง QR ไม่ได้: ' + e.message);
  }
});

app.get('/api/proxy/info', (req, res) => {
  // หา IP วง LAN (IPv4 ตัวแรกที่ไม่ใช่ loopback) เพื่อบอกวิธีเชื่อมแบบ Wi-Fi
  let lanIp = null;
  const ifaces = require('os').networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) { lanIp = i.address; break; }
    }
    if (lanIp) break;
  }
  res.json({ proxyPort: PROXY_PORT, caReady: !!proxyCaPath, lanIp, mitmPort: 8888 });
});

// ดาวน์โหลด CA cert เพื่อเอาไปติดตั้งบนอุปกรณ์
app.get('/api/proxy/cert', (req, res) => {
  if (!proxyCaPath) return res.status(503).send('CA ยังไม่พร้อม');
  res.download(proxyCaPath, 'api-tester-ca.pem');
});

// SSE stream ให้หน้าเว็บอัปเดต real-time
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  sseClients.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// ================= Upload API (สำหรับทดสอบอัปโหลดไฟล์) =================
// POST /api/upload — multipart/form-data แนบไฟล์กี่ตัวก็ได้ (field ชื่ออะไรก็ได้) + text field อื่นๆ
// ตอบกลับรายละเอียดไฟล์ + metadata ของรูป และบันทึกเข้า hook ให้เห็นใน Inspector/Mobile Files ทันที
app.post('/api/upload', upload.any(), async (req, res) => {
  const uploadedFiles = req.files || [];
  if (!uploadedFiles.length) {
    return res.status(400).json({ ok: false, error: 'ไม่พบไฟล์แนบ กรุณาส่งเป็น multipart/form-data พร้อมไฟล์อย่างน้อย 1 ไฟล์' });
  }

  const id = crypto.randomUUID();
  const time = new Date().toISOString();

  const fileDetails = await Promise.all(uploadedFiles.map(async (f, i) => {
    const detail = {
      index: i,
      field: f.fieldname,
      name: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      url: `/api/requests/${id}/files/${i}`,
      metadataUrl: `/api/requests/${id}/files/${i}/metadata`,
    };
    if (f.mimetype && f.mimetype.startsWith('image/')) {
      try {
        // withAddress: reverse geocode หาที่อยู่ให้ด้วย (ข้ามได้ด้วย ?address=0)
        detail.metadata = await extractImageMetadata(f.buffer, { withAddress: req.query.address !== '0' });
      } catch (err) {
        detail.metadata = null;
        detail.metadataError = err.message;
      }
    }
    return detail;
  }));

  // บันทึกเข้า hook store เพื่อให้แสดงใน Inspector และ Mobile Files แบบ real-time
  const entry = {
    id,
    time,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    contentType: req.headers['content-type'] || null,
    headers: req.headers,
    query: req.query,
    body: Object.keys(req.body || {}).length ? req.body : null,
    files: fileDetails.map(({ index, field, name, mimetype, size }) => ({ index, field, name, mimetype, size })),
  };
  addEntry(entry, uploadedFiles.map((f) => ({
    buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname,
  })));

  res.json({
    ok: true,
    id,
    receivedAt: time,
    fields: entry.body,
    files: fileDetails,
  });
});

// ================= Sender (ยิง request ไปทดสอบ API อื่น) =================
// บันทึก request ที่ยิงจาก Sender เข้า hook store เพื่อให้เห็นใน Inspector ด้วย
function logSenderRequest({ method, url, headers = {}, body = null, files = [], resultStatus, resultBody, error }) {
  const id = crypto.randomUUID();
  const ctKey = Object.keys(headers).find((k) => k.toLowerCase() === 'content-type');
  const entry = {
    id,
    time: new Date().toISOString(),
    method,
    path: url,
    ip: 'sender (ยิงจากในเครื่อง)',
    source: 'sender',
    contentType: ctKey ? headers[ctKey] : null,
    headers: { ...headers, 'x-sender-result': error ? `ERROR: ${error}` : `HTTP ${resultStatus}` },
    query: {},
    body,
    files: files.map((f, i) => ({ index: i, field: f.field, name: f.name, mimetype: f.mimetype, size: f.size })),
    // เก็บ response ที่ได้กลับมาด้วย เพื่อดูใน Inspector
    senderResponse: error ? { error } : { status: resultStatus, body: resultBody != null ? String(resultBody).slice(0, 100000) : null },
  };
  addEntry(entry, files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.name })));
}

function collectResponse(resp, bodyText, startedAt) {
  const headers = {};
  resp.headers.forEach((v, k) => { headers[k] = v; });
  return {
    ok: true,
    status: resp.status,
    statusText: resp.statusText,
    durationMs: Date.now() - startedAt,
    headers,
    body: bodyText.length > 500000 ? bodyText.slice(0, 500000) + '\n...(ตัดข้อความ ยาวเกินไป)' : bodyText,
  };
}

// ผลลัพธ์จาก raw response (proxy path) → รูปแบบเดียวกับ collectResponse
function rawResult({ status, statusText, headers }, text, startedAt) {
  const h = {};
  for (const [k, v] of Object.entries(headers || {})) h[k] = Array.isArray(v) ? v.join(', ') : String(v);
  return {
    ok: true, status, statusText: statusText || '', durationMs: Date.now() - startedAt, headers: h,
    body: text.length > 500000 ? text.slice(0, 500000) + '\n...(ตัดข้อความ ยาวเกินไป)' : text,
  };
}

// ยิง request ผ่าน mitmproxy (127.0.0.1:MITM_PORT) เอง เพื่อให้ flow ถูกดักบันทึกเหมือน traffic มือถือ
// HTTP = absolute-form ผ่าน proxy, HTTPS = CONNECT tunnel + TLS (ปิด verify เพราะ mitmproxy เซ็น cert เอง)
function sendThroughProxy({ url, method = 'GET', headers = {}, body = null }, proxyHost = '127.0.0.1', proxyPort = MITM_PORT) {
  const http = require('http');
  const tls = require('tls');
  const u = new URL(url);
  const reqHeaders = { ...headers };
  if (!Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'host')) reqHeaders['Host'] = u.host;
  // ขอ response แบบไม่บีบอัด — เราอ่านเป็น utf8 ตรงๆ (ไม่มี gunzip) เลยกัน body เพี้ยน
  reqHeaders['Accept-Encoding'] = 'identity';
  const payload = (body != null && body !== '' && !['GET', 'HEAD'].includes(method.toUpperCase()))
    ? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) : null;
  if (payload) {
    if (!Object.keys(reqHeaders).some((k) => k.toLowerCase() === 'content-type')) reqHeaders['Content-Type'] = 'application/json';
    reqHeaders['Content-Length'] = Buffer.byteLength(payload);
  }
  const readResp = (resp, resolve) => {
    const chunks = [];
    resp.on('data', (c) => chunks.push(c));
    resp.on('end', () => resolve({ status: resp.statusCode, statusText: resp.statusMessage, headers: resp.headers, text: Buffer.concat(chunks).toString('utf8') }));
  };
  return new Promise((resolve, reject) => {
    if (u.protocol !== 'https:') {
      const r = http.request({ host: proxyHost, port: proxyPort, method, path: url, headers: reqHeaders }, (resp) => readResp(resp, resolve));
      r.on('error', reject); r.setTimeout(20000, () => r.destroy(new Error('timeout')));
      if (payload) r.write(payload); r.end();
      return;
    }
    // HTTPS: ขอ CONNECT tunnel จาก proxy ก่อน
    const port = u.port || 443;
    const connectReq = http.request({ host: proxyHost, port: proxyPort, method: 'CONNECT', path: `${u.hostname}:${port}` });
    connectReq.on('connect', (res2, socket) => {
      if (res2.statusCode !== 200) { reject(new Error(`proxy CONNECT ล้มเหลว (${res2.statusCode})`)); return; }
      const tlsSock = tls.connect({ socket, servername: u.hostname, rejectUnauthorized: false }, () => {
        const r = http.request({ createConnection: () => tlsSock, method, path: u.pathname + u.search, headers: reqHeaders }, (resp) => readResp(resp, resolve));
        r.on('error', reject); r.setTimeout(20000, () => r.destroy(new Error('timeout')));
        if (payload) r.write(payload); r.end();
      });
      tlsSock.on('error', reject);
    });
    connectReq.on('error', reject);
    connectReq.setTimeout(20000, () => connectReq.destroy(new Error('CONNECT timeout')));
    connectReq.end();
  });
}

app.post('/api/send', express.json({ limit: '10mb' }), async (req, res) => {
  const { url, method = 'GET', headers = {}, body, viaProxy } = req.body || {};
  if (!url) return res.status(400).json({ ok: false, error: 'กรุณาระบุ URL' });
  const startedAt = Date.now();
  try {
    const options = { method, headers: { ...headers } };
    if (body !== undefined && body !== null && body !== '' && !['GET', 'HEAD'].includes(method.toUpperCase())) {
      options.body = typeof body === 'string' ? body : JSON.stringify(body);
      if (!Object.keys(options.headers).some((k) => k.toLowerCase() === 'content-type')) {
        options.headers['Content-Type'] = 'application/json';
      }
    }
    // viaProxy: ยิงผ่าน mitmproxy เอง → flow โผล่ในแท็บ Proxy เหมือน traffic จากมือถือ
    if (viaProxy) {
      const pr = await sendThroughProxy({ url, method, headers: options.headers, body: options.body });
      logSenderRequest({ method, url, headers: options.headers, body: body ?? null, resultStatus: pr.status, resultBody: pr.text });
      return res.json(rawResult(pr, pr.text, startedAt));
    }
    const resp = await fetch(url, options);
    const text = await resp.text();
    logSenderRequest({ method, url, headers: options.headers, body: body ?? null, resultStatus: resp.status, resultBody: text });
    res.json(collectResponse(resp, text, startedAt));
  } catch (err) {
    const msg = err.cause ? `${err.message}: ${err.cause.message || err.cause.code}` : err.message;
    logSenderRequest({ method, url, headers: { ...headers }, body: body ?? null, error: msg });
    res.json({ ok: false, durationMs: Date.now() - startedAt, error: msg });
  }
});

// ส่งแบบ form-data (มีไฟล์แนบ) — client ส่ง multipart มาที่นี่ แล้ว server ส่งต่อไปยังปลายทาง
app.post('/api/send-form', upload.any(), async (req, res) => {
  const targetUrl = req.body._url;
  const method = req.body._method || 'POST';
  if (!targetUrl) return res.status(400).json({ ok: false, error: 'กรุณาระบุ URL' });
  let extraHeaders = {};
  try {
    if (req.body._headers) extraHeaders = JSON.parse(req.body._headers);
  } catch {
    return res.status(400).json({ ok: false, error: 'headers ไม่ใช่ JSON ที่ถูกต้อง' });
  }
  const startedAt = Date.now();
  const fields = {};
  for (const [k, v] of Object.entries(req.body)) {
    if (!k.startsWith('_')) fields[k] = v;
  }
  const senderFiles = (req.files || []).map((f) => ({
    field: f.fieldname, name: f.originalname, mimetype: f.mimetype, size: f.size, buffer: f.buffer,
  }));
  try {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of req.files || []) {
      fd.append(f.fieldname, new Blob([f.buffer], { type: f.mimetype }), f.originalname);
    }
    const resp = await fetch(targetUrl, { method, headers: extraHeaders, body: fd });
    const text = await resp.text();
    logSenderRequest({ method, url: targetUrl, headers: extraHeaders, body: Object.keys(fields).length ? fields : null, files: senderFiles, resultStatus: resp.status, resultBody: text });
    res.json(collectResponse(resp, text, startedAt));
  } catch (err) {
    const msg = err.cause ? `${err.message}: ${err.cause.message || err.cause.code}` : err.message;
    logSenderRequest({ method, url: targetUrl, headers: extraHeaders, body: Object.keys(fields).length ? fields : null, files: senderFiles, error: msg });
    res.json({ ok: false, durationMs: Date.now() - startedAt, error: msg });
  }
});

// ================= Start =================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Tester รันอยู่ที่ http://localhost:${PORT}`);
  console.log(`Hook endpoint: http://localhost:${PORT}/hook (รับทุก method ทุก path ย่อย)`);
});

// ประกาศ service ผ่าน mDNS/Bonjour ให้แอปในวง Wi-Fi เดียวกันค้นหา mitmproxy เจอเอง (auto-fill)
try {
  const { Bonjour } = require('bonjour-service');
  const bonjour = new Bonjour();
  bonjour.publish({
    name: `ApiTester Proxy (${require('os').hostname()})`,
    type: 'apitester',           // ประกาศเป็น _apitester._tcp
    protocol: 'tcp',
    port: MITM_PORT,             // พอร์ต mitmproxy ที่มือถือเชื่อม
    txt: { mitm: '8888', web: String(PORT) },
  });
  console.log(`mDNS: ประกาศ _apitester._tcp พอร์ต ${MITM_PORT} (แอปในวง Wi-Fi เดียวกันค้นหาเจอเอง)`);
} catch (err) {
  console.error('mDNS ประกาศไม่สำเร็จ:', err.message);
}

startProxy({
  port: PROXY_PORT,
  caDir: CA_DIR,
  store: proxyStore,
  onFlow: (flow) => broadcast('proxy', flow),
  matchMapLocal: findMapRule,
})
  .then(({ caPath }) => {
    proxyCaPath = caPath;
    console.log(`MITM Proxy รันอยู่ที่พอร์ต ${PROXY_PORT} (ตั้ง proxy บนอุปกรณ์ชี้มาที่ IP เครื่องนี้:${PROXY_PORT})`);
    console.log(`CA cert: ${caPath} — ดาวน์โหลดผ่าน http://localhost:${PORT}/api/proxy/cert`);
  })
  .catch((err) => {
    console.error('เริ่ม MITM proxy ไม่สำเร็จ:', err.message);
  });
