# ApiTester MCP — usage guide (for agents)

How to use the `apitester` MCP tools. Each example shows the tool name and its
arguments. All tools talk to a running ApiTester (`npm start`); proxy/flow tools
also need mitmproxy running.

## Mental model
- **Map Local mock** = one URL pattern → one fixed response (static).
- **Scenario** = a tag grouping static mocks; activate/deactivate a whole set.
- **Test case** = a *flow*: each endpoint has an ordered list of **steps**
  (responses). The same endpoint returns step 1 on call 1, step 2 on call 2, …
  (auto-advance). Only **one case is active at a time**. Cases can be **inline**
  (created via tools) or **file-based** (folders under `test-cases/`).
- `urlPattern`: no `*` = "URL contains this substring"; `*` = wildcard.

---

## 1. Static mock — one endpoint, one response
> "Mock `/api/user` to return a premium user."
```
create_mock {
  "urlPattern": "/api/user",
  "name": "premium user",
  "status": 200,
  "body": "{\"id\":1,\"plan\":\"premium\"}"
}
```
Then `list_mocks`, `toggle_mock {id, enabled}`, `delete_mock {id}` as needed.

## 2. Mock from a real captured response
> "Grab the real `/api/tasks` response and mock it, then make it empty."
```
list_flows { "contains": "/api/tasks" }        // find the flow id
mock_from_flow { "id": "<flowId>", "name": "tasks mock" }
update_mock { "id": "<ruleId>", "body": "{\"tasks\":[]}" }
```

## 3. Scenario — switch a whole set of static mocks
Create mocks tagged with the same `scenario`, then flip between sets:
```
create_mock { "urlPattern":"/api/user", "scenario":"happy", "body":"{\"ok\":true}" }
create_mock { "urlPattern":"/api/user", "scenario":"error", "status":500, "body":"{\"e\":1}" }
activate_scenario { "name": "error", "exclusive": true }   // enables 'error', disables others
deactivate_scenario { "name": "error" }
list_scenarios
```

## 4. Dynamic test case (inline) — sequenced flow
> "Case 5: detail errors first, then succeeds after refresh."
```
create_case {
  "name": "case 5",
  "autoAdvance": true,
  "endpoints": [
    { "method":"POST", "urlPattern":"/api/login",  "steps":[ {"label":"ok","status":200,"body":"{\"token\":\"t\"}"} ] },
    { "method":"GET",  "urlPattern":"/api/detail",  "steps":[ {"label":"error","status":500,"body":"{\"e\":1}"}, {"label":"ok","status":200,"body":"{\"detail\":\"ok\"}"} ] },
    { "method":"GET",  "urlPattern":"/api/product", "steps":[ {"label":"p2","status":200,"body":"{\"product\":2}"} ] }
  ]
}
activate_case { "id": "<caseId>" }     // returns/see id from create_case or list_cases
```
Now through the proxy: `GET /api/detail` returns 500 on the 1st call, 200 on the
2nd (auto-advance). `GET /api/product` returns product 2.

## 5. File-based test cases — one folder per case
Cases under `test-cases/<name>/` (see the repo examples `case1-userA`,
`case2-userB`). Each step reads its body from a file. After editing files:
```
reload_cases                                   // load folders from disk
list_cases                                     // ids look like "file:case2-userB"
activate_case { "id": "file:case2-userB" }
```
`case2-userB` maps 3 APIs; its `PUT /api/detail/name` returns ok then a 422 error
on the next call.

## 6. Driving a flow (multiple test cases in one run)
> "Run case 1, then switch to case 2, watching each step."
```
list_cases                                     // see all cases + which is active
activate_case { "id": "file:case1-userA" }     // exclusive: switching auto-disables the other
case_status                                    // { active, cursors: { "GET /api/detail": 0, ... } }
next_step { "pattern": "/api/detail" }          // manually advance one endpoint (or all if no pattern)
goto_step { "pattern": "/api/detail", "index": 0 }
reset_case                                      // restart the whole flow from step 0
activate_case { "id": "file:case2-userB" }     // switch cases
deactivate_case                                // back to static Map Local
```
- `autoAdvance:true` (default): each real request advances that endpoint's cursor.
- For step-by-step control, create the case with `autoAdvance:false` and use
  `next_step` / `goto_step` yourself.

## 7. Inspect traffic & control the device
```
proxy_info                                     // mitmproxy port, LAN IP, CA ready
list_devices                                   // adb devices + proxy state
connect_device { "serial":"<serial>", "method":"proxy", "mode":"usb" }
list_flows { "limit": 20 }                     // recent requests (compact)
get_flow { "id": "<flowId>" }                  // full request/response
clear_flows
disconnect_device { "serial":"<serial>" }
```

## Tips
- Activating any case/scenario **exclusively** replaces the previous active one —
  you never need to manually clear before switching.
- A test case takes precedence over static Map Local for matching requests.
- `case_status` is the quickest way to see where each endpoint's cursor is.
- File cases are read-only via tools — edit the files then `reload_cases`.
