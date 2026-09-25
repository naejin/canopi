# Always-on continuous save

Status: Accepted (2026-09-26, Canopi v2)

## Context

Canopi 1.x asked people to Save, prompted about unsaved changes on close or switch, and wrote timed recovery copies into a rotating folder nobody could reopen. Untitled work evicted other Designs' recovery copies. Modern tools (online documents, design tools, platform apps) save continuously and never ask.

## Decision

- **Always on, no switch.** Canopi writes every Design to its home about 1.5 s after the last change, and immediately on window blur, before replacing the open Design and before closing. There are no "unsaved changes" prompts. One code path keeps behaviour and tests simple; Undo and revert cover mistakes.
- **Every Design has a home.** A file (after Open or Save As) or a Design Draft (a new or template Design). Desktop drafts live in app data (`drafts/<id>.canopi`), Web drafts in browser storage; both are `.canopi` wire form. Save As… turns a draft into a file and deletes the draft. The welcome screens list drafts to open or delete.
- **Status, not dirtiness.** The shell shows Saving… / Saved / Couldn't save (Retry) / Changed outside Canopi. "Dirty" means "changes not yet written to the home".
- **Failures ask once.** If a replacement or close cannot write first: Retry / Discard changes (or Close without saving) / Cancel.
- **Outside changes are detected.** Loads return a SHA-256 fingerprint; each save must still find it on disk or it returns a conflict and writes nothing. The user chooses Keep my version (overwrite), Use the file's version (reload) or Save mine as a copy…; a missing file offers Save As… or recreate.
- **Revert.** "Revert to version when opened" restores the session's opening snapshot after a confirmation; continuous save then writes it. The `.canopi.prev` sidecar is removed.
- **Durable writes.** Every Design, draft and export write goes through one fsync-then-rename helper.

## Consequences

- The rotating autosave folder, its recovery commands and the `auto_save_interval_s` setting are deleted; an existing autosave folder is deleted at startup.
- Web Download is an export; the Web durable save is the browser Draft, lost if site data is cleared (see ADR 0005).
- A new Design is written on its first edit, so an untouched New leaves no empty draft.
