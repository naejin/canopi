# Code Review Round 4

Date: 2026-03-25
Repository: `canopi`
Scope: current working tree after the latest persistence and test updates

Verification performed:

- `cargo test`: passed
- `npm run build` in `desktop/web`: passed
- `npm test` in `desktop/web`: passed (`2` files, `14` tests)

This pass found no new hard data-loss regressions in the save/open paths. The remaining issues are user-visible correctness/UX semantics rather than basic durability failures.

## Findings

### 1. Medium: persisted non-system themes will still flash on startup

Files:

- `desktop/web/src/state/app.ts:17`
- `desktop/web/src/app.tsx:25`
- `desktop/web/src/app.tsx:34`
- `desktop/web/src/utils/theme.ts:23`

Why this matters:

Theme persistence is now correctly centralized in Rust, but the startup sequence still applies the theme effect before persisted settings arrive. The theme signal starts as `"system"` by default, `initTheme()` applies that immediately, and only afterwards does the async `get_settings` call overwrite `theme.value` with the persisted Rust value.

That means a user with a saved `"dark"` or `"light"` preference will still briefly see the system theme first, then the persisted theme once bootstrap resolves.

Impact:

- Visible startup flash for users whose saved theme differs from system theme.
- The code comment in `initTheme()` currently overstates the guarantee: removing `localStorage` eliminated the competing store problem, but it did not eliminate async-bootstrap flicker.

Recommended fix:

- Apply an initial theme before rendering based on a synchronously available source, or block first paint of themed surfaces until persisted settings are loaded.
- At minimum, update the comments so they describe the real behavior instead of claiming flicker is fully avoided.

### 2. Medium: undoing back to the saved canvas state still leaves the document permanently dirty

Files:

- `desktop/web/src/state/design.ts:27`
- `desktop/web/src/state/design.ts:45`
- `desktop/web/src/canvas/history.ts:49`
- `desktop/web/src/__tests__/dirty-state.test.ts:72`
- `desktop/web/src/__tests__/dirty-state.test.ts:81`

Why this matters:

The current dirty model is purely monotonic for canvas changes: every `execute`, `undo`, and `redo` increments `canvasRevision`, and `designDirty` only compares revision counters. That fixes the old 500-history-cap bug, but it also means that returning the canvas to the exact saved state via undo does not clear dirty state. The new frontend test suite explicitly codifies this as intentional.

Impact:

- Users can undo all canvas edits and still be prompted to save on close.
- Autosave can continue to run even though the visible document matches the last saved state.
- The dirty indicator no longer answers the user’s practical question, which is "does this document differ from what is saved?"

Recommended fix:

- Keep the monotonic counter for cap safety, but add a second notion of "canvas at saved checkpoint" for history-based equality.
- If that is intentionally out of scope, surface the tradeoff clearly in product behavior and documentation instead of treating the current result as fully correct.

## Notes

What looks solid in this round:

- The new frontend test harness is wired and runnable in this environment.
- `atomic_replace()` now has direct unit coverage, including stale-sidecar behavior.
- The previously reported save/discard and immediate-dirty regressions appear fixed.

Residual risk:

- The remaining gaps are mostly semantic and UX-facing. They are less catastrophic than earlier rounds, but they still affect user trust because they show up in the first seconds of app startup and in the core "did I really change anything?" workflow.
