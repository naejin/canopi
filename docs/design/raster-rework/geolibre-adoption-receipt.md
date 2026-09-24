# GeoLibre adoption — delivery receipt

Status: partial — S0–S3 evidence recorded; S4 and S5 append theirs as they land.
Tracking: epic `canopi-8shm`; branch `feature/geolibre-adoption` from `feature/data-library-reference` `d6e1b65c` (itself `main` `e01e7d07` plus the plan and gallery reference).
Current guidance: [adoption plan](geolibre-adoption-plan.md), [LiDAR guide](../../agent/lidar.md), [MapLibre guide](../../agent/maplibre.md).

This receipt holds revision-linked evidence for the authorized S0–S5 migration. The plan owns the contracts; bd owns execution state.

## S0 — production capability inventory

Inventory of `desktop/src/lib.rs` at `d6e1b65c`: 73 registered Tauri commands. The 49 non-raster commands (`design` 7, `design_notebook` 11, `export` 3, `favorites` 3, `geocoding` 1, `health` 1, `problem_report` 2, `saved_object_stamps` 7, `settings` 2, `species` 12) own botanical, Design, planning, export, settings and diagnostics behavior. They are **retained unchanged**; the migration adds no caller to them except the existing Design Edit and document-session seams.

The 24 LiDAR commands are classified against plan section 1:

| Command | Disposition | Target behavior |
| --- | --- | --- |
| `lidar_engine_status` | Retained | Availability read; method-specific analysis availability moves into the library read model (S4). |
| `lidar_list_library` | Retained, extended | One read model for fixed items, pending/failed imports, results with method provenance. |
| `lidar_rename_layer` | Retained | Name is editable metadata; renaming never enqueues analysis. |
| `lidar_delete_layer_impact` | Retained, extended | Reports dependent saved results so deletion can be refused with a route to them. |
| `lidar_delete_layer` | Retained, changed | Refuses a source with saved results instead of cascading; recheck inside the delete transaction. |
| `lidar_create_layer` | **Removed** | Empty-dataset setup is outside the target; import creates the item. |
| `lidar_import_sources` | **Removed** | Appending to an existing item is published-source mutation. Replaced by one-item import. |
| `lidar_get_import_job` | Retained | Progress for one import operation. |
| `lidar_cancel_import` | Retained | Explicit Cancel. |
| `lidar_create_analysis` | Retained, changed (S4) | Creates a new definition/result; new definitions use recipe version 2 once qualified. |
| `lidar_retry_analysis` | Retained, restricted | Only failed/cancelled operations without a complete result; uses the stored recipe version and pinned input. |
| `lidar_get_analysis_job_status` | Retained | — |
| `lidar_cancel_analysis_job` | Retained | — |
| `lidar_delete_analysis` | Retained | Deleting a result leaves its source intact. |
| `lidar_sample_pixel` / `lidar_cancel_sample_pixel` | Retained | Exact native numeric inspection and head fences. |
| `lidar_layer_collection` | Retained read-only | Source filenames/order for item details; no mutation. |
| `lidar_layer_history` | **Removed** | History browser is outside the target. |
| `lidar_move_layer_source` / `lidar_remove_layer_source` | **Removed** | Published-source membership editing. |
| `lidar_undo_layer_change` / `lidar_restore_layer_version` | **Removed** | Library Undo/Restore. |
| `lidar_raster_tile` / `lidar_cancel_raster_tile` | **Removed after S3 proof** | Native PNG tiling is replaced by display derivatives rendered by the upstream renderer. |

New LiDAR commands introduced by this migration: a display descriptor request (S1/S2) and a one-item import with retry/dismiss for the same item identity (S2).

Frontend entry points: `nav.data` becomes **Data Library**; `nav.layers` keeps the Layers surface with its botanical/geographic bands and the new data band; `nav.analysis` (standalone Analysis navigation) is **removed** in S3, with Calculate slope becoming a contextual action in S4. Data surface source editing, History, Restore and library Undo UI are removed with their callable paths. Canvas, plant tools, Species Catalog/Favorites, Location, Calendar, Budget, Consortium, Notebook, exports and settings have no disposition change: they are preserved and re-verified in S5.

Deferred (outside this plan): advanced LiDAR processing, point clouds, hydrology, SQL console, RGB imagery and browser raster processing.

## S0 — performance baseline (reduced by user decision)

On 2026-09-24 the user waived the full three-way baseline comparison ("we know that geolibre upstream will be better"). The comparison in plan section 9 against the pinned upstream reference and the remaining baseline fixtures is therefore **not performed**; the migrated route is measured against the plan's absolute targets only. The baseline evidence already captured is retained below.

Setup: baseline `d6e1b65c` release build with debug assertions (needed for the in-app driver bridge) and one repair applied — `import 'pixi.js/unsafe-eval'` — because the production CSP otherwise fails the shared map scene with "Basemap unavailable" (a pre-existing packaged-build defect, fixed on this branch). Isolated profile on nested Xephyr `:99` with llvmpipe software GL, 1280×800 window. Input: real IGN LiDAR HD MNH tile `0445_6806` (2000×2000, 0.5 m, Lambert-93) imported through the production IPC (1.5 s). Timing is taken at the native tile IPC boundary; 32 scripted wheel zoom/pan interactions.

| Condition | First tile | Viewport complete | Interaction p95 / max | Frame gaps > 50 ms (worst) |
| --- | --- | --- | --- | --- |
| Cold app and native tile cache, OS file cache warm | 5.0 s | 29.8 s | 19.6 s / 19.9 s | 68 (495 ms) |
| Warm native tile cache after reload | 0.65 s | 0.70 s | 0.43 s / 7.7 s | 68 (463 ms) |

Baseline import times on the same build: IGN tile 1.5 s, 24 adjacent 2000×2000 tiles 19.8 s, 20000×20000 capacity plane 59.7 s. Display-derivative preparation of the capacity plane with `gdal_translate -of COG` (DEFLATE, 256 blocks, AVERAGE overviews, 2 threads): 18.2 s, 335 MB peak RSS, 21 MB output.

## S1 — upstream renderer in the Desktop WebView

Revision `9d84640a`. Route: `maplibre-gl-raster@0.14.15` public `LayerManager` with `engine: 'cog-tiler-wasm'`, `cog-tiler-wasm@0.4.0` and `whitebox-wasm@0.6.0` hosted in two module-worker lanes (`desktop/web/src/maplibre/raster-display/`), MapLibre 6.10.0 deduplicated. No upstream file is patched: the adapter uses the public `LayerManagerDeps` seam (`loadCogTiler`, `loadMosaic`, `computeAutoStats`). Two upstream behaviours needed adapter glue, recorded with tests: the engine never forwards MapLibre's abort signal (the pool drops queued tiles outside the live viewport, newest first), and it gates its first map mutation on `isStyleLoaded()`, which stays false while basemap tiles load, then waits for a style event a settled style never emits (the adapter re-applies on `idle`/`sourcedata` until every desired layer reaches the map; found by driving the 24-source mosaic in the app, RED test in `raster-display-adapter.test.ts`). `CogSource.tileCache` is replaced per source with a lane-wide LRU so one 128 MiB decoded-block budget covers all sources; the worker fails loudly if the pinned module stops exposing that field.

Driven proof (release build with debug assertions and the production CSP, isolated profile on Xephyr `:99`, llvmpipe software GL, `results-s1-journey.json`):

- A v6 Design with 30 plants over the IGN MNH item: select-all + Delete during a decode burst made Undo available after 36 ms while 15 tiles decoded in the following 2 s; one frame gap above 50 ms (56 ms). Undo restored the plants above the raster band.
- Canvas → Location during a decode burst disposed the renderer client with 8 queued and 10 in-flight renders; both lanes stopped and no tile was delivered afterwards; no page error. Returning to Canvas recreated the map (style load), restarted two lanes and delivered the first tile after 1.2 s.
- External origins fetched: the OSM basemap only. WASM, worker and CRS handling are bundled/offline (no `epsg.io` request).

Derivative preparation (library display lane, same profile): IGN tile 1 derivative in about 1 s; 24 adjacent 2000×2000 tiles, 24 derivatives in 21.7 s; 20000×20000 capacity plane in 20.4 s; 30 MB total on disk.

Ready-data display after a page reload (derivatives prepared, renderer caches cold, OS file cache warm), timed at the worker-lane boundary from the recent-Design click; 32 scripted wheel interactions per item:

| Item | First tile | Viewport complete | Interactions needing new tiles: p50 / p95 / max |
| --- | --- | --- | --- |
| IGN MNH tile | 1.29 s | 1.43 s | 274 / 667 / 667 ms (7) |
| 24-tile mosaic | 1.01 s | 1.19 s | 413 / 940 / 940 ms (6) |
| Capacity plane | 1.11 s | 1.40 s | 357 / 649 / 649 ms (8) |

The 2 s first-useful-viewport target is met on this environment. The 250 ms warm pan/zoom p95 target is **missed** for interactions that need new tiles (most interactions need none; p50 of all interactions is 0 ms). A four-lane measurement lowered the tile-bearing p95 to 594–631 ms but delayed the first tile to 1.19–1.53 s, so the plan's two lanes are kept. The remaining cost is per-tile reprojection/colorizing in the WASM path on software GL; no further optimisation program was started. Compared with the captured baseline cold route (first tile 5.0 s, viewport 29.8 s, p95 19.6 s) the migrated route removes the native per-tile rendering stall; the warm native tile cache (p95 0.43 s) remains faster for repeat interactions over already-rendered areas.

## S2 — fixed library and migration

Revisions `c3417d69` (fixed items, v19 catalogue, refresh retirement) and `7b165a7a` (result rename). Native proof: `services::lidar::fixed_library_tests` (delete guard, import item/retry/dismiss, empty import refused, GDAL publish with display ready and nothing refreshed, rename) and the v19 migration test in `catalogue.rs`.

Real-binary migration proof (S3 measurement build `16e4e392`, release with debug assertions, Xephyr `:99`): a legacy library written by the baseline v18 binary (`d6e1b65c`) — three sources (among them the 24-tile composition with three history versions and the capacity plane), two Horn results (Degrees on the 24 tiles, Percent on the plane) and four settled analysis jobs — was copied with hardlinks broken and opened.

- Catalogue v18 → v19; `VACUUM INTO` backup `lidar-library.sqlite.backup-v18-…` written first.
- Layer and result identities, names, current generations and units identical before and after; all 20 recorded `lidar_sample_pixel` outcomes identical (18 values, 2 NoData).
- No job spawned: analysis jobs stayed 4 complete, import jobs 3 complete; generations 5 and 4 unchanged. Legacy results keep `method_id`/`recipe_version` NULL and show Horn.
- The retired `display/` and `display-tiles/` stores were reclaimed on open.
- The baseline v18 binary then refused the migrated library at start-up: "LiDAR catalogue schema version 19 is newer than supported 18"; the catalogue stayed at v19.

## S3 — Data Library and Layers

Revisions `b7af2976` (Data Library dock, Layers data band, removal of Data/Analysis panels, Analysis navigation, history/source editors and 85 obsolete strings) and `16e4e392` (native tile route retired: `tiles.rs`, `tile_cache.rs`, PNG pyramid publication at import and analysis, `lidar_raster_tile`, the `tilesets` contract, history/edit contract types; asset scope narrowed to `$APPDATA/lidar/display-cog/*.tif`; `gdalwarp` no longer required; about 4,800 lines removed).

Driven Desktop journey (`adoption-bench/s3-journey.mjs`, `results-s3-journey.json`; fresh profile, real GTK file chooser driven through XTest, production UI and IPC throughout; IGN LiDAR HD MNH tile `0445_6806`, 2000×2000 at 0.5 m):

| Step | Result |
| --- | --- |
| Chooser cancel | no form, no item |
| Import (submit → Ready, display derivatives included) | accepted in 146 ms, Ready in 3.1 s |
| Row preview after Ready | 0.34 s |
| Search hit / no match / clear | found; "No data matches" shown; list restored |
| Add to Design → first map tile | 0.65 s (12 tiles within 1.5 s) |
| Select-all + Delete while tiles decode → Undo available | 81 ms |
| Layers: Fit, Return offered, legend, Inspect | all present; Inspect pressed |
| Sample at view centre | 0.0000 m at 48.299927, −0.432810 in 192 ms |
| Remove from Design | band empty; item stays in the library |
| Reuse in Design B → first tile | 0.46 s |
| Save both, reopen | A has no data reference; B lists the item and draws it |

No page errors. Deliberately removed surfaces are absent: no Analysis navigation, no History. Earlier runs of the same journey (import 3.2 s, first tile 0.54 s, reuse 0.50 s) agree.

Gates at `16e4e392`: `npx tsc --noEmit`; full Vitest 286 files / 2795 tests; `npm run check:ui`; `npm run build`; `npm run build:web` (boundary check passes); `npm run gen:types` + `check:types`; `cargo fmt --check`; `cargo clippy --workspace --all-targets -D warnings`; `cargo test --workspace` (358 lib tests); serial GDAL lane 65 passed, 3 failed only for missing fixtures (IGN MNT tile absent on this machine for the dense and sparse e2e lanes; capacity plane not set) — the capacity-plane lane then passed with `CANOPI_LIDAR_CAPACITY_PLANE` set (display derivatives for the 397M-cell plane in 12.9 s, seams and NoData holes exact). The dense and sparse e2e lanes remain **unverified** here for want of the IGN MNT fixture.

Environment notes: release binaries resolve the plant database from `/usr/lib/Canopi` (schema 8), so the catalog reports "corrupt" in these runs; this does not affect the library. The first GTK chooser in a fresh nested session can wait on GVFS start-up.
