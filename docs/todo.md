# Canopi Rewrite Operational Reference

**Date**: 2026-03-31  
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

Still active:
- Wave 5 packaged-app smoke verification and beta-release closeout

Deferred after live review:
- featured-design world map / template import
- timeline workflows
- budget workflows
- consortium flows

Wave 5 is now a beta-release hardening wave on the surviving architecture. It does not claim that the broader product roadmap is complete.

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
- the next active rewrite step is now Wave 5 packaged-app smoke verification and beta-release closeout

### 3.3 Wave 5 Beta Release Hardening

What is left:
- beta-release checklist and docs cleanup
- supported-platform packaged-app smoke verification
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
- the remaining Wave 5 work is packaged-app smoke verification plus beta-release docs cleanup and evidence capture

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
- the only remaining active rewrite wave is Wave 5 beta release hardening

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
- any beta-release claim that lacks supported-platform packaged-app smoke evidence

Now unblocked after renderer stability closeout:
- Wave 4 design coherence
- renderer-tied product-level visual redesigns:
  - plant color assignment (see section 9)
  - plant label improvements (see section 9.1)
- `loadSpeciesCache` extraction from `engine.ts`

Can be fixed independently if needed:
- `ExternalInputDeps.getEngine` narrowing
- tooltip DOM extraction from `engine.ts`
- resource ownership cleanup in rulers, text tool, and `WorldMapSurface`
- deferred-pass data-shape cleanup in renderer internals

Still deferred beyond Wave 5 beta:
- plant color assignment (see section 9)
- image loading performance — asset protocol migration (see section 10)
- detail-card photo fit polish
- map layers
- world map with featured designs / template import
- timeline workflows
- budget workflows
- consortium flows
- geo / terrain workflows
- export workflows
- knowledge / learning surfaces

---

## 8. Beta-Release Core Journeys

Wave 5 beta is not ready until these journeys pass end to end on the packaged app:

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

## 9. Plant Color Assignment (Design Spec)

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

2. **User color override** (the main feature): right-click a placed plant to assign a color from a curated palette. Stored per-instance in the document. Options:
   - "Set color" — applies to the clicked plant instance
   - "Set color for all [species]" — bulk-applies to every instance of that species in the document (stored per-instance, but applied in batch)
   - "Clear color" — removes override, reverts to default green
   - When `flower_color` data exists, the picker pre-selects the matching palette color as a suggestion

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

Plus a custom hex input for users who need exact colors.

Palette layout in the context menu picker: 4 columns x 3 rows, matching the numbered order (left-to-right, top-to-bottom). Below the grid: a custom color input row.

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
```

**Konva attr**: `data-color-override` on plant groups. Read by `getStratumColor()` replacement logic.

**Serialization**: `color` field round-trips through `.canopi` file save/load. `null` omitted from JSON via `#[serde(skip_serializing_if = "Option::is_none")]`.

### Implementation Phases

**Phase 1 — Data model + rendering**
- Add `color` field to `PlacedPlant` (Rust + TS)
- Update `createPlantNode()` to use `color` override when present, fallback to current stratum logic
- Update serializer to persist/restore the field
- Update `updatePlantDisplay()` to respect overrides in default mode

**Phase 2 — Context menu + picker**
- Right-click context menu on plant groups (new UI surface)
- Color picker: 4x3 palette grid + custom hex input
- "Set color" / "Set color for all [species]" / "Clear color" actions
- Flower color suggestion (pre-select in picker when DB has data)
- Undo/redo support via new `SetPlantColorCommand`

**Phase 3 — Flower color display mode**
- Add `'flower'` to `ColorByAttribute` type
- Implement `flower_color` text-to-hex mapping
- Add genus/family inference lookup (can be computed at species cache load time)
- Add legend entries for the flower color mode
- Add "Flower" option to display mode dropdown + i18n keys

### Architecture Notes

- Context menu is a new canvas UI surface — use HTML overlay (like plant tooltip), not Konva nodes
- `SetPlantColorCommand` is a new undo/redo command; follows existing `Command` interface pattern
- Flower color inference (genus/family propagation) should be computed once at species cache load, not per-render
- The `color` field on `PlacedPlant` is purely a document-level override — it does not modify the species DB
- Phase 2 context menu must not conflict with select tool drag — only trigger on right-click (`contextmenu` event), never on left-click

### 9.1 Plant Label Improvements (Design Spec)

Companion to section 9 — the plant color system changes what labels need to communicate. These improvements assume color assignment is landed (section 9 phase 1+2).

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

## 11. Final Instruction

Use this file as the canonical operational reference.

Use archived docs only for historical context.

With retained-surface Wave 3 closeout landed on 2026-03-30, the live verification rerun completed with Claude Code, the renderer stability gate closed, and Wave 4 design coherence landed on 2026-03-31, the next required step is Wave 5 beta release hardening on the surviving architecture:
- use `docs/release-verification.md`
- keep the work narrow to packaged-app smoke verification and beta-release closeout
- remove any stale scope language if the surviving beta-release surface changes again

If a future change affects:
- remaining wave order
- blocker definitions
- ownership rules
- or beta-release scope

update this file directly and archive the completed detail that was removed from the active path.
