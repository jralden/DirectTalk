# STATE — DirectTalk

Project memory. Updated at phase/plan transitions.

## Project Reference

- **Core value**: Text pasted into the entry box on any connected Mac appears, intact and formatted, in the transcript on every connected Mac — live, no accounts, no client install.
- **Current focus**: Phase 3 — Browser UI (built; two-Mac manual verify pending user)
- **Spec**: `docs/specs/2026-06-05-directtalk-design.md`

## Current Position

- **Phase**: 3 — Browser UI (built; awaiting two-Mac manual verification)
- **Plan**: 03-01 complete (buildable tasks); final human-verify checkpoint deferred to user
- **Status**: All 3 phases built — v1 complete pending two-Mac manual verification
- **Progress**: [==========] 3/3 phases built

## Performance Metrics

- Phases built: 3/3
- Requirements delivered: 14/14 buildable (UI-01..04 + TXT-01 rendering pending two-Mac visual check)

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 1 | 01 | ~5m | 3 | 6 |
| 2 | 01 | ~6m | 3 | 4 |
| 3 | 01 | ~5m | 2 | 3 |

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
- Phase 3 plan 01 executed 2026-06-06: index.html single-file UI + GET / static route + static.test.js (28/28 pass). Commits 970c0a9, 3941d94. Final task is a blocking two-Mac human-verify checkpoint — DEFERRED to user (unattended run cannot drive two physical Macs); checklist in 03-01-SUMMARY.md.
- Next action: user runs the two-Mac verification checklist (03-01-SUMMARY.md "Deferred to User") to close out v1.

---
*Last updated: 2026-06-06 after phase 3 plan 01 execution*
