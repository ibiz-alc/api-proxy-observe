#!/bin/sh
# สตาร์ท 3 process ใน container เดียว: mitmproxy (8888) + MCP (7333) + ApiTester web (3000)
# web รันเป็น foreground (PID 1) — ปิด container = ปิดทั้งชุด
set -e
cd /app

echo "==> mitmproxy (พอร์ต 8888)"
# start_mitmdump() + host ที่ปล่อยผ่านไม่ดัก TLS (ดักแล้ว GMS/FCM พัง — ดูคอมเมนต์ใน mitm-bypass.sh)
. /app/mitm-bypass.sh
start_mitmdump /app/mitm-to-apitester.py

echo "==> MCP server (พอร์ต ${MCP_PORT})"
MCP_PORT="$MCP_PORT" node /app/mcp/index.js > /tmp/apitester-mcp.log 2>&1 &

echo "==> ApiTester web (พอร์ต ${PORT})"
exec node /app/server.js
