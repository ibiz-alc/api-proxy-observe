# scrcpy Web Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ฝัง screen mirror ของ Android device (จริง+emulator) เป็น panel ในเว็บ API Debugger — ดูจอสด, control เต็มรูปแบบ (แตะ/ลาก/คีย์/พิมพ์ไทย), ซ่อน/แสดง, disconnect ได้

**Architecture:** scrcpy-server jar (vendored v3.3.3) ถูก push+start ผ่าน adb โดย server.js (Node) ผ่านชุด `@yume-chan/*`; video H.264 packets ถูก relay ผ่าน WebSocket ไป browser ซึ่ง decode ด้วย WebCodecs (`@yume-chan/scrcpy-decoder-webcodecs` bundle ด้วย esbuild); control events ส่งกลับทาง WS เดียวกัน **1 WS connection = 1 scrcpy session** (ไม่ share stream — keyframe ชัวร์ตอนเริ่ม, จัดการง่าย)

**Tech Stack:** ws 8.x, @yume-chan/adb 2.6.2 + adb-server-node-tcp 2.5.2 + adb-scrcpy 2.3.2 + scrcpy 2.3.0 (protocol), scrcpy-server v3.3.3 (vendor/), esbuild + @yume-chan/scrcpy-decoder-webcodecs 2.5.3 (client), Node 22 (CJS `require(esm)` / dynamic import ได้)

**บริบทสำคัญ:**
- ทำงานใน worktree นี้เท่านั้น branch `feature/scrcpy-web-mirror` — **ห้ามแตะ** repo หลัก (:3000 กำลัง serve demo อยู่)
- Dev server รัน: `env -u NODE_OPTIONS PORT=3100 PROXY_PORT=9199 node server.js`
- Device จริง `RZCXB0AP8DZ` ต่อ USB อยู่ = ของ demo เจ้านาย → **ห้าม inject touch/key ใส่เครื่องนี้** (smoke test ใช้ setClipboard ซึ่งไม่มีผลบน UI เท่านั้น) — ทดสอบ input จริงบน emulator เท่านั้น
- โค้ด comment ภาษาไทย ตาม convention ของ repo (ดู server.js ประกอบ)
- API จริงของ lib ให้อ่านจาก `node_modules/@yume-chan/*/esm/*.d.ts` (ตรวจแล้ว: `AdbScrcpyClient.pushServer/start`, `client.videoStream` → `{metadata, stream, sizeChanged, width, height}`, `client.controller` → `injectTouch/injectScroll/injectKeyCode/injectText/setClipboard/backOrScreenOn/rotateDevice/resetVideo`)

---

## สถานะ (update ทุกครั้งที่จบ task)

- [x] Task 0: Scaffolding — deps ติดตั้งแล้ว, jar vendored ที่ `vendor/scrcpy-server-v3.3.3.bin`, baseline server boot :3100 ผ่าน
- [ ] Task 1: Server mirror module (`mirror.js` + wiring ใน `server.js`)
- [ ] Task 2: Client mirror panel (`client-src/mirror-panel.js` → `public/mirror.bundle.js` + wiring `public/index.html`)
- [ ] Task 3: Integration + E2E (view บน device จริง แบบ read-only, input ครบชุดบน emulator)
- [ ] Task 4: code-review → แก้ finding ที่คุ้ม → commit

---

## WS Protocol Contract (ห้าม drift — สองฝั่งต้องตรงกันเป๊ะ)

**Endpoint:** `ws://host:PORT/api/mirror` (HTTP Upgrade บน http server ตัวเดียวกับ express)

### Client → Server: JSON text frames

```jsonc
{"type":"start","serial":"RZCXB0AP8DZ","maxSize":1024,"bitRate":4000000,"maxFps":30}
  // เริ่ม mirror — ต้องเป็น message แรก; maxSize/bitRate/maxFps optional (default ตามนี้)
{"type":"touch","action":"down"|"move"|"up","pointerId":0,"x":0.5,"y":0.5,"pressure":1}
  // x,y = normalized 0..1 เทียบกับ video frame ปัจจุบัน (server คูณ width/height เอง — กัน race ตอนหมุนจอ)
{"type":"scroll","x":0.5,"y":0.5,"hDelta":0,"vDelta":-1}
  // hDelta/vDelta = -1..1 (จาก wheel event, normalize ฝั่ง client)
{"type":"key","action":"down"|"up","keycode":66,"metaState":0}
  // keycode = Android keycode (client map จาก browser key)
{"type":"text","text":"สวัสดี"}
  // server ตัดสินใจ: ASCII ล้วน → injectText; มี non-ASCII → setClipboard({paste:true})
{"type":"back"} {"type":"home"} {"type":"appswitch"} {"type":"power"} {"type":"rotate"}
{"type":"keyframe"}   // ขอ keyframe ใหม่ (resetVideo) — เผื่อ decoder เพี้ยน
{"type":"stop"}       // จบ session (server ปิด scrcpy + ปิด WS)
```

### Server → Client

JSON text frames:
```jsonc
{"type":"ready","serial":"...","width":1024,"height":2148,"codec":"h264"}
  // scrcpy start สำเร็จ วิดีโอกำลังมา
{"type":"meta","width":2148,"height":1024}   // ขนาดเปลี่ยน (หมุนจอ) — client resize canvas
{"type":"error","message":"..."}              // ผิดพลาด (device ไม่เจอ / scrcpy ตาย) — server ปิด WS ตาม
{"type":"stopped","reason":"..."}             // จบปกติ
```

Binary frames (video packet): header 12 bytes + payload
```
byte 0     : kind — 0=configuration (SPS/PPS), 1=keyframe data, 2=delta data
bytes 1-3  : reserved (0)
bytes 4-11 : pts เป็น microseconds, Float64 little-endian (configuration ใช้ 0)
bytes 12.. : payload (Annex B H.264)
```
Mapping กับ `ScrcpyMediaStreamPacket`: `{type:'configuration', data}` → kind 0; `{type:'data', keyframe:true|false, pts:bigint, data}` → kind 1|2, pts µs

---

## Task 1: Server mirror module

**Files:**
- Create: `mirror.js` (repo root — convention เดียวกับ `proxy.js`, CommonJS)
- Modify: `server.js` — จับ instance จาก `app.listen(...)` (บรรทัด ~2231) ใส่ตัวแปร `const httpServer = app.listen(...)` แล้วเรียก `initMirror({ httpServer })` (require `./mirror`)
- Create: `scripts/mirror-smoke.js` — smoke test แบบ Node WS client

**Design ใน `mirror.js`:**
- `initMirror({ httpServer })` — สร้าง `WebSocketServer({ noServer:true })` + handle `httpServer.on('upgrade')` เฉพาะ path `/api/mirror` (path อื่นปล่อยผ่าน/destroy ตามเดิม — ระวังอย่าชน SSE ที่เป็น HTTP ปกติ)
- ESM imports ทำแบบ lazy dynamic `import()` ครั้งแรกที่มีคน start (cache ไว้) — ห้ามทำ top-level await ใน CJS
- ต่อ adb ผ่าน `AdbServerClient` + `AdbServerNodeTcpConnector({host:'127.0.0.1', port:5037})` → หา device จาก serial (`getDevices()` แล้ว match) → `createTransport` → `new Adb(transport)`
- Push jar จาก `vendor/scrcpy-server-v3.3.3.bin` (ReadableStream จากไฟล์ — ดู `@yume-chan/stream-extra` หรือแปลง buffer เป็น stream) → `AdbScrcpyClient.start(adb, path, new AdbScrcpyOptionsLatest(new ScrcpyOptionsLatest({...})))` — version string ต้องเป็น `'3.3.3'`, `audio:false`, `control:true`
- Video: `await client.videoStream` → อ่าน `stream` (ReadableStream ของ packet) → ห่อ binary frame ตาม contract ส่งเข้า ws (เช็ค `ws.bufferedAmount > 4MB` → drop delta frame กัน backpressure ค้าง, ห้าม drop configuration/keyframe)
- `sizeChanged` event → ส่ง `{"type":"meta",...}`
- Control: แปลง JSON → เรียก controller ตาม contract (touch: คูณ normalized ด้วย width/height ปัจจุบัน; `screenWidth/screenHeight` ใส่ขนาดปัจจุบัน; `actionButton/buttons` ตาม d.ts ของ inject-touch — อ่านก่อนเขียน) — text: regex `/^[\x00-\x7F]*$/` → injectText, ไม่งั้น `setClipboard({sequence: BigInt(Date.now()) หรือ counter, content: text, paste: true})`
- Cleanup ทางเดียวเสมอ: WS close → `client.close()` + kill process; scrcpy `exited` → ส่ง `stopped` + ปิด WS; error ทุกจุด → `{"type":"error"}` + ปิด — **ห้ามมี unhandled rejection ทำ server ตาย** (จำบทเรียน spawn error listener จาก memory: ทุก stream/promise ต้องมี catch)
- Log ผ่าน `console.log('[mirror] ...')` ภาษาไทย ให้เนียนกับ log เดิม

**Steps:**
- [ ] เขียน `scripts/mirror-smoke.js` ก่อน (fail ก่อนมี implementation): ต่อ `ws://localhost:3100/api/mirror`, ส่ง start ด้วย serial จาก argv, คาดหวัง: `ready` ภายใน 15s → binary kind 0 (config) → binary kind 1 (keyframe) → รับ frame ≥ 10 อัน → ส่ง `{"type":"text","text":"apitester-mirror-smoke"}` (ปลอดภัย: ไม่มีผลบนจอ) → ส่ง `stop` → คาดหวัง WS ปิดสวยๆ ภายใน 5s → พิมพ์ `SMOKE PASS` / exit 1 ถ้า fail
- [ ] รัน smoke → ต้อง FAIL (ยังไม่มี endpoint)
- [ ] เขียน `mirror.js` + wiring ใน `server.js`
- [ ] start dev server :3100 → รัน `env -u NODE_OPTIONS node scripts/mirror-smoke.js RZCXB0AP8DZ` → ต้อง `SMOKE PASS`
- [ ] เช็ค log server ไม่มี unhandled error, `adb shell ps | grep scrcpy` บนเครื่องต้องไม่มี process ค้างหลัง stop

## Task 2: Client mirror panel

**Files:**
- Create: `client-src/mirror-panel.js` (ทุกอย่างของ panel อยู่ไฟล์เดียว: UI สร้างด้วย DOM API, WS, decoder, input capture)
- Create: `scripts/build-mirror.mjs` หรือ npm script `build:mirror` → esbuild bundle IIFE ออก `public/mirror.bundle.js` (commit bundle ด้วย — prod ไม่มี build step)
- Modify: `public/index.html` — เพิ่ม `<script src="mirror.bundle.js"></script>` ก่อน `app.js` + ปุ่ม toggle ใน nav (id `mirrorToggleBtn`, style เดียวกับปุ่ม nav อื่น — ดู index.html เดิม)
- Modify: `public/style.css` — สไตล์ drawer (ธีมมืดเดียวกับแอพ ดูตัวแปรสี/`style.css` เดิม)
- Modify: `public/app.js` — แค่ hook ปุ่ม nav เรียก `window.MirrorPanel.toggle()` (โค้ดหลักอยู่ใน bundle)

**Design:**
- `window.MirrorPanel = { toggle(), open(serial?), close() }` — drawer ด้านขวา กว้าง ~380px, ดันเนื้อหาหลัก (margin-right บน body/container) หรือ overlay ก็ได้ให้เหมือน mock ที่เจ้านายส่งมา (แนบขวาเต็มความสูง)
- ส่วนหัว drawer: `<select>` รายชื่อ device (GET `/api/devices` — ดู shape จาก server.js endpoint เดิม), ปุ่ม เชื่อมต่อ/ตัดการเชื่อมต่อ, ปุ่มซ่อน (—) , สถานะ (จุดเขียว/แดง + ข้อความไทย)
- Canvas: decoder จาก `@yume-chan/scrcpy-decoder-webcodecs` (อ่าน d.ts ใน node_modules ก่อนใช้ — ต้องเลือก renderer ที่ lib มีให้ แล้ว append element ของ renderer เข้า container), แสดงเต็มความกว้าง drawer, สูงตาม aspect; รับ `meta` → ปรับ aspect
- ถ้า `typeof VideoDecoder === 'undefined'` → แสดงข้อความ "เบราว์เซอร์นี้ไม่รองรับ WebCodecs — ใช้ Chrome/Edge" แทน canvas
- Input บน canvas container:
  - `pointerdown/move/up` (setPointerCapture) → normalize เป็น 0..1 เทียบ rect ของ video element → ส่ง touch (move throttle ~60Hz / requestAnimationFrame)
  - `wheel` → scroll message (delta normalize หาร 100 clamp -1..1), preventDefault
  - `tabindex=0` + `keydown/keyup`: key พิเศษ map เป็น Android keycode (Enter=66, Backspace=67, Del=112, Tab=61, Escape=111, Arrow L/R/U/D=21/22/19/20, Space=62) ส่ง `key`; ตัวอักษรพิมพ์ได้ (`key.length===1` และไม่มี ctrl/meta) → ส่ง `text` ทีละตัว (ไทยไปทาง clipboard ฝั่ง server เอง); preventDefault กัน scroll
- แถวล่าง: text input + ปุ่ม "ส่งข้อความ" (พิมพ์ไทยยาวๆ แล้วส่งทีเดียว — ทางหลักสำหรับภาษาไทย), toolbar ปุ่ม: ⬅ Back, ⭘ Home, ▢ Recents, 🔄 Rotate, ⏻ Power, 🔑 Keyframe
- Reconnect: ถ้า WS หลุดโดยไม่ได้กด disconnect และ panel ยังเปิด → retry ทุก 3s (แสดง "กำลังเชื่อมต่อใหม่…") สูงสุดไม่จำกัดจนกด disconnect/ปิด panel
- ซ่อน panel (ปุ่ม —): `display:none` แต่ WS + decoder ยังวิ่ง (โชว์กลับมาได้ทันที) — disconnect เท่านั้นที่ตัด session

**Steps:**
- [ ] เขียน `client-src/mirror-panel.js` + build script → bundle สำเร็จไม่มี error
- [ ] wiring index.html / style.css / app.js
- [ ] เปิด `http://localhost:3100` ด้วย browser (หรือ puppeteer ถ้าไม่มีจอ) → ปุ่ม toggle เปิด drawer, เลือก device, connect แล้วเห็นภาพ

## Task 3: Integration + E2E (คนคุมหลักทำเอง ห้ามข้าม — verification-before-completion)

- [ ] Smoke ซ้ำบน device จริง (view + clipboard เท่านั้น)
- [ ] Boot emulator `Pixel_4_XL` ด้วย `-no-snapshot` → ทดสอบ input จริงบน emulator: แตะเปิดแอป, ลาก/scroll, กด Back/Home, พิมพ์ ASCII, พิมพ์ไทย "สวัสดีครับ" (ต้องโผล่ในช่อง search/notes บนจอ), หมุนจอ (canvas ปรับ aspect), disconnect (scrcpy process หายจากเครื่อง), ซ่อน/แสดง, ปิด emulator → panel ขึ้น reconnecting → boot กลับ → ภาพกลับมาเอง
- [ ] ตรวจว่า capture proxy เดิม (:3000/:8888 ของ demo) ไม่ถูกกระทบตลอดการทดสอบ (`curl localhost:3000/api/status` ยังปกติ)

## Task 4: Review + Commit

- [ ] `code-review` skill บน diff ของ branch → ตรวจ finding เองก่อนแก้ (ไม่ใช่ทุกข้อคุ้ม) → แก้ที่สำคัญ
- [ ] Commit เป็นก้อนเดียวหรือสองก้อน (server/client) message ภาษาไทยตาม convention เดิม — **ห้ามใส่ Co-Authored-By** (กติกาเจ้านาย)
- [ ] **ห้าม push / ห้าม merge เข้า main** จนกว่าเจ้านายสั่ง
