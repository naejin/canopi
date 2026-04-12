# Canvas Runtime: Scene-Owned Production Path

## Current Status (2026-04-08)

The live canvas now runs through `SceneCanvasRuntime`.

Production ownership is:
- `CanvasPanel` mounts `SceneCanvasRuntime`
- `SceneCanvasRuntime` implements the app-facing `CanvasRuntime` interface; `currentCanvasSession` stores `CanvasRuntime | null` directly
- `SceneStore` is the source of truth for **canvas scene state** (plants, zones, annotations, groups, layers, plant-species-colors). Non-canvas document sections (consortiums, timeline, budget, `budget_currency`, location, description, extra) are owned by the document store — see root `CLAUDE.md` Document Authority Rule
- `RendererHost` owns backend selection, startup fallback, and runtime recovery
- `PixiJS` is the primary world renderer
- `Canvas2D` is the fallback renderer
- Future in-canvas MapLibre must be a derived visualization layer managed by a dedicated controller, not embedded in the canvas runtime (see root `CLAUDE.md` MapLibre Integration Rule)

Landed in the live path:
- scene-owned load/replace/save flows
- scene-owned selection, drag, rectangle creation, text annotations, plant-stamp placement, and drag-drop placement
- command/patch history in `scene-history.ts` and `scene-commands.ts`
- first-class top-level document `annotations`
- typed panel-target hover/selection highlights via `PanelTarget[]` + `resolvePanelTargets()`
- pure panel-target map projection via `projectPanelTargetsToMapFeatures()` for future rendered overlays

Konva / `CanvasEngine` code has been removed. Do not reintroduce Konva or `getEngine()`-style escape hatches.

## Architecture Rules

### Public Seams
- App code must not reach into renderer implementations or runtime internals
- The app-facing canvas boundary is the `CanvasRuntime` TypeScript interface implemented by `SceneCanvasRuntime`; the old 1:1 `CanvasSession` pass-through class is gone
- As bottom panels/map surfaces need more derived data, consider splitting `CanvasRuntime` into two interfaces: one for **interaction commands** (tools, selection, history, zoom) and one for **state queries/projections** (entity reads for panels, bounds/features for map sync). Both should still be implemented by the runtime or pure helpers, not by renderer internals

### State Ownership
- `SceneStore` owns **canvas scene state**: plants, zones, annotations, groups, layers, plant-species-colors, and ephemeral session state (selection, viewport, hover, presentation modes)
- Non-canvas document sections (consortiums, timeline, budget, `budget_currency`, location, description, extra) are **not** owned by `SceneStore` — they belong to the document store. See root `CLAUDE.md` Document Authority Rule
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects
- Canvas-owned document fields serialize from the live scene, not from stale document input copies
- Top-level `annotations` belong in the schema; do not put live annotations back under `extra`
- Plant presentation state lives in `SceneStore.session`, not in standalone canvas signals
- The only active presentation fields are `plantSizeMode` and `plantColorByAttr`
- Selection truth lives in `SceneStore.session.selectedEntityIds`
- Canvas signals such as `selectedObjectIds`, `plantSizeMode`, and `plantColorByAttr` are UI mirrors, not runtime authority. Prefer computed/derived signals over manually-synced mirrors (see root `CLAUDE.md` Document Authority Rule)
- Panel-origin target hover/selection signals are presentation inputs only. Resolving `hoveredPanelTargets` or `selectedPanelTargets` must not mutate real canvas selection, labels, dirty state, or history unless a future slice explicitly designs that behavior

### Rendering Ownership
- `RendererHost` owns backend lifecycle, capability probing, and fallback
- renderers are projections of scene state, never the source of truth
- camera transforms go through `CameraController`; do not invent a second transform authority
- screen-space chrome such as rulers stays outside the world renderer
- renderers may cache scene state internally, but viewport-only updates must not require a fresh runtime scene snapshot
- `renderScene()` is for scene/presentation/selection rebuilds; `setViewport()` is for camera-only updates
- Pixi keeps retained per-entity world objects across viewport changes; viewport updates may only retune transform- or scale-sensitive overlay details

### Interaction Ownership
- `SceneInteractionController` owns live pointer and drag behavior
- Hit testing and selection geometry must stay scene-side
- Off-canvas drag continuation, multi-drag, and additive selection behavior are part of the contract
- Plant hit testing must use the same shared presentation context as renderers and fit/bounds logic
- Interaction selection writes must go through the runtime-owned selection seam; runtime logic must read authoritative selection from scene session
- Future in-canvas MapLibre interaction (map pan/zoom, click-on-map) belongs in a MapLibre controller, not in `SceneInteractionController`. The two should coordinate through `CameraController` for viewport sync

### Panel Target Projection Rules
- Timeline, budget, and consortium identity is typed with `PanelTarget[]` / `PanelTarget`; do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields
- Use `resolvePanelTargets()` to map typed panel targets to scene plant/zone IDs for canvas highlights
- Use `projectPanelTargetsToMapFeatures()` to turn typed panel targets into map-ready plant point / zone polygon features for future rendered overlays
- `manual` and `none` targets are intentionally empty, not unresolved errors
- Canvas-origin hover uses `hoveredCanvasTargets` and must remain separate from panel-origin hover/selection ownership

### Annotation Rules
- annotation geometry must come from shared helpers in `runtime/annotation-layout.ts`
- use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines
- visible text should win hit testing over underlying zones/plants when it is on top

### Plant Presentation Rules
- plant geometry, color, and stack badges come from `runtime/plant-presentation.ts`
- **no per-plant labels on canvas** — plant identification is via hover tooltip (common name + scientific name) and selection labels (one per species at centroid)
- hover tooltip is an HTML overlay managed by `SceneInteractionController` via `runtime/interaction/hover-tooltip.ts`
- hover species highlight (ring on all same-species plants) flows through `hoveredCanonicalName` in the renderer snapshot
- selection labels are computed by `runtime/selection-labels.ts`, separate from the presentation pipeline; both renderers recompute labels on viewport change
- size mode and color mode are independent axes; do not reintroduce a combined `plantDisplayMode`
- bounds, zoom-to-fit, grouping, renderers, and interaction must all consume the same resolved presentation state
- **Designs auto-fit to content on open**: Both document-load paths call `session.zoomToFit()` after hydration. Safe for empty/new designs — `computeSceneBounds()` returns null and the camera returns the current viewport unchanged
- species-cache backfill may enrich plant metadata, but production geometry should never depend on ad hoc empty-cache fallbacks
- **Default-mode dot sizing is world-proportional**: `PLANT_WORLD_RADIUS = 0.12m` (24cm diameter) gives ~80% fill at 30cm spacing, ~48% at 50cm. Screen size is capped at `CIRCLE_SCREEN_PX` (8px) when zoomed in and floored at `MIN_SCREEN_PX` (2px) when zoomed far out. Do not reintroduce fixed screen-pixel sizing — it causes unreadable overlap in dense designs. Do not use `zoomReference` as a pivot — it's design-dependent and produces inconsistent behavior

### Hover & Tooltip Rules
- `SceneInteractionController._updateHover()` hit-tests on idle `pointermove` (when `_pointerId === null`)
- `_onPointerMove` is on `window`, not container — hover path must bounds-check via `getBoundingClientRect()` (single call, CLAUDE.md hot-path rule)
- hover tooltip is a plain `.ts` module using inline styles with CSS custom properties — no CSS Module (no project precedent for CSS Module imports from `.ts` files)
- `hoveredEntityId` flows: interaction controller → session state → renderer snapshot (`hoveredCanonicalName`) → highlight ring
- selection labels are computed per-species at centroid by `selection-labels.ts`; both renderers must recompute labels in `setViewport()` for pan/zoom tracking
- **do not reintroduce per-plant labels** — the label collision/dedup/placement system was deleted because it is fundamentally unreadable at dense planting scales

### Known Cleanup
- `PlantLOD = 'icon+label'` is a dead value — labels were removed but the LOD type still produces this value. Neither renderer reads `entry.lod`. Clean up when next touching `plants.ts` or `plant-presentation.ts`

### Invalidation Rules
- use scene invalidation for content, selection, presentation, locale, theme, and hover changes
- use viewport invalidation for pan, zoom, and fit operations
- use chrome invalidation for rulers, grid, and guide-only changes
- do not route viewport-only work through the full scene render path

## Runtime Split

```
App code
  ├── CanvasRuntime interface (interaction + state queries)
  │     └── SceneCanvasRuntime
  │           ├── SceneStore (canvas scene state)
  │           ├── SceneInteractionController
  │           ├── CameraController
  │           ├── SceneHistory / SceneCommands
  │           ├── RendererHost
  │           │   ├── Pixi scene renderer
  │           │   └── Canvas2D scene renderer
  │           └── HTML rulers / overlay chrome
  ├── Future MapLibreController (derived visualization, sibling to runtime)
  │     └── syncs viewport via CameraController
  └── Document store (non-canvas state: consortiums, timeline, budget, budget_currency, location, description, extra)
        └── state/design.ts + state/document.ts
```

## Active Work

The rewrite cutover is complete. Konva dependency has been fully removed. Current focus is narrow panel/map expansion and cleanup:
- Keep save/load strictly scene-authoritative for canvas entities
- Keep annotation geometry consistent across runtime, interaction, and renderers
- Keep plant presentation state scene-session-owned and geometry consistent across all consumers
- Keep typed panel-target bridges resolver-based and presentation-only unless a future slice explicitly designs real selection/history behavior
- Preserve the lazy import boundary around `maplibre-gl` for bundle size; verify chunk/lifecycle behavior before changing imports
- Keep docs synchronized with the live scene runtime

### Consortium Succession Chart
- `consortium-renderer.ts` follows the same Canvas2D pattern as `timeline-renderer.ts` — pure render + hit test, no component state
- `computeBarRect()` is the shared geometry helper — used by both `renderConsortium()` and `hitTestBar()`. Do not duplicate bar geometry computation
- **Right-edge drag must compensate for `endPhase + 1` rendering offset**: `computeBarRect` renders the right edge at `phaseToX(endPhase + 1)`. Drag handlers converting mouseX back via `xToPhase` must subtract 1 for the right edge. The right-edge clamp range must be `[0, CONSORTIUM_PHASES.length]` (not `length - 1`) so the last column remains reachable after the subtraction. Left edge has no offset — no compensation needed
- **`xToPhase` upper clamp is `CONSORTIUM_PHASES.length` (not `length - 1`)**: Fixed 2026-04-10. The function must return up to `length` (7) so the right-edge resize handler's `-1` can reach climax (phase 6). Left-edge and move-drag callers have their own downstream `length - 1` clamps
- **`useCanvasRenderer` accepts optional `cachedRectRef` parameter**: Pass a `useRef<DOMRect | null>(null)` as the 4th argument — the hook uses it in `doRedraw` (avoids `getBoundingClientRect()` on dep-triggered redraws at 60fps) and the ResizeObserver invalidates it on resize. Do not create a separate ResizeObserver for `cachedRectRef` invalidation
- **Renderers and hit-testers accept optional `rowOffsets`/`cachedRowOffsets` param**: Callers cache offsets in a ref via `useMemo` and pass them in to avoid per-frame recomputation. Both `renderTimeline` and `hitTestAction` follow this pattern
- **Drag `cachedRect` pattern**: Store `canvas.getBoundingClientRect()` in `DragState.cachedRect` during `mousedown`. Use `drag?.cachedRect ?? canvas.getBoundingClientRect()` in `mousemove` — avoids forced layout at 60fps during drag. Both `ConsortiumChart` and `InteractiveTimeline` follow this pattern
- Consortium, timeline, and budget hover bridge to canvas highlights through `hoveredPanelTargets`; timeline/budget panel-origin selection uses `selectedPanelTargets` plus `selectedPanelTargetOrigin`
- **Within-stratum drag reorder is correct with mixed-strata arrays**: `reorderConsortiumEntry` uses `findIndex` on the target bar's canonical name to get its absolute array index, then splice remove-then-insert. This correctly preserves intra-stratum ordering even when entries from other strata are interleaved in the array — the relative order of same-stratum entries changes while other-stratum entries stay in place. Do not "fix" this by switching to stratum-relative indexing
- **Consortium sync diffs against actual consortium state, not a cache**: `consortium-sync-workflow.ts` compares `getPlacedPlants()` names against `design.consortiums` entries directly on each `sceneEntityRevision` bump. Do not add a `lastSyncedNames` cache — it introduces stale-state bugs when consortiums are modified externally (template import, undo) and the `toAdd/toDelete` emptiness check is a sufficient no-op guard
- `sceneEntityRevision` is incremented in `_markCanvasDirty()`, `undo()`/`redo()`, `loadDocument()`, and `replaceDocument()` — if adding a new mutation path, it must also increment this signal or bottom-panel components will not update
- **No raw `rgba()` in Canvas2D renderer fallbacks** — use hex fallbacks (e.g., `'#D4CFC5'`) not `rgba(0,0,0,0.12)`. Raw rgba with black/brown components breaks dark mode. The `cssVar()` call handles theming; the fallback is for missing-variable edge cases only
- **Action-type colors use CSS variables**: `timeline-renderer.ts` resolves action colors via `cssVar('--color-action-<type>') || hexFallback` — tokens defined in `global.css` with dark-mode overrides. Follow the `ACTION_COLOR_VARS` pattern (CSS var name + hex fallback tuple) when adding new renderer-specific color categories
- **Use `readThemeTokens()` from `canvas2d-utils.ts`** for shared CSS tokens (bg, surface, border, text, textMuted, primary, primaryContrast, fontSans). Renderer-specific tokens (e.g., `--color-danger`, `--color-surface-muted`) still use `cssVar()` directly
- **`Date` objects defeat `useMemo`/`useCanvasRenderer` dep comparison**: `new Date()` always creates a new reference. When a date-derived value is needed as a dep, use the numeric millisecond intermediate (`originMs`) in the dep array, not the `Date` object. Derive the `Date` inside the render callback from a ref. See `InteractiveTimeline.tsx` for the pattern
- **`ACTION_COLOR_VARS` must cover all `ACTION_TYPES`**: Every action type in `TimelineTab.tsx`'s `ACTION_TYPES` array must have a matching entry in `timeline-renderer.ts`'s `ACTION_COLOR_VARS` AND a `--color-action-<type>` CSS variable in `global.css` (light + dark). Missing entries fall through to `DEFAULT_ACTION_COLOR` which shares another type's color — visually indistinguishable
- **`STRATA_ROWS` is the single source for stratum ordering**: `FilterStrip.tsx` and `consortium-sync-workflow.ts` must import from `consortium-renderer.ts`, not maintain independent copies. Default stratum for new consortium entries is `STRATA_ROWS[STRATA_ROWS.length - 1]` (`'unassigned'`)
- **`Date.now()` / `Infinity` in layout sort fallbacks**: Dateless timeline actions use `Infinity` (sort last, stable) not `Date.now()` (non-deterministic, defeats `useMemo`). Both the sort comparator AND the lane-packing fallback must use the same value — using `0` in sort but `Infinity` in lane-packing causes dateless actions to sort first then permanently block their lane (`endMs = Infinity`), producing O(n) unnecessary sub-lanes. See `computeLayout` in `timeline-renderer.ts`
- **`endMs` fallback must also guard `Infinity`**: The `Infinity` sort/lane-packing rule covers the sort comparator, but `endMs = startMs + 86400000` silently produces `Infinity` when `startMs` is `Infinity` — use `isFinite(startMs) ? startMs + 86400000 : Infinity`
- **Use `FONT_SANS_FALLBACK` from `canvas2d-utils.ts`** for all Canvas2D font strings — `cssVar('--font-sans') || FONT_SANS_FALLBACK`. Do not hardcode different fallback strings across renderers. `FONT_SANS_FALLBACK` is `'Inter, system-ui, sans-serif'`
- **Ruler fonts are cached like ruler colors**: `_rulerFont10` and `_rulerFont11` are module-level cached strings refreshed in `refreshRulerColors()`. Do not call `cssVar('--font-sans')` inside per-frame ruler draw functions — use the cached values instead
- **Canvas2D renderer CSS fallback hex values must be consistent** across `consortium-renderer.ts` and `timeline-renderer.ts` — both render in the same viewport and must use identical fallbacks for shared tokens (`--color-bg`, `--color-surface`, `--color-text`, etc.)
- **`bars` useMemo must include `consortiums` in deps**: `sceneEntityRevision` alone is insufficient — `reorderConsortiumEntry` during drag uses `markDirty: false` which doesn't increment `sceneEntityRevision`. The `consortiums` array ref from `currentDesign` is stable (only changes on `mutateCurrentDesign`), so it's safe as a dep alongside the revision signals
- **Date formatting in Canvas2D renderers**: Use `Intl.DateTimeFormat` (or `date.toLocaleDateString(locale, ...)`) — never hardcoded English month arrays. Thread `locale` through the render state object alongside `t`
- **Canvas2D text buttons must use `ctx.measureText()` for positioning**: Hardcoded pixel offsets break with variable-width i18n translations. Measure text dynamically, store computed bounds in a shared mutable object (e.g., `rulerControlBounds`) for hit-testing. See `timeline-renderer.ts`
- **No module-level mutable state for per-instance data**: Canvas2D helpers that cache theme colors (grid colors, ruler colors) must use instance properties, not `let` variables at module scope — multiple instances overwrite each other
- **Unmount mid-drag cleanup**: Canvas2D tab components must call `markDocumentDirty()` only when `dragState.current?.hasMutated` is true, then clear the ref. The normal `handleMouseUp` path will not fire if the component unmounts mid-drag, but mousedown-without-movement must not mark dirty
- **Guard `pxPerDay <= 0` in `renderTimeline`**: Before initial layout measurement, `pxPerDay` can be 0 — `niceInterval` returns `intervalMs=0`, causing an infinite tick loop. All Canvas2D renderers with time-based tick loops must guard against zero-density inputs
- **`_formatDist` and `_formatDistance` are parallel implementations**: `scale-bar.ts` and `rulers.ts` each have private distance formatters. When changing format style (spacing, units), update both. A shared extractor was evaluated and rejected — the functions have different domain needs (rulers handle negatives, scale-bar doesn't)
- **`consortium-sync-workflow` must subscribe to `currentDesign.value`** (not `.peek()`): The effect needs to re-trigger on document replacement (open/new/import), not just `sceneEntityRevision`. Use `.peek()` only inside the `mutateCurrentDesign` callback to avoid re-execution loops — but the outer read must be `.value` for subscription
- **Hit-test edge threshold vs min element width**: When `EDGE_THRESHOLD * 2 >= bar/element min width`, edge zones consume the entire element — body hits become impossible. Guard with `if (width <= EDGE_THRESHOLD * 2) return 'body'` before edge checks
- **Renderer-specific CSS fallbacks must be theme-safe**: Don't hardcode light-mode hex for tokens like `--color-surface-muted`. Use `theme.surface` (from `readThemeTokens()`) as the fallback — degrades to uniform surface color in both themes rather than a bright band in dark mode
- **Canvas2D draw order: fills before borders**: Drawing a border, then a fill that covers part of it, then redrawing the covered portion produces double-stroke with HiDPI antialiasing artifacts. Draw all fill rects first, then all borders in a single pass
- **`ctx.save()` must precede ALL state changes it protects**: Setting `globalAlpha`, `textAlign`, or `font` before `ctx.save()` means `ctx.restore()` won't reset them — the save captures the state at call time, not at restore time. Common mistake: setting `globalAlpha = 0.95` then calling `save()` for a clip rect — alpha leaks
- **Don't add `?? ''` guards on non-nullable TS fields**: `TimelineAction.description` is `string` (not `string | null`), so `action.description ?? ''` is dead code. Check the type definition before adding defensive guards in Canvas2D renderers
- **Timeline drag freezes coordinate origin**: `dragOriginMsRef` + `dragOriginDateRef` freeze `originMs` at drag start (move/resize). Without this, `computeOriginMs()` recalculates from the earliest action during drag, shifting the coordinate system and pinning the action visually while the ruler slides. `scrollX` compensation on drag end prevents a visual jump when the real origin kicks in
- **Timeline auto-scroll separates rAF lifecycle from accumulated state**: `autoScrollRafRef` (rAF id, nullable) and `autoScrollAccumRef` (accumulated px, persistent within drag) must be separate refs. The rAF loop starts/stops multiple times within a drag (edge zone enter/leave, viewport exit), but accumulated scroll must persist — it represents real `scrollX` advancement that the date formula needs. Reset `autoScrollAccumRef` only at drag START, never in `stopAutoScroll()`
- **`document.documentElement` `mouseleave` stops auto-scroll**: When the pointer exits the webview, `mousemove` events stop but rAF keeps ticking against stale `lastDragClientXRef`. The `mouseleave` listener cancels the rAF loop. The accumulated offset persists so the date formula stays consistent when the mouse returns
- **Zoom blocked during move/resize drag**: `handleWheel` early-returns when `dragState.type` is `move` or `resize`. The drag uses `pxPerDaySnapshot` but rendering uses live `pxPerDay` — zoom would create a mismatch
- **`computeAutoScrollSpeed` is module-scope**: Pure function using only module-level constants (`LABEL_SIDEBAR_WIDTH`, `AUTO_SCROLL_EDGE_ZONE`, speed bounds). Quadratic easing: `MIN + (MAX - MIN) * ratio^2`

## Gotchas

- Do not add `getEngine()`-style escape hatches that expose renderer internals to app code
- Command history is patch-based, not snapshot-based. The diff uses `JSON.stringify` comparison — correct but O(n) on full persisted state. Watch for perf if designs grow large
- Selection/order/group logic works on scene entity IDs; preserve stable IDs
- `SceneStore.toCanopiFile()` is the canonical serialization path for canvas scene state
- `computeSceneBounds()` must include annotation extents, not only annotation anchor points
- `computeSceneBounds()` and grouping bounds must use the runtime plant presentation context, not raw `plant.scale`
- Species-wide plant colors are document state and must survive save/reload
- Rust `load_from_file()` has a version-dispatched `migrate_design_value()` path for v1→v2 legacy panel target migration. Before the next breaking schema change, add the corresponding migration case there and add/adjust frontend fixtures rather than scattering ad hoc compatibility logic

### Scene Codec Contract
- `serializeScenePersistedState` only produces canvas-entity fields plus document metadata placeholders — when adding new required fields to `CanopiFile` that are non-canvas state (consortiums, timeline, budget, `budget_currency`), the codec must emit empty placeholder/default values to satisfy the type contract. `serializeDocument()` overwrites them with document-store values
- **Canvas DPR sizing must use `Math.round()`** — `canvas.width = cssWidth * dpr` produces floats on fractional-DPR screens (1.25, 1.5, 1.75). The browser truncates to integer on assignment, so the guard `canvas.width !== newW` never matches on subsequent frames → unconditional buffer reallocation. Always `Math.round(cssWidth * dpr)`. Pattern established in `useCanvasRenderer`, `_drawGrid`, and all ruler functions
- **`ctx.setTransform()` not `ctx.scale()` after size guards** — when a size guard prevents canvas clearing, `ctx.scale(dpr, dpr)` accumulates (2x, 4x, 8x…) because the transform matrix persists. `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` atomically resets-and-sets. Both `useCanvasRenderer` and ruler functions use `setTransform`
