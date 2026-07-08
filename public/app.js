/* global exifr */

// ngrok-free แทรกหน้าเตือน (interstitial) กับ request ที่ไม่มี header นี้ ทำให้ API คืน HTML แทน JSON
// ครอบ fetch ให้แนบ header เสมอ เพื่อให้ใช้งานผ่าน ngrok ได้เหมือน local
const _origFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const headers = new Headers(opts.headers || {});
  headers.set('ngrok-skip-browser-warning', 'true');
  return _origFetch(url, { ...opts, headers });
};

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

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ใส่สีให้ JSON: key / string / number / boolean / null คนละสี เน้น key ให้อ่านง่าย
function syntaxHighlightJson(jsonStr) {
  return escapeHtml(jsonStr).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-num';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-str';
      else if (/true|false/.test(match)) cls = 'json-bool';
      else if (/null/.test(match)) cls = 'json-null';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

// ปุ่ม copy เล็กๆ มุมขวาบนของ code block
function copyButton(getText) {
  const btn = el('button', { class: 'copy-btn', type: 'button', text: '📋 Copy', title: 'คัดลอก' });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(getText());
    btn.textContent = '✅ Copied';
    setTimeout(() => { btn.textContent = '📋 Copy'; }, 1200);
  });
  return btn;
}

// สร้างกล่องโชว์ body: ถ้าเป็น JSON จะจัดสีให้, ไม่ใช่ก็เป็นข้อความธรรมดา + ปุ่ม copy มุมขวาบน
function bodyBlock(raw) {
  const text = prettyBody(raw);
  if (text == null || text === '') return el('pre', { class: 'code-block', text: '(ไม่มี body)' });
  let isJson = false;
  try { JSON.parse(typeof raw === 'object' ? JSON.stringify(raw) : raw); isJson = true; } catch { isJson = false; }
  const pre = isJson
    ? el('pre', { class: 'code-block json', html: syntaxHighlightJson(text) })
    : el('pre', { class: 'code-block', text });
  return el('div', { class: 'code-wrap' }, [copyButton(() => text), pre]);
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
    const parts = [methodBadge(r.method)];
    if (r.source === 'sender') parts.push(el('span', { class: 'sent-badge', title: 'ยิงจากแท็บ Sender', text: '↗ SENT' }));
    parts.push(el('span', { class: 'req-path', text: r.path }));
    parts.push(el('span', { class: 'req-time', text: fmtTime(r.time) }));
    const item = el('div', { class: 'req-item' + (r.id === selectedId ? ' selected' : '') }, parts);
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
    detailEl.appendChild(bodyBlock(r.body));
  }

  // response ที่ได้กลับมา (เฉพาะ entry ที่มาจาก Sender)
  if (r.senderResponse) {
    if (r.senderResponse.error) {
      detailEl.appendChild(el('div', { class: 'section-title', text: '↙ Response (จาก Sender)' }));
      detailEl.appendChild(el('pre', { class: 'code-block', text: 'ERROR: ' + r.senderResponse.error }));
    } else {
      detailEl.appendChild(el('div', { class: 'section-title', text: `↙ Response (จาก Sender) — HTTP ${r.senderResponse.status}` }));
      detailEl.appendChild(r.senderResponse.body ? bodyBlock(r.senderResponse.body) : el('pre', { class: 'code-block', text: '(response ว่าง)' }));
    }
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
  const idx = allFlows.findIndex((x) => x.id === flow.id);
  if (idx >= 0) allFlows[idx] = flow;        // upsert (blocked entry อัปเดต count)
  else {
    allFlows.unshift(flow);
    if (allFlows.length > 300) allFlows.pop();
  }
  renderProxy();
  if (flow.id === selectedFlowId) renderFlowDetail(flow);
});
events.addEventListener('proxy-clear', () => {
  allFlows = [];
  selectedFlowId = null;
  renderProxy();
  flowDetailEl.innerHTML = '<p class="empty-msg">เลือกแถวด้านบนเพื่อดู Request / Response</p>';
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
  sendResultEl.appendChild(result.body ? bodyBlock(result.body) : el('pre', { class: 'code-block', text: '(ว่าง)' }));
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

// ================= Proxy (MITM) — Proxyman-style =================
const flowListBody = document.getElementById('flow-list-body');
const flowEmptyEl = document.getElementById('flow-empty');
const flowDetailEl = document.getElementById('flow-detail');
const deviceTreeBody = document.getElementById('device-tree-body');
let allFlows = [];
let selectedFlowId = null;

// filter state
let flowFilter = '';
let flowField = 'url';   // url | host | path
let flowMatch = 'contains'; // contains | equals
let selDevice = '';      // '' = ทุก device
let selHost = '';        // '' = ทุก host (ใน device ที่เลือก)
// sub-tabs ของ detail
let reqTab = 'Header';
let resTab = 'Body';

(async function initProxy() {
  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  let lanIp = isLocal ? null : host;
  try { lanIp = (await (await fetch('/api/proxy/info')).json()).lanIp || lanIp; } catch { /* ใช้ค่า fallback */ }
  document.getElementById('postern-host').textContent = isLocal ? '127.0.0.1' : host;
  document.getElementById('postern-lan').textContent = lanIp || '<IP วง LAN ของ Mac>';
  // help box (อ้าง mitmproxy backend)
  const pip = document.getElementById('proxy-ip'); if (pip) pip.textContent = host;
  const pport = document.getElementById('proxy-port'); if (pport) pport.textContent = '8888';
  const pcert = document.getElementById('proxy-cert-url'); if (pcert) pcert.textContent = 'http://mitm.it (ผ่าน proxy) หรือปุ่ม "ติดตั้ง CA" ในแอป';
  allFlows = await (await fetch('/api/proxy/flows')).json();
  renderProxy();
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
document.getElementById('flow-filter').addEventListener('input', (e) => {
  flowFilter = e.target.value.trim().toLowerCase();
  renderFlowTable();
});
document.getElementById('flow-field').addEventListener('change', (e) => {
  flowField = e.target.value;
  renderFlowTable();
});
document.getElementById('flow-match').addEventListener('change', (e) => {
  flowMatch = e.target.value;
  renderFlowTable();
});

function statusClass(status) {
  if (!status) return 'status-err';
  return `status-${Math.floor(status / 100)}xx`;
}

function fmtSize(bytes) {
  if (!bytes) return '–';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// กรองตาม field/ข้อความ และ device/host ที่เลือกจาก tree
function filteredFlows() {
  return allFlows.filter((f) => {
    if (selDevice && f.device !== selDevice) return false;
    if (selHost && f.host !== selHost) return false;
    if (flowFilter) {
      const hay = (f[flowField] || '').toLowerCase();
      if (flowMatch === 'equals' ? hay !== flowFilter : !hay.includes(flowFilter)) return false;
    }
    return true;
  });
}

// ---- device tree (ซ้าย) ----
function renderDeviceTree() {
  deviceTreeBody.innerHTML = '';
  const allItem = el('div', { class: 'tree-item tree-device' + (!selDevice ? ' active' : '') }, [
    el('span', { class: 'tree-label', text: '🌐 ทุก device' }),
    el('span', { class: 'tree-count', text: String(allFlows.length) }),
  ]);
  allItem.addEventListener('click', () => { selDevice = ''; selHost = ''; renderProxy(); });
  deviceTreeBody.appendChild(allItem);

  const byDevice = new Map();
  for (const f of allFlows) {
    if (!byDevice.has(f.device)) byDevice.set(f.device, new Map());
    const byHost = byDevice.get(f.device);
    byHost.set(f.host, (byHost.get(f.host) || 0) + 1);
  }

  for (const [device, hosts] of byDevice) {
    const total = [...hosts.values()].reduce((a, b) => a + b, 0);
    const devItem = el('div', { class: 'tree-item tree-device' + (selDevice === device && !selHost ? ' active' : '') }, [
      el('span', { class: 'tree-label', text: '📱 ' + device }),
      el('span', { class: 'tree-count', text: String(total) }),
    ]);
    devItem.addEventListener('click', () => { selDevice = device; selHost = ''; renderProxy(); });
    deviceTreeBody.appendChild(devItem);
    // hosts ของ device นี้ (แสดงเมื่อ device ถูกเลือก)
    if (selDevice === device) {
      for (const [host, count] of hosts) {
        const hostItem = el('div', { class: 'tree-item tree-host' + (selHost === host ? ' active' : '') }, [
          el('span', { class: 'tree-label', text: host }),
          el('span', { class: 'tree-count', text: String(count) }),
        ]);
        hostItem.addEventListener('click', (ev) => { ev.stopPropagation(); selHost = selHost === host ? '' : host; renderProxy(); });
        deviceTreeBody.appendChild(hostItem);
      }
    }
  }
}

// ---- รายการ URL (ซ้ายบน) ----
function renderFlowTable() {
  const flows = filteredFlows();
  document.getElementById('flow-count-label').textContent =
    `${flows.length} / ${allFlows.length}`;
  flowListBody.innerHTML = '';
  flowEmptyEl.style.display = flows.length ? 'none' : 'block';
  if (!flows.length) {
    flowEmptyEl.innerHTML = allFlows.length
      ? 'ไม่มี flow ตรงกับเงื่อนไขที่กรอง'
      : 'ยังไม่มีทราฟฟิกผ่าน proxy<br/>ตั้ง proxy บนอุปกรณ์แล้วเปิดแอป/เว็บ';
    return;
  }
  for (const f of flows) {
    const statusText = f.error ? 'ERR' : (f.status || '...');
    const topRow = [methodBadge(f.method)];
    if (f.blocked) {
      topRow.push(el('span', { class: 'blocked-badge', title: f.error || '', text: '🔒 BLOCKED' }));
      if (f.blockedCount > 1) topRow.push(el('span', { class: 'blocked-count', text: `×${f.blockedCount}` }));
    } else {
      topRow.push(el('span', { class: `status-badge ${statusClass(f.status)}`, text: String(statusText) }));
    }
    if (f.mapped) topRow.push(el('span', { class: 'map-badge', title: 'ถูก Map Local override', text: '🎯 MAP' }));
    topRow.push(el('span', { class: 'flow-item-meta', text: f.blocked ? 'cert pinning' : `${fmtTime(f.time)} · ${f.durationMs != null ? f.durationMs + 'ms' : '–'} · ${fmtSize(f.resSize)}` }));
    const item = el('div', { class: 'flow-item' + (f.id === selectedFlowId ? ' selected' : '') + (f.mapped ? ' mapped' : '') + (f.blocked ? ' blocked' : '') }, [
      el('div', { class: 'flow-item-top' }, topRow),
      el('div', { class: 'flow-item-url', title: f.url }, [
        el('span', { class: 'scheme-dot', text: f.scheme === 'https' ? '🔒 ' : '🌐 ' }),
        el('span', { text: f.host + f.path }),
      ]),
    ]);
    item.addEventListener('click', () => {
      selectedFlowId = f.id;
      renderFlowTable();
      renderFlowDetail(f);
    });
    flowListBody.appendChild(item);
  }
}

function renderProxy() {
  renderDeviceTree();
  renderFlowTable();
}

function headersToRaw(headers) {
  return Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}

// สร้างแผงครึ่งหนึ่ง (Request หรือ Response) พร้อม sub-tabs Header / Body / Raw
// extra = element เสริมชิดขวาของแถบแท็บ (เช่น ปุ่ม Map Local)
function buildDetailPane(title, headline, tabs, activeTab, onTab, extra) {
  const pane = el('div', { class: 'detail-pane' });
  const head = el('div', { class: 'detail-pane-head' }, [
    el('span', { class: 'detail-pane-title', text: title }),
    headline || el('span'),
  ]);
  pane.appendChild(head);
  const tabBar = el('div', { class: 'detail-subtabs' });
  for (const name of Object.keys(tabs)) {
    const btn = el('button', { class: 'subtab-btn' + (name === activeTab ? ' active' : ''), text: name });
    btn.addEventListener('click', () => onTab(name));
    tabBar.appendChild(btn);
  }
  if (extra) tabBar.appendChild(extra);
  pane.appendChild(tabBar);
  const body = el('div', { class: 'detail-pane-body' });
  body.appendChild(tabs[activeTab]);
  pane.appendChild(body);
  return pane;
}

// เปิดแท็บ Map Local แล้ว prefill ข้อมูลจาก flow ปัจจุบัน (ไว้ override response ตัวนี้)
function mapLocalFromFlow(f) {
  const rule = {
    enabled: true,
    name: `${f.method} ${f.host}${f.path.split('?')[0]}`.slice(0, 80),
    method: f.method,
    urlPattern: f.path.split('?')[0] || f.url,
    status: f.status || 200,
    contentType: f.resContentType || 'application/json',
    body: f.error ? '' : (prettyBody(f.resBody) || ''),
  };
  document.querySelector('.tab-btn[data-tab="maplocal"]').click();
  selectedRuleId = null;
  renderMapList();
  renderMapEditor(rule);
}

function renderFlowDetail(f) {
  flowDetailEl.innerHTML = '';

  // ----- Request pane -----
  const reqRawText = `${f.method} ${f.path} HTTP/1.1\n${headersToRaw(f.reqHeaders)}${f.reqBody ? '\n\n' + prettyBody(f.reqBody) : ''}`;
  const reqTabs = {
    Header: kvTable(f.reqHeaders || {}),
    Body: bodyBlock(f.reqBody),
    Raw: el('pre', { class: 'code-block', text: reqRawText }),
  };
  const reqHeadline = el('span', { class: 'detail-url', text: `${f.method} ${f.url}`, title: f.url });
  const mapBtn = el('button', { class: 'maplocal-icon-btn', type: 'button', title: 'สร้าง Map Local จาก flow นี้ (prefill response)', text: '🎯 Map Local' });
  mapBtn.addEventListener('click', () => mapLocalFromFlow(f));
  const reqPane = buildDetailPane('Request', reqHeadline, reqTabs, reqTab, (name) => { reqTab = name; renderFlowDetail(f); }, mapBtn);

  // ----- Response pane -----
  const resRawText = f.error
    ? f.error
    : `HTTP/1.1 ${f.status || ''} ${f.statusText || ''}\n${headersToRaw(f.resHeaders)}${f.resBody ? '\n\n' + prettyBody(f.resBody) : ''}`;
  const resTabs = {
    Header: kvTable(f.resHeaders || {}),
    Body: f.error ? el('pre', { class: 'code-block', text: `ERROR: ${f.error}` }) : bodyBlock(f.resBody),
    Raw: el('pre', { class: 'code-block', text: resRawText }),
  };
  const resHeadline = f.error
    ? el('span', { class: 'status-badge status-err', text: 'ERROR' })
    : el('span', {}, [
      el('span', { class: `status-badge ${statusClass(f.status)}`, text: `${f.status || ''} ${f.statusText || ''}` }),
      el('span', { class: 'detail-meta', text: `  ${f.durationMs != null ? f.durationMs + ' ms · ' : ''}${fmtSize(f.resSize)}` }),
    ]);
  const resPane = buildDetailPane('Response', resHeadline, resTabs, resTab, (name) => { resTab = name; renderFlowDetail(f); });

  const split = el('div', { class: 'detail-split' }, [reqPane, resPane]);
  flowDetailEl.appendChild(split);
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

// ================= Map Local =================
const mapListEl = document.getElementById('maplocal-list');
const mapEditorEl = document.getElementById('maplocal-editor');
let mapRulesData = [];
let selectedRuleId = null;

async function loadMapRules() {
  mapRulesData = await (await fetch('/api/maplocal')).json();
  renderMapList();
}

function renderMapList() {
  mapListEl.innerHTML = '';
  if (!mapRulesData.length) {
    mapListEl.appendChild(el('p', { class: 'empty-msg', html: 'ยังไม่มีกฎ<br/>กด "เพิ่มกฎ" เพื่อสร้าง' }));
    return;
  }
  for (const r of mapRulesData) {
    const item = el('div', { class: 'map-item' + (r.id === selectedRuleId ? ' selected' : '') }, [
      el('span', { class: 'map-dot ' + (r.enabled !== false ? 'on' : 'off'), text: r.enabled !== false ? '●' : '○' }),
      el('div', { class: 'map-item-body' }, [
        el('div', { class: 'map-item-name', text: r.name || r.urlPattern || '(ยังไม่ตั้งชื่อ)' }),
        el('div', { class: 'map-item-sub', text: `${r.method || 'ANY'} · ${r.urlPattern || '—'} · ${r.status || 200}` }),
      ]),
    ]);
    item.addEventListener('click', () => { selectedRuleId = r.id; renderMapList(); renderMapEditor(r); });
    mapListEl.appendChild(item);
  }
}

function renderMapEditor(rule) {
  mapEditorEl.innerHTML = '';
  const isNew = !rule.id;
  const field = (label, node) => {
    mapEditorEl.appendChild(el('label', { class: 'map-label', text: label }));
    mapEditorEl.appendChild(node);
    return node;
  };

  const enabled = el('input', { type: 'checkbox' });
  enabled.checked = rule.enabled !== false;
  const enableRow = el('label', { class: 'map-enable' }, [enabled, el('span', { text: ' เปิดใช้งานกฎนี้' })]);
  mapEditorEl.appendChild(enableRow);

  const name = field('ชื่อกฎ (ไว้จำ)', el('input', { type: 'text', value: rule.name || '', placeholder: 'เช่น mock license-types' }));

  const method = el('select');
  for (const m of ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const opt = el('option', { value: m, text: m });
    if ((rule.method || 'ANY') === m) opt.selected = true;
    method.appendChild(opt);
  }
  field('Method', method);

  const pattern = field('URL pattern (มี * = wildcard, ไม่มี * = ตรวจแบบ "มีคำนี้")',
    el('input', { type: 'text', value: rule.urlPattern || '', placeholder: 'เช่น /api/master-data/license-types หรือ /user/*' }));

  const status = field('HTTP status', el('input', { type: 'text', value: String(rule.status || 200) }));
  const contentType = field('Content-Type', el('input', { type: 'text', value: rule.contentType || 'application/json' }));
  const body = field('Response body', el('textarea', { rows: '12', placeholder: '{"key": "value"}' }));
  body.value = rule.body || '';

  const jsonHint = el('span', { class: 'hint', text: '' });
  const validateJson = () => {
    if ((contentType.value || '').includes('json') && body.value.trim()) {
      try { JSON.parse(body.value); jsonHint.textContent = '✅ JSON ถูกต้อง'; jsonHint.style.color = 'var(--green)'; }
      catch (e) { jsonHint.textContent = '⚠️ JSON ไม่ถูกต้อง: ' + e.message; jsonHint.style.color = 'var(--yellow)'; }
    } else jsonHint.textContent = '';
  };
  body.addEventListener('input', validateJson);
  contentType.addEventListener('input', validateJson);
  validateJson();
  mapEditorEl.appendChild(jsonHint);

  const collect = () => ({
    enabled: enabled.checked,
    name: name.value.trim(),
    method: method.value,
    urlPattern: pattern.value.trim(),
    status: status.value.trim(),
    contentType: contentType.value.trim(),
    body: body.value,
  });

  const status2 = el('span', { class: 'hint' });
  const saveBtn = el('button', { class: 'primary', text: isNew ? 'สร้างกฎ' : 'บันทึก' });
  saveBtn.addEventListener('click', async () => {
    const data = collect();
    if (!data.urlPattern) { status2.textContent = '⚠️ กรุณาใส่ URL pattern'; return; }
    const url = isNew ? '/api/maplocal' : `/api/maplocal/${rule.id}`;
    const resp = await (await fetch(url, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })).json();
    if (resp.ok) {
      status2.textContent = '✅ บันทึกแล้ว';
      selectedRuleId = resp.rule.id;
      await loadMapRules();
      renderMapEditor(resp.rule);
    } else {
      status2.textContent = '❌ ' + (resp.error || 'บันทึกไม่สำเร็จ');
    }
  });

  const btnRow = el('div', { class: 'map-btn-row' }, [saveBtn, status2]);
  if (!isNew) {
    const dupBtn = el('button', { class: 'map-dup-btn', text: '⧉ Duplicate' });
    dupBtn.addEventListener('click', async () => {
      const data = collect();
      data.name = (data.name || data.urlPattern) + ' (copy)';
      const resp = await (await fetch('/api/maplocal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })).json();
      if (resp.ok) {
        selectedRuleId = resp.rule.id;
        await loadMapRules();
        renderMapEditor(resp.rule);
      }
    });
    btnRow.appendChild(dupBtn);

    const delBtn = el('button', { class: 'danger', text: '🗑️ ลบกฎ' });
    delBtn.addEventListener('click', async () => {
      await fetch(`/api/maplocal/${rule.id}`, { method: 'DELETE' });
      selectedRuleId = null;
      await loadMapRules();
      mapEditorEl.innerHTML = '<p class="empty-msg">เลือกกฎจากด้านซ้าย หรือกด "เพิ่มกฎ" เพื่อสร้างใหม่</p>';
    });
    btnRow.appendChild(delBtn);
  }
  mapEditorEl.appendChild(btnRow);
}

document.getElementById('maplocal-add').addEventListener('click', () => {
  selectedRuleId = null;
  renderMapList();
  renderMapEditor({ enabled: true, method: 'ANY', status: 200, contentType: 'application/json', body: '' });
});

loadMapRules();

// ================= Polling fallback (สำหรับ ngrok ที่ SSE อาจไม่ push) =================
// SSE (EventSource) ใส่ header ngrok-skip เองไม่ได้ ถ้าเปิดผ่าน ngrok แล้ว real-time ไม่มา
// จึง poll ซ้ำเบาๆ และ re-render เฉพาะตอนข้อมูลเปลี่ยนจริง (กันจอกระพริบ)
let _lastFlowSig = '';
let _lastReqSig = '';
setInterval(async () => {
  try {
    const flows = await (await fetch('/api/proxy/flows')).json();
    const sig = `${flows.length}:${flows[0]?.id || ''}:${flows[0]?.blockedCount || ''}`;
    if (sig !== _lastFlowSig) {
      _lastFlowSig = sig;
      allFlows = flows;
      renderProxy();
    }
  } catch { /* ignore */ }
  try {
    const reqs = await (await fetch('/api/requests')).json();
    const sig = `${reqs.length}:${reqs[0]?.id || ''}`;
    if (sig !== _lastReqSig) {
      _lastReqSig = sig;
      allRequests = reqs;
      renderList();
      renderMobileGallery();
    }
  } catch { /* ignore */ }
}, 10000);
