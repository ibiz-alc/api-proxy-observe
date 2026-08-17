# Spec: แท็บ 📑 JSON Viewer

Date: 2026-08-17 · Status: approved (เจ้านายอนุมัติ design ในแชท)

## เป้าหมาย

เพิ่มเมนู/แท็บใหม่ "JSON Viewer" ในเว็บ ApiTester สำหรับเอา JSON จากที่อื่นมาดู
(วางเอง หรือเปิดไฟล์) แสดงเป็น tree พับ/ขยายได้ พร้อมค้นหา, Format/Minify,
ชี้ตำแหน่ง error เมื่อ JSON พัง และ copy path/JSON ต่อ node

ไม่แตะ server เลย — งานฝั่ง web UI ล้วน (`public/index.html`, `public/app.js`, `public/style.css`)

## UI

### ตำแหน่งเมนู

- ปุ่ม `📑 JSON` ใน nav bar ต่อจาก `🔗 URL Metadata` (กลุ่มเครื่องมือ utility)
- `<main id="tab-jsonviewer" class="tab">` ใหม่ใน `index.html`

### โครงหน้า: สองฝั่ง ซ้ายวาง-ขวา tree

```
┌───────────────────────────────────────────┐
│ [📂 เปิดไฟล์] [Format] [Minify] [✕ Clear]   │  ← toolbar
├─────────────────┬─────────────────────────┤
│ (แถบ error ถ้าพัง) │ 🔍 [ค้นหา____] 2/5 ▲▼    │
│ {"user": {      │                         │
│   "name": "a"   │ ▾ user { 2 keys         │
│ }}              │     "name": "a"         │
│ (editor ไฮไลต์สี) │   }          (tree)     │
└─────────────────┴─────────────────────────┘
```

- **ฝั่งซ้าย**: reuse `makeJsonEditor()` (textarea โปร่งใสทับ `<pre>` ไฮไลต์สี)
  พิมพ์/วางแล้ว debounce ~300ms → parse → render ฝั่งขวา
- **ฝั่งขวา**: แถบค้นหา + tree จาก `jsonTree()` + `.jt-pathbar`
  (copy JSON / copy path ต่อ node ได้ฟรีจากของเดิม: hover 📋 + คลิกขวา)
- ความกว้างสองฝั่งแบ่งครึ่งด้วย flex (ยังไม่ต้องลากปรับ — YAGNI)

## ฟีเจอร์

### 1. เปิดไฟล์

- `<input type="file" accept=".json,.txt,application/json">` ซ่อนไว้ ปุ่ม 📂 trigger
- อ่านด้วย FileReader ใส่ editor แล้ว parse ทันที (ไม่ต้องรอ debounce)

### 2. Format / Minify

- Format: `JSON.stringify(parsed, null, 2)` ใส่กลับ editor
- Minify: `JSON.stringify(parsed)` ใส่กลับ editor
- ถ้า JSON พัง ปุ่มสองตัวนี้ disabled

### 3. Error เมื่อ JSON พัง

- แถบแดงเหนือ editor: `บรรทัด X คอลัมน์ Y: <ข้อความจาก browser>`
- คำนวณบรรทัด/คอลัมน์จาก `at position N` (V8) หรือ `at line X column Y` ใน error message
  ถ้า parse ตำแหน่งไม่ได้ แสดงแค่ข้อความ error
- scroll editor ไปยังบรรทัดที่พัง
- ฝั่งขวาคง tree ล่าสุดที่ parse ผ่านไว้ (จางลงด้วย opacity) จนกว่าจะ parse ผ่านใหม่

### 4. ค้นหาใน tree

- จับคู่ substring แบบไม่สน case กับข้อความบนบรรทัด tree (`.jt-line` textContent
  เฉพาะบรรทัดตัวเอง ไม่รวมลูก) — ครอบคลุมทั้ง key และ value
- highlight ทุกบรรทัดที่ match (class `jt-hit`) + ตัวปัจจุบัน (class `jt-hit-cur`)
- ตัวนับ `2/5` + ปุ่ม ▲▼ (และ Enter = ตัวถัดไป) กระโดดทีละตัว:
  กางบล็อกบรรพบุรุษที่ถูกพับให้อัตโนมัติ (คลิก head ของ `.jt-node` ที่พับอยู่)
  แล้ว `scrollIntoView({ block: 'center' })`
- เคลียร์ช่องค้นหา = ล้าง highlight ทั้งหมด

### 5. Guards

- ข้อความ/ไฟล์เกิน 5MB: ไม่ parse, แจ้งเตือนว่าใหญ่เกิน (tree เป็น DOM เต็ม จะค้าง)
- เก็บข้อความล่าสุดลง `localStorage` key `jsonViewerText` เฉพาะขนาด ≤ 500KB
  โหลดคืนตอนเปิดหน้า (พฤติกรรมเดียวกับค่าอื่นๆ ที่จำใน localStorage อยู่แล้ว)

### 6. จุดแก้ของเดิม (เล็ก)

- `jsonTree()` หา pathbar ผ่าน `closest('.detail-pane')` เท่านั้น (app.js:198)
  → generalize เป็น `closest('.jt-pane-host, .detail-pane')` แล้วให้ pane ขวาของ
  JSON Viewer ใส่ class `jt-pane-host` — หน้า Inspector/Proxy เดิมไม่กระทบ

## สิ่งที่ไม่ทำ (YAGNI)

- ไม่มี JSONPath query / filter ตาม path
- ไม่มีลากปรับความกว้างสองฝั่ง
- ไม่มี diff สองก้อน
- ไม่มี virtual scrolling (guard 5MB พอ)

## Testing

- Dev-test puppeteer ตาม pattern repo (`scripts/dev-tests/`) รันกับ dev server แยก
  (`PORT=3100 PROXY_PORT=9199`) เช็คอย่างน้อย:
  1. แท็บ JSON โผล่ใน nav และเปิดได้
  2. วาง JSON valid → tree render, จำนวน node ถูก
  3. ค้นหา → ตัวนับถูก, กระโดดแล้วบรรทัด highlight อยู่ใน viewport, กางบล็อกที่พับ
  4. Format/Minify เปลี่ยนข้อความใน editor ถูกต้อง
  5. JSON พัง → แถบ error ชี้บรรทัดถูก, tree เก่ายังอยู่ (จาง)
  6. เปิดไฟล์ผ่าน `input[type=file]` (uploadFile) → render
  7. reload หน้า → ข้อความเดิมกลับมา (localStorage)
- Layout check เชิง geometry: สองฝั่งไม่ overflow, nav ไม่พัง (บทเรียนจากรอบ mirror)
- Code review ก่อน commit (pattern repo: Opus subagent)
