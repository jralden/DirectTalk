'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sessions = require('../sessions');

const REPO_ROOT = path.join(__dirname, '..');
const PORT = '5912';
const SESSION_NAME = 'Restart Run ' + Date.now();

let createdId = null;
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

function start() {
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

after(async () => {
  for (const p of procs) await stop(p);
  if (createdId) fs.rmSync(sessions.sessionPath(createdId), { force: true });
});

test('a session survives a full server stop and restart', async () => {
  // Instance A
  const a = start();
  assert.ok(await waitReady(), 'server A never became ready');

  const created = await post('/api/sessions', JSON.stringify({ name: SESSION_NAME }));
  assert.equal(created.status, 201);
  const obj = JSON.parse(created.body);
  createdId = obj.id;
  assert.ok(createdId);

  // confirm A lists it
  const listA = await get('/api/sessions');
  const arrA = JSON.parse(listA.body);
  assert.ok(arrA.find((e) => e.id === createdId && e.name === SESSION_NAME));

  // Stop A
  await stop(a);

  // Instance B (fresh process)
  const b = start();
  assert.ok(await waitReady(), 'server B never became ready');

  const listB = await get('/api/sessions');
  assert.equal(listB.status, 200);
  const arrB = JSON.parse(listB.body);
  const found = arrB.find((e) => e.id === createdId);
  assert.ok(found, 'session not present after restart');
  assert.equal(found.name, SESSION_NAME);

  await stop(b);
});
