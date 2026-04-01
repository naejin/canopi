# Canopi Rewrite Operational Reference

**Date**: 2026-04-01  
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
- release hardening and beta verification: `docs/release-verification.md`

---

## 1. Status Snapshot

Completed and archived:
- Wave 0
- Wave 1
- Wave 2 structural split
- Wave 3 implementation slice in the current tree
- Wave 3 high-priority boundary fixes
- retained-surface Wave 3 closeout on the surviving architecture
- renderer phases 1-3 implementation
- renderer manual/live stability-gate closeout on the retained-surface build
- automated frontend verification for the landed rewrite slice
- targeted renderer automation rerun on the retained-surface build
- Wave 4 design coherence on the surviving structure
- release-blocking automated gates rerun locally
- post-beta plant color assignment slice:
  - per-plant document color overrides
  - document-local same-species batch apply
  - `color-by: flower` display mode with cached DB-backed inference

Still active:
- post-beta patch hardening only if new release-blocking defects appear

Deferred after live review:
- featured-design world map / template import
- timeline workflows
- budget workflows
- consortium flows

Current implementation note:
- keep internal tab plumbing if it helps future reactivation, but keep timeline, budget, and consortium hidden from the live bottom-panel launcher until a later product phase explicitly reopens them

Wave 5 beta hardening is complete on the surviving architecture. It does not claim that the broader product roadmap is complete.

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
- screen-space canvas chrome may be owned by the renderer-managed HTML overlay seam when it is more stable than Konva-backed UI nodes

The renderer stability gate is now satisfied on the current build; `docs/renderer/renderer.md` remains only for optional measured viewport filtering and deferred internal renderer cleanup.

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

### 3.1 Renderer Stability Gate Closeout

Status:
- complete on 2026-03-30

Why it mattered:
- the remaining renderer risk is behavioral, not architectural
- retained-surface Wave 3 closeout is now landed on the surviving architecture
- the gate is now about correctness under real use on the final retained-surface feature set

How it was done:
- use `docs/renderer/renderer.md` as the renderer-specific checklist
- keep fixes narrow and tied to observed regressions
- do not mix optional optimization or product redesign into stability closeout

Current rule:
- validate retained surfaces only: core canvas flows, layer controls, and design location
- do not reintroduce deferred features as part of renderer-gate work
- update this file and `docs/renderer/renderer.md` when retained-surface fixes materially change the gate

Current in-tree status:
- targeted automated renderer checks are green locally on 2026-03-30
- retained-surface Wave 3 live verification was rerun with Claude Code on 2026-03-30
- added automated coverage for same-session document hydration, dense-cluster label survival, and stack-badge reconciliation on 2026-03-30
- the 2026-03-30 manual renderer pass initially found narrow regressions in missing-canopy zoom fallback plus overlay/resize behavior
- those regressions were fixed in the current code track with targeted test updates
- the post-fix renderer manual checklist and the two additional overlay/resize scenarios passed on 2026-03-30
- the renderer stability gate is closed; Wave 4 coherence work was unblocked on 2026-03-30

### 3.2 Wave 4 Design Coherence

Status:
- complete on 2026-03-31

Why this stays later:
- design cleanup on unstable structure creates rework
- late renderer fixes must not be entangled with product-level visual redesign

How to do it:
- land coherence work only on the reconciler architecture
- batch shared token, i18n, and fixture churn
- keep redesigns that depend on renderer behavior behind the stability gate

Current in-tree status:
- retained-surface keyboard focus-visible coherence cleanup landed on 2026-03-30
- broader retained-surface token/surface cleanup landed on 2026-03-31
- the Wave 4 patch added retained-surface coherence guard coverage for CSS modules plus theme-refresh coverage for guide and stack-badge canvas tokens on 2026-03-31
- frontend retained-surface verification is green locally on 2026-03-31:
  - `npx --prefix desktop/web tsc --noEmit -p desktop/web/tsconfig.json`
  - `npm test --prefix desktop/web`
  - `npm run build --prefix desktop/web`
- Wave 4 coherence handed off to Wave 5 beta hardening, which later closed on 2026-04-01

### 3.3 Wave 5 Beta Release Hardening

Status:
- complete on 2026-04-01

What is left:
- keep the release operator docs accurate for future beta patches
- preserve the landed Tauri platform hardening: CSP (13.1), shell-plugin removal (13.2), poison lock logging (13.5)
- keep the release-blocking CI gates green on the candidate branch
- keep the deferred backlog explicit so it does not leak into Wave 5

Why it stays last:
- beta hardening should validate the current retained-surface product shape
- it should not be used as a substitute for unresolved roadmap or renderer work

How to do it:
- use `docs/release-verification.md`
- keep Wave 5 narrow
- fix beta-blocking regressions only
- keep deferred product improvements documented as out of scope for this wave

Current in-tree status:
- automated release gates are landed and green locally on 2026-03-30:
  - `cargo fmt --all -- --check`
  - `cargo clippy --workspace -- -D warnings`
  - `cargo test --workspace`
  - `npx --prefix desktop/web tsc --noEmit -p desktop/web/tsconfig.json`
  - `npm test --prefix desktop/web`
  - i18n completeness coverage against `en.json` via the frontend test suite
  - `npm run build --prefix desktop/web`
- GitHub Actions already carries the release-build matrix and artifact upload
- supported-platform packaged-app smoke verification, release publication, and promotion timing live in `docs/release-verification.md` and `docs/release-operations.md`

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
- condition 2 is green locally on 2026-03-30, including document-session hydration and dense-cluster density/stacking coverage
- retained-surface Wave 3 closeout is landed on 2026-03-30 and condition 4 was rerun with Claude Code on that build
- condition 3 passed on the post-fix build on 2026-03-30, including the additional scale-bar/legend stacking and vertical resize scenarios recorded in `docs/renderer/renderer.md`
- there are no open High-severity renderer regressions in the gate categories on the current build
- all five gate conditions are now satisfied; Wave 4 coherence work landed on the stable renderer architecture on 2026-03-31

With the gate satisfied:
- Wave 4 landed on the current retained-surface architecture on 2026-03-31
- renderer-tied product redesigns are no longer blocked by renderer stability, but they still must respect the scope and sequencing rules in this file
- there is no remaining active rewrite wave; post-beta follow-up is patch hardening only if new release-blocking defects appear

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
- keep HTML overlay chrome under one renderer-owned seam instead of scattering standalone DOM overlays

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
- plant DB detail query order must have one local owner; do not spread positional mapping across multiple edit sites

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
- plant DB schema/field changes must land with contract-alignment tests and the matching doc updates

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

Pending beta-release closeout:
- none; use `docs/release-verification.md` as the signed-off record for Wave 5 on 2026-04-01

Now unblocked after renderer stability closeout:
- Wave 4 design coherence
- renderer-tied product-level visual redesigns:
  - plant label improvements (see section 9.1)
- `loadSpeciesCache` extraction from `engine.ts`

Can be fixed independently if needed:
- `ExternalInputDeps.getEngine` narrowing
- tooltip DOM extraction from `engine.ts`
- resource ownership cleanup in rulers, text tool, and `WorldMapSurface`
- deferred-pass data-shape cleanup in renderer internals

Completed in the post-beta hardening patch (see section 13):
  - enabled CSP (section 13.1)
  - removed unused shell plugin (section 13.2)
  - added poison lock logging (section 13.5)

Completed in the post-beta product slice:
- plant color assignment (see section 9)

Still deferred beyond Wave 5 beta:
- image loading performance — asset protocol migration (see section 10)
- detail-card photo fit polish (see section 11)
- map layers — contours, hillshade, raster base map on canvas (see section 12)
- binary IPC for tile commands (see section 13.3 — implement with S12)
- auto-updater — `tauri-plugin-updater` with signed updates (see section 13.4)
- world map with featured designs / template import
- timeline workflows
- budget workflows
- consortium flows
- geo / terrain workflows (offline DEM caching — see section 12 phase 3)
- export workflows
- knowledge / learning surfaces

---

## 8. Beta-Release Core Journeys

Wave 5 beta required these journeys to pass end to end on the packaged app. The signed-off record lives in `docs/release-verification.md`:

1. Create, edit, save, load, and switch designs without losing work
2. Search/filter the plant DB, inspect detail, favorite plants, and place them on canvas
3. Edit canvas objects, undo/redo them, and preserve them through save/load roundtrip
4. Use `LayerPanel` for required display/layer configuration
5. Use bottom-bar `location` search / drag / zoom / confirm flows correctly
6. Recover gracefully from network failure, disk failure, and invalid external data
7. Use the app in light and dark themes without broken surfaces
8. Use supported locales without missing keys or broken labels
9. Meet beta-release criteria on each supported platform

---

## 9. Plant Color Assignment

**Status**: landed in the current tree on 2026-04-01 as a post-beta product slice.

### Problem

All plants render as green (stratum-colored, 4 shades of green + green fallback). In practice, stratum coverage is 0.4% of species, so nearly every plant is the same `#4CAF50`. This makes dense designs hard to read and misses intuitive color associations (tomato = red, lavender = purple).

### Research: Automated Color From DB

The species DB has `flower_color` and `fruit_seed_color` text fields. Coverage analysis (2026-04-01):

| Source | Species covered | % of 175,473 |
|---|---|---|
| Direct `flower_color` | 12,176 | 6.9% |
| Genus-inferred (50%+ dominant, 3+ samples) | +43,974 | 25.1% |
| Family-inferred (40%+ dominant, 10+ samples) | +43,296 | 24.7% |
| **Total colored** | **99,446** | **56.7%** |
| Remaining (no data) | 76,027 | 43.3% |

Color distribution of the 57% that resolve: White 28%, Green 27%, Yellow 24%, Pink 7%, Blue 6%, Purple 4%, Brown 3%, Red/Orange/Violet < 1% each.

Flower color is botanically correct but not always evocative — tomato has `flower_color: Yellow` (the flower), but users think "red" (the fruit). `fruit_seed_color` covers only 1.1%.

**Decision**: flower color as a new `color-by` display mode (analytical view, not default). Not suitable as the automatic default because 79% of resolved colors are white/green/yellow (bland) and fruiting plants feel "wrong."

### Design: Hybrid Approach

Three layers, from least to most user effort:

1. **Default**: green (`#4CAF50`). Stays green when no user override. Green = plant — honest and recognizable when the DB has no better signal.

2. **User color override** (the main feature): a left-toolbar plant-color button opens a picker for the current plant selection. The button is disabled unless one or more plants are selected. Stored per-instance in the document. Options:
   - "Set color" — applies to all selected plant instances
   - "Set color for all [species]" — applies to every current instance of that species and stores a document-scoped default so future placements inherit the same color
   - "Clear color" — removes per-instance overrides from the current selected plants
   - "Clear species default" — removes the document-scoped default for future placements when the current selection resolves to exactly one species
   - When `flower_color` data exists for a single-species selection, the picker pre-selects the matching palette color as a suggestion

3. **Flower color display mode**: new `color-by` attribute `'flower'` in the existing display mode system. Maps `flower_color` DB text values to a fixed hex palette. Uses genus/family inference for the 93% without direct data. Falls back to gray (`#9E9E9E`) for species with no data at any level. This is an analytical overlay — it overrides user colors when active, same as hardiness/lifecycle modes do.

### Palette: 12 Botanical Colors

Curated for 8px circles at 50% opacity fill + full opacity 1.5px stroke on both cream (`#F6F2EA`) and charcoal (`#151210`) canvas. Names are botanical/natural, matching the field notebook aesthetic. Hues spaced ~30 degrees apart for maximum perceptual distinctness at small sizes.

| # | Name | Hex | Hue | Use / Association |
|---|------|-----|-----|-------------------|
| 1 | Clover | `#3E8E4E` | 135 | Default green (also in palette for explicit assignment) |
| 2 | Poppy | `#C44230` | 8 | Warm red — tomatoes, peppers, berries |
| 3 | Calendula | `#D4822A` | 30 | Warm orange — squash, companion flowers |
| 4 | Goldenrod | `#C8A51E` | 48 | Rich yellow — sunflowers, composites |
| 5 | Walnut | `#7A5C30` | 35 | Warm brown — trees, woody perennials |
| 6 | Verdigris | `#2E8B7A` | 165 | Blue-green teal — shade plants, aquatics |
| 7 | Cornflower | `#4A82C2` | 212 | Clear mid-blue — cool ornamentals |
| 8 | Chicory | `#3FA0C0` | 195 | Medium-light blue — contrast |
| 9 | Wisteria | `#7B5EA7` | 270 | Soft purple — herbs, aromatics |
| 10 | Elderberry | `#8B3A6E` | 318 | Deep plum — berry bushes, dark fruit |
| 11 | Peony | `#C25B82` | 340 | Rose-pink — flowering ornamentals |
| 12 | Flint | `#71716A` | 60 | Warm neutral gray — infrastructure, ground cover |

Plus a `More colors` path for users who need exact colors. The advanced section stays inside the same toolbar popover and provides a hue strip, saturation/lightness square, and hex input.

Palette layout in the toolbar popover picker: 4 columns x 3 rows, matching the numbered order (left-to-right, top-to-bottom). Below the grid: a custom color input row.

Design rules for the palette:
- No white or black — invisible on one of the two canvas themes at 50% opacity
- No color closer than 25 degrees in hue to its neighbor (except brown, which is distinguished by low saturation)
- Goldenrod (`#C8A51E`, H:48) is intentionally distinct from UI ochre accent (`#A06B1F`, H:30) — different hue, higher lightness, and never appears in UI chrome context
- Clover (`#3E8E4E`) is warmer and more natural than the current default `#4CAF50`, but close enough that the default→override transition feels gentle

### Flower Color Text-to-Hex Mapping

For the `color-by: flower` display mode, map the ~20 distinct `flower_color` DB text values to palette-adjacent hex values:

| DB value | Hex | Palette neighbor |
|---|---|---|
| Red | `#C44230` | Poppy |
| Orange | `#D4822A` | Calendula |
| Yellow | `#C8A51E` | Goldenrod |
| Green | `#3E8E4E` | Clover |
| Blue | `#4A82C2` | Cornflower |
| Purple | `#7B5EA7` | Wisteria |
| Violet | `#6B4E9E` | Slightly darker Wisteria |
| Pink | `#C25B82` | Peony |
| White | `#B8B3AA` | Warm off-white (visible on cream canvas) |
| Brown | `#7A5C30` | Walnut |
| Black | `#4A4A46` | Dark warm gray (visible on dark canvas) |

Composite values (e.g. "Red, Orange"): use the first value.

### Data Model Changes

**Rust** (`common-types/src/design.rs`):
```rust
pub struct PlacedPlant {
    // ... existing fields ...
    pub color: Option<String>,  // hex color override, e.g. "#C44230"
}
```

**TypeScript** (`desktop/web/src/types/design.ts`):
```typescript
export interface PlacedPlant {
  // ... existing fields ...
  color: string | null  // hex color override
}

export interface CanopiFile {
  // ... existing fields ...
  plant_species_colors: Record<string, string>  // document-scoped species color defaults
}
```

**Konva attr**: `data-color-override` on plant groups. Read by `getStratumColor()` replacement logic.

**Serialization**: `color` field round-trips through `.canopi` file save/load. `null` omitted from JSON via `#[serde(skip_serializing_if = "Option::is_none")]`.

**Species-wide color behavior**: `Set color for all [species]` is document-scoped. It updates all currently placed instances of that species and stores a design-level default so future placements of that species inherit the same color.

### Landed Slices

**Slice 1 — Data model + rendering**
- Added `color` to `PlacedPlant` in Rust and TypeScript
- Persisted the field through `.canopi` save/load roundtrip
- Added `data-color-override` to plant groups
- Updated default and canopy rendering to use the explicit override when present

**Slice 2 — Toolbar picker**
- Added a toolbar-anchored HTML popover for selected plant groups
- Added the 4x3 palette plus an inline `More colors` advanced picker
- Landed "Set color", "Set color for all [species]", "Clear color", and "Clear species default"
- Added document-scoped species color defaults so future placements inherit the same-species color
- Added flower-color suggestion when DB data resolves
- Added undo/redo support via `SetPlantColorCommand`

**Slice 3 — Flower color display mode**
- Added `'flower'` to `ColorByAttribute`
- Implemented flower-color text-to-hex mapping
- Added species/genus/family resolution in the DB command path
- Cached resolved flower colors in the species cache load flow
- Added legend entries, display-mode UI wiring, and i18n keys

### Architecture Notes

- Plant color editing is a toolbar-owned HTML popover surface, not a Konva surface
- `SetPlantColorCommand` is a new undo/redo command; follows existing `Command` interface pattern
- Species-wide color defaults are document state, not reconciler state — new placements must read the document default before node creation
- Flower color inference (genus/family propagation) should be computed once at species cache load, not per-render
- The `color` field on `PlacedPlant` is purely a document-level override — it does not modify the species DB
- The toolbar picker is selection-driven — it must derive state from the current selected plant groups rather than holding clicked-plant metadata outside the engine/document seams

### 9.1 Plant Label Improvements (Deferred Design Spec)

Companion to section 9 — the plant color system is landed, but these label improvements remain deferred.

#### Current System

Three LOD tiers based on zoom (`stageScale` = pixels per meter):

| Zoom | LOD | Labels |
|---|---|---|
| < 0.5 px/m | `dot` | Hidden (except selected) |
| 0.5–5 px/m | `icon` | Hidden (except selected) |
| >= 5 px/m | `icon+label` | Density-suppressed at 40px spacing |

Labels are two-line Konva.Text children of the plant group:
- Line 1 (`.plant-label`): common name, or abbreviated botanical name if no common name
- Line 2 (`.plant-botanical`): abbreviated botanical name (only when common name shown)

Density algorithm: greedy top-to-bottom spatial scan. First plant in each 40px neighborhood wins a label. Selected plants always show labels. No priority weighting.

#### Problem

With color-coded plants, the label system has three issues:
1. **Redundant two-line labels** — the botanical abbreviation below the common name adds visual clutter. On a dense design, the second line competes for the same label real estate without adding much value (the tooltip already shows both names on hover)
2. **Color-blind density suppression** — two differently-colored plants 35px apart suppress each other's labels, even though their colors already distinguish them visually. Same-color neighbors are the real readability problem
3. **No priority awareness** — a user-colored tomato (the user explicitly cares about it) loses its label to a generic green plant that happened to scan first in the top-to-bottom sweep

#### Improvement 1: Single-Line Labels

Remove the secondary botanical label (`.plant-botanical`) from persistent display. Show only one line:

- **Has common name** → display common name (normal weight)
- **No common name** → display abbreviated botanical name (italic, as today)

The botanical abbreviation moves to hover-only — the plant tooltip already shows full botanical name + common name + stratum. This recovers ~13px of vertical space per labeled plant, allowing tighter label packing and more labels visible at the same zoom level.

Files affected:
- `plants.ts`: `createPlantNode()` — stop creating `.plant-botanical` child node
- `plants.ts`: `updatePlantLOD()` / `updatePlantDensity()` — remove botanical label visibility logic
- `plants.ts`: `updatePlantLabelsForLocale()` — remove botanical label create/update/destroy logic

This is a pure subtraction — no new code needed. The botanical abbreviation function `abbreviateCanonical()` stays for the no-common-name fallback.

#### Improvement 2: Color-Aware Density Suppression

Modify `updatePlantDensity()` to use two distance thresholds:

| Neighbor relationship | Suppression distance |
|---|---|
| Same color | 40px (current) |
| Different color | 20px |

"Same color" means both plants resolve to the same fill hex (comparing `data-color-override` attrs, or both defaulting to `#4CAF50`). Different-colored plants are already visually distinct — their labels can overlap more without confusion.

Implementation in `updatePlantDensity()`:
```
const blocked = neighbors.some((neighbor) => {
  if (neighbor.group.id() === plant.group.id()) return false
  if (!shown.has(neighbor.group.id())) return false
  const dx = plant.sx - neighbor.sx
  const dy = plant.sy - neighbor.sy
  const distSq = dx * dx + dy * dy
  const sameColor = getPlantFill(plant.group) === getPlantFill(neighbor.group)
  const threshold = sameColor ? SAME_COLOR_DIST_SQ : DIFF_COLOR_DIST_SQ
  return distSq < threshold
})
```

Where `SAME_COLOR_DIST_SQ = 40 * 40` (unchanged) and `DIFF_COLOR_DIST_SQ = 20 * 20`.

`getPlantFill()` reads `data-color-override` attr from the group, falling back to the circle's current `fill()` value. This is a hot-path function — must be cheap (attr read, no DB lookup).

Effect: in a colorful design (many user-assigned colors), significantly more labels survive density suppression. In an all-green design (no overrides), behavior is identical to today.

#### Improvement 3: Priority-Based Label Ordering

Replace the current top-to-bottom spatial sort with a priority-weighted sort in `updatePlantDensity()`. Plants with higher priority win label slots first:

| Priority | Condition | Why |
|---|---|---|
| 0 (highest) | Selected | Already first-class today |
| 1 | User-colored (has `data-color-override`) | User explicitly cares about this plant |
| 2 | Default green (no override) | Generic — lower priority for label real estate |

Within the same priority tier, maintain the current top-to-bottom spatial order for stable, predictable label placement.

Implementation: change the `anchors` sort in `updatePlantDensity()`:
```
const anchors = positions
  .slice()
  .sort((a, b) => {
    const pa = labelPriority(a.group, selectedIds)
    const pb = labelPriority(b.group, selectedIds)
    if (pa !== pb) return pa - pb
    return (a.sy - b.sy) || (a.sx - b.sx)
  })
```

Where `labelPriority()` returns 0 for selected, 1 for user-colored, 2 for default.

Effect: a user-colored tomato next to a default-green weed will keep its label while the weed's label gets suppressed. Creates a natural feedback loop — assigning a color to a plant also makes its label more persistent.

#### Improvement 4: Labels Hidden by Default (Deferred)

With color assignment landed, labels become detail-on-demand rather than always-on. The colored dots carry enough identity for spatial orientation; labels add precision when needed.

Proposed behavior:
- **Default**: labels hidden at all zoom levels. Colored circles + tooltip-on-hover provide identification
- **Selected plants**: always show label (unchanged)
- **Toggle**: "Show labels" option in display controls or toolbar. When active, current density-based display applies (with improvements 1-3)
- **Keyboard shortcut**: quick toggle for show/hide labels

Risk: for all-green designs (user hasn't assigned any colors), hidden labels makes every plant anonymous. Mitigation: only hide labels by default when the document contains at least one color-overridden plant. All-green documents keep current behavior.

This is a larger UX shift. Defer until after improvements 1-3 are landed and validated. Listed here for design continuity.

#### Implementation Order

1. **Improvement 1** (single-line labels) — pure subtraction, no dependencies, immediate vertical space recovery
2. **Improvement 3** (priority ordering) — small sort change, can land with or without color assignment
3. **Improvement 2** (color-aware density) — requires color assignment phase 1 (needs `data-color-override` attr to exist)
4. **Improvement 4** (hidden by default) — deferred, requires user validation of 1-3

Improvements 1-3 can ship together as part of color assignment phase 1. They modify only `plants.ts` — no new files, no data model changes, no i18n keys.

## 10. Image Loading Performance (Design Spec)

### Problem

Opening a plant detail card freezes the UI until the species photo loads. The root cause is the base64 round-trip in `get_cached_image_url`:

1. Rust reads/downloads the image (up to 10s, 10MB)
2. Rust base64-encodes the bytes — a 2MB JPEG becomes ~2.7MB of base64 text
3. The entire base64 string transfers over Tauri IPC as a single JSON payload
4. The WebView parses the data URL and decodes the image synchronously

The `loading="lazy"` attribute on the `<img>` tag doesn't help — the expensive part is the IPC transfer of megabytes of base64, not the browser render.

### Scope: Local or Global?

**Mostly local** to `PhotoCarousel.tsx` — it's the only component doing remote image fetching via base64. But the underlying pattern (large IPC payloads blocking the main thread) would bite any future image surface. The fix should eliminate the base64 workaround entirely.

### Fix: Enable Tauri Asset Protocol (Scoped to Image Cache)

The current CLAUDE.md notes: *"The asset:// protocol is not scoped in capabilities/main-window.json. Serving local files to the WebView requires base64 data URLs from Rust. Adding fs:allow-read scope would fix it properly but needs capability config work."*

Tauri v2 has a built-in `AssetProtocolConfig` that can serve local files to the WebView without base64. Scope it to the image cache directory only — no localhost HTTP server needed, no new dependencies.

**How it works:**
- Enable asset protocol in `tauri.conf.json` with scope limited to `$APPDATA/image-cache/**`
- Rust returns the **cache file path** instead of base64
- Frontend calls `convertFileSrc(path)` to get `http://asset.localhost/path/to/cached/image.jpg`
- Browser loads the image natively — streaming, progressive decode, proper memory management
- No IPC bottleneck: the image bytes never cross the IPC bridge

### Implementation

**Phase 1 — Asset protocol config** (no code changes yet, just plumbing)

1. `desktop/tauri.conf.json` — enable asset protocol with scoped access:
   ```json
   "security": {
     "csp": null,
     "assetProtocol": {
       "enable": true,
       "scope": ["$APPDATA/image-cache/**"]
     },
     "capabilities": ["main-window"]
   }
   ```

2. `desktop/capabilities/main-window.json` — add fs read permission scoped to image cache:
   ```json
   "permissions": [
     ...existing...,
     {
       "identifier": "fs:allow-read",
       "allow": [{ "path": "$APPDATA/image-cache/**" }]
     }
   ]
   ```

**Phase 2 — Rust: return file path instead of base64**

3. `desktop/src/image_cache.rs` — add `pub fn cache_dir(&self) -> &Path` accessor

4. `desktop/src/commands/species.rs` — new command `get_cached_image_path` that returns the cache file path as a string:
   ```rust
   #[tauri::command]
   pub fn get_cached_image_path(
       cache: State<'_, ImageCache>,
       url: String,
   ) -> Result<String, String> {
       cache.ensure_cached(&url)?;  // download if not cached, return ()
       let path = cache.cached_path(&url);
       Ok(path.to_string_lossy().to_string())
   }
   ```
   Split `fetch_and_cache_bytes` into `ensure_cached` (download + cache, don't return bytes) and `cached_path` (return the file path). The bytes never need to enter Rust's return channel.

5. Keep `get_cached_image_url` (base64 version) temporarily for fallback during rollout, remove once stable.

**Phase 3 — Frontend: use convertFileSrc**

6. `desktop/web/src/components/plant-detail/PhotoCarousel.tsx` — replace the `invoke('get_cached_image_url')` call:
   ```typescript
   import { convertFileSrc } from '@tauri-apps/api/core';

   // Before:
   const dataUrl = await invoke<string>('get_cached_image_url', { url: img.url });
   setLoadedSrc(dataUrl);

   // After:
   const cachePath = await invoke<string>('get_cached_image_path', { url: img.url });
   setLoadedSrc(convertFileSrc(cachePath));
   ```

7. Add **adjacent image preloading** — when `currentIndex` changes, also trigger `invoke('get_cached_image_path')` for `currentIndex ± 1` (fire-and-forget, just warms the disk cache so the next swipe is instant).

**Phase 4 — Cleanup**

8. Remove `get_cached_image_url` command (base64 version) from `lib.rs` handler list and `commands/species.rs`
9. Remove `base64` crate from `desktop/Cargo.toml` if no other consumer remains
10. Update `desktop/CLAUDE.md` — remove the "No convertFileSrc()" gotcha, document the asset protocol scope

### Files Changed

| File | Change |
|---|---|
| `desktop/tauri.conf.json` | Enable `assetProtocol` with image-cache scope |
| `desktop/capabilities/main-window.json` | Add scoped `fs:allow-read` |
| `desktop/src/image_cache.rs` | Add `ensure_cached()`, `cached_path()`, `cache_dir()` |
| `desktop/src/commands/species.rs` | Add `get_cached_image_path`, later remove `get_cached_image_url` |
| `desktop/src/lib.rs` | Register new command, later remove old one |
| `desktop/web/src/components/plant-detail/PhotoCarousel.tsx` | Use `convertFileSrc()` + adjacent preload |
| `desktop/web/src/ipc/species.ts` | Add `getCachedImagePath()` wrapper |
| `desktop/Cargo.toml` | Remove `base64` (cleanup phase) |
| `desktop/CLAUDE.md` | Update asset protocol gotcha |

### Performance Impact

| Metric | Before (base64) | After (asset protocol) |
|---|---|---|
| IPC payload for 2MB image | ~2.7MB base64 string | ~80 byte file path string |
| Browser decode | Synchronous data URL parse | Native streaming + progressive |
| Memory | Base64 string + decoded bitmap | Decoded bitmap only |
| Adjacent carousel image | Full IPC round-trip | Instant (disk cache warm) |

### Risk

- **Scope escape**: Asset protocol scope is limited to `$APPDATA/image-cache/**` — no access to arbitrary files. Only SHA256-hashed filenames exist in this directory (no user-controlled paths)
- **Platform differences**: `convertFileSrc()` generates `http://asset.localhost` URLs on all platforms. Tested pattern in Tauri ecosystem
- **Cache miss UX**: `ensure_cached()` still blocks on network download for uncached images. The shimmer loading state in PhotoCarousel already handles this. The improvement is that *cached* images load instantly instead of blocking on base64 encoding + IPC transfer

### Future: Thumbnails (Not In Scope)

If the app ever shows multiple species photos simultaneously (e.g., search results with thumbnails), generate small thumbnails (200px wide) on first cache. Store alongside full-size with a `-thumb` suffix. This is not needed now — PhotoCarousel shows one image at a time.

---

## 11. Detail Card Photo Fit (Design Spec)

### Problem

Plant photos in `PhotoCarousel` use `object-fit: cover` inside a fixed 3:2 container. This crops images to fill the frame — losing edges, canopy shape, growth habit, and other identification-critical detail. Botanical source photos vary wildly in aspect ratio (portrait, landscape, square, macro), so the crop is unpredictable and often removes the most informative parts of the image.

### Current Implementation

```css
.imageContainer {
  aspect-ratio: 3 / 2;      /* fixed container */
  overflow: hidden;
}
.image {
  width: 100%;
  height: 100%;
  object-fit: cover;         /* scale + crop to fill */
}
```

The container dimensions are stable — `aspect-ratio: 3 / 2` on a panel-width block. The panel width does not need to change.

### Fix: `object-fit: contain`

Switch to `object-fit: contain` so the full image is always visible. The container keeps its 3:2 aspect ratio — non-matching images get letterboxed (bars top/bottom) or pillarboxed (bars left/right) within the same box.

**Why contain is better UX here:**
- **Identification context** — users open the detail card to identify a plant. Cropping the leaf edges, canopy silhouette, or flower arrangement defeats that purpose
- **Photo source diversity** — images come from multiple providers (iNaturalist, USDA, etc.) with no consistent aspect ratio. `cover` silently loses different content per image; `contain` is predictable
- **Panel stability** — the container is already dimension-locked. No layout shift from the change

**Tradeoff:** Visible background bars when the image doesn't match 3:2. Three options, in order of complexity:

| Option | Approach | Complexity |
|---|---|---|
| A | Surface background (`var(--color-surface)`) | CSS-only, already set |
| B | Subtle tinted background (e.g. `var(--color-surface-alt)`) | CSS-only, one token |
| C | Blurred backdrop (duplicate `<img>` with `object-fit: cover` + `filter: blur(20px)` + low opacity behind the main image) | Extra DOM element + CSS |

**Recommendation:** Start with **Option A** — the existing `background: var(--color-surface)` already handles this. The field notebook aesthetic favors clean, restrained surfaces over decorative blur. Option C can be revisited if the letterboxing feels too stark in practice, but it's likely unnecessary.

### Implementation

Single CSS change:

```css
/* PhotoCarousel.module.css */
.image {
  width: 100%;
  height: 100%;
  object-fit: contain;    /* was: cover */
  opacity: 0;
  transition: opacity 0.35s ease;
}
```

No component changes. No i18n. No data model. No Rust changes.

### Files Changed

| File | Change |
|---|---|
| `desktop/web/src/components/plant-detail/PhotoCarousel.module.css` | `object-fit: cover` → `object-fit: contain` |

### Interaction With Section 10 (Image Loading Performance)

This change is fully orthogonal to the asset protocol migration. Both improve the photo experience from different angles:
- Section 10 fixes *when* the image appears (eliminating base64 IPC freeze)
- Section 11 fixes *how* the image appears (showing the full photo instead of a crop)

Either can ship independently. If both land, the combined effect is: photos load instantly *and* show the complete image.

### Risk

- **Minimal** — one CSS property change, no layout shift, no JS changes
- **Placeholder unchanged** — the no-photo placeholder already uses `aspect-ratio: 3 / 2` with centered icon, unaffected by this change
- **Nav arrows / source badge** — positioned absolutely within `.imageContainer`, unaffected by object-fit mode
- **Dark mode** — `var(--color-surface)` already has a dark theme override, letterbox bars will match

---

## 12. Map Layers on Canvas (Design Spec)

### Problem

When a user sets or updates a design location via the bottom panel, nothing happens on the canvas — the `contours` and `climate` Konva layers remain empty stubs. The design's geographic context (terrain, elevation, surrounding features) is invisible. For agroecological design, elevation contours are critical — they determine water flow, microclimate zones, and planting strategy. This information should appear on the canvas as soon as a location is set, respecting the layer display settings that already exist.

### Layer Scope

Three map layer types, ordered by value and feasibility:

| Layer | Konva target | Data source | Offline | Online | Priority |
|---|---|---|---|---|---|
| **Elevation contours** | `contours` | AWS Terrain Tiles (DEM, Terrarium) → `maplibre-contour` client-side generation | Yes — cached DEM tiles | Yes — live DEM fetch | P0 |
| **Hillshade** | `contours` (same layer, rendered behind contour lines) | Same DEM source | Yes — same cached tiles | Yes | P1 |
| **Raster base map** | `climate` (repurposed) | OSM raster tiles (street) or satellite provider | Yes — cached via `download_tiles` backend | Yes — live fetch | P2 |

**Out of scope**: parcel/cadastral boundaries (requires country-specific data sources), climate zone overlays (no free global source), water features (insufficient open data at garden scale).

The `contours` layer already exists in the 7-layer Konva stack and is non-listening (no pointer events). The `climate` layer is similarly stubbed. Both have visibility/opacity/lock controls wired through `LayerPanel.tsx` signals — they just need content.

### Architecture: Hidden MapLibre → Rasterize → Konva Image

Use a hidden (off-screen) MapLibre GL instance to render map tiles, then rasterize the result onto the appropriate Konva layer as a `Konva.Image` node. This approach was chosen over the alternative (MapLibre canvas behind Konva) because:

- **Layer controls work natively** — Konva layer `visible()`, `opacity()`, and lock state apply without CSS workarounds
- **Export-ready** — when PNG/PDF export is built, map layers are already part of the Konva stage
- **Reconciler-compatible** — updates flow through `reconciler.invalidate('material')` like all other visual changes
- **No compositing tricks** — no need to make Konva canvas transparent or manage z-index between two canvas systems

**Rendering flow** (fully async — see Non-Blocking Guarantee section for freeze-risk audit):
```
1. Create hidden MapLibre instance (display:none div, fixed size e.g. 2048×2048)
2. Configure with DEM source + contour/hillshade layers from contours.ts
3. Set center/zoom to match Konva viewport (via projection.ts conversions)
4. await MapLibre 'idle' event (tiles fetched + contours generated in Web Workers)
5. await createImageBitmap(map.getCanvas()) — async pixel copy, off main thread
6. Create/update Konva.Image on the `contours` layer with the ImageBitmap
7. Position the Konva.Image in world coordinates to align with the viewport
```
**Never use `toDataURL()`** — it blocks the main thread for GPU readback + PNG encode (20–80ms on 2048×2048). `createImageBitmap()` does the same work asynchronously.

**MapLibre container setup:**
- Hidden div appended to document body: `position: absolute; left: -9999px; width: 2048px; height: 2048px`
- `preserveDrawingBuffer: true` (required for `toDataURL()`)
- Single instance, created on first location set, destroyed on engine teardown
- Resource ownership: the map lifecycle owner is `CanvasEngine` (or a new `map-layer.ts` runtime module)

### Zoom Mapping (Already Solved)

`projection.ts` already provides the complete coordinate bridge:

| Function | Purpose |
|---|---|
| `stageScaleToMapZoom(stageScale, lat)` | Konva px/m → MapLibre zoom level |
| `worldToGeo(x, y, originLat, originLon)` | Canvas meters → lng/lat |
| `geoToWorld(lng, lat, originLat, originLon)` | lng/lat → canvas meters |
| `stageViewportCenter(stage, originLat, originLon)` | Viewport center in geographic coords |

**Zoom range mapping** (at 45°N latitude):

| Konva stageScale (px/m) | MapLibre zoom | Typical use |
|---|---|---|
| 0.1 (min) | ~13.4 | Regional overview — 100m contours |
| 1 | ~16.8 | Neighborhood — 20m contours |
| 5 | ~19.1 | Garden scale — 5m contours |
| 50 | ~22.4 | Close detail — 5m contours (DEM max) |
| 200 (max) | ~24.4 | Extreme close — beyond DEM resolution |

The contour interval ladder in `contours.ts` already adapts to MapLibre zoom: 100m→50m→20m→10m→5m as zoom increases. The user can override with a fixed interval via the `contour_interval` setting (already in the Settings struct, currently unused).

**DEM ceiling**: AWS Terrain Tiles max at zoom 15. Beyond that, `maplibre-contour` overzooms (interpolates), so contour detail plateaus. This is fine — at garden scale (stageScale > 5), the user is placing individual plants, not reading terrain. Contours are most useful at stageScale 0.1–5 (landscape-to-garden transition).

### Viewport Sync Strategy

The Konva viewport moves continuously during pan/zoom. Re-rendering MapLibre on every frame is too expensive. Strategy: **overscan render + deferred re-render**.

1. **Overscan buffer**: render MapLibre at 2× the visible viewport (the hidden container is larger than the screen). The Konva.Image covers more world area than currently visible
2. **Viewport guard**: on each `applyStageTransform`, check if the viewport center has moved more than 25% of the cached render extent. If not, do nothing — the existing Konva.Image still covers the visible area
3. **Deferred re-render**: when the guard trips, schedule a MapLibre re-render after a debounce (300ms idle after last pan/zoom event). Don't re-render during active interaction
4. **Zoom threshold**: if the zoom level changes by more than 2 MapLibre zoom levels from the cached render, trigger an immediate re-render (contour interval may have changed)

**Alignment**: the Konva.Image is positioned in world coordinates using `geoToWorld()`. When the user pans, the image moves with the stage transform (it's a Konva node on a layer). Only when the viewport moves past the overscan boundary does a new render occur.

**Render sizing**: the hidden MapLibre container renders at a fixed resolution (e.g., 2048×2048). The world extent covered depends on the MapLibre zoom level. At MapLibre zoom 16 (stageScale ~1), 2048px covers ~2048m. With 2× overscan on a 1920px screen, the cache covers ~4× the visible width — the user can pan significantly before triggering a re-render.

### Tile Caching Strategy (Offline Support)

**Online mode**: MapLibre fetches DEM tiles from AWS (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`) on demand. No caching needed — tiles are small (~30KB each at zoom 12) and load fast.

**Offline mode**: pre-download DEM tiles for the design's area so contours render without network.

**Backend changes**: extend `tiles.rs` to support multiple tile sources. The existing `download_tiles` command downloads OSM raster tiles. Add a parallel `download_dem_tiles` command (or parameterize the existing one) that downloads from the DEM URL template.

**Download trigger**: when the user confirms a location in the bottom panel, offer a "Download terrain for offline use" action. Calculate bbox from design location:
- Default radius: 2km from design center → bbox of ~4km × 4km
- User-adjustable radius (small garden: 500m, large farm: 5km)
- Zoom range: 0–15 (full DEM resolution)
- Tile count at 2km radius, z0–15: ~1,200 tiles, ~35MB (manageable)

**Storage structure** (parallel to existing raster tiles):
```
~/.local/share/canopi/
  tiles/          # existing — OSM raster tiles
  dem-tiles/      # new — DEM terrain tiles
    {z}/{x}/{y}.png
    manifest.json
```

**MapLibre offline integration**: MapLibre supports custom `transformRequest` to intercept tile fetches. When offline (or when cached tiles exist):
1. Intercept DEM tile requests via `transformRequest`
2. Check `dem-tiles/{z}/{x}/{y}.png` on disk
3. If cached: serve via asset protocol (`convertFileSrc()`) or base64 IPC
4. If not cached + offline: return empty/transparent tile (contours degrade gracefully — gaps, not errors)
5. If not cached + online: let MapLibre fetch normally, optionally cache the response

**Gotcha**: MapLibre runs in the WebView and can't read local files directly. Cached tile serving options:
- **Asset protocol** (preferred, same as section 10): scope `$APPDATA/dem-tiles/**` in asset protocol config. MapLibre `transformRequest` rewrites DEM URLs to `http://asset.localhost/...` paths via `convertFileSrc(cachePath)`. The current CSP is already enabled, so when this lands `img-src` must be widened to include `asset: http://asset.localhost`
- **Optimized IPC binary transfer** (fallback): use `tauri::ipc::Response` to return raw tile bytes without JSON serialization overhead. This avoids the base64 bottleneck documented in section 10 — Tauri v2 can return `Response::new(bytes)` as an ArrayBuffer directly to JS. Frontend creates a Blob URL from the ArrayBuffer for MapLibre consumption
- **IPC streaming** (for bulk tile pre-fetch): use `tauri::ipc::Channel<&[u8]>` to stream tile data chunk-by-chunk during download, enabling real-time progress without blocking the main thread

**Tauri v2 features that help** (from docs):
- `convertFileSrc(filePath)` — converts local file path to `http://asset.localhost/...` URL loadable by WebView. Requires `assetProtocol.enable: true` + scope in `tauri.conf.json`
- `tauri::ipc::Response` — optimized binary return from Rust commands, bypasses JSON serialization. Use for `get_dem_tile` if asset protocol isn't available
- `tauri::ipc::Channel` — streaming IPC channel for sending data chunks from Rust to JS. Use for download progress + tile data streaming during bulk cache operations
- `@tauri-apps/plugin-http` `fetch()` — scoped HTTP client with proxy support. Alternative to `ureq` for tile downloads if async is preferred, but current `ureq` approach in `tiles.rs` works fine for sync command thread pool

### Non-Blocking Guarantee

Every step in the map layer pipeline must be non-blocking. The user must be able to pan, zoom, draw, and interact with the canvas at all times — even while tiles are loading, contours are generating, or the rasterized image is being prepared. A loading indicator on the contours layer is acceptable; a frozen app is not.

**Freeze-risk audit — every blocking operation and its mitigation:**

| # | Operation | Risk | Mitigation |
|---|---|---|---|
| 1 | **MapLibre initialization** (WebGL context, shader compile) | 100–300ms sync on first call | Defer to `requestIdleCallback` or first `requestAnimationFrame` after location set. Show "Loading terrain..." placeholder on contours layer immediately. User can keep working on other layers |
| 2 | **DEM tile network fetch** (MapLibre fetching `{z}/{x}/{y}.png` from AWS) | 200ms–5s per tile, network-dependent | MapLibre handles this internally via Web Workers + async fetch. Already non-blocking. The hidden map fires `idle` when done — no main-thread waiting. Show a loading state until `idle` fires |
| 3 | **`maplibre-contour` isolines generation** (CPU-intensive DEM→vector conversion) | 50–200ms per tile, runs in MapLibre's Web Worker | `maplibre-contour` registers a custom protocol that processes DEM tiles inside MapLibre's built-in Web Worker pool. Main thread is not blocked. Verify with profiling — if a tile batch causes jank, consider limiting concurrent DEM protocol requests |
| 4 | **`canvas.toDataURL()` on 2048×2048 MapLibre canvas** | 20–80ms sync, blocks main thread (GPU readback + PNG encode) | **Replace with `createImageBitmap()`**: use `map.getCanvas()` → `createImageBitmap(canvas)` which returns a `Promise<ImageBitmap>` and does the pixel copy off the main thread. `ImageBitmap` can be drawn directly to a Konva `<canvas>` via `drawImage()`. Avoids the PNG encode/decode round-trip entirely |
| 5 | **Konva.Image node creation/update** | < 1ms (just sets a reference) | Not a concern. `new Konva.Image({ image: bitmap })` is synchronous but trivial |
| 6 | **Bulk DEM tile download** (offline caching, ~1,200 tiles) | 30s–5min total, sequential HTTP | Already runs in Rust on Tauri's sync command thread pool — **not** the main thread. Frontend receives progress via `tile-download-progress` events. Add a cancel signal (`tauri::ipc::Channel` or abort flag) so the user can stop a long download. Show progress bar in the bottom panel, keep app fully interactive |
| 7 | **`transformRequest` tile cache lookup** (checking disk for cached tile) | IPC round-trip per tile (5–15ms each) | For asset protocol path: `convertFileSrc()` is a pure string transform (no IPC), so the rewritten URL is instant. For IPC fallback: batch cache-status checks — `get_cached_dem_tile_paths(z, xRange, yRange)` returns a map of `{z/x/y → localPath | null}` in one call, then `transformRequest` reads from that map synchronously. Never do per-tile IPC inside `transformRequest` |
| 8 | **Viewport sync re-render** (debounced MapLibre re-render on pan/zoom) | Combines risks 2+3+4 above | Debounce ensures this never fires during active interaction (300ms idle gate). The overscan buffer means most pans don't trigger a re-render at all. When it does fire, steps 2+3 are Web Worker-async and step 4 uses `createImageBitmap()` — no main-thread freeze |

**Key implementation pattern — the async render pipeline:**

```typescript
// In map-layer.ts — all async, never blocks main thread

async function renderContourTile(): Promise<void> {
  // 1. Update MapLibre view (instant, just sets internal state)
  hiddenMap.setCenter([lon, lat])
  hiddenMap.setZoom(mapZoom)

  // 2. Wait for tiles + contour generation (async — Web Workers)
  await new Promise<void>(resolve => {
    hiddenMap.once('idle', resolve)
  })

  // 3. Rasterize off main thread (async — no GPU readback stall)
  const bitmap = await createImageBitmap(hiddenMap.getCanvas())

  // 4. Apply to Konva (sync but trivial — < 1ms)
  contourImage.image(bitmap)
  contourImage.setAttrs({ /* world-coordinate position */ })

  // 5. Invalidate through reconciler (batched, next rAF)
  reconciler.invalidate('material')
}
```

**Cancellation / epoch guard:**

Multiple location changes or viewport moves can queue up render requests. Use an epoch counter to discard stale renders:

```typescript
let renderEpoch = 0

async function requestRender(): Promise<void> {
  const epoch = ++renderEpoch

  // ... await MapLibre idle ...
  if (epoch !== renderEpoch) return  // stale — newer request superseded this one

  // ... await createImageBitmap ...
  if (epoch !== renderEpoch) return  // stale — discard

  // ... apply to Konva ...
}
```

This prevents pile-up: if the user changes location 3 times quickly, only the last render completes. No wasted work, no race conditions.

**Loading indicator:**

While the async pipeline is in-flight (between location change and `idle` + rasterization complete):
- Show a subtle loading state on the contours layer — e.g., a pulsing border or muted "Loading terrain..." text at the layer's center (Konva.Text node, removed on completion)
- The rest of the canvas remains fully interactive
- If the render fails (network error, WebGL context lost), show a brief toast and leave the contours layer empty — never block or retry in a loop

**Offline download UX:**

The bulk tile download (phase 3) must be:
- Cancellable — abort button in the progress UI, sends cancel signal to Rust
- Resumable — if cancelled or interrupted, the manifest records progress so the next attempt skips already-cached tiles
- Non-modal — progress bar in the bottom panel, not a modal dialog. User continues working while tiles download in the background
- Failure-tolerant — individual tile failures are logged and skipped (already the case in `tiles.rs`). Partial cache is usable — contours render where tiles exist, gaps where they don't

### Location Change → Layer Update Flow

The reactive chain when a user sets or updates location:

```
User confirms location in bottom panel
  → setDesignLocation(lat, lon) in location-actions.ts
    → designLocation signal updates
    → effect() in map-layer runtime module detects change
      → show loading indicator on contours layer (sync, instant)
      → hiddenMap.setCenter/setZoom (sync, instant)
      → await MapLibre 'idle' (async — tiles + contour generation in Web Workers)
      → epoch guard check (discard if stale)
      → await createImageBitmap(hiddenMap.getCanvas()) (async — off main thread)
      → epoch guard check (discard if stale)
      → update Konva.Image on `contours` layer (sync, < 1ms)
      → remove loading indicator
      → reconciler.invalidate('material')
      → layer visibility/opacity apply automatically via existing effects
```

The entire pipeline is async. The user can interact with the canvas at every step. If they change location again before the pipeline completes, the epoch guard discards the stale render.

**No location set**: `contours` layer stays empty. No MapLibre instance created. Zero overhead.

**Location cleared**: destroy MapLibre instance, remove Konva.Image from `contours` layer, `reconciler.invalidate('material')`.

**Location updated** (moved to different coordinates): re-center MapLibre, re-render, replace Konva.Image. Existing canvas objects (plants, zones) stay in their world-coordinate positions — they were placed relative to the old origin. The map tiles shift to show the new terrain. This is correct: the user is saying "this design is actually located *here*" — the terrain should update, but the design layout shouldn't move.

### Layer Display Controls

**Existing infrastructure** (already wired, just needs content on the layers):

| Control | Signal | Location | Status |
|---|---|---|---|
| Contour visibility | `layerVisibility['contours']` | `state/canvas.ts` | Wired, default `false` |
| Contour opacity | `layerOpacity['contours']` | `state/canvas.ts` | Wired, default `1.0` |
| Contour lock | `layerLockState['contours']` | `state/canvas.ts` | Wired, default `false` |
| Contour interval | `Settings.contour_interval` | `common-types/settings.rs` | In schema, unused |
| Hillshade visibility | `Settings.hillshade_visible` | `common-types/settings.rs` | In schema, unused |
| Hillshade opacity | `Settings.hillshade_opacity` | `common-types/settings.rs` | In schema, unused |
| Map layer visibility | `Settings.map_layer_visible` | `common-types/settings.rs` | In schema, unused |
| Map style | `Settings.map_style` | `common-types/settings.rs` | In schema, unused |
| Map opacity | `Settings.map_opacity` | `common-types/settings.rs` | In schema, unused |

**LayerPanel changes**: currently shows 4 layers (annotations, plants, zones, base). Add `contours` to the panel when location is set (conditionally visible — no point showing a contour layer toggle when there's no location). The `climate` layer (raster base map) can be added in phase 3.

**Contour settings surface**: a small settings section (in the layer panel or bottom panel) exposing:
- Contour interval override (adaptive / 5m / 10m / 20m / 50m / 100m)
- Hillshade toggle + opacity slider
- These read/write the existing Settings fields via `persistCurrentSettings()`

### Implementation Phases

**Phase 1 — Hidden MapLibre + contour rendering (P0, offline-capable)**
- Create `desktop/web/src/canvas/runtime/map-layer.ts` runtime module
- Lifecycle: create hidden MapLibre div, configure DEM source + contour layers from `contours.ts`
- Fully async render pipeline: `setCenter/setZoom` → `await idle` → `await createImageBitmap()` → Konva.Image update (see Non-Blocking Guarantee)
- Epoch guard for render cancellation — rapid location changes or viewport moves discard stale renders, only the latest completes
- Loading indicator on contours layer while render is in-flight (Konva.Text, removed on completion)
- React to `designLocation` signal: trigger async render pipeline on change
- React to viewport changes with overscan guard (25% drift threshold) + debounced re-render (300ms idle gate)
- MapLibre init deferred to `requestIdleCallback` — never blocks first paint or interaction
- Wire into `CanvasEngine` teardown for cleanup (destroy MapLibre instance, remove hidden div)
- Add `contours` to `LayerPanel` (conditional on location existence)
- Auto-set `layerVisibility['contours'] = true` when first location is set

**Phase 2 — Hillshade + contour settings**
- Add hillshade layer to the hidden MapLibre instance (from `getHillshadeLayerConfig()`)
- Render hillshade behind contour lines on the same Konva layer
- Wire `contour_interval`, `hillshade_visible`, `hillshade_opacity` settings to MapLibre layer paint properties
- Add contour/hillshade settings UI (small collapsible section in LayerPanel or bottom panel)
- Theme support: re-render on theme change (contour colors differ light/dark per `contours.ts`). Re-render is async — theme toggle is not blocked by map re-render

**Phase 3 — Offline DEM tile caching**
- Add `download_dem_tiles` command to `tiles.rs` (or parameterize existing `download_tiles`)
- Add `desktop/web/src/ipc/tiles.ts` IPC stubs for tile download/status/removal
- Add `transformRequest` to hidden MapLibre: intercept DEM URLs, serve from cache when available
- Batch cache-status check: `get_cached_dem_tile_paths(z, xRange, yRange)` returns a map in one IPC call — never per-tile IPC inside `transformRequest`
- Add "Download terrain for offline use" action in bottom panel location tab
- Download is cancellable (abort signal to Rust), resumable (manifest tracks progress), non-modal (progress bar in bottom panel, app stays interactive)
- Progress UI: reuse existing `tile-download-progress` event pattern
- Scope `$APPDATA/dem-tiles/**` in asset protocol config (pairs with section 10 asset protocol work)

**Phase 4 — Raster base map (P2, online-only initially)**
- Add raster tile layer to hidden MapLibre (OSM or configurable style)
- Rasterize to Konva.Image on the `climate` layer (repurposed)
- Wire `map_layer_visible`, `map_style`, `map_opacity` settings
- Add `climate` layer (renamed to "Map" in UI) to LayerPanel
- Offline raster map support via existing `download_tiles` backend (already downloads OSM tiles)

### Files Changed

| File | Change | Phase |
|---|---|---|
| `desktop/web/src/canvas/runtime/map-layer.ts` | New — hidden MapLibre lifecycle, rasterization, viewport sync | 1 |
| `desktop/web/src/canvas/engine.ts` | Wire map-layer module, teardown, location effect | 1 |
| `desktop/web/src/canvas/contours.ts` | No change — already provides complete config | — |
| `desktop/web/src/canvas/projection.ts` | No change — already provides coordinate bridge | — |
| `desktop/web/src/components/canvas/LayerPanel.tsx` | Add contours/climate to panel (conditional) | 1 |
| `desktop/web/src/state/canvas.ts` | Flip contour default visibility on location set | 1 |
| `desktop/web/src/state/canvas-actions.ts` | Add contour settings actions | 2 |
| `desktop/web/src/ipc/tiles.ts` | New — IPC stubs for tile download/status | 3 |
| `desktop/src/commands/tiles.rs` | Add DEM tile download support | 3 |
| `desktop/src/lib.rs` | Register new tile commands | 3 |
| `desktop/tauri.conf.json` | Extend the existing CSP/asset config with `dem-tiles` scope and `img-src asset: http://asset.localhost` (pairs with S10) | 3 |
| `desktop/capabilities/main-window.json` | Add `dem-tiles` to fs:allow-read scope | 3 |
| `desktop/web/src/i18n/locales/*.json` | Layer names, contour settings labels (11 locales) | 1 |

### Interaction With Other Sections

- **Section 10 (Image Loading Performance)**: Phase 3 tile caching benefits from the same asset protocol enablement. If section 10 lands first, the `assetProtocol` config just needs an additional scope entry for `dem-tiles`. If this lands first, section 10 gets the asset protocol for free
- **Section 9 (Plant Color Assignment)**: Independent — color assignment affects plant circles, map layers affect the terrain backdrop. Both improve canvas readability from different angles
- **Section 9.1 (Plant Label Improvements)**: Contour label text (elevation numbers) occupies a different visual layer and doesn't interact with plant label density suppression (contours are non-listening, plant density only scans the `plants` layer)

### Risk

- **MapLibre WebGL context limits**: browsers typically allow 8–16 WebGL contexts. The hidden MapLibre instance consumes one. If the main canvas or other components also use WebGL, context limits could be hit. Mitigation: create the hidden instance lazily (only when location is set), destroy when not needed
- **Memory**: a 2048×2048 RGBA bitmap is ~16MB. With overscan, the cached image consumes non-trivial memory. Mitigation: reduce hidden container to 1024×1024 on low-memory devices, accept more frequent re-renders
- **Rasterization quality at extreme zoom**: at very high Konva zoom (stageScale > 50), the rasterized image upscales and pixelates. Mitigation: at extreme zoom, the contours are decorative context, not primary information — pixelation is acceptable. Could re-render at higher resolution if needed
- **`preserveDrawingBuffer` performance**: this MapLibre option prevents buffer clearing between frames, slightly reducing rendering performance. Mitigation: the hidden instance only renders on demand (not continuously), so the cost is per-render, not per-frame. Note: `preserveDrawingBuffer` is required for `createImageBitmap()` — without it, the canvas may be cleared before the async bitmap copy completes
- **Theme flicker**: contour colors are baked into the MapLibre style, not CSS vars. On theme toggle, the MapLibre instance must re-render with dark/light colors. Mitigation: listen to `theme` signal, update MapLibre paint properties + re-rasterize asynchronously. The old image stays visible until the new one is ready — no blank flash
- **WebGL context lost**: the browser can reclaim the hidden MapLibre WebGL context under memory pressure. Mitigation: listen for `webglcontextlost` on the hidden canvas, set a `contextLost` flag, and re-create the MapLibre instance on next render request. Never retry in a tight loop — use exponential backoff (1s → 2s → 4s, max 3 retries)
- **Network failure during online tile fetch**: MapLibre fires `error` events for failed tile loads but continues rendering what it has. Contours will show gaps where tiles failed — acceptable degradation. Show a non-blocking toast ("Some terrain tiles failed to load") rather than blocking the render pipeline

### Future Considerations

- **Vector contours on Konva** (alternative to rasterization): instead of rasterizing MapLibre, extract GeoJSON contour lines from `maplibre-contour` directly and draw them as Konva.Line nodes. Better zoom quality, lower memory, but more complex rendering (hundreds of polylines per viewport) and loses hillshade. Evaluate if rasterization quality proves insufficient
- **3D terrain preview**: MapLibre supports `terrain` property for 3D DEM extrusion. Could offer a "3D preview" mode that temporarily shows the hidden MapLibre map in a modal/overlay, letting the user rotate and explore terrain before returning to the 2D canvas
- **Print/export integration**: when PNG/PDF export is rebuilt (deferred), the Konva.Image on the contours layer exports naturally via `stage.toDataURL()`. No special handling needed. For higher-quality print, could re-render MapLibre at print resolution before export

---

## 13. Tauri Platform Hardening (Design Spec)

Findings from a Tauri v2 feature audit (2026-04-01). These items address security gaps, unused attack surface, and IPC performance patterns that should be resolved before or shortly after beta.

### 13.1 Content Security Policy (CSP)

**Status**: landed in the current tree after the 2026-04-01 beta closeout.

`tauri.conf.json` now carries a restrictive CSP:
- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`
- `img-src 'self' blob: data: https:`
- `connect-src ipc: http://ipc.localhost https:`
- `worker-src 'self' blob:`
- `font-src 'self' data:`

**Current external origins used by the app**:
- `connect-src`: Nominatim OSM API (`nominatim.openstreetmap.org`), template downloads (`templates.canopi.app`), species image fetches (various domains)
- `img-src`: Species images from external URLs, base64 data URLs (`data:`), blob URLs (`blob:` for canvas export)
- Future (S10): `asset: http://asset.localhost` when asset protocol is enabled
- Future (S12): OSM tile servers (`*.tile.openstreetmap.org`), AWS DEM tiles (`s3.amazonaws.com`)

**Landed config**:

```json
"csp": {
  "default-src": "'self'",
  "script-src": "'self'",
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' blob: data: https:",
  "connect-src": "ipc: http://ipc.localhost https:",
  "worker-src": "'self' blob:",
  "font-src": "'self' data:"
}
```

Notes:
- `'unsafe-inline'` for `style-src` is required — CSS Modules inject `<style>` tags at runtime
- `img-src https:` is broad but necessary — species images come from many domains (iNaturalist, USDA, Wikimedia, etc.)
- `worker-src blob:` is required for current MapLibre worker usage in the retained surface
- When asset protocol is enabled (S10/S12), add `asset: http://asset.localhost` to `img-src`
- `connect-src https:` covers Nominatim, template server, image downloads, and future tile servers
- Can be tightened to explicit domains later once the full set of image/tile origins is catalogued

**Files changed**: `desktop/tauri.conf.json`

**Current validation**: passed repo gates (`cargo fmt`, `cargo clippy`, `cargo test`, frontend typecheck/tests/build) after landing. A packaged-app smoke rerun is still the right check if a future beta patch promotes this exact config.

**When**: landed in the post-beta hardening patch after Wave 5 closeout.

### 13.2 Remove Unused Shell Plugin

**Status**: landed in the current tree after the 2026-04-01 beta closeout.

The shell plugin has been removed from:
1. `desktop/src/lib.rs`
2. `desktop/Cargo.toml`
3. `desktop/capabilities/main-window.json`
4. `desktop/web/package.json`
5. lockfiles (`Cargo.lock`, `desktop/web/package-lock.json`)

**Risk**: None observed — repo verification passed and no shell API usage remains in the codebase.

**When**: landed in the post-beta hardening patch after Wave 5 closeout.

### 13.3 Binary IPC for Tile Commands

**Problem**: `get_tile` in `commands/tiles.rs` returns `Result<Vec<u8>, String>`. In Tauri v2, `Vec<u8>` returned from commands goes through JSON serialization — a 30KB PNG tile becomes ~120KB of JSON array-of-numbers text. The Tauri v2 docs explicitly recommend `tauri::ipc::Response` for binary data: it bypasses JSON serialization and delivers raw `ArrayBuffer` to JS.

This doesn't matter today (tile commands are unused — map layers deferred to S12). But it will be a performance bottleneck when S12 map layer rendering begins, especially for the offline tile cache serving path where dozens of tiles load per viewport.

**Fix**: When S12 implementation begins, use `tauri::ipc::Response` for tile-returning commands:

```rust
use tauri::ipc::Response;

#[tauri::command]
fn get_tile(app: AppHandle, z: u32, x: u32, y: u32) -> Result<Response, String> {
    let tile_path = tiles_dir(&app)?.join(format!("{z}/{x}/{y}.png"));
    let bytes = std::fs::read(&tile_path)
        .map_err(|e| format!("Tile {z}/{x}/{y} not found: {e}"))?;
    Ok(Response::new(bytes))
}
```

Frontend receives `ArrayBuffer` directly — use `new Blob([arrayBuffer], { type: 'image/png' })` → `URL.createObjectURL(blob)` for image sources.

Similarly, `read_file_bytes` in `commands/export.rs` returns `(Vec<u8>, String)` where the bytes portion is JSON-serialized. If this command handles large files (background images can be multi-MB), consider splitting into a path-returning command + asset protocol, same as S10.

**The `desktop/CLAUDE.md` already documents the `tauri::ipc::Response` pattern** (Tauri v2 Gotchas → Optimized binary IPC). The current code just doesn't use it yet because the tile commands are inactive.

**When**: Implement alongside S12 (map layers) when tile commands become active. Also consider for `read_file_bytes` if background image import performance is an issue.

### 13.4 Auto-Updater

**Problem**: No update mechanism. Users must manually download new versions from GitHub Releases. For a beta app with active development, this creates friction — users stay on stale versions, bug reports become harder to triage.

Tauri v2 provides `tauri-plugin-updater` with:
- Mandatory code signing (prevents tampered updates)
- Built-in GitHub Releases endpoint (no custom server needed)
- Background update checks with user notification
- Platform-specific update mechanisms (Windows NSIS, macOS DMG, Linux AppImage)
- Configurable check interval and user-facing UI

**Scope**: Post-beta. Requires:
- Code signing infrastructure (Apple Developer ID, Windows Authenticode, Linux GPG)
- Update manifest published alongside GitHub Releases (`latest.json`)
- Frontend UX: update-available banner, manual "Check for updates" in settings, download progress
- Decision: auto-install vs. notify-only (recommend notify-only for beta)

**Files changed** (when implemented):
- `desktop/Cargo.toml` — add `tauri-plugin-updater`
- `desktop/src/lib.rs` — init updater plugin
- `desktop/capabilities/main-window.json` — add updater permissions
- `desktop/web/src/components/` — update notification UI
- CI workflows — signing steps, manifest generation

**When**: Post-beta roadmap. Not a beta blocker — the manual download flow via GitHub Releases works for initial beta testers. Becomes important once the user base grows beyond early adopters.

### 13.5 Mutex Poison Recovery Logging

**Status**: landed in the current tree after the 2026-04-01 beta closeout.

Previous pattern:
```rust
let conn = db.0.lock().unwrap_or_else(|e| e.into_inner());
```

Landed fix:

```rust
// In desktop/src/db/mod.rs or a shared util
pub fn acquire<T>(mutex: &std::sync::Mutex<T>, name: &str) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| {
        tracing::warn!("Recovered poisoned {name} lock — a prior command panicked while holding this lock");
        e.into_inner()
    })
}
```

Call sites now use the helper instead of inlining poison recovery:
```rust
// Before
let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
// After
let conn = acquire(&user_db.0, "UserDb");
```

**Files changed**: `desktop/src/db/mod.rs`, plus `desktop/src/commands/favorites.rs`, `species.rs`, `settings.rs`, `design.rs`, `health.rs`, and `adaptation.rs`

**Risk**: None — behavior is unchanged (still recovers from poison). Just adds observability. The helper also reduces boilerplate at each call site.

**When**: landed in the post-beta hardening patch after Wave 5 closeout.

### Implementation Priority

| # | Item | Impact | Effort | When |
|---|------|--------|--------|------|
| 13.2 | Remove shell plugin | Security (attack surface) | Done | Landed post-beta |
| 13.5 | Poison lock logging | Observability | Done | Landed post-beta |
| 13.1 | Enable CSP | Security (XSS defense) | Done | Landed post-beta |
| 13.3 | Binary IPC for tiles | Performance | 30 min | With S12 |
| 13.4 | Auto-updater | Distribution | Days | Post-beta |

Items 13.2, 13.5, and 13.1 are already landed in the current tree. Items 13.3 and 13.4 remain deferred to their natural implementation moments.

### Interaction With Other Sections

- **Section 10 (Image Loading Performance)**: S10 enables the asset protocol for image cache. When CSP (13.1) is later enabled, `img-src` must include `asset: http://asset.localhost`. The S10 spec already notes this.
- **Section 12 (Map Layers)**: S12 phase 3 needs the same asset protocol for DEM tile cache. Binary IPC (13.3) is the fallback if asset protocol isn't available. S12 already documents both paths.
- **Post-beta hardening**: Items 13.1, 13.2, and 13.5 are now landed and should stay landed on future beta patches unless there is an explicit reason to reopen those decisions.

---

## 14. Final Instruction

Use this file as the canonical operational reference.

Use archived docs only for historical context.

With retained-surface Wave 3 closeout landed on 2026-03-30, the live verification rerun completed with Claude Code, the renderer stability gate closed, Wave 4 design coherence landed on 2026-03-31, and Wave 5 beta hardening closed on 2026-04-01, the current operating rule is:
- use `docs/release-verification.md`
- treat Wave 5 as complete unless a new beta-blocking defect reopens release hardening
- Tauri platform hardening items 13.1 (CSP), 13.2 (shell removal), 13.5 (poison logging) are already landed and should be preserved in future beta patches
- remove any stale scope language if the surviving beta-release surface changes again

If a future change affects:
- remaining wave order
- blocker definitions
- ownership rules
- or beta-release scope

update this file directly and archive the completed detail that was removed from the active path.
