# Map workspace

## Purpose

Boundaries of the design surface: MapLibre draws the background and holds the camera state, the scene runtime owns design objects, one PixiJS renderer draws the scene inside MapLibre. Why: ADR [0001](../adr/0001-geolocated-map-canvas.md), [0002](../adr/0002-geolibre-module-reuse.md), [0004](../adr/0004-one-renderer.md), [0010](../adr/0010-map-first-interface.md), [0015](../adr/0015-rotating-map-and-canvas-controls.md) to [0019](../adr/0019-rendering-and-the-view-transform.md). Paths are relative to `desktop/web/src/`; each rule ends with its enforcing test, or "(advice)".

Rules state the intended boundary; a module marked "today" holds the role until Canvas v2 ([plan](../plans/canvas-v2-plan.md)) replaces it.

## Authorities and boundaries

- **Scene runtime** (`SceneStore` behind `SceneCanvasRuntime`) owns design objects, layers, locks, species colours, symbols and codes, selection, hover, Species Focus and plant presentation. Only `SceneRuntimeEditCoordinator` (`canvas/runtime/scene-runtime/transactions.ts`) admits scene and selection commands, records history and hydrates; one authority operation is open at a time.
- **App code sees roles, never the runtime**: `CanvasCommandSurface` (`tools`, `viewport`, `history`, `sceneEdits`, `chrome`, `layers`, `plantPresentation`, `speciesFocus`), `CanvasQuerySurface` (read-only), `CanvasDocumentSurface` (`canvas/runtime/runtime.ts`). Use the narrowest role. `canvas/runtime/` imports nothing from `app/**`; app behaviour enters through `CanvasRuntimeAppAdapter`.
- **One camera writer.** The camera has centre, zoom and bearing (degrees clockwise from true north); pitch is 0 but no module assumes it ([ADR 0016](../adr/0016-one-view-transform.md)). MapLibre's transform holds the state; one camera driver (`maplibre/camera-driver.ts`) computes, constrains and applies every move. Camera moves, turning included, never move objects; editing stays top-down.
- **The session plane** (`canvas/session-plane.ts`: local Mercator metres, x east, y south, north-aligned whatever the view's bearing) is the runtime's only geometry; files store lon/lat. `canvas/runtime/view/` holds the only projection and camera maths (today `canvas/projection.ts`). `reorigin.ts` rebuilds the plane when the view centre is over 10 km from the origin, re-projecting from stored lon/lat without dirtying anything.
- **The map is a derived visualisation.** Map layers (`app/map-layers/state.ts`) are device settings, never Design data or undoable. Contributions (LiDAR, terrain, Target overlays) render scene and Design state, never mutate it. LiDAR display: [Data library](data-library.md).
- **One of each per workspace generation**: map, WebGL2 context (MapLibre's), renderer, camera driver, view transform, DOM input owner ([ADR 0017](../adr/0017-input-pipeline-and-gestures.md); `canvas/runtime/input/dom-input-source.ts`), tool host, place-search controller, hidden snapshot map. No fallbacks.
- **Design Edit** owns budget, timeline, consortiums, views, stories and plant display ([Design document](design-document.md)). Story overrides, Species Focus, thumbnails and tool guidance are session state, never saved.

## Rules

- Exact camera sync: one view transform (metres to CSS px, bearing included) serves map, scene, overlays, hit testing and tools; one point, one pixel; no deadbands. (`canvas/runtime/view/view-transform.test.ts`)
- When WebGL2 or MapLibre fails, the workspace resolves `map-unavailable`: no renderer or editing, Design still saveable, until a user Retry rebuilds it; nothing restarts on its own. Notices show no engine text. A failing optional contribution only skips itself. (`app/canvas-map-surface/workspace-{activation,map-unavailable,map-contributions}.test.ts`)
- `app/**` and `components/**` never import `maplibre-gl`; Web composition never imports raster display, the LiDAR library or display stores or the Desktop contribution adapter; production never imports the UI gallery. (`__tests__/frontend-architecture-policies.test.ts`)
- Every map-layer log goes through `maplibre/redact-credentials.ts`, because MapLibre copies request URLs, key included, into errors; no bare `console` in `maplibre/` or `app/canvas-map-surface/`. (policy test)
- Only `activeGoogleMapsApiKey` reaches the satellite provider, only while `satellite_source` is `google_key`, only through the map's `transformRequest`. The key never enters published state, a Design, an export, a snapshot, a log or page markup. (`__tests__/settings-sections.test.tsx`, `satellite-bind.test.ts`, `map-background.test.ts`, `settings-projection.test.ts`)
- Maps take only their first `style.load`; nothing calls `setStyle()` or recreates map, camera, layer or runtime for a background change. `maplibre/map-background.ts` owns the background; `app/map-layers/bands.ts` orders layers. (policy test, `map-background.test.ts`, `bands.test.ts`)
- MapLibre owns context, framebuffer, frame scheduling and resize. The custom layer draws only in its callback (`clear: false`); it never clears the context, starts a ticker or resizes. (`__tests__/v2-shared-map-scene-layer.test.ts`)
- A view change never routes through a scene render or rebuilds retained scene geometry; the custom layer reads the camera frame in its own `render` ([ADR 0019](../adr/0019-rendering-and-the-view-transform.md)). (`canvas/runtime/scene-runtime/render-scheduler.test.ts`)
- Design object identity is the typed pair `{ kind, id }`; ids repeat across kinds (`scene-runtime-boundaries.test.ts`); `currentCanvasSelection` is a notification, never authority (advice).
- Abort restores only persisted scene state and transaction-owned selection; nothing retries; an accepted commit is never recorded twice. `captureForPersistence()` is the only save seam, busy in replay, hydration, replacement or a failed open. (`canvas/runtime/scene-runtime/transactions.test.ts`, `__tests__/scene-persistence-authority.test.ts`)
- Overview (below 0.1 CSS px/m, `canvas/workspace-camera-policy.ts`) is presentation: the Design is one pin and mutation commands are unavailable, selection or not. (`__tests__/canvas-overview.test.tsx`, `canvas/runtime/scene-runtime.test.ts`)
- Species Focus, panel Target hover and selection, story overrides and thumbnails create no Scene Edit, history or dirty state (advice; `target-presentation.test.ts`); map presentation reads `app/story-presentation/overrides.ts`, never the controller (policy test).
- Tools take world-space gestures through one tool host and never reach camera, DOM, MapLibre or `SceneStore` ([ADR 0018](../adr/0018-narrow-tool-interface.md); today `tools/registry.ts`); creation tools guard hidden or locked layers at the mutation boundary; locked objects are selectable only as Unlock targets. (`scene-interaction-tool-boundary.test.ts`, `canvas/runtime/scene-runtime/mutations.test.ts`)
- A drag-to-create tool holds one Scene Edit from gesture start to commit or cancel; a nudge series (0.1 m or the large step, 800 ms idle) is one undo; cancellation runs once, in capture phase. (the `canvas-interaction-e2e` suites)
- Controls follow ADR 0015 and the [navigation pattern](../../.interface-design/patterns/canvas-navigation.md): left drag selects or draws, right-, middle- and Space+drag pan in every tool, only deliberate gestures turn the view; the Pointing device setting is stored in `scroll_wheel`. (`canvas/runtime/input/recognise.test.ts`, `canvas/runtime/keyboard-port.test.ts`)
- Show my location (Web only in 2.0): `app/my-location/session.ts` owns the watch, follow and reading, and closing the Design turns them off; only its `geolocation.ts` asks the browser. The reading (dot, accuracy, time) reaches only the map's dot, never a Design, Draft, export, snapshot, log or diagnostics; a camera saved while following is a view. Follow moves the camera only through view jumps. (`__tests__/my-location-trust.test.ts`, `e2e/canvas/my-location.spec.ts`)
- On a turned map, what turns with it and what stays upright follow the navigation pattern. (tests in the plan's rotation phase)
- One placement authority (`scene-runtime/arrangement-placement.ts`; `__tests__/scene-arrangement-placement.test.ts`), one zone geometry (`canvas/runtime/zone-geometry.ts`; policy test), one selection rotation (`scene-runtime/mutations.test.ts`), one rename (`sceneEdits.renameZone`; `canvas-context-menu-entries.test.ts`).
- Text and rings over the map follow the map backdrop and the strokes of `canvas/runtime/scene-visuals.ts`, never the UI theme; every overlay stroke has a casing. (`__tests__/canvas-map-backdrop-ink.test.ts`, `canvas-overlay-casing.test.ts`, `canvas-map-surface-overlays.test.ts`)
- Place search requests on Enter only, `NOMINATIM_MIN_INTERVAL_MS` (1100, `app/geocoding/registry.ts`) apart; confirm is camera-only; Desktop reaches `geocode_address` only through `#geocoding-transport`. (`__tests__/place-search.test.ts`, `place-search-ui.test.tsx`, policy test)
- View snapshots run one at a time on the single hidden map (released after 30 s idle, at most 4096 device px a side), return an image, flags and credit text, never a URL, and touch neither the visible map nor the Design. (`maplibre/view-snapshot-map.test.ts`, `__tests__/saved-view-snapshot.test.ts`)
- CSP: `worker-src` and `child-src` admit `blob:` (`__tests__/tauri-csp.test.ts`); `script-src` carries `'wasm-unsafe-eval'` (advice); never broaden it for a missing worker bundle.

## Do not

- Publish a raw `SceneCanvasRuntime` or cast it to a role; tests use `createTestCanvasRuntimeSurfaces()` (policy test).
- Read the plane origin from the document; use `CanvasQuerySurface.sessionPlane`.
- Fit with a map-only `fitBounds`, call MapLibre camera methods outside the camera driver, project through a workspace map (P2), or convert world to screen outside the view transform.
- Await or return an owner operation from a child setup or disposal callback: the cycle never settles, and nothing checks it at run time (advice).
- Claim a contribution was omitted while parts remain (a failed rollback is a core failure).
- Mirror Target geometry or layer rows into map state.
- Add a tile proxy, offline tile store, bulk download or service-worker cache.

## Where to look

| Area | Module | Tests |
|---|---|---|
| Map surface | `maplibre/surface.ts`, `loader.ts`, `workspace-map.ts` | `__tests__/maplibre-*` |
| Composition, admission | `app/canvas-map-surface/` | `workspace-*.test.ts` |
| Background, satellite | `maplibre/map-background.ts`, `satellite-*.ts`, `basemap-tile-auth.ts` | `__tests__/map-background`, `satellite-*` |
| Map layers, terrain | `app/map-layers/`, `maplibre/terrain*.ts` | `__tests__/map-layers-store`, `maplibre-terrain` |
| Place search | `app/geocoding/` | `__tests__/place-search*` |
| Camera, plane | `canvas/session-plane.ts`, `projection.ts`, `workspace-camera-policy.ts`, `canvas/runtime/view/` | `__tests__/session-plane`, `workspace-camera-*`, `view/*` |
| Views, stories, snapshots | `app/saved-views/`, `app/story-presentation/`, `maplibre/view-snapshot-map.ts` | `__tests__/saved-view*`, `story-presentation` |
| Runtime roles, authority | `canvas/runtime/runtime.ts`, `*-surface.ts`, `scene/`, `scene-runtime/` | `__tests__/canvas-runtime-surfaces`, `scene-runtime.test.ts` |
| Renderer | `canvas/runtime/renderers/`, `maplibre/shared-scene-layer.ts` | `__tests__/pixi-scene`, `v2-shared-map-scene-layer` |
| Presentation | `canvas/runtime/scene-visuals.ts`, `plant-*.ts`, `automatic-detail.ts` | `__tests__/plant-*`, `automatic-detail` |
| Interaction, geometry, lens | `canvas/runtime/interaction-session.ts`, `tools/`, `interaction/`, `zone-geometry.ts`, `inspection-lens*.ts` | `__tests__/canvas-interaction-e2e.*`, `hit-testing`, `inspection-*` |

## Open decisions

- canopi-5ys2.3.9, canopi-5ys2.3.10: snapshots do not draw terrain, LiDAR site data or highlighted objects.
- canopi-5ys2.3.11, canopi-5ys2.3.12: snapshot timings in Tauri WebViews; reuse of the workspace Google session.
