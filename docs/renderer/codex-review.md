# Codex Review: `renderer.md`

## Findings

### 1. High: viewport culling, as written, does not deliver the claimed performance win and risks stale off-screen state

Document refs:
- `docs/renderer/renderer.md:119-123`
- `docs/renderer/renderer.md:251-280`
- `docs/renderer/renderer.md:285-287`

`RenderReconciler.flush()` computes `visiblePlants` on every pass by calling `ViewportCuller.getVisiblePlants()`, and that method linearly scans every `.plant-group` anyway. That means the proposal does not actually make zoom-frame work proportional to visible plants for immediate passes such as counter-scale; it moves the O(n) walk into the culler.

There is also a correctness problem. The doc treats "off-screen plants keep their previous counter-scale" as safe, but the reconciler sample also feeds `visiblePlants` into `plant-display`, `lod`, `density`, and `stacking`. That is not safe for display-mode changes, theme changes, or document-load backfill. A plant skipped while off-screen can keep stale radius/color/label state until some later invalidate happens to touch it.

Current implementation evidence:
- `desktop/web/src/canvas/runtime/viewport.ts:182-189` only syncs overlays on pan.
- `desktop/web/src/canvas/runtime/render-pipeline.ts:74-99` and `desktop/web/src/canvas/display-modes.ts:45-95` currently assume full-layer display refresh.

Recommendation:
- Restrict viewport culling to passes that are truly viewport-local (`density`, `stacking`, future label placement).
- Keep correctness-critical passes (`plant-display`, theme-driven visual refresh, document-load backfill) full-layer until there is a real spatial index that makes lookup sublinear and guarantees catch-up when nodes enter the viewport.

### 2. High: the density-grid sample does not implement the claimed asymmetric suppression fix

Document refs:
- `docs/renderer/renderer.md:354-388`
- `docs/renderer/renderer.md:443-449`

The code sample still computes `tooClose` independently for each plant and then uses:

`const showLabel = isSelected || !tooClose`

That remains symmetric suppression. In a pair or dense cluster, every unselected plant with a close neighbor still hides its label. The comment `Fix: cluster anchor (first in cell) keeps its label` is not backed by any anchor bookkeeping, ordering rule, or component-level representative selection.

Recommendation:
- Either replace this section with an actual anchor algorithm, or do not claim that the bug is fixed here.
- If label placement later replaces density suppression entirely, say that explicitly and remove the earlier misleading "fixed" sample.

### 3. Medium/High: `dirtyPasses` only covers part of the mutation surface

Document refs:
- `docs/renderer/renderer.md:223-226`
- `docs/renderer/renderer.md:455-481`
- `docs/renderer/renderer.md:506`
- `docs/renderer/renderer.md:513-515`

The proposal focuses on `history.ts` calling `reconciler.invalidate(...cmd.dirtyPasses)`, but current canvas mutations do not all flow through `history.execute()`.

Current implementation evidence:
- `desktop/web/src/canvas/tools/select.ts:457-461` records drag moves via `history.record()`
- `desktop/web/src/canvas/tools/select.ts:509-513` records transforms via `history.record()`
- `desktop/web/src/canvas/runtime/object-ops.ts:141-157` records rotate/flip via `history.record()`
- `desktop/web/src/canvas/runtime/object-ops.ts:234-241` records align/distribute via `history.record()`

If the reconciler is only wired to `execute/undo/redo`, common edits will stop reconciling. The document needs an explicit plan for `record()` and for direct scene mutations outside history.

Recommendation:
- Make invalidation part of both `history.execute()` and `history.record()`, or centralize invalidation at the mutation sites instead of the history wrapper.
- Audit every mutation path before removing `reconcileMaterializedScene()`.

### 4. Medium: the proposed fix for programmatic stage changes watches the wrong source of truth

Document refs:
- `docs/renderer/renderer.md:484-493`

Watching `zoomLevel` does not solve "programmatic stage changes bypass pipeline". It only catches code that remembers to write `zoomLevel.value`. It does not catch direct `stage.scale(...)`, `stage.position(...)`, or translate-only changes. It also does not cover pan.

Current implementation evidence:
- `desktop/web/src/canvas/runtime/viewport.ts:182-189` updates stage position during pan and only syncs overlays.
- `desktop/web/src/state/canvas.ts:6` shows `zoomLevel` is a separate signal, not the authoritative stage transform.

Recommendation:
- Enforce a single stage-transform API and make all stage mutations go through it.
- Alternatively, reconcile from stage transform events, not from `zoomLevel`.

### 5. Medium: the document mixes renderer architecture with a separate product redesign

Document refs:
- `docs/renderer/renderer.md:549-925`

The first half of the document is an architectural refactor. The second half changes the default visual language of the product: per-species colors, labels hidden by default, a new settings-backed toggle, and a new label-placement system. That is a separate rollout with separate UX and testing risk.

Bundling both together makes it harder to:
- prove the reconciler fixed the current bugs,
- measure performance changes cleanly,
- stage rollout safely,
- review regressions in isolation.

Recommendation:
- Split this into two RFCs or phases.
- Land renderer correctness/performance first.
- Revisit species-color and label-default changes only after the reconciler is stable.

### 6. Low: the document-load backfill sample does not match the existing IPC contract

Document refs:
- `docs/renderer/renderer.md:427-440`

The sample uses:

`invoke('get_species_batch', { names: canonicalNames })`

Current code exposes:
- `desktop/web/src/ipc/species.ts:78-83` -> `getSpeciesBatch(canonicalNames, locale)`
- `desktop/src/commands/species.rs:114-129` -> `get_species_batch(canonical_names, locale)`

Recommendation:
- Update the sample to the real helper/API shape so the doc is implementation-ready.

## Overall Recommendation

Do not implement this document as one package.

The right cut is:

1. Land a narrower renderer RFC first.
   Focus on dirty-pass scheduling, wheel-zoom canopy correctness, and replacing the O(n^2) density/stacking work.

2. Keep full-layer reconciliation for correctness-sensitive passes in phase 1.
   `plant-display`, theme refresh, and document-load visual backfill should remain full-layer until there is a real spatial index, not a per-frame full scan disguised as culling.

3. Treat `history.record()` and non-history mutations as first-class in the design.
   The invalidation model is incomplete without them.

4. Make stage transform ownership explicit.
   "Observe `zoomLevel`" is not a real ownership boundary.

5. Split label UX and species-color changes into a follow-up RFC.
   Those changes are defensible, but they should not be coupled to the renderer refactor.

## Test Gaps To Add Before Implementation

- A pan-into-view test proving previously off-screen plants are visually correct after display-mode changes.
- A `history.record()` test proving drag/transform/align/rotate paths invalidate the right passes.
- A viewport-culling test for canopy circles or labels whose bounds enter the viewport before the plant center does.
- A label-density or label-placement test proving at least one label survives in a tight cluster.
- A stage-transform ownership test proving external transform changes cannot bypass reconciliation.
