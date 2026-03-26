# Analysis — Complete Code Review

Date: 2026-03-25

Subject: Analysis of `2026-03-25-complete-code-review.md`

## Verdict

All 6 findings are valid. The reviewer found real bugs that would ship if uncorrected. Three are my Phase 2.1 regressions — I introduced the dirty tracking bug (#3), the stale autosave interval (#5), and the one-way settings hydration (#6). The close-flow bug (#1) and Windows rename bug (#2) predate Phase 2.1 but were not caught during it. The north bearing leak (#4) also predates Phase 2.1.

No finding is exaggerated or mischaracterized. The secondary concerns are also correct.

## Finding-by-Finding Verification

### Finding 1: Close/discard flow re-enters close guard — CONFIRMED

**Verified at:** `app.tsx:57-78`

The handler calls `event.preventDefault()` at line 61, shows a confirm dialog, and then calls `getCurrentWindow().close()` at line 78 regardless of the user's choice. Tauri v2's `close()` method re-emits `closeRequested`, which re-enters the same handler. Since `designDirty` is still true (it was never cleared for the "Don't save" branch), the user gets the prompt again infinitely.

**My assessment:** This is a real dead-end. The user literally cannot discard unsaved changes and close the window. The fix is `getCurrentWindow().destroy()` for the discard path, which bypasses the close-requested event entirely. This bug predates Phase 2.1 — I didn't introduce it, but I also didn't catch it during the work.

**Severity agreement:** Critical. Correct.

### Finding 2: Cross-platform rename fails on Windows — CONFIRMED

**Verified at:** `format.rs:35` and `autosave.rs:67`

Both paths use `std::fs::rename(tmp, dest)`. The Rust stdlib documentation states: "On Windows, this function currently corresponds to `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`." However, that flag was only added in later implementations. More importantly, if the destination is open by another process (which is common on Windows with file watchers, antivirus, or backup tools), the rename will fail with `Access Denied`.

**Re-examining:** Actually, on modern Rust (1.x), `std::fs::rename` on Windows DOES use `MOVEFILE_REPLACE_EXISTING` since rustc 1.21+. So the "does not replace an existing destination" claim from the reviewer may be partially overstated for the basic rename case. The real risk is concurrent access blocking the rename, not the lack of replace semantics per se.

**My assessment:** The risk is real but the severity is slightly overstated. The atomic rename does work on Windows for uncontested files. The vulnerability is that file watchers, antivirus real-time scanning, or backup software can hold transient locks that cause `rename` to fail unpredictably. The fix should still be applied — `std::fs::rename` should be wrapped with retry logic or use a Windows-specific API. Rating: High is appropriate given the cross-platform target.

**Severity agreement:** High. Mostly correct — the mechanism is slightly different than described but the impact is real.

### Finding 3: Dirty tracking breaks at 500 operations — CONFIRMED

**Verified at:** `history.ts:11,27,42,74` and `design.ts:41,58`

This is a genuine bug I introduced in Phase C. The logic:

1. `canvasHistoryDepth.value = this._past.length` (line 74)
2. `_past` is capped at `MAX_HISTORY = 500` (lines 27-29, 42-44)
3. After saving at depth 500: `canvasSavedIndex = 500`
4. Command 501 shifts oldest out: `_past.length` stays 500
5. `canvasHistoryDepth (500) === canvasSavedIndex (500)` → dirty is false

The fix the reviewer suggests is correct: use a monotonic revision counter that increments on every mutation, independent of the bounded stack size.

**My assessment:** This is my bug. The two-baseline model from Phase C was architecturally right but the implementation tied one baseline to a bounded array length instead of a monotonic counter. The previous review caught the undo-to-saved semantic issue, but neither I nor the reviewers caught the cap-boundary failure.

**Severity agreement:** High. Correct — this silently drops the dirty indicator.

### Finding 4: North bearing leaks across documents — CONFIRMED

**Verified at:** `serializer.ts:257-258`

`fromCanopi()` only writes `northBearingDeg` when `file.north_bearing_deg != null`. If a file has `null`, the signal retains whatever value was set by the previous document. Then `toCanopi()` reads from the signal (via `metadata.northBearingDeg ?? northBearingDeg.value`) and writes the stale value into the new file.

**My assessment:** Real cross-document state contamination. Easy fix — unconditionally reset `northBearingDeg` to `file.north_bearing_deg ?? 0` in `fromCanopi()`. This bug predates Phase 2.1 but should have been caught when I audited the serializer.

**Severity agreement:** Medium. Correct.

### Finding 5: Autosave interval captured at mount time — CONFIRMED

**Verified at:** `CanvasPanel.tsx:82`

`setInterval(..., autoSaveIntervalMs.value)` captures the signal's value at the time the effect runs. If the settings bootstrap IPC hasn't resolved yet (it's async), the value is the default `60_000`. If the user later changes their preference, the interval doesn't update.

**My assessment:** This is my Phase E regression. I replaced the hardcoded constant with a signal read but didn't make the timer reactive. The fix is to use a `useSignalEffect` that clears and recreates the interval when the signal changes.

**Severity agreement:** Medium. Correct.

### Finding 6: Settings hydrated but never persisted back — CONFIRMED

**Verified at:** `grep` for `set_settings` in frontend returns zero results.

The frontend reads settings from Rust but has no code path to write them back. Theme changes in `StatusBar.tsx`, locale changes, and grid toggles all mutate local signals but never call `set_settings`. On restart, everything reverts.

**My assessment:** The reviewer is correct that this creates a false persistence boundary. Phase E's plan only covered the bootstrap direction (Rust → frontend), not the persistence direction (frontend → Rust). The theme situation is especially confused because `initTheme()` uses `localStorage` independently, creating two competing persistence mechanisms.

**Severity agreement:** Medium. Correct.

### Secondary: `autosaveFailed` not cleared on manual save — CONFIRMED

**Verified at:** `design.ts:58-61`

`markSaved()` updates revision baselines but doesn't clear `autosaveFailed`. After a failed autosave, a successful manual save should clear the warning since the document is now safely persisted.

**My assessment:** My oversight in Phase C. Trivial fix.

## Self-Assessment

Of the 6 findings + 1 secondary:
- **3 are my Phase 2.1 regressions:** #3 (dirty cap bug), #5 (interval capture), #6 (one-way settings)
- **1 secondary is my Phase C oversight:** autosaveFailed not cleared on save
- **3 predate Phase 2.1:** #1 (close flow), #2 (Windows rename), #4 (north bearing)

The dirty tracking cap bug (#3) is the most embarrassing — I specifically designed the two-baseline model to be correct, and the plan review caught the monotonic counter problem with undo semantics, but neither review caught that tying one baseline to a bounded array length recreates a similar class of failure. The fix is straightforward: replace `canvasHistoryDepth` (bounded) with a monotonic `canvasRevision` counter that never wraps.

## Recommended Fix Order

Agree with the reviewer's suggested order:

1. **Close/discard flow** — user-facing dead-end, critical
2. **Cross-platform rename** — platform-specific save failure, high
3. **Dirty tracking cap** — silent integrity loss, high
4. **North bearing reset** — cross-document contamination, medium
5. **Settings persistence + reactive autosave** — correctness, medium
6. **autosaveFailed cleared on manual save** — cosmetic/correctness, low
