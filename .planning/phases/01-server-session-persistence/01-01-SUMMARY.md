---
phase: 01-server-session-persistence
plan: 01
subsystem: server-core
tags: [node, http, jsonl, persistence, zero-dependency]
requires: []
provides:
  - "sessions.js persistence module (createSession/listSessions/appendMessage/readSession + helpers)"
  - "server.js node:http server with route-dispatch and JSON helpers"
  - "GET /api/sessions, POST /api/sessions endpoints"
affects: []
tech-stack:
  added: []
  patterns:
    - "Zero-dependency Node stdlib only (node:http, node:fs, node:path)"
    - "Append-only JSONL per session (meta line + msg lines)"
    - "Route dispatch in single handler, extensible by Phase 2/3"
key-files:
  created:
    - sessions.js
    - server.js
    - test/sessions.test.js
    - test/server.test.js
    - test/restart.test.js
    - .gitignore
  modified: []
decisions:
  - "Server-side slugify(name)+Date.now() ids with -N collision suffix; no client id reaches filesystem"
  - "1MB body cap via req.destroy; handler wrapped in try/catch -> 500 so process never crashes"
  - "server.js exports the http.Server and only listens under require.main === module so tests bind ephemeral ports"
metrics:
  duration: ~5m
  completed: 2026-06-05
  tasks: 3
  files: 6
requirements: [SRV-01, SRV-02, SESS-01, SESS-02, SESS-03]
---

# Phase 1 Plan 01: Server & Session Persistence Summary

Zero-dependency Node server foundation: a JSONL session-persistence module plus a
node:http server that creates and lists named sessions, with restart-survival proven
end-to-end against a real spawned server process.

## What Was Built

- **sessions.js** — append-only JSONL persistence. `sessions/<id>.jsonl`, line 1 is a
  `{type:"meta", name, createdAt}` record; later lines are `{type:"msg", side, text, ts}`
  records (consumed by Phase 2). Tolerant readers skip empty/unparseable lines.
- **server.js** — `node:http` server, `PORT||5757`, bootstraps `sessions/` on start,
  route-dispatch handler, `sendJson`/`readBody` helpers, full try/catch -> 500.
- **test/** — `sessions.test.js` (7), `server.test.js` (5), `restart.test.js` (1). 13/13 pass.
- **.gitignore** — ignores `sessions/` (runtime data) and `node_modules/`.

## sessions.js Public Interface (for Phase 2/3 consumers)

```js
const SESSIONS_DIR;                         // path.join(__dirname,'sessions')
ensureSessionsDir();                        // -> void ; mkdir -p, idempotent
sessionPath(id);                            // -> string ; SESSIONS_DIR/<id>.jsonl
createSession(name);                        // -> { id, name, createdAt } ; writes meta line
listSessions();                             // -> Array<{id,name,createdAt}> ; newest-first
appendMessage(id, side, text);              // -> { type:'msg', side, text, ts } ; Phase 2 use
readSession(id);                            // -> { meta:{id,name,createdAt}, messages:[] } | null
```

## server.js Route-Dispatch Shape

Single `async (req,res)` handler wrapped in try/catch. `new URL(req.url,...)` -> `pathname`.
Cases: `GET /api/sessions` -> 200 list; `POST /api/sessions` -> validate `{name}` (400 on
malformed/empty), `createSession` -> 201; else 404; catch -> 500. Phase 2/3 add routes by
adding cases (e.g. `/api/sessions/:id/stream`, `/api/sessions/:id/messages`, `GET /`).
`module.exports = server`; listens only under `require.main === module`.

## Threat Mitigations Applied

- T-01-01/02: JSON.parse in try/catch, blank-name rejection (400), 1MB body cap (req.destroy).
- T-01-03: ids generated server-side via slugify (alphanumeric + `-`) + Date.now(); no
  client id reaches the filesystem this phase.
- T-01-04: handler try/catch -> 500 JSON; verified server stays alive after a bad body.

## Verification

- `node --test` — 13/13 pass.
- `PORT=5757 node server.js` prints `DirectTalk listening on http://localhost:5757`; `sessions/` created.
- `git status` lists nothing under `sessions/` (ignored).
- server.js and sessions.js use only `node:` stdlib requires (0 npm deps).
- restart.test.js: session created against instance A persists and is listed by a fresh
  instance B after SIGTERM (SESS-03), no orphan process on the test port.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: sessions.js, server.js, .gitignore
- FOUND: test/sessions.test.js, test/server.test.js, test/restart.test.js
- FOUND commits: fab8d80, 0490280, 23922ea
