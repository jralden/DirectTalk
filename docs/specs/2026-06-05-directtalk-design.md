# DirectTalk — Design Spec

**Date:** 2026-06-05
**Status:** Approved for planning

## Problem

When developing/debugging across two Macs on the same wifi network, moving text by
hand between them is slow and error-prone. Typical flow: Claude Code on the host Mac
emits multi-line bash; the operator hand-types it on a second Mac, runs it, then
hand-copies the results back into the Claude Code session. DirectTalk replaces the
hand-copying with a shared, append-only transcript both Macs can read and write.

## Constraints

- Two or more Macs on the same LAN. No internet dependency.
- No accounts, no third-party sign-ons, no shared credentials.
- Plain-text transcript: paste Claude Code output and terminal output; copy back out.
- Must preserve multi-line formatting and indentation (bash scripts, terminal dumps).
- Home network; trusted users. No access barrier required.

## Form Factor

Browser-based. The host Mac runs a small headless server; every participant — including
the host operator — uses the browser UI. Zero install on client Macs: they open a URL.

- Host Mac: opens `http://localhost:<PORT>` and also runs `server.js` in the background.
- Client Macs: open `http://<host>.local:<PORT>` (Bonjour/mDNS resolves `.local`
  automatically on the LAN — no IP entry needed).

## Architecture

Two files, one runtime (Node.js — already present on the host because Claude Code
requires it). No npm dependencies.

- **`server.js`** — Node `http` server. Serves the UI, manages sessions, relays messages.
- **`index.html`** — single-page browser UI (inline CSS + JS).

### Transport

Pure Node, SSE + POST (no WebSocket, no framework):

- Browsers receive transcript appends via Server-Sent Events (push-only; fits the
  append-only model). `EventSource` auto-reconnects on drop.
- Sending a message is a plain `POST`.

### Endpoints

- `GET /` — serves `index.html`.
- `GET /api/sessions` — list existing sessions (id, name, createdAt).
- `POST /api/sessions` — create a new session from `{ name }`; returns the session id.
- `GET /api/sessions/:id/stream` — SSE stream. On connect, replays the full stored
  transcript as events, then stays open and pushes live appends.
- `POST /api/sessions/:id/messages` — append `{ text }`. Server determines the side
  (Host/Client) from the request origin.

### Role detection

Automatic, by connection origin. Requests from `localhost` / `127.0.0.1` (the host Mac)
are labeled **Host**; all others are labeled **Client**. No role-picker UI. If more than
one client connects, all clients share the **Client** label (acceptable for the 1:1
debugging workflow).

## Data Model & Persistence

One append-only JSONL file per session: `sessions/<id>.jsonl`.

- Line 1: meta record — `{ "type": "meta", "name": <string>, "createdAt": <iso8601> }`.
- Subsequent lines: message records —
  `{ "type": "msg", "side": "host"|"client", "text": <string>, "ts": <iso8601> }`.

Append-only avoids rewrite races and is crash-safe. The session list is built by scanning
`sessions/` and reading each file's meta line. Resuming a session reads the file and
replays it over the SSE stream. Transcripts survive server restarts. The host Mac is the
hub: when its server is off, no session is live.

Session id: derived from the name plus creation timestamp (slugified, collision-safe).

## Text Handling

- Stored and rendered as plain text — never interpreted as HTML (no injection, WYSIWYG).
- Transcript pane uses a monospace font and `white-space: pre-wrap` so multi-line scripts
  and terminal output keep line breaks and indentation.
- Incoming text is stripped of ANSI escape sequences (e.g. color codes like `\x1b[32m`)
  server-side before storage, so terminal output renders cleanly.
- Full UTF-8 (emoji, accents, box-drawing characters).

## UI

Single page, three states:

1. **Session picker** — list existing sessions (name + created date); "New session"
   creates one by name and enters it.
2. **Transcript view** — scrollable pane, monospace, `pre-wrap`, auto-scrolls to bottom
   on new messages. Each entry prefixed with `Host` / `Client` and a timestamp.
3. **Entry box** — textarea + Send button; Cmd+Enter sends. On send: POST, then clear
   the box. A connection-status indicator (connected / reconnecting) is always visible.

## Error Handling

- `EventSource` auto-reconnects when the host Mac sleeps or the server restarts; the
  status indicator reflects the current state.
- A failed POST keeps the text in the entry box and surfaces an error.
- The server tolerates malformed requests and file I/O errors without crashing.

## Configuration

- Port: default `5757`, overridable via env var (e.g. `PORT`) or CLI arg.
- Sessions directory: `sessions/` relative to the server, created on first run.

## Security Note (accepted trade-off)

No access barrier: anyone on the LAN who knows the URL can read and post to a session,
and session files sit unencrypted on disk. Transcripts may contain paths, hostnames, or
tokens surfaced during debugging. Accepted for trusted home-network use.

## Testing

- Unit: session create/list, message append, ANSI stripping, SSE replay of a stored
  transcript.
- Manual: two browsers on two Macs — send both directions; restart the server
  mid-session and confirm resume replays the transcript; confirm multi-line paste
  preserves formatting.

## Effort

Small — roughly 250–400 lines total across the two files. No novel technology; low risk.

## Out of Scope (YAGNI)

- Accounts, auth, encryption.
- Editing or deleting transcript messages.
- File/image transfer.
- Internet/remote (non-LAN) access.
- Multiple distinct client identities (all clients share the "Client" label).
