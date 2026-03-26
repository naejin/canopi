# Complete Code Review

Date: 2026-03-25
Repository: `canopi`
Reviewer stance: results first, ego last

## Scope

This review covered the current working tree across the Rust/Tauri backend and the Preact/Konva frontend, including active uncommitted changes already present in the workspace.

Verification performed:

- `cargo test` at repo root: passed
- `npm run build` in `desktop/web`: passed

Green builds did not materially reduce the defect surface here. The highest-risk issues are state-integrity, close-flow, and cross-platform file durability bugs that are not exercised by the current test/build coverage.

## Findings

### 1. Critical: the "Don't save" close path re-enters the close guard and prevents discarding changes

Files:

- `desktop/web/src/app.tsx:57`
- `desktop/web/src/app.tsx:61`
- `desktop/web/src/app.tsx:78`
- `desktop/web/node_modules/@tauri-apps/api/window.js:924`
- `desktop/web/node_modules/@tauri-apps/api/window.js:934`

Why this matters:

The close handler always calls `event.preventDefault()` for dirty documents, then calls `getCurrentWindow().close()` after the confirm dialog. In the installed Tauri API, `close()` explicitly emits `closeRequested` again; `destroy()` is the bypass path. That means the "Don't save" branch re-enters the same handler while `designDirty` is still true, so the user gets trapped in the confirmation loop and cannot actually discard changes.

Evidence:

- `app.tsx` prevents the original close at line 61.
- The "don't save or save succeeded" path calls `close()` again at line 78.
- The Tauri API implementation documents and implements `close()` as re-emitting the close request, and reserves `destroy()` for forced closure.

Impact:

- Unsaved documents cannot be closed without saving.
- Window close button and any programmatic close path inherit the same behavior.
- This is a user-facing dead-end in the primary document lifecycle.

Recommended fix:

- Use a one-shot bypass flag around the guarded close, or call `destroy()` only after the user explicitly chooses discard.
- Add an integration test around the three branches: clean close, save-before-close, discard-without-save.

### 2. High: overwriting an existing design or autosave is not cross-platform safe and will fail on Windows

Files:

- `desktop/src/design/format.rs:19`
- `desktop/src/design/format.rs:26`
- `desktop/src/design/format.rs:35`
- `desktop/src/design/autosave.rs:54`
- `desktop/src/design/autosave.rs:64`
- `desktop/src/design/autosave.rs:67`

Why this matters:

Both the main save path and the autosave path write to a temp file and then call `std::fs::rename(tmp, dest)` while `dest` may already exist. On Unix this usually replaces atomically. On Windows it does not replace an existing destination. This codebase is explicitly cross-platform (`lib-c`, `lib-cpp`, `lib-swift`), so the second manual save and every repeated autosave to the same slot are at risk of failing on Windows.

Impact:

- Existing `.canopi` files can become unsaveable after the first save on Windows.
- Autosave for already-saved designs can fail continuously after the first successful autosave.
- The failure mode is especially bad because it only appears on one target platform and is unlikely to be caught by Linux/macOS-local testing.

Recommended fix:

- Replace `rename` with an explicit atomic-replace strategy that works on Windows.
- Add at least one platform-aware test or abstraction around overwrite semantics.

### 3. High: dirty tracking breaks after 500 canvas operations, allowing unsaved changes to disappear

Files:

- `desktop/web/src/canvas/history.ts:11`
- `desktop/web/src/canvas/history.ts:27`
- `desktop/web/src/canvas/history.ts:42`
- `desktop/web/src/canvas/history.ts:74`
- `desktop/web/src/state/design.ts:41`
- `desktop/web/src/state/design.ts:58`

Why this matters:

Document dirtiness is derived from `canvasHistoryDepth !== canvasSavedIndex`. But `canvasHistoryDepth` is just `_past.length`, and `_past` is capped at `MAX_HISTORY = 500`. Once the stack reaches 500, new commands shift the oldest entry out and the length stays constant. After saving at depth 500, the 501st edit still leaves `canvasHistoryDepth` at 500, so the document incorrectly appears clean.

Impact:

- Unsaved canvas edits can stop showing as dirty.
- Autosave can stop firing because it gates on `designDirty`.
- The close guard can stop prompting even though there are unsaved edits.

This is a real integrity bug, not a cosmetic one.

Recommended fix:

- Track a monotonic history revision counter independent of the bounded undo stack length.
- Save the revision number as the baseline, not the current stack size.

### 4. Medium: north bearing leaks across documents when the newly loaded file has no bearing

Files:

- `desktop/web/src/canvas/serializer.ts:122`
- `desktop/web/src/canvas/serializer.ts:256`

Why this matters:

`toCanopi()` serializes `north_bearing_deg` from the current `northBearingDeg` signal. `fromCanopi()` only writes that signal when `file.north_bearing_deg != null`. If the user opens a design with a bearing, then opens one with `null`, the old bearing remains in memory and will be written back out on the next save/autosave.

Impact:

- Cross-document state contamination.
- Silent metadata corruption on save.
- Hard-to-diagnose because it depends on document load order.

Recommended fix:

- Reset `northBearingDeg` to the default when the incoming file does not define a value.
- Add a regression test for sequential loads with `some -> null`.

### 5. Medium: the autosave interval setting is effectively ignored after mount

Files:

- `desktop/web/src/app.tsx:34`
- `desktop/web/src/app.tsx:40`
- `desktop/web/src/components/panels/CanvasPanel.tsx:27`
- `desktop/web/src/components/panels/CanvasPanel.tsx:71`
- `desktop/web/src/components/panels/CanvasPanel.tsx:82`

Why this matters:

The app hydrates `autoSaveIntervalMs` asynchronously from Rust settings, but `CanvasPanel` installs its timer once inside a `useEffect(..., [])` and captures `autoSaveIntervalMs.value` at mount time. If the panel mounts before settings hydration completes, the timer stays at the default `60_000` ms for the rest of the session. Any later settings change has the same problem.

Impact:

- Persisted autosave interval is not reliably honored.
- Any future in-session autosave preference UI will look functional but remain inert.

Recommended fix:

- Recreate the interval whenever `autoSaveIntervalMs.value` changes.
- Prefer a small hook dedicated to autosave scheduling instead of burying it inside engine mount.

### 6. Medium: settings are hydrated from Rust but never persisted back to Rust

Files:

- `desktop/web/src/app.tsx:34`
- `desktop/web/src/components/shared/StatusBar.tsx:39`
- `desktop/web/src/components/shared/StatusBar.tsx:53`
- `desktop/web/src/components/canvas/CanvasToolbar.tsx:176`
- `desktop/src/commands/settings.rs:16`

Why this matters:

The frontend calls `get_settings` during bootstrap, and the Rust backend exposes `set_settings`, but the UI only mutates local signals (`locale`, `theme`, `snapToGridEnabled`, etc.). There is no frontend call path that persists those changes back through `set_settings`.

Impact:

- Language/theme/grid preferences revert on restart.
- The code presents a false persistence boundary: settings look durable because they are read from storage, but they are not written back.
- Theme persistence is especially confused because `initTheme()` also uses `localStorage`, which is then overwritten by the Rust bootstrap state on startup.

Recommended fix:

- Introduce a frontend settings IPC wrapper and persist on user change.
- Decide on a single source of truth for theme persistence instead of split localStorage/Rust state.

## Secondary Concerns

These are lower-severity but worth tracking:

- `desktop/web/src/state/design.ts:58` does not clear `autosaveFailed` on successful manual save, so the status warning can remain stale until a later autosave or document reset.
- The frontend currently has no browser-level tests around document lifecycle, undo/redo, or settings persistence. The defects above are exactly the class that compile/build checks miss.

## Suggested Fix Order

1. Fix the close/discard flow.
2. Fix cross-platform overwrite semantics for save and autosave.
3. Replace dirty tracking based on bounded history depth with a monotonic revision counter.
4. Fix document-state reinitialization on load (`north_bearing_deg` now, then audit similar stateful signals).
5. Wire settings persistence end to end and make autosave interval reactive.

## Review Notes

What I did not find:

- No immediate Rust test failures.
- No immediate TypeScript build failures.
- No obvious SQL injection issues in the reviewed query paths; the plant DB search path is parameterized.

What remains risky even after fixing the above:

- The canvas/document boundary is still lightly tested relative to its complexity.
- Cross-platform filesystem semantics are not covered by the current automated checks.
