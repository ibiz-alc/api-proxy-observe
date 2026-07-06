# API Tester

Web สำหรับทดสอบการรับ-ส่งข้อมูล API และอ่าน metadata ของรูปภาพ สร้างด้วย Node.js + Express

## ฟีเจอร์

1. **📥 Inspector (รับข้อมูล)** — ยิง request จากระบบอื่นมาที่ `/hook` (รองรับทุก method และทุก path ย่อย เช่น `/hook/order/create`) แล้วดู headers, query, body, ไฟล์แนบ ได้ทันทีแบบ real-time
2. **📤 Sender (ส่งข้อมูล)** — กรอก URL / method / headers / body (JSON หรือ form-data พร้อมไฟล์) ส่งไปทดสอบ API อื่น แล้วดู response ที่ได้กลับมา (ส่งผ่าน server จึงไม่ติด CORS)
3. **🖼️ Image Metadata** — เลือกรูปจากเครื่อง (คลิกหรือลากวาง) เพื่ออ่าน EXIF: วันที่ถ่าย, พิกัด GPS, ที่อยู่ (reverse geocode ผ่าน OpenStreetMap ต้องต่ออินเทอร์เน็ต), ข้อมูลกล้อง, และ metadata ทั้งหมด พร้อมลิงก์เปิด Google Maps

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
