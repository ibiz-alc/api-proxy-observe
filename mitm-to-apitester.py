"""
mitmproxy addon สำหรับ ApiTester
- response: ส่ง flow ที่ถอดรหัสแล้วเข้า ApiTester (แท็บ Proxy)
- request : บังคับใช้กฎ Map Local (ดึงจาก ApiTester) → ตอบ response ปลอมโดยไม่ยิงเซิร์ฟเวอร์จริง
รัน: mitmdump --listen-host 0.0.0.0 --listen-port 8888 -s mitm-to-apitester.py
"""
import json
import time
import urllib.request
from mitmproxy import http

APITESTER = "http://127.0.0.1:3000"
INGEST = APITESTER + "/api/proxy/ingest"
RULES_URL = APITESTER + "/api/maplocal"
MAX_BODY = 200 * 1024
RULES_TTL = 3.0  # cache กฎ Map Local กี่วินาที

_rules = []
_rules_at = 0.0


def _get_rules():
    global _rules, _rules_at
    now = time.time()
    if now - _rules_at < RULES_TTL:
        return _rules
    _rules_at = now
    try:
        with urllib.request.urlopen(RULES_URL, timeout=2) as r:
            _rules = json.loads(r.read().decode("utf-8"))
    except Exception:
        pass
    return _rules


def _pattern_matches(pattern, url):
    if not pattern:
        return False
    if "*" in pattern:
        import re
        parts = [re.escape(p) for p in pattern.split("*")]
        return re.search(".*".join(parts), url) is not None
    return pattern in url


def _find_rule(method, url):
    matched = [
        r for r in _get_rules()
        if r.get("enabled", True)
        and (not r.get("method") or r["method"] == "ANY" or r["method"] == method)
        and _pattern_matches(r.get("urlPattern", ""), url)
    ]
    if not matched:
        return None
    # เจาะจง (ไม่มี *) มาก่อน แล้ว pattern ยาวกว่าชนะ
    matched.sort(key=lambda r: ("*" in r.get("urlPattern", ""), -len(r.get("urlPattern", ""))))
    return matched[0]


def request(flow: http.HTTPFlow):
    rule = _find_rule(flow.request.method, flow.request.pretty_url)
    if rule:
        body = rule.get("body") or ""
        ct = rule.get("contentType") or "application/json"
        flow.response = http.Response.make(
            int(rule.get("status") or 200),
            body.encode("utf-8"),
            {"Content-Type": ct, "X-Api-Tester": "map-local", "Access-Control-Allow-Origin": "*"},
        )


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
    mapped = res.headers.get("x-api-tester") == "map-local"
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
        "mapped": mapped,
        "durationMs": int((res.timestamp_end - req.timestamp_start) * 1000)
        if res.timestamp_end and req.timestamp_start else None,
    }
    try:
        data = json.dumps(payload).encode("utf-8")
        r = urllib.request.Request(INGEST, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(r, timeout=3).read()
    except Exception as e:
        print(f"[apitester] ingest failed: {e}")
