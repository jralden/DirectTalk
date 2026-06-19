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
cd ~/Development/DirectTalk
node server.js           # serves http://localhost:5757 (default port)
PORT=8080 node server.js # serves on port 8080 instead
```

**Custom port.** By default the server listens on port **5757**. To use a different port,
set the `PORT` environment variable for the command: `PORT=8080 node server.js` runs it on
8080. The `PORT=8080` prefix applies to that one run only (it isn't permanent), and `8080`
is just an example — any free port works. Whatever port you choose, clients open the
matching URL (e.g. `http://<host-name>.local:8080`). Change the port if 5757 is already in
use or you prefer a different one.

The `cd` above just lets you type `node server.js` plainly. It isn't strictly required —
paths resolve relative to the script, so `node /path/to/DirectTalk/server.js` works from
any directory. The `sessions/` data directory and `index.html` are always read from next to
`server.js`.

Then:

1. **Host Mac** → open `http://localhost:5757`.
2. **Client Macs** (same wifi) → open `http://<host-name>.local:5757`.
   Find `<host-name>` with `scutil --get LocalHostName` on the host, then append `.local`
   (e.g. `http://johns-macbook.local:5757`). macOS Bonjour resolves it automatically — no
   IP addresses to type.
3. Pick a session from the list at the top of the page (on the host Mac you can create one
   with **+ New**). Everyone in the same session shares one transcript.
4. Paste/type into the entry box, **Cmd+Enter** (or click Send). The line appears on every
   connected Mac, labeled **Host** or **Client**.

The host Mac is the hub: when its server is off, sessions aren't live. Transcripts are
saved to disk, so a session survives a server restart.

## Install as a macOS app

To run DirectTalk by double-clicking instead of typing `node server.js`, build a
self-contained `.app`:

```bash
bash scripts/build-app.sh      # produces dist/DirectTalk.app
```

The bundle embeds a portable Node.js runtime (no system Node needed), starts the server,
and opens the UI in your default browser. Drag `dist/DirectTalk.app` into `/Applications`.
Quitting the app stops the server.

Notes:

- The script targets Apple Silicon (`darwin-arm64`); for an Intel Mac, change `NODE_ARCH`
  in `scripts/build-app.sh` to `darwin-x64`.
- The app is ad-hoc signed. Copying it to a *different* Mac triggers Gatekeeper the first
  time — right-click the app and choose **Open** to approve it.
- Session transcripts are written inside the app bundle, so install it where your user can
  write (the host Mac running it is the owner — `/Applications` is fine for an admin user).

## Roles: host vs. client

Everyone opens the same page, but what you can do depends on how you connected:

- **Host** — the browser on the Mac running the server (opened via `localhost`/loopback).
  Sees an always-visible session list with controls to **create** (`+ New`) and **delete**
  (`✕`) sessions.
- **Client** — any browser reaching the server over the LAN. Sees the same session list and
  can **select** any session to read and write its transcript, but cannot add or delete.

The role is decided server-side by connection origin (loopback = host) and shown as a badge
in the header. The session list refreshes on its own, so a session the host adds or removes
appears or disappears on every connected Mac within a few seconds. Deletion is enforced on
the **server**, not just hidden in the client UI — a client cannot delete a session even by
calling the API directly.

Note: "host" means *connected via `localhost`*. If you open the app on the host Mac using
its LAN IP or `.local` name instead of `localhost`, that browser is treated as a client.

## Features

- **Live sync** over Server-Sent Events — new lines appear instantly on every browser.
- **Append-only transcript** — full history replays when you open a session; nothing is
  edited or lost. Reconnect-safe (sequence-number dedupe).
- **Faithful text** — multi-line scripts and terminal output keep their line breaks and
  indentation (monospace, `white-space: pre-wrap`). ANSI color codes are stripped. Text is
  rendered as text, never HTML.
- **Auto attribution** — messages from the host show as `Host`, everyone else `Client`
  (by connection origin; no role picker).
- **Host/client roles** — the host (the Mac running the server) manages sessions
  (create/delete) from an always-on, auto-refreshing session list; clients select and chat
  but can't manage. Enforced server-side. See [Roles](#roles-host-vs-client).
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
`POST /api/sessions/:id/messages`, `DELETE /api/sessions/:id` (host-only),
`GET /api/whoami` (reports the caller's role).

## Security

LAN-only and **unauthenticated by design** — anyone on your wifi who knows the URL can read
and post to a session, and session files are stored unencrypted under `sessions/`.
Intended for a trusted home network. Don't expose it to the public internet.

The host/client split is **not** authentication: it gates session *management* (only the
loopback browser can create/delete) but reading and posting stay open to everyone on the
LAN. It distinguishes the operator's machine from family devices — it is not a security
boundary against an untrusted network.

## Tests

```bash
node --test
```

40 tests, zero dependencies.

## License

[MIT](LICENSE) © 2026 John Alden
