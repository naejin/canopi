# Canvas Runtime: Scene-Owned Production Path

## Current Status (2026-04-02)

The live canvas now runs through `SceneCanvasRuntime`.

Production ownership is:
- `CanvasPanel` mounts `SceneCanvasRuntime`
- `CanvasSession` is the only app-facing canvas seam
- `SceneStore` is the only source of truth for canvas/document state
- `RendererHost` owns backend selection, startup fallback, and runtime recovery
- `PixiJS` is the primary world renderer
- `Canvas2D` is the fallback renderer
- the location/map flow is handled by a separate location shell and should not be treated as part of the canvas panel contract

Landed in the live path:
- scene-owned load/replace/save flows
- scene-owned selection, drag, rectangle creation, text annotations, plant-stamp placement, and drag-drop placement
- command/patch history in `scene-history.ts` and `scene-commands.ts`
- first-class top-level document `annotations`

Legacy Konva / `CanvasEngine` code may still exist in-tree as superseded history, but it is no longer the live canvas authority for rendering, interaction, or persistence.

## Architecture Rules

### Public Seams
- `CanvasSession` is the only app-facing canvas authority
- `CanvasRuntime` is the execution seam behind `CanvasSession`
- app code must not reach into renderer implementations or old engine internals

### State Ownership
- `SceneStore` owns persisted document state and ephemeral session state
- commands, tools, save/load, and document replacement mutate scene state, not renderer objects
- canvas-owned document fields serialize from the live scene, not from stale document input copies
- top-level `annotations` belong in the schema; do not put live annotations back under `extra`
- plant presentation state lives in `SceneStore.session`, not in standalone canvas signals
- the only active presentation fields are `plantSizeMode` and `plantColorByAttr`
- selection truth lives in `SceneStore.session.selectedEntityIds`
- `CanvasSession.getSelection()/setSelection()/clearSelection()` are runtime-backed; canvas signals such as `selectedObjectIds`, `plantSizeMode`, and `plantColorByAttr` are UI mirrors, not runtime authority

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
- location/map UI state stays in the location shell; do not pull `maplibre-gl` back into the canvas path
- hit testing and selection geometry must stay scene-side
- do not reintroduce Konva-node queries into live interaction paths
- off-canvas drag continuation, multi-drag, and additive selection behavior are part of the contract
- plant hit testing must use the same shared presentation context as renderers and fit/bounds logic
- interaction selection writes must go through the runtime-owned selection seam; runtime logic must read authoritative selection from scene session

### Annotation Rules
- annotation geometry must come from shared helpers in `runtime/annotation-layout.ts`
- use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines
- visible text should win hit testing over underlying zones/plants when it is on top

### Plant Presentation Rules
- plant geometry, color, LOD, label suppression, and stack badges come from `runtime/plant-presentation.ts`
- size mode and color mode are independent axes; do not reintroduce a combined `plantDisplayMode`
- bounds, zoom-to-fit, grouping, renderers, and interaction must all consume the same resolved presentation state
- species-cache backfill may enrich plant metadata, but production geometry should never depend on ad hoc empty-cache fallbacks

### Invalidation Rules
- use scene invalidation for content, selection, presentation, locale, and theme changes
- use viewport invalidation for pan, zoom, and fit operations
- use chrome invalidation for rulers, grid, and guide-only changes
- do not route viewport-only work through the full scene render path

## Runtime Split

```
CanvasSession
  └── CanvasRuntime
      └── SceneCanvasRuntime
          ├── SceneStore
          ├── SceneInteractionController
          ├── CameraController
          ├── SceneHistory / SceneCommands
          ├── RendererHost
          │   ├── Pixi scene renderer
          │   └── Canvas2D scene renderer
          └── HTML rulers / overlay chrome
```

## Active Cleanup Work

The rewrite cutover is complete. Remaining work is cleanup and hardening:
- keep save/load strictly scene-authoritative
- keep annotation geometry consistent across runtime, interaction, and renderers
- keep plant presentation state scene-session-owned and geometry consistent across all consumers
- keep the location shell isolated from the canvas runtime and preserve the current lazy boundary around `maplibre-gl`
- delete or quarantine dead legacy seams that still imply `CanvasEngine` ownership; treat any remaining mentions as historical only
- keep docs synchronized with the live scene runtime

## Gotchas

- `CanvasRuntime` no longer exposes `getEngine()`; do not add escape hatches back
- command history is patch-based, not snapshot-based
- selection/order/group logic works on scene entity IDs; preserve stable IDs
- `SceneStore.toCanopiFile()` is the canonical serialization path for canvas state
- `computeSceneBounds()` must include annotation extents, not only annotation anchor points
- `computeSceneBounds()` and grouping bounds must use the runtime plant presentation context, not raw `plant.scale`
- species-wide plant colors are document state and must survive save/reload
