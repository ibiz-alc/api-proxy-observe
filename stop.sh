#!/bin/bash
# ปิดระบบทั้งหมด — ทั้ง native และ Docker
cd "$(dirname "$0")" || exit 1
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
