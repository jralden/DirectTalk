# DirectTalk — Host/Client Roles + Always-On Session Table

**Date:** 2026-06-06
**Status:** Approved (design)

## Problem

Today every browser connecting to DirectTalk gets identical UI and behavior,
regardless of whether it is the Mac running the server ("host") or a LAN client.
There is also no way to delete a session from the UI — old sessions accumulate
and must be removed by hand (`rm sessions/<id>.jsonl`).

The host (primarily the project owner, while setting up family members' Macs and
debugging on their devices) needs lightweight management controls that clients do
not have: create and delete sessions. Clients should see the same session list
and be able to select/view any session, but not add or delete.

## Goals

- Give the host create/delete controls; clients get view-and-select only.
- Replace the two-screen picker→session flow with a single combined view so the
  session list is always visible.
- Add the long-pending "delete a session" capability (BACKLOG item 1).

## Non-Goals (YAGNI)

Rename, kick-client, read-only-client mode, message pinning, message counts,
real auth tokens/identity. This is a trusted-LAN tool for technical users.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | Stacked: table on top, transcript below, one page | Matches owner's mental model; list stays visible during a session |
| Table sync across machines | Poll `GET /api/sessions` every 3s | Simplest; trivial overhead on a tiny trusted LAN. Revisit if latency is felt |
| Role detection | Loopback = host (reuse existing `sideFor`) | Already implemented server-side; no new identity system |
| Delete confirmation | Browser `confirm()` | Good enough to prevent a one-click mistake |
| Table columns | Name + Created (no msg count) | Keeps the 3s poll cheap — no full-file reads |

## Architecture

### Role model

`sideFor(req)` already returns `'host'` for requests from `127.0.0.1` / `::1`
(loopback) and `'client'` for everything else. This same function drives both the
new `whoami` endpoint and server-side delete authorization.

**Known limitation (accepted):** "host" means "connected via loopback," not "is
the owner." If the owner opens the app via the machine's LAN IP instead of
`localhost`, they appear as a client. For the intended use (owner on the host at
`localhost`, family on client devices) this is fine.

### Server changes (`server.js`)

**`GET /api/whoami`** → `200 { "side": "host" | "client" }`. Returns
`sideFor(req)`. Placed alongside the other `/api` branches, before the static
route.

**`DELETE /api/sessions/:id`** — extend the existing
`/^\/api\/sessions\/([a-z0-9-]+)\/(stream|messages)$/` routing. Add a sibling
match for `DELETE` on `/api/sessions/:id` (no sub-path).

Behavior:
1. **Authorize (security):** if `sideFor(req) !== 'host'`, return `403
   { error: 'forbidden' }`. The client UI hides the ✕, but a client could still
   issue the request directly (`curl`), so the gate is enforced server-side. The
   loopback check is the entire authorization model for this tool; it must be
   enforced here, not only in CSS.
2. End any open SSE responses for that session: for each `res` in
   `subscribers.get(id)`, call `dropSubscriber(id, res)` then `res.end()`, so
   clients watching a deleted session do not sit on a dead stream.
3. Call `sessions.deleteSession(id)`. If it reports the session did not exist,
   return `404 { error: 'not found' }`.
4. On success return `200 { ok: true }` (JSON, consistent with the other API routes).

### Session store changes (`sessions.js`)

**`deleteSession(id)`** — new exported function:
- Validate `id` via the existing `sessionPath(id)` (throws on bad id).
- If the file does not exist, return `false`.
- `fs.rmSync(sessionPath(id))`, delete the `nextSeq` map entry for `id`, return
  `true`.

### Client changes (`index.html`)

**Combined single-page view.** Remove the picker-vs-session show/hide model. One
layout, top to bottom:

```
header  (DirectTalk title, role badge, connection status)
session table  (header row with "+ New" [host-only]; one row per session, each with ✕ [host-only])
transcript  (selected session's messages; empty-state hint when none selected)
composer  (textarea + Send; shown only when a session is selected)
```

**Role gating.** On load, `fetch('/api/whoami')` → set
`document.body.dataset.role = side`. CSS hides `+ New` and every `✕` when
`role="client"`. Default to `client` (most restrictive) if the fetch fails.

**Session table + polling.** Fetch `GET /api/sessions` on load and every 3s.
Diff-render: update the table without destroying the current selection
highlight, transcript scroll position, or in-progress text in the composer.
- A newly appeared session → new row.
- A disappeared session → row removed.
- If the **currently selected** session disappears → treat as "deleted out from
  under me" (see below).

**Selecting a session.** Clicking a row sets it active, highlights the row,
opens the SSE stream, and renders the transcript below (the existing
`openStream`/`appendLine` logic, retargeted into the combined view). The
composer becomes visible.

**Delete (host).** Clicking ✕ on a row →
`confirm("Delete session '<name>'? This removes its transcript permanently.")`.
On confirm, `DELETE /api/sessions/<id>`. On success, let the next poll drop the
row (or remove it immediately). If the deleted session was selected, fall back to
the no-selection empty state.

**Deleted-session handling.** If the selected session vanishes from a poll, or
its SSE stream returns a terminal error (the server ended it on delete): close
the stream, clear the transcript, hide the composer, and show the empty-state
hint. This single path covers both the host deleting their own active view and a
client watching a session the host deletes.

**Empty states.**
- No session selected: transcript area shows `Select a session above.`
- No sessions exist at all: table body shows `No sessions yet.` (host also sees
  `+ New`).

## Data Flow

1. Browser loads → `GET /api/whoami` sets role → `GET /api/sessions` fills table.
2. Every 3s → `GET /api/sessions` → diff-render table.
3. Click row → `GET /api/sessions/:id/stream` (SSE) → transcript renders.
4. Send → `POST /api/sessions/:id/messages` (unchanged).
5. Host `+ New` → `POST /api/sessions` (unchanged) → next poll shows it on all
   browsers.
6. Host ✕ → `confirm` → `DELETE /api/sessions/:id` → server ends subscribers +
   removes file → next poll drops the row everywhere.

## Error Handling

- `DELETE` from a client → `403`. UI never issues it (✕ hidden), but enforced
  regardless.
- `DELETE` unknown/already-deleted session → `404`.
- `whoami` fetch fails → default role `client` (hide host controls).
- Selected session deleted → graceful empty state, no error spew.
- Poll fetch fails transiently → keep the last-known table; retry next tick.

## Testing

New tests:
- `sessions.deleteSession`: deletes an existing file and returns `true`; returns
  `false` for a missing session; throws on an invalid id; clears `nextSeq`.
- `DELETE /api/sessions/:id`:
  - host (loopback) → `200`, file gone.
  - **client (non-loopback) → `403`, file untouched.**
  - missing session → `404`.
  - open SSE subscriber for the session is ended/pruned on delete.
- `GET /api/whoami` → returns `host` for loopback requests.

Existing server/sessions/stream/static tests remain valid; the public API only
gains endpoints. (`index.html` is not unit-tested today; the combined view is
verified manually.)

## Files Touched

- `server.js` — add `whoami` + `DELETE` routes.
- `sessions.js` — add `deleteSession`, export it.
- `index.html` — combined view, role gating, polling, delete UX.
- `test/` — new delete + whoami tests.
- `BACKLOG.md` — move "Delete a session" to Done.
