# Phase 2.1 — Document Integrity

## Context

The architecture review (`docs/reviews/2026-03-24-architecture-review.md`) found that the save/autosave path is **actively destructive** — it drops document sections on every save. This is the top-priority defect. Phase 2.1 fixes document composition, ownership, dirty tracking, startup health, and contract consolidation — directly mapping to the review's Phases A→E.

Reviews of the plan (`docs/plans/phase-2.1-document-integrity-review-2026-03-24.md`) identified corrections incorporated below: no module cycle in Phase A, two-baseline dirty model in Phase C, defensive `extra` spread ordering, `?? null` semantics for custom attrs, background-image import gated until persistence exists, degraded-mode feature gating in Phase D, bootstrap restructuring + theme flicker mitigation in Phase E, and `state/document.ts` explicitly marked as the long-term document API boundary.

---

## Tooling Protocol

Before writing code in any sub-phase, query **Context7** for up-to-date library documentation. Do not rely on training data or web sources.

| Phase | Skills | Context7 IDs |
|-------|--------|--------------|
| A | `/canopi-canvas`, `/canopi-ux` | `/konvajs/site` (custom attrs, node API) |
| B | `/canopi-ux`, `/canopi-canvas` | — |
| C | `/canopi-ux`, `/canopi-canvas` | `/konvajs/site` (if touching node serialization) |
| D | `/canopi-rust`, `/canopi-ux`, `/canopi-db` | `/websites/v2_tauri_app` (managed state, commands), `/rusqlite/rusqlite` |
| E | `/canopi-rust`, `/canopi-ux`, `/canopi-test`, `/canopi-db` | `/websites/v2_tauri_app`, `/konvajs/site` |

After each phase: run `/craft` with two parallel code-reviewer agents (backend + frontend). At session end: `/canopi:canopi-retro`.

---

## Phase A: Stop Destructive Saves (frontend only, zero Rust changes)

**Skills:** `/canopi-canvas`, `/canopi-ux` | **Context7:** `/konvajs/site` — query for `setAttr`/`getAttr`, `Node` custom attributes, `Group` API

### A.1 — Add `extra` to TS type + extraction helper

**File:** `desktop/web/src/types/design.ts`
- Add `extra?: Record<string, unknown>` to `CanopiFile` interface (line 17)

**File:** `desktop/web/src/canvas/serializer.ts`
- Add `extractExtra(raw)` function that diffs a raw JS object against `KNOWN_CANOPI_KEYS` set and returns unknown keys. Rust `#[serde(flatten)]` produces top-level JSON keys — the TS side must capture them on load.
- Export `extractExtra` so load sites can call it.

### A.2 — Capture `extra` on load

**File:** `desktop/web/src/state/design.ts`
- In `openDesign()` (line 69): after receiving `file` from IPC, call `file.extra = extractExtra(file as any)` before assigning to `currentDesign`
- In `newDesignAction()` (line 88): set `file.extra = {}`

**File:** `desktop/web/src/components/panels/CanvasPanel.tsx`
- In the queued-load path (line 55): same `extractExtra()` call

### A.3 — Store plant per-object fields as Konva custom attrs

**File:** `desktop/web/src/canvas/plants.ts`
- Extend `createPlantNode` opts interface (line 51) to accept: `notes?: string | null`, `plantedDate?: string | null`, `quantity?: number | null`
- After line 89, add:
  - `group.setAttr('data-notes', opts.notes ?? null)`
  - `group.setAttr('data-planted-date', opts.plantedDate ?? null)`
  - `group.setAttr('data-quantity', opts.quantity ?? null)`
- Store `null` directly — no sentinel values (`0`, `''`). Same pattern as existing `data-canonical-name` attrs.

### A.4 — Pass per-object fields on load

**File:** `desktop/web/src/canvas/serializer.ts`
- In `fromCanopi()` (line 129), add to `createPlantNode` call: `notes: plant.notes`, `plantedDate: plant.planted_date`, `quantity: plant.quantity`

### A.5 — Store zone `notes` as Konva custom attr on load

**File:** `desktop/web/src/canvas/serializer.ts`
- In `fromCanopi()`, after each zone shape is created (before `zonesLayer.add(shape)` at line 205): `shape.setAttr('data-notes', zone.notes ?? null)`

### A.6 — Read per-object fields back on save

**File:** `desktop/web/src/canvas/engine.ts`
- In `getPlacedPlants()` (lines 1019-1021), replace hardcoded nulls:
  - `notes: group.getAttr('data-notes') ?? null`
  - `planted_date: group.getAttr('data-planted-date') ?? null`
  - `quantity: group.getAttr('data-quantity') ?? null`

**File:** `desktop/web/src/canvas/serializer.ts`
- In `toCanopi()` zone extraction (line 67), replace `notes: null` with: `notes: (node as Konva.Shape).getAttr('data-notes') ?? null`

Use `?? null` everywhere (not `|| null`) to preserve legitimate falsy values like `0`.

### A.7 — Preserve layer `locked` state

**File:** `desktop/web/src/canvas/serializer.ts`
- Import `layerLockState` from `../state/canvas`
- **Save** (line 79): replace `locked: false` with `locked: layerLockState.value[name] ?? false`
- **Load** (after line 222): restore lock state from `file.layers` into `layerLockState` signal (same pattern as visibility restoration at lines 211-222)

### A.8 — Add `doc` parameter to `toCanopi()` to preserve non-canvas sections

**File:** `desktop/web/src/canvas/serializer.ts`

Add a third parameter to `toCanopi()` — the canonical document to merge from. This avoids a module cycle (`serializer.ts` must NOT import from `state/design.ts`, which already imports from `serializer.ts`).

New signature:
```ts
export function toCanopi(
  engine: CanvasEngine,
  metadata: { name: string; description?: string | null; location?: Location | null; northBearingDeg?: number | null },
  doc: CanopiFile | null,
): CanopiFile
```

Replace lines 86-106 with:
```ts
const now = new Date().toISOString()
return {
  // Spread extra FIRST — canonical keys below always win over unknown fields
  ...(doc?.extra ?? {}),
  version: 1,
  name: metadata.name,
  description: metadata.description ?? doc?.description ?? null,
  location: metadata.location ?? doc?.location ?? null,
  north_bearing_deg: metadata.northBearingDeg ?? northBearingDeg.value,
  layers, plants, zones,
  consortiums: doc?.consortiums ?? [],
  timeline: doc?.timeline ?? [],
  budget: doc?.budget ?? [],
  created_at: doc?.created_at ?? now,
  updated_at: now,
}
```

Key changes:
- `extra` spread **first** — canonical keys always override, preventing misclassified unknown keys from clobbering known fields
- `consortiums`/`timeline`/`budget` from `doc` (not `[]`)
- `description`/`location` fall back to `doc` (same pattern as `north_bearing_deg`)
- `created_at` preserved from loaded file, only generated for new designs

### A.9 — Update all 3 call sites to pass `currentDesign.value`

**File:** `desktop/web/src/state/design.ts`
- `saveCurrentDesign()` (line 29): `toCanopi(engine, { name: designName.value }, currentDesign.value)`
- `saveAsCurrentDesign()` (line 48): same

**File:** `desktop/web/src/components/panels/CanvasPanel.tsx`
- Autosave timer (line 70): `toCanopi(eng, { name: designName.value }, currentDesign.value)`

### A.10 — Gate background-image import until persistence exists

Background images (`canvas/import.ts`) are a user-facing feature that does not survive save/load. The `.canopi` schema has no field for images, and `HTMLImageElement` is not JSON-serializable. This is the same class of "saved work lost" as timeline/budget — it must not remain silently broken.

Full persistence requires schema + Rust changes (storing image data or file references), which is out of scope for Phase A's "zero Rust changes" constraint. Gate the feature now; re-enable when persistence is built.

**File:** `desktop/web/src/commands/registry.ts`
- Remove or disable the `canvas.import.image` command entry (line 128)
- Remove the `doImportBackgroundImage` helper and its import of `importBackgroundImage` (lines 12, 85-92)

**File:** `desktop/web/src/canvas/import.ts`
- Keep the file (no deletion) — it will be re-enabled with persistence. Add a comment: `// Gated: re-enable when .canopi background-image persistence is implemented`

### A.11 — Verification
1. `cd desktop/web && npx tsc --noEmit`
2. `cd desktop/web && npm run build`
3. Manual round-trip test: create design → add timeline/budget/consortium items → save → close → reopen → verify all preserved
4. Verify `created_at` unchanged after no-op save
5. Review with `/craft` + two parallel code-reviewer agents

---

## Phase B: Make Document Ownership Explicit (frontend only)

### B.1 — Create `state/document.ts` as the canonical document API

**New file:** `desktop/web/src/state/document.ts`
- Exports `writeCanvasIntoDocument(engine, name)` → calls `toCanopi(engine, metadata, currentDesign.value)`
- Exports `loadCanvasFromDocument(file, engine)` → calls `fromCanopi(file, engine)`
- Re-exports `designDirty`, `designPath`, `designName`, `currentDesign` from `./design`
- Single entry point for all document composition

This is the **canonical document API** and the intended long-term document authority boundary. `state/design.ts` becomes an internal/transitional module that `document.ts` wraps — it is not the final public ownership surface. External consumers import from `document.ts`.

### B.2 — Refactor imports

- `state/design.ts`: keeps its direct `toCanopi`/`fromCanopi` imports (internal)
- `components/panels/CanvasPanel.tsx`: imports `writeCanvasIntoDocument` from `../../state/document` instead of `toCanopi` directly
- Goal: only `state/document.ts` and `state/design.ts` import from `canvas/serializer`; all other modules go through `document.ts`

### B.3 — Document in CLAUDE.md
- Add ownership rules: "`currentDesign` is the runtime authority. `CanvasEngine` is a projection. `state/document.ts` is the canonical document API and composition boundary."

### B.4 — Verification
1. `npx tsc --noEmit` + `npm run build`
2. Same round-trip test
3. Verify no file outside `state/` imports `toCanopi`/`fromCanopi` directly
4. Review with `/craft`

---

## Phase C: Fix Dirty and Autosave Semantics (frontend only)

### C.1 — Two-baseline dirty model

Replace the single boolean `designDirty` with a split model that tracks canvas and non-canvas changes independently. This preserves undo-to-saved-state semantics (undoing all canvas edits back to the save point = canvas clean) while also correctly tracking non-canvas edits.

**File:** `desktop/web/src/state/design.ts`

```ts
// Canvas dirty — tracked by history saved checkpoint
export const canvasSavedIndex = signal<number>(0)  // _past.length at last save
export const canvasHistoryDepth = signal<number>(0) // current _past.length

// Non-canvas dirty — revision counter for tab edits
export const nonCanvasRevision = signal<number>(0)
export const nonCanvasSavedRevision = signal<number>(0)

// Autosave tracking
export const lastAutosaveRevision = signal<number>(0)
export const autosaveFailed = signal<boolean>(false)

// Composite dirty — true if either side has unsaved changes
export const designDirty = computed(() =>
  canvasHistoryDepth.value !== canvasSavedIndex.value
  || nonCanvasRevision.value !== nonCanvasSavedRevision.value
)
```

The `computed` preserves `.value` read API at all existing read sites.

### C.2 — Update canvas dirty tracking

**File:** `desktop/web/src/canvas/history.ts`
- Import `canvasHistoryDepth` from `../state/design`
- After every stack mutation (`execute`, `record`, `undo`, `redo`, `clear`), update: `canvasHistoryDepth.value = this._past.length`
- **Remove** all `designDirty.value = ...` writes from history.ts (lines 32, 48, 57, 66)
- Line 57 (`undo`): no longer needs special dirty logic — `canvasHistoryDepth` tracks stack position, `canvasSavedIndex` remembers the save point. When they match, canvas is clean.

### C.3 — Update non-canvas dirty sites

**`designDirty.value = true` → `nonCanvasRevision.value++`** (7 sites):
- `TimelineTab.tsx:105,118,128`
- `BudgetTab.tsx:117,128`
- `ConsortiumTab.tsx:84,95`

Note: `import.ts:72` (`designDirty.value = true` for background images) is removed by Phase A.10 gating. If background-image persistence is added later, the dirty write should be canvas-side (not non-canvas), since imported images are Konva nodes on the canvas.

### C.4 — Update save/load reset sites

**On save** (`design.ts:40,54`): replace `designDirty.value = false` with:
```ts
canvasSavedIndex.value = canvasHistoryDepth.value
nonCanvasSavedRevision.value = nonCanvasRevision.value
```

**On open/new** (`design.ts:72,91` and `CanvasPanel.tsx:58`): replace `designDirty.value = false` with:
```ts
batch(() => {
  canvasSavedIndex.value = 0
  canvasHistoryDepth.value = 0
  nonCanvasRevision.value = 0
  nonCanvasSavedRevision.value = 0
  autosaveFailed.value = false
})
```

### C.5 — Surface autosave failures

**File:** `desktop/web/src/components/panels/CanvasPanel.tsx`
- Replace fire-and-forget `void autosaveDesign(...)` (line 71) with `.then()` / `.catch()` that updates `autosaveFailed` signal

### C.6 — Status bar indicator

**File:** `desktop/web/src/components/shared/StatusBar.tsx`
- Show autosave failure warning when `autosaveFailed.value === true`
- Add i18n keys to all 6 locale files

### C.7 — Verification
1. `npx tsc --noEmit` + `npm run build`
2. **Critical test:** Edit timeline → 3 canvas edits → undo all 3 → verify dirty still true (non-canvas change remains)
3. **Undo-to-saved test:** Save → canvas edit → undo → verify dirty is false (back to saved state)
4. Save → verify dirty becomes false
5. Load new document → verify all baselines reset
6. Review with `/craft`

---

## Phase D: Make Startup Degradation Explicit (Rust + frontend)

### D.1 — Health types in `common-types`
- New `common-types/src/health.rs`: `SubsystemHealth { plant_db: PlantDbStatus }`, `PlantDbStatus` enum: `Available | Missing | Corrupt`

### D.2 — Track at startup
- `desktop/src/lib.rs`: managed `AppHealth` state, set during plant DB init block

### D.3 — IPC command
- `desktop/src/commands/health.rs`: `get_health()` command, registered in `generate_handler![]`

### D.4 — Frontend health state + banner
- TS mirror types in `types/health.ts`
- `plantDbStatus` signal in `state/app.ts`
- Query `get_health` on mount in `app.tsx`
- `DegradedBanner` component below TitleBar, CSS Modules, i18n keys in 6 locales

### D.5 — Feature gating for degraded mode

A banner alone is insufficient — the fallback in-memory DB has no FTS5 tables, so queries will throw errors. The UI must prevent those queries.

- **Plant DB sidebar:** when `plantDbStatus !== 'available'`, show a purposeful empty state ("Plant database unavailable — run prepare-db.py") instead of the search UI
- **Search input:** disable or hide when degraded
- **Species IPC calls:** short-circuit in the frontend IPC wrapper when degraded (return empty results, no Rust call)
- **Drag-and-drop:** disable plant drag source when degraded

### D.6 — Verification
1. `cargo check --workspace` + `cargo test --workspace`
2. `npx tsc --noEmit` + `npm run build`
3. Test with plant DB removed — banner visible, sidebar shows empty state, no FTS5 errors
4. Test with plant DB present — normal operation, no banner
5. Review with `/craft`

---

## Phase E: Consolidate Contracts (mixed)

### E.1 — Restructure app bootstrap sequence

**File:** `desktop/web/src/app.tsx`
- Move `initTheme()` and `initShortcuts()` out of module-scope execution into an explicit `bootstrapApp()` function
- `bootstrapApp()` sequence: `bootstrapSettings()` → `initTheme()` → `initShortcuts()`
- Call `bootstrapApp()` once from the top-level component mount or a module-scope IIFE

### E.2 — Bootstrap settings from Rust
- `state/app.ts`: `bootstrapSettings()` calls `get_settings` IPC, hydrates locale/theme/grid/autosave signals
- TS mirror of `Settings` type in `types/settings.ts`
- **Theme flicker mitigation:** since `bootstrapSettings()` is async (IPC call), keep a synchronous fallback using existing local defaults (current `initTheme()` behavior). Apply the persisted theme when the IPC response arrives — reconcile, don't block first paint.

### E.3 — Configurable autosave interval
- `CanvasPanel.tsx`: replace hardcoded `60_000` with bootstrapped settings value

### E.4 — Add test infrastructure + TS document round-trip tests

- Install Vitest: `npm install -D vitest` in `desktop/web/`
- Add `"test": "vitest run"` script to `package.json`
- New `canvas/__tests__/serializer.test.ts`
- Tests (TS-level — these are the **primary** safeguard, not Rust tests):
  - No-op round-trip preserves all fields
  - Per-object field preservation (plant notes/planted_date/quantity)
  - Zone notes preservation
  - Layer locked preservation
  - Extra fields preservation
  - `created_at` preserved, `updated_at` changes
  - Dirty semantics: timeline edit + canvas undo still dirty; undo to saved state = clean

### E.5 — Expand Rust tests (supplementary)
- `design/format.rs`: all PlacedPlant fields, Zone notes, Layer locked, created_at/updated_at
- Note: Rust tests passed while the app destroyed data — TS tests are primary

### E.6 — Adopt document lifecycle invariants into CLAUDE.md
- Finalize coding invariants from architecture review (partially done already)

### E.7 — Verification
1. `cargo test --workspace`
2. `cd desktop/web && npm test` (Vitest suite)
3. `npx tsc --noEmit` + `npm run build`
4. Full `cargo tauri dev` smoke test
5. Review with `/craft`
6. Run `/canopi:canopi-retro`

---

## Sequencing

```
Phase A ──→ Phase B ──→ Phase C
                              ↘
Phase D (independent) ────────→ Phase E
```

- **A first** — stops active data destruction
- **B after A** — formalizes composition A corrected
- **C after B** — replaces dirty model B's ownership enables
- **D independent** — lower priority, can parallel with B-C
- **E last** — tests + settings + consolidation across all phases
