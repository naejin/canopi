# Reactive Canvas Renderer: Remaining Work

**Date**: 2026-03-30  
**Status**: phases 1-3 are landed in code; targeted automated stability coverage, retained-surface Wave 3 live verification, and the post-fix renderer manual checklist all passed on 2026-03-30; no active renderer stability blocker remains

Use this file for future renderer work.

This file no longer plans phases 1-3 as future work. Those implementation details are now historical. The remaining active renderer work is:
- optional phase 4 viewport filtering only if measurement justifies it
- deferred internal cleanup that does not reopen the stability gate

---

## 1. Landed Renderer Architecture

These are the current canonical seams and must be preserved unless this file is updated directly.

### 1.1 Ownership

- `RenderReconciler` owns render invalidation, RAF batching, deferred scheduling, and stage-transform invalidation
- `render-pipeline.ts` is the execution delegate behind the reconciler
- `CanvasViewport` routes stage transforms through the engine-owned transform path
- `canvas/rulers.ts` owns the renderer-managed HTML overlay chrome seam for screen-space rulers and scale bar
- `CanvasHistory.execute/record/undo/redo` invalidate render passes instead of forcing generic full reconcile
- command classes declare `dirtyPasses`
- `document-session.ts` backfills plant display attrs after load and guards stale async completions with a document-load epoch

### 1.2 Current pass boundary

Full-layer or correctness-sensitive passes:
- `counter-scale`
- `plant-display`
- `lod`
- `annotations`
- `theme`
- `overlays`

Deferred viewport-local passes:
- `density`
- `stacking`

### 1.3 Rules That Remain Non-Negotiable

- all visual updates go through `reconciler.invalidate(...)`
- all stage transforms go through the engine-owned stage-transform path
- do not reintroduce direct renderer scheduling from viewport, tools, or action code
- do not widen viewport filtering beyond deferred passes without updating this doc and adding validation
- do not mix renderer correctness work with product-level visual redesign

---

## 2. What Is Left To Do

### 2.1 Stability-Gate Validation

This is complete on the current build.

What landed:
- targeted automated checks are green locally on 2026-03-30
- retained-surface Wave 3 live verification was rerun with Claude Code on 2026-03-30
- automated coverage explicitly includes same-session document hydration, dense-cluster label survival, and stack-badge reconciliation
- the post-fix renderer manual checklist and the two additional overlay/resize scenarios passed on 2026-03-30

Why this is still required:
- phases 1-3 are architecturally landed, but rewrite blocking now depends on behavioral proof
- the remaining risk is real-user correctness, not missing scaffolding

This is now satisfied because:
1. targeted automated checks are green
2. the manual checklist below passed on the fixed build
3. Wave 3 live verification is rerun against the reconciler build
4. there are no open High-severity renderer regressions in:
   - canopy zoom behavior
   - document-load stratum/canopy hydration
   - drag / transform / `history.record()` paths
   - dense-cluster label visibility

### 2.2 Narrow Renderer Follow-Ups Found During Validation

This follow-up is also complete on the current build.

Closed regressions from the 2026-03-30 manual pass:
- canopy-mode fallback circles for plants without canopy spread data now scale coherently during wheel and button zoom
- the bottom-left scale bar now stays above the bottom canvas bar/panel and the legend stays above the scale bar
- the scale bar is now rendered through the HTML overlay chrome seam instead of a Konva UI node, removing drag-time jitter while preserving renderer-owned redraw control
- vertical host growth now resizes the stage and rulers correctly without leaving blank canvas at the bottom
- targeted renderer tests were updated in the same patch

Not allowed in this track:
- product-level visual redesign
- label UX redesign
- species-color redesign
- broad scene indexing work that is not required for a discovered regression

### 2.3 Optional Phase 4: Measured Viewport Filtering

This is not active by default.

It may start only if all of the following are true:
1. phases 1-3 are already stable
2. profiling shows the next bottleneck is still renderer work
3. the measured target is deferred-pass work, not speculative cleanup

If phase 4 is started:
- keep it limited to deferred passes
- add screen-margin handling
- add edge-entry tests for canopy/labels
- prove a measured improvement before keeping it

### 2.4 Deferred Internal Cleanup

These are non-blocking internal follow-ups that may be done later if they help maintainability without reopening the stability gate:
- pass `ScreenPlant[]` through deferred density/stacking paths instead of recomputing absolute positions inside plant helpers
- shrink or document renderer helpers that are now no-ops or forwarding shells
- extract `loadSpeciesCache` from `engine.ts` only after renderer stability is complete

### 2.5 Post-Beta Plant Label Patch

The retained-surface plant label follow-up landed after beta closeout on 2026-04-01.

What changed:
- plant labels are now single-line only; persistent `.plant-botanical` nodes were removed
- deferred density suppression is now color-aware: `40px` for same-color neighbors, `20px` for different-color neighbors
- deferred density ordering is now priority-weighted so selected plants win first, then user-colored plants, then default-color plants
- locale refresh removes any legacy botanical label nodes that still exist on older materialized groups

Why it belongs here:
- the behavior lives in deferred renderer-owned passes (`density`) plus plant-node materialization in `plants.ts`
- it did not reopen renderer scheduling, pass ownership, or viewport filtering boundaries

Guardrail:
- keep future label work inside the current seams unless a broader product phase explicitly redefines label UX
- the remaining deferred label idea is still “labels hidden by default”, not another structural rewrite of density ownership

---

## 3. Coding Rules For Future Renderer Work

### 3.1 Mutation Coverage Rule

Any renderer-affecting change must account for all relevant mutation entry points:
- `history.execute()`
- `history.record()`
- `history.undo()`
- `history.redo()`
- document load / replacement
- viewport transforms
- theme / locale / display-mode effects
- direct object-operation flows that already mutate scene state

### 3.2 Scheduling Rule

- `render-pipeline.ts` may execute passes, but it must not take scheduling authority back from the reconciler
- viewport code must not directly schedule plant/display/LOD work
- tools and object operations must not rely on scattered `batchDraw()` calls as the authoritative reconciliation path

### 3.3 Async Safety Rule

- async document-load follow-up work must be guarded by epoch or cancellation ownership
- no async renderer callback may mutate a newer document session after ownership has moved

### 3.4 Validation Rule

- if a change touches `history.record()` paths, add or update a test for that path
- if a change touches deferred density/stacking, verify at least one label survives in a tight cluster
- if a change touches document-load hydration, verify stratum/canopy restoration on load
- if a change touches transform ownership, verify wheel zoom, button zoom, and pan

### 3.5 Scope Rule

- no product redesign bundled into renderer stability work
- no broad API churn in `CanvasEngine`
- no widening of viewport filtering for correctness-sensitive passes without explicit doc updates

---

## 4. Validation Checklist

### 4.1 Required Automated Checks

- viewport tests
- dirty-state / history tests
- document-session tests
- reconciler / renderer-owner tests
- density / stacking tests
- frontend production build

Current automated evidence in-tree:
- `desktop/web/src/__tests__/viewport.test.ts`
- `desktop/web/src/__tests__/dirty-state.test.ts`
- `desktop/web/src/__tests__/document-session.test.ts`
- `desktop/web/src/__tests__/render-pipeline.test.ts`
- `desktop/web/src/__tests__/plant-density.test.ts`
- `desktop/web/src/__tests__/plants.test.ts`
- `desktop/web/src/__tests__/theme-refresh.test.ts`
- `npm run build --prefix desktop/web`

### 4.2 Required Manual Checks

Run these on the landed reconciler build:

1. Canopy mode + wheel zoom
Expected: circle radii stay visually correct during zoom

2. Canopy mode + button zoom
Expected: canopy display stays correct

3. Pan after zoom
Expected: overlays, guides, and annotation zoom behavior remain correct

4. Text annotation undo/redo
Expected: annotation visuals update without unnecessary plant regressions

5. Drag plant
Expected: density/stacking refresh correctly after the interaction settles

6. Transform zone or annotation
Expected: overlay and annotation state stay correct

7. Load saved design with known stratum/canopy data
Expected: stratum color and canopy spread restore correctly after load

8. Dense plant cluster
Expected: at least one label remains visible and stack badges remain correct

9. Dense colorful cluster
Expected: differently-colored neighbors can keep labels more aggressively than same-color neighbors, and a user-colored plant keeps its label ahead of a competing default-color plant

Manual findings recorded on 2026-03-30:
- checks 1 and 2 failed on the pre-fix build because plants without canopy spread data stayed on a fixed fallback size instead of scaling coherently with canopy zoom
- checks 3 through 8 passed on the pre-fix build
- additional renderer regressions found outside the numbered list:
  - the bottom-left scale bar could sit under the bottom canvas bar instead of staying above it
  - vertical window growth could leave the stage height stale, stretching the vertical ruler and exposing blank canvas at the bottom
- post-fix rerun result on 2026-03-30:
  - checks 1 through 8 passed on the fixed build
  - the additional scale-bar/legend stacking scenario passed
  - the vertical resize / ruler / blank-bottom scenario passed

Stop and fix the build if any of these regress:
- stale canopy display during zoom
- stale theme/display state after interaction
- drag/transform paths no longer visually reconcile
- async document-load hydration mutates the wrong session
- every label in a cluster disappears

---

## 5. File Ownership Guidance

Current write ownership for renderer follow-up work:

| File | Responsibility |
|------|----------------|
| `canvas/runtime/render-reconciler.ts` | scheduling, pass invalidation, deferred timing |
| `canvas/runtime/render-pipeline.ts` | pass execution helpers |
| `canvas/runtime/viewport.ts` | transform routing only |
| `canvas/rulers.ts` | renderer-managed HTML overlay chrome for rulers and scale bar |
| `canvas/history.ts` | mutation-to-pass invalidation contract |
| `canvas/plants.ts` | density / stacking / plant LOD helpers |
| `canvas/runtime/document-session.ts` | load hydration and async session safety |
| `canvas/engine.ts` | public facade and seam ownership |

Hotspot rule:
- do not parallelize through `engine.ts` or `history.ts` unless a new seam exists first

---

## 6. Exit Condition For This Document

The renderer stability gate in `docs/todo.md` is now satisfied.

When that happens:
- archive the completed renderer follow-up detail
- reduce this file again to only whatever renderer work still remains
