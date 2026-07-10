#!/usr/bin/env node
/**
 * ApiTester MCP server (stdio)
 * ให้ AI agent ใช้งาน ApiTester ได้: จัดการ mock local data (Map Local),
 * อ่าน traffic จริง (flows) + สร้าง mock จาก flow, จัดกลุ่ม mock เป็นชุด (scenario),
 * และควบคุม device/proxy — คุยกับ ApiTester ผ่าน HTTP (default http://127.0.0.1:3000)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.APITESTER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

// ตัด body ยาวๆ กัน context บวม
function trunc(s, n = 4000) {
  if (s == null) return s;
  s = String(s);
  return s.length > n ? s.slice(0, n) + `\n…(ตัด ${s.length - n} ตัวอักษร)` : s;
}
const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: 'error: ' + (e?.message || String(e)) }] });
const wrap = (fn) => async (args) => { try { return ok(await fn(args || {})); } catch (e) { return fail(e); } };

function registerTools(server) {
/* ============ Map Local (mock local data) ============ */
server.tool(
  'list_mocks',
  'ดูรายการ Map Local mock ทั้งหมด (mock response ที่ตอบแทนเซิร์ฟเวอร์จริงเมื่อ URL ตรง pattern)',
  {},
  wrap(async () => {
    const rules = await api('GET', '/api/maplocal');
    return rules.map((r) => ({ id: r.id, enabled: r.enabled, name: r.name, method: r.method, urlPattern: r.urlPattern, status: r.status, contentType: r.contentType, scenario: r.scenario || '', bodyPreview: trunc(r.body, 200) }));
  }),
);

server.tool(
  'create_mock',
  'สร้าง Map Local mock ใหม่ — เมื่อ request ผ่าน proxy ตรง urlPattern จะตอบ body นี้แทนของจริง (ไม่ยิงเซิร์ฟเวอร์จริง)',
  {
    urlPattern: z.string().describe('pattern ของ URL เช่น /api/user หรือ /api/tasks/* (มี * = wildcard, ไม่มี * = "มีคำนี้ใน URL")'),
    body: z.string().describe('เนื้อหา response (มักเป็น JSON string)'),
    name: z.string().optional().describe('ชื่อกฎ ไว้จำ'),
    method: z.enum(['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional().describe('HTTP method (default ANY)'),
    status: z.number().int().optional().describe('HTTP status (default 200)'),
    contentType: z.string().optional().describe('Content-Type (default application/json)'),
    scenario: z.string().optional().describe('แท็กจัดกลุ่มเป็นชุด (scenario) เพื่อเปิด/ปิดพร้อมกัน'),
    enabled: z.boolean().optional().describe('เปิดใช้เลยไหม (default true)'),
  },
  wrap(async (a) => (await api('POST', '/api/maplocal', a)).rule),
);

server.tool(
  'update_mock',
  'แก้ Map Local mock ที่มีอยู่ (ระบุ id) — ส่งเฉพาะ field ที่ต้องการเปลี่ยน',
  {
    id: z.string(),
    urlPattern: z.string().optional(),
    body: z.string().optional(),
    name: z.string().optional(),
    method: z.enum(['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    status: z.number().int().optional(),
    contentType: z.string().optional(),
    scenario: z.string().optional(),
    enabled: z.boolean().optional(),
  },
  wrap(async ({ id, ...patch }) => (await api('PUT', `/api/maplocal/${id}`, patch)).rule),
);

server.tool(
  'toggle_mock',
  'เปิด/ปิด Map Local mock ตัวเดียว (enabled true/false)',
  { id: z.string(), enabled: z.boolean() },
  wrap(async ({ id, enabled }) => (await api('PUT', `/api/maplocal/${id}`, { enabled })).rule),
);

server.tool(
  'delete_mock',
  'ลบ Map Local mock (ระบุ id)',
  { id: z.string() },
  wrap(async ({ id }) => api('DELETE', `/api/maplocal/${id}`)),
);

/* ============ Scenario (mock เป็นชุด) ============ */
server.tool(
  'list_scenarios',
  'ดูรายการ scenario (ชุด mock ที่แท็กด้วย field scenario) พร้อมสถานะ active (เปิดครบทั้งชุดหรือยัง)',
  {},
  wrap(() => api('GET', '/api/maplocal/scenarios').then((r) => r.scenarios)),
);

server.tool(
  'activate_scenario',
  'เปิดใช้ mock ทั้งชุด (scenario). ตั้ง exclusive=true เพื่อปิด mock ของชุดอื่นทั้งหมดด้วย (สลับ scenario)',
  { name: z.string(), exclusive: z.boolean().optional().describe('ปิดชุดอื่นด้วยไหม (default false)') },
  wrap(({ name, exclusive }) => api('POST', `/api/maplocal/scenarios/${encodeURIComponent(name)}/activate`, { exclusive: !!exclusive })),
);

server.tool(
  'deactivate_scenario',
  'ปิด mock ทั้งชุด (scenario)',
  { name: z.string() },
  wrap(({ name }) => api('POST', `/api/maplocal/scenarios/${encodeURIComponent(name)}/deactivate`)),
);

/* ============ Flows (traffic จริงที่ดักได้) ============ */
async function getFlows() { return api('GET', '/api/proxy/flows'); }

server.tool(
  'list_flows',
  'ดู traffic จริงที่ proxy ดักได้ (สรุปย่อ) — กรองด้วย contains บน url/host/path/method ได้',
  {
    contains: z.string().optional().describe('กรองเฉพาะ flow ที่ url มีข้อความนี้'),
    method: z.string().optional().describe('กรองตาม method เช่น GET'),
    limit: z.number().int().optional().describe('จำนวนสูงสุด (default 50)'),
  },
  wrap(async ({ contains, method, limit = 50 }) => {
    let flows = await getFlows();
    if (contains) flows = flows.filter((f) => (f.url || '').toLowerCase().includes(contains.toLowerCase()));
    if (method) flows = flows.filter((f) => (f.method || '').toUpperCase() === method.toUpperCase());
    return flows.slice(0, limit).map((f) => ({
      id: f.id, method: f.method, status: f.status, host: f.host, path: f.path,
      resContentType: f.resContentType, resSize: f.resSize, mapped: f.mapped,
      isImage: !!f.resIsImage, isVideo: !!f.resIsVideo, isPdf: !!f.resIsPdf, time: f.time,
    }));
  }),
);

server.tool(
  'get_flow',
  'ดูรายละเอียดเต็มของ flow ตัวเดียว (headers + body ของ request/response, ตัด body ที่ยาวมาก)',
  { id: z.string() },
  wrap(async ({ id }) => {
    const f = (await getFlows()).find((x) => x.id === id);
    if (!f) throw new Error('ไม่พบ flow id นี้ (อาจถูกล้างไปแล้ว)');
    return { ...f, reqBody: trunc(f.reqBody, 6000), resBody: trunc(f.resBody, 6000) };
  }),
);

server.tool(
  'mock_from_flow',
  'สร้าง Map Local mock จาก flow จริงที่ดักได้ (ก็อป response ของ flow นั้นมาเป็น mock) — เหมาะกับ "จับ response จริงแล้ว mock ต่อ"',
  {
    id: z.string().describe('flow id จาก list_flows'),
    name: z.string().optional(),
    scenario: z.string().optional(),
    urlPattern: z.string().optional().describe('ทับ pattern เอง (default = path ของ flow แบบตัด query)'),
    enabled: z.boolean().optional(),
  },
  wrap(async ({ id, name, scenario, urlPattern, enabled }) => {
    const f = (await getFlows()).find((x) => x.id === id);
    if (!f) throw new Error('ไม่พบ flow id นี้');
    if (f.resBody == null) throw new Error('flow นี้ไม่มี response body ที่เป็นข้อความ (อาจเป็นรูป/วิดีโอ/binary)');
    const rule = {
      name: name || `mock ${f.method} ${f.host}${(f.path || '').split('?')[0]}`.slice(0, 80),
      method: f.method || 'ANY',
      urlPattern: urlPattern || (f.path || '').split('?')[0] || f.url,
      status: f.status || 200,
      contentType: f.resContentType || 'application/json',
      body: f.resBody,
      scenario: scenario || '',
      enabled: enabled !== false,
    };
    return (await api('POST', '/api/maplocal', rule)).rule;
  }),
);

server.tool('clear_flows', 'ล้างรายการ traffic (flows) ที่ดักไว้ทั้งหมด', {}, wrap(() => api('DELETE', '/api/proxy/flows')));

/* ============ Device / Proxy ============ */
server.tool('proxy_info', 'ดูข้อมูล proxy (พอร์ต mitmproxy, LAN IP ของเครื่อง, CA พร้อมไหม)', {}, wrap(() => api('GET', '/api/proxy/info')));

server.tool(
  'list_devices',
  'ดูรายการมือถือ (adb) + สถานะ proxy/Postern ของแต่ละเครื่อง',
  {},
  wrap(() => api('GET', '/api/devices')),
);

server.tool(
  'connect_device',
  'สั่งเชื่อม proxy ให้มือถือ — method proxy (global http_proxy) หรือ postern (แอป VPN); mode usb หรือ wifi',
  {
    serial: z.string().describe('serial ของ device (จาก list_devices)'),
    method: z.enum(['proxy', 'postern']).optional().describe('default proxy'),
    mode: z.enum(['usb', 'wifi']).optional().describe('default usb'),
  },
  wrap(({ serial, method = 'proxy', mode = 'usb' }) => api('POST', '/api/devices/connect', { serial, method, mode })),
);

server.tool(
  'disconnect_device',
  'ตัดการเชื่อม proxy/VPN ของมือถือ (ล้าง flow + mute ด้วย)',
  { serial: z.string(), method: z.enum(['proxy', 'postern']).optional() },
  wrap(({ serial, method = 'proxy' }) => api('POST', '/api/devices/disconnect', { serial, method })),
);

/* ============ Dynamic Test Cases (sequenced mock flows) ============ */
const STEP_SCHEMA = {
  label: z.string().optional(),
  status: z.number().int().optional(),
  contentType: z.string().optional(),
  body: z.string().describe('เนื้อหา response ของ step (มัก JSON string)'),
};
const ENDPOINT_DESC = 'endpoint 1 ตัว = { method, urlPattern, steps: [...] } โดย steps เรียงตามลำดับที่จะตอบ (ครั้งที่ 1,2,3...)';

server.tool(
  'list_cases',
  'ดู test case ทั้งหมด (mock flow แบบมีลำดับ step) + case ที่ active + cursor ปัจจุบันของแต่ละ endpoint',
  {},
  wrap(async () => {
    const d = await api('GET', '/api/testcases');
    return {
      activeCaseId: d.activeCaseId,
      cases: d.cases.map((c) => ({ id: c.id, name: c.name, active: c.active, autoAdvance: c.autoAdvance, endpoints: c.endpoints.map((e) => `${e.method} ${e.urlPattern} (${e.steps.length} steps)`), cursors: c.cursors })),
    };
  }),
);

server.tool(
  'get_case',
  'ดูรายละเอียดเต็มของ test case ตัวเดียว (endpoints + steps)',
  { id: z.string() },
  wrap(async ({ id }) => {
    const c = (await api('GET', '/api/testcases')).cases.find((x) => x.id === id);
    if (!c) throw new Error('ไม่พบ test case id นี้');
    return c;
  }),
);

server.tool(
  'create_case',
  `สร้าง test case ใหม่ (mock flow มีลำดับ). ${ENDPOINT_DESC}. autoAdvance=true (default) = endpoint ถูกเรียกครั้งที่ N ตอบ step[N] อัตโนมัติ (เกินก็ค้าง step สุดท้าย)`,
  {
    name: z.string(),
    autoAdvance: z.boolean().optional(),
    endpoints: z.array(z.object({
      method: z.enum(['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      urlPattern: z.string(),
      steps: z.array(z.object(STEP_SCHEMA)),
    })).describe('รายการ endpoint แต่ละตัวมีลำดับ steps'),
  },
  wrap(async (a) => (await api('POST', '/api/testcases', a)).case),
);

server.tool(
  'update_case',
  'แก้ test case (ส่ง case ทั้งก้อน — name/autoAdvance/endpoints). แก้แล้ว cursor ของ case นั้นจะ reset',
  {
    id: z.string(),
    name: z.string().optional(),
    autoAdvance: z.boolean().optional(),
    endpoints: z.array(z.object({
      method: z.enum(['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
      urlPattern: z.string(),
      steps: z.array(z.object(STEP_SCHEMA)),
    })).optional(),
  },
  wrap(async ({ id, ...patch }) => (await api('PUT', `/api/testcases/${id}`, patch)).case),
);

server.tool('delete_case', 'ลบ test case', { id: z.string() }, wrap(({ id }) => api('DELETE', `/api/testcases/${id}`)));

server.tool(
  'activate_case',
  'เปิดใช้ test case (active ได้ทีละอันเท่านั้น — เปิดตัวนี้ปิดตัวอื่นอัตโนมัติ). default reset cursor เริ่มนับใหม่',
  { id: z.string(), resetOnActivate: z.boolean().optional() },
  wrap(({ id, resetOnActivate }) => api('POST', `/api/testcases/${id}/activate`, { resetOnActivate: resetOnActivate !== false })),
);

server.tool('deactivate_case', 'ปิด test case ที่ active อยู่ (กลับไปใช้ Map Local static ปกติ)', {}, wrap(() => api('POST', '/api/testcases/deactivate')));

server.tool('reset_case', 'รีเซ็ต cursor ของ case ที่ active — เริ่ม flow ใหม่จาก step แรก', {}, wrap(() => api('POST', '/api/testcases/reset')));

server.tool('reload_cases', 'โหลดเคสแบบไฟล์ใหม่จากดิสก์ (test-cases/<name>/case.json + responses/) — ใช้หลังแก้ไฟล์ mock', {}, wrap(() => api('POST', '/api/testcases/reload')));

server.tool(
  'next_step',
  'เลื่อน step ถัดไปเอง (สำหรับ manual/autoAdvance=false). ระบุ pattern เพื่อเลื่อนเฉพาะ endpoint นั้น ไม่ระบุ = เลื่อนทุก endpoint',
  { pattern: z.string().optional() },
  wrap(({ pattern }) => api('POST', '/api/testcases/next', pattern ? { pattern } : {})),
);

server.tool(
  'goto_step',
  'ตั้ง step ปัจจุบันของ endpoint หนึ่งเป็น index ที่ระบุ (0 = step แรก)',
  { pattern: z.string(), index: z.number().int() },
  wrap(({ pattern, index }) => api('POST', '/api/testcases/goto', { pattern, index })),
);

server.tool(
  'case_status',
  'ดูสถานะ case ที่ active ตอนนี้ + cursor ของแต่ละ endpoint (step ปัจจุบัน)',
  {},
  wrap(async () => {
    const d = await api('GET', '/api/testcases');
    const c = d.cases.find((x) => x.id === d.activeCaseId);
    return c ? { active: c.name, autoAdvance: c.autoAdvance, cursors: c.cursors } : { active: null, note: 'ยังไม่มี case ที่ active' };
  }),
);
}

const INSTRUCTIONS = `ApiTester: inspect/mock API traffic through a MITM proxy.
- Static mock: create_mock (one urlPattern -> one response). urlPattern without * = substring match, with * = wildcard.
- Scenario: tag static mocks, activate_scenario {exclusive:true} to switch whole sets.
- Test case (flow): each endpoint has ordered steps; same endpoint returns step 1 on call 1, step 2 on call 2 (autoAdvance). Only ONE case active at a time; activating is exclusive. Inline via create_case; file-based under test-cases/<name>/ loaded by reload_cases (ids look like "file:<name>"). Drive with activate_case/reset_case/next_step/goto_step; case_status shows cursors.
- mock_from_flow turns a captured flow into a mock. See mcp/USAGE.md for full examples.`;

function buildServer() {
  const server = new McpServer({ name: 'apitester', version: '1.0.0' }, { instructions: INSTRUCTIONS });
  registerTools(server);
  return server;
}

/* ============ transport: HTTP (ถ้าตั้ง MCP_PORT) หรือ stdio (default) ============ */
const HTTP_PORT = parseInt(process.env.MCP_PORT || '', 10);

if (HTTP_PORT >= 1 && HTTP_PORT <= 65535) {
  // โหมด HTTP บน localhost — ให้ agent/tool ต่อผ่าน http://127.0.0.1:<PORT>/mcp (Streamable HTTP)
  const express = (await import('express')).default;
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { isInitializeRequest } = await import('@modelcontextprotocol/sdk/types.js');
  const { randomUUID } = await import('node:crypto');

  const app = express();
  app.use(express.json({ limit: '40mb' }));
  const transports = {}; // sessionId -> transport

  app.post('/mcp', async (req, res) => {
    const sid = req.headers['mcp-session-id'];
    let transport = sid && transports[sid];
    if (!transport && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { transports[id] = transport; },
      });
      transport.onclose = () => { if (transport.sessionId) delete transports[transport.sessionId]; };
      await buildServer().connect(transport);
    } else if (!transport) {
      return res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'No valid session; send initialize first' }, id: null });
    }
    await transport.handleRequest(req, res, req.body);
  });

  const sessionReq = async (req, res) => {
    const sid = req.headers['mcp-session-id'];
    const transport = sid && transports[sid];
    if (!transport) return res.status(400).send('Invalid or missing session id');
    await transport.handleRequest(req, res);
  };
  app.get('/mcp', sessionReq);     // server→client stream (SSE)
  app.delete('/mcp', sessionReq);  // ปิด session

  app.listen(HTTP_PORT, '127.0.0.1', () => {
    console.error(`apitester-mcp (HTTP) → http://127.0.0.1:${HTTP_PORT}/mcp | ApiTester ที่ ${BASE}`);
  }).on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      const hint = HTTP_PORT === 7000 || HTTP_PORT === 5000
        ? ' (พอร์ตนี้มักถูก macOS AirPlay Receiver ยึด — ปิดใน System Settings → General → AirDrop & Handoff, หรือใช้พอร์ตอื่น)'
        : '';
      console.error(`❌ พอร์ต ${HTTP_PORT} ถูกใช้อยู่แล้ว${hint} — ตั้ง MCP_PORT เป็นพอร์ตอื่น เช่น MCP_PORT=7333`);
    } else {
      console.error('❌ start HTTP MCP ไม่สำเร็จ:', e.message);
    }
    process.exit(1);
  });
} else {
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
  console.error(`apitester-mcp (stdio) พร้อมใช้งาน — ต่อกับ ApiTester ที่ ${BASE}`);
}
