'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sessions = require('../sessions');

const REPO_ROOT = path.join(__dirname, '..');
// Dynamically assigned per spawned server (IN-01): a hard-coded port is
// flaky under parallel runs / leftover processes. start() picks a free
// ephemeral port and sets PORT before launching the child.
let PORT = '0';

// Bind a throwaway listener to port 0, read the OS-assigned port, then
// release it. Brief reuse race is acceptable for a test harness and far
// less flaky than a fixed port.
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(String(p)));
    });
  });
}

let createdId = null;
const createdIds = [];
const procs = [];

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: Number(PORT), method: 'GET', path: pathname },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: Number(PORT), method: 'POST', path: pathname,
        headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function start() {
  PORT = await findFreePort();
  const proc = spawn('node', ['server.js'], {
    env: { ...process.env, PORT },
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  procs.push(proc);
  return proc;
}

async function waitReady(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await get('/api/sessions');
      if (res.status === 200) return true;
    } catch (err) {
      // not up yet
    }
    await sleep(100);
  }
  return false;
}

function stop(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', () => resolve());
    proc.kill('SIGTERM');
  });
}

// Parse accumulated SSE buffer into an ordered list of message records,
// ignoring heartbeat (':') frames and unparseable chunks.
function parseFrames(buf) {
  const out = [];
  for (const chunk of buf.split('\n\n')) {
    const line = chunk.trim();
    if (!line || !line.startsWith('data:')) continue;
    const json = line.slice('data:'.length).trim();
    try {
      out.push(JSON.parse(json));
    } catch (e) {
      // ignore
    }
  }
  return out;
}

after(async () => {
  for (const p of procs) await stop(p);
  for (const id of createdIds) fs.rmSync(sessions.sessionPath(id), { force: true });
});

test('SSE replays transcript then pushes live messages', async () => {
  const srv = await start();
  assert.ok(await waitReady(), 'server never became ready');

  const created = await post('/api/sessions', JSON.stringify({ name: 'Stream Test ' + Date.now() }));
  assert.equal(created.status, 201);
  createdId = JSON.parse(created.body).id;
  assert.ok(createdId);
  createdIds.push(createdId);

  // Stored transcript to be replayed on connect.
  const firstPost = await post('/api/sessions/' + createdId + '/messages', JSON.stringify({ text: 'first' }));
  assert.equal(firstPost.status, 201);

  // Open the SSE stream and accumulate chunks.
  let buf = '';
  const streamReq = http.request(
    { host: '127.0.0.1', port: Number(PORT), method: 'GET', path: '/api/sessions/' + createdId + '/stream' },
    (res) => {
      assert.equal(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('text/event-stream'));
      res.on('data', (c) => (buf += c));
    }
  );
  streamReq.end();

  async function waitForText(text, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (parseFrames(buf).some((f) => f.text === text)) return true;
      await sleep(50);
    }
    return false;
  }

  // 1. Replay observed.
  assert.ok(await waitForText('first'), 'replay frame "first" not received');

  // 2. Live push after subscribe.
  const livePost = await post('/api/sessions/' + createdId + '/messages', JSON.stringify({ text: 'live' }));
  assert.equal(livePost.status, 201);
  assert.ok(await waitForText('live'), 'live frame "live" not received');

  // 3. Ordering: replay precedes live.
  const frames = parseFrames(buf);
  const idxFirst = frames.findIndex((f) => f.text === 'first');
  const idxLive = frames.findIndex((f) => f.text === 'live');
  assert.ok(idxFirst >= 0 && idxLive >= 0);
  assert.ok(idxFirst < idxLive, 'replay frame must precede live frame');

  streamReq.destroy();
  await stop(srv);
});

// CR-01: a message POSTed during/around connect must be delivered exactly
// once after dedupe, and never lost. Register-first turns a would-be lost
// message into an at-most-once duplicate; the monotonic `seq` lets a client
// drop the boundary duplicate cleanly.
test('boundary POST during connect is delivered exactly once (seq dedupe)', async () => {
  const srv = await start();
  assert.ok(await waitReady(), 'server never became ready');

  const created = await post('/api/sessions', JSON.stringify({ name: 'Boundary Test ' + Date.now() }));
  assert.equal(created.status, 201);
  const boundaryId = JSON.parse(created.body).id;
  assert.ok(boundaryId);
  createdIds.push(boundaryId);

  // Pre-seed one stored message so replay has content.
  assert.equal(
    (await post('/api/sessions/' + boundaryId + '/messages', JSON.stringify({ text: 'seed' }))).status,
    201
  );

  // Open the SSE stream and, without awaiting connect, fire a concurrent
  // POST so it races the snapshot/registration window.
  let buf = '';
  const streamReq = http.request(
    { host: '127.0.0.1', port: Number(PORT), method: 'GET', path: '/api/sessions/' + boundaryId + '/stream' },
    (res) => {
      assert.equal(res.statusCode, 200);
      res.on('data', (c) => (buf += c));
    }
  );
  streamReq.end();
  // Do NOT await connect before posting -- this is the race window.
  const boundaryPost = post('/api/sessions/' + boundaryId + '/messages', JSON.stringify({ text: 'boundary' }));
  assert.equal((await boundaryPost).status, 201);

  async function waitForText(text, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (parseFrames(buf).some((f) => f.text === text)) return true;
      await sleep(50);
    }
    return false;
  }

  // Never lost: the boundary message must arrive (via replay or live).
  assert.ok(await waitForText('boundary'), 'boundary message was lost');

  // Every record carries a monotonic numeric seq.
  const frames = parseFrames(buf);
  for (const f of frames) {
    assert.equal(typeof f.seq, 'number', 'record missing numeric seq');
  }

  // After deduping by seq the boundary message appears exactly once (a
  // boundary duplicate, if the race produced one, collapses to a single
  // record because replay and live share the same positional seq).
  const bySeq = new Map();
  for (const f of frames) bySeq.set(f.seq, f);
  const boundaryRecs = [...bySeq.values()].filter((f) => f.text === 'boundary');
  assert.equal(boundaryRecs.length, 1, 'boundary message not exactly once after seq dedupe');

  streamReq.destroy();
  await stop(srv);
});
