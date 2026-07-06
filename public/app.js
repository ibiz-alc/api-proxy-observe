/* global exifr */

// ================= Tab switching =================
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ================= Helpers =================
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) node.appendChild(c);
  return node;
}

function kvTable(obj) {
  const table = el('table', { class: 'kv' });
  for (const [k, v] of Object.entries(obj)) {
    const tr = el('tr');
    tr.appendChild(el('td', { text: k }));
    tr.appendChild(el('td', { text: typeof v === 'object' ? JSON.stringify(v) : String(v) }));
    table.appendChild(tr);
  }
  return table;
}

function prettyBody(body) {
  if (body === null || body === undefined) return null;
  if (typeof body === 'object') return JSON.stringify(body, null, 2);
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return String(body);
  }
}

function methodBadge(method) {
  const known = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const cls = known.includes(method) ? method : 'OTHER';
  return el('span', { class: `method-badge method-${cls}`, text: method });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('th-TH', { hour12: false });
}

// ================= Inspector =================
const listEl = document.getElementById('request-list');
const detailEl = document.getElementById('request-detail');
let allRequests = [];
let selectedId = null;

const hookUrl = `${location.origin}/hook`;
document.getElementById('hook-url').textContent = hookUrl;
document.getElementById('copy-hook').addEventListener('click', () => {
  navigator.clipboard.writeText(hookUrl);
  document.getElementById('copy-hook').textContent = '✅ คัดลอกแล้ว';
  setTimeout(() => { document.getElementById('copy-hook').textContent = '📋 คัดลอก'; }, 1500);
});

document.getElementById('clear-requests').addEventListener('click', async () => {
  await fetch('/api/requests', { method: 'DELETE' });
});

function renderList() {
  listEl.innerHTML = '';
  if (!allRequests.length) {
    listEl.appendChild(el('p', { class: 'empty-msg', html: 'ยังไม่มี request เข้ามา<br/>ลองยิงข้อมูลมาที่ hook URL ด้านบน' }));
    return;
  }
  for (const r of allRequests) {
    const item = el('div', { class: 'req-item' + (r.id === selectedId ? ' selected' : '') }, [
      methodBadge(r.method),
      el('span', { class: 'req-path', text: r.path }),
      el('span', { class: 'req-time', text: fmtTime(r.time) }),
    ]);
    item.addEventListener('click', () => {
      selectedId = r.id;
      renderList();
      renderDetail(r);
    });
    listEl.appendChild(item);
  }
}

function renderDetail(r) {
  detailEl.innerHTML = '';
  detailEl.appendChild(el('div', { class: 'detail-header' }, [
    methodBadge(r.method),
    el('strong', { text: r.path }),
    el('span', { class: 'req-time', text: `${new Date(r.time).toLocaleString('th-TH')} • จาก ${r.ip}` }),
  ]));

  if (Object.keys(r.query || {}).length) {
    detailEl.appendChild(el('div', { class: 'section-title', text: 'Query Parameters' }));
    detailEl.appendChild(kvTable(r.query));
  }

  detailEl.appendChild(el('div', { class: 'section-title', text: 'Headers' }));
  detailEl.appendChild(kvTable(r.headers));

  const bodyText = prettyBody(r.body);
  if (bodyText) {
    detailEl.appendChild(el('div', { class: 'section-title', text: `Body ${r.contentType ? `(${r.contentType.split(';')[0]})` : ''}` }));
    detailEl.appendChild(el('pre', { class: 'code-block', text: bodyText }));
  }

  if (r.files && r.files.length) {
    detailEl.appendChild(el('div', { class: 'section-title', text: `ไฟล์แนบ (${r.files.length})` }));
    for (const f of r.files) {
      const url = `/api/requests/${r.id}/files/${f.index}`;
      const chip = el('div', { class: 'file-chip' });
      chip.appendChild(el('div', { html: `<a href="${url}" target="_blank">${f.name}</a> — ${f.mimetype} • ${(f.size / 1024).toFixed(1)} KB (field: ${f.field})` }));
      if (f.mimetype && f.mimetype.startsWith('image/')) {
        const img = el('img', { src: url, alt: f.name, title: 'คลิกเพื่อดู metadata ของภาพ' });
        const metaBtn = el('button', { class: 'meta-toggle-btn', type: 'button', text: '🔍 ดู metadata ของภาพ' });
        const metaContainer = el('div', { class: 'inline-meta', style: 'display:none' });
        let loaded = false;
        const toggleMeta = async () => {
          const isHidden = metaContainer.style.display === 'none';
          metaContainer.style.display = isHidden ? 'block' : 'none';
          metaBtn.textContent = isHidden ? '🔽 ซ่อน metadata' : '🔍 ดู metadata ของภาพ';
          if (isHidden && !loaded) {
            loaded = true;
            try {
              const blob = await (await fetch(url)).blob();
              await renderImageMetadata(metaContainer, blob, { name: f.name, size: f.size, type: f.mimetype });
            } catch (err) {
              metaContainer.innerHTML = `<p class="empty-msg">โหลดไฟล์เพื่ออ่าน metadata ไม่ได้: ${err.message}</p>`;
            }
          }
        };
        img.addEventListener('click', toggleMeta);
        metaBtn.addEventListener('click', toggleMeta);
        chip.appendChild(img);
        chip.appendChild(metaBtn);
        chip.appendChild(metaContainer);
      }
      detailEl.appendChild(chip);
    }
  }
}

async function loadRequests() {
  allRequests = await (await fetch('/api/requests')).json();
  renderList();
  renderMobileGallery();
}

const events = new EventSource('/api/events');
events.addEventListener('request', (e) => {
  const entry = JSON.parse(e.data);
  allRequests.unshift(entry);
  if (allRequests.length > 200) allRequests.pop();
  renderList();
  renderMobileGallery();
});
events.addEventListener('clear', () => {
  allRequests = [];
  selectedId = null;
  selectedMobileId = null;
  renderList();
  renderMobileGallery();
  detailEl.innerHTML = '<p class="empty-msg">เลือก request จากรายการด้านซ้ายเพื่อดูรายละเอียด</p>';
  document.getElementById('mobile-detail').innerHTML = '<p class="empty-msg">เลือกไฟล์จากรายการด้านซ้ายเพื่อดูรายละเอียดและ metadata</p>';
});
events.addEventListener('proxy', (e) => {
  const flow = JSON.parse(e.data);
  allFlows.unshift(flow);
  if (allFlows.length > 300) allFlows.pop();
  renderFlowList();
  if (flow.id === selectedFlowId) renderFlowDetail(flow);
});
events.addEventListener('proxy-clear', () => {
  allFlows = [];
  selectedFlowId = null;
  renderFlowList();
  flowDetailEl.innerHTML = '<p class="empty-msg">เลือก flow จากรายการด้านซ้ายเพื่อดู request/response</p>';
});

loadRequests();

// ================= Sender =================
const bodyJsonEl = document.getElementById('send-body-json');
const bodyFormEl = document.getElementById('send-body-form');
const formFieldsEl = document.getElementById('form-fields');
const sendResultEl = document.getElementById('send-result');

document.querySelectorAll('input[name="body-type"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    bodyJsonEl.style.display = radio.value === 'json' && radio.checked ? 'block' : 'none';
    bodyFormEl.style.display = radio.value === 'form' && radio.checked ? 'block' : 'none';
    if (radio.checked && radio.value === 'form' && !formFieldsEl.children.length) addFormField('text');
  });
});

function addFormField(type) {
  const row = el('div', { class: 'form-field-row' });
  const key = el('input', { type: 'text', placeholder: 'ชื่อ field' });
  const value = type === 'file'
    ? el('input', { type: 'file' })
    : el('input', { type: 'text', placeholder: 'ค่า' });
  const remove = el('button', { class: 'remove-field', type: 'button', text: '✕' });
  remove.addEventListener('click', () => row.remove());
  row.append(key, value, remove);
  formFieldsEl.appendChild(row);
}

document.getElementById('add-text-field').addEventListener('click', () => addFormField('text'));
document.getElementById('add-file-field').addEventListener('click', () => addFormField('file'));

function parseHeaderLines(text) {
  const headers = {};
  for (const line of text.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function renderSendResult(result) {
  sendResultEl.innerHTML = '';
  if (!result.ok) {
    sendResultEl.appendChild(el('div', { class: 'detail-header' }, [
      el('span', { class: 'status-badge status-err', text: 'ERROR' }),
      el('span', { class: 'req-time', text: `${result.durationMs} ms` }),
    ]));
    sendResultEl.appendChild(el('pre', { class: 'code-block', text: result.error }));
    return;
  }
  const cls = `status-${Math.floor(result.status / 100)}xx`;
  sendResultEl.appendChild(el('div', { class: 'detail-header' }, [
    el('span', { class: `status-badge ${cls}`, text: `${result.status} ${result.statusText}` }),
    el('span', { class: 'req-time', text: `${result.durationMs} ms` }),
  ]));
  sendResultEl.appendChild(el('div', { class: 'section-title', text: 'Response Headers' }));
  sendResultEl.appendChild(kvTable(result.headers));
  sendResultEl.appendChild(el('div', { class: 'section-title', text: 'Response Body' }));
  sendResultEl.appendChild(el('pre', { class: 'code-block', text: prettyBody(result.body) || '(ว่าง)' }));
}

document.getElementById('send-btn').addEventListener('click', async () => {
  const url = document.getElementById('send-url').value.trim();
  const method = document.getElementById('send-method').value;
  const headers = parseHeaderLines(document.getElementById('send-headers').value);
  const bodyType = document.querySelector('input[name="body-type"]:checked').value;
  if (!url) {
    sendResultEl.innerHTML = '<p class="empty-msg">กรุณากรอก URL ก่อนส่ง</p>';
    return;
  }
  sendResultEl.innerHTML = '<p class="empty-msg">⏳ กำลังส่ง...</p>';
  try {
    let result;
    if (bodyType === 'form') {
      const fd = new FormData();
      fd.append('_url', url);
      fd.append('_method', method);
      fd.append('_headers', JSON.stringify(headers));
      for (const row of formFieldsEl.querySelectorAll('.form-field-row')) {
        const [keyInput, valueInput] = row.querySelectorAll('input');
        const key = keyInput.value.trim();
        if (!key) continue;
        if (valueInput.type === 'file') {
          if (valueInput.files[0]) fd.append(key, valueInput.files[0]);
        } else {
          fd.append(key, valueInput.value);
        }
      }
      result = await (await fetch('/api/send-form', { method: 'POST', body: fd })).json();
    } else {
      const payload = { url, method, headers };
      if (bodyType === 'json') {
        const raw = bodyJsonEl.value.trim();
        if (raw) {
          try {
            JSON.parse(raw);
          } catch {
            sendResultEl.innerHTML = '<p class="empty-msg">⚠️ Body ไม่ใช่ JSON ที่ถูกต้อง กรุณาตรวจสอบ</p>';
            return;
          }
          payload.body = raw;
        }
      }
      result = await (await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })).json();
    }
    renderSendResult(result);
  } catch (err) {
    renderSendResult({ ok: false, durationMs: 0, error: err.message });
  }
});

// ================= URL Metadata =================
const urlInput = document.getElementById('url-input');
const urlPreview = document.getElementById('url-preview');
const urlMetaEl = document.getElementById('url-meta');

async function readUrlMetadata() {
  const url = urlInput.value.trim();
  if (!url) {
    urlMetaEl.innerHTML = '<p class="empty-msg">กรุณาวาง URL รูปก่อน</p>';
    return;
  }
  const withAddress = document.getElementById('url-address').checked;
  urlPreview.src = url;
  urlPreview.style.display = 'block';
  urlPreview.onerror = () => { urlPreview.style.display = 'none'; };
  urlMetaEl.innerHTML = '<p class="empty-msg">⏳ กำลังดึงรูปและอ่าน metadata...</p>';

  let data;
  try {
    const resp = await fetch(`/api/url-metadata?url=${encodeURIComponent(url)}&address=${withAddress ? '1' : '0'}`);
    data = await resp.json();
  } catch (err) {
    urlMetaEl.innerHTML = `<p class="empty-msg">เรียก API ไม่สำเร็จ: ${err.message}</p>`;
    return;
  }

  if (!data.ok) {
    urlMetaEl.innerHTML = `<p class="empty-msg">อ่านไม่ได้: ${data.error}</p>`;
    return;
  }

  urlMetaEl.innerHTML = '';
  const highlight = el('div', { class: 'meta-highlight' });
  urlMetaEl.appendChild(el('div', { class: 'section-title', text: 'ข้อมูลสำคัญ' }));
  urlMetaEl.appendChild(highlight);

  highlight.appendChild(metaCard('🗂️ ไฟล์', `${(data.size / 1024).toFixed(1)} KB • ${data.contentType}`));

  const m = data.metadata;
  if (!m) {
    highlight.appendChild(metaCard('ℹ️ ผลการอ่าน', 'รูปนี้ไม่มี EXIF metadata ฝังอยู่ (อาจถูกลบตอนส่งผ่านแอปแชท หรือ export ใหม่)'));
    return;
  }

  if (m.imageDescription) highlight.appendChild(metaCard('📝 คำอธิบายภาพ', String(m.imageDescription)));
  highlight.appendChild(metaCard('📅 วันที่ถ่าย', m.dateTaken ? fmtDate(m.dateTaken) : 'ไม่พบข้อมูลวันที่'));
  if (m.camera) highlight.appendChild(metaCard('📷 กล้อง / อุปกรณ์', m.camera));
  if (m.width && m.height) highlight.appendChild(metaCard('📐 ขนาดภาพ', `${m.width} × ${m.height} พิกเซล`));

  if (m.latitude != null && m.longitude != null) {
    const lat = m.latitude.toFixed(6);
    const lon = m.longitude.toFixed(6);
    highlight.appendChild(metaCard('📍 พิกัด GPS (Location)', el('div', {
      html: `${lat}, ${lon}<br/><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">🗺️ เปิดใน Google Maps</a>`,
    })));
    if (m.address) highlight.appendChild(metaCard('🏠 ที่อยู่ (Address)', m.address));
    else if (m.addressError) highlight.appendChild(metaCard('🏠 ที่อยู่ (Address)', `หาที่อยู่ไม่สำเร็จ: ${m.addressError}`));
  } else {
    highlight.appendChild(metaCard('📍 พิกัด GPS (Location)', 'ไม่พบข้อมูลพิกัดในรูปนี้'));
  }

  urlMetaEl.appendChild(el('div', { class: 'section-title', text: 'Metadata (สรุป)' }));
  const flat = {};
  for (const [k, v] of Object.entries(m)) {
    if (v == null) continue;
    flat[k] = k === 'dateTaken' ? fmtDate(v) : String(v);
  }
  urlMetaEl.appendChild(kvTable(flat));
}

document.getElementById('url-read-btn').addEventListener('click', readUrlMetadata);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') readUrlMetadata(); });

// ================= Proxy (MITM) =================
const flowListEl = document.getElementById('flow-list');
const flowDetailEl = document.getElementById('flow-detail');
let allFlows = [];
let selectedFlowId = null;

(async function initProxy() {
  const info = await (await fetch('/api/proxy/info')).json();
  const host = location.hostname;
  document.getElementById('proxy-addr').textContent = `${host}:${info.proxyPort}`;
  document.getElementById('proxy-ip').textContent = host;
  document.getElementById('proxy-port').textContent = info.proxyPort;
  document.getElementById('proxy-cert-url').textContent = `${location.origin}/api/proxy/cert`;
  allFlows = await (await fetch('/api/proxy/flows')).json();
  renderFlowList();
})();

document.getElementById('proxy-cert-btn').addEventListener('click', () => {
  window.location.href = '/api/proxy/cert';
});
document.getElementById('proxy-help-btn').addEventListener('click', () => {
  const help = document.getElementById('proxy-help');
  help.style.display = help.style.display === 'none' ? 'block' : 'none';
});
document.getElementById('clear-flows').addEventListener('click', async () => {
  await fetch('/api/proxy/flows', { method: 'DELETE' });
});

function statusClass(status) {
  if (!status) return 'status-err';
  return `status-${Math.floor(status / 100)}xx`;
}

function renderFlowList() {
  flowListEl.innerHTML = '';
  if (!allFlows.length) {
    flowListEl.appendChild(el('p', { class: 'empty-msg', html: 'ยังไม่มีทราฟฟิกผ่าน proxy<br/>ตั้ง proxy บนอุปกรณ์แล้วเปิดแอป/เว็บ' }));
    return;
  }
  for (const f of allFlows) {
    const statusText = f.error ? 'ERR' : (f.status || '...');
    const item = el('div', { class: 'req-item' + (f.id === selectedFlowId ? ' selected' : '') }, [
      methodBadge(f.method),
      el('span', { class: `status-badge ${statusClass(f.status)}`, text: String(statusText) }),
      el('span', { class: 'req-path', text: f.host + f.path, title: f.url }),
      el('span', { class: 'req-time', text: f.durationMs != null ? f.durationMs + 'ms' : '' }),
    ]);
    item.addEventListener('click', () => {
      selectedFlowId = f.id;
      renderFlowList();
      renderFlowDetail(f);
    });
    flowListEl.appendChild(item);
  }
}

function renderFlowDetail(f) {
  flowDetailEl.innerHTML = '';
  flowDetailEl.appendChild(el('div', { class: 'detail-header' }, [
    methodBadge(f.method),
    f.error
      ? el('span', { class: 'status-badge status-err', text: 'ERROR' })
      : el('span', { class: `status-badge ${statusClass(f.status)}`, text: `${f.status} ${f.statusText || ''}` }),
    el('span', { class: 'req-time', text: `${f.durationMs != null ? f.durationMs + ' ms • ' : ''}${new Date(f.time).toLocaleString('th-TH')}` }),
  ]));
  flowDetailEl.appendChild(el('div', { class: 'section-title', text: 'URL' }));
  flowDetailEl.appendChild(el('pre', { class: 'code-block', text: f.url }));

  if (f.error) {
    flowDetailEl.appendChild(el('div', { class: 'section-title', text: 'Error' }));
    flowDetailEl.appendChild(el('pre', { class: 'code-block', text: f.error }));
  }

  flowDetailEl.appendChild(el('div', { class: 'section-title', text: 'Request Headers' }));
  flowDetailEl.appendChild(kvTable(f.reqHeaders || {}));
  if (f.reqBody) {
    flowDetailEl.appendChild(el('div', { class: 'section-title', text: 'Request Body' }));
    flowDetailEl.appendChild(el('pre', { class: 'code-block', text: prettyBody(f.reqBody) }));
  }

  if (f.resHeaders) {
    flowDetailEl.appendChild(el('div', { class: 'section-title', text: 'Response Headers' }));
    flowDetailEl.appendChild(kvTable(f.resHeaders));
  }
  if (f.resBody) {
    flowDetailEl.appendChild(el('div', { class: 'section-title', text: 'Response Body' }));
    flowDetailEl.appendChild(el('pre', { class: 'code-block', text: prettyBody(f.resBody) }));
  }
}

// ================= Image Metadata =================
const imageInput = document.getElementById('image-input');
const imageDrop = document.getElementById('image-drop');
const imagePreview = document.getElementById('image-preview');
const imageMetaEl = document.getElementById('image-meta');

imageDrop.addEventListener('dragover', (e) => { e.preventDefault(); imageDrop.classList.add('dragover'); });
imageDrop.addEventListener('dragleave', () => imageDrop.classList.remove('dragover'));
imageDrop.addEventListener('drop', (e) => {
  e.preventDefault();
  imageDrop.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleImage(e.dataTransfer.files[0]);
});
imageInput.addEventListener('change', () => {
  if (imageInput.files[0]) handleImage(imageInput.files[0]);
});

function metaCard(label, valueNode) {
  const card = el('div', { class: 'meta-card' });
  card.appendChild(el('div', { class: 'meta-label', text: label }));
  const value = el('div', { class: 'meta-value' });
  if (typeof valueNode === 'string') value.textContent = valueNode;
  else value.appendChild(valueNode);
  card.appendChild(value);
  return card;
}

function fmtDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date)) return String(d);
  return date.toLocaleString('th-TH', { dateStyle: 'full', timeStyle: 'medium' });
}

// EXIF ImageDescription ตามสเปคเป็น ASCII แต่หลายแอปเขียนเป็น UTF-8 หรือ TIS-620 (ไทย)
// exifr decode เป็น UTF-8 อย่างเดียว ถ้าเจอ � (แสดงเป็น ?????) ต้องดึง bytes ดิบมา decode ใหม่
function extractIfd0AsciiTag(buffer, wantedTag) {
  const buf = new DataView(buffer);
  if (buf.getUint16(0) !== 0xffd8) return null; // ไม่ใช่ JPEG
  let off = 2;
  while (off + 4 < buf.byteLength) {
    const marker = buf.getUint16(off);
    const size = buf.getUint16(off + 2);
    if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) { // APP1 'Exif'
      const tiff = off + 10;
      const little = buf.getUint16(tiff) === 0x4949; // 'II' = little endian
      const ifdOff = buf.getUint32(tiff + 4, little);
      const count = buf.getUint16(tiff + ifdOff, little);
      for (let i = 0; i < count; i++) {
        const e = tiff + ifdOff + 2 + i * 12;
        if (buf.getUint16(e, little) === wantedTag) {
          const n = buf.getUint32(e + 4, little);
          const valOff = n <= 4 ? e + 8 : tiff + buf.getUint32(e + 8, little);
          let bytes = new Uint8Array(buffer, valOff, n);
          while (bytes.length && bytes[bytes.length - 1] === 0) bytes = bytes.subarray(0, bytes.length - 1);
          return bytes;
        }
      }
      return null;
    }
    if ((marker & 0xff00) !== 0xff00) return null;
    off += 2 + size;
  }
  return null;
}

async function fixTextEncoding(blob, meta, key, tagId) {
  const value = meta[key];
  if (typeof value !== 'string' || !value.includes('�')) return;
  try {
    const buffer = await blob.slice(0, 512 * 1024).arrayBuffer();
    const raw = extractIfd0AsciiTag(buffer, tagId);
    if (!raw) return;
    for (const enc of ['utf-8', 'windows-874']) {
      try {
        const text = new TextDecoder(enc, { fatal: true }).decode(raw);
        if (!text.includes('�')) {
          meta[key] = text;
          return;
        }
      } catch { /* ลอง encoding ถัดไป */ }
    }
  } catch { /* อ่านไม่ได้ก็ใช้ค่าเดิมจาก exifr */ }
}

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=th`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Nominatim ตอบกลับ ${resp.status}`);
  const data = await resp.json();
  return data.display_name || null;
}

// อ่าน EXIF จาก blob/file แล้ววาดผลลัพธ์ลงใน container — ใช้ร่วมกันทั้งแท็บ Image และ Mobile Files
async function renderImageMetadata(container, blob, info) {
  container.innerHTML = '<p class="empty-msg">⏳ กำลังอ่าน metadata...</p>';

  let meta;
  try {
    meta = await exifr.parse(blob, { gps: true, exif: true, tiff: true, xmp: true, iptc: true });
  } catch (err) {
    container.innerHTML = `<p class="empty-msg">อ่าน metadata ไม่ได้: ${err.message}</p>`;
    return;
  }

  if (meta) {
    // ซ่อมข้อความไทยที่ decode ผิด (แสดงเป็น ?????) ใน tag ข้อความของ IFD0
    await fixTextEncoding(blob, meta, 'ImageDescription', 0x010e);
    await fixTextEncoding(blob, meta, 'Artist', 0x013b);
    await fixTextEncoding(blob, meta, 'Copyright', 0x8298);
  }

  container.innerHTML = '';
  const highlight = el('div', { class: 'meta-highlight' });
  container.appendChild(el('div', { class: 'section-title', text: 'ข้อมูลสำคัญ' }));
  container.appendChild(highlight);

  // ---- ไฟล์ ----
  highlight.appendChild(metaCard('🗂️ ไฟล์', `${info.name} • ${(info.size / 1024).toFixed(1)} KB • ${info.type || 'ไม่ทราบชนิด'}`));

  if (!meta) {
    highlight.appendChild(metaCard('ℹ️ ผลการอ่าน', 'รูปนี้ไม่มี metadata ฝังอยู่ (อาจถูกลบตอนส่งผ่านแอปแชท หรือถูก export ใหม่)'));
    return;
  }

  // ---- คำอธิบายภาพ ----
  if (meta.ImageDescription) {
    const desc = String(meta.ImageDescription);
    const card = metaCard('📝 คำอธิบายภาพ (ImageDescription)', desc);
    if (/\?{3,}/.test(desc)) {
      // bytes ในไฟล์เป็นตัว '?' จริงๆ — แอปที่เขียน EXIF แทนที่ตัวอักษรไทยตอนบันทึก กู้คืนไม่ได้
      card.appendChild(el('div', {
        class: 'meta-label',
        text: '⚠️ ข้อความส่วนที่เป็น ? ถูกแทนที่ตั้งแต่ตอนแอปต้นทางเขียนไฟล์ (EXIF tag นี้รองรับเฉพาะ ASCII ในบางไลบรารี) — ต้องแก้ที่แอปที่เขียน EXIF',
      }));
    }
    highlight.appendChild(card);
  }

  // ---- วันที่ถ่าย ----
  const dateTaken = meta.DateTimeOriginal || meta.CreateDate || meta.ModifyDate;
  highlight.appendChild(metaCard('📅 วันที่ถ่าย', fmtDate(dateTaken) || 'ไม่พบข้อมูลวันที่'));

  // ---- กล้อง ----
  const camera = [meta.Make, meta.Model].filter(Boolean).join(' ');
  if (camera) highlight.appendChild(metaCard('📷 กล้อง / อุปกรณ์', camera + (meta.LensModel ? ` (เลนส์: ${meta.LensModel})` : '')));

  // ---- ขนาดภาพ ----
  const w = meta.ExifImageWidth || meta.ImageWidth;
  const h = meta.ExifImageHeight || meta.ImageHeight;
  if (w && h) highlight.appendChild(metaCard('📐 ขนาดภาพ', `${w} × ${h} พิกเซล`));

  // ---- GPS + ที่อยู่ ----
  if (meta.latitude !== undefined && meta.longitude !== undefined) {
    const lat = meta.latitude.toFixed(6);
    const lon = meta.longitude.toFixed(6);
    const gpsNode = el('div', {
      html: `${lat}, ${lon}<br/><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">🗺️ เปิดใน Google Maps</a>`,
    });
    highlight.appendChild(metaCard('📍 พิกัด GPS (Location)', gpsNode));

    const addressCard = metaCard('🏠 ที่อยู่ (Address)', '⏳ กำลังค้นหาที่อยู่จากพิกัด...');
    highlight.appendChild(addressCard);
    reverseGeocode(lat, lon)
      .then((address) => {
        addressCard.querySelector('.meta-value').textContent = address || 'ไม่พบที่อยู่สำหรับพิกัดนี้';
      })
      .catch((err) => {
        addressCard.querySelector('.meta-value').textContent = `ค้นหาที่อยู่ไม่สำเร็จ (${err.message}) — ต้องต่ออินเทอร์เน็ตเพื่อใช้งานส่วนนี้`;
      });
  } else {
    highlight.appendChild(metaCard('📍 พิกัด GPS (Location)', 'ไม่พบข้อมูลพิกัดในรูปนี้'));
  }

  // ---- Metadata ทั้งหมด ----
  container.appendChild(el('div', { class: 'section-title', text: 'Metadata ทั้งหมด' }));
  const flat = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Date) flat[k] = fmtDate(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flat[k] = JSON.stringify(v);
    else if (Array.isArray(v)) flat[k] = v.join(', ');
    else flat[k] = v;
  }
  container.appendChild(kvTable(flat));
}

async function handleImage(file) {
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.style.display = 'block';
  await renderImageMetadata(imageMetaEl, file, { name: file.name, size: file.size, type: file.type });
}

// ================= Mobile Files =================
const MOBILE_HOOK = '/hook/mobile-upload';
const mobileGalleryEl = document.getElementById('mobile-gallery');
const mobileDetailEl = document.getElementById('mobile-detail');
const mobileStatusEl = document.getElementById('mobile-upload-status');
let selectedMobileId = null;

document.getElementById('mobile-hook-url').textContent = location.origin + MOBILE_HOOK;

const UPLOAD_PATHS = [MOBILE_HOOK, '/api/upload'];

function mobileEntries() {
  return allRequests.filter((r) => UPLOAD_PATHS.some((p) => r.path.startsWith(p)) && r.files && r.files.length);
}

function renderMobileGallery() {
  const entries = mobileEntries();
  mobileGalleryEl.innerHTML = '';
  if (!entries.length) {
    mobileGalleryEl.appendChild(el('p', { class: 'empty-msg', html: 'ยังไม่มีไฟล์ส่งเข้ามา<br/>แนบรูปจากมือถือแล้วจะแสดงที่นี่ทันที' }));
    return;
  }
  for (const r of entries) {
    const firstImage = r.files.find((f) => f.mimetype && f.mimetype.startsWith('image/'));
    const item = el('div', { class: 'req-item gallery-item' + (r.id === selectedMobileId ? ' selected' : '') });
    if (firstImage) {
      item.appendChild(el('img', { class: 'thumb', src: `/api/requests/${r.id}/files/${firstImage.index}`, alt: firstImage.name }));
    } else {
      item.appendChild(el('span', { class: 'thumb-placeholder', text: '📄' }));
    }
    const note = r.body && r.body.note ? r.body.note : '';
    const names = r.files.map((f) => f.name).join(', ');
    item.appendChild(el('div', { class: 'gallery-info' }, [
      el('div', { class: 'req-path', text: names }),
      el('div', { class: 'req-time', text: `${fmtTime(r.time)} • ${r.files.length} ไฟล์${note ? ' • ' + note : ''}` }),
    ]));
    item.addEventListener('click', () => {
      selectedMobileId = r.id;
      renderMobileGallery();
      renderMobileDetail(r);
    });
    mobileGalleryEl.appendChild(item);
  }
}

async function renderMobileDetail(r) {
  mobileDetailEl.innerHTML = '';
  mobileDetailEl.appendChild(el('div', { class: 'detail-header' }, [
    el('strong', { text: `📱 ไฟล์แนบ ${r.files.length} รายการ` }),
    el('span', { class: 'req-time', text: `${new Date(r.time).toLocaleString('th-TH')} • จาก ${r.ip}` }),
  ]));

  const info = {
    'เวลาที่ส่ง': new Date(r.time).toLocaleString('th-TH'),
    'ส่งจาก (IP)': r.ip,
    'อุปกรณ์ (User-Agent)': r.headers['user-agent'] || '-',
  };
  if (r.body && r.body.note) info['หมายเหตุ'] = r.body.note;
  mobileDetailEl.appendChild(el('div', { class: 'section-title', text: 'ข้อมูลผู้ส่ง' }));
  mobileDetailEl.appendChild(kvTable(info));

  for (const f of r.files) {
    const url = `/api/requests/${r.id}/files/${f.index}`;
    mobileDetailEl.appendChild(el('div', { class: 'section-title', text: `ไฟล์: ${f.name} (${(f.size / 1024).toFixed(1)} KB)` }));
    if (f.mimetype && f.mimetype.startsWith('image/')) {
      mobileDetailEl.appendChild(el('img', { class: 'mobile-image-preview', src: url, alt: f.name }));
      const metaContainer = el('div');
      mobileDetailEl.appendChild(metaContainer);
      try {
        const blob = await (await fetch(url)).blob();
        await renderImageMetadata(metaContainer, blob, { name: f.name, size: f.size, type: f.mimetype });
      } catch (err) {
        metaContainer.innerHTML = `<p class="empty-msg">โหลดไฟล์เพื่ออ่าน metadata ไม่ได้: ${err.message}</p>`;
      }
    } else {
      const chip = el('div', { class: 'file-chip' });
      chip.appendChild(el('div', { html: `<a href="${url}" target="_blank">${f.name}</a> — ${f.mimetype} • ${(f.size / 1024).toFixed(1)} KB` }));
      mobileDetailEl.appendChild(chip);
    }
  }
}

document.getElementById('mobile-upload-btn').addEventListener('click', async () => {
  const filesInput = document.getElementById('mobile-files');
  const noteInput = document.getElementById('mobile-note');
  if (!filesInput.files.length) {
    mobileStatusEl.textContent = '⚠️ กรุณาเลือกรูปก่อน';
    return;
  }
  mobileStatusEl.textContent = '⏳ กำลังส่ง...';
  try {
    const fd = new FormData();
    if (noteInput.value.trim()) fd.append('note', noteInput.value.trim());
    for (const f of filesInput.files) fd.append('image', f);
    const resp = await fetch(MOBILE_HOOK, { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(`server ตอบกลับ ${resp.status}`);
    mobileStatusEl.textContent = '✅ ส่งแล้ว';
    filesInput.value = '';
    noteInput.value = '';
    setTimeout(() => { mobileStatusEl.textContent = ''; }, 3000);
  } catch (err) {
    mobileStatusEl.textContent = `❌ ส่งไม่สำเร็จ: ${err.message}`;
  }
});
