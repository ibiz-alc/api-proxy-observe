# ApiTester — Core scope (web + mitmproxy + MCP) ใน container เดียว
# ไม่รวม adb/USB (ใช้ใน container บน Docker Desktop macOS ไม่ได้) — เชื่อมมือถือแบบ manual proxy + manual CA
FROM node:20-slim

# mitmproxy (ให้ mitmdump) + curl (healthcheck) — ติดตั้งผ่าน pip
# --break-system-packages: Debian 12 (PEP 668) ต้องใช้กับ pip ระบบ
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip curl ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages mitmproxy \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# mitmdump จาก pip อยู่ /usr/local/bin — บอก server ตรงๆ กัน resolve พลาด
ENV MITMDUMP=/usr/local/bin/mitmdump \
    APITESTER_URL=http://127.0.0.1:3000 \
    PORT=3000 \
    MCP_PORT=7333 \
    MCP_HOST=0.0.0.0 \
    NODE_ENV=production

WORKDIR /app

# ติดตั้ง deps ก่อน (cache layer) — ทั้ง root และ MCP
COPY package*.json ./
RUN npm install --omit=dev
COPY mcp/package*.json ./mcp/
RUN npm --prefix mcp install --omit=dev

# copy โค้ดที่เหลือ
COPY . .

# 3000 = web/API, 8888 = mitmproxy, 7333 = MCP
EXPOSE 3000 8888 7333

# CA ของ mitmproxy เก็บที่ /root/.mitmproxy — mount volume เพื่อให้ CA คงเดิมข้าม restart
VOLUME ["/root/.mitmproxy"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD curl -fsS http://127.0.0.1:3000/api/status >/dev/null || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
