# Canopi Rewrite Operational Reference

**Date**: 2026-03-30  
**Status**: canonical operational reference for active rewrite work

Use this file for future coding and planning work.

This file keeps only:
- what is left to do
- why the remaining order matters
- current architecture guardrails
- coding rules for future agent implementations
- active blockers and exit gates

Historical implementation detail and completed work now live in:

- `docs/archive/rewrite-history-2026-03.md`

Specialized active implementation guidance lives in:

- renderer follow-up and stabilization: `docs/renderer/renderer.md`
- product scope lock: `docs/product-definition.md`
- release hardening and rewrite-exit checks: `docs/release-verification.md`

---

## 1. Status Snapshot

Completed and archived:
- Wave 0
- Wave 1
- Wave 2 structural split
- Wave 3 implementation slice in the current tree
- Wave 3 high-priority boundary fixes
- renderer phases 1-3 implementation
- automated frontend verification for the landed rewrite slice

Still active:
- retained-surface Wave 3 closeout on the surviving architecture
- renderer stability-gate closeout after retained-surface fixes land
- Wave 4 design coherence on the surviving structure
- Wave 5 release hardening and rewrite-exit verification

Deferred after live review:
- featured-design world map / template import
- timeline workflows
- budget workflows

The rewrite is not complete until the required product journeys pass end to end on the final surviving architecture.

---

## 2. Current Canonical Architecture

These are no longer targets. They are the landed architecture future work must preserve unless this file is updated directly.

### 2.1 Public Facades

Preserve stable subsystem facades:
- `CanvasEngine`
- document mutation boundary
- stable DB command APIs

Do not turn follow-up work into broad API churn.

### 2.2 Document Authority

Document replacement authority is now explicit:
- no component may replace the active document directly
- no panel may call destructive replacement directly
- only document actions may initiate destructive replacement
- destructive replacement must go through the engine-owned replacement seam

Canonical split:
- `CanvasEngine.loadDocument(...)` is load/materialization semantics
- `CanvasEngine.replaceDocument(...)` is destructive replacement semantics

`replaceDocument(...)` owns:
- transient canvas-session reset
- viewport reset coupled to replacement
- document-session materialization

### 2.3 Renderer Ownership

Dedicated rendering ownership is now the rule:
- `RenderReconciler` owns render invalidation, batching, deferred scheduling, and stage-transform invalidation
- `render-pipeline.ts` is the execution delegate behind the reconciler, not the scheduler
- all visual updates go through `reconciler.invalidate(...)`
- stage transforms go through one engine-owned transform path

The renderer split is not considered stable until the remaining validation work in `docs/renderer/renderer.md` is complete.

### 2.4 Mutation Coverage Rules

Renderer ownership must continue to cover all mutation entry points:
- `history.execute()`
- `history.record()`
- `history.undo()`
- `history.redo()`
- document load / replacement
- viewport transforms
- theme / locale / display-mode effects
- direct object-operation flows that already mutate scene state

### 2.5 Deferred Plant Work

The current accepted boundary is:
- full-layer passes stay full-layer for correctness-sensitive work
- only deferred density and stacking are viewport-local
- grid-backed plant neighbor lookup is the current optimization seam

Do not widen viewport filtering for other passes unless the renderer follow-up doc is updated and the required validation exists.

---

## 3. Remaining Work In Order

### 3.1 Wave 3 Retained-Surface Closeout

What is left:
- layer controls
- location tab search / drag / zoom / confirm
- consortium flows
- hide deferred `world-map`, `timeline`, and `budget` entry points from the live UI
- improve retained-surface UI/UX, with design location as the primary follow-up

Why this is next:
- these are the surviving rewrite-exit product journeys after the live review
- the live review already showed that `world-map`, `timeline`, and `budget` should move out of rewrite-exit scope
- retained surfaces must be polished before renderer stability and release hardening can be called done

How to do it:
- hide deferred feature entry points without removing underlying persistence fields
- keep fixes on the surviving architecture only
- use narrow UX and behavior improvements rather than reopening broad product scope

Current outcome from live review:
- `world-map`, `timeline`, and `budget` are postponed and no longer part of rewrite exit
- retained-surface UX work is now the active Wave 3 follow-up track
- design location is the highest-priority user-facing improvement area

### 3.2 Renderer Stability Gate Closeout

What is left:
- rerun the renderer manual checklist on the landed reconciler architecture
- rerun the retained Wave 3 canvas-touched journeys against that build
- fix any High-severity regressions found there
- add only targeted follow-up coverage that closes discovered gaps

Why this is blocked behind retained-surface closeout:
- the remaining renderer risk is behavioral, not architectural
- the code split is landed, but the gate is about correctness under real use on the surviving feature set

How to do it:
- use `docs/renderer/renderer.md` as the renderer-specific checklist
- keep fixes narrow and tied to observed regressions
- do not mix optional optimization or product redesign into stability closeout

Current rule:
- validate retained surfaces only: core canvas flows, layer controls, design location, and consortium
- do not reintroduce deferred features as part of renderer-gate work
- update this file and `docs/renderer/renderer.md` when retained-surface fixes materially change the gate

### 3.3 Wave 4 Design Coherence

Blocked until:
- renderer phases 1-3 are stable per the gate below

What is left:
- design-system cleanup on the final surviving structure
- CSS/token/surface coherence work on Wave 3 and reconciler-backed surfaces

Why this stays later:
- design cleanup on unstable structure creates rework
- late renderer fixes must not be entangled with product-level visual redesign

How to do it:
- land coherence work only on the reconciler architecture
- batch shared token, i18n, and fixture churn
- keep redesigns that depend on renderer behavior behind the stability gate

### 3.4 Wave 5 Release Hardening

What is left:
- rewrite-exit checklist and docs cleanup
- supported-platform build and smoke verification
- keep the release-blocking CI gates green on the final branch

Why it stays last:
- release hardening should validate the finished product shape
- it should not be used as a substitute for unresolved product or renderer work

How to do it:
- use `docs/release-verification.md`
- keep Wave 5 narrow
- fix release-impacting regressions only

Current in-tree status:
- automated release gates are landed and green locally on 2026-03-30:
  - `cargo fmt --all -- --check`
  - `cargo clippy --workspace -- -D warnings`
  - `cargo test --workspace`
  - `npm test --prefix desktop/web`
  - i18n completeness coverage against `en.json` via the frontend test suite
  - `npm run build --prefix desktop/web`
- GitHub Actions already carries the release-build matrix and artifact upload
- the remaining Wave 5 work is primarily packaged-app smoke verification plus rewrite-exit docs cleanup

---

## 4. Renderer Stability Gate

For rewrite planning purposes, renderer phases 1-3 are stable only when all of the following are true:

1. The landed reconciler/build is the code under validation
2. Targeted automated checks are green:
   - viewport tests
   - dirty-state / history tests
   - document-session tests
   - reconciler / rendering-owner tests
   - density / stacking tests
3. The manual validation checklist in `docs/renderer/renderer.md` passes
4. Retained Wave 3 live verification is rerun against the reconciler build for canvas-touched flows
5. There are no open High-severity renderer regressions in:
   - canopy zoom behavior
   - document-load stratum/canopy hydration
   - drag / transform / `history.record()` paths
   - dense-cluster label visibility

Current gate state:
- condition 2 is green locally on 2026-03-30
- conditions 3 and 4 still need a retained-surface rerun after the current UX/location follow-up work
- Wave 4 remains blocked until those results are recorded and any resulting High-severity regressions are closed

Until all five conditions are true:
- Wave 4 stays blocked
- renderer-tied product redesigns stay blocked

---

## 5. Non-Negotiable Guardrails

### 5.1 Document Mutation Rule

- no component may replace the active document directly
- no panel may call destructive document replacement directly
- only document actions may perform destructive session replacement
- do not bypass the engine-owned replacement seam

### 5.2 Action-Layer Rule

- action modules may not import other action modules
- cross-cutting flows should compose actions at a higher boundary
- if repeated orchestration appears, create a small explicit workflow module

### 5.3 Canvas Runtime Rule

- do not introduce a shared runtime service locator
- runtime modules should take only the dependencies they need
- helper contexts must remain narrow construction artifacts, not behavior bags

### 5.4 Renderer Rule

- all visual updates go through `reconciler.invalidate(...)`
- all stage transforms go through the engine-owned stage-transform path
- do not reintroduce direct renderer scheduling from viewport, tools, or action code
- do not treat `zoomLevel` as transform authority
- keep full-layer passes full-layer until a real sublinear index exists
- use viewport filtering only for deferred passes where stale off-screen state is acceptable

### 5.5 Resource Ownership Rule

Every resource-owning surface must have one lifecycle owner for:
- setup
- updates
- teardown

Applies to:
- canvas engine
- map instances
- timers
- listeners
- async cancellation or epoch/cancellation guards
- DOM overlays

### 5.6 Hotspot Ownership Rule

Treat these as hotspot files until a new seam exists:
- `desktop/web/src/canvas/engine.ts`
- `desktop/src/db/plant_db.rs`
- `desktop/src/db/query_builder.rs`
- `desktop/web/src/state/design.ts`
- `desktop/web/src/state/plant-db.ts`

Rules:
- one writer per hotspot at a time
- do not parallelize through a hotspot file
- split authority before splitting execution

### 5.7 Shared-Asset Batching Rule

Batch by wave:
- i18n keys
- shared type changes
- token changes
- test fixtures

### 5.8 Product Parity Rule

No required product surface may become rewrite collateral.

### 5.9 Dirty-Worktree Rule

Do not broad-clear a dirty tree in place.

Default strategy:
- checkpoint the rewrite-owned slice
- keep unrelated user changes untouched
- continue in a clean branch/worktree if isolation is needed

---

## 6. Coding Rules For Future Agents

These are implementation rules, not optional style preferences.

### 6.1 Explore First

- inspect the current tree before proposing or landing follow-up work
- prefer local repo truth over stale planning assumptions
- if a rule, blocker, or architecture target changes, update this file directly

### 6.2 Change The Smallest Correct Seam

- prefer seam-first fixes over broad rewrites
- preserve `CanvasEngine` as the public facade
- preserve landed mutation boundaries unless this file is updated
- do not broaden generic methods when a new explicit seam is clearer

### 6.3 Keep Tests In The Same Patch

- add or update targeted tests with the implementation change
- run targeted checks before broader suites
- do not claim stability from architecture work without verification evidence

### 6.4 Do Not Mix Tracks

- do not mix renderer correctness work with product-level visual redesign
- do not mix design-system cleanup into structural canvas/runtime work
- do not mix release hardening into unfinished product or renderer work

### 6.5 Preserve Future Agent Safety

- make ownership explicit in code
- prefer required contracts over optional “silent fallback” contracts where missing wiring would be dangerous
- add cancellation/epoch guards for async work that can outlive its owning session
- remove or archive stale future-tense doc instructions once work lands

---

## 7. Active Blockers And Deferred Items

Blocked until retained-surface Wave 3 closeout:
- Wave 3 completion call
- renderer stability-gate completion work that depends on retained-surface live findings
- any rewrite-exit claim that depends on real-user verification rather than automated checks

Blocked until the renderer stability gate is satisfied:
- Wave 4 design coherence
- renderer-tied product-level visual redesigns:
  - per-species default colors
  - labels hidden by default
  - smart cartographic label placement
- `loadSpeciesCache` extraction from `engine.ts`

Can be fixed independently if needed:
- `ExternalInputDeps.getEngine` narrowing
- tooltip DOM extraction from `engine.ts`
- resource ownership cleanup in rulers, text tool, and `WorldMapSurface`
- deferred-pass data-shape cleanup in renderer internals

Still deferred until post-rewrite product definition:
- featured-design world map / template import
- timeline workflows
- budget workflows
- geo / terrain workflows
- export workflows
- learning content

---

## 8. Rewrite-Exit User Journeys

The rewrite is not complete until these journeys pass end to end:

1. Create, edit, save, load, and switch designs without losing work
2. Search/filter the plant DB, inspect detail, favorite plants, and place them on canvas
3. Edit canvas objects, undo/redo them, and preserve them through save/load roundtrip
4. Use `LayerPanel` for required display/layer configuration
5. Use bottom-bar `location` search / drag / zoom / confirm flows correctly
6. Use `consortium` flows without lifecycle or persistence regressions
7. Recover gracefully from network failure, disk failure, and invalid external data
8. Use the app in light and dark themes without broken surfaces
9. Use supported locales without missing keys or broken labels
10. Meet release criteria on each supported platform at rewrite exit

---

## 9. Final Instruction

Use this file as the canonical operational reference.

Use archived docs only for historical context.

When retained-surface live verification is rerun after the current UX/location follow-up work:
- record the findings in this file and the renderer/release follow-up docs before broad new work starts
- turn discovered regressions into narrow fixes with targeted tests
- remove any stale scope language if the surviving rewrite-exit surface changes again

If a future change affects:
- remaining wave order
- blocker definitions
- ownership rules
- or rewrite-exit scope

update this file directly and archive the completed detail that was removed from the active path.
