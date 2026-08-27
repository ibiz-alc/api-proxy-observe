# Spec — Multi-select Map Local (Proxy) + Groups (Map Local page)

Date: 2026-08-27 · Branch: `feature/maplocal-multiselect-groups` · Status: approved, implementing

## Goal
สองงานที่เชื่อมกัน:
1. **หน้า Proxy** — เลือกหลาย URL พร้อมกันแล้วสร้าง Map Local ทีเดียว (ไม่ทำทีละอัน) โดย dedupe รายการซ้ำ
2. **หน้า Map Local** — จัด rule เป็น **group** ได้: rename group, drag-drop ย้าย rule เข้า group, เปิด/ปิดทั้ง group

## Architecture decision
ใช้ field `scenario` (string) ที่มีบน rule อยู่แล้วเป็น "group" — ไม่สร้าง entity ใหม่.
Backend มี `POST /api/maplocal/scenarios/:name/activate|deactivate` (เปิด/ปิดทั้งกลุ่ม) อยู่แล้ว.
ช่องว่างคือ **UI ล้วนๆ** + เพิ่ม endpoint เสริมเล็กน้อย.

*ทางเลือกที่ตัดทิ้ง:* สร้างระบบ group แยก (entity/table ใหม่) → ซ้ำซ้อนกับ scenario, เปลืองงาน.

## Requirements (จาก user, ยืนยันแล้ว)
- Multi-select: รองรับ **สองแบบ** — checkbox ต่อแถว **และ** Shift+click (ช่วง) / Cmd·Ctrl+click (ทีละอัน)
- Dedupe key = **เต็ม URL รวม query string** (`f.url`)
- rule ที่ bulk สร้าง → **ungrouped** (`scenario:''`) ก่อน ค่อยจัดกลุ่มทีหลัง
- เปิด group = **additive** (เฉพาะกลุ่มนั้น ไม่แตะกลุ่มอื่น)

## Data / persistence
- `map-local.json` (array of rules, ที่ repo root) — **ไม่เปลี่ยน shape** field `scenario` = ชื่อกลุ่มของ rule
- ไฟล์ใหม่ `data/map-groups.json` = `[{ "name": string, "order": number, "collapsed": bool }]`
  - ให้ **กลุ่มว่างอยู่รอด reload** (สร้างกลุ่มเปล่าแล้วค่อยลากเข้า) + จำลำดับ/สถานะพับ
  - `data/` gitignored → ของจริงไม่ถูก commit
- **Env override (สำคัญ — กัน dev server เขียนทับของจริง 892KB):**
  - `MAP_LOCAL_FILE` override path ของ `map-local.json`
  - `MAP_GROUPS_FILE` override path ของ `data/map-groups.json`
  - ถ้าไม่ตั้ง = ใช้ default เดิม (backward compatible)

## Backend (server.js)
- `MAP_LOCAL_FILE`/`MAP_GROUPS_FILE` env override + โหลด/เซฟ groups metadata (`loadMapGroups`/`saveMapGroups`)
- `POST /api/maplocal/bulk` `{rules:[{...}]}` → validate+push ทุก rule, `saveMapRules()` **ครั้งเดียว**, คืน `{ok, created:[rule], count}`
- Groups API:
  - `GET /api/maplocal/groups` → union ของ (ชื่อใน map-groups.json) ∪ (distinct `scenario` ที่มีบน rules); คืน `[{name, order, collapsed, total, enabled, active}]` (active = ทุก rule ในกลุ่มเปิด)
  - `POST /api/maplocal/groups` `{name}` → สร้างกลุ่มเปล่าใน metadata (กันชื่อซ้ำ)
  - `PUT /api/maplocal/groups/:name` `{newName?, collapsed?, order?}` → rename (อัปเดต `scenario` ทุก rule ในกลุ่ม + metadata; ถ้า newName ชนกลุ่มเดิม = merge) / อัปเดตสถานะพับ/ลำดับ
  - `DELETE /api/maplocal/groups/:name` → เอาออกจาก metadata + set `scenario:''` ทุก rule ในกลุ่ม (**ungroup, ไม่ลบ rule**)
- เปิด/ปิดทั้งกลุ่ม: reuse `scenarios/:name/activate` (exclusive:false = additive) และ `deactivate`
- ย้าย rule เข้ากลุ่ม (drag-drop): reuse `PUT /api/maplocal/:id {scenario}` เดิม (ไม่มี endpoint ใหม่)

## Frontend — Proxy tab (app.js)
- state ใหม่ `selectedFlowIds` (Set) คู่กับ `selectedFlowId` เดิม (คลิกเดี่ยวยังดู detail เหมือนเดิม)
- `renderFlowTable()`:
  - เพิ่ม `.flow-check` checkbox ต่อแถว (คลิก → toggle ใน Set, ไม่เปิด detail)
  - คลิกที่ row: ปกติ = เลือกเดี่ยว+ดู detail (เดิม); **Shift**+click = เลือกช่วงจากแองเคอร์ล่าสุด; **Cmd/Ctrl**+click = toggle เพิ่ม/ลบใน Set
  - แถวที่อยู่ใน Set ได้คลาส `.multi-selected`
- selection action bar (`#flow-select-bar`) โผล่เมื่อ `selectedFlowIds.size>0`: `เลือก N รายการ · [🎯 Map Local (N)] · [ล้าง]`
- กด Map Local → dedupe ด้วย `f.url` (เต็ม URL) → map แต่ละ unique flow เป็น rule ด้วย logic เดียวกับ `mapLocalFromFlow()` (แต่ `scenario:''`) → `POST /api/maplocal/bulk` → toast `สร้าง X · ข้ามซ้ำ Y` → เคลียร์ selection

## Frontend — Map Local page (app.js)
- `renderMapList()` เปลี่ยนเป็น grouped:
  - ปุ่ม `+ กลุ่มใหม่` (`#maplocal-add-group`) → prompt ชื่อ → `POST /api/maplocal/groups`
  - แต่ละกลุ่ม = header (`.map-group-head`) + body (`.map-group-body`) มี rule ซ้อน
    - header: จุดสถานะ (all/partial/off) · ชื่อ (ดับเบิลคลิก/✏️ = rename → `PUT groups/:name`) · `เปิด n/รวม m` · toggle ทั้งกลุ่ม (→ activate/deactivate additive) · ปุ่มพับ · ปุ่มลบกลุ่ม (→ DELETE, ยืนยันก่อน)
  - หมวด **"ไม่ได้จัดกลุ่ม"** สำหรับ `scenario:''` (ลากออกมาที่นี่ = ungroup)
  - rule row: เพิ่ม `draggable="true"`
- **Drag-drop (HTML5 native):** `dragstart` เก็บ ruleId; drop zone = header/body ของกลุ่ม + หมวดไม่ได้จัดกลุ่ม (`dragover` preventDefault + `.drop-target`; `drop` → `PUT /api/maplocal/:id {scenario:<group|''>}` → reload)
- editor (`renderMapEditor`) เพิ่มช่อง group (dropdown ของกลุ่มที่มี + "ไม่มี") → `collect()` ส่ง `scenario` ด้วย (ตอนนี้ไม่ส่งเลย)

## Testing (dev-tests, puppeteer + node)
รันบน **dev server แยก PORT=3100 ใน worktree**, `MAP_LOCAL_FILE`/`MAP_GROUPS_FILE` ชี้ temp, `env -u NODE_OPTIONS`, puppeteer รันนอก repo. ห้ามยิง :3000.
- `multiselect-maplocal-test.js`: checkbox toggle, Shift ช่วง, Cmd ทีละอัน, action bar count, dedupe เต็ม URL (2 flow url ซ้ำ → 1 rule), bulk create ungrouped + toast X/Y
- `maplocal-groups-test.js`: สร้างกลุ่มเปล่า, กลุ่มว่างรอด reload, rename (+ merge เมื่อชนชื่อ), toggle ทั้งกลุ่ม additive (ไม่แตะกลุ่มอื่น), drag-drop ย้ายกลุ่ม + ลากออก=ungroup, ลบกลุ่ม=ungroup ไม่ลบ rule
- regression: `json-viewer` / `proxy-detail-splitter` / `jv-splitter` ถ้าแตะโครงที่เกี่ยวข้อง

## Out of scope (YAGNI)
- nested group, exclusive-mode ใน UI (backend รองรับ ไว้เพิ่มทีหลัง), ลบกลุ่มแบบลบ rule ทิ้ง (ตอนนี้ ungroup อย่างเดียว), reorder rule ภายในกลุ่ม

## Deploy note
server.js เปลี่ยน → ทำให้ขึ้น :3000 ต้อง **restart server** (จะทำให้ flows 300 ใน memory หาย — backup แล้วที่ `data/flows-backup-premaplocal-*.json`) → **เป็น decision ของเจ้านาย** ไม่ restart เอง. Frontend-only (app.js/css) ขึ้นได้แค่ reload.
