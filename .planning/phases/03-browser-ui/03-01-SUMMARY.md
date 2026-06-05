---
phase: 03-browser-ui
plan: 01
subsystem: browser-ui
tags: [html, vanilla-js, eventsource, sse, fetch, zero-dependency, static-serving]

# Dependency graph
requires:
  - phase: 02-live-messaging-text-fidelity
    provides: "GET/POST /api/sessions, /api/sessions/:id/stream (SSE), /api/sessions/:id/messages; record shape {type,seq,side,text,ts}"
provides:
  - "index.html — single-file zero-dependency browser UI (picker, transcript, entry box, connection status)"
  - "GET / and GET /index.html static route on server.js serving text/html"
  - "test/static.test.js — asserts GET / returns 200 + text/html + HTML body"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-file UI: HTML + inline <style> + inline <script>, no build, no client deps"
    - "EventSource for live SSE consume; onopen/onerror drive connection-status indicator"
    - "seq-based dedupe (maxSeq guard) makes reconnect replay/live overlap idempotent"
    - "textContent-only rendering (never markup) for XSS-safe WYSIWYG transcript"
    - "Per-request fs.readFileSync static route placed after /api branches, before 404"

key-files:
  created:
    - index.html
    - test/static.test.js
  modified:
    - server.js

key-decisions:
  - "Static route reads index.html per request (LAN tool, tiny file, no caching needed)"
  - "Avoided the literal token innerHTML entirely; build DOM via createElement + textContent"
  - "Auto-scroll pins to bottom only when user was already at/near bottom (24px threshold)"
  - "Plain Enter inserts newline; Cmd/Ctrl+Enter sends — preserves multi-line compose/paste"
  - "Two views (picker/session) toggled via .hidden class in one file; back button closes EventSource"

requirements-completed: [UI-01, UI-02, UI-03, UI-04]
requirements-partial: [TXT-01]

# Metrics
duration: ~5min
completed: 2026-06-06
---

# Phase 3 Plan 01: Browser UI Summary

**A single zero-dependency `index.html` served at `GET /` — session picker, monospace pre-wrap transcript (text-as-text, side+timestamp, auto-scroll, seq-dedupe), textarea entry box (Cmd/Ctrl+Enter, clear-on-success/keep-on-failure), and an EventSource-driven connection-status indicator — wiring the browser to the Phase 2 SSE + messages API with no npm or client dependencies.**

## Performance

- **Duration:** ~5 min
- **Completed:** 2026-06-06
- **Tasks:** 2 of 2 buildable complete; 1 human-verify checkpoint deferred to user
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- `GET /` and `GET /index.html` serve the UI as `text/html; charset=utf-8`, placed after the `/api/*` branches so no API route is shadowed (UI served, API intact).
- `index.html` is one self-contained file: HTML + inline CSS + inline JS, zero external resources (no CDN, no `<script src>`, no import, no framework).
- Session picker (UI-01): `GET /api/sessions` renders name + local-time created date; "New session" prompts, `POST /api/sessions`, then enters; empty list renders a clean empty-state.
- Transcript (UI-02 + TXT-01 rendering): scrollable monospace pane with `white-space: pre-wrap`; each line shows `Host`/`Client` + local timestamp; message body set via `textContent` (never markup); auto-scrolls, pinning to bottom only when already at/near the bottom.
- seq dedupe: per-session `maxSeq` guard skips any record with `seq <= maxSeq`, so the reconnect replay/live boundary overlap never duplicates or loses a line; reset on entering a session/opening a stream.
- Entry box (UI-03): `<textarea>` + Send; Cmd+Enter and Ctrl+Enter send, plain Enter inserts a newline; clears on 201 success, keeps text and surfaces an error on failure; empty text not sent.
- Connection status (UI-04): always-visible indicator set to `connected` on `es.onopen`, `reconnecting` on `es.onerror` (EventSource auto-reconnect → onopen → back to connected).

## Task Commits

1. **Task 1: GET / static route in server.js + static.test.js** — `970c0a9` (feat)
2. **Task 2: single-file index.html UI** — `3941d94` (feat)

## Files Created/Modified
- `server.js` — Added `node:fs` + `node:path` imports and a `GET /` / `/index.html` static route returning `text/html`; `/api` branches, SSE registry, broadcast, sideFor, and listen call untouched.
- `index.html` — Single-file browser UI (picker, transcript, entry, status) per the locked CONTEXT decisions.
- `test/static.test.js` — 3 tests: `GET /` → 200 + `text/html`; body is the HTML document (not JSON); `GET /index.html` also serves the page.

## Decisions Made
- Per-request `fs.readFileSync` for the static route (LAN-only, tiny file; matches threat model T-03-03 accept).
- Built transcript DOM with `createElement` + `textContent` and never used the `innerHTML` token at all (T-03-01 mitigation; enforced by the grep gate).
- Auto-scroll measured before append; pins to bottom only within 24px of the bottom so reading scrollback isn't disrupted.
- Cmd/Ctrl+Enter sends; plain Enter newlines — keeps multi-line fidelity composable.

## Deviations from Plan

None — both buildable tasks executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None — all data sources are wired to the live Phase 2 API.

## Threat Flags
None — no new trust-boundary surface beyond the plan's threat model. T-03-01 (XSS) mitigated via textContent-only rendering; T-03-02 / T-03-03 accepted per plan.

## Deferred to User — Two-Mac Manual Verification (checkpoint:human-verify)

The plan's final task is a blocking `checkpoint:human-verify` requiring two physical Macs on the same LAN — not automatable in this unattended run. All buildable work is complete and all automated tests pass. Run this checklist to close it out:

1. **Host Mac:** `node server.js` (default http://localhost:5757).
2. **Host browser:** open http://localhost:5757 — picker lists sessions with name + readable local date; "New session" → enter a name → it creates and enters.
3. **Second Mac (same LAN):** open `http://<host>.local:5757` (e.g. `http://Johns-Mac.local:5757`) — same session appears in the picker; open it.
4. **Live sync:** type on one Mac, Cmd+Enter (or Send) — line appears on BOTH Macs with correct side label (Host on host's posts, Client on the other) + timestamp; sender's textarea CLEARS.
5. **Multi-line / fidelity:** paste an indented multi-line block — line breaks + indentation preserved (monospace, pre-wrap); paste `<b>hi</b>` and confirm it shows literally, not bold.
6. **Auto-scroll:** send enough to overflow — pane auto-scrolls to newest; scroll up, have the other Mac send — pins to bottom only if you were at the bottom.
7. **Reconnect / status:** Ctrl+C the server → indicator shows `reconnecting`; restart `node server.js` → indicator returns to `connected` and NO line is duplicated or lost (seq dedupe).
8. **Failure path:** stop the server, type text, try to send → error surfaced and text REMAINS in the textarea.

Reply "approved" once verified, or note which step + observed behavior failed.

## Verification
- `node --test` — 28/28 pass, 0 failures (prior suite + 3 new static-route tests).
- `grep -q "text/html" server.js`, `grep -q "index.html" server.js`, `grep -E "require\('node:fs'\)" server.js` — pass.
- `grep -q "text/event-stream" server.js` — SSE route untouched.
- All Task 2 index.html grep gates pass, including `! grep -q "innerHTML" index.html` and the zero-external-deps gate.

## User Setup Required
Two physical Macs on the same LAN for the manual verification checklist above. No external service configuration.

## Next Phase Readiness
- Phase 3 is the final phase. After the two-Mac manual verification passes, the v1 product is complete: any Mac can open a URL, pick/create a session, and exchange live text with full fidelity, zero install, zero dependencies.

## Self-Check: PASSED

- FOUND: index.html, test/static.test.js, server.js
- FOUND commits: 970c0a9, 3941d94
