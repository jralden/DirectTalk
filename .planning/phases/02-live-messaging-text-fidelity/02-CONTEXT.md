# Phase 2: Live Messaging & Text Fidelity - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Text posted from any browser appears live in every connected browser, intact and correctly
attributed, with terminal output rendered cleanly.

Covers requirements: CONN-01, MSG-01, MSG-02, MSG-03, MSG-04, TXT-01.

In scope: the SSE stream endpoint, the message-append endpoint, in-memory subscriber
fan-out, transcript replay on connect, Host/Client role detection by connection origin,
ANSI stripping at the message boundary, and byte-faithful text handling end to end.
Verifiable with `curl` (SSE) + the existing test harness. No browser UI yet (Phase 3).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss skipped per user setting.
Anchored by the approved spec (`docs/specs/2026-06-05-directtalk-design.md`) and Phase 1's
existing `server.js` / `sessions.js`.

Locked by spec + Phase 1:
- Build on the existing `node:http` server (route-dispatch shape) and `sessions.js`
  (`appendMessage`, `readSession` already exist and are tested). No npm dependencies.
- **SSE stream:** `GET /api/sessions/:id/stream` — set `Content-Type: text/event-stream`,
  `Cache-Control: no-cache`, `Connection: keep-alive`; on connect, replay the full stored
  transcript as SSE events (MSG-03), then keep the connection open and push new appends
  live (MSG-01). Register the response in an in-memory `Map<sessionId, Set<res>>`; remove on
  `close`. Send periodic comment heartbeats (e.g. `:\n\n`) to keep connections alive.
- **Message append:** `POST /api/sessions/:id/messages` with `{text}`. The server determines
  the side (MSG-02): remote address `127.0.0.1` / `::1` / `::ffff:127.0.0.1` → `host`,
  else `client`. Append via `sessions.js` `appendMessage(id, {side, text, ts})`, then
  broadcast the new message to all subscribers of that session.
- **ANSI stripping (MSG-04):** already applied inside `sessions.js appendMessage` (added in
  Phase 1 hardening). Confirm it runs on this path; do not double-strip. Stored text is the
  stripped form, which is what gets broadcast and replayed.
- **Text fidelity (TXT-01, criterion 4):** preserve line breaks and indentation byte-for-byte
  through POST → store → SSE. JSONL stores text with `\n` escaped by `JSON.stringify`; ensure
  multi-line input round-trips exactly. (The monospace + `white-space: pre-wrap` *rendering*
  is Phase 3 UI; this phase guarantees the data/transport layer never mangles whitespace.)
- **LAN reachability (CONN-01):** the server must accept connections from other Macs so
  `<host>.local` resolves to it — bind to all interfaces (Node's `server.listen(port)`
  default binds `::`/`0.0.0.0`, which is correct; do not bind to `127.0.0.1` only). Verify
  the listen call does not restrict the host. `.local` name resolution is provided by macOS
  Bonjour/mDNS — no app code required; this is primarily a verification/doc item.
</decisions>

<code_context>
## Existing Code Insights

- `server.js` — `node:http` server, `PORT||5757`, route-dispatch handler, `sendJson`/
  `readBody` helpers, `sessions/` bootstrap, 400/500 resilience, 1MB body cap.
- `sessions.js` — `createSession`, `listSessions`, `appendMessage` (ANSI-stripped, rejects
  unknown sessions, validated ids), `readSession`. JSONL append-only persistence.
- Extend the existing route dispatcher; reuse the helpers. Keep the SSE subscriber registry
  in `server.js` module scope. Structure so Phase 3 can serve `index.html` from the same
  server without rework.
</code_context>

<specifics>
## Specific Ideas

- Clean up SSE subscribers on client disconnect to avoid leaks (listen for `res` `close`).
- Heartbeat interval to survive idle proxies / sleeping clients; clear it on disconnect.
- Validate `:id` against an existing session (reuse `sessions.js` validation) — 404 on unknown.
- Keep message records shaped `{type:"msg", side, text, ts}` so Phase 3 renders side+timestamp.
</specifics>

<deferred>
## Deferred Ideas

- Browser UI, static serving of `index.html`, `pre-wrap` monospace rendering, auto-scroll,
  connection-status indicator → Phase 3.
</deferred>
