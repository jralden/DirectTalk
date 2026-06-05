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
  let id = base;
  let n = 1;
  while (fs.existsSync(sessionPath(id))) {
    n += 1;
    id = base + '-' + n;
  }
  fs.appendFileSync(
    sessionPath(id),
    JSON.stringify({ type: 'meta', name, createdAt }) + '\n'
  );
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
      if (meta && meta.type === 'meta') {
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

function appendMessage(id, side, text) {
  const clean = stripAnsi(text);
  const rec = { type: 'msg', side, text: clean, ts: new Date().toISOString() };
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
      messages.push(rec);
    }
  }
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
