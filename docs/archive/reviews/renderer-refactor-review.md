# Review: Renderer Refactor Implementation (Phases 1-3)

**Reviewer**: Claude Opus 4.6
**Date**: 2026-03-30
**Scope**: All unstaged changes on `main` — implementation of `docs/renderer/renderer.md` phases 1-3
**Spec**: `docs/renderer/renderer.md`, `docs/todo.md`

---

## Summary

The changeset implements renderer refactor phases 1-3 from `docs/renderer/renderer.md` in a single pass across 24 files (+856/-1109 lines). It introduces:

- `RenderReconciler` with dirty-set invalidation and RAF batching
- `ScreenGrid` spatial hash for O(1) neighbor queries
- Per-command `dirtyPasses` on all 7 command classes
- `applyStageTransform` as the single stage-mutation API
- `replaceDocument` seam separating full replacement from load-only
- Species backfill on document load (stratum + canopy spread)
- Asymmetric anchored density suppression replacing symmetric O(n^2) suppression
- `todo.md` condensed from ~1000 lines to ~420, with history archived

TypeScript compiles clean. All 101 tests pass. The implementation is directionally correct and addresses all five confirmed bugs from the renderer spec.

---

## Verified Spec Conformance

| Spec Requirement | Status | Notes |
|------------------|--------|-------|
| Centralized `reconciler.invalidate(...)` entry point | Done | All signal effects, history ops, document load route through it |
| RAF-batched flush | Done | `_scheduleFlush` deduplicates into one frame |
| Deferred density/stacking with 150ms debounce | Done | `_scheduleDeferredPlantPasses` with `clearTimeout` coalescing |
| `ScreenGrid` spatial hash | Done | 40px cells, `queryNeighbors` with radius |
| `dirtyPasses` on commands | Done | All 7 command files; `BatchCommand` merges sub-command passes |
| History `execute`/`undo`/`redo` invalidation | Done | `_getDirtyPasses(cmd)` falls back to `DEFAULT_RENDER_PASSES` |
| Stage-transform ownership via `applyStageTransform` | Done | Reconciler writes stage attrs + zoomLevel + invalidates |
| Full-layer for correctness-sensitive passes (phase 1) | Done | Only density/stacking are deferred/viewport-scoped |
| Document-load stratum/canopy backfill | Done | `backfillPlantDisplayAttrs` with epoch-guarded async |
| Asymmetric density suppression (anchor algorithm) | Done | Sorted anchor walk with `shown` set, greedy top-left priority |
| Separate `replaceDocument` vs `loadDocument` | Done | Fixes the `document-actions.ts` facade bypass |
| `LocationInput` uses `location-actions.ts` | Done | Removes direct `currentDesign.value` mutation |
| No scattered `batchDraw` from outside pipeline | Done | Viewport, engine effects, external-input all route through `invalidateRender` |

---

## Bugs Fixed

### 1. Canopy circles not resizing during wheel zoom (High)
`applyStageTransform` now invalidates `plant-display` alongside `counter-scale`, `lod`, `annotations`, and `overlays`. The wheel handler calls `_applyViewportTransform` which delegates to `applyStageTransform`. Canopy radius refresh is no longer missed.

### 2. Stratum not restored on document load (High)
`backfillPlantDisplayAttrs` in `document-session.ts` calls `getSpeciesBatch` after materialization, writes `data-stratum` and `data-canopy-spread`, then invalidates `plant-display`, `lod`, `density`, `stacking`. Epoch guard prevents stale async completions.

### 3. Label density suppression hides every label in a cluster (Medium)
Replaced symmetric nearest-neighbor with greedy anchored suppression: plants sorted by (sy, sx), first plant claims its label, subsequent neighbors within threshold are suppressed only if a prior anchor is already `shown`. At least one label survives per cluster.

### 4. Undo/redo always performs full reconcile (Medium)
History now calls `invalidateRender(...cmd.dirtyPasses)` instead of `reconcileMaterializedScene()`. Text-only commands declare `['annotations', 'overlays']`, skipping all plant passes.

### 5. Programmatic stage transforms bypass renderer ownership (Low)
All viewport methods (zoom, pan, fit, reset) now go through `applyStageTransform` on the reconciler. No code mutates stage scale/position directly.

---

## Issues Found

### Critical

#### 1. `history.record()` does not call `invalidateRender`

**File**: `history.ts:54-68`
**Severity**: Critical — silent visual regression on every drag and transform

`record()` pushes to the past stack but does NOT call `engine.invalidateRender(...)`. This path is used by:
- Drag moves (`select.ts:459-461`)
- Transforms (`select.ts:511-513`)
- Rotate/flip (`object-ops.ts:141, 157`)
- Align/distribute (`object-ops.ts:234, 241`)

The spec (`renderer.md` section "History Integration Rule", lines 330-340) explicitly requires `record()` to invalidate. The Codex review of `renderer.md` (finding #3) also flagged this as Medium/High risk.

Currently these operations still reconcile because the tool or object-ops code calls `batchDraw()` directly after the mutation. But once those scattered `batchDraw()` calls are removed (which the spec intends), drag/transform will stop visually reconciling.

**Fix**: Add `invalidateRender` to `record()`:
```typescript
record(cmd: Command, engine: CanvasEngine): void {
  engine.invalidateRender?.(...this._getDirtyPasses(cmd))
  this._past.push(cmd)
  // ...
}
```
Note: this requires changing `record(cmd)` to `record(cmd, engine)` — update all 6 call sites.

### High

#### 2. `dirtyPasses` is optional (`readonly dirtyPasses?: ...`) but the spec says required

**File**: `history.ts:9`
**Severity**: High — any command without `dirtyPasses` silently triggers full reconcile

The `Command` interface declares `dirtyPasses` as optional with a `?`. The `_getDirtyPasses` fallback returns `DEFAULT_RENDER_PASSES` (all 8 passes) for commands that omit it. This defeats the purpose of per-command pass declarations.

Currently all 7 command classes do declare it, so this is not an active bug. But the optional typing creates a regression vector: any future command that forgets `dirtyPasses` will silently perform full reconcile without a type error.

The spec (`renderer.md` line 297-302) declares `dirtyPasses` as required (`readonly dirtyPasses: RenderPass[]`, no `?`).

**Fix**: Remove the `?` from the interface. This is a one-character change.

#### 3. `plants.ts` density function receives `ScreenGrid` but rebuilds positions internally

**File**: `plants.ts:185-230` and `render-reconciler.ts:120-129`

The reconciler builds `ScreenPlant[]` positions and populates the grid, then passes `plants.map(p => p.group)` (just groups, no positions) to `pipeline.updateDeferredPlantPasses`, which calls `updatePlantDensity(groups, ...)`. Inside `updatePlantDensity`, `collectScreenPlants(groups)` recomputes absolute positions by calling `getAbsolutePosition()` again on every group.

This is redundant — the reconciler already computed the positions 10 lines earlier. The ScreenGrid is populated from those positions, but the density function uses freshly-computed positions for its anchor loop, which could theoretically diverge from the grid contents (e.g., if a node moved between rebuild and flush).

**Fix**: Pass `ScreenPlant[]` through to `updatePlantDensity` and `updatePlantStacking` instead of `Konva.Group[]`, avoiding the redundant position computation.

### Medium

#### 4. `render-pipeline.ts` `dispose()` is now empty

**File**: `render-pipeline.ts:119`

The pipeline's `dispose()` method was gutted (RAF and timeout cleanup moved to reconciler), but the body is now `dispose(): void {}`. The engine still calls `this._renderPipeline?.dispose()` during teardown. This is harmless but misleading — it suggests lifecycle cleanup that doesn't exist.

Either remove `dispose()` from the pipeline class or document that it's intentionally a no-op now.

#### 5. `reconcileMaterializedScene()` is now a forwarding shell

**File**: `engine.ts:712-722`

`reconcileMaterializedScene()` now just calls `invalidateRender` with all 8 passes. It's still used by:
- `document-session.ts:183` (via `engine.invalidateRender(...)` directly — already inlined)
- No external callers remain after the refactor

The method is now dead code on the public API. If no external consumer needs it, consider removing it to avoid confusion about which method to call.

#### 6. `applyStageTransform` always invalidates `plant-display` and `lod` even for pan-only changes

**File**: `render-reconciler.ts:41-47`

`applyStageTransform` invalidates `counter-scale`, `plant-display`, `lod`, `annotations`, `overlays` on every call. During pan (no scale change), `counter-scale`, `plant-display`, and `lod` are no-ops since scale hasn't changed. This isn't a correctness issue (the passes will run and find nothing to do), but it's unnecessary work.

Currently pan goes through `invalidateRender('overlays')` directly (viewport `_boundStageDragMove`), so this is not triggered by pan today. But if future code calls `applyStageTransform` for position-only changes, it will do redundant work.

#### 7. `updatePlantDensity` sorts by (sy, sx) but the spec says "stable iteration order"

**File**: `plants.ts:196-197`

The density function sorts plants by screen Y then X for deterministic anchoring. This is reasonable for greedy top-left priority, but it means anchoring results change when the user pans (screen positions change). The spec says "deterministic from stable iteration order" — the current sort is deterministic for a given viewport but not stable across pans.

This is acceptable for phase 2 (density is deferred and viewport-scoped) but worth noting if the algorithm is ever extended to full-layer scope.

#### 8. No test for `history.record()` invalidation

The spec's test matrix (`renderer.md` line 767) requires:
> `history` test: `record()` invalidates passes for drag / transform paths

This test does not exist. This is directly connected to issue #1 above — `record()` doesn't invalidate, so a test for it would currently fail.

### Low

#### 9. `ScreenGrid` key separator differs from spec

**File**: `screen-grid.ts:36,45` uses `"cellX:cellY"` (colon), spec uses `"cx,cy"` (comma).

Purely cosmetic — both work. But if cross-referencing spec vs. implementation, the difference is confusing.

#### 10. `render-reconciler.ts:129` long line

Line 129 is 107 characters. Not a bug, but exceeds typical 100-char convention.

#### 11. `todo.md` history archive is only 82 lines

`docs/archive/rewrite-history-2026-03.md` is 82 lines for what was a ~1000-line document. The condensation is aggressive — original wave implementation details, verification notes, and acceptance criteria are summarized very briefly. If historical context is needed later, the git history preserves the original, but the archive file itself may not be sufficient as a standalone reference.

---

## Architecture Assessment

### What works well

1. **Clean separation of concerns**: The reconciler owns scheduling, the pipeline owns execution, commands own pass declarations. No module overreaches.

2. **Incremental migration**: The pipeline is preserved as a delegate behind the reconciler rather than being rewritten. This matches the spec's "reuse existing rendering functions underneath" guidance.

3. **Stage-transform ownership**: The `applyStageTransform` API is the single point for stage mutation. Viewport no longer writes stage attrs directly. This is the correct fix for the bypass bug.

4. **Epoch-guarded async backfill**: The document-session backfill uses `getDocumentLoadEpoch()` to prevent stale async completions — a pattern that was missing in the original design.

5. **Document replacement seam**: `loadDocument` vs `replaceDocument` gives document-actions a proper facade without overloading one method. This directly addresses the Codex review finding #2 on `todo.md`.

6. **`todo.md` cleanup**: The condensation removes historical noise while preserving all non-negotiable rules and active blockers. The stability gate (section 7) addresses Codex review finding #3.

### What needs attention

1. **`record()` gap**: The most important gap. Drag/transform are the most common canvas interactions and they all go through `record()`.

2. **Test coverage for new behavior**: Tests verify reconciler flush, viewport transform, and backfill epoch guard, but don't cover the `record()` path or the density anchor algorithm directly.

3. **Dual position computation**: The reconciler-to-pipeline interface passes `Konva.Group[]` instead of `ScreenPlant[]`, causing positions to be computed twice per deferred flush.

---

## Recommendation

The implementation is solid for phases 1-3 and can be committed after fixing:

1. **Must fix before commit**: Add `invalidateRender` to `history.record()` (issue #1). Without this, drag and transform operations will regress when scattered `batchDraw()` calls are cleaned up.

2. **Should fix before commit**: Make `dirtyPasses` non-optional on `Command` (issue #2). One-character change that prevents future regressions.

3. **Should fix soon**: Add a `record()` invalidation test (issue #8). This is required by the spec's test matrix.

4. **Can defer**: Issues #3-#7, #9-#11 are low-risk improvements that can land in a follow-up.

---

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | Clean (0 errors) |
| `npm test` (vitest) | 17 files, 101 tests, all passing |
| `npm run build` | Not tested (requires full Tauri) |
| Live app verification | Not tested (requires `cargo tauri dev`) |
| Manual validation checklist from spec | Not tested |
