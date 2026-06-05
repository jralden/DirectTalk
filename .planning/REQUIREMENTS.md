# Requirements — DirectTalk

Derived from the approved design spec (`docs/specs/2026-06-05-directtalk-design.md`).
All v1 requirements are hypotheses until shipped and validated.

## v1 Requirements

### Server (SRV)
- [x] **SRV-01**: Host Mac runs a zero-dependency Node server that serves the UI and relays messages
- [x] **SRV-02**: Server listens on a configurable port (default 5757) and creates the `sessions/` directory on first run

### Connectivity (CONN)
- [x] **CONN-01**: Host accesses the app via `localhost`; client Macs access it via `<host>.local` on the LAN (no IP entry needed)

### Sessions (SESS)
- [x] **SESS-01**: User can create a new session by name
- [x] **SESS-02**: User can resume an existing session chosen from a list
- [x] **SESS-03**: Sessions persist as append-only JSONL and survive a server restart

### Messaging (MSG)
- [x] **MSG-01**: A message posted from any browser appears live in every connected browser via SSE push
- [x] **MSG-02**: Each message is labeled Host or Client, auto-detected by connection origin (localhost = Host)
- [x] **MSG-03**: On connecting to a session, the full stored transcript replays before live messages
- [x] **MSG-04**: ANSI escape codes are stripped from incoming text before storage and display

### Transcript (TXT)
- [ ] **TXT-01**: The transcript preserves multi-line formatting and indentation (monospace, `white-space: pre-wrap`) and renders text as text, never HTML — _data layer done (byte-exact POST→store→SSE round-trip, Phase 2); `pre-wrap`/never-HTML rendering is Phase 3 UI_

### UI (UI)
- [ ] **UI-01**: A session picker lists existing sessions (name + created date) and offers "new session"
- [ ] **UI-02**: A scrollable transcript pane auto-scrolls on new messages; each line shows side + timestamp
- [ ] **UI-03**: An entry box (textarea + Send, Cmd+Enter to send) clears on success and keeps text on a failed send
- [ ] **UI-04**: A connection-status indicator shows connected / reconnecting state

## v2 Requirements (Deferred)

(None — v1 is the complete intended product for now)

## Out of Scope

- Accounts, auth, encryption — trusted home network; complexity not wanted
- Message edit/delete — append-only transcript is the model
- File/image transfer — text-only is the core need
- Internet / non-LAN access — LAN-only by design
- Distinct per-client identities — all clients share the "Client" label

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SRV-01 | Phase 1 | Complete |
| SRV-02 | Phase 1 | Complete |
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete (API) |
| SESS-03 | Phase 1 | Complete |
| CONN-01 | Phase 2 | Complete |
| MSG-01 | Phase 2 | Complete |
| MSG-02 | Phase 2 | Complete |
| MSG-03 | Phase 2 | Complete |
| MSG-04 | Phase 2 | Complete |
| TXT-01 | Phase 2 / Phase 3 | Data layer complete; rendering Phase 3 |
| UI-01 | Phase 3 | Pending |
| UI-02 | Phase 3 | Pending |
| UI-03 | Phase 3 | Pending |
| UI-04 | Phase 3 | Pending |

**Coverage:** 14/14 v1 requirements mapped, no orphans, no duplicates.
