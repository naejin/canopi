# Data Library

## Purpose

Boundaries for Canopi Desktop's local store of LiDAR terrain rasters (imported sources and derived analysis results), their display on the map and the analysis registry. Why: [ADR 0002](../adr/0002-geolibre-module-reuse.md), [ADR 0013](../adr/0013-stored-data-migrations.md), [ADR 0011](../adr/0011-analyses-provenance-and-stories.md), [ADR 0012](../adr/0012-vegetation-analysis.md), [ADR 0014](../adr/0014-pure-rust-raster-engine.md). Rust paths are under `desktop/src/services/lidar/`, frontend paths under `desktop/web/src/`; each rule ends with its enforcing test, or "(advice)".

## Authorities and boundaries

- **The library** (catalogue `$APPDATA/lidar/lidar-library.sqlite`) owns originals, generations, derived items, quality masks, jobs, processing history and display derivatives. Work belongs to the library: closing a panel or switching Designs never stops it; only explicit Cancel does.
- **A Design** owns only ordered references `{ kind, id, visible, opacity, order, style }` (`common-types/src/lidar.rs`, kinds `Source` and `Derived`), edited through `app/design-edit/lidar.ts`. It never holds paths, pixels or library state; a reference to a deleted item stays listed as unavailable until the user removes it.
- **Numeric reads, analysis and display are separate.** Display colour and resampling never become analysis input; a displayed colour is never a measurement; inspection reads the native pixel.
- **The registry** (`common-types/analysis-registry.json`) says what an analysis is; executors in `analyses/` say how it runs. The native side validates every request; the frontend only mirrors the rules for inline errors.
- **Camera and map style** never change raster geography, library data or results, and never start an analysis.
- **Web** has no library, import, display or analysis and round-trips the Design's `lidar` section unchanged. (`desktop/web/scripts/check-web-build-boundaries.mjs`, `__tests__/frontend-architecture-policies.test.ts`)

## Rules

- One catalogue schema, `CATALOGUE_VERSION` (`catalogue.rs`), no migration ladder. Every original carries a derived `sources/<sha256>/meta.json` (`source_meta.rs`); an older or corrupt catalogue is set aside under `lidar-library.set-aside/` and rebuilt from those files, with items prepared again on Retry; a newer catalogue is refused, and a catalogue that can be neither opened nor rebuilt is `Unavailable`; in both states the library runs empty and read-only. Nothing on the recovery path deletes an original. (`mod.rs` recovery tests, `recovery.rs`, `source_meta.rs` tests)
- How the library opened is health, not a log line: `SubsystemHealth.lidar_library` (`common-types/src/health.rs`) carries the state and counts, never paths or reasons; the degraded banner shows the two read-only states and the Data library dialog every non-ready one. (`health.rs` and `recovery.rs` tests, `__tests__/lidar-library-health.test.tsx`)
- An import publishes one fixed item from one batch; listed order is source priority (first valid sample wins, NoData reveals the next). A published item never gains, loses or reorders sources. (`import.rs` tests)
- Files first, then references: originals to `sources/<sha256>/original`, COGs to `assets/<sha256>/cog.tif` by idempotent rename, then one `BEGIN IMMEDIATE` transaction writes the rows. A crash leaves no item or a complete one plus unreferenced files, which the startup sweep removes (never while a job is in flight). (`mod.rs`, `import.rs` tests)
- A run publishes all outputs or none, only while every input is still at its pinned generation; superseded generations stay for history. Restart marks unfinished jobs failed (`analyses/mod.rs`, `recover_interrupted_jobs`) and recalculates nothing. (`analyses/tests.rs`; restart itself is covered only by the `e2e_*` fixture lanes)
- Refresh and Retry are one operation (`lidar_rerun_analysis`): same item ids, new generation, so every Design sees the new result. Refresh is always explicit; staleness (`InputUpdated`, `InputStale`, `RecipeUpdated`, `ToolUpdated`) is only shown. (`analyses/tests.rs`)
- Quantities and units are declared at import, never inferred from a filename; identical bytes with different meanings are distinct items; derived quantities cannot be imported. (`import.rs` tests, `RasterQuantity::is_importable`)
- Admitted input: single-band numeric GeoTIFF, north-up, identity scale and offset, no dataset mask, at least one valid sample; a batch shares CRS and pixel size and is lattice-aligned. Zero and negative samples are data. (`admission.rs`, `import.rs` tests)
- Bounds are safety limits, not performance claims: 2 GiB per file, 24 files and 2 GiB per import, 400 M processing cells per collection (`admission.rs`); 25 M cells for any whole-raster read (`MAX_RAW_EXTRACTION_CELLS`, `import.rs`); windows of at most 1024² plus `MAX_RECIPE_HALO` (2); a 4 MiB metadata ceiling and 256 MiB free-space floor (`prepared_raster.rs`). No union raster or whole-extent buffer. (unit tests in each module)
- Offers read catalogue facts (`crs_class` recorded at import), so the 1.5 s poll reads no raster. Reasons are named (`WrongInput`, `NotReady`, `ValuesNotMetres`, `GridNotProjectedMetres`, `EngineMissing`; frontend `NeedsDesktop`, `AlreadyInLayers`); nothing is chosen silently. (`analyses/tests.rs`, `__tests__/analysis-model.test.ts`)
- Every registry entry has exactly one executor; a job runs only the recipe version it was pinned to. (`analyses/tests.rs`, `cargo test -p bindings-gen analysis_registry`)
- The GeoLibre windowed lane stages with the exact `-2^127` sentinel (`STAGING_NODATA`, `analyses/windowed.rs`); non-finite outputs, the tool marker and the sentinel never reach a published raster. (`geolibre_slope_matches_the_analytic_surface_across_a_chunk_seam` in the `lidar-native` lane)
- Display derivatives (`display-cog-deflate256-v1`, `display_cog.rs`) are regenerable, staged outside the asset scope and renamed into `display-cog/` only when complete; keys include generation identity so a URL never outlives its generation. (`display_cog.rs` tests, `__tests__/lidar-display.test.ts`)
- The WebView reaches only `$APPDATA/lidar/display-cog/*.tif` (asset scope in `desktop/tauri.conf.json`); originals, staging, scratch and numeric rasters stay out of reach. (`__tests__/tauri-csp.test.ts` for CSP; scope is advice)
- Styles dispatch on the quantity in `app/lidar/item-types.ts`, the only frontend module that knows item types, and use stored units, so percent slope is never coloured as degrees. (`__tests__/item-types.test.ts`)
- Delete from library is separate from Remove from Design; an item other results depend on is refused with the count (`lidar_delete_impact`), rechecked inside the transaction. The catalogue tracks no Design references and the confirmation says so. (`mod.rs` tests, `__tests__/lidar-actions.test.ts`)
- Import and analysis started from Layers attach results only to the Design session that asked (`pendingAttachments`, `app/lidar/actions.ts`); a switch, failure or cancel drops the attachment. (`__tests__/lidar-actions.test.ts`)
- Add to Design is idempotent and never moves the camera; Fit uses the viewport command, 48 px padding, capped at zoom 18 (`app/lidar/camera-request.ts`). (`__tests__/lidar-camera-navigation.test.ts`)
- Every LiDAR command is executor-backed except the three bounded cancels (`lidar_cancel_import`, `lidar_cancel_analysis_job`, `lidar_cancel_sample_pixel`); raster and disk-scanning commands use `Local`, catalogue reads `UserData`. (`native_command_policy::tests`)
- Raster work runs in process on the pure-Rust engine (`rust_engine/`, the only production `RasterEngine`; the test-only GDAL oracle `gdal_engine.rs` backs the comparison lane): probes read headers only; every whole-raster load passes `MAX_RAW_EXTRACTION_CELLS` first with its named reason; outputs are the numeric and display profiles; CRSs resolve through `wbprojection`, with the engine's own Swiss and LAEA projections. Its agreement with GDAL is the ignored comparison lane. (`rust_engine` tests, `rust_engine::comparison`)
- The GeoLibre child runs with fixed argv, no shell, bounded output and duration; output files live under `engine-logs/`, never the system temp dir. A cancelled child is killed and publishes nothing. (`process.rs`, `geolibre.rs` tests)
- `desktop/THIRD_PARTY_NOTICES.md` names the raster crates and the GeoLibre CLI revision (`__tests__/third-party-notices.test.ts`); `geolibre.rs` pins the same revision as `scripts/build-geolibre-cli.sh` (`geolibre.rs` tests).

## Environment and commands

- Raster engine: built in; nothing to install or discover.
- GeoLibre CLI: `CANOPI_GEOLIBRE_BIN`, beside the executable, then `PATH` (`geolibre.rs` tests); pinned by `GEOLIBRE_REVISION` in `geolibre.rs`, built by `scripts/build-geolibre-cli.sh` and bundled as a Tauri sidecar beside the executable ([native and release](native-and-release.md)).
- Engine lane (CI job `lidar-native`): `CANOPI_GEOLIBRE_BIN=<path> CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop --lib services::lidar -- --ignored --test-threads=1 --skip e2e_`.
- Comparison lane (local; `gdalinfo`, `gdal_translate` and `gdaltransform` on `PATH`; skips without them): `cargo test -p canopi-desktop --lib rust_engine::comparison -- --ignored --nocapture`.
- Fixture lanes (local; no fixtures is not a pass): `CANOPI_LIDAR_E2E_FIXTURE=<IGN MNT GeoTIFF>`, `CANOPI_LIDAR_MNH_DIR=<IGN MNH tiles>`, then `cargo test -p canopi-desktop --lib -- --ignored --test-threads=1 --nocapture` for the `e2e_*` tests in `e2e.rs`.
- Raster diagnostics: `localStorage['canopi.rasterDiagnostics']='1'`.

## Do not

- Add a catalogue migration or compatibility reader; bump `CATALOGUE_VERSION` and let the rebuild carry the data, keeping `meta.json` complete.
- Store a library path, pixel or runtime URL in a `.canopi`, log or Problem Report.
- Let a source item gain files after publication; a new batch is a new item.
- Guess a quantity or unit from a filename, band description or value range.
- Materialise a merged raster, union grid or absent-coordinate walk.
- Read a raster in the poll, in offers or in a `UserData` command.
- Refresh a result implicitly; show "Out of date" and wait for Refresh.
- Delete files on a failure path; the startup sweep owns cleanup.
- Add an analysis by code alone: registry entry, one executor, locale keys ([AGENTS.md](../../AGENTS.md)).

## Where to look

| Area | Module | Tests |
|---|---|---|
| Admission, import, publication | `admission.rs`, `import.rs`, `collection.rs`, `generation.rs` | inline tests, `fixed_library_tests.rs`, `e2e.rs` |
| Catalogue, paths, sweep, recovery | `catalogue.rs`, `paths.rs`, `mod.rs`, `recovery.rs`, `source_meta.rs` | inline tests |
| Registry, executors | `common-types/analysis-registry.json`, `common-types/src/analysis_registry.rs`, `analyses/` | `analyses/tests.rs`, `bindings-gen analysis_registry` |
| Engines, readers | `engine.rs`, `rust_engine/`, `geolibre.rs`, `prepared_raster.rs` | inline tests, comparison lane, `lidar-native` lane |
| Display | `display_cog.rs`, `maplibre/raster-display/`, `app/lidar/display.ts`, `item-types.ts` | `__tests__/raster-display-*`, `lidar-display`, `item-types` |
| Commands, policy | `desktop/src/commands/lidar.rs`, `native_command_policy.rs` | `native_command_policy::tests` |
| Frontend state, actions | `app/lidar/`, `app/analyses/model.ts` | `__tests__/lidar-*`, `analysis-model`, `analyze-dialog` |
| Layers, dialogs | `components/panels/lidar/`, `components/panels/analyze/` | `__tests__/lidar-site-data`, `lidar-data-dialogs`, `layer-panel`, `web-layers-panel` |
| Design references | `app/design-edit/lidar.ts`, `common-types/src/lidar.rs` | `__tests__/design-edit-lidar` |

## Open decisions

None tracked.
