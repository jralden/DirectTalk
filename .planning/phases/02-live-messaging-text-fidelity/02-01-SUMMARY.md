---
phase: 02-live-messaging-text-fidelity
plan: 01
subsystem: api
tags: [node, http, sse, server-sent-events, messaging, ansi, zero-dependency]

# Dependency graph
requires:
  - phase: 01-server-session-persistence
    provides: "sessions.js (appendMessage/readSession/sessionPath/stripAnsi) + server.js route-dispatch handler"
provides:
  - "GET /api/sessions/:id/stream — SSE endpoint: replays stored transcript then pushes live messages"
  - "POST /api/sessions/:id/messages — appends a message, detects host/client by origin, broadcasts to subscribers"
  - "In-memory Map<sessionId, Set<res>> subscriber registry with broadcast, heartbeats, and close-cleanup"
  - "docs/lan-access.md — CONN-01 LAN reachability documentation"
affects: [phase-3-ui, browser-client, static-serving]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-Sent Events over node:http (text/event-stream, data: frames, comment heartbeats)"
    - "In-memory fan-out registry keyed by session id; subscriber removed on res 'close'"
    - "Role detection by req.socket.remoteAddress against a loopback host-address set"
    - "Single path regex match for /:id/(stream|messages) added before trailing 404"

key-files:
  created:
    - test/messages.test.js
    - test/stream.test.js
    - docs/lan-access.md
  modified:
    - server.js

key-decisions:
  - "Heartbeat interval 15s with hb.unref() so it never keeps the process alive"
  - "readSession null-guard returns 404 before append/subscribe (valid-shaped but nonexistent ids)"
  - "No double ANSI strip — appendMessage already strips; route passes raw text through"
  - "SSE test uses a real spawned server (port 5913) to exercise a genuine long-lived connection"

patterns-established:
  - "SSE: writeHead text/event-stream, replay loop over stored messages, then register res for live broadcast"
  - "broadcast() wraps each res.write in try/catch so one dead subscriber cannot crash a fan-out"

requirements-completed: [CONN-01, MSG-01, MSG-02, MSG-03, MSG-04, TXT-01]

# Metrics
duration: ~6min
completed: 2026-06-05
---

# Phase 2 Plan 01: Live Messaging & Text Fidelity Summary

**SSE stream endpoint (replay-then-live) plus a host/client-detecting message-append endpoint with an in-memory subscriber registry — text round-trips POST -> store -> SSE byte-for-byte with ANSI stripped, all on zero npm dependencies.**

## Performance

- **Duration:** ~6 min
- **Completed:** 2026-06-05
- **Tasks:** 3
- **Files modified:** 4 (1 modified, 3 created)

## Accomplishments
- `GET /api/sessions/:id/stream` replays the full stored transcript on connect, then keeps the connection open and pushes every new message live (MSG-03, MSG-01).
- `POST /api/sessions/:id/messages` appends a message, labels it `host` for loopback origins and `client` otherwise (MSG-02), then broadcasts to all SSE subscribers.
- In-memory `Map<sessionId, Set<res>>` registry with per-connection heartbeat and `res.on('close')` cleanup (bounded memory, no leaked intervals).
- ANSI stripping confirmed on this path (no double-strip) and multi-line + indentation proven byte-exact (MSG-04, TXT-01).
- `docs/lan-access.md` documents localhost (host) / `<host>.local` (clients) reachability and the all-interface bind (CONN-01).

## Task Commits

1. **Task 1: SSE stream + messages routes + subscriber registry** - `90c80ca` (feat)
2. **Task 2: in-process POST/role/404/ANSI/multiline tests** - `8595cfa` (test)
3. **Task 3: spawned-server SSE replay-then-live test + LAN doc** - `a1d5c87` (test)

## Files Created/Modified
- `server.js` - Added subscriber registry, `sideFor`/`broadcast` helpers, host-address set, and the stream + messages route branches; listen call unchanged (binds all interfaces).
- `test/messages.test.js` - 5 in-process tests: host labeling, 404, 400, ANSI strip, multiline fidelity.
- `test/stream.test.js` - 1 spawned-server test asserting event-stream + replay-before-live ordering.
- `docs/lan-access.md` - CONN-01 LAN access guide and all-interface-bind rationale.

## Decisions Made
- Heartbeat at 15s with `hb.unref()` so it never blocks process exit.
- 404 via `readSession` null-guard before append/subscribe for valid-shaped nonexistent ids.
- No double ANSI strip — `appendMessage` already strips internally.
- SSE verified against a real spawned process (not in-process) per plan's harness guidance.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None.

## Threat Flags
None — no new trust-boundary surface beyond the plan's threat model.

## Verification
- `node --test` — 21/21 pass (existing 13 + 5 messages + 1 stream + Phase-1 totals).
- `node --test test/messages.test.js` — 5/5 pass.
- `node --test test/stream.test.js` — 1/1 pass (replay-before-live ordering asserted against a spawned server).
- `grep -q '.local' docs/lan-access.md` and `grep -q 'text/event-stream' test/stream.test.js` — both pass.
- server.js + sessions.js use only `node:` stdlib requires (0 npm deps).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Data/transport layer is complete: any browser can POST text and any subscriber receives it live with correct attribution.
- Phase 3 (browser UI) can serve `index.html` from the same server and consume the SSE stream + messages endpoint directly — no rework of these routes needed.

## Self-Check: PASSED

- FOUND: server.js, test/messages.test.js, test/stream.test.js, docs/lan-access.md
- FOUND commits: 90c80ca, 8595cfa, a1d5c87

---
*Phase: 02-live-messaging-text-fidelity*
*Completed: 2026-06-05*
