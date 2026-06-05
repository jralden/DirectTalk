# Phase 3: Browser UI - Context

**Gathered:** 2026-06-06
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

Users on any Mac can pick or create a session, read the live transcript, send messages,
and see connection status — all in one browser page with zero install.

Covers requirements: UI-01, UI-02, UI-03, UI-04 — plus the *rendering* half of TXT-01
(monospace + `white-space: pre-wrap`, render text as text never HTML) which Phase 2
correctly deferred here since Phase 2 had no UI.

In scope: `index.html` (single-page UI: HTML + inline CSS + inline JS) and serving it from
the existing `server.js`. Wires the browser to the Phase 2 API (session list/create, SSE
stream, message POST).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss skipped per user setting.
Anchored by the approved spec (`docs/specs/2026-06-05-directtalk-design.md`) and the
existing server/API from Phases 1–2.

Locked by spec + prior phases:
- **Single file `index.html`** — HTML + inline CSS + inline JS. Zero build step, zero
  client dependencies (no React/bundler/CDN). Served by `server.js`.
- **Static serving:** add a route so `GET /` returns `index.html` (and serve its assets if
  any — but prefer fully inline so it's one file). Extend the existing route dispatcher;
  do not break the `/api/...` routes.
- **Session picker (UI-01):** on load, `GET /api/sessions` → list existing sessions (name +
  created date). A "New session" action prompts for a name, `POST /api/sessions`, then
  enters it. Entering a session opens its SSE stream.
- **Transcript pane (UI-02 + TXT-01 rendering):** scrollable; CSS `font-family: monospace`
  and `white-space: pre-wrap`. Render message text as **text, never HTML** — set via
  `textContent` (never `innerHTML`) to prevent injection and keep WYSIWYG. Each line shows
  side (`Host`/`Client`) + timestamp. Auto-scroll to bottom on new messages (respect the
  case where the user has scrolled up — acceptable to always auto-scroll for v1 simplicity,
  but pin-to-bottom only when already at bottom is nicer if cheap).
- **Entry box (UI-03):** `<textarea>` + Send button. Cmd+Enter (and Ctrl+Enter) sends.
  On send: `POST /api/sessions/:id/messages` with `{text}`. Clear the textarea on success;
  keep the text and surface an error on failure.
- **Connection status (UI-04):** an indicator reflecting SSE state — connected vs
  reconnecting. Use `EventSource` (auto-reconnects); update the indicator on `open` /
  `error` events. Use the `seq` field added in Phase 2 to dedupe replayed-vs-live messages
  at the connect boundary so no duplicate or lost line appears after a reconnect.
- **Role labeling:** the server already stamps `side` (host/client) per message; the UI
  just displays it. No client-side role logic.
</decisions>

<code_context>
## Existing Code Insights

- `server.js` — `node:http` route dispatch with `/api/sessions`, `/api/sessions/:id/stream`
  (SSE replay-then-live, `seq` on each record), `/api/sessions/:id/messages` (role by
  remoteAddress, append+broadcast). Helpers: `sendJson`, `readBody`. Add a static route for
  `/` → `index.html` using `fs.readFileSync`/stream + correct `Content-Type: text/html`.
- `sessions.js` — message records shaped `{type:"msg", side, text, ts, seq}`.
- The SSE event payload is `JSON.stringify(record)` (one `data:` line per record).
- Keep zero npm dependencies.
</code_context>

<specifics>
## Specific Ideas

- Dedupe on `seq` (or session-scoped max-seq seen) so a reconnect's replay does not
  re-append lines the client already has.
- Render timestamps in the viewer's local time, compactly.
- Keep the page usable without a session selected (show the picker); allow returning to the
  picker from inside a session.
- Escape nothing manually — rely on `textContent` for safety.
- Testing UI in a headless harness is limited; at minimum add a server test that `GET /`
  returns the HTML with `Content-Type: text/html`, and verify the existing API tests still
  pass. Manual browser verification (two Macs) is expected and will be flagged.
</specifics>

<deferred>
## Deferred Ideas

- Anything beyond v1 scope: message edit/delete, file transfer, auth, themes — all out of
  scope per PROJECT.md.
</deferred>
