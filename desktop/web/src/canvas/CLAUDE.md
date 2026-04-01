# Canvas Engine & Konva.js

## Architecture Rules (enforced)

### Canvas Runtime Rule
- **No shared runtime service locator** — runtime modules take only the dependencies they need via typed `*Deps` interfaces
- `CanvasEngine` is the public facade — external code imports from `engine.ts`, never from `runtime/*.ts` directly
- Runtime modules own their domain exclusively:
  - `runtime/viewport.ts` — zoom, pan, resize, counter-scale
  - `runtime/document-session.ts` — document load/hydration, layer state reset
  - `runtime/object-ops.ts` — selection, delete, duplicate, clipboard, z-order
  - `runtime/external-input.ts` — keyboard, mouse, drag-drop event routing
  - `runtime/render-pipeline.ts` — LOD scheduling, theme reconciliation, display mode refresh, post-materialization reconciliation
- Do not move domain logic back into `engine.ts` — if new canvas behavior is needed, add it to the appropriate runtime module or create a new one

### Canvas Drag & Off-Canvas Behavior
- **No pointer capture**: Use window-level `pointermove`/`pointerup` listeners during drag, not `setPointerCapture` (Konva listens on internal canvas elements, not the container div)
- **Edge clamping**: When cursor leaves canvas during draw/select, clamp position to container edge via `_clampToRect()` in `external-input.ts`. Inject clamped position via one-shot `getRelativePointerPosition()` override
- **Tool affinity**: `external-input.ts` locks the tool reference on mousedown — all subsequent events route to that tool even if `activeTool` changes mid-drag
- **Shapes born inert**: All shapes created with `draggable: false`. `_applyTool()` in engine.ts is the sole authority for draggable state. `AddNodeCommand.execute()` also sets draggable based on active tool

### Selection Highlights
- Shadow effects on counter-scaled plant groups must target the **first child** (screen-pixel space), not the group. Use `highlightTargetFor()` from `theme-refresh.ts`
- Ephemeral highlight attrs (`shadowColor`, `shadowBlur`, etc.) stripped via shared `EPHEMERAL_CANVAS_ATTRS` in `node-serialization.ts` — imported by `operations.ts` STRIP_ATTRS
- `_applyHighlight`/`_removeHighlightFromNode` do NOT call `batchDraw()` — caller must batch after bulk operations via `_redrawHighlightedLayers()`
- `_clearAllHighlights` must call `_redrawHighlightedLayers()` after clearing persistent highlights — preview and persistent highlights are flushed separately
- `highlight-glow` canvas color reads from `--color-primary` on theme switch

### Renderer Ownership (landed — stability gate satisfied 2026-03-30)
`RenderReconciler` owns render invalidation, batching, deferred scheduling, and stage-transform invalidation. `render-pipeline.ts` is the execution delegate behind the reconciler, not the scheduler. See `docs/renderer/renderer.md` for the validation checklist. Rules:
- All visual updates go through `reconciler.invalidate(...)` — no scattered `batchDraw()` / manual reconcile calls
- All stage transforms go through the engine-owned stage-transform path
- Do not reintroduce direct renderer scheduling from viewport, tools, or action code
- Do not treat `zoomLevel` as transform authority
- Keep full-layer passes full-layer until a real sublinear index exists
- Use viewport filtering only for deferred passes where stale off-screen state is acceptable

Deferred (no longer gate-blocked, per `docs/todo.md` S4):
- Plant color assignment — user override + flower color display mode (see `docs/todo.md` S9 for full spec)
- Plant label improvements — single-line, color-aware density, priority ordering (see `docs/todo.md` S9.1)
- `loadSpeciesCache` extraction from `engine.ts`

## Runtime Module Split (Wave 2) + Reconciler (Wave 3)
```
CanvasEngine (engine.ts) — facade + signal effects
  ├── RenderReconciler             — render invalidation, batching, deferred scheduling, stage-transform invalidation
  ├── runtime/render-pipeline.ts   — LOD, display modes, theme refresh (execution delegate, not scheduler)
  ├── runtime/viewport.ts          — zoom, pan, resize, counter-scale
  ├── runtime/object-ops.ts        — selection, delete, duplicate, clipboard, z-order
  ├── runtime/external-input.ts    — keyboard, mouse, drag-drop routing
  └── runtime/document-session.ts  — document load/hydration, layer state reset
```
External code uses `CanvasEngine` methods only. Never import from `runtime/*.ts` directly.

## Canvas Rendering
- Zone shapes: world-unit geometry, `strokeScaleEnabled: false` for constant-pixel strokes
- Plant symbols: fixed screen-pixel circles, group-level counter-scale
- Grid: single `Konva.Shape` with custom `sceneFunc`, adaptive density via "nice distances" ladder
- Rulers: HTML `<canvas>` elements, NOT Konva — always in screen space
- Scale bar: drawn in `rulers.ts` `_drawScaleBar()`, color sourced from `--color-text-muted` via `refreshRulerColors()`; `scale-bar.ts` is pure metrics only
- File dialogs: JS `@tauri-apps/plugin-dialog` API, NOT Rust `blocking_*`
- `_chromeEnabled` signal: controls grid/ruler visibility — must be a signal so effects track it
- Display modes: `display-modes.ts` has `updatePlantDisplay()` + `getLegendEntries()`. Signals: `plantDisplayMode` (`'default'`/`'canopy'`/`'color-by'`) and `plantColorByAttr` in `state/canvas.ts`. UI controls in `DisplayModeControls.tsx` + `DisplayLegend.tsx`
- Plant tooltip: HTML `<div>` overlay in `engine.ts` (not Konva text). `pointer-events: none`. Positioned via `stage.getAbsoluteTransform()`. Uses safe DOM methods (no innerHTML)
- Plant LOD labels: threshold at `stageScale >= 5`. Nearest-neighbor density check (squared distances, no sqrt). Selected plants always show labels. Stacked plants get moss-green count badge

## Render Pipeline Ownership
`RenderReconciler` owns all render scheduling. `render-pipeline.ts` is the execution delegate — other runtime modules must not call `batchDraw()` or walk plant nodes for visual updates. Go through `reconciler.invalidate(...)`:
- `reconcileAfterMaterialization()` — full visual sync after any scene mutation (add/remove/undo/redo/load)
- `refreshPlantDisplay()` — display mode color/radius update
- `reconcileZoomDependentState()` — LOD + counter-scale + annotation zoom (called via `scheduleLODUpdate` or after button zoom)
- `refreshTheme()` — CSS variable color refresh on all canvas nodes
- `refreshLocale()` — plant label text update from species DB
- **Renderer stability gate**: Gate satisfied 2026-03-30; Wave 4 unblocked. See `docs/renderer/renderer.md` for the validation record and `docs/todo.md` S4 for gate conditions

## Konva.js Gotchas
- **Never assign `canvas.width`/`canvas.height` unconditionally in draw loops**: Assignment resets the backing buffer and triggers GPU texture reallocation even when the value is unchanged. Guard with `if (canvas.width !== newW) canvas.width = newW`. See `rulers.ts` draw functions
- **Use `ctx.setTransform(dpr,0,0,dpr,0,0)` not `ctx.scale(dpr,dpr)` for HiDPI canvas**: `scale()` is cumulative — if the canvas buffer isn't reallocated every frame (per the guard above), the transform compounds. `setTransform()` is absolute and always safe
- **ResizeObserver + RAF: read live DOM dimensions at RAF time**: Don't close over the `entries` parameter — by the time the RAF callback fires, the entries may be stale (especially when the coalescing guard drops intermediate observations). Read `element.clientWidth/clientHeight` inside the RAF callback instead
- **Shapes don't react to CSS theme changes**: Colors hardcoded at creation time. Theme switch requires walking nodes and updating `fill`/`stroke` from computed CSS variables
- **Canvas colors must use `getCanvasColor()` from `theme-refresh.ts`**: Never hardcode fill/stroke on Konva nodes. Add CSS variable to `global.css` (both themes) + cache entry in `theme-refresh.ts`. `refreshCanvasTheme()` in the engine's theme effect walks all layers on toggle
- **Non-Konva canvas elements too**: Guides, plant badges, and zone fallback colors all use `getCanvasColor()` — not module-level constants. Every color rendered on or near the canvas must be theme-refreshable. If adding a new canvas element with color, add a `--canvas-*` token + `getCanvasColor()` entry + refresh call
- **No Konva Transformer**: Resize/rotate was removed — objects are position-only. Selection uses highlight glows only, move uses native `draggable`. Do not re-add Transformer
- **`name: 'shape'` only on top-level selectable nodes**: Children inside Groups must NOT have it — causes independent selection
- **Screen-space overlays**: Use HTML `<canvas>` (not Konva layers) for rulers. Konva layers are subject to stage transforms
- **`strokeScaleEnabled: false`**: Keeps stroke width constant in screen pixels. Use on all zone/annotation shapes
- **Group-level counter-scale for plants**: Set `group.scale({x: 1/stageScale, y: 1/stageScale})` on the group, not children
- **Plant counter-scale is ephemeral**: `group.scaleX()` on plants is `1/stageScale`, recomputed every zoom. Never persist it — save `scale: null`. On load, skip restoring `plant.scale`; `updatePlantsLOD` sets the correct counter-scale
- **`stage.on('dragmove')` fires for shape drags too**: Filter by `e.target !== this.stage`
- **Custom attrs: use `?? null` not `|| null`**: `getAttr()` can return `0` or `''` which are legitimate values
- **Grouped node coordinates**: Always use `node.getAbsolutePosition(layer)` when serializing. `node.x()/y()` are group-relative after grouping
- **`recreateNode` must handle every shape class**: Missing cases fall through to generic `Konva.Shape` which doesn't render
- **AddNodeCommand strips event handlers**: Attach interaction handlers at the stage level, not on individual nodes
- **Zoom display is relative**: `zoomLevel` is raw stage scale. Display as `Math.round((zoomLevel / zoomReference) * 100)%`
- **Ruler corner uses CSS vars**: `var(--canvas-ruler-bg)` inline so it updates on theme change
- **Detail card sections use `CollapsibleSection` wrapper**: New sections go inline in `PlantDetailCard.tsx` using `<CollapsibleSection>`. Shared field helpers (`Attr`, `BoolChip`, `NumAttr`, `TextBlock`) in `section-helpers.tsx`. Every rendered field MUST appear in the section's `has*` visibility check — missing fields cause silent data hiding

## Canvas Engine Gotchas
- **`CanvasEngine` is the public facade**: External code must use `engine.ts` methods — never import from `runtime/*.ts` directly. Internal behavior lives in runtime modules (see Canvas Architecture section above)
- **Every new canvas module must be wired into runtime**: Must be imported and called from `engine.ts`, the appropriate `runtime/*.ts` module, or `serializer.ts`
- **`state/canvas.ts` mirror signals**: `engine.ts` cannot import from `state/design.ts` (circular). Use mirror signals in `state/canvas.ts`
- **`Command` interface**: Every undo/redo command class must include `readonly type = 'commandName'`
- **`CanvasTool` event signatures**: Tool methods use `Konva.KonvaEventObject<MouseEvent>`, not raw `MouseEvent`
- **Panel switching recreates CanvasEngine**: CanvasPanel unmounts/remounts. Re-load via `loadCanvasFromDocument()` + `showCanvasChrome()`
- **Canvas dirty tracking**: `_past.length` caps at 500. Use `_savedPosition` checkpoint. `history.clear()` must NOT trigger dirty
- **Visual updates go through the reconciler**: Do not call `layer.batchDraw()` for plant/annotation visual changes from outside the render pipeline. Use `reconciler.invalidate(...)` — the reconciler schedules the appropriate pipeline method
- **Vitest with Konva**: Requires `canvas` npm package as devDependency
- **i18n in Vitest**: The i18n module eagerly loads all 11 locale files at import time — `t()` returns real translations in tests without mocking. `locale.value` changes trigger `i18n.changeLanguage()` synchronously via module-level `effect()`
