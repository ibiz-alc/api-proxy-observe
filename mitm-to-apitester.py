"""
mitmproxy addon สำหรับ ApiTester
- response: ส่ง flow ที่ถอดรหัสแล้วเข้า ApiTester (แท็บ Proxy)
- request : บังคับใช้กฎ Map Local (ดึงจาก ApiTester) → ตอบ response ปลอมโดยไม่ยิงเซิร์ฟเวอร์จริง
รัน: mitmdump --listen-host 0.0.0.0 --listen-port 8888 -s mitm-to-apitester.py
"""
import base64
import json
import os
import re
import time
import urllib.request
from mitmproxy import http

# env APITESTER_URL override ได้ (เช่นตอนแยก container) — default = เครื่องเดียวกัน
APITESTER = os.environ.get("APITESTER_URL", "http://127.0.0.1:3000").rstrip("/")
INGEST = APITESTER + "/api/proxy/ingest"
RULES_URL = APITESTER + "/api/maplocal"
TC_PATTERNS_URL = APITESTER + "/api/testcase/patterns"
TC_RESOLVE_URL = APITESTER + "/api/testcase/resolve"
MAX_BODY = 200 * 1024
MAX_MULTIPART = 20 * 1024 * 1024  # ส่ง raw body ของ multipart สูงสุด 20MB (ไว้ preview parts/รูป + repeat ยิงซ้ำแบบ byte-exact)
MAX_IMAGE = 12 * 1024 * 1024   # ส่ง image สูงสุด 12MB (ไว้โชว์รูป + EXIF) — รูปจากมือถือมักหลายMB
MAX_VIDEO = 25 * 1024 * 1024   # ส่ง video สูงสุด 25MB (ไว้ preview) — ใหญ่กว่านี้แค่ติด tag
MAX_PDF = 25 * 1024 * 1024     # ส่ง pdf สูงสุด 25MB (ไว้ preview)
RULES_TTL = 3.0  # cache กฎ Map Local กี่วินาที


_IMG_EXT = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif", ".svg")
_VID_EXT = (".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi")
_PDF_EXT = (".pdf",)


def _sniff_image_mime(content):
    """ดู magic bytes — ครอบคลุมกรณี S3/ที่เก็บไฟล์ตอบ content-type เป็น octet-stream"""
    if not content or len(content) < 12:
        return None
    h = content[:12]
    if h[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if h[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if h[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if h[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if h[:2] == b"BM":
        return "image/bmp"
    if h[4:8] == b"ftyp" and content[8:12] in (b"heic", b"heix", b"mif1", b"hevc", b"msf1"):
        return "image/heic"
    return None


def _sniff_video_mime(content):
    """ดู magic bytes ของวิดีโอ — กันกรณี S3 ตอบ content-type เป็น octet-stream"""
    if not content or len(content) < 12:
        return None
    h = content[:12]
    if h[:4] == b"\x1aE\xdf\xa3":              # EBML → webm/mkv
        return "video/webm"
    if h[4:8] == b"ftyp":                       # ISO base media → mp4/mov
        return "video/quicktime" if h[8:12] == b"qt  " else "video/mp4"
    if h[:4] == b"RIFF" and content[8:12] == b"AVI ":
        return "video/x-msvideo"
    return None


def _media(content, headers, url=""):
    """คืน (base64|None, mime, kind, too_big) — kind ∈ 'image' | 'video' | None
    ตัดสินจาก magic bytes / content-type / นามสกุลใน URL (ไม่พึ่ง content-type อย่างเดียว
    เพราะ S3 มักตอบ .jpg/.mp4 เป็น binary/octet-stream). ถ้าใหญ่เกิน cap → คืน bytes=None แต่ยังบอก kind"""
    if not content:
        return None, None, None, False
    ct = headers.get("content-type", "").lower().split(";")[0].strip()
    path = url.split("?")[0].lower()

    img = _sniff_image_mime(content)
    if ct.startswith("image/") or img is not None or path.endswith(_IMG_EXT):
        mime = img or (ct if ct.startswith("image/") else "image/jpeg")
        if len(content) <= MAX_IMAGE:
            return base64.b64encode(content).decode("ascii"), mime, "image", False
        return None, mime, "image", True

    vid = _sniff_video_mime(content)
    if ct.startswith("video/") or vid is not None or path.endswith(_VID_EXT):
        mime = vid or (ct if ct.startswith("video/") else "video/mp4")
        if len(content) <= MAX_VIDEO:
            return base64.b64encode(content).decode("ascii"), mime, "video", False
        return None, mime, "video", True

    is_pdf = content[:5] == b"%PDF-"
    if ct == "application/pdf" or is_pdf or path.endswith(_PDF_EXT):
        if len(content) <= MAX_PDF:
            return base64.b64encode(content).decode("ascii"), "application/pdf", "pdf", False
        return None, "application/pdf", "pdf", True

    return None, None, None, False

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


_tc_patterns = []
_tc_at = 0.0


def _get_case_patterns():
    """รายการ pattern ของ test case ที่ active (cache สั้นๆ) — ไว้ตัดสินใจว่าจะถาม resolve ไหม"""
    global _tc_patterns, _tc_at
    now = time.time()
    if now - _tc_at < RULES_TTL:
        return _tc_patterns
    _tc_at = now
    try:
        with urllib.request.urlopen(TC_PATTERNS_URL, timeout=2) as r:
            data = json.loads(r.read().decode("utf-8"))
        _tc_patterns = data.get("patterns", []) if data.get("active") else []
    except Exception:
        pass
    return _tc_patterns


def _resolve_case(method, url):
    """ถาม server ว่ามี response ของ test case สำหรับ request นี้ไหม (server คุม cursor/advance เอง)"""
    try:
        payload = json.dumps({"method": method, "url": url}).encode("utf-8")
        req = urllib.request.Request(TC_RESOLVE_URL, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=2) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return {"matched": False}


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


# ===== override เฉพาะบาง key ใน JSON body: [{path,value,enabled}] =====
def _parse_path(path):
    """a.b[0].c -> ['a','b',0,'c']"""
    segs = []
    for part in str(path).split("."):
        m = re.match(r"^([^\[]*)((?:\[\d+\])*)$", part)
        if not m:
            continue
        if m.group(1):
            segs.append(m.group(1))
        for idx in re.findall(r"\d+", m.group(2)):
            segs.append(int(idx))
    return segs


def _apply_overrides(body_str, overrides):
    """ทับเฉพาะ key ที่ระบุลงบน JSON body (value ลอง parse JSON ก่อน ไม่ได้ = string). body ไม่ใช่ JSON คืนเดิม"""
    if not overrides:
        return body_str
    try:
        obj = json.loads(body_str)
    except Exception:
        return body_str
    for ov in overrides:
        if not ov or ov.get("enabled") is False or not ov.get("path"):
            continue
        raw = ov.get("value", "")
        try:
            val = json.loads(raw)
        except Exception:
            val = raw
        segs = _parse_path(ov["path"])
        if not segs:
            continue
        cur, ok = obj, True
        for i in range(len(segs) - 1):
            seg, nxt = segs[i], segs[i + 1]
            if not isinstance(cur, (dict, list)):
                ok = False
                break
            try:
                # สร้าง path ที่ยังไม่มี: segment ถัดไปเป็นตัวเลข → list, ไม่งั้น → dict
                if isinstance(cur, list):
                    while len(cur) <= seg:
                        cur.append(None)
                    if not isinstance(cur[seg], (dict, list)):
                        cur[seg] = [] if isinstance(nxt, int) else {}
                else:
                    if not isinstance(cur.get(seg), (dict, list)):
                        cur[seg] = [] if isinstance(nxt, int) else {}
                cur = cur[seg]
            except Exception:
                ok = False
                break
        if ok and isinstance(cur, (dict, list)):
            try:
                last = segs[-1]
                if isinstance(cur, list) and isinstance(last, int):
                    while len(cur) <= last:
                        cur.append(None)
                cur[last] = val
            except Exception:
                pass
    try:
        return json.dumps(obj, ensure_ascii=False)
    except Exception:
        return body_str


def request(flow: http.HTTPFlow):
    method = flow.request.method
    url = flow.request.pretty_url
    # 1) Map Local มาก่อน (priority สูงสุด) — ถ้าชนกับ Test Case ให้ Map Local ชนะ
    #    อยาก override ด้วย test case ที่ชน ต้อง disabled กฎ Map Local ตัวนั้นก่อน (_find_rule กรอง enabled อยู่แล้ว)
    rule = _find_rule(method, url)
    if rule:
        # passthrough: ปล่อย request ไป server จริง แล้วไปแก้เฉพาะ key ใน response() ทีหลัง
        if rule.get("mode") == "passthrough":
            return
        # mock: ตอบ body ที่เก็บไว้ตรงๆ (override เป็นของโหมด passthrough เท่านั้น)
        flow.metadata["apitester_ml"] = {"ruleId": rule.get("id"), "name": rule.get("name"), "mode": "mock"}
        body = rule.get("body") or ""
        ct = rule.get("contentType") or "application/json"
        flow.response = http.Response.make(
            int(rule.get("status") or 200),
            body.encode("utf-8"),
            {"Content-Type": ct, "X-Api-Tester": "map-local", "Access-Control-Allow-Origin": "*"},
        )
        return
    # 2) Test Case (dynamic/sequenced) — เฉพาะเมื่อไม่มี Map Local ชน
    pats = _get_case_patterns()
    if any(
        (not p.get("method") or p["method"] == "ANY" or p["method"] == method)
        and _pattern_matches(p.get("urlPattern", ""), url)
        for p in pats
    ):
        r = _resolve_case(method, url)
        if r.get("matched"):
            # เก็บว่าใช้ test case ไหน step ไหน ไว้ใน metadata (ส่งต่อให้ ingest — เลี่ยง header เพราะชื่อเคสอาจเป็นภาษาไทย)
            flow.metadata["apitester_tc"] = {
                "caseId": r.get("caseId"), "caseName": r.get("caseName"),
                "step": r.get("step"), "label": r.get("label"), "pattern": r.get("pattern"),
            }
            if r.get("mode") == "passthrough":
                # ปล่อยไป server จริง แล้วไป override เฉพาะ key ใน response()
                flow.metadata["apitester_tc_ov"] = r.get("overrides") or []
                return
            flow.response = http.Response.make(
                int(r.get("status") or 200),
                (r.get("body") or "").encode("utf-8"),
                {"Content-Type": r.get("contentType") or "application/json", "X-Api-Tester": "test-case", "Access-Control-Allow-Origin": "*"},
            )
            return


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
    # Passthrough override: response จริง (ยังไม่ถูก mock) + rule เป็น passthrough → แก้เฉพาะ key ก่อนส่งกลับ/บันทึก
    if res is not None and res.headers.get("x-api-tester") is None:
        prule = _find_rule(req.method, req.pretty_url)
        if prule and prule.get("mode") == "passthrough":
            flow.metadata["apitester_ml"] = {"ruleId": prule.get("id"), "name": prule.get("name"), "mode": "passthrough"}
            res.headers["X-Api-Tester"] = "map-local-passthrough"
            if prule.get("overrides"):
                try:
                    res.set_text(_apply_overrides(res.get_text(), prule["overrides"]))
                except Exception as e:
                    print(f"[apitester] passthrough override failed: {e}")
    # Test Case passthrough → override เฉพาะ key ใน response จริง
    tc_ov = flow.metadata.get("apitester_tc_ov")
    if tc_ov is not None and res is not None:
        try:
            res.set_text(_apply_overrides(res.get_text(), tc_ov))
            res.headers["X-Api-Tester"] = "test-case-passthrough"
        except Exception as e:
            print(f"[apitester] test-case passthrough override failed: {e}")
    client = flow.client_conn.peername[0] if flow.client_conn and flow.client_conn.peername else "mitmproxy"
    mapped = res.headers.get("x-api-tester") in ("map-local", "map-local-passthrough")
    payload = {
        "scheme": req.scheme,
        "device": client,
        "userAgent": req.headers.get("user-agent"),
        "method": req.method,
        # pretty_host = domain จาก Host header/SNI (แทน req.host ที่บางทีได้เป็น IP)
        "host": req.pretty_host,
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
        "mapLocal": flow.metadata.get("apitester_ml"),  # ใช้ Map Local rule ไหน (ถ้ามี)
        "testCase": flow.metadata.get("apitester_tc"),  # ใช้ test case ไหน/step ไหน (ถ้ามี)
        "durationMs": int((res.timestamp_end - req.timestamp_start) * 1000)
        if res.timestamp_end and req.timestamp_start else None,
    }
    # raw body ของ multipart — ส่ง base64 ไว้ให้ server แกะ parts/preview รูป + ยิงซ้ำ (repeat) แบบ byte-exact
    # (multipart มี binary ของไฟล์ ถ้าเก็บเป็น string จะพัง → "Multipart: Unexpected end of form")
    req_ct = (req.headers.get("content-type", "") or "").lower()
    if "multipart/form-data" in req_ct and req.content and len(req.content) <= MAX_MULTIPART:
        payload["reqBodyB64"] = base64.b64encode(req.content).decode("ascii")
    rq_b64, rq_mime, rq_kind, rq_big = _media(req.content, req.headers, req.pretty_url)
    rs_b64, rs_mime, rs_kind, rs_big = _media(res.content, res.headers, req.pretty_url)
    payload["reqMediaB64"] = rq_b64
    payload["reqMediaType"] = rq_mime
    payload["reqMediaKind"] = rq_kind
    payload["reqMediaTooBig"] = rq_big
    payload["resMediaB64"] = rs_b64
    payload["resMediaType"] = rs_mime
    payload["resMediaKind"] = rs_kind
    payload["resMediaTooBig"] = rs_big
    try:
        data = json.dumps(payload).encode("utf-8")
        r = urllib.request.Request(INGEST, data=data, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(r, timeout=3).read()
    except Exception as e:
        print(f"[apitester] ingest failed: {e}")
