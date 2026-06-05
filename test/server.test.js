'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');

const server = require('../server');
const sessions = require('../sessions');

let port;
const createdIds = [];

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const id of createdIds) {
    fs.rmSync(sessions.sessionPath(id), { force: true });
  }
});

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : body;
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
    if (data !== undefined) req.write(data);
    req.end();
  });
}

test('POST /api/sessions creates a session (201 with id)', async () => {
  const res = await request('POST', '/api/sessions', JSON.stringify({ name: 'Verify Run' }));
  assert.equal(res.status, 201);
  const obj = JSON.parse(res.body);
  assert.ok(obj.id);
  assert.equal(obj.name, 'Verify Run');
  createdIds.push(obj.id);
});

test('GET /api/sessions lists the created session', async () => {
  const res = await request('GET', '/api/sessions');
  assert.equal(res.status, 200);
  const arr = JSON.parse(res.body);
  assert.ok(Array.isArray(arr));
  assert.ok(arr.find((e) => e.name === 'Verify Run'));
});

test('POST /api/sessions with non-JSON body returns 400 (server stays alive)', async () => {
  const res = await request('POST', '/api/sessions', 'not json');
  assert.equal(res.status, 400);
  // confirm server still responds afterward
  const ping = await request('GET', '/api/sessions');
  assert.equal(ping.status, 200);
});

test('POST /api/sessions with empty name returns 400', async () => {
  const res = await request('POST', '/api/sessions', JSON.stringify({ name: '' }));
  assert.equal(res.status, 400);
});

test('unknown route returns 404', async () => {
  const res = await request('GET', '/nope');
  assert.equal(res.status, 404);
});
