# Canvas Runtime

Use this guide when changing canvas state, scene runtime, renderer behavior, hit testing, selection, presentation, history, Target projection, or Canvas2D tab renderers.

## Public Seams

- App code must not reach into renderer implementations or runtime internals.
- The app-facing canvas boundary is split into `CanvasCommandSurface`, `CanvasQuerySurface`, and `CanvasDocumentSurface`.
- Toolbars, shortcuts, menus, and plant color actions consume command surfaces.
- Document session orchestration, save/load, chrome, resize, and teardown consume document surfaces.
- Sibling read-only surfaces consume query surfaces for scene snapshots, viewport queries, selection reads, placed plants, localized names, and presentation context.
- Scene freshness for app callers is exposed through `CanvasQuerySurface.revision`. App modules must not import `sceneEntityRevision` or `plantNamesRevision` from `canvas/runtime-mirror-state.ts`; those mirrors are runtime-internal compatibility signals.

## Scene Ownership

- `SceneStore` owns canvas scene state: plants, zones, annotations, groups, layers, plant species colors, selection, viewport, hover, and presentation modes.
- Non-canvas document sections are not owned by `SceneStore`: consortiums, timeline, budget, `budget_currency`, location, description, and document extra.
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects.
- Canvas-owned document fields serialize from the live scene, not stale document input copies.
- Plant presentation state lives in `SceneStore.session`, not standalone canvas signals.
- Scene Layer visibility, opacity, and locks are scene edits. UI controllers must call the canvas command surface instead of writing `layerVisibility`, `layerOpacity`, or `layerLockState` directly.
- Guide creation is a scene edit owned by the runtime. The `guides` signal is a chrome projection, not document authority.
- Canvas signals such as selected object IDs, size mode, color mode, layer state, and guides are UI mirrors, not runtime authority.
- Canvas Query Surface revision values are the app-facing freshness seam for scene entities, localized plant names, and viewport updates. If a caller needs to recompute from scene reads, subscribe to that surface instead of importing runtime mirror signals.
- Basemap, contour, and hillshade display settings remain app settings projections; do not route those map-surface settings through Scene Edit unless the document schema intentionally makes them canvas-owned.
- No circular imports between scene store/runtime and document store. Pass document readers or values through seams when needed.

## History And Dirty State

- `SceneHistory` dirty state is checkpoint-based.
- Any history truncation behavior must preserve saved-position semantics in all write paths.
- Selection, hover, presentation-only target highlights, labels, and viewport-only work must not create document history entries unless explicitly designed.
- Auto-fit on attached document open is expected; attached Design Session transitions call `zoomToFit()` after hydration. Detached transitions must not call canvas-only document surface methods.

## Rendering Ownership

- `RendererHost` owns backend lifecycle, capability probing, and fallback.
- Renderers are projections of scene state, never the source of truth.
- Camera transforms go through `CameraController`.
- The in-canvas basemap is a sibling visualization layer, not part of the renderer contract.
- Screen-space chrome such as rulers stays outside the world renderer.
- Canvas notice placement uses the Canvas Notice Layout seam for safe screen-space slots. Active Tool HUDs use the top-left safe slot; Location Notices use the bottom-left safe slot and reserve the scale bar before compacting.
- Use scene invalidation for content, selection, presentation, locale, theme, and hover changes.
- Use viewport invalidation for pan, zoom, and fit operations.
- Use chrome invalidation for rulers, grid, and guide-only changes.
- Do not route viewport-only work through the full scene render path.
- `renderScene()` is for scene/presentation/selection rebuilds; `setViewport()` is for camera-only updates.

## Interaction Ownership

- `SceneInteractionController` owns live pointer and drag behavior.
- Hit testing and selection geometry must stay scene-side.
- Off-canvas drag continuation, multi-drag, and additive selection behavior are part of the runtime contract.
- Plant hit testing must use the same shared presentation context as renderers and fit/bounds logic.
- Interaction selection writes go through the runtime-owned selection seam.
- Document-level keyboard handlers must guard with `isEditableTarget(event.target)` so Delete/Backspace/etc. do not fire while typing.

## Zone Measurements

- Zone Measurements are derived presentation for zone geometry, not persisted design objects or annotations.
- Render Zone Measurement labels through a renderer-independent, screen-space overlay so Pixi and Canvas2D backends do not duplicate measurement UI.
- Show Zone Measurements while drawing a zone and for a single selected top-level Zone; suppress them for multi-selection and group selection.
- Rectangular and polygonal Zones use the same measurement model: horizontal edge-length labels at readable edge midpoints plus one area label for the whole Zone.
- Elliptical Zones use width, height, and area measurements because they have no Zone Edges.
- Elliptical Zone drawing uses drag-to-bounding-box interaction. The snapped drag start and current pointer define opposite box corners; the stored geometry derives center and radii from that normalized box.
- Polygonal Zone drawing uses click-to-place vertices. The draft remains transient until the user closes it; Escape cancels the draft, Backspace removes the last vertex, and closing creates one scene edit.
- During polygonal Zone drawing, live measurements include committed edge lengths, the active edge to the pointer, and once the preview has enough points to form a polygon, the closing edge back to the first point plus live area.
- Format Zone Measurement values compactly: centimeters for distances below one meter, meters for ordinary distances, square centimeters for areas below one square meter, square meters for ordinary areas, and hectares for large areas.
- Live Zone Measurements must describe the geometry that will actually be created, including snap-to-grid and snap-to-guides effects while drawing.
- Hide edge-length labels for edges that are too short in screen space; zooming in should make them available again. Area labels should remain visible for valid areas.
- Zone Measurement overlays respect Zone layer visibility. Locking does not suppress read-only measurements for an otherwise visible selected Zone.

## Annotation Rules

- Annotation geometry comes from shared helpers in `runtime/annotation-layout.ts`.
- Use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines.
- Visible text should win hit testing over underlying zones/plants when it is on top.

## Plant Presentation

- Plant geometry, color, and stack badges come from `runtime/plant-presentation.ts`.
- Do not reintroduce per-plant labels on canvas. Identification is through hover tooltip and per-species selection labels.
- Hover tooltip is an HTML overlay managed by `SceneInteractionController` through `runtime/interaction/hover-tooltip.ts`.
- Hover species highlight flows through renderer snapshots.
- Selection labels are computed per species at centroid by `runtime/selection-labels.ts` and must track viewport changes.
- Size mode and color mode are independent axes. Do not reintroduce a combined plant display mode.
- Default-mode dot sizing is world-proportional with screen caps/floors from existing constants.
- Species-cache backfill may enrich metadata, but production geometry should not depend on ad hoc empty-cache fallbacks.

## Target Projection

- Timeline, budget, and consortium identity uses typed `PanelTarget[]` / `PanelTarget` wire values, but frontend callers should import Target helpers from `desktop/web/src/target/`.
- Do not reintroduce string matching against timeline descriptions, legacy `plants` arrays, budget descriptions, or consortium canonical-name fields.
- Use the Target resolution helpers to map typed targets to scene plant/zone IDs for canvas highlights.
- `manual` and `none` targets intentionally resolve to empty sets and are not errors.
- Panel-origin hover and selection are presentation inputs. Resolving them must not mutate real canvas selection, labels, dirty state, or history.
- App-owned Target presentation state is exposed through `app/panel-targets/presentation.ts`; runtime adapters and map surface controllers should consume that seam instead of raw `app/panel-targets/state.ts` signals.
- Canvas-origin hover remains separate.

## Canvas2D Tab Components

- Use `useCanvasRenderer` for DPR-aware canvas setup, resize observation, and redraw lifecycle.
- Use shared renderer utilities rather than duplicating drawing helpers.
- Planning tab read-models such as Timeline Action rows, layout lanes, species picker options, and Target derivation belong in `app/planning-projection/`; Canvas2D renderers own drawing, row heights, hit geometry, and pointer math.
- Planning tab UI should consume the relevant workbench or Planning Projection surface instead of calling canvas query surfaces directly for placed plants, localized Species names, Design Session planning arrays, or planning Target presentation. Budget UI uses the Budget Item Workbench; Timeline UI uses the Timeline Action Workbench; Consortium UI uses its Planning Projection/workbench seam.
- Timeline Action document editing belongs in `app/timeline/editing.ts`; Timeline drag math belongs in `app/timeline/interaction.ts`; Timeline canvas event ordering, selected Timeline Action identity, stale-selection cleanup, layout offsets, local view state, popup lifecycle, Target presentation, and cleanup belong in `app/timeline/canvas-workbench.ts`. Canvas2D timeline UI owns render wiring, not interaction ordering, planning input assembly, or document edit transaction internals.
- Consortium drag math belongs in `app/consortium/interaction.ts`; Consortium canvas event ordering, hover bridge behavior, drag lifecycle, and cleanup belong in `app/consortium/workbench.ts`. Canvas2D consortium UI owns layout/render wiring, not interaction ordering or document edit transaction internals.
- Canvas2D renderer functions receive `t` for i18n.
- Cache row offsets and layout computation in refs/memos for pointer paths.
- Snapshot drag-start values that can change mid-drag.
- Track whether a drag actually mutated state before marking documents dirty.
