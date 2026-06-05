# STATE — DirectTalk

Project memory. Updated at phase/plan transitions.

## Project Reference

- **Core value**: Text pasted into the entry box on any connected Mac appears, intact and formatted, in the transcript on every connected Mac — live, no accounts, no client install.
- **Current focus**: Phase 2 — Live Messaging & Text Fidelity
- **Spec**: `docs/specs/2026-06-05-directtalk-design.md`

## Current Position

- **Phase**: 2 — Live Messaging & Text Fidelity (complete)
- **Plan**: 02-01 complete; phase 2 done
- **Status**: Phase 2 complete — ready for `/gsd-plan-phase 3`
- **Progress**: [======    ] 2/3 phases complete

## Performance Metrics

- Phases complete: 2/3
- Requirements delivered: 11/14 (SRV-01, SRV-02, SESS-01, SESS-02, SESS-03, CONN-01, MSG-01, MSG-02, MSG-03, MSG-04, TXT-01)

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 1 | 01 | ~5m | 3 | 6 |
| 2 | 01 | ~6m | 3 | 4 |

## Accumulated Context

### Decisions
- Browser form factor: host runs server, all participants (host included) use the browser UI. Zero install on clients.
- Transport: pure Node, SSE (push) + POST (send), no WebSocket, no dependencies.
- Persistence: one append-only JSONL file per session (`sessions/<id>.jsonl`), meta line + msg lines. Crash-safe, no rewrite races.
- Role detection by origin: localhost/127.0.0.1 = Host, all others = Client. No role picker.
- No access barrier (accepted trade-off, trusted home LAN). No accounts/auth/encryption.
- Server-side session ids: slugify(name)+Date.now() with -N collision suffix; no client id reaches filesystem.
- server.js exports the http.Server and only listens under require.main===module so tests bind ephemeral ports.
- Handler wrapped in try/catch -> 500; 1MB body cap (req.destroy); process never crashes on bad input/IO.
- SSE for live push: text/event-stream, replay stored transcript on connect then keep open; in-memory Map<sessionId, Set<res>> registry, broadcast wrapped in try/catch, 15s heartbeat (unref), res 'close' cleanup.
- Role detection by req.socket.remoteAddress against loopback host-address set {127.0.0.1, ::1, ::ffff:127.0.0.1}.
- No double ANSI strip — appendMessage strips internally; routes pass raw text through.
- LAN reach via all-interface bind (server.listen(PORT), no host arg); clients use <host>.local via Bonjour/mDNS (CONN-01, docs/lan-access.md).

### Todos
(none)

### Blockers
(none)

## Session Continuity

- Roadmap and requirements traceability written 2026-06-05.
- Phase 1 plan 01 executed 2026-06-05: sessions.js + server.js + tests (13/13 pass). Commits fab8d80, 0490280, 23922ea.
- Phase 2 plan 01 executed 2026-06-05: SSE stream + messages routes + subscriber registry; messages.test.js, stream.test.js, docs/lan-access.md (21/21 pass). Commits 90c80ca, 8595cfa, a1d5c87.
- Next action: `/gsd-plan-phase 3`.

---
*Last updated: 2026-06-05 after phase 2 plan 01 execution*
