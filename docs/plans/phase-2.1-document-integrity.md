# Phase 2.1 — Document Integrity

## Context

The architecture review (`docs/reviews/2026-03-24-architecture-review.md`) found that the save/autosave path is **actively destructive** — it drops document sections on every save. This is the top-priority defect. Phase 2.1 fixes document composition, ownership, dirty tracking, startup health, and contract consolidation — directly mapping to the review's Phases A→E.

---

## Phase A: Stop Destructive Saves (frontend only, zero Rust changes)

**Skills:** `/canopi-canvas`, `/canopi-ux` | **Context7:** `/konvajs/site`

### A.1 — Add `extra` to TS type + extraction helper

**File:** `desktop/web/src/types/design.ts`
- Add `extra?: Record<string, unknown>` to `CanopiFile` interface (line 17)

**File:** `desktop/web/src/canvas/serializer.ts`
- Add `extractExtra(raw)` function that diffs a raw JS object against `KNOWN_CANOPI_KEYS` set and returns unknown keys. Rust `#[serde(flatten)]` produces top-level JSON keys — the TS side must capture them on load.

### A.2 — Capture `extra` on load

**File:** `desktop/web/src/state/design.ts`
- In `openDesign()` (line 69): after receiving `file` from IPC, call `file.extra = extractExtra(file as any)` before assigning to `currentDesign`
- In `newDesignAction()` (line 88): set `file.extra = {}`

**File:** `desktop/web/src/components/panels/CanvasPanel.tsx`
- In the queued-load path (line 55): same `extractExtra()` call

### A.3 — Store plant per-object fields as Konva custom attrs

**File:** `desktop/web/src/canvas/plants.ts`
- Extend `createPlantNode` opts interface (line 51) to accept: `notes?: string | null`, `plantedDate?: string | null`, `quantity?: number | null`
- After line 89, add: `group.setAttr('data-notes', opts.notes ?? '')`, `group.setAttr('data-planted-date', opts.plantedDate ?? '')`, `group.setAttr('data-quantity', opts.quantity ?? 0)`
- Same pattern as existing `data-canonical-name` attrs

### A.4 — Pass per-object fields on load

**File:** `desktop/web/src/canvas/serializer.ts`
- In `fromCanopi()` (line 129), add to `createPlantNode` call: `notes: plant.notes`, `plantedDate: plant.planted_date`, `quantity: plant.quantity`

### A.5 — Store zone `notes` as Konva custom attr on load

**File:** `desktop/web/src/canvas/serializer.ts`
- In `fromCanopi()`, after each zone shape is created (before `zonesLayer.add(shape)` at line 205): `if (zone.notes) shape.setAttr('data-notes', zone.notes)`

### A.6 — Read per-object fields back on save

**File:** `desktop/web/src/canvas/engine.ts`
- In `getPlacedPlants()` (lines 1019-1021), replace hardcoded nulls:
  - `notes: group.getAttr('data-notes') || null`
  - `planted_date: group.getAttr('data-planted-date') || null`
  - `quantity: group.getAttr('data-quantity') || null`

**File:** `desktop/web/src/canvas/serializer.ts`
- In `toCanopi()` zone extraction (line 67), replace `notes: null` with: `notes: (node as Konva.Shape).getAttr('data-notes') || null`

### A.7 — Preserve layer `locked` state

**File:** `desktop/web/src/canvas/serializer.ts`
- Import `layerLockState` from `../state/canvas`
- **Save** (line 79): replace `locked: false` with `locked: layerLockState.value[name] ?? false`
- **Load** (after line 222): restore lock state from `file.layers` into `layerLockState` signal (same pattern as visibility restoration at lines 211-222)

### A.8 — Fix `toCanopi()` to preserve non-canvas sections from `currentDesign`

**File:** `desktop/web/src/canvas/serializer.ts`
- Import `currentDesign` from `../state/design`
- Replace lines 86-106 with:
  ```
  const doc = currentDesign.value
  const now = new Date().toISOString()
  return {
    version: 1,
    name: metadata.name,
    description: metadata.description ?? doc?.description ?? null,
    location: metadata.location ?? doc?.location ?? null,
    north_bearing_deg: metadata.northBearingDeg ?? northBearingDeg.value,
    layers, plants, zones,
    consortiums: doc?.consortiums ?? [],
    timeline: doc?.timeline ?? [],
    budget: doc?.budget ?? [],
    created_at: doc?.created_at ?? now,  // preserve from loaded file
    updated_at: now,
    ...(doc?.extra ?? {}),  // spread unknown fields for Rust flatten round-trip
  }
  ```
- Key changes: `consortiums`/`timeline`/`budget` from `currentDesign` (not `[]`), `description`/`location` fall back to `currentDesign` (same pattern as `north_bearing_deg`), `created_at` preserved, `extra` spread

### A.9 — No call-site changes needed

All 3 call sites pass `{ name: designName.value }`. Because `toCanopi()` now falls back to `currentDesign` for all non-canvas fields, they remain correct.

### A.10 — Verification
1. `cd desktop/web && npx tsc --noEmit`
2. `cd desktop/web && npm run build`
3. Manual round-trip test: create design → add timeline/budget/consortium items → save → close → reopen → verify all preserved
4. Verify `created_at` unchanged after no-op save
5. Review with `/craft` + two parallel code-reviewer agents

---

## Phase B: Make Document Ownership Explicit (frontend only)

**Skills:** `/canopi-ux`, `/canopi-canvas`

### B.1 — Create `state/document.ts`

**New file:** `desktop/web/src/state/document.ts`
- Re-exports `designDirty`, `designPath`, `designName`, `currentDesign` from `./design`
- Exports `writeCanvasIntoDocument(engine, name)` → calls `toCanopi()`
- Exports `loadCanvasFromDocument(file, engine)` → calls `fromCanopi()`
- Single entry point for all document composition

### B.2 — Refactor imports

- `state/design.ts`: import `toCanopi`/`fromCanopi` through `./document` (or keep internal)
- `components/panels/CanvasPanel.tsx`: import `writeCanvasIntoDocument` instead of `toCanopi` directly
- Goal: only `state/document.ts` imports directly from `canvas/serializer`

### B.3 — Document in CLAUDE.md
- Add ownership rules: "`currentDesign` is the runtime authority. `CanvasEngine` is a projection. `state/document.ts` is the composition boundary."

### B.4 — Verification
1. `npx tsc --noEmit` + `npm run build`
2. Same round-trip test
3. Verify no file imports `toCanopi`/`fromCanopi` except `state/document.ts`
4. Review with `/craft`

---

## Phase C: Fix Dirty and Autosave Semantics (frontend only)

**Skills:** `/canopi-ux`, `/canopi-canvas`

### C.1 — Replace boolean dirty with revision-based model

**File:** `desktop/web/src/state/design.ts`
- Replace `designDirty = signal<boolean>(false)` with:
  - `documentRevision = signal<number>(0)` — monotonically increasing
  - `lastSavedRevision = signal<number>(0)` — set on successful save
  - `lastAutosaveRevision = signal<number>(0)` — set on successful autosave
  - `autosaveFailed = signal<boolean>(false)`
  - `designDirty = computed(() => documentRevision.value !== lastSavedRevision.value)`
- The `computed` preserves `.value` read API at all 17 read sites

### C.2 — Update all 17 write sites

**`designDirty.value = true` → `documentRevision.value++`** (10 sites):
- `history.ts:32,48,66` (execute, record, redo)
- `import.ts:72` (background image)
- `TimelineTab.tsx:105,118,128`
- `BudgetTab.tsx:117,128`
- `ConsortiumTab.tsx:84,95`

**`designDirty.value = false` → `lastSavedRevision.value = documentRevision.value`** (4 sites):
- `design.ts:40,54` (save, save-as)

**`designDirty.value = false` → `batch(() => { documentRevision.value = 0; lastSavedRevision.value = 0; ... })`** (3 sites):
- `design.ts:72,91` (open, new)
- `CanvasPanel.tsx:58` (queued load)

### C.3 — Fix the undo bug

**File:** `desktop/web/src/canvas/history.ts`
- Line 57: replace `designDirty.value = this._past.length > 0` with `documentRevision.value++`
- Undo is a document change relative to last save. The `computed` dirty signal handles the rest.

### C.4 — Surface autosave failures

**File:** `desktop/web/src/components/panels/CanvasPanel.tsx`
- Replace fire-and-forget `void autosaveDesign(...)` (line 71) with `.then()` / `.catch()` that updates `lastAutosaveRevision` / `autosaveFailed` signals

### C.5 — Status bar indicator

**File:** `desktop/web/src/components/shared/StatusBar.tsx`
- Show autosave failure warning when `autosaveFailed.value === true`
- Add i18n keys to all 6 locale files

### C.6 — Verification
1. `npx tsc --noEmit` + `npm run build`
2. **Critical test:** Edit timeline → 3 canvas edits → undo all 3 → verify dirty still true
3. Save → verify dirty becomes false
4. Load new document → verify revision resets
5. Review with `/craft`

---

## Phase D: Make Startup Degradation Explicit (Rust + frontend)

**Skills:** `/canopi-rust`, `/canopi-ux`, `/canopi-db` | **Context7:** `/websites/v2_tauri_app`

### D.1 — Health types in `common-types`
- New `common-types/src/health.rs`: `SubsystemHealth { plant_db: PlantDbStatus }`, `PlantDbStatus` enum: `Available | Missing | Corrupt`

### D.2 — Track at startup
- `desktop/src/lib.rs`: managed `AppHealth` state, set during plant DB init block

### D.3 — IPC command
- `desktop/src/commands/health.rs`: `get_health()` command, registered in `generate_handler![]`

### D.4 — Frontend
- TS mirror types in `types/health.ts`
- `plantDbStatus` signal in `state/app.ts`
- Query `get_health` on mount in `app.tsx`
- `DegradedBanner` component below TitleBar, CSS Modules, i18n keys in 6 locales

### D.5 — Verification
1. `cargo check --workspace` + `cargo test --workspace`
2. `npx tsc --noEmit` + `npm run build`
3. Test with plant DB removed — banner visible, search fails gracefully
4. Review with `/craft`

---

## Phase E: Consolidate Contracts (mixed)

**Skills:** `/canopi-rust`, `/canopi-ux`, `/canopi-test`, `/canopi-db`

### E.1 — Bootstrap settings from Rust
- `state/app.ts`: `bootstrapSettings()` calls `get_settings` IPC, hydrates locale/theme/grid/autosave signals
- TS mirror of `Settings` type
- Call in `app.tsx` before `initTheme()`

### E.2 — Configurable autosave interval
- `CanvasPanel.tsx`: replace hardcoded `60_000` with bootstrapped settings value

### E.3 — TS document round-trip tests (Vitest)
- New `canvas/__tests__/serializer.test.ts`
- Tests: no-op round-trip, per-object field preservation, zone notes, layer locked, extra fields, timestamps, dirty semantics

### E.4 — Expand Rust tests
- `design/format.rs`: all PlacedPlant fields, Zone notes, Layer locked, created_at/updated_at

### E.5 — Adopt document lifecycle invariants into CLAUDE.md
- Copy coding invariants from architecture review (already partially done)

### E.6 — Verification
1. `cargo test --workspace`
2. Vitest test suite passes
3. Full `cargo tauri dev` smoke test
4. Review with `/craft`
5. Run `/canopi:canopi-retro`

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
