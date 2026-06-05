# STATE — DirectTalk

Project memory. Updated at phase/plan transitions.

## Project Reference

- **Core value**: Text pasted into the entry box on any connected Mac appears, intact and formatted, in the transcript on every connected Mac — live, no accounts, no client install.
- **Current focus**: Phase 1 — Server & Session Persistence
- **Spec**: `docs/specs/2026-06-05-directtalk-design.md`

## Current Position

- **Phase**: 1 — Server & Session Persistence
- **Plan**: None yet
- **Status**: Roadmap created, awaiting `/gsd-plan-phase 1`
- **Progress**: [          ] 0/3 phases complete

## Performance Metrics

- Phases complete: 0/3
- Requirements delivered: 0/14

## Accumulated Context

### Decisions
- Browser form factor: host runs server, all participants (host included) use the browser UI. Zero install on clients.
- Transport: pure Node, SSE (push) + POST (send), no WebSocket, no dependencies.
- Persistence: one append-only JSONL file per session (`sessions/<id>.jsonl`), meta line + msg lines. Crash-safe, no rewrite races.
- Role detection by origin: localhost/127.0.0.1 = Host, all others = Client. No role picker.
- No access barrier (accepted trade-off, trusted home LAN). No accounts/auth/encryption.

### Todos
(none)

### Blockers
(none)

## Session Continuity

- Roadmap and requirements traceability written 2026-06-05.
- Next action: `/gsd-plan-phase 1`.

---
*Last updated: 2026-06-05 at roadmap creation*
