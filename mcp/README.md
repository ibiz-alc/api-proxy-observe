# ApiTester MCP server

A stdio [MCP](https://modelcontextprotocol.io) server that lets an AI agent drive
ApiTester: mock local data (Map Local), inspect real proxy traffic, group mocks
into scenarios, and control devices — all over ApiTester's HTTP API.

## Setup

```bash
cd mcp
npm install
```

The server talks to a running ApiTester (start it with `npm start` in the repo
root). Endpoint defaults to `http://127.0.0.1:3000`; override with
`APITESTER_URL`.

### Transport

- **stdio** (default) — the agent launches `node index.js`; used by the committed
  `.mcp.json`.
- **HTTP** — set `MCP_PORT` to serve over Streamable HTTP on localhost:

  ```bash
  MCP_PORT=7333 node index.js        # npm run start:http
  # → http://127.0.0.1:7333/mcp  (localhost-only)
  claude mcp add --transport http apitester http://127.0.0.1:7333/mcp
  ```

## Register with Claude Code

A project-scoped `.mcp.json` is already committed at the repo root, so Claude
Code auto-detects the `apitester` server when you run it inside this repo (accept
the prompt to enable it). To add it manually elsewhere:

```bash
claude mcp add apitester -- node /absolute/path/to/ApiTester/mcp/index.js
```

## Usage examples

See **[USAGE.md](USAGE.md)** for concrete tool-call examples per workflow (static
mocks, scenarios, dynamic/file-based test cases, driving a flow, device control).
The server also sends a short `instructions` summary to the client on connect.

## Tools

**Map Local (mock local data)**
- `list_mocks` — list all mock rules
- `create_mock` — create a mock (urlPattern → status + body + content-type)
- `update_mock` / `toggle_mock` / `delete_mock` — edit / enable-disable / remove

**Scenarios (mocks as a set)**
- `list_scenarios` — scenarios with active state
- `activate_scenario` (`exclusive` to disable other scenarios) / `deactivate_scenario`

**Flows (captured traffic)**
- `list_flows` (filter by `contains` / `method`) — compact summaries
- `get_flow` — full request/response for one flow
- `mock_from_flow` — turn a captured flow's response into a mock
- `clear_flows`

**Device / proxy**
- `proxy_info`, `list_devices`, `connect_device`, `disconnect_device`

## Example agent usage

> "Mock `/api/user` to return a premium user, then flip to an error scenario."

The agent calls `create_mock` (scenario `premium`), then `create_mock` (scenario
`error`, status 500), then `activate_scenario` with `exclusive: true` to switch
between them.
