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
        chip.appendChild(el('img', { src: url, alt: f.name }));
      }
      detailEl.appendChild(chip);
    }
  }
}

async function loadRequests() {
  allRequests = await (await fetch('/api/requests')).json();
  renderList();
}

const events = new EventSource('/api/events');
events.addEventListener('request', (e) => {
  const entry = JSON.parse(e.data);
  allRequests.unshift(entry);
  if (allRequests.length > 200) allRequests.pop();
  renderList();
});
events.addEventListener('clear', () => {
  allRequests = [];
  selectedId = null;
  renderList();
  detailEl.innerHTML = '<p class="empty-msg">เลือก request จากรายการด้านซ้ายเพื่อดูรายละเอียด</p>';
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

async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=th`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Nominatim ตอบกลับ ${resp.status}`);
  const data = await resp.json();
  return data.display_name || null;
}

async function handleImage(file) {
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.style.display = 'block';
  imageMetaEl.innerHTML = '<p class="empty-msg">⏳ กำลังอ่าน metadata...</p>';

  let meta;
  try {
    meta = await exifr.parse(file, { gps: true, exif: true, tiff: true, xmp: true, iptc: true });
  } catch (err) {
    imageMetaEl.innerHTML = `<p class="empty-msg">อ่าน metadata ไม่ได้: ${err.message}</p>`;
    return;
  }

  imageMetaEl.innerHTML = '';
  const highlight = el('div', { class: 'meta-highlight' });
  imageMetaEl.appendChild(el('div', { class: 'section-title', text: 'ข้อมูลสำคัญ' }));
  imageMetaEl.appendChild(highlight);

  // ---- ไฟล์ ----
  highlight.appendChild(metaCard('🗂️ ไฟล์', `${file.name} • ${(file.size / 1024).toFixed(1)} KB • ${file.type || 'ไม่ทราบชนิด'}`));

  if (!meta) {
    highlight.appendChild(metaCard('ℹ️ ผลการอ่าน', 'รูปนี้ไม่มี metadata ฝังอยู่ (อาจถูกลบตอนส่งผ่านแอปแชท หรือถูก export ใหม่)'));
    return;
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
  imageMetaEl.appendChild(el('div', { class: 'section-title', text: 'Metadata ทั้งหมด' }));
  const flat = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v instanceof Date) flat[k] = fmtDate(v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flat[k] = JSON.stringify(v);
    else if (Array.isArray(v)) flat[k] = v.join(', ');
    else flat[k] = v;
  }
  imageMetaEl.appendChild(kvTable(flat));
}
