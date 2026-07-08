"""
mitmproxy addon: ส่ง flow ที่ถอดรหัสแล้วเข้า ApiTester (แท็บ Proxy)
รัน: mitmdump --listen-host 0.0.0.0 --listen-port 8888 -s mitm-to-apitester.py
mitmproxy รองรับ HTTPS/HTTP2 เต็มรูปแบบ + สร้าง cert ตาม SNI ถูกต้อง
"""
import json
import urllib.request
from mitmproxy import http

APITESTER = "http://127.0.0.1:3000/api/proxy/ingest"
MAX_BODY = 200 * 1024


def _text(content, headers):
    if not content:
        return None
    ct = headers.get("content-type", "").lower()
    if any(t in ct for t in ("json", "text", "xml", "javascript", "urlencoded", "html", "csv")) or ct == "":
        try:
            s = content.decode("utf-8")
            return s[:MAX_BODY] + ("\n...(ตัด)" if len(s) > MAX_BODY else "")
        except UnicodeDecodeError:
            pass
    return f"(binary {len(content)} bytes{', ' + ct.split(';')[0] if ct else ''})"


def response(flow: http.HTTPFlow):
    req = flow.request
    res = flow.response
    client = flow.client_conn.peername[0] if flow.client_conn and flow.client_conn.peername else "mitmproxy"
    payload = {
        "scheme": req.scheme,
        "device": client,
        "userAgent": req.headers.get("user-agent"),
        "method": req.method,
        "host": req.host,
        "path": req.path,
        "url": req.pretty_url,
        "reqHeaders": dict(req.headers),
        "reqBody": _text(req.content, req.headers),
        "reqSize": len(req.content or b""),
        "status": res.status_code,
        "statusText": res.reason,
        "resHeaders": dict(res.headers),
        "resBody": _text(res.content, res.headers),
        "resContentType": res.headers.get("content-type"),
        "resSize": len(res.content or b""),
        "durationMs": int((flow.response.timestamp_end - flow.request.timestamp_start) * 1000)
        if flow.response.timestamp_end and flow.request.timestamp_start else None,
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        r = urllib.request.Request(APITESTER, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(r, timeout=3).read()
    except Exception as e:
        print(f"[apitester] ingest failed: {e}")
