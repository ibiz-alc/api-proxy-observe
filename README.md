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

## Getting started

```bash
npm install
npm start          # PORT=8080 npm start to change port (default 3000)
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

> ⚠️ The CA lets the proxy decrypt HTTPS. Use it only on your own test devices
> and remove it when finished.

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

## Notes

- Request history and proxy flows are kept **in memory** (200 requests / 300
  flows); they are lost on restart.
- Uploads accept up to 25 MB per file.
- Reverse geocoding uses OpenStreetMap Nominatim and needs internet access;
  everything else works offline.
- After editing `mitm-to-apitester.py`, restart mitmdump (hot-reload is
  unreliable).
