const express = require('express');
const multer = require('multer');
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
const proxyImages = new Map(); // "<flowId>:<req|res>" -> { buf, ct }
let proxyCaPath = null;
// เมื่อกด disconnect ที่เว็บ → mute ทันที (แอปที่ยัง cache proxy ไว้จะยิงต่อ แต่เราไม่รับ/ไม่โชว์)
let proxyMuted = false;

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
  };
  mapRules.unshift(rule);
  saveMapRules();
  res.json({ ok: true, rule });
});

app.put('/api/maplocal/:id', express.json({ limit: '5mb' }), (req, res) => {
  const rule = mapRules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ ok: false, error: 'ไม่พบ rule' });
  const b = req.body || {};
  for (const k of ['enabled', 'name', 'method', 'urlPattern', 'contentType', 'body']) {
    if (b[k] !== undefined) rule[k] = k === 'body' ? String(b[k]) : b[k];
  }
  if (b.status !== undefined) rule.status = Number(b.status) || 200;
  saveMapRules();
  res.json({ ok: true, rule });
});

app.delete('/api/maplocal/:id', (req, res) => {
  const before = mapRules.length;
  mapRules = mapRules.filter((r) => r.id !== req.params.id);
  saveMapRules();
  res.json({ ok: true, removed: before - mapRules.length });
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
  if (proxyMuted) return res.json({ ok: true, muted: true }); // ตัดการเชื่อมต่อแล้ว — ไม่รับ flow
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
  proxyStore.flows.unshift(flow);
  while (proxyStore.flows.length > 300) {
    const removed = proxyStore.flows.pop();
    proxyImages.delete(`${removed.id}:req`);
    proxyImages.delete(`${removed.id}:res`);
  }
  broadcast('proxy', flow);
  res.json({ ok: true, id });
});

// ส่งรูปที่ดักได้ (req/res) ให้หน้าเว็บโชว์
app.get('/api/proxy/flows/:id/image', (req, res) => {
  const side = req.query.side === 'req' ? 'req' : 'res';
  const img = proxyImages.get(`${req.params.id}:${side}`);
  if (!img) return res.status(404).json({ error: 'no image' });
  res.setHeader('Content-Type', img.ct || 'application/octet-stream');
  res.send(img.buf);
});

app.delete('/api/proxy/flows', (req, res) => {
  proxyStore.flows.length = 0;
  broadcast('proxy-clear', {});
  res.json({ ok: true });
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
    devices.push({ serial, model: model.replace(/_/g, ' '), connected, proxy: connected ? proxy : null, mode, posternRunning, transport });
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

// เชื่อม: method=proxy → ตั้ง global http_proxy | method=postern → เปิดแอป Proxy Postern พร้อม auto-fill+connect
app.post('/api/devices/connect', express.json(), async (req, res) => {
  const { serial, mode = 'usb', method = 'proxy' } = req.body || {};
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  try {
    const { host, target } = await resolveTarget(S, mode);
    if (method === 'postern') {
      // กันชนกับโหมด proxy: ล้าง global http_proxy ทิ้งก่อน (อย่าให้สองโหมดซ้อนกัน)
      await adb([...S, 'shell', 'settings', 'delete', 'global', 'http_proxy']).catch(() => {});
      // ฆ่า instance เก่าให้หมดก่อน — process :vpn init เอนจิน (lwIP) ได้ครั้งเดียว/process
      // ถ้าไม่เคลียร์ process เก่าที่กำลังตาย จะชนกับ start ใหม่ → service ค้าง/ANR → tun ไม่ขึ้น
      await adb([...S, 'shell', 'am', 'force-stop', POSTERN_PKG]).catch(() => {});
      await new Promise((r) => setTimeout(r, 800));
      // สั่งแอปผ่าน intent: auto-fill host/port แล้ว connect (VPN) ด้วย process ใหม่สด
      await adb([...S, 'shell', 'am', 'start', '-n', `${POSTERN_PKG}/.MainActivity`,
        '--es', 'apitester_host', host,
        '--ei', 'apitester_port', String(MITM_PORT),
        '--ez', 'apitester_connect', 'true']);
      proxyMuted = false;
      return res.json({ ok: true, connected: true, method, mode, host, port: MITM_PORT });
    }
    // โหมด proxy: กันชนกับ Postern — ปิด VPN (force-stop แอป) ก่อน ไม่งั้น VPN จะ hijack
    // loopback/reverse tunnel ทำให้ http_proxy 127.0.0.1:8888 ส่งไม่ถึง mitmproxy
    await adb([...S, 'shell', 'am', 'force-stop', POSTERN_PKG]).catch(() => {});
    await adb([...S, 'shell', 'settings', 'put', 'global', 'http_proxy', target]);
    proxyMuted = false; // เปิดรับ flow อีกครั้ง
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
      await adb([...S, 'shell', 'settings', 'put', 'global', 'http_proxy', ':0']);
      await adb([...S, 'shell', 'settings', 'delete', 'global', 'http_proxy']).catch(() => {});
      await adb([...S, 'reverse', '--remove', `tcp:${MITM_PORT}`]).catch(() => {});
    }
    // mute + ล้าง flow list — กันแอปที่ cache proxy ไว้ยิงต่อแล้วโผล่ใหม่
    proxyMuted = true;
    proxyStore.flows.length = 0;
    proxyImages.clear();
    broadcast('proxy-clear', {});
    res.json({ ok: true, connected: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ดัน CA ของ mitmproxy เข้าเครื่อง (Downloads) + เปิดหน้า Settings ให้ติดตั้ง
app.post('/api/devices/install-ca', express.json(), async (req, res) => {
  const serial = (req.body || {}).serial;
  if (!serial) return res.status(400).json({ ok: false, error: 'ต้องระบุ serial' });
  const S = ['-s', serial];
  const caPath = path.join(require('os').homedir(), '.mitmproxy', 'mitmproxy-ca-cert.cer');
  if (!fs.existsSync(caPath)) return res.status(500).json({ ok: false, error: 'ไม่พบ CA ของ mitmproxy (รัน mitmproxy ก่อน)' });
  try {
    await adb([...S, 'push', caPath, '/sdcard/Download/mitmproxy-ca.crt']);
    await adb([...S, 'shell', 'am', 'start', '-a', 'android.settings.SECURITY_SETTINGS']);
    res.json({ ok: true, file: 'Download/mitmproxy-ca.crt' });
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

app.post('/api/send', express.json({ limit: '10mb' }), async (req, res) => {
  const { url, method = 'GET', headers = {}, body } = req.body || {};
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
