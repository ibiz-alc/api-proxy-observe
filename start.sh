#!/bin/bash
# เปิดใช้งานระบบ ApiTester + mitmproxy (+ ngrok ถ้าใส่ --ngrok)
# ใช้: ./start.sh           → เปิด server + mitmproxy (สำหรับ USB/adb reverse)
#      ./start.sh --ngrok   → เปิด + ngrok (สำหรับ remote/4G) ด้วย
cd "$(dirname "$0")" || exit 1
ADDON="$(pwd)/mitm-to-apitester.py"

echo "==> ปิดของเก่า (ถ้ามี)"
pkill -f "node server.js" 2>/dev/null
pkill -f "mitmdump" 2>/dev/null
pkill -f "ngrok" 2>/dev/null
sleep 2

echo "==> 1) ApiTester server (พอร์ต 3000)"
node server.js > /tmp/apitester.log 2>&1 &
sleep 2

echo "==> 2) mitmproxy + addon (พอร์ต 8888)"
PYTHONUNBUFFERED=1 mitmdump --listen-host 0.0.0.0 --listen-port 8888 -s "$ADDON" > /tmp/mitmdump.log 2>&1 &
sleep 4

if [ "$1" = "--ngrok" ]; then
  echo "==> 3) ngrok (proxy tcp 8888 + web 3000)"
  ngrok start --all --log stdout > /tmp/ngrok.log 2>&1 &
  sleep 6
  curl -s http://localhost:4040/api/tunnels 2>/dev/null | node -e "try{const d=JSON.parse(require('fs').readFileSync(0));d.tunnels.forEach(t=>console.log('   '+t.name+': '+t.public_url))}catch(e){console.log('   (ngrok ยังไม่พร้อม ดู /tmp/ngrok.log)')}"
else
  echo "==> (โหมด USB + Wi-Fi — ไม่เปิด ngrok)"
  adb reverse tcp:8888 tcp:8888 2>/dev/null && echo "   USB: adb reverse tcp:8888 -> Mac ✅ (มือถือใช้ Host 127.0.0.1)" || echo "   (ไม่มี device USB เสียบอยู่)"
  LANIP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  [ -n "$LANIP" ] && echo "   Wi-Fi: มือถือ (วง LAN เดียวกัน) ใช้ Host $LANIP  Port 8888"
fi

echo ""
echo "==> สถานะ"
lsof -iTCP:3000 -sTCP:LISTEN -P -n >/dev/null 2>&1 && echo "   ✅ ApiTester : http://localhost:3000" || echo "   ❌ ApiTester ไม่ขึ้น (ดู /tmp/apitester.log)"
lsof -iTCP:8888 -sTCP:LISTEN -P -n >/dev/null 2>&1 && echo "   ✅ mitmproxy : พอร์ต 8888" || echo "   ❌ mitmproxy ไม่ขึ้น (ดู /tmp/mitmdump.log)"
echo ""
echo "เสร็จ! เปิดเว็บ http://localhost:3000 → แท็บ Proxy | บนมือถือเชื่อม Proxy Postern มาที่ port 8888"
