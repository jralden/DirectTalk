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

test('createSession returns {id,name,createdAt} and writes a meta first line', () => {
  const s = track(sessions.createSession('Debug Run'));
  assert.ok(s.id);
  assert.equal(s.name, 'Debug Run');
  assert.ok(s.createdAt);

  const content = fs.readFileSync(sessions.sessionPath(s.id), 'utf8');
  const firstLine = content.split('\n')[0];
  const meta = JSON.parse(firstLine);
  assert.equal(meta.type, 'meta');
  assert.equal(meta.name, 'Debug Run');
  assert.equal(meta.createdAt, s.createdAt);
});

test('two createSession with the same name produce distinct ids and files', () => {
  const a = track(sessions.createSession('Same Name'));
  const b = track(sessions.createSession('Same Name'));
  assert.notEqual(a.id, b.id);
  assert.notEqual(sessions.sessionPath(a.id), sessions.sessionPath(b.id));
  assert.ok(fs.existsSync(sessions.sessionPath(a.id)));
  assert.ok(fs.existsSync(sessions.sessionPath(b.id)));
});

test('listSessions returns one entry per .jsonl, newest-first', () => {
  const older = track(sessions.createSession('Older List Entry'));
  // force a later createdAt
  const list = sessions.listSessions();
  const ids = list.map((e) => e.id);
  assert.ok(ids.includes(older.id));
  // verify sort: createdAt is descending
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i - 1].createdAt >= list[i].createdAt);
  }
  const entry = list.find((e) => e.id === older.id);
  assert.equal(entry.name, 'Older List Entry');
  assert.ok(entry.createdAt);
});

test('listSessions skips an empty/unparseable file without throwing', () => {
  // write a junk file directly
  sessions.ensureSessionsDir();
  const junkId = 'junk-' + Date.now();
  createdIds.push(junkId);
  fs.writeFileSync(sessions.sessionPath(junkId), 'this is not json\n');
  assert.doesNotThrow(() => sessions.listSessions());
  const list = sessions.listSessions();
  assert.ok(!list.find((e) => e.id === junkId));
});

test('appendMessage appends a msg record', () => {
  const s = track(sessions.createSession('Append Target'));
  const rec = sessions.appendMessage(s.id, 'host', 'hi');
  assert.equal(rec.type, 'msg');
  assert.equal(rec.side, 'host');
  assert.equal(rec.text, 'hi');
  assert.ok(rec.ts);
});

test('appendMessage strips ANSI escape sequences before storage', () => {
  const s = track(sessions.createSession('Ansi Target'));
  const rec = sessions.appendMessage(s.id, 'host', '\x1b[32mgreen\x1b[0m text');
  assert.equal(rec.text, 'green text');

  const content = fs.readFileSync(sessions.sessionPath(s.id), 'utf8');
  assert.ok(!content.includes('\x1b'), 'raw ANSI persisted to disk');
});

test('readSession returns {meta,messages} for all appended lines; null for unknown', () => {
  const s = track(sessions.createSession('Read Target'));
  sessions.appendMessage(s.id, 'host', 'first');
  sessions.appendMessage(s.id, 'client', 'second');
  const res = sessions.readSession(s.id);
  assert.equal(res.meta.id, s.id);
  assert.equal(res.meta.name, 'Read Target');
  assert.equal(res.messages.length, 2);
  assert.equal(res.messages[0].text, 'first');
  assert.equal(res.messages[1].side, 'client');

  assert.equal(sessions.readSession('definitely-unknown-id'), null);
});

test('data persists on disk: fresh readSession returns the data', () => {
  const s = track(sessions.createSession('Persist Target'));
  sessions.appendMessage(s.id, 'host', 'persisted');
  // simulate fresh read (no in-memory state used anyway)
  const res = sessions.readSession(s.id);
  assert.equal(res.meta.name, 'Persist Target');
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].text, 'persisted');
});
