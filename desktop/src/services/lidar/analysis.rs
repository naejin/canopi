//! Analysis definitions, jobs and publication.
//!
//! Analyses operate on the source layer's complete accepted coverage at the
//! persisted recipe resolution — never on the viewport. Jobs resolve an
//! immutable input generation, compute without catalogue locks, stage
//! outputs, and publish atomically only when the expected source generation
//! still matches. `refreshing` keeps the last complete result visible until
//! the atomic replacement.

use super::LidarLibrary;
use super::catalogue::{self, new_id, now_iso};
use super::display::ColorRamp;
use super::generation;
use super::grid::RasterGrid;
use super::import::{
    GenerationManifest, publish_display, read_generation_manifest, remove_display_publication,
    validate_working_grid,
};
use super::prepared_raster::PreparedRaster;
use common_types::lidar::{LidarAnalysisKind, LidarSlopeUnit};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisParameters {
    #[serde(default)]
    pub slope_unit: Option<LidarSlopeUnit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultManifest {
    pub definition_id: String,
    pub kind: String,
    pub source_generation_id: String,
    pub parameters: AnalysisParameters,
    pub engine_version: String,
    pub grid: super::grid::RasterGrid,
    /// Dense-result NoData marker. Absent for a sparse result, whose validity
    /// is carried by its resolved chunk assets.
    #[serde(default)]
    pub nodata: Option<f32>,
    pub created_at: String,
    /// Absent in manifests written before sparse results existed, which are
    /// dense by definition.
    #[serde(default)]
    pub format: super::import::GenerationStorageFormat,
}

#[derive(Debug)]
pub struct AnalysisOutcome {
    pub published: bool,
    pub stale: bool,
    pub message: Option<String>,
}

impl AnalysisOutcome {
    pub fn summary(&self) -> String {
        let detail = self.message.clone().unwrap_or_default();
        if self.stale {
            format!("stale result discarded {detail}")
        } else if self.published {
            format!("result published {detail}")
        } else {
            format!("no result published {detail}")
        }
    }
}

/// A stored raster that carries the generation's CRS.
///
/// A chunked generation owns no dense mosaic, so its first published chunk is
/// the representative raster; the CRS check only needs one.
fn sparse_input_raster(
    library: &LidarLibrary,
    head: &catalogue::GenerationRow,
) -> Result<PathBuf, String> {
    if let Some(mosaic) = head.mosaic_path.as_deref() {
        return Ok(PathBuf::from(mosaic));
    }
    let connection = library.catalogue()?;
    let rows = catalogue::generation_chunk_assets(&connection, &head.id, generation::RESULT_ROLE)?;
    rows.first()
        .map(|row| library.inner.paths.root().join(&row.asset.rel_path))
        .ok_or_else(|| "generation has no stored raster to inspect".to_string())
}

/// Why a layer's grid cannot carry a Horn slope result.
///
/// Slope with `-s 1` is only meaningful on a projected grid whose horizontal
/// and vertical units are metres: a geographic grid would silently treat
/// degrees as metres. GDAL remains the projection authority, so the CRS is
/// read from a stored raster instead of being parsed or reprojected here.
fn slope_eligibility(
    engine: &super::engine::GdalEngine,
    cancel: &AtomicBool,
    raster: &Path,
    layer_units: &str,
) -> Result<(), String> {
    let normalized = layer_units.trim().to_ascii_lowercase();
    if !matches!(
        normalized.as_str(),
        "m" | "metre" | "meter" | "metres" | "meters"
    ) {
        return Err(format!(
            "slope requires metre elevations; this layer reports '{layer_units}'"
        ));
    }
    let info = super::display::gdalinfo_json(engine, cancel, raster)?;
    let wkt = info
        .get("coordinateSystem")
        .and_then(|system| system.get("wkt"))
        .and_then(|wkt| wkt.as_str())
        .unwrap_or("");
    if wkt.is_empty() {
        return Err(
            "slope requires a projected metre grid; this raster reports no CRS".to_string(),
        );
    }
    let upper = wkt.to_ascii_uppercase();
    if !upper.contains("PROJCS[") && !upper.contains("PROJCRS[") {
        return Err(
            "slope requires a projected metre grid; this raster is geographic or unknown"
                .to_string(),
        );
    }
    if !upper.contains("METRE") && !upper.contains("METER") {
        return Err(
            "slope requires metre horizontal units; this raster declares another unit".to_string(),
        );
    }
    Ok(())
}

/// One materialized analysis result block.
struct SlopeChunk {
    chunk_x: i64,
    chunk_y: i64,
    result: Option<(generation::CogAsset, generation::RegionAggregate)>,
    quality: Option<generation::CogAsset>,
}

/// Compute one slope block through the bounded resolver.
///
/// The core is the generation's 1024×1024 chunk; the resolver supplies one
/// extra cell on every side, because GDAL's Horn slope needs the full 3×3
/// neighborhood and produces NoData wherever that neighborhood is incomplete.
/// The scratch export uses NaN NoData so a valid finite sample can never
/// collide with a transport sentinel.
#[allow(clippy::too_many_arguments)]
fn compute_slope_block(
    engine: &super::engine::GdalEngine,
    cancel: &AtomicBool,
    paths: &super::paths::LidarPaths,
    scratch: &Path,
    occurrences: &[generation::ResolvedMember],
    lattice: &RasterGrid,
    crs_wkt: &str,
    percent: bool,
    chunk_x: i64,
    chunk_y: i64,
) -> Result<SlopeChunk, String> {
    let side = generation::CHUNK_SIDE;
    let halo_window = generation::LatticeWindow {
        x: chunk_x * side - 1,
        y: chunk_y * side - 1,
        width: (side + 2) as u32,
        height: (side + 2) as u32,
    };
    let resolved = generation::resolve_window(occurrences, lattice, halo_window, cancel)?;
    let halo_grid = generation::window_grid(lattice, halo_window)?;
    let halo_side = halo_window.width as usize;
    let scratch_values: Vec<f32> = resolved
        .samples
        .iter()
        .zip(resolved.valid.iter())
        .map(|(value, valid)| if *valid == 0 { f32::NAN } else { *value })
        .collect();

    let raw = scratch.join(format!("slope-{chunk_x}-{chunk_y}.raw"));
    super::import::write_f32_raw(&raw, &scratch_values)?;
    let halo_path = scratch.join(format!("slope-{chunk_x}-{chunk_y}-halo.tif"));
    let written = super::import::raw_to_tif(
        engine,
        cancel,
        &raw,
        &halo_path,
        &halo_grid,
        crs_wkt,
        f32::NAN,
    );
    let _ = std::fs::remove_file(&raw);
    written?;

    let block_path = scratch.join(format!("slope-{chunk_x}-{chunk_y}-block.tif"));
    let mut args = vec![
        "slope".to_string(),
        "-s".to_string(),
        "1".to_string(),
        "-q".to_string(),
        halo_path.display().to_string(),
        block_path.display().to_string(),
    ];
    if percent {
        args.insert(1, "-p".to_string());
    }
    let computed = engine.run(super::engine::GdalProgram::Dem, &args, Some(cancel));
    let _ = std::fs::remove_file(&halo_path);
    computed?;

    // GDAL marks uncomputed cells of the block with its own NoData marker
    // (a NaN *input* marker does not survive `gdaldem`), so read it back and
    // treat it as invalid before anything is persisted. A slope value can
    // never be negative, so a negative marker is unambiguous; a non-negative
    // one could collide with a real flat/sloped cell and is refused by name.
    let info = super::display::gdalinfo_json(engine, cancel, &block_path)?;
    let block_nodata = super::display::band_nodata(&info);
    if let Some(marker) = block_nodata
        && marker.is_finite()
        && marker >= 0.0
    {
        let _ = std::fs::remove_file(&block_path);
        return Err(format!(
            "slope block output declares NoData {marker}, which a real slope cell could equal"
        ));
    }
    let block_raw = super::import::raw_f32_bytes(
        engine,
        &block_path,
        halo_window.width,
        halo_window.height,
        cancel,
    );
    let _ = std::fs::remove_file(&block_path);
    let block_raw = block_raw?;

    let core_side = side as usize;
    let mut values = vec![f32::NAN; core_side * core_side];
    let mut quality = vec![0f32; core_side * core_side];
    let mut aggregate = generation::RegionAggregate {
        block_x: chunk_x,
        block_y: chunk_y,
        valid_cells: 0,
        min_value: f64::INFINITY,
        max_value: f64::NEG_INFINITY,
        sum_value: 0.0,
    };
    for row in 0..core_side {
        for column in 0..core_side {
            // The core cell sits one halo cell inside the resolved window.
            let halo_x = column + 1;
            let halo_y = row + 1;
            let value = super::import::f32_sample(&block_raw, halo_y * halo_side + halo_x);
            let index = row * core_side + column;
            if value.is_finite() && Some(value) != block_nodata {
                values[index] = value;
                aggregate.valid_cells += 1;
                aggregate.min_value = aggregate.min_value.min(f64::from(value));
                aggregate.max_value = aggregate.max_value.max(f64::from(value));
                aggregate.sum_value += f64::from(value);
            }
            if neighborhood_is_valid(&resolved.valid, halo_side, halo_x, halo_y) {
                quality[index] = 1.0;
            }
        }
    }

    let core_grid = generation::chunk_grid(lattice, chunk_x, chunk_y);
    let stem = format!("slope-{chunk_x}-{chunk_y}");
    let result = if aggregate.valid_cells == 0 {
        None
    } else {
        Some((
            super::raster_assets::write_cog_asset(
                engine,
                cancel,
                paths,
                scratch,
                &stem,
                &core_grid,
                crs_wkt,
                Some(f32::NAN),
                &values,
            )?,
            aggregate,
        ))
    };
    // An all-zero quality chunk has no index entry: absent means quality zero.
    let quality = if quality.contains(&1.0) {
        Some(super::raster_assets::write_cog_asset(
            engine,
            cancel,
            paths,
            scratch,
            &format!("{stem}-quality"),
            &core_grid,
            crs_wkt,
            None,
            &quality,
        )?)
    } else {
        None
    };
    Ok(SlopeChunk {
        chunk_x,
        chunk_y,
        result,
        quality,
    })
}

/// Whether the full 3×3 accepted-input neighborhood of one halo cell is valid.
fn neighborhood_is_valid(valid: &[u8], side: usize, x: usize, y: usize) -> bool {
    for row in y.saturating_sub(1)..=(y + 1).min(side - 1) {
        for column in x.saturating_sub(1)..=(x + 1).min(side - 1) {
            if valid[row * side + column] == 0 {
                return false;
            }
        }
    }
    true
}

/// Publish one slope result as sparse resolved result and quality chunks.
///
/// Blocks are computed one occupied chunk at a time and never concatenated:
/// the result is exactly the set of chunks the input generation occupies, and
/// the final transaction publishes them only when the input is still the
/// layer head.
#[allow(clippy::too_many_arguments)]
fn publish_sparse_slope(
    library: &LidarLibrary,
    job_id: &str,
    definition_id: &str,
    layer_id: &str,
    parameters: &AnalysisParameters,
    head: &catalogue::GenerationRow,
    manifest: &GenerationManifest,
    expected: &str,
    cancel: &AtomicBool,
) -> Result<AnalysisOutcome, String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    let occurrences = {
        let connection = library.catalogue()?;
        super::import::resolved_occurrences(&connection, paths, head)?
    };
    let Some(occurrences) = occurrences else {
        return Err(
            "slope requires reconstructible member history; this generation predates it"
                .to_string(),
        );
    };
    let percent = parameters.slope_unit == Some(LidarSlopeUnit::Percent);
    let scratch = paths.prepared_dir().join(format!("scratch-slope-{job_id}"));
    std::fs::create_dir_all(&scratch)
        .map_err(|e| format!("Failed to create slope scratch: {e}"))?;
    let outcome = (|| -> Result<AnalysisOutcome, String> {
        let blocks = generation::occupied_chunks(&occurrences, &manifest.grid)?;
        let mut chunks = Vec::with_capacity(blocks.len());
        for (chunk_x, chunk_y) in blocks {
            super::import::check_cancel(cancel)?;
            chunks.push(compute_slope_block(
                engine,
                cancel,
                paths,
                &scratch,
                &occurrences,
                &manifest.grid,
                &manifest.crs_wkt,
                percent,
                chunk_x,
                chunk_y,
            )?);
        }

        let mut coverage_cells = 0u64;
        let (mut min_value, mut max_value) = (f64::INFINITY, f64::NEG_INFINITY);
        for chunk in &chunks {
            if let Some((_, aggregate)) = &chunk.result {
                coverage_cells = coverage_cells.saturating_add(aggregate.valid_cells.max(0) as u64);
                min_value = min_value.min(aggregate.min_value);
                max_value = max_value.max(aggregate.max_value);
            }
        }
        if !min_value.is_finite() || !max_value.is_finite() {
            min_value = 0.0;
            max_value = 0.0;
        }

        let generation_id = new_id("agen");
        let mut rows = Vec::new();
        {
            let connection = library.catalogue()?;
            for chunk in &chunks {
                if let Some((asset, aggregate)) = &chunk.result {
                    catalogue::insert_raster_asset(
                        &connection,
                        &generation::asset_row(paths, asset, &manifest.crs_wkt)?,
                    )?;
                    rows.push(catalogue::GenerationChunkRow {
                        role: generation::RESULT_ROLE.to_string(),
                        chunk_x: chunk.chunk_x,
                        chunk_y: chunk.chunk_y,
                        asset_sha256: asset.sha256.clone(),
                        valid_cells: aggregate.valid_cells,
                        min_value: aggregate.min_value,
                        max_value: aggregate.max_value,
                        sum_value: aggregate.sum_value,
                    });
                }
                if let Some(asset) = &chunk.quality {
                    catalogue::insert_raster_asset(
                        &connection,
                        &generation::asset_row(paths, asset, &manifest.crs_wkt)?,
                    )?;
                    rows.push(catalogue::GenerationChunkRow {
                        role: generation::QUALITY_ROLE.to_string(),
                        chunk_x: chunk.chunk_x,
                        chunk_y: chunk.chunk_y,
                        asset_sha256: asset.sha256.clone(),
                        valid_cells: 1,
                        min_value: 0.0,
                        max_value: 1.0,
                        sum_value: 0.0,
                    });
                }
            }
            catalogue::insert_unpublished_chunks(&connection, &generation_id, &rows)?;
        }

        let result_manifest = ResultManifest {
            definition_id: definition_id.to_string(),
            kind: "slope".to_string(),
            source_generation_id: expected.to_string(),
            parameters: parameters.clone(),
            engine_version: engine.discover().map(|t| t.version).unwrap_or_default(),
            grid: manifest.grid.clone(),
            nodata: None,
            created_at: now_iso(),
            format: super::import::GenerationStorageFormat::CogChunksV1,
        };
        let manifest_json = serde_json::to_string(&result_manifest).map_err(|e| e.to_string())?;

        let published = (|| -> Result<(), String> {
            let connection = library.catalogue()?;
            connection
                .execute_batch("BEGIN IMMEDIATE")
                .map_err(|e| e.to_string())?;
            let publish = (|| -> Result<(), String> {
                let job_state = connection
                    .query_row(
                        "SELECT state FROM lidar_analysis_jobs WHERE id = ?1",
                        [job_id],
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(|e| e.to_string())?;
                if !matches!(job_state.as_str(), "preparing" | "refreshing") {
                    return Err(if job_state == "cancelled" {
                        "cancelled".to_string()
                    } else {
                        format!("analysis job cannot publish from state {job_state}")
                    });
                }
                let current_head = connection
                    .query_row(
                        "SELECT generation_id FROM lidar_layer_heads WHERE layer_id = ?1",
                        [layer_id],
                        |row| row.get::<_, String>(0),
                    )
                    .map(Some)
                    .or_else(|error| match error {
                        rusqlite::Error::QueryReturnedNoRows => Ok(None),
                        other => Err(other.to_string()),
                    })?;
                if current_head.as_deref() != Some(expected) {
                    return Err("source layer changed during analysis publication".to_string());
                }
                connection
                    .execute(
                        "INSERT INTO lidar_analysis_generations(id, definition_id, source_generation_id, engine_version, state, result_path, quality_mask_path, manifest_json, coverage_cells, min_value, max_value, bounds_3857, published_at)
                         VALUES(?1, ?2, ?3, ?4, 'ready', NULL, NULL, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            generation_id,
                            definition_id,
                            expected,
                            result_manifest.engine_version,
                            manifest_json,
                            coverage_cells as i64,
                            min_value,
                            max_value,
                            head.bounds_3857,
                            now_iso(),
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                catalogue::publish_generation_chunks(&connection, &generation_id)?;
                connection
                    .execute(
                        "INSERT INTO lidar_analysis_heads(definition_id, generation_id) VALUES(?1, ?2)
                         ON CONFLICT(definition_id) DO UPDATE SET generation_id = excluded.generation_id",
                        rusqlite::params![definition_id, generation_id],
                    )
                    .map_err(|e| e.to_string())?;
                connection
                    .execute(
                        "UPDATE lidar_analysis_jobs SET state = 'complete', updated_at = ?2 WHERE id = ?1",
                        rusqlite::params![job_id, now_iso()],
                    )
                    .map_err(|e| e.to_string())?;
                Ok(())
            })();
            match publish {
                Ok(()) => connection
                    .execute_batch("COMMIT")
                    .map_err(|e| e.to_string()),
                Err(error) => {
                    let _ = connection.execute_batch("ROLLBACK");
                    Err(error)
                }
            }
        })();
        if let Err(error) = published {
            if let Ok(connection) = library.catalogue() {
                let _ =
                    catalogue::discard_unpublished_generation_chunks(&connection, &generation_id);
            }
            return Err(error);
        }
        Ok(AnalysisOutcome {
            published: true,
            stale: false,
            message: Some(format!(
                "sparse slope result published: {coverage_cells} cells in {} blocks",
                chunks.len()
            )),
        })
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    outcome
}

/// Owns one analysis job's staging root.
///
/// The guard exists so no early return, propagated `?`, cancellation or panic
/// can leave an abandoned `staging-*` directory behind: the directory is
/// removed on drop unless publication renamed it into a generation directory
/// and disarmed the guard.
struct StagingGuard {
    dir: PathBuf,
    kept: bool,
}

impl StagingGuard {
    fn create(pipeline_dir: &Path, job_dir_id: &str) -> Result<Self, String> {
        let dir = pipeline_dir.join(format!("staging-{job_dir_id}"));
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create analysis staging: {e}"))?;
        Ok(Self { dir, kept: false })
    }

    fn dir(&self) -> &Path {
        &self.dir
    }

    /// The staging contents became the published generation.
    fn keep(mut self) {
        self.kept = true;
    }
}

impl Drop for StagingGuard {
    fn drop(&mut self) {
        if !self.kept {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }
}

/// Run one slope analysis job. `job_id` is the catalogue job row this run
/// settles. The input snapshot is resolved up front; the publish transaction
/// verifies it is still the layer head, discarding stale artifacts.
pub fn run_slope_job(
    library: &LidarLibrary,
    job_id: &str,
    definition_id: &str,
    parameters: &AnalysisParameters,
    source_generation_id: &str,
    cancel: &AtomicBool,
) -> Result<AnalysisOutcome, String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    let expected = source_generation_id.to_string();

    // Short read: definition + immutable input generation.
    let (definition, head, manifest) = {
        let connection = library.catalogue()?;
        let definition = definition_row(&connection, definition_id)?
            .ok_or_else(|| format!("Analysis definition {definition_id} no longer exists"))?;
        let head = catalogue::head_generation(&connection, &definition.layer_id)?
            .ok_or_else(|| "source layer has no accepted coverage yet".to_string())?;
        let manifest = read_generation_manifest(&head.manifest_json)?;
        (definition, head, manifest)
    };
    validate_working_grid(&manifest.grid, "slope analysis")?;

    // Bounded slope: when the sparse publication path is enabled, resolve the
    // input generation once and compute one core+halo block per occupied chunk
    // instead of handing a whole dense raster to GDAL. The path needs a
    // reconstructible member sequence and an eligible grid.
    let sparse_input = if super::generation::chunked_publication_enabled() {
        let connection = library.catalogue()?;
        let occurrences = super::import::resolved_occurrences(&connection, paths, &head)?;
        drop(connection);
        match occurrences {
            Some(_) => Some(sparse_input_raster(library, &head)?),
            None => None,
        }
    } else {
        None
    };
    if let Some(raster) = sparse_input {
        let layer_units: String = {
            let connection = library.catalogue()?;
            connection
                .query_row(
                    "SELECT units FROM lidar_source_layers WHERE id = ?1",
                    [&definition.layer_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?
        };
        slope_eligibility(engine, cancel, &raster, &layer_units)?;
        return publish_sparse_slope(
            library,
            job_id,
            definition_id,
            &definition.layer_id,
            parameters,
            &head,
            &manifest,
            &expected,
            cancel,
        );
    }

    // Dense fallback: a generation whose member history cannot be replayed
    // still has its accepted mosaic, and the accepted whole-raster slope stays
    // the route for it.
    let (Some(source_mosaic), Some(source_coverage)) = (
        head.mosaic_path.as_deref(),
        head.coverage_mask_path.as_deref(),
    ) else {
        return Err(
            "slope analysis needs either reconstructible member history or a dense source mosaic"
                .to_string(),
        );
    };

    let job_dir_id = new_id("anl");
    let pipeline_dir = paths.analysis_pipeline_dir(definition_id);
    // The job owns its staging root: a failure or cancellation anywhere below
    // drops the guard and removes every unpublished artifact, so a partially
    // written result can never be mistaken for a published one.
    let staging = StagingGuard::create(&pipeline_dir, &job_dir_id)?;
    let staging_dir = staging.dir().to_path_buf();

    // Numeric analysis via the pinned engine. Slope is terrain geometry in
    // layer units; scale 1 (vertical metres, horizontal metres), or percent.
    let result_path = staging_dir.join("result.tif");
    let mut args = vec![
        "slope".to_string(),
        "-s".to_string(),
        "1".to_string(),
        "-q".to_string(),
        Path::new(source_mosaic).display().to_string(),
        result_path.display().to_string(),
    ];
    if parameters.slope_unit == Some(LidarSlopeUnit::Percent) {
        // `-p` is a mode flag for `slope`; it must precede `-s <scale>`, not
        // be spliced into the scale option's argument pair.
        args.insert(1, "-p".to_string());
    }
    engine.run(super::engine::GdalProgram::Dem, &args, Some(cancel))?;

    // Neighborhood quality mask: cells whose full 3×3 accepted neighborhood
    // is not valid are flagged so unknown areas never masquerade as data. The
    // persisted coverage mask is streamed rather than loaded whole.
    let quality_path = staging_dir.join("quality.bin");
    super::paths::require_free_space(
        &staging_dir,
        u64::from(manifest.grid.width)
            .checked_mul(u64::from(manifest.grid.height))
            .and_then(|bytes| bytes.checked_add(super::prepared_raster::FREE_SPACE_FLOOR_BYTES))
            .ok_or_else(|| "slope quality mask size overflows".to_string())?,
        "the slope quality mask",
    )?;
    super::grid::erode_mask_file(
        Path::new(source_coverage),
        &quality_path,
        manifest.grid.width,
        manifest.grid.height,
        |_| super::import::check_cancel(cancel),
    )?;

    // The analysis engine chooses the output nodata marker; read it back so
    // statistics and display treat unknown cells as unknown.
    let result_info = super::display::gdalinfo_json(engine, cancel, &result_path)?;
    let result_nodata = super::display::band_nodata(&result_info).or(Some(manifest.nodata));

    // Exact result statistics, streamed in bounded windows from the slope
    // output's controlled derivative.
    let (min_value, max_value, result_cells) = result_statistics(
        engine,
        &result_path,
        &manifest.grid,
        result_nodata,
        &staging_dir,
        cancel,
    )?;

    let engine_version = engine.discover().map(|t| t.version).unwrap_or_default();
    let result_manifest = ResultManifest {
        definition_id: definition_id.to_string(),
        kind: definition.kind.clone(),
        source_generation_id: expected.clone(),
        parameters: parameters.clone(),
        engine_version: engine_version.clone(),
        grid: manifest.grid.clone(),
        nodata: Some(manifest.nodata),
        created_at: now_iso(),
        format: super::import::GenerationStorageFormat::LegacyDenseV1,
    };
    let manifest_json = serde_json::to_string(&result_manifest).map_err(|e| e.to_string())?;
    std::fs::write(staging_dir.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("Failed to write result manifest: {e}"))?;

    // Publish guard: the input snapshot must still be the layer head.
    let current_head = {
        let connection = library.catalogue()?;
        connection
            .query_row(
                "SELECT generation_id FROM lidar_layer_heads WHERE layer_id = ?1",
                [&definition.layer_id],
                |row| row.get::<_, String>(0),
            )
            .map(Some)
            .or_else(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })?
    };
    if current_head.as_deref() != Some(expected.as_str()) {
        // Stale completion: never replace a newer result; the guard drops the
        // staging root on return.
        return Ok(AnalysisOutcome {
            published: false,
            stale: true,
            message: Some("source layer changed during analysis; result discarded".to_string()),
        });
    }

    let generation_id = new_id("agen");
    super::import::check_cancel(cancel)?;
    let generation_dir = pipeline_dir.join(format!("gen-{generation_id}"));
    std::fs::rename(&staging_dir, &generation_dir)
        .map_err(|e| format!("Failed to publish analysis dir: {e}"))?;
    // Ownership moves to the published generation directory, which has its own
    // removal on every later failure path.
    staging.keep();
    let final_result = generation_dir.join("result.tif");
    let final_quality = generation_dir.join("quality.bin");
    if let Err(error) = publish_display(
        library,
        cancel,
        "analysis",
        definition_id,
        &generation_id,
        &final_result,
        result_nodata,
        &ColorRamp::slope_degrees(),
        None,
    ) {
        let _ = std::fs::remove_dir_all(&generation_dir);
        return Err(error);
    }
    {
        let connection = match library.catalogue() {
            Ok(connection) => connection,
            Err(error) => {
                remove_display_publication(library, "analysis", definition_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        };
        if let Err(error) = connection.execute_batch("BEGIN IMMEDIATE") {
            remove_display_publication(library, "analysis", definition_id, &generation_id);
            let _ = std::fs::remove_dir_all(&generation_dir);
            return Err(error.to_string());
        }
        let publish = (|| -> Result<(), String> {
            let job_state = connection
                .query_row(
                    "SELECT state FROM lidar_analysis_jobs WHERE id = ?1",
                    [job_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?;
            if !matches!(job_state.as_str(), "preparing" | "refreshing") {
                return Err(if job_state == "cancelled" {
                    "cancelled".to_string()
                } else {
                    format!("analysis job cannot publish from state {job_state}")
                });
            }
            let current_head = connection
                .query_row(
                    "SELECT generation_id FROM lidar_layer_heads WHERE layer_id = ?1",
                    [&definition.layer_id],
                    |row| row.get::<_, String>(0),
                )
                .map(Some)
                .or_else(|error| match error {
                    rusqlite::Error::QueryReturnedNoRows => Ok(None),
                    other => Err(other.to_string()),
                })?;
            if current_head.as_deref() != Some(expected.as_str()) {
                return Err("source layer changed during analysis publication".to_string());
            }
            connection
                .execute(
                    "INSERT INTO lidar_analysis_generations(id, definition_id, source_generation_id, engine_version, state, result_path, quality_mask_path, manifest_json, coverage_cells, min_value, max_value, bounds_3857, published_at)
                     VALUES(?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                    rusqlite::params![
                        generation_id,
                        definition_id,
                        expected,
                        engine_version,
                        final_result.display().to_string(),
                        final_quality.display().to_string(),
                        manifest_json,
                        result_cells as i64,
                        min_value,
                        max_value,
                        head.bounds_3857,
                        now_iso(),
                    ],
                )
                .map_err(|e| e.to_string())?;
            connection
                .execute(
                    "INSERT INTO lidar_analysis_heads(definition_id, generation_id) VALUES(?1, ?2)
                     ON CONFLICT(definition_id) DO UPDATE SET generation_id = excluded.generation_id",
                    rusqlite::params![definition_id, generation_id],
                )
                .map_err(|e| e.to_string())?;
            connection
                .execute(
                    "UPDATE lidar_analysis_jobs SET state = 'complete', updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![job_id, now_iso()],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        match publish {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    remove_display_publication(library, "analysis", definition_id, &generation_id);
                    let _ = std::fs::remove_dir_all(&generation_dir);
                    return Err(error.to_string());
                }
            }
            Err(error) if error == "source layer changed during analysis publication" => {
                let _ = connection.execute_batch("ROLLBACK");
                remove_display_publication(library, "analysis", definition_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Ok(AnalysisOutcome {
                    published: false,
                    stale: true,
                    message: Some(
                        "source layer changed during analysis; result discarded".to_string(),
                    ),
                });
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                remove_display_publication(library, "analysis", definition_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        }
    }

    Ok(AnalysisOutcome {
        published: true,
        stale: false,
        message: None,
    })
}

/// Exact result statistics from one bounded scan of the slope output.
///
/// Validity is the existing finite-and-not-NoData rule, using the NoData the
/// analysis engine declared for this result. The reader owns its derivative
/// and removes it before this returns, so the analysis staging directory can
/// be renamed into its published generation without carrying a temporary file.
fn result_statistics(
    engine: &super::engine::GdalEngine,
    result: &Path,
    grid: &RasterGrid,
    nodata: Option<f32>,
    scratch: &Path,
    cancel: &AtomicBool,
) -> Result<(f64, f64, u64), String> {
    // The slope result and the quality mask already exist on disk here, so the
    // measured free space already reflects them: no additional output bytes.
    let mut reader = PreparedRaster::open(engine, result, grid, nodata, 0, scratch, cancel)?;
    let (mut min_value, mut max_value, mut result_cells) = (f64::INFINITY, f64::NEG_INFINITY, 0u64);
    reader.scan(cancel, |_window, samples, valid| {
        for (value, valid) in samples.iter().zip(valid.iter()) {
            if *valid != 0 {
                result_cells += 1;
                min_value = min_value.min(*value as f64);
                max_value = max_value.max(*value as f64);
            }
        }
        Ok(())
    })?;
    if !min_value.is_finite() {
        min_value = 0.0;
        max_value = 0.0;
    }
    Ok((min_value, max_value, result_cells))
}

pub fn definition_row(
    connection: &rusqlite::Connection,
    definition_id: &str,
) -> Result<Option<catalogue::AnalysisDefinitionRow>, String> {
    connection
        .query_row(
            "SELECT id, layer_id, kind, parameters_json
             FROM lidar_analysis_definitions WHERE id = ?1",
            [definition_id],
            |row| {
                Ok(catalogue::AnalysisDefinitionRow {
                    id: row.get(0)?,
                    layer_id: row.get(1)?,
                    kind: row.get(2)?,
                    parameters_json: row.get(3)?,
                })
            },
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
}

pub fn parse_parameters(json: &str) -> Result<AnalysisParameters, String> {
    serde_json::from_str(json).map_err(|e| format!("Invalid analysis parameters: {e}"))
}

/// Capability registry for slice 1: only slope on ground elevation is
/// registered; surface and other-continuous layers display numeric color
/// only until a capability is explicitly registered.
pub fn capability(kind: LidarAnalysisKind, measurement_kind: &str) -> Result<(), String> {
    match (kind, measurement_kind) {
        (LidarAnalysisKind::Slope, "ground-elevation") => Ok(()),
        (LidarAnalysisKind::Slope, other) => Err(format!(
            "slope analysis requires a ground-elevation layer; this layer is {other}"
        )),
    }
}

/// Mark stale result heads and enqueue one refresh per definition after an
/// accepted source change. Returns (job_id, definition_id, parameters_json,
/// source_generation_id) for the orchestrator to spawn.
pub fn enqueue_refreshes(
    connection: &rusqlite::Connection,
    layer_id: &str,
) -> Vec<(String, String, String, String)> {
    let layer_head = match catalogue::head_generation(connection, layer_id) {
        Ok(Some(head)) => head.id,
        _ => return Vec::new(),
    };
    let definitions = match catalogue::list_definitions_for_layer(connection, layer_id) {
        Ok(defs) => defs,
        Err(_) => return Vec::new(),
    };
    let mut enqueued = Vec::new();
    for definition in definitions {
        let head_result = catalogue::head_analysis_generation(connection, &definition.id)
            .ok()
            .flatten();
        let already_current = head_result
            .as_ref()
            .map(|r| r.source_generation_id == layer_head)
            .unwrap_or(false);
        if already_current {
            continue;
        }
        let active = matches!(
            catalogue::latest_analysis_job_state(connection, &definition.id)
                .ok()
                .flatten()
                .as_deref(),
            Some("preparing") | Some("refreshing")
        );
        if active {
            continue;
        }
        let job_id = new_id("anl");
        let state = if head_result.is_some() {
            "refreshing"
        } else {
            "preparing"
        };
        let inserted = connection
            .execute(
                "INSERT INTO lidar_analysis_jobs(id, definition_id, source_generation_id, state, created_at, updated_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?5)",
                rusqlite::params![job_id, definition.id, layer_head, state, now_iso()],
            )
            .is_ok();
        if inserted {
            enqueued.push((
                job_id,
                definition.id,
                definition.parameters_json.clone(),
                layer_head.clone(),
            ));
        }
    }
    enqueued
}

/// Startup recovery: jobs interrupted by a restart fail explicitly so the UI
/// never reports ghost activity; published results are unaffected.
pub fn recover_interrupted_jobs(connection: &rusqlite::Connection) -> Result<(), String> {
    for (table, transient) in [
        (
            "lidar_import_jobs",
            vec!["staging", "awaiting_review", "applying"],
        ),
        ("lidar_analysis_jobs", vec!["preparing", "refreshing"]),
    ] {
        for state in transient {
            connection
                .execute(
                    &format!(
                        "UPDATE {table} SET state = 'failed', message = 'interrupted by restart',
                         updated_at = ?1 WHERE state = ?2"
                    ),
                    rusqlite::params![now_iso(), state],
                )
                .map_err(|e| format!("Failed to recover {table}: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    /// GDAL-backed workflow expectations: a plane rising one metre per metre
    /// eastward is 45 degrees, or 100 percent, everywhere it has neighbours.
    #[derive(Debug)]
    struct PublishedSlope {
        result_path: PathBuf,
        quality_path: PathBuf,
        coverage_cells: u64,
        min_value: f64,
        max_value: f64,
    }

    fn scratch_root(label: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("canopi-slope-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch root");
        root
    }

    /// A 45-degree plane with a NoData hole, published through the real
    /// import review and apply path.
    fn plane_layer(library: &LidarLibrary, root: &Path, width: u32, height: u32) -> String {
        let engine = super::super::engine::GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let values: Vec<f32> = (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, y)| {
                if (8..10).contains(&x) && (6..8).contains(&y) {
                    -9999.0
                } else {
                    x as f32
                }
            })
            .collect();
        let raw = root.join("plane.raw");
        super::super::import::write_f32_raw(&raw, &values).expect("plane raw");
        let source = root.join("plane.tif");
        let grid = RasterGrid {
            width,
            height,
            geotransform: [0.0, 1.0, 0.0, height as f64, 0.0, -1.0],
        };
        super::super::import::raw_to_tif(
            &engine,
            &cancel,
            &raw,
            &source,
            &grid,
            "EPSG:3857",
            -9999.0,
        )
        .expect("plane converts");

        let layer_id = library
            .create_layer(
                "slope plane",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .expect("layer created");
        publish_source(library, &layer_id, &source, false);
        layer_id
    }

    /// Publish one source through the real review and apply path. An identical
    /// reimport keeps the existing generation unless the caller replaces
    /// overlap, which is how the layer head is advanced here.
    fn publish_source(
        library: &LidarLibrary,
        layer_id: &str,
        source: &Path,
        replace_overlap: bool,
    ) {
        let cancel = AtomicBool::new(false);
        let job_id = library.record_import_job(layer_id).expect("job recorded");
        let output = super::super::import::stage_import(
            library,
            &job_id,
            layer_id,
            std::slice::from_ref(&source.to_path_buf()),
            &cancel,
        )
        .expect("staging succeeds");
        assert!(
            output.review.compatible,
            "plane must be admitted: {:?}",
            output.review.issues
        );
        library.finish_staging(
            &job_id,
            Ok(super::super::import::StagingOutput {
                review: output.review.clone(),
            }),
        );
        let staging: super::super::import::StagedImport = serde_json::from_str(
            &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                .expect("staging json"),
        )
        .expect("staging parses");
        library.prepare_apply(&job_id).expect("review accepted");
        let outcome =
            super::super::import::apply_import(library, &staging, true, replace_overlap, &cancel)
                .expect("apply publishes");
        assert!(outcome.changed, "{}", outcome.summary());
    }

    /// Create the analysis, run its first job as the orchestrator would.
    fn run_first_slope_job(
        library: &LidarLibrary,
        layer_id: &str,
        unit: LidarSlopeUnit,
    ) -> (String, String) {
        let receipt = library
            .create_analysis(
                layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(unit),
                },
            )
            .expect("analysis created");
        let (parameters, source_generation) = {
            let connection = library.catalogue().expect("catalogue");
            let parameters: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .expect("parameters");
            let source_generation: String = connection
                .query_row(
                    "SELECT source_generation_id FROM lidar_analysis_jobs WHERE id = ?1",
                    [&receipt.job_id],
                    |row| row.get(0),
                )
                .expect("source generation");
            (parameters, source_generation)
        };
        let parameters = parse_parameters(&parameters).expect("parameters parse");
        let outcome = run_slope_job(
            library,
            &receipt.job_id,
            &receipt.definition_id,
            &parameters,
            &source_generation,
            &AtomicBool::new(false),
        )
        .expect("slope job runs");
        assert!(outcome.published && !outcome.stale, "{}", outcome.summary());
        (receipt.job_id, receipt.definition_id)
    }

    fn published_slope(library: &LidarLibrary, definition_id: &str) -> PublishedSlope {
        let connection = library.catalogue().expect("catalogue");
        let generation_id: String = connection
            .query_row(
                "SELECT generation_id FROM lidar_analysis_heads WHERE definition_id = ?1",
                [definition_id],
                |row| row.get(0),
            )
            .expect("analysis head");
        connection
            .query_row(
                "SELECT result_path, quality_mask_path, coverage_cells, min_value, max_value
                 FROM lidar_analysis_generations WHERE id = ?1",
                [&generation_id],
                |row| {
                    Ok(PublishedSlope {
                        result_path: PathBuf::from(row.get::<_, String>(0)?),
                        quality_path: PathBuf::from(row.get::<_, String>(1)?),
                        coverage_cells: row.get::<_, i64>(2)? as u64,
                        min_value: row.get(3)?,
                        max_value: row.get(4)?,
                    })
                },
            )
            .expect("published generation")
    }

    /// Independently recompute the statistics from the published result with
    /// the retained dense conversion.
    fn oracle_statistics(
        engine: &super::super::engine::GdalEngine,
        published: &PublishedSlope,
        grid: &RasterGrid,
    ) -> (f64, f64, u64) {
        let cancel = AtomicBool::new(false);
        let raw = super::super::import::raw_f32_bytes(
            engine,
            &published.result_path,
            grid.width,
            grid.height,
            &cancel,
        )
        .expect("result converts");
        let info = super::super::display::gdalinfo_json(engine, &cancel, &published.result_path)
            .expect("result info");
        let nodata = super::super::display::band_nodata(&info);
        let (mut min, mut max, mut cells) = (f64::INFINITY, f64::NEG_INFINITY, 0u64);
        for chunk in raw.chunks_exact(4) {
            let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value.is_finite() && Some(value) != nodata {
                cells += 1;
                min = min.min(value as f64);
                max = max.max(value as f64);
            }
        }
        if !min.is_finite() {
            min = 0.0;
            max = 0.0;
        }
        (min, max, cells)
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn slope_jobs_publish_streamed_statistics_and_quality_masks() {
        let engine = super::super::engine::GdalEngine::new();
        let root = scratch_root("streamed");
        let library = LidarLibrary::open(&root).expect("library opens");
        let (width, height) = (24u32, 18u32);
        let layer_id = plane_layer(&library, &root, width, height);
        let manifest = {
            let connection = library.catalogue().expect("catalogue");
            let head = catalogue::head_generation(&connection, &layer_id)
                .expect("head read")
                .expect("layer published");
            read_generation_manifest(&head.manifest_json).expect("manifest")
        };

        super::super::prepared_raster::observability::reset();
        let (_job_id, degrees_definition) =
            run_first_slope_job(&library, &layer_id, LidarSlopeUnit::Degrees);
        let degrees = published_slope(&library, &degrees_definition);
        assert!(
            super::super::prepared_raster::observability::tiles_decoded() > 0,
            "slope statistics must decode through the native tiled reader"
        );

        // Statistics and coverage match the retained dense conversion.
        let (min, max, cells) = oracle_statistics(&engine, &degrees, &manifest.grid);
        assert_eq!(degrees.min_value, min);
        assert_eq!(degrees.max_value, max);
        assert_eq!(degrees.coverage_cells, cells);
        assert!(
            (44.0..=46.0).contains(&degrees.max_value),
            "a one-metre-per-metre plane is 45 degrees, got {}",
            degrees.max_value
        );

        // The streamed quality mask is byte-identical to the dense erosion of
        // the accepted coverage, including the hole and the outer edges.
        let coverage_path = {
            let connection = library.catalogue().expect("catalogue");
            let head = catalogue::head_generation(&connection, &layer_id)
                .expect("head read")
                .expect("layer published");
            PathBuf::from(
                head.coverage_mask_path
                    .as_deref()
                    .expect("dense generation has a coverage mask"),
            )
        };
        let coverage = super::super::grid::ValidMask::read_from(&coverage_path, width, height)
            .expect("coverage reads");
        let oracle_quality = coverage.eroded_checked(|_| Ok(())).expect("dense erosion");
        assert_eq!(
            std::fs::read(&degrees.quality_path).expect("quality mask"),
            oracle_quality.bytes().to_vec(),
            "published quality mask must match the dense oracle"
        );

        // Percent reports the same plane as 100 percent.
        let (_job_id, percent_definition) =
            run_first_slope_job(&library, &layer_id, LidarSlopeUnit::Percent);
        let percent = published_slope(&library, &percent_definition);
        let (percent_min, percent_max, percent_cells) =
            oracle_statistics(&engine, &percent, &manifest.grid);
        assert_eq!(percent.min_value, percent_min);
        assert_eq!(percent.max_value, percent_max);
        assert_eq!(percent.coverage_cells, percent_cells);
        assert!(
            (99.0..=101.0).contains(&percent.max_value),
            "the same plane is 100 percent, got {}",
            percent.max_value
        );

        // A job whose input generation is no longer the layer head publishes
        // nothing and leaves the previous result in place.
        let receipt = library
            .create_analysis(
                &layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(LidarSlopeUnit::Degrees),
                },
            )
            .expect("stale analysis created");
        // An identical reimport publishes only when it replaces overlap; that
        // changed head is what makes the pending job stale.
        publish_source(&library, &layer_id, &root.join("plane.tif"), true);
        let (stale_parameters, stale_source_generation) = {
            let connection = library.catalogue().expect("catalogue");
            let parameters: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .expect("parameters");
            let generation: String = connection
                .query_row(
                    "SELECT source_generation_id FROM lidar_analysis_jobs WHERE id = ?1",
                    [&receipt.job_id],
                    |row| row.get(0),
                )
                .expect("source generation");
            (parameters, generation)
        };
        let stale = run_slope_job(
            &library,
            &receipt.job_id,
            &receipt.definition_id,
            &parse_parameters(&stale_parameters).expect("parameters parse"),
            &stale_source_generation,
            &AtomicBool::new(false),
        )
        .expect("stale job settles");
        assert!(stale.stale && !stale.published, "{}", stale.summary());
        let unchanged = published_slope(&library, &degrees_definition);
        assert_eq!(unchanged.min_value, min);
        assert_eq!(unchanged.max_value, max);

        // The derivative never reaches a published generation: it is removed
        // before the staging directory is renamed.
        let published_dir = unchanged
            .result_path
            .parent()
            .expect("published generation directory");
        let leftovers: Vec<_> = std::fs::read_dir(published_dir)
            .expect("generation directory reads")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("prepared-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "published generation carries a derivative: {leftovers:?}"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
    /// Names of the staging roots a definition currently owns.
    fn staging_roots(library: &LidarLibrary, definition_id: &str) -> Vec<String> {
        let dir = library.inner.paths.analysis_pipeline_dir(definition_id);
        std::fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("staging-"))
            .collect()
    }

    /// Build one definition and its queued job without running it.
    fn queued_slope_job(library: &LidarLibrary, layer_id: &str) -> (String, String, String) {
        let receipt = library
            .create_analysis(
                layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(LidarSlopeUnit::Degrees),
                },
            )
            .expect("analysis created");
        let (parameters, source_generation) = {
            let connection = library.catalogue().expect("catalogue");
            let parameters: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .expect("parameters");
            let source_generation: String = connection
                .query_row(
                    "SELECT source_generation_id FROM lidar_analysis_jobs WHERE id = ?1",
                    [&receipt.job_id],
                    |row| row.get(0),
                )
                .expect("source generation");
            (parameters, source_generation)
        };
        (
            receipt.job_id,
            receipt.definition_id,
            format!("{parameters}|{source_generation}"),
        )
    }

    /// A mid-pipeline failure must not leave the job's staging root behind,
    /// and must leave the accepted head untouched.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn failed_slope_job_removes_its_staging_root_and_keeps_the_accepted_head() {
        let root = scratch_root("staging-failure");
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = plane_layer(&library, &root, 24, 18);
        let (job_id, definition_id, encoded) = queued_slope_job(&library, &layer_id);
        let (parameters, source_generation) = encoded.split_once('|').expect("encoded pair");
        let parameters = parse_parameters(parameters).expect("parameters parse");
        let head_before: String = {
            let connection = library.catalogue().expect("catalogue");
            connection
                .query_row(
                    "SELECT generation_id FROM lidar_layer_heads WHERE layer_id = ?1",
                    [&layer_id],
                    |row| row.get(0),
                )
                .expect("head")
        };

        // Fail after the staging root exists: the quality-mask free-space
        // check cannot pass with no measurable capacity.
        let error = {
            let _guard = super::super::paths::capacity_probe::override_available(0);
            run_slope_job(
                &library,
                &job_id,
                &definition_id,
                &parameters,
                source_generation,
                &AtomicBool::new(false),
            )
            .expect_err("a job without free space must fail")
        };
        assert!(
            error.contains("slope quality mask"),
            "the failure must happen after the slope step wrote its staged result: {error}"
        );
        assert!(
            staging_roots(&library, &definition_id).is_empty(),
            "failed job left {:?}",
            staging_roots(&library, &definition_id)
        );
        let connection = library.catalogue().expect("catalogue");
        let head_after: String = connection
            .query_row(
                "SELECT generation_id FROM lidar_layer_heads WHERE layer_id = ?1",
                [&layer_id],
                |row| row.get(0),
            )
            .expect("head");
        assert_eq!(head_after, head_before);
        drop(connection);
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A cancelled job must not leave its staging root behind either.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn cancelled_slope_job_removes_its_staging_root() {
        let root = scratch_root("staging-cancel");
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = plane_layer(&library, &root, 24, 18);
        let (job_id, definition_id, encoded) = queued_slope_job(&library, &layer_id);
        let (parameters, source_generation) = encoded.split_once('|').expect("encoded pair");
        let parameters = parse_parameters(parameters).expect("parameters parse");

        let error = run_slope_job(
            &library,
            &job_id,
            &definition_id,
            &parameters,
            source_generation,
            &AtomicBool::new(true),
        )
        .expect_err("a cancelled job must not publish");
        assert_eq!(error, "cancelled");
        assert!(
            staging_roots(&library, &definition_id).is_empty(),
            "cancelled job left {:?}",
            staging_roots(&library, &definition_id)
        );
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A staging root left by a crashed process is removed at startup, while
    /// published generations and member assets are not candidates.
    #[test]
    fn startup_pruning_removes_abandoned_staging_roots_only() {
        let root = scratch_root("staging-prune");
        let definition_id = "definition-prune";
        let library = LidarLibrary::open(&root).expect("library opens");
        let pipeline = library.inner.paths.analysis_pipeline_dir(definition_id);
        let abandoned = pipeline.join("staging-anl-abandoned");
        let published = pipeline.join("gen-agen-published");
        std::fs::create_dir_all(&abandoned).expect("abandoned staging");
        std::fs::create_dir_all(&published).expect("published dir");
        std::fs::write(abandoned.join("result.tif"), b"partial").expect("partial result");
        std::fs::write(published.join("result.tif"), b"accepted").expect("accepted result");
        drop(library);

        let reopened = LidarLibrary::open(&root).expect("library reopens");
        assert!(
            !abandoned.exists(),
            "an abandoned staging root must not survive startup"
        );
        assert!(
            published.join("result.tif").exists(),
            "a published generation directory is never pruned"
        );
        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }
    // -----------------------------------------------------------------------
    // B3: bounded slope through the resolver
    // -----------------------------------------------------------------------

    /// A plane source whose value equals the distance east of `origin_x`, with
    /// a NoData column range so seams and holes can be placed deliberately.
    #[allow(clippy::too_many_arguments)]
    fn plane_member(
        root: &Path,
        name: &str,
        origin_x: f64,
        width: u32,
        height: u32,
        hole_columns: &[u32],
    ) -> PathBuf {
        let engine = super::super::engine::GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let values: Vec<f32> = (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, _)| {
                if hole_columns.contains(&x) {
                    -9999.0
                } else {
                    (origin_x + f64::from(x)) as f32
                }
            })
            .collect();
        let raw = root.join(format!("{name}.raw"));
        super::super::import::write_f32_raw(&raw, &values).expect("plane raw");
        let source = root.join(format!("{name}.tif"));
        super::super::import::raw_to_tif(
            &engine,
            &cancel,
            &raw,
            &source,
            &RasterGrid {
                width,
                height,
                geotransform: [origin_x, 1.0, 0.0, height as f64, 0.0, -1.0],
            },
            "EPSG:3857",
            -9999.0,
        )
        .expect("plane converts");
        let _ = std::fs::remove_file(&raw);
        let _ = std::fs::remove_file(raw.with_extension("hdr"));
        source
    }

    /// Import sources through the real caller path and publish them dense.
    fn sparse_layer_without_gate(library: &LidarLibrary, sources: &[PathBuf]) -> String {
        import_layer(library, sources, "dense slope")
    }

    /// Import sources through the real caller path and publish them sparse.
    fn sparse_layer(library: &LidarLibrary, sources: &[PathBuf]) -> String {
        import_layer(library, sources, "bounded slope")
    }

    /// Import one layer through the real staging, review and apply callers,
    /// publishing in whichever format the gate currently selects.
    fn import_layer(library: &LidarLibrary, sources: &[PathBuf], name: &str) -> String {
        let cancel = AtomicBool::new(false);
        let layer_id = library
            .create_layer(
                name,
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .expect("layer created");
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let output =
            super::super::import::stage_import(library, &job_id, &layer_id, sources, &cancel)
                .expect("staging");
        assert!(output.review.compatible, "{:?}", output.review.issues);
        library.finish_staging(
            &job_id,
            Ok(super::super::import::StagingOutput {
                review: output.review.clone(),
            }),
        );
        let staging: super::super::import::StagedImport = serde_json::from_str(
            &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                .expect("staging json"),
        )
        .expect("staging parse");
        library.prepare_apply(&job_id).expect("review accepted");
        let applied = super::super::import::apply_import(library, &staging, true, false, &cancel)
            .expect("apply publishes");
        assert!(applied.changed);
        layer_id
    }

    /// Read a window of an analysis head's sparse result and quality chunks.
    fn sparse_result_window(
        library: &LidarLibrary,
        definition_id: &str,
        window: generation::LatticeWindow,
    ) -> (Vec<f32>, Vec<u8>, Vec<u8>) {
        let connection = library.catalogue().expect("catalogue");
        let (generation_id, manifest_json): (String, String) = connection
            .query_row(
                "SELECT g.id, g.manifest_json FROM lidar_analysis_heads h
                 JOIN lidar_analysis_generations g ON g.id = h.generation_id
                 WHERE h.definition_id = ?1",
                [definition_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("analysis head");
        let manifest: ResultManifest = serde_json::from_str(&manifest_json).expect("manifest");
        assert_eq!(
            manifest.format,
            super::super::import::GenerationStorageFormat::CogChunksV1
        );
        let paths = &library.inner.paths;
        let result_chunks = generation::persisted_chunks(
            &connection,
            paths,
            &generation_id,
            generation::RESULT_ROLE,
        )
        .expect("result chunks");
        let quality_chunks = generation::persisted_chunks(
            &connection,
            paths,
            &generation_id,
            generation::QUALITY_ROLE,
        )
        .expect("quality chunks");
        let cancel = AtomicBool::new(false);
        let values =
            generation::read_persisted_window(&result_chunks, &manifest.grid, window, &cancel)
                .expect("result window");
        let quality = generation::read_quality_chunks_window(
            &quality_chunks,
            &manifest.grid,
            window,
            &cancel,
        )
        .expect("quality window");
        let quality = quality
            .samples
            .iter()
            .map(|value| u8::from(*value == 1.0))
            .collect();
        (values.samples, values.valid, quality)
    }

    #[test]
    fn slope_eligibility_refuses_non_metre_elevations() {
        let engine = super::super::engine::GdalEngine::new();
        let error = slope_eligibility(
            &engine,
            &AtomicBool::new(false),
            Path::new("/nonexistent.tif"),
            "ft",
        )
        .expect_err("non-metre elevations are not slope eligible");
        assert!(error.contains("metre elevations"), "{error}");
    }

    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn slope_eligibility_accepts_a_projected_metre_grid() {
        let root = scratch_root("eligibility");
        let source = plane_member(&root, "eligible", 0.0, 8, 6, &[]);
        let engine = super::super::engine::GdalEngine::new();
        slope_eligibility(&engine, &AtomicBool::new(false), &source, "m")
            .expect("a projected metre plane is eligible");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The bounded slope must reproduce the accepted whole-raster GDAL result
    /// on the cells whose 3×3 input neighborhood is complete, in both units.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_slope_matches_the_dense_oracle_in_both_units() {
        let root = scratch_root("sparse-equivalence");
        let library = LidarLibrary::open(&root).expect("library opens");
        let left = plane_member(&root, "left", 0.0, 24, 18, &[22, 23]);
        // The hole spans the member seam: local columns 22..23 of the left
        // member and local column 0 of the right one share union column 24.
        let right = plane_member(&root, "right", 24.0, 24, 18, &[0]);

        // The same data through both storage formats: a dense layer for the
        // accepted whole-raster oracle, and a sparse layer for the bounded
        // path. Both lattices share an origin, so cells are comparable.
        let dense_layer = sparse_layer_without_gate(&library, &[left.clone(), right.clone()]);
        let layer_id = {
            let _guard = super::super::generation::chunked_publication::enable();
            sparse_layer(&library, &[left, right])
        };

        // Sparse result for the bounded path.
        let sparse = {
            let _guard = super::super::generation::chunked_publication::enable();
            let (_job, definition) =
                run_first_slope_job(&library, &layer_id, LidarSlopeUnit::Degrees);
            definition
        };
        // Dense result for the accepted path, on its own dense generation.
        let dense = run_first_slope_job(&library, &dense_layer, LidarSlopeUnit::Degrees).1;
        let dense_publication = published_slope(&library, &dense);
        assert!(
            dense_publication.result_path.exists(),
            "the dense oracle is a real raster"
        );

        // Both results must cover the same cells with the same values where the
        // neighborhood is complete: a plane rising 1 m/m is 45 degrees.
        let window = generation::LatticeWindow {
            x: 0,
            y: 0,
            width: 48,
            height: 18,
        };
        let (values, valid, quality) = sparse_result_window(&library, &sparse, window);
        let dense_grid = {
            let connection = library.catalogue().expect("catalogue");
            read_generation_manifest(
                &connection
                    .query_row(
                        "SELECT g.manifest_json FROM lidar_layer_heads h
                         JOIN lidar_layer_generations g ON g.id = h.generation_id
                         WHERE h.layer_id = ?1",
                        [&dense_layer],
                        |row| row.get::<_, String>(0),
                    )
                    .expect("head manifest"),
            )
            .expect("manifest")
            .grid
        };
        let dense_raw = super::super::import::raw_f32_bytes(
            &library.inner.engine,
            &dense_publication.result_path,
            dense_grid.width,
            dense_grid.height,
            &AtomicBool::new(false),
        )
        .expect("dense result bytes");

        let mut covered = 0usize;
        for row in 0..18usize {
            for column in 0..48usize {
                let index = row * 48 + column;
                // GDAL's Horn slope needs the full 3×3 input neighborhood, so
                // the generation's own outer boundary is incomplete as well,
                // and the hole columns 22..24 remove 21..25.
                let inside_boundary = (1..=16).contains(&row) && (1..=46).contains(&column);
                let expected_quality = inside_boundary && !(21..=25).contains(&column);
                assert_eq!(
                    quality[index],
                    u8::from(expected_quality),
                    "quality at {column},{row}"
                );
                assert_eq!(
                    valid[index],
                    u8::from(expected_quality),
                    "result validity at {column},{row}"
                );
                if quality[index] == 0 {
                    continue;
                }
                covered += 1;
                assert!(
                    (values[index] - 45.0).abs() < 0.001,
                    "sparse slope at {column},{row} is {}",
                    values[index]
                );
                let dense_value = super::super::import::f32_sample(&dense_raw, row * 48 + column);
                assert!(
                    (dense_value - values[index]).abs() < 1e-4,
                    "sparse {} and dense {} disagree at {column},{row}",
                    values[index],
                    dense_value
                );
            }
        }
        assert_eq!(covered, 16 * 41, "the complete-neighborhood interior only");

        // Percent is the same plane reported in the other unit.
        let percent = {
            let _guard = super::super::generation::chunked_publication::enable();
            run_first_slope_job(&library, &layer_id, LidarSlopeUnit::Percent).1
        };
        let (percent_values, percent_valid, _) = sparse_result_window(&library, &percent, window);
        for row in 0..18usize {
            for column in 0..48usize {
                let index = row * 48 + column;
                if percent_valid[index] == 0 {
                    continue;
                }
                assert!(
                    (percent_values[index] - 100.0).abs() < 0.01,
                    "percent slope at {column},{row} is {}",
                    percent_values[index]
                );
            }
        }

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A cancelled bounded slope publishes nothing and leaves no scratch root
    /// or unpublished index rows behind.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn cancelled_sparse_slope_publishes_nothing() {
        let root = scratch_root("sparse-cancel");
        let library = LidarLibrary::open(&root).expect("library opens");
        let source = plane_member(&root, "cancel", 0.0, 16, 12, &[]);
        let layer_id = {
            let _guard = super::super::generation::chunked_publication::enable();
            sparse_layer(&library, &[source])
        };
        let (job_id, definition_id, encoded) = queued_slope_job(&library, &layer_id);
        let (parameters, source_generation) = encoded.split_once('|').expect("encoded pair");
        let parameters = parse_parameters(parameters).expect("parameters parse");
        let error = {
            let _guard = super::super::generation::chunked_publication::enable();
            run_slope_job(
                &library,
                &job_id,
                &definition_id,
                &parameters,
                source_generation,
                &AtomicBool::new(true),
            )
            .expect_err("a cancelled slope job must not publish")
        };
        assert_eq!(error, "cancelled");
        let connection = library.catalogue().expect("catalogue");
        let heads: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM lidar_analysis_heads WHERE definition_id = ?1",
                [&definition_id],
                |row| row.get(0),
            )
            .expect("head count");
        assert_eq!(heads, 0, "a cancelled job publishes no analysis head");
        let unpublished: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM lidar_generation_chunks WHERE state != 'published'",
                [],
                |row| row.get(0),
            )
            .expect("chunk count");
        assert_eq!(unpublished, 0, "no unpublished chunk rows survive");
        drop(connection);
        let scratch = library.inner.paths.prepared_dir();
        let leftovers: Vec<String> = std::fs::read_dir(&scratch)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("scratch-slope-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "slope scratch left behind: {leftovers:?}"
        );
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }
}
