# LAN Access (CONN-01)

DirectTalk lets two Macs on the same network share a session. One Mac runs the
server (the **host**); the other connects as a **client** over the LAN.

## Host access

On the Mac running the server:

```
http://localhost:5757
```

(Use `$PORT` instead of `5757` if you started the server with a custom `PORT`.)

Requests from `localhost` arrive on the loopback address, so the host is labeled
`host` automatically (see role detection below).

## Client access

From another Mac on the same network:

```
http://<host>.local:5757
```

Replace `<host>` with the host Mac's local hostname. On the host, find it with:

```
scutil --get LocalHostName
```

Append `.local` to that value. Example: if `LocalHostName` is `studio`, clients
visit `http://studio.local:5757`.

`<host>.local` resolves via macOS Bonjour / mDNS — there is **no IP address to
look up or configure**. No DNS entry and no app code are required for name
resolution.

## Why it works

The server starts with `server.listen(PORT)` (see `server.js`). With no host
argument, Node binds **all interfaces** (`::` / `0.0.0.0`), so connections from
other machines on the LAN are accepted. The code does **not** bind
`127.0.0.1`-only, which would block remote clients. No additional application
code beyond the all-interface bind is needed for LAN reachability.

## Role detection

The server determines each message's side from the connection origin:

- `127.0.0.1`, `::1`, `::ffff:127.0.0.1` (loopback) → `host`
- any other remote address → `client`

So the Mac running the server is the host, and Macs reaching it over
`<host>.local` are clients.

## Requirements

- Both Macs must be on the same LAN (same Wi-Fi / wired network).
- mDNS (Bonjour) must be reachable — standard on macOS LANs.
