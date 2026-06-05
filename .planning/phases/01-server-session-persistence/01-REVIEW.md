---
phase: 01-server-session-persistence
reviewed: 2026-06-05T00:00:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - sessions.js
  - server.js
  - test/sessions.test.js
  - test/server.test.js
  - test/restart.test.js
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: findings
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-05
**Depth:** deep (cross-file + spec contract)
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 1 (sessions.js, server.js, three test suites) is well-scoped, zero-dependency, and
all 13 node:test cases pass. The Phase 1 HTTP routes are not directly exploitable: ids are
server-generated via `slugify` + `Date.now()`, so no client-controlled value reaches the
filesystem in this phase — the threat model's T-01-03 disposition holds *for the routes
wired today*.

However, `sessions.js` is the frozen contract Phase 2 will consume (`appendMessage`,
`readSession`, `sessionPath` keyed by a client `:id`). Reviewed as that contract, it ships
without the input validation the threat model assumes, and it omits a documented spec
requirement (ANSI stripping). Those are latent BLOCKERs the moment Phase 2 routes are added,
so they are surfaced now while the interface can still change cheaply. Per the review brief,
absence of auth/encryption is an accepted trade-off and is NOT flagged.

No Critical (Phase-1-exploitable) issues. Four warnings, three info items.

## Warnings

### WR-01: `sessionPath` performs no id validation — path traversal latent in the Phase 2 contract

**File:** `sessions.js:12-14` (consumed by `appendMessage:74`, `readSession:78-79`)
**Issue:** `sessionPath(id)` does `path.join(SESSIONS_DIR, id + '.jsonl')` with no
sanitization. Verified: `sessionPath('../../etc/foo')` resolves to
`/Users/.../Development/etc/foo.jsonl`, escaping `SESSIONS_DIR`. Phase 1 routes never pass a
client id here, so it is not exploitable today. But the spec endpoints
`GET /api/sessions/:id/stream` and `POST /api/sessions/:id/messages` (design lines 53-56)
feed the client `:id` straight into `readSession`/`appendMessage` → `sessionPath`. A
request to `/api/sessions/..%2f..%2f..%2fetc%2fpasswd/stream` would read, and
`/messages` would *write/create*, arbitrary `.jsonl` files outside `sessions/`. Freezing
the module without the guard converts a Phase-2 bug into a contract bug.
**Fix:** Validate id at the filesystem boundary, in `sessionPath` so every caller is covered:
```js
function sessionPath(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error('invalid session id');
  }
  return path.join(SESSIONS_DIR, id + '.jsonl');
}
```
(Generated ids from `slugify` + `Date.now()` already match `^[a-z0-9-]+$`, so Phase 1 is
unaffected. Phase 2 handlers should catch the throw and return 400/404.)

### WR-02: `appendMessage` does not strip ANSI escape sequences — spec deviation in the frozen contract

**File:** `sessions.js:72-76`
**Issue:** Design spec lines 84-85 require: "Incoming text is stripped of ANSI escape
sequences ... server-side before storage." `appendMessage` stores `text` verbatim. The
JSONL file therefore retains raw `\x1b[...m` codes, contradicting the persistence contract.
Phase 1's plan does not list ANSI as a must-have, but `appendMessage` is the exact function
Phase 2 will call, and storage is its responsibility per the spec.
**Fix:** Strip before building the record:
```js
const ANSI = /\x1b\[[0-9;]*m/g;
function appendMessage(id, side, text) {
  const clean = String(text).replace(ANSI, '');
  const rec = { type: 'msg', side, text: clean, ts: new Date().toISOString() };
  fs.appendFileSync(sessionPath(id), JSON.stringify(rec) + '\n');
  return rec;
}
```

### WR-03: `appendMessage` silently creates a session-less file when id does not exist

**File:** `sessions.js:72-76`
**Issue:** `appendFileSync` with the default `'a'` flag creates the file if absent. Calling
`appendMessage('does-not-exist', ...)` produces `sessions/does-not-exist.jsonl` containing a
`msg` line and no `meta` line. `listSessions` (line 57) then silently drops it (no meta), so
the message is written but invisible — silent data loss. Phase 2 will call this with a
client `:id`; a typo or stale id writes an orphan transcript.
**Fix:** Require the session to exist before appending:
```js
function appendMessage(id, side, text) {
  if (!fs.existsSync(sessionPath(id))) {
    throw new Error('unknown session: ' + id);
  }
  ...
}
```
Caller (Phase 2) maps the throw to 404.

### WR-04: `createSession` collision check is non-atomic and uses a corrupting append flag

**File:** `sessions.js:30-37`
**Issue:** The `while (fs.existsSync(sessionPath(id)))` loop is a check-then-act. Within one
process it is safe because `createSession` is fully synchronous and never yields between the
check and the `appendFileSync`. Across two processes (the design allows it; restart.test.js
spawns separate processes) two `createSession('X')` calls in the same millisecond compute
the identical `base = slugify + Date.now()`, both pass `existsSync`, and both
`appendFileSync` with flag `'a'` into the *same* file — producing one `.jsonl` with two meta
lines and the same id returned twice (silent corruption), instead of an error. Low
probability given the single-hub design, but the failure mode is silent rather than loud.
**Fix:** Make creation atomic with the exclusive flag and let collisions error into the loop:
```js
try {
  fs.appendFileSync(sessionPath(id),
    JSON.stringify({ type: 'meta', name, createdAt }) + '\n',
    { flag: 'ax' });   // fail if exists
} catch (err) {
  if (err.code === 'EEXIST') { /* bump n, retry */ } else throw err;
}
```

## Info

### IN-01: `listSessions` pushes `meta.name` without validating it is a string

**File:** `sessions.js:57-62`
**Issue:** The guard checks only `meta.type === 'meta'`. A meta line lacking `name`
(`{"type":"meta","createdAt":"..."}`) yields a list entry with `name: undefined`. Cosmetic
in Phase 1 (createSession always writes name), but the list endpoint would surface `undefined`.
**Fix:** Add `&& typeof meta.name === 'string'` to the condition, or default `name: meta.name ?? ''`.

### IN-02: `listSessions` reads the entire file to extract only the first line

**File:** `sessions.js:53-54`
**Issue:** `fs.readFileSync(...)` loads the whole transcript just to take the first
non-empty line. Correctness is fine; flagged only as a maintainability note for when
transcripts grow (performance is out of v1 review scope, so not a warning).
**Fix:** Acceptable for now; revisit with a streamed first-line read if transcripts get large.

### IN-03: `readSession` returns `{ meta: null, messages: [...] }` for a meta-less file

**File:** `sessions.js:78-97`
**Issue:** If the file exists but has no meta line (e.g. the orphan from WR-03), `readSession`
returns `{ meta: null, messages }` rather than `null`. A Phase 2 caller that destructures
`res.meta.name` would throw. Tighten once WR-03 is addressed.
**Fix:** `if (!meta) return null;` before the final return, or document that `meta` may be null.

---

_Reviewed: 2026-06-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
