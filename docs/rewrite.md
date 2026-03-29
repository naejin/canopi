# Canopi Rewrite Reference

**Date**: 2026-03-29  
**Status**: canonical implementation reference for the rewrite program

This document is the single source of truth for the rewrite.

It defines:
- rewrite scope
- product scope at rewrite exit
- architectural rules
- execution order
- branch/worktree strategy
- wave-level acceptance criteria

Older standalone review documents are superseded by this file.

---

## 1. Executive Direction

The rewrite should proceed.

But it must be run as a **product-completion rewrite**, not as an architecture-only cleanup.

The agreed strategy is:
- keep stable facades
- introduce explicit mutation boundaries
- reduce authority concentration in the biggest hotspot files
- preserve product parity during migration
- rebuild required deleted surfaces with the new architecture
- validate every wave with tests and live verification
- integrate wave by wave into `main`

The rewrite is not complete when the code is merely cleaner.
It is complete only when the product required at rewrite exit is working end to end.

---

## 2. Converged Conclusions

### 2.1 Highest-priority problem

The most important defect in the current app is missing document transition authority.

Current risk:
- some in-app document replacement flows can discard unsaved work
- document loading and transient session reset are not owned in one place

Therefore:
- document transition authority is first
- no component may replace the active document directly

### 2.2 Root architectural problem

The rewrite exists to reduce **authority concentration**.

The main current hotspots are:
- `desktop/web/src/canvas/engine.ts`
- `desktop/src/db/plant_db.rs`
- `desktop/src/db/query_builder.rs`
- `desktop/web/src/state/plant-db.ts` as an emerging future hotspot

Wave 3 rebuild targets are separate:
- `desktop/web/src/components/panels/WorldMapPanel.tsx`
- `desktop/web/src/components/canvas/LayerPanel.tsx`
- `desktop/web/src/components/canvas/InteractiveTimeline.tsx`

These are not current hotspots because they were deleted during pruning.
They should be rebuilt fresh with the split architecture, not treated as monoliths to preserve.

### 2.3 Facade preservation is non-negotiable

The rewrite should preserve stable subsystem facades:
- `CanvasEngine`
- document mutation boundary
- stable DB command APIs

Do not turn the rewrite into broad API churn.

### 2.4 The canvas split needs a render pipeline

`CanvasEngine` cannot be considered cleanly split without:

`desktop/web/src/canvas/runtime/render-pipeline.ts`

It should own:
- plant rendering strategy:
  - post-add display-mode styling
  - viewport-aware LOD and density work
  - cache-aware display reconciliation
- annotation rendering strategy:
  - counter-scale behavior for text and measure labels
- zone strategy:
  - no pipeline ownership for zone scaling; zones remain self-managing via Konva and `strokeScaleEnabled: false`
- universal rendering reconciliation:
  - post-materialization theme correction after undo/redo/paste/load
  - batch draw coordination

### 2.5 Design coherence should follow structural rewrite

Keep early:
- design-system rule clarification
- token foundations

Move later:
- bulk CSS and surface migration on files that will be structurally split

Reason:
- avoid migrating temporary structures and then re-migrating their replacements

### 2.6 QA is part of every wave

QA should not be a final cleanup phase.

Each wave is complete only when it has:
- automated tests where appropriate
- live verification where appropriate
- parity checks
- documented acceptance

### 2.7 Stubs do not count as completion

The rewrite must distinguish:
- architecture complete
- parity complete
- product complete

Examples that do **not** count as product completion by themselves:
- platform scaffolds
- placeholder panels
- preserved facades without working user journeys

---

## 3. Product Scope At Rewrite Exit

### 3.1 Already-decided required surfaces

These are treated as **required at rewrite exit**:
- document safety and save/load flows
- plant DB search, filters, detail, favorites, and plant placement
- core canvas editing flows
- `WorldMapPanel` / featured designs discovery
- `LayerPanel`
- design location tools
- timeline tools
- budget tools
- consortium tools

These were previously pruned/deleted in code, but the converged decision is that they belong in the finished product and should be rebuilt with the split architecture, not restored as old monoliths.

### 3.2 Still requires Wave 0 classification

Wave 0 must explicitly classify the remaining ambiguous surfaces:
- geo / terrain map features
- export
- full cross-platform support level
- knowledge / learning content
- any other previously deleted or partial pillar not listed above

For each surface, Wave 0 must classify it as one of:
- `required at rewrite exit`
- `deferred after rewrite exit`
- `intentionally removed`

### 3.3 Required product definition output

Before implementation starts, create:

`docs/product-definition.md` or `docs/rewrite-parity-matrix.md`

It should be lightweight.
This is a one-day scoping document, not a long planning phase.

Minimum required columns:
- surface
- current state
- rewrite-exit classification
- owner wave
- user-facing purpose
- acceptance criteria

---

## 4. Non-Negotiable Rules

### 4.1 Document mutation rule

- no component may replace the active document directly
- no panel may call document replacement directly
- only document actions may perform destructive session replacement

### 4.2 Action-layer rule

- action modules may not import other action modules
- cross-cutting flows should compose actions at a higher boundary
- if repeated orchestration appears, create a small explicit workflow module

### 4.3 Canvas runtime rule

- do not introduce a shared runtime service locator
- runtime modules should take only the dependencies they need
- if any helper context exists, it must remain a narrow construction artifact, not a behavior bag

### 4.4 Resource ownership rule

Every resource-owning surface must have one explicit lifecycle owner for:
- setup
- updates
- teardown

Applies to:
- canvas engine
- map instances
- timers
- listeners
- async cancellation tokens
- DOM overlays

### 4.5 Parallel ownership rule

- one writer per hot file until the seam exists
- do not parallelize through a hotspot file
- split authority first, then parallelize

### 4.6 Shared-asset batching rule

Batch these by wave instead of scattering them:
- i18n keys
- shared type changes
- token changes
- test fixtures

### 4.7 Product parity rule

No active product surface may become rewrite collateral.

Meaning:
- if a feature is active, it must remain working through migration
- if a feature is temporarily disabled, it must have a named re-enable wave
- if a feature is cut, docs must say it is cut

### 4.8 Dirty-worktree rule

Do not do a broad in-place "clear first" when the worktree already contains:
- unrelated user changes
- active rewrite seams
- partial deletions from other tracks

Instead:
- freeze the current rewrite slice as a checkpoint
- keep unrelated dirty files untouched
- continue in narrow wave-sized write sets
- if a cleaner surface is needed, move the rewrite to a fresh branch/worktree instead of mass-reverting in place

Allowed surgical clearing:
- isolate rewrite-owned files
- stop overlapping writers on hot files
- move only the current wave to a clean worktree

Disallowed clearing behavior:
- repo-wide revert/reset as a prerequisite for continuing the rewrite
- broad formatting passes across unrelated files
- "cleanup" commits that mix wave progress with unrelated code motion

---

## 5. Recommended Git Strategy

Do **not** run this as one giant long-lived `rewrite` branch.

### 5.1 Branch model

Use:
- `main` as the integration trunk
- short-lived wave branches such as:
  - `rewrite/w0-product-contract`
  - `rewrite/w1-data-safety`
  - `rewrite/w2-canvas`
  - `rewrite/w3-panels`

Merge each wave when:
- its acceptance criteria pass
- its parity checks pass
- its file ownership conflicts are resolved

Avoid:
- one permanent mega-branch for the full rewrite
- deferring integration until "the rewrite is done"

### 5.2 Worktree model

Use `git worktree` as the workspace strategy.

Recommended:
- one worktree on `main`
- one worktree for the active rewrite wave
- additional worktrees only when write sets are disjoint

Good fit:
- `main`
- one worktree for document/backend work
- one worktree for canvas work only when it is not overlapping hot files

Avoid:
- overlapping waves editing the same hotspot files in different worktrees
- stale worktrees left around after merge

Worktrees help with:
- branch-switching friction
- clean workspace isolation
- clearer ownership boundaries

They do **not** replace branch discipline or wave-by-wave integration.

### 5.3 Dirty-tree continuation model

If the current worktree is already dirty, the default continuation strategy is:
- do not clear in place
- do not try to untangle every unrelated change before proceeding
- checkpoint the rewrite-owned slice
- continue the rewrite in a fresh branch/worktree if isolation is needed

Recommended order:
1. identify the rewrite-owned file set for the current wave
2. checkpoint that slice
3. create a fresh branch or worktree from the intended base
4. carry only the rewrite-owned changes forward
5. continue the next wave there

Meaning of "clear and continue" for this rewrite:
- acceptable: isolate the rewrite into a cleaner worktree
- not acceptable: broad local cleanup in the same dirty tree

---

## 6. Rewrite Wave Plan

The agreed shape is roughly **6 waves** including the lightweight scope wave.

### Wave 0: Product Contract

Goal:
- define what "complete product after the rewrite" means

Outputs:
- product definition / parity matrix document
- explicit classification of deleted/pruned capabilities
- initial journey list
- initial rewrite-exit scope

Required decisions:
- confirm `WorldMapPanel`, `LayerPanel`, `location`, `timeline`, `budget`, and `consortium` as required at rewrite exit
- classify geo / terrain
- classify export
- classify platform support expectations
- classify knowledge / learning

Acceptance:
- no ambiguity remains around rewrite-exit scope
- this wave stays lightweight

### Wave 1: Data Safety, Backend Query, And Network / Storage Integrity

Goal:
- eliminate document-loss risk
- centralize document replacement
- harden integrity-sensitive backend and IO behavior

Primary frontend files:
- `desktop/web/src/state/document-actions.ts` new
- `desktop/web/src/state/design.ts`
- `desktop/web/src/state/document.ts`
- `desktop/web/src/components/shared/WelcomeScreen.tsx`
- `desktop/web/src/commands/registry.ts`
- `desktop/web/src/shortcuts/manager.ts`
- `desktop/web/src/components/panels/CanvasPanel.tsx` for queued-load handoff
- any rebuilt template-import entry point in Wave 3 must call document actions from day one

Primary backend files:
- `desktop/src/db/plant/*`
- `desktop/src/db/query/*`
- tile/image-cache/network integrity modules

Deliverables:
- document transition authority
- guarded save/discard/cancel flow
- cancellation-safe queued load
- transient runtime reset on document switch
- `plant_db.rs` split by family
- `query_builder.rs` split by concern
- truthful tile/accounting behavior
- bounded network/cache policies
- explicit network hardening convention for all `ureq` call sites:
  - set `timeout_global`
  - set response size limits where relevant
  - use the image-cache hardening pattern as the reference implementation
- explicit document workflow ownership for destructive session replacement

Acceptance:
- no component replaces the active document directly
- all document-replacing flows use one shared guard path
- command APIs remain stable
- allowlist security boundary remains explicit
- failure states are surfaced clearly
- tests cover save/discard/cancel/failure paths

Status as of 2026-03-29:
- completed in the current tree after retro review convergence
- frontend document boundary is in place behind `state/document.ts` and `state/document-actions.ts`
- backend DB/query split is in place behind preserved facades
- network hardening seam is in place for the concrete `ureq` call sites through `desktop/src/http.rs`
- retro review fixes landed:
  - queued-load failures are now surfaced and the pending path is preserved for retry
  - search pagination under `Sort::Relevance` now uses stable offset cursors instead of a broken canonical-name cursor
  - tile download accounting now counts only persisted tiles and writes truthful manifest/progress values
- automated coverage exists for save/discard/cancel/failure paths and the reviewed backend query behavior
- template import remains a required journey, but its concrete frontend entry point is still blocked on the Wave 3 `WorldMapPanel` rebuild

### Wave 2: Canvas Rewrite

Goal:
- turn `CanvasEngine` into a stable facade with owned internals

Primary files:
- `desktop/web/src/canvas/engine.ts`
- `desktop/web/src/canvas/runtime/viewport.ts`
- `desktop/web/src/canvas/runtime/overlays.ts`
- `desktop/web/src/canvas/runtime/document-session.ts`
- `desktop/web/src/canvas/runtime/object-ops.ts`
- `desktop/web/src/canvas/runtime/external-input.ts`
- `desktop/web/src/canvas/runtime/render-pipeline.ts`

Deliverables:
- engine facade preserved
- lifecycle responsibilities split
- render pipeline introduced
- visual correctness owned explicitly
- narrow runtime dependencies

Acceptance:
- `engine.ts` is mostly public API and orchestration
- no service-locator drift
- object operations and document session are independently testable
- render pipeline covers plant add/update/theme correctness cases
- render pipeline covers annotation counter-scale behavior
- render pipeline covers universal post-materialization theme correction after undo/redo/paste/load

Status as of 2026-03-29:
- implementation complete in the authoritative isolated worktree
- landed in the current tree:
  - `canvas/runtime/document-session.ts`
  - `canvas/runtime/object-ops.ts`
  - `canvas/runtime/external-input.ts`
  - `canvas/runtime/render-pipeline.ts`
  - `canvas/runtime/viewport.ts`
  - `CanvasHistory` now triggers post-materialization reconciliation on command execute / undo / redo
  - document-session load now resets layer visibility / lock / opacity state to defaults before applying file state
  - document-session load now refreshes plant labels for the active locale instead of trusting serialized common names
  - viewport ownership moved out of `canvas/engine.ts` behind the preserved `CanvasEngine` facade:
    - wheel zoom
    - stage pan overlay sync
    - resize observer
    - `zoomIn` / `zoomOut` / `zoomToFit`
    - default viewport initialization
    - default viewport reset on document replacement
  - `CanvasPanel` now initializes viewport through the engine facade instead of mutating `engine.stage` directly
  - focused tests cover document-session state reset and command-driven reconciliation
  - focused viewport tests now cover:
    - default viewport initialization
    - programmatic zoom
    - fit-to-content
    - resize-observer redraw
    - wheel zoom behavior
  - focused render-pipeline tests now cover:
    - plant add/update/theme correctness
    - annotation counter-scale behavior
    - post-materialization reconciliation after zoom and document refresh flows
- retro review fixes landed after the viewport extraction:
  - `zoomToFit` now ignores overlay-owned chrome and fits only document-owned `.shape` nodes from content layers
  - the viewport slice was rerun through `npm exec tsc --noEmit` and `npm exec vitest run src/__tests__` after the review fixes
- retro review fixes landed after code review:
  - `community.rs`: path traversal check now runs before `fs::write` (was write-then-check)
  - `document-actions.ts`: `consumeQueuedDocumentLoad` no longer routes through `confirmReplacement` dirty guard
  - `document-actions.ts`: `nameFromPath` fixed to handle Windows-style backslash paths
  - `document-session.ts`: zone materialization now uses `getCanvasColor('zone-stroke')` instead of hardcoded `#2D5F3F`
  - `external-input.ts`: drag ghost circle now uses `getCanvasColor('zone-stroke')` instead of hardcoded `#4CAF50`
  - `filters.rs`: added safety comments at all `format!()` SQL interpolation sites documenting allowlist provenance
- verification completed in the isolated worktree:
  - automated verification passed:
    - `npm test` in `desktop/web`
    - `npm run build` in `desktop/web`
    - `cargo test` in `desktop`
  - Tauri MCP live verification passed for:
    - create / open / save / reload
    - document switch with unsaved changes
    - plant drag/drop and plant stamp
    - undo / redo / paste / duplicate / delete
    - theme switch, locale switch, zoom, and display-mode changes
- deferred, non-blocking cleanup:
  - `CanvasEngine` remains the public facade and still owns some overlay-facing orchestration
  - `canvas/runtime/overlays.ts` is landed; do not treat overlay extraction as an open Wave 2 blocker
  - `ExternalInputDeps.getEngine` still returns full `CanvasEngine` and can be narrowed later to a `ToolContext` interface (~18-file refactor touching `CanvasTool`, `Command`, all tools, all commands)

### Wave 3: Panels, Controllers, And Frontend Plant DB Cleanup

Goal:
- rebuild deleted panel surfaces with the split architecture
- isolate panel lifecycles and controller logic
- prevent `state/plant-db.ts` from becoming the next hidden authority module

Primary files:
- `desktop/web/src/components/panels/WorldMapPanel.tsx` new / recreated
- `desktop/web/src/components/world-map/*` new
- `desktop/web/src/components/canvas/LayerPanel.tsx` new / recreated
- `desktop/web/src/components/canvas/BottomPanel.tsx` new / recreated
- `desktop/web/src/components/canvas/BottomPanelLauncher.tsx` new
- `desktop/web/src/components/canvas/LocationTab.tsx` new / recreated
- `desktop/web/src/components/canvas/TimelineTab.tsx` new / recreated
- `desktop/web/src/components/canvas/BudgetTab.tsx` new / recreated
- `desktop/web/src/components/canvas/ConsortiumTab.tsx` new / recreated
- `desktop/web/src/components/canvas/InteractiveTimeline.tsx` new / recreated
- `desktop/web/src/state/community-actions.ts`
- `desktop/web/src/state/canvas-actions.ts`
- `desktop/web/src/state/location-actions.ts` new
- `desktop/web/src/state/timeline-actions.ts`
- `desktop/web/src/state/budget-actions.ts` new
- `desktop/web/src/state/consortium-actions.ts` new
- `desktop/web/src/state/plant-db.ts`

Required product outcome:
- `WorldMapPanel` rebuilt
- `LayerPanel` rebuilt
- location rebuilt
- timeline rebuilt
- budget rebuilt
- consortium rebuilt

Deliverables:
- split panel shells
- explicit controller/hooks
- template import routed through document boundary
- explicit template-import workflow module owned here
- `WorldMapPanel` split cleanly from design-location behavior:
  - clicking the world-map entry point opens a main-screen panel
  - the panel is filled by a world map with featured-design pins
  - filters highlight the matching featured-design pins
- bottom-panel shell restored as a bottom bar with `location`, `timeline`, `budget`, and `consortium`
- right-side bottom-panel expand button removed from the canonical UX
- location tab rebuilt as a map-picker workflow:
  - search bar overlays the map
  - a fixed center pin stays in place while the map moves beneath it
  - search recenters the map to the address under the fixed pin
  - drag and zoom behave like standard map applications
  - confirm action commits the centered pin as the design location through explicit action ownership and updates the canvas location mirror used by later map surfaces
- lazy-loading boundaries for heavy surfaces, explicitly:
  - rebuilt `WorldMapPanel` / MapLibre surface
  - rebuilt bottom-panel `location` / `timeline` / `budget` / `consortium` surface
- plant DB frontend controller cleanup

Acceptance:
- external-resource lifecycles are isolated
- panel shells are mostly compositional
- `WorldMapPanel` owns featured-design discovery and template-import entry without mixing in design-location editing
- bottom-panel expansion is tab-driven from the bottom bar, with per-tab collapse controls instead of a separate side expand affordance
- location search, recenter, drag, zoom, and confirm flows update design location through explicit ownership
- budget has explicit component and action ownership, not just implied scope
- consortium has explicit component and action ownership, not just a placeholder shell
- heavy surfaces are code-split appropriately
- plant DB state behavior is testable without module-init side effects

Status as of 2026-03-29:
- implementation landed in the current tree for:
  - `WorldMapPanel`
  - `LayerPanel`
  - bottom-panel `location` / `timeline` / `budget` / `consortium` surfaces
- Wave 3 controller/action seams landed:
  - `state/community-actions.ts`
  - `state/template-import-workflow.ts`
  - `state/canvas-actions.ts`
  - `state/location-actions.ts`
  - `state/timeline-actions.ts`
  - `state/budget-actions.ts`
  - `state/consortium-actions.ts`
- template import now routes through `state/document-actions.ts` via the explicit Wave 3 workflow module
- `WorldMapPanel` no longer owns design-location editing; location now lives in the bottom-panel `LocationTab`
- the right-side bottom-panel expand button has been replaced by a tab-driven bottom launcher
- `ConsortiumTab` is rebuilt with explicit CRUD and document dirty-tracking ownership instead of a placeholder shell
- plant DB search orchestration now mounts explicitly from `PlantDbPanel` and no longer runs from module init
- review-driven Wave 3 convergence is complete in the current tree for:
  - `WorldMapPanel` template import staying behind the document boundary
  - `WorldMapPanel` no longer mixing in design-location behavior
  - bottom-panel expansion/collapse being tab-driven
  - explicit location and consortium action ownership
  - explicit Plant DB controller lifecycle
- automated verification for the converged Wave 3 implementation passed:
  - `npm exec tsc --noEmit` in `desktop/web`
  - `npm test` in `desktop/web`
  - `npm run build` in `desktop/web`
- Wave 3 is not marked complete yet:
  - Claude Code still needs to run Tauri MCP live verification for the rebuilt journeys
  - any bugs found during the live verification pass must be fixed before merging the wave as complete

Review checklist before calling Wave 3 complete:
- confirm `WorldMapPanel` template import uses the document boundary only
- confirm `LayerPanel`, `WorldMapPanel`, and bottom-panel tabs tear down listeners / map resources cleanly on unmount
- confirm `WorldMapPanel` only handles featured-design discovery and no longer mixes in design-location behavior
- confirm the bottom bar replaces the right-side expand button and each tab owns its collapse control
- confirm location confirm-flow updates design location and the canvas location mirror correctly
- confirm timeline, budget, and consortium edits participate in dirty tracking and save/load roundtrip as required by their final scope
- confirm plant DB controller lifecycle remains explicit and test-covered
- confirm `rewrite.md` status and verification notes match the landed code exactly

### Wave 4: Design Coherence On Final Structure

Goal:
- apply the coherence pass to the structures that actually survive

Deliverables:
- token migration on final surfaces
- theme-correct canvas colors
- consistent spacing/control hierarchy
- final rewritten panels aligned visually

Acceptance:
- styling work lands on final module structure, not temporary files
- both themes verify cleanly

### Wave 5: Product Completion And Hardening

Goal:
- finish any remaining required pillars
- prove the whole product end to end

Wave 0 scope lock narrowed Wave 5 to:
- desktop release hardening for Linux, macOS, and Windows via Tauri
- regression/failure-path hardening on required rewrite-exit journeys
- i18n, bundle, memory/leak, and docs cleanup

Explicitly deferred after rewrite exit:
- geo / terrain completion
- export workflows
- knowledge / learning surfaces

Deliverables:
- regression suite
- smoke verification
- failure-path verification
- i18n completeness
- bundle-size verification
- memory/leak audit
- docs cleanup

Acceptance:
- no open P0/P1/P2 issues
- required user journeys pass end to end
- supported platforms meet release criteria

Status as of 2026-03-29:
- implementation started in the current tree for:
  - release-blocking CI gates for frontend/backend/platform verification
  - automated i18n completeness coverage for all supported locales
  - rewrite-exit release verification documentation
- automated verification for the Wave 5 slice currently stands at:
  - `npm test --prefix desktop/web`: passed, now including locale completeness coverage
  - `npm run build --prefix desktop/web`: passed, with existing non-blocking bundle warnings unchanged
  - `cargo clippy --workspace -- -D warnings`: passed after closing the reviewed Rust lint backlog in the active release-gate path
  - `cargo test --workspace`: passed
- Tauri MCP live verification remains required for rewrite completion, but it is intentionally excluded from the Wave 5 implementation write set in this tree
- Claude Code should run the live verification pass separately and feed back only bug-fix follow-ups

---

## 7. User-Journey Exit Criteria

These are the product-level checks for rewrite completion.

### Required journeys

1. Create a new design, edit it, and switch documents without losing work.
2. Search and filter the plant database, inspect detail, favorite plants, and place them on the canvas.
3. Create and edit canvas objects, undo/redo them, save/load them, and preserve them through roundtrip.
4. Use `WorldMapPanel` / featured designs discovery without bypassing document safety rules.
5. Use `LayerPanel` for the required display/layer configuration the final product supports.
6. Use the bottom-bar `location` tab to search, drag, zoom, and confirm a design location that updates canvas map layers.
7. Use `timeline`, `budget`, and `consortium` bottom-bar tabs without lifecycle or persistence regressions.
8. Recover gracefully from network failure, disk failure, and invalid external data.
9. Use the app in light and dark themes without unreadable or broken surfaces.
10. Use the app in supported locales without missing keys or broken labels.
11. Run the product on every platform classified as supported at rewrite exit with production-ready behavior.

### Conditional journeys

These are required only if Wave 0 classifies them as required at rewrite exit:
- geo / terrain / map-layer workflows
- export workflows
- knowledge / learning workflows

If a journey is required, it must be tested and pass before the rewrite is called complete.

---

## 8. File Ownership Guidance

### 8.1 Current hotspots

Treat these as current hotspot files until seams exist:
- `desktop/web/src/canvas/engine.ts`
- `desktop/src/db/plant_db.rs`
- `desktop/src/db/query_builder.rs`
- `desktop/web/src/state/design.ts`
- `desktop/web/src/state/plant-db.ts`

Rule:
- do not assign multiple concurrent writers to these files
- create seam files first
- move ownership to new files immediately after seam creation

### 8.2 Wave 3 rebuild targets

These are not current hotspots to preserve.
They are rebuild targets that should be created fresh with split ownership:
- `desktop/web/src/components/panels/WorldMapPanel.tsx`
- `desktop/web/src/components/canvas/LayerPanel.tsx`
- `desktop/web/src/components/canvas/InteractiveTimeline.tsx`
- `desktop/web/src/components/canvas/BottomPanel.tsx`
- `desktop/web/src/components/canvas/TimelineTab.tsx`
- `desktop/web/src/components/canvas/BudgetTab.tsx`

Rule:
- do not recreate them as new monoliths
- create them with the target split architecture from day one

---

## 9. Resume Here

### 9.1 Authoritative continuation workspace

The rewrite is no longer at day-zero startup.

Authoritative continuation workspace:
- worktree path: `/tmp/canopi-rewrite-w1`
- branch: `rewrite_w1_isolated`

Continue the rewrite there if it still exists.

If that worktree is missing:
1. create a fresh isolated branch/worktree from the intended integration base
2. carry forward only the rewrite-owned file set listed below
3. do not continue implementation in the mixed original worktree

Environment aids that may exist only in the isolated worktree:
- `desktop/web/node_modules` may be a symlink to the original worktree install for local checks
- `desktop/resources/canopi-core.db` may be symlinked into the isolated worktree for Rust/Tauri tests

These are verification aids only.
Do not treat them as rewrite-owned product changes.

### 9.2 Rewrite-owned file set already carried forward

Wave 0 / Wave 1 / Wave 2 Package A files:
- `docs/rewrite.md`
- `docs/product-definition.md`
- frontend document boundary:
  - `desktop/web/src/state/document-actions.ts`
  - `desktop/web/src/state/document.ts`
  - `desktop/web/src/state/design.ts`
  - `desktop/web/src/components/panels/CanvasPanel.tsx`
  - `desktop/web/src/__tests__/document-actions.test.ts`
- backend integrity:
  - `desktop/src/http.rs`
  - `desktop/src/lib.rs`
  - `desktop/src/image_cache.rs`
  - `desktop/src/commands/community.rs`
  - `desktop/src/commands/geocoding.rs`
  - `desktop/src/commands/tiles.rs`
  - `desktop/src/db/plant_db.rs`
  - `desktop/src/db/query_builder.rs`
  - `desktop/src/db/plant_db/*`
  - `desktop/src/db/query_builder/*`
- canvas runtime:
  - `desktop/web/src/canvas/engine.ts`
  - `desktop/web/src/canvas/runtime/viewport.ts`
  - `desktop/web/src/canvas/runtime/document-session.ts`
  - `desktop/web/src/canvas/runtime/object-ops.ts`
  - `desktop/web/src/canvas/runtime/external-input.ts`
  - `desktop/web/src/canvas/runtime/render-pipeline.ts`
  - `desktop/web/src/canvas/runtime/types.ts`

Do not pull unrelated dirty files into the rewrite branch/worktree.

### 9.3 Completed status

Completed:
- Wave 0 lightweight product definition and classification lock
- Wave 1 frontend document transition seam
- Wave 1 backend DB/query split with preserved facades
- Wave 1 network hardening seam
- Wave 2 runtime extraction (all packages):
  - viewport lifecycle extraction
  - document-session extraction
  - object-ops extraction
  - external-input extraction
  - render-pipeline introduction

Scope revision: `canvas/runtime/overlays.ts` was originally planned as a separate
module and was explored in the isolated rewrite worktree. The current tree keeps
overlay-facing orchestration in `CanvasEngine` and the expanded render pipeline
instead. Do not treat the absence of a separate `overlays.ts` module as an open
Wave 2 blocker.

Wave 1 state:
- `state/document.ts` is the public document facade
- `state/document-actions.ts` owns destructive document replacement
- queued-load handoff routes through document actions without the dirty guard
- backend command/public APIs remain stable

Wave 2 state:
- `CanvasEngine` still exists as the public facade
- `canvas/runtime/viewport.ts` owns zoom, stage-pan sync, resize observation, and programmatic zoom math
- `canvas/runtime/render-pipeline.ts` owns LOD scheduling, theme reconciliation, and post-materialization refresh
- `canvas/runtime/document-session.ts` owns canvas session reset and document materialization
- `canvas/runtime/object-ops.ts` owns selection-driven operations (delete, duplicate, clipboard, z-order, etc.)
- `canvas/runtime/external-input.ts` owns keyboard/mouse/drag-drop event routing
- overlay lifecycle remains split between `CanvasEngine` orchestration and `canvas/runtime/render-pipeline.ts`; there is no separate `canvas/runtime/overlays.ts` requirement in the current tree
- known tech debt: `ExternalInputDeps.getEngine` returns the full `CanvasEngine` — should be narrowed to a `ToolContext` interface, but this requires changing `CanvasTool`, `Command`, all tools, and all commands (~18 files)

### 9.4 Last known verification status

Verified in the isolated worktree after Package A:
- `npm test` in `desktop/web`: passed
- `npm run build` in `desktop/web`: passed
- `cargo test` in `desktop`: passed
- focused Wave 2 coverage is present and passing for:
  - document actions
  - document-session reset and load behavior
  - viewport initialization / zoom / fit / resize behavior
  - render-pipeline display / annotation / reconciliation behavior
- Tauri MCP live verification passed for the Wave 2 product journeys:
  - create / open / save / reload
  - document switch with unsaved changes
  - plant drag/drop and plant stamp
  - undo / redo / paste / duplicate / delete
  - theme switch, locale switch, zoom, and display-mode changes
- focused Wave 3 coverage is present and passing for:
  - template-import workflow
  - plant DB controller lifecycle
  - bottom-panel tab actions
  - location action ownership
  - consortium action ownership
- Wave 3 automated verification passed in the current tree for:
  - `npm exec tsc --noEmit` in `desktop/web`
  - `npm test` in `desktop/web`
  - `npm run build` in `desktop/web`
- Wave 3 Tauri MCP live verification is intentionally pending:
  - do not mark Wave 3 complete until Claude Code runs the live verification pass for featured-design world-map discovery/template import, layer controls, location selection, timeline, budget, and consortium flows

Known non-blocking warnings:
- existing Vite chunk-size warnings
- existing dynamic+static import warnings around `ipc/species.ts`
- existing Rust dead-code warnings in platform/tile types
- the lazy `WorldMapSurface` bundle is currently large because it owns the MapLibre dependency; keep it code-split and revisit manual chunking only if it becomes a release blocker

### 9.5 Next execution order

Wave 2 is complete.
Do not reopen Wave 0 or Wave 1 except for bug fixes caused by later waves.
Do not reopen Wave 2 except for bug fixes or explicitly chosen deferred cleanup.

Packages B–E (document-session, object-ops, render-pipeline, external-input) are all landed.

Wave 3 implementation and local code-review convergence are now in the current tree.
Next execution order:
- run Claude Code Tauri MCP live verification for:
  - featured-design world-map discovery and template import
  - layer controls
  - location tab search / drag / zoom / confirm
  - timeline flows
  - budget flows
  - consortium flows
- fix any Wave 3 bugs found during review / live verification
- keep Wave 5 automation/documentation work narrow and independent of the live verification pass:
  - release-blocking CI gates
  - automated i18n completeness checks
  - rewrite-exit release checklist/docs cleanup
- start Wave 4 only after Wave 3 review and live verification are both complete

Deferred Wave 2 cleanup that may be revisited later:
1. Narrow `ExternalInputDeps.getEngine`:
   - define `ToolContext` interface in `runtime/types.ts`
   - change `CanvasTool` and `Command` interfaces to use `ToolContext` instead of `CanvasEngine`
   - update all tool and command implementations (~18 files)
   - treat this as architectural cleanup, not a functional blocker

### 9.6 Carry-forward implementation rules

When touching Wave 2 code during later waves:
- preserve `CanvasEngine` as the public facade
- keep runtime modules dependency-narrow
- do not introduce a canvas service-locator context
- do not reintroduce document mutation into canvas code
- do not mix design-system/CSS cleanup into structural canvas packages
- do not parallelize through `engine.ts` until the next seam exists

### 9.7 Explicit blockers and deferred items

Blocked until Wave 3 review / live verification closeout:
- Wave 3 completion call
- Wave 4 start

Still deferred until post-rewrite per product definition:
- geo / terrain product workflows
- export workflows
- learning content

---

## 10. Risks To Watch

### Over-planning

Wave 0 must stay short.
Do not recreate the original RW.0 problem by trying to fully specify everything before implementation.

### Hidden authority migration

Do not simply move complexity from `engine.ts` into:
- a context object
- an action import graph
- a generic workflow manager

### Scope creep

Wave 5 can become unbounded if Wave 0 classifications are sloppy.

### Parallelism fiction

Do not assume two tasks are parallel just because they are named differently.
If they share a hotspot file or a mutation boundary still in flux, they are not parallel.

---

## 11. Final Recommendation

Use this document as the implementation reference.

The rewrite should now be understood as:
- lightweight scope lock first
- document safety first
- backend integrity early
- canvas split with render pipeline
- required panel rebuilds with split architecture
- design coherence on final structure
- product completion and hardening at the end

Execution model:
- `main` as trunk
- short-lived wave branches
- `git worktree` for isolated parallel work where write sets are disjoint

Success condition:
- the architecture is cleaner
- the hotspot files are decomposed
- the required deleted surfaces are rebuilt correctly
- the finished product works end to end
