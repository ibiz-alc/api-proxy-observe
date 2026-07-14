# คู่มือเชื่อมต่อแบบ Manual (ไม่ผ่านปุ่มในเว็บ)

ใช้เมื่อต้องการตั้งค่าเองด้วยคำสั่ง/บนมือถือโดยตรง — ครอบคลุม USB และ Wi-Fi
ทั้งขั้นตอน **เปิดใช้งาน** และ **ปิดใช้งาน**

พอร์ตที่เกี่ยวข้อง: เว็บ `3000` · mitmproxy `8888` · MCP `7333`

---

## 0) เตรียมฝั่ง Mac (ทำก่อนทุกโหมด)

```bash
cd ~/Documents/Project/ApiTester
./start.sh                 # เปิด web + mitmproxy (ทำ adb reverse ให้ด้วยถ้ามีเครื่องเสียบ USB)
./stop.sh                  # ปิดทั้งหมด
```

ตรวจว่าพร้อม:

```bash
curl -s localhost:3000/api/status | python3 -m json.tool   # ทุก service ต้อง up:true
lsof -nP -iTCP:8888 -sTCP:LISTEN                            # ต้องเห็น mitmdump
```

> ⚠️ **mute ค้าง** — ถ้าเคยกด disconnect ในเว็บมาก่อน server จะ mute (ทิ้งทุก flow เงียบๆ)
> การเชื่อมต่อแบบ manual ไม่ได้ปลด mute ให้ ต้องปลดเอง:
>
> ```bash
> curl -s -X POST -H 'Content-Type: application/json' \
>   -d '{"muted":false}' localhost:3000/api/proxy/mute
> ```
>
> เช็คสถานะ mute ได้จาก `curl -s localhost:3000/api/status` (ฟิลด์ `muted`)

---

## 1) Android ผ่าน USB

### เปิดใช้งาน

```bash
# 1. เสียบสาย + เปิด USB debugging แล้วเช็คว่าเห็นเครื่อง
adb devices

# 2. เปิดอุโมงค์ให้พอร์ต 8888 ของมือถือชี้กลับมาที่ Mac
adb reverse tcp:8888 tcp:8888

# 3. ตั้ง global proxy บนมือถือ
adb shell settings put global http_proxy 127.0.0.1:8888

# 4. ปลด mute (ดูข้อ 0)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"muted":false}' localhost:3000/api/proxy/mute
```

ครั้งแรกต้องติดตั้ง CA ก่อน (ดูหัวข้อ CA ด้านล่าง)

### ปิดใช้งาน

```bash
adb shell settings put global http_proxy :0        # ล้างค่า proxy (สำคัญ: ใช้ :0 ไม่ใช่ null)
adb shell settings delete global http_proxy
adb reverse --remove tcp:8888                       # ถอนอุโมงค์
```

---

## 2) Android ผ่าน Wi-Fi

### เปิดใช้งาน

**เงื่อนไขบังคับ: มือถือต้องต่อ Wi-Fi วงเดียวกับ Mac** (ห้ามอยู่ 4G/5G)
เช็คจาก Mac ได้ถ้ายังเสียบสายอยู่:

```bash
adb shell dumpsys connectivity | grep "Active default network" -A1
# ต้องเห็น WIFI ไม่ใช่ MOBILE[LTE]
```

```bash
# 1. หา LAN IP ของ Mac
ipconfig getifaddr en0          # เช่น 192.168.101.24

# 2. ตั้ง proxy บนมือถือ — เลือกวิธีใดวิธีหนึ่ง

# วิธี A: ผ่าน adb (ต้องเสียบสายตอนสั่ง จากนั้นถอดสายได้)
adb shell settings put global http_proxy <MAC_IP>:8888

# วิธี B: ตั้งบนมือถือเอง (ไม่ต้องใช้สายเลย)
#   Settings → Wi-Fi → แตะวงที่ต่ออยู่ → แก้ไข/Advanced →
#   Proxy = Manual → Hostname = <MAC_IP>, Port = 8888

# 3. ปลด mute (ดูข้อ 0)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"muted":false}' localhost:3000/api/proxy/mute
```

### ปิดใช้งาน

```bash
# ถ้าตั้งด้วยวิธี A:
adb shell settings put global http_proxy :0
adb shell settings delete global http_proxy

# ถ้าตั้งด้วยวิธี B: Settings → Wi-Fi → แตะวง → Proxy = None
```

---

## 3) iOS ผ่าน Wi-Fi (โหมดเดียวที่ iOS ใช้ได้)

### เปิดใช้งาน

1. ต่อ iPhone เข้า Wi-Fi วงเดียวกับ Mac
2. Settings → Wi-Fi → (i) ข้างชื่อวง → Configure Proxy → **Manual** →
   Server = `<MAC_IP>`, Port = `8888`
3. ครั้งแรก: เปิด Safari ไป **http://mitm.it** → ติดตั้ง cert iOS →
   Settings → General → VPN & Device Management → install profile →
   Settings → General → About → **Certificate Trust Settings** → เปิดใช้ mitmproxy
   (ข้ามขั้นนี้ = HTTPS พังทุกเส้น)
4. ปลด mute (ดูข้อ 0)

### ปิดใช้งาน

- Settings → Wi-Fi → (i) → Configure Proxy → **Off**
- (ถ้าเลิกใช้ถาวร) ลบ profile ใน VPN & Device Management

---

## 4) ติดตั้ง CA บน Android (ครั้งแรกครั้งเดียวต่อ Mac)

```bash
# ดาวน์โหลด cert แล้วดันเข้าเครื่อง
curl -s -o /tmp/mitmproxy-ca-cert.pem localhost:3000/api/devices/ca
adb push /tmp/mitmproxy-ca-cert.pem /sdcard/Download/

# บนมือถือ: Settings → Security → More/Encryption & credentials →
# Install a certificate → CA certificate → เลือกไฟล์จาก Download
```

หรือระหว่างที่ proxy ทำงานแล้ว เปิดเบราว์เซอร์ไป `http://mitm.it` แล้วโหลดจากที่นั่นก็ได้

> CA ผูกกับเครื่อง Mac (`~/.mitmproxy/`) — เปลี่ยน Mac = ต้องติดตั้ง CA ใหม่
> (หรือ copy โฟลเดอร์ `~/.mitmproxy/` ข้ามเครื่องเพื่อใช้ CA เดิม)

---

## 5) ตรวจว่าใช้งานได้จริง

```bash
# ยิงทดสอบจาก Mac ผ่าน proxy — ต้องได้ 200
curl -s -o /dev/null -w '%{http_code}\n' -x <MAC_IP>:8888 -k https://example.com/

# แล้วเช็คว่า flow ถูกบันทึก (ground truth คือ count นี้ ไม่ใช่ log)
curl -s localhost:3000/api/status | python3 -m json.tool | grep -A2 flows
```

จากนั้นเปิดแอปบนมือถือ → traffic ต้องโผล่ในแท็บ Proxy ที่ http://localhost:3000

---

## 6) ใช้ไม่ได้ — ไล่เช็คตามนี้

| อาการ | เช็ค / แก้ |
|---|---|
| Wi-Fi ใช้ไม่ได้เลย | มือถืออยู่ 4G ไม่ใช่ Wi-Fi? `adb shell dumpsys connectivity \| grep Active` — ต้องเป็น WIFI วงเดียวกับ Mac |
| ต่อ Wi-Fi วงเดียวกันแล้วยังไม่ถึง | ทดสอบ `adb shell "echo \| toybox nc -w 3 <MAC_IP> 8888"` — ถ้า timeout ทั้งที่วงเดียวกัน = Wi-Fi ออฟฟิศเปิด client isolation (AP บล็อกเครื่องคุยกัน) → ใช้ USB แทน หรือใช้ Hotspot |
| ต่อได้แต่ flows = 0 | mute ค้าง → ปลดตามข้อ 0 · หรือ mitmdump ไม่ได้รัน → `lsof -nP -iTCP:8888 -sTCP:LISTEN` |
| HTTPS ขึ้น cert error ทุกเส้น | ยังไม่ติดตั้ง/trust CA (iOS อย่าลืม Certificate Trust Settings) |
| USB เคยได้ อยู่ๆ ไม่ได้ | `adb reverse --list` ว่าง? ถอด-เสียบสายทำให้ reverse หลุด → สั่ง `adb reverse tcp:8888 tcp:8888` ใหม่ |
| แอปเมิน system proxy | ใช้โหมด Proxy Postern จากเว็บ หรือแอปนั้น pin cert (แก้ฝั่งเราไม่ได้) |
