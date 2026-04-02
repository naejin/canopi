# Rewrite History Archive (2026-03)

Archived from the operational rewrite docs on 2026-03-30.

Use this file for historical context only. It is not the operational source of truth for future agent work.

The canonical active references are now:
- `docs/todo.md`
- `docs/renderer/renderer.md`

The live canvas architecture is now `SceneCanvasRuntime` + `CanvasSession`; any `CanvasEngine` language below is superseded history.

---

## 1. Why This Archive Exists

The rewrite docs were carrying both:
- active execution guidance
- already-landed implementation detail

That made future agents treat completed work as if it were still pending.

This archive preserves what was completed and why it mattered, so the active docs can stay focused on the remaining work only.

---

## 2. Completed Through 2026-03-30

### Waves

Completed and no longer active:
- Wave 0
- Wave 1
- Wave 2 structural split

Implemented and archived as landed work:
- Wave 3 implementation slice
- Wave 3 high-priority boundary fixes
- renderer phases 1-3 implementation

Not yet completed at archive time:
- Wave 3 live desktop verification closeout
- renderer stability-gate acceptance
- Wave 4
- Wave 5

---

## 3. Landed Architecture Snapshot

### Document boundary

The document transition authority problem was addressed with an explicit split:
- `CanvasEngine.loadDocument(...)` remains load/materialization semantics
- `CanvasEngine.replaceDocument(...)` owns destructive replacement semantics

The replacement seam owns:
- transient canvas-session reset
- viewport reset coupled to replacement
- document-session materialization

`state/document-actions.ts` now routes destructive replacement through the engine-owned seam instead of importing runtime internals directly.

### Location mutation boundary

`components/canvas/LocationInput.tsx` stopped directly mutating:
- `currentDesign.value`
- `nonCanvasRevision.value`

Committed location changes now flow through `state/location-actions.ts`.

### Renderer ownership

Renderer phases 1-3 landed with this shape:
- `RenderReconciler` owns invalidation, RAF batching, deferred scheduling, and stage-transform invalidation
- `render-pipeline.ts` remains the execution delegate behind the reconciler
- `CanvasViewport` routes transforms through the engine-owned transform path
- `CanvasHistory.execute/record/undo/redo` use render invalidation instead of unconditional full reconcile
- command classes carry `dirtyPasses`
- `screen-grid.ts` provides grid-backed deferred density/stacking lookup
- `document-session.ts` backfills stratum/canopy attrs after load and guards async completion with a load epoch

### Canonical ownership rules that were proven by the landed slice

These rules were not just planned; they were implemented:
- dedicated rendering ownership outside the engine core logic
- explicit destructive document boundary
- narrower runtime dependencies
- no action-layer document replacement bypass
- no direct location mutation from component UI code

---

## 4. Landed Renderer Fixes

Renderer phases 1-3 addressed these confirmed issues in the implementation:
- canopy circles stale during wheel zoom
- missing stratum/canopy hydration on document load
- symmetric cluster label suppression
- unconditional full reconcile on execute/undo/redo
- programmatic stage transforms bypassing renderer ownership
- grid-backed replacement for the worst deferred `O(n^2)` plant-neighbor work

The renderer was still not considered stable at archive time because the remaining gate was behavioral validation, not missing architecture.

---

## 5. Verification Snapshot At Archive Time

Completed automated verification for the landed frontend slice:
- `npm test --prefix desktop/web`
- `npm run build --prefix desktop/web`

Frontend tests at archive snapshot:
- 102 passing tests

Converged local review findings resolved before archive:
- async document-load backfill needed an epoch guard
- theme changes needed overlay invalidation after the reconciler refactor
- `history.record()` needed the same invalidation contract as execute/undo/redo
- `dirtyPasses` was tightened to a required command contract

Still pending at archive time:
- live desktop verification on the reconciler build for Wave 3 flows
- renderer stability-gate completion

---

## 6. Historical “Future Work” That Is No Longer Future

The following items used to appear in the active docs as upcoming work, but were landed before this archive snapshot:
- `LocationInput` action-boundary fix
- engine-owned destructive document replacement seam
- `RenderReconciler` introduction
- grid-backed deferred density/stacking
- document-load stratum/canopy backfill
- `history.record()` renderer invalidation

These were removed from the active docs so future agents would stop planning them again.

---

## 7. Historical References

Other docs that preserve historical or specialized context:
- renderer-specific archived reviews and follow-ups in `docs/renderer/**`
- archived reviews in `docs/archive/reviews/**`
- product scope lock in `docs/product-definition.md`

The git history remains the authoritative source for exact prior text if more historical detail is needed than this archive preserves.
