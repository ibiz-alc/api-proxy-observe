#!/bin/bash
# ปิดระบบทั้งหมด — ทั้ง native และ Docker
cd "$(dirname "$0")" || exit 1

# คืน state ของเครื่อง Android ที่ต่ออยู่ก่อนดับ service
# ถ้าไม่ล้าง เครื่องจะยังชี้ proxy ไปที่ mitmproxy ที่ตายแล้ว = เน็ตดับทั้งเครื่อง หาสาเหตุยาก
# ล้างเฉพาะ proxy ที่เป็นของ ApiTester (127.0.0.1:8888 หรือ <LAN IP ของ Mac>:8888) — ไม่แตะ proxy ที่ผู้ใช้ตั้งเอง
# (ชุดคำสั่งล้างตรงกับ /api/devices/disconnect ใน server.js)
cleanup_devices() {
  command -v adb >/dev/null 2>&1 || return 0
  local serials
  serials=$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}')
  if [ -z "$serials" ]; then
    echo "   (ไม่มี device ต่ออยู่)"
    return 0
  fi
  local lanip s cur k
  lanip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
  for s in $serials; do
    adb -s "$s" reverse --remove tcp:8888 >/dev/null 2>&1
    cur=$(adb -s "$s" shell settings get global http_proxy 2>/dev/null | tr -d '\r')
    if [ "$cur" = "127.0.0.1:8888" ] || { [ -n "$lanip" ] && [ "$cur" = "$lanip:8888" ]; }; then
      adb -s "$s" shell settings put global http_proxy :0 >/dev/null 2>&1
      for k in http_proxy global_http_proxy_host global_http_proxy_port \
               global_http_proxy_exclusion_list global_proxy_pac_url; do
        adb -s "$s" shell settings delete global "$k" >/dev/null 2>&1
      done
      # แจ้งแอปให้รับรู้ทันที ไม่ต้องรอ network reconfigure
      adb -s "$s" shell am broadcast -a android.intent.action.PROXY_CHANGE >/dev/null 2>&1
      echo "   ล้าง proxy + reverse: $s (เน็ตเครื่องกลับมาปกติ)"
    elif [ -z "$cur" ] || [ "$cur" = "null" ] || [ "$cur" = ":0" ]; then
      echo "   ตัด reverse: $s (ไม่ได้ตั้ง proxy ไว้)"
    else
      echo "   ตัด reverse: $s (proxy=$cur ไม่ใช่ของ ApiTester — ไม่แตะ)"
    fi
  done
}

echo "==> คืนค่า device Android (ล้าง proxy/reverse ที่ ApiTester ตั้งไว้)"
cleanup_devices

echo "==> ปิด ApiTester + mitmproxy + MCP + ngrok"
pkill -f "node server.js" 2>/dev/null && echo "   ปิด ApiTester" || echo "   (ApiTester ไม่ได้รัน)"
pkill -f "mitmdump" 2>/dev/null && echo "   ปิด mitmproxy" || echo "   (mitmproxy ไม่ได้รัน)"
# MCP อาจถูกรันเองจาก mcp/ ด้วย `node index.js` — จับจากพอร์ตแทนชื่อ (กรอง -c node ไม่แตะ docker daemon)
MCP_PIDS=$(lsof -ti tcp:7333 -sTCP:LISTEN -a -c node 2>/dev/null)
if [ -n "$MCP_PIDS" ]; then kill $MCP_PIDS 2>/dev/null && echo "   ปิด MCP"; else echo "   (MCP ไม่ได้รัน)"; fi
pkill -f "ngrok" 2>/dev/null && echo "   ปิด ngrok" || echo "   (ngrok ไม่ได้รัน)"
# container apitester (โหมด --docker)
if command -v docker >/dev/null 2>&1 && docker ps -q --filter name=apitester 2>/dev/null | grep -q .; then
  docker compose stop >/dev/null 2>&1 || docker stop apitester >/dev/null 2>&1
  echo "   ปิด container apitester"
else
  echo "   (container ไม่ได้รัน)"
fi
echo "เสร็จ — ปิดหมดแล้ว"
echo "   (proxy บนเครื่องถูกล้างแล้ว → รอบหน้า ./start.sh เสร็จ ให้กด Connect ที่แท็บ Status อีกครั้ง)"
