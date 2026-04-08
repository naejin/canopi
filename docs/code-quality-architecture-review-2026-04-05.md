# Code Quality And Architecture Review

Date: 2026-04-05
Revised: 2026-04-05 (incorporates cross-review feedback from two independent agents)
Updated: 2026-04-08 (post-bottom-panel MVP architecture pass; documents resolved and remaining convergence work)

Purpose: give the next implementation agent an unbiased, actionable review of the current codebase and a converged direction for improving it.

This review is based on the current repository state, representative code inspection across Rust and frontend modules, and a fresh local verification pass:

- `npm test --prefix desktop/web` passed: 45 files, 203 tests
- `cargo test --workspace` passed across the Rust workspace

That lowers immediate regression risk, but it does not remove the structural issues described below.

## 2026-04-08 Follow-Up Status

A later review of the live code found that several original risks have been reduced:

- **Finding 1 is substantially resolved.** Canvas scene state is owned by `SceneStore`; non-canvas document state is owned by `currentDesign` / document actions; `SceneCanvasRuntime.serializeDocument()` composes canvas output with document-owned `consortiums`, `timeline`, `budget`, and `budget_currency`. The old `currentConsortiums` and `designLocation` mirrors are gone.
- **Finding 2 remains the main blocker before panel/map sync expansion.** Consortiums now use `canonical_name`, but timeline and budget still rely on ambiguous strings (`TimelineAction.plants`, `TimelineAction.zone`, and budget `category + description` matching).
- **Finding 4 remains open.** `CanvasSession` is still a mostly pass-through facade even though `CanvasRuntime` already exists.
- **Finding 7 is partially addressed.** Rust has an ad hoc legacy consortium migration in `desktop/src/design/format.rs`, but there is still no version-dispatched migration boundary for future breaking file-format changes.
- **Finding 8 was partly stale.** `maplibre-gl` is used by `LocationTab` and `WorldMapSurface`, and Vite has a `maplibre-gl` manual chunk. Do not remove MapLibre as a dead dependency. `suncalc` still appears unused.

Practical recommendation as of 2026-04-08: do not run a broad architecture rewrite before `docs/todo.md`. Do a narrow convergence pass for panel identity semantics and the `CanvasSession` seam before expanding panel-to-canvas, canvas-to-chart, or map overlay synchronization.

## Executive Summary

The project has a good top-level product architecture:

- Rust owns persistence, SQLite, file I/O, and platform integration
- the read-only plant DB and writable user DB are correctly separated
- the canvas is treated as an imperative subsystem instead of a declarative tree
- tests are materially better than average for a Tauri desktop app
- the CLAUDE.md architecture rules (document mutation, action-layer isolation, resource ownership) are unusually explicit and well-enforced

The main remaining weaknesses are in the frontend architecture:

- entity identity semantics are inconsistent across panels — **core risk, fix before panel/map sync expansion**
- `CanvasSession` duplicates an already-existing runtime interface — **moderate risk, fix before growing runtime API**
- the file-format contract is fragile and under-tested — **moderate risk, address before schema changes**
- the canvas runtime is broad — **maintainability concern, refactor incrementally**
- lifecycle ownership is implicit in places — **low priority, refactor opportunistically**

### Severity tiers

The findings below are organized by urgency:

- **Core risks** (Finding 2; Finding 1 historically): Structural issues that block panel/map sync if pursued. Finding 1 is now mostly resolved; Finding 2 remains.
- **Moderate risks** (Findings 3–4 and 7): Real issues that can be addressed incrementally, but before schema or runtime API expansion where relevant.
- **Low priority** (Finding 5): Maintainability concerns. Refactor opportunistically, not as prerequisites.

## Target Direction

The likely near-term direction is:

- add in-canvas map layers using MapLibre
- reactivate the bottom-panel timeline, budget, and consortium surfaces
- keep those panels synchronized with the actual canvas scene
- let panel selections influence canvas presentation and, in some cases, map overlays

**That direction is roadmap-contingent.** The findings below are labeled by whether they matter today regardless of direction, or only become urgent if that specific roadmap is pursued.

---

# Core Risks

## Finding 1: Document Authority Is Split Across Multiple Stores

**Severity as of 2026-04-08: mostly resolved — keep as historical context and guardrail**

The original finding below described a real risk at the time of the April 5 review. The live code now has an explicit authority split:

- canvas scene fields (`plants`, `zones`, `annotations`, `groups`, `layers`, `plant_species_colors`) are scene-store owned
- non-canvas document fields (`consortiums`, `timeline`, `budget`, `budget_currency`, `location`, `description`, `extra`) are document-store owned
- `serializeDocument()` composes those authorities rather than pushing non-canvas state into `SceneStore`

Do not do a broad document-store rewrite just to satisfy this old finding. The remaining risk is drift: future work must avoid reintroducing ad hoc mirrors or making MapLibre/panels into second document authorities.

### Original finding

### What is wrong

The codebase currently has several overlapping "authorities" for document data:

- `currentDesign` in `desktop/web/src/state/design.ts` — holds the full `CanopiFile`
- persisted document state inside `SceneStore` — holds the same data in a different shape (camelCase scene entities)
- canvas mirrors like `currentConsortiums` and `designLocation` in `desktop/web/src/state/canvas.ts` — explicit copies with comments saying "mirror of currentDesign"
- synchronization glue in:
  - `desktop/web/src/state/document.ts`
  - `desktop/web/src/state/document-mutations.ts`
  - `desktop/web/src/canvas/runtime/scene-runtime/scene-sync.ts`

This is better than the earlier destructive serializer path, but it is still a split-brain design.

### Concrete evidence: the save-time merge seam

The split-brain is most visible in `SceneCanvasRuntime.serializeDocument()` at `desktop/web/src/canvas/runtime/scene-runtime.ts:599-655`. This method must reconstruct a complete document by **merging data from two authorities**:

- Plants, zones, annotations, groups, and plant-species-colors come from `SceneStore` (the canvas authority)
- Consortiums, timeline, and budget are pulled back from the `doc` parameter (the `currentDesign` signal — the non-canvas authority)
- Location, description, and `created_at` fall through a chain of `doc ?? persisted` fallbacks

Timeline edits go through `mutateCurrentDesign()` (modifying the `currentDesign` signal directly). Plant/zone edits go through `SceneStore`. The two never see each other until this merge at save time. If any future path adds real-time panel↔canvas sync, this merge seam becomes the primary bug surface.

### Why this matters more now (roadmap-contingent)

The planned work raises the pressure on this boundary:

- MapLibre canvas layers will need location, viewport, and layer settings
- timeline, budget, and consortium panels need to reflect actual canvas entities
- panel edits should update the canvas immediately
- canvas edits should update panel-derived aggregates immediately

That is exactly the kind of feature growth that turns document mirroring into a bug factory.

### Improvement path

1. Converge on one canonical design model.
2. Recommended: create an app-scoped document store that owns the whole `.canopi` model and survives route/runtime teardown.
3. Make `SceneStore` a scene projection plus session model:
   - scene graph
   - selection
   - viewport
   - history
   - interaction state
   - presentation state
4. Stop storing non-scene document sections in multiple places unless the canvas truly needs them for rendering.
5. Replace manual mirrors like `currentConsortiums` and `designLocation` with selectors/derived views where feasible.
6. If a mirrored bridge remains necessary, centralize it in one adapter with explicit ownership rules.
7. Document the boundary clearly:
   - document store owns persistence truth
   - canvas runtime owns scene execution truth
   - bridge translates between them

### Acceptance criteria

- There is a documented answer to "what is the source of truth for this field?" — **met in root `CLAUDE.md` Document Authority Rule**
- Location, consortiums, timeline, and budget do not require ad hoc mirroring to stay in sync — **mostly met; consortium sync is an explicit document workflow**
- Saving no longer depends on reconstructing non-canvas document sections from `SceneStore` — **met; save composes scene output with document-owned sections**

## Finding 2: Panel-To-Canvas Identity Semantics Are Inconsistent

**Severity as of 2026-04-08: core risk — blocks full panel-to-canvas, canvas-to-chart, and map overlay synchronization**

### What is wrong

The three panel subsystems still use different identity schemes for referencing design content:

- **Consortiums** now use `canonical_name` (`Consortium` in `desktop/web/src/types/design.ts`) and `consortium-sync-workflow.ts` auto-adds species entries from placed plants. This is an improvement over the old placed-plant-ID shape, but it should still be encoded as an explicit species target before general sync work.
- **Timeline** stores `plants: string[] | null` and `zone: string | null` (`TimelineAction` in `desktop/web/src/types/design.ts`) without saying whether plant strings are placed-plant IDs or canonical species names. New manual actions in `TimelineTab` currently use `plants: null` / `zone: null`.
- **Budget** pricing matches by `category === 'plants' && description === canonicalName` in `desktop/web/src/state/budget-actions.ts`. That makes a display field double as an identity key.

Those are different concepts:
- stable placed-plant IDs (unique per placement)
- canonical species names (shared across all placements of a species)
- zone names / IDs
- view-derived species aggregates (computed at display time)
- manual rows/tasks with no scene target

They should not be treated as interchangeable references.

### Why this matters more now (roadmap-contingent)

If the app is going to support:

- bottom-panel timeline with canvas highlighting
- bottom-panel budget with canvas highlighting
- bottom-panel consortium with canvas highlighting
- MapLibre overlays driven by panel selection

then the project must define what a panel row actually refers to.

Examples:

- Does a timeline action target one placed plant, all placed plants of a species, a zone, or a freeform task?
- Does a budget row refer to a species aggregate, a specific placement, a zone, or a non-canvas expense?
- Does selecting a consortium row highlight exact plant instances on canvas and on the map?
- If a panel references a plant and that plant is deleted, what is the repair behavior?

Without clear target semantics, sync logic will become stringly typed and brittle.

### Improvement path

1. Define target identity semantics before expanding the UI.
2. Recommended: use explicit target types rather than overloading string arrays or descriptions.

Example direction:

- shared target union:
  - `placed_plant` with a placed plant ID
  - `species` with a canonical name
  - `zone` with a zone name / stable zone ID
  - `manual` / `none` with no scene target
- timeline actions target:
  - one or more placed plants
  - a species aggregate
  - a zone
  - a manual task with no scene target
- budget items target:
  - a species aggregate
  - one placed plant
  - a zone
  - a manual line item
- consortiums remain species-targeted for the current succession chart unless product requirements demand per-placement succession

3. Make the schema express those semantics directly instead of relying on interpretation.
4. Build selectors that translate document targets into:
   - canvas highlights
   - map overlay highlights
   - panel counts and summaries
5. Add deletion/migration rules:
   - orphaned references
   - duplicate species placements
   - legacy timeline `plants` arrays
   - legacy budget `category + description` plant rows
   - legacy canonical-name consortium records

### Acceptance criteria

- Every panel row has explicit identity semantics
- Panel selection can highlight the correct canvas entities deterministically
- MapLibre overlays can be driven from the same targets without inventing a second mapping layer

---

# Moderate Risks

## Finding 3: The File-Format Contract Is Fragile

**Severity: moderate — the round-trip works today, but the contract is under-tested and easy to break**

### What is wrong

Rust preserves unknown fields as top-level flattened keys via `#[serde(flatten)]` on `extra: HashMap<String, Value>` in `common-types/src/design.rs`.

The frontend separates unknown keys from known keys in `desktop/web/src/state/document-extra.ts` using a hardcoded `KNOWN_CANOPI_KEYS` set. The scene codec stores them as `extra: Record<string, unknown>` on `ScenePersistedState`.

The round-trip works: TS writes `extra` as a nested key → Rust's `#[serde(flatten)]` absorbs unknown keys on deserialize and emits them at the top level on serialize → TS's `extractExtra()` captures them again.

However, the contract is fragile:

- If a new known key is added to the Rust struct but not to `KNOWN_CANOPI_KEYS`, it silently gets swallowed into `extra` on the frontend side
- There is no integration test that verifies a real save/load round trip with unknown fields
- The two representations (flat in JSON, nested in scene state) are a source of confusion even though they currently interoperate correctly

### Why this was previously overstated

The original version of this review characterized this as "two different mental models for the same file-format contract." That was too strong. It is one model with a serde asymmetry that happens to work. The real issue is narrower: contract fragility plus missing integration coverage.

### Improvement path

1. Add a real Rust → frontend → Rust round-trip test with unknown top-level fields.
2. Add schema-compat regression fixtures that include:
   - unknown top-level keys
   - maximum-populated timeline/budget/consortium/location data
3. Consider generating `KNOWN_CANOPI_KEYS` from the Rust struct fields (or a shared schema) instead of maintaining it by hand.
4. If automated type generation remains blocked, add a validation test that compares the TS mirrors against a machine-readable Rust export during CI.

### Acceptance criteria

- Unknown top-level fields survive a real save/load round trip (tested)
- Adding a new known field to Rust has a clear, documented step for the TS side
- The next agent can add map-related or panel-related saved fields without guessing how they serialize

## Finding 4: `CanvasSession` Is a Zero-Value Pass-Through Facade

**Severity: moderate — 200 lines of pure boilerplate that taxes every runtime change**

### What is wrong

`desktop/web/src/canvas/session.ts` defines `CanvasSession` with ~40 methods. Every single one is a one-liner delegation to `_runtime`:

```ts
zoomIn(): void { this._runtime.zoomIn() }
zoomOut(): void { this._runtime.zoomOut() }
copy(): void { this._runtime.copy() }
// ... 37 more identical pass-throughs
```

The class adds zero logic, zero validation, zero transformation. If the intent is to decouple app code from the runtime implementation, a TypeScript interface would achieve the same at zero runtime cost and zero maintenance overhead.

As a class, it's a maintenance tax: every new runtime method requires a parallel update in the session. Every rename requires two edits. It's the most straightforward code quality issue in the frontend.

### Improvement path

1. Replace `CanvasSession` with a `CanvasRuntime` interface that `SceneCanvasRuntime` implements directly.
2. Or, if the session layer should add real value (input validation, logging, error boundaries), add that logic. A pass-through with no logic should not exist as a class.

---

# Low Priority

## Finding 5: `SceneCanvasRuntime` Breadth and Lifecycle Implicitness

**Severity: low — maintainability concerns, not demonstrated defects. Refactor incrementally.**

### Runtime breadth

`desktop/web/src/canvas/runtime/scene-runtime.ts` is 1,043 lines with ~50 public methods. It coordinates rendering, interaction, history, clipboard, serialization, cache hydration, selection, guide/layer sync, invalidation, and signal sync.

The CLAUDE.md already identifies it as a hotspot file. The class is well-decomposed internally — it delegates to `SceneStore`, `CameraController`, `SceneInteractionController`, `RendererHost`, etc. It is a coordinator, not a monolith. But coordinators that grow to 1,000+ lines tend to accumulate more responsibility over time.

If MapLibre canvas layers are added, a `MapLibreController` can be introduced as a sibling to the runtime without decomposing the runtime first. Runtime decomposition is not a prerequisite for that work.

### Lifecycle implicitness

Several frontend behaviors are initialized at module scope:

- app bootstrap and settings hydration in `desktop/web/src/app.tsx`
- close guard registration in `desktop/web/src/app.tsx`
- plant DB controller lifecycle in `desktop/web/src/state/plant-db.ts`

This is workable for the current app size (single window, no routing). Moving these into hooks (`useCloseGuard`, `usePlantDbController`) would improve readability but does not change the ownership model. Address opportunistically when touching these files.

### Improvement path (incremental)

- When adding MapLibre: create a dedicated `MapLibreController` as a sibling, not a runtime sub-component
- When runtime methods exceed ~60: consider extracting a document-adapter or selection-coordinator
- When touching bootstrap code: consider moving to explicit lifecycle hooks
- Do not block feature work on these refactors

---

# Additional Findings

These were identified during cross-review and should be tracked alongside the primary findings.

## Finding 6: Command System Uses JSON.stringify for Diffing and Cloning

**Severity: moderate — works correctly but scales poorly**

`desktop/web/src/canvas/runtime/scene-commands.ts` uses `JSON.stringify` for equality comparison (`stableStringify`) and `JSON.parse(JSON.stringify())` for deep cloning (`cloneValue`). This means every command capture serializes the entire persisted state twice (before + after).

For a design with hundreds of plants, this creates measurable garbage pressure. It also silently drops `undefined` values and cannot handle special types. `structuredClone` would be more correct; a targeted per-collection diff would be faster.

## Finding 7: No Data Migration Path

**Severity as of 2026-04-08: moderate — partially addressed, still needed before the next breaking schema change**

`ScenePersistedState` has a `version` field, but no generalized frontend migration path reads it for migration. Rust now has an ad hoc `migrate_legacy_consortiums()` call in `desktop/src/design/format.rs`, which proves the load path can host migrations, but the code still needs an explicit version-dispatched boundary.

Before the next schema change: add a `migrate_design_value(value: serde_json::Value) -> serde_json::Value` / `migrateDocument(file: CanopiFile): CanopiFile` step in the load path that dispatches on `version`. Move the legacy consortium migration behind that boundary so new migrations do not become scattered one-off functions.

## Finding 8: Dead Dependencies / MapLibre Status

**Severity: low — no functional impact, minor bundle/install bloat**

The original finding said `maplibre-gl`, `maplibre-contour`, and `suncalc` were all dead after pruning. That is now stale:

- `maplibre-gl` is live: `LocationTab` imports it directly, and `WorldMapPanel` dynamically imports `WorldMapSurface`, which also imports it.
- `vite.config.ts` already has a `maplibre-gl` manual chunk; verify production output before changing imports.
- `maplibre-contour` has support code in `canvas/contours.ts` and should be kept if contour/hillshade work is near-term; otherwise it can be deferred separately from MapLibre core.
- `suncalc` still appears unused by live code and can be removed if `rg "suncalc"` only finds docs/package metadata.

---

## Secondary Observations

- The Rust side is generally stronger architecturally than the frontend side.
- The storage split between plant DB and user DB is a strength and should remain.
- The test suite is a real asset and should be extended with contract/integration tests rather than replaced with more unit-only coverage.
- The project should resist adding more "just mirror this signal" fixes. That pattern is already near its limit.
- The existing CLAUDE.md architecture rules (document mutation rule, action-layer rule, resource ownership rule) are well-enforced and should be maintained. The issues in this review exist within those guardrails, not because of their absence.

## Recommended Order Of Work

### If pursuing MapLibre + panel activation:

1. Define stable identity semantics for timeline/budget/consortium references (Finding 2). Do this before full panel-to-canvas highlighting, canvas-to-chart hover, or map overlay selection.
2. Replace or split `CanvasSession` before adding more runtime API surface (Finding 4).
3. Add round-trip integration tests for the file-format contract (Finding 3).
4. Add a versioned migration boundary before changing the `.canopi` schema for target identities (Finding 7).
5. Add in-canvas MapLibre layers as a derived visualization with a dedicated `MapLibreController`.
6. Keep the document authority boundary from Finding 1 intact; do not push non-canvas state into `SceneStore` or MapLibre.
7. Address runtime breadth and lifecycle incrementally.

### If pursuing other work (search improvements, export, polish):

1. Add round-trip integration tests for the file-format contract (Finding 3).
2. Replace CanvasSession pass-through with an interface (Finding 4).
3. Add a document migration path before the next schema change (Finding 7).
4. Remove `suncalc` if still unused; do not remove `maplibre-gl` while `LocationTab` / `WorldMapSurface` are live (Finding 8).
5. Defer Findings 1 and 2 until panel/map work begins.

## Concrete Non-Goals

The next agent should avoid:

- pushing more document truth into ad hoc canvas signals
- making MapLibre a peer source of object state
- adding new panel features before target identity semantics are defined
- treating passing tests as proof that the architecture is already converged
- blocking all feature work on prerequisite refactoring — tier the urgency

## Closing Assessment

This is a well-built codebase with strong product direction, a sensible Rust backend, explicit architecture guardrails, and enough tests to support careful refactoring.

The current risk is not "low quality code everywhere." As of the 2026-04-08 follow-up, the highest risk is concentrated in:

1. **Inconsistent identity semantics** — panel subsystems still use ambiguous strings and descriptions for targets
2. **Runtime API seam drift** — `CanvasSession` duplicates `CanvasRuntime` and will tax every new runtime method
3. **File-format compatibility** — round-trip and migration coverage must land before schema changes

Those are fixable, and identity semantics are the prerequisite for robust panel/map expansion. Everything else can be addressed incrementally.
