//! Analysis definitions, jobs and publication.
//!
//! Analyses operate on a source item's complete coverage at its native
//! resolution — never on the viewport. A job resolves the item's immutable
//! generation, computes without catalogue locks, stages sparse result chunks,
//! and publishes a new result atomically only when that generation is still
//! the item's current one.

use super::LidarLibrary;
use super::catalogue::{self, new_id, now_iso};
use super::generation;
use super::grid::RasterGrid;
use super::import::{GenerationManifest, read_generation_manifest};
use common_types::lidar::{LidarAnalysisKind, LidarSlopeUnit};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalysisParameters {
    pub slope_unit: LidarSlopeUnit,
    /// Published with the result; `None` publishes an unnamed result.
    pub name: Option<String>,
}

impl AnalysisParameters {
    /// The name to publish a result under, trimmed and emptied to `None`.
    fn published_name(&self) -> Option<String> {
        self.name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
    }
}

/// How a slope definition is computed, selected by its stored recipe version.
///
/// The version column is the execution authority: a retry runs the version
/// its definition stored, and an unknown version fails instead of being
/// coerced. A changed method needs a new version.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlopeRecipe {
    /// Version 2: the pinned GeoLibre projected slope (5×5 Florinsky stencil).
    GeolibreProjected,
}

impl SlopeRecipe {
    pub const fn version(self) -> i64 {
        match self {
            Self::GeolibreProjected => 2,
        }
    }

    pub const fn method_id(self) -> &'static str {
        match self {
            Self::GeolibreProjected => "geolibre-projected-slope-v1",
        }
    }

    pub fn from_version(version: i64) -> Result<Self, String> {
        match version {
            2 => Ok(Self::GeolibreProjected),
            other => Err(format!(
                "slope recipe version {other} is not supported by this version of Canopi"
            )),
        }
    }

    /// Input cells beyond each side of a core window the stencil reads.
    const fn halo(self) -> i64 {
        match self {
            Self::GeolibreProjected => 2,
        }
    }
}

/// Finite staging marker for GeoLibre windows: -2^127, exact in Float32 and in
/// its decimal tag. The pinned tool compares neighbour NoData by equality, so
/// NaN would not trigger its valid-centre substitution.
const GEOLIBRE_STAGING_NODATA: f32 = f32::from_bits(0xFF00_0000);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultManifest {
    pub definition_id: String,
    pub kind: String,
    pub source_generation_id: String,
    pub parameters: AnalysisParameters,
    pub engine_version: String,
    pub grid: super::grid::RasterGrid,
    /// CRS of the result lattice, so a result can be sampled without
    /// re-reading its input generation.
    pub crs_wkt: String,
    pub created_at: String,
}

/// A published slope result. Every other ending is an error: the input of a
/// job is a fixed item, so there is no superseded or stale outcome.
#[derive(Debug)]
pub struct AnalysisOutcome {
    pub coverage_cells: u64,
    pub blocks: usize,
}

impl AnalysisOutcome {
    pub fn summary(&self) -> String {
        format!(
            "sparse slope result published: {} cells in {} blocks",
            self.coverage_cells, self.blocks
        )
    }
}

/// The item's ordered source occurrences, resolved for bounded reads.
fn head_occurrences(
    library: &LidarLibrary,
    head: &catalogue::GenerationRow,
    manifest: &GenerationManifest,
    cancel: &AtomicBool,
) -> Result<Vec<generation::ResolvedMember>, String> {
    super::collection::load_reader(library, &head.id, manifest, cancel)
        .map(|reader| reader.resolved().to_vec())
}

/// One source COG of the item, whose CRS the eligibility check reads; every
/// admitted source shares the item's horizontal CRS.
fn representative_source(
    library: &LidarLibrary,
    head: &catalogue::GenerationRow,
    cancel: &AtomicBool,
) -> Result<PathBuf, String> {
    super::collection::snapshot_members(library, &head.id, cancel)?
        .first()
        .map(|member| member.resolved.cog.path.clone())
        .ok_or_else(|| "the item has no source to analyse".to_string())
}

/// Why an item's grid cannot carry a projected slope result.
///
/// Projected slope with `z_factor=1` is only meaningful on a grid whose
/// horizontal and vertical units are metres: a geographic grid would silently
/// treat degrees as metres. GDAL remains the projection authority, so the CRS is
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
    let info = super::raster_info::gdalinfo_json(engine, cancel, raster)?;
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
/// The core is the generation's 1024×1024 chunk and the resolver supplies the
/// stencil's two-cell halo on every side; the GeoLibre 5×5 stencil substitutes
/// the valid centre for missing neighbours. Staging uses a finite sentinel no
/// valid sample of the window may equal. Only the core is kept.
#[allow(clippy::too_many_arguments)]
fn compute_slope_block(
    recipe: SlopeRecipe,
    geolibre: &super::geolibre::GeolibreEngine,
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
    let halo = recipe.halo();
    let halo_window = generation::LatticeWindow {
        x: chunk_x * side - halo,
        y: chunk_y * side - halo,
        width: (side + 2 * halo) as u32,
        height: (side + 2 * halo) as u32,
    };
    let resolved = generation::resolve_window(occurrences, lattice, halo_window, cancel)?;
    let halo_grid = generation::window_grid(lattice, halo_window)?;
    let halo_side = halo_window.width as usize;
    let staging_nodata = GEOLIBRE_STAGING_NODATA;
    if resolved
        .samples
        .iter()
        .zip(resolved.valid.iter())
        .any(|(value, valid)| *valid != 0 && *value == staging_nodata)
    {
        return Err(format!(
            "slope block {chunk_x},{chunk_y} holds a valid sample equal to the staging NoData marker"
        ));
    }
    let scratch_values: Vec<f32> = resolved
        .samples
        .iter()
        .zip(resolved.valid.iter())
        .map(|(value, valid)| if *valid == 0 { staging_nodata } else { *value })
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
        staging_nodata,
    );
    let _ = std::fs::remove_file(&raw);
    written?;

    let block_path = scratch.join(format!("slope-{chunk_x}-{chunk_y}-block.tif"));
    let computed = geolibre.slope(&halo_path, &block_path, percent, cancel);
    let _ = std::fs::remove_file(&halo_path);
    if let Err(error) = computed {
        let _ = std::fs::remove_file(&block_path);
        return Err(error);
    }

    // The engine marks uncomputed cells of the block with its own NoData
    // marker, so read it back and treat it as invalid before anything is persisted. A slope value can
    // never be negative, so a negative marker is unambiguous; a non-negative
    // one could collide with a real flat/sloped cell and is refused by name.
    let info = super::raster_info::gdalinfo_json(engine, cancel, &block_path)?;
    let block_nodata = super::raster_info::band_nodata(&info);
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
            // The core cell sits one halo inside the resolved window.
            let halo_x = column + halo as usize;
            let halo_y = row + halo as usize;
            let value = super::import::f32_sample(&block_raw, halo_y * halo_side + halo_x);
            let index = row * core_side + column;
            // An invalid centre is invalid output whatever the tool wrote, and
            // neither the tool's marker nor the staging sentinel is a slope.
            let centre_valid = resolved.valid[halo_y * halo_side + halo_x] != 0;
            if centre_valid
                && value.is_finite()
                && Some(value) != block_nodata
                && value != GEOLIBRE_STAGING_NODATA
            {
                values[index] = value;
                aggregate.valid_cells += 1;
                aggregate.min_value = aggregate.min_value.min(f64::from(value));
                aggregate.max_value = aggregate.max_value.max(f64::from(value));
                aggregate.sum_value += f64::from(value);
            }
            if neighborhood_is_valid(&resolved.valid, halo_side, halo_x, halo_y, halo as usize) {
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

/// Whether the recipe's full input neighbourhood (5×5 for GeoLibre) of one
/// halo cell was originally valid.
fn neighborhood_is_valid(valid: &[u8], side: usize, x: usize, y: usize, reach: usize) -> bool {
    for row in y.saturating_sub(reach)..=(y + reach).min(side - 1) {
        for column in x.saturating_sub(reach)..=(x + reach).min(side - 1) {
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
/// Sparse slope storage admission over the actual occupied work.
///
/// Covers core+halo buffers, staged result/quality bytes and the shared
/// reserve with checked arithmetic. Widely separated small members admit
/// despite a large lattice envelope; occupied work beyond available storage
/// is refused before any output is written.
pub(super) fn admit_sparse_slope_storage(
    scratch: &Path,
    occupied_blocks: usize,
    halo: u64,
) -> Result<(), String> {
    let side = u64::try_from(generation::CHUNK_SIDE)
        .map_err(|_| "chunk side is not representable".to_string())?;
    let halo_side = halo
        .checked_mul(2)
        .and_then(|margin| side.checked_add(margin))
        .ok_or_else(|| "slope halo side overflows".to_string())?;
    let halo_cells = halo_side
        .checked_mul(halo_side)
        .ok_or_else(|| "slope halo cells overflow".to_string())?;
    let core_cells = side
        .checked_mul(side)
        .ok_or_else(|| "slope core cells overflow".to_string())?;
    // Core+halo f32 samples, staged result+quality bytes, and one block's
    // scratch overlap, all per occupied block.
    let halo_bytes = halo_cells
        .checked_mul(4)
        .ok_or_else(|| "slope halo bytes overflow".to_string())?;
    let result_quality_bytes = core_cells
        .checked_mul(8)
        .ok_or_else(|| "slope result bytes overflow".to_string())?;
    let scratch_overlap = core_cells
        .checked_mul(4)
        .ok_or_else(|| "slope scratch bytes overflow".to_string())?;
    let per_block = halo_bytes
        .checked_add(result_quality_bytes)
        .and_then(|bytes| bytes.checked_add(scratch_overlap))
        .ok_or_else(|| "slope per-block working set overflows".to_string())?;
    let blocks = u64::try_from(occupied_blocks).map_err(|_| "block count overflow".to_string())?;
    let total = per_block
        .checked_mul(blocks)
        .ok_or_else(|| "slope sparse working set overflows".to_string())?;
    let side_u32 = u32::try_from(side).map_err(|_| "chunk side overflow".to_string())?;
    let reserve = super::prepared_raster::required_free_bytes(side_u32, side_u32, 0)?;
    let total = total
        .checked_add(reserve)
        .ok_or_else(|| "slope sparse working set plus reserve overflows".to_string())?;
    super::paths::require_free_space(scratch, total, "the sparse slope working set")
}

/// Compute one slope result block by block in job scratch and publish it
/// against the pinned input generation `expected`.
#[allow(clippy::too_many_arguments)]
fn publish_sparse_slope(
    library: &LidarLibrary,
    job_id: &str,
    definition_id: &str,
    layer_id: &str,
    recipe: SlopeRecipe,
    parameters: &AnalysisParameters,
    head: &catalogue::GenerationRow,
    manifest: &GenerationManifest,
    occurrences: &[generation::ResolvedMember],
    expected: &str,
    cancel: &AtomicBool,
) -> Result<AnalysisOutcome, String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    // What actually runs is recorded with the result; resolving it first also
    // makes a missing engine fail before any work or output.
    let engine_version = match recipe {
        SlopeRecipe::GeolibreProjected => library.inner.geolibre.discover()?.provenance(),
    };
    let percent = parameters.slope_unit == LidarSlopeUnit::Percent;
    let scratch = paths.slope_scratch_dir(job_id);
    std::fs::create_dir_all(&scratch)
        .map_err(|e| format!("Failed to create slope scratch: {e}"))?;
    let outcome = (|| -> Result<AnalysisOutcome, String> {
        let blocks = generation::occupied_chunks(occurrences, &manifest.grid)?;
        // Sparse admission covers the actual occupied work: core blocks plus
        // halos, bounded working buffers, staged result/quality bytes and the
        // shared reserve. Checked arithmetic; no first-member lattice envelope.
        let total_blocks = blocks.len();
        admit_sparse_slope_storage(&scratch, total_blocks, recipe.halo() as u64)?;
        let mut chunks = Vec::with_capacity(total_blocks);
        for (index, (chunk_x, chunk_y)) in blocks.into_iter().enumerate() {
            super::import::check_cancel(cancel)?;
            // Recheck before each bounded output: remaining work plus reserve,
            // not a second charge of bytes already written.
            let remaining = total_blocks.saturating_sub(index);
            admit_sparse_slope_storage(&scratch, remaining, recipe.halo() as u64)?;
            chunks.push(compute_slope_block(
                recipe,
                &library.inner.geolibre,
                engine,
                cancel,
                paths,
                &scratch,
                occurrences,
                &manifest.grid,
                &manifest.crs_wkt,
                percent,
                chunk_x,
                chunk_y,
            )?);
            #[cfg(test)]
            super::acceptance_hooks::after_block(
                &scratch,
                chunks.last().is_some_and(|chunk| chunk.result.is_some()),
            );
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
            engine_version,
            grid: manifest.grid.clone(),
            crs_wkt: manifest.crs_wkt.clone(),
            created_at: now_iso(),
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
                if job_state != "preparing" {
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
                // A published item never changes its generation, so this only
                // guards the catalogue against a result for an input it no
                // longer holds.
                if current_head.as_deref() != Some(expected) {
                    return Err("the input of this calculation is no longer available".to_string());
                }
                require_definition_recipe(&connection, definition_id, recipe)?;
                connection
                    .execute(
                        "INSERT INTO lidar_analysis_generations(id, definition_id, source_generation_id, engine_version, state, manifest_json, coverage_cells, min_value, max_value, bounds_3857, published_at, name, method_id, recipe_version)
                         VALUES(?1, ?2, ?3, ?4, 'ready', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                            parameters.published_name(),
                            recipe.method_id(),
                            recipe.version(),
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                catalogue::publish_generation_chunks(&connection, &generation_id)?;
                connection
                    .execute(
                        "INSERT INTO lidar_analysis_heads(definition_id, generation_id) VALUES(?1, ?2)",
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
            coverage_cells,
            blocks: chunks.len(),
        })
    })();
    let _ = std::fs::remove_dir_all(&scratch);
    outcome
}

/// Run one slope analysis job. `job_id` is the catalogue job row this run
/// settles. The input generation is resolved up front; the publish
/// transaction rechecks it before anything becomes visible.
pub fn run_slope_job(
    library: &LidarLibrary,
    job_id: &str,
    definition_id: &str,
    parameters: &AnalysisParameters,
    source_generation_id: &str,
    cancel: &AtomicBool,
) -> Result<AnalysisOutcome, String> {
    let engine = &library.inner.engine;
    let expected = source_generation_id.to_string();

    // Short read: definition + immutable input generation.
    let (definition, recipe, head, manifest) = {
        let connection = library.catalogue()?;
        let definition = definition_row(&connection, definition_id)?
            .ok_or_else(|| format!("Analysis definition {definition_id} no longer exists"))?;
        // The stored version decides the method; an unknown one fails here,
        // before any input is read, and the previous result stays as it is.
        let recipe = SlopeRecipe::from_version(definition.version)?;
        let head = catalogue::head_generation(&connection, &definition.layer_id)?
            .ok_or_else(|| "source layer has no accepted coverage yet".to_string())?;
        let manifest = read_generation_manifest(&head.manifest_json)?;
        (definition, recipe, head, manifest)
    };
    // Every source item is an ordered collection: resolve it once and compute
    // one core+halo block per occupied chunk, never a whole-raster pass.
    let occurrences = head_occurrences(library, &head, &manifest, cancel)?;
    let raster = representative_source(library, &head, cancel)?;
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
    publish_sparse_slope(
        library,
        job_id,
        definition_id,
        &definition.layer_id,
        recipe,
        parameters,
        &head,
        &manifest,
        &occurrences,
        &expected,
        cancel,
    )
}

pub fn definition_row(
    connection: &rusqlite::Connection,
    definition_id: &str,
) -> Result<Option<catalogue::AnalysisDefinitionRow>, String> {
    connection
        .query_row(
            "SELECT id, layer_id, kind, parameters_json, version
             FROM lidar_analysis_definitions WHERE id = ?1",
            [definition_id],
            |row| {
                Ok(catalogue::AnalysisDefinitionRow {
                    id: row.get(0)?,
                    layer_id: row.get(1)?,
                    kind: row.get(2)?,
                    parameters_json: row.get(3)?,
                    version: row.get(4)?,
                })
            },
        )
        .map(Some)
        .or_else(|err| match err {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })
}

/// Refuse publication when the definition vanished or its stored recipe is not
/// the one that ran, inside the publishing transaction.
fn require_definition_recipe(
    connection: &rusqlite::Connection,
    definition_id: &str,
    recipe: SlopeRecipe,
) -> Result<(), String> {
    let stored: Option<i64> = connection
        .query_row(
            "SELECT version FROM lidar_analysis_definitions WHERE id = ?1",
            [definition_id],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    match stored {
        None => Err(format!(
            "analysis {definition_id} was deleted during the calculation"
        )),
        Some(version) if version == recipe.version() => Ok(()),
        Some(version) => Err(format!(
            "analysis {definition_id} stores recipe version {version}, not the {} that ran",
            recipe.method_id()
        )),
    }
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

/// Startup recovery: jobs interrupted by a restart fail explicitly so the UI
/// never reports ghost activity; published results are unaffected.
pub fn recover_interrupted_jobs(connection: &rusqlite::Connection) -> Result<(), String> {
    for (table, transient) in [
        ("lidar_import_jobs", vec!["staging", "applying"]),
        ("lidar_analysis_jobs", vec!["preparing"]),
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
                None,
                false,
            )
            .expect("layer created");
        publish_source(library, &layer_id, &source);
        layer_id
    }

    /// Publish one source into `layer_id` through the real stage and apply path.
    ///
    /// A published item is fixed, so production never gives an item a second
    /// generation. Currency guards (a result pinned to an input that is no
    /// longer the head) are still exercised by first withdrawing the head,
    /// which leaves the old generation's rows in place for the guard to see.
    fn publish_source(library: &LidarLibrary, layer_id: &str, source: &Path) {
        library
            .catalogue()
            .expect("catalogue")
            .execute(
                "DELETE FROM lidar_layer_heads WHERE layer_id = ?1",
                [layer_id],
            )
            .expect("head withdrawn");
        let cancel = AtomicBool::new(false);
        let job_id = library.record_import_job(layer_id).expect("job recorded");
        super::super::import::stage_and_publish(
            library,
            &job_id,
            layer_id,
            std::slice::from_ref(&source.to_path_buf()),
            &cancel,
        )
        .expect("the batch publishes");
    }

    /// Create the analysis, run its first job as the orchestrator would.
    fn run_first_slope_job(
        library: &LidarLibrary,
        layer_id: &str,
        unit: LidarSlopeUnit,
    ) -> (String, String) {
        let receipt = library
            .create_analysis_unchecked(
                layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: unit,
                    name: None,
                },
                None,
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
        assert!(outcome.coverage_cells > 0, "{}", outcome.summary());
        (receipt.job_id, receipt.definition_id)
    }

    /// The published slope result is readable through its own manifest, in its
    /// own units, at a known cell.
    ///
    /// This is R16's end-to-end half. The unit test above proves the unit comes
    /// from the result's parameters; this one proves a *published* result can be
    /// read at all — the reviewer's finding was that a slope result failed
    /// before sampling because the head was parsed as a source manifest, and
    /// that the source reader cannot identify a result's chunks.
    ///
    /// The oracle is the geometry, not a formula: the fixture is a plane rising
    /// exactly one metre per metre eastward, so its slope is 45 degrees and 100
    /// percent wherever it has neighbours. Both reads must agree with that and
    /// with each other.
    #[test]
    #[ignore = "requires GDAL and the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
    fn inspection_reads_a_published_slope_result_in_both_units() {
        let root = scratch_root("inspection");
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = plane_layer(&library, &root, 16, 16);
        let cancel = AtomicBool::new(false);

        // The centre of lattice cell (5, 5): the grid origin is (0, 16) with a
        // one-metre cell and a -1 y resolution, in EPSG:3857.
        let (easting, northing) = (5.5_f64, 16.0 - 5.5);
        // Independent inverse Web Mercator, so the point is not derived from
        // the transform under test.
        const R: f64 = 6_378_137.0;
        let longitude = easting / R * 180.0 / std::f64::consts::PI;
        let latitude = (2.0 * (northing / R).exp().atan() - std::f64::consts::FRAC_PI_2) * 180.0
            / std::f64::consts::PI;

        let mut observed: Vec<(LidarSlopeUnit, f64, String)> = Vec::new();
        for (unit, expected, expected_units) in [
            (LidarSlopeUnit::Degrees, 45.0_f64, "°"),
            (LidarSlopeUnit::Percent, 100.0_f64, "%"),
        ] {
            let (_job_id, definition_id) = run_first_slope_job(&library, &layer_id, unit);
            let generation_id = {
                let connection = library.catalogue().expect("catalogue");
                super::super::catalogue::head_analysis_generation(&connection, &definition_id)
                    .expect("head read")
                    .expect("a published result")
                    .id
            };
            let outcome = library
                .sample(
                    &common_types::lidar::LidarSampleRequest {
                        kind: common_types::lidar::LidarSampleEntityKind::Analysis,
                        entity_id: definition_id.clone(),
                        expected_generation_id: generation_id,
                        request_id: format!("test-{expected_units}"),
                        longitude,
                        latitude,
                    },
                    &cancel,
                )
                .expect("the sample runs");
            let common_types::lidar::LidarSampleOutcome::Value { value, units, .. } = outcome
            else {
                panic!("cell (5, 5) must hold a slope, got {outcome:?}");
            };
            // Half a degree of slack covers the one-cell kernel's own rounding
            // on a Float32 plane; the value is not a survey observation.
            assert!(
                (value - expected).abs() < 0.5,
                "{unit:?} slope at cell (5, 5) was {value}, expected {expected}"
            );
            assert_eq!(units, expected_units, "{unit:?} units");
            observed.push((unit, value, units));
        }

        // The two units describe the same geometry, so they must agree.
        let degrees = observed[0].1;
        let percent = observed[1].1;
        assert!(
            (percent - 100.0 * degrees.to_radians().tan()).abs() < 0.5,
            "percent {percent} must be the tangent of degrees {degrees}"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(root);
    }

    /// Build one definition and its queued job without running it.
    fn queued_slope_job(library: &LidarLibrary, layer_id: &str) -> (String, String, String) {
        let receipt = library
            .create_analysis_unchecked(
                layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: LidarSlopeUnit::Degrees,
                    name: None,
                },
                None,
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

    /// Import sources through the real caller path.
    fn published_layer(library: &LidarLibrary, sources: &[PathBuf]) -> String {
        import_layer(library, sources, "bounded slope")
    }

    /// Import one layer through the real staging and apply callers.
    fn import_layer(library: &LidarLibrary, sources: &[PathBuf], name: &str) -> String {
        let cancel = AtomicBool::new(false);
        let layer_id = library
            .create_layer(
                name,
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .expect("layer created");
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        super::super::import::stage_and_publish(library, &job_id, &layer_id, sources, &cancel)
            .expect("the batch publishes");
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

    /// A smooth analytic surface `z = 40 sin(2πx/90) + 16 cos(2πy/54)` on a
    /// 1 m projected lattice, with a square NoData hole.
    fn curved_member(root: &Path, width: u32, height: u32, hole: std::ops::Range<u32>) -> PathBuf {
        let engine = super::super::engine::GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let values: Vec<f32> = (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, y)| {
                if hole.contains(&x) && hole.contains(&(y + 600)) {
                    -9999.0
                } else {
                    curved_height(f64::from(x), f64::from(y)) as f32
                }
            })
            .collect();
        let raw = root.join("curved.raw");
        super::super::import::write_f32_raw(&raw, &values).expect("curved raw");
        let source = root.join("curved.tif");
        super::super::import::raw_to_tif(
            &engine,
            &cancel,
            &raw,
            &source,
            &RasterGrid {
                width,
                height,
                geotransform: [0.0, 1.0, 0.0, f64::from(height), 0.0, -1.0],
            },
            "EPSG:3857",
            -9999.0,
        )
        .expect("curved converts");
        let _ = std::fs::remove_file(&raw);
        source
    }

    fn curved_height(x: f64, y: f64) -> f64 {
        40.0 * (std::f64::consts::TAU * x / 90.0).sin()
            + 16.0 * (std::f64::consts::TAU * y / 54.0).cos()
    }

    /// Analytic gradient magnitude (rise over run) at a cell centre.
    fn curved_gradient(x: f64, y: f64) -> f64 {
        let dx = 40.0 * std::f64::consts::TAU / 90.0 * (std::f64::consts::TAU * x / 90.0).cos();
        let dy = -16.0 * std::f64::consts::TAU / 54.0 * (std::f64::consts::TAU * y / 54.0).sin();
        dx.hypot(dy)
    }

    fn run_created_job(
        library: &LidarLibrary,
        layer_id: &str,
        unit: LidarSlopeUnit,
        name: &str,
    ) -> String {
        let receipt = library
            .create_analysis(
                layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: unit,
                    name: None,
                },
                Some(name.to_string()),
            )
            .expect("a new slope is created with the GeoLibre recipe");
        let connection = library.catalogue().expect("catalogue");
        let (parameters, input): (String, String) = connection
            .query_row(
                "SELECT d.parameters_json, j.source_generation_id FROM lidar_analysis_jobs j
                 JOIN lidar_analysis_definitions d ON d.id = j.definition_id WHERE j.id = ?1",
                [&receipt.job_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("job");
        drop(connection);
        let outcome = run_slope_job(
            library,
            &receipt.job_id,
            &receipt.definition_id,
            &parse_parameters(&parameters).expect("parameters"),
            &input,
            &AtomicBool::new(false),
        )
        .expect("the GeoLibre slope job runs");
        assert!(outcome.coverage_cells > 0, "{}", outcome.summary());
        receipt.definition_id
    }

    /// Recipe 2 runs the pinned GeoLibre CLI window by window and publishes the
    /// projected 5×5 slope: it matches the analytic surface on both sides of a
    /// 1024-cell chunk seam, keeps NoData centres invalid, marks quality only
    /// where the whole 5×5 input neighbourhood was valid, records what ran,
    /// and a second calculation is a separate result that leaves the first.
    #[test]
    #[ignore = "requires GDAL and the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
    fn geolibre_slope_matches_the_analytic_surface_across_a_chunk_seam() {
        let root = scratch_root("geolibre-slope");
        let library = LidarLibrary::open(&root).expect("library opens");
        let (width, height) = (1040u32, 12u32);
        // Hole columns 600..603 on rows 0..3 (the helper offsets rows by 600).
        let layer_id = published_layer(&library, &[curved_member(&root, width, height, 600..603)]);
        let degrees = run_created_job(&library, &layer_id, LidarSlopeUnit::Degrees, "Steepness");
        // Read in two halves: one window stays within the resolver's cap.
        let read = |definition: &str| {
            let half = width / 2;
            let left = sparse_result_window(
                &library,
                definition,
                generation::LatticeWindow {
                    x: 0,
                    y: 0,
                    width: half,
                    height,
                },
            );
            let right = sparse_result_window(
                &library,
                definition,
                generation::LatticeWindow {
                    x: i64::from(half),
                    y: 0,
                    width: half,
                    height,
                },
            );
            let join = |l: &[f32], r: &[f32]| -> Vec<f32> {
                (0..height as usize)
                    .flat_map(|row| {
                        l[row * half as usize..(row + 1) * half as usize]
                            .iter()
                            .chain(&r[row * half as usize..(row + 1) * half as usize])
                            .copied()
                            .collect::<Vec<_>>()
                    })
                    .collect()
            };
            let join_u8 = |l: &[u8], r: &[u8]| -> Vec<u8> {
                (0..height as usize)
                    .flat_map(|row| {
                        l[row * half as usize..(row + 1) * half as usize]
                            .iter()
                            .chain(&r[row * half as usize..(row + 1) * half as usize])
                            .copied()
                            .collect::<Vec<_>>()
                    })
                    .collect()
            };
            (
                join(&left.0, &right.0),
                join_u8(&left.1, &right.1),
                join_u8(&left.2, &right.2),
            )
        };
        let (values, valid, quality) = read(&degrees);
        let near_hole = |x: u32, y: u32| (598..605).contains(&x) && y < 5;
        let mut compared = 0usize;
        for y in 0..height {
            for x in 0..width {
                let index = (y * width + x) as usize;
                let in_hole = (600..603).contains(&x) && y < 3;
                if in_hole {
                    assert_eq!(valid[index], 0, "a NoData centre stays invalid at {x},{y}");
                    continue;
                }
                assert_eq!(valid[index], 1, "a valid centre has a value at {x},{y}");
                let interior = (2..height - 2).contains(&y) && (2..width - 2).contains(&x);
                let expected_quality = interior && !near_hole(x, y);
                assert_eq!(
                    quality[index],
                    u8::from(expected_quality),
                    "quality at {x},{y}"
                );
                if expected_quality {
                    // The surface is sampled at integer cell indices, 1 m apart.
                    let expected = curved_gradient(f64::from(x), f64::from(y))
                        .atan()
                        .to_degrees();
                    let error = (f64::from(values[index]) - expected).abs();
                    assert!(error < 0.01, "{x},{y}: {} vs {expected}", values[index]);
                    compared += 1;
                }
            }
        }
        assert!(
            compared > 8_000,
            "the comparison covers the surface ({compared} cells)"
        );
        for x in 1020..1028 {
            assert_eq!(
                quality[(5 * width + x) as usize],
                1,
                "the seam at column {x} is interior"
            );
        }

        let (method, version, engine): (String, i64, String) = library
            .catalogue()
            .unwrap()
            .query_row(
                "SELECT g.method_id, g.recipe_version, g.engine_version FROM lidar_analysis_heads h
                 JOIN lidar_analysis_generations g ON g.id = h.generation_id WHERE h.definition_id = ?1",
                [&degrees],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("provenance");
        assert_eq!(
            (method.as_str(), version),
            ("geolibre-projected-slope-v1", 2)
        );
        assert!(engine.starts_with("geolibre-cli "), "{engine}");

        let percent = run_created_job(&library, &layer_id, LidarSlopeUnit::Percent, "Steepness");
        assert_ne!(
            percent, degrees,
            "a second calculation is a separate result"
        );
        let (values, _, _) = read(&percent);
        let (x, y) = (1024u32, 6u32);
        let expected = 100.0 * curved_gradient(f64::from(x), f64::from(y));
        let got = f64::from(values[(y * width + x) as usize]);
        assert!((got - expected).abs() < 0.05, "percent {got} vs {expected}");
        let snapshot = library.library_snapshot().expect("snapshot");
        assert_eq!(
            snapshot.analyses.len(),
            2,
            "the first result is still there"
        );
        assert!(
            snapshot
                .analyses
                .iter()
                .all(|analysis| analysis.generation_id.is_some())
        );
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Processes currently running one executable, read from `/proc`.
    #[cfg(target_os = "linux")]
    fn running(executable: &Path) -> usize {
        let wanted = std::fs::canonicalize(executable).expect("tool path");
        std::fs::read_dir("/proc")
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| {
                std::fs::read_link(entry.path().join("exe")).is_ok_and(|exe| exe == wanted)
            })
            .count()
    }

    /// Cancelling while the GeoLibre child computes a window kills and reaps
    /// that child, publishes nothing and leaves no scratch behind.
    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires GDAL and the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
    fn cancelling_a_geolibre_slope_kills_its_child_and_publishes_nothing() {
        let root = scratch_root("geolibre-cancel");
        let library = LidarLibrary::open(&root).expect("library opens");
        let tool = library
            .inner
            .geolibre
            .discover()
            .expect("GeoLibre CLI")
            .path;
        let layer_id = published_layer(&library, &[curved_member(&root, 1024, 1024, 0..0)]);
        let receipt = library
            .create_analysis(
                &layer_id,
                LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: LidarSlopeUnit::Degrees,
                    name: None,
                },
                None,
            )
            .expect("created");
        let input: String = library
            .catalogue()
            .unwrap()
            .query_row(
                "SELECT source_generation_id FROM lidar_analysis_jobs WHERE id = ?1",
                [&receipt.job_id],
                |row| row.get(0),
            )
            .unwrap();
        let cancel = std::sync::Arc::new(AtomicBool::new(false));
        let watcher = {
            let cancel = cancel.clone();
            let tool = tool.clone();
            std::thread::spawn(move || {
                let started = std::time::Instant::now();
                while running(&tool) == 0 {
                    assert!(
                        started.elapsed().as_secs() < 60,
                        "the GeoLibre child never started"
                    );
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
                cancel.store(true, std::sync::atomic::Ordering::SeqCst);
            })
        };
        let error = run_slope_job(
            &library,
            &receipt.job_id,
            &receipt.definition_id,
            &AnalysisParameters {
                slope_unit: LidarSlopeUnit::Degrees,
                name: None,
            },
            &input,
            &cancel,
        )
        .expect_err("a cancelled GeoLibre slope does not publish");
        watcher.join().expect("watcher");
        assert_eq!(error, "cancelled");
        assert_eq!(running(&tool), 0, "the GeoLibre child was reaped");
        let heads: i64 = library
            .catalogue()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM lidar_analysis_heads", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(heads, 0);
        let leftovers = std::fs::read_dir(library.inner.paths.prepared_dir())
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("scratch-slope-")
            })
            .count();
        assert_eq!(leftovers, 0, "slope scratch removed");
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
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

    /// A cancelled bounded slope publishes nothing and leaves no scratch root
    /// or unpublished index rows behind.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn cancelled_sparse_slope_publishes_nothing() {
        let root = scratch_root("sparse-cancel");
        let library = LidarLibrary::open(&root).expect("library opens");
        let source = plane_member(&root, "cancel", 0.0, 16, 12, &[]);
        let layer_id = { published_layer(&library, &[source]) };
        let (job_id, definition_id, encoded) = queued_slope_job(&library, &layer_id);
        let (parameters, source_generation) = encoded.split_once('|').expect("encoded pair");
        let parameters = parse_parameters(parameters).expect("parameters parse");
        let error = {
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
    #[test]
    fn low_capacity_refuses_sparse_slope_admission_before_output() {
        let root = scratch_root("sparse-admission-refuse");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        // Healthy control: ample capacity admits the same work.
        {
            let _guard = crate::services::lidar::paths::capacity_probe::override_available(
                8 * 1024 * 1024 * 1024,
            );
            admit_sparse_slope_storage(&root, 4, 2).expect("ample capacity admits");
        }
        // Capacity loss before output refuses the block without writing.
        {
            let _guard = crate::services::lidar::paths::capacity_probe::override_available(1);
            let error = admit_sparse_slope_storage(&root, 4, 2).expect_err("low capacity refuses");
            assert!(error.contains("free"), "named capacity reason: {error}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }
    include!("analysis_acceptance_tests.rs");
}
