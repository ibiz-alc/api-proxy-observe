#!/bin/bash
# รันครบ: backend (ApiTester+mitmproxy) → adb reverse → เปิดแอป Proxy Postern → กดเชื่อมต่อให้เอง
# ใช้: ./run-mobile.sh           → เปิดทุกอย่าง + เชื่อม VPN
#      ./run-mobile.sh --claim   → เปิด ClaimOn ต่อด้วย
cd "$(dirname "$0")" || exit 1
PKG=com.thaivivat.proxy.postern

# 1) backend + mitmproxy + adb reverse (โหมด USB)
./start.sh

# 2) เช็ค device
if ! adb get-state 1>/dev/null 2>&1; then
  echo "❌ ไม่พบ device (เสียบ USB + เปิด USB debugging)"; exit 1
fi

# 3) เปิดแอป Proxy Postern
echo ""
echo "==> เปิดแอป Proxy Postern"
adb shell am force-stop "$PKG" >/dev/null 2>&1; sleep 1
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 3

# 4) หาปุ่ม "เชื่อมต่อ" แล้วกด (พิกัดจริงจาก UI — ไม่ hardcode)
adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1
COORD=$(adb shell cat /sdcard/u.xml 2>/dev/null | python3 -c '
import sys,re
x=sys.stdin.read()
for m in re.finditer(r"text=\"([^\"]*)\"[^>]*class=\"android.widget.TextView\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", x):
    if m.group(1).strip()=="เชื่อมต่อ":
        print((int(m.group(2))+int(m.group(4)))//2, (int(m.group(3))+int(m.group(5)))//2); break
')
if [ -n "$COORD" ]; then
  echo "==> กดปุ่มเชื่อมต่อที่ ($COORD)"
  adb shell input tap $COORD
  sleep 5
else
  echo "⚠️ หาปุ่มเชื่อมต่อไม่เจอ (อาจเชื่อมอยู่แล้ว หรือ layout เปลี่ยน) — กดเองในแอป"
fi

# 5) ยืนยัน VPN
if adb shell "ip -br addr 2>/dev/null | grep -q tun0"; then
  echo "✅ VPN เชื่อมต่อแล้ว (มือถือ → mitmproxy 8888)"
else
  echo "⚠️ VPN ยังไม่ขึ้น — เปิดแอปแล้วกดเชื่อมต่อเอง"
fi

# 6) (ทางเลือก) เปิด ClaimOn
if [ "$1" = "--claim" ]; then
  echo "==> เปิด ClaimOn"
  adb shell monkey -p com.thaivivat.claimonapp.develop -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi

echo ""
echo "เสร็จ! ดูทราฟฟิกที่ http://localhost:3000 → แท็บ Proxy"
