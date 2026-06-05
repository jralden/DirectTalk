'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SESSIONS_DIR = path.join(__dirname, 'sessions');

function ensureSessionsDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function sessionPath(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    throw new Error('invalid session id');
  }
  return path.join(SESSIONS_DIR, id + '.jsonl');
}

function slugify(name) {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'session';
}

function createSession(name) {
  ensureSessionsDir();
  const createdAt = new Date().toISOString();
  const base = slugify(name) + '-' + Date.now();
  const metaLine = JSON.stringify({ type: 'meta', name, createdAt }) + '\n';
  let id = base;
  let n = 1;
  // Exclusive create ('wx'/O_EXCL): atomically fails if the file already
  // exists, closing the check-then-act race between processes. On EEXIST,
  // bump the suffix and retry instead of clobbering/appending.
  for (;;) {
    try {
      fs.writeFileSync(sessionPath(id), metaLine, { flag: 'wx' });
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      n += 1;
      id = base + '-' + n;
    }
  }
  return { id, name, createdAt };
}

function listSessions() {
  ensureSessionsDir();
  const out = [];
  let files;
  try {
    files = fs.readdirSync(SESSIONS_DIR);
  } catch (err) {
    return out;
  }
  for (const fname of files) {
    if (!fname.endsWith('.jsonl')) continue;
    try {
      const content = fs.readFileSync(path.join(SESSIONS_DIR, fname), 'utf8');
      const firstLine = content.split('\n').find((l) => l.trim().length > 0);
      if (!firstLine) continue;
      const meta = JSON.parse(firstLine);
      if (meta && meta.type === 'meta' && typeof meta.name === 'string') {
        out.push({
          id: fname.replace(/\.jsonl$/, ''),
          name: meta.name,
          createdAt: meta.createdAt,
        });
      }
    } catch (err) {
      continue;
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return out;
}

// Matches CSI sequences (e.g. \x1b[32m color codes) for server-side stripping.
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
}

// Count the msg records already stored for a session. Used to derive the
// next monotonic seq so that the seq assigned at append time matches the
// seq assigned by readSession's position enumeration (replay/live dedupe).
function countMessages(id) {
  if (!fs.existsSync(sessionPath(id))) return 0;
  const content = fs.readFileSync(sessionPath(id), 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  let n = 0;
  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (err) {
      continue;
    }
    if (rec.type === 'msg') n += 1;
  }
  return n;
}

// In-memory next-seq counter per session (WR-01). Seeded lazily from the
// on-disk msg count on first append, then incremented in-process. Because the
// read-and-increment below never yields to the event loop, two near-simultaneous
// appends cannot read the same value -- each gets a distinct, monotonic seq.
// The counter equals the positional seq readSession assigns on replay (both are
// 0-based among msg records, in append order), so live and replay seqs stay
// mutually consistent and the connect-boundary duplicate still dedupes. Seeded
// from disk so it stays correct across process restarts.
const nextSeq = new Map();

function appendMessage(id, side, text) {
  if (!fs.existsSync(sessionPath(id))) {
    throw new Error('unknown session: ' + id);
  }
  const clean = stripAnsi(text);
  // Atomically claim the next seq. The Map lookup + set is synchronous (no
  // await/yield between read and increment), so concurrent appends within this
  // single process each get a unique seq -- closing the countMessages read/write
  // race that previously handed two simultaneous posts the same seq.
  let seq = nextSeq.has(id) ? nextSeq.get(id) : countMessages(id);
  nextSeq.set(id, seq + 1);
  // seq = position of this record among msg records (0-based), matching the seq
  // readSession assigns on replay. Stored in the JSONL line; Phase 1 readers
  // tolerate extra fields.
  const rec = { type: 'msg', seq, side, text: clean, ts: new Date().toISOString() };
  fs.appendFileSync(sessionPath(id), JSON.stringify(rec) + '\n');
  return rec;
}

function readSession(id) {
  if (!fs.existsSync(sessionPath(id))) return null;
  const content = fs.readFileSync(sessionPath(id), 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  let meta = null;
  const messages = [];
  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (err) {
      continue;
    }
    if (rec.type === 'meta' && !meta) {
      meta = { id, name: rec.name, createdAt: rec.createdAt };
    } else if (rec.type === 'msg') {
      // Assign seq by position so replayed records carry the same seq the
      // live broadcast emitted (records written before seq existed get a
      // backfilled positional seq, keeping dedupe unambiguous).
      messages.push(Object.assign({}, rec, { seq: messages.length }));
    }
  }
  if (!meta) return null;
  return { meta, messages };
}

module.exports = {
  SESSIONS_DIR,
  ensureSessionsDir,
  sessionPath,
  stripAnsi,
  createSession,
  listSessions,
  appendMessage,
  readSession,
};
