---
phase: 02-live-messaging-text-fidelity
reviewed: 2026-06-05T00:00:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - server.js
  - sessions.js
  - test/messages.test.js
  - test/stream.test.js
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-06-05
**Depth:** deep (cross-file: server.js handler -> sessions.js contract)
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 2 adds the SSE stream endpoint, the message POST endpoint, an in-memory
subscriber registry, heartbeats, and disconnect cleanup. The core mechanics are
mostly sound: subscriber Set cleanup on `res.on('close')` clears the heartbeat
interval and removes empty Map entries, broadcast writes are try/catch-wrapped,
and the `:id` regex constrains input so no unsafe id reaches `sessions.js`.

One real BLOCKER: a **replay/live race** drops messages that arrive while a new
subscriber is mid-connect. There are four WARNING-level robustness/correctness
issues and two INFO items.

**Explicitly checked and NOT a bug — SSE multi-line `data:` framing.** The
flagged concern (raw newlines in `data:` breaking the frame) does not apply here
because the payload is `JSON.stringify(rec)`, which escapes `\n` to the two
characters `\` + `n`. Verified: `JSON.stringify({text:"a\nb"})` contains no raw
newline, so each record is exactly one `data:` line followed by the `\n\n`
terminator. Framing is correct. (Were the server ever to emit raw `text` instead
of JSON, this would become a BLOCKER — see IN-02.)

## Critical Issues

### CR-01: Replay/live race drops messages that arrive during connect

**File:** `server.js:79-90`
**Issue:** The stream handler reads the transcript snapshot from disk
(`sessions.readSession(id)`, line 79) and replays it (lines 86-88) BEFORE adding
the response to the subscriber registry (lines 89-90). A `POST .../messages` that
lands in that window is:

1. NOT in the disk snapshot already captured on line 79 (read happened first), and
2. NOT delivered by `broadcast` (line 124), because the subscriber Set does not
   yet contain `res`.

The message is therefore **permanently lost for that subscriber** — it never
appears in replay and never arrives live. This violates the must-have "Connecting
to a session's SSE stream replays the full stored transcript before any live
message" (no gap allowed) and the core promise that a posted message reaches all
subscribers. The existing test (`test/stream.test.js`) does not catch it because
it serializes connect-then-post; the race only fires under concurrent POST during
connect.

**Fix:** Register the subscriber BEFORE reading/replaying so no live message is
missed, then dedupe replay against anything already pushed. Simplest correct
ordering — register first, snapshot after, and dedupe by a monotonic key:

```js
if (req.method === 'GET' && sub === 'stream') {
  if (!sessions.readSession(id)) return sendJson(res, 404, { error: 'not found' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Register FIRST so concurrent appends are queued as live frames...
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id).add(res);

  // ...then snapshot + replay. A message that slipped in between may be
  // delivered twice; dedupe on the client, or gate replay so live frames
  // are buffered until replay completes. Choose one and make it explicit.
  const data = sessions.readSession(id);
  for (const msg of data.messages) {
    res.write('data: ' + JSON.stringify(msg) + '\n\n');
  }

  const hb = setInterval(() => { try { res.write(':\n\n'); } catch (e) {} }, 15000);
  if (hb.unref) hb.unref();
  res.on('close', () => {
    clearInterval(hb);
    const s = subscribers.get(id);
    if (s) { s.delete(res); if (s.size === 0) subscribers.delete(id); }
  });
  return;
}
```

Register-first turns the "lost message" failure into an at-most "duplicate
message" outcome, which is recoverable (dedupe by `ts` + content, or add a
sequence number to records and have the client drop already-seen seq). The
current "lost message" outcome is not recoverable. A sequence number per record
is the clean long-term fix.

## Warnings

### WR-01: POST guard + appendMessage double-read; TOCTOU yields 500 instead of 404

**File:** `server.js:120-123`, cross-ref `sessions.js:88-96`
**Issue:** The POST handler calls `sessions.readSession(id)` purely as a 404 guard
(line 120), then `sessions.appendMessage(id, ...)` (line 123), which independently
calls `fs.existsSync(sessionPath(id))` and **throws** `unknown session` if the
file is gone. If the session file is deleted between the guard read and the append
(or if the guard passes but append's existsSync disagrees), `appendMessage` throws,
the handler `catch` returns a 500 ("internal error") rather than the correct 404.
It also reads the entire transcript from disk on every POST just to check
existence — wasteful, and the read result is discarded.

**Fix:** Drop the redundant guard read and translate the known throw into a 404:

```js
let rec;
try {
  rec = sessions.appendMessage(id, sideFor(req), text);
} catch (e) {
  if (/unknown session/.test(e.message)) return sendJson(res, 404, { error: 'not found' });
  throw e;
}
broadcast(id, rec);
return sendJson(res, 201, rec);
```

### WR-02: Subscriber Map entry leaks if a session is deleted while subscribed

**File:** `server.js:89-104`
**Issue:** The Map entry for a session is only removed when its Set drops to size 0
via `res.on('close')`. If a session file is removed out-of-band while a subscriber
is still connected, broadcasts keep targeting a live socket (fine), but a stream
re-open for that now-deleted id 404s on line 80 before reaching registration — so
the dead session's Set lingers until the last live subscriber disconnects. Bounded
by live connections, so not unbounded growth, but worth noting against T-02-03's
"empty Sets deleted to bound memory" claim: the bound holds only while
disconnects fire. Low severity; flagged for completeness.

**Fix:** Acceptable as-is for LAN scope; if hardening, prune on broadcast when a
write throws (the socket is dead) instead of waiting for the `close` event.

### WR-03: Heartbeat write error is swallowed without removing the dead subscriber

**File:** `server.js:91-95`
**Issue:** When the heartbeat `res.write(':\n\n')` throws (socket already gone but
`close` not yet fired), the `catch (e) {}` swallows it and the interval keeps
firing every 15s against a dead socket until `close` eventually cleans up. Same
pattern in `broadcast` (line 26). Harmless in practice but masks the dead-socket
signal. Pair with WR-02's fix: on write failure, proactively delete the
subscriber and clear its interval rather than relying solely on `close`.

**Fix:** On a heartbeat/broadcast write throw, treat the subscriber as gone:
remove it from the Set and `clearInterval(hb)`.

### WR-04: Empty-string text is accepted as a valid message

**File:** `server.js:116-119`
**Issue:** The validation is `typeof text !== 'string'` only. An empty string
(`{"text":""}`) passes, producing a stored/broadcast `msg` record with empty
text. Compare the `POST /api/sessions` name check (line 66), which explicitly
rejects empty/whitespace-only names with `name.trim().length === 0`. The message
endpoint is inconsistent and will persist blank transcript entries. Whether empty
messages are intended is a spec question, but the asymmetry with the name check
suggests it's unintended.

**Fix:** Decide intent. If empty messages are invalid, mirror the name check:

```js
if (typeof text !== 'string' || text.length === 0) {
  return sendJson(res, 400, { error: 'text is required' });
}
```

(Use `text.length === 0`, not `.trim()` — a message of only whitespace/newlines
may be legitimate given the multi-line fidelity requirement; only reject truly
empty.)

## Info

### IN-01: stream test uses a hard-coded port (5913) — flaky under parallel runs

**File:** `test/stream.test.js:13`
**Issue:** The spawned-server test binds a fixed `PORT = '5913'`. If that port is
occupied (CI, concurrent test runs, a leftover process from a previous failed
run), `server.listen` fails and `waitReady` times out, surfacing as a confusing
"server never became ready" rather than "port in use." The in-process test
(`messages.test.js`) correctly uses `listen(0)` for an ephemeral port.

**Fix:** Spawned tests need a known port, but harden cleanup: ensure `after`
always kills the proc (it does), and consider detecting `EADDRINUSE` on the child
to fail fast with a clear message. Low priority.

### IN-02: SSE framing is only safe because records are JSON — add a guard comment

**File:** `server.js:22, 87`
**Issue:** Both the replay (line 87) and broadcast (line 22) emit
`'data: ' + JSON.stringify(rec) + '\n\n'`. This is correct *only* because
`JSON.stringify` escapes newlines, keeping each record to a single `data:` line.
If a future change ever emits a raw `text` field (e.g. `data: ${rec.text}`), any
multi-line message would break SSE framing (each `\n` in the payload starts a new
field, and a blank line mid-text would terminate the event early) — a silent
correctness BLOCKER.

**Fix:** Add a one-line comment at the frame-build site documenting that JSON
serialization is load-bearing for SSE correctness, so the invariant survives
future edits:

```js
// JSON.stringify escapes newlines -> exactly one `data:` line per record.
// Do NOT emit raw multi-line text here; it would break SSE framing.
const frame = 'data: ' + JSON.stringify(rec) + '\n\n';
```

---

_Reviewed: 2026-06-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
