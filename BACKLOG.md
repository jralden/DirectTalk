# DirectTalk — Backlog

Enhancements and changes to consider after living with v1.0 for a while.
Newest ideas go at the bottom; nothing here is committed work yet.

## Open

1. **Delete a session.** There's no way to remove a session from the app today — old
   sessions accumulate in the picker and must be deleted by hand (`rm sessions/<id>.jsonl`
   on the host). Add a delete action (e.g. a button in the picker) plus a
   `DELETE /api/sessions/:id` endpoint, with a confirm step so it isn't one misclick.

## Done

(none yet)
