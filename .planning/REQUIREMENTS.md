# Requirements — DirectTalk

Derived from the approved design spec (`docs/specs/2026-06-05-directtalk-design.md`).
All v1 requirements are hypotheses until shipped and validated.

## v1 Requirements

### Server (SRV)
- [ ] **SRV-01**: Host Mac runs a zero-dependency Node server that serves the UI and relays messages
- [ ] **SRV-02**: Server listens on a configurable port (default 5757) and creates the `sessions/` directory on first run

### Connectivity (CONN)
- [ ] **CONN-01**: Host accesses the app via `localhost`; client Macs access it via `<host>.local` on the LAN (no IP entry needed)

### Sessions (SESS)
- [ ] **SESS-01**: User can create a new session by name
- [ ] **SESS-02**: User can resume an existing session chosen from a list
- [ ] **SESS-03**: Sessions persist as append-only JSONL and survive a server restart

### Messaging (MSG)
- [ ] **MSG-01**: A message posted from any browser appears live in every connected browser via SSE push
- [ ] **MSG-02**: Each message is labeled Host or Client, auto-detected by connection origin (localhost = Host)
- [ ] **MSG-03**: On connecting to a session, the full stored transcript replays before live messages
- [ ] **MSG-04**: ANSI escape codes are stripped from incoming text before storage and display

### Transcript (TXT)
- [ ] **TXT-01**: The transcript preserves multi-line formatting and indentation (monospace, `white-space: pre-wrap`) and renders text as text, never HTML

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

(Filled by roadmap — each REQ-ID mapped to a phase)
