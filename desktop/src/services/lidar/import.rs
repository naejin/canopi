//! Import staging and publication for source items.
//!
//! Each selected source is probed, validated and prepared as a retained COG
//! whose valid cells and range are measured once. GDAL performs format
//! conversion and georeferencing only. Catalogue locks are held only for short
//! reads and the publish transaction — never during raster computation.
//! Publication is atomic: promoted assets, the ordered members and the item's
//! only head commit in one transaction.

use super::LidarLibrary;
use super::admission;
use super::catalogue::{self, new_id, now_iso};
use super::collection;
use super::engine::{GdalEngine, GdalProgram};
use super::generation::{self};
use super::grid::{self, GeoTransform, RasterGrid, union_grid};
use super::paths::LidarPaths;
use super::prepared_raster::PreparedRaster;
#[cfg(test)]
use super::prepared_raster::RasterWindow;
use common_types::lidar::LidarImportProgressPhase;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Canonical NoData used for a layer whose first source declares none.
pub const FALLBACK_NODATA: f32 = -99999.0;
/// Most cells one whole-raster read into memory may hold (analysis blocks and
/// test oracles). Item reads never materialize a whole raster.
pub(crate) const MAX_RAW_EXTRACTION_CELLS: u64 = 25_000_000;

/// What reading an item's sources costs: each source across its full native
/// grid. NoData is charged too, because a mostly-NoData source still costs
/// decoding work; the count is work accounting, not a coverage measurement.
fn ordered_processing_cost(
    incoming: &[&StagedSource],
) -> Result<Vec<admission::ProcessingCost>, String> {
    Ok(incoming
        .iter()
        .map(|source| admission::ProcessingCost {
            width: source.width,
            height: source.height,
        })
        .collect())
}

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
    /// The staged job that owns this source's prepared bytes.
    pub job_id: String,
    /// The retained controlled source COG this interpretation reads from.
    pub source_cog: RetainedSourceCog,
    /// Valid cells the prepared source actually holds, so the batch can refuse
    /// an all-NoData member by name.
    pub valid_cells: u64,
    pub compatible: bool,
    pub issues: Vec<String>,
}

/// One retained controlled source COG, as a staged job records it.
///
/// The digest names the immutable content-addressed asset; the grid lives on
/// the staged source itself, and the effective NoData is this source's own
/// rule, never another member's sentinel.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RetainedSourceCog {
    pub sha256: String,
    pub bytes: u64,
    pub nodata: Option<f32>,
    pub value_range: [f64; 2],
    /// Location relative to the owning job's root while the job is unpublished.
    pub relative_path: String,
}

impl RetainedSourceCog {
    /// Resolve this retained COG's readable path under the owning job root;
    /// the digest is identity, never proof that a global file exists.
    pub(super) fn resolve(&self, paths: &LidarPaths, job_id: &str) -> Result<PathBuf, String> {
        let relative = &self.relative_path;
        resolve_under_root(&paths.job_dir(job_id), relative).map_err(|error| {
            format!("staged source COG location {relative} escapes its job root: {error}")
        })
    }
}

/// Move a prepared job to publishing.
///
/// Guarded on the staging state so a job that was cancelled while it prepared
/// stays cancelled and its publication is refused.
fn mark_publishing(library: &LidarLibrary, job_id: &str) -> Result<(), String> {
    let connection = library.catalogue()?;
    connection
        .execute(
            "UPDATE lidar_import_jobs
             SET state = 'applying', message = NULL,
                 progress_phase = 'composing_layer', progress_percent = 0,
                 updated_at = ?2
             WHERE id = ?1 AND state = 'staging'",
            rusqlite::params![job_id, catalogue::now_iso()],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the staged payload one job wrote during preparation.
///
/// The payload is the job's own record of what it prepared, and publication
/// reads it to publish exactly what was validated.
pub fn read_staged_import(library: &LidarLibrary, job_id: &str) -> Result<StagedImport, String> {
    let path = library.inner.paths.job_dir(job_id).join("staging.json");
    let staging_json = std::fs::read_to_string(&path)
        .map_err(|e| format!("Staged import data is missing: {e}"))?;
    serde_json::from_str(&staging_json).map_err(|e| format!("Invalid staging data: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StagedImport {
    pub job_id: String,
    pub layer_id: String,
    pub layer_nodata: f32,
    pub union_grid: RasterGrid,
    pub sources: Vec<StagedSource>,
    /// Processing cells this batch was admitted for.
    pub processing_cells: u64,
    pub engine_version: String,
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
) -> Result<(), String> {
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
    validate_source_selection(source_paths)?;

    let layer = {
        let connection = library.catalogue()?;
        let layer = catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        if catalogue::head_generation(&connection, layer_id)?.is_some() {
            return Err("this library item is already published and fixed".to_string());
        }
        layer
    };

    let job_dir = paths.job_dir(job_id);
    std::fs::create_dir_all(&job_dir).map_err(|e| format!("Failed to create job dir: {e}"))?;

    let mut staged: Vec<StagedSource> = Vec::new();
    for source_path in source_paths {
        check_cancel(cancel)?;
        // A source this batch cannot use refuses the whole batch, and the
        // refusal names the user's own file: "gdalinfo failed on a hashed copy"
        // is not an answer anyone can act on.
        let filename = source_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| source_path.display().to_string());
        let staged_source = stage_source(
            engine,
            paths,
            library,
            &layer.measurement_kind,
            &layer.units,
            source_path,
            job_id,
            &job_dir,
            cancel,
        )
        .map_err(|error| format!("{filename}: {error}"))?;
        staged.push(staged_source);
    }

    // One common interpretation for the whole batch: the first compatible
    // source is the anchor every other selected source must match, so an
    // EPSG:3857 and an EPSG:4326 raster with equal coordinates are not both
    // admitted into one item.
    {
        let anchor = staged
            .iter()
            .find(|source| source.compatible)
            .map(|source| (grid_for_source(source), source.crs_wkt.clone()));
        if let Some((anchor_grid, anchor_crs)) = anchor {
            for source in staged.iter_mut().filter(|source| source.compatible) {
                if source.crs_wkt.trim() != anchor_crs.trim() {
                    source.compatible = false;
                    source
                        .issues
                        .push("horizontal CRS differs from the other selected sources".to_string());
                }
                if let Err(error) = grid_for_source(source).compatible(&anchor_grid) {
                    source.compatible = false;
                    source.issues.push(format!(
                        "grid incompatible with the other selected sources: {error}"
                    ));
                }
            }
        }
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

    // Union grid across every compatible source. It is metadata: work is
    // bounded by blocks, never sized by its area.
    let mut union = grid_for_source(compatible[0]);
    let layer_nodata = compatible[0].nodata.unwrap_or(FALLBACK_NODATA);
    for source in &compatible {
        union = union_grid(&union, &grid_for_source(source))?;
    }
    validate_lattice(&union, "import")?;
    let admitted_processing_cells =
        admission::check_processing_budget(ordered_processing_cost(&compatible)?, "import")?;

    // Every selected source is now prepared and validated independently, and
    // that is all publication needs: the composition is defined by its members,
    // their order and their own stored facts.
    check_cancel(cancel)?;
    let engine_version = engine_version(engine);

    // Every issue is reported against the file it is about, so a refused batch
    // names the user's own sources rather than only the rule that refused them.
    let issues: Vec<String> = staged
        .iter()
        .flat_map(|source| {
            source
                .issues
                .iter()
                .map(|issue| format!("{}: {issue}", source.filename))
        })
        .collect();

    let staging = StagedImport {
        job_id: job_id.to_string(),
        layer_id: layer_id.to_string(),
        layer_nodata,
        union_grid: union,
        sources: staged,
        processing_cells: admitted_processing_cells,
        engine_version,
    };
    std::fs::write(
        job_dir.join("staging.json"),
        serde_json::to_string(&staging).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to persist staging: {e}"))?;

    if !issues.is_empty() {
        return Err(issues.join("; "));
    }
    // Preparation is finished and the batch is valid, so the job moves to
    // publishing here rather than in a separate caller step: publication
    // refuses any other state, and a cancelled job is left cancelled by the
    // guarded update below.
    mark_publishing(library, job_id)?;
    Ok(())
}

/// Refuse a batch that contains any rejected source.
///
/// A selected batch is atomic: publishing the compatible subset would silently
/// accept a selection the user never approved. The UI already refuses to
/// confirm such a batch, and this is the same rule enforced where the
/// publication actually happens.
pub(super) fn ensure_whole_batch_compatible(staging: &StagedImport) -> Result<(), String> {
    let rejected: Vec<String> = staging
        .sources
        .iter()
        .filter(|source| !source.compatible)
        .map(|source| format!("{}: {}", source.filename, source.issues.join("; ")))
        .collect();
    if rejected.is_empty() {
        return Ok(());
    }
    Err(format!(
        "the selected batch contains sources that cannot be published, so none was: {}",
        rejected.join(" | ")
    ))
}

/// The layer's fixed lattice, recorded from its first accepted source.
///
/// The anchor never moves, so a later import that extends the layer left or up
/// keeps every unchanged member's chunk coordinates. Width and height describe
/// only how far the lattice currently reaches right and down from the anchor;
/// the sparse resolver addresses negative cells directly.
fn layer_lattice_grid(
    connection: &rusqlite::Connection,
    layer_id: &str,
    anchor: &RasterGrid,
    crs_wkt: &str,
) -> Result<RasterGrid, String> {
    let row = catalogue::LayerLatticeRow {
        origin_x: anchor.geotransform[0],
        origin_y: anchor.geotransform[3],
        pixel_x: anchor.geotransform[1],
        pixel_y: anchor.geotransform[5],
        crs_wkt: crs_wkt.to_string(),
    };
    catalogue::record_layer_lattice(connection, layer_id, &row)?;
    let stored = catalogue::layer_lattice(connection, layer_id)?
        .ok_or_else(|| "layer lattice was not recorded".to_string())?;
    Ok(RasterGrid {
        width: anchor.width,
        height: anchor.height,
        geotransform: [
            stored.origin_x,
            stored.pixel_x,
            0.0,
            stored.origin_y,
            0.0,
            stored.pixel_y,
        ],
    })
}

/// Validate a selection against the one admission policy.
///
/// Returns the total selected bytes so callers reuse the counted value instead
/// of re-deriving it. Every bound comes from `admission`, so an authorized
/// representative run can raise it for its own thread and nothing else changes.
fn validate_source_selection(source_paths: &[PathBuf]) -> Result<u64, String> {
    if source_paths.is_empty() {
        return Err("select at least one raster source".to_string());
    }
    admission::check_source_count(source_paths.len())?;
    let mut total_bytes = 0u64;
    for path in source_paths {
        let metadata = std::fs::metadata(path)
            .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?;
        if !metadata.is_file() {
            return Err(format!("{} is not a regular file", path.display()));
        }
        admission::check_source_bytes(path, metadata.len())?;
        total_bytes = total_bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "selected source sizes overflow the import budget".to_string())?;
    }
    admission::check_import_bytes(total_bytes)?;
    Ok(total_bytes)
}

pub(crate) fn validate_working_grid(grid: &RasterGrid, operation: &str) -> Result<(), String> {
    let cells = u64::from(grid.width)
        .checked_mul(u64::from(grid.height))
        .ok_or_else(|| format!("{operation} dimensions overflow"))?;
    if cells > MAX_RAW_EXTRACTION_CELLS {
        return Err(format!(
            "{operation} requires {cells} cells; a whole-raster read is limited to {MAX_RAW_EXTRACTION_CELLS}"
        ));
    }
    Ok(())
}

fn stage_managed_original(
    paths: &LidarPaths,
    source_path: &Path,
    job_dir: &Path,
    filename: &str,
    cancel: &AtomicBool,
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
            check_cancel(cancel)?;
            let read = source
                .read(&mut buffer)
                .map_err(|e| format!("Failed to read {}: {e}", source_path.display()))?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(read as u64)
                .ok_or_else(|| "source byte count overflow".to_string())?;
            admission::check_source_bytes(source_path, total)
                .map_err(|error| format!("{error} while the managed original was being copied"))?;
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
        let (existing_hash, existing_size) = hash_file_limited(&managed_original, cancel)?;
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

fn hash_file_limited(path: &Path, cancel: &AtomicBool) -> Result<(String, u64), String> {
    let mut file = std::io::BufReader::new(
        std::fs::File::open(path)
            .map_err(|e| format!("Failed to verify {}: {e}", path.display()))?,
    );
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        check_cancel(cancel)?;
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to verify {}: {e}", path.display()))?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or_else(|| "managed source size overflow".to_string())?;
        admission::check_source_bytes(path, total)
            .map_err(|error| format!("{error} while the managed original was verified"))?;
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
    measurement_kind: &str,
    units: &str,
    source_path: &Path,
    job_id: &str,
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
        stage_managed_original(paths, source_path, job_dir, &filename, cancel)?;

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

    // One retained controlled source COG carries this interpretation's numbers
    // from here on; the managed original is never loaded whole and no durable
    // raw/mask pair is written beside it.
    let source_grid = RasterGrid {
        width: probe.width,
        height: probe.height,
        geotransform: probe.geotransform,
    };
    // No working-area check: `gdal_translate` streams the source into the
    // retained COG and its facts are read from that COG in bounded windows.
    // The item's bound is the admission processing budget.
    validate_lattice(&source_grid, "source raster")?;
    let (source_cog, valid_cells) = stage_source_samples(
        engine,
        cancel,
        &managed_original,
        &source_grid,
        &probe.crs_wkt,
        probe.nodata,
        job_dir,
        &sha256,
    )?;
    let value_range = source_cog.value_range;
    if valid_cells == 0 {
        // An all-NoData selection is refused by name here rather than published
        // as an occurrence that can never contribute a sample.
        issues.push(
            "source holds no valid samples; every cell is NoData under its own rule".to_string(),
        );
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
                crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash,
                valid_cells, min_value, max_value)
             VALUES(?1, ?2, 1, ?3, ?4, 1, 0, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
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
                valid_cells as i64,
                (valid_cells > 0).then_some(value_range[0]),
                (valid_cells > 0).then_some(value_range[1]),
            ],
        )
        .map_err(|e| format!("Failed to record interpretation: {e}"))?;
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
        job_id: job_id.to_string(),
        source_cog,
        valid_cells,
        compatible: issues.is_empty(),
        issues,
    })
}

// ---------------------------------------------------------------------------
// Streamed source extraction
// ---------------------------------------------------------------------------

/// Convert one source into its job-owned retained COG and read its range and
/// valid-cell count from that COG in bounded windows. A failed or cancelled
/// attempt removes its partial output.
#[allow(clippy::too_many_arguments)]
fn stage_source_samples(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    input: &Path,
    grid: &RasterGrid,
    crs_wkt: &str,
    nodata: Option<f32>,
    job_dir: &Path,
    sha256: &str,
) -> Result<(RetainedSourceCog, u64), String> {
    let stem = format!("source-cog-{}", &sha256[..sha256.len().min(16)]);
    // The conversion streams through GDAL and the admitted COG is the durable
    // output, so no additional numeric output is charged beside it. The
    // combined footprint is measured against the job scratch, which holds the
    // conversion until it is admitted.
    let asset = super::raster_assets::write_job_source_cog(
        engine, cancel, job_dir, &stem, input, grid, crs_wkt, nodata,
    )?;
    let relative_path = asset
        .path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| "staged source COG has no file name".to_string())?;
    let mut reader = PreparedRaster::open_committed(&asset.path, grid, nodata)?;
    let (value_range, valid_cells) = scan_source_facts(&mut reader, cancel)?;
    drop(reader);
    Ok((
        RetainedSourceCog {
            sha256: asset.sha256,
            bytes: asset.bytes,
            nodata,
            value_range,
            relative_path,
        },
        valid_cells,
    ))
}

/// Range and valid-cell count of one retained source, in bounded windows.
///
/// The range spans the samples that are **data**: the reader's validity flag is
/// the single rule, so a declared NoData sentinel is excluded however finite it
/// is, while legitimate zero and negative samples are kept. A sentinel like
/// -9999 would otherwise dominate the range and describe the dataset wrongly.
///
/// A source with no valid sample has no range to report. It returns
/// `[0.0, 0.0]` with a zero count, which callers must read as "no range" rather
/// than as a measured zero: the count is what distinguishes the two.
fn scan_source_facts(
    reader: &mut PreparedRaster,
    cancel: &AtomicBool,
) -> Result<([f64; 2], u64), String> {
    let (mut min, mut max) = (f64::INFINITY, f64::NEG_INFINITY);
    let mut valid_cells = 0u64;
    reader.scan(cancel, |_window, samples, valid| {
        for (value, valid) in samples.iter().zip(valid.iter()) {
            if *valid == 0 {
                continue;
            }
            valid_cells = valid_cells.saturating_add(1);
            let value = f64::from(*value);
            // The flag already requires finiteness; this keeps the range finite
            // even if a future reader relaxes that.
            if value.is_finite() {
                min = min.min(value);
                max = max.max(value);
            }
        }
        Ok(())
    })?;
    if valid_cells > 0 && min.is_finite() {
        Ok(([min, max], valid_cells))
    } else {
        Ok(([0.0, 0.0], valid_cells))
    }
}

/// Check that a lattice is representable, without limiting its area.
///
/// A sparse or block-wise caller never allocates by lattice area, so the dense
/// working ceiling does not apply to it; what must hold is that its geometry is
/// finite and its arithmetic cannot overflow.
fn validate_lattice(grid: &RasterGrid, operation: &str) -> Result<(), String> {
    if grid.width == 0 || grid.height == 0 {
        return Err(format!("{operation} has an empty extent"));
    }
    u64::from(grid.width)
        .checked_mul(u64::from(grid.height))
        .ok_or_else(|| format!("{operation} dimensions overflow"))?;
    if !grid.geotransform.iter().all(|value| value.is_finite()) {
        return Err(format!("{operation} geometry is not finite"));
    }
    if grid.geotransform[1] == 0.0 || grid.geotransform[5] == 0.0 {
        return Err(format!("{operation} has a degenerate pixel size"));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// BG7: job-owned source COGs and their promotion journal
// ---------------------------------------------------------------------------

/// Test-only fault points in the promotion lifecycle.
///
/// `check` is compiled in both builds so the real lifecycle calls it
/// unconditionally; only the trigger is test-only, which keeps a fault seam
/// out of production behaviour without a second implementation.
pub(crate) mod promotion_probe {
    #[cfg(test)]
    use std::cell::RefCell;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub(crate) enum FaultPoint {
        /// Immediately before a job-local COG is hard-linked into the store.
        ///
        /// The armed action runs here, between the destination check and the
        /// link, so a collision timing is exercised deterministically.
        BeforePromotionLink,
        /// After a job-local COG has been promoted, before any catalogue write.
        AfterPromotion,
        /// Immediately before the publication transaction begins.
        BeforeTransaction,
        /// After the publication transaction commits, before journal cleanup.
        AfterCommitBeforeCleanup,
        /// Immediately before a promotion journal is cleared.
        BeforeJournalClear,
    }

    /// One seam and the action a test runs when that seam is reached.
    #[cfg(test)]
    type ArmedAction = (FaultPoint, Box<dyn Fn()>);

    #[cfg(test)]
    thread_local! {
        static ARMED: RefCell<Vec<FaultPoint>> = const { RefCell::new(Vec::new()) };
        static ACTIONS: RefCell<Vec<ArmedAction>> = const { RefCell::new(Vec::new()) };
    }

    #[cfg(test)]
    pub(crate) fn fail_at(point: FaultPoint) {
        ARMED.with(|armed| armed.borrow_mut().push(point));
    }

    /// Run one action at every occurrence of a fault point, then continue.
    ///
    /// Actions stay armed until [`clear`], so an action can behave differently
    /// on its second call — which is how a collision on the second source is
    /// exercised deterministically.
    #[cfg(test)]
    pub(crate) fn act_at(point: FaultPoint, action: impl Fn() + 'static) {
        ACTIONS.with(|actions| actions.borrow_mut().push((point, Box::new(action))));
    }

    #[cfg(test)]
    pub(crate) fn clear() {
        ARMED.with(|armed| armed.borrow_mut().clear());
        ACTIONS.with(|actions| actions.borrow_mut().clear());
    }

    /// Consume one armed failure at this point, before any action runs.
    pub(crate) fn check(point: FaultPoint) -> Result<(), String> {
        #[cfg(test)]
        {
            let armed = ARMED.with(|armed| {
                let mut armed = armed.borrow_mut();
                armed
                    .iter()
                    .position(|armed| *armed == point)
                    .map(|position| armed.remove(position))
            });
            if armed.is_some() {
                return Err(format!("injected failure at {point:?}"));
            }
        }
        let _ = point;
        Ok(())
    }

    /// Run any armed actions for this point; failures come from [`check`].
    pub(crate) fn run(point: FaultPoint) {
        #[cfg(test)]
        {
            ACTIONS.with(|actions| {
                for (armed, action) in actions.borrow().iter() {
                    if *armed == point {
                        action();
                    }
                }
            });
        }
        let _ = point;
    }
}

/// Resolve a recorded root-relative location under an owned root.
///
/// Only plain path components are accepted: an absolute path, a parent
/// traversal or a prefix component is refused before any file is touched, so a
/// journal or staged record can never name a file outside its owner's root.
fn resolve_under_root(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let recorded = Path::new(relative);
    if recorded.as_os_str().is_empty() || recorded.is_absolute() {
        return Err(format!(
            "recorded location {relative:?} is not root-relative"
        ));
    }
    if recorded
        .components()
        .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!(
            "recorded location {relative:?} leaves its owning root"
        ));
    }
    Ok(root.join(recorded))
}

/// One source COG this job has promoted into the immutable store.
#[derive(Debug, Clone)]
struct PromotedSourceCog {
    interpretation_id: String,
    sha256: String,
    /// Global destination the publication references.
    path: PathBuf,
    bytes: u64,
    nodata: Option<f32>,
    grid: RasterGrid,
    crs_wkt: String,
}

impl PromotedSourceCog {
    fn asset(&self) -> super::raster_assets::CogAsset {
        super::raster_assets::CogAsset {
            sha256: self.sha256.clone(),
            path: self.path.clone(),
            bytes: self.bytes,
            grid: self.grid.clone(),
            nodata: self.nodata,
        }
    }
}

/// One journal entry: the intent, then the outcome, of promoting one file.
///
/// The destination is recorded relative to the library root, so recovery
/// resolves it through the owned root instead of trusting a stored path.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PromotionEntry {
    interpretation_id: String,
    sha256: String,
    destination: String,
    /// Job-relative location of the file this job hard-linked to the
    /// destination.
    ///
    /// Positive file identity with this witness — not a matching digest and not
    /// the intent itself — is what licenses deleting an uncommitted
    /// destination. An entry written before witnesses existed has none, so its
    /// destination is preserved and reported as unproven ownership.
    #[serde(default)]
    witness: Option<String>,
}

/// The promotions one job has attempted, in the order it attempted them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PromotionJournal {
    entries: Vec<PromotionEntry>,
}

/// Journal file of one job, next to the payloads it owns.
fn promotion_journal_path(paths: &LidarPaths, job_id: &str) -> PathBuf {
    paths.job_dir(job_id).join("promotions.json")
}

fn read_promotion_journal(paths: &LidarPaths, job_id: &str) -> Result<PromotionJournal, String> {
    let path = promotion_journal_path(paths, job_id);
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json)
            .map_err(|e| format!("Invalid promotion journal {}: {e}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PromotionJournal::default())
        }
        Err(error) => Err(format!(
            "Failed to read promotion journal {}: {error}",
            path.display()
        )),
    }
}

/// Record one promotion durably before it happens.
///
/// A crash after this write but before the promotion leaves an intent whose
/// destination does not exist, which recovery treats as nothing to clean up; a
/// crash after the promotion leaves an owned file recovery can remove.
fn write_promotion_journal(
    paths: &LidarPaths,
    job_id: &str,
    journal: &PromotionJournal,
) -> Result<(), String> {
    let path = promotion_journal_path(paths, job_id);
    let parent = path
        .parent()
        .ok_or_else(|| "promotion journal has no directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create promotion journal dir: {e}"))?;
    let staging = parent.join(format!("promotions-{}.json", new_id("journal")));
    let json = serde_json::to_string(journal).map_err(|e| e.to_string())?;
    {
        use std::io::Write as _;
        let mut file = std::fs::File::create(&staging)
            .map_err(|e| format!("Failed to create promotion journal: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write promotion journal: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Failed to sync promotion journal: {e}"))?;
    }
    std::fs::rename(&staging, &path)
        .map_err(|e| format!("Failed to publish promotion journal: {e}"))?;
    sync_journal_directory(parent)
}

/// Make the journal's directory entry durable where the platform supports it.
///
/// A supported platform reports a sync failure: durable intent must not be
/// claimed after ignoring one. Directory syncing is not available on every
/// platform (Windows cannot open a directory for this), so an unsupported
/// platform keeps the rename plus file sync as its documented limit instead of
/// failing an otherwise valid publication.
fn sync_journal_directory(parent: &Path) -> Result<(), String> {
    let attempt = std::fs::File::open(parent).and_then(|dir| dir.sync_all());
    match attempt {
        Ok(()) => Ok(()),
        Err(error) if directory_sync_unsupported(&error) => {
            tracing::debug!(
                directory = %parent.display(),
                error = %error,
                "directory syncing is unavailable on this platform; journal durability rests on the rename and file sync"
            );
            Ok(())
        }
        Err(error) => Err(format!(
            "Failed to sync the promotion journal directory {}: {error}",
            parent.display()
        )),
    }
}

/// Whether a directory-sync failure means "this platform cannot do it".
fn directory_sync_unsupported(error: &std::io::Error) -> bool {
    if cfg!(unix) {
        return false;
    }
    matches!(
        error.kind(),
        std::io::ErrorKind::Unsupported
            | std::io::ErrorKind::PermissionDenied
            | std::io::ErrorKind::InvalidInput
    )
}

/// Remove one job's promotion journal, treating an absent file as idempotent
/// success.
///
/// Clearing is fallible: an unlink or directory-sync error is reported, never
/// swallowed into an "already clean" result. Every caller that removes a
/// journal goes through here so the durability policy has one home.
fn clear_promotion_journal(paths: &LidarPaths, job_id: &str) -> Result<(), String> {
    let path = promotion_journal_path(paths, job_id);
    // The fault seam stands in for a failing unlink and is routed through the
    // same error arm, so a caller that swallows a real I/O failure is caught by
    // the same regression that injects one.
    let removed = match promotion_probe::check(promotion_probe::FaultPoint::BeforeJournalClear) {
        Ok(()) => std::fs::remove_file(&path),
        Err(injected) => Err(std::io::Error::other(injected)),
    };
    match removed {
        Ok(()) => match path.parent() {
            Some(parent) => sync_journal_directory(parent),
            None => Ok(()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to clear the promotion journal {}: {error}",
            path.display()
        )),
    }
}

/// Whether two paths name the very same file.
///
/// Positive identity is one file reachable through two names, which is what a
/// hard link creates; equal content is not identity, because a separately
/// created copy can match a digest. `None` means this platform cannot answer,
/// and every caller treats that as "not proven" rather than as permission.
fn same_file(left: &Path, right: &Path) -> Option<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        let left = std::fs::metadata(left).ok()?;
        let right = std::fs::metadata(right).ok()?;
        Some(left.dev() == right.dev() && left.ino() == right.ino())
    }
    #[cfg(not(unix))]
    {
        let _ = (left, right);
        None
    }
}

/// Remove one uncommitted destination only if this job provably created it.
///
/// The proof is positive file identity with the journalled job-local witness:
/// an absent witness, a missing witness file, a different file or a platform
/// that cannot answer all preserve the destination and report recoverable
/// uncertainty instead of deleting it.
fn remove_owned_destination(
    paths: &LidarPaths,
    job_id: &str,
    entry: &PromotionEntry,
) -> Result<bool, String> {
    let destination = resolve_under_root(paths.root(), &entry.destination)?;
    // A recorded path that leaves the owned root is refused whether or not it
    // exists; a destination that does not exist needs no ownership at all.
    if !destination.exists() {
        return Ok(false);
    }
    let Some(witness) = entry.witness.as_deref() else {
        return Err(format!(
            "promotion of {} records no job-local witness; ownership is unproven",
            entry.destination
        ));
    };
    let witness = resolve_under_root(&paths.job_dir(job_id), witness).map_err(|error| {
        format!(
            "promotion of {} has an unusable witness: {error}",
            entry.destination
        )
    })?;
    match same_file(&destination, &witness) {
        Some(true) => {
            std::fs::remove_file(&destination)
                .map_err(|error| format!("Failed to remove {}: {error}", destination.display()))?;
            Ok(true)
        }
        Some(false) => Err(format!(
            "{} is not the file this job linked; preserving it",
            destination.display()
        )),
        None => Err(format!(
            "file identity is unavailable on this platform; preserving {}",
            destination.display()
        )),
    }
}

/// Promote every staged source COG this job owns into the immutable store.
///
/// Intent is journalled before each promotion, and the catalogue reference is
/// written later inside the publication transaction, so a crash at any point
/// leaves either a job-owned unpublished file (recoverable) or a committed
/// asset. A destination that already exists is a non-owning reuse: this job
/// never claims or deletes it.
fn promote_source_cogs(
    library: &LidarLibrary,
    staging: &StagedImport,
    cancel: &AtomicBool,
    promoted: &mut Vec<PromotedSourceCog>,
) -> Result<(), String> {
    let paths = &library.inner.paths;
    let mut journal = read_promotion_journal(paths, &staging.job_id)?;
    for source in staging.sources.iter().filter(|source| source.compatible) {
        check_cancel(cancel)?;
        let cog = &source.source_cog;
        let interpretation_id = format!("interp-{}", source.interp_hash);
        let destination = paths.asset_cog(&cog.sha256);
        let destination_rel = destination
            .strip_prefix(paths.root())
            .map_err(|_| "asset destination is outside the library root".to_string())?
            .to_string_lossy()
            .into_owned();
        if !destination.exists() {
            let parent = destination
                .parent()
                .ok_or_else(|| "asset destination has no directory".to_string())?;
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create asset directory: {e}"))?;
            // A job-local file being promoted is charged as a second copy: the
            // job keeps its own until publication succeeds.
            super::paths::require_free_space(parent, cog.bytes, "the promoted source COG")?;
            let local = cog.resolve(paths, &source.job_id)?;
            let witness = Some(cog.relative_path.clone());
            journal.entries.push(PromotionEntry {
                interpretation_id: interpretation_id.clone(),
                sha256: cog.sha256.clone(),
                destination: destination_rel.clone(),
                witness,
            });
            write_promotion_journal(paths, &staging.job_id, &journal)?;
            promotion_probe::check(promotion_probe::FaultPoint::BeforePromotionLink)?;
            promotion_probe::run(promotion_probe::FaultPoint::BeforePromotionLink);
            // Same-filesystem, no-replace link: an unbudgeted copy fallback is
            // refused rather than silently doubling the footprint.
            match std::fs::hard_link(&local, &destination) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    // A collision is not ownership. Give the intent up before any
                    // further fallible work, so neither this job's rollback nor a
                    // later restart can treat a file this job did not create as
                    // its own, and refuse the conflicting attempt by name.
                    journal.entries.retain(|entry| {
                        !(entry.sha256 == cog.sha256 && entry.destination == destination_rel)
                    });
                    if let Err(cleanup) = write_promotion_journal(paths, &staging.job_id, &journal)
                    {
                        tracing::warn!(
                            job_id = staging.job_id,
                            error = %cleanup,
                            "could not record the relinquished promotion intent"
                        );
                    }
                    // Ownership is decided by file identity, so a stale intent
                    // cannot license deletion even if the journal write failed.
                    return Err(format!(
                        "asset {} already exists; refusing to adopt a file this job did not create",
                        destination.display()
                    ));
                }
                Err(error) => {
                    if !destination.exists() {
                        journal.entries.retain(|entry| {
                            !(entry.sha256 == cog.sha256 && entry.destination == destination_rel)
                        });
                        let _ = write_promotion_journal(paths, &staging.job_id, &journal);
                    }
                    return Err(format!(
                        "Failed to promote staged source COG {} to {} without copying: {error}",
                        local.display(),
                        destination.display()
                    ));
                }
            }
        }
        // The destination must match the declared identity before any catalogue
        // row references it: a readable layout is not proof that a reused file
        // is the payload this source declares.
        let grid = grid_for_source(source);
        let (destination_digest, destination_bytes) =
            super::raster_assets::hash_file(&destination, cancel)?;
        if destination_digest != cog.sha256 || destination_bytes != cog.bytes {
            return Err(format!(
                "asset {} holds {destination_bytes} bytes of {destination_digest}, not the declared {} bytes of {}",
                destination.display(),
                cog.bytes,
                cog.sha256
            ));
        }
        let reader = PreparedRaster::open_committed(&destination, &grid, cog.nodata)?;
        drop(reader);
        promoted.push(PromotedSourceCog {
            interpretation_id,
            sha256: cog.sha256.clone(),
            path: destination,
            bytes: cog.bytes,
            nodata: cog.nodata,
            grid,
            crs_wkt: source.crs_wkt.clone(),
        });
        promotion_probe::check(promotion_probe::FaultPoint::AfterPromotion)?;
    }
    Ok(())
}

/// Rolls back this job's uncommitted promotions unless the publication arms it.
///
/// Every exit from the publication path — an early "no change" decision, a
/// cancelled materialization, a failed head transaction — drops the guard and
/// removes only the destinations this job created and no committed reference
/// owns. A successful publication calls [`Self::commit`], which clears the
/// journal and disarms the rollback.
struct PromotionGuard<'a> {
    library: &'a LidarLibrary,
    staging: &'a StagedImport,
    promoted: Vec<PromotedSourceCog>,
    committed: bool,
}

impl<'a> PromotionGuard<'a> {
    /// Take ownership of this job's promotions before the first side effect.
    ///
    /// The guard exists before any intent is journalled or any file is linked,
    /// so an error during a later source, a validation failure or a
    /// cancellation still reaches rollback: a guard built from a finished
    /// promotion list would be too late for the work already done.
    fn begin(library: &'a LidarLibrary, staging: &'a StagedImport) -> Self {
        Self {
            library,
            staging,
            promoted: Vec::new(),
            committed: false,
        }
    }

    /// Promote every staged source COG this job owns, recording each as it lands.
    fn promote(&mut self, cancel: &AtomicBool) -> Result<(), String> {
        promote_source_cogs(self.library, self.staging, cancel, &mut self.promoted)
    }

    fn promoted(&self) -> &[PromotedSourceCog] {
        &self.promoted
    }

    /// The publication committed: keep the assets, then clear the journal.
    ///
    /// The commit boundary is the head transaction, so this marks the owner
    /// committed first — unconditionally — and reports a later journal-cleanup
    /// failure as a diagnostic. The publication is authoritative either way;
    /// the retained journal is retry evidence, not a failed Apply.
    fn commit(mut self) -> Option<String> {
        self.committed = true;
        match mark_promotions_committed(self.library, self.staging) {
            Ok(()) => None,
            Err(error) => {
                tracing::warn!(
                    job_id = self.staging.job_id,
                    error = %error,
                    "publication committed; promotion evidence retained for recovery"
                );
                Some(format!(
                    "published; promotion evidence retained for recovery: {error}"
                ))
            }
        }
    }
}

impl Drop for PromotionGuard<'_> {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        if let Err(error) = rollback_promotions(self.library, self.staging, &self.promoted) {
            tracing::warn!(
                job_id = self.staging.job_id,
                error = %error,
                "promotion rollback left recoverable evidence"
            );
        }
    }
}

/// Write the catalogue references that make promoted payloads authoritative.
///
/// Called inside the publication transaction: the generation, its head and the
/// source references it depends on become visible together or not at all.
fn insert_promoted_references(
    connection: &rusqlite::Connection,
    paths: &LidarPaths,
    promoted: &[PromotedSourceCog],
) -> Result<(), String> {
    for asset in promoted {
        catalogue::insert_raster_asset(
            connection,
            &generation::asset_row(paths, &asset.asset(), &asset.crs_wkt)?,
        )?;
        connection
            .execute(
                "INSERT INTO lidar_interpretation_cogs(
                    interpretation_id, asset_sha256, nodata, created_at)
                 VALUES(?1, ?2, ?3, ?4)
                 ON CONFLICT(interpretation_id) DO NOTHING",
                rusqlite::params![
                    asset.interpretation_id,
                    asset.sha256,
                    asset.nodata,
                    now_iso(),
                ],
            )
            .map_err(|e| format!("Failed to record interpretation COG: {e}"))?;
    }
    Ok(())
}

/// Drop promotions that no committed reference owns.
///
/// Only destinations this job journalled are candidates, and only when no
/// interpretation references the digest: a reused asset, an accepted
/// generation or an analysis result is never touched.
fn rollback_promotions(
    library: &LidarLibrary,
    staging: &StagedImport,
    owned: &[PromotedSourceCog],
) -> Result<(), String> {
    let paths = &library.inner.paths;
    let journal = read_promotion_journal(paths, &staging.job_id)?;
    let mut failures = Vec::new();
    for entry in &journal.entries {
        let referenced = {
            let connection = library.catalogue()?;
            catalogue::asset_reference_exists(&connection, &entry.sha256)?
        };
        if referenced {
            continue;
        }
        if let Err(error) = remove_owned_destination(paths, &staging.job_id, entry) {
            failures.push(error);
        }
    }
    let _ = owned;
    if !failures.is_empty() {
        return Err(format!(
            "promotion cleanup left recoverable evidence: {}",
            failures.join("; ")
        ));
    }
    clear_promotion_journal(paths, &staging.job_id)
}

/// Record that the publication committed, so recovery keeps the assets.
fn mark_promotions_committed(library: &LidarLibrary, staging: &StagedImport) -> Result<(), String> {
    // The publication is already committed here: an interruption before the
    // journal is cleared is exactly the state recovery resolves.
    promotion_probe::check(promotion_probe::FaultPoint::AfterCommitBeforeCleanup)?;
    clear_promotion_journal(&library.inner.paths, &staging.job_id)
}

/// Settle one job's root: reconcile its promotion journal, then remove it.
///
/// The journal decision and the directory removal are one decision. A root whose
/// journal cannot be settled is retained with its evidence and reported, so the
/// next normal recovery attempt can retry instead of losing the only record of
/// what this job promoted.
pub fn settle_job_root(library: &LidarLibrary, job_id: &str) -> Result<(), String> {
    reconcile_promotion_journals(library, &[job_id.to_string()])?;
    let root = library.inner.paths.job_dir(job_id);
    if root.exists() {
        std::fs::remove_dir_all(&root)
            .map_err(|e| format!("Failed to remove settled job root {}: {e}", root.display()))?;
    }
    Ok(())
}

/// Reconcile journals left by interrupted jobs before accepting new work.
///
/// A committed reference wins: its asset stays even if the journal still lists
/// it. An entry with no committed owner was created by that job and is removed.
/// Only journalled destinations are candidates. A journal whose cleanup fails is retained so
/// the failure stays visible and retryable.
pub fn reconcile_promotion_journals(
    library: &LidarLibrary,
    job_ids: &[String],
) -> Result<usize, String> {
    let paths = &library.inner.paths;
    let mut removed = 0usize;
    let mut failures = Vec::new();
    for job_id in job_ids {
        let journal = match read_promotion_journal(paths, job_id) {
            Ok(journal) => journal,
            Err(error) => {
                failures.push(error);
                continue;
            }
        };
        for entry in &journal.entries {
            let referenced = {
                let connection = library.catalogue()?;
                catalogue::asset_reference_exists(&connection, &entry.sha256)?
            };
            if referenced {
                continue;
            }
            match remove_owned_destination(paths, job_id, entry) {
                Ok(true) => removed += 1,
                Ok(false) => {}
                Err(error) => failures.push(error),
            }
        }
        // The journal is cleared only when every entry was resolved: an
        // unresolved entry keeps the evidence for the next attempt.
        if failures.is_empty()
            && let Err(error) = clear_promotion_journal(paths, job_id)
        {
            failures.push(error);
        }
    }
    if failures.is_empty() {
        Ok(removed)
    } else {
        Err(format!(
            "promotion recovery left recoverable evidence: {}",
            failures.join("; ")
        ))
    }
}

/// The promoted, content-addressed COG of a staged source: the member's only
/// durable payload. The publication transaction writes the reference that
/// makes it authoritative.
fn promoted_source_cog(paths: &LidarPaths, source: &StagedSource) -> Result<PathBuf, String> {
    let promoted = paths.asset_cog(&source.source_cog.sha256);
    if !promoted.exists() {
        return Err(format!(
            "staged source {} has no promoted asset at {}",
            source.filename,
            promoted.display()
        ));
    }
    Ok(promoted)
}

/// What publishing a new item produced.
#[derive(Debug)]
pub struct ApplyOutcome {
    pub generation_id: String,
    /// Exact published cells, or `None` when the composition's count is not
    /// derivable from member facts. An unknown count is never reported as zero.
    pub published_cells: Option<u64>,
    /// A diagnostic from after the commit point (journal cleanup), if any.
    pub message: Option<String>,
}

impl ApplyOutcome {
    /// Summary used in structured logs so the generation identity is recorded.
    pub fn summary(&self) -> String {
        format!(
            "generation {} published with {}",
            self.generation_id,
            match self.published_cells {
                Some(cells) => format!("{cells} cells"),
                None => "unknown coverage".to_string(),
            }
        )
    }
}

/// Publish a new fixed item once: its sources, in the listed order, as one
/// ordered collection.
///
/// A published item is fixed, so there is no head to extend or replace: a
/// second publication of the same item is refused. Nothing is materialized;
/// the publication costs member metadata and one bounded measuring pass.
pub fn apply_import(
    library: &LidarLibrary,
    staging: &StagedImport,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let paths = &library.inner.paths;
    let layer_id = staging.layer_id.clone();
    library.record_import_progress(&staging.job_id, LidarImportProgressPhase::ComposingLayer, 2);
    {
        let connection = library.catalogue()?;
        if catalogue::head_generation(&connection, &layer_id)?.is_some() {
            return Err("this library item is already published and fixed".to_string());
        }
    }
    ensure_whole_batch_compatible(staging)?;
    let compatible: Vec<&StagedSource> = staging.sources.iter().filter(|s| s.compatible).collect();
    if compatible.is_empty() {
        return Err("import has no compatible sources to publish".to_string());
    }
    let mut union = grid_for_source(compatible[0]);
    validate_lattice(&union, "import publication")?;
    for source in &compatible {
        union = union_grid(&union, &grid_for_source(source))?;
        validate_lattice(&union, "import publication union")?;
    }
    admission::check_processing_budget(
        ordered_processing_cost(&compatible)?,
        "import publication",
    )?;
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::PreparingRaster,
        42,
    );

    // Promote the job's own source COGs into the immutable store first: the
    // generation references global assets, and the references that make them
    // authoritative are written inside the publication transaction.
    let mut promotions = PromotionGuard::begin(library, staging);
    promotions.promote(cancel)?;
    for (index, source) in compatible.iter().enumerate() {
        check_cancel(cancel)?;
        promoted_source_cog(paths, source)?;
        let completed = u64::try_from(index + 1).unwrap_or(u64::MAX);
        let total = u64::try_from(compatible.len()).unwrap_or(u64::MAX).max(1);
        let percent = 42 + u8::try_from(completed.saturating_mul(8) / total).unwrap_or(8);
        library.record_import_progress(
            &staging.job_id,
            LidarImportProgressPhase::PreparingRaster,
            percent.min(50),
        );
    }
    let crs_wkt = compatible[0].crs_wkt.clone();
    let lattice = {
        let connection = library.catalogue()?;
        layer_lattice_grid(
            &connection,
            &layer_id,
            &grid_for_source(compatible[0]),
            &crs_wkt,
        )?
    };
    // The first listed source is topmost.
    let mut members = Vec::with_capacity(compatible.len());
    let mut manifest_members = Vec::with_capacity(compatible.len());
    for (source, resolved) in compatible
        .iter()
        .zip(incoming_occurrences(paths, &compatible)?)
    {
        manifest_members.push(source.interp_hash.clone());
        members.push(collection::SnapshotMember {
            member_id: new_id("mem"),
            interpretation_id: format!("interp-{}", source.interp_hash),
            resolved,
        });
    }
    let plan = collection::SnapshotPlan {
        members,
        lattice,
        crs_wkt,
        nodata: staging.layer_nodata,
        manifest_members,
    };
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::ComposingLayer,
        60,
    );
    let measurement = collection::measure(library, &plan, cancel)?;
    // Member facts prove an empty composition exactly.
    if measurement.published_cells == Some(0) {
        let named = compatible
            .iter()
            .map(|source| source.filename.clone())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "selection contains no valid pixels; nothing published ({named})"
        ));
    }
    let (manifest_json, _) = collection::manifest_for(library, &plan)?;
    let generation_id = new_id("gen");
    publish_applied_snapshot(
        library,
        staging,
        &generation_id,
        &plan,
        &measurement,
        &manifest_json,
        promotions.promoted(),
    )?;
    // The head transaction is the commit point: from here the publication is
    // authoritative even if journal cleanup fails.
    let diagnostic = promotions.commit();
    library.record_import_progress(&staging.job_id, LidarImportProgressPhase::Finalizing, 98);
    Ok(ApplyOutcome {
        generation_id,
        published_cells: measurement.published_cells,
        message: diagnostic,
    })
}

/// Stage, validate and publish one batch the way the one-step route does.
///
/// The same sequence production runs: prepare every source, refuse an
/// incompatible batch, then publish atomically.
#[cfg(test)]
pub(crate) fn stage_and_publish(
    library: &LidarLibrary,
    job_id: &str,
    layer_id: &str,
    source_paths: &[PathBuf],
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    stage_import(library, job_id, layer_id, source_paths, cancel)?;
    let staging = read_staged_import(library, job_id)?;
    apply_import(library, &staging, cancel)
}

/// Staged sources as ordered occurrences over their retained source COGs,
/// in the listed order.
fn incoming_occurrences(
    paths: &LidarPaths,
    sources: &[&StagedSource],
) -> Result<Vec<generation::ResolvedMember>, String> {
    sources
        .iter()
        .enumerate()
        .map(|(index, source)| {
            let cog = &source.source_cog;
            let grid = grid_for_source(source);
            Ok(generation::ResolvedMember {
                ordinal: i64::try_from(index).unwrap_or(i64::MAX),
                grid: grid.clone(),
                nodata: cog.nodata.or(source.nodata),
                cog: super::raster_assets::CogAsset {
                    sha256: cog.sha256.clone(),
                    path: paths.asset_cog(&cog.sha256),
                    bytes: cog.bytes,
                    grid,
                    nodata: cog.nodata,
                },
            })
        })
        .collect()
}

/// Point the layer head at a generation.
fn advance_layer_head(
    connection: &rusqlite::Connection,
    layer_id: &str,
    generation_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES(?1, ?2)
             ON CONFLICT(layer_id) DO UPDATE SET generation_id = excluded.generation_id",
            rusqlite::params![layer_id, generation_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Publish an item's ordered collection and make it the item's generation.
///
/// The whole commit is one short transaction: the job must still be applying
/// and the item must still be unpublished, and the member rows readers select
/// by become visible with the generation that owns them. A failure publishes
/// nothing.
#[allow(clippy::too_many_arguments)]
fn publish_applied_snapshot(
    library: &LidarLibrary,
    staging: &StagedImport,
    generation_id: &str,
    plan: &collection::SnapshotPlan,
    measurement: &collection::SnapshotMeasurement,
    manifest_json: &str,
    promoted: &[PromotedSourceCog],
) -> Result<(), String> {
    promotion_probe::check(promotion_probe::FaultPoint::BeforeTransaction)?;
    let connection = library.catalogue()?;
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
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
        if catalogue::head_generation(&connection, &staging.layer_id)?.is_some() {
            return Err("this library item is already published and fixed".to_string());
        }
        insert_promoted_references(&connection, &library.inner.paths, promoted)?;
        collection::insert_snapshot(
            &connection,
            &staging.layer_id,
            generation_id,
            plan,
            measurement,
            manifest_json,
        )?;
        advance_layer_head(&connection, &staging.layer_id, generation_id)?;
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
        Ok(()) => connection
            .execute_batch("COMMIT")
            .map_err(|e| e.to_string()),
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

/// The immutable description of one item generation: an ordered collection of
/// source COGs on a fixed lattice, top-first by interpretation hash.
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

pub(crate) fn f32_sample(raw: &[u8], index: usize) -> f32 {
    let offset = index * 4;
    f32::from_le_bytes([
        raw[offset],
        raw[offset + 1],
        raw[offset + 2],
        raw[offset + 3],
    ])
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
            // The exact decimal of a finite marker, so a reader comparing the
            // tag to Float32 samples finds the very value that was written.
            if nodata.is_finite() {
                format!("{:?}", f64::from(nodata))
            } else {
                format!("{nodata}")
            },
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

pub(crate) fn format_geotransform(gt: GeoTransform) -> String {
    format!(
        "[{},{},{},{},{},{}]",
        gt[0], gt[1], gt[2], gt[3], gt[4], gt[5]
    )
}

pub(crate) fn parse_geotransform(raw: &str) -> Result<GeoTransform, String> {
    let values = serde_json::from_str::<Vec<f64>>(raw)
        .map_err(|error| format!("Invalid stored geotransform: {error}"))?;
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

pub(super) fn engine_version(engine: &GdalEngine) -> String {
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
    fn raw_extraction_limit_rejects_extent_explosion_before_allocation() {
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
        assert!(error.contains("whole-raster read is limited"));
    }

    #[test]
    fn source_selection_caps_count_and_bytes_before_staging() {
        let too_many = vec![PathBuf::from("unused"); admission::MAX_SOURCE_FILES_PER_IMPORT + 1];
        assert!(
            validate_source_selection(&too_many)
                .unwrap_err()
                .contains("at most")
        );

        let path = std::env::temp_dir().join(new_id("canopi-oversized-source"));
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(admission::MAX_SOURCE_FILE_BYTES + 1).unwrap();
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

        let (sha256, managed, size) = stage_managed_original(
            &paths,
            &source,
            &job_dir,
            "extensionless-source",
            &AtomicBool::new(false),
        )
        .unwrap();
        assert_eq!(size, 19);
        assert_eq!(std::fs::read(&managed).unwrap(), b"canopi raster bytes");
        assert_eq!(
            hash_file_limited(&managed, &AtomicBool::new(false))
                .unwrap()
                .0,
            sha256
        );

        std::fs::write(&managed, b"corrupt").unwrap();
        let error = stage_managed_original(
            &paths,
            &source,
            &job_dir,
            "extensionless-source",
            &AtomicBool::new(false),
        )
        .unwrap_err();
        assert!(error.contains("failed integrity verification"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn geotransform_storage_round_trips() {
        let transform = [445999.75, 0.5, 0.0, 6807000.25, 0.0, -0.5];
        assert_eq!(
            parse_geotransform(&format_geotransform(transform)).unwrap(),
            transform
        );
    }

    #[test]
    fn geotransform_storage_rejects_missing_or_non_finite_values() {
        assert!(parse_geotransform("[1,2,3]").is_err());
        assert!(
            parse_geotransform("0,1,0,1,0,1").is_err(),
            "only the stored JSON form"
        );
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
    /// The range an oracle expects for one source.
    ///
    /// A value the source itself declares as NoData is not one of its values, so
    /// it must not widen the reported range even though it is finite: a legend
    /// that spanned it would describe data the source does not hold.
    fn oracle_range(raw: &[u8], nodata: Option<f32>) -> [f64; 2] {
        let mut min = f64::INFINITY;
        let mut max = f64::NEG_INFINITY;
        for chunk in raw.chunks_exact(4) {
            let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if value.is_finite() && Some(value) != nodata {
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
                None,
                false,
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
        stage_import(
            &library,
            &job_id,
            &layer_id,
            &[float_source.clone(), int_source.clone()],
            &cancel,
        )
        .expect("fixtures are admitted");
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
            let cog = &source.source_cog;
            let grid = grid_for_source(source);
            let mut reader = PreparedRaster::open_committed(
                &cog.resolve(&library.inner.paths, &source.job_id)
                    .expect("the retained COG resolves"),
                &grid,
                cog.nodata,
            )
            .expect("the retained COG opens through the production reader");
            assert_eq!(reader.grid(), &grid);
            let read = reader
                .read_window(
                    RasterWindow {
                        x: 0,
                        y: 0,
                        width,
                        height,
                    },
                    &cancel,
                )
                .expect("retained COG reads");
            assert_eq!(read.samples().len(), oracle.len() / 4, "sample count");
            assert_eq!(
                read.valid().to_vec(),
                oracle_mask.bytes().to_vec(),
                "validity comes from this source's own effective NoData rule"
            );
            for (index, chunk) in oracle.chunks_exact(4).enumerate() {
                let expected = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                let got = read.samples()[index];
                if expected.is_nan() {
                    assert!(got.is_nan(), "sample {index} must stay NaN");
                } else {
                    assert_eq!(got.to_bits(), expected.to_bits(), "sample {index}");
                }
            }
            assert_eq!(
                source.value_range,
                oracle_range(&oracle, Some(-9999.0)),
                "the range covers the source's own values and nothing it declares as no data"
            );
            assert_eq!(source.valid_cells, oracle_mask.count_valid());
        }

        // Nothing durable beside the retained COG: no prepared derivative, no
        // raw samples and no validity mask survive staging.
        let leftovers: Vec<_> = std::fs::read_dir(library.inner.paths.job_dir(&job_id))
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| {
                name.starts_with("prepared-") || name.ends_with(".raw") || name.ends_with(".bin")
            })
            .collect();
        assert!(
            leftovers.is_empty(),
            "durable raw/mask or derivative left behind: {leftovers:?}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn staging_without_a_measurable_scratch_directory_fails_by_name() {
        let engine = GdalEngine::new();
        let root = std::env::temp_dir().join(new_id("canopi-absent-scratch"));
        let missing = root.join("absent-scratch");
        let error = stage_source_samples(
            &engine,
            &AtomicBool::new(false),
            Path::new("unused.tif"),
            &RasterGrid {
                width: 4,
                height: 4,
                geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
            },
            "EPSG:3857",
            None,
            &missing,
            "0000000000000000",
        )
        .expect_err("unmeasurable capacity must fail");
        assert!(error.contains("Cannot verify free space"), "{error}");
        let _ = std::fs::remove_dir_all(root);
    }

    /// A failed conversion must fail staging, retain nothing durable and leave
    /// no partial asset behind.
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

        // A read-only scratch root makes the conversion's own output fail.
        let scratch = dir.join("read-only-scratch");
        std::fs::create_dir(&scratch).unwrap();
        let mut permissions = std::fs::metadata(&scratch).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            permissions.set_mode(0o555);
        }
        std::fs::set_permissions(&scratch, permissions).unwrap();

        let error = stage_source_samples(
            &engine,
            &cancel,
            &source,
            &grid,
            "EPSG:3857",
            Some(-9999.0),
            &scratch,
            "0123456789abcdef",
        )
        .expect_err("an unwritable conversion must fail staging");
        assert!(!error.is_empty());
        // Nothing durable was created, and no staged file survives: the job
        // directory holds no source COG, and the global store holds no asset.
        let paths = LidarPaths::open(&dir).expect("library paths");
        let assets: usize = std::fs::read_dir(paths.asset_dir(""))
            .into_iter()
            .flatten()
            .flatten()
            .count();
        assert_eq!(assets, 0, "no asset is created from a failed conversion");
        let staged: Vec<_> = std::fs::read_dir(&scratch)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(staged.is_empty(), "staged leftovers: {staged:?}");

        let mut permissions = std::fs::metadata(&scratch).unwrap().permissions();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            permissions.set_mode(0o755);
        }
        std::fs::set_permissions(&scratch, permissions).unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// The import caller charges the retained source COG, its conversion
    /// scratch and the shared reserve together, and rejects before any GDAL
    /// work when that combined footprint does not fit.
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
        let required = crate::services::lidar::prepared_raster::required_free_bytes(
            grid.width,
            grid.height,
            0,
        )
        .unwrap();
        let _guard = capacity_probe::override_available(required - 1);
        // A missing input never reaches GDAL: the capacity error proves the
        // combined check ran before the conversion.
        let error = stage_source_samples(
            &engine,
            &cancel,
            &dir.join("absent-input.tif"),
            &grid,
            "EPSG:3857",
            None,
            &dir,
            "0123456789abcdef",
        )
        .expect_err("the combined footprint must be rejected");
        assert!(
            error.contains(&required.to_string()),
            "names the required bytes: {error}"
        );
        assert!(
            error.contains(&(required - 1).to_string()),
            "names the available bytes: {error}"
        );
        assert_eq!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "tif"))
                .count(),
            0,
            "no conversion output on rejection"
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    /// At exactly the combined requirement the real caller proceeds, and one
    /// byte less still rejects: the boundary is inclusive at the requirement
    /// and one retained COG is the only durable output.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn staged_source_admits_exactly_the_combined_requirement() {
        use crate::services::lidar::paths::capacity_probe;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let dir = std::env::temp_dir().join(new_id("canopi-combined-boundary"));
        std::fs::create_dir_all(&dir).unwrap();
        let paths = LidarPaths::open(&dir).expect("library paths");
        let job_dir = paths.job_dir("boundary-job");
        std::fs::create_dir_all(&job_dir).unwrap();
        let (width, height) = (1024u32, 1024u32);
        let source = write_staging_fixture(&engine, &dir, "boundary", width, height, -9999.0);
        let grid = RasterGrid {
            width,
            height,
            geotransform: [0.0, 1.0, 0.0, height as f64, 0.0, -1.0],
        };
        let required = crate::services::lidar::prepared_raster::required_free_bytes(
            grid.width,
            grid.height,
            0,
        )
        .unwrap();
        {
            let _guard = capacity_probe::override_available(required);
            let (cog, valid_cells) = stage_source_samples(
                &engine,
                &cancel,
                &source,
                &grid,
                "EPSG:3857",
                Some(-9999.0),
                &job_dir,
                "fedcba9876543210",
            )
            .expect("the exact combined requirement admits the work");
            assert!(cog.value_range[0].is_finite() && cog.value_range[1].is_finite());
            assert!(cog.bytes > 0);
            // An independent oracle for the same grid: a cell is valid when it
            // is finite and differs from the declared sentinel.
            let expected_valid = (0..height)
                .flat_map(|y| (0..width).map(move |x| (x, y)))
                .filter(|(x, y)| {
                    let value = staged_value(*x, *y);
                    value.is_finite() && value != -9999.0
                })
                .count() as u64;
            assert_eq!(
                valid_cells, expected_valid,
                "the prepared source reports the valid cells it actually holds"
            );
            let staged_path = cog.resolve(&paths, "boundary-job").unwrap();
            assert!(
                staged_path.exists(),
                "the COG is the job's own durable output at {}",
                staged_path.display()
            );
            assert_eq!(staged_path.parent(), Some(job_dir.as_path()));
            assert!(
                !paths.asset_cog(&cog.sha256).exists(),
                "nothing is admitted globally before publication"
            );
        }
        {
            let _guard = capacity_probe::override_available(required - 1);
            let error = stage_source_samples(
                &engine,
                &cancel,
                &source,
                &grid,
                "EPSG:3857",
                Some(-9999.0),
                &dir,
                "fedcba9876543210",
            )
            .expect_err("one byte below the requirement must reject");
            assert!(error.contains(&required.to_string()), "{error}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    // -----------------------------------------------------------------------
    // Sparse-generation caller slice: stage → review → Apply → reopen → undo
    // -----------------------------------------------------------------------

    /// One constant-fill source with an explicit origin, so tests can place
    /// members on the layer lattice without depending on probe defaults.
    #[allow(clippy::too_many_arguments)]
    fn write_placed_fixture(
        engine: &GdalEngine,
        dir: &Path,
        name: &str,
        origin_x: f64,
        origin_y: f64,
        width: u32,
        height: u32,
        nodata: f32,
        value: f32,
    ) -> PathBuf {
        let values = vec![value; (width * height) as usize];
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
                geotransform: [origin_x, 1.0, 0.0, origin_y, 0.0, -1.0],
            },
            "EPSG:3857",
            nodata,
        )
        .expect("fixture converts");
        let _ = std::fs::remove_file(&raw);
        let _ = std::fs::remove_file(raw.with_extension("hdr"));
        tif
    }

    /// Cancellation settles owned subprocess work promptly, not eventually.
    ///
    /// The resource contract bounds this at five seconds because a cancelled
    /// import must release its slot and its scratch without the user waiting on
    /// an abandoned conversion. The engine polls the flag every 50 ms and then
    /// kills and reaps the child, so this asserts on measured wall-clock elapsed
    /// time rather than on the poll interval the code happens to use: the
    /// timeout ceiling would be 600 seconds, so a pass here only means the
    /// cancel path ran, and the elapsed bound is what proves it.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_cancelled_engine_conversion_settles_within_the_contract_bound() {
        let root = std::env::temp_dir().join(new_id("canopi-cancel-settle"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();

        // Long enough that the conversion is still running when the cancel
        // lands, and cheap to build: 128 MiB of Float32, written in whole
        // little-endian words through one buffer rather than value by value.
        let grid = RasterGrid {
            width: 8_192,
            height: 4_096,
            geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
        };
        let raw = root.join("cancel.raw");
        let total = grid.width as usize * grid.height as usize;
        let words: Vec<u8> = (0..total).flat_map(|_| 1.0f32.to_le_bytes()).collect();
        std::fs::write(&raw, &words).expect("raw writes");
        drop(words);

        let cancel = AtomicBool::new(false);
        let source = root.join("cancel.tif");
        let output = root.join("cancel-out.tif");
        let args = crate::services::lidar::prepared_raster::controlled_cog_arguments(
            &source,
            &output,
            "EPSG:3857",
            &grid,
            None,
        );

        let settled = std::sync::Arc::new(std::sync::Mutex::new(None));
        let handle = {
            let engine = engine.clone();
            let cancel = std::sync::Arc::new(AtomicBool::new(false));
            let cancel_for_thread = cancel.clone();
            let settled = settled.clone();
            std::thread::spawn(move || {
                // The engine call itself is the owned work; the caller sets the
                // flag from outside, exactly as the UI's cancel action does.
                let started = std::time::Instant::now();
                let outcome = engine.run(
                    GdalProgram::Translate,
                    &args,
                    Some(cancel_for_thread.as_ref()),
                );
                *settled.lock().unwrap() = Some((started.elapsed(), outcome.is_err()));
            })
        };

        // Let the conversion start, then cancel it.
        std::thread::sleep(std::time::Duration::from_millis(250));
        cancel.store(true, Ordering::Relaxed);
        handle.join().expect("the engine thread joins");

        let (elapsed, was_error) = settled.lock().unwrap().expect("the run settled");
        assert!(
            was_error,
            "a cancelled conversion must report an error rather than a success"
        );
        assert!(
            elapsed < std::time::Duration::from_secs(5),
            "cancellation settled in {elapsed:?}, above the 5 second contract bound"
        );
        println!("cancellation settled in {elapsed:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Declared NoData is not data, so it must not enter the source range.
    ///
    /// The range is the physical span a user sees, and a sentinel like -9999
    /// would otherwise dominate it and misreport the dataset. The rule is the
    /// validity mask's own: a sample counts only when it is finite and differs
    /// from the source's declared NoData, which keeps valid zero and negative
    /// samples and excludes the sentinel.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn source_range_excludes_declared_nodata_and_keeps_zero_and_negative() {
        let root = std::env::temp_dir().join(new_id("canopi-range-nodata"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);

        let nodata = -9999.0f32;
        let raw = root.join("nodata-mix.raw");
        // A finite sentinel beside a valid negative, a valid zero and a valid
        // positive value, which is the case the bug reports.
        write_f32_raw(&raw, &[nodata, -1.5, 0.0, 2.5]).unwrap();
        let tif = root.join("nodata-mix.tif");
        let grid = RasterGrid {
            width: 2,
            height: 2,
            geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
        };
        raw_to_tif(&engine, &cancel, &raw, &tif, &grid, "EPSG:3857", nodata)
            .expect("fixture converts");

        // The retained source COG is the controlled profile the reader accepts,
        // so the test converts through the same writer the production path uses
        // rather than inventing a second profile.
        let cog = crate::services::lidar::raster_assets::write_job_source_cog(
            &engine,
            &cancel,
            &root,
            "controlled",
            &tif,
            &grid,
            "EPSG:3857",
            Some(nodata),
        )
        .expect("fixture converts to the controlled profile");

        let mut reader = PreparedRaster::open_committed(&cog.path, &grid, Some(nodata))
            .expect("reader opens the fixture");
        let (range, valid_cells) = scan_source_facts(&mut reader, &cancel).expect("scan");

        assert_eq!(
            range,
            [-1.5, 2.5],
            "the declared NoData sentinel must not extend the range"
        );
        assert_eq!(valid_cells, 3, "the sentinel is not a valid sample");
        drop(reader);

        // With no declared NoData the same samples are all data, so the rule
        // follows the source's own declaration rather than the value's shape:
        // a legitimate -9999 sample is still data when nothing declares it.
        let mut reader = PreparedRaster::open_committed(&cog.path, &grid, None)
            .expect("reader opens the fixture without a nodata rule");
        let (range, valid_cells) = scan_source_facts(&mut reader, &cancel).expect("scan");
        assert_eq!(range, [-9999.0, 2.5]);
        assert_eq!(valid_cells, 4);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// The same fixture placed with an explicit CRS declaration.
    #[allow(clippy::too_many_arguments)]
    fn write_crs_fixture(
        engine: &GdalEngine,
        dir: &Path,
        name: &str,
        crs: &str,
        origin_x: f64,
        origin_y: f64,
        width: u32,
        height: u32,
        value: f32,
    ) -> PathBuf {
        let values = vec![value; (width * height) as usize];
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
                geotransform: [origin_x, 1.0, 0.0, origin_y, 0.0, -1.0],
            },
            crs,
            -9999.0,
        )
        .expect("fixture converts");
        let _ = std::fs::remove_file(&raw);
        let _ = std::fs::remove_file(raw.with_extension("hdr"));
        tif
    }

    /// Prepare one batch the way the one-step route does, ready to publish.
    ///
    /// Items are fixed once published, so a batch aimed at a published item is
    /// staged into a new item of the same kind, as a user's next import would
    /// be. Callers read the target from `StagedImport::layer_id`.
    fn stage_review(
        library: &LidarLibrary,
        layer_id: &str,
        sources: &[PathBuf],
        cancel: &AtomicBool,
    ) -> (String, StagedImport) {
        let published = catalogue::head_generation(&library.catalogue().unwrap(), layer_id)
            .unwrap()
            .is_some();
        let next_layer;
        let layer_id = if published {
            next_layer = library
                .create_layer(
                    "next import",
                    common_types::lidar::LidarMeasurementKind::GroundElevation,
                    None,
                    false,
                )
                .expect("next item created");
            next_layer.as_str()
        } else {
            layer_id
        };
        let job_id = library.record_import_job(layer_id).expect("job recorded");
        stage_import(library, &job_id, layer_id, sources, cancel)
            .unwrap_or_else(|error| panic!("fixtures must be admitted: {error}"));
        let staging = read_staged_import(library, &job_id).expect("staged payload");
        (job_id, staging)
    }

    /// The accepted head row of a layer.
    fn head_of(library: &LidarLibrary, layer_id: &str) -> catalogue::GenerationRow {
        let connection = library.catalogue().unwrap();
        catalogue::head_generation(&connection, layer_id)
            .unwrap()
            .expect("layer has a head")
    }

    /// Published resolved-chunk rows of a generation: an ordered collection
    /// materializes none.
    fn published_chunk_count(library: &LidarLibrary, generation_id: &str) -> usize {
        let connection = library.catalogue().unwrap();
        catalogue::generation_chunk_assets(&connection, generation_id, "result")
            .unwrap()
            .len()
    }

    /// Occupied lattice chunks of a layer's accepted composition.
    ///
    /// Derived arithmetically from the member list, which is what the resolver
    /// visits: no raster is opened and the empty gap between separated sources
    /// contributes nothing.
    fn head_occupied_chunks(library: &LidarLibrary, layer_id: &str) -> Vec<(i64, i64)> {
        let head = head_of(library, layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        let reader = super::super::collection::load_reader(
            library,
            &head.id,
            &manifest,
            &AtomicBool::new(false),
        )
        .expect("every member still resolves");
        reader.occupied_chunks().unwrap()
    }

    /// Member count of a layer's accepted ordered composition.
    fn head_member_count(library: &LidarLibrary, layer_id: &str) -> usize {
        let head = head_of(library, layer_id);
        let connection = library.catalogue().unwrap();
        catalogue::collection_members(&connection, &head.id)
            .unwrap()
            .len()
    }

    /// Read a window of the accepted head exactly as a caller would.
    fn head_window(
        library: &LidarLibrary,
        layer_id: &str,
        window: generation::LatticeWindow,
    ) -> (Vec<f32>, Vec<u8>) {
        let head = head_of(library, layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        let cancel = AtomicBool::new(false);
        let reader = super::super::collection::load_reader(library, &head.id, &manifest, &cancel)
            .expect("every member still resolves");
        let resolved = reader
            .read_window(window, &cancel)
            .expect("window resolves");
        (resolved.samples, resolved.valid)
    }

    /// P1-4: one common interpretation for a layer's first batch.
    ///
    /// Without an accepted head there is nothing to compare a source against,
    /// so the first compatible selection becomes the anchor. Equal-coordinate
    /// rasters that declare different horizontal CRSs must not be admitted
    /// together: the lattice could not reconcile them and a later read could
    /// not reconcile them either.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_first_batch_refuses_sources_that_disagree_on_the_horizontal_crs() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-first-batch-crs"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let web_mercator =
            write_crs_fixture(&engine, &root, "web", "EPSG:3857", 0.0, 4.0, 4, 4, 5.0);
        let lambert =
            write_crs_fixture(&engine, &root, "lambert", "EPSG:2154", 0.0, 4.0, 4, 4, 7.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "first batch crs",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let staging_error = stage_import(
            &library,
            &job_id,
            &layer_id,
            &[web_mercator, lambert],
            &cancel,
        )
        .expect_err("a mixed-CRS batch is refused by preparation");
        assert!(
            staging_error.contains("horizontal CRS differs"),
            "the refusal names the CRS disagreement: {staging_error}"
        );
        {
            let connection = library.catalogue().unwrap();
            assert!(
                catalogue::head_generation(&connection, &layer_id)
                    .unwrap()
                    .is_none(),
                "a refused batch publishes nothing"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-4: an all-NoData source is refused by name before review.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn an_all_nodata_source_is_refused_by_name() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-zero-valid"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // Every cell equals the declared NoData sentinel, so the source has no
        // valid sample under its own rule.
        let empty = write_placed_fixture(&engine, &root, "empty", 0.0, 4.0, 4, 4, -9999.0, -9999.0);
        let real = write_placed_fixture(&engine, &root, "real", 0.0, 4.0, 4, 4, -9999.0, 5.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "zero valid",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let refusal = stage_import(&library, &job_id, &layer_id, &[empty, real], &cancel)
            .expect_err("an all-NoData source refuses the batch");
        assert!(
            refusal.contains("empty.tif"),
            "the refusal names the file: {refusal}"
        );
        assert!(
            refusal.contains("no valid samples"),
            "and says why: {refusal}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-3: published statistics and the reopened samples are the same
    /// composition.
    ///
    /// A full-cover import of 9 above 5 reads back as 9, so its published range
    /// must be 9..9 as well. Building the incoming occurrence with the
    /// superseded Add/ReplaceOverlap roles measured a different composition
    /// than the one the snapshot actually replays.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn published_statistics_match_the_reopened_composition() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-published-statistics"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let five = write_placed_fixture(&engine, &root, "five", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let nine = write_placed_fixture(&engine, &root, "nine", 0.0, 4.0, 4, 4, -9999.0, 9.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "published statistics",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        // One item of two overlapping sources, topmost first.
        let (_job, staging) = stage_review(&library, &layer_id, &[nine, five], &cancel);
        let applied = apply_import(&library, &staging, &cancel).expect("the pair applies");
        let head = head_of(&library, &layer_id);
        assert_eq!(head.id, applied.generation_id);
        // Two members cannot be composed from metadata, so the exact count and
        // range are unknown. What the generation does publish is the display
        // range: the union of its members' own ranges, labelled as an envelope.
        assert_eq!(head.coverage_cells, None);
        assert_eq!(head.min_value, None);
        assert_eq!(head.max_value, None);
        assert_eq!(head.display_min_value, Some(5.0));
        assert_eq!(head.display_max_value, Some(9.0));
        assert_eq!(head.display_basis.as_deref(), Some("source-envelope"));

        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        let (values, valid) = head_window(
            &reopened,
            &layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(
            values.iter().all(|value| *value == 9.0),
            "the reopened composition is the one the statistics describe: {values:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P2-8: source-region facts translate to absolute pixels.
    ///
    /// A 2048x1 source whose valid cells begin in the second block reported no
    /// coverage and a 0..0 range, because every block was read as if it started
    /// at the member's first pixel.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn source_region_facts_cover_later_blocks() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-region-facts"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // Cells 0..1024 are NoData; 1024..2048 are seven.
        let mut values = vec![-9999.0f32; 2048];
        for value in values.iter_mut().skip(1024) {
            *value = 7.0;
        }
        let source =
            write_oracle_fixture(&engine, &root, "half", 0.0, 1.0, 2048, 1, -9999.0, &values);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "region facts",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let (_job, staging) = stage_review(&library, &layer_id, &[source], &cancel);
        apply_import(&library, &staging, &cancel).expect("publishes");

        let summary = library.layer_collection(&layer_id, None).unwrap();
        let listed = &summary.sources[0];
        assert_eq!(
            listed.coverage_cells, 1024,
            "the source list reports the valid half, not the first block"
        );
        assert_eq!(
            listed.value_range,
            [7.0, 7.0],
            "and the range of the samples it actually holds"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P2-9: a bounded read resolves only the occurrences that can reach it.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_window_resolves_only_the_occurrences_that_can_reach_it() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-bounded-members"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let near = write_placed_fixture(&engine, &root, "near", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let far = write_placed_fixture(&engine, &root, "far", 1_000_000.0, 4.0, 4, 4, -9999.0, 9.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "bounded members",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let (_job, staging) = stage_review(&library, &layer_id, &[near, far], &cancel);
        apply_import(&library, &staging, &cancel).expect("publishes");
        let head = head_of(&library, &layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();

        let whole = super::super::collection::load_reader(&library, &head.id, &manifest, &cancel)
            .expect("the composition resolves");
        assert_eq!(whole.resolved().len(), 2, "both occurrences are members");

        let windowed = super::super::collection::load_reader_within(
            &library,
            &head.id,
            &manifest,
            Some(super::super::collection::ReadBounds {
                x0: -2,
                y0: -2,
                x1: 6,
                y1: 6,
            }),
            &cancel,
        )
        .expect("the bounded composition resolves");
        assert_eq!(
            windowed.resolved().len(),
            1,
            "a window near the first source never opens the distant one"
        );
        assert_eq!(
            windowed.occupied_chunks().unwrap(),
            vec![(0, 0)],
            "and its occupied blocks follow the selection"
        );
        let resolved = windowed
            .read_window(
                generation::LatticeWindow {
                    x: 0,
                    y: 0,
                    width: 4,
                    height: 4,
                },
                &cancel,
            )
            .unwrap();
        assert!(resolved.valid.iter().all(|byte| *byte == 1));
        assert!(resolved.samples.iter().all(|value| *value == 5.0));
        let _ = std::fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // B5: representative sparse-gap run
    // -----------------------------------------------------------------------

    /// Two members a million pixels apart plus one that extends the lattice
    /// left of the anchor: only the occupied chunks may be stored, read and
    /// displayed, and the gap must never be walked.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_gap_import_stores_only_occupied_chunks() {
        let root = std::env::temp_dir().join(new_id("canopi-gap-run"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let sampler = crate::services::lidar::measurement::Sampler::start();
        let library = LidarLibrary::open(&root).expect("library opens");
        // The union spans ~45M cells, so this representative run raises the
        // interim admission envelope for its own thread: production keeps the
        // 25M bound, while the block-wise review still costs only the data.
        let _admission = admission::limits_probe::raise(128 * 1024 * 1024, 16, 1024 * 1024 * 1024);

        let left =
            write_placed_fixture(&engine, &root, "left", -500.0, 1000.0, 40, 30, -9999.0, 3.0);
        let anchor =
            write_placed_fixture(&engine, &root, "anchor", 0.0, 1000.0, 60, 45, -9999.0, 5.0);
        let far = write_placed_fixture(
            &engine,
            &root,
            "far",
            1_000_000.0,
            1000.0,
            32,
            24,
            -9999.0,
            7.0,
        );
        let expected_cells = (60 * 45 + 40 * 30 + 32 * 24) as u64;

        let layer_id = library
            .create_layer(
                "sparse gap",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        // The lattice anchors on the first selected source, so selecting the
        // anchor first makes the left member extend it into negative cells.
        let (_job_id, staging) = stage_review(&library, &layer_id, &[anchor, left, far], &cancel);
        assert!(
            staging.union_grid.width > 1_000_000,
            "the union spans the gap: {}",
            staging.union_grid.width
        );
        apply_import(&library, &staging, &cancel).expect("apply");

        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, None);
        assert_eq!(head.min_value, None);
        assert_eq!(head.max_value, None);
        assert_eq!(head.display_min_value, Some(3.0));
        assert_eq!(head.display_max_value, Some(7.0));
        assert_eq!(head.display_basis.as_deref(), Some("source-envelope"));
        let _ = expected_cells;
        // The composition materializes nothing at all: its cost is member
        // metadata, and only the occupied lattice blocks are ever visited.
        assert_eq!(
            published_chunk_count(&library, &head.id),
            0,
            "an ordered composition stores no resolved source raster"
        );
        let occupied = head_occupied_chunks(&library, &layer_id);
        assert_eq!(
            occupied.len(),
            3,
            "one block per occupied cell group: {occupied:?}"
        );
        assert!(
            occupied.iter().any(|(x, _)| *x < 0),
            "the left extension lives before the fixed anchor: {occupied:?}"
        );
        assert!(occupied.iter().any(|(x, _)| *x > 900), "{occupied:?}");
        // Nothing anywhere in the library tree is area-proportional: the union
        // is ~45M cells, so a resolved write would be hundreds of megabytes.
        let stored: i64 = {
            let connection = library.catalogue().unwrap();
            connection
                .query_row(
                    "SELECT COALESCE(SUM(a.bytes), 0) FROM lidar_generation_chunks g
                     JOIN lidar_raster_assets a ON a.sha256 = g.asset_sha256
                     WHERE g.generation_id = ?1 AND g.state = 'published'",
                    [&head.id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(
            stored, 0,
            "no resolved bytes are written for the composition"
        );
        let gap_rows: i64 = {
            let connection = library.catalogue().unwrap();
            connection
                .query_row(
                    "SELECT COUNT(*) FROM lidar_generation_chunks
                     WHERE generation_id = ?1 AND chunk_x BETWEEN 1 AND 900",
                    [&head.id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(gap_rows, 0, "the gap holds no index row at all");

        // Reads: exact values inside each member, exactly invalid in the gap.
        let sample = |x: i64, y: i64| -> (f32, u8) {
            let (samples, valid) = head_window(
                &library,
                &layer_id,
                generation::LatticeWindow {
                    x,
                    y,
                    width: 1,
                    height: 1,
                },
            );
            (samples[0], valid[0])
        };
        // The layer lattice is anchored on the first selected source, so the
        // anchor keeps cell 0 and the left member sits before it.
        let (value, valid) = sample(0, 0);
        assert_eq!((value, valid), (5.0, 1));
        let (value, valid) = sample(-500, 0);
        assert_eq!((value, valid), (3.0, 1));
        let (_, valid) = sample(600, 0);
        assert_eq!(valid, 0, "the gap is exactly invalid");
        let (_, valid) = sample(999_999, 0);
        assert_eq!(valid, 0, "the gap is invalid for its whole width");
        let (value, valid) = sample(1_000_000, 0);
        assert_eq!((value, valid), (7.0, 1));

        drop(library);
        let measurement = sampler.finish();
        let _ = crate::services::lidar::measurement::gate_combined_budget(
            "sparse gap run",
            &measurement,
        );
        let _ = std::fs::remove_dir_all(&root);
    }
    /// The authorized 24-tile authored run: more tiles than the production
    /// file-count ceiling allows, spread across a million-cell gap, imported
    /// as one batch and stored as occupied chunks only.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_twenty_four_tile_batch_stays_chunk_sized() {
        let root = std::env::temp_dir().join(new_id("canopi-24-tile"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let sampler = crate::services::lidar::measurement::Sampler::start();
        let library = LidarLibrary::open(&root).expect("library opens");
        // No admission override: 24 files and 96M processing cells are inside
        // the production policy, while the union this arrangement spans is far
        // above the retired envelope bound. Running the real policy is what
        // makes this a capacity witness rather than an overridden probe.

        // Three columns eight rows apart, each column 100,000 cells from the
        // next, so the union is far larger than the data it holds.
        let mut sources = Vec::new();
        for column in 0..3u32 {
            for row in 0..8u32 {
                let name = format!("tile-{column}-{row}");
                sources.push(write_placed_fixture(
                    &engine,
                    &root,
                    &name,
                    f64::from(column) * 100_000.0,
                    1000.0 - f64::from(row) * 40.0,
                    32,
                    24,
                    -9999.0,
                    10.0 + f64::from(row) as f32,
                ));
            }
        }
        // Twenty-four files is exactly the production file ceiling: this batch
        // is admitted at the boundary rather than over it, and the union it
        // spans is what the retired envelope bound refused.
        assert_eq!(sources.len(), admission::MAX_SOURCE_FILES_PER_IMPORT);

        let layer_id = library
            .create_layer(
                "24 tiles",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let (_job_id, staging) = stage_review(&library, &layer_id, &sources, &cancel);
        apply_import(&library, &staging, &cancel).expect("apply");

        let head = head_of(&library, &layer_id);
        // Twenty-four occurrences cannot be composed from metadata alone, so the
        // generation claims no exact count. The member facts below are what the
        // batch is charged and what its display range is built from.
        assert_eq!(
            head.coverage_cells, None,
            "a multi-member composition does not claim an exact count"
        );
        assert_eq!(head.display_basis.as_deref(), Some("source-envelope"));
        assert_eq!(
            head_member_count(&library, &layer_id),
            24,
            "every selected source is its own occurrence"
        );
        assert_eq!(
            head_occupied_chunks(&library, &layer_id).len(),
            3,
            "one occupied block per column; the eight rows share it"
        );
        assert_eq!(
            published_chunk_count(&library, &head.id),
            0,
            "a 24-source batch stores member metadata only"
        );
        let total_bytes: i64 = {
            let connection = library.catalogue().unwrap();
            connection
                .query_row(
                    "SELECT COALESCE(SUM(a.bytes), 0) FROM lidar_generation_chunks g
                     JOIN lidar_raster_assets a ON a.sha256 = g.asset_sha256
                     WHERE g.generation_id = ?1 AND g.state = 'published'",
                    [&head.id],
                    |row| row.get(0),
                )
                .unwrap()
        };
        let union_cells =
            u64::from(staging.union_grid.width) * u64::from(staging.union_grid.height);
        // Processing cost is charged per occurrence, so the same batch that
        // spans an over-limit envelope costs only its own 96M cells. This is
        // the concrete case the retired envelope bound refused by geometry the
        // batch never decodes.
        let proposed: Vec<admission::ProcessingCost> = (0..head_member_count(&library, &layer_id))
            .map(|_| admission::ProcessingCost {
                width: 32,
                height: 24,
            })
            .collect();
        let proposed_cells = admission::processing_cells(proposed.iter().copied()).unwrap();
        println!(
            "24 tiles: {} cells in {} members, {total_bytes} resolved bytes, \
             union {union_cells} cells, proposed {proposed_cells} processing cells",
            24 * 32 * 24,
            head_member_count(&library, &layer_id)
        );
        assert!(
            union_cells > 25_000_000,
            "the arranged union spans far more cells than it holds"
        );
        assert_eq!(proposed_cells, 24 * 32 * 24);
        assert!(
            admission::check_processing_budget(proposed.iter().copied(), "sparse 24-tile batch")
                .is_ok(),
            "the processing budget admits the batch, charging occurrences and not the gap"
        );
        assert!(
            total_bytes < 3 * 8 * 1024 * 1024,
            "three chunks' worth of bytes, not the union's area: {total_bytes}"
        );

        drop(library);
        let measurement = sampler.finish();
        let _ = crate::services::lidar::measurement::gate_combined_budget(
            "24-tile batch",
            &measurement,
        );
        let _ = std::fs::remove_dir_all(&root);
    }
    // -----------------------------------------------------------------------
    // BG5: admission is one policy, decided before review and rechecked at Apply
    // -----------------------------------------------------------------------

    /// Two small sources far apart: their union envelope spans 25M cells, but
    /// the governing bound is the processing cells the collection proposes,
    /// and two 4x4 sources propose 32.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn admission_admits_a_separated_pair_by_its_own_cells() {
        let root = std::env::temp_dir().join(new_id("canopi-admit-over"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");
        let south_west = write_placed_fixture(&engine, &root, "sw", 0.0, 4.0, 4, 4, -9999.0, 3.0);
        let north_east =
            write_placed_fixture(&engine, &root, "ne", 4997.0, 5000.0, 4, 4, -9999.0, 7.0);
        let layer_id = library
            .create_layer(
                "envelope over",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        // No override: this must run under the real production policy.
        assert_eq!(
            admission::limits(),
            admission::AdmissionLimits::production()
        );
        let (_job_id, staging) =
            stage_review(&library, &layer_id, &[south_west, north_east], &cancel);
        let envelope = u64::from(staging.union_grid.width) * u64::from(staging.union_grid.height);
        assert!(envelope > 25_000_000, "the arrangement is wide: {envelope}");
        assert_eq!(staging.processing_cells, 32);
        apply_import(&library, &staging, &cancel)
            .expect("the processing budget admits the pair, charging the sources and not the gap");
        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, None);
        assert_eq!(
            head_member_count(&library, &layer_id),
            2,
            "both separated occurrences are retained"
        );
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A lowered processing budget refuses an ordinary pair before any work
    /// depends on it, and nothing is published: the ordered path consults the
    /// policy rather than a hard-coded ceiling of its own.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn admission_refuses_a_pair_over_the_processing_budget() {
        let root = std::env::temp_dir().join(new_id("canopi-admit-budget"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");
        let south_west = write_placed_fixture(&engine, &root, "sw", 0.0, 4.0, 4, 4, -9999.0, 3.0);
        let north_east =
            write_placed_fixture(&engine, &root, "ne", 4997.0, 5000.0, 4, 4, -9999.0, 7.0);
        let layer_id = library
            .create_layer(
                "budget over",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        // Only the processing budget is lowered, below the pair's own 32 cells,
        // so a refusal can only come from the processing-budget check.
        let _lowered = admission::limits_probe::set(admission::AdmissionLimits {
            files: 24,
            source_bytes: 2 * 1024 * 1024 * 1024,
            import_bytes: 2 * 1024 * 1024 * 1024,
            processing_cells: 16,
        });
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let error = stage_import(
            &library,
            &job_id,
            &layer_id,
            &[south_west, north_east],
            &cancel,
        )
        .expect_err("a pair over the processing budget must be refused");
        assert!(error.contains("processing cells"), "{error}");
        assert!(error.contains("32"), "{error}");
        // Nothing was published and no head was created.
        let connection = library.catalogue().unwrap();
        for table in [
            "lidar_layer_generations",
            "lidar_layer_heads",
            "lidar_generation_chunks",
            "lidar_layer_lattices",
        ] {
            assert_eq!(
                {
                    let mut statement = connection
                        .prepare(&format!("SELECT COUNT(*) FROM {table}"))
                        .unwrap();
                    statement.query_row([], |row| row.get::<_, i64>(0)).unwrap()
                },
                0,
                "{table} must stay empty after a refused import"
            );
        }
        drop(connection);
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The managed-original copy and verification paths read the same policy,
    /// so a lowered bound stops a copy and a raised one lets it through: no
    /// hidden hard-coded ceiling survives beside the policy.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn the_copy_and_hash_paths_are_governed_by_the_same_policy() {
        let root = std::env::temp_dir().join(new_id("canopi-copy-policy"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");
        let source =
            write_placed_fixture(&engine, &root, "policy", 0.0, 64.0, 64, 64, -9999.0, 1.0);
        let bytes = std::fs::metadata(&source).unwrap().len();
        assert!(bytes > 1, "the fixture has content to copy");

        let layer_id = library
            .create_layer(
                "copy policy",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();

        // A lowered per-source bound refuses the selection by name.
        {
            // The bound is lowered below this file's own size, so the refusal
            // can only come from the policy the copy path consults.
            let _lowered = admission::limits_probe::set(admission::AdmissionLimits {
                files: 4,
                source_bytes: (bytes / 2).max(1),
                import_bytes: 4096,
                processing_cells: 1_000_000,
            });
            let job_id = library.record_import_job(&layer_id).expect("job recorded");
            let error = stage_import(
                &library,
                &job_id,
                &layer_id,
                std::slice::from_ref(&source),
                &cancel,
            )
            .expect_err("a source over the lowered bound must be refused");
            assert!(error.contains("per-source limit"), "{error}");
        }

        // The same file is staged once the policy allows it, so no other
        // ceiling stands in the way.
        let (_job_id, _staging) =
            stage_review(&library, &layer_id, std::slice::from_ref(&source), &cancel);
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // BG1: a retained source COG is the durable member payload
    // -----------------------------------------------------------------------

    /// Exact Float32 oracle fixture: the caller's own numbers, sentinel cells
    /// included, so a read compares without a tolerance.
    #[allow(clippy::too_many_arguments)]
    fn write_oracle_fixture(
        engine: &GdalEngine,
        dir: &Path,
        name: &str,
        origin_x: f64,
        origin_y: f64,
        width: u32,
        height: u32,
        nodata: f32,
        values: &[f32],
    ) -> PathBuf {
        assert_eq!(
            values.len(),
            (width * height) as usize,
            "the oracle covers the grid"
        );
        let raw = dir.join(format!("{name}.raw"));
        write_f32_raw(&raw, values).expect("oracle fixture writes");
        let tif = dir.join(format!("{name}.tif"));
        raw_to_tif(
            engine,
            &AtomicBool::new(false),
            &raw,
            &tif,
            &RasterGrid {
                width,
                height,
                geotransform: [origin_x, 1.0, 0.0, origin_y, 0.0, -1.0],
            },
            "EPSG:3857",
            nodata,
        )
        .expect("fixture converts");
        let _ = std::fs::remove_file(&raw);
        let _ = std::fs::remove_file(raw.with_extension("hdr"));
        tif
    }

    /// Every file under a directory, as relative path and size, in a stable
    /// order: enough to prove a caller created or rewrote nothing.
    fn tree_files(root: &Path) -> Vec<(String, u64)> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, u64)>) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else if let Ok(meta) = std::fs::metadata(&path) {
                    out.push((
                        path.strip_prefix(root)
                            .unwrap_or(&path)
                            .to_string_lossy()
                            .into_owned(),
                        meta.len(),
                    ));
                }
            }
        }
        let mut files = Vec::new();
        walk(root, root, &mut files);
        files.sort();
        files
    }

    /// A grid whose Float32 values are exactly representable, with two declared
    /// sentinel cells so validity is exercised beside the values.
    /// Samples at valid cells only; an invalid cell's stored value is not data.
    fn valid_values(values: &[f32], valid: &[u8]) -> Vec<Option<f32>> {
        values
            .iter()
            .zip(valid)
            .map(|(value, valid)| (*valid == 1).then_some(*value))
            .collect()
    }

    fn oracle_grid(width: u32, height: u32) -> (Vec<f32>, Vec<u8>) {
        let mut values: Vec<f32> = (0..(width * height))
            .map(|index| index as f32 * 0.25 - 3.5)
            .collect();
        values[7] = -9999.0;
        values[19] = -9999.0;
        let valid = values
            .iter()
            .map(|value| u8::from(*value != -9999.0))
            .collect();
        (values, valid)
    }

    /// The production vertical slice with source retention: staging keeps one
    /// controlled COG, review and Apply read it, no durable raw/mask/native.tif
    /// copy appears, a restart reads the published generation without preparing
    /// anything, and replacement and undo leave the shared asset immutable.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_retained_source_cog_is_the_only_durable_member_payload() {
        use crate::services::lidar::prepared_raster::observability;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-retained-payload"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let (width, height) = (6u32, 5u32);
        let (first_values, first_valid) = oracle_grid(width, height);
        let second_values: Vec<f32> = first_values
            .iter()
            .map(|value| {
                if *value == -9999.0 {
                    *value
                } else {
                    *value + 100.0
                }
            })
            .collect();
        let first = write_oracle_fixture(
            &engine,
            &root,
            "retained",
            0.0,
            100.0,
            width,
            height,
            -9999.0,
            &first_values,
        );
        let second = write_oracle_fixture(
            &engine,
            &root,
            "replacement",
            0.0,
            100.0,
            width,
            height,
            -9999.0,
            &second_values,
        );

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "retained payload",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let (job_one, staging_one) =
            stage_review(&library, &layer_id, std::slice::from_ref(&first), &cancel);

        // Staging retained exactly one COG and no disposable second payload.
        let staged = &staging_one.sources[0];
        let retained = staged.source_cog.clone();
        // Ownership: the COG is the job's own file until publication, and no
        // global asset exists yet.
        let job_cog = retained
            .resolve(&library.inner.paths, &staged.job_id)
            .expect("the staged COG resolves under its job");
        assert!(job_cog.starts_with(library.inner.paths.job_dir(&job_one)));
        assert!(job_cog.exists(), "the job owns its prepared COG");
        let asset = library.inner.paths.asset_cog(&retained.sha256);
        assert!(
            !asset.exists(),
            "nothing is admitted globally before publication"
        );
        let staged_files = tree_files(&library.inner.paths.job_dir(&job_one));
        assert!(
            staged_files
                .iter()
                .all(|(path, _)| !path.ends_with("values.raw") && !path.ends_with("valid.bin")),
            "job scratch keeps no raw/mask payload: {staged_files:?}"
        );
        assert_eq!(
            staged_files
                .iter()
                .filter(|(path, _)| path.ends_with(".tif"))
                .count(),
            1,
            "the job holds exactly its own prepared COG: {staged_files:?}"
        );
        apply_import(&library, &staging_one, &cancel).expect("apply");

        // The interpretation references the shared digest.
        let interpretation_id = format!("interp-{}", staged.interp_hash);
        {
            let connection = library.catalogue().unwrap();
            let (row, nodata) = catalogue::interpretation_cog(&connection, &interpretation_id)
                .unwrap()
                .expect("the interpretation references its retained COG");
            assert_eq!(row.sha256, retained.sha256);
            assert_eq!(nodata, Some(-9999.0));
        }
        assert_eq!(std::fs::metadata(&asset).unwrap().len(), retained.bytes);

        // Restart: the accepted head reads back exactly through the committed
        // reader, and reading prepares nothing.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        observability::reset();
        let before_read = tree_files(&root);
        let window = generation::LatticeWindow {
            x: 0,
            y: 0,
            width,
            height,
        };
        let head = head_of(&reopened, &layer_id);
        let _ = head;
        let (values, valid) = head_window(&reopened, &layer_id, window);
        assert_eq!(valid, first_valid, "validity is the source's own rule");
        assert_eq!(
            valid_values(&values, &valid),
            valid_values(&first_values, &first_valid),
            "Float32 values round-trip exactly"
        );
        assert!(
            observability::tiles_decoded() > 0,
            "the committed reader decoded the retained source COG"
        );
        assert_eq!(
            tree_files(&root),
            before_read,
            "reading a published generation prepares nothing"
        );

        // A second item publishes from its own retained source; the first
        // source's shared asset stays byte-identical and its item unchanged.
        let shared_before =
            crate::services::lidar::raster_assets::hash_file(&asset, &AtomicBool::new(false))
                .unwrap();
        let second_layer = reopened
            .create_layer(
                "second payload",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let (_job_two, staging_two) = stage_review(
            &reopened,
            &second_layer,
            std::slice::from_ref(&second),
            &cancel,
        );
        assert_ne!(
            staging_two.sources[0].source_cog.sha256, retained.sha256,
            "different content is a different asset"
        );
        apply_import(&reopened, &staging_two, &cancel).expect("second item applies");
        let (second_read, second_valid) = head_window(&reopened, &second_layer, window);
        assert_eq!(
            valid_values(&second_read, &second_valid),
            valid_values(&second_values, &first_valid)
        );
        let (values, valid) = head_window(&reopened, &layer_id, window);
        assert_eq!(valid, first_valid);
        assert_eq!(
            valid_values(&values, &valid),
            valid_values(&first_values, &first_valid),
            "the first item is unchanged"
        );
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&asset, &AtomicBool::new(false))
                .unwrap(),
            shared_before,
            "a retained asset is immutable"
        );
        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A publication that fails after preparation publishes nothing, and a
    /// shared asset another publication already references survives exactly as
    /// it was.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_failed_apply_leaves_a_reused_asset_and_the_head_intact() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-reused-asset"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "reused asset",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();

        // One small source published normally: its COG is now a shared asset.
        let small = write_placed_fixture(&engine, &root, "small", 0.0, 4.0, 4, 4, -9999.0, 3.0);
        let (_job_one, staging_one) =
            stage_review(&library, &layer_id, std::slice::from_ref(&small), &cancel);
        let retained = staging_one.sources[0].source_cog.clone();
        apply_import(&library, &staging_one, &cancel).expect("apply");
        let asset = library.inner.paths.asset_cog(&retained.sha256);
        let shared_digest =
            crate::services::lidar::raster_assets::hash_file(&asset, &AtomicBool::new(false))
                .unwrap();
        let head_before = head_of(&library, &layer_id);

        // A second job reuses the same file and is cancelled before it
        // publishes: nothing changes and the shared asset is untouched.
        let (_job_two, staging_two) =
            stage_review(&library, &layer_id, std::slice::from_ref(&small), &cancel);
        assert_eq!(
            staging_two.sources[0].source_cog.sha256, retained.sha256,
            "content addressing reuses the admitted asset"
        );
        cancel.store(true, Ordering::Relaxed);
        let cancelled = apply_import(&library, &staging_two, &cancel)
            .expect_err("a cancelled Apply publishes nothing");
        assert!(cancelled.contains("cancelled"), "{cancelled}");
        cancel.store(false, Ordering::Relaxed);
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&asset, &AtomicBool::new(false))
                .unwrap(),
            shared_digest,
            "a cancelled Apply never touches a shared asset"
        );
        assert_eq!(head_of(&library, &layer_id).id, head_before.id);

        // A third job reuses that file beside a far source. It prepares
        // normally — the ordered route charges occurrences, not an envelope —
        // so the failure below is a real publication failure rather than an
        // admission refusal.
        let far = write_placed_fixture(&engine, &root, "far", 5004.0, 5004.0, 4, 4, -9999.0, 7.0);
        let (_job_three, staging_three) =
            stage_review(&library, &layer_id, &[small.clone(), far], &cancel);
        assert_eq!(staging_three.sources[0].source_cog.sha256, retained.sha256);
        let far_interp = format!("interp-{}", staging_three.sources[1].interp_hash);
        {
            let connection = library.catalogue().unwrap();
            assert!(
                catalogue::interpretation_cog(&connection, &far_interp)
                    .unwrap()
                    .is_none(),
                "the new source has no reference yet"
            );
        }

        // A publication interrupted after promotion leaves nothing behind and
        // never disturbs the asset the accepted head already references.
        promotion_probe::fail_at(promotion_probe::FaultPoint::BeforeTransaction);
        let error = apply_import(&library, &staging_three, &cancel)
            .expect_err("the injected failure refuses the publication");
        promotion_probe::clear();
        assert!(error.contains("injected failure"), "{error}");
        let head_after = head_of(&library, &layer_id);
        assert_eq!(head_after.id, head_before.id);
        assert_eq!(head_after.coverage_cells, head_before.coverage_cells);
        {
            let connection = library.catalogue().unwrap();
            assert!(
                catalogue::interpretation_cog(&connection, &far_interp)
                    .unwrap()
                    .is_none(),
                "a refused Apply writes no reference"
            );
            let generations: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM lidar_layer_generations WHERE layer_id = ?1",
                    [&layer_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(generations, 1, "a refused Apply publishes nothing");
        }
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&asset, &AtomicBool::new(false))
                .unwrap(),
            shared_digest,
            "the reused asset is untouched"
        );
        let (values, valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(values.iter().all(|value| *value == 3.0));
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // BG6: the review visits occupied blocks, never the empty envelope
    // -----------------------------------------------------------------------

    /// A 1x1 fixture, the smallest occupied source placement.
    #[allow(dead_code)]
    fn write_cell_fixture(
        engine: &GdalEngine,
        dir: &Path,
        name: &str,
        origin_x: f64,
        origin_y: f64,
        value: f32,
    ) -> PathBuf {
        write_placed_fixture(engine, dir, name, origin_x, origin_y, 1, 1, -9999.0, value)
    }
    /// A failed publication rolls its own promotions back, keeps a reused asset
    /// and leaves the accepted head readable.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_failed_publication_rolls_back_only_its_own_promotions() {
        use promotion_probe::FaultPoint;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-promotion-rollback"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "promotion rollback",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        // 1. An accepted generation, so the layer has history to protect.
        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (_job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        apply_import(&library, &staging_one, &cancel).expect("apply");
        let accepted_hash = staging_one.sources[0].interp_hash.clone();
        let accepted_asset = committed_asset(&library, &accepted_hash).expect("committed");
        let head_before = head_of(&library, &layer_id);

        // 2. A new source: promotion then an injected failure before the
        // transaction. Its asset and reference must not survive; the accepted
        // asset must.
        let fresh = write_placed_fixture(&engine, &root, "fresh", 16.0, 8.0, 4, 4, -9999.0, 9.0);
        let (job_two, staging_two) =
            stage_review(&library, &layer_id, std::slice::from_ref(&fresh), &cancel);
        let fresh_hash = staging_two.sources[0].interp_hash.clone();
        let fresh_cog = staging_two.sources[0].source_cog.clone();
        let fresh_asset = paths.asset_cog(&fresh_cog.sha256);
        promotion_probe::fail_at(FaultPoint::BeforeTransaction);
        let error = apply_import(&library, &staging_two, &cancel)
            .expect_err("the injected failure refuses the publication");
        promotion_probe::clear();
        assert!(error.contains("injected failure"), "{error}");
        assert!(
            !fresh_asset.exists(),
            "a rolled-back promotion leaves no global asset"
        );
        assert_eq!(
            committed_asset(&library, &fresh_hash),
            None,
            "no reference commits with a failed publication"
        );
        assert!(
            fresh_cog
                .resolve(&paths, &staging_two.sources[0].job_id)
                .unwrap()
                .exists(),
            "the job keeps its own COG for a retry"
        );
        assert!(
            journal_of(&library, &job_two).is_none(),
            "the journal is settled"
        );
        assert_eq!(head_of(&library, &layer_id).id, head_before.id);
        assert!(
            paths.asset_cog(&accepted_asset).exists(),
            "accepted history is never deleted"
        );

        // 3. The same job succeeds once the fault is gone, and the reused
        // accepted asset is untouched by the retry.
        apply_import(&library, &staging_two, &cancel).expect("apply");
        assert_eq!(
            committed_asset(&library, &fresh_hash),
            Some(fresh_cog.sha256.clone())
        );
        assert!(fresh_asset.exists(), "the promoted asset is published");
        assert!(journal_of(&library, &job_two).is_none());
        assert_eq!(
            committed_asset(&library, &accepted_hash),
            Some(accepted_asset.clone()),
            "the accepted reference is unchanged"
        );

        // 3b. One job that reuses an already committed asset and adds a new
        // one: the failed publication rolls back only the new promotion and
        // leaves the reused asset and its reference exactly as they were.
        let head_before_reuse = head_of(&library, &layer_id);
        let reuse_new =
            write_placed_fixture(&engine, &root, "reuse-new", 48.0, 8.0, 4, 4, -9999.0, 3.0);
        let (_job_reuse, staging_reuse) =
            stage_review(&library, &layer_id, &[accepted.clone(), reuse_new], &cancel);
        let reuse_new_hash = staging_reuse.sources[1].interp_hash.clone();
        let reuse_new_asset = paths.asset_cog(&staging_reuse.sources[1].source_cog.sha256);
        promotion_probe::fail_at(FaultPoint::BeforeTransaction);
        let _ = apply_import(&library, &staging_reuse, &cancel)
            .expect_err("the injected failure refuses the mixed publication");
        promotion_probe::clear();
        assert!(
            paths.asset_cog(&accepted_asset).exists(),
            "a reused asset is not owned by the failing job"
        );
        assert_eq!(
            committed_asset(&library, &accepted_hash),
            Some(accepted_asset.clone())
        );
        assert!(
            !reuse_new_asset.exists(),
            "the job's own new promotion is rolled back"
        );
        assert_eq!(committed_asset(&library, &reuse_new_hash), None);
        assert_eq!(head_of(&library, &layer_id).id, head_before_reuse.id);

        // 4. A failure after the head transaction commits keeps the asset and
        // leaves the journal for recovery, which then settles it.
        let third = write_placed_fixture(&engine, &root, "third", 32.0, 8.0, 4, 4, -9999.0, 7.0);
        let (job_three, staging_three) =
            stage_review(&library, &layer_id, std::slice::from_ref(&third), &cancel);
        let third_hash = staging_three.sources[0].interp_hash.clone();
        let third_cog = staging_three.sources[0].source_cog.clone();
        promotion_probe::fail_at(FaultPoint::AfterCommitBeforeCleanup);
        let committed = apply_import(&library, &staging_three, &cancel)
            .expect("a committed publication is success even when cleanup fails");
        promotion_probe::clear();
        assert!(
            committed
                .message
                .as_deref()
                .is_some_and(|message| message.contains("promotion evidence retained")),
            "the diagnostic names the retained evidence: {:?}",
            committed.message
        );
        let third_asset = paths.asset_cog(&third_cog.sha256);
        assert_eq!(
            committed_asset(&library, &third_hash),
            Some(third_cog.sha256.clone()),
            "the committed reference survives the failed cleanup"
        );
        assert!(third_asset.exists());
        assert!(
            journal_of(&library, &job_three).is_some(),
            "the unsettled journal is retained as evidence"
        );

        // Restart: recovery sees the committed reference, keeps the asset and
        // clears the journal; the generation still reads exactly.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        assert!(paths.asset_cog(&third_cog.sha256).exists());
        assert!(journal_of(&reopened, &job_three).is_none());
        let (values, valid) = head_window(
            &reopened,
            &staging_three.layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(values.iter().all(|value| *value == 7.0));

        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The rollback owner exists before the first promotion, so a failure while
    /// a later source is being prepared still removes what already landed.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_failure_during_a_later_source_still_rolls_back() {
        use promotion_probe::FaultPoint;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-later-source"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "later source",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (_job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        apply_import(&library, &staging_one, &cancel).expect("apply");
        let accepted_asset =
            committed_asset(&library, &staging_one.sources[0].interp_hash).expect("committed");
        let head_before = head_of(&library, &layer_id);

        let first = write_placed_fixture(&engine, &root, "first", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let second = write_placed_fixture(&engine, &root, "second", 32.0, 8.0, 4, 4, -9999.0, 9.0);
        let (job_two, staging_two) = stage_review(
            &library,
            &layer_id,
            &[first.clone(), second.clone()],
            &cancel,
        );
        let hashes: Vec<String> = staging_two
            .sources
            .iter()
            .map(|source| source.interp_hash.clone())
            .collect();
        let assets: Vec<_> = staging_two
            .sources
            .iter()
            .map(|source| paths.asset_cog(&source.source_cog.sha256))
            .collect();
        promotion_probe::fail_at(FaultPoint::AfterPromotion);
        let error = apply_import(&library, &staging_two, &cancel)
            .expect_err("the injected failure refuses the publication");
        promotion_probe::clear();
        assert!(error.contains("injected failure"), "{error}");
        for (asset, hash) in assets.iter().zip(&hashes) {
            assert!(
                !asset.exists(),
                "a promotion that landed before the failure is removed: {}",
                asset.display()
            );
            assert_eq!(committed_asset(&library, hash), None);
        }
        assert_eq!(head_of(&library, &layer_id).id, head_before.id);
        assert!(paths.asset_cog(&accepted_asset).exists());
        assert!(
            journal_of(&library, &job_two).is_none(),
            "the journal is settled"
        );
        for source in &staging_two.sources {
            let local = source
                .source_cog
                .resolve(&paths, &source.job_id)
                .expect("job-local COG");
            assert!(local.exists(), "the job keeps its own COG for retry");
        }

        let _applied = apply_import(&library, &staging_two, &cancel).expect("retry applies");
        for (asset, hash) in assets.iter().zip(&hashes) {
            assert!(asset.exists());
            assert!(committed_asset(&library, hash).is_some());
        }

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A collision is not ownership: a matching file this job did not create is
    /// preserved through rollback and restart, and the conflicting attempt is
    /// refused by name.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_collision_is_never_owned() {
        use promotion_probe::FaultPoint;
        use std::cell::Cell;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-collision"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "collision",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (_job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        apply_import(&library, &staging_one, &cancel).expect("apply");
        let accepted_asset =
            committed_asset(&library, &staging_one.sources[0].interp_hash).expect("committed");
        let head_before = head_of(&library, &layer_id);

        // Two new sources: the first links normally, the second collides.
        let first = write_placed_fixture(&engine, &root, "first", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let second = write_placed_fixture(&engine, &root, "second", 32.0, 8.0, 4, 4, -9999.0, 9.0);
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[first, second], &cancel);
        let locals: Vec<PathBuf> = staging_two
            .sources
            .iter()
            .map(|source| {
                source
                    .source_cog
                    .resolve(&paths, &source.job_id)
                    .expect("job-local COG")
            })
            .collect();
        let destinations: Vec<PathBuf> = staging_two
            .sources
            .iter()
            .map(|source| paths.asset_cog(&source.source_cog.sha256))
            .collect();
        // Create the competing file between the destination check and the link
        // of the second source: identical content, a different file.
        let calls = Cell::new(0u32);
        let rival_local = locals[1].clone();
        let rival_destination = destinations[1].clone();
        promotion_probe::act_at(FaultPoint::BeforePromotionLink, move || {
            let call = calls.get();
            calls.set(call + 1);
            if call == 1 {
                std::fs::copy(&rival_local, &rival_destination).expect("rival asset is created");
            }
        });
        let error = apply_import(&library, &staging_two, &cancel)
            .expect_err("the collision refuses the publication");
        promotion_probe::clear();
        assert!(error.contains("refusing to adopt"), "{error}");
        assert!(
            error.contains(&destinations[1].display().to_string()),
            "the refusal names the destination: {error}"
        );

        // The competing file is byte-for-byte intact and never referenced.
        let declared = staging_two.sources[1].source_cog.clone();
        assert!(
            destinations[1].exists(),
            "a file this job did not create is preserved"
        );
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(
                &destinations[1],
                &AtomicBool::new(false)
            )
            .unwrap(),
            (declared.sha256.clone(), declared.bytes),
            "its content still matches the declared digest by construction"
        );
        assert_eq!(
            committed_asset(&library, &staging_two.sources[1].interp_hash),
            None,
            "no reference adopts the competing file"
        );
        // The job's own earlier promotion rolls back, and nothing else moves.
        assert!(
            !destinations[0].exists(),
            "an asset this job created before the collision is removed"
        );
        assert_eq!(
            committed_asset(&library, &staging_two.sources[0].interp_hash),
            None
        );
        assert_eq!(head_of(&library, &layer_id).id, head_before.id);
        assert!(paths.asset_cog(&accepted_asset).exists());
        assert!(
            journal_of(&library, &job_two).is_none(),
            "the journal is settled"
        );
        for local in &locals {
            assert!(local.exists(), "the job keeps its own COG for retry");
        }

        // Restart preserves the collision file and the library opens cleanly.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        assert!(destinations[1].exists(), "recovery preserves it too");
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(
                &destinations[1],
                &AtomicBool::new(false)
            )
            .unwrap(),
            (declared.sha256, declared.bytes)
        );
        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An unresolved recovery keeps its evidence, fails library opening with a
    /// named error, and completes idempotently once the fault is removed.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn unresolved_recovery_keeps_the_root_and_fails_open() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-unresolved-recovery"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "unresolved recovery",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let waiting = write_placed_fixture(&engine, &root, "waiting", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_wait, staging_wait) =
            stage_review(&library, &layer_id, std::slice::from_ref(&waiting), &cancel);
        let wait_local = staging_wait.sources[0]
            .source_cog
            .resolve(&paths, &staging_wait.sources[0].job_id)
            .expect("job-local COG");

        let other = write_placed_fixture(&engine, &root, "other", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let (job_bad, _staging_bad) =
            stage_review(&library, &layer_id, std::slice::from_ref(&other), &cancel);
        write_promotion_journal(
            &paths,
            &job_bad,
            &PromotionJournal {
                entries: vec![PromotionEntry {
                    interpretation_id: "interp-unknown".to_string(),
                    sha256: "unknown-digest".to_string(),
                    destination: "../outside/cog.tif".to_string(),
                    witness: None,
                }],
            },
        )
        .unwrap();

        drop(library);
        let error = LidarLibrary::open(&root)
            .err()
            .expect("unresolved recovery fails library opening");
        assert!(
            error.contains("recovery is incomplete"),
            "the error names recoverability: {error}"
        );
        assert!(
            journal_of_paths(&paths, &job_bad).is_some(),
            "the unresolved journal is retained"
        );
        assert!(paths.job_dir(&job_bad).exists(), "its root is intact");
        assert!(
            wait_local.exists(),
            "an awaiting-review payload is untouched"
        );

        let _ = std::fs::remove_file(promotion_journal_path(&paths, &job_bad));
        let reopened = LidarLibrary::open(&root).expect("recovery completes on reopen");
        assert!(journal_of(&reopened, &job_bad).is_none());
        // A job interrupted while publishing is settled rather than left in a
        // state nobody can act on: there is no review to return to, and its
        // validated payload is re-derivable by importing again.
        assert!(
            !paths.job_dir(&job_wait).exists(),
            "an interrupted publication is settled"
        );
        assert!(!wait_local.exists(), "and its job-local COG is removed");
        // Recovery leaves the library usable: a fresh batch publishes normally.
        let _fresh = {
            let job_id = reopened.record_import_job(&layer_id).expect("job recorded");
            stage_and_publish(
                &reopened,
                &job_id,
                &layer_id,
                std::slice::from_ref(&other),
                &cancel,
            )
            .expect("a fresh batch publishes after recovery")
        };
        drop(reopened);
        let twice = LidarLibrary::open(&root).expect("the second reopen is clean");
        drop(twice);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A committed publication is irreversible success: a journal-clear failure
    /// keeps the retry evidence, reports a diagnostic, and still settles as a
    /// complete job through the real caller, which never enqueues analysis.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_cleanup_failure_after_commit_is_still_a_successful_publication() {
        use promotion_probe::FaultPoint;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-commit-success"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "commit success",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (_job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        apply_import(&library, &staging_one, &cancel).expect("apply");

        let incoming =
            write_placed_fixture(&engine, &root, "incoming", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let (job_two, staging_two) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&incoming),
            &cancel,
        );
        let hash = staging_two.sources[0].interp_hash.clone();
        let asset = paths.asset_cog(&staging_two.sources[0].source_cog.sha256);

        promotion_probe::fail_at(FaultPoint::BeforeJournalClear);
        let applied = apply_import(&library, &staging_two, &cancel)
            .expect("a committed publication reports success");
        promotion_probe::clear();
        let diagnostic = applied
            .message
            .as_deref()
            .expect("the retained evidence is reported as a diagnostic");
        assert!(
            diagnostic.contains("promotion evidence retained"),
            "{diagnostic}"
        );
        let head = head_of(&library, &staging_two.layer_id);
        assert_eq!(head.id, applied.generation_id);
        assert!(asset.exists(), "the promoted asset is published");
        assert!(committed_asset(&library, &hash).is_some());
        assert!(
            journal_of(&library, &job_two).is_some(),
            "the journal survives for recovery"
        );

        // A dependent of the layer, so the committed success must run the
        // existing refresh path rather than a failed-publication settlement.
        {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_analysis_definitions(
                        id, layer_id, kind, version, parameters_json, created_at)
                     VALUES('definition-commit', ?1, 'slope', 1, '{}', '0')",
                    [&layer_id],
                )
                .unwrap();
        }
        library.finish_import_sources(&job_two, &layer_id, Ok(()));
        {
            let connection = library.catalogue().unwrap();
            let state = catalogue::get_import_job(&connection, &job_two)
                .unwrap()
                .expect("job row")
                .state;
            assert_eq!(state, "complete", "a committed apply settles as complete");
            let refreshes: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM lidar_analysis_jobs
                     WHERE definition_id = 'definition-commit'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(refreshes, 0, "a publication never enqueues analysis");
        }

        let generations_before = generation_count(&library, &layer_id);
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        assert!(journal_of(&reopened, &job_two).is_none());
        assert_eq!(generation_count(&reopened, &layer_id), generations_before);
        let (values, valid) = head_window(
            &reopened,
            &staging_two.layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 4,
                height: 4,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(values.iter().all(|value| *value == 7.0));

        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A journal that cannot be cleared keeps its evidence through the failed
    /// publication, blocks a destructive settlement, and retries cleanly.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn journal_clear_failure_retains_evidence_until_recovery() {
        use promotion_probe::FaultPoint;
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-journal-clear"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "journal clear",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (_job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        apply_import(&library, &staging_one, &cancel).expect("apply");
        let accepted_asset =
            committed_asset(&library, &staging_one.sources[0].interp_hash).expect("committed");

        let incoming =
            write_placed_fixture(&engine, &root, "incoming", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let (job_two, staging_two) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&incoming),
            &cancel,
        );
        let asset = paths.asset_cog(&staging_two.sources[0].source_cog.sha256);

        // The publication fails before the commit and the rollback cannot clear
        // its journal: the evidence must survive rather than report clean.
        promotion_probe::fail_at(FaultPoint::BeforeTransaction);
        promotion_probe::fail_at(FaultPoint::BeforeJournalClear);
        let error = apply_import(&library, &staging_two, &cancel)
            .expect_err("the injected failure refuses the publication");
        promotion_probe::clear();
        assert!(error.contains("injected failure"), "{error}");
        assert!(!asset.exists(), "the uncommitted promotion is removed");
        assert!(
            journal_of(&library, &job_two).is_some(),
            "a journal that could not be cleared is retained"
        );
        assert!(paths.job_dir(&job_two).exists(), "its root is retained");
        assert!(paths.asset_cog(&accepted_asset).exists());

        // The fault now hits opening: recovery reports the named error and
        // keeps the evidence instead of deleting the root.
        promotion_probe::fail_at(FaultPoint::BeforeJournalClear);
        drop(library);
        let error = LidarLibrary::open(&root)
            .err()
            .expect("an uncleared journal fails opening");
        promotion_probe::clear();
        assert!(error.contains("recovery is incomplete"), "{error}");
        assert!(journal_of_paths(&paths, &job_two).is_some());
        assert!(paths.job_dir(&job_two).exists());
        assert!(paths.asset_cog(&accepted_asset).exists());

        // Removing the fault completes cleanup, and it is idempotent.
        let reopened = LidarLibrary::open(&root).expect("cleanup completes on reopen");
        assert!(journal_of(&reopened, &job_two).is_none());
        assert!(
            !paths.job_dir(&job_two).exists(),
            "the settled root is removed"
        );
        assert!(paths.asset_cog(&accepted_asset).exists());
        drop(reopened);
        let twice = LidarLibrary::open(&root).expect("the second reopen is clean");
        drop(twice);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// The catalogue's view of one source: its committed reference, when any.
    fn committed_asset(library: &LidarLibrary, interp_hash: &str) -> Option<String> {
        let connection = library.catalogue().unwrap();
        catalogue::interpretation_cog(&connection, &format!("interp-{interp_hash}"))
            .unwrap()
            .map(|(row, _)| row.sha256)
    }

    fn journal_of(library: &LidarLibrary, job_id: &str) -> Option<PromotionJournal> {
        let path = promotion_journal_path(&library.inner.paths, job_id);
        std::fs::read_to_string(&path)
            .ok()
            .map(|json| serde_json::from_str(&json).expect("journal parses"))
    }

    /// Journal contents by path, for assertions after the library is dropped.
    fn journal_of_paths(paths: &LidarPaths, job_id: &str) -> Option<PromotionJournal> {
        std::fs::read_to_string(promotion_journal_path(paths, job_id))
            .ok()
            .map(|json| serde_json::from_str(&json).expect("journal parses"))
    }

    /// Journal file of one job, next to the payloads it owns.
    fn promotion_journal_path(paths: &LidarPaths, job_id: &str) -> PathBuf {
        paths.job_dir(job_id).join("promotions.json")
    }

    fn generation_count(library: &LidarLibrary, layer_id: &str) -> i64 {
        let connection = library.catalogue().unwrap();
        connection
            .query_row(
                "SELECT COUNT(*) FROM lidar_layer_generations WHERE layer_id = ?1",
                [layer_id],
                |row| row.get(0),
            )
            .unwrap()
    }
}
