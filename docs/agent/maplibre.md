# MapLibre Integration

Use this guide when changing MapLibre surfaces, basemap rendering, terrain layers, map/canvas projection, or map overlay behavior.

## Ownership

- MapLibre is a derived visualization layer, not a document authority.
- Map layers render scene/document state; they do not own or mutate it.
- Map surfaces and readiness/status UI consume saved Location state through the Location Workbench; do not import Design Session state directly for location presentation.
- `maplibre/host.ts` owns shared MapLibre resource lifetime for migrated map-backed surfaces: lazy loading, map creation, resize observation, keyed rebuild teardown, preserved view state, initialization failure callbacks, and final removal. The host must not import app-owned Design, Location, Target Presentation, terrain, or canvas authority.
- `maplibre/surface-adapter.ts` is the typed adapter seam above the MapLibre Host. Production map-backed surfaces should request map lifetime through the MapLibre Surface Adapter so typed map access, map-lifetime cleanup callbacks, and event listener cleanup stay out of app/components code.
- Keep direct `maplibre-gl` imports, Map/Marker/Bounds construction, basemap style construction, and control construction in low-level modules under `desktop/web/src/maplibre/` or in tests.
- In-canvas MapLibre remains isolated behind the Canvas Map Surface adapter and the MapLibre Host. Do not scatter MapLibre ownership across canvas runtime or renderers.
- Location map editing uses the MapLibre Surface Adapter for map lifetime and keeps saved Location authority, pending search-result preview, pin projection, drag clearing, map-click commits, and map-center commits in `app/location/map-editing.ts`.
- Web Edition v1 omits visible Location editing entirely. Do not mount a Web Location map, coordinate form, or map-picking workflow, and do not import `app/location/coordinate-workbench.ts` from Web sources. Saved `.canopi` Location data round-trips. The approved initial Web Canvas map capability displays a street basemap only when the Design already has a saved Location; it does not add Location editing. `WebCanvasWorkspace` currently mounts no canvas basemap, so this remains planned. See [ADR 0013](../adr/0013-web-edition-map-scope.md) and [ADR 0016](../adr/0016-web-edition-omits-geocoding.md).
- [ADR 0024](../adr/0024-shared-canvas-pdf-export.md) defers all map backgrounds beyond Canvas PDF v1 while retaining print selection for Design Layers. The PDF export path must not mount or capture a map surface or fetch map assets in v1, even if the interactive canvas shows a basemap. Interactive Web maps remain separate work and do not block PDF delivery. When PDF map work resumes, preserve required attribution and validate the source for print coverage, resolution, and provider terms; interactive loading alone does not establish print suitability.
- The Design Template world map uses the MapLibre Surface Adapter for map lifetime and keeps template marker creation, selection classes, fit-to-bounds, and selected-template fly-to behavior in `components/world-map/WorldMapSurface.tsx` with low-level constructors isolated under `maplibre/world-map.ts`.
- `app/canvas-map-surface/snapshot.ts` owns in-canvas map snapshot inputs: canvas query surface freshness, saved Location, north bearing, basemap style, layer visibility/opacity, theme, terrain settings, and Target Presentation overlays. The mounted `components/canvas/maplibre-surface-controller.ts` should call that seam instead of importing those authorities directly.
- `app/canvas-map-surface/reconciliation.ts` owns pure in-canvas map activation decisions: inactive, destroy, create, sync, or rebuild from snapshot inputs plus lifecycle state. `app/canvas-map-surface/lifecycle.ts` is the Canvas Map Surface adapter: it requests MapLibre Surface Adapter maps and owns camera sync, basemap presentation, terrain, Target Presentation overlays, readiness state, diagnostics, and MapLibre event reactions for the in-canvas surface.
- The lazy import boundary around `maplibre-gl` should stay inside the MapLibre Host/loader path for bundle size.
- MapLibre 6 uses namespace exports and a separately bundled module worker. `maplibre/loader.ts` owns the one-time `setWorkerUrl()` call before exposing the shared module. Import its worker with Vite's `?worker&url`, not plain `?url`: the latter leaves the worker's sibling-module imports unresolved in production. Keep failed loads retryable. The real-library attribution regression protects the sanitizer fix introduced in 6.4.1.

## Camera And Projection

- MapLibre follows canvas camera state one-way. The canvas camera is the authority.
- The current in-canvas basemap is non-interactive and must not mutate document or canvas state.
- Map/canvas projection is bearing-aware, Mercator-backed, and shared.
- `north_bearing_deg` participates in camera derivation and world-to-geo feature projection.
- `desktop/web/src/canvas/projection.ts` is the dependency-free canonical seam for local-Mercator math, scalar precision policy, and projection diagnostics. `createProjectionPrecisionSnapshot()` accepts only the already-derived physical extent in meters; it must not import Scene contracts or infer Scene geometry. MapLibre surface state and developer diagnostics both consume that snapshot; do not duplicate its threshold comparison in surface code. Consumers import only the operations and constants they need; do not add a strategy or selector until a second demonstrated implementation has a real selection seam.
- `CanvasQuerySurface.getScenePhysicalExtentMeters()` computes the current Scene’s radial physical extent through `canvas/runtime/scene-physical-extent.ts` inside SceneStore, without cloning the Scene. `maplibre/canvas-surface-state.ts` composes that scalar with the projection precision policy. Preserve design origin `(0, 0)` as the radial origin, the stable `local-mercator` projection identity, and the strict warning boundary: exactly 10 km is not a warning, while any extent above it is.
- MapLibre-facing bearing adaptation belongs in `desktop/web/src/canvas/maplibre-camera.ts`.
- Do not keep separate bearing math, zoom shortcuts, or equirectangular fallbacks in surface or overlay code.
- Exact sync is correctness-critical. Do not add camera deadbands or tolerances that can suppress tiny pan/zoom changes.
- Screen-lock validation is the standard: the same world point must land on the same screen pixel in canvas and map projections.
- User-facing MapLibre maps are pan/zoom-only while Canopi has no user map-rotation workflow. Keep zoom controls when useful, but do not expose MapLibre compass controls or drag/touch rotation unless map rotation returns through an explicit product decision.

## Surface Shape

- Keep map-backed surface adapters thin. The MapLibre Host owns low-level setup, resize observation, keyed rebuild teardown, and final removal; the MapLibre Surface Adapter owns typed map access and map-lifetime cleanup; surface-specific adapters own snapshots, overlays, markers, terrain, and presentation state.
- Helper modules under `desktop/web/src/maplibre/` own MapLibre loading/types, basemap presentation, overlay coordination, terrain loading, and terrain diff/apply behavior.
- Precision warnings and dev diagnostics derive from the projection seam, not ad hoc surface math.
- Rendered map overlays consume the pure Target map projection seam in `desktop/web/src/target/` instead of resolving Target identity themselves.

## Layers And Settings

- `layerVisibility.base` and `layerOpacity.base` mean shared hosted basemap visibility/opacity.
- `gridVisible` is separate canvas chrome and must not be coupled to the base layer row.
- `activeLayerName` can be any layer string used by scene and terrain layer UI.
- Web Edition v1 scope is street basemap only: no satellite basemap, terrain contours, hillshade, offline tile download, service-worker tile precache, or offline map promise. See `docs/adr/0013-web-edition-map-scope.md` and `docs/adr/0022-web-edition-not-offline-first.md`.
- Canopi has no app-managed offline tile downloader or cache on desktop or Web. MapLibre reads its configured live sources; do not reintroduce a parallel Tauri tile store without a product and cache/update decision.
- Contours use `layerVisibility.contours` and `layerOpacity.contours`.
- Hillshading uses `hillshadeVisible` and `hillshadeOpacity`.
- Canvas Layer Presentation bridges scene/map/terrain layer asymmetry for the Desktop `LayersPanel` adapter, Canvas shell Location Notices, and Canvas Map Surface snapshots. Map readiness callers should consume its map-surface projection instead of recomputing base/contour/hillshade visibility.
- Camera-driven map snapshots use `readCanvasMapLayerPresentation()` for settings-only map/terrain inputs; do not build Scene layer rows or clone geometry for map settings. Empty, disabled, or unlocated Target overlays clear their map layers without querying Scene geometry. Nonempty overlays still read current geometry for every sync.
- Terrain paint-only changes, such as opacity and theme, should stay incremental through `maplibre/terrain-sync.ts`.
- Rebuild terrain sources/layers only when source-shape inputs change.

## Tauri And Network

- Review CSP in `tauri.conf.json` when adding tile or image sources; connection and image directives currently allow HTTPS sources. Keep native asset access restricted to the image cache.
- MapLibre's worker is emitted as a self-hosted asset by Vite. Keep both `worker-src` and the WebKit fallback `child-src` admitting self-hosted workers and `blob:`; other canvas/PDF/terrain workers still use blob URLs. Never broaden CSP to compensate for a missing worker bundle.
- Linux desktop startup sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before Tauri initializes WebKitGTK. Keep this in process startup, not in developer shell instructions, because MapLibre/WebGL can freeze the WebKitGTK webview on affected systems when the default DMA-BUF renderer is used.
- Blocking HTTP/file work must run through the managed Native Operation Executor: use `Network` for remote requests and `Local` for local file work. Direct `spawn_blocking` calls belong only in `desktop/src/native_operation.rs`; see the [executor guide](build-release.md#native-operation-executor).
- All `ureq` calls must set global timeouts and response size limits.
- For large binary data, prefer `tauri::ipc::Response::new(bytes)` over JSON serialization.
