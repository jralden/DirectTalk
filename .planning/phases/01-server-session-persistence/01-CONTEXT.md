# Phase 1: Server & Session Persistence - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** Auto-generated (discuss skipped via workflow.skip_discuss)

<domain>
## Phase Boundary

A zero-dependency Node server runs on the host Mac, manages named sessions, and persists
them to disk so they survive a restart.

Covers requirements: SRV-01, SRV-02, SESS-01, SESS-02, SESS-03.

In scope: the HTTP server process, session create/list/resume API, JSONL persistence,
configurable port, `sessions/` directory bootstrap. Verifiable via `curl` alone — no
browser UI yet (that is Phase 3), no live SSE messaging (that is Phase 2).
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss skipped per user setting.
Use the approved design spec (`docs/specs/2026-06-05-directtalk-design.md`), the ROADMAP
phase goal, success criteria, and codebase conventions to guide decisions.

Anchored by the spec:
- Runtime: Node.js, standard library only (no npm dependencies). Use `node:http`,
  `node:fs`, `node:path`, `node:crypto`.
- Port: default 5757, overridable via `PORT` env var (and/or CLI arg).
- Sessions stored as append-only JSONL: `sessions/<id>.jsonl`. Line 1 = meta record
  `{type:"meta", name, createdAt}`; subsequent lines = message records (added in Phase 2).
- Session id: slug derived from name + creation timestamp, collision-safe.
- Endpoints to stand up in this phase: `GET /api/sessions` (list by scanning the dir +
  reading each meta line), `POST /api/sessions` (create `{name}`, returns id).
- The `sessions/` directory is created on first run if missing.
</decisions>

<code_context>
## Existing Code Insights

Greenfield. No application source exists yet. This phase creates `server.js` (the server
entry point). Keep it a single file per the spec's two-file shape (`server.js` +
`index.html`); `index.html` arrives in Phase 3.
</code_context>

<specifics>
## Specific Ideas

- Keep the server resilient: tolerate malformed request bodies and file I/O errors
  without crashing.
- Structure the code so Phase 2 can add the SSE stream and message-append endpoint and
  Phase 3 can add static serving of `index.html` without rework.
</specifics>

<deferred>
## Deferred Ideas

- Live SSE messaging, role detection, ANSI stripping, transcript replay → Phase 2.
- Browser UI and static file serving → Phase 3.
</deferred>
