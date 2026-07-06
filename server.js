const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const exifr = require('exifr');
const { startProxy } = require('./proxy');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_PORT = process.env.PROXY_PORT || 8080;
const CA_DIR = path.join(__dirname, '.proxy-ca');

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
let proxyCaPath = null;

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

app.use(express.static(path.join(__dirname, 'public')));
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

app.get('/api/requests/:id/files/:index', (req, res) => {
  const files = fileBuffers.get(req.params.id);
  const file = files && files[Number(req.params.index)];
  if (!file) return res.status(404).json({ error: 'file not found' });
  res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalname)}"`);
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

// ================= Proxy (MITM) API =================
app.get('/api/proxy/flows', (req, res) => {
  res.json(proxyStore.flows);
});

app.delete('/api/proxy/flows', (req, res) => {
  proxyStore.flows.length = 0;
  broadcast('proxy-clear', {});
  res.json({ ok: true });
});

app.get('/api/proxy/info', (req, res) => {
  res.json({ proxyPort: PROXY_PORT, caReady: !!proxyCaPath });
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
    res.json(collectResponse(resp, text, startedAt));
  } catch (err) {
    res.json({ ok: false, durationMs: Date.now() - startedAt, error: err.cause ? `${err.message}: ${err.cause.message || err.cause.code}` : err.message });
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
  try {
    const fd = new FormData();
    for (const [k, v] of Object.entries(req.body)) {
      if (!k.startsWith('_')) fd.append(k, v);
    }
    for (const f of req.files || []) {
      fd.append(f.fieldname, new Blob([f.buffer], { type: f.mimetype }), f.originalname);
    }
    const resp = await fetch(targetUrl, { method, headers: extraHeaders, body: fd });
    const text = await resp.text();
    res.json(collectResponse(resp, text, startedAt));
  } catch (err) {
    res.json({ ok: false, durationMs: Date.now() - startedAt, error: err.cause ? `${err.message}: ${err.cause.message || err.cause.code}` : err.message });
  }
});

// ================= Start =================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Tester รันอยู่ที่ http://localhost:${PORT}`);
  console.log(`Hook endpoint: http://localhost:${PORT}/hook (รับทุก method ทุก path ย่อย)`);
});

startProxy({
  port: PROXY_PORT,
  caDir: CA_DIR,
  store: proxyStore,
  onFlow: (flow) => broadcast('proxy', flow),
})
  .then(({ caPath }) => {
    proxyCaPath = caPath;
    console.log(`MITM Proxy รันอยู่ที่พอร์ต ${PROXY_PORT} (ตั้ง proxy บนอุปกรณ์ชี้มาที่ IP เครื่องนี้:${PROXY_PORT})`);
    console.log(`CA cert: ${caPath} — ดาวน์โหลดผ่าน http://localhost:${PORT}/api/proxy/cert`);
  })
  .catch((err) => {
    console.error('เริ่ม MITM proxy ไม่สำเร็จ:', err.message);
  });
