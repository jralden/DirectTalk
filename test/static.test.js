'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const server = require('../server');

let port;

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Local helper that also returns response headers (server.test.js's helper
// only returns status + body).
function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: buf })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('GET / returns 200 with Content-Type text/html', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  assert.ok(
    /text\/html/.test(res.headers['content-type'] || ''),
    'content-type should include text/html'
  );
});

test('GET / returns the HTML page (not JSON)', async () => {
  const res = await request('GET', '/');
  assert.ok(
    /<!doctype html>/i.test(res.body) || /<html/i.test(res.body),
    'body should contain the HTML document'
  );
});

test('GET /index.html also serves the page', async () => {
  const res = await request('GET', '/index.html');
  assert.equal(res.status, 200);
  assert.ok(/text\/html/.test(res.headers['content-type'] || ''));
});
