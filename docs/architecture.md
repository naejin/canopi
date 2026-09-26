# Canopi v2 architecture

Canopi is a desktop (Tauri) and Web app for designing agroecological sites on a map. This page is the lasting description of the v2 architecture. Decisions and their rationale live in [ADRs](adr/); subsystem detail lives in the guides linked from [`AGENTS.md`](../AGENTS.md).

## Principles

1. **The map is the canvas.** Basemap, satellite, LiDAR and terrain are the background of the design surface. There is no separate local canvas and no Design location. See [ADR 0001](adr/0001-geolocated-map-canvas.md).
2. **Every design object is geolocated.** Plants, zones, annotations, measurement guides and group members are stored in WGS84 longitude/latitude. Metres exist only inside the runtime, never in files.
3. **Reuse GeoLibre before writing code.** Generic GIS pieces come from GeoLibre modules, copied with attribution or depended on as light packages. Canopi does not fork the GeoLibre app. See [ADR 0002](adr/0002-geolibre-module-reuse.md).
4. **No backward compatibility.** No migrations, legacy readers, compatibility shims or old-format fixtures. Old data is refused, set aside or deleted. See [ADR 0003](adr/0003-no-backward-compatibility.md).
5. **Delete, don't deprecate.** Dead code, docs, tests, scripts and dependencies are removed in the change that makes them dead.

## Stack

- Backend: Rust workspace (Tauri v2, rusqlite, specta). `desktop/src/` holds IPC commands, services and DB access. `common-types/` holds the authored cross-language contracts; `bindings-gen/` generates the TypeScript transport.
- Frontend: Preact, `@preact/signals`, TypeScript, Vite, CSS Modules, i18next core with 11 UI languages. Source is in `desktop/web/src/`.
- Map and scene: MapLibre GL JS owns the WebGL2 context and camera. The design scene is drawn by PixiJS inside a MapLibre custom layer (`maplibre-pixi`), the only renderer. See [ADR 0004](adr/0004-one-renderer.md).

## Authorities

| Owner | Owns | Mutation path |
|---|---|---|
| Scene runtime (`SceneStore` via `SceneCanvasRuntime`) | Design objects: plants, zones, annotations, measurement guides, groups, locks, species colours, symbols and codes, layers | Runtime transactions |
| Design Edit (`app/design-edit/`) | Budget, currency, timeline, consortiums, description, extra | Design Edit commands |
| Map layer store (`app/map-layers/`) | Map layers: basemap, satellite, LiDAR items, contours, hillshade; order, visibility, opacity, provider choice | Layer-store actions |
| Settings | Last view, basemap style, Google key (device-local credential), locale, theme | Settings actions |

- Undo covers scene runtime edits only. Design Edit commands, map layers and settings are not undoable.
- Neither document authority duplicates the other's data. Save composition goes through the document-session seam, which asks each authority for its part.
- Panels read canvas entities through read-only runtime queries, not mirrored signals.
- Every resource-owning surface (runtime, renderer, MapLibre instance, timers, listeners, cancellation tokens, DOM overlays) has one lifecycle owner for setup, update and teardown.

## Geolocation model

- **Files store lon/lat.** `.canopi` format v7 stores every persisted position as `GeoPoint { lon, lat }` (WGS84 degrees). Zone rotation is degrees clockwise from true north. The file has no anchor, north bearing, placement status or altitude.
- **Session plane.** On load, the codec builds a local tangent plane (local Mercator, `canvas/projection.ts`) with its origin at the centre of the objects' bounds, or at the current view centre for an empty Design. All runtime geometry, tools, snapping, measurements, hit testing and PDF layout work in metres in this plane. Camera `{x, y, scale}` is pixels per metre in the plane.
- **Re-origin.** When the view centre moves more than 10 km from the plane origin, the runtime rebuilds the plane at the view centre and re-projects every object from its stored lon/lat. This is lossless because lon/lat is authoritative.
- **Canonical write-back.** The codec remembers each object's loaded lon/lat. On save, an object whose plane coordinates did not change writes its original lon/lat unchanged; a changed object writes lon/lat rounded to 1e-9 degree (about 0.1 mm). Open then save without edits is byte-identical.
- **Relative arrangements.** Saved object stamps stay relative arrangements in metres. Design templates are v7 files and are placed relative to the view on insert.
- **LiDAR** sampling and coverage fit use the session plane.
- **View, not placement.** Pan, zoom, fit and place search move the camera only. Objects never move unless the user edits them (cut and paste relocates objects).
- **New Design view.** A new Design opens at the app's last view (`last_view {lon, lat, zoom}` in settings); without one, at lat 23.0, lon 13.0, zoom 4 with a "Search your site" prompt. Opening a Design fits the camera to its objects; an empty Design uses the last view.

## Map stack

- The map layer store (`app/map-layers/state.ts`, signals persisted through settings) holds Basemap, Satellite, Contours and Hillshade. `maplibre/map-background.ts` applies the background band to every map (workspace and templates world map); `app/map-layers/bands.ts` orders Canopi layers into bands, back to front:

```text
background: basemap or satellite
LiDAR items (ordered)
terrain references: contours, hillshade
shared scene layer (Pixi design objects, existing layer order)
interaction overlays
```

- **Basemap.** OpenFreeMap vector styles (Liberty by default; Positron, Bright, Dark) with the attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". The style is added as a vector source, style layers, glyphs and sprite without `setStyle()`, so the map lifetime, camera and edits survive a style change. Row opacity scales each style layer's paint opacity. Labels follow the app locale (`name:<locale>`, falling back to `name`).
- **Satellite.** A raster source in its own row under Basemap; turning it on hides the Basemap. Google is the only imagery (Esri World Imagery was rejected on its licence terms). Without a key, Google serves its public `mt1.google.com` tiles, as GeoLibre's basemap control does; with the user's device key it uses the official Map Tiles API session in `maplibre/basemap-tile-auth.ts`, the credential boundary (see [ADR 0001](adr/0001-geolocated-map-canvas.md)). The key never enters a Design, export, snapshot, diagnostic bundle or log.
- **Site references** group in Layers: Basemap, Satellite, LiDAR items, Contours, Hillshade.
- **Place search.** A pin button under the inspection lens (loupe) button opens a search field for a place name or coordinates. Coordinates are parsed locally. Place names go through one geocoding provider registry (Nominatim first, Enter only, at least 1.1 s between requests, OSM attribution on results). Desktop uses the native HTTP transport with an identifying User-Agent; Web uses browser `fetch`. Confirm moves the view only.
- **Failure.** If WebGL2 or MapLibre cannot start, or the map fails later, the workspace shows an explicit "map unavailable" state: the map surface publishes its error status, no renderer or editing session is mounted, and the Design stays loaded so it can still be saved. There is no fallback renderer.

## GeoLibre reuse boundary

GeoLibre (MIT, https://github.com/opengeos/GeoLibre) is a React and Zustand app; Canopi never imports its React components or stores. Reference commit for copied TypeScript modules: `e9df9e2`.

| Piece | Source | How |
|---|---|---|
| COG display | `maplibre-gl-raster`, `cog-tiler-wasm` (npm, pinned in `desktop/web/package.json`) | Dependency |
| Native GeoTIFF/COG reader | `wbgeotiff` from `opengeos/whitebox-wasm` (pinned git rev in `desktop/Cargo.toml`) | Dependency |
| Slope | GeoLibre CLI from `opengeos/geolibre-rust` (revision in `scripts/build-geolibre-cli.sh` and `desktop/src/services/lidar/geolibre.rs`) | Sidecar binary |
| Geocoding registry | `packages/core/src/geocoding.ts` | Copy into `app/geocoding/` |
| Basemap presets | `packages/core/src/types.ts` (`OPENFREEMAP_BASEMAPS`) | Copy |
| Layer sync pattern | `packages/map/src/layer-sync.ts` | Pattern only (store-driven, idempotent sync); no code copied |
| Evaluated, not adopted (V7) | `packages/map/src/{layer-sync,terrain-control,cog-dem-source,cog-imagery,fill-patterns,map-capture,collapsed-attribution-control,map-resize,map-bounds}.ts`, `apps/geolibre-desktop/src/lib/print-layout-export.ts` | None would make Canopi code smaller or clearly better; reasons in the [map workspace guide](guides/map-workspace.md#geolibre-reuse-decisions). Re-evaluate map capture and print layout when PDF maps return (ADR 0008) |

Every copied file keeps an MIT header naming its source path and commit and gets an entry in [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). `@geolibre/map` is not a dependency (it pulls Cesium and React); `@geolibre/core` may be used for types only if it adds no heavy runtime.

## Editions

- **Desktop** (Tauri) and **Web** (static bundle) share the codec, scene runtime, workbenches and workspace composition. Platform adapters are chosen at compile time through separate build entries and aliases; build checks reject desktop imports in Web chunks.
- **Web** is a static app with browser-local data, geocoding through the shared registry, no problem reports and `.canopi` plus PDF plus GeoJSON as its file outputs. See [ADR 0005](adr/0005-web-edition-scope.md).
- **Species catalog:** Desktop reads SQLite through Rust; Web reads generated Parquet through DuckDB-WASM. See [ADR 0006](adr/0006-species-catalog-storage.md).
- **Personal libraries:** saved object stamps and the Design Notebook live in the Desktop user DB; Web keeps stamps browser-local. See [ADR 0007](adr/0007-design-objects-and-personal-libraries.md).
- **PDF:** one browser-compatible layout and encoder for every edition, without map backgrounds in v2.0. See [ADR 0008](adr/0008-canvas-pdf-export.md).
- **Saving:** always-on continuous save to each Design's home (a file or a Design Draft), with conflict detection and no unsaved-changes prompts. See [ADR 0009](adr/0009-continuous-save.md).
- **Interface:** a map-first Field Atlas interface with floating chrome, menus for every command, one plant finder and one species row everywhere. See [ADR 0010](adr/0010-map-first-interface.md).
- **Analyses and stories:** analyses come from a registry over typed library items with recorded provenance; Designs hold saved views and stories presented inside Canopi. See [ADR 0011](adr/0011-analyses-provenance-and-stories.md).
- **Vegetation analysis:** canopy gaps, tree tops, crowns and terrain from points are ported from the ONF Computree plugin or written by Canopi from published methods, in the LGPL `vegetation/` crate, and run in the registry's in-process `native` lane. See [ADR 0012](adr/0012-vegetation-analysis.md).
- **GeoJSON:** RFC 7946 import and export of design objects in both editions through one pure codec (`app/geojson/`). Export reads canonical lon/lat; import rejects malformed files before mutation and adds objects as one undoable runtime transaction.

## Native execution

Every `#[tauri::command]` is registered once and is either executor-backed async or one of the reviewed bounded synchronous commands in `desktop/src/native_command_policy.rs`. Filesystem, SQLite, network, rendering, encoding, compression, process, sleeping and unbounded CPU work never run synchronously on a command thread. Direct global blocking-pool calls belong only in `desktop/src/native_operation.rs`.

## Persistence of app data

- Desktop user DB: one schema, no migrations. An older database is renamed `user.db.v<N>-set-aside`, an unreadable or damaged one `user.db.corrupt-<unix-seconds>`, and an empty one is created. A newer database is refused with a typed error.
- LiDAR library: catalogue v20. A library written by an older Canopi is deleted on first open; a newer one is refused.
- Web: independent browser-local records for drafts, settings, species activity and stamps. Web v1 storage is ignored.
