# Canvas Runtime

Use this guide when changing canvas state, scene runtime, renderer behavior, hit testing, selection, presentation, history, Target projection, or Canvas2D tab renderers.

## Public Seams

- App code must not reach into renderer implementations or runtime internals.
- The app-facing canvas boundary is split into `CanvasCommandSurface`, `CanvasQuerySurface`, and `CanvasDocumentSurface`.
- `CanvasCommandSurface` is role-shaped: `tools`, `viewport`, `history`, `sceneEdits`, `chrome`, `layers`, and `plantPresentation`. New focused callers should consume the narrow role surface exported by `canvas/session.ts` instead of the full command bundle.
- The App Command Graph may consume the full `CanvasCommandSurface` because it is the shared command-ID orchestration layer. Do not use that as precedent for ordinary UI components or leaf controllers.
- Toolbars, shortcuts, menus, and plant color actions consume command surfaces through the narrowest role that covers their writes.
- Document session orchestration, save/load, chrome, resize, and teardown consume document surfaces.
- Sibling read-only surfaces consume query surfaces for scene snapshots, viewport queries, selection reads, placed plants, localized names, and presentation context.
- `CanvasQuerySurface.getDesignObjectSelection()` is the app-facing read model for editable top-level Design Object selection, selected locked Design Objects, blocked selection reasons, and combined visual bounds. New selection actions, transform overlays, lock cues, and toolbar placement should consume this query instead of duplicating plant Visual Footprint, annotation bounds, Zone bounds, Layer, Object Group, or Design Object Lock rules.
- Publish live canvas sessions as explicit `CanvasRuntimeSurfaces` bundles. Do not publish a raw `SceneCanvasRuntime`, and do not cast a role-specific fake into the session signal; tests should use `createTestCanvasRuntimeSurfaces()` with the role surface they need.
- `createCanvasRuntimeSurfaces()` must compose `runtime.commandSurface`, `runtime.querySurface`, and `runtime.documentSurface` directly. Do not reintroduce fallback casts that treat `SceneCanvasRuntime` itself as any role surface.
- Scene freshness for app callers is exposed through `CanvasQuerySurface.revision`. Do not recreate canvas runtime mirror revision signals; app modules subscribe through the query surface instead.
- `canvas/runtime/runtime.ts` owns the app-facing Canvas Runtime Surface interfaces. `canvas/runtime/surfaces.ts` only composes the live runtime surfaces; command, query, and document surface behavior belongs behind the role modules in `canvas/runtime/*-surface.ts`.
- `SceneCanvasRuntime` may still wire the concrete scene runtime during migration, but new surface behavior should be added to the relevant role module before adding more broad runtime pass-through code.
- `canvas/runtime/document-surface.ts` owns document lifecycle surface behavior for load, replace, serialization, saved checkpoints, viewport initialization, chrome attachment, resize, and teardown. `SceneCanvasRuntime` compatibility methods delegate to that role.
- `canvas/runtime/query-surface.ts` owns read-only surface behavior for scene snapshots, viewport facts, revisions, selection, placed plants, localized names, and plant presentation context. `SceneCanvasRuntime` compatibility methods delegate to that role.
- `canvas/runtime/command-surface.ts` owns command surface behavior for tools, viewport changes, history, scene edits, chrome toggles, layer edits, and plant presentation writes. `SceneCanvasRuntime` compatibility methods delegate to that role.
- `app/canvas-runtime/host.ts` owns live runtime creation and publication of `CanvasRuntimeSurfaces` into the Design Session.
- `canvas/runtime/app-adapter.ts` owns the runtime-facing `CanvasRuntimeAppAdapter` contract and detached fallback behavior.
- `app/canvas-runtime/app-adapter.ts` owns production wiring from the adapter contract to app-owned document/session/settings modules.
- Production files under `canvas/runtime/` must not import `app/**`; add behavior through `CanvasRuntimeSurfaces`, `CanvasRuntimeAppAdapter`, or a narrower runtime-owned interface instead.

## Scene Ownership

- `SceneStore` owns canvas scene state: plants, zones, annotations, groups, Design Object locks, layers, plant species colors, plant species symbols, selection, viewport, hover, and presentation modes.
- Non-canvas document sections are not owned by `SceneStore`: consortiums, timeline, budget, `budget_currency`, location, description, and document extra.
- Commands, tools, save/load, and document replacement mutate scene state, not renderer objects.
- Canvas-owned document fields serialize from the live scene, not stale document input copies.
- Full Design file composition is app-owned and crosses `CanvasRuntimeAppAdapter.document`. Runtime core serializes canvas-owned state and must not import `app/contracts/document`.
- Plant presentation state lives in `SceneStore.session`, not standalone canvas signals.
- Scene Layer visibility, opacity, and locks are scene edits. UI controllers must call the canvas command surface instead of writing `layerVisibility`, `layerOpacity`, or `layerLockState` directly.
- Canvas Layer Presentation (`app/canvas-layer-presentation/presentation.ts`) owns the visible Layer catalog and authority-correct row commands for scene Layers, basemap, contours, and hillshading. UI callers should consume that seam instead of hard-coding `base`, `contours`, or `hillshading` routing.
- Layer lock controls belong on scene Layer rows in the Layer Panel and must write through Canvas Layer Presentation. Layer-locked objects can show locked-Layer hover cues, but must not show object-level unlock affordances.
- Design Object lock state lives on persisted scene entities in `SceneStore`. Production code must read and mutate object locks through scene queries/edits, never through standalone mirror signals.
- A group is effectively locked for mutating canvas interactions when the group itself is locked or any existing member Design Object is locked. Missing member IDs do not lock a group.
- Directly locked Design Objects stay hover-discoverable and can become selected locked targets so the Selection Action Toolbar can offer Unlock. They must not become editable targets until unlocked; other mutation buttons should be visible but disabled in the locked-selection toolbar state. Locked-Layer objects, hidden objects, grouped members, missing targets, and Object Groups blocked only by locked members remain structural blockers rather than selected locked targets. Do not reintroduce implicit unlock-all behavior through `unlockSelected()` or shortcuts.
- Movement, color, and other mutating commands must derive write targets from editable selection or explicit layer/lock filters. Raw selected IDs and broad species scopes may include locked targets for read-only affordances and must not be used directly for scene mutations.
- Guide creation is a scene edit owned by the runtime. The `guides` signal is a chrome projection, not document authority.
- Runtime chrome rendering and interaction snapping read guides from `SceneStore.persisted.guides`; do not read the `guides` signal in production runtime behavior.
- Canvas signals such as selected object IDs, size mode, color mode, layer state, and guides are UI mirrors, not runtime authority.
- Canvas Query Surface revision values are the app-facing freshness seam for scene entities, localized plant names, and viewport updates. If a caller needs to recompute from scene reads, subscribe to that surface; do not recreate `runtime-mirror-state.ts` or runtime mirror revision signals.
- Canvas Map Surface reads saved Location and `north_bearing_deg` through the Location Workbench presentation seam, not `scene-metadata-state` or direct document-session imports.
- Basemap, contour, and hillshade display settings remain app settings projections; do not route those map-surface settings through Scene Edit unless the document schema intentionally makes them canvas-owned.
- Shared runtime settings reads, writes, and subscriptions for locale, theme invalidation, grid/rulers/snap, Plant Spacing interval, and layer projections cross `CanvasRuntimeAppAdapter.settings`. Runtime core must not import `app/settings/*` or `app/canvas-settings/*` for those concerns.
- No circular imports between scene store/runtime and document store. Pass document readers or values through seams when needed.

## History And Dirty State

- `SceneHistory` dirty state is checkpoint-based.
- `SceneHistory` reports canvas clean-state through an injected clean-state callback from the `CanvasRuntimeAppAdapter`. Production wiring lives in `app/canvas-runtime/app-adapter.ts`; runtime core must not import `app/document-session/store`.
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
- Selected, hover, locked-object hover, and locked-Layer hover strokes are screen-space interaction cues owned by `scene-visuals.ts`. Pixi and Canvas2D renderers should consume the same interaction visual helper so selected states remain stronger than hover and locked states do not imply editable selection.
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
- Species Selection is a Select-tool canvas selection gesture: double-clicking a visible editable top-level Placed Plant selects all visible editable top-level Placed Plants with the same Canonical Name across the design, excluding grouped members, locked Design Objects, hidden Layers, and locked Layers. Shift+double-click applies the same Species set additively/toggling against the current selection. The Selection Action Toolbar uses `CanvasDesignObjectSelectionModel.sameSpeciesReferenceCanonicalName` to expose Select Same Species and dispatches the non-dirty `selectSameSpecies()` command. It must not mutate Design data, Target Presentation, dirty state, or document history.
- Plant hit testing must use the same shared presentation context as renderers and fit/bounds logic.
- Interaction selection writes go through the runtime-owned selection seam.
- Editable hit testing should continue to ignore locked Layers, but hover feedback may use visible-only hit testing so locked Layers and locked Design Objects can explain why an object is blocked.
- Document-level keyboard handlers must guard with `isEditableTarget(event.target)` so Delete/Backspace/etc. do not fire while typing.

### Scene Interaction Tool Modules

- Tool modules are internal adapters behind `canvas/runtime/interaction/tool-modules.ts`; they do not change the public `SceneCanvasRuntime`, `CanvasCommandSurface`, `CanvasQuerySurface`, or `CanvasDocumentSurface` interfaces.
- Scene Interaction Frame (`canvas/runtime/interaction/frame.ts`) owns interaction listener setup/teardown, generic pointer capture bookkeeping, cached pointer bounds, generic tool pointer-drag state, shared Space-key state for panning, tool transition routing, transient cleanup ordering, and disposal cleanup ordering.
- Test Scene Interaction behavior through the Scene Interaction Frame event harness in `desktop/web/src/__tests__/support/scene-interaction-frame.ts`. New broad interaction tests should dispatch user-equivalent pointer, keyboard, and wheel events instead of calling private `SceneInteractionController` handlers.
- Shared panning, band selection, top-level Design Object dragging, snap-adjusted drag deltas, and shared gesture cleanup live in `canvas/runtime/interaction/shared-gestures.ts` behind the frame. `SceneInteractionController` should route these gestures through that seam and keep tool dispatch separate.
- `SceneInteractionController` supplies concrete cleanup callbacks to `frame.cleanupTransient()`; do not inline the ordering for pointer gesture reset, shared gesture cancellation, tool transient cancellation, hover clearing, or cursor reset back into the controller.
- Tool construction, active-tool lifecycle dispatch, and optional adapter hook normalization belong in `tool-modules.ts`.
- Tool modules own tool-specific state machines, including setup, per-event handling, refresh-after-viewport-change behavior, cancellation, and teardown for their own transient state.
- Shared tool context may expose only runtime-owned seams and stable projections: `SceneStore`, `CameraController`, Scene Edit transactions, selection setters/readers, hit testing, snapping/grid/guide reads, render invalidation, localized Species names, plant presentation context, settings commands or projections, and DOM overlay containers.
- Tool modules may create DOM overlays for tool-owned chrome, but the module that creates an overlay owns its cleanup. Router-owned overlays stay router-owned until a later bead deliberately moves them behind a tool module.
- Creation tools must guard the target scene Layer at the mutation boundary, not only through visible UI state. Plant Stamp and drop-to-canvas use the Plants Layer, Zone drawing uses the Zones Layer, and text Annotation creation uses the Annotations Layer; hidden or locked target Layers must not create scene edits, dirty state, stale previews, or new entities.
- Selection transform affordances such as the Rotation Handle, live rotation readout, and Selection Action Toolbar should be runtime-owned DOM overlays coordinated by the Scene Interaction Frame/shared selection behavior. They must not be renderer-owned projections or outer Preact chrome that reaches into runtime internals.
- Single-selection Rotation Handle drags are Scene Edit transactions owned by the runtime overlay. They must update rotation live, commit one history entry only past the no-op angle threshold, and abort cleanly on Escape, dispose, tool transition, or tiny/no-op pointer-up.
- Multi-selection and Object Group Rotation Handle drags use one pivot from combined visual bounds. Placed Plants rotate by moving positions without adding visible plant orientation; Rectangular/Elliptical Zones move their centers and increment orientation; Linear/Polygonal Zones rotate points; Object Groups mutate member geometry and group position without using hidden group rotation.
- The Selection Action Toolbar reads `CanvasQuerySurface.getDesignObjectSelection()` through the interaction deps, dispatches mutations through a narrow `CanvasSceneEditCommandSurface` role, and must not steal focus when it appears. Icon-only buttons may expose custom tooltips and focused keyboard activation, but hover/highlight alone must not make keyboard activation implicit. Action tooltips open above the toolbar, and the toolbar stacking layer must stay above the Rotation Handle so hover labels remain readable.
- Runtime-owned overlays such as the Selection Action Toolbar, Rotation Handle, locked-object affordance, and tool HUDs may suppress passive hover/preview pointermoves, but active pointer gestures must receive movement before overlay ignore checks so drags, pans, and rotations do not freeze while crossing overlays.
- Selection Action Toolbar command availability should be derived from the selection read model. Keep mutation and dirty/undo behavior behind the command surface and Scene Edit transactions rather than duplicating it in overlay code.
- Scene Interaction Frame owns canvas-scoped browser-default suppression such as `contextmenu`; handlers should preserve native behavior for editable targets and non-canvas panels.
- The Canvas Context Menu is a runtime-owned canvas overlay coordinated by the Scene Interaction Frame. It dispatches Copy, Paste, and Delete through canvas scene-edit command surfaces, keeps unavailable commands visible but disabled, and must place itself dynamically inside the visible canvas so app chrome or viewport edges do not hide it.
- Canvas Context Menu target selection follows design-tool behavior: right-clicking an unselected editable top-level Design Object selects only that object; right-clicking a Design Object already inside the current selection preserves the current selection; right-clicking empty canvas preserves selection and uses the clicked canvas point for context paste. Right-clicking a directly locked Design Object may select it as a locked target, but Copy and Delete remain disabled because locked objects are not editable mutation sources. Copy and Delete availability requires an editable selection with no locked or blocked targets; mixed editable plus locked/blocked selections keep those commands visible but disabled.
- Normal Paste and Duplicate use the internal canvas clipboard and place copies one meter to the right of the copied Design Object selection; repeated normal Paste or Duplicate advances one additional meter to the right each time. Context Paste from the Canvas Context Menu recomputes the copied payload's combined visual-bounds center with the current viewport and presentation context at paste time, then translates the copied Design Objects so that center lands on the clicked canvas point, preserving relative geometry and group membership.
- Scene edits from tools must go through `SceneEditCoordinator`; modules must not mutate persisted scene arrays outside an edit transaction except for explicitly transient draft state owned by the runtime.
- Tool modules must treat `setTool()` changes, `dispose()`, document replacement, Escape cancellation, source invalidation, and viewport refresh as lifecycle events that leave no stale overlays, listeners, selections, previews, or pointer capture behind.
- Do not install module-level `effect()` or global listeners from a tool module unless that module also owns an explicit disposer and `import.meta.hot.dispose()` cleanup. Prefer router-dispatched events for canvas tool input.
- Current Scene Edit tool adapters include Annotation Text, Zone drawing, Object Stamp, Plant Stamp, and Plant Spacing. Do not reintroduce tool-specific fields, source state, preview state, or direct tool branches into `SceneInteractionController`; route through a `SceneToolAdapter` and keep the state machine in the tool module.
- `canvas/plant-stamp-source.ts` owns Plant Stamp Source selection plus drag data parsing/serialization. Plant Stamp tool modules consume that seam and clear the selected source on adapter deactivation/disposal; Species Catalog UI modules call it instead of writing source state or hand-assembling drag payloads.
- Guard Scene Edit ownership with source boundary tests in `scene-interaction-tool-boundary.test.ts`, focused tool-module tests such as `plant-spacing-tool.test.ts`, and user-equivalent frame lifecycle tests in `scene-interaction.test.ts` or `scene-interaction-frame.test.ts`. Add tests before moving another tool concern across the router/module boundary.

## Zone Geometry

- Zone file data carries orientation as `Zone.rotation`; scene runtime entities expose it as `SceneZoneEntity.rotationDeg`. Missing rotation from older documents hydrates to `0`, and new saves serialize an explicit numeric rotation.
- Rectangular and Elliptical Zones are oriented shapes. Rendering, hit testing, band selection, object stamp previews, selection/group bounds, zoom-to-fit, and Zone Measurements must consume the shared helpers in `canvas/runtime/zone-geometry.ts` instead of duplicating axis-aligned bounds.
- Elliptical Zones store `points[0]` as the world center and `points[1]` as the radius vector. Translation-style edits, Paste, Duplicate, and Object Stamp must offset only the center while preserving the radius vector; linear, polygonal, and rectangular Zones continue to translate their world points.
- Linear and Polygonal Zones still derive geometry from their saved points; keep their rotation value at `0` unless a future feature deliberately defines oriented behavior for those Zone types.

## Zone Measurements

- Zone Measurements are derived presentation for zone geometry, not persisted design objects or annotations.
- Render Zone Measurement labels through a renderer-independent, screen-space overlay so Pixi and Canvas2D backends do not duplicate measurement UI.
- Show Zone Measurements while drawing a zone and for a single selected top-level Zone; suppress them for multi-selection and group selection.
- Linear Zones use one edge-length measurement and never show area, width, or height labels.
- Rectangular and polygonal Zones use the same measurement model: horizontal edge-length labels at readable edge midpoints plus one area label for the whole Zone.
- Elliptical Zones use width, height, and area measurements because they have no Zone Edges.
- Linear Zone drawing uses drag-to-endpoint interaction. The snapped drag start and current pointer define the saved endpoints.
- Elliptical Zone drawing uses drag-to-bounding-box interaction. The snapped drag start and current pointer define opposite box corners; the stored geometry derives center and radii from that normalized box.
- Polygonal Zone drawing uses click-to-place vertices. The Zone Draft remains transient until the user closes it; Escape cancels the draft, Backspace removes the last vertex, Undo/Redo step through draft vertices before committed Scene Edit history, and closing creates one scene edit.
- During polygonal Zone drawing, live measurements include committed edge lengths, the active edge to the pointer, and once the preview has enough points to form a polygon, the closing edge back to the first point plus live area.
- Format Zone Measurement values compactly: centimeters for distances below one meter, meters for ordinary distances, square centimeters for areas below one square meter, square meters for ordinary areas, and hectares for large areas.
- Live Zone Measurements must describe the geometry that will actually be created, including snap-to-grid and snap-to-guides effects while drawing.
- Hide edge-length labels for edges that are too short in screen space; zooming in should make them available again. Area labels should remain visible for valid areas.
- Zone Measurement overlays respect Zone layer visibility. Locking does not suppress read-only measurements for an otherwise visible selected Zone.

## Annotation Rules

- Annotation geometry comes from shared helpers in `runtime/annotation-layout.ts`.
- Annotation text is readable presentation anchored to a design position; its visible text bounds are screen-space and should not be treated as physical world geometry.
- Annotation `rotationDeg` is visible geometry. Renderers, hit testing, band selection, grouping, zoom-to-fit, and selection/read-model bounds must consume the rotated frame helpers from `annotation-layout.ts` rather than reading unrotated text bounds directly.
- Use the same annotation bounds for hit testing, band select, grouping, zoom-to-fit, and selection outlines.
- Visible text should win hit testing over underlying zones/plants when it is on top.

## Plant Presentation

- Plant geometry, color, Plant Symbol resolution, and stack badges come from `runtime/plant-presentation.ts`.
- Visual Footprint is the shared presentation boundary for symbolic plant sizing; rendering, hit testing, band select, grouping bounds, and zoom-to-fit must consume the same computed footprint. Additional click/touch padding is allowed only as an explicit interaction affordance.
- Plant Symbols are built-in marker recipes visually composed within the existing circular Visual Footprint. The Visual Footprint is the interaction and layout boundary; glyph recipes should be optically balanced and may be inset instead of filling that boundary edge-to-edge. They must not change hit testing, band select, grouping bounds, zoom-to-fit bounds, stack badge placement, hover rings, selection rings, or locked-state rings.
- Render Plant Symbols with Pixi and Canvas2D native primitives rather than runtime SVG parsing, image textures, DOM overlays, or a new icon dependency. At low zoom where the symbol is not readable, collapse all symbols to the same dot/round marker.
- Plant Symbols apply to default symbolic marker mode. Canopy spread mode remains physical circle geometry when canopy spread is known; only the missing-canopy symbolic fallback should use the selected Plant Symbol.
- Plant Symbols stay upright and ignore placed plant rotation unless a future feature deliberately defines oriented marker symbols.
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
- Target map overlays for Zones must project effective Zone geometry. Rectangular and Elliptical Zone targets use the rotation-aware helpers in `canvas/runtime/zone-geometry.ts`; do not project raw persisted points for oriented Zone types.
- Canvas-origin hover remains separate.

## Canvas2D Tab Components

- Use `useCanvasRenderer` for DPR-aware canvas setup, resize observation, and redraw lifecycle.
- Use shared renderer utilities rather than duplicating drawing helpers.
- Planning tab read-models such as Timeline Action rows, layout lanes, species picker options, and Target derivation belong in `app/planning-projection/`; Canvas2D renderers own drawing, row heights, hit geometry, and pointer math.
- Planning tab UI should consume the relevant workbench or Planning Projection surface instead of calling canvas query surfaces directly for placed plants, localized Species names, Design Session planning arrays, or planning Target presentation. Budget UI uses the Budget Item Workbench; Timeline UI uses the Timeline Action Workbench; Consortium UI uses its Planning Projection/workbench seam.
- Planning Canvas Interaction Frame (`app/planning-canvas/interaction-frame.ts`) owns shared planning-canvas document listener lifetime, hover/selection Target Presentation write ordering, stale visible-item cleanup, and disposal cleanup. It is not the Scene Interaction Frame; scene tools stay under `canvas/runtime/interaction/frame.ts`. Planning surface adapters keep geometry, rendering, local interaction state, and Design Edit semantics in their own modules.
- Timeline Action document editing belongs in `app/design-edit/`; Timeline drag math belongs in `app/timeline/interaction.ts`; Timeline Action Canvas behavior belongs behind `app/timeline/canvas/`. `geometry.ts` owns row offsets, canvas height, action bounds, sidebar/ruler dimensions, and action-type row lookup. `host-model.ts` owns Planning Projection input assembly, canvas sizing, render callback/dependency assembly, frame listener installation, and tooltip/popover host-model projection. `controller.ts` owns Preact-facing interaction state, geometry/render-state refs, frame delegate assembly, and the small frame adapter seam. `interaction-frame.ts` owns pan, move, resize, autoscroll, origin freeze/restore, commit/abort, pointer ordering, wheel handling, popover open/save/delete/cancel ordering, keyboard delete, Timeline-specific drag cleanup, and composition of the Planning Canvas Interaction Frame for listener lifetime, stale identity cleanup, and Target Presentation writes. Canvas2D timeline UI consumes `useTimelineActionCanvasHostModel()` from `app/timeline/canvas/` plus the shared Canvas2D renderer hook; it must not import Timeline renderers, settings signals, interaction ordering, planning input assembly, or Design Edit transaction internals directly.
- Test Timeline Action Canvas interaction-frame behavior through `timeline-interaction-frame.test.ts`; keep source ownership guarded in `frontend-boundaries-sources.test.ts`.
- Consortium drag math belongs in `app/consortium/interaction.ts`; Consortium canvas event ordering, hover bridge behavior, drag lifecycle, and the Planning Canvas Interaction Frame adapter belong in `app/consortium/workbench.ts`. Shared planning document listeners, stale hover cleanup, and Target Presentation writes should go through the frame. Canvas2D consortium UI owns layout/render wiring, not interaction ordering or Design Edit transaction internals.
- Consortium Succession Phase and Stratum facts belong in `app/consortium/time-model.ts`; Canvas2D consortium renderers own pixel layout and drawing, not the Consortium Time Model.
- Canvas2D renderer functions receive `t` for i18n.
- Cache row offsets and layout computation in refs/memos for pointer paths.
- Snapshot drag-start values that can change mid-drag.
- Track whether a drag actually mutated state before marking documents dirty.
