---
phase: 01-server-session-persistence
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - sessions.js
  - server.js
  - .gitignore
  - test/sessions.test.js
  - test/server.test.js
autonomous: true
requirements: [SRV-01, SRV-02, SESS-01, SESS-02, SESS-03]

must_haves:
  truths:
    - "Running `node server.js` starts an HTTP server on port 5757 with no npm install"
    - "The PORT env var overrides the default listen port"
    - "The sessions/ directory is created automatically on first run if missing"
    - "POST /api/sessions with a JSON {name} creates a session and writes a meta line to sessions/<id>.jsonl"
    - "GET /api/sessions returns the list of existing sessions (id, name, createdAt) by scanning sessions/"
    - "After stopping and restarting the server, previously created sessions and their stored messages remain present and readable"
    - "The server does not crash on malformed request bodies or file I/O errors"
  artifacts:
    - path: "sessions.js"
      provides: "Session persistence module: id slugging, create, list, append, read (reusable by Phase 2)"
      exports: ["createSession", "listSessions", "appendMessage", "readSession", "sessionPath", "ensureSessionsDir", "SESSIONS_DIR"]
      min_lines: 60
    - path: "server.js"
      provides: "Zero-dependency node:http server with a route dispatch table and JSON helpers"
      contains: "createServer"
      min_lines: 60
    - path: "test/sessions.test.js"
      provides: "node:test coverage for create/list/append/read and restart persistence"
      min_lines: 40
  key_links:
    - from: "server.js"
      to: "sessions.js"
      via: "require of ./sessions"
      pattern: "require\\(['\"]\\./sessions"
    - from: "sessions.js createSession"
      to: "sessions/<id>.jsonl"
      via: "fs append of meta line"
      pattern: "appendFileSync"
    - from: "sessions.js listSessions"
      to: "sessions/ directory"
      via: "readdir + read first line of each .jsonl"
      pattern: "readdirSync"
---

<objective>
Build the zero-dependency Node server foundation for DirectTalk: a session persistence
module plus an HTTP server that creates and lists named sessions, backed by append-only
JSONL files that survive a restart.

Purpose: This is the hub of the whole app. Phase 2 (SSE stream + message append) and
Phase 3 (static serving of index.html) bolt onto this server's route dispatch and reuse
this phase's sessions module without rework.

Output:
- `sessions.js` — persistence module (id slugging, create, list, append, read).
- `server.js` — node:http server with route dispatch, JSON helpers, port config, sessions/ bootstrap.
- `test/sessions.test.js` + `test/server.test.js` — node:test coverage incl. restart persistence.
- `.gitignore` — ignore `sessions/` (runtime data, not source).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@docs/specs/2026-06-05-directtalk-design.md
@.planning/phases/01-server-session-persistence/01-CONTEXT.md
@CLAUDE.md

<interfaces>
<!-- Contracts this plan CREATES. Phase 2/3 executors will consume sessions.js. -->
<!-- Build to exactly these signatures so downstream phases slot in cleanly. -->

sessions.js exports (CommonJS — the project has no package.json with "type":"module"):

```js
const SESSIONS_DIR = path.join(__dirname, 'sessions'); // exported constant

function ensureSessionsDir()      // -> void   ; mkdir -p sessions/, idempotent
function sessionPath(id)          // -> string ; SESSIONS_DIR/<id>.jsonl
function createSession(name)      // -> { id, name, createdAt } ; writes meta line 1
function listSessions()           // -> Array<{ id, name, createdAt }> ; scans dir, newest-first
function appendMessage(id, side, text) // -> { type:'msg', side, text, ts } ; Phase 2 use
function readSession(id)          // -> { meta:{id,name,createdAt}, messages:[] } | null
```

server.js shape (route dispatch so Phase 2/3 add routes by adding cases):

```js
const http = require('node:http');
const sessions = require('./sessions');
const PORT = Number(process.env.PORT) || 5757;
// helpers: sendJson(res,status,obj), readBody(req)->Promise<string>
// GET /api/sessions, POST /api/sessions, else 404. Handler wrapped in try/catch -> 500.
const server = http.createServer(async (req,res) => { ... });
server.listen(PORT, () => console.log(`DirectTalk listening on http://localhost:${PORT}`));
```
</interfaces>

<environment>
Node v22.17.0 installed. CommonJS modules (`require`/`module.exports`). No package.json
required — project must run with `node server.js` and `node --test` using ONLY the
standard library. Do NOT run `npm install`. Do NOT add any dependency.
</environment>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create sessions.js persistence module</name>
  <files>sessions.js, test/sessions.test.js</files>
  <read_first>
    - docs/specs/2026-06-05-directtalk-design.md (Data Model and Persistence, lines 64-77)
    - .planning/phases/01-server-session-persistence/01-CONTEXT.md (decisions)
  </read_first>
  <behavior>
    - createSession("Debug Run") returns {id, name:"Debug Run", createdAt}; the file's first line parses to {type:"meta", name:"Debug Run", createdAt}.
    - Two createSession calls with the same name produce two distinct ids and two distinct files (collision-safe).
    - listSessions() returns one {id, name, createdAt} per .jsonl file, sorted newest-first by createdAt.
    - listSessions() skips a file whose first line is empty or unparseable without throwing.
    - appendMessage(id,"host","hi") appends a line parsing to {type:"msg", side:"host", text:"hi", ts}.
    - readSession(id) returns {meta, messages} reflecting all appended lines; readSession(unknown) returns null.
    - Data persists on disk: after createSession + appendMessage, a fresh readSession(id) still returns the data.
  </behavior>
  <action>
    Create `sessions.js` as CommonJS using ONLY node stdlib:
    `const fs = require('node:fs'); const path = require('node:path');`

    Export exactly: `SESSIONS_DIR, ensureSessionsDir, sessionPath, createSession, listSessions, appendMessage, readSession`.

    Implementation:
    - `SESSIONS_DIR = path.join(__dirname, 'sessions')`.
    - `ensureSessionsDir()`: `fs.mkdirSync(SESSIONS_DIR, { recursive: true })` (idempotent).
    - `sessionPath(id)`: `path.join(SESSIONS_DIR, id + '.jsonl')`.
    - internal `slugify(name)`: lowercase, replace runs of non-alphanumeric with `-`, trim
      leading/trailing `-`; if empty result, use `"session"`.
    - `createSession(name)`:
        - `ensureSessionsDir();`
        - `const createdAt = new Date().toISOString();`
        - base id = `slugify(name) + '-' + Date.now()`; while `fs.existsSync(sessionPath(id))`,
          append `-2`,`-3`,... (collision-safe).
        - `fs.appendFileSync(sessionPath(id), JSON.stringify({type:'meta', name, createdAt}) + '\n');`
        - return `{ id, name, createdAt }`.
    - `listSessions()`:
        - `ensureSessionsDir();`
        - `fs.readdirSync(SESSIONS_DIR)`, filter to names ending `.jsonl`.
        - for each: read file, take first non-empty line, `JSON.parse` in try/catch; if
          `meta.type === 'meta'` push `{ id: name.replace(/\.jsonl$/, ''), name: meta.name, createdAt: meta.createdAt }`; on any error `continue`.
        - sort by createdAt descending; return array.
    - `appendMessage(id, side, text)`:
        - `const rec = { type:'msg', side, text, ts: new Date().toISOString() };`
        - `fs.appendFileSync(sessionPath(id), JSON.stringify(rec) + '\n');` return `rec`.
    - `readSession(id)`:
        - if `!fs.existsSync(sessionPath(id))` return `null`.
        - read file, split on `\n`, drop empty lines; JSON.parse each in try/catch (skip bad lines).
        - first meta record -> `meta = { id, name, createdAt }`; remaining `type==='msg'` -> `messages[]`.
        - return `{ meta, messages }`.

    Then create `test/sessions.test.js` with `node:test` + `node:assert/strict`:
    - Cover every <behavior> bullet.
    - Hermetic cleanup: track every id returned by createSession; in an `after()` hook
      `fs.rmSync(sessions.sessionPath(id), { force: true })` for each.
  </action>
  <verify>
    <automated>cd /Users/johnalden/Development/DirectTalk && node --test test/sessions.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/sessions.test.js` exits 0, all tests pass.
    - `grep -E "module.exports" sessions.js` lists createSession, listSessions, appendMessage, readSession, sessionPath, ensureSessionsDir, SESSIONS_DIR.
    - `grep -v '^#' sessions.js | grep -Eo "require\\(['\"][^'\"]+" | grep -v "node:" | grep -vc "\\./"` returns 0 (only node: stdlib + relative requires).
    - `grep -E "'meta'|\"meta\"" sessions.js` matches (meta record written).
    - `grep -c appendFileSync sessions.js` is at least 2 (create + append).
  </acceptance_criteria>
  <done>
    sessions.js exports the seven names; all node:test cases pass; only node: stdlib
    requires; meta and msg records written as specified; data survives a fresh read.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create server.js HTTP server with sessions routes and bootstrap</name>
  <files>server.js, .gitignore, test/server.test.js</files>
  <read_first>
    - sessions.js (created in Task 1 — use its exact exports)
    - docs/specs/2026-06-05-directtalk-design.md (Endpoints lines 47-56, Configuration 107-109, Error Handling 99-104)
  </read_first>
  <action>
    Create `server.js` as CommonJS using ONLY node stdlib:
    `const http = require('node:http'); const sessions = require('./sessions');`

    Top-level:
    - `const PORT = Number(process.env.PORT) || 5757;`
    - `sessions.ensureSessionsDir();`  (creates sessions/ on first run — SRV-02).

    Helpers:
    - `function sendJson(res, status, obj) { const body = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); }`
    - `function readBody(req) { return new Promise((resolve) => { let d=''; req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on('end', () => resolve(d)); req.on('error', () => resolve('')); }); }`

    Request handler `async (req, res)`, whole body wrapped in try/catch:
    - `const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname;`
    - `GET /api/sessions` -> `sendJson(res, 200, sessions.listSessions());`
    - `POST /api/sessions`:
        - `const raw = await readBody(req);`
        - parse JSON in try/catch; if parse fails OR `name` is not a string with `.trim().length > 0`,
          `return sendJson(res, 400, { error: 'name is required' });`
        - `const s = sessions.createSession(name); return sendJson(res, 201, s);`
    - else -> `sendJson(res, 404, { error: 'not found' });`
    - catch (err) -> `console.error(err); sendJson(res, 500, { error: 'internal error' });`
      (process must never crash on bad request or file error — Error Handling req).

    Listen + export for tests:
    - `const server = http.createServer(handler);`
    - `module.exports = server;`
    - `if (require.main === module) server.listen(PORT, () => console.log(\`DirectTalk listening on http://localhost:${PORT}\`));`
      (run only when invoked directly so test/server.test.js can listen on an ephemeral port).

    Create `.gitignore` containing exactly:
    ```
    sessions/
    node_modules/
    ```

    Create `test/server.test.js` with `node:test` + `node:assert/strict` + `node:http`:
    - `require('../server')` then `server.listen(0)` on a random port; capture `server.address().port`.
    - Helper to issue requests via `http.request`.
    - Test: POST /api/sessions with `{"name":"Verify Run"}` returns 201 and body has `id`.
    - Test: GET /api/sessions returns 200 and body array contains an entry with name "Verify Run".
    - Test: POST /api/sessions with body `not json` returns 400 (server still alive).
    - Test: POST /api/sessions with `{"name":""}` returns 400.
    - `after()`: close server and `fs.rmSync` the created session file(s) (hermetic).
  </action>
  <verify>
    <automated>cd /Users/johnalden/Development/DirectTalk && node --test test/server.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/server.test.js` exits 0, all tests pass.
    - `grep -c "http.createServer" server.js` is at least 1.
    - `grep -E "require\\(['\"]\\./sessions" server.js` matches (server uses the module).
    - `grep -E "process.env.PORT" server.js` matches and `grep -E "5757" server.js` matches (default + override).
    - `grep -E "sessions.ensureSessionsDir|ensureSessionsDir\\(\\)" server.js` matches (dir bootstrap).
    - `grep -v '^#' server.js | grep -Eo "require\\(['\"][^'\"]+" | grep -v "node:" | grep -vc "\\./"` returns 0 (no npm deps).
    - `printf 'sessions/\\n' | grep -qf - .gitignore` (sessions/ ignored).
  </acceptance_criteria>
  <done>
    `node server.js` starts an http server on PORT||5757 and bootstraps sessions/; the two
    JSON endpoints work; malformed/empty bodies return 400 without crashing; server.test.js
    passes; .gitignore ignores sessions/ and node_modules/.
  </done>
</task>

<task type="auto">
  <name>Task 3: Verify end-to-end restart persistence via running server</name>
  <files>test/restart.test.js</files>
  <read_first>
    - server.js (created in Task 2)
    - sessions.js (created in Task 1)
  </read_first>
  <action>
    Create `test/restart.test.js` (node:test + node:assert/strict + node:http) proving
    success criterion 4 (data survives a restart) against the REAL server process, since the
    in-process tests do not exercise a true stop/start.

    Approach (use child_process from stdlib):
    - `const { spawnSync, spawn } = require('node:child_process');`
    - Choose a fixed test port, e.g. `const PORT = '5912';` and a unique session name with a
      timestamp so the test is repeatable.
    - Helper `start()`: `spawn('node', ['server.js'], { env: { ...process.env, PORT }, cwd: <repo root> })`;
      wait until a GET /api/sessions succeeds (poll up to ~3s).
    - Test body:
        1. start server (instance A). POST /api/sessions `{name}` -> capture id (expect 201).
        2. POST is enough for meta; (optionally) confirm GET lists it.
        3. kill instance A (`proc.kill('SIGTERM')`), wait for exit.
        4. start server again (instance B).
        5. GET /api/sessions -> assert the array contains an entry with the same `name` and `id`.
        6. kill instance B.
    - `after()`: ensure both processes are killed and `fs.rmSync(sessionPath(id), { force:true })`.
    - Resolve repo root via `path.join(__dirname, '..')` for cwd.

    Keep polling/timeouts generous but bounded; fail with a clear assert message if the
    server never becomes ready.
  </action>
  <verify>
    <automated>cd /Users/johnalden/Development/DirectTalk && node --test test/restart.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/restart.test.js` exits 0, the restart test passes.
    - `grep -E "spawn" test/restart.test.js` matches (real process start/stop).
    - `grep -E "SIGTERM|\\.kill\\(" test/restart.test.js` matches (server is actually stopped between checks).
    - After the test, no orphan node server process remains on the test port (test kills both instances).
  </acceptance_criteria>
  <done>
    A session created against a running server is still listed after the server is fully
    stopped and restarted, proven by an automated node:test that spawns and kills the real
    server process.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| LAN client -> HTTP API | Untrusted request bodies and paths cross into server.js |
| server.js -> filesystem (sessions/) | Session ids become file paths on disk |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Tampering | POST /api/sessions body parsing | mitigate | Wrap JSON.parse in try/catch; reject non-object/blank name with 400; cap body at 1e6 bytes (req.destroy) |
| T-01-02 | Denial of Service | request body read | mitigate | readBody aborts the request when accumulated body exceeds 1MB |
| T-01-03 | Tampering | id -> file path (sessionPath) | mitigate | ids are generated server-side via slugify (alphanumeric + `-`) + Date.now(); no client-supplied id reaches the filesystem in this phase |
| T-01-04 | Denial of Service | handler exceptions / file I/O errors | mitigate | Handler body in try/catch -> 500 JSON; process never crashes (Error Handling requirement) |
| T-01-05 | Information Disclosure | unencrypted session files on disk; open LAN access | accept | Documented accepted trade-off in spec (trusted home LAN, no auth/encryption) |
| T-01-06 | Spoofing | no auth / origin trust | accept | Out of scope per spec; role detection (Phase 2) is convenience labeling, not a security control |
</threat_model>

<verification>
Phase-level checks (run after all tasks):

1. `node --test` (runs all of test/) exits 0.
2. `PORT=5757 node server.js` prints "DirectTalk listening on http://localhost:5757" and a
   `sessions/` directory exists afterward.
3. `git status` does NOT list any file under `sessions/` (ignored).
4. `grep -rL "node:" --include=*.js . | grep -E "server.js|sessions.js"` — server.js and
   sessions.js contain only node: stdlib requires (no npm).
</verification>

<success_criteria>
- [ ] `node server.js` starts an HTTP server on 5757 (overridable via PORT) with no npm install (SRV-01, SRV-02).
- [ ] `sessions/` is created on first run (SRV-02).
- [ ] POST /api/sessions `{name}` creates a session and writes a meta line to `sessions/<id>.jsonl` (SESS-01).
- [ ] GET /api/sessions lists existing sessions (id, name, createdAt) by scanning `sessions/` (SESS-02).
- [ ] Sessions persist as append-only JSONL and survive a full server restart (SESS-03), proven by test/restart.test.js.
- [ ] Server tolerates malformed bodies (400) and handler errors (500) without crashing.
- [ ] All node:test suites pass; sessions.js is reusable by Phase 2 (appendMessage/readSession exported and tested).
</success_criteria>

<output>
After completion, create `.planning/phases/01-server-session-persistence/01-01-SUMMARY.md`
documenting: files created, the sessions.js public interface (for Phase 2/3 consumers), the
route-dispatch shape, and any deviations.
</output>
