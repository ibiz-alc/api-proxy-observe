// พร็อกซีส่งต่อเฉย ๆ สำหรับ "แชร์เน็ตจาก Mac ให้มือถือ" — ไม่ถอดรหัส ไม่บันทึก ไม่ต้องติดตั้ง CA
//
// ทำไมต้องมีตัวนี้ทั้งที่ mitmproxy (:8888) ก็ให้เน็ตได้: Android มี global http_proxy ได้ค่าเดียว
// ถ้าใช้ตัวเดียวกัน "หยุดแชร์เน็ต" กับ "ตัด proxy ที่บันทึก traffic" จะกลายเป็นปุ่มเดียวกันโดยปริยาย
// แยกพอร์ตแล้วสองปุ่มเป็นอิสระ: ปิด capture → สลับมาใช้ตัวนี้ เน็ตบนมือถือไม่ดับ
//
// ผูกที่ 127.0.0.1 เท่านั้น — มือถือเข้าถึงผ่าน adb reverse (สาย USB) ไม่ได้เปิดโล่งทั้งวง LAN
const http = require('http');
const net = require('net');

function createShareProxy() {
  // HTTP ธรรมดา: request-URI เป็น absolute-form (GET http://host/path) ตามสเปคของ proxy
  const server = http.createServer((req, res) => {
    let target;
    try { target = new URL(req.url); } catch { res.writeHead(400); return res.end('bad request-URI'); }
    if (target.protocol !== 'http:') { res.writeHead(400); return res.end('unsupported scheme'); }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const up = http.request({
      host: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: (target.pathname || '/') + (target.search || ''),
      headers,
    }, (upRes) => {
      try { res.writeHead(upRes.statusCode || 502, upRes.headers); }
      catch { res.writeHead(502); return res.end('bad upstream headers'); }
      upRes.pipe(res);
    });
    // ทุก stream ต้องมี error listener — ไม่งั้น ECONNRESET เดียวจะล้ม process ทั้งตัว
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('แชร์เน็ต: ต่อปลายทางไม่ได้ — ' + e.message);
    });
    res.on('error', () => up.destroy());
    req.on('error', () => up.destroy());
    req.pipe(up);
  });

  // HTTPS ผ่าน CONNECT: เปิดท่อ TCP ตรง ๆ ไม่ยุ่งกับ TLS
  // → แอปที่ทำ certificate pinning หรือเครื่องที่ไม่ได้ติดตั้ง CA ก็ใช้เน็ตได้ (ต่างจากทาง mitmproxy)
  server.on('connect', (req, socket, head) => {
    const i = req.url.lastIndexOf(':'); // IPv6 literal มี ':' หลายตัว — เอาตัวท้ายสุดเป็นพอร์ต
    const host = i > 0 ? req.url.slice(0, i) : req.url;
    const port = Number(i > 0 ? req.url.slice(i + 1) : '') || 443;
    const up = net.connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const kill = () => { up.destroy(); socket.destroy(); };
    up.on('error', kill);
    socket.on('error', kill);
  });

  server.on('clientError', (err, socket) => { try { socket.destroy(); } catch { /* ปิดไปแล้ว */ } });
  return server;
}

module.exports = { createShareProxy };
