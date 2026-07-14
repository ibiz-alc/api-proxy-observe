# API Tester

A Node.js + Express web tool for inspecting, sending and mocking API traffic,
reading image metadata, and MITM-decrypting a mobile app's HTTPS traffic in a
Proxyman-like UI.

## Features

1. **📥 Inspector** — point any system at `/hook` (any method, any sub-path such
   as `/hook/order/create`) and see headers, query, body and uploaded files in
   real time.
2. **📤 Sender** — enter URL / method / headers / body (JSON or multipart
   form-data with file attachments), fire the request from the server (so no
   CORS), and inspect the response.
3. **🖼️ Image Metadata** — pick an image (click or drag-and-drop) to read EXIF:
   capture date, GPS coordinates, reverse-geocoded address (OpenStreetMap
   Nominatim), camera info, with a Google Maps link. UTF-8 `ImageDescription`
   supported.
4. **🔗 URL Metadata** — paste an image URL; the server fetches it and extracts
   EXIF: `GET /api/url-metadata?url=<url>&address=1`.
5. **🌐 Proxy (MITM)** — capture and decrypt real device traffic — see below.
6. **🤖 MCP server** — let an AI agent mock local data, inspect traffic, manage
   scenarios and devices. See [`mcp/`](mcp/).

## Requirements (first-time setup)

| Tool | Required for | Install (macOS) | Notes |
|------|--------------|-----------------|-------|
| **Node.js ≥ 18** | web server + MCP | `brew install node` | tested on v22 |
| **mitmproxy** (`mitmdump`) | Proxy tab / HTTPS capture | `brew install mitmproxy` | provides `mitmdump` on `PATH` |
| **adb** (Android platform-tools) | USB / Wi-Fi device control | `brew install android-platform-tools` | Android only — not needed for iOS |
| **ngrok** | remote / 4G access (optional) | `brew install ngrok` | only for `./start.sh --ngrok` |

First-time install:

```bash
npm install                 # web server deps (root)
npm --prefix mcp install    # MCP server deps (only if you use the MCP/agent integration)
```

The mitmproxy CA is generated automatically on the first `mitmdump` run (stored
under `~/.mitmproxy/`) — install it on each device via the **Install CA** button
(Android) or the 🍎 iOS card (manual). No CA setup is needed for the web-only
Inspector/Sender tabs.

## Getting started

```bash
npm install
npm start          # PORT=8080 npm start to change port (default 3000)
```

Or start everything (web + mitmproxy, and `--ngrok` for remote) with the helper:

```bash
./start.sh            # web (:3000) + mitmproxy (:8888) for USB/Wi-Fi
./start.sh --ngrok    # also start ngrok for remote/4G
./stop.sh             # stop everything
```

Open http://localhost:3000 and try:

```bash
curl -X POST http://localhost:3000/hook/test \
  -H 'Content-Type: application/json' \
  -d '{"hello": "world"}'
```

## 🌐 Proxy (MITM — Proxyman-style)

The Proxy tab shows live device traffic, including decrypted HTTPS, backed by
**mitmproxy** (port `8888`, HTTP/2 + SNI). An addon (`mitm-to-apitester.py`)
forwards each decrypted flow to the web UI over Server-Sent Events and enforces
Map Local rules.

### Connecting a device (driven from the web, over adb)

Enable USB debugging, then use the **How to connect** panel in the Proxy tab:

- **USB** — sets the Android global HTTP proxy to `127.0.0.1:8888` with
  `adb reverse tcp:8888 tcp:8888`.
- **Wi-Fi** — sets the proxy to `<Mac LAN IP>:8888` (same network).
- **Proxy Postern app** — launches the companion VPN app, auto-fills the
  endpoint for the transport, and connects the VPN (useful when an app ignores
  the system proxy). The app lives under [`android/ProxyPostern`](android/ProxyPostern).

Install the mitmproxy CA on the device with the **Install CA** button (pushes
the cert and opens the system settings page). Connect / disconnect and CA
install are all one click from the web.

### Connecting iOS (iPhone / iPad)

adb/USB automation is Android-only, so iOS is connected **manually over Wi-Fi**.
The **Status** tab shows a 🍎 iOS card with the exact proxy string and a copy
button. Steps on the device:

1. Join the same Wi-Fi as the Mac.
2. Settings → Wi-Fi → tap (i) → Configure Proxy → **Manual** →
   Server = `<Mac LAN IP>`, Port = `8888`.
3. Open Safari to **http://mitm.it** and install the iOS certificate. (Hover the
   **🔳 QR mitm.it** chip on the iOS card to show a QR — scan it with the iPhone
   camera to open the page directly.)
4. Settings → General → VPN & Device Management → install the downloaded profile.
5. Settings → General → About → **Certificate Trust Settings** → enable the
   mitmproxy cert. **Do not skip this** — without it every HTTPS handshake fails.

Map Local and Test Cases work with iOS traffic unchanged (they act on flows at
the proxy, regardless of client OS). Apps using **certificate pinning** (e.g.
banking apps) won't traverse the proxy even with the CA trusted — that's a limit
of the target app, not the setup. The USB and Proxy Postern modes do not apply
to iOS.

### Media detection & preview

Responses are classified by **magic bytes / URL extension / content-type** (not
content-type alone), so S3 objects served as `binary/octet-stream` are still
recognized. The flow list shows a `🖼️ IMAGE`, `🎬 VIDEO` or `📄 PDF` badge, and
the detail pane adds an inline preview tab:

| Type  | Preview                | Size cap for preview |
|-------|------------------------|----------------------|
| Image | `<img>` + EXIF metadata | 12 MB |
| Video | `<video>` player        | 25 MB |
| PDF   | embedded viewer         | 25 MB |

Beyond the cap, the item is still tagged but shows a "too large to preview"
note. Filter the list by media type with the **Image / Video / PDF** buttons.

### Map Local

Return a mock response for requests matching a pattern, without touching the
real server (Map Local tab).

### Test Cases (sequenced mock flows)

The **Test Cases** tab defines flows where the *same* endpoint returns different
responses over successive calls (e.g. `GET /api/detail` → error on call 1, ok on
call 2 after a refresh). Each case is a set of endpoints, each with an ordered
list of steps; only one case is active at a time. Steps **auto-advance** by call
count by default, with manual **Reset / Next** controls. Fully drivable from MCP
(`activate_case`, `reset_case`, `next_step`, `reload_cases`, …). See
[`docs/dynamic-test-cases-design.md`](docs/dynamic-test-cases-design.md).

Cases can be **inline** (created in the web/MCP, stored in `test-cases.json`) or
**file-based** — a folder per case with response bodies as separate files, kept
apart between cases and version-controlled:

```
test-cases/
  case1-userA/
    case.json                 # endpoints + steps, each step points to a file
    responses/{login,detail,update-name,update-items}.json
  case2-userB/
    case.json
    responses/{login,detail,update-name,update-error}.json
```

Each step uses `"file": "responses/<x>.json"` instead of an inline `body`
(status defaults to 200, `.json` → `application/json`). Edit the files and press
**🔄 Reload** (or MCP `reload_cases`). See `test-cases/` for the working example.

> ⚠️ The CA lets the proxy decrypt HTTPS. Use it only on your own test devices
> and remove it when finished.

## 🤖 MCP server (for AI agents)

`mcp/` is a stdio [MCP](https://modelcontextprotocol.io) server that lets an AI
agent (Claude Code, Claude Desktop, …) drive ApiTester over its HTTP API: mock
local data (Map Local), group mocks into scenarios, read captured traffic and
turn a real response into a mock, and control devices.

### 1. Install

```bash
cd mcp
npm install
```

### 2. Run ApiTester

The MCP server is a thin client — ApiTester must be running:

```bash
npm start          # in the repo root (serves http://127.0.0.1:3000)
```

For the proxy/flow tools, also have mitmproxy running (`./start.sh`).
Override the target with `APITESTER_URL` if not on the default.

### 3. Register with the agent

**Claude Code** — a project-scoped `.mcp.json` is committed at the repo root, so
running `claude` inside this repo auto-detects the `apitester` server (accept the
prompt to enable it). Verify with `/mcp`. To add it from anywhere:

```bash
claude mcp add apitester -- node /absolute/path/to/ApiTester/mcp/index.js
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apitester": {
      "command": "node",
      "args": ["/absolute/path/to/ApiTester/mcp/index.js"],
      "env": { "APITESTER_URL": "http://127.0.0.1:3000", "NODE_OPTIONS": "" }
    }
  }
}
```

> **Troubleshooting:** if the server fails to start with
> `Cannot find module '.../cmux-claude-node-options/restore-node-options.cjs'`,
> the launcher injected a stale `NODE_OPTIONS`. The committed `.mcp.json` clears
> it with `"NODE_OPTIONS": ""` — keep that in any custom config too.

### Run as an HTTP server on localhost (optional)

By default the server uses **stdio** (the launcher spawns it). To instead run it
as a long-lived **HTTP** endpoint that any MCP-over-HTTP client can connect to:

```bash
cd mcp
MCP_PORT=7333 node index.js      # or: npm run start:http
# → http://127.0.0.1:7333/mcp  (Streamable HTTP, bound to localhost only)
```

Connect Claude Code to it over HTTP instead of stdio:

```bash
claude mcp add --transport http apitester http://127.0.0.1:7333/mcp
```

Use HTTP mode when several clients/agents share one server, or you want it
running independently of the editor. Otherwise stdio (above) is simplest.

> Avoid ports **7000** and **5000** on macOS — the AirPlay Receiver
> (ControlCenter) holds them, so binding there fails with `EADDRINUSE`. The
> default is `7333`; override with `MCP_PORT`.

### 4. Tools

| Group | Tools |
|-------|-------|
| **Map Local (mock)** | `list_mocks`, `create_mock`, `update_mock`, `toggle_mock`, `delete_mock` |
| **Scenarios** | `list_scenarios`, `activate_scenario` (`exclusive` to switch sets), `deactivate_scenario` |
| **Flows (captured traffic)** | `list_flows`, `get_flow`, `mock_from_flow`, `clear_flows` |
| **Test cases (sequenced)** | `list_cases`, `get_case`, `create_case`, `update_case`, `delete_case`, `activate_case`, `deactivate_case`, `reset_case`, `next_step`, `goto_step`, `case_status` |
| **Device / proxy** | `proxy_info`, `list_devices`, `connect_device`, `disconnect_device` |

### 5. Example agent prompts

- *"Mock `/api/user` to return a premium user."* → `create_mock`
- *"Capture the real `/api/tasks` response and mock it, then change status to empty."*
  → `list_flows` → `mock_from_flow` → `update_mock`
- *"Make a 'server error' scenario for all endpoints and switch to it."*
  → `create_mock` (scenario `error`, status 500) → `activate_scenario` with `exclusive: true`
- *"Connect my phone over USB and show the last 10 requests."*
  → `connect_device` → `list_flows`

A mock intercepts matching requests going through the proxy and returns the
canned response without hitting the real server. Scenarios let the agent flip
between whole sets of mocks (e.g. `happy-path` vs `error`) in one call.

## Selected endpoints

- `POST /hook/*` — capture any request.
- `POST /api/send`, `POST /api/send-form` — send a request from the server.
- `GET /api/url-metadata?url=<url>&address=1` — EXIF for a remote image.
- `GET /api/requests/:id/files/:index/metadata` — lat/lng/address as JSON.
  Fetching the file itself also returns `X-Image-Latitude` / `-Longitude` /
  `-Date` / `-Camera` / `-Address` headers (text values are URL-encoded).
- `GET /api/proxy/flows`, `GET /api/proxy/flows/:id/image?side=req|res` —
  proxy flows and captured media bytes.

## Deployment

Runs anywhere with Node.js 18+. For a long-running process use
[pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start server.js --name api-tester
```

### Docker (Core: web + mitmproxy + MCP)

One image runs all three services. **adb/USB is not included** — Docker Desktop
on macOS has no USB passthrough, so connect devices with **manual proxy + manual
CA** (works for iOS and Android alike).

```bash
./start.sh --docker              # start in Docker (stops native services first)
./start.sh --docker --build      # rebuild image after code changes
./start.sh                       # switch back to native (stops the container first)
./stop.sh                        # stop everything (native + container)
```

Or drive compose directly: `docker compose up -d --build` / `logs -f` / `down`.

> **Don't run native and Docker at the same time.** Both can bind the same
> ports without an error (native on IPv4, Docker on IPv6) and requests silently
> split between the two stacks. `start.sh`/`stop.sh` handle the switch for you.

Then on the device:

1. Set Wi-Fi proxy to **`<your computer's LAN IP>`:8888** (same as native Wi-Fi mode).
2. Install the CA: open the web UI → **Status** tab → **📜 CA Certificate
   (Manual)** → download or scan the QR. (adb-based "Install CA (USB)" won't work
   from the container.)

Ports: `3000` web/API · `8888` mitmproxy · `7333` MCP (HTTP).

Persisted via volumes (see `docker-compose.yml`):
- `./data/mitmproxy` → the mitmproxy CA. **Keep this** so the CA stays stable
  across restarts and devices don't need to re-trust a new cert every time.
- `./map-local.json`, `./test-cases` → mock rules and file-based cases.

Config via env (already set in the image): `PORT`, `MCP_PORT`, `MCP_HOST`
(`0.0.0.0` in the container so MCP is reachable from the host), `MITMDUMP`,
`APITESTER_URL`.

## Notes

- Request history and proxy flows are kept **in memory** (200 requests / 300
  flows); they are lost on restart.
- Uploads accept up to 25 MB per file.
- Reverse geocoding uses OpenStreetMap Nominatim and needs internet access;
  everything else works offline.
- After editing `mitm-to-apitester.py`, restart mitmdump (hot-reload is
  unreliable).
