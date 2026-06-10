# MapLibre Integration

Use this guide when changing MapLibre surfaces, basemap rendering, terrain layers, map/canvas projection, or map overlay behavior.

## Ownership

- MapLibre is a derived visualization layer, not a document authority.
- Map layers render scene/document state; they do not own or mutate it.
- Map surfaces and readiness/status UI consume saved Location state through the Location Workbench; do not import Design Session state directly for location presentation.
- `maplibre/host.ts` owns shared MapLibre resource lifetime for migrated map-backed surfaces: lazy loading, map creation, resize observation, keyed rebuild teardown, preserved view state, initialization failure callbacks, and final removal. The host must not import app-owned Design, Location, Target Presentation, terrain, or canvas authority.
- Existing full-screen surfaces may keep component-local MapLibre ownership when setup/update/teardown are contained in one component, unless they have been migrated to the MapLibre Host.
- In-canvas MapLibre remains isolated behind the Canvas Map Surface adapter and the MapLibre Host. Do not scatter MapLibre ownership across canvas runtime or renderers.
- Location map editing uses the MapLibre Host for map lifetime and keeps saved Location authority, pending search-result preview, pin projection, drag clearing, and map-center commits in `app/location/map-editing.ts`.
- `app/canvas-map-surface/snapshot.ts` owns in-canvas map snapshot inputs: canvas query surface freshness, saved Location, north bearing, basemap style, layer visibility/opacity, theme, terrain settings, and Target Presentation overlays. The mounted `components/canvas/maplibre-surface-controller.ts` should call that seam instead of importing those authorities directly.
- `app/canvas-map-surface/reconciliation.ts` owns pure in-canvas map activation decisions: inactive, destroy, create, sync, or rebuild from snapshot inputs plus lifecycle state. `app/canvas-map-surface/lifecycle.ts` is the Canvas Map Surface adapter: it requests host maps and owns camera sync, basemap presentation, terrain, Target Presentation overlays, readiness state, diagnostics, and MapLibre event handlers for the in-canvas surface.
- The lazy import boundary around `maplibre-gl` should stay inside the MapLibre Host/loader path for bundle size.

## Camera And Projection

- MapLibre follows canvas camera state one-way. The canvas camera is the authority.
- The current in-canvas basemap is non-interactive and must not mutate document or canvas state.
- Map/canvas projection is bearing-aware, Mercator-backed, and shared.
- `north_bearing_deg` participates in camera derivation and world-to-geo feature projection.
- Projection backend choice is centralized in `desktop/web/src/canvas/projection.ts`.
- MapLibre-facing bearing adaptation belongs in `desktop/web/src/canvas/maplibre-camera.ts`.
- Do not keep separate bearing math, zoom shortcuts, or equirectangular fallbacks in surface or overlay code.
- Exact sync is correctness-critical. Do not add camera deadbands or tolerances that can suppress tiny pan/zoom changes.
- Screen-lock validation is the standard: the same world point must land on the same screen pixel in canvas and map projections.

## Surface Shape

- Keep in-canvas map surfaces thin. Lifecycle classes/components own setup, update, and teardown.
- Helper modules under `desktop/web/src/maplibre/` own MapLibre loading/types, basemap presentation, overlay coordination, terrain loading, and terrain diff/apply behavior.
- Precision warnings and dev diagnostics derive from the projection seam, not ad hoc surface math.
- Rendered map overlays consume the pure Target map projection seam in `desktop/web/src/target/` instead of resolving Target identity themselves.

## Layers And Settings

- `layerVisibility.base` and `layerOpacity.base` mean shared hosted basemap visibility/opacity.
- `gridVisible` is separate canvas chrome and must not be coupled to the base layer row.
- `activeLayerName` can be any layer string used by scene and terrain layer UI.
- Contours use `layerVisibility.contours` and `layerOpacity.contours`.
- Hillshading uses `hillshadeVisible` and `hillshadeOpacity`.
- Canvas Layer Presentation bridges scene/map/terrain layer asymmetry for `LayerPanel`, Canvas shell Location Notices, and Canvas Map Surface snapshots. Map readiness callers should consume its map-surface projection instead of recomputing base/contour/hillshade visibility.
- Terrain paint-only changes, such as opacity and theme, should stay incremental through `maplibre/terrain-sync.ts`.
- Rebuild terrain sources/layers only when source-shape inputs change.

## Tauri And Network

- CSP in `tauri.conf.json` is strict. Add resource origins when adding tile or image sources.
- MapLibre's default bundle starts workers from blob URLs. Keep both `worker-src` and the WebKit fallback `child-src` open to `blob:` in Tauri CSP.
- Blocking HTTP/file work must run behind an async Tauri command and `spawn_blocking`.
- All `ureq` calls must set global timeouts and response size limits.
- For large binary data, prefer `tauri::ipc::Response::new(bytes)` over JSON serialization.
