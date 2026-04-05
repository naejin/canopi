# Canvas Runtime: Scene-Owned Production Path

## Current Status (2026-04-02)

The live canvas now runs through `SceneCanvasRuntime`.

Production ownership is:
- `CanvasPanel` mounts `SceneCanvasRuntime`
- `SceneCanvasRuntime` is the app-facing canvas authority (via interface, not the `CanvasSession` pass-through — see Public Seams below)
- `SceneStore` is the source of truth for **canvas scene state** (plants, zones, annotations, groups, layers, plant-species-colors). Non-canvas document sections (consortiums, timeline, budget) are owned by the document store — see root `CLAUDE.md` Document Authority Rule
- `RendererHost` owns backend selection, startup fallback, and runtime recovery
- `PixiJS` is the primary world renderer
- `Canvas2D` is the fallback renderer
- MapLibre is a derived visualization layer managed by a dedicated controller, not embedded in the canvas runtime (see root `CLAUDE.md` MapLibre Integration Rule)

Landed in the live path:
- scene-owned load/replace/save flows
- scene-owned selection, drag, rectangle creation, text annotations, plant-stamp placement, and drag-drop placement
- command/patch history in `scene-history.ts` and `scene-commands.ts`
- first-class top-level document `annotations`

Legacy Konva / `CanvasEngine` code may still exist in-tree as superseded history, but it is no longer the live canvas authority for rendering, interaction, or persistence.

## Architecture Rules

### Public Seams
- App code must not reach into renderer implementations or runtime internals
- The app-facing canvas boundary should be a TypeScript interface implemented by `SceneCanvasRuntime`, not a 1:1 pass-through class. `CanvasSession` in its current form (200 lines of pure delegation) should be replaced with an interface or given real logic (validation, error boundaries, logging)
- As bottom panels need to read canvas entity state (plant list, species, positions), consider splitting into two interfaces: one for **interaction commands** (tools, selection, history, zoom) and one for **state queries** (entity reads for panels, bounds for map sync). Both implemented by the runtime

### State Ownership
- `SceneStore` owns **canvas scene state**: plants, zones, annotations, groups, layers, plant-species-colors, and ephemeral session state (selection, viewport, hover, presentation modes)
- Non-canvas document sections (consortiums, timeline, budget, location, description, extra) are **not** owned by `SceneStore` — they belong to the document store. See root `CLAUDE.md` Document Authority Rule
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects
- Canvas-owned document fields serialize from the live scene, not from stale document input copies
- Top-level `annotations` belong in the schema; do not put live annotations back under `extra`
- Plant presentation state lives in `SceneStore.session`, not in standalone canvas signals
- The only active presentation fields are `plantSizeMode` and `plantColorByAttr`
- Selection truth lives in `SceneStore.session.selectedEntityIds`
- Canvas signals such as `selectedObjectIds`, `plantSizeMode`, and `plantColorByAttr` are UI mirrors, not runtime authority. Prefer computed/derived signals over manually-synced mirrors (see root `CLAUDE.md` Signal Mirror Rule)

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
- MapLibre interaction (map pan/zoom, click-on-map) is owned by the MapLibre controller, not by `SceneInteractionController`. The two coordinate through `CameraController` for viewport sync

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
- species-cache backfill may enrich plant metadata, but production geometry should never depend on ad hoc empty-cache fallbacks

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
  ├── MapLibreController (derived visualization, sibling to runtime)
  │     └── syncs viewport via CameraController
  └── Document store (non-canvas state: consortiums, timeline, budget)
        └── state/design.ts + state/document.ts
```

## Active Work

The rewrite cutover is complete. Konva dependency has been fully removed. Current focus is convergence for panel/map expansion:
- Keep save/load strictly scene-authoritative for canvas entities
- Keep annotation geometry consistent across runtime, interaction, and renderers
- Keep plant presentation state scene-session-owned and geometry consistent across all consumers
- Converge the save-time merge seam in `serializeDocument()` — non-canvas sections should come from the document store directly, not be re-merged into `SceneStore` at save time
- Replace `CanvasSession` pass-through with a runtime interface (or give it real logic)
- Preserve the lazy import boundary around `maplibre-gl` for bundle size
- Keep docs synchronized with the live scene runtime

## Gotchas

- Do not add `getEngine()`-style escape hatches that expose renderer internals to app code
- Command history is patch-based, not snapshot-based. The diff uses `JSON.stringify` comparison — correct but O(n) on full persisted state. Watch for perf if designs grow large
- Selection/order/group logic works on scene entity IDs; preserve stable IDs
- `SceneStore.toCanopiFile()` is the canonical serialization path for canvas scene state
- `computeSceneBounds()` must include annotation extents, not only annotation anchor points
- `computeSceneBounds()` and grouping bounds must use the runtime plant presentation context, not raw `plant.scale`
- Species-wide plant colors are document state and must survive save/reload
- `ScenePersistedState` has a `version` field but no migration code reads it yet. Before the first breaking schema change, add a `migrateDocument()` step in the load path
