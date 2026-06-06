'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');

const sessions = require('../sessions');
const server = require('../server');

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
  // Open a real SSE stream so there is a live subscriber to end.
  const streamReq = http.request(
    { host: '127.0.0.1', port, method: 'GET', path: '/api/sessions/' + s.id + '/stream' }
  );
  streamReq.end();
  const streamRes = await new Promise((resolve, reject) => {
    streamReq.on('response', resolve);
    streamReq.on('error', reject);
  });
  streamRes.resume(); // drain SSE bytes so the socket doesn't buffer/back-pressure

  // Poll for registration instead of a fixed sleep (faster, not flaky).
  const deadline = Date.now() + 2000;
  while (!server._subscribers.has(s.id) && Date.now() < deadline) {
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(server._subscribers.has(s.id), 'precondition: subscriber registered');

  const res = await request('DELETE', '/api/sessions/' + s.id);
  assert.equal(res.status, 200);
  assert.ok(!server._subscribers.has(s.id), 'subscribers cleared on delete');

  // Close the client socket so the test doesn't linger on the 15s heartbeat.
  streamReq.destroy();
});

test('stop server', async () => {
  await new Promise((resolve) => server.close(resolve));
});
