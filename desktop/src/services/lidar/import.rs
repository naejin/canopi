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
    self, GeoTransform, RasterGrid, ValidMask, classify_coverage, remap_mask_checked, union_grid,
};
use super::paths::LidarPaths;
use super::prepared_raster::PreparedRaster;
use common_types::lidar::{
    LidarImportDecisionPreview, LidarImportProgressPhase, LidarImportReview, LidarImportSourceFacts,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read as _, Seek as _, SeekFrom, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Canonical NoData used for a layer whose first source declares none.
pub const FALLBACK_NODATA: f32 = -99999.0;
const MAX_SOURCE_FILES_PER_IMPORT: usize = 16;
const MAX_SOURCE_FILE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_IMPORT_SOURCE_BYTES: u64 = 1024 * 1024 * 1024;
pub(crate) const MAX_DENSE_WORKING_CELLS: u64 = 25_000_000;

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
    /// Head generation the review was planned against; apply detects a
    /// changed head and recomputes the plan instead of publishing stale
    /// decisions.
    #[serde(default)]
    pub planned_against_head: Option<String>,
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
    validate_source_selection(source_paths)?;

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
            cancel,
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
    validate_working_grid(&union, "import review")?;
    let mut layer_nodata = layer_nodata;
    if head_manifest.is_none() {
        layer_nodata = compatible[0].nodata.unwrap_or(FALLBACK_NODATA);
    }
    for source in &compatible {
        union = union_grid(&union, &grid_for_source(source))?;
        validate_working_grid(&union, "import review union")?;
    }

    // Existing accepted values and coverage on the union grid.
    let (layer_values, layer_mask_on_union) = head_values_on_union(
        engine,
        head.as_ref(),
        head_manifest.as_ref(),
        &union,
        layer_nodata,
        cancel,
    )?;

    // R-tree candidate guard: when every accepted member has a footprint,
    // an incoming extent intersecting none of them must classify without
    // overlap. This cross-checks exact masks against the spatial index.
    let incoming_bounds =
        compatible
            .iter()
            .map(|s| grid_for_source(s).bounds())
            .fold(union.bounds(), |acc, b| {
                [
                    acc[0].min(b[0]),
                    acc[1].min(b[1]),
                    acc[2].max(b[2]),
                    acc[3].max(b[3]),
                ]
            });
    let (all_members_footprinted, member_count) = if let Some(head_row) = &head {
        let connection = library.catalogue()?;
        let member_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM lidar_generation_members WHERE generation_id = ?1",
                [&head_row.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        let footprint_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM lidar_source_footprints WHERE layer_id = ?1",
                [layer_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        (
            member_count > 0 && footprint_count >= member_count,
            member_count,
        )
    } else {
        (false, 0)
    };
    let footprint_candidates: Vec<String> = if member_count == 0 || all_members_footprinted {
        let connection = library.catalogue()?;
        catalogue::footprint_candidates(&connection, incoming_bounds)?
    } else {
        Vec::new()
    };

    // Classify the combined incoming validity against existing coverage, so
    // cells claimed by two staged files are counted once.
    let mut combined_incoming = ValidMask::empty(union.width, union.height);
    for source in &compatible {
        let source_mask =
            ValidMask::read_from(&source.valid_mask_path, source.width, source.height)?;
        let remapped = remap_mask_checked(&source_mask, &grid_for_source(source), &union, |_| {
            check_cancel(cancel)
        })?;
        for y in 0..union.height {
            check_cancel(cancel)?;
            for x in 0..union.width {
                if remapped.get(x, y) {
                    combined_incoming.set(x, y, true);
                }
            }
        }
    }
    let classification = classify_coverage(&combined_incoming, layer_mask_on_union.as_ref())?;
    if all_members_footprinted
        && footprint_candidates.is_empty()
        && classification.overlap_cells > 0
    {
        return Err(
            "spatial index reports no overlapping members but exact masks disagree".to_string(),
        );
    }

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

    // Fixed-style Before/After previews share one value scale. The initial
    // review reflects the UI's default decision: add uncovered coverage and
    // preserve overlap.
    check_cancel(cancel)?;
    let preview_composed = compose_values_cancellable(
        layer_values.as_deref(),
        layer_mask_on_union.as_ref(),
        &compatible,
        &union,
        layer_nodata,
        true,
        false,
        Some(cancel),
    )?;
    let preview_min = head
        .as_ref()
        .and_then(|row| row.min_value)
        .unwrap_or(preview_composed.min_value)
        .min(preview_composed.min_value);
    let preview_max = head
        .as_ref()
        .and_then(|row| row.max_value)
        .unwrap_or(preview_composed.max_value)
        .max(preview_composed.max_value)
        .max(preview_min + 1.0);
    let preview_ramp = ColorRamp::elevation_range(preview_min, preview_max);
    let before_preview_path = if let Some(head) = &head {
        check_cancel(cancel)?;
        let target = job_dir.join("preview-before.png");
        display::generate_preview(
            engine,
            cancel,
            Path::new(&head.mosaic_path),
            Some(layer_nodata),
            &preview_ramp,
            &target,
        )?;
        Some(target)
    } else {
        None
    };
    let after_preview_path = {
        let preview_tif = preview_tif_from_composed(
            engine,
            cancel,
            &job_dir,
            "default",
            &union,
            &layer_crs_wkt,
            layer_nodata,
            &preview_composed,
        )?;
        let target = job_dir.join("preview-after.png");
        display::generate_preview(
            engine,
            cancel,
            &preview_tif,
            Some(layer_nodata),
            &preview_ramp,
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
        planned_against_head: head.as_ref().map(|h| h.id.clone()),
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

pub fn render_decision_preview(
    library: &LidarLibrary,
    staging: &StagedImport,
    add_uncovered: bool,
    replace_overlap: bool,
    cancel: &AtomicBool,
) -> Result<LidarImportDecisionPreview, String> {
    if !add_uncovered && !replace_overlap {
        return Err("select at least one coverage change to preview".to_string());
    }
    check_cancel(cancel)?;
    let (head, head_manifest) = {
        let connection = library.catalogue()?;
        let head = catalogue::head_generation(&connection, &staging.layer_id)?;
        let manifest = head
            .as_ref()
            .map(|row| read_generation_manifest(&row.manifest_json))
            .transpose()?;
        (head, manifest)
    };
    if head.as_ref().map(|row| row.id.as_str()) != staging.planned_against_head.as_deref() {
        return Err("import review is stale; review the current coverage again".to_string());
    }
    let compatible: Vec<&StagedSource> = staging
        .sources
        .iter()
        .filter(|source| source.compatible)
        .collect();
    if compatible.is_empty() {
        return Err("import has no compatible sources to preview".to_string());
    }
    validate_working_grid(&staging.union_grid, "import decision preview")?;
    let (layer_values, layer_mask) = head_values_on_union(
        &library.inner.engine,
        head.as_ref(),
        head_manifest.as_ref(),
        &staging.union_grid,
        staging.layer_nodata,
        cancel,
    )?;
    let composed = compose_values_cancellable(
        layer_values.as_deref(),
        layer_mask.as_ref(),
        &compatible,
        &staging.union_grid,
        staging.layer_nodata,
        add_uncovered,
        replace_overlap,
        Some(cancel),
    )?;
    let preview_min = head
        .as_ref()
        .and_then(|row| row.min_value)
        .unwrap_or(composed.min_value)
        .min(composed.min_value);
    let preview_max = head
        .as_ref()
        .and_then(|row| row.max_value)
        .unwrap_or(composed.max_value)
        .max(composed.max_value)
        .max(preview_min + 1.0);
    let ramp = ColorRamp::elevation_range(preview_min, preview_max);
    let decision_key = format!("{}{}", u8::from(add_uncovered), u8::from(replace_overlap));
    let job_dir = library.inner.paths.job_dir(&staging.job_id);
    let before_preview_path = if let Some(head) = &head {
        let target = job_dir.join(format!("preview-before-{decision_key}.png"));
        display::generate_preview(
            &library.inner.engine,
            cancel,
            Path::new(&head.mosaic_path),
            Some(staging.layer_nodata),
            &ramp,
            &target,
        )?;
        Some(target.display().to_string())
    } else {
        None
    };
    let preview_tif = preview_tif_from_composed(
        &library.inner.engine,
        cancel,
        &job_dir,
        &format!("decision-{decision_key}"),
        &staging.union_grid,
        &staging.layer_crs_wkt,
        staging.layer_nodata,
        &composed,
    )?;
    let after_target = job_dir.join(format!("preview-after-{decision_key}.png"));
    let rendered = display::generate_preview(
        &library.inner.engine,
        cancel,
        &preview_tif,
        Some(staging.layer_nodata),
        &ramp,
        &after_target,
    );
    let _ = std::fs::remove_file(&preview_tif);
    rendered?;
    Ok(LidarImportDecisionPreview {
        add_uncovered,
        replace_overlap,
        before_preview_path,
        after_preview_path: after_target.display().to_string(),
    })
}

fn validate_source_selection(source_paths: &[PathBuf]) -> Result<(), String> {
    if source_paths.is_empty() {
        return Err("select at least one raster source".to_string());
    }
    if source_paths.len() > MAX_SOURCE_FILES_PER_IMPORT {
        return Err(format!(
            "an import can contain at most {MAX_SOURCE_FILES_PER_IMPORT} source files"
        ));
    }
    let mut total_bytes = 0u64;
    for path in source_paths {
        let metadata = std::fs::metadata(path)
            .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a regular file", path.display()));
        }
        if metadata.len() > MAX_SOURCE_FILE_BYTES {
            return Err(format!(
                "{} is larger than the {} MiB per-source limit",
                path.display(),
                MAX_SOURCE_FILE_BYTES / (1024 * 1024),
            ));
        }
        total_bytes = total_bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "selected source sizes overflow the import budget".to_string())?;
    }
    if total_bytes > MAX_IMPORT_SOURCE_BYTES {
        return Err(format!(
            "selected sources exceed the {} MiB import limit",
            MAX_IMPORT_SOURCE_BYTES / (1024 * 1024),
        ));
    }
    Ok(())
}

pub(crate) fn validate_working_grid(grid: &RasterGrid, operation: &str) -> Result<(), String> {
    let cells = u64::from(grid.width)
        .checked_mul(u64::from(grid.height))
        .ok_or_else(|| format!("{operation} dimensions overflow"))?;
    if cells > MAX_DENSE_WORKING_CELLS {
        return Err(format!(
            "{operation} requires {cells} cells; the current dense raster engine limit is {MAX_DENSE_WORKING_CELLS}"
        ));
    }
    Ok(())
}

fn stage_managed_original(
    paths: &LidarPaths,
    source_path: &Path,
    job_dir: &Path,
    filename: &str,
) -> Result<(String, PathBuf, u64), String> {
    let temporary = job_dir.join(format!("source-copy-{}.tmp", new_id("copy")));
    let copied = (|| -> Result<(String, u64), String> {
        let mut source = std::io::BufReader::new(
            std::fs::File::open(source_path)
                .map_err(|e| format!("Failed to open {}: {e}", source_path.display()))?,
        );
        let target_file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|e| format!("Failed to create managed source staging: {e}"))?;
        let mut target = std::io::BufWriter::new(target_file);
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = source
                .read(&mut buffer)
                .map_err(|e| format!("Failed to read {}: {e}", source_path.display()))?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read as u64)
                .ok_or_else(|| "source byte count overflow".to_string())?;
            if total > MAX_SOURCE_FILE_BYTES {
                return Err(format!(
                    "{} grew beyond the {} MiB per-source limit while being read",
                    source_path.display(),
                    MAX_SOURCE_FILE_BYTES / (1024 * 1024),
                ));
            }
            hasher.update(&buffer[..read]);
            target
                .write_all(&buffer[..read])
                .map_err(|e| format!("Failed to stage managed source: {e}"))?;
        }
        target
            .flush()
            .map_err(|e| format!("Failed to flush managed source: {e}"))?;
        target
            .get_ref()
            .sync_all()
            .map_err(|e| format!("Failed to sync managed source: {e}"))?;
        Ok((format!("{:x}", hasher.finalize()), total))
    })();
    let (sha256, size_bytes) = match copied {
        Ok(result) => result,
        Err(error) => {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
    };

    let managed_dir = paths.source_dir(&sha256);
    std::fs::create_dir_all(&managed_dir)
        .map_err(|e| format!("Failed to create source dir: {e}"))?;
    let managed_original = paths.source_original(&sha256);
    if managed_original.exists() {
        let (existing_hash, existing_size) = hash_file_limited(&managed_original)?;
        if existing_hash != sha256 || existing_size != size_bytes {
            let _ = std::fs::remove_file(&temporary);
            return Err(format!(
                "managed source {} failed integrity verification",
                managed_original.display()
            ));
        }
        let _ = std::fs::remove_file(&temporary);
    } else {
        std::fs::rename(&temporary, &managed_original)
            .map_err(|e| format!("Failed to publish managed source: {e}"))?;
    }

    let manifest_path = paths.source_manifest(&sha256);
    if !manifest_path.exists() {
        let manifest = serde_json::json!({
            "sha256": sha256,
            "original_filename": filename,
            "original_path": source_path.display().to_string(),
            "size_bytes": size_bytes,
            "imported_at": now_iso(),
        });
        std::fs::write(&manifest_path, manifest.to_string())
            .map_err(|e| format!("Failed to write source manifest: {e}"))?;
    }
    Ok((sha256, managed_original, size_bytes))
}

fn hash_file_limited(path: &Path) -> Result<(String, u64), String> {
    let mut file = std::io::BufReader::new(
        std::fs::File::open(path)
            .map_err(|e| format!("Failed to verify {}: {e}", path.display()))?,
    );
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to verify {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or_else(|| "managed source size overflow".to_string())?;
        if total > MAX_SOURCE_FILE_BYTES {
            return Err("managed source exceeds the per-source limit".to_string());
        }
        hasher.update(&buffer[..read]);
    }
    Ok((format!("{:x}", hasher.finalize()), total))
}

fn units_compatible(source: &str, layer: &str) -> bool {
    let normalize = |value: &str| value.trim().to_ascii_lowercase();
    let source = normalize(source);
    let layer = normalize(layer);
    source == layer
        || matches!(
            source.as_str(),
            "m" | "metre" | "metres" | "meter" | "meters"
        ) && matches!(
            layer.as_str(),
            "m" | "metre" | "metres" | "meter" | "meters"
        )
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
    cancel: &AtomicBool,
) -> Result<StagedSource, String> {
    let filename = source_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unnamed".to_string());

    // Stream the source once into job-owned staging while hashing it. This
    // avoids loading an arbitrary TIFF into memory and lets an existing
    // deduplicated original be verified before it is trusted.
    let (sha256, managed_original, size_bytes) =
        stage_managed_original(paths, source_path, job_dir, &filename)?;

    // Probe from the managed copy so the flow survives user-file changes.
    let probe_json = probe_gdalinfo(engine, &managed_original, cancel)?;
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
    if probe.geotransform[1] <= 0.0
        || probe.geotransform[5] >= 0.0
        || probe.geotransform[2].abs() > 1e-12
        || probe.geotransform[4].abs() > 1e-12
    {
        issues.push(
            "rotated, reflected, or south-up rasters are not supported by the current grid engine"
                .to_string(),
        );
    }
    if (probe.scale - 1.0).abs() > f64::EPSILON || probe.offset.abs() > f64::EPSILON {
        issues.push(
            "band scale/offset metadata is not supported; materialize physical values before import"
                .to_string(),
        );
    }
    if probe
        .mask_flags
        .iter()
        .any(|flag| !flag.eq_ignore_ascii_case("ALL_VALID"))
    {
        issues.push(
            "dataset validity masks are not supported; encode invalid cells as declared NoData"
                .to_string(),
        );
    }
    if let Some(unit) = probe.unit.as_deref()
        && !units_compatible(unit, units)
    {
        issues.push(format!(
            "band unit '{unit}' does not match layer unit '{units}'"
        ));
    }
    if let Some(expected_wkt) = layer_crs_wkt
        && probe.crs_wkt.trim() != expected_wkt.trim()
    {
        issues.push(
            "horizontal CRS differs from the layer; transforming foreign grids arrives in a later slice"
                .to_string(),
        );
    }

    // Exact valid mask, value range and raw samples, streamed in bounded
    // windows from one controlled derivative: the managed original is never
    // loaded whole and the derivative is removed before this returns.
    let source_grid = RasterGrid {
        width: probe.width,
        height: probe.height,
        geotransform: probe.geotransform,
    };
    validate_working_grid(&source_grid, "source raster")?;
    let mask_path = job_dir.join(format!("valid-{sha256}.bin"));
    let raw_path = job_dir.join(format!("source-{sha256}.raw"));
    let value_range = stage_source_samples(
        engine,
        &managed_original,
        &source_grid,
        probe.nodata,
        job_dir,
        &raw_path,
        &mask_path,
        cancel,
    )?;

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
// Streamed source extraction
// ---------------------------------------------------------------------------

/// Stream one source's raw samples, valid mask and value range.
///
/// The derivative belongs to the reader and is gone before this returns. A
/// failed or cancelled attempt removes its partial outputs, so a failed
/// staging attempt never leaves a half-written numeric asset behind.
///
/// Both staged outputs are written while the derivative is alive, so they are
/// charged to the reader's combined working-set budget (four sample bytes and
/// one validity byte per cell) rather than to a second, independent check that
/// would see the same free bytes.
#[allow(clippy::too_many_arguments)]
fn stage_source_samples(
    engine: &GdalEngine,
    input: &Path,
    grid: &RasterGrid,
    nodata: Option<f32>,
    job_dir: &Path,
    raw_path: &Path,
    mask_path: &Path,
    cancel: &AtomicBool,
) -> Result<[f64; 2], String> {
    let cells = u64::from(grid.width)
        .checked_mul(u64::from(grid.height))
        .ok_or_else(|| "source raster dimensions overflow".to_string())?;
    let raw_bytes = cells
        .checked_mul(4)
        .ok_or_else(|| "source raster byte count overflows".to_string())?;
    let staged_output_bytes = cells
        .checked_mul(5)
        .ok_or_else(|| "staged source size overflows".to_string())?;

    let staged = (|| -> Result<[f64; 2], String> {
        let mut reader = PreparedRaster::open(
            engine,
            input,
            grid,
            nodata,
            staged_output_bytes,
            job_dir,
            cancel,
        )?;
        write_source_outputs(&mut reader, grid, raw_path, mask_path, cancel)
    })();
    match staged {
        Ok(range) => {
            for (path, expected) in [(raw_path, raw_bytes), (mask_path, cells)] {
                let written = std::fs::metadata(path)
                    .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?
                    .len();
                if written != expected {
                    let _ = std::fs::remove_file(raw_path);
                    let _ = std::fs::remove_file(mask_path);
                    return Err(format!(
                        "staged {} has {written} bytes, expected {expected}",
                        path.display()
                    ));
                }
            }
            Ok(range)
        }
        Err(error) => {
            let _ = std::fs::remove_file(raw_path);
            let _ = std::fs::remove_file(mask_path);
            Err(error)
        }
    }
}

/// Write the exact persisted row-major layouts from a bounded window scan.
fn write_source_outputs(
    reader: &mut PreparedRaster,
    grid: &RasterGrid,
    raw_path: &Path,
    mask_path: &Path,
    cancel: &AtomicBool,
) -> Result<[f64; 2], String> {
    let mut raw = PositionedWriter::create(raw_path, "staged samples")?;
    let mut mask = PositionedWriter::create(mask_path, "staged valid mask")?;
    let mut row = Vec::new();
    let (mut min, mut max) = (f64::INFINITY, f64::NEG_INFINITY);
    reader.scan(cancel, |window, samples, valid| {
        for line in 0..window.height {
            let start = line as usize * window.width as usize;
            let stop = start + window.width as usize;
            row.clear();
            for value in &samples[start..stop] {
                row.extend_from_slice(&value.to_le_bytes());
                if value.is_finite() {
                    min = min.min(*value as f64);
                    max = max.max(*value as f64);
                }
            }
            let cell = u64::from(window.y + line) * u64::from(grid.width) + u64::from(window.x);
            raw.write_at(cell * 4, &row)?;
            mask.write_at(cell, &valid[start..stop])?;
        }
        Ok(())
    })?;
    raw.finish()?;
    mask.finish()?;
    if min.is_finite() {
        Ok([min, max])
    } else {
        Ok([0.0, 0.0])
    }
}

/// Row-addressed writer that keeps the persisted layout exact without
/// buffering a whole row band.
struct PositionedWriter {
    file: std::fs::File,
    next_offset: u64,
    what: &'static str,
}

impl PositionedWriter {
    fn create(path: &Path, what: &'static str) -> Result<Self, String> {
        let file =
            std::fs::File::create(path).map_err(|e| format!("Failed to create {what}: {e}"))?;
        Ok(Self {
            file,
            next_offset: 0,
            what,
        })
    }

    fn write_at(&mut self, offset: u64, bytes: &[u8]) -> Result<(), String> {
        if offset != self.next_offset {
            self.file
                .seek(SeekFrom::Start(offset))
                .map_err(|e| format!("Failed to position {}: {e}", self.what))?;
        }
        self.file
            .write_all(bytes)
            .map_err(|e| format!("Failed to write {}: {e}", self.what))?;
        self.next_offset = offset + bytes.len() as u64;
        Ok(())
    }

    fn finish(mut self) -> Result<(), String> {
        self.file
            .flush()
            .map_err(|e| format!("Failed to flush {}: {e}", self.what))
    }
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

#[allow(clippy::too_many_arguments)]
fn compose_values_cancellable(
    layer_values_on_union: Option<&[f32]>,
    layer_on_union: Option<&ValidMask>,
    sources: &[&StagedSource],
    union: &RasterGrid,
    nodata: f32,
    add_uncovered: bool,
    replace_overlap: bool,
    cancel: Option<&AtomicBool>,
) -> Result<ComposedMosaic, String> {
    validate_working_grid(union, "raster composition")?;
    let mut values = vec![nodata; (union.width as usize) * (union.height as usize)];
    let mut valid = ValidMask::empty(union.width, union.height);
    if let Some(layer_mask) = layer_on_union {
        for y in 0..union.height {
            check_optional_cancel(cancel, y)?;
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
        validate_f32_raw(&raw, source.width, source.height)?;
        let source_mask =
            ValidMask::read_from(&source.valid_mask_path, source.width, source.height)?;
        let offset_x = ((source.geotransform[0] - union.geotransform[0]) / union.geotransform[1])
            .round() as i64;
        let offset_y = ((union.geotransform[3] - source.geotransform[3])
            / union.geotransform[5].abs())
        .round() as i64;
        for y in 0..source.height {
            check_optional_cancel(cancel, y)?;
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
                    let sample = f32_sample(&raw, (y * source.width + x) as usize);
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
// Durable member assets and replay composition
// ---------------------------------------------------------------------------

/// One accepted member of the layer coverage with its durable prepared
/// assets. Member rasters make history, undo and replacement exact: every
/// publication replays the member sequence instead of editing a merged
/// raster in place.
#[derive(Debug, Clone)]
pub struct MemberSource {
    pub interpretation_id: String,
    pub role: String,
    pub job_id: Option<String>,
    pub grid: RasterGrid,
    pub raw_samples_path: PathBuf,
    pub valid_mask_path: PathBuf,
}

/// Directory of the durable prepared assets for one interpretation.
pub fn member_prepared_dir(paths: &LidarPaths, interp_hash: &str) -> PathBuf {
    paths.prepared_dir().join("sources").join(interp_hash)
}

/// Persist the durable per-interpretation assets for a staged source. The
/// staged raw samples and valid mask move from the job dir into managed
/// storage; GeoTIFF conversion is metadata-stable and idempotent.
pub fn write_member_assets(
    engine: &GdalEngine,
    paths: &LidarPaths,
    cancel: &AtomicBool,
    source: &StagedSource,
) -> Result<PathBuf, String> {
    let dir = member_prepared_dir(paths, &source.interp_hash);
    if prepared_member_is_valid(&dir, source) {
        return Ok(dir);
    }
    let parent = dir
        .parent()
        .ok_or_else(|| "prepared member path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create prepared source root: {e}"))?;
    let staging = parent.join(format!("staging-{}", new_id("member")));
    std::fs::create_dir(&staging)
        .map_err(|e| format!("Failed to create prepared member staging: {e}"))?;
    std::fs::copy(&source.raw_samples_path, staging.join("values.raw"))
        .map_err(|e| format!("Failed to persist member samples: {e}"))?;
    std::fs::copy(&source.valid_mask_path, staging.join("valid.bin"))
        .map_err(|e| format!("Failed to persist member mask: {e}"))?;
    let grid = grid_for_source(source);
    raw_to_tif(
        engine,
        cancel,
        &staging.join("values.raw"),
        &staging.join("native.tif"),
        &grid,
        &source.crs_wkt,
        source.nodata.unwrap_or(FALLBACK_NODATA),
    )?;
    let meta = serde_json::json!({
        "interp_hash": source.interp_hash,
        "geotransform": source.geotransform,
        "width": source.width,
        "height": source.height,
        "nodata": source.nodata,
        "crs_wkt": source.crs_wkt,
    });
    std::fs::write(staging.join("meta.json"), meta.to_string())
        .map_err(|e| format!("Failed to persist member meta: {e}"))?;
    if !prepared_member_is_valid(&staging, source) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("prepared member failed publication validation".to_string());
    }
    let backup = parent.join(format!("replaced-{}", new_id("member")));
    let had_previous = dir.exists();
    if had_previous {
        std::fs::rename(&dir, &backup)
            .map_err(|e| format!("Failed to isolate invalid prepared member: {e}"))?;
    }
    if let Err(error) = std::fs::rename(&staging, &dir) {
        if had_previous {
            let _ = std::fs::rename(&backup, &dir);
        }
        return Err(format!("Failed to publish prepared member: {error}"));
    }
    if had_previous {
        let _ = std::fs::remove_dir_all(backup);
    }
    Ok(dir)
}

fn prepared_member_is_valid(dir: &Path, source: &StagedSource) -> bool {
    let cells = u64::from(source.width) * u64::from(source.height);
    let raw_size = std::fs::metadata(dir.join("values.raw")).map(|m| m.len());
    let mask_size = std::fs::metadata(dir.join("valid.bin")).map(|m| m.len());
    let tif_size = std::fs::metadata(dir.join("native.tif")).map(|m| m.len());
    let meta_hash = std::fs::read_to_string(dir.join("meta.json"))
        .ok()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|value| value.get("interp_hash")?.as_str().map(str::to_string));
    raw_size.ok() == Some(cells * 4)
        && mask_size.ok() == Some(cells)
        && tif_size.is_ok_and(|size| size > 0)
        && meta_hash.as_deref() == Some(source.interp_hash.as_str())
}

/// Replay accepted members in publication order. `add` members paint only
/// cells the sequence has not accepted yet; `replace` members paint over.
fn replay_members(
    members: &[MemberSource],
    union: &RasterGrid,
    nodata: f32,
    cancel: Option<&AtomicBool>,
) -> Result<ComposedMosaic, String> {
    validate_working_grid(union, "accepted-member replay")?;
    let mut values = vec![nodata; (union.width as usize) * (union.height as usize)];
    let mut valid = ValidMask::empty(union.width, union.height);
    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;
    for member in members {
        let raw = std::fs::read(&member.raw_samples_path)
            .map_err(|e| format!("Failed to read member samples: {e}"))?;
        validate_f32_raw(&raw, member.grid.width, member.grid.height)?;
        let mask = ValidMask::read_from(
            &member.valid_mask_path,
            member.grid.width,
            member.grid.height,
        )?;
        let offset_x = ((member.grid.geotransform[0] - union.geotransform[0])
            / union.geotransform[1])
            .round() as i64;
        let offset_y = ((union.geotransform[3] - member.grid.geotransform[3])
            / union.geotransform[5].abs())
        .round() as i64;
        let (add_uncovered, replace_overlap) = match member.role.as_str() {
            "add" => (true, false),
            "replace" => (true, true),
            "replace-overlap" => (false, true),
            role => return Err(format!("Unsupported stored acceptance role {role}")),
        };
        for y in 0..member.grid.height {
            check_optional_cancel(cancel, y)?;
            let ty = offset_y + y as i64;
            if ty < 0 || ty >= union.height as i64 {
                continue;
            }
            for x in 0..member.grid.width {
                let tx = offset_x + x as i64;
                if tx < 0 || tx >= union.width as i64 {
                    continue;
                }
                if !mask.get(x, y) {
                    continue;
                }
                let covered = valid.get(tx as u32, ty as u32);
                if (covered && !replace_overlap) || (!covered && !add_uncovered) {
                    continue;
                }
                let sample = f32_sample(&raw, (y * member.grid.width + x) as usize);
                values[ty as usize * union.width as usize + tx as usize] = sample;
                valid.set(tx as u32, ty as u32, true);
                if sample.is_finite() {
                    min_value = min_value.min(sample as f64);
                    max_value = max_value.max(sample as f64);
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
    library.record_import_progress(&staging.job_id, LidarImportProgressPhase::ComposingLayer, 2);

    // Short read: head snapshot, member sequence and interpretation rows;
    // the catalogue is released before any raster computation.
    struct HeadBase {
        manifest: Option<GenerationManifest>,
        members: Vec<MemberSource>,
        legacy_grid: Option<RasterGrid>,
    }
    let (head, head_base) = {
        let connection = library.catalogue()?;
        let head = catalogue::head_generation(&connection, &layer_id)?;
        let base = match &head {
            Some(head_row) => {
                let manifest = read_generation_manifest(&head_row.manifest_json)?;
                let members = catalogue::generation_members(&connection, &head_row.id)?;
                let mut resolved = Vec::new();
                for (interpretation_id, role, job_id) in members.iter() {
                    let (interpretation_id, role, job_id) =
                        (interpretation_id.clone(), role.clone(), job_id.clone());
                    let interp = catalogue::get_interpretation(&connection, &interpretation_id)?
                        .ok_or_else(|| format!("missing interpretation {interpretation_id}"))?;
                    let dir = member_prepared_dir(paths, &interp.interp_hash);
                    let raw = dir.join("values.raw");
                    let mask = dir.join("valid.bin");
                    if !raw.exists() || !mask.exists() {
                        // History written before durable member assets existed:
                        // fall back to the legacy head-snapshot composition.
                        resolved.clear();
                        break;
                    }
                    let gt = parse_geotransform(&interp.geotransform)?;
                    resolved.push(MemberSource {
                        interpretation_id,
                        role,
                        job_id,
                        grid: RasterGrid {
                            width: interp.width as u32,
                            height: interp.height as u32,
                            geotransform: gt,
                        },
                        raw_samples_path: raw,
                        valid_mask_path: mask,
                    });
                }
                let legacy = resolved.is_empty() && !members.is_empty();
                HeadBase {
                    manifest: Some(manifest),
                    members: resolved,
                    legacy_grid: legacy
                        .then(|| read_generation_manifest(&head_row.manifest_json).ok())
                        .flatten()
                        .map(|m| m.grid.clone()),
                }
            }
            None => HeadBase {
                manifest: None,
                members: Vec::new(),
                legacy_grid: None,
            },
        };
        (head, base)
    };
    let planned_head = head.as_ref().map(|row| row.id.as_str());
    if planned_head != staging.planned_against_head.as_deref() {
        return Err("import review is stale; review the current coverage again".to_string());
    }
    let head_manifest = head_base.manifest.clone();
    library.record_import_progress(&staging.job_id, LidarImportProgressPhase::ComposingLayer, 6);

    // Union grid: layer member grids plus every compatible staged source.
    let compatible: Vec<&StagedSource> = staging.sources.iter().filter(|s| s.compatible).collect();
    if compatible.is_empty() {
        return Err("import has no compatible sources to publish".to_string());
    }
    let incoming_role = match (add_uncovered, replace_overlap) {
        (true, true) => "replace",
        (true, false) => "add",
        (false, true) => "replace-overlap",
        (false, false) => {
            return Ok(ApplyOutcome {
                generation_id: head.as_ref().map(|row| row.id.clone()).unwrap_or_default(),
                published_cells: head
                    .as_ref()
                    .map(|row| row.coverage_cells.max(0) as u64)
                    .unwrap_or(0),
                changed: false,
                message: Some("no coverage changes selected; existing generation kept".to_string()),
            });
        }
    };
    let mut union = head_base
        .members
        .first()
        .map(|m| m.grid.clone())
        .or_else(|| head_base.legacy_grid.clone())
        .or_else(|| staging.layer_grid.clone())
        .unwrap_or_else(|| grid_for_source(compatible[0]));
    validate_working_grid(&union, "import publication")?;
    for member in &head_base.members {
        union = union_grid(&union, &member.grid)?;
        validate_working_grid(&union, "import publication union")?;
    }
    for source in &compatible {
        union = union_grid(&union, &grid_for_source(source))?;
        validate_working_grid(&union, "import publication union")?;
    }
    let _ = head_manifest;
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::ComposingLayer,
        10,
    );

    // Compose the new coverage: replay the member sequence, then paint the
    // incoming sources with the user's decisions. Invalid pixels never erase
    // accepted coverage; overlap is replaced only when explicitly approved.
    let composed = match (head_base.legacy_grid.as_ref(), head_base.members.is_empty()) {
        (Some(_), true) => {
            // Legacy head without member assets: seed from the merged
            // snapshot, then paint the incoming sources.
            let head_manifest_for_seed = head
                .as_ref()
                .map(|h| read_generation_manifest(&h.manifest_json))
                .transpose()?;
            let (layer_values, layer_mask) = head_values_on_union(
                engine,
                head.as_ref(),
                head_manifest_for_seed.as_ref(),
                &union,
                staging.layer_nodata,
                cancel,
            )?;
            compose_values_cancellable(
                layer_values.as_deref(),
                layer_mask.as_ref(),
                &compatible,
                &union,
                staging.layer_nodata,
                add_uncovered,
                replace_overlap,
                Some(cancel),
            )?
        }
        _ => {
            let mut sequence = head_base.members.clone();
            for source in &compatible {
                sequence.push(MemberSource {
                    interpretation_id: format!("interp-{}", source.interp_hash),
                    role: incoming_role.to_string(),
                    job_id: Some(staging.job_id.clone()),
                    grid: grid_for_source(source),
                    raw_samples_path: source.raw_samples_path.clone(),
                    valid_mask_path: source.valid_mask_path.clone(),
                });
            }
            replay_members(&sequence, &union, staging.layer_nodata, Some(cancel))?
        }
    };
    let published_cells = composed.valid.count_valid();
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::ComposingLayer,
        40,
    );
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

    // Durable per-interpretation assets for the incoming sources.
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::PreparingRaster,
        42,
    );
    for (index, source) in compatible.iter().enumerate() {
        check_cancel(cancel)?;
        write_member_assets(engine, paths, cancel, source)?;
        let completed = u64::try_from(index + 1).unwrap_or(u64::MAX);
        let total = u64::try_from(compatible.len()).unwrap_or(u64::MAX).max(1);
        let percent = 42 + u8::try_from(completed.saturating_mul(8) / total).unwrap_or(8);
        library.record_import_progress(
            &staging.job_id,
            LidarImportProgressPhase::PreparingRaster,
            percent.min(50),
        );
    }

    // Write the prepared mosaic + coverage mask into staging.
    let generation_id = new_id("gen");
    let pipeline_dir = paths.layer_pipeline_dir(&layer_id);
    let staging_dir = pipeline_dir.join(format!("staging-{generation_id}"));
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create staging dir: {e}"))?;
    let raw_path = staging_dir.join("mosaic.raw");
    write_f32_raw(&raw_path, &composed.values)?;
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::PreparingRaster,
        53,
    );
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
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::PreparingRaster,
        60,
    );
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
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::PreparingRaster,
        64,
    );

    // Atomic publish: rename staging into place, then advance the head in
    // one short transaction.
    check_cancel(cancel)?;
    let generation_dir = pipeline_dir.join(format!("gen-{generation_id}"));
    std::fs::rename(&staging_dir, &generation_dir)
        .map_err(|e| format!("Failed to publish generation dir: {e}"))?;
    let final_mosaic = generation_dir.join("mosaic.tif");
    let final_coverage = generation_dir.join("coverage.bin");
    library.record_import_progress(&staging.job_id, LidarImportProgressPhase::RenderingMap, 65);
    let last_display_percent = std::cell::Cell::new(65u8);
    let display_progress = |progress: display::DisplayProgress| {
        let percent = 65
            + u8::try_from(
                progress.completed_steps.saturating_mul(31) / progress.total_steps.max(1),
            )
            .unwrap_or(31)
            .min(31);
        if percent > last_display_percent.get() {
            last_display_percent.set(percent);
            library.record_import_progress(
                &staging.job_id,
                LidarImportProgressPhase::RenderingMap,
                percent,
            );
        }
    };
    if let Err(error) = publish_display(
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
        Some(&display_progress),
    ) {
        let _ = std::fs::remove_dir_all(&generation_dir);
        return Err(error);
    }
    library.record_import_progress(&staging.job_id, LidarImportProgressPhase::Finalizing, 98);
    {
        let connection = match library.catalogue() {
            Ok(connection) => connection,
            Err(error) => {
                remove_display_publication(library, "source", &layer_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        };
        if let Err(error) = connection.execute_batch("BEGIN IMMEDIATE") {
            remove_display_publication(library, "source", &layer_id, &generation_id);
            let _ = std::fs::remove_dir_all(&generation_dir);
            return Err(error.to_string());
        }
        let publish = (|| -> Result<(), String> {
            let job_state = connection
                .query_row(
                    "SELECT state FROM lidar_import_jobs WHERE id = ?1",
                    [&staging.job_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|e| e.to_string())?;
            if job_state != "applying" {
                return Err(if job_state == "cancelled" {
                    "cancelled".to_string()
                } else {
                    format!("import job cannot publish from state {job_state}")
                });
            }
            let current_head = catalogue::head_generation(&connection, &layer_id)?;
            if current_head.as_ref().map(|row| row.id.as_str()) != planned_head {
                return Err("import review is stale; review the current coverage again".to_string());
            }
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
            // Preserve prior operations first, then append this accepted
            // operation. Duplicate interpretation ids are valid re-imports;
            // ordinal owns identity within a generation.
            for (ordinal, member) in head_base.members.iter().enumerate() {
                connection
                    .execute(
                        "INSERT INTO lidar_generation_members(generation_id, interpretation_id, role, ordinal, job_id)
                         VALUES(?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![generation_id, member.interpretation_id, member.role, ordinal as i64, member.job_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            let prior_member_count = head_base.members.len();
            for (incoming_ordinal, source) in compatible.iter().enumerate() {
                let interpretation_id = format!("interp-{}", source.interp_hash);
                let ordinal = prior_member_count + incoming_ordinal;
                connection
                    .execute(
                        "INSERT INTO lidar_generation_members(generation_id, interpretation_id, role, ordinal, job_id)
                         VALUES(?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![generation_id, interpretation_id, incoming_role, ordinal as i64, staging.job_id],
                    )
                    .map_err(|e| e.to_string())?;
                connection
                    .execute(
                        "INSERT INTO lidar_acceptance_regions(id, generation_id, interpretation_id, decision, job_id)
                         VALUES(?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![new_id("acc"), generation_id, interpretation_id, incoming_role, staging.job_id],
                    )
                    .map_err(|e| e.to_string())?;
                catalogue::upsert_footprint(
                    &connection,
                    &interpretation_id,
                    &layer_id,
                    grid_for_source(source).bounds(),
                )?;
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
                    "UPDATE lidar_import_jobs
                     SET state = 'complete', progress_phase = 'finalizing',
                         progress_percent = 100, updated_at = ?2 WHERE id = ?1",
                    rusqlite::params![staging.job_id, now_iso()],
                )
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        match publish {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    remove_display_publication(library, "source", &layer_id, &generation_id);
                    let _ = std::fs::remove_dir_all(&generation_dir);
                    return Err(error.to_string());
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                remove_display_publication(library, "source", &layer_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        }
    }

    Ok(ApplyOutcome {
        generation_id,
        published_cells,
        changed: true,
        message: None,
    })
}

/// Undo one accepted import: republish the layer coverage without the
/// interpretation that import introduced. Immutable history stays on disk.
pub fn undo_import(
    library: &LidarLibrary,
    job_id: &str,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;

    // Short read: the import's accepted interpretations and the current head.
    let (layer_id, target_interpretations, head, head_manifest) = {
        let connection = library.catalogue()?;
        let layer_id: String = connection
            .query_row(
                "SELECT g.layer_id
                 FROM lidar_acceptance_regions a
                 JOIN lidar_layer_generations g ON g.id = a.generation_id
                 WHERE a.job_id = ?1
                 ORDER BY g.created_at DESC LIMIT 1",
                [job_id],
                |row| row.get(0),
            )
            .map_err(|_| "import has no accepted publication to undo".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT interpretation_id FROM lidar_acceptance_regions
                 WHERE job_id = ?1 ORDER BY id",
            )
            .map_err(|e| e.to_string())?;
        let target_interpretations = statement
            .query_map([job_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let head = catalogue::head_generation(&connection, &layer_id)?
            .ok_or_else(|| "layer has no accepted coverage".to_string())?;
        let manifest = read_generation_manifest(&head.manifest_json)?;
        (layer_id, target_interpretations, head, manifest)
    };

    // Resolve the remaining member sequence from durable assets.
    let remaining: Vec<MemberSource> = {
        let connection = library.catalogue()?;
        let members = catalogue::generation_members(&connection, &head.id)?;
        let has_job_identity = members
            .iter()
            .any(|(_, _, member_job_id)| member_job_id.as_deref() == Some(job_id));
        let mut legacy_targets = target_interpretations.clone();
        legacy_targets.reverse();
        let mut resolved = Vec::new();
        for (member_id, role, member_job_id) in members.into_iter().rev() {
            let legacy_match = if has_job_identity || member_job_id.is_some() {
                false
            } else if let Some(index) = legacy_targets
                .iter()
                .position(|target| target == &member_id)
            {
                legacy_targets.remove(index);
                true
            } else {
                false
            };
            if member_job_id.as_deref() == Some(job_id) || legacy_match {
                continue;
            }
            let interp = catalogue::get_interpretation(&connection, &member_id)?
                .ok_or_else(|| format!("missing interpretation {member_id}"))?;
            let dir = member_prepared_dir(paths, &interp.interp_hash);
            let raw = dir.join("values.raw");
            let mask = dir.join("valid.bin");
            if !raw.exists() || !mask.exists() {
                return Err("cannot undo: this import predates durable member history".to_string());
            }
            let gt = parse_geotransform(&interp.geotransform)?;
            resolved.push(MemberSource {
                interpretation_id: member_id,
                role,
                job_id: member_job_id,
                grid: RasterGrid {
                    width: interp.width as u32,
                    height: interp.height as u32,
                    geotransform: gt,
                },
                raw_samples_path: raw,
                valid_mask_path: mask,
            });
        }
        resolved.reverse();
        resolved
    };

    let mut union = remaining
        .first()
        .map(|m| m.grid.clone())
        .unwrap_or_else(|| head_manifest.grid.clone());
    validate_working_grid(&union, "import undo")?;
    for member in &remaining {
        union = union_grid(&union, &member.grid)?;
        validate_working_grid(&union, "import undo union")?;
    }
    let composed = replay_members(&remaining, &union, head_manifest.nodata, Some(cancel))?;
    let published_cells = composed.valid.count_valid();

    // Publish the new generation without the undone interpretation.
    let generation_id = new_id("gen");
    let pipeline_dir = paths.layer_pipeline_dir(&layer_id);
    let staging_dir = pipeline_dir.join(format!("staging-{generation_id}"));
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create staging dir: {e}"))?;
    let raw_path = staging_dir.join("mosaic.raw");
    write_f32_raw(&raw_path, &composed.values)?;
    let mosaic_path = staging_dir.join("mosaic.tif");
    let crs_wkt = head_manifest.crs_wkt.clone();
    raw_to_tif(
        engine,
        cancel,
        &raw_path,
        &mosaic_path,
        &union,
        &crs_wkt,
        head_manifest.nodata,
    )?;
    let coverage_path = staging_dir.join("coverage.bin");
    composed.valid.write_to(&coverage_path)?;
    let _ = std::fs::remove_file(&raw_path);
    let manifest = GenerationManifest {
        grid: union.clone(),
        nodata: head_manifest.nodata,
        crs_wkt: crs_wkt.clone(),
        members: remaining
            .iter()
            .map(|m| {
                m.interpretation_id
                    .trim_start_matches("interp-")
                    .to_string()
            })
            .collect(),
        engine_version: engine.discover().map(|t| t.version).unwrap_or_default(),
        created_at: now_iso(),
    };
    let manifest_json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(staging_dir.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("Failed to write manifest: {e}"))?;
    let bounds_3857 = raster_bounds_3857(engine, cancel, &union, &crs_wkt)?;

    let generation_dir = pipeline_dir.join(format!("gen-{generation_id}"));
    std::fs::rename(&staging_dir, &generation_dir)
        .map_err(|e| format!("Failed to publish generation dir: {e}"))?;
    let final_mosaic = generation_dir.join("mosaic.tif");
    let final_coverage = generation_dir.join("coverage.bin");
    if published_cells > 0
        && let Err(error) = publish_display(
            library,
            cancel,
            "source",
            &layer_id,
            &generation_id,
            &final_mosaic,
            Some(head_manifest.nodata),
            &ColorRamp::elevation_range(
                composed.min_value,
                composed.max_value.max(composed.min_value + 1.0),
            ),
            None,
        )
    {
        let _ = std::fs::remove_dir_all(&generation_dir);
        return Err(error);
    }
    {
        let connection = match library.catalogue() {
            Ok(connection) => connection,
            Err(error) => {
                remove_display_publication(library, "source", &layer_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        };
        if let Err(error) = connection.execute_batch("BEGIN IMMEDIATE") {
            remove_display_publication(library, "source", &layer_id, &generation_id);
            let _ = std::fs::remove_dir_all(&generation_dir);
            return Err(error.to_string());
        }
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
            for (ordinal, member) in remaining.iter().enumerate() {
                connection
                    .execute(
                        "INSERT INTO lidar_generation_members(generation_id, interpretation_id, role, ordinal, job_id)
                         VALUES(?1, ?2, ?3, ?4, ?5)",
                        rusqlite::params![generation_id, member.interpretation_id, member.role, ordinal as i64, member.job_id],
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
            for interpretation_id in &target_interpretations {
                if remaining
                    .iter()
                    .any(|member| &member.interpretation_id == interpretation_id)
                {
                    continue;
                }
                connection
                    .execute(
                        "DELETE FROM lidar_source_footprints WHERE layer_id = ?1 AND interpretation_id = ?2",
                        rusqlite::params![layer_id, interpretation_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match publish {
            Ok(()) => {
                if let Err(error) = connection.execute_batch("COMMIT") {
                    let _ = connection.execute_batch("ROLLBACK");
                    remove_display_publication(library, "source", &layer_id, &generation_id);
                    let _ = std::fs::remove_dir_all(&generation_dir);
                    return Err(error.to_string());
                }
            }
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                remove_display_publication(library, "source", &layer_id, &generation_id);
                let _ = std::fs::remove_dir_all(&generation_dir);
                return Err(error);
            }
        }
    }

    Ok(ApplyOutcome {
        message: Some(format!(
            "import undone; generation {generation_id} published"
        )),
        generation_id: generation_id.clone(),
        published_cells,
        changed: true,
    })
}
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
    progress: Option<&dyn Fn(display::DisplayProgress)>,
) -> Result<(), String> {
    let style = ramp.style_name();
    let dir =
        library
            .inner
            .paths
            .display_generation_dir(entity_kind, entity_id, generation_id, style);
    let pyramid = match display::generate_pyramid(
        &library.inner.engine,
        cancel,
        numeric_raster,
        nodata,
        ramp,
        &dir,
        progress,
    ) {
        Ok(pyramid) => pyramid,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dir);
            tracing::warn!(
                entity_kind,
                entity_id,
                generation_id,
                error,
                "LiDAR display rendering failed; generation publication aborted"
            );
            return Err(format!("LiDAR display rendering failed: {error}"));
        }
    };
    if pyramid.tile_count == 0 || pyramid.bytes == 0 {
        let _ = std::fs::remove_dir_all(&dir);
        return Err("LiDAR display rendering produced no tile content".to_string());
    }
    let display = library.display().inspect_err(|_| {
        let _ = std::fs::remove_dir_all(&dir);
    })?;
    let key = format!("{entity_kind}/{entity_id}/{generation_id}/{style}");
    let bounds_json = serde_json::to_string(&pyramid.bounds_3857).map_err(|error| {
        let _ = std::fs::remove_dir_all(&dir);
        error.to_string()
    })?;
    display
        .execute(
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
                bounds_json,
                pyramid.tile_count as i64,
                pyramid.bytes as i64,
                now_iso(),
            ],
        )
        .map_err(|error| {
            let _ = std::fs::remove_dir_all(&dir);
            format!("Failed to register LiDAR display tiles: {error}")
        })?;
    Ok(())
}

pub(crate) fn remove_display_publication(
    library: &LidarLibrary,
    entity_kind: &str,
    entity_id: &str,
    generation_id: &str,
) {
    if let Ok(display) = library.display() {
        let _ = display.execute(
            "DELETE FROM tilesets WHERE entity_kind = ?1 AND entity_id = ?2 AND generation_id = ?3",
            rusqlite::params![entity_kind, entity_id, generation_id],
        );
    }
    let generation_dir = library
        .inner
        .paths
        .display_dir()
        .join(entity_kind)
        .join(entity_id)
        .join(generation_id);
    let _ = std::fs::remove_dir_all(generation_dir);
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
    cancel: &AtomicBool,
) -> Result<(Option<Vec<f32>>, Option<ValidMask>), String> {
    let Some(head) = head else {
        return Ok((None, None));
    };
    let manifest = manifest.ok_or("generation manifest is missing")?;
    validate_working_grid(&manifest.grid, "accepted layer raster")?;
    validate_working_grid(union, "accepted layer union")?;
    let raw = raw_f32_bytes(
        engine,
        Path::new(&head.mosaic_path),
        manifest.grid.width,
        manifest.grid.height,
        cancel,
    )?;
    validate_f32_raw(&raw, manifest.grid.width, manifest.grid.height)?;
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
        if y % 256 == 0 {
            check_cancel(cancel)?;
        }
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
                    f32_sample(&raw, (y * manifest.grid.width + x) as usize);
            }
        }
    }
    let remapped =
        remap_mask_checked(&layer_mask, &manifest.grid, union, |_| check_cancel(cancel))?;
    Ok((Some(expanded), Some(remapped)))
}

#[allow(clippy::too_many_arguments)]
fn preview_tif_from_composed(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    job_dir: &Path,
    stem: &str,
    union: &RasterGrid,
    crs_wkt: &Option<String>,
    nodata: f32,
    composed: &ComposedMosaic,
) -> Result<PathBuf, String> {
    let raw = job_dir.join(format!("after-preview-{stem}.raw"));
    write_f32_raw(&raw, &composed.values)?;
    let tif = job_dir.join(format!("after-preview-{stem}.tif"));
    let converted = raw_to_tif(
        engine,
        cancel,
        &raw,
        &tif,
        union,
        crs_wkt.as_deref().unwrap_or(""),
        nodata,
    );
    let _ = std::fs::remove_file(&raw);
    converted?;
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
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let grid = RasterGrid {
        width,
        height,
        geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
    };
    validate_working_grid(&grid, "raw raster extraction")?;
    let expected = usize::try_from(u64::from(width) * u64::from(height) * 4)
        .map_err(|_| "raw raster byte count exceeds this platform".to_string())?;
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
        Some(cancel),
    )?;
    let scratch_size = std::fs::metadata(&scratch)
        .map_err(|e| format!("Failed to inspect raw raster: {e}"))?
        .len();
    if scratch_size != expected as u64 {
        let _ = std::fs::remove_file(&scratch);
        let _ = std::fs::remove_file(scratch.with_extension("raw.aux.xml"));
        return Err(format!(
            "raw raster buffer has {scratch_size} bytes, expected {expected}"
        ));
    }
    let bytes = std::fs::read(&scratch).map_err(|e| format!("Failed to read raw raster: {e}"))?;
    let _ = std::fs::remove_file(&scratch);
    let _ = std::fs::remove_file(scratch.with_extension("raw.aux.xml"));
    Ok(bytes)
}

fn validate_f32_raw(raw: &[u8], width: u32, height: u32) -> Result<(), String> {
    let expected = usize::try_from(u64::from(width) * u64::from(height) * 4)
        .map_err(|_| "raw buffer dimensions exceed this platform".to_string())?;
    if raw.len() != expected {
        return Err(format!(
            "raw buffer has {} bytes, expected {expected}",
            raw.len()
        ));
    }
    Ok(())
}

fn f32_sample(raw: &[u8], index: usize) -> f32 {
    let offset = index * 4;
    f32::from_le_bytes([
        raw[offset],
        raw[offset + 1],
        raw[offset + 2],
        raw[offset + 3],
    ])
}

fn check_optional_cancel(cancel: Option<&AtomicBool>, row: u32) -> Result<(), String> {
    if row.is_multiple_of(256)
        && let Some(cancel) = cancel
    {
        check_cancel(cancel)?;
    }
    Ok(())
}

pub fn write_f32_raw(path: &Path, values: &[f32]) -> Result<(), String> {
    let file =
        std::fs::File::create(path).map_err(|e| format!("Failed to create raw buffer: {e}"))?;
    let mut output = std::io::BufWriter::new(file);
    for value in values {
        output
            .write_all(&value.to_le_bytes())
            .map_err(|e| format!("Failed to write raw buffer: {e}"))?;
    }
    output
        .flush()
        .map_err(|e| format!("Failed to flush raw buffer: {e}"))
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
    let output = engine.run_with_input(
        GdalProgram::Transform,
        &[
            "-s_srs".to_string(),
            crs_wkt.to_string(),
            "-t_srs".to_string(),
            "EPSG:3857".to_string(),
        ],
        input.as_bytes(),
        Some(cancel),
    )?;
    check_cancel(cancel)?;
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for line in output.stdout.lines() {
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

fn probe_gdalinfo(
    engine: &GdalEngine,
    raster: &Path,
    cancel: &AtomicBool,
) -> Result<String, String> {
    let output = engine.run(
        GdalProgram::Info,
        &["-json".to_string(), raster.display().to_string()],
        Some(cancel),
    )?;
    Ok(output.stdout)
}

fn grid_for_source(source: &StagedSource) -> RasterGrid {
    RasterGrid {
        width: source.width,
        height: source.height,
        geotransform: source.geotransform,
    }
}

fn format_geotransform(gt: GeoTransform) -> String {
    format!(
        "[{},{},{},{},{},{}]",
        gt[0], gt[1], gt[2], gt[3], gt[4], gt[5]
    )
}

fn parse_geotransform(raw: &str) -> Result<GeoTransform, String> {
    let values = match serde_json::from_str::<Vec<f64>>(raw) {
        Ok(values) => values,
        Err(json_error) => raw
            .split(',')
            .map(|value| value.trim().parse::<f64>())
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| format!("Invalid stored geotransform: {json_error}"))?,
    };
    let transform: GeoTransform = values.try_into().map_err(|values: Vec<f64>| {
        format!(
            "Invalid stored geotransform: expected 6 values, found {}",
            values.len()
        )
    })?;
    if !transform.iter().all(|value| value.is_finite()) {
        return Err("Invalid stored geotransform: values must be finite".to_string());
    }
    Ok(transform)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dense_grid_limit_rejects_extent_explosion_before_allocation() {
        let allowed = RasterGrid {
            width: 5_000,
            height: 5_000,
            geotransform: [0.0, 1.0, 0.0, 5_000.0, 0.0, -1.0],
        };
        assert!(validate_working_grid(&allowed, "test").is_ok());
        let oversized = RasterGrid {
            width: 5_001,
            ..allowed
        };
        let error = validate_working_grid(&oversized, "test").unwrap_err();
        assert!(error.contains("current dense raster engine limit"));
    }

    #[test]
    fn source_selection_caps_count_and_bytes_before_staging() {
        let too_many = vec![PathBuf::from("unused"); MAX_SOURCE_FILES_PER_IMPORT + 1];
        assert!(
            validate_source_selection(&too_many)
                .unwrap_err()
                .contains("at most")
        );

        let path = std::env::temp_dir().join(new_id("canopi-oversized-source"));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_SOURCE_FILE_BYTES + 1).unwrap();
        let error = validate_source_selection(std::slice::from_ref(&path)).unwrap_err();
        assert!(error.contains("per-source limit"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn managed_original_is_streamed_and_existing_content_is_verified() {
        let root = std::env::temp_dir().join(new_id("canopi-managed-source-test"));
        let paths = LidarPaths::open(&root).unwrap();
        let job_dir = paths.job_dir("job");
        std::fs::create_dir_all(&job_dir).unwrap();
        let source = root.join("extensionless-source");
        std::fs::write(&source, b"canopi raster bytes").unwrap();

        let (sha256, managed, size) =
            stage_managed_original(&paths, &source, &job_dir, "extensionless-source").unwrap();
        assert_eq!(size, 19);
        assert_eq!(std::fs::read(&managed).unwrap(), b"canopi raster bytes");
        assert_eq!(hash_file_limited(&managed).unwrap().0, sha256);

        std::fs::write(&managed, b"corrupt").unwrap();
        let error =
            stage_managed_original(&paths, &source, &job_dir, "extensionless-source").unwrap_err();
        assert!(error.contains("failed integrity verification"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn geotransform_storage_round_trips_and_reads_legacy_rows() {
        let transform = [445999.75, 0.5, 0.0, 6807000.25, 0.0, -0.5];
        assert_eq!(
            parse_geotransform(&format_geotransform(transform)).unwrap(),
            transform
        );
        assert_eq!(
            parse_geotransform("445999.75,0.5,0,6807000.25,0,-0.5").unwrap(),
            transform
        );
    }

    #[test]
    fn geotransform_storage_rejects_missing_or_non_finite_values() {
        assert!(parse_geotransform("[1,2,3]").is_err());
        assert!(parse_geotransform("0,1,0,1,0,NaN").is_err());
    }

    fn member_fixture(
        dir: &std::path::Path,
        name: &str,
        grid: &RasterGrid,
        role: &str,
        values: &[f32],
    ) -> MemberSource {
        std::fs::create_dir_all(dir).unwrap();
        let raw = dir.join(format!("{name}.raw"));
        let mut bytes = Vec::new();
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        std::fs::write(&raw, &bytes).unwrap();
        let mask_values: Vec<u8> = values
            .iter()
            .map(|v| if v.is_finite() && *v != -9999.0 { 1 } else { 0 })
            .collect();
        let mask = dir.join(format!("{name}.bin"));
        std::fs::write(&mask, &mask_values).unwrap();
        MemberSource {
            interpretation_id: format!("interp-{name}"),
            role: role.to_string(),
            job_id: None,
            grid: grid.clone(),
            raw_samples_path: raw,
            valid_mask_path: mask,
        }
    }

    fn sample(mosaic: &ComposedMosaic, grid: &RasterGrid, x: u32, y: u32) -> f32 {
        mosaic.values[y as usize * grid.width as usize + x as usize]
    }

    #[test]
    fn replay_adds_then_replaces_in_publication_order() {
        let grid = RasterGrid {
            width: 2,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let dir = std::env::temp_dir().join("canopi-replay-test");
        // First member: add covers both cells (1.0, 2.0).
        let first = member_fixture(&dir, "m1", &grid, "add", &[1.0, 2.0]);
        let mosaic = replay_members(std::slice::from_ref(&first), &grid, -99999.0, None).unwrap();
        assert_eq!(sample(&mosaic, &grid, 0, 0), 1.0);
        assert_eq!(sample(&mosaic, &grid, 1, 0), 2.0);

        // Second member: add only paints where the first left invalid.
        let second = member_fixture(&dir, "m2", &grid, "add", &[9.0, 3.0]);
        let mosaic = replay_members(&[first.clone(), second], &grid, -99999.0, None).unwrap();
        assert_eq!(sample(&mosaic, &grid, 0, 0), 1.0);
        assert_eq!(sample(&mosaic, &grid, 1, 0), 2.0);

        // Replace member paints over accepted coverage.
        let third = member_fixture(&dir, "m3", &grid, "replace", &[7.0, 8.0]);
        let mosaic = replay_members(&[first, third], &grid, -99999.0, None).unwrap();
        assert_eq!(sample(&mosaic, &grid, 0, 0), 7.0);
        assert_eq!(sample(&mosaic, &grid, 1, 0), 8.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replay_undoes_a_member_by_dropping_it_from_the_sequence() {
        let grid = RasterGrid {
            width: 2,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let dir = std::env::temp_dir().join("canopi-replay-undo");
        // First import covers only the left cell.
        let first = member_fixture(&dir, "a", &grid, "add", &[1.0, -9999.0]);
        // Second import would cover both; accepted as uncovered-additions only.
        let second = member_fixture(&dir, "b", &grid, "add", &[9.0, 3.0]);
        let with_both =
            replay_members(&[first.clone(), second.clone()], &grid, -99999.0, None).unwrap();
        assert_eq!(
            sample(&with_both, &grid, 0, 0),
            1.0,
            "existing value wins the overlap"
        );
        assert_eq!(
            sample(&with_both, &grid, 1, 0),
            3.0,
            "uncovered cell is filled"
        );
        assert_eq!(with_both.valid.count_valid(), 2);

        // Undo the second import: replay only the first member.
        let after_undo = replay_members(&[first], &grid, -99999.0, None).unwrap();
        assert_eq!(sample(&after_undo, &grid, 0, 0), 1.0);
        assert_eq!(
            after_undo.valid.count_valid(),
            1,
            "the undone coverage disappears"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replay_invalid_member_cells_never_erase_accepted_coverage() {
        let grid = RasterGrid {
            width: 2,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let dir = std::env::temp_dir().join("canopi-replay-invalid");
        let first = member_fixture(&dir, "base", &grid, "add", &[5.0, 6.0]);
        // Replace member whose second cell is nodata: cell 1 must keep 6.0.
        let replacer = member_fixture(&dir, "repl", &grid, "replace", &[4.0, -9999.0]);
        let mosaic = replay_members(&[first, replacer], &grid, -99999.0, None).unwrap();
        assert_eq!(sample(&mosaic, &grid, 0, 0), 4.0);
        assert_eq!(sample(&mosaic, &grid, 1, 0), 6.0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn replay_can_replace_overlap_without_accepting_uncovered_cells() {
        let base_grid = RasterGrid {
            width: 1,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let incoming_grid = RasterGrid {
            width: 2,
            height: 1,
            geotransform: [0.0, 1.0, 0.0, 1.0, 0.0, -1.0],
        };
        let dir = std::env::temp_dir().join(new_id("canopi-replace-overlap-test"));
        let base = member_fixture(&dir, "base", &base_grid, "add", &[1.0]);
        let incoming = member_fixture(
            &dir,
            "incoming",
            &incoming_grid,
            "replace-overlap",
            &[7.0, 8.0],
        );
        let mosaic = replay_members(&[base, incoming], &incoming_grid, -99999.0, None).unwrap();
        assert_eq!(sample(&mosaic, &incoming_grid, 0, 0), 7.0);
        assert_eq!(mosaic.valid.count_valid(), 1);
        assert!(!mosaic.valid.get(1, 0));
        std::fs::remove_dir_all(dir).unwrap();
    }

    // -----------------------------------------------------------------
    // Streamed staging through the real engine
    // -----------------------------------------------------------------

    /// Authored values for the staging compatibility fixtures.
    fn staged_value(x: u32, y: u32) -> f32 {
        match (x % 23, y % 17) {
            (0, 0) => -9999.0,
            (1, 1) => f32::NAN,
            (2, 2) => f32::INFINITY,
            (3, 3) => 0.0,
            (4, 4) => -12.5,
            _ => (x as f32) * 0.5 - (y as f32) * 0.25,
        }
    }

    /// Independently recomputed value range for the retained conversion.
    fn oracle_range(raw: &[u8]) -> [f64; 2] {
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for chunk in raw.chunks_exact(4) {
            let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value.is_finite() {
                min = min.min(value as f64);
                max = max.max(value as f64);
            }
        }
        if min.is_finite() {
            [min, max]
        } else {
            [0.0, 0.0]
        }
    }

    fn write_staging_fixture(
        engine: &GdalEngine,
        dir: &Path,
        name: &str,
        width: u32,
        height: u32,
        nodata: f32,
    ) -> PathBuf {
        let values: Vec<f32> = (0..height)
            .flat_map(|y| (0..width).map(move |x| (x, y)))
            .map(|(x, y)| staged_value(x, y))
            .collect();
        let raw = dir.join(format!("{name}.raw"));
        write_f32_raw(&raw, &values).expect("fixture raw writes");
        let tif = dir.join(format!("{name}.tif"));
        raw_to_tif(
            engine,
            &AtomicBool::new(false),
            &raw,
            &tif,
            &RasterGrid {
                width,
                height,
                geotransform: [0.0, 1.0, 0.0, height as f64, 0.0, -1.0],
            },
            "EPSG:3857",
            nodata,
        )
        .expect("fixture converts");
        let _ = std::fs::remove_file(&raw);
        let _ = std::fs::remove_file(raw.with_extension("hdr"));
        tif
    }

    /// The streamed production staging path must persist exactly what the
    /// retained dense GDAL conversion produced, for every special value the
    /// Float32 contract covers, and must really decode through the native
    /// tiled reader rather than a full-buffer fallback.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn staged_source_assets_match_the_gdal_conversion_oracle() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-staging-oracle"));
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "staging oracle",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .expect("layer created");
        let job_id = library.record_import_job(&layer_id).expect("job recorded");

        let (width, height) = (60u32, 45u32);
        let float_source =
            write_staging_fixture(&engine, &root, "oracle-f32", width, height, -9999.0);
        let int_source = root.join("oracle-int16.tif");
        engine
            .run(
                GdalProgram::Translate,
                &[
                    "-q".to_string(),
                    "-ot".to_string(),
                    "Int16".to_string(),
                    "-co".to_string(),
                    "TILED=YES".to_string(),
                    float_source.display().to_string(),
                    int_source.display().to_string(),
                ],
                Some(&cancel),
            )
            .expect("int16 fixture converts");

        use crate::services::lidar::prepared_raster::observability;
        observability::reset();
        let output = stage_import(
            &library,
            &job_id,
            &layer_id,
            &[float_source.clone(), int_source.clone()],
            &cancel,
        )
        .expect("staging succeeds");
        assert!(
            output.review.compatible,
            "fixtures must be admitted: {:?}",
            output.review.issues
        );
        assert!(
            observability::tiles_decoded() > 0,
            "staging must decode through the native tiled reader"
        );

        let staging: StagedImport = serde_json::from_str(
            &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                .expect("staging json"),
        )
        .expect("staging parses");
        assert_eq!(staging.sources.len(), 2);
        for (source, fixture) in staging.sources.iter().zip([&float_source, &int_source]) {
            assert_eq!(source.width, width);
            assert_eq!(source.height, height);
            assert_eq!(source.nodata, Some(-9999.0));
            assert_eq!(source.size_bytes, std::fs::metadata(fixture).unwrap().len());

            let oracle =
                raw_f32_bytes(&engine, fixture, width, height, &cancel).expect("oracle conversion");
            let oracle_mask = grid::valid_mask_from_f32_raw_checked(
                width,
                height,
                &oracle,
                Some(-9999.0),
                |_| Ok(()),
            )
            .expect("oracle mask");
            let persisted_raw = std::fs::read(&source.raw_samples_path).expect("persisted raw");
            let persisted_mask = std::fs::read(&source.valid_mask_path).expect("persisted mask");
            assert_eq!(persisted_raw.len(), oracle.len(), "raw byte count");
            assert_eq!(persisted_mask, oracle_mask.bytes().to_vec(), "mask bytes");
            for (index, chunk) in oracle.chunks_exact(4).enumerate() {
                let expected = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                let got =
                    f32::from_le_bytes(persisted_raw[index * 4..index * 4 + 4].try_into().unwrap());
                if expected.is_nan() {
                    assert!(got.is_nan(), "sample {index} must stay NaN");
                } else {
                    assert_eq!(got.to_bits(), expected.to_bits(), "sample {index}");
                }
            }
            assert_eq!(
                source.value_range,
                oracle_range(&oracle),
                "value range keeps the retained finite-NoData behaviour"
            );
        }

        // The derivative is temporary: nothing prepared-* survives staging.
        let leftovers: Vec<_> = std::fs::read_dir(library.inner.paths.job_dir(&job_id))
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("prepared-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "derivative left behind: {leftovers:?}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staging_without_a_measurable_scratch_directory_fails_by_name() {
        let engine = GdalEngine::new();
        let missing = std::env::temp_dir().join(new_id("canopi-absent-scratch"));
        let error = stage_source_samples(
            &engine,
            Path::new("unused.tif"),
            &RasterGrid {
                width: 4,
                height: 4,
                geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
            },
            None,
            &missing,
            &missing.join("source.raw"),
            &missing.join("valid.bin"),
            &AtomicBool::new(false),
        )
        .expect_err("unmeasurable capacity must fail");
        assert!(error.contains("Cannot verify free space"), "{error}");
    }

    /// A failed numeric output must fail the job, not publish a partial asset.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn staged_output_write_failure_removes_partial_assets() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = std::env::temp_dir().join(new_id("canopi-write-failure"));
        std::fs::create_dir_all(&dir).unwrap();
        let (width, height) = (40u32, 30u32);
        let source = write_staging_fixture(&engine, &dir, "failure", width, height, -9999.0);
        let grid = RasterGrid {
            width,
            height,
            geotransform: [0.0, 1.0, 0.0, height as f64, 0.0, -1.0],
        };

        // A directory where the samples file belongs makes the first write
        // fail; the validity mask must not be left behind.
        let raw_path = dir.join("source-occupied.raw");
        std::fs::create_dir(&raw_path).unwrap();
        let mask_path = dir.join("valid-occupied.bin");
        let error = stage_source_samples(
            &engine,
            &source,
            &grid,
            Some(-9999.0),
            &dir,
            &raw_path,
            &mask_path,
            &cancel,
        )
        .expect_err("an unwritable output must fail staging");
        assert!(error.contains("Failed to create staged samples"), "{error}");
        assert!(
            !mask_path.exists(),
            "a failed staging attempt leaves no partial mask"
        );
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("prepared-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "derivative left behind: {leftovers:?}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The import caller charges both staged outputs while the derivative is
    /// alive. 265 MiB free passes each former separate check (261 MiB for the
    /// outputs, 264 MiB for preparation), so only the combined estimate can
    /// reject it - and it must reject before preparation or any output file.
    #[test]
    fn staged_source_rejects_an_insufficient_combined_budget_before_preparation() {
        use crate::services::lidar::paths::capacity_probe;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = std::env::temp_dir().join(new_id("canopi-combined-budget"));
        std::fs::create_dir_all(&dir).unwrap();
        let grid = RasterGrid {
            width: 1024,
            height: 1024,
            geotransform: [0.0, 1.0, 0.0, 1024.0, 0.0, -1.0],
        };
        let raw_path = dir.join("source.raw");
        let mask_path = dir.join("valid.bin");
        let _guard = capacity_probe::override_available(265 * 1024 * 1024);
        // A missing input never reaches GDAL: the capacity error proves the
        // combined check ran before preparation.
        let error = stage_source_samples(
            &engine,
            &dir.join("absent-input.tif"),
            &grid,
            None,
            &dir,
            &raw_path,
            &mask_path,
            &cancel,
        )
        .expect_err("the combined footprint must be rejected");
        assert!(
            error.contains("282066944"),
            "names the required bytes: {error}"
        );
        assert!(
            error.contains("277872640"),
            "names the available bytes: {error}"
        );
        assert!(!raw_path.exists(), "no samples output on rejection");
        assert!(!mask_path.exists(), "no validity output on rejection");
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("prepared-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no derivative on rejection: {leftovers:?}"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// At exactly the combined requirement the real caller proceeds, and one
    /// byte less still rejects: the boundary is inclusive at the requirement
    /// and the estimate is not over-conservative.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn staged_source_admits_exactly_the_combined_requirement() {
        use crate::services::lidar::paths::capacity_probe;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = std::env::temp_dir().join(new_id("canopi-combined-boundary"));
        std::fs::create_dir_all(&dir).unwrap();
        let (width, height) = (1024u32, 1024u32);
        let source = write_staging_fixture(&engine, &dir, "boundary", width, height, -9999.0);
        let grid = RasterGrid {
            width,
            height,
            geotransform: [0.0, 1.0, 0.0, height as f64, 0.0, -1.0],
        };
        let raw_path = dir.join("source-boundary.raw");
        let mask_path = dir.join("valid-boundary.bin");
        {
            let _guard = capacity_probe::override_available(269 * 1024 * 1024);
            let range = stage_source_samples(
                &engine,
                &source,
                &grid,
                Some(-9999.0),
                &dir,
                &raw_path,
                &mask_path,
                &cancel,
            )
            .expect("the exact combined requirement admits the work");
            assert!(range[0].is_finite() && range[1].is_finite());
            assert_eq!(
                std::fs::metadata(&raw_path).unwrap().len(),
                u64::from(width) * u64::from(height) * 4
            );
            assert_eq!(
                std::fs::metadata(&mask_path).unwrap().len(),
                u64::from(width) * u64::from(height)
            );
        }
        std::fs::remove_file(&raw_path).unwrap();
        std::fs::remove_file(&mask_path).unwrap();
        {
            let _guard = capacity_probe::override_available(269 * 1024 * 1024 - 1);
            let error = stage_source_samples(
                &engine,
                &source,
                &grid,
                Some(-9999.0),
                &dir,
                &raw_path,
                &mask_path,
                &cancel,
            )
            .expect_err("one byte below the requirement must reject");
            assert!(error.contains("282066944"), "{error}");
            assert!(!raw_path.exists() && !mask_path.exists());
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
