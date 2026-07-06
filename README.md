# API Tester

Web สำหรับทดสอบการรับ-ส่งข้อมูล API และอ่าน metadata ของรูปภาพ สร้างด้วย Node.js + Express

## ฟีเจอร์

1. **📥 Inspector (รับข้อมูล)** — ยิง request จากระบบอื่นมาที่ `/hook` (รองรับทุก method และทุก path ย่อย เช่น `/hook/order/create`) แล้วดู headers, query, body, ไฟล์แนบ ได้ทันทีแบบ real-time
2. **📤 Sender (ส่งข้อมูล)** — กรอก URL / method / headers / body (JSON หรือ form-data พร้อมไฟล์) ส่งไปทดสอบ API อื่น แล้วดู response ที่ได้กลับมา (ส่งผ่าน server จึงไม่ติด CORS)
3. **🖼️ Image Metadata** — เลือกรูปจากเครื่อง (คลิกหรือลากวาง) เพื่ออ่าน EXIF: วันที่ถ่าย, พิกัด GPS, ที่อยู่ (reverse geocode ผ่าน OpenStreetMap ต้องต่ออินเทอร์เน็ต), ข้อมูลกล้อง, และ metadata ทั้งหมด พร้อมลิงก์เปิด Google Maps
4. **📱 Mobile Files** — แนบรูปจากมือถือ (เปิดหน้าเว็บผ่าน IP วง LAN เดียวกัน หรือให้ mobile app ยิง multipart มาที่ `/hook/mobile-upload`) แล้วฝั่ง web เห็นทันทีว่าแนบไฟล์อะไรมา: รูปตัวอย่าง, ชื่อ/ขนาดไฟล์, IP กับ User-Agent ของผู้ส่ง, หมายเหตุ และ metadata ของรูปครบชุด (วันที่ถ่าย, GPS, ที่อยู่, กล้อง)

## วิธีใช้งาน

```bash
npm install
npm start
```

เปิดเบราว์เซอร์ที่ http://localhost:3000

ทดลองยิงข้อมูลเข้ามา:

```bash
curl -X POST http://localhost:3000/hook/test \
  -H 'Content-Type: application/json' \
  -d '{"hello": "world"}'
```

## 🌐 Proxy (MITM — ดักทราฟฟิกแบบ Proxyman)

แท็บ Proxy ทำตัวเป็น HTTP proxy ดักดูทราฟฟิกจริงจากอุปกรณ์ (รวมถึงถอดรหัส HTTPS)

**วิธีใช้:**
1. บนอุปกรณ์ (มือถือ) ตั้ง Wi-Fi → HTTP Proxy → Manual → Server = IP เครื่องนี้, Port = `8080` (ตั้งผ่าน `PROXY_PORT` ได้)
2. เปิดเบราว์เซอร์บนอุปกรณ์ โหลด CA cert จาก `http://<IP>:3000/api/proxy/cert` แล้วติดตั้ง + ตั้งค่าให้เชื่อ (iOS: Certificate Trust Settings / Android: Install CA certificate)
3. เปิดแอป/เว็บบนอุปกรณ์ → ทราฟฟิกโผล่ในแท็บ Proxy แบบ real-time คลิกดู request/response headers + body ได้

> ⚠️ CA cert ให้ proxy ถอดรหัส HTTPS ได้ ใช้เฉพาะบนอุปกรณ์ทดสอบของคุณเอง และถอนการติดตั้งเมื่อเลิกใช้

พอร์ต proxy (`8080`) แยกจากหน้าเว็บ (`3000`) — CA เก็บใน `.proxy-ca/` (ถูก gitignore)

## Upload API (สำหรับทดสอบอัปโหลดไฟล์)

`POST /api/upload` — ส่งเป็น `multipart/form-data` แนบไฟล์กี่ไฟล์ก็ได้ (ตั้งชื่อ field อะไรก็ได้) พร้อม text field อื่นๆ เช่น `note`

```bash
curl -X POST http://localhost:3000/api/upload \
  -F 'note=ทดสอบอัปโหลด' \
  -F 'image=@photo.jpg'
```

ตอบกลับเป็น JSON: รายละเอียดไฟล์ + `metadata` ของรูป (วันที่ถ่าย, พิกัด GPS, กล้อง, ขนาดภาพ, ImageDescription) เอาไปตรวจความถูกต้องใน test ได้ทันที:

```json
{
  "ok": true,
  "id": "…",
  "fields": { "note": "ทดสอบอัปโหลด" },
  "files": [{
    "name": "photo.jpg", "mimetype": "image/jpeg", "size": 1142,
    "url": "/api/requests/…/files/0",
    "metadata": { "dateTaken": "…", "latitude": 13.75, "longitude": 100.49, "camera": "Apple iPhone 15 Pro" }
  }]
}
```

- ไม่แนบไฟล์ → ตอบ `400` พร้อมข้อความ error
- ทุกการอัปโหลดถูกบันทึกเข้า hook ด้วย — เห็นใน**แท็บ Inspector และ Mobile Files แบบ real-time** และดาวน์โหลดไฟล์กลับได้ผ่าน `url` ที่ตอบกลับ

### ดึง lat/lng/address ของรูปเป็น JSON (สำหรับ mobile)

response ของ `/api/upload` แต่ละไฟล์มี `metadataUrl` มาให้ — มือถือเอาไปดึง lat/lng/address ตรงๆ ได้ (ไม่ต้องแกะ EXIF เอง):

```
GET /api/requests/:id/files/:index/metadata
→ {
  "ok": true,
  "metadata": {
    "latitude": 13.7515, "longitude": 100.4937,
    "address": "ถนนสนามไชย, แขวงพระบรมมหาราชวัง, เขตพระนคร, กรุงเทพมหานคร, 10200, ประเทศไทย",
    "dateTaken": "2025-12-25T07:30:00.000Z", "camera": "Apple iPhone 15 Pro"
  }
}
```

- `?address=0` = ข้ามการหาที่อยู่ (เร็วขึ้น ไม่ต้องต่อเน็ต คืนแค่ lat/lng)
- `/api/upload` เองก็คืน `address` มาในผลลัพธ์เลย (ใส่ `?address=0` เพื่อข้ามได้เช่นกัน)
- address มาจาก OpenStreetMap Nominatim — server ต้องต่ออินเทอร์เน็ต

## Deploy ขึ้น server

รันได้ทุกที่ที่มี Node.js 18 ขึ้นไป:

```bash
npm install
PORT=8080 npm start        # กำหนด port ได้ผ่านตัวแปร PORT (default 3000)
```

แนะนำใช้ [pm2](https://pm2.keymetrics.io/) เพื่อให้รันค้างไว้:

```bash
npm install -g pm2
pm2 start server.js --name api-tester
```

## ข้อควรรู้

- ประวัติ request เก็บใน **หน่วยความจำ** (สูงสุด 200 รายการ) — restart แล้วข้อมูลหาย
- ไฟล์แนบรับได้สูงสุด 25 MB ต่อไฟล์
- ส่วนค้นหา "ที่อยู่" จากพิกัด GPS ใช้บริการฟรีของ OpenStreetMap Nominatim จึงต้องต่ออินเทอร์เน็ต (ส่วนอื่นใช้ offline ได้)
