#!/usr/bin/env bash
# restart.sh — restart เฉพาะตัวที่ต้อง ไม่ต้องรัน start.sh ใหม่ทั้งชุด (ไม่แตะ setup/ngrok/CA)
#
#   ./restart.sh            # ทั้ง server + mitmproxy (ค่าเริ่มต้น)
#   ./restart.sh server     # เฉพาะ ApiTester server :3000 (เช่นแก้โค้ด server.js / mirror.js)
#   ./restart.sh mitm       # เฉพาะ mitmproxy :8888 (เช่นแก้ mitm-to-apitester.py — addon ไม่ hot-reload)
#   ./restart.sh --keep-devices   # ไม่ต้องตั้ง proxy ให้เครื่องที่ต่ออยู่ใหม่
#
# ⚠️ restart server = flow ที่บันทึกไว้หายทั้งหมด (เก็บใน memory ไม่ลงดิสก์)
#    ถ้ายังอยากดูของเดิม เปิดเว็บแล้วก็อป/เซฟไว้ก่อน
#
# ตั้งใจ kill ด้วย "PID จากพอร์ต" ไม่ใช่ pkill — กันไปฆ่า node/python ตัวอื่นของเจ้าของเครื่อง
set -u
cd "$(dirname "$0")" || exit 1
ADDON="$(pwd)/mitm-to-apitester.py"

WHAT=all
KEEP_DEVICES=no
for arg in "$@"; do
  case "$arg" in
    all|server|mitm) WHAT="$arg" ;;
    --keep-devices) KEEP_DEVICES=yes ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "ไม่รู้จักออปชัน: $arg (ใช้: all | server | mitm | --keep-devices)"; exit 1 ;;
  esac
done

pid_on_port() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1; }

stop_port() { # stop_port <port> <ชื่อ> <คำที่ต้องอยู่ในชื่อ process>
  local pid; pid=$(pid_on_port "$1")
  if [ -z "$pid" ]; then echo "   – $2 ไม่ได้รันอยู่"; return 0; fi
  # เช็คก่อนว่าเป็นของเราจริง — พอร์ตเดียวกัน Docker (docker-proxy) ก็ bind ได้
  # native bind IPv4 / Docker bind IPv6 ซ้อนกันได้เงียบๆ ถ้าฆ่ามั่วจะไปดับ container ของคนอื่น
  local comm; comm=$(ps -o comm= -p "$pid" 2>/dev/null)
  if [ -z "$comm" ]; then echo "   – $2 หลุดไปเองแล้ว (pid $pid ไม่มีอยู่)"; return 0; fi
  case "$comm" in
    *"$3"*) : ;;
    *) echo "   ⚠️ พอร์ต $1 ถูกใช้โดย '$comm' (pid $pid) ไม่ใช่ $3 — ไม่แตะ"
       echo "      ถ้าเป็น container: docker compose stop"
       return 1 ;;
  esac
  echo "   ⏹ ปิด $2 (pid $pid)"
  kill "$pid" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    [ -z "$(pid_on_port "$1")" ] && return 0
  done
  echo "   ⚠️ $2 ไม่ยอมปิด — ส่ง SIGKILL"
  kill -9 "$pid" 2>/dev/null
  sleep 1
}

wait_port() { # wait_port <port> [วินาที]
  local n=${2:-25}
  for _ in $(seq 1 "$n"); do
    [ -n "$(pid_on_port "$1")" ] && return 0
    sleep 1
  done
  return 1
}

echo "==> restart: $WHAT"

# ---- ปิด ----
if [ "$WHAT" = all ] || [ "$WHAT" = server ]; then stop_port 3000 "ApiTester server" node; fi
if [ "$WHAT" = all ] || [ "$WHAT" = mitm ]; then stop_port 8888 "mitmproxy" mitmdump; fi

# ---- เปิด ----
if [ "$WHAT" = all ] || [ "$WHAT" = server ]; then
  # ส่ง path เต็มของ mitmdump ให้ node (เหมือน start.sh) — venv มาก่อน PATH
  if [ -x "$(pwd)/.venv-mitm/bin/mitmdump" ]; then
    export MITMDUMP="$(pwd)/.venv-mitm/bin/mitmdump"
  else
    export MITMDUMP="$(command -v mitmdump)"
  fi
  echo "   ▶ ApiTester server :3000 (log: /tmp/apitester.log)"
  # -u NODE_OPTIONS: กัน preload module จาก env ภายนอกทำ node ล้ม
  env -u NODE_OPTIONS node server.js > /tmp/apitester.log 2>&1 &
fi

if [ "$WHAT" = all ] || [ "$WHAT" = mitm ]; then
  if [ -x "$(pwd)/.venv-mitm/bin/mitmdump" ]; then
    MITMDUMP="$(pwd)/.venv-mitm/bin/mitmdump"
  else
    MITMDUMP="$(command -v mitmdump)"
  fi
  echo "   ▶ mitmproxy :8888 + addon (log: /tmp/mitmdump.log)"
  PYTHONUNBUFFERED=1 "${MITMDUMP:-mitmdump}" --listen-host 0.0.0.0 --listen-port 8888 -s "$ADDON" \
    > /tmp/mitmdump.log 2>&1 &
fi

# ---- เช็คว่าขึ้นจริง ----
echo "==> สถานะ"
ok=yes
if [ "$WHAT" = all ] || [ "$WHAT" = server ]; then
  if wait_port 3000; then echo "   ✅ ApiTester : http://localhost:3000"
  else ok=no; echo "   ❌ ApiTester ไม่ขึ้น:"; tail -8 /tmp/apitester.log | sed 's/^/      /'; fi
fi
if [ "$WHAT" = all ] || [ "$WHAT" = mitm ]; then
  if wait_port 8888; then echo "   ✅ mitmproxy : พอร์ต 8888"
  else ok=no; echo "   ❌ mitmproxy ไม่ขึ้น:"; tail -10 /tmp/mitmdump.log | sed 's/^/      /'; fi
fi

# ตรวจว่า mitmproxy รับ connection ได้จริง ไม่ใช่แค่ LISTEN
# (เคยเจอ addon บล็อก event loop → ยัง LISTEN แต่ต่อเข้าไป timeout ทุกอัน)
if [ "$ok" = yes ] && { [ "$WHAT" = all ] || [ "$WHAT" = mitm ]; }; then
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -x http://127.0.0.1:8888 http://example.com/ 2>/dev/null)
  if [ "$code" = "000" ]; then
    echo "   ⚠️ mitmproxy ฟังอยู่แต่ยิงผ่านไม่ได้ (ค้าง?) — ดู /tmp/mitmdump.log"
  else
    echo "   ✅ ยิงผ่าน proxy ได้จริง (example.com → HTTP $code)"
  fi
fi

# ---- ตั้ง proxy ให้เครื่องที่ต่ออยู่ใหม่ (server เพิ่งเกิดใหม่ = ไม่รู้จักใครเลย) ----
if [ "$KEEP_DEVICES" = no ] && { [ "$WHAT" = all ] || [ "$WHAT" = server ]; } && command -v adb >/dev/null 2>&1; then
  echo "==> ตั้ง proxy ให้เครื่องที่เสียบอยู่"
  adb devices | awk 'NR>1 && $2=="device" {print $1}' | while read -r s; do
    [ -z "$s" ] && continue
    r=$(curl -s -m 30 -X POST http://127.0.0.1:3000/api/devices/connect \
      -H 'Content-Type: application/json' -d "{\"serial\":\"$s\"}")
    case "$r" in
      *'"ok":true'*) echo "   ✅ $s" ;;
      *) echo "   ⚠️ $s — $(printf '%s' "$r" | head -c 160)" ;;
    esac
  done
fi

echo ""
echo "เสร็จ · flow ที่บันทึกไว้ก่อน restart หายไปแล้ว (เก็บใน memory) · รีเฟรชหน้าเว็บด้วย"
