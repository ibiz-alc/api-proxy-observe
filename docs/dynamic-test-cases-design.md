# Design: Dynamic Test Cases (sequenced Map Local)

Date: 2026-07-10 · Status: **implemented** (server + addon + MCP + UI). This doc is the reference.

## Problem
Map Local today is **static**: one URL pattern → one fixed response (see `server.js`
`/api/maplocal*`, addon `mitm-to-apitester.py` `_find_rule`). Real test scenarios are
**flows** where the *same* endpoint must return *different* responses over time, e.g.:

```
case 5: Login → Load Detail(error) → Refresh → Load Detail(ok) → Show Product 2 → Logout
```

Here `GET /api/detail` returns an error on call 1, then success on call 2 (after refresh).
Static Map Local can't express that. We want **enable/disable-able, ordered test cases**,
drivable from the UI and via **MCP**.

## Concept
A **Test Case** is a named set of **endpoint sequences**. Each endpoint (method + URL
pattern) owns an ordered list of **steps** (responses). While a case is active, each
matching request is answered with the endpoint's *current* step; by default the cursor
**auto-advances** on every match (clamped to the last step). Manual **next / goto / reset**
controls also exist. Only **one case is active at a time** (exclusive) so cursors stay
unambiguous.

The user's flow arrows (`Login > Load Detail > ...`) are just the natural order the app
calls endpoints — we don't enforce order, we only script *what each endpoint returns on its
Nth call*.

## Data model
New store `test-cases.json` (same pattern as `map-local.json`, git-ignored):

```jsonc
{
  "id": "uuid",
  "name": "case 5 — refresh recovers",
  "autoAdvance": true,                 // auto cursor++ on match (default). false = manual only
  "endpoints": [
    { "method": "POST", "urlPattern": "/api/login",  "steps": [ {"label":"ok","status":200,"contentType":"application/json","body":"{...}"} ] },
    { "method": "GET",  "urlPattern": "/api/detail",  "steps": [ {"label":"error","status":500,...}, {"label":"ok","status":200,...} ] },
    { "method": "GET",  "urlPattern": "/api/product", "steps": [ {"label":"product2","status":200,...} ] },
    { "method": "POST", "urlPattern": "/api/logout",  "steps": [ {"label":"ok","status":200,...} ] }
  ]
}
```

Reuses the existing rule fields (`method`, `urlPattern`, `status`, `contentType`, `body`)
and wildcard matching (`patternMatches` in `server.js`) so the editor/validation are familiar.

### Runtime state (server, in-memory)
```
activeCaseId: string | null
cursors: { "<METHOD> <urlPattern>": number }   // per active-case endpoint
```
Cursors are in-memory (reset on server restart — acceptable for a test tool).

## The 5 example cases
| Case | login | detail | product | extra |
|------|-------|--------|---------|-------|
| 1 | [ok] | [ok] | [product1] | — |
| 2 | [ok] | [ok] | [product2] | — |
| 3 | [401 error] | — | — | flow stops at auth |
| 4 | [ok] | [500 error] | — | — |
| 5 | [ok] | [500 error, ok] | [product2] | logout [ok] |

Case 5's `detail: [error, ok]` is the only one needing the sequence; the rest are 1-step
endpoints. Auto-advance makes case 5 "just work": detail call#1→error, refresh = call#2→ok.

## Resolution & precedence
Addon `request()` order for each request:
1. If a case is active and the request matches one of its endpoints → return that step's
   response (header `X-Api-Tester: test-case`), advance cursor if `autoAdvance`.
2. Else fall back to existing static Map Local (`X-Api-Tester: map-local`).
3. Else pass through to the real server.

### Where resolution runs — decision
**Server owns the state; the addon asks per matching request.** Add
`POST /api/testcase/resolve {method, url}` → `{matched, status, contentType, body}` (or
`{matched:false}`). The addon caches the active case's *pattern list* (3 s, like it caches
rules now) and only calls `resolve` when a request matches a pattern — so no extra round-trip
for unmatched traffic. Centralizing state makes reset/next/goto and the live UI/MCP view
trivial and consistent. Localhost latency is negligible.

(Alternative considered: counters inside the mitmdump process — rejected: harder to reset,
observe, and drive from MCP; state split across two processes.)

## Advance model (both, per user choice)
- `autoAdvance:true` (default): each matched call does `cursor++` (clamped).
- Manual controls (work in either mode): `reset` (all cursors→0), `next {pattern?}`
  (cursor++ for one/all endpoints), `goto {pattern, index}`.
- `autoAdvance:false`: calls always return the current step without moving; only manual
  controls advance — for step-by-step walkthroughs.

## HTTP API (server.js)
- `GET  /api/testcases` → cases + `activeCaseId` + current `cursors`
- `POST /api/testcases` (create) · `PUT /api/testcases/:id` · `DELETE /api/testcases/:id`
- `POST /api/testcases/:id/activate` `{resetOnActivate?:true}` (exclusive)
- `POST /api/testcases/deactivate`
- `POST /api/testcases/reset`
- `POST /api/testcases/next` `{pattern?}` · `POST /api/testcases/goto` `{pattern, index}`
- `POST /api/testcase/resolve` `{method, url}` (addon-internal)

## Addon changes (mitm-to-apitester.py)
- Cache active-case patterns alongside Map Local rules (extend the 3 s `_get_rules` cache).
- In `request()`: if a pattern matches, `POST /api/testcase/resolve`; on `matched`, build
  `flow.response` with `X-Api-Tester: test-case`. Keep static Map Local as fallback.

## UI (public/)
New **Test Cases** tab (or a sub-tab under Map Local):
- List of cases with an active toggle (radio-like: one active) + Reset / Next buttons + a
  live cursor readout per endpoint (e.g. `detail 2/2`).
- Case editor: name, autoAdvance toggle, and per-endpoint rows (method + pattern + ordered
  steps). Each step body reuses the colorized JSON editor + Format (`makeJsonEditor`,
  added in commit `fc17be5`).

## MCP tools (mcp/index.js)
`list_cases`, `get_case`, `create_case`, `update_case`, `delete_case`,
`activate_case {name, reset, exclusive}`, `deactivate_case`, `reset_case`,
`next_step {pattern?}`, `goto_step {pattern, index}`, `case_status` (active + cursors).
Thin wrappers over the HTTP API, same style as existing tools.

## Relationship to existing "scenario" tag
The current static `scenario` tag on Map Local rules (commit `3568955`) stays for simple
"enable a set of static mocks". Test Cases are the dynamic superset. Keep them separate for
now; a later cleanup could fold scenarios into single-step cases.

## Out of scope / open questions
- Cursor persistence across restarts (kept in-memory for now).
- Matching a request to multiple endpoints in one case (first/most-specific wins, reuse
  existing sort in `_find_rule`).
- Recording a live flow into a case automatically (future: build a case from captured flows,
  like `mock_from_flow`).

## Suggested build order (phases)
1. Server: data model + store + resolve + activate/reset/next/goto endpoints.
2. Addon: pattern cache + resolve call + precedence.
3. MCP tools.
4. UI tab.
(Per the user's earlier choice, could ship phases 1–3 first — MCP + engine — and add the UI
after.)
