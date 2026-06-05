'use strict';

const http = require('node:http');
const sessions = require('./sessions');

const PORT = Number(process.env.PORT) || 5757;

sessions.ensureSessionsDir();

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
