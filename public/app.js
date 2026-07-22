/* global exifr */

// ngrok-free แทรกหน้าเตือน (interstitial) กับ request ที่ไม่มี header นี้ ทำให้ API คืน HTML แทน JSON
// ครอบ fetch ให้แนบ header เสมอ เพื่อให้ใช้งานผ่าน ngrok ได้เหมือน local
const _origFetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const headers = new Headers(opts.headers || {});
  headers.set('ngrok-skip-browser-warning', 'true');
  return _origFetch(url, { ...opts, headers });
};

// ซ่อนโหมด Proxy Postern (แอป VPN) ไว้ชั่วคราว — เอากลับมาด้วย false
// Wi-Fi กลับมาใช้ได้แล้ว (ไม่อยู่ใต้ flag นี้)
const USB_ONLY = true;
if (USB_ONLY) document.querySelectorAll('[data-usbonly-hide]').forEach((e) => { e.style.display = 'none'; });

// ================= Tab switching =================
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (typeof renderTcProxyPopup === 'function') renderTcProxyPopup(); // โชว์/ซ่อน popup Test Case ในหน้า Proxy
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

// ===== JSON tree viewer แบบพับได้ (▸/▾) + เส้น guide บอกว่าอยู่ใน object ไหน (JSON ก้อนใหญ่) =====
function jtPrimSpan(v) {
  if (v === null) return el('span', { class: 'json-null', text: 'null' });
  const t = typeof v;
  if (t === 'string') return el('span', { class: 'json-str', text: JSON.stringify(v) });
  if (t === 'boolean') return el('span', { class: 'json-bool', text: String(v) });
  if (t === 'number') return el('span', { class: 'json-num', text: String(v) });
  return el('span', { text: String(v) });
}
function jtNode(key, value, isIndex, last) {
  const node = el('div', { class: 'jt-node' });
  const hasKey = key !== null && key !== undefined;
  const keyEl = () => (hasKey ? el('span', { class: isIndex ? 'jt-index' : 'json-key', text: isIndex ? String(key) : `"${key}"` }) : el('span'));
  const colon = () => (hasKey ? el('span', { class: 'jt-colon', text: ': ' }) : el('span'));
  const comma = last ? '' : ',';
  const isObj = value !== null && typeof value === 'object';
  if (!isObj) { // leaf
    node.appendChild(el('div', { class: 'jt-line' }, [keyEl(), colon(), jtPrimSpan(value), el('span', { class: 'jt-punct', text: comma })]));
    return node;
  }
  const isArr = Array.isArray(value);
  const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
  const open = isArr ? '[' : '{';
  const close = isArr ? ']' : '}';
  if (!entries.length) {
    node.appendChild(el('div', { class: 'jt-line' }, [keyEl(), colon(), el('span', { class: 'jt-punct', text: open + close + comma })]));
    return node;
  }
  const toggle = el('span', { class: 'jt-toggle', text: '▾' });
  const summary = el('span', { class: 'jt-summary', text: ` ${entries.length} ${isArr ? 'items' : 'keys'}` });
  const ellipsis = el('span', { class: 'jt-ellipsis', text: `… ${close}${comma}` });
  const head = el('div', { class: 'jt-line jt-head' }, [toggle, keyEl(), colon(), el('span', { class: 'jt-punct', text: open }), summary, ellipsis]);
  const children = el('div', { class: 'jt-children' });
  entries.forEach(([k, v], i) => children.appendChild(jtNode(k, v, isArr, i === entries.length - 1)));
  const closeLine = el('div', { class: 'jt-line jt-close' }, [el('span', { class: 'jt-punct', text: close + comma })]);
  node.append(head, children, closeLine);
  let collapsed = false;
  const apply = () => {
    children.style.display = collapsed ? 'none' : '';
    closeLine.style.display = collapsed ? 'none' : '';
    summary.style.display = collapsed ? 'none' : '';
    ellipsis.style.display = collapsed ? '' : 'none';
    toggle.textContent = collapsed ? '▸' : '▾';
  };
  apply();
  head.addEventListener('click', (e) => { e.stopPropagation(); collapsed = !collapsed; apply(); });
  return node;
}
function jsonTree(value) { return el('div', { class: 'jt' }, [jtNode(null, value, false, true)]); }

// กล่องแก้ JSON ที่มีไฮไลต์สี (textarea โปร่งใสวางทับ <pre> ที่ไฮไลต์ไว้ + sync scroll)
function makeJsonEditor(value) {
  const code = el('code');
  const highlight = el('pre', { class: 'je-highlight' }, [code]);
  const ta = el('textarea', { class: 'je-input', spellcheck: 'false', placeholder: '{"key": "value"}' });
  ta.value = value || '';
  const refresh = () => { code.innerHTML = syntaxHighlightJson(ta.value) + '\n'; };
  ta.addEventListener('input', refresh);
  // sync scroll สองทาง: พิมพ์/เลื่อนที่ textarea → เลื่อน layer ไฮไลต์ตาม;
  // และเมื่อ browser Cmd+F เลื่อน layer ไฮไลต์ไปหา match → เลื่อน textarea ตาม (ตั้งค่าซ้ำค่าเดิมไม่ยิง event ซ้ำ จึงไม่ loop)
  ta.addEventListener('scroll', () => { highlight.scrollTop = ta.scrollTop; highlight.scrollLeft = ta.scrollLeft; });
  highlight.addEventListener('scroll', () => { ta.scrollTop = highlight.scrollTop; ta.scrollLeft = highlight.scrollLeft; });
  refresh();
  return { wrap: el('div', { class: 'je-wrap' }, [highlight, ta]), textarea: ta, refresh };
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
  let parsed; let isTree = false;
  try { parsed = typeof raw === 'object' ? raw : JSON.parse(raw); isTree = parsed !== null && typeof parsed === 'object'; } catch { isTree = false; }
  const content = isTree
    ? el('div', { class: 'code-block json jt-scroll' }, [jsonTree(parsed)]) // object/array → tree พับได้
    : el('pre', { class: 'code-block', text });
  return el('div', { class: 'code-wrap' }, [copyButton(() => text), content]);
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
  if (tcActiveId) refreshTcCursors(); // มี case active → อัปเดต highlight step แบบ realtime
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

// เปิดใช้ "ส่งผ่าน proxy" อยู่ไหม (chip ในแท็บ Sender)
function sendViaProxyOn() { const c = document.getElementById('send-via-proxy'); return !!(c && c.checked); }

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

// สลับโหมด ฟอร์ม / cURL
document.querySelectorAll('input[name="send-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const curl = document.querySelector('input[name="send-mode"]:checked').value === 'curl';
    document.getElementById('send-curl-mode').style.display = curl ? 'block' : 'none';
    document.getElementById('send-form-mode').style.display = curl ? 'none' : 'block';
  });
});

// ส่งจากโหมด cURL — parse แล้วยิงผ่าน /api/send (body เป็น string ดิบ รองรับทั้ง JSON/urlencoded)
async function sendFromCurl() {
  const raw = document.getElementById('curl-input').value.trim();
  if (!raw) { sendResultEl.innerHTML = '<p class="empty-msg">วาง cURL ก่อนส่ง</p>'; return; }
  let p;
  try { p = parseCurl(raw); } catch (e) { sendResultEl.innerHTML = '<p class="empty-msg">แปลง cURL ไม่สำเร็จ: ' + e.message + '</p>'; return; }
  if (!p.url) { sendResultEl.innerHTML = '<p class="empty-msg">ไม่พบ URL ใน cURL</p>'; return; }
  sendResultEl.innerHTML = '<p class="empty-msg">⏳ กำลังส่ง...</p>';
  try {
    const payload = { url: p.url, method: p.method, headers: p.headers, viaProxy: sendViaProxyOn() };
    if (p.body) payload.body = p.body;
    const result = await (await fetch('/api/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })).json();
    renderSendResult(result);
  } catch (err) { renderSendResult({ ok: false, durationMs: 0, error: err.message }); }
}

document.getElementById('send-btn').addEventListener('click', async () => {
  if (document.querySelector('input[name="send-mode"]:checked').value === 'curl') { await sendFromCurl(); return; }
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
      const payload = { url, method, headers, viaProxy: sendViaProxyOn() };
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

// ---- นำเข้าจาก cURL: แยก token (รองรับ ' " \ และ \<newline>) แล้ว map ลงฟอร์ม Sender ----
function tokenizeCurl(input) {
  const s = String(input).replace(/\\\r?\n/g, ' '); // line-continuation
  const tokens = [];
  let cur = '', inTok = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { // single quote — literal จนถึง ' ถัดไป
      inTok = true; i++;
      while (i < s.length && s[i] !== "'") cur += s[i++];
      i++; continue;
    }
    if (c === '"') { // double quote — รองรับ \ escape
      inTok = true; i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { cur += s[i + 1]; i += 2; continue; }
        cur += s[i++];
      }
      i++; continue;
    }
    if (c === '\\') { if (i + 1 < s.length) { cur += s[i + 1]; inTok = true; i += 2; } else i++; continue; }
    if (/\s/.test(c)) { if (inTok) { tokens.push(cur); cur = ''; inTok = false; } i++; continue; }
    cur += c; inTok = true; i++;
  }
  if (inTok) tokens.push(cur);
  return tokens;
}

function parseCurl(input) {
  const toks = tokenizeCurl(input);
  let i = (toks[0] && toks[0].toLowerCase() === 'curl') ? 1 : 0;
  const res = { method: '', url: '', headers: {}, body: '' };
  const data = [];
  const VALUE_FLAGS_IGNORE = ['-o', '--output', '-w', '--write-out', '--connect-timeout', '-m', '--max-time', '--retry', '-x', '--proxy', '--cacert', '--cert', '--key', '-E', '--max-redirs'];
  for (; i < toks.length; i++) {
    const t = toks[i];
    const val = () => toks[++i] || '';
    if (t === '-X' || t === '--request') res.method = val().toUpperCase();
    else if (t === '-H' || t === '--header') { const h = val(); const k = h.indexOf(':'); if (k > 0) res.headers[h.slice(0, k).trim()] = h.slice(k + 1).trim(); }
    else if (t === '-d' || t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii' || t === '--data-urlencode') data.push(val());
    else if (t === '-u' || t === '--user') res.headers['Authorization'] = 'Basic ' + btoa(val());
    else if (t === '-b' || t === '--cookie') res.headers['Cookie'] = val();
    else if (t === '-A' || t === '--user-agent') res.headers['User-Agent'] = val();
    else if (t === '-e' || t === '--referer') res.headers['Referer'] = val();
    else if (t === '--url') res.url = val();
    else if (VALUE_FLAGS_IGNORE.includes(t)) val(); // กินค่า flag ที่ไม่ใช้ทิ้ง
    else if (t.startsWith('-') && t !== '-') { /* boolean flag (-s -k -L -i -v --compressed ฯลฯ) ข้าม */ }
    else if (!res.url) res.url = t; // positional = URL
  }
  if (data.length) res.body = data.join('&');
  if (!res.method) res.method = data.length ? 'POST' : 'GET';
  return res;
}

const curlImportBtn = document.getElementById('curl-import-btn');
if (curlImportBtn) curlImportBtn.addEventListener('click', () => {
  const raw = document.getElementById('curl-input').value.trim();
  if (!raw) return;
  let p;
  try { p = parseCurl(raw); } catch (e) { alert('แปลง cURL ไม่สำเร็จ: ' + e.message); return; }
  if (!p.url) { alert('ไม่พบ URL ใน cURL ที่วาง'); return; }
  // method — เพิ่ม option ถ้ายังไม่มีในลิสต์ (เช่น OPTIONS)
  const methodSel = document.getElementById('send-method');
  if (![...methodSel.options].some((o) => o.value === p.method)) methodSel.add(new Option(p.method, p.method));
  methodSel.value = p.method;
  document.getElementById('send-url').value = p.url;
  document.getElementById('send-headers').value = Object.entries(p.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
  // body → ช่อง JSON (pretty ถ้าเป็น JSON) แล้วเลือก radio JSON; ไม่มี body = none
  const wantType = p.body ? 'json' : 'none';
  const radio = document.querySelector(`input[name="body-type"][value="${wantType}"]`);
  if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
  if (p.body) {
    let pretty = p.body;
    try { pretty = JSON.stringify(JSON.parse(p.body), null, 2); } catch { /* ไม่ใช่ JSON — ใส่ raw ไป */ }
    bodyJsonEl.value = pretty;
  }
  // สลับไปโหมดฟอร์มให้เห็นค่าที่แปลงมา
  const formRadio = document.querySelector('input[name="send-mode"][value="form"]');
  if (formRadio) { formRadio.checked = true; formRadio.dispatchEvent(new Event('change')); }
  curlImportBtn.textContent = '✅ แปลงแล้ว';
  setTimeout(() => { curlImportBtn.textContent = 'แปลงลงฟอร์ม ▸'; }, 1500);
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
let flowMediaFilter = ''; // '' | image | video | pdf
let selDevice = '';      // '' = ทุก device
let selHost = '';        // '' = ทุก host (ใน device ที่เลือก)
// Pin base URL (origin scheme://host) — เก็บใน localStorage ให้อยู่ข้าม refresh
const PINS_KEY = 'apitester_pins';
let pinnedBaseUrls = (() => { try { return JSON.parse(localStorage.getItem(PINS_KEY)) || []; } catch { return []; } })();
let selPin = '';         // '' = ไม่ได้เลือก pin
function flowBaseUrl(f) { return `${f.scheme || 'https'}://${f.host || ''}`; }
function savePins() { try { localStorage.setItem(PINS_KEY, JSON.stringify(pinnedBaseUrls)); } catch { /* ignore */ } }
function togglePin(base) {
  const i = pinnedBaseUrls.indexOf(base);
  if (i >= 0) { pinnedBaseUrls.splice(i, 1); if (selPin === base) selPin = ''; delete pinColors[base]; savePinColors(); }
  else pinnedBaseUrls.push(base);
  savePins();
  renderProxy();
}
// สี tag ของ pin (rainbow 7 สี) — เก็บต่อ base URL แยกใน localStorage (ไม่แตะ format pinnedBaseUrls เดิม), default = yellow
const PIN_COLORS_KEY = 'apitester_pin_colors';
const PIN_PALETTE = [
  { key: 'red', hex: '#ef4444' }, { key: 'orange', hex: '#f97316' }, { key: 'yellow', hex: '#eab308' },
  { key: 'green', hex: '#22c55e' }, { key: 'blue', hex: '#3b82f6' }, { key: 'indigo', hex: '#6366f1' }, { key: 'violet', hex: '#a855f7' },
];
let pinColors = (() => { try { return JSON.parse(localStorage.getItem(PIN_COLORS_KEY)) || {}; } catch { return {}; } })();
function savePinColors() { try { localStorage.setItem(PIN_COLORS_KEY, JSON.stringify(pinColors)); } catch { /* ignore */ } }
function pinColorKey(base) { return pinColors[base] || 'yellow'; } // default เหลือง
function pinColorHex(base) { const c = PIN_PALETTE.find((x) => x.key === pinColorKey(base)); return c ? c.hex : '#eab308'; }
function setPinColor(base, key) { pinColors[base] = key; savePinColors(); renderProxy(); }
// เมนูเลือกสี tag (คลิกขวาที่ pin) — จานสี 7 สี rainbow
let _pinColorMenu = null;
function closePinColorMenu() { if (_pinColorMenu) { _pinColorMenu.remove(); _pinColorMenu = null; } }
function showPinColorMenu(ev, base) {
  closePinColorMenu();
  const row = el('div', { class: 'pin-color-row' });
  for (const c of PIN_PALETTE) {
    const dot = el('span', { class: 'pin-swatch' + (pinColorKey(base) === c.key ? ' sel' : ''), title: c.key });
    dot.style.background = c.hex;
    dot.addEventListener('click', (e) => { e.stopPropagation(); setPinColor(base, c.key); closePinColorMenu(); });
    row.appendChild(dot);
  }
  const menu = el('div', { class: 'pin-color-menu' }, [el('div', { class: 'pin-color-menu-title', text: 'tag' }), row]);
  document.body.appendChild(menu);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = ev.clientX, y = ev.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = Math.max(4, x) + 'px';
  menu.style.top = Math.max(4, y) + 'px';
  _pinColorMenu = menu;
}
document.addEventListener('click', closePinColorMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePinColorMenu(); });
// sub-tabs ของ detail
let reqTab = 'Header';
let resTab = 'Body';

(async function initProxy() {
  allFlows = await (await fetch('/api/proxy/flows')).json();
  renderProxy();
})();

// ตัวลากปรับขนาดรายการ URL (บน) / detail (ล่าง) — เก็บค่าไว้ใน localStorage
(function initProxyResizer() {
  const resizer = document.getElementById('proxy-vresizer');
  const listWrap = document.getElementById('flow-list-wrap');
  if (!resizer || !listWrap) return;
  const saved = parseInt(localStorage.getItem('proxyListH') || '', 10);
  if (saved >= 160) listWrap.style.height = saved + 'px';
  let dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const top = listWrap.getBoundingClientRect().top;
    const workspace = listWrap.closest('.proxy-workspace').getBoundingClientRect();
    const max = workspace.bottom - top - 130; // เผื่อพื้นที่ detail ขั้นต่ำ
    const h = Math.max(160, Math.min(max, e.clientY - top));
    listWrap.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('proxyListH', String(parseInt(listWrap.style.height, 10) || 230));
  });
})();

// ตัวลากปรับความกว้างคอลัมน์ Devices (ซ้าย) — เก็บค่าไว้ใน localStorage
(function initDeviceResizer() {
  const resizer = document.getElementById('proxy-hresizer');
  const tree = document.getElementById('device-tree');
  if (!resizer || !tree) return;
  const MIN = 120, MAX = 480;
  const saved = parseInt(localStorage.getItem('proxyDeviceW') || '', 10);
  if (saved >= MIN) tree.style.flex = '0 0 ' + Math.min(MAX, saved) + 'px';
  let dragging = false;
  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const left = tree.getBoundingClientRect().left;
    const w = Math.max(MIN, Math.min(MAX, e.clientX - left));
    tree.style.flex = '0 0 ' + w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('proxyDeviceW', String(parseInt(tree.style.flexBasis, 10) || 190));
  });
})();
document.getElementById('clear-flows').addEventListener('click', async () => {
  await fetch('/api/proxy/flows', { method: 'DELETE' });
});
// cmd/ctrl+backspace ตอนอยู่ tab proxy → เคลียร์ traffic (เว้นตอนโฟกัสช่องพิมพ์ ไม่ขวางการลบข้อความ)
window.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete'))) return;
  if (!document.getElementById('tab-proxy').classList.contains('active')) return;
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
  e.preventDefault();
  document.getElementById('clear-flows').click();
});
// cmd/ctrl+enter ตอนอยู่ tab proxy + เลือก flow ไว้ → repeat (ยิงซ้ำ)
window.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && e.key === 'Enter')) return;
  if (!document.getElementById('tab-proxy').classList.contains('active')) return;
  const f = allFlows.find((x) => x.id === selectedFlowId);
  if (!f) return;
  e.preventDefault();
  replayFlow(f);
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
document.querySelectorAll('#media-filter button').forEach((b) => {
  b.addEventListener('click', () => {
    flowMediaFilter = b.dataset.media;
    document.querySelectorAll('#media-filter button').forEach((x) => x.classList.toggle('active', x === b));
    renderFlowTable();
  });
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
    if (selPin && flowBaseUrl(f) !== selPin) return false;
    if (selDevice && f.device !== selDevice) return false;
    if (selHost && f.host !== selHost) return false;
    if (flowFilter) {
      const hay = (f[flowField] || '').toLowerCase();
      if (flowMatch === 'equals' ? hay !== flowFilter : !hay.includes(flowFilter)) return false;
    }
    if (flowMediaFilter === 'image' && !(f.resIsImage || f.reqIsImage)) return false;
    if (flowMediaFilter === 'video' && !(f.resIsVideo || f.reqIsVideo)) return false;
    if (flowMediaFilter === 'pdf' && !(f.resIsPdf || f.reqIsPdf)) return false;
    return true;
  });
}

// ---- device tree (ซ้าย) ----
function renderDeviceTree() {
  deviceTreeBody.innerHTML = '';

  // ---- Pinned base URLs (บนสุด) ----
  if (pinnedBaseUrls.length) {
    deviceTreeBody.appendChild(el('div', { class: 'tree-section', text: '📌 Pinned' }));
    for (const base of pinnedBaseUrls) {
      const count = allFlows.filter((f) => flowBaseUrl(f) === base).length;
      const removeBtn = el('span', { class: 'pin-remove', title: 'ลบ pin', text: '✕' });
      removeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); togglePin(base); });
      const label = base.replace(/^https?:\/\//, '');
      const pinItem = el('div', { class: 'tree-item tree-pin' + (selPin === base ? ' active' : ''), title: base + '\n(คลิกขวาเพื่อเปลี่ยนสี tag)' }, [
        el('span', { class: 'tree-label', text: label }),
        el('span', { class: 'tree-count', text: String(count) }),
        removeBtn,
      ]);
      pinItem.style.borderLeftColor = pinColorHex(base); // แถบสี tag ตามที่เลือก (default เหลือง)
      pinItem.addEventListener('click', () => {
        selPin = selPin === base ? '' : base;
        selDevice = ''; selHost = '';
        renderProxy();
      });
      pinItem.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); showPinColorMenu(ev, base); }); // คลิกขวา → เลือกสี
      deviceTreeBody.appendChild(pinItem);
    }
    deviceTreeBody.appendChild(el('div', { class: 'tree-section', text: 'Devices' }));
  }

  const allItem = el('div', { class: 'tree-item tree-device' + (!selDevice && !selPin ? ' active' : '') }, [
    el('span', { class: 'tree-label', text: '🌐 Devices' }),
    el('span', { class: 'tree-count', text: String(allFlows.length) }),
  ]);
  allItem.addEventListener('click', () => { selDevice = ''; selHost = ''; selPin = ''; renderProxy(); });
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
    devItem.addEventListener('click', () => { selDevice = device; selHost = ''; selPin = ''; renderProxy(); });
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
    const row = [methodBadge(f.method)];
    if (f.blocked) {
      row.push(el('span', { class: 'blocked-badge', title: f.error || '', text: '🔒 BLOCKED' }));
      if (f.blockedCount > 1) row.push(el('span', { class: 'blocked-count', text: `×${f.blockedCount}` }));
    } else {
      row.push(el('span', { class: `status-badge ${statusClass(f.status)}`, text: String(statusText) }));
    }
    if (f.mapped && !f.testCase) { // test case มี tag ของตัวเองแล้ว ไม่ต้องโชว์ MAP ซ้ำ
      const ml = f.mapLocal;
      const icon = ml && ml.mode === 'passthrough' ? '🔀' : '🎯';
      const badge = el('span', { class: 'map-badge' + (ml && ml.ruleId ? ' clickable' : ''), title: ml && ml.ruleId ? 'คลิกไปที่กฎ Map Local นี้' : 'ถูก Map Local', text: `${icon} ${ml && ml.name ? ml.name : 'MAP'}` });
      if (ml && ml.ruleId) badge.addEventListener('click', (e) => { e.stopPropagation(); gotoMapLocalRule(ml.ruleId); });
      row.push(badge);
    }
    if (f.testCase && f.testCase.caseId) {
      const tc = f.testCase;
      const tag = el('span', { class: 'tc-badge', title: 'สร้างจาก Test Case — คลิกเพื่อไปที่ step นี้', text: `🎬 ${tc.caseName || 'case'} · #${(tc.step ?? 0) + 1}${tc.label ? ' ' + tc.label : ''}` });
      tag.addEventListener('click', (e) => { e.stopPropagation(); gotoTestCaseStep(tc); });
      row.push(tag);
    }
    if (f.resIsImage || f.reqIsImage) row.push(el('span', { class: 'image-badge', title: 'response เป็นรูปภาพ', text: '🖼️' }));
    if (f.resIsVideo || f.reqIsVideo) row.push(el('span', { class: 'video-badge', title: 'response เป็นวิดีโอ', text: '🎬' }));
    if (f.resIsPdf || f.reqIsPdf) row.push(el('span', { class: 'pdf-badge', title: 'response เป็น PDF', text: '📄' }));
    row.push(el('span', { class: 'flow-item-url', title: f.url }, [
      el('span', { class: 'scheme-dot', text: f.scheme === 'https' ? '🔒 ' : '🌐 ' }),
      el('span', { text: f.host + f.path }),
    ]));
    row.push(el('span', { class: 'flow-item-meta', text: f.blocked ? 'cert pinning' : `${fmtTime(f.time)} · ${f.durationMs != null ? f.durationMs + 'ms' : '–'} · ${fmtSize(f.resSize)}` }));
    const item = el('div', { class: 'flow-item' + (f.id === selectedFlowId ? ' selected' : '') + (f.mapped ? ' mapped' : '') + (f.blocked ? ' blocked' : '') }, [
      el('div', { class: 'flow-item-row' }, row),
    ]);
    // tag สี: flow ที่อยู่ใน base URL ที่ถูก pin → ติดแถบสีตามที่เลือกไว้กับ pin นั้น
    if (pinnedBaseUrls.includes(flowBaseUrl(f))) { item.classList.add('flow-pinned'); item.style.borderLeftColor = pinColorHex(flowBaseUrl(f)); }
    item.addEventListener('click', () => {
      selectedFlowId = f.id;
      renderFlowTable();
      renderFlowDetail(f);
    });
    item.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      showFlowContextMenu(ev, f);
    });
    flowListBody.appendChild(item);
  }
}

function renderProxy() {
  renderDeviceTree();
  renderFlowTable();
  renderTcProxyPopup();
}

// ===== Panel ในหน้า Proxy: เอา list/tree ของ Test Case มาไว้ (dock ซ้าย/ขวา, ย่อ/ขยาย, ปรับกว้าง) =====
let _tcPopupEl = null;
const _tcPopup = { side: 'right', width: 320, mode: 'full', height: null, top: null }; // mode: full | compact | mini
// ความโปร่งใสกล่อง Test Case popup — เก็บใน localStorage ให้อยู่ข้าม refresh (ตั้งในแท็บ Settings)
const TC_OPACITY_KEY = 'tcPopupOpacity';
let tcPopupOpacity = (() => { const v = parseFloat(localStorage.getItem(TC_OPACITY_KEY)); return (v >= 0.2 && v <= 1) ? v : 1; })();
function tcPopupDraggable(handle, box) {
  if (handle._dragBound) return; // กัน bind ซ้ำ (mini ใช้ element เดิม → traffic ทุกครั้งจะ bind เพิ่ม)
  handle._dragBound = true;
  handle.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, .tc-popup-toggle, .tc-popup-resizer, .tc-popup-mini-btn')) return;
    e.preventDefault();
    box.classList.add('dragging');
    const move = (ev) => { box.style.left = (ev.clientX - 50) + 'px'; box.style.top = Math.max(0, ev.clientY - 12) + 'px'; box.style.right = 'auto'; box.style.bottom = 'auto'; };
    const up = (ev) => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      box.classList.remove('dragging');
      _tcPopup.side = ev.clientX < window.innerWidth / 2 ? 'left' : 'right'; // snap แกน X ริมที่ใกล้สุด
      _tcPopup.top = Math.max(0, Math.min(window.innerHeight - 80, box.getBoundingClientRect().top)); // แกน Y คงตำแหน่งที่ปล่อย
      renderTcProxyPopup();
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}
function tcPopupResizer(res, box) {
  res.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = box.getBoundingClientRect().width, side = _tcPopup.side;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      _tcPopup.width = Math.max(220, Math.min(600, side === 'right' ? startW - dx : startW + dx));
      box.style.width = _tcPopup.width + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}
function tcPopupVResizer(res, box) {
  res.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY, startH = box.getBoundingClientRect().height;
    const move = (ev) => {
      _tcPopup.height = Math.max(120, Math.min(window.innerHeight - 64, startH + (ev.clientY - startY)));
      box.style.height = _tcPopup.height + 'px';
    };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
}
// compact = โชว์เฉพาะเคส active + step ปัจจุบันของแต่ละ endpoint (ตามภาพ)
function buildTcCompactInto(host, c) {
  host.innerHTML = '';
  const active = c.id === tcActiveId;
  host.appendChild(el('div', { class: 'tc-cmp-case' }, [
    el('span', { class: 'map-dot ' + (active ? 'on' : 'off'), text: active ? '●' : '○' }),
    el('span', { class: 'tc-cmp-name', text: c.name || '(ไม่มีชื่อ)' }),
    el('span', { class: 'tc-cmp-en' + (active ? ' on' : ''), text: active ? 'Enabled' : 'Disabled' }),
  ]));
  const flags = [];
  if (c.autoAdvance !== false) flags.push('⚡ AUTO');
  if (c.loop) flags.push('🔁 LOOP');
  if (active) flags.push('▶ RUNNING');
  host.appendChild(el('div', { class: 'tc-nav-summary', text: `${c.source === 'file' ? 'FILE' : 'INLINE'} · ${c.endpoints.length} ENDPOINTS${flags.length ? ' · ' + flags.join(' · ') : ''}` }));
  const cursors = c.cursors || {}; const hits = c.hits || {};
  c.endpoints.forEach((ep, ei) => {
    const enabled = ep.steps.map((s, idx) => ({ s, idx })).filter((x) => x.s.enabled !== false);
    if (!enabled.length) return;
    const k = `${ep.method || 'ANY'} ${ep.urlPattern}`;
    const cur = Math.min(cursors[k] || 0, enabled.length - 1);
    const curStep = enabled[cur].s; const curFull = enabled[cur].idx;
    const times = Math.max(1, curStep.times || 1); const hitN = hits[k] || 0;
    const epNode = el('div', { class: 'tc-nav-ep', title: 'ไปที่ endpoint นี้' }, [
      el('span', { class: 'tc-nav-method m-' + (ep.method || 'any').toLowerCase(), text: ep.method || 'ANY' }),
      el('span', { class: 'tc-nav-ep-path', text: ep.urlPattern || '(no pattern)' }),
    ]);
    epNode.addEventListener('click', () => { tcSelectedId = c.id; scrollTcTo(`.tc-ep[data-ep-idx="${ei}"]`, 'start'); });
    host.appendChild(epNode);
    const stNode = el('div', { class: 'tc-nav-step current', title: 'ไปที่ step ปัจจุบัน' }, [
      el('span', { class: 'tc-nav-bullet', text: `#${curFull + 1}` }),
      el('span', { class: 'tc-nav-step-label', text: curStep.label || `step ${curFull + 1}` }),
      times > 1 ? el('span', { class: 'tc-nav-times', title: `เหลือ ${times - hitN} ครั้งถึง step ถัดไป`, text: `⏭ ${times - hitN}` }) : el('span'),
    ]);
    stNode.addEventListener('click', () => { tcSelectedId = c.id; scrollTcTo(`.tc-step[data-ep-idx="${ei}"][data-step="${curFull}"]`, 'start'); });
    host.appendChild(stNode);
    // ปุ่มเปลี่ยน current step (ย้อน/ถัดไป) ในโหมด compact
    const prev = el('button', { class: 'tc-cmp-btn', type: 'button', title: 'ย้อน step', text: '◀' });
    const nxt = el('button', { class: 'tc-cmp-btn', type: 'button', title: 'ไป step ถัดไป', text: '▶' });
    prev.addEventListener('click', async (e) => { e.stopPropagation(); const to = (cur - 1 + enabled.length) % enabled.length; await fetch('/api/testcases/goto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern: ep.urlPattern, index: to }) }); await tcAfterChange(); });
    nxt.addEventListener('click', async (e) => { e.stopPropagation(); await fetch('/api/testcases/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern: ep.urlPattern }) }); await tcAfterChange(); });
    host.appendChild(el('div', { class: 'tc-cmp-ctrls' }, [prev, nxt, el('span', { class: 'tc-cmp-hint', text: 'เปลี่ยน step' })]));
  });
}
async function tcAfterChange() { // เปลี่ยน current step แล้ว refresh popup+panel+highlight
  try { const d = await (await fetch('/api/testcases')).json(); tcData = d.cases || []; tcActiveId = d.activeCaseId || null; } catch { return; }
  renderTcList(); renderTcProxyPopup(); updateTcEditorHighlight();
}
function renderTcProxyPopup() {
  if (!_tcPopupEl) { _tcPopupEl = el('div', { class: 'tc-popup', id: 'tc-popup' }); document.body.appendChild(_tcPopupEl); }
  const pop = _tcPopupEl;
  const onProxy = document.getElementById('tab-proxy').classList.contains('active');
  const c = tcData.find((x) => x.id === tcActiveId);
  if (!onProxy || !c) { pop.style.display = 'none'; return; }
  const mode = _tcPopup.mode || 'full';
  pop.style.display = 'flex';
  pop.style.left = ''; pop.style.right = ''; pop.style.bottom = '';
  pop.className = 'tc-popup dock-' + _tcPopup.side + ' mode-' + mode;
  pop.style.opacity = tcPopupOpacity; // ความโปร่งใสตั้งจากแท็บ Settings
  pop.style.top = _tcPopup.top != null ? _tcPopup.top + 'px' : '';
  // เก็บตำแหน่ง scroll ของ list เดิมไว้ก่อน rebuild — กันมุมมองเด้งกลับไปบนสุดตอนกด ◎/มี flow เข้า
  const prevListScroll = (() => { const l = pop.querySelector('.tc-popup-list'); return l ? l.scrollTop : 0; })();
  pop.innerHTML = '';

  // === mini: หุบไปมุมติดจอ — "Test Cases" หมุน 90° + ปุ่ม » ขยาย ===
  if (mode === 'mini') {
    pop.style.width = ''; pop.style.height = ''; pop.style.maxHeight = '';
    const expand = el('span', { class: 'tc-popup-mini-btn', title: 'ขยาย', text: '»' });
    expand.addEventListener('click', (e) => { e.stopPropagation(); _tcPopup.mode = 'full'; renderTcProxyPopup(); });
    pop.append(expand, el('span', { class: 'tc-popup-mini-label', text: 'Test Cases' }));
    tcPopupDraggable(pop, pop);
    return;
  }

  pop.style.width = _tcPopup.width + 'px';
  pop.style.height = _tcPopup.height ? _tcPopup.height + 'px' : ''; // ตั้งเอง = สูงคงที่ (ทั้ง full/compact), ไม่ตั้ง = auto
  pop.style.maxHeight = 'calc(100vh - ' + ((_tcPopup.top != null ? _tcPopup.top : 52) + 12) + 'px)';
  // header + ปุ่ม: ย่อ/ขยาย (▾/▸) และ _ หุบไปมุม
  const setBtn = el('span', { class: 'tc-popup-toggle gear', title: 'ตั้งค่า (ความโปร่งใส ฯลฯ)', text: '⚙️' });
  setBtn.addEventListener('click', (e) => { e.stopPropagation(); document.querySelector('.tab-btn[data-tab="settings"]').click(); });
  const cmpBtn = el('span', { class: 'tc-popup-toggle', title: mode === 'compact' ? 'ขยายเต็ม' : 'ย่อ (โชว์ step ปัจจุบัน)', text: mode === 'compact' ? '▸' : '▾' });
  cmpBtn.addEventListener('click', (e) => { e.stopPropagation(); _tcPopup.mode = mode === 'compact' ? 'full' : 'compact'; renderTcProxyPopup(); });
  const miniBtn = el('span', { class: 'tc-popup-toggle', title: 'หุบไปมุมจอ', text: _tcPopup.side === 'left' ? '«' : '»' });
  miniBtn.addEventListener('click', (e) => { e.stopPropagation(); _tcPopup.mode = 'mini'; renderTcProxyPopup(); });
  const head = el('div', { class: 'tc-popup-head' }, [el('span', { class: 'tc-popup-title', text: '🎬 Test Cases' }), el('div', { class: 'tc-popup-head-btns' }, [setBtn, cmpBtn, miniBtn])]);
  pop.appendChild(head);
  tcPopupDraggable(head, pop);

  if (mode === 'compact') {
    const resizer = el('div', { class: 'tc-popup-resizer' });
    const vresizer = el('div', { class: 'tc-popup-vresizer' });
    const cbody = el('div', { class: 'tc-popup-list tc-popup-compact' });
    pop.append(resizer, cbody, vresizer);
    tcPopupResizer(resizer, pop);   // ปรับกว้างได้แม้ตอนย่อ
    tcPopupVResizer(vresizer, pop); // ปรับสูงได้แม้ตอนย่อ
    buildTcCompactInto(cbody, c);
    cbody.scrollTop = prevListScroll; // คงตำแหน่ง scroll เดิม
    return;
  }
  // full
  const resizer = el('div', { class: 'tc-popup-resizer' });
  const vresizer = el('div', { class: 'tc-popup-vresizer' });
  const listBox = el('div', { class: 'tc-popup-list' });
  pop.append(resizer, listBox, vresizer);
  tcPopupResizer(resizer, pop);
  tcPopupVResizer(vresizer, pop);
  buildTcListInto(listBox);
  listBox.scrollTop = prevListScroll; // คงตำแหน่ง scroll เดิม (ไม่เด้งขึ้นบนสุดตอน rebuild)
}

// คลิก tag Map Local ในแท็บ Proxy → ไปแท็บ Map Local + เปิดกฎนั้น
function gotoMapLocalRule(id) {
  document.querySelector('.tab-btn[data-tab="maplocal"]').click();
  loadMapRules().then(() => {
    const r = mapRulesData.find((x) => x.id === id);
    if (r) { selectedRuleId = id; renderMapList(); renderMapEditor(r); }
  });
}

// คลิก tag ในแท็บ Proxy → ไปแท็บ Test Case, เปิดเคสนั้น, เลื่อนไป step ที่ตรง + flash
function gotoTestCaseStep(tc) {
  document.querySelector('.tab-btn[data-tab="testcases"]').click();
  tcSelectedId = tc.caseId;
  loadCases().then(() => {
    setTimeout(() => {
      for (const b of tcEditorEl.querySelectorAll('.tc-step')) {
        if (b.dataset.pattern === (tc.pattern || '') && String(b.dataset.step) === String(tc.step)) {
          b.scrollIntoView({ block: 'center', behavior: 'smooth' });
          b.classList.add('tc-step-flash');
          setTimeout(() => b.classList.remove('tc-step-flash'), 1600);
          return;
        }
      }
    }, 80);
  });
}

// ================= Repeat / Repeat & Edit (คลิกขวาที่แถว flow) =================
let _flowCtxMenu = null;
function closeFlowContextMenu() {
  if (_flowCtxMenu) { _flowCtxMenu.remove(); _flowCtxMenu = null; }
}
function showFlowContextMenu(ev, f) {
  closeFlowContextMenu();
  const repeatBtn = el('button', { class: 'flow-ctx-item', type: 'button', text: '🔁 Repeat' });
  const editBtn = el('button', { class: 'flow-ctx-item', type: 'button', text: '✏️ Repeat & Edit' });
  const base = flowBaseUrl(f);
  const isPinned = pinnedBaseUrls.includes(base);
  const pinBtn = el('button', { class: 'flow-ctx-item', type: 'button', text: (isPinned ? '📌 Unpin ' : '📌 Pin ') + base });
  repeatBtn.addEventListener('click', () => { closeFlowContextMenu(); replayFlow(f); });
  editBtn.addEventListener('click', () => { closeFlowContextMenu(); openRepeatEdit(f); });
  pinBtn.addEventListener('click', () => { closeFlowContextMenu(); togglePin(base); });
  const menu = el('div', { class: 'flow-ctx-menu' }, [
    repeatBtn, editBtn, pinBtn,
    el('div', { class: 'kebab-sep' }),
    makeCopyAsWrap(f),
  ]);
  document.body.appendChild(menu);
  // วางใกล้เมาส์ กันล้นขอบจอ
  const mw = menu.offsetWidth || 190, mh = menu.offsetHeight || 84;
  let x = ev.clientX, y = ev.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = Math.max(4, x) + 'px';
  menu.style.top = Math.max(4, y) + 'px';
  _flowCtxMenu = menu;
}
document.addEventListener('click', closeFlowContextMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFlowContextMenu(); });

// parse textarea "Key: Value" (บรรทัดละคู่) -> object
function parseRawHeaders(text) {
  const obj = {};
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (k) obj[k] = v;
  }
  return obj;
}

// ยิง request ซ้ำ — override = { method, url, headers, body } (ไม่ส่ง = ใช้ค่าจาก flow เดิม)
async function replayFlow(f, override) {
  const payload = {
    method: (override && override.method) || f.method,
    url: (override && override.url) || f.url,
    headers: (override && override.headers) || f.reqHeaders || {},
  };
  // multipart → ส่ง raw body เดิมแบบ byte-exact ผ่าน fromFlowId (ไม่งั้น "Multipart: Unexpected end of form")
  // ยกเว้นกรณี override.body ถูกแก้มาจริง (edit เป็น text)
  if (f.reqMultipart && !(override && override.body != null)) payload.fromFlowId = f.id;
  else payload.body = override ? override.body : f.reqBody;
  try {
    const r = await (await fetch('/api/proxy/replay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })).json();
    if (!r.ok) throw new Error(r.error || 'replay ไม่สำเร็จ');
    // flow ใหม่จะเด้งเข้าลิสต์เองผ่าน SSE — เลือกให้เลยเพื่อดู response ทันที
    if (r.flow) {
      selectedFlowId = r.flow.id;
      renderFlowTable();
      renderFlowDetail(r.flow);
    }
  } catch (e) {
    alert('Repeat ล้มเหลว: ' + e.message);
  }
}

function openRepeatEdit(f) {
  const methodSel = el('select', { class: 'repeat-field' });
  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].forEach((m) => {
    methodSel.appendChild(el('option', { value: m, text: m }));
  });
  methodSel.value = f.method || 'GET';
  const urlInput = el('input', { class: 'repeat-field', type: 'text' });
  urlInput.value = f.url || '';
  const headersTa = el('textarea', { class: 'repeat-field repeat-ta', spellcheck: 'false' });
  headersTa.value = headersToRaw(f.reqHeaders || {});
  const isMultipart = !!f.reqMultipart; // multipart → body เป็น binary ส่งของเดิมแบบ byte-exact (แก้ไม่ได้)
  const bodyTa = el('textarea', { class: 'repeat-field repeat-ta', spellcheck: 'false' });
  if (isMultipart) {
    bodyTa.value = '(multipart/form-data — ส่ง body เดิมแบบ byte-exact ผ่าน server, แก้ที่นี่ไม่ได้)\n\nดู/preview แต่ละ part ได้ที่แท็บ 📎 Form Data ในหน้ารายละเอียด';
    bodyTa.readOnly = true; bodyTa.classList.add('repeat-ta-ro');
  } else {
    // pretty-print body ถ้าเป็น JSON (prettyBody parse+reformat ให้; ถ้าไม่ใช่ JSON คืน text เดิม)
    bodyTa.value = f.reqBody != null ? (prettyBody(f.reqBody) || '') : '';
  }
  // จำนวนครั้ง (ยิงพร้อมกันแบบ load test) + สรุปผล
  const timesInput = el('input', { class: 'repeat-times-input', type: 'number', min: '1', max: '500', value: '1', title: 'ยิงกี่ครั้งพร้อมกัน (load test) — >1 จะสรุปผลรวมแทนการเพิ่มทีละ flow' });
  const resultBox = el('div', { class: 'repeat-result' });

  const execBtn = el('button', { class: 'repeat-exec', type: 'button', text: '▶️ Execute' });
  const cancelBtn = el('button', { class: 'repeat-cancel', type: 'button', text: 'Cancel' });
  const box = el('div', { class: 'repeat-modal' }, [
    el('div', { class: 'repeat-title', text: '✏️ Repeat & Edit' }),
    // เนื้อหากลาง scroll ในกล่อง (title ค้างบน, actions ค้างล่าง)
    el('div', { class: 'repeat-scroll' }, [
      el('div', { class: 'repeat-topbar' }, [
        el('div', { class: 'repeat-col repeat-method-col' }, [
          el('label', { class: 'repeat-label', text: 'Method' }), methodSel,
        ]),
        el('div', { class: 'repeat-col repeat-url-col' }, [
          el('label', { class: 'repeat-label', text: 'URL' }), urlInput,
        ]),
      ]),
      el('div', { class: 'repeat-grid' }, [
        el('div', { class: 'repeat-col repeat-col-left' }, [
          el('label', { class: 'repeat-label', text: 'Headers (บรรทัดละ Key: Value)' }), headersTa,
        ]),
        el('div', { class: 'repeat-gutter', title: 'ลากเพื่อปรับความกว้าง Header : Body' }),
        el('div', { class: 'repeat-col repeat-col-right' }, [
          el('label', { class: 'repeat-label', text: isMultipart ? 'Body (multipart — read-only)' : 'Body (JSON)' }), bodyTa,
        ]),
      ]),
      resultBox,
    ]),
    el('div', { class: 'repeat-actions' }, [
      el('div', { class: 'repeat-times' }, [el('label', { class: 'repeat-times-label', text: '× ครั้ง (พร้อมกัน)' }), timesInput]),
      el('div', { class: 'repeat-actions-btns' }, [cancelBtn, execBtn]),
    ]),
  ]);
  const overlay = el('div', { class: 'repeat-overlay' }, [box]);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  execBtn.addEventListener('click', async () => {
    const times = Math.max(1, Math.min(500, parseInt(timesInput.value, 10) || 1));
    const base = {
      method: methodSel.value,
      url: urlInput.value.trim(),
      headers: parseRawHeaders(headersTa.value),
    };
    if (isMultipart) base.fromFlowId = f.id; // ส่ง raw body เดิม (byte-exact) จากที่ server เก็บไว้
    else base.body = bodyTa.value === '' ? null : bodyTa.value;

    // ยิงครั้งเดียว → ปิด modal เปิด flow detail เหมือนเดิม
    if (times === 1) {
      execBtn.disabled = true; execBtn.textContent = '⏳ กำลังยิง…';
      try {
        const r = await (await fetch('/api/proxy/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base) })).json();
        if (!r.ok) throw new Error(r.error || 'ยิงไม่สำเร็จ');
        close();
        selectedFlowId = r.flow.id; renderFlowTable(); renderFlowDetail(r.flow);
      } catch (e) {
        resultBox.innerHTML = ''; resultBox.appendChild(el('div', { class: 'repeat-result-err', text: '❌ ' + e.message }));
        execBtn.disabled = false; execBtn.textContent = '▶️ Execute';
      }
      return;
    }

    // load test: ยิงทีละครั้ง (พร้อมกัน) แต่ละครั้งเข้า /api/proxy/replay → โผล่ใน traffic log ผ่าน SSE + โชว์ผลรายครั้ง
    resultBox.innerHTML = '';
    const progress = el('div', { class: 'rr-progress', text: `เสร็จ 0/${times}` });
    const logBox = el('div', { class: 'rr-log' });
    resultBox.append(progress, logBox);
    let done = 0, ok = 0, fail = 0;
    execBtn.disabled = true;
    const runOne = () => fetch('/api/proxy/replay', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(base) })
      .then((r) => r.json())
      .then((r) => (r.flow || { error: r.error || 'ยิงไม่สำเร็จ' }))
      .catch((e) => ({ error: e.message }))
      .then((fl) => {
        done++;
        const good = fl && !fl.error && fl.status >= 200 && fl.status < 400;
        const ms = fl && fl.durationMs != null ? ` · ${fl.durationMs}ms` : '';
        let line;
        if (good) { ok++; line = `✅ สำเร็จ ${ok}/${times} · ${fl.status}${ms}`; }
        else { fail++; line = `❌ ล้มเหลว ${fail}/${times} · ${fl && fl.error ? fl.error : (fl && fl.status) || 'ERR'}${ms}`; }
        logBox.appendChild(el('div', { class: 'rr-line ' + (good ? 'ok' : 'bad'), text: line }));
        logBox.scrollTop = logBox.scrollHeight;
        progress.textContent = `เสร็จ ${done}/${times}  ·  ✅ ${ok}  ·  ❌ ${fail}`;
      });
    await Promise.all(Array.from({ length: times }, runOne));
    progress.textContent = `เสร็จทั้งหมด ${times} ครั้ง  ·  ✅ ${ok}  ·  ❌ ${fail}`;
    execBtn.disabled = false; execBtn.textContent = '▶️ Execute';
  });
  document.body.appendChild(overlay);
  urlInput.focus();

  // ลาก gutter เพื่อปรับความกว้าง Header : Body (ซ้าย/ขวา)
  const grid = box.querySelector('.repeat-grid');
  const leftCol = box.querySelector('.repeat-col-left');
  const gutter = box.querySelector('.repeat-gutter');
  gutter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const gridW = grid.getBoundingClientRect().width;
    const startW = leftCol.getBoundingClientRect().width;
    const onMove = (ev) => {
      let w = startW + (ev.clientX - startX);
      w = Math.max(120, Math.min(gridW - 180, w)); // เผื่อ body ขั้นต่ำ
      leftCol.style.flex = `0 0 ${w}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function headersToRaw(headers) {
  return Object.entries(headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
}


// ---- Copy as ... helpers ----
// escape สำหรับ single-quote ใน shell (curl)
function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function buildCurl(f) {
  const parts = [`curl -X ${f.method} ${shellQuote(f.url)}`];
  for (const [k, v] of Object.entries(f.reqHeaders || {})) parts.push(`  -H ${shellQuote(`${k}: ${v}`)}`);
  const hasBody = f.reqBody != null && f.reqBody !== '' && !['GET', 'HEAD'].includes((f.method || '').toUpperCase());
  if (hasBody) parts.push(`  --data-raw ${shellQuote(typeof f.reqBody === 'object' ? JSON.stringify(f.reqBody) : String(f.reqBody))}`);
  return parts.join(' \\\n');
}

function copyReqBody(f) { return prettyBody(f.reqBody) || ''; }
function copyResBody(f) { return f.error ? f.error : (prettyBody(f.resBody) || ''); }

function buildRawReqRes(f) {
  const reqBody = copyReqBody(f);
  const req = `### REQUEST\n${f.method} ${f.url}\n${headersToRaw(f.reqHeaders)}${reqBody ? '\n\n' + reqBody : ''}`;
  const statusLine = f.error ? 'ERROR' : `HTTP/1.1 ${f.status || ''} ${f.statusText || ''}`.trim();
  const resHead = f.error ? '' : headersToRaw(f.resHeaders);
  const resBody = copyResBody(f);
  const res = `### RESPONSE\n${statusLine}${resHead ? '\n' + resHead : ''}${resBody ? '\n\n' + resBody : ''}`;
  return `${req}\n\n${res}`;
}

// toast แจ้งผลคัดลอก (เมนู hover หายไปเลยใช้ toast แทนการเปลี่ยนข้อความปุ่ม)
let copyToastTimer = null;
function copyToast(label) {
  let t = document.getElementById('copy-toast');
  if (!t) { t = el('div', { class: 'copy-toast', id: 'copy-toast' }); document.body.appendChild(t); }
  t.textContent = `✅ คัดลอกแล้ว: ${label}`;
  t.classList.add('show');
  clearTimeout(copyToastTimer);
  copyToastTimer = setTimeout(() => t.classList.remove('show'), 1500);
}
function copyAs(label, text) { navigator.clipboard.writeText(text || ''); copyToast(label); }

// สร้างเมนูย่อย "📋 Copy as ▸" (flyout) — ใช้ร่วมกันทั้งเมนู ⋯ และคลิกขวาบน URL
function makeCopyAsWrap(f) {
  const copyItem = (label, getText) => {
    const it = el('button', { class: 'flow-ctx-item', type: 'button', text: label });
    it.addEventListener('click', () => {
      copyAs(label, getText());
      it.closest('.kebab-wrap')?.classList.add('menu-dismissed'); // ปิดเมนู hover (⋯)
      closeFlowContextMenu();                                     // ปิดเมนูคลิกขวา (ถ้าอยู่ในนั้น)
    });
    return it;
  };
  const menu = el('div', { class: 'copy-as-menu' }, [
    copyItem('cURL', () => buildCurl(f)),
    copyItem('Raw Request & Response', () => buildRawReqRes(f)),
    el('div', { class: 'kebab-sep' }),
    copyItem('Request Header', () => headersToRaw(f.reqHeaders)),
    copyItem('Request Body', () => copyReqBody(f)),
    copyItem('Response Header', () => headersToRaw(f.resHeaders)),
    copyItem('Response Body', () => copyResBody(f)),
  ]);
  const trigger = el('button', { class: 'flow-ctx-item copy-as-trigger', type: 'button', text: '📋 Copy as ▸' });
  trigger.addEventListener('click', (e) => e.stopPropagation()); // อย่าให้คลิก trigger ปิดเมนูคลิกขวา
  return el('div', { class: 'copy-as-wrap' }, [trigger, menu]);
}

// สร้างแผงครึ่งหนึ่ง (Request หรือ Response) พร้อม sub-tabs Header / Body / Raw
// extra = element เสริมชิดขวาของแถบแท็บ (เช่น ปุ่ม Map Local)
function buildDetailPane(title, headline, tabs, activeTab, onTab, extra) {
  if (!(activeTab in tabs)) activeTab = Object.keys(tabs)[0]; // กัน tab ที่ไม่มีในflowนี้ (เช่น Image)
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

// แท็บรูป: โชว์ image ที่ดักได้ + EXIF metadata
function imageTab(f, side) {
  const wrap = el('div', { class: 'img-tab' });
  if (f[`${side}MediaTooBig`]) {
    wrap.appendChild(el('p', { class: 'hint', text: '🖼️ รูปนี้ใหญ่เกิน 12MB — ไม่ได้ดึงมา preview (แต่ยืนยันว่าเป็นรูปภาพ)' }));
    return wrap;
  }
  const url = `/api/proxy/flows/${f.id}/image?side=${side}`;
  const m = f[`${side}ImageMeta`];
  wrap.appendChild(el('img', { class: 'img-tab-preview', src: url, alt: 'image' }));
  wrap.appendChild(el('a', { class: 'img-tab-dl', href: url, target: '_blank', text: '⬇ เปิดรูปเต็ม / ดาวน์โหลด' }));
  if (!m) { wrap.appendChild(el('p', { class: 'hint', text: 'รูปนี้ไม่มี EXIF metadata ฝังอยู่' })); return wrap; }
  wrap.appendChild(el('div', { class: 'section-title', text: 'Image Metadata (EXIF)' }));
  const hi = el('div', { class: 'meta-highlight' });
  wrap.appendChild(hi);
  if (m.imageDescription) hi.appendChild(metaCard('📝 คำอธิบายภาพ', String(m.imageDescription)));
  hi.appendChild(metaCard('📅 วันที่ถ่าย', m.dateTaken ? fmtDate(m.dateTaken) : 'ไม่พบ'));
  if (m.camera) hi.appendChild(metaCard('📷 กล้อง', m.camera));
  if (m.width && m.height) hi.appendChild(metaCard('📐 ขนาดภาพ', `${m.width} × ${m.height}`));
  if (m.latitude != null && m.longitude != null) {
    const lat = m.latitude.toFixed(6); const lon = m.longitude.toFixed(6);
    hi.appendChild(metaCard('📍 พิกัด GPS', el('div', { html: `${lat}, ${lon}<br/><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">🗺️ เปิด Google Maps</a>` })));
    if (m.address) hi.appendChild(metaCard('🏠 ที่อยู่', m.address));
  } else {
    hi.appendChild(metaCard('📍 พิกัด GPS', 'ไม่พบพิกัดในรูปนี้'));
  }
  return wrap;
}

// แท็บวิดีโอ: เล่น preview ที่ดักได้ (ใช้ endpoint เดียวกับรูป — เสิร์ฟ bytes ตาม content-type)
function videoTab(f, side) {
  const wrap = el('div', { class: 'img-tab' });
  if (f[`${side}MediaTooBig`]) {
    wrap.appendChild(el('p', { class: 'hint', text: '🎬 วิดีโอนี้ใหญ่เกิน 25MB — ไม่ได้ดึงมา preview (แต่ยืนยันว่าเป็นวิดีโอ)' }));
    return wrap;
  }
  const url = `/api/proxy/flows/${f.id}/image?side=${side}`;
  const video = el('video', { class: 'video-tab-preview', src: url, controls: 'controls', preload: 'metadata' });
  wrap.appendChild(video);
  wrap.appendChild(el('a', { class: 'img-tab-dl', href: url, target: '_blank', text: '⬇ เปิดวิดีโอเต็ม / ดาวน์โหลด' }));
  return wrap;
}

// แท็บ Form Data: แกะ multipart/form-data → โชว์แต่ละ part (field value / ไฟล์ + preview รูป)
function multipartTab(f) {
  const wrap = el('div', { class: 'mp-tab' });
  const parts = (f.reqMultipart && f.reqMultipart.parts) || [];
  if (!parts.length) { wrap.appendChild(el('p', { class: 'hint', text: 'ไม่มี parts (อาจใหญ่เกิน หรือแกะไม่ได้)' })); return wrap; }
  parts.forEach((p, i) => {
    const row = el('div', { class: 'mp-part' });
    const head = el('div', { class: 'mp-part-head' }, [
      el('span', { class: 'mp-part-kind ' + p.kind, text: p.kind === 'file' ? '📎 FILE' : '📝 FIELD' }),
      el('span', { class: 'mp-part-name', text: p.name || '(no name)' }),
      el('span', { class: 'mp-part-meta', text: p.kind === 'file'
        ? `${p.filename || '(no filename)'} · ${p.contentType || ''} · ${fmtSize(p.size)}`
        : fmtSize(p.size) }),
    ]);
    row.appendChild(head);
    if (p.kind === 'field') {
      row.appendChild(el('pre', { class: 'mp-part-value', text: p.value != null ? p.value : '' }));
    } else if (!p.stored) {
      row.appendChild(el('p', { class: 'hint', text: '(ไฟล์ใหญ่เกิน 25MB — ไม่ได้เก็บไว้ดู)' }));
    } else {
      const url = `/api/proxy/flows/${f.id}/image?part=${i}`; // เปิดดู inline (ตาม content-type)
      const dlUrl = url + `&dl=${encodeURIComponent(p.filename || `part${i}`)}`; // บังคับดาวน์โหลด + ชื่อไฟล์
      if (p.isImage) {
        const img = el('img', { class: 'mp-part-img', src: url, alt: p.filename || 'image', title: 'คลิกเพื่อเปิดรูปเต็ม' });
        img.addEventListener('click', () => window.open(url, '_blank'));
        row.appendChild(img);
      } else if (p.isPdf) {
        row.appendChild(el('iframe', { class: 'mp-part-pdf', src: url, title: p.filename || 'pdf' }));
      }
      const acts = el('div', { class: 'mp-part-acts' }, [
        el('a', { class: 'img-tab-dl', href: url, target: '_blank', text: '🔍 เปิดดู' }),
        el('a', { class: 'img-tab-dl', href: dlUrl, download: p.filename || `part${i}`, text: '⬇ ดาวน์โหลด' }),
      ]);
      if (p.isImage) { // ปุ่มดู EXIF metadata (popup) — หลังปุ่มดาวน์โหลด
        const metaBtn = el('button', { class: 'img-tab-dl mp-meta-btn', type: 'button', text: 'ℹ️ Metadata' });
        metaBtn.addEventListener('click', () => showImagePartMeta(f, i, p.filename));
        acts.appendChild(metaBtn);
      }
      row.appendChild(acts);
    }
    wrap.appendChild(row);
  });
  return wrap;
}

// popup EXIF metadata ของรูปใน multipart request — ดึงแบบ on-demand ตอนกดปุ่ม ℹ️ Metadata
async function showImagePartMeta(f, partIdx, filename) {
  const box = el('div', { class: 'repeat-modal meta-popup' });
  box.appendChild(el('div', { class: 'repeat-title', text: `🖼️ Image Metadata — ${filename || 'image'}` }));
  const bodyWrap = el('div', { class: 'meta-popup-body' }, [el('p', { class: 'hint', text: '⏳ กำลังอ่าน metadata…' })]);
  box.appendChild(bodyWrap);
  const closeBtn = el('button', { class: 'repeat-cancel', type: 'button', text: 'ปิด' });
  box.appendChild(el('div', { class: 'meta-popup-actions' }, [closeBtn]));
  const overlay = el('div', { class: 'repeat-overlay' }, [box]);
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);

  let data;
  try { data = await (await fetch(`/api/proxy/flows/${f.id}/partmeta?part=${partIdx}`)).json(); }
  catch (e) { data = { meta: null, error: e.message }; }
  const m = data && data.meta;
  bodyWrap.innerHTML = '';
  if (!m) {
    bodyWrap.appendChild(el('p', { class: 'hint', text: 'รูปนี้ไม่มี EXIF metadata ฝังอยู่' + (data && data.error ? ` (${data.error})` : '') }));
    return;
  }
  const hi = el('div', { class: 'meta-highlight' });
  if (m.imageDescription) hi.appendChild(metaCard('📝 คำอธิบายภาพ', String(m.imageDescription)));
  hi.appendChild(metaCard('📅 วันที่ถ่าย', m.dateTaken ? fmtDate(m.dateTaken) : 'ไม่พบ'));
  if (m.camera) hi.appendChild(metaCard('📷 กล้อง', m.camera));
  if (m.width && m.height) hi.appendChild(metaCard('📐 ขนาดภาพ', `${m.width} × ${m.height}`));
  if (m.latitude != null && m.longitude != null) {
    const lat = m.latitude.toFixed(6); const lon = m.longitude.toFixed(6);
    hi.appendChild(metaCard('📍 พิกัด GPS', el('div', { html: `${lat}, ${lon}<br/><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank">🗺️ เปิด Google Maps</a>` })));
    if (m.address) hi.appendChild(metaCard('🏠 ที่อยู่', m.address));
  } else {
    hi.appendChild(metaCard('📍 พิกัด GPS', 'ไม่พบพิกัดในรูปนี้'));
  }
  bodyWrap.appendChild(hi);
}

// แท็บ PDF: embed preview + ลิงก์เปิดเต็ม
function pdfTab(f, side) {
  const wrap = el('div', { class: 'img-tab' });
  if (f[`${side}MediaTooBig`]) {
    wrap.appendChild(el('p', { class: 'hint', text: '📄 PDF นี้ใหญ่เกิน 25MB — ไม่ได้ดึงมา preview (แต่ยืนยันว่าเป็น PDF)' }));
    return wrap;
  }
  const url = `/api/proxy/flows/${f.id}/image?side=${side}`;
  wrap.appendChild(el('iframe', { class: 'pdf-tab-preview', src: url, title: 'pdf' }));
  wrap.appendChild(el('a', { class: 'img-tab-dl', href: url, target: '_blank', text: '⬇ เปิด PDF เต็ม / ดาวน์โหลด' }));
  return wrap;
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
  if (f.reqMultipart) reqTabs['Form Data'] = multipartTab(f); // multipart → แกะ parts + preview รูป
  if (f.reqIsImage) reqTabs['🖼️ Image'] = imageTab(f, 'req');
  if (f.reqIsVideo) reqTabs['🎬 Video'] = videoTab(f, 'req');
  if (f.reqIsPdf) reqTabs['📄 PDF'] = pdfTab(f, 'req');
  const reqHeadline = el('span', { class: 'detail-url', text: `${f.method} ${f.url}`, title: f.url });
  const copyUrlBtn = el('button', { class: 'maplocal-icon-btn', type: 'button', title: 'คัดลอก URL', text: '📋 Copy URL' });
  copyUrlBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(f.url);
    copyUrlBtn.textContent = '✅ Copied';
    setTimeout(() => { copyUrlBtn.textContent = '📋 Copy URL'; }, 1200);
  });
  const mapBtn = el('button', { class: 'maplocal-icon-btn', type: 'button', title: 'สร้าง Map Local จาก flow นี้ (prefill response)', text: '🎯 Map Local' });
  mapBtn.addEventListener('click', () => mapLocalFromFlow(f));
  // Pin icon — ปักหมุด base URL (scheme://host) ของ flow นี้
  const base = flowBaseUrl(f);
  const pinBtn = el('button', { class: 'maplocal-icon-btn pin-toggle', type: 'button' });
  pinBtn.textContent = '📌';
  const syncPin = () => {
    const pinned = pinnedBaseUrls.includes(base);
    pinBtn.classList.toggle('active', pinned);
    pinBtn.title = (pinned ? 'เอาหมุดออก: ' : 'ปักหมุด: ') + base;
  };
  syncPin();
  pinBtn.addEventListener('click', () => { togglePin(base); syncPin(); });
  // เมนู ⋯ (hover) — Repeat / Repeat & Edit เหมือนคลิกขวาที่แถว flow
  const kebabWrap = el('div', { class: 'kebab-wrap' });
  const dismissKebab = () => kebabWrap.classList.add('menu-dismissed'); // กดแล้วให้เมนูหายทันที
  const repeatItem = el('button', { class: 'flow-ctx-item', type: 'button', text: '🔁 Repeat' });
  repeatItem.addEventListener('click', () => { dismissKebab(); replayFlow(f); });
  const editItem = el('button', { class: 'flow-ctx-item', type: 'button', text: '✏️ Repeat & Edit' });
  editItem.addEventListener('click', () => { dismissKebab(); openRepeatEdit(f); });
  const copyWrap = makeCopyAsWrap(f); // เมนูย่อย "Copy as ▸" (flyout ออกด้านซ้าย)
  const kebabBtn = el('button', { class: 'maplocal-icon-btn kebab-btn', type: 'button', title: 'เพิ่มเติม', text: '⋯' });
  kebabWrap.append(kebabBtn, el('div', { class: 'kebab-menu' }, [repeatItem, editItem, el('div', { class: 'kebab-sep' }), copyWrap]));
  // ออกจากปุ่ม ⋯ แล้วรีเซ็ต เพื่อให้ hover ครั้งถัดไปเปิดเมนูได้อีก
  kebabWrap.addEventListener('mouseleave', () => kebabWrap.classList.remove('menu-dismissed'));
  const reqExtra = el('div', { class: 'detail-extra' }, [copyUrlBtn, mapBtn, pinBtn, kebabWrap]);
  const reqPane = buildDetailPane('Request', reqHeadline, reqTabs, reqTab, (name) => { reqTab = name; renderFlowDetail(f); }, reqExtra);

  // ----- Response pane -----
  const resRawText = f.error
    ? f.error
    : `HTTP/1.1 ${f.status || ''} ${f.statusText || ''}\n${headersToRaw(f.resHeaders)}${f.resBody ? '\n\n' + prettyBody(f.resBody) : ''}`;
  const resTabs = {
    Header: kvTable(f.resHeaders || {}),
    Body: f.error ? el('pre', { class: 'code-block', text: `ERROR: ${f.error}` }) : bodyBlock(f.resBody),
    Raw: el('pre', { class: 'code-block', text: resRawText }),
  };
  if (f.resIsImage) resTabs['🖼️ Image'] = imageTab(f, 'res');
  if (f.resIsVideo) resTabs['🎬 Video'] = videoTab(f, 'res');
  if (f.resIsPdf) resTabs['📄 PDF'] = pdfTab(f, 'res');
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
let mapSaveHandler = null; // ฟังก์ชัน save ของ editor ที่เปิดอยู่ (ให้ Cmd+S เรียกได้)
let tcSaveHandler = null;  // เช่นเดียวกัน สำหรับแท็บ Test Case

async function loadMapRules() {
  mapRulesData = await (await fetch('/api/maplocal')).json();
  // auto-focus: ยังไม่ได้เลือกอะไร → เปิดกฎที่ enabled ตัวแรกให้เลย (ไม่ต้องกดหลาย step)
  if (!selectedRuleId && mapRulesData.length) {
    const r = mapRulesData.find((x) => x.enabled !== false) || mapRulesData[0];
    if (r) { selectedRuleId = r.id; renderMapList(); renderMapEditor(r); return; }
  }
  renderMapList();
}

function renderMapList() {
  mapListEl.innerHTML = '';
  if (!mapRulesData.length) {
    mapListEl.appendChild(el('p', { class: 'empty-msg', html: 'ยังไม่มีกฎ<br/>กด "เพิ่มกฎ" เพื่อสร้าง' }));
    return;
  }
  for (const r of mapRulesData) {
    const on = r.enabled !== false;
    const tog = el('button', { class: 'map-item-toggle ' + (on ? 'on' : 'off'), type: 'button', text: on ? 'Enabled' : 'Disabled', title: 'คลิกเพื่อสลับเปิด/ปิดกฎนี้' });
    tog.addEventListener('click', async (e) => {
      e.stopPropagation(); // อย่าเปิด editor
      await fetch(`/api/maplocal/${r.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !on }) });
      await loadMapRules();
      if (r.id === selectedRuleId) { const fresh = mapRulesData.find((x) => x.id === r.id); if (fresh) renderMapEditor(fresh); }
    });
    const item = el('div', { class: 'map-item' + (r.id === selectedRuleId ? ' selected' : '') }, [
      el('span', { class: 'map-dot ' + (on ? 'on' : 'off'), text: on ? '●' : '○' }),
      el('div', { class: 'map-item-body' }, [
        el('div', { class: 'map-item-name' }, [
          el('span', { class: 'ml-mode-icon', title: r.mode === 'passthrough' ? 'โหมด Passthrough (แก้ response จริง)' : 'โหมด Mock (ตอบ body ที่ตั้ง)', text: (r.mode === 'passthrough' ? '🔀 ' : '📦 ') }),
          el('span', { text: r.name || r.urlPattern || '(ยังไม่ตั้งชื่อ)' }),
        ]),
        el('div', { class: 'map-item-sub', text: `${r.method || 'ANY'} · ${r.urlPattern || '—'} · ${r.status || 200}` }),
      ]),
      tog,
    ]);
    item.addEventListener('click', () => { selectedRuleId = r.id; renderMapList(); renderMapEditor(r); });
    mapListEl.appendChild(item);
  }
}

// widget ตาราง override: แต่ละแถว = [เปิด/ปิด] path → ค่าใหม่ [ลบ] ; คืน { el, collect() }
// onChange(overrides) เรียกทุกครั้งที่แก้ (ไว้ผูกค่าเข้า model ให้รอด redraw)
function makeOverrideEditor(initial, onChange) {
  const rows = el('div', { class: 'ov-rows' });
  const recs = [];
  const collect = () => recs.map((r) => ({ path: r.path.value.trim(), value: r.val.value, enabled: r.en.checked })).filter((o) => o.path);
  const fire = () => { if (onChange) onChange(collect()); };
  const addRow = (o) => {
    o = o || { path: '', value: '', enabled: true };
    const en = el('input', { type: 'checkbox', title: 'เปิด/ปิด override นี้' }); en.checked = o.enabled !== false;
    const path = el('input', { type: 'text', class: 'ov-path', value: o.path || '', placeholder: 'a.b[0].c' });
    const val = el('input', { type: 'text', class: 'ov-val', value: o.value != null ? o.value : '', placeholder: 'ค่าใหม่ (JSON เช่น true/12/"x" หรือข้อความ)' });
    const rm = el('button', { class: 'tc-x', type: 'button', title: 'ลบ override', text: '✕' });
    const row = el('div', { class: 'ov-row' }, [en, path, val, rm]);
    const rec = { en, path, val, row };
    rm.addEventListener('click', () => { row.remove(); const i = recs.indexOf(rec); if (i >= 0) recs.splice(i, 1); fire(); });
    for (const inp of [en, path, val]) inp.addEventListener('input', fire);
    recs.push(rec);
    rows.appendChild(row);
  };
  (Array.isArray(initial) ? initial : []).forEach(addRow);
  const addBtn = el('button', { class: 'tc-add-step', type: 'button', text: '+ เพิ่ม override' });
  addBtn.addEventListener('click', () => { addRow(); fire(); });
  const wrapEl = el('div', { class: 'ov-editor' }, [rows, addBtn]);
  return {
    el: wrapEl,
    collect,
    setEnabled: (on) => { wrapEl.classList.toggle('ov-disabled', !on); wrapEl.querySelectorAll('input,button').forEach((n) => { n.disabled = !on; }); },
  };
}

function renderMapEditor(rule) {
  mapEditorEl.innerHTML = '';
  const isNew = !rule.id;
  const cfg = el('div', { class: 'map-cfg' });          // คอลัมน์ Config
  const bodyCol = el('div', { class: 'map-body-col' });  // คอลัมน์ Response Body
  const field = (parent, label, node) => {
    parent.appendChild(el('label', { class: 'map-label', text: label }));
    parent.appendChild(node);
    return node;
  };

  const enabled = el('input', { type: 'checkbox' });
  enabled.checked = rule.enabled !== false;
  const enText = el('span');
  const syncEn = () => { enText.textContent = ' ' + (enabled.checked ? '✅ เปิดใช้งานกฎนี้' : '⛔ ปิดใช้งานกฎนี้'); };
  syncEn();
  enabled.addEventListener('change', async () => {
    syncEn();
    // auto-bind: กฎที่บันทึกแล้ว → PUT ทันที + อัปเดต toggle ในลิสต์ (ไม่ rebuild editor กันค่าที่แก้ค้างหาย)
    if (rule.id) {
      await fetch(`/api/maplocal/${rule.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: enabled.checked }) }).catch(() => {});
      const r = mapRulesData.find((x) => x.id === rule.id); if (r) r.enabled = enabled.checked;
      rule.enabled = enabled.checked;
      renderMapList();
    }
  });
  cfg.appendChild(el('label', { class: 'toggle-chip map-enable-chip', title: 'เปิด/ปิดกฎนี้' }, [enabled, enText]));

  // โหมด Mock / Passthrough (chip เลือก 1)
  const modeChip = (val, text, title) => {
    const inp = el('input', { type: 'radio', name: 'ml-mode', value: val });
    inp.checked = (rule.mode === 'passthrough' ? 'passthrough' : 'mock') === val;
    inp.addEventListener('change', () => syncMode());
    return el('label', { class: 'chip', title }, [inp, el('span', { text: ' ' + text })]);
  };
  cfg.appendChild(el('label', { class: 'map-label', text: 'โหมด' }));
  cfg.appendChild(el('div', { class: 'chip-group mode-chips' }, [
    modeChip('mock', '📦 Mock', 'ตอบ Response body ที่ตั้งไว้ (+override)'),
    modeChip('passthrough', '🔀 Passthrough', 'ยิง server จริง แล้วแก้เฉพาะ key ใน response จริงด้วย override'),
  ]));
  const getMode = () => (document.querySelector('input[name="ml-mode"]:checked') || {}).value || 'mock';
  const overrideEd = makeOverrideEditor(rule.overrides);

  const name = field(cfg, 'ชื่อกฎ (ไว้จำ)', el('input', { type: 'text', value: rule.name || '', placeholder: 'เช่น mock license-types' }));

  const method = el('select');
  for (const m of ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    const opt = el('option', { value: m, text: m });
    if ((rule.method || 'ANY') === m) opt.selected = true;
    method.appendChild(opt);
  }
  field(cfg, 'Method', method);

  const pattern = field(cfg, 'URL pattern (มี * = wildcard, ไม่มี * = ตรวจแบบ "มีคำนี้")',
    el('input', { type: 'text', value: rule.urlPattern || '', placeholder: 'เช่น /api/master-data/license-types หรือ /user/*' }));

  const status = field(cfg, 'HTTP status', el('input', { type: 'text', value: String(rule.status || 200) }));
  const contentType = field(cfg, 'Content-Type', el('input', { type: 'text', value: rule.contentType || 'application/json' }));


  // ---- Response body (คอลัมน์ขวา) — ไฮไลต์สี + ปุ่ม Format ----
  const bodyEd = makeJsonEditor(rule.body || '');
  const jsonHint = el('span', { class: 'hint', text: '' });
  const validateJson = () => {
    const v = bodyEd.textarea.value;
    if ((contentType.value || '').includes('json') && v.trim()) {
      try { JSON.parse(v); jsonHint.textContent = '✅ JSON ถูกต้อง'; jsonHint.style.color = 'var(--green)'; }
      catch (e) { jsonHint.textContent = '⚠️ JSON ไม่ถูกต้อง: ' + e.message; jsonHint.style.color = 'var(--yellow)'; }
    } else jsonHint.textContent = '';
  };
  bodyEd.textarea.addEventListener('input', validateJson);
  contentType.addEventListener('input', validateJson);
  const fmtBtn = el('button', { class: 'map-fmt-btn', type: 'button', title: 'จัดรูปแบบ JSON ให้สวย', text: '✨ Format' });
  fmtBtn.addEventListener('click', () => {
    const v = bodyEd.textarea.value.trim();
    if (!v) return;
    try {
      bodyEd.textarea.value = JSON.stringify(JSON.parse(v), null, 2);
      bodyEd.refresh();
      jsonHint.textContent = '✅ จัดรูปแบบแล้ว'; jsonHint.style.color = 'var(--green)';
    } catch (e) {
      jsonHint.textContent = '⚠️ format ไม่ได้ (JSON ไม่ถูกต้อง): ' + e.message; jsonHint.style.color = 'var(--yellow)';
    }
  });
  bodyCol.appendChild(el('div', { class: 'map-body-head' }, [el('span', { class: 'map-label', text: 'Response body' }), fmtBtn]));
  const passthroughNote = el('div', { class: 'tc-file-banner', text: '🔀 โหมด Passthrough: ใช้ response จริงจาก server — ช่อง body นี้ไม่ถูกใช้ (แก้ค่าด้วย “Override เฉพาะ key” ทางซ้าย)' });
  passthroughNote.style.display = 'none';
  bodyCol.appendChild(passthroughNote);
  bodyCol.appendChild(bodyEd.wrap);
  bodyCol.appendChild(jsonHint);
  // Override เฉพาะ key — วางในคอลัมน์กว้าง (ขวา) จะได้ช่อง path/value กว้างพอ
  bodyCol.appendChild(el('label', { class: 'map-label', text: '🔧 Override เฉพาะ key (path → ค่าใหม่) — ทับบน body/response จริง' }));
  bodyCol.appendChild(overrideEd.el);
  validateJson();
  // โชว์/ซ่อน note ตามโหมด
  function syncMode() {
    const pt = getMode() === 'passthrough';
    passthroughNote.style.display = pt ? 'block' : 'none';
    bodyEd.textarea.readOnly = pt;                     // Passthrough → แก้ไม่ได้ แต่ยัง scroll/เลือก/ดูได้
    bodyEd.wrap.classList.toggle('je-readonly', pt);
    fmtBtn.disabled = pt;                               // ปิดปุ่ม Format ด้วย
    overrideEd.setEnabled(pt); // override ใช้ได้เฉพาะ Passthrough (Mock แก้ body ตรงๆ)
  }
  syncMode();

  const collect = () => ({
    enabled: enabled.checked,
    name: name.value.trim(),
    method: method.value,
    urlPattern: pattern.value.trim(),
    status: status.value.trim(),
    contentType: contentType.value.trim(),
    body: bodyEd.textarea.value,
    mode: getMode(),
    overrides: overrideEd.collect(),
  });

  const status2 = el('span', { class: 'hint' });
  const doSave = async () => {
    const data = collect();
    if (!data.urlPattern) { status2.textContent = '⚠️ กรุณาใส่ URL pattern'; status2.style.color = 'var(--yellow)'; return; }
    // ถ้า content-type เป็น json และมี body → ต้อง parse ได้ ไม่งั้นเตือนแล้วไม่บันทึก
    if ((data.contentType || '').includes('json') && data.body.trim()) {
      try { JSON.parse(data.body); } catch (e) {
        jsonHint.textContent = '⛔ JSON format ผิด — บันทึกไม่ได้: ' + e.message; jsonHint.style.color = 'var(--red)';
        status2.textContent = '❌ format ผิด บันทึกไม่ได้'; status2.style.color = 'var(--red)';
        return;
      }
    }
    const url = isNew ? '/api/maplocal' : `/api/maplocal/${rule.id}`;
    const resp = await (await fetch(url, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })).json();
    if (resp.ok) {
      status2.textContent = '✅ บันทึกแล้ว'; status2.style.color = 'var(--green)';
      selectedRuleId = resp.rule.id;
      await loadMapRules();
      renderMapEditor(resp.rule);
    } else {
      status2.textContent = '❌ ' + (resp.error || 'บันทึกไม่สำเร็จ'); status2.style.color = 'var(--red)';
    }
  };
  mapSaveHandler = doSave; // ให้ Cmd+S เรียก save ของ editor ตัวนี้
  const saveBtn = el('button', { class: 'primary', text: isNew ? 'สร้างกฎ' : 'บันทึก' });
  saveBtn.addEventListener('click', doSave);

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
      mapSaveHandler = null;
      await loadMapRules();
      mapEditorEl.innerHTML = '<p class="empty-msg">เลือกกฎจากด้านซ้าย หรือกด "เพิ่มกฎ" เพื่อสร้างใหม่</p>';
    });
    btnRow.appendChild(delBtn);
  }
  cfg.appendChild(btnRow);
  mapEditorEl.appendChild(el('div', { class: 'map-editor-cols' }, [cfg, bodyCol]));
}

document.getElementById('maplocal-add').addEventListener('click', () => {
  selectedRuleId = null;
  renderMapList();
  renderMapEditor({ enabled: true, method: 'ANY', status: 200, contentType: 'application/json', body: '' });
});

// Cmd/Ctrl+S → บันทึกสิ่งที่เปิดอยู่ (Map Local / Test Case)
window.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's')) return;
  const onMap = document.getElementById('tab-maplocal').classList.contains('active');
  const onTc = document.getElementById('tab-testcases').classList.contains('active');
  if (!onMap && !onTc) return;
  e.preventDefault(); // กัน browser เด้ง save page
  if (onMap && mapSaveHandler) mapSaveHandler();
  else if (onTc && tcSaveHandler) tcSaveHandler();
});

// ทำสำเนา rule/case ที่เลือก (จากข้อมูลที่บันทึกไว้)
async function duplicateMapRule(id) {
  const r = mapRulesData.find((x) => x.id === id);
  if (!r) return;
  const data = { ...r }; delete data.id;
  data.name = (r.name || r.urlPattern || 'rule') + ' (copy)';
  const resp = await (await fetch('/api/maplocal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (resp.ok) { selectedRuleId = resp.rule.id; await loadMapRules(); renderMapEditor(resp.rule); }
}
async function duplicateTestCase(id) {
  const c = tcData.find((x) => x.id === id);
  if (!c) return;
  const data = JSON.parse(JSON.stringify(c));
  for (const k of ['id', 'source', 'active', 'cursors', 'dir']) delete data[k];
  data.name = (c.name || 'case') + ' (copy)';
  const resp = await (await fetch('/api/testcases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (resp.ok) { tcSelectedId = resp.case.id; await loadCases(); }
}
// Cmd/Ctrl+D → ทำสำเนารายการที่เลือก (Map Local rule / Test Case)
window.addEventListener('keydown', (e) => {
  if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd')) return;
  const onMap = document.getElementById('tab-maplocal').classList.contains('active');
  const onTc = document.getElementById('tab-testcases').classList.contains('active');
  if (!onMap && !onTc) return;
  e.preventDefault(); // กัน browser bookmark
  if (onMap && selectedRuleId) duplicateMapRule(selectedRuleId);
  else if (onTc && tcSelectedId) duplicateTestCase(tcSelectedId);
});

// ================= Test Cases (dynamic sequenced mock) =================
const tcListEl = document.getElementById('tc-list');
const tcEditorEl = document.getElementById('tc-editor');
let tcData = [];
let tcActiveId = null;
let tcSelectedId = null;
const newStep = () => ({ label: '', status: 200, contentType: 'application/json', body: '', enabled: true, mode: 'mock', times: 1, overrides: [] });
const newEndpoint = () => ({ method: 'GET', urlPattern: '', steps: [newStep()] });

async function loadCases() {
  try {
    const d = await (await fetch('/api/testcases')).json();
    tcData = d.cases || []; tcActiveId = d.activeCaseId || null;
  } catch { tcData = []; }
  // auto-focus: ยังไม่ได้เลือก + มีเคสที่ active → เปิดเคสนั้นให้เลย
  if (!tcSelectedId && tcActiveId && tcData.some((c) => c.id === tcActiveId)) tcSelectedId = tcActiveId;
  renderTcList();
  renderTcProxyPopup(); // เผื่อ active case เปลี่ยน → อัปเดต popup ในหน้า Proxy
  const sel = tcData.find((c) => c.id === tcSelectedId);
  if (sel) renderTcEditor(sel);
}

// อัปเดต cursor/highlight แบบ realtime (เรียกตอนมี flow เข้า) — ไม่ rebuild editor ถ้ากำลังพิมพ์อยู่ กันโฟกัสหลุด
async function refreshTcCursors() {
  try {
    const d = await (await fetch('/api/testcases')).json();
    tcData = d.cases || []; tcActiveId = d.activeCaseId || null;
  } catch { return; }
  renderTcList();
  updateTcEditorHighlight(); // ปรับ highlight ใน editor แบบ in-place ทุกครั้ง (ไม่ rebuild → โฟกัสไม่หลุด, ไม่ติด editing guard)
}
// เลื่อน highlight step ปัจจุบันใน editor โดยไม่ rebuild (toggle .current + อัปเดต ⏭ badge)
function updateTcEditorHighlight() {
  const c = tcData.find((x) => x.id === tcSelectedId);
  if (!c || c.id !== tcActiveId) { tcEditorEl.querySelectorAll('.tc-step.current').forEach((b) => b.classList.remove('current')); return; }
  const cursors = c.cursors || {}; const hits = c.hits || {};
  c.endpoints.forEach((ep, ei) => {
    const curFull = tcCurFull(ep, cursors[`${ep.method} ${ep.urlPattern}`]);
    const hitN = hits[`${ep.method} ${ep.urlPattern}`] || 0;
    ep.steps.forEach((st, si) => {
      const box = tcEditorEl.querySelector(`.tc-step[data-ep-idx="${ei}"][data-step="${si}"]`);
      if (box) box.classList.toggle('current', curFull === si);
    });
    // อัปเดตตัวเลขครั้งบนช่อง times ของ step ปัจจุบัน (ไม่บังคับ) — ข้ามได้
    void hitN;
  });
}

// render list+tree ลง container ไหนก็ได้ (ใช้ทั้ง panel ซ้าย และ popup หน้า Proxy → CSS เหมือนกัน)
function renderTcList() {
  buildTcListInto(tcListEl);
  // อัปเดต popup เฉพาะโหมด full (compact/mini rebuild ผ่าน renderTcProxyPopup เอง — กันเนื้อหา compact โดนทับด้วย tree เต็ม)
  if (_tcPopupEl && _tcPopupEl.style.display !== 'none' && _tcPopup.mode === 'full') {
    const pl = _tcPopupEl.querySelector('.tc-popup-list');
    if (pl) buildTcListInto(pl);
  }
}
function buildTcListInto(host) {
  const prevScroll = host.scrollTop || 0; // คง scroll เดิมเมื่อ rebuild ทับ element เดิม (เช่น flow เข้ามา)
  host.innerHTML = '';
  if (!tcData.length) { host.appendChild(el('p', { class: 'empty-msg', html: 'ยังไม่มีเคส<br/>กด "เพิ่มเคส" เพื่อสร้าง' })); return; }
  for (const c of tcData) {
    const active = c.id === tcActiveId;
    const tog = el('button', { class: 'map-item-toggle ' + (active ? 'on' : 'off'), type: 'button', text: active ? 'Enabled' : 'Disabled', title: 'คลิกเพื่อเปิด/ปิดใช้เคสนี้ (เปิดได้ทีละเคส)' });
    tog.addEventListener('click', async (e) => {
      e.stopPropagation(); // อย่าเปิด editor
      await fetch(active ? '/api/testcases/deactivate' : `/api/testcases/${c.id}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await loadCases();
    });
    const item = el('div', { class: 'map-item' + (c.id === tcSelectedId ? ' selected' : '') }, [
      el('span', { class: 'map-dot ' + (active ? 'on' : 'off'), text: active ? '●' : '○' }),
      el('div', { class: 'map-item-body' }, [
        el('div', { class: 'map-item-name', text: c.name || '(ไม่มีชื่อ)' }),
        el('div', { class: 'map-item-sub', text: `${c.source === 'file' ? '🗂️ file' : '✎ inline'} · ${c.endpoints.length} ep${c.autoAdvance !== false ? ' · ⚡auto' : ''}${c.loop ? ' · 🔁loop' : ''}${active ? ' · 🟢 active' : ''}` }),
      ]),
      tog,
    ]);
    item.addEventListener('click', () => { tcSelectedId = c.id; renderTcList(); renderTcEditor(c); });
    host.appendChild(item);
    // เคสที่เลือก → กาง tree: endpoints > steps คลิกเลื่อนไปที่ตัวนั้นใน editor + highlight step ที่กำลังทำงาน
    if (c.id === tcSelectedId) {
      const cursors = c.cursors || {};
      const tree = el('div', { class: 'tc-nav' });
      const flags = [];
      if (c.autoAdvance !== false) flags.push('⚡ AUTO-ADVANCE');
      if (c.loop) flags.push('🔁 LOOP');
      if (active) flags.push('▶ RUNNING');
      tree.appendChild(el('div', { class: 'tc-nav-summary', text: `${c.source === 'file' ? '🗂️ FILE' : '✎ INLINE'} · ${c.endpoints.length} ENDPOINTS${flags.length ? ' · ' + flags.join(' · ') : ''}` }));
      c.endpoints.forEach((ep, ei) => {
        const curFull = active ? tcCurFull(ep, cursors[`${ep.method} ${ep.urlPattern}`]) : undefined;
        const epNode = el('div', { class: 'tc-nav-ep' + (curFull != null ? ' has-current' : ''), title: 'ไปที่ endpoint นี้' }, [
          el('span', { class: 'tc-nav-method m-' + (ep.method || 'any').toLowerCase(), text: ep.method || 'ANY' }),
          el('span', { class: 'tc-nav-ep-path', text: ep.urlPattern || '(no pattern)' }),
        ]);
        epNode.addEventListener('click', (e) => { e.stopPropagation(); scrollTcTo(`.tc-ep[data-ep-idx="${ei}"]`, 'start'); });
        tree.appendChild(epNode);
        (ep.steps || []).forEach((st, si) => {
          const stOff = st.enabled === false;
          const cur = active && curFull === si;
          const times = Math.max(1, st.times || 1);
          const hitN = (c.hits || {})[`${ep.method} ${ep.urlPattern}`] || 0;
          const stNode = el('div', { class: 'tc-nav-step' + (cur ? ' current' : '') + (stOff ? ' off' : ''), title: 'ไปที่ step นี้' }, [
            el('span', { class: 'tc-nav-bullet', text: `#${si + 1}` }),
            el('span', { class: 'tc-nav-step-label', text: st.label || `step ${si + 1}` }),
            stOff ? el('span', { class: 'tc-nav-off-tag', text: 'ปิด' })
              : cur ? el('span', { class: 'tc-nav-times', title: `เหลืออีก ${times - hitN} ครั้งถึง step ถัดไป (ครั้งที่ ${hitN + 1}/${times})`, text: `⏭ ${times - hitN}` })
                : (times > 1 ? el('span', { class: 'tc-nav-times dim', text: `×${times}` }) : el('span')),
          ]);
          // ไอคอน "ตั้งเป็น step ปัจจุบัน" — เฉพาะเคส active + step ที่เปิด + ยังไม่ใช่ตัวปัจจุบัน
          if (active && !stOff && !cur) {
            const setBtn = el('span', { class: 'tc-nav-set', title: 'ตั้งเป็น step ปัจจุบัน (auto-advance จะไหลต่อจากตรงนี้)', text: '◎' });
            setBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              let sub = 0; for (let j = 0; j < si; j++) if (ep.steps[j].enabled !== false) sub++; // แปลงเป็น index ของ enabled-sublist
              await fetch('/api/testcases/goto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pattern: ep.urlPattern, index: sub }) });
              await tcAfterChange(); // อัปเดต popup+panel+highlight แบบเบา (ไม่ rebuild editor → ไม่ทำมุมมองเพี้ยน) เหมือนปุ่ม ◀▶
            });
            stNode.appendChild(setBtn);
          }
          stNode.addEventListener('click', (e) => { e.stopPropagation(); scrollTcTo(`.tc-step[data-ep-idx="${ei}"][data-step="${si}"]`, 'start'); });
          tree.appendChild(stNode);
        });
      });
      host.appendChild(tree);
    }
  }
  host.scrollTop = prevScroll; // คืนตำแหน่ง scroll เดิม
}

// เลื่อน editor ไปที่ endpoint/step ที่เลือกจาก tree ด้านซ้าย + flash ให้เห็น
function scrollTcTo(selector, block = 'center') {
  // ถ้าคลิกจาก popup (อยู่แท็บ Proxy) → สลับไปแท็บ Test Case + render editor ของเคสที่เลือกก่อน แล้วค่อยเลื่อน
  const onTc = document.getElementById('tab-testcases').classList.contains('active');
  if (!onTc) {
    document.querySelector('.tab-btn[data-tab="testcases"]').click();
    const sel = tcData.find((c) => c.id === tcSelectedId);
    if (sel) renderTcEditor(sel);
  }
  setTimeout(() => {
    const t = tcEditorEl.querySelector(selector);
    if (!t) return;
    t.scrollIntoView({ block, behavior: 'smooth' });
    t.classList.add('tc-step-flash');
    setTimeout(() => t.classList.remove('tc-step-flash'), 1600);
  }, onTc ? 0 : 90);
}

// เมนูย้าย/คัดลอก step ไป endpoint อื่น (บนสุด/ล่างสุด ของแต่ละ endpoint) — mode: 'move' | 'copy'
let _stepMoveMenu = null;
function closeStepMoveMenu() { if (_stepMoveMenu) { _stepMoveMenu.remove(); _stepMoveMenu = null; } }
document.addEventListener('click', closeStepMoveMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeStepMoveMenu(); });
function showStepTargetMenu(ev, model, fromEi, fromSi, mode, redraw) {
  closeStepMoveMenu();
  const isCopy = mode === 'copy';
  const srcStep = model.endpoints[fromEi].steps[fromSi];
  const menu = el('div', { class: 'flow-ctx-menu step-move-menu' });
  menu.appendChild(el('div', { class: 'smm-title', text: (isCopy ? 'คัดลอก step นี้ไปที่:' : 'ย้าย step นี้ไปที่:') }));
  // วางก่อน/หลัง step เป้าหมาย (อ้างด้วย object reference กัน index เลื่อนตอน move)
  const place = (ti, targetStepObj, after) => {
    if (!isCopy && targetStepObj === srcStep) { closeStepMoveMenu(); return; } // ย้ายไปที่ตัวเอง = ไม่ทำอะไร
    const step = isCopy ? JSON.parse(JSON.stringify(srcStep)) : model.endpoints[fromEi].steps.splice(fromSi, 1)[0];
    if (!step) return;
    const arr = model.endpoints[ti].steps;
    let idx = arr.indexOf(targetStepObj);
    if (idx < 0) idx = after ? arr.length - 1 : 0;
    arr.splice(after ? idx + 1 : idx, 0, step);
    closeStepMoveMenu();
    redraw();
  };
  model.endpoints.forEach((ep, ti) => {
    menu.appendChild(el('div', { class: 'smm-ep-head', text: `${ep.method || 'ANY'} ${ep.urlPattern || '(no pattern)'}` }));
    if (!ep.steps.length) { menu.appendChild(el('div', { class: 'smm-empty', text: '(ไม่มี step)' })); return; }
    ep.steps.forEach((st, tsi) => {
      const self = ti === fromEi && tsi === fromSi;
      const before = el('button', { class: 'smm-btn', type: 'button', title: 'วางก่อนอันนี้', text: '↑ ก่อน' });
      const after = el('button', { class: 'smm-btn', type: 'button', title: 'วางหลังอันนี้', text: '↓ หลัง' });
      before.addEventListener('click', (e) => { e.stopPropagation(); place(ti, st, false); });
      after.addEventListener('click', (e) => { e.stopPropagation(); place(ti, st, true); });
      menu.appendChild(el('div', { class: 'smm-row' + (self ? ' smm-self' : '') }, [
        el('span', { class: 'smm-ep', text: `#${tsi + 1}${st.label ? ' ' + st.label : ''}${self ? ' • นี่' : ''}` }),
        before, after,
      ]));
    });
  });
  document.body.appendChild(menu);
  const mw = menu.offsetWidth || 280, mh = menu.offsetHeight || 240;
  let x = ev.clientX, y = ev.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = Math.max(4, x) + 'px';
  menu.style.top = Math.max(4, y) + 'px';
  _stepMoveMenu = menu;
}

// cursor เก็บเป็น index ของ "step ที่เปิด" (sublist) → แปลงเป็น index จริงใน list เต็ม เพื่อไฮไลต์ถูกช่อง
function tcCurFull(ep, curSub) {
  if (curSub == null) return undefined;
  const idxs = [];
  (ep.steps || []).forEach((s, i) => { if (s.enabled !== false) idxs.push(i); });
  return idxs[Math.min(curSub, idxs.length - 1)];
}
// แสดงว่าตอนนี้อยู่ step ไหนของแต่ละ endpoint (นับเฉพาะ step ที่เปิด)
function tcPositionEl(caseObj, cursors) {
  const rows = [];
  for (const ep of caseObj.endpoints || []) {
    const enabled = (ep.steps || []).filter((s) => s.enabled !== false);
    if (!enabled.length) continue;
    const i = Math.min(cursors[`${ep.method} ${ep.urlPattern}`] || 0, enabled.length - 1);
    const label = enabled[i] && enabled[i].label ? ` — ${enabled[i].label}` : '';
    rows.push(el('div', { class: 'tc-pos-row', text: `${ep.urlPattern || '(no pattern)'} · step ${i + 1}/${enabled.length}${label}` }));
  }
  return el('div', { class: 'tc-pos' }, [el('span', { class: 'tc-pos-title', text: '📍 ตอนนี้อยู่ที่' }), ...rows]);
}

function tcControls(caseObj) {
  const active = caseObj.id === tcActiveId;
  const actBtn = el('button', { class: active ? 'pd-btn danger' : 'pd-btn primary', text: active ? '⏹ ปิดใช้เคสนี้' : '▶ เปิดใช้เคสนี้' });
  actBtn.addEventListener('click', async () => {
    await fetch(active ? '/api/testcases/deactivate' : `/api/testcases/${caseObj.id}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await loadCases();
  });
  const ctrls = el('div', { class: 'tc-ctrls' }, [actBtn]);
  if (active) {
    const resetBtn = el('button', { class: 'pd-btn primary', text: '↺ Reset' });
    resetBtn.addEventListener('click', async () => { await fetch('/api/testcases/reset', { method: 'POST' }); await loadCases(); });
    const nextBtn = el('button', { class: 'pd-btn primary', text: '⏭ Next step' });
    nextBtn.addEventListener('click', async () => { await fetch('/api/testcases/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadCases(); });
    ctrls.appendChild(resetBtn); ctrls.appendChild(nextBtn);
  }
  return ctrls;
}

function renderTcEditor(caseObj) {
  // เคสจากไฟล์ = read-only (แก้ที่ไฟล์แล้ว reload)
  if (caseObj.source === 'file') {
    tcEditorEl.innerHTML = '';
    const scroll = el('div', { class: 'tc-scroll' });
    tcEditorEl.appendChild(scroll);
    scroll.appendChild(el('div', { class: 'tc-file-banner', html: `🗂️ เคสจากไฟล์ <code>test-cases/${caseObj.dir}/</code> (read-only) — แก้ที่ไฟล์แล้วกด 🔄 Reload ไฟล์` }));
    scroll.appendChild(el('div', { class: 'tc-name', text: caseObj.name }));
    scroll.appendChild(tcControls(caseObj));
    const cursors = (tcData.find((c) => c.id === caseObj.id) || {}).cursors || {};
    const active = caseObj.id === tcActiveId;
    if (active) scroll.appendChild(tcPositionEl(caseObj, cursors));
    for (const ep of caseObj.endpoints) {
      const box = el('div', { class: 'tc-ep' });
      box.appendChild(el('div', { class: 'tc-ep-head' }, [methodBadge(ep.method), el('code', { text: ep.urlPattern })]));
      const curFull = tcCurFull(ep, cursors[`${ep.method} ${ep.urlPattern}`]);
      ep.steps.forEach((st, si) => {
        const isCur = active && curFull === si;
        const off = st.enabled === false;
        const stBox = el('div', { class: 'tc-step' + (isCur ? ' current' : '') + (off ? ' tc-step-off' : ''), 'data-pattern': ep.urlPattern, 'data-step': String(si) });
        stBox.appendChild(el('div', { class: 'tc-step-head' }, [el('span', { class: 'tc-step-num', text: `#${si + 1} ${st.label || ''} · ${st.status}${off ? ' · ปิด' : ''}` })]));
        stBox.appendChild(el('pre', { class: 'code-block json tc-ro-body', html: syntaxHighlightJson(st.body || '') }));
        box.appendChild(stBox);
      });
      scroll.appendChild(box);
    }
    return;
  }

  const isNew = !caseObj.id;
  const model = {
    id: caseObj.id,
    name: caseObj.name || '',
    autoAdvance: caseObj.autoAdvance !== false,
    loop: caseObj.loop === true,
    endpoints: (caseObj.endpoints || []).map((e) => ({
      method: e.method || 'GET', urlPattern: e.urlPattern || '',
      steps: (e.steps || []).map((s) => ({ label: s.label || '', status: s.status || 200, contentType: s.contentType || 'application/json', body: s.body || '', enabled: s.enabled !== false, mode: s.mode === 'passthrough' ? 'passthrough' : 'mock', times: Math.max(1, Number(s.times) || 1), overrides: Array.isArray(s.overrides) ? s.overrides : [] })),
    })),
  };
  if (!model.endpoints.length) model.endpoints.push(newEndpoint());
  const cursors = (tcData.find((c) => c.id === model.id) || {}).cursors || {};
  const status2 = el('span', { class: 'hint' });

  const draw = () => {
    // จำตำแหน่ง scroll เดิมไว้ (draw() สร้าง .tc-scroll ใหม่ → ไม่งั้นเด้งขึ้นบนทุกครั้งที่ +endpoint/+step)
    const prevScroll = (() => { const s = tcEditorEl.querySelector('.tc-scroll'); return s ? s.scrollTop : 0; })();
    tcEditorEl.innerHTML = '';
    const scroll = el('div', { class: 'tc-scroll' }); // ส่วนที่ scroll (footer อยู่นอกนี้ ปักล่าง)
    tcEditorEl.appendChild(scroll);
    const nameInput = el('input', { type: 'text', value: model.name, placeholder: 'ชื่อเคส เช่น case 5' });
    nameInput.addEventListener('input', () => { model.name = nameInput.value; });
    // chip toggle: auto-advance / loop — อยู่แถวเดียวกับชื่อเคส ชิดขวา
    const mkToggle = (text, checked, onChange, title) => {
      const inp = el('input', { type: 'checkbox' }); inp.checked = checked;
      inp.addEventListener('change', () => onChange(inp.checked));
      return el('label', { class: 'toggle-chip', title: title || '' }, [inp, el('span', { text: ' ' + text })]);
    };
    const autoChip = mkToggle('⚡ auto-advance', model.autoAdvance, (v) => { model.autoAdvance = v; }, 'เลื่อน step อัตโนมัติเมื่อ endpoint ถูกเรียก');
    const loopChip = mkToggle('🔁 loop', model.loop, (v) => { model.loop = v; }, 'จบ step สุดท้ายแล้ววนกลับ step 1');
    scroll.appendChild(el('label', { class: 'map-label', text: 'ชื่อเคส' }));
    scroll.appendChild(el('div', { class: 'tc-name-row' }, [nameInput, el('div', { class: 'tc-toggles' }, [autoChip, loopChip])]));

    if (!isNew) {
      const active = model.id === tcActiveId;
      const actBtn = el('button', { class: active ? 'pd-btn danger' : 'pd-btn primary', text: active ? '⏹ ปิดใช้เคสนี้' : '▶ เปิดใช้เคสนี้' });
      actBtn.addEventListener('click', async () => {
        await fetch(active ? '/api/testcases/deactivate' : `/api/testcases/${model.id}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await loadCases();
      });
      const ctrls = el('div', { class: 'tc-ctrls' }, [actBtn]);
      if (active) {
        const resetBtn = el('button', { class: 'pd-btn primary', text: '↺ Reset' });
        resetBtn.addEventListener('click', async () => { await fetch('/api/testcases/reset', { method: 'POST' }); await loadCases(); });
        const nextBtn = el('button', { class: 'pd-btn primary', text: '⏭ Next step' });
        nextBtn.addEventListener('click', async () => { await fetch('/api/testcases/next', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); await loadCases(); });
        ctrls.appendChild(resetBtn); ctrls.appendChild(nextBtn);
      }
      scroll.appendChild(ctrls);
      if (active) scroll.appendChild(tcPositionEl(model, cursors)); // แสดงว่าตอนนี้อยู่ step ไหน
    }

    scroll.appendChild(el('div', { class: 'map-label', text: 'Endpoints (แต่ละ endpoint ตอบตามลำดับ step)' }));
    model.endpoints.forEach((ep, ei) => {
      const box = el('div', { class: 'tc-ep', 'data-ep-idx': String(ei) });
      const mSel = el('select', { class: 'tc-ep-method' });
      for (const m of ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']) { const o = el('option', { value: m, text: m }); if (ep.method === m) o.selected = true; mSel.appendChild(o); }
      mSel.addEventListener('change', () => { ep.method = mSel.value; });
      const pat = el('input', { type: 'text', class: 'tc-ep-pattern', value: ep.urlPattern, placeholder: '/api/detail หรือ /user/*' });
      pat.addEventListener('input', () => { ep.urlPattern = pat.value; });
      const dupEp = el('button', { class: 'tc-dup', title: 'ทำสำเนา endpoint นี้ (ทุก step)', text: '⧉' });
      dupEp.addEventListener('click', () => { model.endpoints.splice(ei + 1, 0, JSON.parse(JSON.stringify(ep))); draw(); });
      const rmEp = el('button', { class: 'tc-x', title: 'ลบ endpoint', text: '✕' });
      rmEp.addEventListener('click', () => { model.endpoints.splice(ei, 1); if (!model.endpoints.length) model.endpoints.push(newEndpoint()); draw(); });
      // apply times ทุก step ใน endpoint นี้ (ย้ายมาอยู่หัว endpoint หลัง URL)
      const applyInput = el('input', { type: 'number', min: '1', value: String((ep.steps[0] && ep.steps[0].times) || 1), class: 'tc-apply-times', title: 'จำนวนครั้ง (times)' });
      const applyBtn = el('button', { class: 'tc-apply-btn', type: 'button', title: 'ตั้ง times ทุก step ใน endpoint นี้ให้เท่ากัน', text: '× ทุก step' });
      applyBtn.addEventListener('click', () => { const v = Math.max(1, parseInt(applyInput.value, 10) || 1); ep.steps.forEach((s) => { s.times = v; }); draw(); });
      box.appendChild(el('div', { class: 'tc-ep-head' }, [mSel, pat, applyInput, applyBtn, dupEp, rmEp]));

      const curFull = tcCurFull(ep, cursors[`${ep.method} ${ep.urlPattern}`]);
      ep.steps.forEach((st, si) => {
        const isCur = model.id === tcActiveId && curFull === si;
        const off = st.enabled === false;
        const stBox = el('div', { class: 'tc-step' + (isCur ? ' current' : '') + (off ? ' tc-step-off' : ''), 'data-ep-idx': String(ei), 'data-pattern': ep.urlPattern, 'data-step': String(si) });
        const sLabel = el('input', { type: 'text', class: 'tc-step-label', value: st.label, placeholder: `label step ${si + 1}` });
        sLabel.addEventListener('input', () => { st.label = sLabel.value; });
        const sStatus = el('input', { type: 'text', class: 'tc-step-status', value: String(st.status), placeholder: 'status' });
        sStatus.addEventListener('input', () => { st.status = parseInt(sStatus.value, 10) || 200; });
        const sCt = el('input', { type: 'text', class: 'tc-step-ct', value: st.contentType, placeholder: 'content-type' });
        sCt.addEventListener('input', () => { st.contentType = sCt.value; });
        // times = ต้องเรียกกี่ครั้งก่อนไป step ถัดไป (default 1)
        const sTimes = el('input', { type: 'number', class: 'tc-step-times', min: '1', value: String(st.times || 1), title: 'เรียกกี่ครั้งก่อนไป step ถัดไป (×N)' });
        sTimes.addEventListener('input', () => { st.times = Math.max(1, parseInt(sTimes.value, 10) || 1); });
        // โหมด Mock/Passthrough ต่อ step (เหมือน Map Local) — chip เล็กหลัง content-type สูงเท่าปุ่มเปิด
        const pt = st.mode === 'passthrough';
        const mkStepMode = (val, txt, title) => {
          const inp = el('input', { type: 'radio', name: `tcm-${ei}-${si}`, value: val }); inp.checked = (pt ? 'passthrough' : 'mock') === val;
          inp.addEventListener('change', () => { st.mode = val; draw(); });
          return el('label', { class: 'chip', title }, [inp, el('span', { text: txt })]);
        };
        const modeGroup = el('div', { class: 'chip-group tc-step-mode' }, [
          mkStepMode('mock', '📦', 'Mock — ตอบ body ที่ตั้ง'),
          mkStepMode('passthrough', '🔀', 'Passthrough — ยิงจริงแล้ว override เฉพาะ key'),
        ]);
        // toggle เปิด/ปิด step (ปิดแล้วถูกข้ามใน sequence ไม่ต้องลบ)
        const enToggle = el('button', { class: 'tc-step-toggle ' + (off ? 'off' : 'on'), type: 'button', title: 'เปิด/ปิด step นี้', text: off ? 'ปิด' : 'เปิด' });
        enToggle.addEventListener('click', () => { st.enabled = off; draw(); });
        const moveSt = el('button', { class: 'tc-dup', title: 'ย้าย step ไป endpoint อื่น (บน/ล่าง)', text: '⇅' });
        moveSt.addEventListener('click', (e) => { e.stopPropagation(); showStepTargetMenu(e, model, ei, si, 'move', draw); });
        const dupSt = el('button', { class: 'tc-dup', title: 'คัดลอก step ไป before/after #index', text: '⧉' });
        dupSt.addEventListener('click', (e) => { e.stopPropagation(); showStepTargetMenu(e, model, ei, si, 'copy', draw); });
        const rmSt = el('button', { class: 'tc-x', title: 'ลบ step', text: '✕' });
        rmSt.addEventListener('click', () => { ep.steps.splice(si, 1); if (!ep.steps.length) ep.steps.push(newStep()); draw(); });
        const bodyEd = makeJsonEditor(st.body);
        bodyEd.textarea.addEventListener('input', () => { st.body = bodyEd.textarea.value; });
        bodyEd.wrap.classList.add('tc-step-body');
        stBox.appendChild(el('div', { class: 'tc-step-head' }, [el('span', { class: 'tc-step-num', text: `#${si + 1}${off ? ' · ปิด' : ''}` }), sLabel, sStatus, sCt, el('span', { class: 'tc-times-x', text: '×' }), sTimes, modeGroup, enToggle, moveSt, dupSt, rmSt]));
        if (pt) stBox.appendChild(el('div', { class: 'tc-file-banner', text: '🔀 Passthrough: ใช้ response จริงจาก server — body ด้านล่างไม่ถูกใช้ (แก้ด้วย Override)' }));
        stBox.appendChild(bodyEd.wrap);
        // override เฉพาะ key ของ step นี้ — เปิดใช้เฉพาะ Passthrough (เหมือน Map Local; Mock แก้ body ตรงๆ)
        const ovEd = makeOverrideEditor(st.overrides, (ovs) => { st.overrides = ovs; });
        stBox.appendChild(el('div', { class: 'map-label', text: '🔧 Override เฉพาะ key' }));
        stBox.appendChild(ovEd.el);
        // mirror Map Local: passthrough → body read-only (ยัง scroll/ดูได้) + override เปิด; mock → body แก้ได้ + override ปิด
        bodyEd.textarea.readOnly = pt;
        bodyEd.wrap.classList.toggle('je-readonly', pt);
        ovEd.setEnabled(pt);
        box.appendChild(stBox);
      });
      const addStep = el('button', { class: 'tc-add-step', text: '+ step' });
      addStep.addEventListener('click', () => { ep.steps.push(newStep()); draw(); });
      box.appendChild(el('div', { class: 'tc-step-foot' }, [addStep])); // apply-times ย้ายไปหัว endpoint แล้ว
      scroll.appendChild(box);
    });

    const addEp = el('button', { class: 'tc-add-ep', text: '+ เพิ่ม endpoint' });
    addEp.addEventListener('click', () => { model.endpoints.push(newEndpoint()); draw(); });

    const saveBtn = el('button', { class: 'primary', text: isNew ? 'สร้างเคส' : 'บันทึก' });
    const doSaveTc = async () => {
      if (!model.name.trim()) { status2.textContent = '⚠️ ใส่ชื่อเคสก่อน'; status2.style.color = 'var(--yellow)'; return; }
      for (const ep of model.endpoints) {
        for (const st of ep.steps) {
          if ((st.contentType || '').includes('json') && st.body.trim()) {
            try { JSON.parse(st.body); } catch (e) { status2.textContent = `⛔ JSON ผิดที่ ${ep.urlPattern || '(endpoint)'}: ${e.message}`; status2.style.color = 'var(--red)'; return; }
          }
        }
      }
      const url = isNew ? '/api/testcases' : `/api/testcases/${model.id}`;
      const resp = await (await fetch(url, { method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model) })).json();
      if (resp.ok) { status2.textContent = '✅ บันทึกแล้ว'; status2.style.color = 'var(--green)'; tcSelectedId = resp.case.id; await loadCases(); }
      else { status2.textContent = '❌ ' + (resp.error || 'บันทึกไม่สำเร็จ'); status2.style.color = 'var(--red)'; }
    };
    saveBtn.addEventListener('click', doSaveTc);
    tcSaveHandler = doSaveTc; // ให้ Cmd/Ctrl+S เรียก save ของเคสที่เปิดอยู่
    const btnRow = el('div', { class: 'map-btn-row' }, [saveBtn, status2]);
    if (!isNew) {
      const delBtn = el('button', { class: 'danger', text: '🗑️ ลบเคส' });
      delBtn.addEventListener('click', async () => { await fetch(`/api/testcases/${model.id}`, { method: 'DELETE' }); tcSelectedId = null; await loadCases(); tcEditorEl.innerHTML = '<p class="empty-msg">เลือกเคส หรือกด "เพิ่มเคส"</p>'; });
      btnRow.appendChild(delBtn);
    }
    // footer ปักล่าง — เห็นปุ่มเพิ่ม endpoint/บันทึก/ลบเคส เสมอ ไม่ต้อง scroll ตาม
    tcEditorEl.appendChild(el('div', { class: 'tc-footer' }, [addEp, btnRow]));
    scroll.scrollTop = prevScroll; // คงตำแหน่ง scroll เดิม (ไม่เด้งขึ้นบน)
  };
  draw();
}

document.getElementById('tc-add').addEventListener('click', () => {
  tcSelectedId = null;
  renderTcList();
  renderTcEditor({ autoAdvance: true, endpoints: [] });
});
document.getElementById('tc-reload').addEventListener('click', async (e) => {
  const b = e.currentTarget; b.disabled = true;
  try { const r = await (await fetch('/api/testcases/reload', { method: 'POST' })).json(); await loadCases(); b.textContent = `🔄 Reload (${r.fileCases} ไฟล์)`; setTimeout(() => { b.textContent = '🔄 Reload ไฟล์'; }, 1500); }
  finally { b.disabled = false; }
});

loadCases();

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

// ================= Status tab (ความพร้อมของระบบ + ปุ่มเปิด service ที่ดับ) =================
const statusCards = document.getElementById('status-cards');
const statusBanner = document.getElementById('status-banner');

function stBadge(up, textUp = 'พร้อมใช้งาน', textDown = 'ไม่พร้อม') {
  return el('span', { class: 'st-badge ' + (up ? 'up' : 'down'), text: up ? '✅ ' + textUp : '❌ ' + textDown });
}

function stBtn(label, onClick, kind = '') {
  const b = el('button', { class: 'st-action' + (kind ? ' ' + kind : ''), text: label });
  b.addEventListener('click', async () => {
    b.disabled = true;
    const old = b.textContent;
    b.textContent = '⏳ กำลังทำ…';
    try { await onClick(); } catch (e) { alert('ไม่สำเร็จ: ' + e.message); }
    b.disabled = false;
    b.textContent = old;
    renderStatus();
  });
  return b;
}

async function stStartService(svc) {
  const r = await (await fetch('/api/status/start/' + svc, { method: 'POST' })).json();
  if (!r.ok) throw new Error((r.error || 'start ไม่สำเร็จ') + (r.log ? '\n--- log ---\n' + r.log : ''));
}

async function stStopService(svc) {
  const r = await (await fetch('/api/status/stop/' + svc, { method: 'POST' })).json();
  if (!r.ok) throw new Error(r.error || 'stop ไม่สำเร็จ');
}

async function stDisconnectDevice(serial) {
  const r = await (await fetch('/api/devices/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial }),
  })).json();
  if (!r.ok) throw new Error(r.error || 'disconnect ไม่สำเร็จ');
}

// ติดตั้ง CA เข้า system store ของ Android Emulator อัตโนมัติ (auto-trust HTTPS)
// stBtn ครอบ busy state + จับ error ให้แล้ว — ที่นี่แค่ยิง endpoint + แจ้งผล
async function stInstallCaEmulator(serial) {
  const r = await (await fetch('/api/devices/install-ca-emulator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial }),
  })).json();
  if (!r.ok) throw new Error(r.error);
  alert('✅ ติดตั้ง CA เข้า system store แล้ว\n\n' + r.note
    + '\n\nแอปที่เปิดค้างอยู่ให้ปิด-เปิดใหม่ (force-stop) เพื่อให้เชื่อ CA · แอปที่ทำ certificate pinning จะยังถอดรหัสไม่ได้ (ปกติ)');
  renderStatus();
}

// ปลด mute ตรงๆ (ไม่ต้อง reconnect) — ใช้ตอนตั้ง proxy เองบนมือถือ/emulator แล้วอยากรับ flow
async function stUnmute() {
  const r = await (await fetch('/api/proxy/mute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ muted: false }),
  })).json();
  if (!r.ok) throw new Error(r.error || 'ปลด mute ไม่สำเร็จ');
  renderStatus();
}

async function stConnectDevice(serial, mode) {
  const r = await (await fetch('/api/devices/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serial, mode }),
  })).json();
  // Guard โหมด Wi-Fi: มือถือไม่ได้อยู่วงเดียวกับ Mac → เตือนชัดๆ ไม่ตั้ง proxy ค้าง
  if (r.unreachable) { alert('⚠️ เชื่อม Wi-Fi ไม่ได้\n\n' + r.error); return; }
  if (!r.ok) throw new Error(r.error || 'connect ไม่สำเร็จ');
}

function stCard(icon, title, up, details, actions = []) {
  const card = el('div', { class: 'st-card ' + (up ? 'ok' : 'bad') }, [
    el('div', { class: 'st-head' }, [
      el('span', { class: 'st-title', text: icon + ' ' + title }),
      stBadge(up),
    ]),
    el('div', { class: 'st-body' }, details.map((t) => el('div', { class: 'st-line', text: t }))),
  ]);
  if (actions.length) card.appendChild(el('div', { class: 'st-actions' }, actions));
  return card;
}

// popup QR ลอยตามเมาส์ — ผูกกับ element ใดก็ได้ที่ให้ผู้ใช้เอาเมาส์ไปชี้
let _qrPopup = null;
function attachQrHover(target, url, size = 200) {
  const show = (e) => {
    if (!_qrPopup) {
      _qrPopup = el('div', { class: 'qr-popup' }, [
        el('img', { width: String(size), height: String(size),
          src: `/api/qr?data=${encodeURIComponent(url)}&size=${size}` }),
        el('div', { class: 'qr-popup-cap', text: url }),
      ]);
      document.body.appendChild(_qrPopup);
    }
    move(e);
  };
  const move = (e) => {
    if (!_qrPopup) return;
    // วางใกล้เมาส์ กันล้นขอบจอ
    const pad = 16, w = size + 20, h = size + 40;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth) x = e.clientX - w - pad;
    if (y + h > window.innerHeight) y = e.clientY - h - pad;
    _qrPopup.style.left = Math.max(4, x) + 'px';
    _qrPopup.style.top = Math.max(4, y) + 'px';
  };
  const hide = () => { if (_qrPopup) { _qrPopup.remove(); _qrPopup = null; } };
  target.addEventListener('mouseenter', show);
  target.addEventListener('mousemove', move);
  target.addEventListener('mouseleave', hide);
}

// ติดตั้ง CA แบบ Manual — โหลด cert จากเว็บ (ไม่พึ่ง adb/USB) ใช้ได้ทุก OS + เคส Docker
// มี QR ของ URL โหลดผ่าน LAN ให้มือถือสแกนโหลดตรงได้เลย
function renderCaCard(lanIp, mitmUp) {
  const dlPath = '/api/devices/ca';
  const lanUrl = lanIp ? `http://${lanIp}:3000${dlPath}` : null;
  const card = el('div', { class: 'st-card ' + (mitmUp ? 'ok' : 'bad') }, [
    el('div', { class: 'st-head' }, [
      el('span', { class: 'st-title', text: '📜 CA Certificate (Manual)' }),
      el('span', { class: 'st-badge ' + (mitmUp ? 'up' : 'down'),
        text: mitmUp ? '✅ พร้อมโหลด' : '⚠️ จะ gen ให้ตอนโหลด' }),
    ]),
    el('div', { class: 'st-body' }, [
      el('div', { class: 'st-line', text: 'ติดตั้ง CA เองโดยไม่ต้องต่อ USB — เหมาะกับ iOS, Android ที่ไม่ต่อสาย, หรือรันใน Docker' }),
    ]),
  ]);
  const body = card.querySelector('.st-body');
  // แถบสถานะจริงของไฟล์ CA — เช็คจาก /api/devices/ca/status (ไม่ gen ใหม่) แล้วอัปเดตทีหลัง
  const statusLine = el('div', { class: 'st-ca-status checking', text: '⏳ กำลังเช็คสถานะ CA…' });
  body.appendChild(statusLine);
  // ลิงก์ดาวน์โหลดแบบข้อความ (โชว์ URL ให้เห็น/คัดลอกได้) + LAN URL ให้มือถือเปิดตรง
  const linkLine = el('div', { class: 'st-ca-links' }, [
    el('span', { class: 'st-ca-link-label', text: 'ลิงก์โหลด: ' }),
    el('a', { class: 'st-ca-link', href: dlPath, download: 'mitmproxy-ca.crt', text: dlPath }),
  ]);
  if (lanUrl) {
    linkLine.appendChild(el('span', { class: 'st-ca-link-sep', text: ' · LAN: ' }));
    linkLine.appendChild(el('a', { class: 'st-ca-link', href: lanUrl, target: '_blank', rel: 'noopener', text: lanUrl }));
  }
  body.appendChild(linkLine);
  // วิธีติดตั้งย่อ ต่อ OS
  const ol = el('ol', { class: 'st-steps' });
  ol.appendChild(el('li', { text: 'โหลดไฟล์ CA (ปุ่มด้านล่าง) หรือให้มือถือสแกน QR โหลดผ่าน Wi-Fi' }));
  ol.appendChild(el('li', { html: '<b>iOS:</b> ติดตั้ง profile → Settings → General → About → Certificate Trust Settings → เปิดสวิตช์' }));
  ol.appendChild(el('li', { html: '<b>Android:</b> Settings → Security → Encryption & credentials → Install a certificate → CA certificate' }));
  body.appendChild(ol);

  // เติมสถานะ CA จริงจาก server (มีไฟล์ไหม + fingerprint + วันหมดอายุ)
  fetch('/api/devices/ca/status').then((r) => r.json()).then((s) => {
    statusLine.classList.remove('checking');
    if (!s.exists) {
      statusLine.classList.add('warn');
      statusLine.textContent = '⚠️ ยังไม่มีไฟล์ CA — จะถูกสร้างอัตโนมัติเมื่อกดดาวน์โหลดครั้งแรก';
      return;
    }
    statusLine.classList.add(s.expired ? 'warn' : 'ok');
    statusLine.innerHTML = '';
    statusLine.appendChild(el('div', { class: 'st-ca-status-head',
      text: s.expired ? '⛔ CA หมดอายุแล้ว' : '✅ มีไฟล์ CA พร้อมใช้งาน' }));
    const meta = [];
    if (s.sha256) meta.push('SHA-256: ' + s.sha256);
    if (s.validTo) meta.push('หมดอายุ: ' + new Date(s.validTo).toLocaleString());
    if (typeof s.size === 'number') meta.push('ขนาด: ' + s.size + ' bytes');
    if (meta.length) statusLine.appendChild(el('div', { class: 'st-ca-meta', text: meta.join('  ·  ') }));
  }).catch(() => {
    statusLine.classList.remove('checking');
    statusLine.classList.add('warn');
    statusLine.textContent = '⚠️ เช็คสถานะ CA ไม่ได้';
  });

  const acts = [];
  const dlBtn = el('a', { class: 'st-action', href: dlPath, download: 'mitmproxy-ca.crt', text: '📥 ดาวน์โหลด CA' });
  acts.push(dlBtn);
  if (lanUrl) {
    const qrIcon = el('span', { class: 'qr-icon', title: 'ชี้เพื่อดู QR ให้มือถือสแกนโหลด CA', text: '🔳 QR โหลด CA' });
    attachQrHover(qrIcon, lanUrl, 200);
    acts.push(qrIcon);
  }
  card.appendChild(el('div', { class: 'st-actions' }, acts));
  return card;
}

// คู่มือเชื่อม Android (USB / Wi-Fi) — ปุ่มเชื่อมจริงอยู่ที่การ์ด device ด้านบน
function renderAndroidCard(lanIp, mitmUp) {
  const host = lanIp ? `${lanIp}:8888` : '(หา LAN IP ไม่เจอ — เช็คว่า Mac ต่อ Wi-Fi)';
  const card = el('div', { class: 'st-card ' + (mitmUp ? 'ok' : 'bad') }, [
    el('div', { class: 'st-head' }, [
      el('span', { class: 'st-title', text: '🤖 Android (วิธีเชื่อมต่อ)' }),
      el('span', { class: 'st-badge ' + (mitmUp ? 'up' : 'down'),
        text: mitmUp ? '✅ พร้อมให้เชื่อม' : '❌ เปิด mitmproxy ก่อน' }),
    ]),
    el('div', { class: 'st-body' }, [
      el('div', { class: 'st-line', html: '🔌 <b>USB</b> (เสถียร/เร็วสุด): เสียบสาย + เปิด USB debugging → กดปุ่ม “🔌 เชื่อม USB” ที่การ์ด device ด้านบน (จัดการ proxy + adb reverse อัตโนมัติ)' }),
      el('div', { class: 'st-line', html: `📶 <b>Wi-Fi</b> <span class="st-star">*</span>: มือถืออยู่วง Wi-Fi เดียวกับ Mac แล้วกดปุ่ม “📶 เชื่อม Wi-Fi” (Host = <code>${host}</code>)` }),
    ]),
  ]);
  const body = card.querySelector('.st-body');
  body.appendChild(el('div', { class: 'st-line', text: 'ติดตั้ง CA:' }));
  const ol = el('ol', { class: 'st-steps' });
  ol.appendChild(el('li', { html: 'โหลด CA จากการ์ด “📜 CA Certificate” ด้านล่าง หรือสแกน QR' }));
  ol.appendChild(el('li', { html: 'Settings → Security → Encryption &amp; credentials → Install a certificate → CA certificate' }));
  body.appendChild(ol);
  body.appendChild(el('div', { class: 'st-note',
    text: '* Wi-Fi: มือถือต้องอยู่วง LAN เดียวกับ Mac ไม่งั้น traffic ไปไม่ถึง (บางที่ Wi-Fi บล็อกพอร์ต — ถ้าไม่ชัวร์ใช้ USB)' }));
  return card;
}

// iPhone/iPad เชื่อมผ่าน adb ไม่ได้ — ต้องตั้ง Wi-Fi proxy ด้วยมือบนเครื่อง
// การ์ดนี้เป็นคู่มือ: โชว์ IP:port ที่ต้องกรอก + ปุ่ม copy + checklist 5 ขั้น
function renderIosCard(lanIp, mitmUp) {
  const host = lanIp || '(หา LAN IP ไม่เจอ — เช็คว่า Mac ต่อ Wi-Fi อยู่)';
  const proxyStr = lanIp ? `${lanIp}:8888` : '';
  const steps = [
    'iPhone ต่อ Wi-Fi วงเดียวกับ Mac *',
    `Settings → Wi-Fi → กด (i) → Configure Proxy → Manual → Server = ${host} · Port = 8888`,
    'เปิด Safari เข้า http://mitm.it → โหลด certificate ของ iOS (ชี้ QR ด้านบนแล้วสแกนด้วยกล้อง iPhone เพื่อเปิดหน้านี้ได้เลย)',
    'Settings → General → VPN & Device Management → ติดตั้ง profile ที่โหลด',
    'Settings → General → About → Certificate Trust Settings → เปิดสวิตช์ให้ mitmproxy (ขั้นนี้ห้ามลืม ไม่งั้น HTTPS พัง)',
  ];
  // icon QR ของ mitm.it — เอาเมาส์ชี้แล้วโชว์ QR 200x200 ตรงเมาส์ (สแกนด้วยกล้อง iPhone)
  const qrIcon = el('span', { class: 'qr-icon', title: 'ชี้เพื่อดู QR สแกนเปิด http://mitm.it' , text: '🔳 QR mitm.it' });
  attachQrHover(qrIcon, 'http://mitm.it', 200);
  const card = el('div', { class: 'st-card ' + (mitmUp ? 'ok' : 'bad') }, [
    el('div', { class: 'st-head' }, [
      el('span', { class: 'st-title', text: '🍎 iOS (วิธีเชื่อมต่อ)' }),
      el('span', { class: 'st-badge ' + (mitmUp ? 'up' : 'down'),
        text: mitmUp ? '✅ พร้อมให้เชื่อม' : '❌ เปิด mitmproxy ก่อน' }),
    ]),
    el('div', { class: 'st-body' }, [
      el('div', { class: 'st-line', text: 'เชื่อมด้วยมือผ่าน Wi-Fi (adb/USB ใช้กับ iOS ไม่ได้)' }),
    ]),
  ]);
  // แถว proxy + ปุ่ม copy
  if (lanIp) {
    const copyBtn = el('button', { class: 'st-action', text: '📋 copy proxy' });
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(proxyStr).then(() => {
        const old = copyBtn.textContent; copyBtn.textContent = '✓ คัดลอกแล้ว';
        setTimeout(() => { copyBtn.textContent = old; }, 1500);
      });
    });
    card.querySelector('.st-body').appendChild(
      el('div', { class: 'st-line', html: `Proxy ที่ต้องกรอกบน iPhone: <code>${proxyStr}</code>` }));
    card.appendChild(el('div', { class: 'st-actions' }, [copyBtn]));
  }
  // หมายเหตุ: iOS Simulator ที่บูตอยู่จะโผล่เป็น "device card" ด้านบน (มีปุ่ม Connect/Disconnect/ติดตั้ง CA ในตัว)
  card.querySelector('.st-body').appendChild(
    el('div', { class: 'st-line', html: '🤖 <b>iOS Simulator</b> (บน Mac นี้): จะโผล่เป็นการ์ด device ด้านบนพร้อมปุ่ม Connect/Disconnect — บันทึกได้เลยแบบไม่ต้องรหัส' }));
  // QR mitm.it + ลิงก์ (ใช้กับเครื่องจริง)
  const mitmLink = el('a', { class: 'st-action ghost', href: 'http://mitm.it', target: '_blank', rel: 'noopener', text: '🔗 http://mitm.it' });
  card.appendChild(el('div', { class: 'st-actions' }, [qrIcon, mitmLink]));

  // checklist (เครื่องจริง — ต้องทำเอง)
  card.querySelector('.st-body').appendChild(
    el('div', { class: 'st-line', text: '📱 เครื่องจริง (iPhone/iPad) — ทำตามขั้นตอนนี้:' }));
  const ol = el('ol', { class: 'st-steps' });
  for (const s of steps) ol.appendChild(el('li', { text: s }));
  card.querySelector('.st-body').appendChild(ol);
  card.querySelector('.st-body').appendChild(
    el('div', { class: 'st-line', text: '⚠️ แอปที่ทำ certificate pinning (เช่นแอปธนาคาร) จะไม่วิ่งผ่าน proxy แม้ติดตั้ง cert ถูก — เป็นข้อจำกัดของแอปเป้าหมายเอง' }));
  card.querySelector('.st-body').appendChild(
    el('div', { class: 'st-note', text: '* Wi-Fi: iPhone ต้องอยู่วง LAN เดียวกับ Mac ไม่งั้น traffic ไปไม่ถึง' }));
  return card;
}

// ติดตั้ง CA ลง iOS Simulator (auto-trust) — ระบุ udid = เฉพาะตัวนั้น (ปุ่มใต้ device card), ไม่ระบุ = ทุกตัว
async function stSimInstallCa(udid) {
  const opt = { method: 'POST' };
  if (udid) { opt.headers = { 'Content-Type': 'application/json' }; opt.body = JSON.stringify({ udid }); }
  const r = await (await fetch('/api/devices/ios-sim/install-ca', opt)).json();
  if (!r.ok) throw new Error(r.error || 'ติดตั้งไม่สำเร็จ');
  const warn = (r.failed && r.failed.length) ? `\n\n⚠️ ล้มเหลวบางตัว: ${r.failed.join(', ')}` : '';
  alert(`✅ ติดตั้ง CA (auto-trust) ลง Simulator แล้ว: ${r.installed.join(', ')}${warn}\n\nเปิด Safari/แอปใน Simulator ได้เลย — HTTPS จะถูกถอดรหัสทันที`);
}

async function stSimConnect() {
  const r = await (await fetch('/api/devices/ios-sim/connect', { method: 'POST' })).json();
  if (!r.ok) throw new Error(r.error || 'connect ไม่สำเร็จ');
}
async function stSimDisconnect() {
  const r = await (await fetch('/api/devices/ios-sim/disconnect', { method: 'POST' })).json();
  if (!r.ok) throw new Error(r.error || 'disconnect ไม่สำเร็จ');
}

async function renderStatus() {
  let d;
  try { d = await (await fetch('/api/status')).json(); }
  catch (e) {
    statusCards.innerHTML = '';
    statusCards.appendChild(el('p', { class: 'empty-msg', text: 'เช็คสถานะไม่ได้: ' + e.message }));
    return;
  }
  const { services: sv, devices, iosSims = [], iosProxy = {}, muted, mutedDropped = 0, flows, lanIp } = d;
  statusCards.innerHTML = '';

  // --- ความพร้อมรวมของ pipeline บันทึก traffic ---
  const connectedDev = devices.find((x) => x.connected || x.posternRunning);
  const usbNoReverse = devices.find((x) => x.connected && x.mode === 'usb' && x.reverse === false);
  const blockers = [];
  if (!sv.mitmproxy.up) blockers.push('mitmproxy ยังไม่เปิด (ตัวบันทึก traffic)');
  if (!devices.length) blockers.push('ไม่พบ device — เสียบสาย USB + เปิด USB debugging');
  else if (!connectedDev) blockers.push('มือถือยังไม่ได้เชื่อม proxy — กดปุ่มเชื่อมที่การ์ด Device');
  if (usbNoReverse) blockers.push('adb reverse หายไป (สายหลุด/เสียบใหม่) — กดเชื่อม USB ใหม่');
  if (muted) blockers.push('การบันทึกถูก mute อยู่ (หลังกด disconnect)' + (mutedDropped ? ` — ทิ้งไป ${mutedDropped} flows` : '') + ' · กดปลด mute ที่การ์ด "การบันทึก traffic"');
  statusBanner.className = 'status-banner ' + (blockers.length ? 'bad' : 'ok');
  statusBanner.innerHTML = blockers.length
    ? '<b>⚠️ ยังบันทึก traffic ไม่ได้:</b><br/>• ' + blockers.join('<br/>• ')
    : '✅ <b>พร้อมบันทึก traffic จากมือถือ</b> — เปิดแอป/เว็บบนมือถือได้เลย';

  // --- API Debugger server ---
  statusCards.appendChild(stCard('🧪', 'API Debugger server', true,
    [`พอร์ต ${sv.apitester.port} — หน้าเว็บ + API + เก็บ flow (ตอบอยู่ตอนนี้)`]));

  // --- mitmproxy ---
  statusCards.appendChild(stCard('🌐', `mitmproxy (พอร์ต ${sv.mitmproxy.port})`, sv.mitmproxy.up,
    sv.mitmproxy.up
      ? ['ดัก/ถอดรหัส HTTPS จากมือถือแล้วส่ง flow เข้ามาบันทึก']
      : ['ดับอยู่ — เชื่อม USB/Wi-Fi ไปก็ไม่บันทึก เพราะไม่มีตัวรับบนพอร์ตนี้'],
    sv.mitmproxy.up
      ? [stBtn('⏹️ ปิด mitmproxy', () => stStopService('mitm'), 'stop')]
      : [stBtn('▶️ เปิด mitmproxy', () => stStartService('mitm'))]));

  // --- MCP ---
  statusCards.appendChild(stCard('🤖', `MCP server (พอร์ต ${sv.mcp.port})`, sv.mcp.up,
    sv.mcp.up
      ? [`ให้ AI agent ควบคุม ApiTester — ${sv.mcp.url}`]
      : ['ดับอยู่ — ไม่กระทบการบันทึก traffic แต่ AI agent จะต่อไม่ได้'],
    sv.mcp.up
      ? [stBtn('⏹️ ปิด MCP', () => stStopService('mcp'), 'stop')]
      : [stBtn('▶️ เปิด MCP', () => stStartService('mcp'))]));

  // --- Devices ---
  if (!devices.length) {
    statusCards.appendChild(stCard('📱', 'Device', false,
      ['ไม่พบ device — เสียบสาย USB + เปิด USB debugging แล้วกดรีเฟรช']));
  }
  for (const dev of devices) {
    const okDev = !!(dev.connected || dev.posternRunning) && !(dev.mode === 'usb' && dev.reverse === false);
    const details = [];
    if (dev.connected) {
      details.push(`เชื่อมแล้วโหมด ${dev.mode.toUpperCase()} → proxy ${dev.proxy}`);
      if (dev.mode === 'usb') details.push(dev.reverse ? 'adb reverse tcp:8888 ✓' : '⚠️ adb reverse หายไป — traffic ไปไม่ถึง Mac');
    } else if (dev.posternRunning) {
      details.push('เชื่อมผ่านแอป Proxy Postern (VPN) อยู่');
    } else {
      details.push('ยังไม่ได้เชื่อม proxy' + (lanIp ? ` (Wi-Fi ใช้ Host ${lanIp}:8888)` : ''));
    }
    const acts = [];
    if (!okDev) {
      acts.push(stBtn('🔌 เชื่อม USB', () => stConnectDevice(dev.serial, 'usb')));
      acts.push(stBtn('📶 เชื่อม Wi-Fi', () => stConnectDevice(dev.serial, 'wifi')));
    } else {
      acts.push(stBtn('⛔ ตัดการเชื่อมต่อ', () => stDisconnectDevice(dev.serial), 'stop'));
    }
    // Emulator: ติดตั้ง CA เข้า system store อัตโนมัติ (auto-trust HTTPS ทั้งเครื่อง)
    if (dev.emulator) {
      acts.push(stBtn('🔐 ติดตั้ง CA (Auto)', () => stInstallCaEmulator(dev.serial)));
    }
    // แสดงสถานะการเชื่อมจริง (โหมด proxy) ไม่ใช่ transport ของ adb
    const connLabel = dev.connected
      ? (dev.mode === 'wifi' ? '📶 WIFI' : '🔌 USB')
      : dev.posternRunning ? '📲 POSTERN' : '⚪ ยังไม่เชื่อม';
    statusCards.appendChild(stCard('📱', `${dev.model} (${connLabel})`, okDev, details, acts));
  }

  // --- iOS Simulator: โผล่เป็น device การ์ดเหมือน Android (connect/disconnect อยู่ใต้ device นั้น) ---
  // proxy เป็น macOS-wide (แชร์ทุก sim) → ทุกการ์ด sim สะท้อนสถานะเดียวกัน
  for (const sim of iosSims) {
    const active = !!iosProxy.active;
    const details = [];
    if (active) {
      details.push('เชื่อมแล้ว → traffic ของ Simulator กำลังบันทึก');
      details.push(`macOS proxy: ${iosProxy.service || '?'} → 127.0.0.1:8888 (แชร์ทุก sim บนเครื่องนี้)`);
    } else {
      details.push('ยังไม่ได้เชื่อม — กด Connect (ตั้ง macOS proxy อัตโนมัติ ไม่ต้องรหัส)');
    }
    if (!iosProxy.macCaTrusted && active) details.push('ⓘ แอป Mac อื่นอาจขึ้น cert error ชั่วคราวระหว่างต่อ (หายเมื่อ Disconnect)');
    const acts = [];
    if (!active) {
      const cb = stBtn('▶︎ Connect', stSimConnect);
      if (!sv.mitmproxy.up) cb.disabled = true; // ต้องเปิด mitmproxy ก่อน
      acts.push(cb);
    } else {
      acts.push(stBtn('⛔ ตัดการเชื่อมต่อ', stSimDisconnect, 'stop'));
    }
    acts.push(stBtn('🔐 ติดตั้ง CA (Simulator)', () => stSimInstallCa(sim.udid)));
    const connLabel = active ? '🟢 SIM ต่ออยู่' : '⚪ SIM ยังไม่เชื่อม';
    statusCards.appendChild(stCard('🍎', `${sim.name} (${connLabel})`, active, details, acts));
  }

  // --- วิธีเชื่อมต่อ: แยกการ์ด Android / iOS ---
  statusCards.appendChild(renderAndroidCard(lanIp, sv.mitmproxy.up));
  statusCards.appendChild(renderIosCard(lanIp, sv.mitmproxy.up));

  // --- CA Certificate (Manual — โหลดเอง ไม่พึ่ง USB) ---
  statusCards.appendChild(renderCaCard(lanIp, sv.mitmproxy.up));

  // --- การบันทึก ---
  const recDetails = [
    muted
      ? '🔇 ถูก mute อยู่ — flow ที่เข้ามาจะถูกทิ้ง (เกิดหลังกด disconnect)'
        + (mutedDropped ? ` · ทิ้งไปแล้ว ${mutedDropped} flows (มีเครื่องยังยิง proxy อยู่ → กดปลด mute เพื่อรับ)` : '')
      : '🔊 รับ flow ปกติ',
    `บันทึกไว้ ${flows.count} flows` + (flows.lastAt ? ` · ล่าสุด ${new Date(flows.lastAt).toLocaleTimeString()}` : ''),
  ];
  const recActs = muted
    ? [stBtn('🔊 ปลด mute (รับ flow)', stUnmute)]
    : [];
  statusCards.appendChild(stCard('⏺️', 'การบันทึก traffic', !muted, recDetails, recActs));

  // --- คีย์ลัด (ให้คนอื่นเห็น) ---
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl';
  statusCards.appendChild(stCard('⌨️', 'คีย์ลัด (Keyboard shortcuts)', true, [
    `Proxy: ${mod} + ⌫  — เคลียร์ traffic ทั้งหมด`,
    `Proxy: ${mod} + Enter  — repeat (ยิงซ้ำ) flow ที่เลือกไว้`,
    `Map Local / Test Case: ${mod} + S  — บันทึก`,
    `Map Local / Test Case: ${mod} + D  — ทำสำเนา (duplicate) รายการที่เลือก`,
    `Sender: ลาก cURL วางในโหมด cURL แล้วกด "ส่ง" — ยิงผ่าน proxy ได้`,
  ]));
}

document.getElementById('status-refresh').addEventListener('click', renderStatus);
document.querySelector('.tab-btn[data-tab="status"]').addEventListener('click', renderStatus);
setInterval(() => {
  if (document.getElementById('tab-status').classList.contains('active')) renderStatus();
}, 5000);
renderStatus();

// ================= Settings tab =================
function setupSettings() {
  const range = document.getElementById('tc-opacity-range');
  const valLbl = document.getElementById('tc-opacity-value');
  const demo = document.getElementById('tc-opacity-demo');
  if (!range) return;
  const apply = (v) => {
    tcPopupOpacity = v;
    valLbl.textContent = Math.round(v * 100) + '%';
    if (demo) demo.style.opacity = v;
    if (typeof renderTcProxyPopup === 'function') renderTcProxyPopup(); // อัปเดตกล่องจริงทันทีถ้าเปิดอยู่
  };
  range.value = tcPopupOpacity;
  apply(tcPopupOpacity); // ตั้งค่าเริ่มจาก localStorage
  range.addEventListener('input', () => apply(parseFloat(range.value)));
  range.addEventListener('change', () => { // บันทึกลงเครื่องเมื่อปล่อยเมาส์
    try { localStorage.setItem(TC_OPACITY_KEY, String(tcPopupOpacity)); } catch { /* ignore */ }
  });
}
setupSettings();
