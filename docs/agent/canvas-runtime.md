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

- `SceneStore` owns canvas scene state: plants, zones, annotations, groups, Design Object locks, layers, plant species colors, selection, viewport, hover, and presentation modes.
- Non-canvas document sections are not owned by `SceneStore`: consortiums, timeline, budget, `budget_currency`, location, description, and document extra.
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects.
- Canvas-owned document fields serialize from the live scene, not stale document input copies.
- Plant presentation state lives in `SceneStore.session`, not standalone canvas signals.
- Scene Layer visibility, opacity, and locks are scene edits. UI controllers must call the canvas command surface instead of writing `layerVisibility`, `layerOpacity`, or `layerLockState` directly.
- Design Object lock state lives on persisted scene entities in `SceneStore`. Production code must read and mutate object locks through scene queries/edits, never through standalone mirror signals.
- A group is effectively locked for mutating canvas interactions when the group itself is locked or any existing member Design Object is locked. Missing member IDs do not lock a group.
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
- Strokes, outlines, stack badges, labels, handles, and measurement text are readability aids. Keep their visual weight screen-readable across zoom instead of scaling them as physical design geometry.
- Canvas notice placement uses the Canvas Notice Layout seam for safe screen-space slots. Active Tool HUDs use the top-left safe slot; Location Notices use the bottom-left safe slot and reserve the scale bar before compacting.
- Use scene invalidation for content, selection, presentation, locale, theme, and hover changes.
- Use viewport invalidation for pan, zoom, and fit operations.
- Use chrome invalidation for rulers, grid, and guide-only changes.
- Do not route viewport-only work through the full scene render path.
- `renderScene()` is for scene/presentation/selection rebuilds; `setViewport()` is for camera-only updates.

## Interaction Ownership

- `SceneInteractionController` owns live pointer capture and generic drag routing; tool modules own tool-specific drag state.
- Hit testing and selection geometry must stay scene-side.
- Off-canvas drag continuation, multi-drag, and additive selection behavior are part of the runtime contract.
- Plant hit testing must use the same shared presentation context as renderers and fit/bounds logic.
- Interaction selection writes go through the runtime-owned selection seam.
- Document-level keyboard handlers must guard with `isEditableTarget(event.target)` so Delete/Backspace/etc. do not fire while typing.

### Scene Interaction Tool Modules

- Tool modules are internal adapters behind `canvas/runtime/interaction/tool-modules.ts`; they do not change the public `SceneCanvasRuntime`, `CanvasCommandSurface`, `CanvasQuerySurface`, or `CanvasDocumentSurface` interfaces.
- `SceneInteractionController` owns global pointer, wheel, key, drag/drop listener registration, shared panning, shared selection, scene invalidation, and common cancellation on tool changes. Tool construction, active-tool lifecycle dispatch, and optional adapter hook normalization belong in `tool-modules.ts`.
- Tool modules own tool-specific state machines, including setup, per-event handling, refresh-after-viewport-change behavior, cancellation, and teardown for their own transient state.
- Shared tool context may expose only runtime-owned seams and stable projections: `SceneStore`, `CameraController`, Scene Edit transactions, selection setters/readers, hit testing, snapping/grid/guide reads, render invalidation, localized Species names, plant presentation context, settings commands or projections, and DOM overlay containers.
- Tool modules may create DOM overlays for tool-owned chrome, but the module that creates an overlay owns its cleanup. Router-owned overlays stay router-owned until a later bead deliberately moves them behind a tool module.
- Scene edits from tools must go through `SceneEditCoordinator`; modules must not mutate persisted scene arrays outside an edit transaction except for explicitly transient draft state owned by the runtime.
- Tool modules must treat `setTool()` changes, `dispose()`, document replacement, Escape cancellation, source invalidation, and viewport refresh as lifecycle events that leave no stale overlays, listeners, selections, previews, or pointer capture behind.
- Do not install module-level `effect()` or global listeners from a tool module unless that module also owns an explicit disposer and `import.meta.hot.dispose()` cleanup. Prefer router-dispatched events for canvas tool input.
- Current Scene Edit tool adapters include Annotation Text, Zone drawing, Object Stamp, Plant Stamp, and Plant Spacing. Do not reintroduce tool-specific fields, source state, preview state, or direct tool branches into `SceneInteractionController`; route through a `SceneToolAdapter` and keep the state machine in the tool module.
- Guard Scene Edit ownership with source boundary tests in `scene-interaction-tool-boundary.test.ts` and user-equivalent lifecycle tests in `scene-interaction.test.ts`. Add tests before moving another tool concern across the router/module boundary.

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
- Annotation text is readable presentation anchored to a design position; its visible text bounds are screen-space and should not be treated as physical world geometry.
- Use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines.
- Visible text should win hit testing over underlying zones/plants when it is on top.

## Plant Presentation

- Plant geometry, color, and stack badges come from `runtime/plant-presentation.ts`.
- Visual Footprint is the shared presentation boundary for symbolic plant sizing; rendering, hit testing, band select, grouping bounds, and zoom-to-fit must consume the same computed footprint. Additional click/touch padding is allowed only as an explicit interaction affordance.
- Stack badges indicate placed plants whose centers collapse to nearly the same screen position, not all plants whose symbolic Visual Footprints overlap. Badge placement should derive from the current plant visual radius instead of fixed legacy dot-size assumptions.
- Do not reintroduce per-plant labels on canvas. Identification is through hover tooltip and per-species selection labels.
- Hover tooltip is an HTML overlay managed by `SceneInteractionController` through `runtime/interaction/hover-tooltip.ts`.
- Hover species highlight flows through renderer snapshots.
- Selection labels are computed per species at centroid by `runtime/selection-labels.ts` and must track viewport changes.
- Size mode and color mode are independent axes. Do not reintroduce a combined plant display mode.
- Default Plant Size Mode dots are symbolic position markers. Size them with a smooth absolute-scale Visual Footprint curve with soft screen-readable limits, not a hard pixel cap or design-reference-relative sizing. Target about 2px minimum, about 6.75px asymptotic maximum, and gradual growth from roughly 2.2px at 1 px/m to roughly 6.3px at 200 px/m.
- Canopy spread mode is physical geometry when canopy spread is known. Plants with missing canopy spread use the symbolic Visual Footprint fallback rather than misleading physical circles.
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
- Timeline Action document editing belongs in `app/timeline/editing.ts`; Timeline drag math belongs in `app/timeline/interaction.ts`; Timeline Action pan, move, resize, autoscroll, origin freeze/restore, commit/abort, pointer ordering, wheel handling, popover open/save/delete/cancel ordering, keyboard delete, stale identity cleanup, Target Presentation writes, and drag cleanup belong in `app/timeline/interaction-frame.ts`. `app/timeline/interaction-workbench.ts` owns Preact-facing interaction state, frame delegate assembly, render-state refs, tooltip/popover projection, and the small frame adapter seam. Timeline canvas workbench owns Planning Projection input assembly and layout offsets. Canvas2D timeline UI owns render wiring, not interaction ordering, planning input assembly, or document edit transaction internals.
- Test Timeline Action interaction-frame behavior through `timeline-interaction-frame.test.ts`; keep source ownership guarded in `frontend-boundaries-sources.test.ts`.
- Consortium drag math belongs in `app/consortium/interaction.ts`; Consortium canvas event ordering, hover bridge behavior, drag lifecycle, and cleanup belong in `app/consortium/workbench.ts`. Canvas2D consortium UI owns layout/render wiring, not interaction ordering or document edit transaction internals.
- Canvas2D renderer functions receive `t` for i18n.
- Cache row offsets and layout computation in refs/memos for pointer paths.
- Snapshot drag-start values that can change mid-drag.
- Track whether a drag actually mutated state before marking documents dirty.
