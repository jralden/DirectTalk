# DirectTalk

A tiny LAN tool for sharing a plain-text transcript between two or more Macs on the same
wifi network. One Mac (the **host**) runs a small Node server; everyone — host included —
opens a URL in a browser and reads/writes a shared, append-only transcript.

Built to kill the slow, error-prone hand-copying of multi-line commands and their output
between a Claude Code session on one Mac and a terminal on another. No accounts, no
third-party sign-ons, **zero install on the client Macs**.

## Why

You're driving Claude Code on your Mac while installing/debugging on someone else's (a
family member's). Claude tells you to run a long bash script over there; you hand-type it,
run it, then hand-copy the output back. DirectTalk replaces the hand-copying: paste into a
box on either Mac and it appears, intact and formatted, in the transcript on every
connected Mac — live.

## Requirements

- macOS machines on the same wifi/LAN.
- [Node.js](https://nodejs.org) on the **host** Mac only (already present if you use
  Claude Code). No `npm install` — zero dependencies.
- Client Macs need only a browser.

## Run it

On the host Mac:

```bash
node server.js           # serves http://localhost:5757
PORT=8080 node server.js # custom port
```

You don't have to be in the project directory — paths resolve relative to the script, so a
full path works from anywhere: `node /path/to/DirectTalk/server.js`. The `sessions/` data
directory and `index.html` are always read from next to `server.js`.

Then:

1. **Host Mac** → open `http://localhost:5757`.
2. **Client Macs** (same wifi) → open `http://<host-name>.local:5757`.
   Find `<host-name>` with `scutil --get LocalHostName` on the host, then append `.local`
   (e.g. `http://johns-macbook.local:5757`). macOS Bonjour resolves it automatically — no
   IP addresses to type.
3. Pick an existing session or create a new one. Everyone in the same session shares one
   transcript.
4. Paste/type into the entry box, **Cmd+Enter** (or click Send). The line appears on every
   connected Mac, labeled **Host** or **Client**.

The host Mac is the hub: when its server is off, sessions aren't live. Transcripts are
saved to disk, so a session survives a server restart.

## Features

- **Live sync** over Server-Sent Events — new lines appear instantly on every browser.
- **Append-only transcript** — full history replays when you open a session; nothing is
  edited or lost. Reconnect-safe (sequence-number dedupe).
- **Faithful text** — multi-line scripts and terminal output keep their line breaks and
  indentation (monospace, `white-space: pre-wrap`). ANSI color codes are stripped. Text is
  rendered as text, never HTML.
- **Auto attribution** — messages from the host show as `Host`, everyone else `Client`
  (by connection origin; no role picker).
- **Connection status** — a live indicator shows connected / reconnecting / disconnected.
- **Zero install on clients, zero npm dependencies, one server file + one HTML file.**

## How it works

```
Host Mac                          Client Mac(s)
┌───────────────┐                 ┌──────────────┐
│  server.js    │◀── HTTP/SSE ───▶│   browser    │
│  (node:http)  │                 │ (index.html) │
│  sessions/    │                 └──────────────┘
│  *.jsonl      │
└───────────────┘
```

- `server.js` — `node:http` server: serves the UI, manages sessions, relays messages.
- `sessions.js` — append-only JSONL persistence (`sessions/<id>.jsonl`).
- `index.html` — single self-contained page (HTML + inline CSS + JS, no client deps).

API: `GET /api/sessions`, `POST /api/sessions`, `GET /api/sessions/:id/stream` (SSE),
`POST /api/sessions/:id/messages`.

## Security

LAN-only and **unauthenticated by design** — anyone on your wifi who knows the URL can read
and post to a session, and session files are stored unencrypted under `sessions/`.
Intended for a trusted home network. Don't expose it to the public internet.

## Tests

```bash
node --test
```

29 tests, zero dependencies.

## License

[MIT](LICENSE) © 2026 John Alden
