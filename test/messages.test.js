'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');

const server = require('../server');
const sessions = require('../sessions');

let port;
let sessionId;
const createdIds = [];

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
  const s = sessions.createSession('Msg Test ' + Date.now());
  sessionId = s.id;
  createdIds.push(sessionId);
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

test('POST appends and labels host from loopback', async () => {
  const res = await request(
    'POST',
    '/api/sessions/' + sessionId + '/messages',
    JSON.stringify({ text: 'hello' })
  );
  assert.equal(res.status, 201);
  const obj = JSON.parse(res.body);
  assert.equal(obj.type, 'msg');
  assert.equal(obj.side, 'host');
  assert.equal(obj.text, 'hello');
});

test('POST to unknown session -> 404', async () => {
  const res = await request(
    'POST',
    '/api/sessions/no-such-id-9999/messages',
    JSON.stringify({ text: 'hi' })
  );
  assert.equal(res.status, 404);
});

test('POST without text -> 400', async () => {
  const res = await request(
    'POST',
    '/api/sessions/' + sessionId + '/messages',
    JSON.stringify({})
  );
  assert.equal(res.status, 400);
});

test('ANSI stripped', async () => {
  const res = await request(
    'POST',
    '/api/sessions/' + sessionId + '/messages',
    JSON.stringify({ text: '\x1b[32mgreen\x1b[0m' })
  );
  assert.equal(res.status, 201);
  const obj = JSON.parse(res.body);
  assert.equal(obj.text, 'green');
  assert.ok(!obj.text.includes('\x1b'));
});

test('multiline + indentation preserved', async () => {
  const input = 'line1\n  indented\nline3';
  const res = await request(
    'POST',
    '/api/sessions/' + sessionId + '/messages',
    JSON.stringify({ text: input })
  );
  assert.equal(res.status, 201);
  const obj = JSON.parse(res.body);
  assert.equal(obj.text, input);
});
