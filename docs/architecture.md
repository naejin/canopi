# Canopi v2 architecture

Canopi is a desktop (Tauri) and Web app for designing agroecological sites on a map. This page states the architecture as rules, each with the ADR that decided it. Subsystem boundaries live in the guides linked from [`AGENTS.md`](../AGENTS.md); rationale lives in [ADRs](adr/).

## Principles

1. **The map is the canvas.** Basemap, satellite, LiDAR and terrain are the background of the design surface. There is no separate local canvas and no Design location ([ADR 0001](adr/0001-geolocated-map-canvas.md)).
2. **Every design object is geolocated.** Files store WGS84 longitude/latitude; metres exist only in the runtime's session plane ([ADR 0001](adr/0001-geolocated-map-canvas.md)).
3. **Reuse GeoLibre before writing code.** Generic GIS pieces are copied with attribution or depended on as light packages; Canopi never forks the GeoLibre app or imports its React code ([ADR 0002](adr/0002-geolibre-module-reuse.md)).
4. **Stored data migrates forward, in one module per store.** Designs from v7 (the first Canopi 2 preview) upgrade in memory through `common-types/src/migrations.rs`; Canopi 1.2 and earlier are refused with a typed message. Nothing outside the migration modules reads an older format, and dead compatibility code is still deleted ([ADR 0013](adr/0013-stored-data-migrations.md)). The user DB upgrades in place from schema 8 (Canopi 1.0) (`desktop/src/db/user_db_migrations.rs`); the LiDAR library rebuilds its catalogue from originals; Web storage still refuses older data until its migration ships.
5. **Delete, don't deprecate.** Dead code, docs, tests, scripts and dependencies go in the change that makes them dead.

## Stack

- Backend: Rust workspace (Tauri v2, rusqlite, specta). `desktop/src/` holds IPC commands, services and DB access; `common-types/` the authored cross-language contracts; `bindings-gen/` the TypeScript transport generator.
- Frontend: Preact, `@preact/signals`, TypeScript, Vite, CSS Modules, i18next core with 11 UI languages, in `desktop/web/src/`.
- Map and scene: MapLibre GL JS owns the WebGL2 context and camera; the design scene is drawn by PixiJS inside one MapLibre custom layer (`maplibre-pixi`), the only renderer ([ADR 0004](adr/0004-one-renderer.md)). If WebGL2 or MapLibre fails, the workspace shows an explicit "map unavailable" state and the Design stays loaded; there is no fallback renderer.

## Authorities

| Owner | Owns | Mutation path |
|---|---|---|
| Scene runtime (`SceneStore` via `SceneCanvasRuntime`) | Design objects: plants, zones, annotations, measurement guides, groups, locks, species colours, symbols and codes, scene layers | Runtime transactions |
| Design Edit (`app/design-edit/`) | Budget, currency, timeline, consortiums, description, saved views, stories, LiDAR presentation order, extra | Design Edit commands |
| Map layer store (`app/map-layers/`) | Basemap, satellite, LiDAR items, contours, hillshade: order, visibility, opacity, provider | Layer-store actions |
| Settings | Last view, basemap style, Google key (device-local credential), locale, theme, single-key shortcuts, New Design defaults | Settings actions |

- Scene history covers scene runtime edits. A Design Edit is outside scene history unless it opts in (LiDAR presentation order) or offers its own Undo toast (deleting a view or story); map layers and settings are never undoable.
- Neither document authority duplicates the other's data; save composition goes through the document-session seam, which asks each authority for its part ([design document](guides/design-document.md)).
- Panels read canvas entities through read-only runtime queries, never mirrored signals.
- Every resource-owning surface (runtime, renderer, MapLibre instance, timer, listener, cancellation token, DOM overlay) has one lifecycle owner for setup, update and teardown ([frontend](guides/frontend.md)).

## Geolocation model

Decided by [ADR 0001](adr/0001-geolocated-map-canvas.md); constants live in `desktop/web/src/canvas/session-plane.ts`.

- **Files store lon/lat.** `.canopi` format v9 (`CURRENT_CANOPI_FILE_VERSION`) stores every persisted position, including saved-view cameras, as `GeoPoint { lon, lat }`; zone rotation is degrees clockwise from true north. There is no anchor, north bearing, placement status or altitude, and the obsolete root keys are refused.
- **Session plane.** On load the codec builds a local Mercator-anchored plane (`canvas/projection.ts`) at the centre of the objects' bounds, or the view centre for an empty Design. All runtime geometry, tools, snapping, measurement, hit testing, LiDAR sampling and PDF layout work in metres there; camera `{x, y, scale}` is pixels per metre.
- **Re-origin.** When the view centre moves more than 10 km from the origin, the runtime rebuilds the plane and re-projects every object from its stored lon/lat, losslessly.
- **Canonical write-back.** An object whose plane coordinates did not change writes its loaded lon/lat unchanged; a changed one writes lon/lat rounded to 1e-9 degree. Open then save without edits is byte-identical (`geolocated-design-codec.test.ts`).
- **View, not placement.** Pan, zoom, fit and place search move the camera only; objects move only when the user edits them. Saved object stamps stay relative arrangements in metres; templates are current-format `.canopi` files placed relative to the view.
- **New Design view.** A new Design opens centred on the app's last view zoomed out to at most zoom 5, or at lon 13.0, lat 23.0, zoom 4 without one, and asks "Where is your site?" before "Start your Design".

## Map stack

- Layers are ordered into bands, back to front: background (basemap or satellite), LiDAR items, terrain references (contours, hillshade), the shared scene layer, interaction overlays (`app/map-layers/bands.ts`).
- **Basemap:** OpenFreeMap vector styles (Liberty default; Positron, Bright, Dark) installed as source, layers, glyphs and sprite without `setStyle()`, so map lifetime, camera and edits survive a style change; attribution comes from the provider's TileJSON; labels follow the app locale.
- **Satellite:** Google only (Esri was rejected on licence terms). Without a key the public `mt1.google.com` tiles; with the user's device key the Map Tiles API session in `maplibre/basemap-tile-auth.ts`, the credential boundary. The key never enters a Design, export, snapshot, diagnostic bundle or log ([ADR 0001](adr/0001-geolocated-map-canvas.md)).
- **Place search:** the title-bar place field (Ctrl K) parses coordinates locally and sends place names through the geocoding registry copied from GeoLibre (Nominatim, Enter only, at least 1.1 s between requests, OSM attribution). Confirm moves the view only. Details: [map workspace](guides/map-workspace.md).

## GeoLibre reuse boundary

GeoLibre (MIT, https://github.com/opengeos/GeoLibre) is a React and Zustand app; Canopi never imports its components or stores ([ADR 0002](adr/0002-geolibre-module-reuse.md)). Reference commit for copied TypeScript modules: `e9df9e2`.

| Piece | Source | How |
|---|---|---|
| COG display | `maplibre-gl-raster`, `cog-tiler-wasm` (pinned in `desktop/web/package.json`) | Dependency |
| Native GeoTIFF/COG reader | `wbgeotiff` from `opengeos/whitebox-wasm` (git rev in `desktop/Cargo.toml`) | Dependency |
| Analyses | GeoLibre CLI from `opengeos/geolibre-rust` (revision in `scripts/build-geolibre-cli.sh` and `desktop/src/services/lidar/geolibre.rs`) | Sidecar binary |
| Geocoding registry | `packages/core/src/geocoding.ts` | Copied into `app/geocoding/` |
| Basemap presets | `OPENFREEMAP_BASEMAPS` | Copied into `maplibre/openfreemap-basemap.ts` |
| Layer sync | `packages/map/src/layer-sync.ts` | Pattern only (store-driven, idempotent sync) |

Every copied file keeps an MIT header naming its source path and commit and an entry in the root [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md); pinned dependencies and the AGPL sidecar are in `desktop/THIRD_PARTY_NOTICES.md` (`third-party-notices.test.ts`). `@geolibre/map` is never a dependency (it pulls Cesium and React). Modules evaluated and not adopted, with reasons, are listed in [map workspace](guides/map-workspace.md).

## Editions

- **Desktop** (Tauri) and **Web** (static bundle) share the codec, scene runtime, workbenches and workspace composition; adapters are chosen at compile time through five Vite aliases, and the Web build rejects Tauri markers ([editions](guides/editions.md)).
- **Web scope:** browser-local data, geocoding through the shared registry, no problem reports, `.canopi`, PDF and GeoJSON as file outputs ([ADR 0005](adr/0005-web-edition-scope.md)).
- **Species catalog:** Desktop reads SQLite through Rust; Web reads generated Parquet through DuckDB-WASM ([ADR 0006](adr/0006-species-catalog-storage.md)).
- **Personal libraries:** saved object stamps and the Design Notebook live in the Desktop user DB; Web keeps stamps browser-local ([ADR 0007](adr/0007-design-objects-and-personal-libraries.md)).
- **PDF:** one browser-compatible layout and encoder for every edition, never with map backgrounds ([ADR 0008](adr/0008-canvas-pdf-export.md)).
- **Saving:** always-on continuous save to each Design's home (a file or a Draft), with conflict detection and no unsaved-changes prompts ([ADR 0009](adr/0009-continuous-save.md)).
- **Interface:** map-first Field Atlas chrome floating over the map, menus for every command, one plant finder and one species row everywhere ([ADR 0010](adr/0010-map-first-interface.md)).
- **Analyses and stories:** analyses are entries in the authored registry `common-types/analysis-registry.json`, generated into Rust and TypeScript, each run by a handwritten executor in `desktop/src/services/lidar/analyses/` with recorded provenance; Designs hold saved views and stories presented inside Canopi ([ADR 0011](adr/0011-analyses-provenance-and-stories.md), [data library](guides/data-library.md)).
- **Vegetation analysis** from ONF Computree methods in an LGPL crate is decided but not built: no `vegetation/` crate or `native` lane exists yet ([ADR 0012](adr/0012-vegetation-analysis.md)).
- **GeoJSON:** RFC 7946 import and export of design objects in both editions through one pure codec (`app/geojson/`); import rejects malformed files before mutation and adds objects as one undoable transaction.

## Native execution

Every `#[tauri::command]` is registered once and is executor-backed async or one of the reviewed bounded synchronous commands in `desktop/src/native_command_policy.rs`. Filesystem, SQLite, network, rendering, encoding, compression, process, sleeping and unbounded CPU work never run synchronously on a command thread; direct blocking-pool calls belong only in `desktop/src/native_operation.rs` (`native_command_policy::tests`; [native and release](guides/native-and-release.md)).

## Persistence of app data

[ADR 0013](adr/0013-stored-data-migrations.md) decides every store; until each migration ships, the store keeps ADR 0003's refusal:

- Designs: formats v7 to current open and upgrade in memory; older (Canopi 1.2 and earlier) or newer files are refused with a typed `DesignLoadFailure` that says which.

- Desktop user DB: a database from Canopi 1.0 to 1.2 (schema 8) upgrades in place through the ladder in `desktop/src/db/user_db_migrations.rs` (one transaction, integrity check before commit, rollback leaves the file untouched); an older or newer one is refused with a typed error and left untouched; only a damaged one is renamed `<file>.corrupt-<unix-seconds>` and replaced by an empty database.
- LiDAR library: an older or corrupt catalogue is set aside and rebuilt from the originals and their `meta.json`; a newer one is refused and the library runs empty and read-only. Originals are never deleted by recovery.
- Web: independent browser-local records for drafts, settings, species activity and stamps; data from an older Canopi is ignored.
