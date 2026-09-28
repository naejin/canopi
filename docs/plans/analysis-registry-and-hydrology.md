# ADR 0011 implementation plan: analysis registry, typed items with provenance, hydrology

Status: in progress (2026-09-28). Registry, typed items and provenance shipped (canopi-h90p.9.1); contours, hillshade, aspect and hydrology remain (canopi-h90p.9.2–.9.4, canopi-5ys2.1).

Research date 2026-09-26. Sources:
- Canopi worktree `.rq-scratch/wt-v2`, branch `feature/geolibre-adoption`.
- `geolibre-rust` at the pinned `aac2b743`; the checkout HEAD is that commit.
- `geolibre-src` at `e9df9e24`.
- Pinned CLI binary `.rq-scratch/s4-bin/geolibre` (`geolibre-cli 1.5.3`).

Every tool id and parameter below was checked with `geolibre manifest <id>` on that binary. The research agent ran the hydrology chains end to end on a synthetic EPSG:2154 Float32 DEM.

Beads:
- Seams: `canopi-h90p.9` (P1).
- Hydrology: `canopi-5ys2.1` (P3, depends on h90p.9).
- Where the UI lives in Layers: `canopi-h90p.2`.

---

## 0. Headline findings

1. **Slope is hard-wired end to end.**
   - `LidarAnalysisKind::Slope` is the only kind.
   - Rust side: `LidarAnalysisParameters`, `LidarAnalysisSummary.slope_unit` (required), `LidarAnalysisMethod::GeolibreProjectedSlopeV1`, `LidarLibrarySnapshot.slope_engine`, `SlopeRecipe`, `analysis::capability`, `inspection::result_units` and `paths::slope_scratch_dir`.
   - TS side: `lidarDisplayStyle` treats every `Analysis` as slope.
   - §1.4 lists every site.
2. **Hydrology cannot use the 1024² window lane.**
   - Fill/breach, pointers, accumulation, streams, basins, watershed and TWI are all global.
   - The guide currently forbids a whole-extent buffer ("no union raster … no whole-extent buffer").
   - Plan: add a bounded **global lane**:
     - Stream the composed collection into one scratch GeoTIFF, window by window.
     - Run the CLI on that file.
     - Read the results back window by window into the existing sparse chunk store.
   - A new admission limit caps the number of extent cells.
3. **Lane: GeoLibre CLI sidecar, not WASM.**
   - The CLI Canopi already pins has every tool needed: 1060 tools in total, from `wbtools_oss` in `opengeos/whitebox-wasm` @ `9c0ff4f`.
   - The WASM route (`geolibre-cli.wasm` via `npm/tools.mjs`) is the same catalogue running inside the WebView. It has these drawbacks:
     - It is limited by wasm32 memory.
     - It puts a raster engine in the frontend, which goes against the Web/Desktop boundary.
     - It is slower.
     - It adds nothing offline, because the sidecar also runs offline.
   - Recommend correcting bead `canopi-5ys2.1`, whose text says "bundled Whitebox WASM catalog", and the ADR's lane list. This is a user decision (§7).
4. **Licence (act now).**
   - The CLI binary statically links `wbspatialstats` (`license = "AGPL-3.0-or-later"`, John Lindsay / Whitebox Geospatial).
   - It comes in through `wbtools_oss` with no feature gate; the kriging and spatial-statistics tools use it.
   - `desktop/THIRD_PARTY_NOTICES.md:18-22` describes the sidecar as MIT with an MIT-or-Apache tool registry, which is incomplete.
   - Canopi is `AGPL-3.0-only`, and AGPL-3.0-or-later is compatible with that. Still:
     - The notice must name the AGPL component.
     - Releases must offer the sidecar's Corresponding Source: geolibre-rust `aac2b743` plus whitebox-wasm `9c0ff4f`.
   - `wbcore` and `wbtools_oss` declare no `license` field; only the repo-level MIT/Apache files cover them.
   - File this as its own bead now. This is not legal advice.
5. **The thread cap does not hold for hydrology.**
   - The hydrology and flow tools call `thread::available_parallelism()` directly:
     - `wbtools_oss/src/tools/hydrology/mod.rs:1966,2196,4771,10053`
     - `flow_algorithms/mod.rs:339,796,844,1307,2063,2197`
   - So `RAYON_NUM_THREADS=2` is ignored.
   - The library-wide heavy lease already means only one heavy job runs at a time. Add a lower child-process priority and file an upstream issue.
6. **ADR 0011 changes three data-library contract lines.**
   - "A published result is never recalculated in place."
   - "A slope job has no stale or superseded outcome."
   - "No … automatic analysis refresh" (ADR 0002).
   - Refresh stays user-initiated, never automatic, so ADR 0002 still holds. The guide's section on the result lifecycle gets rewritten (§3.6).

---

## 1. Current pipeline, end to end

### 1.1 Rust (desktop/src)

**`commands/lidar.rs`** (316 lines)
- 17 IPC commands, registered in `lib.rs:116-132`.
- All are executor-backed (`UserData` for catalogue work, `Local` for `lidar_sample_pixel`).
- Three are synchronous and on the allowlist: `lidar_cancel_import`, `lidar_cancel_analysis_job` and `lidar_cancel_sample_pixel`.
- Analysis commands:
  - `lidar_create_analysis(layer_id, kind: LidarAnalysisKind, parameters: LidarAnalysisParameters, result_name)`
  - `lidar_retry_analysis(definition_id, expected_source_generation_id)`
  - `lidar_delete_analysis`
  - `lidar_rename_analysis`

**`services/lidar/mod.rs`** (2702 lines)
- `LidarLibrary` holds the catalogue `Mutex<Connection>`, the `RasterEngine` (pure Rust, ADR 0014), `GeolibreEngine`, cancel flags, the exclusive `heavy_job` lease and display admission.
- `library_snapshot` (:466) discovers GeoLibre and reports it as `slope_engine`.
- `run_analysis` (:1298) waits for the lease, parses the parameters, and runs `analysis::run_slope_job` on `Local`.
- `create_analysis` / `create_analysis_unchecked` (:1378/:1393):
  - hard-code `SlopeRecipe::GeolibreProjected`;
  - write the definition, `lidar_dependencies(kind='source')` and the job, then spawn the run.
- `retry_analysis` (:1463), `delete_analysis` (:1542), `refuse_dependent_results` (:1582), `discard_unsupported_library` (:2528).
- Startup sweeps: `prune_slope_scratch` (:325), `prune_transient_artifacts` (:362), `prune_unreferenced_assets` (:416).

**`services/lidar/analysis.rs`** (1642 lines)
- Types and constants:
  - `AnalysisParameters {slope_unit, name}`.
  - `SlopeRecipe`: version 2, method `geolibre-projected-slope-v1`, halo 2.
  - `GEOLIBRE_STAGING_NODATA` (-2^127).
  - `ResultManifest`.
- `slope_eligibility`, run at job time, checks:
  - the values are in metres;
  - the raster's CRS (`wbprojection` from its GeoKeys/WKT) is projected with metre units.
- `compute_slope_block`, per window:
  1. Read core plus halo, write raw, then `raw_to_tif`.
  2. Run `geolibre slope`.
  3. Check the output's NoData through the raster engine's probe.
  4. Read the output back into values and a quality mask.
  5. Store it with `write_cog_asset`.
- `publish_sparse_slope` stages the chunks, then publishes in one `BEGIN IMMEDIATE` transaction:
  - checks that the job is still preparing, the input head is unchanged and the recipe is unchanged;
  - inserts the generation, publishes the chunks, inserts the head and completes the job.
- Also: `run_slope_job`, `capability` (slope requires ground elevation), `recover_interrupted_jobs`.

**`services/lidar/geolibre.rs`** (185 lines)
- `GEOLIBRE_REVISION = aac2b743…`.
- Discovery, cached: `CANOPI_GEOLIBRE_BIN`, then beside the executable, then `PATH`.
- `version` feeds `GeolibreTool::provenance()`, which returns `"geolibre-cli 1.5.3 (geolibre-rust aac2b743978…)"`.
- `slope(input, output, percent, cancel)` runs `slope --input= --output= --units= --z_factor=1` with `RAYON_NUM_THREADS=2`, through `GdalEngine::run_managed`.
- A test pins the build script's revision.

**`services/lidar/engine.rs`** (609 lines)
- Bounded process runner: fixed argv, no shell.
- Limits: `DEFAULT_PROCESS_TIMEOUT` of 600 s, 2 MiB output cap, 50 ms cancel poll.
- Kills and reaps on cancel. Logs go to `engine-logs/`.

**`services/lidar/catalogue.rs`** (1564 lines)
- `CATALOGUE_VERSION = 20`; `open` refuses any other version.
- Holds the schema (below), row types and queries.

**`services/lidar/presentation.rs`** (297 lines)
- Builds `LidarLibrarySnapshot`: one summary per layer and one per definition.
- For a definition:
  - `state` comes from the head or the latest job;
  - `slope_unit` from the parameters;
  - `method` from `SlopeRecipe`;
  - `engine_version` from the result manifest.
- `parse_analysis_kind` (:287) maps `"slope"`.

**`services/lidar/inspection.rs`** (573 lines)
- Native pixel read. For analyses it uses `result_units(manifest.parameters.slope_unit)` (`°` or `%`).

**`services/lidar/display_cog.rs`** (1264 lines)
- Display derivatives, profile `display-cog-deflate256-v1`.
- Results are read in chunk parts of at most 8×8 chunks, with the -2^127 sentinel.
- Kind-agnostic except for test fixtures.

**`services/lidar/generation.rs`** (1366 lines)
- `CHUNK_SIDE = 1024`, `RESULT_ROLE`/`QUALITY_ROLE`.
- `resolve_window`, `occupied_chunks`, `CollectionReader`.
- `GenerationReader` (source vs result chunks), `chunk_grid`, `window_grid`, `RegionAggregate`.

**`services/lidar/admission.rs`** (349 lines)
- Limits: 2 GiB per file, 24 files, 2 GiB per import.
- `MAX_IMPORT_PROCESSING_CELLS = 400_000_000`.

**`services/lidar/paths.rs`** (264 lines)
- `SLOPE_SCRATCH_PREFIX = "scratch-slope-"`, `slope_scratch_dir(job)`, display dirs, `require_free_space`.

**Other `services/lidar/` files**
- `import.rs` (3647 lines), `collection.rs` (collection resolver), `prepared_raster.rs` (`wbgeotiff` reader).
- `raster_assets.rs`: content-addressed COG assets (`write_cog_asset`, `admit_staged_cog`).
- `engine.rs` (`RasterEngine::probe`), `grid.rs`, `rust_engine/`.

**`native_command_policy.rs`**
- The sync allowlist, the state-access allowlist, and the rule that every command has an `invoke` call site.

**Catalogue v20 tables** (`catalogue.rs:99-301`). The four marked (analysis) are the ones this plan replaces.
- Meta and sources:
  - `lidar_catalogue_meta`
  - `lidar_sources` (sha256 originals)
  - `lidar_interpretations` (measurement kind, units, CRS WKT, nodata, geotransform, valid cells, range)
- Layers:
  - `lidar_source_layers(id, name, measurement_kind, units, created_at)`
  - `lidar_layer_generations` (manifest, coverage, min/max, display range and basis, bounds_3857)
  - `lidar_layer_heads`, `lidar_collection_members`, `lidar_layer_lattices`
  - `lidar_import_jobs` (plus `request_json`)
- Analysis:
  - (analysis) `lidar_analysis_definitions(id, layer_id, kind, version, parameters_json, created_at)`
  - (analysis) `lidar_analysis_generations(id, definition_id, source_generation_id, engine_version, state, manifest_json, coverage_cells, min/max, bounds_3857, published_at, name, method_id, recipe_version)`
  - `lidar_analysis_heads`
  - (analysis) `lidar_analysis_jobs(id, definition_id, source_generation_id, state, message, created_at, updated_at)`
  - (analysis) `lidar_dependencies(definition_id, layer_id, kind)`
- Storage:
  - `lidar_raster_assets`, `lidar_interpretation_cogs`
  - `lidar_generation_chunks(generation_id, role, chunk_x, chunk_y, asset_sha256, valid_cells, min, max, sum, state)`

**Today's result record** is a definition row, plus a generation row, plus a `ResultManifest` in `manifest_json`:

```
{definition_id, kind:"slope", source_generation_id, parameters:{slope_unit,name}, engine_version, grid, crs_wkt, created_at}
```

About half of the provenance is already there (input generation, engine version, method/recipe). It is typed only for slope, and it has no tool ids, no input keys and no history.

### 1.2 common-types (`common-types/src/lidar.rs`, 510 lines)

- Kinds and units: `LidarMeasurementKind` (4 source kinds), `LidarAnalysisKind {Slope}`, `LidarSlopeUnit`, `LidarUnitDeclaration`.
- States and jobs: `LidarResultState`, the import job and progress types.
- Summaries and snapshot:
  - `LidarEngineStatus`, `LidarLayerSummary`, `LidarDisplayRange` (and its basis).
  - `LidarAnalysisSummary`, with a required `slope_unit`, plus `method`, `engine_version` and `input_generation_id`.
  - `LidarAnalysisMethod {GeolibreProjectedSlopeV1}`.
  - `LidarLibrarySnapshot {layers, analyses, engine, slope_engine}`.
- Requests and receipts: collection, delete-impact and receipt types; `LidarAnalysisParameters {slope_unit, name}`; sample request/outcome; display request, descriptor, asset and state.
- The `.canopi` presentation section:
  - `LidarPresentationSection {schema_version, entries: [LidarPresentationEntry {kind: Source|Analysis, id, visible, opacity, order, style}]}`, with `LIDAR_PRESENTATION_SCHEMA_VERSION = 1`.
  - It is the field `CanopiFile.lidar` in `design.rs:256`; `CURRENT_CANOPI_FILE_VERSION = 7`.

These are registered for TS in `bindings-gen/src/contracts.rs:28+` and generated into `desktop/web/src/generated/contracts.ts:177-550`.

### 1.3 Frontend (`desktop/web/src`)

**Library state (`app/lidar/`)**
- `library-store.ts`:
  - snapshot signal, polled every 1.5 s;
  - `readLidarPresentation` joins the Design's entries with the library into `LidarPresentationItem {kind, id, name, detail, slopeUnit, state, visible, opacity, order, bounds, generationId, displayRange}`;
  - `analysisName` returns `"<source> · <kind>"`.
- `library-items.ts`:
  - `LibraryItem.type: LidarMeasurementKind | 'Slope'`, with a `'slope'` filter;
  - `slopeIneligibility` (:141-153) mirrors the Rust eligibility check using a metre regex.
- `actions.ts`: `calculateSlope` (:185, sends `'Slope'`), `settleSlopeAttachments` (:208), `retryFailedCalculation`, `cancelAnalysisJob`.
- `workflow.ts`: `installLidarWorkflow` (settle effect plus polling). `library-navigation.ts`: `calculateSlopeInLibrary`.

**Display, legend and inspection**
- `app/lidar/display.ts`:
  - `lidarDisplayStyle` (:154): any `Analysis` gets magma reversed over `[0,60°]` or `[0,173.2%]`; ground and surface elevation get terrain; everything else gets viridis.
  - `lidarDisplayLayers` (:175).
- `display-legend.ts`: RAMPS for terrain, viridis and magma; `°` and `%` are special-cased.
- `app/lidar/inspection.ts`: native readout. The units come from `LidarSampleOutcome::Value.units`.
- `app/design-edit/lidar.ts`: Design Edit for the entries. It holds a hand copy of schema version 1.

**Components (`components/panels/lidar/`)**
- `DataLibraryPanel.tsx` (667 lines), which contains `CalculateSlopeForm` (:617), the `INELIGIBLE` table (:604) and `methodLabel` (:451).
- `LibraryPreview.tsx`.
- `LidarLayersSection.tsx` ("Calculate slope" at :177).

**Map**
- Raster display: `maplibre/raster-display/{adapter,pool,worker,protocol}.ts`.
  - The cog-tiler colormaps include `blues`, `gray`, `terrain`, `viridis` and `magma`.
  - `RasterRenderOptions` already has `stretch: linear|sqrt|log`.
- Band composition:
  1. `app/canvas-map-surface/desktop-workspace-map-contribution-adapter.ts:29-33`
  2. `workspace-map-contributions.ts:55,157,280`
  3. `app/map-layers/bands.ts` (the lidar band is band 1)
- Web: `browser-workspace-map-contribution-adapter.ts:21` sets `lidar: []`; the boundary script is `scripts/check-web-build-boundaries.mjs`.

**i18n**
- 11 locales. The slope keys are under `canvas.lidar.library.*`.
- Named for slope: `typeSlope`, `calculateSlope`, `calculateTitle`, `slopeNeedsSource`/`slopeNeedsGround`/`slopeNeedsMetres`, `slopeEngineMissing`, `methodGeolibre`, `unitDegrees`, `unitPercent`.
- Generic-sounding but slope-only: `calculateFrom`, `resultName`, `calculateAttachNote`, `calculateLibraryNote`, `calculating`, `run`, `methodUnknown`, `factMethod`/`factInput`/`factEngine`/`factResults`.

### 1.4 Every place slope is hard-coded

**Rust**
- `common-types/src/lidar.rs`: `LidarAnalysisKind::Slope`, `LidarSlopeUnit`, `LidarAnalysisSummary.slope_unit`, `LidarAnalysisMethod::GeolibreProjectedSlopeV1`, `LidarLibrarySnapshot.slope_engine`, `LidarAnalysisParameters.slope_unit`.
- `commands/lidar.rs`: the create signature.
- `mod.rs`:
  - :58 field doc
  - :320-353 `prune_slope_scratch`
  - :466-480 `slope_engine`
  - :1297-1374 `run_slope_job`
  - :1400 recipe; :1412 params
  - :1471-1499 messages such as "calculate a new slope"
- `analysis.rs`: everything from :19 to :800, including `capability`.
- `presentation.rs`: :18, :121-168, :287.
- `inspection.rs`: :21-38, :121.
- `paths.rs`: :17-18, :94-96.
- `geolibre.rs`: the `slope` function and the "slope engine" messages.
- Fixtures: `display_cog.rs:1106-1133`, `mod.rs:1651-1662`.

**TS (non-test)**
- `generated/contracts.ts`.
- `app/lidar/`:
  - `library-items.ts`: :7, :21-22, :29, :44, :46, :77-91, :123, :141-153
  - `actions.ts`: :6, :178-220
  - `workflow.ts`: :3, :12, :25
  - `library-navigation.ts`: :20-28
  - `display.ts`: :142-162
  - `library-store.ts`: :126, :161, :177, :200, :214, :238
  - `display-legend.ts`: :21 (implicit)
- `components/panels/lidar/`:
  - `DataLibraryPanel.tsx`: :5, :22, :26, :34, :63, :79, :89-95, :158, :239, :325-336, :362, :452, :490, :522, :604-666
  - `LidarLayersSection.tsx`: :12, :119, :177-181
  - `LibraryPreview.tsx`: :54

**Tests:** `lidar-actions`, `lidar-data-library-panel`, `lidar-library-items`, `lidar-display`, `lidar-layers-section`, `canvas-icon-buttons`.

---

## 2. Hydrology through GeoLibre

### 2.1 Where the tools are

**Location**
- None of these tools are in `crates/geolibre-*`.
- They come from `wbtools_oss`, a git dependency on `opengeos/whitebox-wasm` @ `9c0ff4fdf351` (`geolibre-rust/Cargo.lock:3697-3720`).
- `geolibre-cli/src/main.rs:40 build_registry()` registers them (`register_default_tools` plus `geolibre_tools::geolibre_tools()`).

**CLI grammar** (`main.rs:321-460`)
- Commands: `list`, `manifests` (JSON), `manifest <id>`, `version` (prints `geolibre-cli 1.5.3`).
- Tools run as `<tool_id> --k=v ...`; values are inferred as bool, i64, f64 or string.
- Exit codes: 0 ok, 1 tool error (message on stderr), 2 usage error.

**Output and progress**
- The last stdout line is an outputs JSON (`{"path":"..."}`).
- Earlier lines are free-text `info` messages.
- Percent progress is compiled out (`EMIT_PROGRESS=false`, `main.rs:466`).

**Cancellation**
- There is no cancellation API: `ToolContext` has only progress and capabilities.
- Cancel means kill, which Canopi's runner already does.
- Outputs are written directly to the target path, so keep writing to scratch and publishing afterwards.

### 2.2 Tools at the pinned revision

All of these are present, and HEAD equals the pin. \* = required parameter.

**Conditioning, routing and accumulation**
- **Breach:** `breach_depressions_least_cost`
  - Parameters: `dem`\*, `output`, `max_dist` (integer, **cells**, default 100), `fill_deps` (false), `max_cost`, `flat_increment`, `minimize_dist`.
  - Output: Float64 raster. Global.
- **Fill:** `fill_depressions`
  - Parameters: `dem`\*, `output`, `fix_flats` (true), `flat_increment` (1e-4), `flat_resolution` (`garbrecht_martz` or `natural`), `max_depth`.
  - Output: Float64. Global.
- **D8 pointer:** `d8_pointer`
  - Parameters: `dem`\*, `output`, `esri_pntr` (false).
  - Output: Int16, NoData -32768, values 0..128. Mostly global.
- **Accumulation:** `d8_flow_accum`
  - Parameters: `input`\*, `input_is_pointer`, `out_type` (`cells`, `ca` or `sca`; default `sca`), `log_transform`, `output`.
  - Output: Float32, NoData -32768. Global.

**Streams**
- **Extract streams:** `extract_streams`
  - Parameters: `flow_accumulation`\*, `threshold` (same units as the accumulation raster; default 0), `zero_background` (false), `output`.
  - Output: Int16. Local on the accumulation raster.
- **Stream order:** `strahler_stream_order`
  - Parameters: `d8_pntr`\*, `streams`\*, `zero_background`, `output`.
  - Output: Int32. Global.
- **Streams to lines:** `raster_streams_to_vector`
  - Parameters: `d8_pntr`\*, `streams_raster`\*, `all_vertices`, `output` (line vector).
  - Output: lines with `FID` and `STRM_VAL`. Global.

**Catchments**
- **Snap outlets:** `snap_pour_points`
  - Parameters: `flow_accum`\*, `pour_pts`\* (point vector), `snap_dist` (**map units**; 0 means one cell), `output`.
  - Output: points. Local.
- **Watershed:** `watershed`
  - Parameters: `d8_pntr`\*, `pour_pts`\*, `output`.
  - Output: Int32, NoData -32768. Global.
- **Raster to polygons:** `raster_to_vector_polygons`
  - Parameters: `input`\*, `output`.
  - Output: polygons with `FID` and `VALUE`. Global.

**Wetness and ponding**
- **Wetness index (TWI):** `wetness_index`
  - Parameters: `sca`\*, `slope`\* (**degrees**), `output`.
  - Output: Float32, NoData -32768. Local on its inputs.
- **Ponding depth:** `depth_in_sink`
  - Parameters: `dem`\*, `zero_background` (false), `output`.
  - Output: raster in metres. Global.

**Later candidates**
- **Height above stream (HAND):** `elevation_above_stream` (`dem`\*, `streams`\*, `output`); raster in metres; global.
- **Flow length:** `downslope_flowpath_length` and `max_upslope_flowpath_length`; rasters; global. In testing, `downslope_flowpath_length` rejected pointers from a DEM with NoData corners, so defer it.
- **Basins:** `basins`, `subbasins`, `isobasins` (`d8_pntr`\*, plus `streams` for subbasins); Int32; global.

**Terrain entries**
- **Slope (used today):** `slope`
  - Parameters: `input`\*, `units` (`degrees`, `radians` or `percent`), `z_factor`.
  - Output: Float32, NoData -9999. 5×5 local stencil, windowed.
- **Hillshade:** `hillshade` / `multidirectional_hillshade`
  - Parameters: `input`\*, `z_factor`, `altitude` (30), `azimuth` (315); the multidirectional tool adds `full_360_mode`.
  - Output: Float32 with values up to about 32 684, not 0–255. Local; halo to be verified.
- **Contours:** `contours_from_raster`
  - Parameters: `input`\*, `output`\*, `interval` (10), `base` (0), `smooth` (9, odd), `tolerance` (10°).
  - Output: lines with `HEIGHT`. Vector; run it in the global lane.

**Vector formats and CRS**
- The vector writer picks the format from the file extension; `.geojson`, `.gpkg` and `.shp` were verified.
- GeoJSON output is written in WGS84 lon/lat, even when the input raster is Lambert-93.
- GeoJSON pour points are read as WGS84 and reprojected to the raster CRS. GeoJSON with projected coordinates fails with "latitude out of range".
- This matches principle 2 exactly: Canopi stores and exchanges vectors in lon/lat.

**Measured on a 3000×3000 Float32 DEM**

| Tool | Time | Peak memory |
|---|---|---|
| breach with fill | 4.3 s | 473 MB (about 50 B/cell) |
| fill | 5.0 s | 393 MB |
| `d8_flow_accum` from the DEM | 3.3 s | 358 MB |
| `d8_pointer` | 2.3 s | 225 MB |
| `slope` | 3.3 s | 258 MB |

Outputs are tiled 512×512. Breach and fill outputs are Float64.

### 2.3 Lane recommendation

**Use the GeoLibre CLI sidecar for every entry**
- Two modes: windowed (slope, hillshade) and the new global mode (contours, hydrology).
- One binary, one pin (`GEOLIBRE_REVISION`), one discovery path, one provenance string, one bounded runner, kill on cancel.

**Not Whitebox WASM**
- `geolibre-wasm` exports no hydrology; its `analysis.rs` has only `convex_hull` and `morans_i`.
- The WASI CLI path would run raster engines in the WebView.
- It is bounded by wasm32 memory (about 4 GiB), while global rasters need about 50 B/cell.
- It duplicates the native lane.
- The Web edition has no library to analyse anyway.

**Threads and priority**
- Keep `RAYON_NUM_THREADS=2`; it still bounds slope.
- For global tools, accept that they use all cores. The library-wide heavy lease means only one such job runs at a time.
- Start the child at below-normal priority: `setpriority` in `pre_exec` on Unix, `BELOW_NORMAL_PRIORITY_CLASS` on Windows.
- Upstream issue: make `wbtools_oss` hydrology respect `RAYON_NUM_THREADS` or accept a `--threads` flag.

**Licences**
- geolibre-rust: MIT (Qiusheng Wu).
- whitebox-wasm crates: MIT OR Apache-2.0 (Lindsay / Whitebox Geospatial), except `wbspatialstats`, which is AGPL-3.0-or-later and linked into the CLI.
- Actions:
  - Fix `THIRD_PARTY_NOTICES.md` and `third-party-notices.test.ts`.
  - Offer the sidecar's Corresponding Source.
  - Upstream issue: put `wbspatialstats` behind a feature so a hydrology-only CLI build is MIT/Apache.

---

## 3. Design

### 3.1 Registry: authored JSON contract, generated Rust and TS, handwritten executors

This follows the `plant-filter-fields.json` pattern: `bindings-gen/src/plant_filter.rs` renders TS and Rust, driven by `npm run gen:types` and `check:types`.

- **Authored:** `common-types/analysis-registry.json`. It holds ids, versions, inputs, params, outputs, lane and i18n keys. It says *what* an analysis is; the argv it runs stays in Rust.
- **Generated:**
  - Rust: `desktop/src/services/lidar/analysis_registry_generated.rs`, a static `&[AnalysisDefinition]`.
  - TS: `desktop/web/src/generated/analysis-registry.ts`, a typed const array.
  - New renderer: `bindings-gen/src/analysis_registry.rs`.
- **Rust executors:**
  - Files: `services/lidar/analyses/{mod.rs, windowed.rs, global.rs, terrain.rs, hydrology.rs}`.
  - `mod.rs` holds `fn executor(id) -> Option<&'static dyn AnalysisExecutor>`.
  - A test asserts a one-to-one match between registry entries and executors: no entry without an executor, no executor without an entry.

Registry types (Rust names; TS mirrors them through generation):

```rust
pub struct AnalysisDefinition {
    pub id: &'static str,              // "terrain.slope", "hydrology.water-flow"
    pub version: u32,                  // recipe version; bump when the method changes
    pub group: AnalysisGroup,          // Terrain | Water | Vegetation
    pub title_key: &'static str,       // "analyses.terrain.slope.title"
    pub summary_key: &'static str,
    pub lane: AnalysisLane,            // GeolibreWindowed { halo: u32 } | GeolibreGlobal
    pub inputs: &'static [AnalysisInputSpec],
    pub params: &'static [AnalysisParamSpec],
    pub outputs: &'static [AnalysisOutputSpec],
}
pub struct AnalysisInputSpec {
    pub key: &'static str,             // "dem"
    pub accepts: &'static [ItemTypePattern],   // Raster{GroundElevation}
    pub requires: &'static [GridRequirement],  // ProjectedMetreGrid, MetreValues
}
pub enum AnalysisParamType {
    Choice { options: &'static [&'static str] },
    Number { min: f64, max: f64, step: f64, unit: ParamUnit }, // Metre | SquareMetre | Degree
    Integer { min: i64, max: i64 },
    Boolean,
    Points { min: u32, max: u32 },     // lon/lat picked on the map
}
pub struct AnalysisParamSpec {
    pub key: &'static str, pub label_key: &'static str,
    pub kind: AnalysisParamType,
    pub default: ParamDefault,         // None (user must choose) or a typed value
    pub advanced: bool,                // shown in a disclosure
    pub visible_when: Option<(&'static str, &'static str)>,
}
pub struct AnalysisOutputSpec {
    pub key: &'static str,
    pub item: ItemType,                // Raster{UpslopeArea} | Vector{Streams}
    pub units: OutputUnits,            // Fixed("m²") | ByParam { param, map }
    pub optional: bool,
    pub default_selected: bool,
    pub presentable: bool,             // false = kept only for provenance/other analyses
}
pub enum AnalysisLane { GeolibreWindowed { halo: u32 }, GeolibreGlobal }
```

- Only lanes that have entries exist. There are no `WhiteboxWasm` or `Native` variants until Computree lands (delete, don't deprecate).
- The Rust executor converts to tool units (for example metres to cells for `max_dist`). Users only ever see metres, m² and degrees.

Example entries (abridged):

```json
{ "id": "terrain.slope", "version": 1, "group": "terrain", "lane": { "geolibre_windowed": { "halo": 2 } },
  "inputs": [{ "key": "dem", "accepts": [{ "raster": "ground-elevation" }], "requires": ["projected-metre-grid", "metre-values"] }],
  "params": [{ "key": "unit", "kind": { "choice": ["degrees", "percent"] }, "default": null }],
  "outputs": [{ "key": "slope", "item": { "raster": "slope" }, "units": { "by_param": { "param": "unit", "map": { "degrees": "°", "percent": "%" } } }, "presentable": true }] }

{ "id": "hydrology.water-flow", "version": 1, "group": "water", "lane": "geolibre_global",
  "inputs": [{ "key": "dem", "accepts": [{ "raster": "ground-elevation" }], "requires": ["projected-metre-grid", "metre-values"] }],
  "params": [
    { "key": "depressions", "kind": { "choice": ["breach", "fill"] }, "default": "breach" },
    { "key": "max_breach_m", "kind": { "number": { "min": 1, "max": 1000, "step": 1, "unit": "metre" } }, "default": 50, "advanced": true, "visible_when": ["depressions", "breach"] },
    { "key": "stream_area_m2", "kind": { "number": { "min": 100, "max": 10000000, "step": 100, "unit": "square-metre" } }, "default": 10000 } ],
  "outputs": [
    { "key": "upslope_area", "item": { "raster": "upslope-area" }, "units": "m²", "optional": true, "default_selected": true, "presentable": true },
    { "key": "streams", "item": { "vector": "streams" }, "units": "", "optional": true, "default_selected": true, "presentable": true },
    { "key": "wetness", "item": { "raster": "wetness-index" }, "units": "", "optional": true, "default_selected": false, "presentable": true },
    { "key": "ponding", "item": { "raster": "sink-depth" }, "units": "m", "optional": true, "default_selected": false, "presentable": true } ] }
```

- **Planned entries:** `terrain.slope`, `terrain.hillshade`, `terrain.contours`, `hydrology.water-flow`, `hydrology.catchment`.
- **Later candidates:** `hydrology.height-above-stream` (`elevation_above_stream`), `hydrology.flow-length`, `hydrology.subbasins`, and `vegetation.*` (Computree, `canopi-5ys2.2`).

### 3.2 Typed library items (common-types)

A new module, `common-types/src/library.rs`. `lidar.rs` keeps the raster transport types (samples, display descriptors, presentation section).

```rust
pub enum RasterQuantity {            // replaces LidarMeasurementKind
    GroundElevation, SurfaceElevation, AboveGroundHeight, OtherContinuous, // importable
    Slope, Hillshade, UpslopeArea, WetnessIndex, SinkDepth,                // derived only
}
pub enum VectorFeature { Streams, Catchments, Contours }
#[serde(tag = "kind")]
pub enum LibraryItemType {
    Raster { quantity: RasterQuantity },
    Vector { feature: VectorFeature, geometry: VectorGeometry }, // Line | Polygon | Point
    // PointCloud { .. } lands with canopi-5ys2.2
}
pub enum LibraryItemRole { Source, Derived }

pub struct LibraryItemSummary {
    pub id: String, pub name: Option<String>, pub role: LibraryItemRole,
    pub item_type: LibraryItemType, pub units: String,
    pub state: LidarResultState, pub generation_id: Option<String>,
    pub bounds: Option<[f64; 4]>, pub value_range: Option<[f64; 2]>,
    pub display_range: Option<LidarDisplayRange>, pub resolution_m: Option<f64>,
    pub coverage_cells: Option<u64>, pub feature_count: Option<u64>,
    pub import_job: Option<LidarImportJob>,        // sources
    pub provenance: Option<Provenance>,            // derived
    pub freshness: Freshness,                      // Current for sources
    pub run: Option<AnalysisRunStatus>,            // latest job state + message
    pub offers: Vec<AnalysisOffer>,                // analyses this item can feed, or why not
    pub dependents: u32,
}
pub struct Provenance {
    pub definition_id: String, pub analysis_id: String, pub recipe_version: u32,
    pub output_key: String,
    pub inputs: Vec<ProvenanceInput>,        // { key, item_id, generation_id }
    pub parameters: Vec<AnalysisParamValue>, // { key, value: ParamValue }
    pub tool: ToolProvenance,                // { engine, version, revision, tools: [...] }
    pub job_id: String, pub created_at: String,
}
pub enum ParamValue { Number(f64), Integer(i64), Boolean(bool), Choice(String), Points(Vec<[f64; 2]>) }
pub enum Freshness { Current, Stale { reasons: Vec<StaleReason> } }
pub enum StaleReason {
    InputUpdated { input_key: String, item_id: String },
    InputStale { input_key: String, item_id: String },   // transitive
    RecipeUpdated { from: u32, to: u32 },
    ToolUpdated { from: String, to: String },
}
pub struct AnalysisOffer { pub analysis_id: String, pub available: bool, pub reason: Option<AnalysisUnavailable> }
pub enum AnalysisUnavailable {
    WrongInput { expected: ItemTypePattern },   // needs ground elevation / a point cloud
    NotReady, ValuesNotMetres, GridNotProjectedMetres,
    ExtentTooLarge { cells: u64, limit: u64 },
    EngineMissing { detail: String },
}
pub struct LibrarySnapshot { pub items: Vec<LibraryItemSummary>, pub engines: EngineStatuses }
```

**Deleted in the same change**
- Contract types: `LidarAnalysisKind`, `LidarSlopeUnit`, `LidarAnalysisMethod`, `LidarAnalysisSummary`, `LidarLayerSummary`, `LidarAnalysisParameters`, and `LidarLibrarySnapshot.slope_engine`.
- `LidarMeasurementKind`: import now takes `RasterQuantity` and refuses non-importable quantities by name.
- Rust helpers: `SlopeRecipe`, `analysis::capability`, `inspection::result_units`.
- `slope_scratch_dir` becomes `analysis_scratch_dir`, with prefix `scratch-analysis-`.
- `LidarSampleEntityKind` and `LidarDisplayRequest.kind` become `{Source, Derived}`.

**Where each unavailable reason is computed**
- The frontend adds "needs Desktop" (Web edition) and "already in Layers" (Design references), §3.5.
- Everything that needs the catalogue, raster probe facts or the engine is computed natively into `offers`. That gives eligibility one authority (Rust) and deletes `slopeIneligibility`.

**Grid facts without a raster read in the poll path**
- `slope_eligibility` probes the raster at job time, but offers are computed on every 1.5 s poll.
- So import records two facts on the generation: `crs_class` (`projected-metre`, `projected-other`, `geographic` or `unknown`) and extent cells.
- Offers read those columns. The job still rechecks with the raster engine, which stays authoritative.

### 3.3 Catalogue v21 (no migration)

- Set `CATALOGUE_VERSION = 21`.
- `discard_unsupported_library` deletes v20 libraries (existing behaviour, ADR 0003).
- Existing Design references become "unavailable" rows, as today.
- Lower-churn target: keep the source tables (the import code is 3.6k lines) and generalise the analysis side.

```sql
-- sources: item typing and grid facts
lidar_source_layers(id, name, item_kind TEXT NOT NULL CHECK (item_kind IN ('raster')),
                    quantity TEXT NOT NULL, units TEXT NOT NULL, created_at)
lidar_layer_generations(... existing ..., crs_class TEXT NOT NULL, extent_cells INTEGER NOT NULL)

lidar_analysis_definitions(id PK, analysis_id TEXT NOT NULL, parameters_json TEXT NOT NULL,
                           outputs_json TEXT NOT NULL, created_at TEXT NOT NULL)
lidar_analysis_inputs(definition_id REFERENCES lidar_analysis_definitions(id),
                      input_key TEXT NOT NULL, item_id TEXT NOT NULL,
                      PRIMARY KEY (definition_id, input_key))
CREATE INDEX idx_analysis_inputs_item ON lidar_analysis_inputs(item_id);

lidar_derived_items(id PK, definition_id REFERENCES lidar_analysis_definitions(id),
                    output_key TEXT NOT NULL, item_kind TEXT NOT NULL CHECK (item_kind IN ('raster','vector')),
                    quantity TEXT, feature TEXT, units TEXT NOT NULL, name TEXT, created_at TEXT NOT NULL,
                    UNIQUE (definition_id, output_key),
                    CHECK ((item_kind = 'raster') = (quantity IS NOT NULL)),
                    CHECK ((item_kind = 'vector') = (feature IS NOT NULL)))

lidar_analysis_jobs(id PK, definition_id, state, message, recipe_version INTEGER NOT NULL,
                    input_generations_json TEXT NOT NULL, tool_provenance TEXT,
                    created_at, started_at, finished_at, updated_at)

lidar_derived_generations(id PK, item_id REFERENCES lidar_derived_items(id), job_id REFERENCES lidar_analysis_jobs(id),
                          manifest_json TEXT NOT NULL, coverage_cells INTEGER, feature_count INTEGER,
                          min_value REAL, max_value REAL, bounds_3857 TEXT NOT NULL, published_at TEXT NOT NULL)
lidar_derived_heads(item_id PK REFERENCES lidar_derived_items(id), generation_id REFERENCES lidar_derived_generations(id))

lidar_vector_assets(sha256 PK, rel_path TEXT NOT NULL, bytes INTEGER NOT NULL, feature_count INTEGER NOT NULL,
                    geometry TEXT NOT NULL, bounds_wgs84 TEXT NOT NULL, created_at TEXT NOT NULL)
lidar_generation_vectors(generation_id PK, asset_sha256 REFERENCES lidar_vector_assets(sha256))
```

**Dropped**
- Tables: `lidar_analysis_generations`, `lidar_analysis_heads`, and `lidar_dependencies` (replaced by `lidar_analysis_inputs`).
- Per-generation columns `method_id`, `recipe_version`, `engine_version` and `name`. Provenance moves to the job and the name to the item.

**Kept or changed**
- Raster chunks stay in `lidar_generation_chunks`; `generation_id` is now the derived generation id.
- Id prefixes: `lyr-` sources, `item-` derived items, `adef-` definitions, `anl-` jobs, `dgen-` generations.
- The result manifest becomes `{item_id, output_key, grid, crs_wkt, storage: "chunks"|"vector"}`. It holds only what sampling needs; provenance lives in the tables, not duplicated in JSON.

**`.canopi`**
- No format change is needed for parts a–c.
- `LidarPresentationEntry.kind` keeps `Source | Analysis`; an `Analysis` id is now a derived item id. Old ids disappear with the old catalogue anyway.
- Rename `Analysis` to `Derived` only when views and stories bump the file version (same ADR). Doing both in one bump avoids two format versions.

### 3.4 Execution

**Create**
- Command: `lidar_create_analysis(request: AnalysisRequest) -> AnalysisReceipt {definition_id, job_id, item_ids}`, on the `UserData` executor.
- Request shape: `AnalysisRequest {analysis_id, inputs: [{key, item_id}], parameters: [AnalysisParamValue], outputs: [String], name: Option<String>}`.
- Steps:
  1. Look the analysis up in the registry.
  2. `registry::validate`:
     - types, ranges, choices and required fields;
     - points inside the input's bounds;
     - at least one output selected;
     - inputs match `accepts`.
  3. Recheck the offer (engine present, grid facts, extent).
  4. In one transaction, insert the definition, its inputs, the derived items (units resolved from `OutputUnits`) and a job pinned to the current input heads.
  5. Spawn `run_analysis`.

**Run**
- `run_analysis` is generic and replaces `run_slope_job`:
  1. Wait for the heavy lease.
  2. On the `Local` executor, call `executor(analysis_id).run(ctx)`.
     - `ctx` provides the pinned inputs, parsed params, scratch dir `prepared/scratch-analysis-<job>`, cancel flag and engine.
     - It returns one `StagedOutput` per output key: raster chunk rows or a vector asset.
  3. Publish in one `BEGIN IMMEDIATE` transaction:
     - check that the job is still preparing, each input's head still equals its pinned generation, and the definition still exists;
     - insert every output's generation, publish the chunks and **upsert** the heads;
     - record `tool_provenance` and `finished_at`, and complete the job;
     - delete the superseded generations' chunk and vector rows (the existing unreferenced-asset sweep removes the files).
- All outputs publish, or none do.

**Windowed lane** (`analyses/windowed.rs`)
- Generalises today's `compute_slope_block` over `(tool_id, args, halo, output_nodata_rule, quality: StencilValid | None)`.
- Slope keeps its 5×5 stencil (halo 2) and its quality mask.
- Hillshade gets halo 1, but only after an acceptance test proves its stencil and NoData handling across a chunk seam. The model is the existing `geolibre_slope_matches_the_analytic_surface_across_a_chunk_seam`.

**Global lane** (`analyses/global.rs`)
1. **Admission** (`admission.rs`):
   - `MAX_GLOBAL_ANALYSIS_CELLS` is charged on the lattice extent (width × height), because the tool allocates the whole bounding box, not just valid cells.
   - Proposed limit: 25 000 000 cells (5000²). That is about 1.25 GB peak in the tool, 25 km² at 1 m, or 6.25 km² at 0.5 m.
   - Free space must cover about 40 B/cell of scratch plus the 256 MiB floor.
   - Over the limit, the job is refused by name, and the offer reports `ExtentTooLarge` before the user starts. This is a safety limit, not a performance claim.
2. **Materialise the input:**
   - For each occupied 1024² chunk, read it with `generation::resolve_window` (sources) or `GenerationChunkReader` (derived inputs).
   - Write its rows at their offsets in a pre-sized raw Float32 file (`pwrite`; never a whole-extent buffer in memory). Invalid cells get the -2^127 sentinel.
   - Convert with `raw_to_tif` and tag NoData.
   - Check cancel and free space between windows.
3. **Run the tool chain** through a generic `GeolibreEngine::run(tool_id, args, env)`, which replaces `slope()`:
   - one bounded child per step, below-normal priority;
   - make the deadline configurable per step instead of the fixed 600 s;
   - parse the final stdout JSON line to confirm each output path.
4. **Read raster results back** window by window, using the raster engine's windowed Float32 read (`RasterEngine::read_f32`, `prepared_raster.rs`):
   - Map the tool's NoData (per output) and any non-finite values to invalid.
   - Force invalid wherever the input cell was invalid.
   - Write chunk COGs only for occupied chunks.
   - Write no quality chunks. The details view shows a caveat that catchments crossing the item's edge are truncated.
5. **Vectors** (the tool writes WGS84 GeoJSON). Canonicalise in Rust within a bound:
   - At most 64 MiB and 200 000 features; otherwise refuse by name ("raise the stream area threshold").
   - Keep only whitelisted properties, renamed to a stable schema: streams `{order}`, catchments `{outlet, area_m2}`, contours `{elevation_m}`.
   - Round coordinates to 1e-7°.
   - Reject coordinates outside the item's WGS84 bounds plus a tolerance.
   - Hash the file and admit it to `assets/<sha256>/features.geojson`. Files first, then catalogue rows, as today.

**Recipes**
- **`terrain.slope@1`** (windowed): `slope --units=<degrees|percent> --z_factor=1`, halo 2. Same science as today, renumbered under the new id.
- **`terrain.hillshade@1`** (windowed): `hillshade --altitude --azimuth --z_factor=1` (or `multidirectional_hillshade`), halo 1 to be verified. Displayed in gray over its value range.
- **`terrain.contours@1`** (global, vector): `contours_from_raster --input=dem.tif --interval=<m, default 1> --base=0 --smooth=9 --tolerance=10 --output=contours.geojson`. `smooth` and `tolerance` are advanced parameters.
- **`hydrology.water-flow@1`** (global):
  1. Condition the DEM, using either:
     - `breach_depressions_least_cost --dem=dem.tif --output=cond.tif --max_dist=<ceil(max_breach_m/pixel)> --fill_deps=true`, or
     - `fill_depressions --dem=dem.tif --output=cond.tif --fix_flats=true`.
  2. `d8_pointer --dem=cond.tif --output=d8.tif`.
  3. `d8_flow_accum --input=d8.tif --input_is_pointer=true --out_type=ca --output=area.tif`, which gives upslope area in m².
  4. Streams:
     - `extract_streams --flow_accumulation=area.tif --threshold=<stream_area_m2> --output=streams.tif`
     - `strahler_stream_order --d8_pntr=d8.tif --streams=streams.tif --output=order.tif`
     - `raster_streams_to_vector --d8_pntr=d8.tif --streams_raster=order.tif --output=streams.geojson` (lines with `order`)
  5. Wetness (flat cells become invalid):
     - `d8_flow_accum --input=d8.tif --input_is_pointer=true --out_type=sca --output=sca.tif`
     - `slope --input=cond.tif --units=degrees --output=slope.tif`
     - `wetness_index --sca=sca.tif --slope=slope.tif --output=twi.tif`
  6. Ponding: `depth_in_sink --dem=dem.tif --zero_background=false --output=sink.tif`. Depth in metres; non-sink cells are NoData and draw as transparent.

  Only the selected outputs' steps run, and the tool ids that actually ran go into `ToolProvenance.tools`.
- **`hydrology.catchment@1`** (global, vector):
  - Input: `dem` (ground elevation).
  - Parameters:
    - `outlets`: `Points{1..16}`, lon/lat picked on the map.
    - `snap_m`: default 5.
    - The same `depressions` / `max_breach_m` as water flow; the dialog prefills them from an existing water-flow run on the same DEM.
  - Steps:
    1. Conditioning, then `d8_pointer`, then `d8_flow_accum --out_type=ca`.
    2. Write `outlets.geojson` in WGS84.
    3. `snap_pour_points --flow_accum=area.tif --pour_pts=outlets.geojson --snap_dist=<m> --output=snapped.geojson`.
    4. `watershed --d8_pntr=d8.tif --pour_pts=snapped.geojson --output=ws.tif`.
    5. `raster_to_vector_polygons --input=ws.tif --output=catchments.geojson`.
    6. `area_m2` = per-value cell counts × cell area.
  - Recomputing the pointer from the immutable DEM takes seconds. It avoids storing a flow-direction item and avoids a result-to-result chain in v1.

**Rerun and refresh**
- `lidar_rerun_analysis(definition_id) -> AnalysisReceipt` (`UserData`) replaces `lidar_retry_analysis`.
- Rules:
  - Refused while a job is preparing.
  - The stored parameters are revalidated against the current registry version. If they no longer validate: "settings no longer valid; run a new analysis".
  - Inputs are pinned to their current heads.
- One command covers both cases: Retry (no head yet) and Refresh (a head exists).
- Heads are upserted:
  - Designs keep the same item ids and show the new generation.
  - Display descriptor keys include the generation, so no stale URL is drawn.
  - Inspection returns `StaleGeneration` and re-aims, as today.
- "Run again with changes" is different: it opens the Analyze dialog prefilled from the provenance and creates a new definition with new items.

**Stale detection** (in the snapshot builder, catalogue reads only). For each derived head, compare with its job:
- `input_generations_json[key]` differs from the input item's current head → `InputUpdated`.
- `job.recipe_version` differs from the registry's version → `RecipeUpdated`.
- `job.tool_provenance` differs from the cached current discovery → `ToolUpdated` (a soft reason: new build of the same method).
- One topological pass then marks dependents of stale items as `InputStale`.

Sources are immutable, so in v2 `InputUpdated` only happens for derived inputs that were refreshed (chains, Computree) or after a GeoLibre version bump. The mechanism is generic and cheap.

**Processing history**
- `lidar_processing_history(definition_id, cursor) -> ProcessingHistoryPage`:
  - `runs`: a list of `ProcessingRun {job_id, state, message, recipe_version, tool, inputs, started_at, finished_at, outputs: [{item_id, generation_id, coverage_cells | feature_count}]}`;
  - `next_cursor`.
- `UserData` executor, bounded pages (for example 50 runs).
- The bytes of superseded generations are deleted at publish; there is no restore.
- This keeps ADR 0002's "no dataset history" for the data itself, while giving ADR 0011's processing history as a log of runs.

**Other commands**
- `lidar_rename_item` and `lidar_delete_item` replace the separate layer and analysis versions.
- Delete behaviour:
  - Refused while `lidar_analysis_inputs` references the item; the error gives the dependent count, as today.
  - Removes a derived item's generations and head.
  - Removes the definition when its last item is deleted.
- `lidar_delete_impact` is generalised to items.
- `lidar_cancel_analysis_job` stays on the sync allowlist.
- Every new command lands together with its `invoke` call site; removed commands go with their helpers (the policy test enforces both).
- Restart recovery and the startup sweeps switch from `scratch-slope-` to `scratch-analysis-`.

**Display and inspection (native)**
- `display_cog.rs` already reads result chunks generically; only its entity lookup moves to derived items.
- Vector items get a display descriptor too:
  - the asset is copied, staged and then renamed, into `$APPDATA/lidar/display-vector/<sha>.geojson`;
  - the Tauri asset scope gains exactly `$APPDATA/lidar/display-vector/*.geojson`.
- `inspection.rs` reports the derived item's stored `units`, and `result_units` is deleted. Vector items are not sampled natively.

### 3.5 Frontend

**Kind dispatch table** — new `app/lidar/item-types.ts`, the single place that knows about item types.
- Two tables:
  - `RASTER_QUANTITIES: Record<RasterQuantity, {labelKey, style(item)}>`
  - `VECTOR_FEATURES: Record<VectorFeature, {labelKey, layers(item)}>`
- Raster styles:
  - Ground and surface elevation: terrain over the display range.
  - Above-ground height and other continuous: viridis.
  - Slope: magma reversed over a fixed domain chosen by units (moved from `display.ts:142-162`).
  - Hillshade: gray over the value range.
  - Upslope area: blues with `stretch: 'log'`, rescaled over `[cell area, max]`.
  - Wetness index: blues over the value range.
  - Sink depth: blues over `[0, max]` m.
- Vector styles:
  - Streams: line width interpolated by `order`.
  - Catchments: soft fill with an outline.
  - Contours: thin lines, every fifth emphasised, `elevation_m` labels.
- Colours come from theme tokens (the Field Atlas water blue), never raw rgba.
- These all dispatch through the table instead: `lidarDisplayStyle`, `LibraryItem.type`, the `'slope'` filter, `analysisName`, and the legend's `°`/`%` special case.
- `display-legend.ts` gains `blues` and `gray` ramps and a log-scale legend.

**Vector renderer** — new `maplibre/vector-results/adapter.ts`
- One owner per live map for the GeoJSON sources and layers of visible vector references.
- Created and synced from `workspace-map-contributions.ts`, next to `createRasterDisplay`.
- Its layer ids join the lidar band through `bands.ts`, and it is torn down with the map (resource-ownership rule).
- The contribution snapshot gains `lidarVectors`; Web stays `[]`.

**Inspection**
- Raster items keep the native read.
- Vector items read the feature under the pointer with `queryRenderedFeatures` on that item's layers, and show "Stream, order 3", "Catchment, 2.4 ha" or "Contour 132 m".
- `InspectionTarget` gains the item type.

**Analyze dialog** — `components/panels/analyze/AnalyzeDialog.tsx` plus `app/analyses/model.ts`.
- Entries:
  - come from `generated/analysis-registry.ts`;
  - are filtered to those whose `inputs[0].accepts` matches the selected item;
  - are grouped by Terrain and Water.
- Availability:
  - the native `item.offers`;
  - plus frontend reasons:
    - `NeedsDesktop` on Web;
    - `AlreadyInLayers` when the Design already references a derived item with the same analysis, inputs and parameters, shown with "Show in Layers" instead of Run;
    - if the duplicate is only in the library, "Add existing".
- Controls by parameter type:
  - `choice`: segmented control or radio.
  - `number`: field with a unit suffix, min/max/step, locale formatting via `Intl`.
  - `integer`.
  - `boolean`: checkbox.
  - `points`: "Pick on map" through the pointer-handler registry inspection already uses, shown as a removable list; Escape cancels.
- Layout rules:
  - `advanced` parameters go in a disclosure;
  - `visible_when` is honoured;
  - optional outputs are checkboxes;
  - the name field is suggested as `"<source> · <analysis>"`.
- TS validation mirrors the registry types for inline errors; Rust stays authoritative.

**Actions** (`app/lidar/actions.ts`)
- `calculateSlope` becomes `runAnalysis(request, attachToDesign)`.
- `retryFailedCalculation` becomes `rerunAnalysis(definitionId)`.
- `settleSlopeAttachments` becomes `settleResultAttachments`:
  - attaches every presentable output item of the requesting session's definition once it is published;
  - drops the request if the session changes or the run fails.
- `calculateSlopeInLibrary` becomes `analyzeInLibrary(itemId, analysisId?)`.
- Deleted: `slopeIneligibility`, `CalculateSlopeForm`, the `INELIGIBLE` table and `methodLabel`.

**Library and Layers**
- The type filter becomes All / Sources / Terrain / Water.
- Derived rows nest under their first input (`provenance.inputs[0].item_id`).
- An "Out of date: <reason>" badge with Refresh sits beside a stale item.
- Details show:
  - the provenance: analysis, method version, parameters with units, inputs by name, tool version and GeoLibre revision, creation date;
  - a "Processing history" disclosure that pages `lidar_processing_history`.
- Moving this into Layers is `canopi-h90p.2`; the seam only has to work in the current panels.

**i18n**
- New keys, in all 11 locales:
  - `analyses.<id>.{title,summary}`
  - `analyses.<id>.params.<key>.{label,help}`
  - `analyses.<id>.outputs.<key>`
  - `library.quantity.<q>`, `library.feature.<f>`
  - `analyses.unavailable.<reason>`, `analyses.stale.<reason>`
- The slope-only keys are deleted.
- A test checks that every registry i18n key exists in every locale.

### 3.6 Docs to rewrite in the same changes

- **`docs/guides/data-library.md`**:
  - "Calculate slope" becomes "Analyze": registry, offers, create, rerun, stale, history.
  - Storage: v21 tables, derived items, vector assets, pruning of superseded generations.
  - Scientific invariants:
    - slope recipe renumbered;
    - global lane admission and materialisation;
    - hydrology NoData handling and the edge caveat.
  - Map display: vector descriptors, asset scope, styles by quantity.
  - Native execution: new commands; global-lane threads and priority.
  - Frontend state; gates (new tests and ignored lanes).
- Replace "A published result is never recalculated in place" and "A slope job therefore has no stale or superseded outcome" with the refresh model. ADR 0002's "no … automatic analysis refresh" stays true, because refresh is explicit.
- Also update:
  - `docs/architecture.md`: registry boundary, new module.
  - `docs/guides/native-and-release.md`: command list, `Local` jobs.
  - `desktop/THIRD_PARTY_NOTICES.md`: licence fix.
  - `AGENTS.md` quality gates: registry generation and check.

---

## 4. Beads and order

**L. Correct the GeoLibre CLI licence notice** (AGPL-3.0-or-later `wbspatialstats`). Standalone, P1.
- Content:
  - `THIRD_PARTY_NOTICES.md` and `third-party-notices.test.ts`;
  - a release note for Corresponding Source;
  - an upstream issue to feature-gate the crate.
- Gates: frontend tests, docs.

**1. Registry contract, typed items and provenance (slope only).** Parent h90p.9.
- Rust and contracts:
  - `analysis-registry.json` and its bindings-gen renderer;
  - `common-types/src/library.rs` and catalogue v21;
  - generic create, run, rerun, history, rename and delete;
  - offers and stale detection;
  - the generalised windowed lane, with slope as `terrain.slope@1`.
- Frontend:
  - the kind table;
  - the generated Analyze dialog replacing `CalculateSlopeForm`;
  - the stale badge with Refresh, and history;
  - i18n.
- Docs.
- Gates: all Rust gates, native policy, shared contracts, frontend plus coverage, `check:ui` and both builds, docs, the `lidar-native` lane.

**2. Hillshade entry.** Parent h90p.9.
- Content: windowed `hillshade`, the seam acceptance test, gray style.
- Gates: Rust, frontend, lidar lane.

**3. Contours entry: global lane and vector items.** Parent h90p.9, or a new bead.
- Content:
  - materialisation and global admission;
  - the vector asset store and display descriptors;
  - the vector adapter and vector inspection.
- Gates: full set.

**4. Hydrology: water flow.** Parent 5ys2.1.
- Content:
  - the `hydrology.water-flow` recipe;
  - styles for upslope area, streams, wetness index and sink depth;
  - child priority.
- Gates: full set plus ignored lanes.

**5. Hydrology: catchment from outlets.** Parent 5ys2.1.
- Content: the `points` parameter with map picking, and `hydrology.catchment`.
- Gates: full set plus ignored lanes.

**U. Upstream issues** in geolibre-rust and whitebox-wasm (external, no gates):
- respect the thread cap in hydrology;
- feature-gate `wbspatialstats`;
- optional percent progress.

**F. Later follow-ups** under 5ys2.1: height above stream, flow length, subbasins.

Doing contours before hydrology keeps each review small. Bead 3 proves the global lane and the vector kind with a single tool; bead 4 is then only recipes and styles.

## 5. Tests (write first)

**Rust unit tests (no engine)**
- Registry:
  - registry ↔ executor one-to-one;
  - registry JSON validation: unique ids and keys, defaults within ranges, `visible_when` targets exist, well-formed i18n keys.
- `validate(request)` refusals by name:
  - unknown id, wrong input type;
  - out-of-range number, missing required choice;
  - points outside bounds, no outputs.
- Offers per item: ground vs surface elevation, geographic grid, non-metre units, extent over the limit, engine missing.
- Catalogue versions: a v20 library is deleted; a v22 catalogue is refused.
- Lifecycle:
  - create inserts the definition, inputs, items and pinned job in one transaction;
  - multi-output publish is atomic: cancelling after the first output publishes nothing and cleans scratch;
  - rerun upserts heads, prunes superseded chunks and keeps the job history.
- Stale reasons: input head moved, recipe bump, tool change, transitive.
- Delete is refused for items used as inputs.
- Restart recovery for `scratch-analysis-`.
- Vector canonicalisation: property whitelist, rounding, out-of-bounds refusal, size cap.
- Global lane:
  - admission refusal and free-space checks;
  - materialisation never allocates a whole-extent buffer (peak live bytes bounded, measured like the `prepared_raster` counters).

**Ignored `lidar-native` lane** (pinned CLI, analytic surfaces in Lambert-93)
- Slope unchanged across a seam; hillshade across a seam.
- Contours on a tilted plane:
  - straight and parallel lines;
  - spacing equals interval ÷ gradient;
  - WGS84 coordinates inside the bounds.
- Water flow:
  - V-shaped valley: the stream follows the valley floor, order increases downstream, and upslope area grows linearly along it.
  - Bowl: sink depth equals the analytic depth; fill and breach differ as expected.
  - TWI is finite on slopes and invalid on flats.
- Catchment: an outlet on a two-valley surface covers one valley, and `area_m2` equals cell count × cell area.
- Cancelling mid-chain kills the child and publishes nothing.
- The real-fixture e2e lane gains `e2e_water_flow_on_ign_mnt`.

**Frontend tests**
- The dialog generated from a registry fixture: every parameter type, advanced disclosure, `visible_when`, optional outputs.
- Unavailable reasons shown by name, including NeedsDesktop and AlreadyInLayers.
- Point picking, including the keyboard path and Escape.
- `runAnalysis`, `rerunAnalysis` and `settleResultAttachments` fenced to their Design session.
- Stale badge and Refresh.
- Kind-table styles and legends (log stretch, gray, blues).
- Vector adapter lifecycle: create, sync, teardown, HMR.
- Vector inspection readout.
- i18n completeness across 11 locales.
- The Web build boundary still excludes raster engines.

## 6. Risks and constraints

- **Memory:** the global lane is bounded by the extent cap, not by the tool. Keep the cap conservative, and name it in the offer so users crop or import fewer tiles.
- **Edge effects:** catchments and accumulation are truncated at the edge of the item's coverage. State this in the details view and the guide.
- **Disk:** Float64 intermediates double the scratch size, and admission counts them.
- **Tool quirks:**
  - Hillshade's scale (about 0–32 767) comes from the value range; do not assume 0–255.
  - `downslope_flowpath_length` fails with NoData corners and is excluded until reproduced upstream.
- **Timeouts:** 600 s per child is ample at the proposed cap (breach on 9M cells took 4.3 s). Still, make the deadline per step and scale it with cell count.
- **Stdout:** only the last line is JSON. Parse it defensively, and treat a missing output file as failure (the current slope rule).
- **Native policy test:** it fails on any new command without an `invoke` call site, or with state access outside the executor. Land each command with its TS caller.

## 7. Decisions for the user

1. **Lane:** use the GeoLibre CLI sidecar for hydrology instead of "bundled Whitebox WASM". That means editing bead `canopi-5ys2.1`, and optionally changing ADR 0011's lane list to "GeoLibre CLI or native".
2. **Licence:** either ship the AGPL-3.0-or-later component in the sidecar with a corrected notice and Corresponding Source, or pursue an upstream feature gate first.
3. **Extent cap** for the global lane: 25M cells is proposed.
4. **Refresh semantics:**
   - Option A: refresh updates the item in place. Every Design that references it sees the new result, the old bytes are deleted, and the run stays in history.
   - Option B: refresh creates a new sibling item instead.
5. **Catchment in v1:** it recomputes routing from the DEM, so there is no flow-direction item and no chain.
6. **Order:** hillshade and contours as h90p.9 follow-ups before hydrology, or fold contours into hydrology bead 4.