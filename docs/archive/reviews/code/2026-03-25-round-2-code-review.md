# Code Review Round 2

Date: 2026-03-25
Repository: `canopi`
Scope: current working tree after the first review fixes

Verification performed:

- `cargo test`: passed
- `npm run build` in `desktop/web`: passed

Several first-round issues were fixed correctly: the close loop now uses `destroy()`, north bearing is reset on load, and autosave interval scheduling is now reactive. The remaining problems are concentrated in document lifecycle correctness and file durability.

## Findings

### 1. High: opening or creating a design now marks it dirty immediately

Files:

- `desktop/web/src/canvas/history.ts:65`
- `desktop/web/src/canvas/history.ts:74`
- `desktop/web/src/state/design.ts:121`
- `desktop/web/src/state/design.ts:141`
- `desktop/web/src/components/panels/CanvasPanel.tsx:63`

Why this matters:

The new dirty model uses a monotonic `canvasRevision`, and `CanvasHistory.clear()` now increments that revision via `_updateSignals()`. But the open/new/queued-load flows still call `resetDirtyBaselines()` before `engine.history.clear()`. That means a freshly opened or newly created document ends with `canvasRevision = 1` and `canvasSavedRevision = 0`, so `designDirty` becomes true immediately.

Impact:

- Freshly opened documents appear unsaved before the user edits anything.
- Autosave fires unnecessarily on untouched documents.
- The close guard will prompt to save even when the user only opened a file and did nothing.

Recommended fix:

- Either make `history.clear()` not increment the monotonic revision, or call `clear()` before resetting the dirty baselines.
- Add a regression test for `new -> dirty=false` and `open -> dirty=false`.

### 2. High: the new `atomic_replace()` fallback can delete the original file and still fail

Files:

- `desktop/src/design/mod.rs:7`
- `desktop/src/design/mod.rs:16`
- `desktop/src/design/mod.rs:18`
- `desktop/src/design/format.rs:35`
- `desktop/src/design/autosave.rs:67`

Why this matters:

The new helper is documented as an atomic replace, but its fallback path is `remove_file(dest)` followed by `rename(src, dest)`. If the second step fails after the destination has already been removed, the original file is gone and the replacement may also be absent. In the main save path, the caller then removes the temp file on error, which makes the failure destructive rather than merely unsuccessful.

Impact:

- A failed save can now delete the user’s current design file.
- A failed autosave can delete the previous autosave slot.
- This is worse than the original Windows-overwrite bug because it creates a true data-loss window.

Recommended fix:

- Do not remove the destination before you have a guaranteed replacement strategy.
- Use a platform-specific replace primitive that preserves atomicity, or fall back to copy-and-fsync semantics without deleting the original until success is guaranteed.

### 3. Medium: settings persistence is still only partial; `snap_to_grid` remains user-visible but non-durable

Files:

- `desktop/web/src/state/app.ts:35`
- `desktop/web/src/state/app.ts:41`
- `desktop/web/src/components/shared/StatusBar.tsx:43`
- `desktop/web/src/commands/registry.ts:35`
- `desktop/web/src/canvas/engine.ts:559`

Why this matters:

The new persistence path only writes back `locale`, `theme`, and `auto_save_interval_s`. But the app still hydrates `grid_size_m` and `snap_to_grid` from Rust settings at startup, and `snap_to_grid` is a user-facing toggle in the canvas toolbar. Toggling snap changes runtime behavior, but that change is never persisted.

Impact:

- Users see snap-to-grid revert on restart.
- The settings model is still internally inconsistent: some hydrated settings are durable, others are session-only.
- This will be hard to reason about once more settings UI is added on top of the current partial persistence.

Recommended fix:

- Persist all user-editable settings that are already part of the Rust `Settings` object.
- At minimum, wire `snap_to_grid` and any future `grid_size_m` control into the same persistence path.

## Notes

Resolved since round 1:

- Close/discard loop fixed by switching from `close()` to `destroy()`.
- `north_bearing_deg` no longer leaks between documents.
- Autosave interval now rebinds when the interval signal changes.

Residual risk:

- The document lifecycle still lacks automated frontend coverage. The dirty-state regression above is exactly the kind of issue that slips through builds and unit tests but changes user-visible behavior immediately.
