'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const sessions = require('./sessions');

const PORT = Number(process.env.PORT) || 5757;

sessions.ensureSessionsDir();

// sessionId -> Set<res> of open SSE responses.
const subscribers = new Map();

// res -> its heartbeat interval handle, so a dead socket detected by a failed
// write can clear the interval without waiting for the `close` event.
const heartbeats = new Map();

const HOST_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function sideFor(req) {
  return HOST_ADDRS.has(req.socket.remoteAddress) ? 'host' : 'client';
}

// Remove a subscriber from the registry and clear its heartbeat. Idempotent:
// safe to call from a write-failure path and again from `res.on('close')`.
function dropSubscriber(id, res) {
  const set = subscribers.get(id);
  if (set) {
    set.delete(res);
    if (set.size === 0) subscribers.delete(id);
  }
  const hb = heartbeats.get(res);
  if (hb) {
    clearInterval(hb);
    heartbeats.delete(res);
  }
}

function broadcast(id, rec) {
  const set = subscribers.get(id);
  if (!set) return;
  // JSON.stringify escapes newlines -> exactly one `data:` line per record.
  // This is load-bearing for SSE framing: do NOT emit raw multi-line text
  // here (e.g. `data: ${rec.text}`) -- a `\n` in the payload would start a
  // new field and a blank line mid-text would terminate the event early.
  const frame = 'data: ' + JSON.stringify(rec) + '\n\n';
  // Snapshot to an array: dropSubscriber mutates the Set on write failure,
  // and mutating a Set while iterating it is unsafe.
  for (const r of [...set]) {
    try {
      r.write(frame);
    } catch (e) {
      // Write threw -> socket is dead. Prune it now instead of relying
      // solely on the `close` event (WR-02/WR-03).
      dropSubscriber(id, r);
    }
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

    if (req.method === 'GET' && pathname === '/api/whoami') {
      return sendJson(res, 200, { side: sideFor(req) });
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
        // Flush headers immediately with an SSE comment. Node holds response
        // headers until the first body write; for an empty session there is no
        // replay to write, so without this the client's EventSource would not
        // fire `onopen` (stuck "connecting") until the first 15s heartbeat.
        res.write(':\n\n');

        // Register the subscriber BEFORE snapshotting/replaying. A POST that
        // lands in this window is then delivered as a LIVE frame instead of
        // being lost between the snapshot read and registration (CR-01). It
        // may also appear in the replay snapshot, producing a boundary
        // duplicate -- but every record carries a monotonic `seq`, so the
        // client dedupes by seq and sees each message exactly once. A lost
        // message is unrecoverable; a duplicate is not.
        if (!subscribers.has(id)) subscribers.set(id, new Set());
        subscribers.get(id).add(res);

        // Snapshot + replay AFTER registration. As in broadcast(),
        // JSON.stringify is load-bearing: it escapes newlines so each record
        // is exactly one `data:` line. Do NOT emit raw multi-line text here.
        const data = sessions.readSession(id);
        for (const msg of data.messages) {
          res.write('data: ' + JSON.stringify(msg) + '\n\n');
        }
        const hb = setInterval(() => {
          try {
            res.write(':\n\n');
          } catch (e) {
            // Heartbeat write threw -> socket is dead. Prune now and stop
            // firing every 15s against a gone socket (WR-03).
            dropSubscriber(id, res);
          }
        }, 15000);
        if (hb.unref) hb.unref();
        heartbeats.set(res, hb);
        res.on('close', () => dropSubscriber(id, res));
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
        // Reject a truly empty string (length 0). Whitespace-only text is
        // allowed on purpose -- the multi-line fidelity requirement means a
        // message of only spaces/newlines may be legitimate -- so do NOT
        // .trim() here.
        if (typeof text !== 'string' || text.length === 0) {
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

    // Host-only session deletion. Authorization is enforced here, not just in
    // the client UI: a client could otherwise issue this request directly.
    const del = pathname.match(/^\/api\/sessions\/([a-z0-9-]+)$/);
    if (req.method === 'DELETE' && del) {
      const id = del[1];
      if (sideFor(req) !== 'host') {
        return sendJson(res, 403, { error: 'forbidden' });
      }
      // End any open streams so watchers don't sit on a dead session.
      const set = subscribers.get(id);
      if (set) {
        for (const r of [...set]) {
          dropSubscriber(id, r);
          try { r.end(); } catch (e) { /* already closed */ }
        }
      }
      const existed = sessions.deleteSession(id);
      if (!existed) return sendJson(res, 404, { error: 'not found' });
      return sendJson(res, 200, { ok: true });
    }

    // Static landing page. Placed AFTER all /api branches so it never shadows
    // an API route, and BEFORE the trailing 404. LAN tool, tiny file: read it
    // per request (no caching needed).
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'internal error' });
  }
}

const server = http.createServer(handler);

// Expose internal registries for tests (e.g. asserting dead-socket pruning).
// Attached to the http.Server instance so the public export is unchanged.
server._subscribers = subscribers;
server._heartbeats = heartbeats;
// Exposed for tests: mutate to simulate a non-loopback (client) caller, since
// the test harness can only connect over loopback.
server._hostAddrs = HOST_ADDRS;

module.exports = server;

if (require.main === module) {
  server.listen(PORT, () =>
    console.log(`DirectTalk listening on http://localhost:${PORT}`)
  );
}
