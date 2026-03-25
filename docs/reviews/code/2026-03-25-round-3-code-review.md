# Code Review Round 3

Date: 2026-03-25
Repository: `canopi`
Scope: current working tree after the second review fixes

Verification performed:

- `cargo test`: passed
- `npm run build` in `desktop/web`: passed

The round-2 headline regressions are fixed:

- `CanvasHistory.clear()` no longer increments the monotonic canvas revision.
- `persistCurrentSettings()` now includes `snap_to_grid`.
- The destructive `remove-then-rename` fallback is gone.

What remains is smaller, but still worth fixing.

## Findings

### 1. Medium: theme persistence still has two competing sources of truth, causing stale startup state and visible theme flips

Files:

- `desktop/web/src/utils/theme.ts:23`
- `desktop/web/src/utils/theme.ts:32`
- `desktop/web/src/app.tsx:26`
- `desktop/web/src/app.tsx:34`

Why this matters:

The app now persists settings through Rust, but `initTheme()` still reads and writes `localStorage` synchronously before the Rust `get_settings` bootstrap completes. That means startup theme selection is now driven by two stores:

- `localStorage` immediately at module init
- Rust settings asynchronously a moment later

If those ever diverge, the UI will initialize with the `localStorage` value and then switch to the Rust value once bootstrap resolves. That creates exactly the theme flicker this code says it is trying to avoid, and it leaves the app with split persistence semantics.

Impact:

- Users can see a theme flash on startup when `localStorage` and Rust disagree.
- Theme state becomes harder to reason about and debug because both stores are authoritative at different times.
- Any future settings migration or reset logic will have to reconcile both places.

Recommended fix:

- Pick one persistence source of truth for theme.
- If Rust settings are canonical, stop reading theme from `localStorage` during init and use a dedicated bootstrap strategy for early theme application.

### 2. Medium: `atomic_replace()` can be blocked indefinitely by a stale `.old` sidecar

Files:

- `desktop/src/design/mod.rs:14`
- `desktop/src/design/mod.rs:22`
- `desktop/src/design/mod.rs:23`
- `desktop/src/design/mod.rs:33`

Why this matters:

The new rollback-based fallback renames the destination to a fixed sidecar path: `dest.with_extension("canopi.old")`. If a prior interrupted save leaves that sidecar behind, or if another process creates it, the next `rename(dest, old)` can fail before the save even attempts the replacement. There is no recovery path for an already-existing `.old` file.

Impact:

- A stale `.old` file can cause all future saves/autosaves for that target to fail until manual cleanup.
- This is especially plausible after crashes, which is exactly when save robustness matters most.

Recommended fix:

- Use a unique temporary rollback filename instead of a fixed `.old` path, or cleanly detect and recover stale rollback files before attempting the rename.

## Notes

Resolved since round 2:

- Fresh open/new documents are no longer immediately dirty.
- `snap_to_grid` is now included in the persisted settings payload.

Residual risk:

- The document lifecycle is in much better shape now, but the persistence boot path still lacks frontend-level tests around startup hydration, theme application, and settings recovery after interrupted saves.

Detailed recommendations:

- Add a frontend startup test that boots the app with persisted Rust settings and asserts the initial rendered theme, locale, grid size, and snap state without relying on prior `localStorage`.
- Add a divergence test where `localStorage` and Rust theme settings intentionally disagree, then assert there is either no intermediate theme flip or that the app consistently honors the chosen source of truth.
- Add document lifecycle tests for `new`, `open`, `save`, `save as`, and `close with discard/save`, with explicit assertions on `designDirty`, title-bar dirty state, and autosave scheduling.
- Add a save-recovery test around interrupted replace flows: pre-create destination, temp file, and stale rollback sidecar variants, then verify the original file remains recoverable and subsequent saves are not permanently blocked.
- Promote the persistence contract into code comments or a short design note: define which store is canonical for each setting and what startup ordering guarantees the UI depends on.
- Add lightweight telemetry or structured logs around settings bootstrap and save replacement fallback so future persistence bugs are diagnosable from logs instead of reproduction alone.
