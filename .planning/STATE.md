# STATE — DirectTalk

Project memory. Updated at phase/plan transitions.

## Project Reference

- **Core value**: Text pasted into the entry box on any connected Mac appears, intact and formatted, in the transcript on every connected Mac — live, no accounts, no client install.
- **Current focus**: Phase 1 — Server & Session Persistence
- **Spec**: `docs/specs/2026-06-05-directtalk-design.md`

## Current Position

- **Phase**: 1 — Server & Session Persistence (complete)
- **Plan**: 01-01 complete; phase 1 done
- **Status**: Phase 1 complete — ready for `/gsd-plan-phase 2`
- **Progress**: [===       ] 1/3 phases complete

## Performance Metrics

- Phases complete: 1/3
- Requirements delivered: 5/14 (SRV-01, SRV-02, SESS-01, SESS-02, SESS-03)

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 1 | 01 | ~5m | 3 | 6 |

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

### Todos
(none)

### Blockers
(none)

## Session Continuity

- Roadmap and requirements traceability written 2026-06-05.
- Phase 1 plan 01 executed 2026-06-05: sessions.js + server.js + tests (13/13 pass). Commits fab8d80, 0490280, 23922ea.
- Next action: `/gsd-plan-phase 2`.

---
*Last updated: 2026-06-05 after phase 1 plan 01 execution*
