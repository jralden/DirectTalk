# Roadmap — DirectTalk

Derived from `.planning/REQUIREMENTS.md` and `docs/specs/2026-06-05-directtalk-design.md`.

**Granularity:** coarse
**Phases:** 3
**Coverage:** 14/14 v1 requirements mapped

## Phases

- [x] **Phase 1: Server & Session Persistence** - Zero-dependency Node server with session create/list/resume backed by append-only JSONL
- [ ] **Phase 2: Live Messaging & Text Fidelity** - SSE relay with role detection, transcript replay, ANSI stripping, and LAN access
- [ ] **Phase 3: Browser UI** - Single-page UI: session picker, transcript pane, entry box, connection-status indicator

## Phase Details

### Phase 1: Server & Session Persistence
**Goal**: A zero-dependency Node server runs on the host Mac, manages named sessions, and persists them to disk so they survive a restart.
**Depends on**: Nothing (first phase)
**Requirements**: SRV-01, SRV-02, SESS-01, SESS-02, SESS-03
**Success Criteria** (what must be TRUE):
  1. Running `node server.js` starts an HTTP server on port 5757 (overridable) with no `npm install` and creates `sessions/` on first run.
  2. A POST to `/api/sessions` with a name creates a new session and writes a JSONL meta line to `sessions/<id>.jsonl`.
  3. A GET to `/api/sessions` returns the list of existing sessions (id, name, createdAt) by scanning `sessions/`.
  4. After stopping and restarting the server, previously created sessions and their stored messages are still present and readable.
**Plans**: 1 plan
- [x] 01-01-PLAN.md — sessions.js persistence module + node:http server (create/list sessions, JSONL persistence, restart survival)

### Phase 2: Live Messaging & Text Fidelity
**Goal**: Text posted from any browser appears live in every connected browser, intact and correctly attributed, with terminal output rendered cleanly.
**Depends on**: Phase 1
**Requirements**: CONN-01, MSG-01, MSG-02, MSG-03, MSG-04, TXT-01
**Success Criteria** (what must be TRUE):
  1. A message POSTed to a session is pushed live over SSE to every browser connected to that session.
  2. On connecting to a session's SSE stream, the full stored transcript replays before any new live messages arrive.
  3. Messages originating from `localhost`/`127.0.0.1` are labeled Host; all others are labeled Client.
  4. ANSI escape codes in incoming text are stripped before storage and display, and multi-line text retains its line breaks and indentation.
  5. The host reaches the server via `localhost` and client Macs reach it via `<host>.local` on the LAN with no IP entry.
**Plans**: TBD

### Phase 3: Browser UI
**Goal**: Users on any Mac can pick or create a session, read the live transcript, send messages, and see connection status — all in one browser page with zero install.
**Depends on**: Phase 2
**Requirements**: UI-01, UI-02, UI-03, UI-04
**Success Criteria** (what must be TRUE):
  1. The session picker lists existing sessions (name + created date) and offers a "new session" action that creates and enters a session.
  2. The transcript pane is scrollable, monospace with `white-space: pre-wrap`, renders text as text (never HTML), shows side + timestamp per line, and auto-scrolls on new messages.
  3. The entry box (textarea + Send, Cmd+Enter to send) clears on a successful send and keeps the text on a failed send.
  4. A connection-status indicator shows connected / reconnecting state and updates as the SSE connection drops and recovers.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Server & Session Persistence | 1/1 | Complete | 2026-06-05 |
| 2. Live Messaging & Text Fidelity | 0/0 | Not started | - |
| 3. Browser UI | 0/0 | Not started | - |

---
*Last updated: 2026-06-05 after phase 1 plan 01 execution*
