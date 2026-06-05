---
phase: 03-browser-ui
reviewed: 2026-06-06T00:00:00Z
depth: deep
files_reviewed: 3
files_reviewed_list:
  - index.html
  - server.js
  - test/static.test.js
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-06-06
**Depth:** deep (cross-file: index.html ↔ server.js ↔ sessions.js)
**Files Reviewed:** 3 (index.html, server.js static route, test/static.test.js)
**Status:** issues_found

## Summary

The Phase 3 browser UI is solid on the headline risks. The #1 concern — XSS — is
correctly mitigated: every server-provided string (message text, session name,
side label, timestamp, error messages) is rendered via `textContent` / DOM
`createTextNode`, never `innerHTML`. The static `GET /` route serves a fixed
`__dirname`/index.html path with no user input in the path, so there is no
traversal surface, and it is placed after all `/api` branches so it cannot shadow
an API route. SSE wiring closes the previous `EventSource` before opening a new
one (no listener/connection leak), and `maxSeq` resets to `-1` on session entry,
so seq dedupe is correct across reconnects for the documented connect-boundary
duplicate.

No BLOCKERs found. The findings below are correctness/robustness gaps. The most
important (WR-01) is a cross-file concurrency bug: two messages posted at the same
instant get the same `seq`, which the client dedupe then silently drops in the
live view. Its root cause is in Phase 2 `sessions.js`, but it defeats the Phase 3
dedupe contract, so it is in scope to report.

## Warnings

### WR-01: Concurrent posts get duplicate `seq` → client dedupe drops the second message live

**File:** `sessions.js:108-118` (root cause) → defeats `index.html:304` (dedupe)
**Issue:** `appendMessage` derives `seq` non-atomically: it calls
`countMessages(id)` (read), then `fs.appendFileSync` (write). If the Host and a
Client POST at nearly the same time, both read the same count `N`, both write a
record with `seq = N`, and `broadcast` sends two distinct messages both carrying
`seq = N`. The client renders the first (`maxSeq = N`) and then drops the second
because `N <= maxSeq` is true (`index.html:304`). The lost message reappears only
after a reconnect, because `readSession` re-derives `seq` positionally on replay.
This is exactly the two-way simultaneous-send case the tool is built for, and the
seq contract in `03-01-PLAN.md` ("monotonic per session") is violated.
**Fix:** Make seq assignment atomic with the append. Simplest: maintain an
in-memory `Map<id, number>` next-seq counter in `sessions.js`, seeded lazily from
`countMessages` on first use, incremented under the (single-threaded) Node event
loop before each `appendFileSync` — no two appends can interleave between the read
and the increment since neither yields. Alternatively, on the client, dedupe by a
composite key (e.g. `seq + '|' + ts + '|' + side`) instead of a single monotonic
`maxSeq`, so equal-seq distinct records both render. Prefer the server fix.

### WR-02: `sendMessage` does not guard against a stale/null `currentId`

**File:** `index.html:340-364`
**Issue:** `sendMessage` posts to `/api/sessions/' + currentId + '/messages'`
without checking `currentId`. The keydown handler (`index.html:370-376`) is bound
to `entry`, which lives only in the session view, so today this is reachable only
with a valid `currentId`. But the coupling is implicit: any future change that
lets the textarea retain focus across `leaveSession` (which sets `currentId = null`,
`index.html:270`) would POST to `/api/sessions/null/messages`. That fails the
server id regex `^[a-z0-9-]+$`, returns 404, and surfaces "Send failed" with the
text kept — not a crash, but a confusing dead-end.
**Fix:** Early-return if no active session:
```js
function sendMessage() {
  if (!currentId) return;
  var text = entry.value;
  if (text.length === 0) return;
  ...
}
```

### WR-03: Connection status is not reset to a neutral state on leave / can mislead

**File:** `index.html:268-277, 284-308`
**Issue:** `leaveSession` calls `closeStream()` (which only `es.close()`s) and
hides `statusEl`, but never resets its text/class. `closeStream` itself never
updates the indicator. The deliberate `es.close()` on leave does not fire
`onerror`, so that is fine — but if the user re-enters a session, `openStream`
sets "reconnecting" then "connected", so the stale class is overwritten. The real
gap: `onerror` fires for a genuine 404 (deleted/unknown session) the same as for a
transient drop, so a permanently-dead stream shows "reconnecting" forever with no
escalation. For a LAN debugging tool that is borderline acceptable, but it can
mask a real failure (e.g. session file removed) as a transient blip.
**Fix:** Distinguish terminal failure from reconnect. EventSource exposes
`es.readyState === EventSource.CLOSED` in `onerror` when it has given up:
```js
es.onerror = function () {
  if (es.readyState === EventSource.CLOSED) setStatus('disconnected');
  else setStatus('reconnecting');
};
```
At minimum, reset the indicator text in `closeStream()` so a hidden-then-shown
indicator never displays a stale state for one frame.

## Info

### IN-01: `test/static.test.js` re-binds the shared server singleton (latent, not currently failing)

**File:** `test/static.test.js:11-18` (and `test/server.test.js:15-20`)
**Issue:** Both files `require('../server')` — the same exported `http.Server`
instance — and each independently calls `server.listen(0)` in `before` and
`server.close()` in `after`. This passes today only because `node --test`
isolates each test file in its own child process. If the suite is ever run
in-process (e.g. a single combined entry file, or a future `--test` mode that
shares a process), the second `listen` throws `ERR_SERVER_ALREADY_LISTEN` /
the second `close` throws "Server is not running." The test is silently coupled
to the runner's process-isolation behavior.
**Fix:** Either create a fresh `http.createServer(handler)` per test file
(requires exporting `handler`), or have a single shared setup module own the
listen/close lifecycle. Low priority while the default runner is used.

### IN-02: Initial status shows "reconnecting" (red) before the first connect, not "connecting"

**File:** `index.html:293`
**Issue:** `openStream` sets `setStatus('reconnecting')` before the first
connection is even attempted, so on session entry the user briefly sees the red
"reconnecting" badge rather than a neutral "connecting". The plan explicitly
allows this ("connecting/reconnecting is fine"), so this is cosmetic, but the red
styling on first load can read as an error.
**Fix:** Add a `connecting` state used only for the initial open:
`setStatus('connecting')` in `openStream`, styled neutral (not red), then
`onerror` uses `reconnecting`.

### IN-03: `text.length === 0` send-guard rejects empty but allows whitespace-only — verify intent

**File:** `index.html:341-342`
**Issue:** The client blocks only truly empty text (`length === 0`), allowing a
message of a single newline or spaces. This matches the server (`server.js:165`
rejects only `length === 0`, deliberately not trimming, to preserve multi-line
fidelity). So client and server agree — flagged only to confirm the asymmetry is
intentional (it is, per the plan's multi-line-fidelity requirement). No fix
needed; documenting the deliberate non-trim for future maintainers.

### IN-04: `index.html` is read from disk on every `GET /` request

**File:** `server.js:190`
**Issue:** `fs.readFileSync` runs per request. The plan explicitly accepts this
(threat T-03-03: LAN-only, tiny file, no caching needed), so this is in-scope
acknowledged debt, not a defect. Noted only because a synchronous read in the
request handler blocks the event loop; harmless at this scale, worth revisiting
if the file grows or load increases. Out of v1 performance scope; no action.

---

_Reviewed: 2026-06-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
