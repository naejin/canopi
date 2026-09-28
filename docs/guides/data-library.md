# Data Library

## Purpose

Boundaries for Canopi Desktop's local store of LiDAR terrain rasters (imported sources and the derived items analyses calculate from them), their display on the map and the analysis registry. Why: [ADR 0002](../adr/0002-geolibre-module-reuse.md), [ADR 0003](../adr/0003-no-backward-compatibility.md), [ADR 0011](../adr/0011-analyses-provenance-and-stories.md), [ADR 0012](../adr/0012-vegetation-analysis.md). Rust paths are under `desktop/src/services/lidar/`, frontend paths under `desktop/web/src/`; each rule ends with its enforcing test, or "(advice)".

## Authorities and boundaries

- **The library** (catalogue `$APPDATA/lidar/lidar-library.sqlite`) owns originals, generations, derived items, quality masks, jobs, processing history and display derivatives. Work belongs to the library: closing a panel or switching Designs never stops it; only explicit Cancel does.
- **A Design** owns only ordered references `{ kind, id, visible, opacity, order, style }` (`common-types/src/lidar.rs`, kinds `Source` and `Derived`), edited through `app/design-edit/lidar.ts`. It never holds paths, pixels or library state; a reference to a deleted item stays listed as unavailable until the user removes it.
- **Numeric reads, analysis and display are separate.** Display colour and resampling never become analysis input; a displayed colour is never a measurement; inspection reads the native pixel.
- **The registry** (`common-types/analysis-registry.json`) says what an analysis is; executors in `analyses/` say how it runs. The native side validates every request; the frontend only mirrors the rules for inline errors.
- **Camera and map style** never change raster geography, library data or results, and never start an analysis.
- **Web** has no library, import, display or analysis and round-trips the Design's `lidar` section unchanged. (`desktop/web/scripts/check-web-build-boundaries.mjs`, `__tests__/frontend-architecture-policies.test.ts`)

## Rules

- One catalogue schema, `CATALOGUE_VERSION` (`catalogue.rs`, 21), no migration ladder. An older library is deleted on open; a newer one is refused, never written. (`mod.rs` tests)
- An import publishes one fixed item from one batch; listed order is source priority (first valid sample wins, NoData reveals the next). A published item never gains, loses or reorders sources. (`import.rs` tests)
- Files first, then references: originals to `sources/<sha256>/original`, COGs to `assets/<sha256>/cog.tif` by idempotent rename, then one `BEGIN IMMEDIATE` transaction writes the rows. A crash leaves no item or a complete one plus unreferenced files, which the startup sweep removes (never while a job is in flight). (`mod.rs`, `import.rs` tests)
- A run publishes all outputs or none, only while every input is still at its pinned generation; superseded generations stay for history. Restart marks unfinished jobs failed and recalculates nothing. (`analyses/tests.rs`)
- Refresh and Retry are one operation (`lidar_rerun_analysis`): same item ids, new generation, so every Design sees the new result. Refresh is always explicit; staleness (`InputUpdated`, `InputStale`, `RecipeUpdated`, `ToolUpdated`) is only shown. (`analyses/tests.rs`)
- Quantities and units are declared at import, never inferred from a filename; identical bytes with different meanings are distinct items; derived quantities cannot be imported. (`import.rs` tests, `RasterQuantity::is_importable`)
- Admitted input: single-band numeric GeoTIFF, north-up, identity scale and offset, no dataset mask, at least one valid sample; a batch shares CRS and pixel size and is lattice-aligned. Zero and negative samples are data. (`admission.rs`, `import.rs` tests)
- Bounds are safety limits, not performance claims: 2 GiB per file, 24 files and 2 GiB per import, 400 M processing cells per collection (`admission.rs`); 25 M cells for any whole-raster read (`MAX_RAW_EXTRACTION_CELLS`, `import.rs`); windows of at most 1024² plus `MAX_RECIPE_HALO` (2); a 4 MiB metadata ceiling and 256 MiB free-space floor (`prepared_raster.rs`). No union raster or whole-extent buffer. (unit tests in each module)
- Offers read catalogue facts (`crs_class` recorded at import), so the 1.5 s poll runs no GDAL. Reasons are named (`WrongInput`, `NotReady`, `ValuesNotMetres`, `GridNotProjectedMetres`, `EngineMissing`; frontend `NeedsDesktop`, `AlreadyInLayers`); nothing is chosen silently. (`analyses/tests.rs`, `__tests__/analysis-model.test.ts`)
- Every registry entry has exactly one executor; a job runs only the recipe version it was pinned to. (`analyses/tests.rs`, `cargo test -p bindings-gen analysis_registry`)
- The GeoLibre windowed lane stages with the exact `-2^127` sentinel; non-finite outputs, the tool marker and the sentinel never reach a published raster. (`analyses/windowed.rs` tests)
- Display derivatives (`display-cog-deflate256-v1`, `display_cog.rs`) are regenerable, staged outside the asset scope and renamed into `display-cog/` only when complete; keys include generation identity so a URL never outlives its generation. (`display_cog.rs` tests, `__tests__/lidar-display.test.ts`)
- The WebView reaches only `$APPDATA/lidar/display-cog/*.tif` (asset scope in `desktop/tauri.conf.json`); originals, staging, scratch and numeric rasters stay out of reach. (`__tests__/tauri-csp.test.ts` for CSP; scope is advice)
- Styles dispatch on the quantity in `app/lidar/item-types.ts`, the only frontend module that knows item types, and use stored units, so percent slope is never coloured as degrees. (`__tests__/item-types.test.ts`)
- Delete from library is separate from Remove from Design; an item other results depend on is refused with the count (`lidar_delete_impact`), rechecked inside the transaction. The catalogue tracks no Design references and the confirmation says so. (`mod.rs` tests, `__tests__/lidar-actions.test.ts`)
- Import and analysis started from Layers attach results only to the Design session that asked (`pendingAttachments`, `app/lidar/actions.ts`); a switch, failure or cancel drops the attachment. (`__tests__/lidar-actions.test.ts`)
- Add to Design is idempotent and never moves the camera; Fit uses the viewport command, 48 px padding, capped at zoom 18. (`__tests__/lidar-camera-navigation.test.ts`)
- Every LiDAR command is executor-backed except the three bounded cancels (`lidar_cancel_import`, `lidar_cancel_analysis_job`, `lidar_cancel_sample_pixel`); GDAL and disk-scanning commands use `Local`, catalogue reads `UserData`. (`native_command_policy::tests`)
- Child processes run with fixed argv, no shell, bounded output and duration; output files live under `engine-logs/`, never the system temp dir. A cancelled child is killed and publishes nothing. (`engine.rs`, `geolibre.rs` tests)
- `desktop/THIRD_PARTY_NOTICES.md` names the raster packages and the GeoLibre CLI revision. (`__tests__/third-party-notices.test.ts`, `geolibre.rs` tests)

## Environment and commands

- GDAL: `CANOPI_LIDAR_GDAL_BIN`, then `PATH` (`gdalinfo`, `gdal_translate`, `gdaltransform`; CI uses 3.8.4). Not bundled in release.
- GeoLibre CLI: `CANOPI_GEOLIBRE_BIN`, beside the executable, then `PATH`; pinned by `GEOLIBRE_REVISION` in `geolibre.rs`; build with `scripts/build-geolibre-cli.sh`. Not bundled in release.
- Engine lane (CI job `lidar-native`): `CANOPI_GEOLIBRE_BIN=<path> CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop --lib services::lidar -- --ignored --test-threads=1 --skip e2e_`.
- Fixture lanes (local; no fixtures is not a pass): `CANOPI_LIDAR_E2E_FIXTURE=<IGN MNT GeoTIFF>`, `CANOPI_LIDAR_MNH_DIR=<IGN MNH tiles>`, then `cargo test -p canopi-desktop --lib -- --ignored --test-threads=1 --nocapture` for the `e2e_*` tests in `e2e.rs`.
- Raster diagnostics: `localStorage['canopi.rasterDiagnostics']='1'`.

## Do not

- Add a catalogue migration, backup or compatibility reader; bump `CATALOGUE_VERSION` and discard.
- Store a library path, pixel or runtime URL in a `.canopi`, log or Problem Report.
- Let a source item gain files after publication; a new batch is a new item.
- Guess a quantity or unit from a filename, band description or value range.
- Materialise a merged raster, union grid or absent-coordinate walk.
- Run GDAL or read a raster in the poll, in offers or in a `UserData` command.
- Refresh a result implicitly; show "Out of date" and wait for Refresh.
- Delete files on a failure path; the startup sweep owns cleanup.
- Add an analysis by code alone: registry entry, one executor, locale keys ([AGENTS.md](../../AGENTS.md)).

## Where to look

| Area | Module | Tests |
|---|---|---|
| Admission, import, publication | `admission.rs`, `import.rs`, `collection.rs`, `generation.rs` | inline tests, `fixed_library_tests.rs`, `e2e.rs` |
| Catalogue, paths, sweep | `catalogue.rs`, `paths.rs`, `mod.rs` | inline tests |
| Registry, executors | `common-types/analysis-registry.json`, `common-types/src/analysis_registry.rs`, `analyses/` | `analyses/tests.rs`, `bindings-gen analysis_registry` |
| Engines, readers | `engine.rs`, `geolibre.rs`, `prepared_raster.rs` | inline tests, `lidar-native` lane |
| Display | `display_cog.rs`, `maplibre/raster-display/`, `app/lidar/display.ts`, `item-types.ts` | `__tests__/raster-display-*`, `lidar-display`, `item-types` |
| Commands, policy | `desktop/src/commands/lidar.rs`, `native_command_policy.rs` | `native_command_policy::tests` |
| Frontend state, actions | `app/lidar/`, `app/analyses/model.ts` | `__tests__/lidar-*`, `analysis-model`, `analyze-dialog` |
| Layers, dialogs | `components/panels/lidar/`, `components/panels/analyze/` | `__tests__/lidar-site-data`, `lidar-data-dialogs`, `layer-panel`, `web-layers-panel` |
| Design references | `app/design-edit/lidar.ts`, `common-types/src/lidar.rs` | `__tests__/design-edit-lidar` |

## Open decisions

- canopi-fxil.20: bundle the GDAL CLI tools with release builds.
- canopi-8shm.9: bundle the pinned GeoLibre CLI as a Tauri sidecar.
