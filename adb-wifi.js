// ================= ADB ผ่าน Wi-Fi (wireless debugging) — ส่วน logic ล้วน ไม่แตะ adb เอง =================
// แยกออกมาให้ unit-test ได้: แตก output ของ adb/ip, เลือก IP มือถือที่อยู่วงเดียวกับ Mac
const os = require('os');

// serial ของ transport แบบ Wi-Fi: "192.168.1.5:5555" (adb connect) หรือ
// "adb-<serial>-xxxx._adb-tls-connect._tcp" (Android 11+ ที่ adb ต่อให้เองผ่าน mDNS)
const isWifiSerial = (s) => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(s) || /\._adb-tls-connect\._tcp\.?$/.test(s);

// `adb devices -l` → [{ serial, state, model }] (state: device | offline | unauthorized | ...)
function parseAdbDevices(out) {
  const rows = [];
  for (const line of String(out).split('\n').slice(1)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|authorizing|connecting|no permissions)\b(.*)$/);
    if (!m) continue;
    rows.push({ serial: m[1], state: m[2], model: ((m[3].match(/model:(\S+)/) || [])[1] || '').replace(/_/g, ' ') });
  }
  return rows;
}

// interface ที่ใช้ทำ adb Wi-Fi ไม่ได้/ไม่ควร: มือถือ (rmnet/ccmni), VPN (tun), USB tethering (ตายตอนถอดสาย), loopback ฯลฯ
const SKIP_IFACE = /^(lo|rmnet|ccmni|v4-|clat|dummy|tun|ppp|usb|rndis|ncm|ifb|ip6tnl|sit|epdg|bt-pan)/;
// `ip -4 -o addr show` บนมือถือ → [{ iface, ip, prefix }] เฉพาะ interface ที่เป็น Wi-Fi/Hotspot
function parseDeviceIps(out) {
  const res = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/^\d+:\s+(\S+?)(?:@\S+)?\s+inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/);
    if (!m || SKIP_IFACE.test(m[1])) continue;
    res.push({ iface: m[1], ip: m[2], prefix: +m[3] });
  }
  return res;
}

const ipInt = (ip) => ip.split('.').reduce((a, o) => ((a << 8) | (+o & 255)) >>> 0, 0);
const maskOf = (prefix) => (prefix <= 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);
const prefixOfMask = (mask) => ipInt(mask).toString(2).replace(/0+$/, '').length;

// IPv4 ทุกวงของ Mac (Wi-Fi, LAN, bridge100 ตอนเปิด Internet Sharing, hotspot ของมือถือที่ Mac ไปเกาะ ฯลฯ)
function macNets(ifaces = os.networkInterfaces()) {
  const nets = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal || /^(utun|awdl|llw|lo)/.test(name)) continue;
      nets.push({ iface: name, ip: i.address, prefix: prefixOfMask(i.netmask || '255.255.255.0') });
    }
  }
  return nets;
}
// วงเดียวกัน = ใช้ prefix ที่แคบกว่าของสองฝั่ง (กันกรณีฝั่งหนึ่งประกาศ /16 อีกฝั่ง /24)
function sameNet(a, b) {
  const m = maskOf(Math.max(Math.min(a.prefix, b.prefix), 8));
  return (ipInt(a.ip) & m) === (ipInt(b.ip) & m);
}
// เลือก IP มือถือที่ Mac ยิงถึง → { ip, iface, macIp, macIface } หรือ null
function pickReachableIp(devIps, nets) {
  for (const d of devIps) {
    const n = nets.find((x) => sameNet(d, x));
    if (n) return { ip: d.ip, iface: d.iface, macIp: n.ip, macIface: n.iface };
  }
  return null;
}

// `adb mdns services` → [{ name, type: 'pairing'|'connect', host }]
function parseMdns(out) {
  const res = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/^(\S+)\s+_adb-tls-(pairing|connect)\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+:\d+)/);
    if (m) res.push({ name: m[1], type: m[2], host: m[3] });
  }
  return res;
}

// ผลของ `adb connect` / `adb pair` (exit 0 แม้พลาด → ต้องอ่านข้อความเอง)
const connectOk = (out) => /(connected to|already connected)/i.test(out) && !/(failed|unable|cannot|refused)/i.test(out);
const pairOk = (out) => /successfully paired/i.test(out);

module.exports = { isWifiSerial, parseAdbDevices, parseDeviceIps, macNets, sameNet, pickReachableIp, parseMdns, connectOk, pairOk };
