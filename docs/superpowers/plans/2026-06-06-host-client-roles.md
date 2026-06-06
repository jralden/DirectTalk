# Host/Client Roles + Always-On Session Table — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the host (loopback) create/delete controls over sessions while clients get view-and-select only, in a single combined view where the session list is always visible.

**Architecture:** Reuse the existing loopback-based `sideFor(req)` for role detection. Add `GET /api/whoami` and a host-enforced `DELETE /api/sessions/:id` to the server, a `deleteSession` to the store, and rewrite `index.html` into one combined page (table on top, transcript below) that polls the session list every 3s and gates host controls by role.

**Tech Stack:** Node.js core (`node:http`, `node:fs`), `node:test` + `node:assert/strict` for tests, vanilla browser JS (no build step). Tests run with `node --test`.

**Spec:** `docs/superpowers/specs/2026-06-06-host-client-roles-design.md`

---

## File Structure

- `sessions.js` — add `deleteSession(id)`; export it. (store layer)
- `server.js` — add `GET /api/whoami`, `DELETE /api/sessions/:id`; expose `HOST_ADDRS` as `server._hostAddrs` for tests. (HTTP layer)
- `index.html` — full rewrite of the view: combined table + transcript, role gating, 3s polling, delete UX. (browser UI)
- `test/delete.test.js` — new: `deleteSession` unit tests + `DELETE` / `whoami` endpoint tests.
- `BACKLOG.md` — move "Delete a session" to Done.

---

## Task 1: `sessions.deleteSession(id)`

**Files:**
- Modify: `sessions.js` (add function + export)
- Test: `test/delete.test.js` (create)

- [ ] **Step 1: Write the failing unit tests**

Create `test/delete.test.js`:

```javascript
'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sessions = require('../sessions');

const createdIds = [];
function track(s) {
  createdIds.push(s.id);
  return s;
}

after(() => {
  for (const id of createdIds) {
    fs.rmSync(sessions.sessionPath(id), { force: true });
  }
});

test('deleteSession removes the file and returns true', () => {
  const s = track(sessions.createSession('Delete Me'));
  assert.ok(fs.existsSync(sessions.sessionPath(s.id)));
  const ok = sessions.deleteSession(s.id);
  assert.equal(ok, true);
  assert.ok(!fs.existsSync(sessions.sessionPath(s.id)));
});

test('deleteSession returns false for a missing session', () => {
  const ok = sessions.deleteSession('no-such-session-' + Date.now());
  assert.equal(ok, false);
});

test('deleteSession throws on an invalid id', () => {
  assert.throws(() => sessions.deleteSession('../etc/passwd'), /invalid session id/);
});

test('deleteSession clears the in-memory seq counter', () => {
  const s = track(sessions.createSession('Seq Clear'));
  sessions.appendMessage(s.id, 'host', 'one');
  sessions.deleteSession(s.id);
  // Re-create at the same id is not possible (timestamped), but appending to a
  // recreated file must start seq at 0. Simulate by recreating the file by hand.
  fs.writeFileSync(
    sessions.sessionPath(s.id),
    JSON.stringify({ type: 'meta', name: 'Seq Clear', createdAt: new Date().toISOString() }) + '\n'
  );
  const rec = sessions.appendMessage(s.id, 'host', 'fresh');
  assert.equal(rec.seq, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/delete.test.js`
Expected: FAIL — `sessions.deleteSession is not a function`.

- [ ] **Step 3: Implement `deleteSession`**

In `sessions.js`, add this function after `appendMessage` (it uses the existing
module-level `nextSeq` Map and `sessionPath`):

```javascript
function deleteSession(id) {
  const p = sessionPath(id); // validates id; throws 'invalid session id'
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p);
  nextSeq.delete(id);
  return true;
}
```

Add `deleteSession` to the `module.exports` object:

```javascript
module.exports = {
  SESSIONS_DIR,
  ensureSessionsDir,
  sessionPath,
  stripAnsi,
  createSession,
  listSessions,
  appendMessage,
  readSession,
  deleteSession,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/delete.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add sessions.js test/delete.test.js
git commit -m "feat: add sessions.deleteSession"
```

---

## Task 2: `GET /api/whoami`

**Files:**
- Modify: `server.js` (add route)
- Test: `test/delete.test.js` (append endpoint tests + request helper/server bootstrap)

- [ ] **Step 1: Add the server bootstrap + whoami test**

Append to `test/delete.test.js`. This adds the HTTP harness (mirroring
`test/server.test.js`) and the first endpoint test. Add the new requires at the
top of the file (alongside the existing ones):

```javascript
const http = require('node:http');
const server = require('../server');
```

Then append at the end of the file:

```javascript
let port;

test('start server', async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path,
        headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

test('GET /api/whoami returns host for a loopback request', async () => {
  const res = await request('GET', '/api/whoami');
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).side, 'host');
});

test('stop server', async () => {
  await new Promise((resolve) => server.close(resolve));
});
```

Note: `test/delete.test.js` runs in its own process, so binding the shared
`server` singleton here does not collide with `test/server.test.js`.

- [ ] **Step 2: Run to verify the whoami test fails**

Run: `node --test test/delete.test.js`
Expected: FAIL — whoami returns 404 (route not defined), so `JSON.parse(res.body).side` is `undefined`.

- [ ] **Step 3: Add the `whoami` route**

In `server.js`, inside `handler`, add this branch immediately after the
`GET /api/sessions` branch (around line 86, before the `POST /api/sessions` block):

```javascript
    if (req.method === 'GET' && pathname === '/api/whoami') {
      return sendJson(res, 200, { side: sideFor(req) });
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/delete.test.js`
Expected: PASS (whoami test green; full file still green).

- [ ] **Step 5: Commit**

```bash
git add server.js test/delete.test.js
git commit -m "feat: add GET /api/whoami role endpoint"
```

---

## Task 3: `DELETE /api/sessions/:id` (host-enforced)

**Files:**
- Modify: `server.js` (expose `_hostAddrs`, add DELETE route)
- Test: `test/delete.test.js` (append endpoint tests)

- [ ] **Step 1: Expose `HOST_ADDRS` for the client-role test**

In `server.js`, near the other test-only exposures (after `server._heartbeats =
heartbeats;`, ~line 207), add:

```javascript
// Exposed for tests: mutate to simulate a non-loopback (client) caller, since
// the test harness can only connect over loopback.
server._hostAddrs = HOST_ADDRS;
```

- [ ] **Step 2: Write the failing DELETE tests**

Insert these tests into `test/delete.test.js` *between* the `GET /api/whoami`
test and the `stop server` test:

```javascript
test('DELETE /api/sessions/:id as host deletes the file (200)', async () => {
  const s = track(sessions.createSession('Host Delete'));
  const res = await request('DELETE', '/api/sessions/' + s.id);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.ok(!fs.existsSync(sessions.sessionPath(s.id)));
});

test('DELETE /api/sessions/:id for a missing session returns 404', async () => {
  const res = await request('DELETE', '/api/sessions/no-such-' + Date.now());
  assert.equal(res.status, 404);
});

test('DELETE /api/sessions/:id from a client is forbidden (403), file untouched', async () => {
  const s = track(sessions.createSession('Client Blocked'));
  // Simulate a non-loopback caller: temporarily stop treating loopback as host.
  const saved = [...server._hostAddrs];
  server._hostAddrs.clear();
  try {
    const res = await request('DELETE', '/api/sessions/' + s.id);
    assert.equal(res.status, 403);
  } finally {
    for (const a of saved) server._hostAddrs.add(a);
  }
  assert.ok(fs.existsSync(sessions.sessionPath(s.id)), 'file must survive a forbidden delete');
});

test('DELETE ends open SSE subscribers for the session', async () => {
  const s = track(sessions.createSession('Sub End'));
  // Open a stream and wait for it to be registered.
  await new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'GET', path: '/api/sessions/' + s.id + '/stream' },
      () => resolve()
    );
    req.on('error', reject);
    req.end();
  });
  await new Promise((r) => setTimeout(r, 50)); // let registration settle
  assert.ok(server._subscribers.has(s.id), 'precondition: subscriber registered');
  const res = await request('DELETE', '/api/sessions/' + s.id);
  assert.equal(res.status, 200);
  assert.ok(!server._subscribers.has(s.id), 'subscribers cleared on delete');
});
```

- [ ] **Step 3: Run to verify the DELETE tests fail**

Run: `node --test test/delete.test.js`
Expected: FAIL — DELETE currently falls through to the 404 branch for the
host-delete test (file not removed) and the 403/subscriber tests fail.

- [ ] **Step 4: Add the DELETE route**

In `server.js`, add this branch right before the static landing-page block
(before the `if (req.method === 'GET' && (pathname === '/' ...` block, ~line 189).
It reuses `sideFor`, `subscribers`, and `dropSubscriber` already in the module:

```javascript
    // Host-only session deletion. Authorization is enforced here, not just in
    // the client UI: a client could otherwise issue this request directly.
    const del = pathname.match(/^\/api\/sessions\/([a-z0-9-]+)$/);
    if (req.method === 'DELETE' && del) {
      const id = del[1];
      if (sideFor(req) !== 'host') {
        return sendJson(res, 403, { error: 'forbidden' });
      }
      // End any open streams so watchers don't sit on a dead session.
      const set = subscribers.get(id);
      if (set) {
        for (const r of [...set]) {
          dropSubscriber(id, r);
          try { r.end(); } catch (e) { /* already closed */ }
        }
      }
      const existed = sessions.deleteSession(id);
      if (!existed) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { ok: true });
    }
```

- [ ] **Step 5: Run to verify all tests pass**

Run: `node --test test/delete.test.js`
Expected: PASS (all delete/whoami tests green).

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `node --test test/`
Expected: PASS — all files green.

- [ ] **Step 7: Commit**

```bash
git add server.js test/delete.test.js
git commit -m "feat: add host-enforced DELETE /api/sessions/:id"
```

---

## Task 4: Combined view UI (`index.html` rewrite)

**Files:**
- Modify: `index.html` (full replacement)

This file has no unit tests; it is verified manually after the rewrite. Replace
the entire file with the content below in one step — the view model changes
(picker/session toggle → one combined page), so a piecemeal edit is riskier than
a clean replacement. The server API it depends on (`/api/whoami`,
`/api/sessions`, `/api/sessions/:id/stream`, `/api/sessions/:id/messages`,
`DELETE /api/sessions/:id`) is all in place from Tasks 1–3.

- [ ] **Step 1: Replace `index.html` with the combined view**

Write `index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DirectTalk</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --panel: #252526;
      --border: #3c3c3c;
      --fg: #d4d4d4;
      --muted: #888;
      --accent: #4ec9b0;
      --host: #569cd6;
      --client: #ce9178;
      --ok: #4ec9b0;
      --bad: #f48771;
      --sel: #094771;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    header {
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 0 0 auto;
    }
    header h1 { font-size: 16px; margin: 0; }
    header .spacer { flex: 1; }
    .role-badge {
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
      border: 1px solid var(--accent); color: var(--accent);
      text-transform: uppercase; letter-spacing: 0.5px;
    }
    button {
      background: #0e639c; color: #fff; border: none; border-radius: 4px;
      padding: 6px 12px; cursor: pointer; font-size: 13px;
    }
    button:hover { background: #1177bb; }
    .status {
      font-size: 12px; padding: 3px 8px; border-radius: 10px;
      border: 1px solid var(--border);
    }
    .status.connecting { color: var(--muted); border-color: var(--border); }
    .status.connected { color: var(--ok); border-color: var(--ok); }
    .status.reconnecting { color: var(--bad); border-color: var(--bad); }
    .status.disconnected { color: var(--bad); border-color: var(--bad); }

    main { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }

    /* Sessions table (always visible) */
    #sessions { flex: 0 0 auto; max-height: 38vh; overflow-y: auto; border-bottom: 1px solid var(--border); }
    #sessionsHead {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px; background: var(--panel);
      position: sticky; top: 0;
    }
    #sessionsHead .label { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; }
    #sessionsHead .spacer { flex: 1; }
    table.sess { width: 100%; border-collapse: collapse; }
    table.sess td, table.sess th { padding: 7px 16px; text-align: left; }
    table.sess th { font-size: 11px; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 600; }
    table.sess tbody tr { cursor: pointer; border-bottom: 1px solid #2a2a2a; }
    table.sess tbody tr:hover td { background: #2a2d2e; }
    table.sess tbody tr.selected td { background: var(--sel); }
    .sname { font-weight: 600; }
    .sdate { color: var(--muted); font-size: 12px; }
    td.delcell { width: 1%; text-align: right; }
    .delbtn { color: var(--bad); cursor: pointer; font-weight: 700; padding: 0 4px; user-select: none; }
    .empty-row td { color: var(--muted); font-style: italic; cursor: default; }
    .pickerErr { color: var(--bad); font-size: 13px; padding: 8px 16px; }

    /* Transcript */
    #transcript {
      flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.45;
    }
    .line { margin-bottom: 6px; }
    .meta { color: var(--muted); font-size: 11px; user-select: none; }
    .meta .side-host { color: var(--host); font-weight: 600; }
    .meta .side-client { color: var(--client); font-weight: 600; }
    .body { display: block; }
    .hint { color: var(--muted); font-style: italic; }

    #composer {
      flex: 0 0 auto; border-top: 1px solid var(--border); background: var(--panel);
      padding: 10px 16px; display: flex; gap: 10px; align-items: flex-end;
    }
    #entry {
      flex: 1; resize: vertical; min-height: 44px; max-height: 200px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--border);
      border-radius: 6px; padding: 8px 10px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px;
    }
    #sendErr { color: var(--bad); font-size: 12px; padding: 0 16px 8px; }
    .hidden { display: none !important; }

    /* Role gating: clients never see host-only controls. */
    body[data-role="client"] .host-only { display: none !important; }
  </style>
</head>
<body data-role="client">
  <header>
    <h1>DirectTalk</h1>
    <span id="roleBadge" class="role-badge hidden"></span>
    <span id="sessionName" class="sdate"></span>
    <span class="spacer"></span>
    <span id="status" class="status hidden">connecting</span>
  </header>

  <main>
    <section id="sessions">
      <div id="sessionsHead">
        <span class="label">Sessions</span>
        <span class="spacer"></span>
        <button id="newBtn" class="host-only">+ New</button>
      </div>
      <div id="pickerErr" class="pickerErr hidden"></div>
      <table class="sess">
        <tbody id="sessionRows"></tbody>
      </table>
    </section>

    <div id="transcript"><span class="hint">Select a session above.</span></div>
    <div id="sendErr" class="hidden"></div>
    <div id="composer" class="hidden">
      <textarea id="entry" placeholder="Message  (Cmd/Ctrl+Enter to send)"></textarea>
      <button id="sendBtn">Send</button>
    </div>
  </main>

  <script>
    (function () {
      'use strict';

      var sessionRows = document.getElementById('sessionRows');
      var pickerErr = document.getElementById('pickerErr');
      var transcript = document.getElementById('transcript');
      var entry = document.getElementById('entry');
      var sendBtn = document.getElementById('sendBtn');
      var sendErr = document.getElementById('sendErr');
      var statusEl = document.getElementById('status');
      var composer = document.getElementById('composer');
      var newBtn = document.getElementById('newBtn');
      var sessionNameEl = document.getElementById('sessionName');
      var roleBadge = document.getElementById('roleBadge');

      var es = null;          // active EventSource
      var currentId = null;   // active session id
      var currentName = null; // active session name
      var maxSeq = -1;        // highest seq rendered for the current session
      var role = 'client';    // 'host' | 'client', set by /api/whoami

      function show(el) { el.classList.remove('hidden'); }
      function hide(el) { el.classList.add('hidden'); }

      function fmtDate(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        return d.toLocaleString();
      }

      // ----- Role -----
      function loadRole() {
        return fetch('/api/whoami')
          .then(function (r) { return r.ok ? r.json() : { side: 'client' }; })
          .catch(function () { return { side: 'client' }; })
          .then(function (o) {
            role = o.side === 'host' ? 'host' : 'client';
            document.body.dataset.role = role;
            roleBadge.textContent = role;
            show(roleBadge);
          });
      }

      // ----- Sessions table -----
      function loadSessions() {
        return fetch('/api/sessions')
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (list) {
            hide(pickerErr);
            renderSessions(list);
          })
          .catch(function (e) {
            // Transient poll failure: keep the last-known table, surface a note.
            pickerErr.textContent = 'Could not load sessions: ' + e.message;
            show(pickerErr);
          });
      }

      function renderSessions(list) {
        while (sessionRows.firstChild) sessionRows.removeChild(sessionRows.firstChild);

        if (!list || list.length === 0) {
          var tr = document.createElement('tr');
          tr.className = 'empty-row';
          var td = document.createElement('td');
          td.colSpan = 3;
          td.textContent = 'No sessions yet.';
          tr.appendChild(td);
          sessionRows.appendChild(tr);
        } else {
          list.forEach(function (s) { sessionRows.appendChild(buildRow(s)); });
        }

        // If the selected session vanished (e.g. host deleted it), reset.
        if (currentId && !(list || []).some(function (s) { return s.id === currentId; })) {
          handleSelectedGone();
        }
      }

      function buildRow(s) {
        var tr = document.createElement('tr');
        tr.dataset.id = s.id;
        if (s.id === currentId) tr.className = 'selected';
        tr.addEventListener('click', function (e) {
          if (e.target && e.target.classList.contains('delbtn')) return; // delete handles itself
          selectSession(s.id, s.name);
        });

        var nameTd = document.createElement('td');
        var nameSpan = document.createElement('span');
        nameSpan.className = 'sname';
        nameSpan.textContent = s.name;
        nameTd.appendChild(nameSpan);

        var dateTd = document.createElement('td');
        dateTd.className = 'sdate';
        dateTd.textContent = fmtDate(s.createdAt);

        var delTd = document.createElement('td');
        delTd.className = 'delcell host-only';
        var del = document.createElement('span');
        del.className = 'delbtn';
        del.textContent = '✕'; // ✕
        del.title = 'Delete session';
        del.addEventListener('click', function (ev) {
          ev.stopPropagation();
          deleteSession(s.id, s.name);
        });
        delTd.appendChild(del);

        tr.appendChild(nameTd);
        tr.appendChild(dateTd);
        tr.appendChild(delTd);
        return tr;
      }

      function markSelectedRow() {
        var rows = sessionRows.querySelectorAll('tr');
        rows.forEach(function (tr) {
          tr.classList.toggle('selected', tr.dataset.id === currentId);
        });
      }

      // ----- Delete (host) -----
      function deleteSession(id, name) {
        var ok = window.confirm("Delete session '" + name + "'? This removes its transcript permanently.");
        if (!ok) return;
        fetch('/api/sessions/' + id, { method: 'DELETE' })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            if (id === currentId) handleSelectedGone();
            return loadSessions();
          })
          .catch(function (e) {
            pickerErr.textContent = 'Could not delete: ' + e.message;
            show(pickerErr);
          });
      }

      // ----- Create (host) -----
      function createSession() {
        var name = window.prompt('Session name:');
        if (name === null) return;            // cancelled
        name = name.trim();
        if (name.length === 0) {
          pickerErr.textContent = 'Name is required.';
          show(pickerErr);
          return;
        }
        fetch('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name })
        })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function (s) {
            return loadSessions().then(function () { selectSession(s.id, s.name); });
          })
          .catch(function (e) {
            pickerErr.textContent = 'Could not create session: ' + e.message;
            show(pickerErr);
          });
      }

      // ----- Selection / transcript -----
      function selectSession(id, name) {
        currentId = id;
        currentName = name;
        maxSeq = -1;
        while (transcript.firstChild) transcript.removeChild(transcript.firstChild);
        hide(sendErr);
        sessionNameEl.textContent = name || id;
        show(statusEl);
        show(composer);
        markSelectedRow(); // immediate highlight, don't wait for the next poll
        openStream(id);
        entry.focus();
      }

      function handleSelectedGone() {
        closeStream();
        currentId = null;
        currentName = null;
        maxSeq = -1;
        sessionNameEl.textContent = '';
        hide(statusEl);
        hide(composer);
        while (transcript.firstChild) transcript.removeChild(transcript.firstChild);
        var hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = 'Session ended. Select a session above.';
        transcript.appendChild(hint);
      }

      function setStatus(state) {
        statusEl.className = 'status ' + state;
        statusEl.textContent = state;
      }

      function closeStream() {
        if (es) { es.close(); es = null; }
      }

      function openStream(id) {
        closeStream();
        setStatus('connecting');
        es = new EventSource('/api/sessions/' + id + '/stream');
        es.onopen = function () { setStatus('connected'); };
        es.onerror = function () {
          if (es.readyState === EventSource.CLOSED) setStatus('disconnected');
          else setStatus('reconnecting');
        };
        es.onmessage = function (e) {
          var rec;
          try { rec = JSON.parse(e.data); } catch (err) { return; }
          if (typeof rec.seq === 'number' && rec.seq <= maxSeq) return; // dedupe
          appendLine(rec);
          if (typeof rec.seq === 'number') maxSeq = rec.seq;
        };
      }

      function appendLine(rec) {
        var wasAtBottom =
          transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 24;

        var line = document.createElement('div');
        line.className = 'line';

        var meta = document.createElement('span');
        meta.className = 'meta';
        var sideClass = rec.side === 'host' ? 'side-host' : 'side-client';
        var sideLabel = rec.side === 'host' ? 'Host' : 'Client';
        var sideSpan = document.createElement('span');
        sideSpan.className = sideClass;
        sideSpan.textContent = sideLabel;
        meta.appendChild(sideSpan);
        meta.appendChild(document.createTextNode('  ' + fmtDate(rec.ts) + '  '));

        var body = document.createElement('span');
        body.className = 'body';
        // SECURITY (T-03-01): render message text as TEXT, never as markup.
        body.textContent = rec.text;

        line.appendChild(meta);
        line.appendChild(body);
        transcript.appendChild(line);

        if (wasAtBottom) transcript.scrollTop = transcript.scrollHeight;
      }

      function sendMessage() {
        if (!currentId) return; // no active session -> never POST to /null/
        var text = entry.value;
        if (text.length === 0) return; // nothing to send
        hide(sendErr);
        sendBtn.disabled = true;
        fetch('/api/sessions/' + currentId + '/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: text })
        })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
          })
          .then(function () {
            entry.value = '';          // clear on success
            entry.focus();
          })
          .catch(function (e) {
            sendErr.textContent = 'Send failed: ' + e.message + ' (text kept)';
            show(sendErr);
          })
          .then(function () { sendBtn.disabled = false; });
      }

      // ----- Wiring -----
      newBtn.addEventListener('click', createSession);
      sendBtn.addEventListener('click', sendMessage);
      entry.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          sendMessage();
        }
      });

      // Init: resolve role, fill the table, then poll every 3s.
      loadRole().then(loadSessions);
      setInterval(loadSessions, 3000);
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the test suite still passes (no server regressions)**

Run: `node --test test/`
Expected: PASS — `index.html` changes don't touch server tests; `static.test.js`
still serves the file.

- [ ] **Step 3: Manual verification — host view**

Run: `node server.js`
Open `http://localhost:5757` in a browser. Verify:
- Role badge reads `host`; `+ New` button is visible.
- Click `+ New`, name it "manual-test" → it appears in the table and is selected;
  composer is visible.
- Type a message + Cmd/Ctrl+Enter → it renders as `Host`.
- A `✕` is visible on each row.

- [ ] **Step 4: Manual verification — client view**

Find the host's LAN IP (System Settings → Network, e.g. `192.168.1.x`).
Open `http://<LAN-IP>:5757` from another device (or the same machine — the
non-loopback address tags it `client`). Verify:
- Role badge reads `client`; no `+ New` button; no `✕` on rows.
- Clicking a row loads that session's transcript; sending a message renders as `Client`.

- [ ] **Step 5: Manual verification — live poll + delete**

With both host and client open on the same session:
- On host, `+ New` a session → within ~3s it appears in the client's table.
- On host, click `✕` on a session the client is viewing → confirm → within ~3s
  the row disappears on the client and its transcript shows
  "Session ended. Select a session above." The host's own view resets the same
  way if it was the deleted session.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: combined session table view with host/client role gating"
```

---

## Task 5: Close out the backlog item

**Files:**
- Modify: `BACKLOG.md`

- [ ] **Step 1: Move "Delete a session" to Done**

Edit `BACKLOG.md` so the delete item moves from `## Open` to `## Done`. Resulting
file:

```markdown
# DirectTalk — Backlog

Enhancements and changes to consider after living with v1.0 for a while.
Newest ideas go at the bottom; nothing here is committed work yet.

## Open

(none)

## Done

1. **Delete a session.** Added a host-only `✕` per row in the session table plus
   a host-enforced `DELETE /api/sessions/:id` endpoint, with a browser `confirm`
   step. (2026-06-06)
```

- [ ] **Step 2: Commit**

```bash
git add BACKLOG.md
git commit -m "docs: mark 'delete a session' done in backlog"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** whoami (T2), host-enforced DELETE incl. 403 + subscriber-end
  (T3), deleteSession store fn (T1), combined stacked view (T4), role gating /
  poll / delete UX / deleted-session handling (T4), backlog close-out (T5), tests
  for all server/store additions (T1–T3). All spec sections mapped.
- **Placeholders:** none — every code step has full content.
- **Type/name consistency:** `deleteSession` (id→bool), `sideFor`, `_hostAddrs`,
  `subscribers`/`dropSubscriber`, `handleSelectedGone`, `selectSession`,
  `markSelectedRow`, `loadSessions`, `renderSessions` used consistently across
  tasks. Rows carry `data-id`; `markSelectedRow` highlights immediately on click
  and `renderSessions` re-derives the highlight each poll. No dead code.
```
