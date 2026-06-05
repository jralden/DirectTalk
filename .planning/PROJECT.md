# DirectTalk

## What This Is

A tiny LAN tool for sharing a plain-text transcript between two or more Macs on the
same wifi network. One Mac (the host) runs a zero-dependency Node server; everyone —
host included — opens a URL in a browser and reads/writes a shared, append-only
transcript. Built to kill the slow, error-prone hand-copying of multi-line commands and
their results between a Claude Code session on one Mac and a terminal on another.

## Core Value

The ONE thing that must work: text pasted into the entry box on any connected Mac
appears, intact and formatted, in the transcript on every connected Mac — live, with no
accounts and no install on the client Macs.

## Context

- Author develops almost exclusively via Claude Code, often driving installs/updates/
  debugging on a family member's Mac while Claude Code runs on the author's Mac.
- All Macs share a home wifi network. Users are trusted family members.
- Constraint: no third-party sign-ons or shared credentials (family uses tools the
  author doesn't have logins for and doesn't want).
- Approved design spec: `docs/specs/2026-06-05-directtalk-design.md` (primary reference).

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Host Mac runs a zero-dependency Node server that serves the UI and relays messages
- [ ] Any Mac on the LAN opens the app in a browser (host via localhost, clients via `<host>.local`)
- [ ] Users can create a new named session or resume an existing one
- [ ] A message posted from any browser appears live in every connected browser's transcript
- [ ] The transcript preserves multi-line formatting and indentation (pasted scripts/terminal output)
- [ ] Incoming text has ANSI escape codes stripped before storage/display
- [ ] Each message is labeled by side (Host vs Client), auto-detected by connection origin
- [ ] Sessions persist to disk (append-only JSONL) and survive a server restart
- [ ] A connection-status indicator shows connected / reconnecting state

### Out of Scope

- Accounts, auth, encryption — trusted home network; complexity not wanted
- Message edit/delete — append-only transcript is the model
- File/image transfer — text-only is the core need
- Internet / non-LAN access — LAN-only by design
- Distinct per-client identities — all clients share the "Client" label (1:1 debugging flow)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Browser form factor (host server + browser UI) | Zero install/trust on family Macs; lowest friction | — Pending |
| Pure Node, SSE + POST, no dependencies | Append-only transcript fits push-only SSE; nothing to `npm install` | — Pending |
| No access barrier | Trusted home network; keep it simple | — Pending |
| Two-side attribution (Host/Client) by origin | No role-picker UI; matches actual usage | — Pending |
| Append-only JSONL persistence | Crash-safe, no rewrite races, simple resume | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-05 after initialization*
