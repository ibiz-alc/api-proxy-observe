# JSON Viewer Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มแท็บ 📑 JSON Viewer ในเว็บ ApiTester — วาง/เปิดไฟล์ JSON ฝั่งซ้าย เห็น tree พับได้ฝั่งขวา พร้อมค้นหา, Format/Minify, ชี้ตำแหน่ง error, copy path/JSON ต่อ node

**Architecture:** งาน web UI ล้วน 3 ไฟล์ (`public/index.html`, `public/app.js`, `public/style.css`) — reuse `makeJsonEditor()` เป็น input pane และ `jsonTree()` เป็น output pane, เพิ่มชั้นค้นหา/error ทับของเดิมโดยไม่แก้พฤติกรรมหน้าอื่น (จุดแตะของเดิมจุดเดียว: generalize ตัวหา pathbar ใน `jsonTree()`)

**Tech Stack:** Vanilla JS (pattern เดิมของ repo), puppeteer-core สำหรับ dev-test

**Spec:** `docs/superpowers/specs/2026-08-17-json-viewer-design.md`

**สภาพแวดล้อม:** ทำใน worktree `.claude/worktrees/json-viewer` (branch `feature/json-viewer`) + dev server `PORT=3100 PROXY_PORT=9199` เพื่อไม่กระทบ :3000 ที่เจ้านายใช้อยู่ · node/npm นำหน้า `env -u NODE_OPTIONS` เสมอ · ห้าม Co-Authored-By ใน commit

---

### Task 0: Worktree + dev server

**Files:** ไม่มีการแก้ไฟล์

- [ ] **Step 1: สร้าง worktree + branch**

```bash
cd /Users/verasitwisitsophon/Documents/Project/ApiTester
git worktree add .claude/worktrees/json-viewer -b feature/json-viewer
ln -s /Users/verasitwisitsophon/Documents/Project/ApiTester/node_modules .claude/worktrees/json-viewer/node_modules
```

- [ ] **Step 2: สตาร์ท dev server จาก worktree**

```bash
cd .claude/worktrees/json-viewer
env -u NODE_OPTIONS PORT=3100 PROXY_PORT=9199 node server.js   # background
curl -s localhost:3100/api/status | head -c 100                # ต้องได้ {"ok":true,...
```

หมายเหตุ: server เสิร์ฟ static จาก `public/` ของ worktree — แก้ไฟล์แล้ว reload เห็นเลย

### Task 1: HTML — ปุ่ม nav + โครงแท็บ

**Files:**
- Modify: `public/index.html` (nav ~บรรทัด 16, เพิ่ม `<main>` หลังบล็อก `tab-url` ~บรรทัด 126)

- [ ] **Step 1: เพิ่มปุ่ม nav หลัง URL Metadata**

```html
      <button class="tab-btn" data-tab="url">🔗 URL Metadata</button>
      <button class="tab-btn" data-tab="jsonviewer">📑 JSON</button>
```

- [ ] **Step 2: เพิ่ม main section หลังปิดบล็อก `tab-url`**

```html
  <!-- ============ JSON Viewer ============ -->
  <main id="tab-jsonviewer" class="tab">
    <div class="jv-toolbar">
      <button id="jv-open-btn" type="button">📂 เปิดไฟล์</button>
      <input type="file" id="jv-file" accept=".json,.txt,application/json" style="display:none" />
      <button id="jv-format-btn" type="button">Format</button>
      <button id="jv-minify-btn" type="button">Minify</button>
      <button id="jv-clear-btn" type="button">✕ Clear</button>
      <span id="jv-stat" class="hint"></span>
    </div>
    <div class="jv-layout">
      <section class="jv-pane">
        <div id="jv-error" class="jv-error" style="display:none"></div>
        <div id="jv-editor-host" class="jv-editor-host"></div>
      </section>
      <section class="jv-pane jt-pane-host">
        <div class="jv-searchbar">
          <input type="text" id="jv-search" placeholder="🔍 ค้นหา key/value" />
          <span id="jv-search-count" class="hint"></span>
          <button id="jv-prev-btn" type="button" title="ก่อนหน้า">▲</button>
          <button id="jv-next-btn" type="button" title="ถัดไป">▼</button>
        </div>
        <div class="jt-pathbar"></div>
        <div id="jv-tree" class="code-block json jt-scroll"><p class="empty-msg">วาง JSON ฝั่งซ้าย หรือกด 📂 เปิดไฟล์</p></div>
      </section>
    </div>
  </main>
```

- [ ] **Step 3: เปิด `http://localhost:3100` เช็คแท็บโผล่และคลิกได้** (ยังว่างเปล่า — ยังไม่มี JS/CSS)

### Task 2: CSS

**Files:**
- Modify: `public/style.css` (ต่อท้ายไฟล์)

- [ ] **Step 1: เพิ่มบล็อก CSS**

```css
/* ===== แท็บ JSON Viewer — ซ้ายวาง (je-wrap เดิม) ขวา tree (jt เดิม) ===== */
.jv-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
.jv-toolbar button { padding: 6px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); color: var(--text); cursor: pointer; font-size: 0.82rem; }
.jv-toolbar button:hover:not(:disabled) { border-color: var(--accent); }
.jv-toolbar button:disabled { opacity: 0.45; cursor: default; }
.jv-layout { display: flex; gap: 10px; height: calc(100vh - 150px); min-height: 320px; }
.jv-pane { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.jv-editor-host { flex: 1; min-height: 0; display: flex; }
.jv-error { background: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; padding: 6px 10px; font-size: 0.8rem; white-space: pre-wrap; flex-shrink: 0; }
.jv-searchbar { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }
.jv-searchbar input { flex: 1; min-width: 0; }
.jv-searchbar button { padding: 4px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel); color: var(--text); cursor: pointer; }
.jv-searchbar button:hover { border-color: var(--accent); }
#jv-tree { flex: 1; min-height: 0; overflow: auto; margin: 0; }
#jv-tree.jv-stale { opacity: 0.45; } /* JSON พัง — โชว์ tree เก่าแบบจาง */
.jt-hit { background: rgba(250, 204, 21, 0.16); border-radius: 4px; }
.jt-hit-cur { background: rgba(250, 204, 21, 0.36); outline: 1px solid #facc15; }
```

หมายเหตุ: `.jt-pane-host .jt-pathbar` ใช้สไตล์ `.jt-pathbar` เดิมที่มีอยู่แล้ว

### Task 3: generalize pathbar ของ jsonTree

**Files:**
- Modify: `public/app.js:198` (ฟังก์ชัน `jsonTree`)

- [ ] **Step 1: แก้ตัวหา pathbar ให้รองรับ host ใหม่**

```js
// เดิม
const bar = () => root.closest('.detail-pane') && root.closest('.detail-pane').querySelector('.jt-pathbar');
// ใหม่ — เพิ่ม .jt-pane-host (แท็บ JSON Viewer) โดย .detail-pane เดิมยังทำงานเหมือนเดิม
const bar = () => { const h = root.closest('.jt-pane-host, .detail-pane'); return h && h.querySelector('.jt-pathbar'); };
```

- [ ] **Step 2: เช็คหน้า Proxy เดิม hover แล้ว pathbar ยังขึ้น** (จะถูกคุมซ้ำใน dev-test Task 6)

### Task 4: JS — setupJsonViewer (parse/render/error/format/minify/file/localStorage)

**Files:**
- Modify: `public/app.js` (ต่อท้ายไฟล์ หลัง `setupSettings()`)

- [ ] **Step 1: เพิ่มโค้ดส่วน JSON Viewer**

```js
// ================= JSON Viewer tab =================
// วาง/เปิดไฟล์ JSON ฝั่งซ้าย (makeJsonEditor) → parse (debounce) → tree ฝั่งขวา (jsonTree)
// + ค้นหาใน tree, Format/Minify, แถบ error ชี้บรรทัด, จำข้อความล่าสุดใน localStorage
const JV_TEXT_KEY = 'jsonViewerText';
const JV_MAX_PARSE = 5 * 1024 * 1024;  // เกินนี้ไม่ parse — tree เป็น DOM เต็ม จะค้าง
const JV_MAX_SAVE = 500 * 1024;        // เกินนี้ไม่เขียน localStorage (กัน quota)
function jvErrorPos(msg, text) { // หา line/col จาก error message ของ browser → {line, col, pos} หรือ null
  let m = msg.match(/line (\d+) column (\d+)/i);
  if (m) return { line: +m[1], col: +m[2], pos: null };
  m = msg.match(/position (\d+)/i);
  if (!m) return null;
  const pos = Math.min(+m[1], text.length);
  const before = text.slice(0, pos);
  const line = (before.match(/\n/g) || []).length + 1;
  return { line, col: pos - before.lastIndexOf('\n'), pos };
}
function setupJsonViewer() {
  const host = document.getElementById('jv-editor-host');
  if (!host) return;
  const ed = makeJsonEditor(localStorage.getItem(JV_TEXT_KEY) || '');
  host.appendChild(ed.wrap);
  const ta = ed.textarea;
  const treeBox = document.getElementById('jv-tree');
  const errBar = document.getElementById('jv-error');
  const statLbl = document.getElementById('jv-stat');
  const fmtBtn = document.getElementById('jv-format-btn');
  const minBtn = document.getElementById('jv-minify-btn');
  let parsed = null; let parseOk = false;

  const showError = (text) => { errBar.textContent = text; errBar.style.display = ''; treeBox.classList.add('jv-stale'); };
  const clearError = () => { errBar.style.display = 'none'; treeBox.classList.remove('jv-stale'); };
  const setText = (v) => { ta.value = v; ed.refresh(); parseNow(); };

  function parseNow() {
    const text = ta.value;
    try { if (text.length <= JV_MAX_SAVE) localStorage.setItem(JV_TEXT_KEY, text); } catch { /* quota เต็ม — ข้าม */ }
    jvClearSearch();
    if (!text.trim()) {
      parsed = null; parseOk = false; clearError();
      treeBox.replaceChildren(el('p', { class: 'empty-msg', text: 'วาง JSON ฝั่งซ้าย หรือกด 📂 เปิดไฟล์' }));
      statLbl.textContent = ''; fmtBtn.disabled = minBtn.disabled = true;
      return;
    }
    if (text.length > JV_MAX_PARSE) {
      parseOk = false; fmtBtn.disabled = minBtn.disabled = true;
      showError(`ข้อความใหญ่เกิน ${Math.round(JV_MAX_PARSE / 1024 / 1024)}MB — ไม่ render (จะค้าง)`);
      return;
    }
    try {
      parsed = JSON.parse(text); parseOk = true; clearError();
      fmtBtn.disabled = minBtn.disabled = false;
      treeBox.replaceChildren(jsonTree(parsed));
      const n = treeBox.querySelectorAll('.jt-line').length;
      statLbl.textContent = `${(text.length / 1024).toFixed(1)} KB · ${n} บรรทัด`;
      jvRunSearch(); // ถ้ามีคำค้นค้างอยู่ ให้ค้นใหม่บน tree ใหม่
    } catch (e) {
      parseOk = false; fmtBtn.disabled = minBtn.disabled = true;
      const p = jvErrorPos(String(e.message || e), text);
      showError(p ? `บรรทัด ${p.line} คอลัมน์ ${p.col}: ${e.message}` : String(e.message || e));
      if (p && p.pos != null) { // เลื่อน editor ไปแถวที่พัง (ประมาณจาก line-height)
        const lh = parseFloat(getComputedStyle(ta).lineHeight) || 19;
        ta.scrollTop = Math.max(0, (p.line - 3) * lh);
        ed.wrap.querySelector('.je-highlight').scrollTop = ta.scrollTop;
      }
    }
  }
  let jvTimer = null;
  ta.addEventListener('input', () => { clearTimeout(jvTimer); jvTimer = setTimeout(parseNow, 300); });

  // toolbar
  document.getElementById('jv-format-btn').addEventListener('click', () => { if (parseOk) setText(JSON.stringify(parsed, null, 2)); });
  document.getElementById('jv-minify-btn').addEventListener('click', () => { if (parseOk) setText(JSON.stringify(parsed)); });
  document.getElementById('jv-clear-btn').addEventListener('click', () => setText(''));
  const fileInput = document.getElementById('jv-file');
  document.getElementById('jv-open-btn').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > JV_MAX_PARSE) { showError(`ไฟล์ใหญ่เกิน ${Math.round(JV_MAX_PARSE / 1024 / 1024)}MB`); fileInput.value = ''; return; }
    const r = new FileReader();
    r.onload = () => { setText(String(r.result)); fileInput.value = ''; };
    r.readAsText(f);
  });

  // ===== ค้นหาใน tree: match ทั้ง key/value บนบรรทัด (.jt-line มีเฉพาะข้อความบรรทัดตัวเอง ลูกอยู่ใน .jt-children แยก) =====
  const searchInput = document.getElementById('jv-search');
  const countLbl = document.getElementById('jv-search-count');
  let hits = []; let hitIdx = -1;
  function jvClearSearch() {
    hits.forEach((l) => l.classList.remove('jt-hit', 'jt-hit-cur'));
    hits = []; hitIdx = -1; countLbl.textContent = '';
  }
  function jvExpandTo(line) { // กางบล็อกบรรพบุรุษที่พับอยู่ (คลิก head — state พับเก็บใน closure ของ jtNode)
    for (let elx = line.parentElement; elx && elx !== treeBox; elx = elx.parentElement) {
      if (elx.classList.contains('jt-children') && elx.style.display === 'none') {
        const head = elx.parentElement.querySelector(':scope > .jt-head');
        if (head) head.click();
      }
    }
  }
  function jvGoto(i) {
    if (!hits.length) return;
    if (hitIdx >= 0 && hits[hitIdx]) hits[hitIdx].classList.remove('jt-hit-cur');
    hitIdx = ((i % hits.length) + hits.length) % hits.length;
    const line = hits[hitIdx];
    line.classList.add('jt-hit-cur');
    jvExpandTo(line);
    line.scrollIntoView({ block: 'center' });
    countLbl.textContent = `${hitIdx + 1}/${hits.length}`;
  }
  function jvRunSearch() {
    const q = searchInput.value.trim().toLowerCase();
    hits.forEach((l) => l.classList.remove('jt-hit', 'jt-hit-cur'));
    hits = []; hitIdx = -1;
    if (!q) { countLbl.textContent = ''; return; }
    treeBox.querySelectorAll('.jt-line').forEach((l) => {
      if (l.textContent.toLowerCase().includes(q)) { l.classList.add('jt-hit'); hits.push(l); }
    });
    countLbl.textContent = hits.length ? `0/${hits.length}` : 'ไม่พบ';
    if (hits.length) jvGoto(0);
  }
  let jvSearchTimer = null;
  searchInput.addEventListener('input', () => { clearTimeout(jvSearchTimer); jvSearchTimer = setTimeout(jvRunSearch, 200); });
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); jvGoto(hitIdx + 1); } });
  document.getElementById('jv-next-btn').addEventListener('click', () => jvGoto(hitIdx + 1));
  document.getElementById('jv-prev-btn').addEventListener('click', () => jvGoto(hitIdx - 1));

  parseNow(); // render ค่าที่จำไว้จาก localStorage ตอนเปิดหน้า
}
setupJsonViewer();
```

- [ ] **Step 2: reload :3100 → วาง JSON เล็กๆ เช็คด้วยตา** (tree ขึ้น, Format/Minify ทำงาน, พิมพ์ให้พังแล้วแถบแดงขึ้น)

### Task 5: Commit งาน UI

- [ ] **Step 1: commit ใน worktree**

```bash
git add public/index.html public/style.css public/app.js
git commit -m "feat(json-viewer): แท็บ 📑 JSON — วาง/เปิดไฟล์ ดู tree พับได้ + ค้นหา + Format/Minify + ชี้บรรทัด error"
```

### Task 6: Dev-test puppeteer

**Files:**
- Create: `scripts/dev-tests/json-viewer-test.js`

- [ ] **Step 1: เขียนเทสต์ครอบ 7 เช็คตาม spec** (แท็บเปิด, tree render, ค้นหา+กระโดด+กางบล็อก, Format/Minify, error ชี้บรรทัด, เปิดไฟล์, localStorage รอด reload, pathbar หน้า Proxy เดิมไม่พัง) — โครงตาม `tc-popup-rail-check.js` ล่าสุด: puppeteer-core + Chrome ระบบ, `PORT` จาก env, exit 1 เมื่อ FAIL, log ผลเป็น JSON ต่อเช็ค

- [ ] **Step 2: รันจากนอก repo (screenshot ลง cwd)**

```bash
cd <scratchpad> && env -u NODE_OPTIONS PORT=3100 node <worktree>/scripts/dev-tests/json-viewer-test.js
```

Expected: ทุกเช็ค PASS

- [ ] **Step 3: commit เทสต์**

```bash
git add scripts/dev-tests/json-viewer-test.js && git commit -m "test(json-viewer): dev-test puppeteer ครอบ render/ค้นหา/format/error/file/localStorage"
```

### Task 7: Code review + merge

- [ ] **Step 1: code review ด้วย Opus subagent บน diff `main..feature/json-viewer`** — ตรวจ finding เองก่อนแก้ (pattern repo)
- [ ] **Step 2: แก้ตาม finding ที่ยืนยันแล้ว + รันเทสต์ซ้ำ**
- [ ] **Step 3: merge เข้า main + ยืนยันบน :3000**

```bash
cd /Users/verasitwisitsophon/Documents/Project/ApiTester
git merge --no-ff feature/json-viewer -m "merge: แท็บ JSON Viewer"
# smoke บน production: เปิด :3000 → แท็บ JSON → วาง JSON → tree ขึ้น
```

- [ ] **Step 4: ปิด dev server + ลบ worktree**

```bash
git worktree remove .claude/worktrees/json-viewer
git branch -d feature/json-viewer
```
