# Release Notes

API Tester — a web tool for inspecting, sending and mocking API traffic, plus
MITM decryption of a target Android app's HTTPS traffic, viewed in a
Proxyman-like web UI.

## 2026-07-08

### Proxy — media handling
- **Image, video and PDF support.** Responses show a `🖼️ IMAGE`, `🎬 VIDEO` or
  `📄 PDF` badge in the flow list and an inline preview tab: images with EXIF,
  a `<video>` player, and an embedded PDF viewer.
- **Media-type filter.** Filter the flow list to Image / Video / PDF (or All).
- **Smarter detection.** Media is identified by magic bytes, URL extension and
  content-type — not content-type alone — so S3 objects served as
  `binary/octet-stream` (e.g. `.jpg`/`.mp4`/`.pdf`) are recognized. The sniffed
  MIME type is used when serving bytes back so the browser renders them.
- **Preview size caps** raised: image 12 MB (fixes large photos that could not
  be previewed), video 25 MB, PDF 25 MB; larger files are tagged without a
  preview.

### Proxy — layout
- URL/flow list moved to the **top**, detail pane moved to the **bottom** with a
  **draggable divider** to resize them (persisted in `localStorage`).
- Device panel is now a narrow left column.

### Proxy — connect via the Proxy Postern app (from the web)
- New **Connect via app** flow: the web launches the Proxy Postern VPN app over
  adb, auto-fills the endpoint that matches the transport (USB → `127.0.0.1`
  with `adb reverse`; Wi-Fi → the Mac's LAN IP), and auto-connects the VPN.
- Device list shows real VPN state; connect/disconnect and CA install are driven
  from the web, same as the USB/Wi-Fi (global-proxy) flows.
- Fixed a foreground-service ANR and a reconnect race by always calling
  `startForeground()` and force-stopping any stale app instance before connect.

### Project layout
- The `ProxyPostern` Android app now lives under `android/ProxyPostern`
  (kept as its own git repository).

## Earlier

### Proxy (MITM)
- Real-time flow list over Server-Sent Events, backed by mitmproxy (HTTP/2 +
  SNI) with an addon that forwards decrypted flows to the web UI.
- Web-driven device control over adb: connect/disconnect via USB or Wi-Fi by
  setting the Android global HTTP proxy; push and install the mitmproxy CA.
- **Map Local**: mock responses for matching requests without touching the real
  server.
- Request tools: copy URL, view image EXIF metadata inline.

### Inspector
- A hook endpoint that captures any method/path; view headers, query, body and
  uploaded files with image previews.

### Sender
- Send arbitrary requests (JSON or multipart/form-data with file attachments)
  and inspect the response.

### Image Metadata
- Read EXIF from an image (capture date, GPS coordinates, reverse-geocoded
  address, camera info), with UTF-8 `ImageDescription` support.
