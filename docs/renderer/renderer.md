# Reactive Canvas Renderer: Remaining Work

**Date**: 2026-03-30  
**Status**: phases 1-3 are landed in code; this file now tracks what is left to do for renderer stability and follow-up work

Use this file for future renderer work.

This file no longer plans phases 1-3 as future work. Those implementation details are now historical. The remaining active renderer work is:
- stability-gate validation of the landed reconciler architecture
- narrow follow-up fixes if that validation finds regressions
- optional phase 4 viewport filtering only if measurement justifies it

---

## 1. Landed Renderer Architecture

These are the current canonical seams and must be preserved unless this file is updated directly.

### 1.1 Ownership

- `RenderReconciler` owns render invalidation, RAF batching, deferred scheduling, and stage-transform invalidation
- `render-pipeline.ts` is the execution delegate behind the reconciler
- `CanvasViewport` routes stage transforms through the engine-owned transform path
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

This is the active renderer blocker.

What is left:
- run the manual validation checklist below on the landed reconciler build
- rerun the Wave 3 canvas-touched journeys against that build
- fix any High-severity renderer regressions found there

Why this is still required:
- phases 1-3 are architecturally landed, but rewrite blocking now depends on behavioral proof
- the remaining risk is real-user correctness, not missing scaffolding

Done only when:
1. targeted automated checks are green
2. the manual checklist below passes
3. Wave 3 live verification is rerun against the reconciler build
4. there are no open High-severity renderer regressions in:
   - canopy zoom behavior
   - document-load stratum/canopy hydration
   - drag / transform / `history.record()` paths
   - dense-cluster label visibility

### 2.2 Narrow Renderer Follow-Ups Found During Validation

Allowed follow-up work:
- fix renderer correctness regressions discovered during manual verification
- add missing targeted tests that directly cover those regressions
- tighten ownership seams if validation shows a remaining bypass

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
| `canvas/history.ts` | mutation-to-pass invalidation contract |
| `canvas/plants.ts` | density / stacking / plant LOD helpers |
| `canvas/runtime/document-session.ts` | load hydration and async session safety |
| `canvas/engine.ts` | public facade and seam ownership |

Hotspot rule:
- do not parallelize through `engine.ts` or `history.ts` unless a new seam exists first

---

## 6. Exit Condition For This Document

This file stops being active renderer-follow-up guidance when:
- the renderer stability gate in `docs/todo.md` is satisfied
- any optional phase 4 work is either completed and validated or explicitly deferred

When that happens:
- archive the completed renderer follow-up detail
- reduce this file again to only whatever renderer work still remains
