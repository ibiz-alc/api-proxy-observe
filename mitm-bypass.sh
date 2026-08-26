#!/bin/sh
# ตัวสตาร์ท mitmdump ที่ใช้ร่วมกัน (start.sh / restart.sh / docker-entrypoint.sh)
# + รายชื่อ host ที่ "ไม่" ดัก TLS — ปล่อยผ่านเป็น tunnel ดิบ (ไม่ถอดรหัส ไม่บันทึกเป็น flow)
#
# ทำไมต้องมี
# ----------
# Google Play Services (GMS) ไม่เชื่อ CA ที่ผู้ใช้ติดตั้งเอง (user CA store) และ pin cert ของ
# Google ไว้ พอตั้ง global http_proxy ชี้ mitmproxy ทราฟฟิกของ GMS จะวิ่งผ่าน proxy ไปด้วย
# แล้ว handshake ล้มทุกครั้ง:
#     Client TLS handshake failed. The client does not trust the proxy's certificate
#     for android.apis.google.com (ssl/tls alert certificate unknown)
# android.apis.google.com คือช่องที่ GMS ใช้ checkin/ลงทะเบียน FCM → พอทะลุไม่ได้ GMS จะตอบ
# error กลับมาที่แอป และ FirebaseMessaging.getToken() จะพังเป็น:
#     java.util.concurrent.ExecutionException: java.io.IOException: SERVICE_NOT_AVAILABLE
#
# วัดจริงแล้ว 26 ส.ค. 2026 (SM-A217F / Android 12, /tmp/mitmdump.log 3 ชม.):
#   handshake ล้ม 379 ครั้ง — www.google.com 326, quake-pa.googleapis.com 23,
#   android.apis.google.com 9, digitalassetlinks.googleapis.com 8, app-measurement.com 6,
#   connectivitycheck.gstatic.com 3, play.googleapis.com 2, play.google.com 1
#   → ทั้งหมดเป็น endpoint ของ GMS ล้วน ๆ
#   ส่วน endpoint ที่แอปยิงเอง (firebaseinstallations.googleapis.com, firebaselogging-pa,
#   firebase-settings.crashlytics.com) ได้ 200 OK ปกติ เพราะแอป debug เชื่อ user CA
#   → พังเฉพาะฝั่ง GMS ไม่ใช่ฝั่งแอป
#
# host ของแอปที่เทสต์อยู่ไม่โดนแตะ — ยังถอดรหัส/บันทึกครบเหมือนเดิม
# ปิด bypass (กลับไปดักทุก host): MITM_IGNORE_HOSTS= ./start.sh
# เพิ่ม host เอง: MITM_IGNORE_HOSTS='regex ของคุณ' ./start.sh
#
# firebaselogging-pa ถูกกันไว้ไม่ให้ bypass — ตัวนี้แอปยิงเอง (ทะลุ mitm ได้ 200 OK อยู่แล้ว)
# ถ้าปล่อยให้ -pa กินไปด้วยจะหายจาก flow เงียบ ๆ ทั้งที่เดิมดูได้
#
# หมายเหตุ regex: mitmproxy ทำ re.search กับ hostname (บางเคสเป็น host:port) → เลยผูก (^|\.)
# ไว้ข้างหน้าเพื่อให้ match เฉพาะโดเมน/ซับโดเมนจริง (notgoogle.com จะไม่โดน) และปิดท้ายด้วย
# (:[0-9]+)?$ เผื่อกรณีที่ match ทั้ง host:port เช่น mtalk.google.com:5228
_mitm_ignore_default='(^|\.)(google\.com|gstatic\.com|googleusercontent\.com|android\.com|app-measurement\.com|(play|digitalassetlinks)\.googleapis\.com|(?!firebaselogging-)[a-z0-9-]+-pa\.googleapis\.com)(:[0-9]+)?$'
: "${MITM_IGNORE_HOSTS=$_mitm_ignore_default}"

# สตาร์ท mitmdump + addon เป็น background job — $1 = path ของ addon
# ต้องมีที่เดียวเท่านั้น ไม่งั้นเพิ่ม flag แล้วลืมแก้บางสคริปต์ → FCM จะพังกลับมาเฉพาะบางทางเข้า
# พอร์ตตรึงไว้ที่ 8888 ตรงกับ server.js (const MITM_PORT = 8888) และ wait_port/adb reverse
# ในสคริปต์ที่เรียก — ทำให้ตั้งพอร์ตอื่นได้เฉพาะตรงนี้ = สคริปต์จะรายงานว่า mitmproxy ไม่ขึ้น
start_mitmdump() {
  _addon="$1"
  if [ -n "$MITM_IGNORE_HOSTS" ]; then
    PYTHONUNBUFFERED=1 "${MITMDUMP:-mitmdump}" --listen-host 0.0.0.0 --listen-port 8888 \
      -s "$_addon" --ignore-hosts "$MITM_IGNORE_HOSTS" > /tmp/mitmdump.log 2>&1 &
  else
    PYTHONUNBUFFERED=1 "${MITMDUMP:-mitmdump}" --listen-host 0.0.0.0 --listen-port 8888 \
      -s "$_addon" > /tmp/mitmdump.log 2>&1 &
  fi
}
