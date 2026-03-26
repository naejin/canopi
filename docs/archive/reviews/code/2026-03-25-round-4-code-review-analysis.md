# Analysis — Code Review Round 4

Date: 2026-03-25

Subject: Analysis of `2026-03-25-round-4-code-review.md`

## Verdict

Both findings are valid.

### Finding 1: Theme flash on startup — CONFIRMED

The signal starts as `"system"`, `initTheme()` applies it immediately, then async `get_settings` overwrites it. A user who saved `"dark"` will see system-theme → dark flash.

The fix: use `localStorage` as a **synchronous cache** for the initial paint, not as a competing source of truth. On bootstrap, write the Rust value to `localStorage` so subsequent startups have the correct theme available synchronously. This gives instant correct theme on startup while keeping Rust as the canonical authority.

### Finding 2: Undo-to-saved-state still dirty — CONFIRMED

The monotonic counter means execute→undo produces revision 2 vs saved 0 = dirty, even though the canvas content matches saved state. This was flagged in the Phase C plan review — the original reviewer recommended a two-baseline model with a history saved checkpoint marker, which I partially implemented but then replaced with a pure monotonic counter to fix the 500-cap bug.

The fix: track a `_savedPosition` in the history stack (index into `_past` at time of save). Canvas is clean when `_past.length === _savedPosition` AND the stack hasn't been truncated past the saved position. This gives undo-to-clean behavior while remaining safe against the 500-cap issue (if truncation shifts past the saved position, we know it can never be clean again — which is correct).

## Self-Assessment

Finding 1: I overcorrected when removing localStorage — it had a valid role as a sync cache for first paint. I should have kept the read path and removed only the write-as-authority path.

Finding 2: This is the tension from the Phase C plan review. The original reviewer recommended split baselines with a history saved checkpoint. I implemented the monotonic counter instead for simplicity. The reviewer is right that the result doesn't answer the user's question ("did I change anything?"). The hybrid approach (checkpoint + truncation guard) gives both correctness properties.
