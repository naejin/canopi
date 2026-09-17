# Canopi v2 GeoLibre reuse inventory

Status: evidence.
Tracking: `canopi-ltck.1`.
Current guidance: [ADR 0025](../adr/0025-always-anchored-spatial-workspace.md), [MapLibre](../agent/maplibre.md).

This dated inventory records inputs to the completed v2 rendering experiment. Paths, versions and gaps below describe its pinned baseline, not current defects. Consult the linked operating guides for present ownership.

## Receipt and policy

- Canopi baseline: `963fe634a808402d05a8c4ed4767ea9568ff5d45`.
- GeoLibre baseline: `d3fca7b8f250e3a337d9a29de261d85420935106`.
- GeoLibre was inspected from a clean read-only checkout at that exact commit.
- Canopi installs `maplibre-gl` 6.4.1, `pixi.js` 8.17.1, and
  `maplibre-contour` 0.1.0. GeoLibre resolves MapLibre 6.9.0 at its pin, so every
  adapted API must be checked against Canopi's installed 6.4.1 types.
- GeoLibre is MIT licensed, Copyright 2026 Qiusheng Wu. A copied or
  substantially adapted source or test must retain the MIT notice in a
  third-party notice and name the pinned source in the affected file. A clean
  Canopi implementation of an observed behavior records provenance here but
  does not copy an unexplained workaround.

## Decisions

| Pinned GeoLibre file and symbols | Dependencies and behavior needed | Canopi seam | Decision and retained tests | Owner and update strategy |
| --- | --- | --- | --- | --- |
| `packages/map/src/layer-sync.ts`: `syncLayer`, `ensureLayer`, `moveLayer`, `styleValuesEqual`, `removeLayerFromMap`, `externalSourceIdsFor`; `packages/map/src/headless.ts`: `createLayerSync` | The 3,897-line synchronizer depends on `@geolibre/core`, PMTiles, GeoJSON-VT, labels, markers, filters, generated images, and many layer kinds. Canopi needs stable IDs, incremental data/paint updates, bottom-to-top ordering, moves, removal, and style-reload reconstruction. | A Canopi ordered descriptor list under `maplibre/`, composed by `app/canvas-map-surface/`. | Reimplement narrowly. Retain behavioral cases from `tests/headless-layer-sync.test.ts` for initial order, move, middle insertion, removal, and dispose; retain `tests/map-controller.test.ts` cases for no-op equal values, in-place data update, style reload, and late native-layer restack. GeoLibre issue 1404's top-down-anchor regression is the ordering reference. | Low-level `maplibre/` owns map mutations. Review these pinned symbols manually when MapLibre or semantic ordering changes. |
| `packages/map/src/map-controller.ts`: `init`, `destroy`, `readView`, `applyView`, `fitBounds`, `onCameraIdle`, `stopCamera`, `suspendNavigation`, `waitAndSyncLayers`; `packages/map/src/MapCanvas.tsx` | The controller and React component are coupled to Zustand, Turf, controls, global events, plugins, flight/story state, globe, Cesium, and Mapbox behavior. Canopi needs MapLibre-owned commands, live frame publication, interruption, fit/coverage/return, empty style, and one lifecycle. GeoLibre publishes persisted view state at `moveend`, which is not a render clock. | Canvas Runtime navigation command and frame query roles, composed by Canvas Map Surface lifecycle. | Reject both modules intact; adapt behavior only. Retain invalid/degenerate fit bounds, no `jumpTo` while an owned gesture runs, destroy during async work, style-reload sync, handler enable-state restoration, and window mouseup/blur/Escape cancellation cases. | Workspace navigation/frame contract belongs to Canvas Runtime; MapLibre construction stays low-level. Consult upstream only for a matching camera or lifecycle regression. |
| `packages/plugins/src/plugins/raster-layer-sync.ts`: `createRasterStoreLayer`, `syncRasterLayersToStoreWithOptions`, `wireRasterStoreSync`, `runWithRasterStoreSyncSuspended`, `savedRasterState` | The 741-line module couples bidirectional Zustand/control state to `maplibre-gl-raster`, STAC signing, Deck.gl/native modes, and module-global echo suppression. Canopi already has managed LiDAR authority and needs one-way add/remove/source/paint transitions. | `readCurrentLidarPresentation` to `lidarMapLayers`, `classifyLidarSync`, and `applyLidarSync`. | Reject runtime code. Translate tests for unchanged no-op, opacity-only paint, source-shape replacement, malformed saved state, teardown, and stale completion. Omit bidirectional store echo tests. | `app/lidar/` owns library/presentation and `app/canvas-map-surface/` owns map reconciliation. No routine upstream sync. |
| `packages/plugins/src/plugins/geo-editor-geometry.ts`: `tagFeatureKeys`, `canonicalGeometryKey`, `reconcileEditedFeatures`, `planGeoEditorOverlayOrder` | Identity and reconciliation helpers are GeoJSON/Geoman-specific and repair generic editor ID/property changes. Canopi needs only semantic overlay ordering while SceneStore identities, tools, locks, and history stay authoritative. | General semantic layer stack under `maplibre/`. | Reject editor identity/reconciliation. Reimplement the pure order-planning behavior. Retain overlay-above-anchor, below-first-higher-layer, already-positioned no-op, and absent-anchor/overlay no-op cases from `tests/geo-editor-geometry.test.ts`; GeoLibre issue 1015 is the reference. | Map stack owner under `maplibre/`; no Geoman dependency or upstream identity sync. |
| `packages/map/src/map-resize.ts`: `createMapResizeScheduler`, `RESIZE_DEBOUNCE_MS` | This cohesive 298-line module includes ResizeObserver, window/splitter motion, DPR media queries, coalescing, a preserved-frame overlay, races, and disposal. Canopi already has a MapLibre Host owner and must resize map and scene together. | Deepen `maplibre/host.ts`; never install a second resize scheduler. | Adapt after the shared canvas proves which pieces are needed. Retain mount no-op, next-frame discrete resize, continuous coalescing, callback-order race, splitter suppression, stale-frame race, DPR-only resize, and full disposal tests. Commits `0e743b6` and `f3a108c` are the provenance points. Evaluate the copied-frame overlay only with the combined canvas. | `maplibre/host.ts` owns resize. Review upstream only for resize fixes and retain exact provenance for copied code/tests. |
| `packages/processing/src/types.ts`: `AlgorithmParameter`, `DuckDbCapability`, `ProcessingContext`, `ProcessingAlgorithm` | The small interface depends on GeoLibre layers, GeoJSON results, DuckDB-WASM, generic fit behavior, and sidecar engines. Phase A/B needs no processing API; Canopi already has native LiDAR actions, IPC, publication, polling, and cancellation. | Existing `app/lidar/`, generated contracts, and `desktop/src/services/lidar/`. | Reject for Phase A/B. Reconsider a Canopi-specific declarative capability contract only inside a later analysis bead. Potential later tests cover conditional/required parameters, cancellation, result capture without camera ownership, and immutable registry metadata. | LiDAR analysis owner. The spatial work neither replaces the native engine nor opens a broader processing toolbox. |

## Canopi code retained

| Responsibility | Current code and invariant |
| --- | --- |
| Local-metre geometry | `canvas/projection.ts` owns `worldToMercator`, `mercatorToWorld`, `worldToGeo`, `geoToWorld`, and the 10 km precision warning. `canvas/maplibre-camera.ts`, `canvas/runtime/scene/store.ts`, and `canvas/runtime/zone-geometry.ts` retain current axis, geometry, and extent semantics. No GeoLibre/Turf/proj4 coordinate authority is added. |
| Botanical presentation | `SceneRendererSnapshot` and `SceneRendererInstance`, `scene-visuals.ts`, `plant-presentation.ts`, `plant-symbol-recipes.ts`, `automatic-detail.ts`, `label-collision.ts`, and the Pixi scene implementation retain symbols, species colours, labels, stack badges, culling/LOD, Zones, guides, and Annotations. The experiment adapts their render data rather than replacing Plants with generic points. |
| Editing and history | `SceneStore`, Scene Edit transactions/settlement, `SceneHistory`, `createSceneInteractionSession`, tool modules, hit testing, pointer utilities, locks, groups, and role-shaped Canvas command/query/document surfaces remain authoritative. MapLibre never mutates Plants or Zones. |
| Export and fallback | `buildCanvasPrintSnapshot`, Canvas PDF layout/encoding, inspection snapshots, `renderCanvas2DSceneSnapshot`, `createCanvas2DSceneRenderer`, `RendererHost`, and `claimCanvasRuntimeLifecycle` remain network-independent. Canvas2D remains the editing fallback. |
| Map lifetime | `createMapLibreHost`, `createMapLibreSurfaceAdapter`, the lifetime registry, Canvas Map Surface lifecycle, reconciliation, and snapshot modules remain the resource boundary. They will be deepened into one workspace owner rather than bypassed. |
| LiDAR and Layers | LiDAR presentation reads, `lidarMapLayers`, `classifyLidarSync`, `applyLidarSync`, terrain synchronization, overlay synchronization, library polling/actions, and scoped tile URLs remain. Source/result visibility, stored georeferencing, generation publication, numerical analysis, cancellation, and passive display failure are unchanged. |

## Historical gaps at the inspected baseline

- The current `CameraController` is writable authority, MapLibre is
  `interactive: false`, and every Canvas Map Surface update can call `jumpTo`.
  This is the inverse of the accepted v2 owner.
- Nullable location and map destruction when backgrounds are hidden conflict
  with an always-present spatial frame and offline empty style.
- `MapLibreMapInstance` lacks typed custom-layer, live `move`/`render`, style
  reload, context restoration, `triggerRepaint`, camera read, ordered move, and
  input-handler operations required by Phase B.
- LiDAR reconciliation ignores reordering of stable IDs and source-shape
  changes to bounds or zoom limits. `FIRST_NON_LIDAR_LAYER_CANDIDATES` cannot
  express or reconstruct the required semantic stack.
- `pendingLidarBounds` is a persistent map-only camera override and must become
  a navigation command with a session-bound return bookmark.
- MapLibre 6.4.1 defines custom rendering as
  `(gl: WebGL2RenderingContext, options: CustomRenderMethodInput)`. Its nearby
  embedded example uses an older destructured signature and is not the type
  authority.
- Pixi 8.17.1 accepts a caller-provided `context`, but normal Application
  teardown loses that context. Current Pixi also owns a separate canvas and uses
  `clearBeforeRender: true`. A qualified adapter must be explicitly non-owning.
- GeoLibre contains no shared Pixi/MapLibre context or botanical editing proof.

The [experiment result](../v2-shared-renderer-experiment.md) records the selected approach and measured limits. Do not reopen these baseline gaps without verifying current code.
