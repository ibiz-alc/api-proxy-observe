#!/bin/sh
# สตาร์ท 3 process ใน container เดียว: mitmproxy (8888) + MCP (7333) + ApiTester web (3000)
# web รันเป็น foreground (PID 1) — ปิด container = ปิดทั้งชุด
set -e
cd /app

echo "==> mitmproxy (พอร์ต 8888)"
PYTHONUNBUFFERED=1 "$MITMDUMP" --listen-host 0.0.0.0 --listen-port 8888 \
  -s /app/mitm-to-apitester.py > /tmp/mitmdump.log 2>&1 &

echo "==> MCP server (พอร์ต ${MCP_PORT})"
MCP_PORT="$MCP_PORT" node /app/mcp/index.js > /tmp/apitester-mcp.log 2>&1 &

echo "==> ApiTester web (พอร์ต ${PORT})"
exec node /app/server.js
