//! Import staging, review planning and publication for source layers.
//!
//! Validity, classification and mosaic composition run in Rust on exact
//! Float32 buffers so invalid pixels can never bleed into accepted coverage.
//! GDAL performs format conversion, georeferencing and display rendering
//! only. Catalogue locks are held only for short reads and the publish
//! transaction — never during raster computation. Publication is atomic:
//! staging is renamed into the generation directory and the head advances in
//! one transaction.

use super::LidarLibrary;
use super::catalogue::{self, new_id, now_iso};
use super::display::{self, ColorRamp};
use super::engine::{GdalEngine, GdalProgram};
use super::grid::{
    self, GeoTransform, RasterGrid, ValidMask, classify_coverage, remap_mask, union_grid,
};
use super::paths::LidarPaths;
use common_types::lidar::{LidarImportReview, LidarImportSourceFacts};
use serde::{Deserialize, Serialize};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Canonical NoData used for a layer whose first source declares none.
pub const FALLBACK_NODATA: f32 = -99999.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedSource {
    pub filename: String,
    pub sha256: String,
    pub managed_original: PathBuf,
    pub interp_hash: String,
    pub width: u32,
    pub height: u32,
    pub geotransform: GeoTransform,
    pub crs_wkt: String,
    pub nodata: Option<f32>,
    pub value_range: [f64; 2],
    pub size_bytes: u64,
    pub valid_mask_path: PathBuf,
    pub raw_samples_path: PathBuf,
    pub compatible: bool,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedImport {
    pub job_id: String,
    pub layer_id: String,
    pub layer_grid: Option<RasterGrid>,
    pub layer_crs_wkt: Option<String>,
    pub layer_nodata: f32,
    pub union_grid: RasterGrid,
    pub sources: Vec<StagedSource>,
    pub uncovered_cells: u64,
    pub overlap_cells: u64,
    pub invalid_cells: u64,
    pub before_preview_path: Option<PathBuf>,
    pub after_preview_path: Option<PathBuf>,
    pub engine_version: String,
}

pub struct StagingOutput {
    pub review: LidarImportReview,
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

pub fn stage_import(
    library: &LidarLibrary,
    job_id: &str,
    layer_id: &str,
    source_paths: &[PathBuf],
    cancel: &AtomicBool,
) -> Result<StagingOutput, String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;

    // Short read: layer identity and current head snapshot.
    let (layer, head) = {
        let connection = library.catalogue()?;
        let layer = catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        let head = catalogue::head_generation(&connection, layer_id)?;
        (layer, head)
    };
    let head_manifest = match &head {
        Some(head) => Some(read_generation_manifest(&head.manifest_json)?),
        None => None,
    };
    let layer_grid: Option<RasterGrid> = head_manifest.as_ref().map(|m| m.grid.clone());
    let layer_crs_wkt: Option<String> = head_manifest
        .as_ref()
        .map(|m| m.crs_wkt.clone())
        .filter(|wkt| !wkt.is_empty());
    // The layer's canonical nodata: adopted from the first accepted source
    // when the layer is still empty, so managed rasters keep the source's
    // declared sentinel semantics.
    let layer_nodata: f32 = match &head_manifest {
        Some(m) => m.nodata,
        None => FALLBACK_NODATA,
    };

    let job_dir = paths.job_dir(job_id);
    std::fs::create_dir_all(&job_dir).map_err(|e| format!("Failed to create job dir: {e}"))?;

    let mut staged: Vec<StagedSource> = Vec::new();
    for source_path in source_paths {
        check_cancel(cancel)?;
        staged.push(stage_source(
            engine,
            paths,
            library,
            layer_id,
            &layer.measurement_kind,
            &layer.units,
            layer_grid.as_ref(),
            layer_crs_wkt.as_deref(),
            source_path,
            &job_dir,
        )?);
    }

    let compatible: Vec<&StagedSource> = staged.iter().filter(|s| s.compatible).collect();
    if compatible.is_empty() {
        let issues = staged
            .iter()
            .flat_map(|s| s.issues.iter().cloned())
            .collect::<Vec<_>>();
        return Err(format!(
            "no source could join layer '{}': {}",
            layer.name,
            issues.join("; ")
        ));
    }

    // Union grid across the layer grid and every compatible source.
    let mut union = layer_grid
        .clone()
        .unwrap_or_else(|| grid_for_source(compatible[0]));
    let mut layer_nodata = layer_nodata;
    if head_manifest.is_none() {
        layer_nodata = compatible[0].nodata.unwrap_or(FALLBACK_NODATA);
    }
    for source in &compatible {
        union = union_grid(&union, &grid_for_source(source))?;
    }

    // Existing accepted values and coverage on the union grid.
    let (layer_values, layer_mask_on_union) = head_values_on_union(
        engine,
        head.as_ref(),
        head_manifest.as_ref(),
        &union,
        layer_nodata,
    )?;

    // Classify the combined incoming validity against existing coverage, so
    // cells claimed by two staged files are counted once.
    let mut combined_incoming = ValidMask::empty(union.width, union.height);
    for source in &compatible {
        let source_mask =
            ValidMask::read_from(&source.valid_mask_path, source.width, source.height)?;
        let remapped = remap_mask(&source_mask, &grid_for_source(source), &union)?;
        for y in 0..union.height {
            for x in 0..union.width {
                if remapped.get(x, y) {
                    combined_incoming.set(x, y, true);
                }
            }
        }
    }
    let classification = classify_coverage(&combined_incoming, layer_mask_on_union.as_ref())?;

    let mut facts: Vec<LidarImportSourceFacts> = Vec::new();
    for source in &staged {
        facts.push(LidarImportSourceFacts {
            filename: source.filename.clone(),
            sha256: source.sha256.clone(),
            size_bytes: source.size_bytes,
            width: source.width,
            height: source.height,
            pixel_size_m: grid_for_source(source).pixel_size().0,
            nodata: source.nodata,
            value_range: source.value_range,
            compatible: source.compatible,
            issues: source.issues.clone(),
        });
    }

    // Fixed-style Before/After previews at one comparison style.
    let before_preview_path = if let Some(head) = head {
        check_cancel(cancel)?;
        let target = job_dir.join("preview-before.png");
        display::generate_preview(
            engine,
            cancel,
            Path::new(&head.mosaic_path),
            Some(layer_nodata),
            &ColorRamp::elevation_range(
                head.min_value.unwrap_or(0.0),
                head.max_value.unwrap_or(1.0),
            ),
            &target,
        )?;
        Some(target)
    } else {
        None
    };

    check_cancel(cancel)?;
    let after_preview_path = {
        let composed = compose_values(
            layer_values.as_deref(),
            layer_mask_on_union.as_ref(),
            &compatible,
            &union,
            layer_nodata,
            true,
            true,
        )?;
        let preview_tif = preview_tif_from_composed(
            engine,
            cancel,
            &job_dir,
            &union,
            &layer_crs_wkt,
            layer_nodata,
            &composed,
        )?;
        let target = job_dir.join("preview-after.png");
        display::generate_preview(
            engine,
            cancel,
            &preview_tif,
            Some(layer_nodata),
            &ColorRamp::elevation_range(
                composed.min_value,
                composed.max_value.max(composed.min_value + 1.0),
            ),
            &target,
        )?;
        let _ = std::fs::remove_file(&preview_tif);
        Some(target)
    };

    let issues: Vec<String> = staged
        .iter()
        .flat_map(|s| s.issues.iter().cloned())
        .collect();

    let staging = StagedImport {
        job_id: job_id.to_string(),
        layer_id: layer_id.to_string(),
        layer_grid,
        layer_crs_wkt,
        layer_nodata,
        union_grid: union,
        sources: staged,
        uncovered_cells: classification.uncovered_cells,
        overlap_cells: classification.overlap_cells,
        invalid_cells: classification.invalid_cells,
        before_preview_path,
        after_preview_path,
        engine_version: engine_version(engine),
    };
    std::fs::write(
        job_dir.join("staging.json"),
        serde_json::to_string(&staging).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to persist staging: {e}"))?;

    let review = LidarImportReview {
        job_id: job_id.to_string(),
        layer_id: layer_id.to_string(),
        sources: facts,
        uncovered_cells: staging.uncovered_cells,
        overlap_cells: staging.overlap_cells,
        invalid_cells: staging.invalid_cells,
        compatible: issues.is_empty(),
        issues,
        before_preview_path: staging
            .before_preview_path
            .as_ref()
            .map(|p| p.display().to_string()),
        after_preview_path: staging
            .after_preview_path
            .as_ref()
            .map(|p| p.display().to_string()),
    };
    Ok(StagingOutput { review })
}

#[allow(clippy::too_many_arguments)]
fn stage_source(
    engine: &GdalEngine,
    paths: &LidarPaths,
    library: &LidarLibrary,
    layer_id: &str,
    measurement_kind: &str,
    units: &str,
    layer_grid: Option<&RasterGrid>,
    layer_crs_wkt: Option<&str>,
    source_path: &Path,
    job_dir: &Path,
) -> Result<StagedSource, String> {
    let filename = source_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unnamed".to_string());

    // Copy accepted originals into managed storage first: exact byte reimports
    // deduplicate, and Downloads can move or disappear.
    let bytes = std::fs::read(source_path)
        .map_err(|e| format!("Failed to read {}: {e}", source_path.display()))?;
    let sha256 = grid::sha256_hex(&bytes);
    let managed_dir = paths.source_dir(&sha256);
    std::fs::create_dir_all(&managed_dir)
        .map_err(|e| format!("Failed to create source dir: {e}"))?;
    let managed_original = paths.source_original(&sha256);
    if !managed_original.exists() {
        std::fs::write(&managed_original, &bytes)
            .map_err(|e| format!("Failed to store original: {e}"))?;
        let manifest = serde_json::json!({
            "sha256": sha256,
            "original_filename": filename,
            "original_path": source_path.display().to_string(),
            "size_bytes": bytes.len(),
            "imported_at": now_iso(),
        });
        std::fs::write(paths.source_manifest(&sha256), manifest.to_string())
            .map_err(|e| format!("Failed to write source manifest: {e}"))?;
    }
    let size_bytes = bytes.len() as u64;

    // Probe from the managed copy so the flow survives user-file changes.
    let probe_json = probe_gdalinfo(engine, &managed_original)?;
    let probe = super::probe::parse_gdalinfo_json(&probe_json)?;

    let mut issues = Vec::new();
    if probe.band_count != 1 {
        issues.push(format!(
            "source has {} bands; Canopi joins single-band numeric rasters",
            probe.band_count
        ));
    }
    if probe.driver != "GTiff" {
        issues.push(format!("driver {} is not GeoTIFF", probe.driver));
    }
    if let Some(expected_wkt) = layer_crs_wkt
        && probe.crs_wkt.trim() != expected_wkt.trim()
    {
        issues.push(
            "horizontal CRS differs from the layer; transforming foreign grids arrives in a later slice"
                .to_string(),
        );
    }

    // Exact valid mask, value range and raw samples from the numeric buffer.
    let raw = raw_f32_bytes(engine, &managed_original, probe.width, probe.height)?;
    let mask = grid::valid_mask_from_f32_raw(probe.width, probe.height, &raw, probe.nodata)?;
    let mask_path = job_dir.join(format!("valid-{sha256}.bin"));
    mask.write_to(&mask_path)?;
    let raw_path = job_dir.join(format!("source-{sha256}.raw"));
    std::fs::write(&raw_path, &raw).map_err(|e| format!("Failed to stage samples: {e}"))?;
    let value_range = raw_value_range(&raw);

    let source_grid = RasterGrid {
        width: probe.width,
        height: probe.height,
        geotransform: probe.geotransform,
    };
    if let Some(expected) = layer_grid
        && let Err(error) = source_grid.compatible(expected)
    {
        issues.push(format!("grid incompatible with layer: {error}"));
    }

    // Interpretation identity: content plus interpretation facts, never names.
    let vertical_ref = "unspecified";
    let interp_hash = grid::sha256_hex(
        format!(
            "{}|1|{measurement_kind}|{units}|{}|{}|{}|{}|{}|{vertical_ref}",
            sha256,
            probe.band_type,
            probe.nodata.map(|v| v.to_string()).unwrap_or_default(),
            format_geotransform(probe.geotransform),
            probe.width,
            probe.height,
        )
        .as_bytes(),
    );

    // Short write: durable source + interpretation identity.
    let connection = library.catalogue()?;
    connection
        .execute(
            "INSERT INTO lidar_sources(sha256, original_filename, size_bytes, probe_json, imported_at)
             VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(sha256) DO NOTHING",
            rusqlite::params![sha256, filename, size_bytes as i64, probe_json, now_iso()],
        )
        .map_err(|e| format!("Failed to record source: {e}"))?;
    connection
        .execute(
            "INSERT INTO lidar_interpretations(
                id, source_sha256, band_index, measurement_kind, units, scale, offset,
                crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
             VALUES(?1, ?2, 1, ?3, ?4, 1, 0, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(interp_hash) DO NOTHING",
            rusqlite::params![
                format!("interp-{interp_hash}"),
                sha256,
                measurement_kind,
                units,
                probe.crs_wkt,
                vertical_ref,
                probe.nodata,
                format_geotransform(probe.geotransform),
                probe.width as i64,
                probe.height as i64,
                interp_hash,
            ],
        )
        .map_err(|e| format!("Failed to record interpretation: {e}"))?;
    let _ = layer_id;

    Ok(StagedSource {
        filename,
        sha256,
        managed_original,
        interp_hash,
        width: probe.width,
        height: probe.height,
        geotransform: probe.geotransform,
        crs_wkt: probe.crs_wkt.clone(),
        nodata: probe.nodata,
        value_range,
        size_bytes,
        valid_mask_path: mask_path,
        raw_samples_path: raw_path,
        compatible: issues.is_empty(),
        issues,
    })
}

// ---------------------------------------------------------------------------
// Composition (exact, pure Rust over Float32 buffers)
// ---------------------------------------------------------------------------

pub struct ComposedMosaic {
    pub values: Vec<f32>,
    pub valid: ValidMask,
    pub min_value: f64,
    pub max_value: f64,
}

/// Full-value composite including existing raster values. Invalid pixels
/// never erase accepted coverage; overlap pixels are replaced only when the
/// user explicitly approved replacement. Later staged sources win where two
/// of them claim the same previously uncovered cell.
pub fn compose_values(
    layer_values_on_union: Option<&[f32]>,
    layer_on_union: Option<&ValidMask>,
    sources: &[&StagedSource],
    union: &RasterGrid,
    nodata: f32,
    add_uncovered: bool,
    replace_overlap: bool,
) -> Result<ComposedMosaic, String> {
    let mut values = vec![nodata; (union.width as usize) * (union.height as usize)];
    let mut valid = ValidMask::empty(union.width, union.height);
    if let Some(layer_mask) = layer_on_union {
        for y in 0..union.height {
            for x in 0..union.width {
                if layer_mask.get(x, y) {
                    valid.set(x, y, true);
                }
            }
        }
    }
    if let Some(layer_values) = layer_values_on_union {
        values.copy_from_slice(layer_values);
    }
    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;
    {
        for index in valid
            .bytes()
            .iter()
            .enumerate()
            .filter(|(_, b)| **b != 0)
            .map(|(i, _)| i)
        {
            let value = values[index];
            if value.is_finite() {
                min_value = min_value.min(value as f64);
                max_value = max_value.max(value as f64);
            }
        }
    }
    for source in sources {
        let raw = std::fs::read(&source.raw_samples_path)
            .map_err(|e| format!("Failed to read staged samples: {e}"))?;
        let samples = read_f32_samples(&raw, source.width, source.height)?;
        let source_mask =
            ValidMask::read_from(&source.valid_mask_path, source.width, source.height)?;
        let offset_x = ((source.geotransform[0] - union.geotransform[0]) / union.geotransform[1])
            .round() as i64;
        let offset_y = ((union.geotransform[3] - source.geotransform[3])
            / union.geotransform[5].abs())
        .round() as i64;
        for y in 0..source.height {
            let ty = offset_y + y as i64;
            if ty < 0 || ty >= union.height as i64 {
                continue;
            }
            for x in 0..source.width {
                let tx = offset_x + x as i64;
                if tx < 0 || tx >= union.width as i64 {
                    continue;
                }
                if !source_mask.get(x, y) {
                    continue;
                }
                let covered = valid.get(tx as u32, ty as u32);
                let paint = if covered {
                    replace_overlap
                } else {
                    add_uncovered
                };
                if paint {
                    let sample = samples[(y * source.width + x) as usize];
                    values[ty as usize * union.width as usize + tx as usize] = sample;
                    valid.set(tx as u32, ty as u32, true);
                    if sample.is_finite() {
                        min_value = min_value.min(sample as f64);
                        max_value = max_value.max(sample as f64);
                    }
                }
            }
        }
    }
    if !min_value.is_finite() {
        min_value = 0.0;
        max_value = 0.0;
    }
    Ok(ComposedMosaic {
        values,
        valid,
        min_value,
        max_value,
    })
}

// ---------------------------------------------------------------------------
// Apply / publish
// ---------------------------------------------------------------------------

pub struct ApplyOutcome {
    pub generation_id: String,
    pub published_cells: u64,
    pub changed: bool,
    pub message: Option<String>,
}

impl ApplyOutcome {
    /// Summary used in structured logs so the immutable generation identity
    /// is recorded with the publication.
    pub fn summary(&self) -> String {
        format!(
            "generation {} published with {} cells (changed: {})",
            self.generation_id, self.published_cells, self.changed
        )
    }
}

pub fn apply_import(
    library: &LidarLibrary,
    staging: &StagedImport,
    add_uncovered: bool,
    replace_overlap: bool,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    let layer_id = staging.layer_id.clone();
    let union = staging.union_grid.clone();

    // Short read: head snapshot, then release the catalogue before computing.
    let head = {
        let connection = library.catalogue()?;
        catalogue::head_generation(&connection, &layer_id)?
    };
    let head_manifest = match &head {
        Some(head) => Some(read_generation_manifest(&head.manifest_json)?),
        None => None,
    };
    let (layer_values, layer_mask_on_union) = head_values_on_union(
        engine,
        head.as_ref(),
        head_manifest.as_ref(),
        &union,
        staging.layer_nodata,
    )?;

    let compatible: Vec<&StagedSource> = staging.sources.iter().filter(|s| s.compatible).collect();
    let composed = compose_values(
        layer_values.as_deref(),
        layer_mask_on_union.as_ref(),
        &compatible,
        &union,
        staging.layer_nodata,
        add_uncovered,
        replace_overlap,
    )?;
    let published_cells = composed.valid.count_valid();
    let previous_cells = head.as_ref().map(|h| h.coverage_cells).unwrap_or(0);

    if published_cells == 0 {
        return Ok(ApplyOutcome {
            generation_id: head.as_ref().map(|h| h.id.clone()).unwrap_or_default(),
            published_cells: 0,
            changed: false,
            message: Some("selection contains no valid pixels; nothing published".to_string()),
        });
    }
    if head.is_some() && published_cells == previous_cells as u64 && !replace_overlap {
        return Ok(ApplyOutcome {
            generation_id: head.as_ref().map(|h| h.id.clone()).unwrap_or_default(),
            published_cells,
            changed: false,
            message: Some(
                "selection added no accepted coverage; existing generation kept".to_string(),
            ),
        });
    }

    // Write the prepared mosaic + coverage mask into staging.
    let generation_id = new_id("gen");
    let pipeline_dir = paths.layer_pipeline_dir(&layer_id);
    let staging_dir = pipeline_dir.join(format!("staging-{generation_id}"));
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create staging dir: {e}"))?;
    let raw_path = staging_dir.join("mosaic.raw");
    write_f32_raw(&raw_path, &composed.values)?;
    let mosaic_path = staging_dir.join("mosaic.tif");
    let crs_wkt = staging.layer_crs_wkt.clone().unwrap_or_else(|| {
        compatible
            .first()
            .map(|s| s.crs_wkt.clone())
            .unwrap_or_default()
    });
    raw_to_tif(
        engine,
        cancel,
        &raw_path,
        &mosaic_path,
        &union,
        &crs_wkt,
        staging.layer_nodata,
    )?;
    let coverage_path = staging_dir.join("coverage.bin");
    composed.valid.write_to(&coverage_path)?;
    let _ = std::fs::remove_file(&raw_path);

    let manifest = GenerationManifest {
        grid: union.clone(),
        nodata: staging.layer_nodata,
        crs_wkt: crs_wkt.clone(),
        members: compatible.iter().map(|s| s.interp_hash.clone()).collect(),
        engine_version: staging.engine_version.clone(),
        created_at: now_iso(),
    };
    let manifest_json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(staging_dir.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("Failed to write manifest: {e}"))?;

    let bounds_3857 = raster_bounds_3857(engine, cancel, &union, &crs_wkt)?;

    // Atomic publish: rename staging into place, then advance the head in
    // one short transaction.
    let generation_dir = pipeline_dir.join(format!("gen-{generation_id}"));
    std::fs::rename(&staging_dir, &generation_dir)
        .map_err(|e| format!("Failed to publish generation dir: {e}"))?;
    let final_mosaic = generation_dir.join("mosaic.tif");
    let final_coverage = generation_dir.join("coverage.bin");
    {
        let connection = library.catalogue()?;
        connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let publish = (|| -> Result<(), String> {
            connection
                .execute(
                    "INSERT INTO lidar_layer_generations(id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json, coverage_cells, min_value, max_value, bounds_3857)
                     VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    rusqlite::params![
                        generation_id,
                        layer_id,
                        now_iso(),
                        final_mosaic.display().to_string(),
                        final_coverage.display().to_string(),
                        manifest_json,
                        published_cells as i64,
                        composed.min_value,
                        composed.max_value,
                        serde_json::to_string(&bounds_3857).map_err(|e| e.to_string())?,
                    ],
                )
                .map_err(|e| e.to_string())?;
            for (ordinal, source) in compatible.iter().enumerate() {
                let interpretation_id = format!("interp-{}", source.interp_hash);
                let role = if replace_overlap { "replace" } else { "add" };
                connection
                    .execute(
                        "INSERT INTO lidar_generation_members(generation_id, interpretation_id, role, ordinal)
                         VALUES(?1, ?2, ?3, ?4)",
                        rusqlite::params![generation_id, interpretation_id, role, ordinal as i64],
                    )
                    .map_err(|e| e.to_string())?;
                connection
                    .execute(
                        "INSERT INTO lidar_acceptance_regions(id, generation_id, interpretation_id, decision)
                         VALUES(?1, ?2, ?3, ?4)",
                        rusqlite::params![new_id("acc"), generation_id, interpretation_id, role],
                    )
                    .map_err(|e| e.to_string())?;
            }
            connection
                .execute(
                    "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES(?1, ?2)
                     ON CONFLICT(layer_id) DO UPDATE SET generation_id = excluded.generation_id",
                    rusqlite::params![layer_id, generation_id],
                )
                .map_err(|e| e.to_string())?;
            connection
                .execute(
                    "UPDATE lidar_import_jobs SET state = 'complete', updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![staging.job_id, now_iso()],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        match publish {
            Ok(()) => connection
                .execute_batch("COMMIT")
                .map_err(|e| e.to_string())?,
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        }
    }

    // Display pyramid is a presentation artifact: failures degrade silently
    // while the numeric result stays authoritative.
    publish_display(
        library,
        cancel,
        "source",
        &layer_id,
        &generation_id,
        &final_mosaic,
        Some(staging.layer_nodata),
        &ColorRamp::elevation_range(
            composed.min_value,
            composed.max_value.max(composed.min_value + 1.0),
        ),
    );

    Ok(ApplyOutcome {
        generation_id,
        published_cells,
        changed: true,
        message: None,
    })
}

/// Best-effort display publication; presentation degrades silently when the
/// engine or disk fails. Tile generation happens without any lock; only the
/// cache row write takes the display-cache mutex.
#[allow(clippy::too_many_arguments)]
pub fn publish_display(
    library: &LidarLibrary,
    cancel: &AtomicBool,
    entity_kind: &str,
    entity_id: &str,
    generation_id: &str,
    numeric_raster: &Path,
    nodata: Option<f32>,
    ramp: &ColorRamp,
) {
    let style = ramp.style_name();
    let dir =
        library
            .inner
            .paths
            .display_generation_dir(entity_kind, entity_id, generation_id, style);
    match display::generate_pyramid(
        &library.inner.engine,
        cancel,
        numeric_raster,
        nodata,
        ramp,
        &dir,
    ) {
        Ok(pyramid) => {
            let display = library.display();
            let Ok(display) = display else {
                return;
            };
            let key = format!("{entity_kind}/{entity_id}/{generation_id}/{style}");
            let _ = display.execute(
                "INSERT INTO tilesets(key, entity_kind, entity_id, generation_id, style, dir, path_template, min_zoom, max_zoom, bounds_3857, tile_count, bytes, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(key) DO UPDATE SET
                    dir=excluded.dir, path_template=excluded.path_template,
                    min_zoom=excluded.min_zoom, max_zoom=excluded.max_zoom,
                    bounds_3857=excluded.bounds_3857, tile_count=excluded.tile_count,
                    bytes=excluded.bytes",
                rusqlite::params![
                    key,
                    entity_kind,
                    entity_id,
                    generation_id,
                    style,
                    dir.display().to_string(),
                    pyramid.path_template,
                    pyramid.min_zoom as i64,
                    pyramid.max_zoom as i64,
                    serde_json::to_string(&pyramid.bounds_3857).unwrap_or_default(),
                    pyramid.tile_count as i64,
                    pyramid.bytes as i64,
                    now_iso(),
                ],
            );
        }
        Err(error) => {
            tracing::warn!(
                entity_kind,
                entity_id,
                generation_id,
                error,
                "LiDAR display rendering failed; presentation degrades without tiles"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Existing accepted values and coverage remapped onto the union grid.
#[allow(clippy::type_complexity)]
fn head_values_on_union(
    engine: &GdalEngine,
    head: Option<&catalogue::GenerationRow>,
    manifest: Option<&GenerationManifest>,
    union: &RasterGrid,
    nodata: f32,
) -> Result<(Option<Vec<f32>>, Option<ValidMask>), String> {
    let Some(head) = head else {
        return Ok((None, None));
    };
    let manifest = manifest.ok_or("generation manifest is missing")?;
    let raw = raw_f32_bytes(
        engine,
        Path::new(&head.mosaic_path),
        manifest.grid.width,
        manifest.grid.height,
    )?;
    let samples = read_f32_samples(&raw, manifest.grid.width, manifest.grid.height)?;
    let layer_mask = ValidMask::read_from(
        Path::new(&head.coverage_mask_path),
        manifest.grid.width,
        manifest.grid.height,
    )?;
    let mut expanded = vec![nodata; (union.width as usize) * (union.height as usize)];
    let offset_x = ((manifest.grid.geotransform[0] - union.geotransform[0]) / union.geotransform[1])
        .round() as i64;
    let offset_y = ((union.geotransform[3] - manifest.grid.geotransform[3])
        / union.geotransform[5].abs())
    .round() as i64;
    for y in 0..manifest.grid.height {
        let ty = offset_y + y as i64;
        if ty < 0 || ty >= union.height as i64 {
            continue;
        }
        for x in 0..manifest.grid.width {
            let tx = offset_x + x as i64;
            if tx < 0 || tx >= union.width as i64 {
                continue;
            }
            if layer_mask.get(x, y) {
                expanded[ty as usize * union.width as usize + tx as usize] =
                    samples[(y * manifest.grid.width + x) as usize];
            }
        }
    }
    let remapped = remap_mask(&layer_mask, &manifest.grid, union)?;
    Ok((Some(expanded), Some(remapped)))
}

fn preview_tif_from_composed(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    job_dir: &Path,
    union: &RasterGrid,
    crs_wkt: &Option<String>,
    nodata: f32,
    composed: &ComposedMosaic,
) -> Result<PathBuf, String> {
    let raw = job_dir.join("after-preview.raw");
    write_f32_raw(&raw, &composed.values)?;
    let tif = job_dir.join("after-preview.tif");
    raw_to_tif(
        engine,
        cancel,
        &raw,
        &tif,
        union,
        crs_wkt.as_deref().unwrap_or(""),
        nodata,
    )?;
    let _ = std::fs::remove_file(&raw);
    Ok(tif)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationManifest {
    pub grid: RasterGrid,
    pub nodata: f32,
    pub crs_wkt: String,
    pub members: Vec<String>,
    pub engine_version: String,
    pub created_at: String,
}

pub fn read_generation_manifest(json: &str) -> Result<GenerationManifest, String> {
    serde_json::from_str(json).map_err(|e| format!("Invalid generation manifest: {e}"))
}

pub fn raw_f32_bytes(
    engine: &GdalEngine,
    raster: &Path,
    width: u32,
    height: u32,
) -> Result<Vec<u8>, String> {
    let token = grid::sha256_hex(raster.display().to_string().as_bytes());
    let token: String = token.chars().take(16).collect();
    let scratch =
        std::env::temp_dir().join(format!("canopi-lidar-{}-{token}.raw", std::process::id()));
    engine.run(
        GdalProgram::Translate,
        &[
            "-q".to_string(),
            "-ot".to_string(),
            "Float32".to_string(),
            "-of".to_string(),
            "ENVI".to_string(),
            raster.display().to_string(),
            scratch.display().to_string(),
        ],
        None,
    )?;
    let bytes = std::fs::read(&scratch).map_err(|e| format!("Failed to read raw raster: {e}"))?;
    let _ = std::fs::remove_file(&scratch);
    let _ = std::fs::remove_file(scratch.with_extension("raw.aux.xml"));
    let expected = width as usize * height as usize * 4;
    if bytes.len() < expected {
        return Err(format!(
            "raw raster buffer has {} bytes, expected {expected}",
            bytes.len()
        ));
    }
    Ok(bytes)
}

pub fn read_f32_samples(raw: &[u8], width: u32, height: u32) -> Result<Vec<f32>, String> {
    let expected = width as usize * height as usize;
    if raw.len() < expected * 4 {
        return Err("raw buffer too small".to_string());
    }
    Ok(raw[..expected * 4]
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

pub fn write_f32_raw(path: &Path, values: &[f32]) -> Result<(), String> {
    let mut bytes = Vec::with_capacity(values.len() * 4);
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    std::fs::write(path, bytes).map_err(|e| format!("Failed to write raw buffer: {e}"))
}

/// Convert a raw Float32 buffer into a georeferenced tiled GeoTIFF.
pub fn raw_to_tif(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    raw: &Path,
    tif: &Path,
    grid: &RasterGrid,
    crs_wkt: &str,
    nodata: f32,
) -> Result<(), String> {
    let hdr = raw.with_extension("hdr");
    std::fs::write(
        &hdr,
        format!(
            "ENVI\nsamples = {}\nlines = {}\nbands = 1\ndata type = 4\nbyte order = 0\nheader offset = 0\n",
            grid.width, grid.height
        ),
    )
    .map_err(|e| format!("Failed to write ENVI header: {e}"))?;
    let result = engine.run(
        GdalProgram::Translate,
        &[
            "-q".to_string(),
            "-ot".to_string(),
            "Float32".to_string(),
            "-a_srs".to_string(),
            crs_wkt.to_string(),
            "-a_ullr".to_string(),
            format!("{}", grid.geotransform[0]),
            format!("{}", grid.geotransform[3]),
            format!(
                "{}",
                grid.geotransform[0] + grid.geotransform[1] * grid.width as f64
            ),
            format!(
                "{}",
                grid.geotransform[3] + grid.geotransform[5] * grid.height as f64
            ),
            "-a_nodata".to_string(),
            format!("{nodata}"),
            "-co".to_string(),
            "TILED=YES".to_string(),
            "-co".to_string(),
            "COMPRESS=DEFLATE".to_string(),
            "-co".to_string(),
            "PREDICTOR=3".to_string(),
            raw.display().to_string(),
            tif.display().to_string(),
        ],
        Some(cancel),
    );
    let _ = std::fs::remove_file(&hdr);
    result.map(|_| ())
}

/// Projected bounds in EPSG:3857 for presentation fit and tile alignment.
pub fn raster_bounds_3857(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    grid: &RasterGrid,
    crs_wkt: &str,
) -> Result<[f64; 4], String> {
    let bounds = grid.bounds();
    let corners = [
        (bounds[0], bounds[1]),
        (bounds[2], bounds[1]),
        (bounds[2], bounds[3]),
        (bounds[0], bounds[3]),
    ];
    let input = corners
        .iter()
        .map(|(x, y)| format!("{x} {y}\n"))
        .collect::<String>();
    let tools = engine.discover()?;
    let mut child = std::process::Command::new(&tools.gdaltransform)
        .arg("-s_srs")
        .arg(crs_wkt)
        .arg("-t_srs")
        .arg("EPSG:3857")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start gdaltransform: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(input.as_bytes());
    }
    drop(child.stdin.take());
    let mut output = String::new();
    if let Some(stdout) = child.stdout.as_mut() {
        let _ = stdout.read_to_string(&mut output);
    }
    let status = child.wait();
    if !status.map(|s| s.success()).unwrap_or(false) {
        return Err("gdaltransform failed to project layer bounds".to_string());
    }
    check_cancel(cancel)?;
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for line in output.lines() {
        let parts: Vec<f64> = line
            .split_whitespace()
            .filter_map(|v| v.parse::<f64>().ok())
            .collect();
        if parts.len() >= 2 {
            min_x = min_x.min(parts[0]);
            max_x = max_x.max(parts[0]);
            min_y = min_y.min(parts[1]);
            max_y = max_y.max(parts[1]);
        }
    }
    if !min_x.is_finite() {
        return Err("gdaltransform produced no projected corners".to_string());
    }
    Ok([min_x, min_y, max_x, max_y])
}

fn probe_gdalinfo(engine: &GdalEngine, raster: &Path) -> Result<String, String> {
    let output = engine.run(
        GdalProgram::Info,
        &["-json".to_string(), raster.display().to_string()],
        None,
    )?;
    Ok(output.stdout)
}

fn raw_value_range(raw: &[u8]) -> [f64; 2] {
    let mut min = f64::INFINITY;
    let mut max = f64::NEG_INFINITY;
    for chunk in raw.chunks_exact(4) {
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if value.is_finite() {
            min = min.min(value as f64);
            max = max.max(value as f64);
        }
    }
    if !min.is_finite() {
        [0.0, 0.0]
    } else {
        [min, max]
    }
}

fn grid_for_source(source: &StagedSource) -> RasterGrid {
    RasterGrid {
        width: source.width,
        height: source.height,
        geotransform: source.geotransform,
    }
}

fn format_geotransform(gt: GeoTransform) -> String {
    gt.iter()
        .map(|v| format!("{v}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn engine_version(engine: &GdalEngine) -> String {
    engine.discover().map(|t| t.version).unwrap_or_default()
}

pub fn check_cancel(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".to_string());
    }
    Ok(())
}
