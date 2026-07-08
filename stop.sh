#!/bin/bash
# ปิดระบบทั้งหมด
echo "==> ปิด ApiTester + mitmproxy + ngrok"
pkill -f "node server.js" 2>/dev/null && echo "   ปิด ApiTester" || echo "   (ApiTester ไม่ได้รัน)"
pkill -f "mitmdump" 2>/dev/null && echo "   ปิด mitmproxy" || echo "   (mitmproxy ไม่ได้รัน)"
pkill -f "ngrok" 2>/dev/null && echo "   ปิด ngrok" || echo "   (ngrok ไม่ได้รัน)"
echo "เสร็จ — ปิดหมดแล้ว"
