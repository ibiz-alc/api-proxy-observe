# API Tester — Design

วันที่: 2026-07-06
สถานะ: อนุมัติแล้ว (สร้างเสร็จพร้อม design นี้)

## เป้าหมาย

Web app ด้วย Node.js สำหรับทดสอบความถูกต้องของการรับ-ส่งข้อมูล ใช้ตรวจสอบด้วยตาเอง (ไม่มี validation อัตโนมัติ) รันได้ทั้ง localhost และ deploy ขึ้น server

## Requirement ที่ตกลงกัน

- สองทิศทาง: รับ request เข้ามาแสดง (webhook inspector) + ส่ง request ออกไปทดสอบ API อื่น
- รองรับ JSON และ form-data/ไฟล์แนบ
- เก็บประวัติในหน่วยความจำ (สูงสุด 200 รายการ, restart แล้วหาย)
- อัปเดตหน้าเว็บแบบ real-time
- ฟีเจอร์เพิ่ม: browse รูปภาพเพื่ออ่าน metadata — วันที่ถ่าย, พิกัด GPS (location), ที่อยู่ (address), ข้อมูลกล้อง

## สถาปัตยกรรม

แนวทางที่เลือก: **Express ตัวเดียว + หน้าเว็บ HTML/JS ธรรมดา (ไม่มี build step) + SSE**

```
server.js               Express app เดียว เสิร์ฟทั้ง API และหน้าเว็บ
public/index.html       UI 3 แท็บ: Inspector / Sender / Image Metadata
public/app.js           logic ฝั่งเบราว์เซอร์ทั้งหมด
public/style.css        ธีมมืด responsive
```

### Endpoints

| Endpoint | หน้าที่ |
|---|---|
| `ALL /hook`, `/hook/*` | รับ request ทุก method เก็บ method/path/headers/query/body/ไฟล์ ลงหน่วยความจำ แล้ว broadcast ผ่าน SSE |
| `GET /api/requests` | รายการ request ที่เก็บไว้ |
| `DELETE /api/requests` | ล้างประวัติ |
| `GET /api/requests/:id/files/:index` | ดาวน์โหลด/พรีวิวไฟล์แนบที่รับไว้ |
| `GET /api/events` | SSE stream ให้หน้าเว็บอัปเดต real-time |
| `POST /api/send` | proxy ส่ง request (JSON/raw) ไปยัง API ปลายทาง — เลี่ยง CORS |
| `POST /api/send-form` | proxy ส่ง multipart form-data + ไฟล์ ไปยังปลายทาง |
| `GET /vendor/exifr.js` | เสิร์ฟไลบรารี exifr จาก node_modules (ไม่พึ่ง CDN) |

### การ parse body ของ `/hook`

ลำดับ middleware: multer (multipart) → json → urlencoded → text → raw (ยกเว้น multipart เพื่อไม่อ่าน stream ซ้ำ) — ทำให้รับ content type ใดก็ได้ ถ้า parse ไม่ได้จะแสดงเป็น raw text หรือระบุว่าเป็น binary

### Image Metadata

- อ่าน EXIF ในเบราว์เซอร์ด้วย exifr (รูปไม่ต้องอัปโหลดขึ้น server)
- แสดง: วันที่ถ่าย (DateTimeOriginal), พิกัด GPS + ลิงก์ Google Maps, ข้อมูลกล้อง/เลนส์, ขนาดภาพ, ตาราง metadata ทั้งหมด
- ที่อยู่ (address): reverse geocode จากพิกัดผ่าน OpenStreetMap Nominatim (ภาษาไทย) — ต้องต่ออินเทอร์เน็ต, ถ้าล้มเหลวแสดงข้อความบอกอย่างสุภาพ

## การจัดการ error

- Sender ต่อปลายทางไม่ได้ → ตอบ `{ok:false, error}` พร้อมสาเหตุ (เช่น ECONNREFUSED) แสดงเป็น badge ERROR
- รูปไม่มี metadata → แจ้งว่ารูปอาจถูกลบ EXIF (เช่นส่งผ่านแอปแชท)
- จำกัดขนาด: ไฟล์ 25 MB, body 10 MB, response ที่แสดงตัดที่ 500 KB

## การทดสอบ (ทำแล้ว)

- curl ยิง hook: JSON, form-data+ไฟล์, GET+query, PUT text/plain — เก็บและอ่านกลับถูกต้อง
- /api/send และ /api/send-form ส่งต่อถึงปลายทางและคืน status/headers/body/เวลา
- ปลายทางล่ม → รายงาน error ถูกต้อง
- ดาวน์โหลดไฟล์แนบกลับมาได้เนื้อหาตรงต้นฉบับ
- สร้าง JPEG ฝัง EXIF (GPS วัดพระแก้ว + วันที่ + iPhone 15 Pro) → exifr อ่านครบ, Nominatim คืนที่อยู่ภาษาไทยถูกต้อง
