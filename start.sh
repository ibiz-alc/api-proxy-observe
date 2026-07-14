#!/bin/bash
# เปิดใช้งานระบบ ApiTester + mitmproxy (+ ngrok ถ้าใส่ --ngrok)
# ครั้งแรกจะติดตั้ง dependency ที่ขาดให้อัตโนมัติ (mitmproxy/adb/node + npm install)
# ใช้: ./start.sh              → ติดตั้ง (ถ้าจำเป็น) + เปิด server + mitmproxy (USB/Wi-Fi)
#      ./start.sh --ngrok      → เปิด + ngrok (remote/4G) ด้วย
#      ./start.sh --skip-setup → ข้ามขั้นติดตั้ง (เร็วขึ้น ถ้าลงครบแล้ว)
cd "$(dirname "$0")" || exit 1
ADDON="$(pwd)/mitm-to-apitester.py"

# รอให้พอร์ต listen จริง (poll สูงสุด ~15 วิ) — mitmdump cold start บางทีเกิน 4 วิ
wait_port() {
  local port="$1" tries="${2:-30}"
  for ((i = 0; i < tries; i++)); do
    lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  return 1
}

# ติดตั้ง brew package ถ้ายังไม่มีคำสั่งนั้น — ensure_pkg <ชื่อคำสั่ง> <ชื่อ formula> <จำเป็นไหม yes/no>
ensure_pkg() {
  local cmd="$1" formula="$2" required="$3"
  command -v "$cmd" >/dev/null 2>&1 && return 0
  if ! command -v brew >/dev/null 2>&1; then
    echo "   ❌ ไม่พบ '$cmd' และไม่มี Homebrew ติดตั้งเอง: https://brew.sh"
    echo "      แล้วรัน: brew install $formula"
    [ "$required" = "yes" ] && return 1 || return 0
  fi
  echo "   📦 ติดตั้ง $formula (ยังไม่มี $cmd)…"
  if brew install "$formula"; then
    echo "   ✅ ติดตั้ง $formula สำเร็จ"
    return 0
  fi
  echo "   ❌ ติดตั้ง $formula ไม่สำเร็จ"
  [ "$required" = "yes" ] && return 1 || return 0
}

# ===== ขั้นติดตั้ง (ข้ามด้วย --skip-setup) =====
if [ "$1" != "--skip-setup" ] && [ "$2" != "--skip-setup" ]; then
  echo "==> 0) ตรวจ + ติดตั้ง dependency"

  # node: จำเป็น + ต้อง >= 18 (package.json engines)
  ensure_pkg node node yes || exit 1
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "   ❌ Node เวอร์ชันเก่าไป ($(node -v)) — ต้อง >= 18"
    echo "      อัปเดต: brew upgrade node"
    exit 1
  fi
  echo "   ✅ node $(node -v)"

  # python3: mitmproxy bundle python มาเองก็จริง แต่เช็คไว้ให้ครบ (ใช้กับ addon/สคริปต์เสริม)
  if command -v python3 >/dev/null 2>&1; then
    echo "   ✅ python3 $(python3 --version 2>&1 | awk '{print $2}')"
  else
    echo "   ⚠️ ไม่พบ python3 — mitmproxy ใช้ python ในตัวได้ แต่แนะนำให้ลง: brew install python3"
    ensure_pkg python3 python no
  fi

  ensure_pkg mitmdump mitmproxy yes  || exit 1   # จำเป็น: ดัก/ถอดรหัส HTTPS
  ensure_pkg adb android-platform-tools no       # optional: คุม device Android (iOS ไม่ต้อง)
  [ "$1" = "--ngrok" ] && ensure_pkg ngrok ngrok no  # optional: remote/4G

  # npm install ให้อัตโนมัติถ้ายังไม่มี node_modules
  if [ ! -d node_modules ]; then
    echo "   📦 npm install (web server)…"
    npm install || { echo "   ❌ npm install ล้มเหลว"; exit 1; }
  fi
  # MCP server deps (optional — สำหรับ AI agent integration)
  if [ -f mcp/package.json ] && [ ! -d mcp/node_modules ]; then
    echo "   📦 npm install (MCP server)…"
    npm --prefix mcp install || echo "   ⚠️ MCP npm install ล้มเหลว (ข้ามได้ถ้าไม่ใช้ agent)"
  fi
fi

echo "==> ปิดของเก่า (ถ้ามี)"
pkill -f "node server.js" 2>/dev/null
pkill -f "mitmdump" 2>/dev/null
pkill -f "ngrok" 2>/dev/null
sleep 2

echo "==> 1) ApiTester server (พอร์ต 3000)"
node server.js > /tmp/apitester.log 2>&1 &

echo "==> 2) mitmproxy + addon (พอร์ต 8888)"
PYTHONUNBUFFERED=1 mitmdump --listen-host 0.0.0.0 --listen-port 8888 -s "$ADDON" > /tmp/mitmdump.log 2>&1 &

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
echo "==> สถานะ (รอ service ขึ้นจริง…)"
if wait_port 3000; then echo "   ✅ ApiTester : http://localhost:3000"; else echo "   ❌ ApiTester ไม่ขึ้น (ดู /tmp/apitester.log)"; tail -8 /tmp/apitester.log | sed 's/^/      /'; fi
if wait_port 8888; then
  echo "   ✅ mitmproxy : พอร์ต 8888"
else
  echo "   ❌ mitmproxy ไม่ขึ้น — สาเหตุจาก log:"
  tail -12 /tmp/mitmdump.log | sed 's/^/      /'
fi
echo ""
echo "เสร็จ! เปิดเว็บ http://localhost:3000 → แท็บ Proxy | บนมือถือเชื่อม Proxy Postern มาที่ port 8888"
