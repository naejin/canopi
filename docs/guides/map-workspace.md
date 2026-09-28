# Map workspace

## Purpose

Boundaries of the design surface: MapLibre draws the geographic background and owns the camera, the scene runtime owns design objects, one PixiJS renderer draws the scene inside MapLibre. Why: [ADR 0001](../adr/0001-geolocated-map-canvas.md), [ADR 0002](../adr/0002-geolibre-module-reuse.md), [ADR 0004](../adr/0004-one-renderer.md), [ADR 0010](../adr/0010-map-first-interface.md). Paths are relative to `desktop/web/src/`; each rule ends with its enforcing test, or "(advice)".

## Authorities and boundaries

- **Scene runtime** (`SceneStore` behind `SceneCanvasRuntime`) owns design objects, layers, locks, species colours, symbols and codes, selection, hover, Species Focus and plant presentation. Only `SceneRuntimeEditCoordinator` (`canvas/runtime/scene-runtime/transactions.ts`) admits scene and selection commands, records history and hydrates; one authority operation is open at a time.
- **App code sees roles, never the runtime**: `CanvasCommandSurface` (`tools`, `viewport`, `history`, `sceneEdits`, `chrome`, `layers`, `plantPresentation`, `speciesFocus`), `CanvasQuerySurface` (read-only), `CanvasDocumentSurface` (`canvas/runtime/runtime.ts`). Consume the narrowest role. `canvas/runtime/` imports nothing from `app/**`; app behaviour enters through `CanvasRuntimeAppAdapter`.
- **The camera owner** (`maplibre/workspace-camera.ts`) is the only writer of the viewport. Camera moves never move objects. The map is north-up, pan/zoom only: no bearing, pitch or rotation anywhere.
- **The session plane** (`canvas/session-plane.ts`: local Mercator metres, x east, y south) is the runtime's only geometry; files store lon/lat. `canvas/projection.ts` holds the only projection math. `reorigin.ts` rebuilds the plane when the view centre is over 10 km (`SESSION_PLANE_REORIGIN_DISTANCE_METERS`) from the origin, re-projecting from stored lon/lat without dirtying anything.
- **The map is a derived visualisation.** Map layers (`app/map-layers/state.ts`) are device settings, never Design data, never undoable. Contributions (LiDAR rasters, terrain, Target overlays) render scene and Design state and never mutate it. LiDAR display: [Data library](data-library.md).
- **One of each per workspace generation**: map, WebGL2 context (MapLibre's), renderer, camera owner, DOM pointer owner (`canvas/runtime/scene-interaction.ts`), place-search controller, hidden snapshot map. No fallbacks.
- **Design Edit** owns budget, timeline, consortiums, views, stories and plant display ([Design document](design-document.md)). Story overrides, Species Focus, thumbnails and tool guidance are session state, never saved.

## Rules

- Exact camera sync: one geographic point, one pixel, in scene and map; no deadbands. (`__tests__/v2-shared-camera-transform.test.ts`)
- When WebGL2 or MapLibre fails, the workspace resolves `map-unavailable`: no renderer or interaction, Design still saveable. A failing optional contribution only skips itself (`canvas.layers.layerSkipped`). (`app/canvas-map-surface/workspace-map-unavailable.test.ts`, `workspace-map-contributions.test.ts`)
- `app/**` and `components/**` never import `maplibre-gl` (it lives under `maplibre/`); Web composition never imports raster display, the LiDAR library or display stores or the Desktop contribution adapter; production never imports the UI gallery. (`__tests__/frontend-architecture-policies.test.ts`)
- Every map-layer log goes through `maplibre/redact-credentials.ts`, because MapLibre copies request URLs, key included, into errors; no bare `console` in `maplibre/` or `app/canvas-map-surface/`. (policy test)
- Only `activeGoogleMapsApiKey` reaches the satellite provider, only while `satellite_source` is `google_key`, and only the map's `transformRequest` adds it. The key never enters published state, a Design, an export, a snapshot, a log or page markup. (`__tests__/settings-sections.test.tsx`, `satellite-bind.test.ts`, `map-background.test.ts`, `settings-projection.test.ts`)
- Background changes never call `setStyle()` or recreate map, camera, layer or runtime; `maplibre/map-background.ts` owns Basemap, Satellite and attribution; `app/map-layers/bands.ts` is the one layer order: register new layer ids there. (`__tests__/map-background.test.ts`, `app/map-layers/bands.test.ts`)
- MapLibre owns context, framebuffer, frame scheduling and resize. The custom layer draws only in its callback (`clear: false`), never clears the context, starts a ticker or resizes the canvas. (`__tests__/v2-shared-map-scene-layer.test.ts`)
- Invalidations stay typed (scene, viewport, chrome); viewport work never routes through a scene render. (`canvas/runtime/scene-runtime/render-scheduler.test.ts`)
- Design object identity is the typed pair `{ kind, id }`; ids repeat across kinds (`__tests__/scene-interaction-tool-boundary.test.ts`); `selectedObjectIds` is a notification, never authority (advice).
- Abort restores only persisted scene state and transaction-owned selection; an accepted commit is retried, never recorded twice. `captureForPersistence()` is the only save seam and reports busy during replay, hydration or replacement. (`canvas/runtime/scene-runtime/transactions.test.ts`, `__tests__/scene-persistence-authority.test.ts`)
- Overview (below 0.1 CSS px/m, `canvas/workspace-camera-policy.ts`) is presentation: the Design is one pin and mutation commands are unavailable; 100 % is 20 px/m (`ZOOM_REFERENCE_SCALE`, `canvas/runtime/camera.ts`). (`__tests__/canvas-overview.test.tsx` for the pin, `canvas/runtime/scene-runtime.test.ts` for blocked mutations)
- Species Focus, panel Target hover and selection, story overrides and thumbnails create no Scene Edit, history or dirty state (advice; `__tests__/target-presentation.test.ts` covers the hover and selection lifecycle); map presentation reads `app/story-presentation/overrides.ts`, never the controller (policy test "Map presentation reads story overrides, not the presentation controller").
- Tools are `SceneToolAdapter` modules (`canvas/runtime/interaction/tool-modules.ts`) given runtime seams, never `SceneStore`; creation tools guard hidden or locked layers at the mutation boundary; locked objects are selectable only as Unlock targets. (`scene-interaction-tool-boundary.test.ts`, `canvas/runtime/scene-runtime/mutations.test.ts`)
- A drag-to-create tool holds one Scene Edit from pointer-down to commit or cancel; a nudge series (0.1 m, 1 m with Shift, 800 ms idle) is one undo; cancellation runs once, in capture phase. (`__tests__/scene-interaction.test.ts`)
- Settings › Canvas › Scroll wheel (`scrollWheel`, `zoom` or `pan`) decides whether a plain wheel zooms or pans; pinch and Ctrl wheel always zoom and Shift wheel pans; the Select tool card's one line follows the choice (`canvas.toolCard.selectHint` / `selectHintPan`); arrows pan the map by 64 px (256 with Shift) when nothing is selected and nudge the selection otherwise. (`__tests__/scene-interaction.test.ts`, `settings-sections.test.tsx`, `settings-projection.test.ts`, `tool-card.test.tsx`)
- One placement authority (`scene-runtime/arrangement-placement.ts`; `__tests__/scene-arrangement-placement.test.ts`), one zone geometry (`canvas/runtime/zone-geometry.ts`; policy "Scene physical extent depends only on canonical Zone geometry"), one selection rotation (`scene-runtime/mutations.test.ts`), one rename (`sceneEdits.renameZone`; `canvas-context-menu-entries.test.ts`).
- Text and rings over the map follow the map backdrop (`basemap`, `dark-basemap`, `satellite`, `paper`) and the strokes of `canvas/runtime/scene-visuals.ts`, never the UI theme; every overlay stroke has a casing. (`__tests__/canvas-map-backdrop-ink.test.ts`, `canvas-overlay-casing.test.ts`, `canvas-map-surface-overlays.test.ts`)
- Place search requests on Enter only, `NOMINATIM_MIN_INTERVAL_MS` (1100, `app/geocoding/registry.ts`) apart; confirm is camera-only; Desktop reaches `geocode_address` only through `#geocoding-transport`. (`__tests__/place-search.test.ts`, `place-search-ui.test.tsx`, policy test)
- View snapshots run one at a time on the single hidden map (released after 30 s idle, at most 4096 device px a side), return an image, flags and credit text, never a URL, and touch neither the visible map nor the Design. (`maplibre/view-snapshot-map.test.ts`, `__tests__/saved-view-snapshot.test.ts`)
- CSP: `worker-src` and `child-src` admit `blob:` (`__tests__/tauri-csp.test.ts`); `script-src` carries `'wasm-unsafe-eval'` (advice); never broaden it for a missing worker bundle.

## Do not

- Publish a raw `SceneCanvasRuntime` or cast it to a role; tests use `createTestCanvasRuntimeSurfaces()`.
- Read the plane origin from the document; use `CanvasQuerySurface.sessionPlane`.
- Fit with a map-only `fitBounds`; go through the viewport command surface.
- Await an owner operation from a child setup or disposal promise.
- Claim a contribution was omitted while partial resources remain; a failed rollback is a core failure.
- Mirror Target geometry or scene layer rows into map state.
- Add a tile proxy, offline tile store, bulk download or service-worker cache.

## Where to look

| Area | Module | Tests |
|---|---|---|
| Host, loader, map | `maplibre/host.ts`, `loader.ts`, `surface-adapter.ts`, `workspace-map.ts` | `__tests__/maplibre-*` |
| Composition, admission | `app/canvas-map-surface/` | co-located `workspace-*.test.ts` |
| Background, satellite | `maplibre/map-background.ts`, `satellite-*.ts`, `basemap-tile-auth.ts` | `__tests__/map-background`, `satellite-*` |
| Map layers, terrain | `app/map-layers/`, `maplibre/terrain*.ts` | `__tests__/map-layers-store`, `maplibre-terrain` |
| Place search | `app/geocoding/` | `__tests__/place-search*` |
| Camera, plane | `canvas/session-plane.ts`, `projection.ts`, `workspace-camera-policy.ts`, `canvas/runtime/camera.ts` | `__tests__/session-plane`, `workspace-camera-*`, `camera-controller` |
| Views, stories, snapshots | `app/saved-views/`, `app/story-presentation/`, `maplibre/view-snapshot-map.ts` | `__tests__/saved-view*`, `story-presentation` |
| Runtime roles, authority | `canvas/runtime/runtime.ts`, `*-surface.ts`, `scene/`, `scene-runtime/` | `__tests__/canvas-runtime-surfaces`, `scene-runtime.test.ts` |
| Renderer | `canvas/runtime/renderers/`, `maplibre/shared-scene-layer.ts` | `__tests__/pixi-scene`, `maplibre-scene-renderer` |
| Presentation | `canvas/runtime/scene-visuals.ts`, `plant-display.ts`, `plant-presentation.ts`, `automatic-detail.ts` | `__tests__/plant-*`, `automatic-detail` |
| Interaction, geometry, lens | `canvas/runtime/scene-interaction.ts`, `interaction/`, `zone-geometry.ts`, `inspection-lens*.ts` | `__tests__/scene-interaction*`, `hit-testing`, `inspection-*` |

## Open decisions

- canopi-5ys2.3.9, canopi-5ys2.3.10: snapshots do not draw terrain, LiDAR site data or highlighted objects.
- canopi-5ys2.3.11, canopi-5ys2.3.12: snapshot timings in Tauri WebViews; reuse of the workspace Google session.
