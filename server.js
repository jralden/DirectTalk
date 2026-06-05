'use strict';

const http = require('node:http');
const sessions = require('./sessions');

const PORT = Number(process.env.PORT) || 5757;

sessions.ensureSessionsDir();

// sessionId -> Set<res> of open SSE responses.
const subscribers = new Map();

const HOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sideFor(req) {
  return HOST_ADDRS.has(req.socket.remoteAddress) ? 'host' : 'client';
}

function broadcast(id, rec) {
  const set = subscribers.get(id);
  if (!set) return;
  const frame = 'data: ' + JSON.stringify(rec) + '\n\n';
  for (const r of set) {
    try {
      r.write(frame);
    } catch (e) {}
  }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(d));
    req.on('error', () => resolve(''));
  });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/api/sessions') {
      return sendJson(res, 200, sessions.listSessions());
    }

    if (req.method === 'POST' && pathname === '/api/sessions') {
      const raw = await readBody(req);
      let body;
      try {
        body = JSON.parse(raw);
      } catch (err) {
        return sendJson(res, 400, { error: 'name is required' });
      }
      const name = body && body.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return sendJson(res, 400, { error: 'name is required' });
      }
      const s = sessions.createSession(name);
      return sendJson(res, 201, s);
    }

    const m = pathname.match(/^\/api\/sessions\/([a-z0-9-]+)\/(stream|messages)$/);
    if (m) {
      const id = m[1];
      const sub = m[2];

      if (req.method === 'GET' && sub === 'stream') {
        // 404 guard before committing to the SSE response.
        if (!sessions.readSession(id)) {
          return sendJson(res, 404, { error: 'not found' });
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        // Register the subscriber BEFORE snapshotting/replaying. A POST that
        // lands in this window is then delivered as a LIVE frame instead of
        // being lost between the snapshot read and registration (CR-01). It
        // may also appear in the replay snapshot, producing a boundary
        // duplicate -- but every record carries a monotonic `seq`, so the
        // client dedupes by seq and sees each message exactly once. A lost
        // message is unrecoverable; a duplicate is not.
        if (!subscribers.has(id)) subscribers.set(id, new Set());
        subscribers.get(id).add(res);

        // Snapshot + replay AFTER registration.
        const data = sessions.readSession(id);
        for (const msg of data.messages) {
          res.write('data: ' + JSON.stringify(msg) + '\n\n');
        }
        const hb = setInterval(() => {
          try {
            res.write(':\n\n');
          } catch (e) {}
        }, 15000);
        if (hb.unref) hb.unref();
        res.on('close', () => {
          clearInterval(hb);
          const s = subscribers.get(id);
          if (s) {
            s.delete(res);
            if (s.size === 0) subscribers.delete(id);
          }
        });
        return;
      }

      if (req.method === 'POST' && sub === 'messages') {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw);
        } catch (e) {
          return sendJson(res, 400, { error: 'text is required' });
        }
        const text = body && body.text;
        if (typeof text !== 'string') {
          return sendJson(res, 400, { error: 'text is required' });
        }
        // No separate existence guard: appendMessage's own existsSync is the
        // single source of truth. Translating its "unknown session" throw to
        // a 404 avoids a redundant full-transcript read and the TOCTOU that
        // would otherwise surface as a 500 if the file vanished mid-request.
        let rec;
        try {
          rec = sessions.appendMessage(id, sideFor(req), text);
        } catch (e) {
          if (/unknown session/.test(e.message)) {
            return sendJson(res, 404, { error: 'not found' });
          }
          throw e;
        }
        broadcast(id, rec);
        return sendJson(res, 201, rec);
      }
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'internal error' });
  }
}

const server = http.createServer(handler);

module.exports = server;

if (require.main === module) {
  server.listen(PORT, () =>
    console.log(`DirectTalk listening on http://localhost:${PORT}`)
  );
}
