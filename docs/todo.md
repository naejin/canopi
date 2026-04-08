# Canopi: Current Work

**Date**: 2026-04-08
**Status**: v0.2.0 shipped — rewrite cut over, bottom-panel MVP landed

This file tracks active and deferred work.
For architectural analysis and rationale, see [Code Quality And Architecture Review](./code-quality-architecture-review-2026-04-05.md).

## Completed (rewrite phase)

- `CanvasPanel` mounts `SceneCanvasRuntime`
- Location/map flow split into its own location shell
- `SceneStore` is the canonical canvas scene model
- `RendererHost` owns backend selection and recovery (PixiJS primary, Canvas2D fallback)
- Scene-native interaction owns selection, drag, rectangle, text, and plant placement
- Top-level document `annotations` are part of the schema
- Scene history is command/patch based
- Konva dependency fully removed
- Document replacement guard and dirty model landed

## Active Work

### Architecture status from 2026-04-08 review

Do **not** do a broad architecture refactor before this file. The document-authority convergence work is far enough along to continue safely: canvas scene state is owned by `SceneStore`, non-canvas document state is owned by `currentDesign` / document actions, and save composes both in `SceneCanvasRuntime.serializeDocument()`.

Do a narrow convergence pass before expanding panel/map sync:
- ~~Define typed target identity semantics for timeline and budget before adding full panel-to-canvas highlighting, canvas-to-chart hover, or map overlays~~ — **done**: panel targets are typed as `placed_plant` / `species` / `zone` / `manual` / `none`; timeline, budget, and consortium now encode target identity explicitly.
- ~~Replace the pass-through `CanvasSession` facade, or split it into explicit command/query interfaces, before adding more runtime API surface~~ — **done**: `currentCanvasSession` stores `CanvasRuntime | null`; `setCurrentCanvasTool()` still primes tool state without a mounted runtime.
- ~~Add file-format round-trip/migration coverage before the next breaking `.canopi` schema change~~ — **done**: v1→v2 migration covers legacy panel identity fields, and v2 panel sections round-trip with unknown top-level fields.

Live-code corrections from the review:
- `maplibre-gl` is not dead: `LocationTab` imports it directly, `WorldMapPanel` dynamically imports `WorldMapSurface`, and `vite.config.ts` has a `maplibre-gl` manual chunk. Keep MapLibre; verify chunk/lifecycle behavior instead of removing it.
- `suncalc` still appears unused by live code and remains a removal candidate.

### 1. Convergence (prerequisites for panel/map expansion)

These align with the core risks identified in the architecture review.

**Document authority convergence:**
- ~~Converge the save-time merge seam in `serializeDocument()`~~ — **done** (`b4596f1`): non-canvas sections come from document store, not re-merged into SceneStore
- ~~Replace `currentConsortiums` mirror~~ — **done** (`a8f7fbc`): removed entirely, consortium data is document-store owned
- ~~Replace `designLocation` mirror~~ — **done**: removed entirely (zero component consumers). Read location from `currentDesign.value?.location` directly
- ~~Consortium auto-sync as workflow~~ — **done** (`04fd4fa`): `consortium-sync-workflow.ts` runs at document level (installed by `document.ts` via `loadCanvasFromDocument`, not by `SceneCanvasRuntime`). Sync returns early when canvas session is null (authority fix) — re-triggers via `sceneEntityRevision` on document load. Effect subscribes to `currentDesign.value` (not `.peek()`) so document replacement also re-triggers sync
- ~~TS/Rust type alignment for array fields~~ — **done**: `consortiums`, `timeline`, `budget` are required in TS (matching Rust `Vec<T>`), Rust struct has `#[serde(default)]` for backward compat with old files, scene codec emits empty placeholders
- See root `CLAUDE.md` Document Authority Rule

**Panel identity semantics:**
- ~~Define explicit target identity types for timeline, budget, and consortium references before activating full panel↔canvas sync~~ — **done**: shared target union covers `placed_plant`, `species`, `zone`, `manual`, and `none`.
- ~~Timeline `plants` / `zone` ambiguity~~ — **done**: timeline actions now write explicit `targets`; v1 migration maps legacy plant refs to placed-plant IDs when they match existing placements, otherwise species targets, plus zone targets.
- ~~Budget `description` as identity key~~ — **done**: budget plant prices upsert and read by explicit species target; `description` remains display/category copy.
- ~~Consortium bare `canonical_name` identity~~ — **done**: consortium entries are species-targeted via `target`, while current chart behavior remains species aggregate based.
- ~~Add migration/repair rules for legacy timeline `plants`, budget `description` species rows, deleted plants/zones, and duplicate species placements~~ — **done**: legacy data is migrated into typed targets; unresolved/deleted targets remain explicit for later sync/highlight repair.
- ~~Add pure target resolver before UI sync~~ — **done** (`7bf5a54`): `resolvePanelTargets()` maps typed panel targets to scene IDs (plant IDs and zone names), reports missing scene-backed targets, and treats `manual` / `none` as intentionally empty without mutating canvas selection or history.
- ~~Add first panel→canvas hover bridge through target resolver~~ — **done**: bottom-panel hover state now carries `PanelTarget[]`; the scene runtime resolves it to plant/zone highlight IDs without mutating canvas selection or history. Current hover-only wiring covers consortium species hover, timeline action hover via `action.targets`, and budget row hover via the existing `BudgetItem.target` with species-target fallback.
- See architecture review Finding 2

**Canvas seam:**
- ~~Replace `CanvasSession` pass-through with a runtime interface (or give it real logic)~~ — **done**.
- Existing `CanvasRuntime` already defines the boundary that `SceneCanvasRuntime` implements. The implemented seam stores `CanvasRuntime | null` in `currentCanvasSession`; future API growth can still split this into:
  - command surface for toolbar/shortcuts/document actions: tool, selection, zoom, undo/redo, clipboard, grouping, document load/save lifecycle
  - read-only query surface for panels: placed plants, localized names, selected plant color context
- ~~Preserve the current `setCurrentCanvasTool()` behavior when no runtime is mounted: it primes the mirror tool state for later mount~~ — **done**.

### 2. Correctness (ongoing)
- Keep save/load strictly scene-authoritative for canvas entities
- Keep species-color edits stable across save and reload
- Keep annotation bounds consistent across selection, grouping, fit, and rendering
- Keep plant presentation geometry consistent across renderers, interaction, grouping, and fit

### 3. Performance
- Keep viewport-only updates on the renderer fast path
- Keep Pixi retained across pan/zoom; avoid per-tick scene-tree rebuilds
- Add scene-side spatial indexing only when profiling shows hit-testing or marquee is the bottleneck
- **MapLibre chunk/lifecycle isolation**: Verify `maplibre-gl` is in a separate Vite chunk. `WorldMapPanel` already lazy-loads `WorldMapSurface`, but `LocationTab` imports `maplibre-gl` directly; check the production bundle before changing imports. Keep `maplibre-contour` in the same async chunk when contour UI is reactivated. Flag any chunk >500KB. See roadmap QA.6b
- Verify timeline renderer is NOT in the main chunk (bottom panel is toggled)
- ~~Canvas DPR sizing and transform fixes~~ — **done**: `useCanvasRenderer` uses `Math.round()` + `setTransform()` (not `scale()`), ruler functions aligned to same pattern. Prevents buffer reallocation on fractional-DPR screens and transform accumulation across redraws
- ~~ConsortiumChart useMemo stability~~ — **done**: plants/consortiums read from refs with `sceneEntityRevision` as trigger dep, preventing O(n) `buildConsortiumBars` recomputation on every hover frame. `consortiums` added as direct dep to catch in-drag reorder changes (not covered by `sceneEntityRevision` when `markDirty: false`)
- ~~InteractiveTimeline `originDate` reference churn~~ — **done**: `computeOriginDate` returned a new `Date` every call, defeating `useMemo` dep comparison and forcing canvas redraws. Replaced with numeric `originMs` intermediate; `Date` only recreated when timestamp changes
- ~~InteractiveTimeline 60fps Date parsing~~ — **done**: `handleMouseMove` re-parsed `originalStartDate`/`originalEndDate` ISO strings on every pointermove. Pre-computed `originalStartMs`/`durationMs` in `DragState` at mousedown
- ~~BudgetTab event handler churn~~ — **done**: `startEditPrice`/`commitPrice` recreated on every render (new reference per keypress during editing). Wrapped in `useCallback` with `priceMapRef`
- ~~BudgetTab useMemo stability~~ — **done**: `getPlacedPlants()`/`getLocalizedCommonNames()` stored in refs with revision signals as deps (matching ConsortiumChart pattern), preventing O(n) `countPlants` recomputation on every keypress during price editing
- ~~CanvasPanel unnecessary locale subscription~~ — **done**: removed `void locale.value` — all children subscribe independently, parent re-render was wasted work
- ~~BottomPanel 60fps resize re-renders~~ — **done**: resize handler writes to DOM ref during drag, commits signal + persists settings on mouseup only via `commitBottomPanelHeight`. Prevents parent re-rendering all tab children at 60fps during panel resize

### 4. Safeguards
- **ErrorBoundary**: Add a Preact ErrorBoundary wrapping `main.tsx` — blank-screen crash protection. Small, no dependencies (see `docs/archive/roadmap.md` SG.0)
- **Pre-commit hooks**: Add husky + lint-staged (`tsc --noEmit`, `eslint`) — prevents broken commits during parallel agent work (see `docs/archive/roadmap.md` SG.1)

### 5. Moderate-priority cleanup
- Add real Rust → frontend → Rust round-trip test for file-format contract (see review Finding 3)
- Add explicit versioned `migrateDocument()` / `migrate_design_value()` load path before the first breaking schema change. Rust already has an ad hoc legacy consortium migration in `desktop/src/design/format.rs`; promote that pattern into a version-dispatched migration boundary instead of adding scattered one-off migrations.
- Remove `suncalc` dependency (celestial dial was pruned, no live code references it). Do not remove `maplibre-gl`; it is used by `LocationTab` and `WorldMapSurface`.
- Watch `JSON.stringify` diff cost in `scene-commands.ts` as designs grow
- ~~Hardcoded `rgba()` colors in `scene-interaction.ts` textarea~~ — **done**: replaced with CSS custom properties (`--color-surface`, `--color-primary`, `--color-text`, `--font-sans`, `--radius-sm`, `--text-base`). Remaining: `overlay-ui.ts` (selection band) still uses hardcoded `rgba()` — migrate to CSS variables for dark-mode correctness
- ~~Timeline action-type colors dark mode~~ — **done**: replaced hardcoded hex `ACTION_COLOR_DEFAULTS` with `ACTION_COLOR_VARS` (CSS var name + hex fallback). Added `--color-action-*` tokens to `global.css` with dark-mode overrides
- ~~Timeline bar label dark mode~~ — **done**: in-bar text used `surfaceColor` (invisible in dark mode). Switched to `--color-primary-contrast`. CSS fallback hex values aligned across `timeline-renderer.ts` and `consortium-renderer.ts`
- ~~Consortium-actions no-op spreading~~ — **done**: `updateConsortiums` wrapper checked reference identity before spreading, preventing spurious dirty marks on no-op reorders. Extended to `moveConsortiumEntry` (`findIndex` + value comparison guard) and `deleteConsortiumEntry` (`some()` guard before `filter()`) — all action updaters now short-circuit on no-op
- ~~Dead i18n keys from pre-redesign budget/timeline CRUD~~ — **done**: 31 dead keys removed across 11 locales (~310 stale translations)
- ~~Timeline planting green in UI chrome~~ — **done**: replaced `#5A7D3A` (green) with `#7D6049` (walnut brown) in `ACTION_COLOR_DEFAULTS`. "Green NEVER in UI chrome" rule enforced
- ~~`budget_currency` undefined on new designs~~ — **done**: `serializeDocument()` now falls back to `'EUR'` instead of emitting `undefined`
- ~~TimelineTab spurious canvas subscription~~ — **done**: removed `sceneEntityRevision` read — timeline is pure document state with no canvas dependency
- ~~Native `<select>` in TimelineTab~~ — **done**: replaced with custom `Dropdown` component + `actionType` i18n key in all 11 locales
- ~~BottomPanel 60fps resize re-renders~~ — **done**: resize uses direct DOM manipulation during drag, signal write only on mouseup via `commitBottomPanelHeight` action. Dead `setBottomPanelHeight` removed
- ~~Sidebar 60fps resize re-renders~~ — **done**: `App.tsx` sidebar drag writes to DOM ref during drag, commits `sidePanelWidth` signal on mouseup only (matching BottomPanel pattern)
- ~~ConsortiumChart unmount mid-drag~~ — **done**: cleanup effect calls `markDocumentDirty()` only if `dragState.hasMutated` is true — no spurious dirty on mousedown-then-tab-switch without movement
- ~~Canvas2D font fallback consistency~~ — **done**: extracted `FONT_SANS_FALLBACK` to `canvas2d-utils.ts`, used by `consortium-renderer.ts`, `timeline-renderer.ts`, and `rulers.ts`. Ruler font strings cached in `_rulerFont10`/`_rulerFont11` via `refreshRulerColors()` (not `cssVar()` per frame)
- ~~Canvas2D theme token duplication~~ — **done**: extracted `readThemeTokens()` to `canvas2d-utils.ts` — shared CSS token reader (bg, surface, border, text, textMuted, primary, primaryContrast, fontSans) used by both `consortium-renderer.ts` and `timeline-renderer.ts`. Renderer-specific tokens still use `cssVar()` directly
- ~~InteractiveTimeline spurious dirty on click~~ — **done**: `handleMouseUp` called `markDocumentDirty()` on any non-pan mouseup even without movement. Added `hasMutated: boolean` to `DragState` (matching ConsortiumChart pattern), gated both mouseup and unmount cleanup
- ~~BottomPanel resize height lost on unmount mid-drag~~ — **done**: `ResizeHandle` tracks `lastClientY` during drag for accurate commit on mouseup. Unmount calls `cleanup(false)` to discard partial drag height — avoids persisting half-dragged state to settings
- ~~`updateConsortiums`/`updateTimeline` duplication~~ — **done**: extracted `updateDesignArray<K>()` generic helper in `document-mutations.ts`. Both action modules now delegate to it, passing `options` directly (no double-negation of `markDirty`)
- ~~Dead `selectedCanonical` in consortium renderer~~ — **done**: removed always-null field from `ConsortiumRenderState`, deleted `isSelected` dead branch in render loop
- ~~Timeline `pxPerDay=0` infinite loop~~ — **done**: `renderTimeline` early-returns when `pxPerDay <= 0` (happens before initial layout measurement). `niceInterval` returned `intervalMs=0`, causing infinite tick loop
- ~~BottomPanel double `commitBottomPanelHeight`~~ — **done**: `releasePointerCapture()` in `pointerup` caused `lostpointercapture` to fire, running cleanup twice. Added `cleaned` boolean guard
- ~~Rulers mousedown listener leak~~ — **done**: `setupRulerDrag` stored handler refs so `destroy()` can `removeEventListener` before `remove()`
- ~~LocationInput stale null-guard~~ — **done**: `save()`/`clear()` used render-time `design` for guard while mutations used `currentDesign.peek()`. Aligned guards to `.peek()`
- ~~Scale-bar/ruler formatting inconsistency~~ — **done**: `_formatDist` (scale-bar) and `_formatDistance` (rulers) had divergent unit spacing (`"40 cm"` vs `"40cm"`). Unified to no-space format
- ~~InteractiveTimeline scrollY snapshot inconsistency~~ — **done**: `scrollX` was in `TimelineRenderState` but `scrollY` was a separate param — inconsistent snapshot during diagonal pan. Consolidated `scrollY` into `TimelineRenderState`, removed separate param from `renderTimeline`/`hitTestAction`
- ~~Dead `HitEdge` type alias~~ — **done**: exported from `timeline-renderer.ts` with zero consumers. Inlined into `HitResult` interface, then narrowed to `edge: 'body'` (the `| null` arm was unreachable — no code path returns null)
- ~~Timeline `order` duplicate after delete~~ — **done**: `addTimelineAction` computes `max(existing orders) + 1` instead of `timeline.length`
- ~~`openBottomPanel` intermediate re-renders~~ — **done**: wrapped multi-signal writes in `batch()`, removed stale `_heightInitialized` guard that overwrote Rust-persisted height
- ~~InteractiveTimeline `onWheel` passive listener~~ — **done**: JSX `onWheel` registers as passive by default — `preventDefault()` silently failed. Replaced with imperative `addEventListener({ passive: false })` in `useEffect`
- ~~`serializeDocument` null doc type safety~~ — **done**: tightened `doc` param from `CanopiFile | null` to `CanopiFile` across interface/session/runtime. Guards at call sites (`document.ts`, `document-actions.ts`) make null-before-save a compile error instead of silent data loss
- ~~Redundant `void signal.value` top-level reads~~ — **done**: removed from `ConsortiumChart` (`sceneEntityRevision`, `plantNamesRevision`), `BudgetTab` (same), `TimelineTab` (`locale`). `useMemo` deps already maintain subscriptions — the top-level reads caused full component re-renders on every canvas mutation
- ~~`hitTestBar` dead `_height` parameter~~ — **done**: never read inside the function. Removed from signature + all 6 call sites
- ~~Duplicate `SceneBounds` interface~~ — **done**: `scene-runtime.ts` had local copy identical to `camera.ts` export. Replaced with import
- ~~Duplicate `cachedRectRef` ResizeObserver pattern~~ — **done**: both `ConsortiumChart` and `InteractiveTimeline` had identical 7-line `useEffect` blocks. Added optional `cachedRectRef` param to `useCanvasRenderer`, removed duplicate observers
- ~~`guides` double-subscription in effects.ts~~ — **done**: `guides.value` was in both `onChromeOverlay` and `onLayerSignals`, causing two renders per guide change. Removed from `onChromeOverlay` — `onLayerSignals` path handles both sync and invalidation
- ~~ConsortiumChart drag reorder TOCTOU~~ — **done**: used `currentDesign.peek().consortiums` instead of `consortiumsRef.current`, creating snapshot mismatch with `barsRef` during rapid drag. Aligned to ref
- ~~InteractiveTimeline stale `lastDragDates`~~ — **done**: not reset in `handleMouseUp` — stale dedup guard persisted to next drag. Added reset
- ~~`BottomPanel` unnecessary height signal subscription while closed~~ — **done**: `bottomPanelHeight.value` read before `!open` early return subscribed component while closed. Moved after guard
- ~~`Math.min/max(...spread)` on zone polygon bounds~~ — **done**: `getMemberBounds` and `groupSelected` used spread on unbounded arrays. Replaced with for-loop reduction per CLAUDE.md convention
- ~~`upsertConsortiumEntry` identity guard~~ — **done**: spreading `updated[idx] = entry` always created new object even when all fields unchanged. Added field-comparison guard (stratum, start_phase, end_phase)
- ~~`BottomPanel` tab signal subscription while closed~~ — **done**: `bottomPanelTab.value` read before `!open` early return. Moved after guard (matching height fix)
- ~~Consortium renderer dark-mode surface-muted fallback~~ — **done**: hardcoded `#E8E2D6` light-mode fallback for `--color-surface-muted` produced bright band in dark mode. Changed to `theme.surface` (theme-safe degradation)
- ~~Timeline renderer sidebar double-stroke~~ — **done**: border drawn at full height, then ruler fill covered top portion, then border redrawn for ruler segment. Consolidated to single full-height draw after all fills
- ~~`hitTestBar` impossible body hit on narrow bars~~ — **done**: `EDGE_THRESHOLD * 2 = 12 > min bar width = 8` meant edge zones consumed entire bar. Added guard to return `'body'` when bar width ≤ threshold
- ~~`InteractiveTimeline` `handleMouseDown` unstable deps~~ — **done**: called `onSelect`/`onEditRequest` props directly despite `onSelectRef`/`onEditRequestRef` already existing. Switched to ref calls with `[]` deps; pan/drag start values use `.peek()`
- ~~`commitBottomPanelHeight` spurious IPC~~ — **done**: no change guard — `persistCurrentSettings()` called on every mouseup even when height unchanged. Added equality check
- ~~`updateTimelineAction` incomplete field-compare~~ — **done**: identity guard omitted `plants` and `depends_on` array fields — future callers patching only those fields would silently no-op. Guard now covers all 10 `TimelineAction` fields
- ~~`Date.now()` in timeline `computeLayout`~~ — **done**: dateless actions sorted by wall-clock time, causing non-deterministic lane assignment across re-renders. Replaced with `Infinity` (stable, sorts last)
- ~~`getSceneStore()` interface return type~~ — **done**: `CanvasRuntime` interface declared `SceneStore | null` but implementation never returns null. Removed `| null`
- ~~`?? []` dead fallbacks on required CanopiFile fields~~ — **done**: removed from `normalizeDocument` (5 fields) and `serializeDocument` (3 fields). Rust `#[serde(default)]` guarantees presence; TS fallbacks masked type errors
- ~~`STRATUM_ORDER` duplication in FilterStrip~~ — **done**: hand-copied `['emergent', 'high', 'medium', 'low']` replaced with import from `STRATA_ROWS` in `consortium-renderer.ts`
- ~~Hardcoded `'unassigned'` in consortium sync workflow~~ — **done**: replaced string literal with `DEFAULT_STRATUM` derived from `STRATA_ROWS` constant
- ~~Missing `'other'` action type color~~ — **done**: `ACTION_COLOR_VARS` had no entry for `'other'`, fell through to `fertilising` color. Added `--color-action-other` CSS variable (light + dark mode) and mapped in renderer
- ~~Redundant `gridHeight` reduce in consortium renderer~~ — **done**: `rowHeights.reduce()` duplicated work already done by `computeRowYOffsets`. Derived from `rowOffsets[last] - HEADER_HEIGHT` instead
- ~~ConsortiumChart/InteractiveTimeline ghost hover on fast mouse exit~~ — **done**: added `onMouseLeave` handlers to both canvas components, clearing `hoveredCanonical`/`hoveredConsortiumSpecies`/`hoveredId` signals and resetting cursor
- ~~`scene-interaction.ts` getBoundingClientRect at 60fps during drag~~ — **done**: added `_cachedContainerRect` field, cached on `pointerdown`, used in `_screenPoint()`, cleared in `_cancelTransientInteraction`
- ~~Consortium renderer save/restore pairing~~ — **done**: entire per-bar block (fill, border, shadow, labels) wrapped in single `ctx.save()`/`ctx.restore()`. Removes fragile manual `globalAlpha = 1` resets. Column headers and phase dividers also use save/restore
- ~~Test fixture inconsistencies~~ — **done**: added missing `extra: {}` (location-actions), `consortiums: []`/`annotations: []`/`extra: {}` (phase3-regression), IPC mock (canvas-actions), fixed tautological store.test round-trip assertion (non-empty input → empty placeholder output)
- ~~`useCanvasRenderer` `doRedraw` ignoring `cachedRectRef`~~ — **done**: hover path used `cachedRectRef` but dep-triggered redraws called `getBoundingClientRect()` unconditionally. `doRedraw` now reads from `cachedRectRef` when available, avoiding forced layout reflow at 60fps during pan/hover
- ~~`InteractiveTimeline` `originDate` reference churn in deps~~ — **done**: `originDate` (`Date` object) in `useCanvasRenderer` deps created new reference every render when `originMs` was stable. Replaced with `originMs` (number) in deps; `Date` derived inside render callback from ref
- ~~ConsortiumChart document-level cleanup stale dragState~~ — **done**: cleanup only removed listeners but didn't null `dragState.current`. Added `markDocumentDirty()` + `dragState.current = null` in cleanup (matching `InteractiveTimeline` pattern) to prevent stale ref on rapid tab re-mount
- ~~ConsortiumChart resize `hasMutated` spurious dirty~~ — **done**: `drag.hasMutated = true` was set after both branches, reachable when `bar` is null. Moved inside each branch after `moveConsortiumEntry` so it's only set on actual mutation
- ~~Plant-counting loop duplication~~ — **done**: identical species-grouping logic existed in `budget-helpers.ts` and `consortium-renderer.ts`. Extracted `groupPlantsBySpecies()` to `canvas/plant-grouping.ts`, consumed by both
- ~~InteractiveTimeline Delete/Backspace in form inputs~~ — **done**: document-level `keydown` handler captured Delete/Backspace globally when a timeline action was selected, preventing text editing in description/date form inputs. Added `isEditableTarget()` guard from `pointer-utils.ts`
- ~~Consortium renderer `ctx.save()` ordering~~ — **done**: `fillStyle`/`font` set before `ctx.save()` in row-label loop — `ctx.restore()` couldn't reset them, leaking canvas state. Moved `ctx.save()` before all state mutations
- ~~Timeline dateless action sort/lane-packing inconsistency~~ — **done**: sort fallback `0` vs lane-packing `Infinity` caused dateless actions to sort first then permanently block their lane (endMs=Infinity), producing O(n) unnecessary sub-lanes. Aligned sort to `Infinity`
- ~~TimelineTab missing `font-weight: 600`~~ — **done**: chip, toolBtn, addBtn, saveBtn, cancelBtn, emptyAddBtn all missing weight. Interactive elements rendered at browser default 400 instead of label weight 600
- ~~`Intl.NumberFormat` per-row construction in BudgetTab~~ — **done**: `formatCurrency` created new formatter on every call (~40-60 calls per render with 20 species). Added module-level `Map<string, Intl.NumberFormat>` cache keyed by currency
- ~~`.exportBtn` missing `font-weight`~~ — **done**: interactive button inherited body weight 400 instead of label weight 600. Added `font-weight: 600` per typography rule

### 6. Documentation
- Keep canvas/runtime/renderer docs aligned with the live architecture
- Move historical migration detail into archive docs

## Deferred Product Work

**MapLibre / geo:**
- Current MapLibre usage: full-screen location shell (`LocationTab`) and dynamically loaded featured-design world map (`WorldMapSurface`). These are document-derived UI surfaces, not canvas authorities.
- In-canvas MapLibre layers (via dedicated `MapLibreController` — see root `CLAUDE.md` MapLibre Integration Rule)
- Local tangent plane projection math in `canvas/projection.ts` (`lngLatToMeters` / `metersToLngLat`) — prerequisite for MapLibre viewport sync (see `docs/archive/roadmap.md` 4.0c)
- PMTiles offline tiles: Rust reader + Tauri custom protocol + download manager UI (see `docs/archive/roadmap.md` 4.2)
- Contour/hillshade layers via `maplibre-contour` + DEM tiles (see `docs/archive/roadmap.md` 4.3/4.4)

**Bottom panels (MVP shipped):**
- ~~Timeline MVP~~ — **done** (`d56ab50`): trimmed week view, zoom, edge resize, auto-populate, completed UI. Tab routing active
- ~~Budget tab~~ — **done**: redesigned with compact summary header (species/plant counts, pricing progress), document-level currency picker (13 currencies via `budget_currency` field), notebook-style ruled table, inline price editing, CSV export. Live updates via `sceneEntityRevision`
- ~~Consortium succession chart~~ — **done** (`9fd8cf3`..`1007a96`): Canvas2D strata×phase grid, auto-sync from placed species, drag-move/resize, hover sync with canvas
- ~~Bottom panel state persistence~~ — **done**: open/height/tab hydrated from Rust settings on bootstrap, persisted on panel actions (height persisted on drag-end, not per-frame)
- Remaining: timeline/budget selection wiring using the pure target resolver, canvas→chart hover direction, panel↔map sync

**Other:**
- Featured-design world map / template import
- Template adaptation (hardiness comparison, replacement suggestions — see `docs/archive/roadmap.md` 7.2, distinct from import)
- Export (PNG/SVG/CSV/GeoJSON)
- Knowledge / learning content surface
- Pen/stylus input support (requires hardware testers — see `docs/archive/roadmap.md` 5.4)

## Deferred Quality Work

- **Async/blocking UX audit**: Identify every frontend `await` of a slow IPC call that blocks rendering — geocoding in `LocationInput.tsx`, photo carousel in detail card, filter options on first mount (see `docs/archive/roadmap.md` QA.2)
- **Memory leak audit**: Review resource lifecycle for MapLibre instances, module-level effects, autosave timers, panel mount/unmount (see `docs/archive/roadmap.md` QA.4)
- **Network/disk resilience**: Audit failure paths — geocoding timeout, image cache fallback, disk-full autosave, template download validation (see `docs/archive/roadmap.md` QA.5)
- **Security surface review**: Markdown sanitization in `markdown.ts`, `validated_column()` allowlist completeness, geocoding URL encoding (see `docs/archive/roadmap.md` QA.6c)
- **Design coherence (DC) phase**: Systematic CSS token migration across 34 modules — see `docs/archive/roadmap.md` Phase DC. Most canvas dark-mode bugs (BUG-002–006) are already fixed via `theme-refresh.ts` + CSS variables; remaining hardcoded colors listed in active work section 5
- **Test foundation**: Signal state tests, canvas operation tests, CI coverage reporting (see `docs/archive/roadmap.md` SG.2)

## Guardrails

- Do not reintroduce renderer-owned truth
- Do not add escape hatches that expose renderer internals to app code
- Do not move annotations back under `extra`
- Do not reintroduce `plantDisplayMode` or split plant presentation authority
- Do not reintroduce full scene rebuilds on viewport-only updates
- Do not push non-canvas state (consortiums, timeline, budget) into `SceneStore` — **enforced**: save-path split-brain fix removes all non-canvas state from ScenePersistedState
- Do not add new ad hoc signal mirrors — use computed/derived signals or single-writer pattern (see root `CLAUDE.md` Signal Mirror Rule). Both `designLocation` and `currentConsortiums` mirrors were removed entirely
- Bottom-panel tabs are active — consortium auto-sync runs at document level via `consortium-sync-workflow.ts`
- Do not make MapLibre a second document authority
- Do not add full panel↔canvas or panel↔map sync without resolving typed targets through the pure resolver; do not reintroduce string matching.

## Exit Criteria For Convergence Phase

- ~~Document authority boundary is explicit~~ — **done**: canvas state in SceneStore, non-canvas in document store, save composes both
- ~~Save path composes from two authorities without re-merging~~ — **done**: `serializeDocument()` spreads canvas output + document store sections
- ~~Panel identity semantics are defined and typed (not stringly-typed string arrays)~~ — **done**
- ~~Legacy identity data is migrated or interpreted through one compatibility adapter: timeline `plants`/`zone`, budget `category + description`, consortium species entries~~ — **done**
- ~~`CanvasSession` is either replaced with an interface, split into command/query surfaces, or given real logic~~ — **done**
- ~~File-format round-trip coverage exists for Rust load/save and frontend serialize paths, including unknown top-level fields and populated timeline/budget/consortium/location sections~~ — **done**: migration and v2 round-trip coverage now exercise populated panel/location sections and unknown top-level field preservation.
- ~~Architecture review Finding 1 resolved~~ — **done**; ~~Finding 2 resolved~~ — **done**
