# Canopi Architecture Review

Date: 2026-03-24

Reviewer: Codex

## Scope

This review is based on:

- `docs/plans/architecture-draft.md`
- `docs/plans/phase-0-scaffold.md`
- `docs/plans/phase-1-plant-database.md`
- `docs/plans/phase-2-design-canvas.md`
- the current implementation in `desktop/`, `desktop/web/`, `common-types/`, and `scripts/prepare-db.py`
- follow-up verification in `docs/reviews/2026-03-24-architecture-review-analysis.md`

The plan documents were useful context, but they are not treated here as constraints. The standard for this review is:

- does the architecture serve Canopi as an offline-first desktop application
- does it protect user data and file integrity
- does it support a large local plant database and a serious canvas workflow
- does it give future implementation work clear ownership boundaries

This document is intentionally detailed and roadmap-oriented. If a fact changes priority, affects correctness, or constrains future implementation, it is included.

## Executive Summary

Canopi has the right broad runtime shape:

- Rust owns persistence, SQLite, startup, and file I/O
- the frontend is a shell and state orchestration layer
- the canvas is correctly treated as an imperative subsystem
- the read-only plant DB and writable user DB are separated for the right reasons

That broad shape should be preserved.

The immediate problem is data integrity at the document boundary.

The current save/autosave composition path is actively destructive:

- `timeline` is lost on save
- `budget` is lost on save
- `consortiums` are lost on save
- `created_at` is overwritten on save
- `description` is lost on save
- `location` is lost on save
- unknown `extra` fields are lost through the TypeScript serialization path
- schema-level per-object fields are also stripped for loaded/future files:
  - `PlacedPlant.notes`
  - `PlacedPlant.planted_date`
  - `PlacedPlant.quantity`
  - `Zone.notes`
- schema-level layer state is also not preserved fully:
  - `Layer.locked`

This is not a future risk. It is a current defect in the document lifecycle.

The central conclusion is:

- keep the broad app architecture
- fix document composition first
- make document ownership explicit immediately after
- then fix dirty/autosave/startup semantics around that corrected core

## What Is Working Well

### 1. The top-level application split is correct

The current high-level split is appropriate:

- Rust for persistence, startup, file I/O, and DB concerns
- Preact for shell UI and interaction flow
- Konva isolated inside an imperative engine

This is the right shape for an offline-first desktop design tool. I would keep it.

### 2. The storage split is strong

The separation between:

- read-only `PlantDb`
- writable `UserDb`

is one of the strongest parts of the architecture.

Why it is good:

- static plant data and mutable user data have different lifecycles
- indexing and packaging concerns are distinct from user preference persistence
- failure modes are easier to reason about
- the concurrency model remains simple for a desktop app

This should remain the storage model.

### 3. The imperative canvas direction is correct

`CanvasEngine` is the right architectural choice. Canopi should not model Konva as a declarative component tree.

What is good already:

- tool objects
- engine-owned layers
- command/history concept
- Preact controls around the engine rather than through it

This should remain the canvas direction.

### 4. The backend already has meaningful verification

`cargo test --workspace` currently passes with 45 tests.

That means the codebase already has coverage for:

- query builder behavior
- DB helpers
- recent files
- Rust-side design-format round-tripping
- autosave helper functions

The missing part is end-to-end document lifecycle testing through the actual frontend/backend path.

## Priority Model

This review separates:

- active correctness defects
- structural issues that will regenerate defects
- medium-priority integration work
- items that should be deferred until surrounding complexity justifies them

### Critical

- stop destructive save/autosave composition
- preserve document metadata and unknown fields during round-trip
- stop the current TypeScript composition path from destroying document sections

These are active integrity defects and outrank all other work.

### High

- establish one canonical in-memory document owner
- fix dirty-state correctness across canvas and non-canvas edits
- surface plant DB degraded startup explicitly

These are structural issues that will keep generating bugs if left ambiguous.

### Medium

- autosave semantics and failure visibility
- settings bootstrap and runtime authority
- file-format compatibility tests across the real Rust -> TS -> Rust path
- targeted review of canvas history correctness and memory profile
- frontend state-shape hardening around mutable containers

### Deferred

- service-layer introduction
- full logging taxonomy
- native platform boundary design
- generated shared contracts if current tooling remains unstable

## Complete Data-Loss Inventory

It is important to distinguish the current loss cases by user impact. They share a root cause, but not the same urgency.

### Category 1: active user-facing data destruction

These fields can be edited in the current UI and are lost on save now:

- `timeline`
- `budget`
- `consortiums`

This is the stop-the-world defect category.

### Category 2: file-integrity and forward-compatibility loss

These are not all directly editable in the current UI, but losing them still breaks the file contract:

- `created_at`
- `description`
- `location`
- unknown `extra` fields from future versions or manual edits

This category matters because it breaks no-op save fidelity and forward compatibility.

### Category 3: schema fields currently not represented in the canvas runtime

These fields exist in the schema and can be loaded from files, but are not preserved when the engine is reserialized:

- `PlacedPlant.notes`
- `PlacedPlant.planted_date`
- `PlacedPlant.quantity`
- `Zone.notes`
- `Layer.locked`

These are not currently exposed through the UI, so they are not the highest user-facing emergency. But they are part of the same broken composition class and should be fixed in the same pass if feasible.

## Core Finding: The Save Composition Path Is Broken

The most important finding in the codebase is this:

`desktop/web/src/canvas/serializer.ts` is the composition point for `CanopiFile`, and it is currently assembling an incomplete document.

Current `toCanopi()` behavior:

- reads plants from `CanvasEngine`
- reads zones from `CanvasEngine`
- reads layer visibility/opacities from signals
- reconstructs a small metadata subset from a narrow metadata parameter
- hardcodes:
  - `consortiums: []`
  - `timeline: []`
  - `budget: []`
- regenerates:
  - `created_at`
  - `updated_at`

The metadata mechanism is also asymmetric:

- `toCanopi()` accepts `description` and `location`
- but all current call sites pass only `name`
- so `description` and `location` are effectively dropped even though the function signature could preserve them

For per-object fields, the problem is different:

- the engine projection does not store plant `notes`, `planted_date`, `quantity`, or zone `notes`
- so once the serializer extracts from the engine, those values are gone unless preserved elsewhere

Affected save paths:

- manual save
- save as
- autosave

This is already a data-loss bug, not just an architectural smell.

## Detailed Findings

### 1. Active data loss in `toCanopi()` is the top issue

This is the most urgent issue in the project.

#### Verified current behavior

`toCanopi()` currently drops or overwrites:

- `timeline`
- `budget`
- `consortiums`
- `created_at`
- `description`
- `location`
- unknown `extra` fields

And the engine-derived serialization path cannot currently preserve:

- `PlacedPlant.notes`
- `PlacedPlant.planted_date`
- `PlacedPlant.quantity`
- `Zone.notes`
- `Layer.locked`

#### Why this is critical

This is not merely “split state is risky.” This is active destructive behavior in the main document path.

Concrete current impact:

- users can edit timeline, budget, and consortiums in the UI today
- those sections are lost on save and autosave today

Important nuance:

- `description`, `location`, per-object notes/date/quantity, and `extra` fields are not currently user-editable through the UI
- but they can exist in loaded files or future-version files
- losing them still breaks the file contract

#### Required short-term fix

Before any larger refactor, the code must stop destroying parts of the loaded document on save.

At minimum:

- preserve `timeline`
- preserve `budget`
- preserve `consortiums`
- preserve `description`
- preserve `location`
- preserve `created_at`
- preserve `extra` / unknown fields
- preserve loaded per-object fields not reconstructible from the engine:
  - plant `notes`
  - plant `planted_date`
  - plant `quantity`
  - zone `notes`
- preserve layer `locked` state through load/save
- define `updated_at` intentionally rather than rebuilding both timestamps unconditionally

#### Feasibility

This first fix is smaller than it may appear.

It requires:

- zero Rust changes
- no IPC changes
- no startup changes
- no broad canvas-engine redesign

It is a frontend-only correction centered on:

- `desktop/web/src/canvas/serializer.ts`
- exactly three `toCanopi()` call sites

For non-visual per-object fields, the current codebase already suggests the implementation path:

- plant nodes already use Konva custom attrs for metadata
- undo/redo serialization already captures custom attrs via node attribute snapshots
- the same mechanism can preserve:
  - plant `notes`
  - plant `planted_date`
  - plant `quantity`
  - zone `notes`

That means the least disruptive Phase A fix is likely:

- store these fields as Konva custom attrs when loading/creating nodes
- read them back during serialization
- keep them round-trippable even before any UI editor exists

For `Layer.locked`, the immediate fix is simpler:

- stop always saving `locked: false`
- load and persist the flag from the canonical layer state just as visibility/opacity are already handled

This should be treated as a small, isolated, safe correction and should not be bundled with broader architecture work.

#### Future-task invariant

No future save path may construct a new `CanopiFile` from only canvas state plus ad hoc metadata if that bypasses loaded document sections or non-reconstructible schema fields.

### 2. Document ownership is currently split and must be made explicit

The data-loss bug exists because document ownership is ambiguous.

Observed runtime model:

- canvas-owned data lives in `CanvasEngine`
- non-canvas document data lives in `currentDesign`
- save/autosave reconstruct from a partial merge
- there is no single runtime owner of the document

Current practical split:

- `plants`, `zones`, visual layer state: primarily engine-derived
- `timeline`, `budget`, `consortiums`: edited in bottom-panel components through `currentDesign`
- metadata and unknown fields: partially loaded, partially reconstructed, partially dropped

This model is not stable enough for a long-lived file format.

#### Architectural options

Canopi should choose one of these explicitly.

1. Document-authoritative runtime model
   - a canonical document store owns the whole in-memory design
   - engine edits a canvas subset of that document
   - save/autosave serialize from the canonical document

2. Explicitly split runtime model with strict composition
   - engine owns only canvas objects
   - document store owns metadata and non-canvas sections
   - one composition layer writes engine-owned sections back into the canonical document before serialization
   - ownership is documented and test-covered

Either can work. The current implicit hybrid should not continue.

#### Recommended direction

I recommend:

- a canonical frontend document state object
- `CanvasEngine` treated as a projection/editor for canvas-relevant data
- one explicit sync boundary:
  - `loadCanvasFromDocument(doc)`
  - `writeCanvasIntoDocument(doc)`

This is the cleanest path to:

- safe saves
- safe autosaves
- explicit dirty semantics
- migration
- predictable ownership

#### Feasibility

This is practical in the current codebase.

Why:

- bottom-panel components already follow a consistent pattern:
  - read `currentDesign`
  - copy with modification
  - write back
  - mark dirty
- the dependency graph is still manageable
- this can be introduced as a document-state module without a full rewrite

#### Future-task invariants

- there must be one canonical in-memory document owner
- engine state must not silently become the whole document
- non-canvas sections must not live only in view components
- composition from engine state into file state must happen in one documented place

### 3. Dirty-state correctness is currently broken for mixed edit sources

This issue is related to document ownership, but deserves separate treatment because it directly affects user-visible save semantics.

#### Verified current behavior

Bottom-panel tabs mutate `currentDesign` directly and set:

- `designDirty.value = true`

Canvas history also sets dirty on execute/record and clears dirty in `undo()` using:

- `designDirty.value = this._past.length > 0`

That logic is only correct for canvas-only history.

#### Concrete bug

Example flow:

1. User edits timeline in `TimelineTab` -> `designDirty = true`
2. User performs three canvas edits -> history has 3 entries
3. User undoes all three canvas edits -> `_past.length === 0`
4. `undo()` sets `designDirty = false`
5. But the timeline change is still unsaved

So the current dirty flag can lie.

#### Why this matters

- close/save guards become unreliable
- autosave gating becomes unreliable
- save indicators can mislead users

#### Recommended direction

Dirty should not be derived from one subsystem’s history stack alone.

Canopi needs a document-level dirty model that can represent:

- unsaved file changes
- autosave freshness
- last successful save baseline
- changes from multiple sources

A timestamp-based or revision-based model may be simpler than trying to infer cleanliness from stack depth.

#### Feasibility

This change is simpler than it first appears:

- dirty writes are straightforward boolean assignments today
- read sites are limited
- once document ownership is explicit, a richer dirty model can replace the current boolean incrementally

#### Future-task invariants

- dirty is document-scoped, not history-stack-scoped
- undoing canvas history to empty does not imply “clean” if non-canvas edits remain
- save/autosave logic must not depend on partial dirty sources

### 4. Autosave is currently incomplete and partially misleading

Autosave shares the same broken composition path as manual save.

#### Verified current behavior

From `CanvasPanel.tsx` and Rust autosave code:

- interval is hardcoded at `60_000`
- timer runs continuously while the panel is mounted
- autosave is skipped only when `!designDirty.value`
- autosave content is built via the same `toCanopi()` path
- autosave failures are invoked fire-and-forget:
  - `void autosaveDesign(...)`
- Rust autosave writes to `{app_data_dir}/autosave/`
- autosaves are pruned to max 5 files
- the timer is not reset when a different document is loaded; it is panel-lifecycle-based rather than document-lifecycle-based

#### Current defects

1. Autosave does not preserve timeline/budget/consortium data.
2. Autosave does not preserve metadata correctly.
3. Autosave does not preserve unknown fields correctly.
4. Autosave does not preserve per-object non-visual schema fields.
5. Autosave failure is effectively silent in the frontend path.
6. Dirty semantics are already unreliable because of mixed edit sources.

So autosave currently provides less protection than it appears to.

#### Recommended autosave contract

Autosave should be treated as:

- checkpointing of the canonical in-memory document
- separate from “saved to the user’s chosen file”
- visible enough to be trusted when it fails

Suggested semantics:

- autosave serializes the same canonical document model used for manual save
- autosave does not redefine immutable file metadata
- autosave has explicit success/failure tracking
- autosave freshness is modeled separately from manual-save cleanliness

#### Future implementation guidance

Before extending autosave:

- fix canonical document composition first
- define:
  - file-dirty
  - autosave-dirty
  - last autosave success/failure
- consider whether autosave timing should remain panel-scoped or become document-scoped

#### Future-task invariants

- autosave must checkpoint the same logical document the user expects to save
- autosave failure must not be silent
- autosave timing should align with document lifecycle, not only panel mount lifecycle

### 5. Forward compatibility is only partially true today

The Rust side has a decent forward-compatibility design:

- `version`
- `#[serde(flatten)] extra`
- Rust-side tests preserving unknown fields

But the real application path goes through TypeScript, and the TS layer currently undermines that guarantee.

#### Verified current behavior

- `desktop/web/src/types/design.ts` does not model `extra`
- `toCanopi()` constructs a fresh object without carrying unknown fields forward

That means:

- Rust can preserve unknown fields if it loads and re-saves directly
- the app’s real TS save path can still strip them

So the end-to-end forward-compatibility guarantee is currently false.

#### Recommendation

Until generated contracts are in place:

- add an `extra` field to the TS mirror or otherwise preserve unknown fields in the canonical document store
- ensure composition logic copies unknown fields forward untouched unless a migration explicitly consumes them

There is already a useful local precedent in the serializer:

- `north_bearing_deg` survives because the serializer has a fallback to the `northBearingDeg` signal when callers do not pass metadata

`description` and `location` currently have no equivalent fallback. The immediate fix can be done either by:

1. passing them from the current canonical document at all call sites
2. adding a defensive serializer fallback from canonical document state

Either is valid. The key requirement is that no loaded metadata field should collapse to `null` just because a caller omitted it.

#### Future-task invariants

- unknown fields must survive the real Rust -> TS -> Rust round-trip
- Rust-only round-trip tests are not sufficient evidence

### 6. The `.canopi` file format needs explicit product guarantees

The file format already matters enough to deserve explicit invariants.

#### What is good already

- explicit schema version
- centralized Rust save/load
- unknown-field preservation intent

#### What is missing

- end-to-end round-trip guarantees through the frontend
- explicit `created_at` vs `updated_at` policy
- migration policy for future versions
- distinction between:
  - file schema version
  - runtime model version
  - app version compatibility

#### Required invariants

- no-op save must preserve user data and metadata
- unknown fields must survive unless intentionally migrated away
- `created_at` must be stable
- `updated_at` must change only according to a defined save/checkpoint policy
- newer-version file handling must have an explicit policy

### 7. Shared contracts are still duplicated manually

This remains a real structural issue, but it is not the first thing to fix.

Current state:

- Rust domain types in `common-types/`
- TS mirrors in `desktop/web/src/types/`
- comments like “keep in sync” on the TS side

This is fragile, especially for:

- document types
- IPC payloads
- species types

#### Recommendation

Strategically:

- Rust should remain the domain authority
- generated contracts should become the long-term default

Tactically:

- if current generation tooling is unstable, do not force a brittle integration immediately
- but do minimize manual duplication and keep TS mirrors clearly subordinate to Rust types

#### Future-task invariants

- do not introduce new duplicate shared types casually
- whenever `common-types` changes, verify TS mirrors in the same task
- keep UI-local view models separate from persistence/file-format models

### 8. Plant DB degraded startup is not explicit enough

The current startup path in `desktop/src/lib.rs` logs failure and substitutes an in-memory DB.

This avoids crashes but creates runtime ambiguity.

#### Verified current behavior

If the plant DB cannot be opened:

- the app still launches
- managed `PlantDb` state still exists
- plant commands remain callable
- search may fail noisily because the expected schema/FTS tables are missing
- the user gets no explicit product-level explanation

This is worse than “search returns no results.” It can become runtime query errors against the fallback DB.

#### Recommendation

Canopi should represent subsystem health explicitly.

At minimum:

- app startup state:
  - `booting`
  - `ready`
  - `degraded`
  - `fatal`
- plant DB state:
  - `available`
  - `missing`
  - `corrupt`
  - `uninitialized`

Choose one product behavior explicitly:

1. Fatal startup if plant DB is core to app value
2. Explicit degraded mode if file/canvas workflows should still function

Either is better than silent substitution.

#### Future-task invariants

- critical dependency failure must not be hidden behind fake healthy state
- degraded mode must be visible to both code and user

### 9. Settings are real, but still integration work rather than a structural emergency

The Rust side has a real `Settings` model and persistence commands. The frontend does not yet bootstrap from it.

#### Verified current behavior

- no visible frontend call to `get_settings`
- locale defaults locally
- theme defaults locally
- grid/snap state defaults locally
- autosave interval is hardcoded

This is incomplete, but it is not the first fire to put out.

#### Recommendation

Treat settings as a medium-priority integration milestone:

- load once at startup
- hydrate shell and canvas defaults
- centralize settings updates
- make runtime behavior reflect persisted settings

#### Future-task invariants

- Rust `Settings` remains the contract
- frontend signals are runtime projections of that contract
- hardcoded defaults should be fallback-only, not the long-term authority

### 10. Canvas history deserves targeted review, but not redesign yet

The current history system matters because it intersects with dirty semantics and future feature scope.

#### Verified current behavior

- history is canvas-only
- command stack max is 500
- command implementations serialize full node state rather than true minimal diffs
- undo/redo drive dirty based on canvas history stack depth

#### What needs review

1. Is history intentionally canvas-only for the near term?
2. Are non-canvas document edits intentionally non-undoable for now?
3. Is snapshot-style node serialization acceptable for expected object counts?
4. Does dirty tracking need a save-baseline model instead of stack-length heuristics?

#### Recommendation

Do not redesign history immediately. But before significantly expanding mixed canvas and side-panel editing, do a focused review of:

- command memory profile
- dirty semantics relative to save baseline
- whether history scope remains canvas-only

### 11. Logging should be tied to concrete failure modes

Generic “add more logging” is not useful enough by itself.

The more useful framing is:

- improve diagnostics where current failure modes are ambiguous

Best current targets:

- plant DB degraded startup
- save failures
- autosave failures
- file migration/load failures

This should remain secondary to fixing the underlying correctness issues.

### 12. Service-layer introduction should remain deferred

Commands are still thin enough today.

Current command handlers mostly:

- lock state
- call DB/design helpers
- map to IPC response shape

That is acceptable for now.

Add a service layer only when actual repeated orchestration appears.

### 13. Plant identity is a design limitation worth documenting

This is not a current data-loss bug, but it is a real forward-looking constraint.

#### Verified current behavior

Plant nodes receive a fresh `crypto.randomUUID()` on every load.

Zones already behave differently:

- `zone.name` is written into the Konva node ID
- that ID round-trips back into `zone.name`

So zone identity is currently stable across load/save, while plant identity is not.

There is no persistent plant identity in the `PlacedPlant` schema, so across save/load cycles:

- “the same plant” cannot be referred to by stable ID
- any future per-plant tracking would have to infer identity from other fields

#### Why this matters

This does not need to block Phase A. But if future roadmap items include:

- plant-specific notes
- health tracking
- maintenance history
- references from timeline or consortium records to specific placed plants

then stable plant identity will become necessary.

#### Recommendation

Treat this as a documented design limitation for now.

If future features require persistent plant identity:

- add an `id` field to `PlacedPlant`
- store it on the Konva node as a custom attr
- preserve it through load/save the same way other non-visual fields should be preserved

### 14. Layer locking must stay separate from runtime object locking

This is a small but important implementation note for Phase A and later canvas work.

#### Verified current behavior

- `Layer.locked` exists in the persisted file schema
- `Layer.locked` is currently not preserved correctly through save/load
- `lockedObjectIds` in canvas state is a separate runtime concept for per-object locking

These are not the same thing.

#### Why this matters

When fixing `Layer.locked`, the implementation should not accidentally treat it as equivalent to per-object lock state.

They represent different scopes:

- `Layer.locked`: persisted whole-layer property
- `lockedObjectIds`: runtime per-object lock set

#### Future-task invariants

- preserve `Layer.locked` as part of file round-trip
- do not conflate persisted layer locking with runtime object locking

## Recommended Architecture From Here

If I were steering Canopi from the current codebase, I would optimize for this runtime shape.

### Runtime ownership

- Rust owns startup, DBs, file I/O, migrations, and subsystem health
- frontend owns shell composition and interaction flow
- one canonical frontend document store owns in-memory design data
- `CanvasEngine` owns only canvas editing/runtime projection

### Persistence model

- plant DB remains static/read-only
- user DB remains writable and small
- `.canopi` remains the long-lived user document boundary
- autosave writes recovery checkpoints from the canonical document state

### Type ownership

- Rust remains the source of truth for shared domain contracts
- TS mirrors are temporary and subordinate
- UI-only view models can remain TS-local

### Failure model

- startup health is explicit
- degraded states are surfaced intentionally
- critical dependency failure is never hidden behind fake healthy state

## Implementation Plan

### Phase A: Stop destructive saves

This is the first priority and should stay narrow.

It requires:

- zero Rust changes
- no IPC changes
- no startup changes
- no broad canvas-engine redesign

It is a frontend-only correction centered on serializer/composition behavior and its three call sites.

Required work:

1. Fix the `toCanopi()` composition path so it preserves:
   - `timeline`
   - `budget`
   - `consortiums`
   - `description`
   - `location`
   - `created_at`
   - unknown `extra` fields
   - loaded per-object fields not reconstructible from the engine:
     - plant `notes`
     - plant `planted_date`
     - plant `quantity`
     - zone `notes`
   - layer `locked`
2. Define `updated_at` policy:
   - manual save only
   - manual save and autosave
   - or separate saved/checkpoint semantics
3. Add tests covering full-file preservation through the frontend save path.

Success criteria:

- loading and re-saving a file without touching non-canvas sections does not delete them
- autosave preserves the same content
- no-op save preserves currently known schema fields, including non-UI fields loaded from disk

### Phase B: Make document ownership explicit

Required work:

1. Introduce a document-state module responsible for canonical in-memory design data.
2. Define explicit engine sync APIs:
   - load document into engine
   - write engine state back into document
3. Remove implicit ad hoc composition from save call sites.

Success criteria:

- there is one obvious place to answer “what is the current document”
- save and autosave serialize from that owner

Feasibility note:

- current bottom-panel components already follow a consistent mutation pattern
- dependency graph is still manageable
- this can be introduced incrementally

### Phase C: Fix dirty and autosave semantics

Required work:

1. Replace history-stack-based dirty clearing with document-level dirty tracking.
2. Track at least:
   - unsaved file changes
   - autosave freshness
   - last successful save baseline
3. Surface autosave failures.

Success criteria:

- undoing canvas edits no longer clears dirty when non-canvas edits remain
- autosave status is trustworthy

Implementation note:

- current dirty writes are simple
- this change becomes straightforward once document ownership is explicit

### Phase D: Make startup degradation explicit

Required work:

1. Replace silent plant DB fallback semantics with explicit subsystem health state.
2. Decide product behavior for missing/corrupt plant DB.
3. Reflect that state in frontend UI intentionally.

Success criteria:

- users understand when the core DB is unavailable
- code paths stop pretending the system is healthy when it is not

### Phase E: Consolidate around stronger contracts

Required work:

1. Bootstrap settings on startup.
2. Expand end-to-end file-format compatibility tests.
3. Move toward generated shared contracts when the toolchain path is reliable.
4. Adopt the document-lifecycle invariants from this review into `CLAUDE.md` once Phase A is complete so future sessions enforce them by default.

Note on generated contracts:

- strategically important
- tactically deferrable if the current `specta` path remains unstable
- should not block Phases A-C

## Test Plan Needed For Future Work

The current Rust tests are useful but insufficient for the real app lifecycle.

Add tests for:

### Document round-trip

- Rust -> TS -> Rust no-op save preserves entire file
- preserved sections:
  - timeline
  - budget
  - consortiums
  - description
  - location
  - `created_at`
  - unknown fields
  - plant `notes`
  - plant `planted_date`
  - plant `quantity`
  - zone `notes`
  - layer `locked`

### Save and autosave

- manual save after non-canvas edits
- autosave after non-canvas edits
- save/autosave after mixed canvas + non-canvas edits
- autosave failure visibility and state
- autosave timer behavior across document loads if timer remains panel-scoped

### Dirty semantics

- timeline edit + canvas edits + undo canvas edits still dirty
- save resets dirty baseline correctly
- load new document resets dirty correctly

### Startup degradation

- missing plant DB
- corrupt plant DB
- expected UI behavior in degraded mode

### History

- undo/redo after add/remove/transform
- history clear on load
- dirty baseline behavior around undo to saved state
- memory impact under larger command counts if node counts increase materially

## Coding Invariants For Future Tasks

These should be treated as project rules until explicitly revised.

### Document and file invariants

- never regenerate `created_at` casually
- only update `updated_at` according to a defined save/checkpoint policy
- preserve loaded document sections unless intentionally modified
- preserve unknown fields unless an explicit migration transforms them
- preserve non-visual schema fields loaded from disk unless intentionally modified
- preserve layer schema fields, not just the subset currently used by the UI
- no save path may silently discard document sections it does not own

### State ownership invariants

- there must be one canonical in-memory document owner
- `CanvasEngine` is not the whole document
- view components must not become hidden owners of durable file content
- composition from engine state into file state must happen in one documented place

### Dirty/autosave invariants

- dirty is document-scoped
- canvas history depth is not the same thing as document cleanliness
- autosave must checkpoint the same logical document the user expects to save
- autosave failure must not be silent
- autosave timing should align with document lifecycle semantics

### Startup/failure invariants

- critical dependency failure must be represented explicitly
- degraded mode must be visible to both code and user
- fake healthy fallback state is not acceptable for core dependencies

### Type-contract invariants

- Rust is the authority for shared domain contracts
- TS mirrors are temporary and subordinate
- UI-local types should not be confused with persistence/file-format types

### Process invariant

- once Phase A lands, the document-lifecycle invariants in this review should be copied into `CLAUDE.md` so future work does not regress the save path

## Final Assessment

Canopi already has the right broad architecture for the product. The urgent problem is not the framework mix or the storage model. The urgent problem is that the current document lifecycle is not preserving user data correctly.

That changes the roadmap.

The next work should start from:

1. stop destructive saves and autosaves
2. make document ownership explicit so those bugs cannot recur
3. fix dirty/autosave/startup semantics around that corrected core

After that, the rest of the architectural cleanup becomes safer and easier.

The highest-value move from here is not redesign. It is to make the existing good architecture trustworthy at the document boundary.
