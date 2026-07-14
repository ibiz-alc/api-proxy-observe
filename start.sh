#!/bin/bash
# เปิดใช้งานระบบ ApiTester + mitmproxy (+ ngrok ถ้าใส่ --ngrok)
# ครั้งแรกจะติดตั้ง dependency ที่ขาดให้อัตโนมัติ (mitmproxy/adb/node + npm install)
# ใช้: ./start.sh                  → native: server + mitmproxy (USB/Wi-Fi ครบ)
#      ./start.sh --ngrok          → native + ngrok (remote/4G)
#      ./start.sh --skip-setup     → ข้ามขั้นติดตั้ง (เร็วขึ้น ถ้าลงครบแล้ว)
#      ./start.sh --docker         → รันใน Docker แทน (manual proxy+CA, ไม่มี adb/USB)
#      ./start.sh --docker --build → Docker + rebuild image (หลังแก้โค้ด)
# สลับโหมดได้เลย — สคริปต์จะปิดอีกโหมดให้ก่อน (native กับ Docker bind พอร์ตซ้อนกันได้เงียบๆ)
cd "$(dirname "$0")" || exit 1
ADDON="$(pwd)/mitm-to-apitester.py"

NGROK=no SKIP_SETUP=no DOCKER=no BUILD=no
for arg in "$@"; do
  case "$arg" in
    --ngrok) NGROK=yes ;;
    --skip-setup) SKIP_SETUP=yes ;;
    --docker) DOCKER=yes ;;
    --build) BUILD=yes ;;
    *) echo "❌ ไม่รู้จัก option: $arg (มี --ngrok --skip-setup --docker --build)"; exit 1 ;;
  esac
done

# ฆ่า node ที่ listen พอร์ตนั้นอยู่ (กรองด้วย -c node — ไม่แตะ docker daemon ที่ bind พอร์ตเดียวกัน)
kill_node_on_port() {
  local pids
  pids=$(lsof -ti tcp:"$1" -sTCP:LISTEN -a -c node 2>/dev/null)
  [ -n "$pids" ] && kill $pids 2>/dev/null
}

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

# ===== โหมด Docker (--docker) =====
if [ "$DOCKER" = yes ]; then
  command -v docker >/dev/null 2>&1 || { echo "❌ ไม่พบ docker — ติดตั้ง Docker Desktop ก่อน"; exit 1; }
  if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon ยังไม่พร้อม — รัน: open -a Docker แล้วรอ ~30 วิ ค่อยลองใหม่"
    exit 1
  fi

  echo "==> ปิด native ที่ค้าง (กันพอร์ตชนแบบเงียบ — native=IPv4, Docker=IPv6)"
  pkill -f "node server.js" 2>/dev/null && echo "   ปิด ApiTester (native)"
  pkill -f "mitmdump" 2>/dev/null && echo "   ปิด mitmproxy (native)"
  kill_node_on_port 7333 && echo "   ปิด MCP (native)"
  sleep 1

  echo "==> Docker: compose up"
  if [ "$BUILD" = yes ]; then
    docker compose up -d --build || exit 1
  else
    docker compose up -d || exit 1
  fi

  echo ""
  echo "==> สถานะ (รอ service ใน container ขึ้นจริง…)"
  for ((i = 0; i < 30; i++)); do
    curl -fsS -m 2 http://127.0.0.1:3000/api/status >/dev/null 2>&1 && break
    sleep 1
  done
  if curl -fsS -m 3 http://127.0.0.1:3000/api/status 2>/dev/null | grep -q '"ok":true'; then
    echo "   ✅ ApiTester : http://localhost:3000 (Docker)"
    echo "   ✅ mitmproxy : พอร์ต 8888 | MCP : พอร์ต 7333"
  else
    echo "   ❌ container ยังไม่พร้อม — ดู log: docker logs apitester"
    docker logs apitester 2>&1 | tail -8 | sed 's/^/      /'
    exit 1
  fi
  echo ""
  echo "เสร็จ! (Docker) มือถือเชื่อมแบบ manual proxy + ติดตั้ง CA จากแท็บ Status — โหมดนี้ไม่มี adb/USB"
  echo "กลับมารันปกติ: ./start.sh (จะหยุด container ให้เอง)"
  exit 0
fi

# ===== ขั้นติดตั้ง (ข้ามด้วย --skip-setup) =====
if [ "$SKIP_SETUP" != yes ]; then
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
  [ "$NGROK" = yes ] && ensure_pkg ngrok ngrok no  # optional: remote/4G

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
# container apitester รันอยู่ → หยุดก่อน ไม่งั้นพอร์ตซ้อนกันเงียบๆ (Docker bind IPv6, native bind IPv4)
if command -v docker >/dev/null 2>&1 && docker ps -q --filter name=apitester 2>/dev/null | grep -q .; then
  echo "   🐳 หยุด container apitester ก่อน (กันพอร์ตชน)"
  docker compose stop >/dev/null 2>&1 || docker stop apitester >/dev/null 2>&1
fi
pkill -f "node server.js" 2>/dev/null
pkill -f "mitmdump" 2>/dev/null
pkill -f "ngrok" 2>/dev/null
kill_node_on_port 7333
sleep 2

echo "==> 1) ApiTester server (พอร์ต 3000)"
# ส่ง path เต็มของ mitmdump ให้ node (shell นี้มี PATH เต็ม — กันเคส node หา mitmdump ไม่เจอ)
export MITMDUMP="$(command -v mitmdump)"
# -u NODE_OPTIONS: กัน preload module จาก env ภายนอก (เช่น sandbox ของ agent) ทำ node ล้มทั้งตัว
env -u NODE_OPTIONS node server.js > /tmp/apitester.log 2>&1 &

echo "==> 2) mitmproxy + addon (พอร์ต 8888)"
PYTHONUNBUFFERED=1 mitmdump --listen-host 0.0.0.0 --listen-port 8888 -s "$ADDON" > /tmp/mitmdump.log 2>&1 &

if [ "$NGROK" = yes ]; then
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
