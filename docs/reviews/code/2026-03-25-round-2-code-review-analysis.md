# Analysis — Code Review Round 2

Date: 2026-03-25

Subject: Analysis of `2026-03-25-round-2-code-review.md`

## Verdict

All 3 findings are valid. Finding #1 is my regression from the fix for round 1's finding #3. Finding #2 is a correct critique of my round 1 fix for finding #2. Finding #3 is a gap I left in round 1's fix #6.

## Finding-by-Finding

### Finding 1: Open/new marks document dirty immediately — CONFIRMED

**Verified at:** `design.ts:121-122`, `design.ts:141-142`, `CanvasPanel.tsx:63-64`

The sequence in all three open/new/queued-load paths is:
1. `resetDirtyBaselines()` → sets `canvasRevision = 0`, `canvasSavedRevision = 0`
2. `engine.history.clear()` → calls `_updateSignals()` → increments `canvasRevision` to 1
3. Result: `canvasRevision (1) !== canvasSavedRevision (0)` → dirty = true

This is my regression. When I replaced `canvasHistoryDepth` (which was `_past.length`, correctly 0 after clear) with a monotonic `canvasRevision++`, I forgot that `clear()` also calls `_updateSignals()`. The fix is simple: `clear()` should not increment the revision — clearing is not a document mutation.

**Severity agreement:** High. Correct.

### Finding 2: `atomic_replace` fallback can delete original and still fail — CONFIRMED

**Verified at:** `design/mod.rs:16-18`

The fallback is: `remove_file(dest)` then `rename(src, dest)`. If the rename fails after the remove succeeds, the destination file is gone and the temp file may still exist (or the caller removes it). In the save path (`format.rs:35`), there's a `.prev` backup, so recovery is possible. But in the autosave path, there's no backup — the previous autosave slot is just gone.

The reviewer is right that this is worse than the original bug for the autosave case. My "fix" for round 1 finding #2 introduced a data-loss window that didn't exist before.

The correct approach: don't remove dest. Instead, rename dest to a temporary name first, then rename src to dest, then remove the old dest. If the second rename fails, rename the old dest back.

**Severity agreement:** High. Correct — I made the save path less safe, not more.

### Finding 3: Settings persistence is partial — CONFIRMED

**Verified at:** `state/app.ts:37-42`

`persistCurrentSettings()` spreads `_lastSettings` but only overrides `locale`, `theme`, and `auto_save_interval_s`. The `snap_to_grid` and `grid_size_m` values that were hydrated at startup are not included in the override — they're carried through from `_lastSettings`, but if the user toggles snap in the toolbar (`engine.ts:560`), that change never reaches `persistCurrentSettings()` because:
1. The toggle doesn't call `persistCurrentSettings()`
2. Even if it did, `persistCurrentSettings()` doesn't read `snapToGridEnabled.value`

**Severity agreement:** Medium. Correct.

## Self-Assessment

All three are my bugs:
- #1: Regression from my monotonic counter fix (clear increments revision)
- #2: My atomic_replace fallback is worse than the original bug for autosave
- #3: Incomplete persistence coverage in my round 1 fix

The pattern: I'm fixing bugs too quickly and introducing new ones in the fix path. The dirty-state regression (#1) is especially obvious in hindsight — `clear()` calling `_updateSignals()` which increments the counter is right there in the code I wrote.
