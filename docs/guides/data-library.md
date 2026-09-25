# Data Library

The Data Library is Canopi's local store of reusable LiDAR terrain data (Desktop only): imported elevation or height rasters and slope results calculated from them. A Design holds only references and their presentation. Decisions are in [ADR 0002](../adr/0002-geolibre-module-reuse.md) (fixed items, upstream display, GeoLibre slope) and [ADR 0003](../adr/0003-no-backward-compatibility.md) (catalogue v20, no migrations). Map composition is in [Map workspace](map-workspace.md); the `.canopi` reference section is in [Design document](design-document.md).

Paths: native code in `desktop/src/services/lidar/` and `desktop/src/commands/lidar.rs`; frontend in `desktop/web/src/app/lidar/`, `desktop/web/src/components/panels/lidar/` and `desktop/web/src/maplibre/raster-display/`.

## Ownership

- The library owns originals, numeric generations, results, quality masks, jobs and display derivatives. A Design owns an ordered list of references (`kind`, stable id, visibility, opacity, order, style) edited through Design Edit (`app/design-edit/lidar.ts`).
- Library changes never dirty a Design. Adding, removing, hiding, reordering and opacity changes are Design Edits: they dirty the Design and are undoable with it.
- Camera, map style and workspace navigation never change raster geography, library data or results, and never start analysis.
- Numeric reads, analysis and display are separate responsibilities. Display colour and resampling never become analysis input; a displayed colour is never a measurement.

## Product contract

Two surfaces manage data: the **Data Library** side panel (`DataLibraryPanel.tsx`, `LibraryPreview.tsx`) for reusable items, and the data band in **Layers** (`LidarLayersSection.tsx`) for the current Design. There is no Analysis panel, dataset history, restore, library undo, source editor or automatic refresh.

### Library list and details

- Header action **Import**; below it name search and a type filter (All, Sources, Slope). Search, filter, order and detail navigation are session view state, never Design data (`app/lidar/library-items.ts`). Items sort by name with identity as tie-breaker. Unfinished or failed operations stay listed whatever the filter.
- Each row shows a lazy preview, name, quiet type and resolution or units, and **Add to Design** (or **Added** when referenced; hiding in Layers does not un-add). Previews share the raster worker pool; a missing preview never blocks search or metadata.
- Details (same dock, Back restores search, scroll and focus) show a larger preview, extent, measurement and units, resolution, availability and source filenames; results also show input and method. Technical CRS and engine facts sit in a disclosure. Rename and Delete are in the overflow menu. Names are not unique and never identify an item.

### Import

- The native picker opens first (`chooseImportFiles`); cancelling it creates nothing. The user names the item and declares what the samples mean: measurement kind (ground elevation, surface elevation, above-ground height, other continuous) and units, or explicitly unknown units. Meaning is never guessed from a filename.
- One submitted selection of one or more compatible GeoTIFFs publishes **one fixed item**. The listed order is the item's source priority: where files overlap the first listed valid sample wins and NoData reveals the next. Importing more files later creates another item; a published item never gains, loses or reorders sources.
- Any incompatible source or preparation failure publishes none of the batch; the error names the file and reason.
- Import saves to the library only. It never attaches to a Design or moves the camera; **Add to Design** is the single attachment step.
- Progress, Cancel and Retry appear beside the operation. Closing the dock or switching Designs never stops library work; only explicit Cancel does. Retry reuses the saved request (`lidar_import_jobs.request_json`) with a new job; a failed import stays a failed operation, never an empty ready item. Dismiss removes a never-published failed or cancelled import and only its unreferenced staging.

### Layers data band

- Flat rows in drawing order with independent eyes, compact preparing, unavailable or error states, and keyboard order controls. Order is display order only, never source priority.
- The selected row offers opacity, a units legend (`app/lidar/display-legend.ts`), Fit, Inspect and Remove from Design. Management actions link to Data Library details.
- **Add** is idempotent: an existing reference keeps its visibility, opacity and order; a new one is visible at the top of the band and does not fit the camera. **Remove from Design** leaves the item in the library and in other Designs.
- Unavailable references (deleted item, another machine's library) stay listed and saved with their presentation.
- **Fit** converts the item's WGS84 bounds through the session plane and fits them through the canvas camera (48 CSS px padding, capped at MapLibre zoom 18); Return restores the first bookmark (`app/lidar/camera-request.ts`).

### Inspection

- **Inspect** samples the native numeric value at the pointer or, by keyboard, the view centre (`app/lidar/inspection.ts`). Results are value with units, NoData, stale (the generation moved; re-aim) or unavailable with a reason. Only the latest request is shown; earlier requests are cancelled (`lidar_cancel_sample_pixel`).
- Inspection keeps pan and zoom, and ends on Escape, hiding or removing the target, Design replacement or map teardown.

### Calculate slope

- A ready source offers **Calculate slope** from its menu or details, or from its Layers details (`calculateSlopeInLibrary`). A small form holds the fixed input, an editable suggested name and Degrees or Percent. `slopeIneligibility` explains an unsupported input or a missing engine; no other method is chosen silently.
- Run creates a new, separate result item. A second calculation with the same settings is a second result; inputs and earlier results never change.
- Started from Layers, the finished result is attached only to the Design session that asked (`settleSlopeAttachments`); a Design switch or failure drops the attachment. Started from the library, it stays in the library.
- A failed or cancelled calculation offers Retry with its saved input, recipe and parameters. A published result is never recalculated in place.

### Delete

- Delete from library is separate from Remove from Design and confirms with the item's name and current-Design impact, noting that other saved Designs may reference it. There is no library undo.
- A source with saved results is refused, with the dependent count; delete those results first. The native guard rechecks inside the delete transaction.
- On success the current Design's reference is removed through Design Edit only if the same Design session is still current. Undo restores the reference, which then shows as unavailable.

## Storage

- Library root: `$APPDATA/lidar/` (`paths.rs`), catalogue `lidar-library.sqlite`. `.canopi` files never contain library paths or pixels.
- One schema, `CATALOGUE_VERSION` 20 (`catalogue.rs`), no migration ladder or backup. `LidarLibrary::open` deletes a library whose catalogue records an older version (`discard_unsupported_library`); `catalogue::open` refuses any other version, so a newer library is never deleted or written.
- Import copies each accepted original into managed storage (`sources/<sha256>/original`, nothing beside it) while hashing it and verifies deduplicated originals before trusting them; the catalogue records the filename. Interpretation identity is content plus interpretation facts, never names, so identical bytes with different meanings stay distinct.
- A source item's generation is an immutable ordered list of member occurrences (`lidar_collection_members`) with interpretation-level valid-cell and range facts. Its value at a location is the highest-priority valid sample, resolved on demand from the retained source COGs (`collection.rs`, `generation.rs`); no merged raster is ever materialized. Each retained source is one controlled uncompressed Float32 COG (256 blocks, one base level, no overviews).
- A published item refuses new sources ("already published and fixed"). Publication is a short catalogue transaction that inserts the item's only head; heads are insert-only, so an item's generation and a result's generation never change. A slope job therefore has no stale or superseded outcome: it publishes or fails.
- Files first, then references. Import moves each job-local source COG into the content-addressed store (`assets/<sha256>/cog.tif`) with an idempotent rename (an existing destination is reused after its digest is verified), and slope chunks are admitted the same way; only then does one transaction write the rows that reference them. A crash at any point leaves either no visible item or the complete one, plus at most unreferenced files. Nothing is deleted on a failure path; a retry of the same batch reuses the files already in place.
- Slope results are sparse 1024-cell chunks with separate 0/1 quality chunks; an all-zero quality chunk is absent. Each result records input generation, `method_id`, `recipe_version` and engine build.
- Restart recovery marks staging, applying and preparing jobs failed ("interrupted by restart"); published data is unaffected, and nothing is recalculated because the app reopened. Opening also sweeps transient files: settled job roots, unregistered display derivatives, slope scratch (`prepared/scratch-slope-<job>`) of any job not still preparing, engine output files (`engine-logs/`) left by an earlier process, unpublished chunk rows, and asset directories and metadata rows that no interpretation or chunk row references. The asset sweep never touches a referenced digest and is skipped while any import or calculation is in flight.

## Scientific invariants

- Admitted input: single-band numeric GeoTIFF, georeferenced with a horizontal CRS, north-up (no rotation, reflection or south-up), identity scale and offset, no dataset mask (invalid cells must be declared NoData), band unit compatible with the declared unit, at least one valid sample. A batch must share pixel size and CRS and be lattice-aligned; extents may differ.
- Valid zero and negative samples are data. NoData and non-finite samples never erase valid coverage. Coverage is valid pixels, not source rectangles.
- Units and measurement kind are recorded, not inferred. Surface elevation, above-ground height and unknown units are never slope inputs.
- Slope eligibility (`analysis.rs`): ground elevation only (`capability`), elevations in metres, and a projected CRS with metre horizontal units read from the stored raster by GDAL. Geographic or unknown grids are refused by name.
- **Recipe 2** is the only slope recipe (`analysis::SlopeRecipe`, `lidar_analysis_definitions.version`): the pinned GeoLibre projected slope, a 5×5 Florinsky stencil with a two-cell halo, `z_factor=1`, degrees or percent. Unknown versions and unreadable parameters fail by name; publication rechecks the stored recipe inside the transaction. A changed method needs a new recipe version.
- Recipe 2 stages each 1024² core plus halo with the exact -2^127 NoData sentinel (the tool substitutes the valid centre for missing neighbours). Invalid centres stay invalid; quality is 1 only where the whole 5×5 input was valid. Non-finite outputs and the sentinel are excluded before publication.
- `create_analysis` always writes recipe 2 and one job pinned to the source's current generation. `retry_analysis` reruns only a failed or cancelled operation, with its stored recipe and parameters, against its pinned input; a complete result or a missing or unexpected input is refused before enqueue.
- Inspection (`inspection.rs`) transforms the WGS84 point into the generation's own grid, reads the containing native pixel through the same resolver as analysis, never interpolates, never decodes a coloured tile and never answers from a generation the caller did not ask for. Results report their own degrees or percent.

## Bounded reads and admission

- `admission.rs` is one policy: at most 2 GiB per file, 24 files and 2 GiB per import, and 400,000,000 processing cells per collection, charged per occurrence. It is enforced at selection, while each source is prepared and again at publication. These are safety limits, not performance claims.
- Readers resolve only requested windows, at most 1024² plus the recipe halo (`prepared_raster::MAX_RECIPE_HALO` = 2), with a live-byte budget. No union raster, absent-coordinate walk or whole-extent buffer. Empty space between distant chunks is never allocated.
- `prepared_raster.rs` reaches the pinned native reader `wbgeotiff` only through its private reader. It checks free space before preparation and at every window boundary: padded derivative size, a 4 MiB metadata ceiling, numeric output written meanwhile, and a 256 MiB floor. A platform that cannot report free space fails by name.

## Map display

- `display_cog.rs` prepares display derivatives, profile `display-cog-deflate256-v1`: Float32 COG, DEFLATE, 256 blocks, AVERAGE overviews, source CRS. A source occurrence converts its own COG (content-keyed, reused across items and Designs) with its own NoData; a result is read in bounded windows into parts of at most 8×8 chunks with the -2^127 sentinel, written as its shortest round-trip decimal. Derivatives are regenerable display data, never a source, head or result.
- Derivatives are staged outside the asset scope and renamed into `$APPDATA/lidar/display-cog/` only when complete, so the renderer never reads a partial file. Keys include generation or content identity and profile, so a newer generation never reuses an older URL. Import prepares derivatives before publication; others prepare lazily on one preparation lane.
- `lidar_display_descriptor` answers `Preparing`, `Ready`, `Unavailable`, `Failed` (a request with `retry` starts again) or `Stale` (not the expected generation). `app/lidar/display.ts` holds descriptors, requests and styles; stale answers trigger a fresh read, never display in a successor.
- Styles use stored units: ground and surface elevation `terrain` over the library display range; height and other continuous `viridis`; slope reversed `magma` over a fixed degrees or percent domain, so percent is never coloured as degrees. Legends mirror the compiled `cog-tiler-wasm` ramps.
- Low-zoom display is a visualization of the collection through per-source overviews and one layer-wide stretch, not the exact reduced numeric grid; inspection and analysis stay exact.
- Frontend engine: `maplibre/raster-display/adapter.ts` owns one upstream `LayerManager` per live map with the `cog-tiler-wasm` engine, `loadCogTiler` through the pool, in-memory `loadMosaic` for multi-asset items and refused main-thread auto-statistics. `pool.ts` runs two module-worker lanes shared by the map and library previews, a 128 MiB aggregate decoded-block budget, newest-first dispatch and drops queued off-viewport tiles (`tileIsRelevant`). The engine ignores abort signals, so relevance filtering lives in the pool and the adapter nudges the manager on `idle` and `sourcedata`.
- Asset access: Tauri's asset protocol is scoped to `$APPDATA/lidar/display-cog/*.tif` only; originals, staging, scratch and numeric rasters stay inaccessible to the WebView. CSP admits `'wasm-unsafe-eval'` and `asset:` / `http://asset.localhost` for range reads. Runtime URLs never enter a Design, log or diagnostic.
- Diagnostics are opt-in: `localStorage['canopi.rasterDiagnostics']='1'` exposes `window.__CANOPI_RASTER_DIAGNOSTICS__`.

## Native execution

- Every LiDAR command is executor-backed except the reviewed bounded cancel signals `lidar_cancel_import`, `lidar_cancel_analysis_job` and `lidar_cancel_sample_pixel` in `desktop/src/native_command_policy.rs`. Commands that run GDAL (`lidar_sample_pixel`) use the `Local` class; catalogue and metadata commands (snapshot, rename, delete, collection pages, display descriptors, create and retry receipts) use `UserData`. Import, slope and display preparation jobs run on `Local`. An inspection lookup waits for its display-admission slot outside the executor and is woken when a slot is released or the lookup is cancelled. Rules are in [Native and release](native-and-release.md).
- `engine.rs` runs the GDAL CLI tools (`gdalinfo`, `gdal_translate`, `gdaltransform`) with fixed argv, no shell, bounded output and duration, cancellation, and a cached, recorded engine version. Child output is captured in `$APPDATA/lidar/engine-logs/` under per-process, per-run names created with `create_new` (never the system temp directory) and removed when the run settles. Discovery: `CANOPI_LIDAR_GDAL_BIN` directory, then `PATH`; release builds do not bundle GDAL yet (tracked in bd). The COG options need GDAL 3.7+ (validated on 3.8.4).
- `geolibre.rs` runs `geolibre slope` from `geolibre-rust` at `GEOLIBRE_REVISION` (`aac2b743`) as a job-owned child through the bounded process runner with `RAYON_NUM_THREADS=2`, one window at a time; cancel or timeout kills and reaps it and never publishes partial output. Discovery: `CANOPI_GEOLIBRE_BIN`, beside the executable, then `PATH`. Build it with `scripts/build-geolibre-cli.sh` (writes `desktop/binaries/geolibre-<host-triple>`; its revision is unit-tested against `GEOLIBRE_REVISION`). Without the CLI, new slope is unavailable by name (`snapshot.slope_engine`) while saved results stay readable. The release bundle does not yet include the sidecar.
- `desktop/THIRD_PARTY_NOTICES.md` names the raster packages and the GeoLibre CLI with exact versions; `third-party-notices.test.ts` fails on drift.

## Frontend state

- `app/lidar/library-store.ts` holds the library snapshot signal and polls every 1.5 s while any import or calculation is running, stopping when idle. Work belongs to the library: unmounting a panel or switching Designs never stops it.
- `app/lidar/workflow.ts` (`installLidarWorkflow`) is the Desktop-lifetime owner of polling and the slope-attachment effect, with HMR disposal.
- `app/lidar/actions.ts` owns every library and reference mutation; components call actions and read models only. `readCurrentLidarPresentation` joins library identity with Design references; the Desktop map contribution adapter joins it with display descriptors.
- Web has no library, import, display or analysis and imports no raster engine (enforced by `desktop/web/scripts/check-web-build-boundaries.mjs`). Its Data panel (`web/WebLocalRasterPanel.tsx`) only states that local rasters are unavailable; the Design's LiDAR references round-trip unchanged.

## Gates

- Any native change: the Rust gates in [AGENTS.md](../../AGENTS.md#quality-gates), plus focused `services::lidar` tests. Contract changes: regenerate bindings.
- GDAL and GeoLibre lane (CI job `lidar-native` in `.github/workflows/build.yml`, GDAL 3.8.4 plus the pinned CLI): `CANOPI_GEOLIBRE_BIN=<path> CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop --lib services::lidar -- --ignored --test-threads=1 --skip e2e_`.
- Real-fixture lanes stay local: `CANOPI_LIDAR_E2E_FIXTURE=<IGN MNT GeoTIFF>` and `CANOPI_LIDAR_MNH_DIR=<IGN MNH tiles>` (plus `CANOPI_LIDAR_GDAL_BIN` and `CANOPI_GEOLIBRE_BIN` as needed), then `cargo test -p canopi-desktop --lib -- --ignored --test-threads=1 --nocapture`. Lanes: `e2e_import_publish_slope_restart_reuse`, `e2e_sparse_generation_lifecycle`, `e2e_mnh_batch_import_apply_display_restart`. Report the tile and hash used; a run without fixtures is not a pass.
- Frontend tests in `desktop/web/src/__tests__/`: `lidar-actions`, `lidar-library-store`, `lidar-library-items`, `lidar-data-library-panel`, `lidar-layers-section`, `lidar-display`, `lidar-inspection`, `lidar-camera-navigation`, `raster-display-pool`, `raster-display-adapter`, `design-edit-lidar`.
