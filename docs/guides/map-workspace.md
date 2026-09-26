# Map workspace

The map workspace is the design surface: MapLibre draws the geographic background and owns the camera; the scene runtime owns design objects; one PixiJS renderer draws the scene inside MapLibre. Read [architecture](../architecture.md) for authorities and the geolocation model, and [ADR 0001](../adr/0001-geolocated-map-canvas.md), [ADR 0002](../adr/0002-geolibre-module-reuse.md) and [ADR 0004](../adr/0004-one-renderer.md) for the decisions. LiDAR data is in [Data Library](data-library.md); file format and save/load are in [Design document](design-document.md); UI styling is in [.interface-design/system.md](../../.interface-design/system.md).

Paths are relative to `desktop/web/src/` unless they start with `desktop/`.

## Invariants

- The map is a derived visualization, never a document authority. Map layers render scene, Design and settings state; they never mutate it.
- Camera movement (pan, zoom, fit, Return, place search, LiDAR coverage) never moves design objects. The map is north-up and pan/zoom-only: no bearing, pitch, compass or rotation gestures anywhere in projection, camera or overlays.
- Exact camera sync is correctness-critical: the same geographic point lands on the same screen pixel in the scene and the map. No deadbands or tolerances that suppress small pan/zoom changes.
- One renderer (`maplibre-pixi`), one camera owner, one pointer owner, one map per workspace generation. No fallback renderer, second camera, standalone map surface or map gesture owner.
- If WebGL2 or MapLibre cannot start, or the map fails later, the workspace resolves `map-unavailable`: no renderer or interaction session is mounted, and the Design stays loaded and saveable.

## MapLibre host and map lifetime

- `maplibre/host.ts` owns low-level map lifetime: lazy loading, construction, resize observation, keyed rebuild teardown, preserved view state, init-failure callbacks and final removal. It imports no app authority (Design, Target, terrain, canvas). It snapshots the container's direct children and classes around construction and rolls back only that delta on failure or removal.
- `maplibre/surface-adapter.ts` is the typed seam above the host: typed map access, map-lifetime cleanup callbacks and listener cleanup. Production surfaces request map lifetime through it.
- Direct `maplibre-gl` imports and Map/Marker/Bounds/control/style construction live only under `maplibre/` (and tests). `maplibre/loader.ts` owns the lazy import and the one-time `setWorkerUrl()`; import the worker with Vite `?worker&url`, never plain `?url`. Failed loads stay retryable.
- `maplibre/workspace-map.ts` creates the workspace map from a source-free inline style with `interactive: false`, `minZoom: 0`, `maxZoom: 27`, `bearing: 0`, `renderWorldCopies: false` and an antialiased context (Pixi inherits that context and cannot enable multisampling later), centred on the session plane origin.
- The templates world map (`components/world-map/WorldMapSurface.tsx`, constructors in `maplibre/world-map.ts`) uses the same surface adapter and mounts the same background band.

## Workspace composition and admission

- `app/canvas-map-surface/workspace-runtime-composition.ts` is the one construction seam: exactly one camera owner, one MapLibre renderer, one scene runtime, the activation coordinator, the generation reconciler and the wrapped document surface. `desktop-workspace-runtime.ts` and `web/browser-workspace-runtime.ts` mount it through `WorkspaceRuntimeMountOptions` without importing each other. Edition lifecycles await `start()` before rulers or Design attachment and hand the Design off synchronously before observer, settings and composition cleanup.
- `app/canvas-map-surface/workspace-activation.ts` admits a map generation transactionally. `activate(snapshot)` binds the Design session identity, the initial centre, the latest background presentation and an optional world extent. Map creation, WebGL2 acquisition, the attached custom layer and the attached camera must all succeed before the first `SceneCanvasRuntime.init()` mounts `maplibre-pixi`; remote tile readiness is not an admission condition.
- Failure before first init cleans the attempt and resolves `map-unavailable` without initializing the runtime. Failure after init cleans that generation, calls `SceneCanvasRuntime.unmountRenderer()` once and fences map restart for that coordinator.
- Design replacement: `app/canvas-map-surface/workspace-document-surface.ts` wraps only `replaceDocument()` and synchronously requests a generation disconnect before delegating. Disconnect publishes one retained settlement, aborts acquisition, fences callbacks, detaches the camera and disposes the layer while the context is valid, then releases the map. The next generation reuses the initialized runtime and renderer bridge; the bridge's retained-snapshot replay is the only scene handoff between maps. Equal map values with a new session identity still form a new generation.
- `app/canvas-map-surface/workspace-generation-reconciler.ts` bridges the synchronous replacement to activation through an opaque ticket; only that ticket may queue the post-replacement snapshot read. Successor replacement, disposal or a stale ticket invalidates queued work.
- The newest activation wins; abort and generation fences reject stale map, style, camera, init and failure callbacks. Teardown is memoized, joins generation cleanup and pending init, and alone destroys the runtime. A child setup or disposal promise must never await an owner operation that joins that child.
- `app/canvas-map-surface/workspace-map-controls.ts` adapts the map to admission through one surface adapter. Background presentation updates are scoped to the current attempt, never recreate the map, camera, layer or runtime, and never call `setStyle()`. One attempt-scoped reconciliation drain serializes style reload and presentation work; a failed mutation fences later drains and reaches the failure watcher.
- `app/canvas-map-surface/workspace-map-contributions.ts` owns session-bound contributions: LiDAR rasters, terrain, panel Target overlays, semantic order, readiness, view bounds and diagnostics. It rebuilds from the latest snapshot after `style.load`. A failed LiDAR layer is omitted passively until its source shape changes; a failed removal or terrain rollback is a hard map failure (never claim omission while partial resources remain). Overlay-sync and ordering failures are terminal.
- `workspace-map-contribution-adapter.ts` defines the immutable contribution snapshot. Desktop supplies LiDAR, terrain and Targets; Web (`web/browser-workspace-map-contribution-adapter.ts`) supplies empty LiDAR and terrain and imports no Desktop code. Target geometry is read through the read-only scene query, never mirrored.

## Map layer store and bands

- `app/map-layers/state.ts` owns Basemap (style, visibility, opacity), Satellite (visibility, opacity), Contours and Hillshade; `app/map-layers/actions.ts` mutates them through the settings projection (toggles persist immediately, sliders are queued). Map layers are not undoable and never enter a Design. `mapBackgroundOf()` decides the background: Satellite on hides the Basemap without changing the Basemap toggle.
- `app/map-layers/bands.ts` is the single semantic order for Canopi-owned layers, back to front: background (basemap or satellite), LiDAR items, terrain references, the shared scene layer, interaction overlays. It validates the descriptor list, reads `getLayersOrder()` (style serialization omits custom layers), applies only needed `moveLayer()` calls and never recreates the scene layer. Register new layer ids in its descriptors.
- `app/canvas-layer-presentation/presentation.ts` turns scene layers and the map layer store into Layers rows. Site references: Basemap (style, opacity), Satellite (the optional Google device key field, with a note that without it the public tiles are used; opacity), the Design's LiDAR items, Contours, Hillshade. Web shows Basemap and Satellite only. `gridVisible` is canvas chrome, not a map row.
- Map snapshots read the store directly (`readWorkspaceBackgroundPresentation`, `mapTerrainStateOf`); never build scene layer rows or clone geometry for map settings.

## Background band and providers

- `maplibre/map-background.ts` (`mountMapBackground`) is the one owner of a map's Basemap, Satellite and attribution control. No surface binds a basemap itself. It waits for `mapStyleReadiness(map, lifetime)` (`addSource` throws before style load) and then applies the latest presentation. `whenReady()` returns a disposer and fires at most once, removing its `load`/`style.load` listeners when it fires or is disposed; the background and the satellite binding keep at most one pending wait and dispose it in their own `dispose()`.
- `maplibre/openfreemap-basemap.ts` installs the OpenFreeMap vector style (Liberty default; Positron, Bright, Dark; presets copied from GeoLibre) as `ofm-` sources and `ofm:` layers with `setGlyphs`/`setSprite`, never `setStyle()`. Row opacity scales every installed layer's paint opacity, keeping zoom curves. Labels use `name:<locale>` falling back to `name`. OpenFreeMap credit comes from its TileJSON.
- Google is the only satellite imagery; there is no provider choice. `maplibre/satellite-provider.ts` (`resolveSatelliteDescriptor(config)`) picks from the device key alone: without one, a plain raster source on `GOOGLE_KEYLESS_TILES` (`https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}`, max zoom 20, "© Google"; not a published API, see ADR 0001), `official: false`, no session or request; with one, the official Map Tiles API session. `satellite-provider-session.ts` owns Google session acquisition, viewport metadata, renewal and fencing; `satellite-contribution.ts` reconciles the one raster source and layer; `satellite-bind.ts` wires them once the style accepts sources and re-runs the session when the key or locale changes. Settled `moveend` refreshes Google viewport metadata only; renewal publishes `loading` so a dead token is never used. Google copyright is custom attribution on the same control.
- **Credential boundary.** `maplibre/basemap-tile-auth.ts`: published descriptors carry the credential-free template `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}`. The map's `transformRequest` closes over that map's own auth object and adds the session and key for that endpoint only; every other URL passes untouched. A map without a transport cannot serve the official path, so an unresolvable `{session}` withdraws the contribution. Credentials are published while the session is live and cleared on disposal. The key never enters published state, a Design, an export, a snapshot, a diagnostic bundle or a log.
- Hidden presentation adds no remote source work. Session and recognized source errors are passive; the rest of the map keeps working.
- Canopi has no tile proxy, offline tile store, bulk download or service-worker cache in either edition.

## Terrain references (Desktop)

- Contours and hillshade come from the terrarium DEM through `maplibre-contour` (`canvas/contours.ts`, `maplibre/terrain*.ts`). Web has neither.
- Paint-only changes (opacity, theme) stay incremental through `maplibre/terrain-sync.ts`; rebuild sources and layers only when source-shape inputs change. Terrain load, source or rebuild errors leave editing ready once partial contributions are removed.

## LiDAR band

- `maplibre/raster-display/adapter.ts` is the only owner of upstream `maplibre-gl-raster` objects (one `LayerManager` per live map, `cog-tiler-wasm` engine). Layer ids change with the displayed generation; opacity is paint-only; `dispose()` removes layers, sources, protocol and listeners. Contract details are in [Data Library](data-library.md#map-display).
- Passive failures (unready descriptor, engine error, missing library entity) omit only that contribution.
- Coverage and Return go through the canvas viewport command surface, not a map-only `fitBounds`: the four WGS84 corners are converted through the session plane and fitted with 48 CSS px padding, capped at the scale of MapLibre zoom 18. The first bookmark is retained until Return.

## Place search

- The pin icon button under the inspection lens button, `Ctrl+F` (`view.searchPlace`) or the empty-Design "Search your site" prompt opens `components/canvas/PlaceSearch.tsx`. The component only renders: `app/geocoding/place-search-session.ts` owns the one place-search controller (bound to `#geocoding-transport`) and closes and clears the search when the Design is replaced. Both platform bootstraps install it (`installPlaceSearchSession()`).
- `app/geocoding/place-search.ts` parses coordinates locally and paces requests; `app/geocoding/registry.ts` (copied from GeoLibre) holds providers: Nominatim first, search on Enter only, never as-you-type, at least 1.1 s between requests (`NOMINATIM_MIN_INTERVAL_MS`), OSM attribution on results.
- The `#geocoding-transport` alias selects the edition transport: `transport.desktop.ts` calls the native `geocode_address` command (identifying User-Agent); `transport.browser.ts` uses `fetch`. No proxy.
- Confirm calls `viewport.showPlace`: camera only.

## Camera and session plane

- The runtime works in metres in the session plane (`canvas/session-plane.ts`): local Mercator, x east, y south, scaled at the origin latitude, an exact affine image of the map. `SceneStore` owns the plane and the codec's ledger of loaded lon/lat (`canvas/runtime/scene/geo-frame.ts`); map code reads it through `CanvasQuerySurface.sessionPlane`, never from the document.
- `canvas/projection.ts` holds the only local-Mercator math (`worldToGeo`, `geoToWorld`, zoom/scale conversion); `canvas/maplibre-camera.ts` converts a plane viewport to MapLibre centre/zoom. No separate projection math, zoom shortcuts or equirectangular fallbacks elsewhere.
- `maplibre/workspace-camera.ts` implements `WorkspaceCameraOwner`. Detached it behaves like `CameraController`; attached (`{ map, readOrigin }`) it sends navigation only to the active map and publishes every accepted `move`/`resize` frame through one stable signal, reading the plane origin live. `attachment.refreshOrigin()` republishes after a plane change without moving the map. Detach, replacement and projection rejection fence callbacks and keep the last valid frame. It never creates or removes the map.
- `maplibre/scene-camera-transform.ts` derives the metre viewport from live MapLibre projection and rejects pitch or excessive affine residual.
- **Re-origin.** `canvas/runtime/scene-runtime/reorigin.ts` watches settled site-scale frames; when the view centre is more than 10 km from the origin, the settled scene authority rebuilds the plane at the view centre and one reprojector updates the scene store, every undo command, the clipboard and the viewport (`reprojectViewport`). Objects re-project from stored lon/lat; nothing is dirtied or recorded.
- **Last view.** A view settled for 750 ms (`WORKSPACE_VIEW_SETTLE_MS`) is reported through `onViewSettled` and stored as the `last_view` setting (`app/canvas-map-surface/last-view.ts`). Fitting an empty Design centres the origin at the last view's zoom.
- **Zoom policy.** `canvas/workspace-camera-policy.ts` maps MapLibre zoom 0–27 into plane scale at the origin latitude, derives a single-world minimum for the screen and enters overview strictly below 0.1 CSS px per metre. 100 % is 20 CSS px per metre regardless of window size. Clamping precedes anchor compensation; an exhausted input is an exact no-op (same frame object and revision).
- Temporary bounds navigation (`focusTemporaryBounds()` / `returnFromTemporaryFocus()`) retains only the first pre-focus viewport. Init, successful load or replacement and disposal clear it; a replacement rejected before hydration keeps it.

## Scene runtime surfaces

- App code sees only `CanvasRuntimeSurfaces`: `CanvasCommandSurface` (roles `tools`, `viewport`, `history`, `sceneEdits`, `chrome`, `layers`, `plantPresentation`, `speciesFocus`), `CanvasQuerySurface` (read-only snapshots, `viewport` frame signal, `revision`, selection, placed plants, names, `sessionPlane`) and `CanvasDocumentSurface` (load, replace, persistence capture, viewport init, chrome, resize, teardown, `attachInspectionTo()`). Consume the narrowest role (`canvas/session.ts`); only the app command graph takes the full command surface.
- `createCanvasRuntimeSurfaces()` composes `runtime.commandSurface`, `querySurface` and `documentSurface` directly. Never publish a raw `SceneCanvasRuntime` or cast it to a role; tests use `createTestCanvasRuntimeSurfaces()`.
- Role behaviour lives in `canvas/runtime/{command,query,document}-surface.ts`; `canvas/runtime/runtime.ts` owns the interfaces. `SceneCanvasRuntime` is a thin shell for init, interaction attachment and construction callbacks.
- `canvas/runtime/scene-runtime/construction.ts` builds SceneStore, the one camera owner, SceneHistory, the settled scene authority, the render scheduler with its one injected renderer, presentation, document bridge and role surfaces. It returns only a `SceneStateReader`, a session writer and edit/admission roles; never leak the concrete store.
- `canvas/runtime/lifecycle-owner.ts` holds the single runtime lease (`acquireCanvasRuntimeLifecycle`); a new runtime waits for the previous release. The standalone Canvas host for the UI gallery and live-runtime tests lives in `ui-gallery/scene-canvas-runtime-host.ts`; production never imports the gallery.
- Production files under `canvas/runtime/` never import `app/**`. App behaviour enters through `CanvasRuntimeAppAdapter` (`canvas/runtime/app-adapter.ts`; production factory `app/canvas-runtime/app-adapter.ts`): Design composition, clean state, `translate`, settings reads/writes, layer projection and presentation data. Optional capabilities stay absent, never no-op.
- `app/canvas-commands/` owns the platform-neutral toolbar catalog (tool groups, labels, shortcuts, availability, typed intents). A disabled command never dispatches; adapters re-read the live command surface at dispatch time. Web shortcuts install through `web/canvas-shortcuts.ts`, not the Desktop command graph.

## Scene authority and history

- `SceneStore` owns plants, zones, annotations, measurement guides, groups, object locks, layers, species colours, symbols and code reservations, selection, hover, Species Focus and plant presentation state. Viewport state belongs only to the camera owner. Budget, timeline, consortiums, description and extra belong to Design Edit.
- Design object identity is always the typed pair `{ kind, id }` (`canvas/runtime/scene/design-object-targets.ts`); ids are not unique across kinds. Commands, history, hit results, locks and renderer snapshots preserve the pair and never infer kind from a raw id. The app `selectedObjectIds` signal is a lossy UI notification, never selection authority.
- `SceneStore.persisted` returns a defensive clone; mutators clone completed drafts before installing them. Read-side tools get `SceneStateReader`/`SettledSceneReader`, never the store.
- `SceneRuntimeEditCoordinator` (`scene-runtime/transactions.ts`) is the settled scene authority: it alone admits persisted scene and selection commands, records history, replays undo/redo, applies presentation backfills and hydrates documents. Exactly one authority operation is open at a time (a Scene Edit, one replay, hydration or reserved replacement); others get busy (`SceneEditBusyError`). Whole commands cross `runWhenSettled()` before reading live preview state.
- Abort restores only persisted scene state and transaction-owned selection, never camera, hover or active-layer settings. Once history accepts a commit, later publication failures retry that committed outcome; they never record twice or roll back. Post-commit cleanup uses the idempotent `onCommitted` continuation.
- UI mirrors (selection, layer settings, guides, species colours) publish as an idempotent settlement phase after commit or abort, never from inside a transaction callback. Guides are scene edits; runtime reads `SceneStore.persisted.guides`, not the `guides` signal.
- Presentation backfills (canonical names, species metadata) are non-dirty enrichment carried by opaque tickets and validated against plant identity and canonical name before applying.
- `SceneHistory` dirty state uses unique state identities: undo to the saved identity is clean; a divergent branch at the same depth is dirty; clearing history makes old checkpoints stale. Scene and Design Edit entries share one sequence so the history command undoes the newest across both. Selection, hover, labels and viewport work never create history.
- `CanvasDocumentSurface.captureForPersistence()` is the only save seam: owned content, exact-current observation and an idempotent `acknowledgeSaved()`. During an open edit it captures the committed before-state; during replay, hydration or replacement it reports busy (`CanvasAuthorityBusyError`). Acknowledgement revalidates generation and runtime lifetime before and after publishing clean state.
- Document replacement reserves the successor authority before cancelling interaction. Failure before hydration raises `CanvasDocumentReplacementNotAdmittedError` and leaves the old scene authoritative. Replacement hydration alone clears history. Attached Design opens call `zoomToFit()` after hydration.
- Cross-authority writes from scene data read a settled query (for example `getSettledPlacedPlants()`) and skip work while it returns `null`.

## Renderer

- `canvas/runtime/renderers/maplibre-scene.ts` bridges scene snapshots to one map-owned target; it owns no canvas, resources, observer, ticker or frame callback. Connections are generation-fenced. `maplibre/shared-scene-layer.ts` is the custom layer; `maplibre/shared-scene-renderer.ts` composes them; `canvas/runtime/renderers/pixi-scene.ts` is the retained Pixi presentation.
- MapLibre owns the WebGL2 context, framebuffer, camera, frame scheduling, resize and context lifetime. The layer never clears or loses the context, starts a ticker, resizes the canvas or draws outside the custom-layer callback (`clear: false`). Scene edits and camera changes call `triggerRepaint()`. It uses a direct `WebGLRenderer` with explicit state reset and resource-only teardown, because Pixi's normal destroy loses the shared context. Style reload and context restore recreate resources from scene authority.
- Every admitted callback submits the retained stage; an unchanged camera and size skip presentation sync; a pending snapshot or resize always syncs first.
- `canvas/runtime/scene-runtime/render-scheduler.ts` owns the mounted renderer: mounts once, rejects a second mount, coalesces invalidations into one frame (scene beats viewport), fences stale preparation, reports fire-and-forget failures and leaves the scene intact on `unmount()`. Awaited scene renders stay immediate for document settlement.
- Invalidation kinds: scene (content, selection, presentation, locale, theme, hover) via `renderScene()`; viewport (pan, zoom, fit, resize) via `setViewport()`; chrome (rulers, grid, guides). Never route viewport work through a full scene render.
- `SceneRendererSnapshot` is total: typed hover target, per-kind selections derived from typed targets, `selectionLabelPlantIds` only for a single direct plant selection. No missing-array fallbacks.
- Screen-space chrome stays outside the renderer. `canvas/rulers.ts` owns the ruler/scale overlay lifetime; grid (`canvas/grid.ts`) and scale bar (`canvas/scale-bar.ts`) compose around it.

## Presentation invariants

- Zones and measurement guides draw under the camera transform; plant symbols, stack badges, annotation text and markers and labels draw in CSS-pixel layers from shared screen points. Backing resolution follows the MapLibre canvas density; Pixi text textures use twice that density; font sizes stay in CSS px. Zone stroke width divides by camera scale only. Strokes, labels, handles and badges stay screen-readable across zoom.
- `canvas/runtime/scene-visuals.ts` defines hover, selected, locked-object and locked-layer strokes, shared by Pixi and the inspection lens; selected is stronger than hover, and locked cues never imply editability. Colours resolve from canvas theme tokens; persisted entities never carry highlight state.
- `canvas/runtime/text-visibility.ts` fades annotation text and pinned names from hidden at 8 to full at 20 CSS px per metre. A single directly selected plant or annotation, or a hovered annotation, bypasses fading and collision. Fading is screen-only; PDF uses its own detail rules ([PDF export](pdf-export.md)).
- `canvas/runtime/annotation-layout.ts` owns annotation geometry: an 8 px note marker crossfades with text; crowded notes keep a quiet 4 px square. Below half text opacity the marker drives hit testing and bounds, above it the rotated text does. Fit to content always uses full authored text bounds (`getAnnotationWorldBounds`); interaction uses the visual helpers.
- `canvas/runtime/plant-presentation.ts` owns plant geometry, colour, symbol and stack badges. The visual footprint is the one sizing boundary for drawing, hit testing, band select, group bounds and fit. Radius follows the symbolic curve capped at 42 % of the nearest distinct neighbour's screen distance, floor 0.65 CSS px; below 3.6 px it is a solid dot. Stack counts only mark exactly coincident positions. Symbols are native contours from `canvas/runtime/plant-symbol-recipes.ts` (no SVG parsing, textures or DOM), stay upright and never change the footprint.
- `canvas/runtime/automatic-detail.ts` admits plant names, annotation text and guide distances into free screen space, pan-independent. Automatic names need 500 % (100 px/m) and 35 px separation; pinned names win; short species codes from 50 px/m. Nothing admitted is persisted.
- `canvas/runtime/species-key.ts` assigns deterministic, locale-independent species codes persisted as reservations. Species Focus dims other plants as session state only: no history, no dirty state, never printed.
- Overview (below 0.1 px/m) is presentation, not document state: the snapshot omits authored objects, names, selection, grids, guides and rulers; creation and mutation commands are unavailable; primary drag pans. The origin marker and **Return to Design** fit the Design. Map-unavailable overview must not imply geographic scale.
- Target overlays (`target/`, `app/panel-targets/presentation.ts`) resolve typed `PanelTarget` values to scene ids; `manual` and `none` resolve empty. Panel hover and selection never change canvas selection, history or dirty state. Zone targets project effective oriented geometry.

## Interaction

- `canvas/runtime/scene-interaction.ts` (`SceneInteractionSession`) is the only DOM pointer owner: listener lifetime, pointer capture (window capture listeners as fallback), drag routing, tool transitions, cancellation and teardown. Pointer-down, keydown and continuation listeners run in capture phase so cancellation runs first and overlays cannot strand a gesture. Matching `pointercancel`, unexpected capture loss, Escape, blur, tool change, document replacement and disposal cancel once; a failed cancellation quarantines later mutation routes until retried.
- Pan and zoom reach the session, whose navigation targets the camera owner; tool gestures mutate the scene only. Wheel: plain vertical zooms at the pointer; Shift pans; Ctrl/Cmd and trackpad pinch zoom. Space-drag and middle button pan. Deltas are normalized (16 px per line, viewport per page) and only effective changes publish.
- Tools are `SceneToolAdapter` modules behind `canvas/runtime/interaction/tool-modules.ts` (annotation text, zone drawing, object stamp, plant stamp, plant spacing). They own their state machines and overlays and receive only runtime seams, never `SceneStore`. Shared pan, band select and object drag live in `interaction/shared-gestures.ts`.
- Scene edits go through the edit coordinator. Drag-to-create tools hold one Scene Edit from pointer-down to commit or cancel. Creation tools guard the target layer at the mutation boundary: hidden or locked target layers create nothing.
- Hit testing and selection geometry are scene-side and use the same presentation context as rendering. Direct object hits beat zone boundaries; the selected zone's control points beat everything inside their hit target. Hover may use visible-only hits to explain locks; editable hits ignore locked layers.
- Locks and groups: groups are flat and typed; a group is editable only when all members are on visible, unlocked layers; directly locked objects are selectable only as Unlock targets; mutation targets come from the typed editable-selection model (`CanvasQuerySurface.getDesignObjectSelection()`).
- Runtime-owned DOM overlays: Selection Action Toolbar, Rotation Handle, control points (`interaction/control-point-overlay.ts`), context menu, hover tooltip, tool HUDs. They hide during drags and non-select tools, update text in place on locale change and never steal focus. Active gestures receive pointer movement before overlay ignore checks.
- `canvas/runtime/scene-runtime/arrangement-placement.ts` is the one placement authority for paste, duplicate, object stamp and saved object stamps: fresh ids, collision handling, group remapping, atomic insertion, one history entry, final selection. Normal paste offsets 1 m right per repeat; context paste centres on the clicked point.
- Document keyboard handlers guard with `isEditableTarget(event.target)`. Test through the user-equivalent harness in `__tests__/support/scene-interaction-events.ts`, not session internals.

## Geometry

- `canvas/runtime/zone-geometry.ts` is the only zone geometry: rectangle and ellipse are oriented shapes (`rotationDeg`, clockwise from north); ellipses store centre plus radius vector; linear and polygonal zones rotate their points. Rendering, hit testing, band select, bounds, fit, measurements, stamps and Target overlays all use it.
- Zone selection is boundary-proximity (about 6 px screen tolerance); band select is area-based. Control-point drags keep the zone type, snap to grid and guides and commit one edit only when geometry changed.
- Zone measurements are derived, pointer-transparent screen overlays shown while drawing and for one selected zone; they describe the snapped preview geometry.
- `canvas/runtime/scene-physical-extent.ts` computes the radial extent from the origin (plants, effective zones, annotation anchors, guide endpoints), excluding screen footprints.

## Dense canvas and inspection lens

- Reading aids never change the Design: no Scene Edit, history or dirty state. `canvas/plant-spacing.ts` caches nearest distances on immutable plant arrays and is shared by the canvas, lens and PDF. `canvas/label-collision.ts` buckets label rectangles.
- `CanvasDocumentSurface.attachInspectionTo()` returns a disposable handle (`canvas/inspection.ts`). `SceneCanvasInspectionOwner` owns the preview canvas, subscriptions, observer, frame, independent inspected location and hover; attachment failure rolls back. Replacement resets the location; destruction releases lenses.
- The lens opens at the canvas centre and follows pointer movement over artwork (host-relative CSS px through `inspectAtScreenPoint`); moving onto controls keeps the last location; editing drags do not redirect it. It pans by drag or arrows, never moves the main camera or selection, excludes hidden plant layers, and its Canvas2D preview (`inspection-lens-drawing.ts`) is renderer-neutral and DPR-aware. `inspection-layout.ts` places full localized names with connectors and never forces overlaps.

## Tauri, network and profiling

- `desktop/tauri.conf.json` CSP: images and connections allow HTTPS plus the scoped asset protocol; `script-src` adds `'wasm-unsafe-eval'` for the raster engine; `worker-src` and `child-src` admit self-hosted workers and `blob:`. Never broaden CSP to cover a missing worker bundle.
- Linux startup sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` in process startup before WebKitGTK initializes.
- Desktop geocoding (`desktop/src/services/geocoding.rs`) runs through the Native Operation Executor `Network` class with `ureq` timeouts and response size limits ([Native and release](native-and-release.md)). The Google session uses browser HTTP (`maplibre/satellite-http.browser.ts`) in both editions.
- Profiling: open the native Web Inspector (`Ctrl+Shift+I`); the scene draws in `.maplibregl-canvas`. For unattended Linux runs, set `WEBKIT_INSPECTOR_HTTP_SERVER=127.0.0.1:9231` in an isolated `dbus-run-session` with temporary `XDG_*` dirs and a copied Design; WebKit routes commands via `Target.sendMessageToTarget`. Use Spector.js standalone for WebGL capture (disabled during timing). WebGL strings can be generic; corroborate the GPU with OS process attribution. A second animation frame is not GPU completion.
- Performance changes keep work-count assertions beside visual and state assertions: a faster renderer that drops selection, changes botanical appearance or publishes stale state is a regression. Plant geometry contexts are shared only for exactly equal effective geometry and must be rebound before destroy.

## GeoLibre reuse decisions

Copied modules and commits are in `THIRD_PARTY_NOTICES.md`; the boundary is in [architecture](../architecture.md#geolibre-reuse-boundary). Compared with GeoLibre `e9df9e2`, these were not adopted because none made Canopi smaller or clearly better:

| Canopi area | GeoLibre source | Reason |
|---|---|---|
| Contours, hillshade | `terrain-control.ts`, `cog-dem-source.ts` | GeoLibre toggles 3D terrain (Canopi is flat, pan/zoom only) and reads DEM COGs with main-thread `geotiff`; it has no contour wiring. |
| Terrain and overlay sync, band order | `layer-sync.ts` | Built for arbitrary user layers; Canopi syncs a few fixed layers and its reconciler moves only inverted pairs, leaving unmanaged layers alone. |
| Basemap opacity and labels | `map-controller.ts` | Same approach; Canopi scales only the layers it installed. |
| Raster display | `cog-imagery.ts`, `plugins/maplibre-raster.ts` | Drives the upstream control UI with a main-thread tiler; its codec patches do not apply to DEFLATE display COGs. |
| Zone fill patterns | `fill-patterns.ts` | Zones are drawn by Pixi without patterns; patterns are a product decision. |
| Map capture, print layout | `map-capture.ts`, `print-layout-export.ts` | PDF has no maps in v2.0 ([ADR 0008](../adr/0008-canvas-pdf-export.md)); re-evaluate when map export returns. |
| Attribution, resize, bounds | `collapsed-attribution-control.ts`, `map-resize.ts`, `map-bounds.ts` | Collapsing credit changes required attribution; the host owns resize; `canvas/projection.ts` has the same formulas. |

`@geolibre/map` is not a dependency. The PDF path never mounts or captures a map or fetches map assets.

## Tests

Map, camera and interaction changes need the Frontend and Shared composition gates in [AGENTS.md](../../AGENTS.md#quality-gates). Keep boundary tests such as `scene-interaction-tool-boundary.test.ts` and the runtime dependency-graph assertion green; they encode the ownership rules above.
