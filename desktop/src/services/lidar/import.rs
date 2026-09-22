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
use super::admission;
use super::catalogue::{self, new_id, now_iso};
use super::collection;
use super::display::{self, ColorRamp};
use super::engine::{GdalEngine, GdalProgram};
use super::generation::{self, LatticeWindow};
use super::grid::{
    self, CoverageClassification, GeoTransform, RasterGrid, ValidMask, remap_mask_checked,
    union_grid,
};
use super::paths::LidarPaths;
use super::prepared_raster::{PreparedRaster, RasterWindow};
use common_types::lidar::{
    LidarImportDecisionPreview, LidarImportProgressPhase, LidarImportReview, LidarImportSourceFacts,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Canonical NoData used for a layer whose first source declares none.
pub const FALLBACK_NODATA: f32 = -99999.0;
pub(crate) use super::admission::MAX_DENSE_ENVELOPE_CELLS as MAX_DENSE_WORKING_CELLS;

/// Every occurrence the ordered proposal would read, and what each costs.
///
/// The budget the admission policy charges is the work the collection would
/// propose, not the area it would span. Each accepted occurrence is visited the
/// way the resolver visits it — a source member across its own native grid, a
/// preserved `previous-composition` member across only the chunks it actually
/// stores — and each incoming staged source is charged its full native grid.
/// Overlap and NoData are charged again on every occurrence on purpose: a
/// mostly-NoData source still costs decoding work, so the count is conservative
/// work accounting rather than a coverage measurement.
///
/// Only `result` chunks count for a preserved member. A quality chunk describes
/// cells the result chunk already accounts for, which is the result/quality
/// role deduplication the policy requires.
fn ordered_processing_cost(
    connection: &rusqlite::Connection,
    head: Option<&catalogue::GenerationRow>,
    incoming: &[&StagedSource],
) -> Result<Vec<admission::ProcessingCost>, String> {
    let mut proposed = Vec::new();
    if let Some(head_row) = head {
        let members = catalogue::collection_members(connection, &head_row.id)?;
        if members.is_empty() {
            // A head written before ordered collections existed replays through
            // the legacy member table, or as one dense preserved lattice when
            // even that is absent.
            let legacy = catalogue::generation_members(connection, &head_row.id)?;
            if legacy.is_empty() {
                let manifest = read_generation_manifest(&head_row.manifest_json)?;
                proposed.push(admission::ProcessingCost::Dense {
                    width: manifest.grid.width,
                    height: manifest.grid.height,
                });
            } else {
                for (interpretation_id, _role, _job_id) in legacy {
                    let interpretation =
                        catalogue::get_interpretation(connection, &interpretation_id)?
                            .ok_or_else(|| format!("missing interpretation {interpretation_id}"))?;
                    proposed.push(admission::ProcessingCost::Dense {
                        width: interpretation.width as u32,
                        height: interpretation.height as u32,
                    });
                }
            }
        } else {
            for member in members {
                match (
                    member.interpretation_id.as_deref(),
                    member.base_generation_id.as_deref(),
                ) {
                    (Some(interpretation_id), _) => {
                        let interpretation =
                            catalogue::get_interpretation(connection, interpretation_id)?
                                .ok_or_else(|| {
                                    format!("missing interpretation {interpretation_id}")
                                })?;
                        proposed.push(admission::ProcessingCost::Dense {
                            width: interpretation.width as u32,
                            height: interpretation.height as u32,
                        });
                    }
                    (None, Some(base_generation_id)) => {
                        proposed.push(admission::ProcessingCost::Sparse {
                            footprint: catalogue::published_chunk_footprint(
                                connection,
                                base_generation_id,
                                generation::RESULT_ROLE,
                            )?,
                        });
                    }
                    (None, None) => {
                        return Err(format!(
                            "collection member {} names no source or preserved generation",
                            member.member_id
                        ));
                    }
                }
            }
        }
    }
    for source in incoming {
        proposed.push(admission::ProcessingCost::Dense {
            width: source.width,
            height: source.height,
        });
    }
    Ok(proposed)
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
    ///
    /// A job-local COG is resolved under this job's root; absent in a staged
    /// job written before job-local retention.
    #[serde(default)]
    pub job_id: Option<String>,
    /// The retained controlled source COG this interpretation reads from.
    ///
    /// Absent only in a staged job written before source retention existed:
    /// such a job is still reviewable and publishable through its disposable
    /// raw/mask scratch, which is why those paths stay optional.
    #[serde(default)]
    pub source_cog: Option<RetainedSourceCog>,
    #[serde(default)]
    pub valid_mask_path: PathBuf,
    #[serde(default)]
    pub raw_samples_path: PathBuf,
    /// Valid cells the prepared source actually holds.
    ///
    /// Preparation already counts them; keeping the count is what lets the
    /// batch refuse an all-NoData member by name instead of publishing an
    /// occurrence that contributes no coverage. Absent in staging written
    /// before this field existed, which reads as unknown rather than zero.
    #[serde(default)]
    pub valid_cells: Option<u64>,
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
    ///
    /// Absent in a staged job written before job-local retention: such a job
    /// reads the global content-addressed asset of the same digest instead.
    #[serde(default)]
    pub relative_path: Option<String>,
}

impl RetainedSourceCog {
    /// Resolve this retained COG's readable path.
    ///
    /// A job-relative location is resolved under the owning job root and must
    /// stay there: the digest is identity, never proof that a global file
    /// exists. Without one, the global content-addressed asset is used, which
    /// this job only leases.
    pub(super) fn resolve(
        &self,
        paths: &LidarPaths,
        job_id: Option<&str>,
    ) -> Result<PathBuf, String> {
        let Some(relative) = self.relative_path.as_deref() else {
            return Ok(paths.asset_cog(&self.sha256));
        };
        let job_id = job_id.ok_or_else(|| {
            "staged source keeps its COG in a job but records no owning job".to_string()
        })?;
        let root = paths.job_dir(job_id);
        resolve_under_root(&root, relative).map_err(|error| {
            format!("staged source COG location {relative} escapes its job root: {error}")
        })
    }

    /// Open this source's retained COG for bounded reads.
    pub(super) fn open(
        &self,
        paths: &LidarPaths,
        job_id: Option<&str>,
        grid: &RasterGrid,
    ) -> Result<PreparedRaster, String> {
        PreparedRaster::open_committed(&self.resolve(paths, job_id)?, grid, self.nodata)
    }
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
    /// Processing cells this proposal was admitted for.
    ///
    /// Recorded so the review carries the number the admission policy actually
    /// charged, and so Apply can be read against the same figure the user saw.
    /// Defaulted for staged payloads written before the ordered path replaced
    /// the union-envelope bound.
    #[serde(default)]
    pub processing_cells: u64,
    pub before_preview_path: Option<PathBuf>,
    pub after_preview_path: Option<PathBuf>,
    pub engine_version: String,
}

#[derive(Debug)]
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
            job_id,
            &job_dir,
            cancel,
        )?);
    }

    // One common interpretation for the whole batch.
    //
    // When the layer already has an accepted head, `stage_source` compared each
    // source against that head's CRS and grid. A layer's first batch has no head
    // to compare against, so the first compatible selection becomes the anchor
    // every other selected source must match: without this, an EPSG:3857 and an
    // EPSG:4326 raster with equal coordinates were both admitted, and neither
    // the lattice nor a later read could reconcile them.
    {
        let anchor_grid = layer_grid.clone().or_else(|| {
            staged
                .iter()
                .find(|source| source.compatible)
                .map(grid_for_source)
        });
        let anchor_crs = layer_crs_wkt.clone().or_else(|| {
            staged
                .iter()
                .find(|source| source.compatible)
                .map(|source| source.crs_wkt.clone())
        });
        for source in staged.iter_mut().filter(|source| source.compatible) {
            if let Some(expected) = anchor_crs.as_deref()
                && source.crs_wkt.trim() != expected.trim()
            {
                source.compatible = false;
                source.issues.push(
                    "horizontal CRS differs from the other selected sources; transforming foreign \
                     grids arrives in a later slice"
                        .to_string(),
                );
            }
            if let Some(expected) = anchor_grid.as_ref()
                && let Err(error) = grid_for_source(source).compatible(expected)
            {
                source.compatible = false;
                source.issues.push(format!(
                    "grid incompatible with the other selected sources: {error}"
                ));
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

    // Union grid across the layer grid and every compatible source. It is
    // metadata: review work is bounded by blocks, never sized by its area.
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
    validate_lattice(&union, "import review")?;
    // Admission is one policy for both storage branches, and the branch that
    // will run decides which bound applies. The ordered route never allocates
    // by envelope, so it is charged the processing cells it proposes; a legacy
    // dense head keeps the envelope guard.
    let dense_route = head.as_ref().is_some_and(|row| {
        read_generation_manifest(&row.manifest_json)
            .is_ok_and(|manifest| manifest.format == GenerationStorageFormat::LegacyDenseV1)
    });
    // Zero on the legacy dense branch, which is governed by the envelope guard.
    let mut admitted_processing_cells: u64 = 0;
    if dense_route {
        let composition_extent = composition_extent_grid(library, head.as_ref())?;
        admission::check_dense_envelope(
            admission::union_envelope_cells(union.width, union.height)?,
            "import review",
        )?;
        if let Some(mut admitted) = composition_extent {
            for source in &compatible {
                admitted = union_grid(&admitted, &grid_for_source(source))?;
            }
            validate_lattice(&admitted, "import review envelope")?;
            admission::check_dense_envelope(
                admission::union_envelope_cells(admitted.width, admitted.height)?,
                "import review envelope",
            )?;
        }
    } else {
        // Rechecked against the expected head at Apply; here it is decided
        // before any review work depends on the proposal.
        let proposed = {
            let connection = library.catalogue()?;
            ordered_processing_cost(&connection, head.as_ref(), &compatible)?
        };
        admitted_processing_cells = admission::check_processing_budget(proposed, "import review")?;
    }

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

    // Compose the review one bounded block at a time: each block unions the
    // incoming sources' validity (so overlapping files count once), compares it
    // once with the accepted head, and reduces the result into both previews.
    // Nothing here is sized by the union's area.
    check_cancel(cancel)?;
    let (target_width, target_height) = review_preview_target(&union)?;
    let coverage = {
        let head_source =
            HeadBlockSource::open(library, head.as_ref(), head_manifest.as_ref(), cancel)?;
        // The traversal runs on the fixed layer lattice: the accepted head's own
        // grid when one exists, otherwise the first accepted source's grid,
        // exactly as publication anchors it.
        let lattice = head_manifest
            .as_ref()
            .map(|manifest| manifest.grid.clone())
            .unwrap_or_else(|| grid_for_source(compatible[0]));
        review_coverage(
            &head_source,
            &compatible,
            library,
            paths,
            &lattice,
            &union,
            layer_nodata,
            (target_width, target_height),
            cancel,
        )?
    };
    let classification = coverage.classification;
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

    // Fixed-style Before/After previews share one value scale, and both are
    // rendered from the bounded target grids the review walk produced. The
    // initial review reflects the UI's default decision: add uncovered
    // coverage and preserve overlap.
    check_cancel(cancel)?;
    let preview_min = head
        .as_ref()
        .and_then(|row| row.min_value)
        .unwrap_or(coverage.preview_min)
        .min(coverage.preview_min);
    let preview_max = head
        .as_ref()
        .and_then(|row| row.max_value)
        .unwrap_or(coverage.preview_max)
        .max(coverage.preview_max)
        .max(preview_min + 1.0);
    let preview_ramp = ColorRamp::elevation_range(preview_min, preview_max);
    let preview_grid = preview_target_grid(&union, target_width, target_height);
    let before_preview_path = if head.is_some() {
        check_cancel(cancel)?;
        let preview_tif = preview_tif_from_values(
            engine,
            cancel,
            &job_dir,
            "before-head",
            &preview_grid,
            &layer_crs_wkt,
            layer_nodata,
            &coverage.before_values,
        )?;
        let target = job_dir.join("preview-before.png");
        let rendered = display::generate_preview(
            engine,
            cancel,
            &preview_tif,
            Some(layer_nodata),
            &preview_ramp,
            &target,
        );
        let _ = std::fs::remove_file(&preview_tif);
        rendered?;
        Some(target)
    } else {
        None
    };
    let after_preview_path = {
        check_cancel(cancel)?;
        let preview_tif = preview_tif_from_values(
            engine,
            cancel,
            &job_dir,
            "default",
            &preview_grid,
            &layer_crs_wkt,
            layer_nodata,
            &coverage.preview_values,
        )?;
        let target = job_dir.join("preview-after.png");
        let rendered = display::generate_preview(
            engine,
            cancel,
            &preview_tif,
            Some(layer_nodata),
            &preview_ramp,
            &target,
        );
        let _ = std::fs::remove_file(&preview_tif);
        rendered?;
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
        processing_cells: admitted_processing_cells,
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

/// Render the composition an Apply of this staging would publish.
///
/// The ordered model has no coverage decisions to preview: the selection is
/// always inserted above the accepted sources. The preview is therefore the
/// composed result itself, which is also what makes it the caller-level
/// detector for "the accepted head's own values" in the review regressions.
pub fn render_composition_preview(
    library: &LidarLibrary,
    staging: &StagedImport,
    cancel: &AtomicBool,
) -> Result<LidarImportDecisionPreview, String> {
    check_cancel(cancel)?;
    let engine = &library.inner.engine;
    let paths = &library.inner.paths;
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
    // The decision preview walks the same bounded blocks the review did, so a
    // sparsely covered layer costs what its data occupies.
    validate_lattice(&staging.union_grid, "import decision preview")?;
    let (target_width, target_height) = review_preview_target(&staging.union_grid)?;
    let coverage = {
        let head_source =
            HeadBlockSource::open(library, head.as_ref(), head_manifest.as_ref(), cancel)?;
        let lattice = head_manifest
            .as_ref()
            .map(|manifest| manifest.grid.clone())
            .unwrap_or_else(|| grid_for_source(compatible[0]));
        review_coverage(
            &head_source,
            &compatible,
            library,
            paths,
            &lattice,
            &staging.union_grid,
            staging.layer_nodata,
            (target_width, target_height),
            cancel,
        )?
    };
    let preview_min = head
        .as_ref()
        .and_then(|row| row.min_value)
        .unwrap_or(coverage.preview_min)
        .min(coverage.preview_min);
    let preview_max = head
        .as_ref()
        .and_then(|row| row.max_value)
        .unwrap_or(coverage.preview_max)
        .max(coverage.preview_max)
        .max(preview_min + 1.0);
    let ramp = ColorRamp::elevation_range(preview_min, preview_max);
    let decision_key = "composition".to_string();
    let job_dir = paths.job_dir(&staging.job_id);
    let preview_grid = preview_target_grid(&staging.union_grid, target_width, target_height);
    let before_preview_path = if head.is_some() {
        check_cancel(cancel)?;
        let head_tif = preview_tif_from_values(
            engine,
            cancel,
            &job_dir,
            &format!("before-{decision_key}"),
            &preview_grid,
            &staging.layer_crs_wkt,
            staging.layer_nodata,
            &coverage.before_values,
        )?;
        let target = job_dir.join(format!("preview-before-{decision_key}.png"));
        let rendered = display::generate_preview(
            engine,
            cancel,
            &head_tif,
            Some(staging.layer_nodata),
            &ramp,
            &target,
        );
        let _ = std::fs::remove_file(&head_tif);
        rendered?;
        Some(target.display().to_string())
    } else {
        None
    };
    let preview_tif = preview_tif_from_values(
        engine,
        cancel,
        &job_dir,
        &format!("decision-{decision_key}"),
        &preview_grid,
        &staging.layer_crs_wkt,
        staging.layer_nodata,
        &coverage.preview_values,
    )?;
    let after_target = job_dir.join(format!("preview-after-{decision_key}.png"));
    let rendered = display::generate_preview(
        engine,
        cancel,
        &preview_tif,
        Some(staging.layer_nodata),
        &ramp,
        &after_target,
    );
    let _ = std::fs::remove_file(&preview_tif);
    rendered?;
    // The ordered model records no coverage decision, so the preview reports
    // the composition it renders rather than echoing decisions that no longer
    // exist. Both flags stay in the wire contract at their historical values so
    // an older reader cannot mistake the payload for a changed decision.
    Ok(LidarImportDecisionPreview {
        add_uncovered: true,
        replace_overlap: false,
        before_preview_path,
        after_preview_path: after_target.display().to_string(),
    })
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

/// The lattice grid the current composition's coverage actually reaches.
///
/// The layer's manifest grid is its fixed coordinate anchor; its width and
/// height describe where coordinates start, not how far the accepted coverage
/// reaches. Admission is about the latter, so it is measured from the current
/// membership: each source's own interpretation grid, and each preserved
/// composition's signed extent. `Ok(None)` means the layer is still empty.
fn composition_extent_grid(
    library: &LidarLibrary,
    head: Option<&catalogue::GenerationRow>,
) -> Result<Option<RasterGrid>, String> {
    let Some(head) = head else {
        return Ok(None);
    };
    let connection = library.catalogue()?;
    let manifest = read_generation_manifest(&head.manifest_json)?;
    let mut extent: Option<RasterGrid> = None;
    if manifest.format.is_ordered_collection() {
        for member in catalogue::collection_members(&connection, &head.id)? {
            match member.kind.as_str() {
                collection::SOURCE_KIND => {
                    let Some(id) = member.interpretation_id.as_deref() else {
                        continue;
                    };
                    let Some(row) = catalogue::get_interpretation(&connection, id)? else {
                        continue;
                    };
                    let grid = RasterGrid {
                        width: u32::try_from(row.width.max(0)).unwrap_or(u32::MAX),
                        height: u32::try_from(row.height.max(0)).unwrap_or(u32::MAX),
                        geotransform: parse_geotransform(&row.geotransform)?,
                    };
                    extent = Some(match extent.take() {
                        Some(current) => union_grid(&current, &grid)?,
                        None => grid,
                    });
                }
                _ => {
                    let Some(base) = member.base_generation_id.as_deref() else {
                        continue;
                    };
                    if let Some(grid) = preserved_extent(&connection, base)? {
                        extent = Some(match extent.take() {
                            Some(current) => union_grid(&current, &grid)?,
                            None => grid,
                        });
                    }
                }
            }
        }
    } else if let Some(grid) = preserved_extent(&connection, &head.id)? {
        extent = Some(grid);
    }
    Ok(extent)
}

/// The grid a preserved generation's coverage reaches.
///
/// A sparse generation with published records reaches across exactly the signed
/// blocks they occupy; one without records, and every dense generation, is its
/// own manifest rectangle.
fn preserved_extent(
    connection: &rusqlite::Connection,
    generation_id: &str,
) -> Result<Option<RasterGrid>, String> {
    let Some(row) = catalogue::generation_row(connection, generation_id)? else {
        return Ok(None);
    };
    let manifest = read_generation_manifest(&row.manifest_json)?;
    if manifest.format == GenerationStorageFormat::CogChunksV1
        && let Some((first_x, first_y, last_x, last_y)) =
            catalogue::generation_chunk_extent(connection, generation_id, generation::RESULT_ROLE)?
    {
        return Ok(Some(collection::chunk_extent_grid(
            &manifest.grid,
            first_x,
            first_y,
            last_x,
            last_y,
        )?));
    }
    Ok(Some(manifest.grid))
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
    if cells > dense_working_limit() {
        return Err(format!(
            "{operation} requires {cells} cells; the current dense raster engine limit is {MAX_DENSE_WORKING_CELLS}"
        ));
    }
    Ok(())
}

/// The dense working-area ceiling in force for this call.
///
/// Production keeps the accepted limit. The representative large-fixture runs
/// this batch is authorized to attempt raise it for their own thread through
/// [`dense_working_probe`], so a 48M-cell batch or a million-pixel gap can be
/// exercised without exposing unsupported large dense jobs to users.
fn dense_working_limit() -> u64 {
    admission::limits().dense_envelope_cells
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
    layer_id: &str,
    measurement_kind: &str,
    units: &str,
    layer_grid: Option<&RasterGrid>,
    layer_crs_wkt: Option<&str>,
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

    // One retained controlled source COG carries this interpretation's numbers
    // from here on; the managed original is never loaded whole and no durable
    // raw/mask pair is written beside it.
    let source_grid = RasterGrid {
        width: probe.width,
        height: probe.height,
        geotransform: probe.geotransform,
    };
    // No dense working-area check here. This step never allocates the source's
    // grid: `gdal_translate` streams it into the retained COG and the facts and
    // regions are derived from that COG in bounded windows. The dense guard
    // belongs on the steps that really do allocate a whole area (raw
    // extraction, composition and legacy replay below), and the ordered path's
    // own bound is the admission processing budget, already applied at review
    // and rechecked at Apply. Applying a memory bound to a streamed conversion
    // is what previously refused a large single file that fits its disk
    // estimate comfortably — the exact case C1 exists to admit.
    validate_lattice(&source_grid, "source raster")?;
    let (source_cog, regions, valid_cells) = stage_source_samples(
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
    if !regions.is_empty() {
        let rows: Vec<(i64, i64, i64, f64, f64, f64)> = regions
            .iter()
            .map(|region| {
                (
                    region.block_x,
                    region.block_y,
                    region.valid_cells,
                    region.min_value,
                    region.max_value,
                    region.sum_value,
                )
            })
            .collect();
        catalogue::replace_interpretation_regions(
            &connection,
            &format!("interp-{interp_hash}"),
            &rows,
        )?;
    }
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
        job_id: Some(job_id.to_string()),
        source_cog: Some(source_cog),
        valid_mask_path: PathBuf::new(),
        raw_samples_path: PathBuf::new(),
        valid_cells: Some(valid_cells),
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
    cancel: &AtomicBool,
    input: &Path,
    grid: &RasterGrid,
    crs_wkt: &str,
    nodata: Option<f32>,
    job_dir: &Path,
    sha256: &str,
) -> Result<(RetainedSourceCog, Vec<generation::RegionAggregate>, u64), String> {
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
    // Facts and occupied regions are derived from the retained COG itself, in
    // bounded windows: no second durable payload is created to describe it.
    let mut reader = PreparedRaster::open_committed(&asset.path, grid, nodata)?;
    let (value_range, valid_cells) = scan_source_facts(&mut reader, cancel)?;
    let regions = generation::member_regions(&mut reader, grid, grid, cancel)?;
    drop(reader);
    Ok((
        RetainedSourceCog {
            sha256: asset.sha256,
            bytes: asset.bytes,
            nodata,
            value_range,
            relative_path: Some(relative_path),
        },
        regions,
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

/// Largest side of a review preview, matching the review surface's target.
const REVIEW_PREVIEW_MAX_SIDE: u32 = 512;

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

/// Both preview target dimensions: at most 512 each, aspect preserved.
fn review_preview_target(union: &RasterGrid) -> Result<(u32, u32), String> {
    validate_lattice(union, "preview target")?;
    let longest = union.width.max(union.height);
    if longest <= REVIEW_PREVIEW_MAX_SIDE {
        return Ok((union.width, union.height));
    }
    let scale = f64::from(REVIEW_PREVIEW_MAX_SIDE) / f64::from(longest);
    Ok((
        ((f64::from(union.width) * scale).round() as u32).clamp(1, REVIEW_PREVIEW_MAX_SIDE),
        ((f64::from(union.height) * scale).round() as u32).clamp(1, REVIEW_PREVIEW_MAX_SIDE),
    ))
}

/// The small grid a preview target raster is written on.
fn preview_target_grid(union: &RasterGrid, width: u32, height: u32) -> RasterGrid {
    RasterGrid {
        width,
        height,
        geotransform: [
            union.geotransform[0],
            union.geotransform[1] * f64::from(union.width) / f64::from(width),
            0.0,
            union.geotransform[3],
            0.0,
            union.geotransform[5] * f64::from(union.height) / f64::from(height),
        ],
    }
}

// ---------------------------------------------------------------------------
// Bounded review: block-wise composed coverage
// ---------------------------------------------------------------------------

/// The accepted head's numeric coverage, readable one bounded block at a time.
enum HeadBlockSource {
    /// No accepted generation yet.
    None,
    /// Preserved dense mosaic. A dense generation only exists inside the dense
    /// working ceiling, so its whole numeric pair is bounded and is read once.
    Dense {
        values: Vec<f32>,
        valid: ValidMask,
        manifest_grid: RasterGrid,
    },
    /// A generation-owned numeric store read through its format's resolver.
    ///
    /// Published resolved chunks come from the paged chunk reader; an ordered
    /// collection resolves its source COGs on demand. Either way the reader is
    /// bound to the immutable generation, and the reference lattice comes from
    /// the review caller.
    Reader { owner: generation::GenerationReader },
}

impl HeadBlockSource {
    fn open(
        library: &LidarLibrary,
        head: Option<&catalogue::GenerationRow>,
        manifest: Option<&GenerationManifest>,
        cancel: &AtomicBool,
    ) -> Result<Self, String> {
        let engine = &library.inner.engine;
        let (Some(head), Some(manifest)) = (head, manifest) else {
            return Ok(Self::None);
        };
        match manifest.format {
            GenerationStorageFormat::CogChunksV1 => Ok(Self::Reader {
                owner: generation::GenerationReader::Chunks(
                    generation::GenerationChunkReader::new(&head.id, generation::RESULT_ROLE),
                ),
            }),
            GenerationStorageFormat::OrderedMembersV1 => {
                let Some(collection) =
                    collection::load_reader(library, &head.id, manifest, cancel)?
                else {
                    return Err(
                        "accepted collection is missing a source payload; the layer cannot be \
                         read without inventing coverage"
                            .to_string(),
                    );
                };
                Ok(Self::Reader {
                    owner: generation::GenerationReader::Collection(Box::new(collection)),
                })
            }
            GenerationStorageFormat::LegacyDenseV1 => {
                let (Some(mosaic_path), Some(mask_path)) = (
                    head.mosaic_path.as_deref(),
                    head.coverage_mask_path.as_deref(),
                ) else {
                    return Err("accepted generation has no dense raster".to_string());
                };
                let raw = raw_f32_bytes(
                    engine,
                    Path::new(mosaic_path),
                    manifest.grid.width,
                    manifest.grid.height,
                    cancel,
                )?;
                let values = f32_values(&raw);
                let valid = ValidMask::read_from(
                    Path::new(mask_path),
                    manifest.grid.width,
                    manifest.grid.height,
                )?;
                Ok(Self::Dense {
                    values,
                    valid,
                    manifest_grid: manifest.grid.clone(),
                })
            }
        }
    }

    /// Accepted values and validity for one union block.
    ///
    /// Cells the head does not cover stay invalid and carry `nodata`.
    /// The occupied lattice blocks this head stores, as an ordered stream.
    fn block_stream(&self, lattice: &RasterGrid) -> BlockStream {
        match self {
            Self::None => BlockStream::Empty,
            // Published chunk coordinates are already lattice block coordinates.
            Self::Reader { owner, .. } => BlockStream::occupied(owner.clone()),
            // A dense or opaque head has no occupied index, so its own stored
            // extent supplies the candidates.
            Self::Dense { manifest_grid, .. } => {
                BlockStream::extent(lattice_block_range(lattice, manifest_grid))
            }
        }
    }

    fn block(
        &self,
        library: &LidarLibrary,
        lattice: &RasterGrid,
        window: LatticeWindow,
        nodata: f32,
        cancel: &AtomicBool,
    ) -> Result<(Vec<f32>, Vec<u8>), String> {
        let cells = usize::try_from(u64::from(window.width) * u64::from(window.height))
            .map_err(|_| "review block is too large for this platform".to_string())?;
        let mut values = vec![nodata; cells];
        let mut valid = vec![0u8; cells];
        match self {
            Self::None => {}
            Self::Reader { owner, .. } => {
                let resolved = owner.read_window(library, lattice, window, cancel)?;
                for index in 0..cells {
                    if resolved.valid[index] == 0 {
                        continue;
                    }
                    values[index] = resolved.samples[index];
                    valid[index] = 1;
                }
            }
            Self::Dense {
                values: mosaic,
                valid: mask,
                manifest_grid,
            } => {
                let offset_x = ((manifest_grid.geotransform[0] - lattice.geotransform[0])
                    / lattice.geotransform[1])
                    .round() as i64;
                let offset_y = ((lattice.geotransform[3] - manifest_grid.geotransform[3])
                    / manifest_grid.geotransform[5].abs())
                .round() as i64;
                let width = window.width as usize;
                for row in 0..window.height as i64 {
                    let my = window.y + row - offset_y;
                    if my < 0 || my >= i64::from(manifest_grid.height) {
                        continue;
                    }
                    for column in 0..window.width as i64 {
                        let mx = window.x + column - offset_x;
                        if mx < 0 || mx >= i64::from(manifest_grid.width) {
                            continue;
                        }
                        if !mask.get(mx as u32, my as u32) {
                            continue;
                        }
                        let source = my as usize * manifest_grid.width as usize + mx as usize;
                        let target = row as usize * width + column as usize;
                        values[target] = mosaic[source];
                        valid[target] = 1;
                    }
                }
            }
        }
        Ok((values, valid))
    }
}

/// One composed union block with the incoming validity that produced it.
struct ComposedBlock {
    values: Vec<f32>,
    valid: Vec<u8>,
    /// Union of the incoming sources' validity in this block, before the
    /// accepted roles are applied: the review counts this once per cell.
    incoming: Vec<u8>,
}

/// Open readers reused across one bounded walk, keyed by source digest.
///
/// Opening a retained COG validates its layout but prepares nothing and charges
/// nothing, so one open per source serves a whole review walk.
#[derive(Default)]
struct SourceReaders {
    open: std::collections::HashMap<String, PreparedRaster>,
}

impl SourceReaders {
    fn release(&mut self) {
        self.open.clear();
    }
}

/// Read one incoming source window.
///
/// A source with a retained COG reads through the production reader, so its
/// validity is the source's own effective NoData rule; a staged job written
/// before retention still reads its disposable raw/mask scratch.
fn read_source_window(
    source: &StagedSource,
    paths: &LidarPaths,
    readers: &mut SourceReaders,
    window: RasterWindow,
    cancel: &AtomicBool,
) -> Result<(Vec<f32>, Vec<u8>), String> {
    let grid = grid_for_source(source);
    let job_id = source.job_id.as_deref();
    let Some(cog) = source.source_cog.as_ref() else {
        return generation::read_legacy_window(
            &source.raw_samples_path,
            &source.valid_mask_path,
            &grid,
            window,
            cancel,
        );
    };
    if !readers.open.contains_key(&cog.sha256) {
        readers
            .open
            .insert(cog.sha256.clone(), cog.open(paths, job_id, &grid)?);
    }
    let reader = readers
        .open
        .get_mut(&cog.sha256)
        .ok_or_else(|| "source reader cache lost its entry".to_string())?;
    let read = reader.read_window(window, cancel)?;
    Ok((read.samples().to_vec(), read.valid().to_vec()))
}

/// Read a whole incoming source payload for the preserved dense composition.
///
/// That branch is source-sized by design; a retained COG is scanned in bounded
/// windows into its buffer, while a pre-retention staged job reads its raw/mask
/// scratch directly.
fn read_source_payload(
    source: &StagedSource,
    paths: &LidarPaths,
    cancel: &AtomicBool,
) -> Result<(Vec<f32>, Vec<u8>), String> {
    let grid = grid_for_source(source);
    match source.source_cog.as_ref() {
        Some(cog) => read_cog_payload(cog, paths, source.job_id.as_deref(), &grid, cancel),
        None => {
            let raw = std::fs::read(&source.raw_samples_path)
                .map_err(|e| format!("Failed to read staged samples: {e}"))?;
            validate_f32_raw(&raw, source.width, source.height)?;
            let valid = ValidMask::read_from(&source.valid_mask_path, source.width, source.height)?;
            Ok((f32_values(&raw), valid.bytes().to_vec()))
        }
    }
}

/// Read one whole retained COG payload in bounded windows.
///
/// The values are the source's own numbers with its effective NoData rule
/// already applied to the returned validity, so no caller needs a second
/// sentinel convention.
fn read_cog_payload(
    cog: &RetainedSourceCog,
    paths: &LidarPaths,
    job_id: Option<&str>,
    grid: &RasterGrid,
    cancel: &AtomicBool,
) -> Result<(Vec<f32>, Vec<u8>), String> {
    let cells = usize::try_from(u64::from(grid.width) * u64::from(grid.height))
        .map_err(|_| "source raster is too large for this platform".to_string())?;
    let mut values = vec![0f32; cells];
    let mut valid = vec![0u8; cells];
    let mut reader = cog.open(paths, job_id, grid)?;
    reader.scan(cancel, |window, samples, window_valid| {
        for row in 0..window.height {
            let start = row as usize * window.width as usize;
            let target = (window.y + row) as usize * grid.width as usize + window.x as usize;
            let width = window.width as usize;
            values[target..target + width].copy_from_slice(&samples[start..start + width]);
            valid[target..target + width].copy_from_slice(&window_valid[start..start + width]);
        }
        Ok(())
    })?;
    Ok((values, valid))
}

/// Compose one bounded union block from the accepted head and the incoming
/// sources, applying the accepted roles.
///
/// The block is the unit of work: nothing here is sized by the union, so a
/// review costs what its data occupies rather than what its envelope spans.
#[allow(clippy::too_many_arguments)]
fn compose_union_block(
    head: &HeadBlockSource,
    sources: &[&StagedSource],
    readers: &mut SourceReaders,
    library: &LidarLibrary,
    paths: &LidarPaths,
    lattice: &RasterGrid,
    window: LatticeWindow,
    nodata: f32,
    cancel: &AtomicBool,
) -> Result<ComposedBlock, String> {
    let width = window.width as usize;
    let (mut values, mut valid) = head.block(library, lattice, window, nodata, cancel)?;
    let mut incoming = vec![0u8; values.len()];
    for source in sources {
        let window_in_source = source_window(source, lattice, window)?;
        if window_in_source.width == 0 || window_in_source.height == 0 {
            continue;
        }
        let (source_values, source_valid) =
            read_source_window(source, paths, readers, window_in_source, cancel)?;
        let offset_x = ((source.geotransform[0] - lattice.geotransform[0])
            / lattice.geotransform[1])
            .round() as i64;
        let offset_y = ((lattice.geotransform[3] - source.geotransform[3])
            / source.geotransform[5].abs())
        .round() as i64;
        let dest_x = (i64::from(window_in_source.x) + offset_x - window.x) as usize;
        let dest_y = (i64::from(window_in_source.y) + offset_y - window.y) as usize;
        for row in 0..window_in_source.height as usize {
            check_optional_cancel(Some(cancel), row as u32)?;
            for column in 0..window_in_source.width as usize {
                let index = row * window_in_source.width as usize + column;
                if source_valid[index] == 0 {
                    continue;
                }
                let target = (dest_y + row) * width + dest_x + column;
                incoming[target] = 1;
                // The ordered model has exactly one composition rule: the
                // selection is inserted above the accepted sources, so a valid
                // incoming sample wins and an invalid one reveals what is
                // below. `incoming` still records every valid incoming cell so
                // the caller can classify it against the accepted head, but the
                // classification never changes the composed value.
                values[target] = source_values[index];
                valid[target] = 1;
            }
        }
    }
    Ok(ComposedBlock {
        values,
        valid,
        incoming,
    })
}

/// A source's window that intersects one union block.
fn source_window(
    source: &StagedSource,
    union: &RasterGrid,
    window: LatticeWindow,
) -> Result<RasterWindow, String> {
    let offset_x =
        ((source.geotransform[0] - union.geotransform[0]) / union.geotransform[1]).round() as i64;
    let offset_y = ((union.geotransform[3] - source.geotransform[3]) / union.geotransform[5].abs())
        .round() as i64;
    let x0 = (window.x - offset_x).max(0);
    let y0 = (window.y - offset_y).max(0);
    let x1 = (window.x + i64::from(window.width) - offset_x).min(i64::from(source.width));
    let y1 = (window.y + i64::from(window.height) - offset_y).min(i64::from(source.height));
    Ok(RasterWindow {
        x: x0 as u32,
        y: y0 as u32,
        width: (x1 - x0).max(0) as u32,
        height: (y1 - y0).max(0) as u32,
    })
}

// ---------------------------------------------------------------------------
// BG6: occupied-region review traversal
// ---------------------------------------------------------------------------

/// Test-only observation of the work a review traversal actually performs.
///
/// A caller-level test reads this instead of testing the traversal in
/// isolation, so a regression that walks the envelope again is visible from the
/// real staging/review path.
pub(crate) mod review_probe {
    use std::cell::Cell;

    thread_local! {
        static BLOCKS: Cell<u64> = const { Cell::new(0) };
        static PAGES: Cell<u64> = const { Cell::new(0) };
    }

    #[cfg(test)]
    pub(crate) fn reset() {
        BLOCKS.with(|value| value.set(0));
        PAGES.with(|value| value.set(0));
    }

    #[cfg(test)]
    pub(crate) fn blocks() -> u64 {
        BLOCKS.with(Cell::get)
    }

    #[cfg(test)]
    pub(crate) fn pages() -> u64 {
        PAGES.with(Cell::get)
    }

    #[cfg(test)]
    pub(crate) fn note_block() {
        BLOCKS.with(|value| value.set(value.get() + 1));
    }

    #[cfg(test)]
    pub(crate) fn note_page() {
        PAGES.with(|value| value.set(value.get() + 1));
    }
}

/// One bounded page of occupied coordinates, the existing 256-record policy.
const REVIEW_PAGE_MAX: usize = generation::CHUNK_PAGE_MAX;

/// The lattice blocks one stored extent covers.
fn lattice_block_range(lattice: &RasterGrid, grid: &RasterGrid) -> (i64, i64, i64, i64) {
    let origin_x =
        ((grid.geotransform[0] - lattice.geotransform[0]) / lattice.geotransform[1]).round() as i64;
    let origin_y = ((lattice.geotransform[3] - grid.geotransform[3])
        / lattice.geotransform[5].abs())
    .round() as i64;
    let first_x = origin_x.div_euclid(generation::CHUNK_SIDE);
    let first_y = origin_y.div_euclid(generation::CHUNK_SIDE);
    let last_x = (origin_x + i64::from(grid.width) - 1).div_euclid(generation::CHUNK_SIDE);
    let last_y = (origin_y + i64::from(grid.height) - 1).div_euclid(generation::CHUNK_SIDE);
    (first_x, first_y, last_x - first_x + 1, last_y - first_y + 1)
}

/// The full lattice window of one occupied block.
fn block_window(block: (i64, i64)) -> LatticeWindow {
    let side = generation::CHUNK_SIDE;
    LatticeWindow {
        x: block.1 * side,
        y: block.0 * side,
        width: side as u32,
        height: side as u32,
    }
}

/// One ordered stream of occupied lattice blocks, in `(block_y, block_x)` order.
///
/// Every stream is either paged from the catalogue or generated lazily from an
/// extent, so a stream holds at most one page of coordinates and never the
/// generation's or a source's whole occupied index.
enum BlockStream {
    /// A sparse generation's published records, paged by keyset.
    Chunks {
        owner: generation::GenerationChunkReader,
        page: Vec<(i64, i64)>,
        index: usize,
        cursor: Option<(i64, i64)>,
        done: bool,
    },
    /// One source's occupied regions, read once and expanded as up to four
    /// monotone translated streams.
    ///
    /// A source block covers 1024 source cells; when the source origin is not
    /// lattice-aligned its lattice footprint starts mid-block, so the same
    /// ordered index is walked under a constant translation per quadrant. A
    /// constant translation preserves the index order, so every translated
    /// stream is monotone and the merge needs no page-sized buffer and no
    /// discard rule.
    Regions {
        interpretation_id: String,
        streams: Vec<RegionStream>,
        /// The coordinate this stream currently offers, cached so the merge can
        /// advance exactly the sub-streams that produced it.
        current: Option<(i64, i64)>,
    },
    /// An ordered collection's occupied blocks, derived arithmetically from
    /// member extents.
    ///
    /// The block set is coordinates only: computing it opens no raster and
    /// holds no samples, and it is exact rather than a bounding envelope, so
    /// the empty gap between separated sources contributes nothing.
    Occupied {
        chunks: Vec<(i64, i64)>,
        index: usize,
    },
    /// Every block of one object's own stored extent, generated lazily.
    Extent {
        first_x: i64,
        first_y: i64,
        blocks_x: i64,
        blocks_y: i64,
        next: i64,
    },
    /// The stream cannot be built at all; the review reports it by name.
    Invalid { error: String },
    /// Nothing to visit.
    Empty,
}

impl BlockStream {
    /// The occupied blocks of one generation, in its own storage terms.
    fn occupied(owner: generation::GenerationReader) -> Self {
        match owner {
            generation::GenerationReader::Chunks(owner) => Self::Chunks {
                owner,
                page: Vec::new(),
                index: 0,
                cursor: None,
                done: false,
            },
            generation::GenerationReader::Collection(collection) => {
                match collection.occupied_chunks() {
                    Ok(chunks) => Self::Occupied { chunks, index: 0 },
                    // A member whose grid cannot be placed on the lattice is a
                    // publication defect, not something a review can skip: it
                    // would silently under-report accepted coverage.
                    Err(error) => Self::Invalid { error },
                }
            }
        }
    }

    /// Up to four constant-translated streams over one source's region index.
    ///
    /// The source-to-lattice cell offset is decomposed by Euclidean division:
    /// `offset = q * 1024 + r` with `0 <= r < 1024`. A source block then maps to
    /// lattice blocks `q + {0}` when `r == 0`, otherwise `q + {0, 1}` on that
    /// axis, for both axes independently.
    fn regions(interpretation_id: String, offset_x: i64, offset_y: i64) -> Self {
        let qx = offset_x.div_euclid(generation::CHUNK_SIDE);
        let qy = offset_y.div_euclid(generation::CHUNK_SIDE);
        let rx = offset_x.rem_euclid(generation::CHUNK_SIDE);
        let ry = offset_y.rem_euclid(generation::CHUNK_SIDE);
        let dxs: &[i64] = if rx == 0 { &[0] } else { &[0, 1] };
        let dys: &[i64] = if ry == 0 { &[0] } else { &[0, 1] };
        let mut streams = Vec::with_capacity(dxs.len() * dys.len());
        for dy in dys {
            for dx in dxs {
                streams.push(RegionStream::new(qx + dx, qy + dy));
            }
        }
        Self::Regions {
            interpretation_id,
            streams,
            current: None,
        }
    }

    fn extent(range: (i64, i64, i64, i64)) -> Self {
        if range.2 <= 0 || range.3 <= 0 {
            return Self::Empty;
        }
        Self::Extent {
            first_x: range.0,
            first_y: range.1,
            blocks_x: range.2,
            blocks_y: range.3,
            next: 0,
        }
    }

    /// The next coordinate this stream will emit, refilling one page if needed.
    fn peek(
        &mut self,
        library: &LidarLibrary,
        cancel: &AtomicBool,
    ) -> Result<Option<(i64, i64)>, String> {
        loop {
            match self {
                Self::Empty => return Ok(None),
                Self::Extent {
                    first_x,
                    first_y,
                    blocks_x,
                    blocks_y,
                    next,
                } => {
                    if *next >= *blocks_x * *blocks_y {
                        return Ok(None);
                    }
                    return Ok(Some((
                        *first_y + *next / *blocks_x,
                        *first_x + *next % *blocks_x,
                    )));
                }
                Self::Chunks {
                    owner,
                    page,
                    index,
                    cursor,
                    done,
                } => {
                    if *index < page.len() {
                        return Ok(Some(page[*index]));
                    }
                    if *done {
                        return Ok(None);
                    }
                    check_cancel(cancel)?;
                    let fetched = owner.page(library, None, *cursor)?;
                    #[cfg(test)]
                    #[cfg(test)]
                    review_probe::note_page();
                    *done = fetched.len() < REVIEW_PAGE_MAX;
                    *cursor = fetched.last().map(|chunk| (chunk.chunk_y, chunk.chunk_x));
                    *page = fetched
                        .iter()
                        .map(|chunk| (chunk.chunk_y, chunk.chunk_x))
                        .collect();
                    page.dedup();
                    *index = 0;
                    if page.is_empty() {
                        return Ok(None);
                    }
                    continue;
                }
                Self::Occupied { chunks, index } => return Ok(chunks.get(*index).copied()),
                Self::Invalid { error } => return Err(error.clone()),
                Self::Regions {
                    interpretation_id,
                    streams,
                    current,
                } => {
                    if let Some(coord) = *current {
                        return Ok(Some(coord));
                    }
                    // Four constant translations of one ordered index: the
                    // merge offers their minimum and, on advance, steps every
                    // sub-stream that offered it. Each sub-stream refills at
                    // most one bounded page, so a source costs at most four
                    // live pages.
                    let mut best: Option<(i64, i64)> = None;
                    for stream in streams.iter_mut() {
                        check_cancel(cancel)?;
                        if let Some(coord) = stream.peek(library, interpretation_id)?
                            && best.is_none_or(|current| coord < current)
                        {
                            best = Some(coord);
                        }
                    }
                    *current = best;
                    return Ok(best);
                }
            }
        }
    }

    /// Step past the coordinate this stream last offered.
    ///
    /// The merge only advances a stream that currently holds the smallest
    /// coordinate, so a region stream steps exactly the sub-streams that
    /// produced it and keeps its offered coordinate cached for the next call.
    fn advance(&mut self, library: &LidarLibrary) -> Result<(), String> {
        match self {
            Self::Empty => {}
            Self::Extent { next, .. } => *next += 1,
            Self::Chunks { index, .. } => *index += 1,
            Self::Occupied { index, .. } => *index += 1,
            Self::Invalid { .. } => {}
            Self::Regions {
                interpretation_id,
                streams,
                current,
            } => {
                let Some(coord) = current.take() else {
                    return Ok(());
                };
                for stream in streams.iter_mut() {
                    if stream.peek(library, interpretation_id)? == Some(coord) {
                        stream.advance();
                    }
                }
            }
        }
        Ok(())
    }
}

/// One constant-translated view of a source's occupied-region index.
struct RegionStream {
    /// Lattice-block translation for this quadrant.
    dx: i64,
    dy: i64,
    page: Vec<(i64, i64)>,
    index: usize,
    /// Keyset cursor in the source's own block coordinates.
    cursor: Option<(i64, i64)>,
    exhausted: bool,
}

impl RegionStream {
    fn new(dx: i64, dy: i64) -> Self {
        Self {
            dx,
            dy,
            page: Vec::new(),
            index: 0,
            cursor: None,
            exhausted: false,
        }
    }

    /// The next lattice block this stream will emit, refilling one bounded page
    /// when the current one is spent.
    fn peek(
        &mut self,
        library: &LidarLibrary,
        interpretation_id: &str,
    ) -> Result<Option<(i64, i64)>, String> {
        loop {
            if self.index < self.page.len() {
                return Ok(Some(self.page[self.index]));
            }
            if self.exhausted {
                return Ok(None);
            }
            let rows = {
                let connection = library.catalogue()?;
                catalogue::interpretation_region_keyset_page(
                    &connection,
                    interpretation_id,
                    self.cursor,
                    REVIEW_PAGE_MAX,
                )?
            };
            #[cfg(test)]
            review_probe::note_page();
            self.exhausted = rows.len() < REVIEW_PAGE_MAX;
            self.cursor = rows.last().map(|row| (row.1, row.0));
            self.page.clear();
            self.page.reserve(rows.len());
            for (block_x, block_y, _, _, _, _) in &rows {
                // Checked signed arithmetic: a source or journal coordinate that
                // cannot be translated is an error, never a wrapped block.
                let y = block_y
                    .checked_add(self.dy)
                    .ok_or_else(|| "occupied region coordinate overflows".to_string())?;
                let x = block_x
                    .checked_add(self.dx)
                    .ok_or_else(|| "occupied region coordinate overflows".to_string())?;
                self.page.push((y, x));
            }
            self.index = 0;
            // An empty page is not EOF unless the index itself is exhausted.
            if self.page.is_empty() && self.exhausted {
                return Ok(None);
            }
        }
    }

    fn advance(&mut self) {
        self.index += 1;
    }
}

/// The merged, deduplicated stream of occupied lattice blocks a review visits.
///
/// The head and every selected source contribute one ordered stream; the merge
/// keeps exactly one coordinate per stream, so live storage is bounded by the
/// number of selected files and one page, never by the envelope's area.
struct ReviewTraversal {
    streams: Vec<BlockStream>,
    last: Option<(i64, i64)>,
}

impl ReviewTraversal {
    fn open(
        head: &HeadBlockSource,
        sources: &[&StagedSource],
        lattice: &RasterGrid,
        library: &LidarLibrary,
    ) -> Result<Self, String> {
        let mut streams = vec![head.block_stream(lattice)];
        {
            let connection = library.catalogue()?;
            for source in sources {
                streams.push(source_block_stream(source, lattice, &connection)?);
            }
        }
        Ok(Self {
            streams,
            last: None,
        })
    }

    /// The next occupied lattice block, or `None` when every stream is done.
    fn next_block(
        &mut self,
        library: &LidarLibrary,
        cancel: &AtomicBool,
    ) -> Result<Option<(i64, i64)>, String> {
        loop {
            check_cancel(cancel)?;
            let mut best: Option<(i64, i64)> = None;
            for stream in &mut self.streams {
                if let Some(coord) = stream.peek(library, cancel)?
                    && best.is_none_or(|current| coord < current)
                {
                    best = Some(coord);
                }
            }
            let Some(coord) = best else {
                return Ok(None);
            };
            // Every stream sitting on this coordinate advances past it, so a
            // coordinate occupied by several members is visited once.
            for stream in &mut self.streams {
                if stream.peek(library, cancel)? == Some(coord) {
                    stream.advance(library)?;
                }
            }
            if self.last == Some(coord) {
                continue;
            }
            self.last = Some(coord);
            #[cfg(test)]
            review_probe::note_block();
            return Ok(Some(coord));
        }
    }
}

/// The occupied blocks of one staged source.
///
/// A source staged with retained facts has an occupied-region index; one staged
/// before that index existed is scanned over its own stored extent instead.
/// Neither path walks the joined envelope.
fn source_block_stream(
    source: &StagedSource,
    lattice: &RasterGrid,
    connection: &rusqlite::Connection,
) -> Result<BlockStream, String> {
    let interpretation_id = format!("interp-{}", source.interp_hash);
    if catalogue::interpretation_has_regions(connection, &interpretation_id)? {
        let offset_x = ((source.geotransform[0] - lattice.geotransform[0])
            / lattice.geotransform[1])
            .round() as i64;
        let offset_y = ((lattice.geotransform[3] - source.geotransform[3])
            / lattice.geotransform[5].abs())
        .round() as i64;
        return Ok(BlockStream::regions(interpretation_id, offset_x, offset_y));
    }
    let grid = grid_for_source(source);
    Ok(BlockStream::extent(lattice_block_range(lattice, &grid)))
}

/// Counts and preview samples accumulated over the union's blocks.
struct ReviewCoverage {
    classification: CoverageClassification,
    /// Target-sized composed values for the after preview; invalid cells keep
    /// the layer NoData marker.
    preview_values: Vec<f32>,
    preview_min: f64,
    preview_max: f64,
    /// Target-sized accepted values for the before preview.
    before_values: Vec<f32>,
}

/// Walk the occupied lattice blocks once, composing each for the counts and
/// both previews.
///
/// The traversal is driven by the incoming sources' occupied regions and the
/// accepted head's own occupied records, merged in `(block_y, block_x)` order
/// and deduplicated, so neither its work nor its metadata depends on the empty
/// gap inside the union envelope. Coordinates are fixed-lattice cells; they are
/// translated to envelope coordinates only when the previews are sampled.
#[allow(clippy::too_many_arguments)]
fn review_coverage(
    head: &HeadBlockSource,
    sources: &[&StagedSource],
    library: &LidarLibrary,
    paths: &LidarPaths,
    lattice: &RasterGrid,
    union: &RasterGrid,
    nodata: f32,
    target: (u32, u32),
    cancel: &AtomicBool,
) -> Result<ReviewCoverage, String> {
    let cells = u64::from(union.width) * u64::from(union.height);
    let (target_width, target_height) = target;
    let target_cells = usize::try_from(u64::from(target_width) * u64::from(target_height))
        .map_err(|_| "preview target is too large for this platform".to_string())?;
    let mut preview_values = vec![nodata; target_cells];
    let mut before_values = vec![nodata; target_cells];
    let mut uncovered_cells = 0u64;
    let mut overlap_cells = 0u64;
    let mut incoming_cells = 0u64;
    let (mut preview_min, mut preview_max) = (f64::INFINITY, f64::NEG_INFINITY);
    // Lattice cell to envelope cell, used only for the preview targets.
    let union_offset_x =
        ((lattice.geotransform[0] - union.geotransform[0]) / union.geotransform[1]).round() as i64;
    let union_offset_y = ((union.geotransform[3] - lattice.geotransform[3])
        / lattice.geotransform[5].abs())
    .round() as i64;
    let union_width = i64::from(union.width);
    let union_height = i64::from(union.height);
    let mut traversal = ReviewTraversal::open(head, sources, lattice, library)?;
    let mut readers = SourceReaders::default();
    while let Some(block) = traversal.next_block(library, cancel)? {
        check_cancel(cancel)?;
        let window = block_window(block);
        let composed = compose_union_block(
            head,
            sources,
            &mut readers,
            library,
            paths,
            lattice,
            window,
            nodata,
            cancel,
        )?;
        let (accepted_values, accepted) = head.block(library, lattice, window, nodata, cancel)?;
        let width = window.width as usize;
        for row in 0..window.height as usize {
            for column in 0..width {
                let index = row * width + column;
                if composed.incoming[index] == 0 {
                    continue;
                }
                incoming_cells += 1;
                if accepted[index] == 0 {
                    uncovered_cells += 1;
                } else {
                    overlap_cells += 1;
                }
            }
        }
        // Reduce this block into both preview targets: After is the composed
        // selection, Before is the accepted head's own values.
        for row in 0..window.height {
            for column in 0..window.width {
                let index = row as usize * width + column as usize;
                let union_x = window.x + i64::from(column) + union_offset_x;
                let union_y = window.y + i64::from(row) + union_offset_y;
                if union_x < 0 || union_y < 0 || union_x >= union_width || union_y >= union_height {
                    continue;
                }
                let tx = (union_x as u64 * u64::from(target_width) / u64::from(union.width))
                    .min(u64::from(target_width) - 1) as u32;
                let ty = (union_y as u64 * u64::from(target_height) / u64::from(union.height))
                    .min(u64::from(target_height) - 1) as u32;
                let target_index = ty as usize * target_width as usize + tx as usize;
                if composed.valid[index] != 0 {
                    preview_values[target_index] = composed.values[index];
                    if composed.values[index].is_finite() {
                        preview_min = preview_min.min(f64::from(composed.values[index]));
                        preview_max = preview_max.max(f64::from(composed.values[index]));
                    }
                }
                if accepted[index] != 0 {
                    before_values[target_index] = accepted_values[index];
                }
            }
        }
    }
    readers.release();
    if !preview_min.is_finite() {
        preview_min = 0.0;
        preview_max = 0.0;
    }
    Ok(ReviewCoverage {
        classification: CoverageClassification {
            uncovered_cells,
            overlap_cells,
            // The checked envelope minus the unique incoming valid cells,
            // computed arithmetically: the gap is never visited.
            invalid_cells: cells.saturating_sub(incoming_cells),
        },
        preview_values,
        preview_min,
        preview_max,
        before_values,
    })
}

/// Decode little-endian Float32 bytes.
fn f32_values(raw: &[u8]) -> Vec<f32> {
    raw.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
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
    paths: &LidarPaths,
    union: &RasterGrid,
    nodata: f32,
    add_uncovered: bool,
    replace_overlap: bool,
    cancel: &AtomicBool,
) -> Result<ComposedMosaic, String> {
    validate_working_grid(union, "raster composition")?;
    let mut values = vec![nodata; (union.width as usize) * (union.height as usize)];
    let mut valid = ValidMask::empty(union.width, union.height);
    if let Some(layer_mask) = layer_on_union {
        for y in 0..union.height {
            check_cancel(cancel)?;
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
        // A retained source reads through its own COG; only a staged job
        // written before retention still reads disposable raw/mask scratch.
        let (source_values, source_valid) = read_source_payload(source, paths, cancel)?;
        let offset_x = ((source.geotransform[0] - union.geotransform[0]) / union.geotransform[1])
            .round() as i64;
        let offset_y = ((union.geotransform[3] - source.geotransform[3])
            / union.geotransform[5].abs())
        .round() as i64;
        for y in 0..source.height {
            check_cancel(cancel)?;
            let ty = offset_y + y as i64;
            if ty < 0 || ty >= union.height as i64 {
                continue;
            }
            for x in 0..source.width {
                let tx = offset_x + x as i64;
                if tx < 0 || tx >= union.width as i64 {
                    continue;
                }
                let index = (y * source.width + x) as usize;
                if source_valid[index] == 0 {
                    continue;
                }
                let covered = valid.get(tx as u32, ty as u32);
                let paint = if covered {
                    replace_overlap
                } else {
                    add_uncovered
                };
                if paint {
                    let sample = source_values[index];
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
    pub payload: MemberPayload,
}

/// Durable payload one dense replay member's samples come from.
///
/// A member published with source retention reads its own content-addressed
/// COG; only history written before retention still reads a raw/mask pair.
#[derive(Debug, Clone)]
pub enum MemberPayload {
    Cog {
        /// Readable path: a published member's global asset, or the owning
        /// job's local file while the member is still unpublished.
        path: PathBuf,
        /// Effective NoData rule of this member's own samples.
        nodata: Option<f32>,
    },
    LegacyDense {
        raw_samples_path: PathBuf,
        valid_mask_path: PathBuf,
    },
}

/// The durable payload one staged source publishes.
///
/// A retained source COG is already the durable payload; a staged job written
/// before retention carries its disposable raw/mask pair instead.
fn member_payload_of(source: &StagedSource, paths: &LidarPaths) -> Result<MemberPayload, String> {
    match source.source_cog.as_ref() {
        // The job-local file is read where it lives until the publication
        // commits its promoted reference.
        Some(cog) => Ok(MemberPayload::Cog {
            path: cog.resolve(paths, source.job_id.as_deref())?,
            nodata: cog.nodata,
        }),
        None => Ok(MemberPayload::LegacyDense {
            raw_samples_path: source.raw_samples_path.clone(),
            valid_mask_path: source.valid_mask_path.clone(),
        }),
    }
}

impl MemberPayload {
    /// Read this member's whole payload: the dense route is source-sized by
    /// design, and a retained COG still reads in bounded windows.
    fn read(&self, grid: &RasterGrid, cancel: &AtomicBool) -> Result<(Vec<f32>, Vec<u8>), String> {
        match self {
            Self::Cog { path, nodata } => {
                let mut reader = PreparedRaster::open_committed(path, grid, *nodata)?;
                let cells = usize::try_from(u64::from(grid.width) * u64::from(grid.height))
                    .map_err(|_| "member raster is too large for this platform".to_string())?;
                let mut values = vec![0f32; cells];
                let mut valid = vec![0u8; cells];
                reader.scan(cancel, |window, samples, window_valid| {
                    for row in 0..window.height {
                        let start = row as usize * window.width as usize;
                        let target =
                            (window.y + row) as usize * grid.width as usize + window.x as usize;
                        let width = window.width as usize;
                        values[target..target + width]
                            .copy_from_slice(&samples[start..start + width]);
                        valid[target..target + width]
                            .copy_from_slice(&window_valid[start..start + width]);
                    }
                    Ok(())
                })?;
                Ok((values, valid))
            }
            Self::LegacyDense {
                raw_samples_path,
                valid_mask_path,
            } => {
                let raw = std::fs::read(raw_samples_path)
                    .map_err(|e| format!("Failed to read member samples: {e}"))?;
                validate_f32_raw(&raw, grid.width, grid.height)?;
                let mask = ValidMask::read_from(valid_mask_path, grid.width, grid.height)?;
                Ok((f32_values(&raw), mask.bytes().to_vec()))
            }
        }
    }
}

/// Directory of the durable prepared assets for one interpretation.
pub fn member_prepared_dir(paths: &LidarPaths, interp_hash: &str) -> PathBuf {
    paths.prepared_dir().join("sources").join(interp_hash)
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
        let Some(cog) = source.source_cog.as_ref() else {
            continue;
        };
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
            let local = cog.resolve(paths, source.job_id.as_deref())?;
            let witness = source
                .source_cog
                .as_ref()
                .and_then(|cog| cog.relative_path.clone());
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
            super::raster_assets::hash_file(&destination)?;
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
/// Intact review jobs keep their own local payloads; only journalled
/// destinations are candidates. A journal whose cleanup fails is retained so
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

/// Persist the durable per-interpretation assets for a staged source. The
/// staged raw samples and valid mask move from the job dir into managed
/// storage; GeoTIFF conversion is metadata-stable and idempotent.
pub fn write_member_assets(
    connection: &rusqlite::Connection,
    engine: &GdalEngine,
    paths: &LidarPaths,
    cancel: &AtomicBool,
    source: &StagedSource,
) -> Result<PathBuf, String> {
    // A retained COG is already this member's durable payload: promotion moved
    // it into the immutable store, and the publication transaction writes the
    // reference that makes it authoritative. A staged job written before
    // retention still publishes the legacy raw/mask pair it carries.
    if let Some(cog) = source.source_cog.as_ref() {
        let _ = connection;
        let promoted = paths.asset_cog(&cog.sha256);
        if !promoted.exists() {
            return Err(format!(
                "staged source {} has no promoted asset at {}",
                source.filename,
                promoted.display()
            ));
        }
        return Ok(promoted);
    }
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
        let (member_values, member_valid) = match cancel {
            Some(cancel) => member.payload.read(&member.grid, cancel)?,
            None => member.payload.read(&member.grid, &AtomicBool::new(false))?,
        };
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
                let index = (y * member.grid.width + x) as usize;
                if member_valid[index] == 0 {
                    continue;
                }
                let covered = valid.get(tx as u32, ty as u32);
                if (covered && !replace_overlap) || (!covered && !add_uncovered) {
                    continue;
                }
                let sample = member_values[index];
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

#[derive(Debug, Clone)]
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
                    let interp_nodata = interp.nodata.map(|value| value as f32);
                    let payload =
                        match generation::retained_cog(&connection, paths, &interpretation_id)? {
                            // A retained COG is this member's durable payload; its
                            // own effective NoData rule wins over the row.
                            Some((asset, cog_nodata)) => MemberPayload::Cog {
                                path: asset.path,
                                nodata: cog_nodata.or(interp_nodata),
                            },
                            None => {
                                let dir = member_prepared_dir(paths, &interp.interp_hash);
                                let raw = dir.join("values.raw");
                                let mask = dir.join("valid.bin");
                                if !raw.exists() || !mask.exists() {
                                    // History written before durable member assets
                                    // existed: fall back to the legacy head-snapshot
                                    // composition.
                                    resolved.clear();
                                    break;
                                }
                                MemberPayload::LegacyDense {
                                    raw_samples_path: raw,
                                    valid_mask_path: mask,
                                }
                            }
                        };
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
                        payload,
                    });
                }
                // An accepted head with no replayable member assets still
                // contributes its own lattice to the review union. That covers
                // a preserved dense head and, just as importantly, an ordered
                // collection whose ordered membership lives in
                // `lidar_collection_members` rather than in the legacy member
                // table: without it the union would be the incoming source
                // alone and every accepted cell would read as uncovered.
                let legacy = resolved.is_empty();
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

    ensure_whole_batch_compatible(staging)?;
    // Union grid: layer member grids plus every compatible staged source.
    let compatible: Vec<&StagedSource> = staging.sources.iter().filter(|s| s.compatible).collect();
    if compatible.is_empty() {
        return Err("import has no compatible sources to publish".to_string());
    }
    // The ordered route has exactly one decision — add the selection above the
    // accepted sources — so its incoming occurrences always carry topmost-valid
    // semantics. The legacy flags are read only by the preserved dense route
    // below, which is a test-forced path, never production publication.
    let ordered_publication = generation::chunked_publication_enabled();
    let incoming_role = match (add_uncovered, replace_overlap) {
        (true, true) => "replace",
        (true, false) => "add",
        (false, true) => "replace-overlap",
        // The ordered route adds the selection as a new contiguous group on top
        // of the accepted members, which is a membership change even when every
        // incoming sample agrees with the composed value; the superseded
        // pixel-only no-change rule must not discard it.
        (false, false) if ordered_publication => "add",
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
    validate_lattice(&union, "import publication")?;
    for member in &head_base.members {
        union = union_grid(&union, &member.grid)?;
        validate_lattice(&union, "import publication union")?;
    }
    for source in &compatible {
        union = union_grid(&union, &grid_for_source(source))?;
        validate_lattice(&union, "import publication union")?;
    }
    // Recheck at Apply against the selected sources and the expected head:
    // admission is decided again immediately before anything is materialized
    // or published, on whichever branch will run. This is the concurrent-change
    // fence — a reorder, undo or second import that moved the head between
    // review and Apply is admitted or refused against the head that will
    // actually be replaced, not the one review saw.
    if let Some(manifest) = head_base.manifest.as_ref()
        && manifest.format == GenerationStorageFormat::LegacyDenseV1
    {
        admission::check_dense_envelope(
            admission::union_envelope_cells(union.width, union.height)?,
            "import publication",
        )?;
        if let Some(mut admitted) = composition_extent_grid(library, head.as_ref())? {
            for source in &compatible {
                admitted = union_grid(&admitted, &grid_for_source(source))?;
            }
            validate_lattice(&admitted, "import publication envelope")?;
            admission::check_dense_envelope(
                admission::union_envelope_cells(admitted.width, admitted.height)?,
                "import publication envelope",
            )?;
        }
    } else {
        let proposed = {
            let connection = library.catalogue()?;
            ordered_processing_cost(&connection, head.as_ref(), &compatible)?
        };
        admission::check_processing_budget(proposed, "import publication")?;
    }
    let _ = head_manifest;
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::ComposingLayer,
        10,
    );

    // A new source generation is an immutable snapshot of the layer's ordered
    // collection. Nothing about the composition is materialized: the
    // publication costs member metadata and one bounded measuring pass, and
    // every reader resolves the same priority list on demand.
    if generation::chunked_publication_enabled() {
        // Promote the job's own source COGs into the immutable store first: the
        // snapshot references global assets, and the references that make them
        // authoritative are written inside the publication transaction.
        library.record_import_progress(
            &staging.job_id,
            LidarImportProgressPhase::PreparingRaster,
            42,
        );
        let mut promotions = PromotionGuard::begin(library, staging);
        promotions.promote(cancel)?;
        for (index, source) in compatible.iter().enumerate() {
            check_cancel(cancel)?;
            {
                let connection = library.catalogue()?;
                write_member_assets(&connection, engine, paths, cancel, source)?;
            }
            let completed = u64::try_from(index + 1).unwrap_or(u64::MAX);
            let total = u64::try_from(compatible.len()).unwrap_or(u64::MAX).max(1);
            let percent = 42 + u8::try_from(completed.saturating_mul(8) / total).unwrap_or(8);
            library.record_import_progress(
                &staging.job_id,
                LidarImportProgressPhase::PreparingRaster,
                percent.min(50),
            );
        }
        let crs_wkt = staging.layer_crs_wkt.clone().unwrap_or_else(|| {
            compatible
                .first()
                .map(|s| s.crs_wkt.clone())
                .unwrap_or_default()
        });
        // The generation lattice is the layer's fixed anchor, never the
        // re-anchored union: extending the layer must not shift the
        // coordinates of members that did not change.
        let anchor = staging
            .layer_grid
            .clone()
            .unwrap_or_else(|| grid_for_source(compatible[0]));
        let lattice = {
            let connection = library.catalogue()?;
            layer_lattice_grid(&connection, &layer_id, &anchor, &crs_wkt)?
        };
        // New selections are inserted as one contiguous group ABOVE the
        // existing members, in the deterministic order the confirmation list
        // showed: the first displayed source becomes topmost.
        let mut members: Vec<collection::SnapshotMember> =
            Vec::with_capacity(compatible.len() + head_base.members.len() + 1);
        let mut manifest_members = Vec::with_capacity(compatible.len());
        let incoming = incoming_occurrences(paths, &compatible, "add", 0)?;
        for (source, resolved) in compatible.iter().zip(incoming) {
            manifest_members.push(source.interp_hash.clone());
            members.push(collection::SnapshotMember {
                member_id: new_id("mem"),
                kind: collection::SOURCE_KIND,
                interpretation_id: Some(format!("interp-{}", source.interp_hash)),
                base_generation_id: None,
                job_id: Some(staging.job_id.clone()),
                resolved,
            });
        }
        match head.as_ref() {
            None => {}
            Some(head_row) => {
                let head_manifest_row = head_manifest
                    .as_ref()
                    .ok_or_else(|| "accepted head has no manifest".to_string())?;
                if head_manifest_row.format.is_ordered_collection() {
                    // A snapshot copies its predecessor's member references; it
                    // never wraps the previous head in another collection.
                    let prior = collection::snapshot_members(library, &head_row.id, cancel)?
                        .ok_or_else(|| {
                            "accepted collection is missing a source payload; the layer cannot \
                             be extended without inventing coverage"
                                .to_string()
                        })?;
                    for member in &prior {
                        if let Some(interpretation_id) = member.interpretation_id.as_deref() {
                            manifest_members
                                .push(interpretation_id.trim_start_matches("interp-").to_string());
                        }
                    }
                    members.extend(prior);
                } else {
                    // A pre-transition head becomes one indivisible bottom
                    // member labelled "Previous composition": its masked
                    // replacement history cannot be reinterpreted as an
                    // arbitrary priority stack, so it is never split into
                    // reorderable historical sources.
                    //
                    // The member wraps the **actual accepted head**, not the
                    // base ancestor that head may overlay: replaying the
                    // ancestor would silently replace the values the user
                    // accepted with an older composition.
                    members.push(collection::previous_composition_member(
                        library,
                        &head_row.id,
                        cancel,
                    )?);
                }
            }
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
        tracing::info!(
            layer_id,
            format = GenerationStorageFormat::OrderedMembersV1.as_str(),
            members = plan.members.len(),
            "publishing an ordered source collection"
        );
        let measurement = collection::measure(library, &plan, cancel)?;
        if measurement.published_cells == 0 {
            return Ok(ApplyOutcome {
                generation_id: head.as_ref().map(|h| h.id.clone()).unwrap_or_default(),
                published_cells: 0,
                changed: false,
                message: Some("selection contains no valid pixels; nothing published".to_string()),
            });
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
            planned_head,
            compatible.as_slice(),
            "add",
            promotions.promoted(),
        )?;
        // The head transaction is the commit point: from here the publication
        // is authoritative even if journal cleanup fails.
        let diagnostic = promotions.commit();
        library.record_import_progress(&staging.job_id, LidarImportProgressPhase::Finalizing, 98);
        return Ok(ApplyOutcome {
            generation_id,
            published_cells: measurement.published_cells,
            changed: true,
            message: diagnostic,
        });
    }

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
            let (layer_values, layer_mask) = {
                let numeric = head_numeric_read(
                    library,
                    head.as_ref(),
                    head_manifest_for_seed.as_ref(),
                    cancel,
                )?;
                head_values_on_union(
                    library,
                    head.as_ref(),
                    head_manifest_for_seed.as_ref(),
                    &numeric,
                    &union,
                    staging.layer_nodata,
                    cancel,
                )?
            };
            compose_values_cancellable(
                layer_values.as_deref(),
                layer_mask.as_ref(),
                &compatible,
                paths,
                &union,
                staging.layer_nodata,
                add_uncovered,
                replace_overlap,
                cancel,
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
                    payload: member_payload_of(source, paths)?,
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

    // Durable per-interpretation assets for the incoming sources: the job's own
    // COGs are promoted now, and the references that make them authoritative
    // are written inside the publication transaction below.
    library.record_import_progress(
        &staging.job_id,
        LidarImportProgressPhase::PreparingRaster,
        42,
    );
    let mut promotions = PromotionGuard::begin(library, staging);
    promotions.promote(cancel)?;
    for (index, source) in compatible.iter().enumerate() {
        check_cancel(cancel)?;
        {
            let connection = library.catalogue()?;
            write_member_assets(&connection, engine, paths, cancel, source)?;
        }
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
        format: GenerationStorageFormat::LegacyDenseV1,
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
        promotion_probe::check(promotion_probe::FaultPoint::BeforeTransaction)?;
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
            insert_promoted_references(&connection, paths, promotions.promoted())?;
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

    // The head transaction committed above: report the publication as success
    // and carry any retained promotion evidence as a diagnostic.
    let diagnostic = promotions.commit();
    Ok(ApplyOutcome {
        generation_id,
        published_cells,
        changed: true,
        message: diagnostic,
    })
}

/// Undo one accepted import: republish the layer coverage without the
/// interpretation that import introduced. Immutable history stays on disk.
/// Everything a member-list edit needs from the accepted head.
struct SnapshotBase {
    manifest: GenerationManifest,
    generation_id: String,
    /// Whether Undo is offered from this head at all.
    undo_available: bool,
    /// Composition Undo restores; absent means the empty composition.
    undo_target: Option<String>,
}

/// The Undo state a newly published snapshot records.
///
/// Availability and target are independent on purpose: an available Undo with
/// no target restores the empty initial composition, while an unavailable one
/// means the walk is exhausted. Conflating them would make Undo either loop on
/// the empty composition or stop one step early.
struct UndoState {
    target: Option<String>,
    available: bool,
}

impl UndoState {
    /// The state an ordinary user change records: it points at the head it
    /// replaced, which is always reachable.
    fn after_change(head: Option<&str>) -> Self {
        Self {
            target: head.map(str::to_string),
            available: true,
        }
    }
}

/// Read the accepted head's manifest, identity and Undo state.
fn snapshot_base(library: &LidarLibrary, layer_id: &str) -> Result<SnapshotBase, String> {
    let connection = library.catalogue()?;
    let head = catalogue::head_generation(&connection, layer_id)?
        .ok_or_else(|| "layer has no accepted coverage".to_string())?;
    let manifest = read_generation_manifest(&head.manifest_json)?;
    Ok(SnapshotBase {
        manifest,
        generation_id: head.id,
        undo_available: head.undo_available,
        undo_target: head.previous_generation_id,
    })
}

/// The manifest member list of a snapshot, keeping the accepted convention.
fn snapshot_manifest_members(members: &[collection::SnapshotMember]) -> Vec<String> {
    members
        .iter()
        .filter_map(|member| member.interpretation_id.as_deref())
        .map(|interpretation_id| interpretation_id.trim_start_matches("interp-").to_string())
        .collect()
}

/// The ordered occurrence identities of one member list.
///
/// Restore compares these rather than generation IDs: an identical ordered
/// composition is a no-op even when it was published as a different snapshot,
/// and two occurrences of the same bytes stay distinct because their member
/// identities are distinct.
fn occurrence_identities(
    members: &[collection::SnapshotMember],
) -> Vec<(String, String, Option<String>, Option<String>)> {
    members
        .iter()
        .map(|member| {
            (
                member.member_id.clone(),
                member.kind.to_string(),
                member.interpretation_id.clone(),
                member.base_generation_id.clone(),
            )
        })
        .collect()
}

/// Publish one member list as a new immutable snapshot and advance the head.
///
/// Every ordered edit funnels through here, so reorder, remove, undo and
/// restore share one publication path: measure the composition, write the
/// generation with its member rows, its recorded operation and its Undo state,
/// and advance the head in one short transaction — or leave the previous head
/// authoritative.
#[allow(clippy::too_many_arguments)]
fn publish_snapshot_members(
    library: &LidarLibrary,
    layer_id: &str,
    members: Vec<collection::SnapshotMember>,
    base: &SnapshotBase,
    expected_head: &str,
    undo: UndoState,
    operation: &str,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let mut plan = collection::SnapshotPlan {
        members,
        lattice: base.manifest.grid.clone(),
        crs_wkt: base.manifest.crs_wkt.clone(),
        nodata: base.manifest.nodata,
        manifest_members: Vec::new(),
    };
    plan.manifest_members = snapshot_manifest_members(&plan.members);
    let measurement = collection::measure(library, &plan, cancel)?;
    let (manifest_json, _) = collection::manifest_for(library, &plan)?;
    let generation_id = new_id("gen");
    let connection = library.catalogue()?;
    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let publish = (|| -> Result<(), String> {
        let current = catalogue::head_generation(&connection, layer_id)?;
        if current.as_ref().map(|row| row.id.as_str()) != Some(expected_head) {
            return Err(
                "the layer changed since this edit was prepared; refresh and try again".to_string(),
            );
        }
        collection::insert_snapshot(
            &connection,
            layer_id,
            &generation_id,
            &plan,
            &measurement,
            &manifest_json,
            &collection::SnapshotLineage {
                previous_generation_id: undo.target.as_deref(),
                undo_available: undo.available,
                operation,
            },
        )?;
        advance_layer_head(&connection, layer_id, &generation_id)?;
        Ok(())
    })();
    match publish {
        Ok(()) => connection
            .execute_batch("COMMIT")
            .map_err(|e| e.to_string())?,
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            return Err(error);
        }
    }
    Ok(ApplyOutcome {
        generation_id,
        published_cells: measurement.published_cells,
        changed: true,
        message: None,
    })
}

/// The accepted member list of a layer, top-first.
fn accepted_members(
    library: &LidarLibrary,
    base: &SnapshotBase,
    cancel: &AtomicBool,
) -> Result<Vec<collection::SnapshotMember>, String> {
    if base.manifest.format.is_ordered_collection() {
        collection::snapshot_members(library, &base.generation_id, cancel)?.ok_or_else(|| {
            "accepted collection is missing a source payload; the layer cannot be read \
             without inventing coverage"
                .to_string()
        })
    } else {
        Ok(vec![collection::previous_composition_member(
            library,
            &base.generation_id,
            cancel,
        )?])
    }
}

/// The member list one recorded version replays.
fn version_members(
    library: &LidarLibrary,
    version_id: &str,
    manifest: &GenerationManifest,
    cancel: &AtomicBool,
) -> Result<Vec<collection::SnapshotMember>, String> {
    if manifest.format.is_ordered_collection() {
        collection::snapshot_members(library, version_id, cancel)?.ok_or_else(|| {
            "that version is missing a source payload; restoring it would invent coverage"
                .to_string()
        })
    } else {
        Ok(vec![collection::previous_composition_member(
            library, version_id, cancel,
        )?])
    }
}

/// Check the caller's expected head against the accepted one.
fn ensure_expected_head(base: &SnapshotBase, expected_head: Option<&str>) -> Result<(), String> {
    if let Some(expected) = expected_head
        && expected != base.generation_id
    {
        return Err(
            "the layer changed since this edit was prepared; refresh and try again".to_string(),
        );
    }
    Ok(())
}

/// Undo the last user change: publish the composition that preceded it.
///
/// The head records both its target and whether Undo is available, so a walk
/// backwards stops exactly where the user's history begins: the first change
/// undoes to the empty initial composition, and the Undo after that is refused
/// rather than republishing the same state. The new snapshot inherits the
/// target's own next-Undo state, which is what makes repeated Undo continue
/// backwards instead of toggling. Restoring publishes a new generation; no
/// accepted history is deleted.
pub fn undo_last_change(
    library: &LidarLibrary,
    layer_id: &str,
    expected_head: Option<&str>,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let base = snapshot_base(library, layer_id)?;
    ensure_expected_head(&base, expected_head)?;
    if !base.undo_available {
        return Ok(ApplyOutcome {
            generation_id: base.generation_id.clone(),
            published_cells: 0,
            changed: false,
            message: Some("there is no earlier version to undo".to_string()),
        });
    }
    let (members, undo) = match base.undo_target.as_deref() {
        // The target is the empty initial composition, which has nothing before
        // it, so the new snapshot is where the walk stops.
        None => (
            Vec::new(),
            UndoState {
                target: None,
                available: false,
            },
        ),
        Some(target) => {
            let restored = {
                let connection = library.catalogue()?;
                catalogue::generation_row(&connection, target)?
                    .ok_or_else(|| format!("previous version {target} is missing"))?
            };
            let manifest = read_generation_manifest(&restored.manifest_json)?;
            let members = version_members(library, target, &manifest, cancel)?;
            (
                members,
                UndoState {
                    target: restored.previous_generation_id.clone(),
                    available: restored.undo_available,
                },
            )
        }
    };
    publish_snapshot_members(
        library,
        layer_id,
        members,
        &base,
        &base.generation_id,
        undo,
        "undo",
        cancel,
    )
}

/// Publish one older version as the new head without deleting the versions in
/// between.
///
/// An explicit restore is an ordinary new change, so it records the head it
/// replaced and can itself be undone. Restoring a version whose ordered
/// occurrence identities already match the current composition publishes
/// nothing.
pub fn restore_version(
    library: &LidarLibrary,
    layer_id: &str,
    version_id: &str,
    expected_head: Option<&str>,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let base = snapshot_base(library, layer_id)?;
    ensure_expected_head(&base, expected_head)?;
    let version = {
        let connection = library.catalogue()?;
        catalogue::generation_row(&connection, version_id)?
            .ok_or_else(|| format!("version {version_id} is missing"))?
    };
    let manifest = read_generation_manifest(&version.manifest_json)?;
    let members = version_members(library, version_id, &manifest, cancel)?;
    let current = accepted_members(library, &base, cancel)?;
    if occurrence_identities(&members) == occurrence_identities(&current) {
        return Ok(ApplyOutcome {
            generation_id: base.generation_id.clone(),
            published_cells: 0,
            changed: false,
            message: Some("that version is already the current composition".to_string()),
        });
    }
    publish_snapshot_members(
        library,
        layer_id,
        members,
        &base,
        &base.generation_id,
        UndoState::after_change(Some(&base.generation_id)),
        "restore",
        cancel,
    )
}

/// Move one source one position towards the top or the bottom of the list.
///
/// An edge move is a no-op rather than an error, and an idempotent request
/// publishes nothing: no meaningless history and no analysis refresh.
pub fn move_member(
    library: &LidarLibrary,
    layer_id: &str,
    member_id: &str,
    towards_top: bool,
    expected_head: Option<&str>,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let base = snapshot_base(library, layer_id)?;
    ensure_expected_head(&base, expected_head)?;
    let mut members = accepted_members(library, &base, cancel)?;
    let Some(index) = members
        .iter()
        .position(|member| member.member_id == member_id)
    else {
        return Err(format!("no source {member_id} in this layer"));
    };
    let target = if towards_top {
        index.checked_sub(1)
    } else if index + 1 < members.len() {
        Some(index + 1)
    } else {
        None
    };
    let Some(target) = target else {
        return Ok(ApplyOutcome {
            generation_id: base.generation_id.clone(),
            published_cells: 0,
            changed: false,
            message: Some("that source is already at the edge of the list".to_string()),
        });
    };
    members.swap(index, target);
    publish_snapshot_members(
        library,
        layer_id,
        members,
        &base,
        &base.generation_id,
        UndoState::after_change(Some(&base.generation_id)),
        "reorder",
        cancel,
    )
}

/// Detach one occurrence from the current composition.
///
/// The occurrence's asset and every accepted version stay in the library: a
/// removal changes the current composition, never the retained data.
pub fn remove_member(
    library: &LidarLibrary,
    layer_id: &str,
    member_id: &str,
    expected_head: Option<&str>,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let base = snapshot_base(library, layer_id)?;
    ensure_expected_head(&base, expected_head)?;
    let mut members = accepted_members(library, &base, cancel)?;
    let before = members.len();
    members.retain(|member| member.member_id != member_id);
    if members.len() == before {
        return Err(format!("no source {member_id} in this layer"));
    }
    publish_snapshot_members(
        library,
        layer_id,
        members,
        &base,
        &base.generation_id,
        UndoState::after_change(Some(&base.generation_id)),
        "remove",
        cancel,
    )
}

/// Undo the last change of the layer an accepted import job published.
///
/// Retained as a caller-level convenience for tests that name a job rather than
/// a layer. The shipped action is `lidar_undo_layer_change`, which names the
/// layer and its expected head, so a stale request fails by name instead of
/// undoing whatever the newest change happened to be.
#[cfg(test)]
pub fn undo_import(
    library: &LidarLibrary,
    job_id: &str,
    cancel: &AtomicBool,
) -> Result<ApplyOutcome, String> {
    let layer_id: String = {
        let connection = library.catalogue()?;
        connection
            .query_row(
                "SELECT g.layer_id
                 FROM lidar_acceptance_regions a
                 JOIN lidar_layer_generations g ON g.id = a.generation_id
                 WHERE a.job_id = ?1
                 ORDER BY g.created_at DESC LIMIT 1",
                [job_id],
                |row| row.get(0),
            )
            .map_err(|_| "import has no accepted publication to undo".to_string())?
    };
    undo_last_change(library, &layer_id, None, cancel)
}

/// The layer a version belongs to, checked before restoring it.
pub fn version_layer(library: &LidarLibrary, version_id: &str) -> Result<String, String> {
    let connection = library.catalogue()?;
    connection
        .query_row(
            "SELECT layer_id FROM lidar_layer_generations WHERE id = ?1",
            [version_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| format!("version {version_id} is missing"))
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
/// Ordered occurrence sequence of a published generation, as the resolver
/// needs it.
///
/// `Ok(None)` means the generation's history cannot be reconstructed from
/// durable payloads: either a member's samples are gone or the generation is a
/// legacy snapshot whose members were never recorded. A caller must then keep
/// the accepted dense route instead of fabricating occurrences it cannot
/// prove.
pub(super) fn resolved_occurrences(
    connection: &rusqlite::Connection,
    paths: &LidarPaths,
    head: &catalogue::GenerationRow,
) -> Result<Option<Vec<generation::ResolvedMember>>, String> {
    let members = catalogue::generation_members(connection, &head.id)?;
    if members.is_empty() {
        // A dense generation without member rows carries coverage that no
        // ordered replay can reproduce.
        return Ok(if head.mosaic_path.is_some() {
            None
        } else {
            Some(Vec::new())
        });
    }
    occurrences_for_members(connection, paths, &members)
}

/// Resolve selected member rows into ordered occurrences.
///
/// `Ok(None)` means at least one row's durable samples are gone, so the
/// sequence cannot be replayed without inventing coverage.
pub(super) fn occurrences_for_members(
    connection: &rusqlite::Connection,
    paths: &LidarPaths,
    members: &[(String, String, Option<String>)],
) -> Result<Option<Vec<generation::ResolvedMember>>, String> {
    let mut resolved = Vec::with_capacity(members.len());
    for (ordinal, (interpretation_id, role, _job_id)) in members.iter().enumerate() {
        let interp = catalogue::get_interpretation(connection, interpretation_id)?
            .ok_or_else(|| format!("missing interpretation {interpretation_id}"))?;
        let grid = RasterGrid {
            width: interp.width as u32,
            height: interp.height as u32,
            geotransform: parse_geotransform(&interp.geotransform)?,
        };
        let mut nodata = interp.nodata.map(|value| value as f32);
        let source = match generation::retained_cog(connection, paths, interpretation_id)? {
            Some((asset, cog_nodata)) => {
                // The retained COG's own effective rule wins over the
                // interpretation row; neither may borrow another member's
                // sentinel.
                nodata = cog_nodata.or(nodata);
                generation::MemberSource::Cog(asset)
            }
            None => {
                let dir = member_prepared_dir(paths, &interp.interp_hash);
                let values = dir.join("values.raw");
                let mask = dir.join("valid.bin");
                if !values.exists() || !mask.exists() {
                    return Ok(None);
                }
                generation::MemberSource::LegacyDense { values, mask }
            }
        };
        resolved.push(generation::ResolvedMember {
            ordinal: i64::try_from(ordinal).unwrap_or(i64::MAX),
            role: generation::MemberRole::parse(role)?,
            grid,
            nodata,
            source,
        });
    }
    Ok(Some(resolved))
}

/// Incoming staged sources as ordered occurrences, read from the durable
/// member assets this apply is about to persist.
fn incoming_occurrences(
    paths: &LidarPaths,
    sources: &[&StagedSource],
    role: &str,
    first_ordinal: i64,
) -> Result<Vec<generation::ResolvedMember>, String> {
    let role = generation::MemberRole::parse(role)?;
    let mut occurrences = Vec::with_capacity(sources.len());
    for (index, source) in sources.iter().enumerate() {
        let grid = grid_for_source(source);
        let (payload, nodata) = match source.source_cog.as_ref() {
            // The retained COG is the incoming occurrence's own payload; its
            // effective NoData rule is the one it was admitted with.
            Some(cog) => (
                generation::MemberSource::Cog(super::raster_assets::CogAsset {
                    sha256: cog.sha256.clone(),
                    path: paths.asset_cog(&cog.sha256),
                    bytes: cog.bytes,
                    grid: grid.clone(),
                    nodata: cog.nodata,
                }),
                cog.nodata.or(source.nodata),
            ),
            None => {
                let dir = member_prepared_dir(paths, &source.interp_hash);
                let values = dir.join("values.raw");
                let mask = dir.join("valid.bin");
                if !values.exists() || !mask.exists() {
                    return Err(format!(
                        "staged source {} has no durable member assets",
                        source.filename
                    ));
                }
                (
                    generation::MemberSource::LegacyDense { values, mask },
                    source.nodata,
                )
            }
        };
        // The occurrence sequence continues after the accepted history: a
        // replay rejects an ordinal that goes backwards, so a third import into
        // one layer must not restart at zero.
        let ordinal = first_ordinal.saturating_add(i64::try_from(index).unwrap_or(i64::MAX));
        occurrences.push(generation::ResolvedMember {
            ordinal,
            role,
            grid,
            nodata,
            source: payload,
        });
    }
    Ok(occurrences)
}

/// One chunked generation to materialize and index.
/// A materialized, indexed generation whose index is not yet readable.
/// What materializing a chunked generation produced.
/// Materialize every occupied chunk and index it unpublished.
///
/// Returns without publishing anything when the sequence changes nothing, and
/// leaves a `Ready` materialization whose chunk rows are still unreadable: the
/// caller's short transaction is what makes them selectable.
/// Drop the unpublished index of a materialization that is not being published.
/// Insert the generation row of a chunked publication.
/// Insert the ordered member occurrences of a generation.
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

/// Publish one ordered collection snapshot and advance the head.
///
/// The whole commit is one short transaction: the job must still be applying,
/// the head must still be the one the review planned against, and the member
/// rows the readers select by become visible with the generation that owns
/// them. A failure publishes nothing and leaves the previous head
/// authoritative.
#[allow(clippy::too_many_arguments)]
fn publish_applied_snapshot(
    library: &LidarLibrary,
    staging: &StagedImport,
    generation_id: &str,
    plan: &collection::SnapshotPlan,
    measurement: &collection::SnapshotMeasurement,
    manifest_json: &str,
    planned_head: Option<&str>,
    incoming: &[&StagedSource],
    incoming_role: &str,
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
        let current_head = catalogue::head_generation(&connection, &staging.layer_id)?;
        if current_head.as_ref().map(|row| row.id.as_str()) != planned_head {
            return Err("import review is stale; review the current coverage again".to_string());
        }
        insert_promoted_references(&connection, &library.inner.paths, promoted)?;
        collection::insert_snapshot(
            &connection,
            &staging.layer_id,
            generation_id,
            plan,
            measurement,
            manifest_json,
            &collection::SnapshotLineage {
                previous_generation_id: planned_head,
                undo_available: true,
                operation: "import",
            },
        )?;
        for source in incoming {
            let interpretation_id = format!("interp-{}", source.interp_hash);
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
                &staging.layer_id,
                grid_for_source(source).bounds(),
            )?;
        }
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

/// Publish the materialized chunks of an import apply and advance the head.
///
/// The whole commit is one short transaction: the job must still be applying,
/// the head must still be the one the review planned against, and the chunk
/// index becomes readable only here.
#[allow(clippy::too_many_arguments)]
/// Publish the materialized chunks of an undo and advance the head.
///
/// Undo republishes a shorter ordered sequence; the footprints of the removed
/// interpretations are dropped in the same transaction so the spatial index
/// never advertises coverage the head no longer has.
/// Whether undo removes one stored occurrence of the target import job.
///
/// Members recorded with job identity are matched by that identity. Older
/// members have none, so the accepted interpretations of the job are matched
/// from the end of the sequence, which is the order they were appended in.
/// How the current head generation's numbers are read.
enum HeadNumeric {
    /// No accepted generation yet.
    None,
    /// Dense mosaic plus coverage mask of a preserved legacy generation.
    Dense,
    /// A generation-owned numeric store, read through its own resolver.
    Reader(generation::GenerationReader),
}

/// Select the read path of the accepted head from its manifest format.
///
/// The selection is explicit so a chunked generation can never fall back to a
/// dense file it does not own, and a legacy generation keeps its accepted
/// dense read.
fn head_numeric_read(
    library: &LidarLibrary,
    head: Option<&catalogue::GenerationRow>,
    manifest: Option<&GenerationManifest>,
    cancel: &AtomicBool,
) -> Result<HeadNumeric, String> {
    let (Some(head), Some(manifest)) = (head, manifest) else {
        return Ok(HeadNumeric::None);
    };
    match manifest.format {
        GenerationStorageFormat::LegacyDenseV1 => Ok(HeadNumeric::Dense),
        // The bound reader holds identity only: its pages are fetched as the
        // read needs them, so no caller materializes the generation's records.
        GenerationStorageFormat::CogChunksV1 => {
            Ok(HeadNumeric::Reader(generation::GenerationReader::Chunks(
                generation::GenerationChunkReader::new(&head.id, generation::RESULT_ROLE),
            )))
        }
        GenerationStorageFormat::OrderedMembersV1 => {
            let collection = collection::load_reader(library, &head.id, manifest, cancel)?
                .ok_or_else(|| {
                    "accepted collection is missing a source payload; the layer cannot be read \
                     without inventing coverage"
                        .to_string()
                })?;
            Ok(HeadNumeric::Reader(
                generation::GenerationReader::Collection(Box::new(collection)),
            ))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn head_values_on_union(
    library: &LidarLibrary,
    head: Option<&catalogue::GenerationRow>,
    manifest: Option<&GenerationManifest>,
    numeric: &HeadNumeric,
    union: &RasterGrid,
    nodata: f32,
    cancel: &AtomicBool,
) -> Result<(Option<Vec<f32>>, Option<ValidMask>), String> {
    let (Some(head), Some(manifest)) = (head, manifest) else {
        return Ok((None, None));
    };
    validate_working_grid(union, "accepted layer union")?;
    let engine = &library.inner.engine;
    if let HeadNumeric::Reader(owner) = numeric {
        // A chunked head has no dense file: read the union one bounded window
        // at a time from the published chunk rows. The head's lattice is its
        // own fixed layer anchor, which may differ from this union's origin,
        // so each union block is read at its lattice position. Absent chunks
        // stay invalid and no absent coordinate is visited.
        validate_working_grid(&manifest.grid, "accepted layer lattice")?;
        let cells = usize::try_from(u64::from(union.width) * u64::from(union.height))
            .map_err(|_| "accepted layer union is too large for this platform".to_string())?;
        let mut expanded = vec![nodata; cells];
        let mut valid = ValidMask::empty(union.width, union.height);
        let offset_x = ((manifest.grid.geotransform[0] - union.geotransform[0])
            / union.geotransform[1])
            .round() as i64;
        let offset_y = ((union.geotransform[3] - manifest.grid.geotransform[3])
            / union.geotransform[5].abs())
        .round() as i64;
        let side = generation::CHUNK_SIDE as u32;
        let mut y = 0u32;
        while y < union.height {
            let height = side.min(union.height - y);
            let mut x = 0u32;
            while x < union.width {
                check_cancel(cancel)?;
                let width = side.min(union.width - x);
                let resolved = owner.read_window(
                    library,
                    &manifest.grid,
                    generation::LatticeWindow {
                        x: i64::from(x) - offset_x,
                        y: i64::from(y) - offset_y,
                        width,
                        height,
                    },
                    cancel,
                )?;
                for row in 0..height as usize {
                    for column in 0..width as usize {
                        let index = row * width as usize + column;
                        if resolved.valid[index] == 0 {
                            continue;
                        }
                        let target =
                            (y as usize + row) * union.width as usize + x as usize + column;
                        expanded[target] = resolved.samples[index];
                        valid.set(x + column as u32, y + row as u32, true);
                    }
                }
                x += width;
            }
            y += height;
        }
        return Ok((Some(expanded), Some(valid)));
    }
    // Dense legacy head: the accepted mosaic and coverage mask.
    validate_working_grid(&manifest.grid, "accepted layer raster")?;
    let (Some(mosaic_path), Some(mask_path)) = (
        head.mosaic_path.as_deref(),
        head.coverage_mask_path.as_deref(),
    ) else {
        return Err("accepted generation has no dense raster".to_string());
    };
    let raw = raw_f32_bytes(
        engine,
        Path::new(mosaic_path),
        manifest.grid.width,
        manifest.grid.height,
        cancel,
    )?;
    validate_f32_raw(&raw, manifest.grid.width, manifest.grid.height)?;
    let layer_mask = ValidMask::read_from(
        Path::new(mask_path),
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
fn preview_tif_from_values(
    engine: &GdalEngine,
    cancel: &AtomicBool,
    job_dir: &Path,
    stem: &str,
    union: &RasterGrid,
    crs_wkt: &Option<String>,
    nodata: f32,
    values: &[f32],
) -> Result<PathBuf, String> {
    let raw = job_dir.join(format!("preview-{stem}.raw"));
    write_f32_raw(&raw, values)?;
    let tif = job_dir.join(format!("preview-{stem}.tif"));
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

/// Storage format of one published generation.
///
/// The manifest is the single authority for how a generation's numbers are
/// read: a catalogued generation either owns one dense mosaic plus a coverage
/// mask, owns sparse resolved COG chunks, or is an ordered collection of
/// independent source COGs whose composed value is resolved on demand. Readers
/// must never guess from the presence of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum GenerationStorageFormat {
    /// Accepted format: one dense Float32 mosaic and a coverage mask.
    #[default]
    #[serde(rename = "legacy-dense-v1")]
    LegacyDenseV1,
    /// Sparse 1024×1024 resolved standard COG chunks indexed per generation.
    #[serde(rename = "cog-chunks-v1")]
    CogChunksV1,
    /// Ordered independent source COGs composed by priority at read time.
    #[serde(rename = "ordered-members-v1")]
    OrderedMembersV1,
}

impl GenerationStorageFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LegacyDenseV1 => "legacy-dense-v1",
            Self::CogChunksV1 => "cog-chunks-v1",
            Self::OrderedMembersV1 => "ordered-members-v1",
        }
    }

    /// Whether this format resolves its value from an ordered member list
    /// rather than from stored resolved numbers.
    pub fn is_ordered_collection(self) -> bool {
        matches!(self, Self::OrderedMembersV1)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerationManifest {
    pub grid: RasterGrid,
    pub nodata: f32,
    pub crs_wkt: String,
    pub members: Vec<String>,
    pub engine_version: String,
    pub created_at: String,
    /// Absent in manifests written before the sparse format existed, which are
    /// dense by definition.
    #[serde(default)]
    pub format: GenerationStorageFormat,
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

pub(crate) fn f32_sample(raw: &[u8], index: usize) -> f32 {
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

pub(crate) fn format_geotransform(gt: GeoTransform) -> String {
    format!(
        "[{},{},{},{},{},{}]",
        gt[0], gt[1], gt[2], gt[3], gt[4], gt[5]
    )
}

pub(crate) fn parse_geotransform(raw: &str) -> Result<GeoTransform, String> {
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
            payload: MemberPayload::LegacyDense {
                raw_samples_path: raw,
                valid_mask_path: mask,
            },
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
            let cog = source
                .source_cog
                .as_ref()
                .expect("staging retains one controlled source COG");
            let grid = grid_for_source(source);
            let mut reader = cog
                .open(&library.inner.paths, source.job_id.as_deref(), &grid)
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
                oracle_range(&oracle),
                "value range keeps the retained finite-NoData behaviour"
            );
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
        for source in &staging.sources {
            assert!(
                source.raw_samples_path.as_os_str().is_empty()
                    && source.valid_mask_path.as_os_str().is_empty(),
                "a retained source records no raw/mask payload"
            );
        }
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
            let (cog, regions, valid_cells) = stage_source_samples(
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
            let staged_path = cog.resolve(&paths, Some("boundary-job")).unwrap();
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
            assert!(!regions.is_empty(), "occupied regions are derived from it");
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

    /// The CRS this engine reports for a raster, as a source probe would.
    fn declared_wkt(engine: &GdalEngine, raster: &Path) -> String {
        let info = super::super::display::gdalinfo_json(engine, &AtomicBool::new(false), raster)
            .expect("gdalinfo reads the fixture");
        info.get("coordinateSystem")
            .and_then(|system| system.get("wkt"))
            .and_then(|wkt| wkt.as_str())
            .unwrap_or("")
            .to_string()
    }

    /// Publish a generation in the shape the superseded route wrote.
    ///
    /// A pre-repair library owns `cog-chunks-v1` generations whose manifest grid
    /// is only the lattice anchor while their published chunks may reach well
    /// beyond it. The delivery has to keep reading that shape exactly, so the
    /// tests build it directly instead of reviving the retired publication path.
    fn publish_legacy_chunked_head(
        library: &LidarLibrary,
        layer_id: &str,
        lattice: &RasterGrid,
        clusters: &[(i64, i64, f32)],
        base_generation_id: Option<&str>,
    ) -> String {
        let engine = &library.inner.engine;
        let paths = &library.inner.paths;
        let cancel = AtomicBool::new(false);
        let scratch = paths.prepared_dir().join("legacy-fixture");
        std::fs::create_dir_all(&scratch).unwrap();
        let generation_id = new_id("gen");
        let mut rows = Vec::new();
        // The manifest must declare exactly the CRS this engine reports for the
        // written raster, or a later source would be refused as foreign.
        let mut crs_wkt = String::new();
        for (chunk_x, chunk_y, value) in clusters {
            let grid = generation::chunk_grid(lattice, *chunk_x, *chunk_y);
            let values = vec![*value; (grid.width * grid.height) as usize];
            let asset = super::super::raster_assets::write_cog_asset(
                engine,
                &cancel,
                paths,
                &scratch,
                &format!("legacy-{chunk_x}-{chunk_y}"),
                &grid,
                "EPSG:3857",
                Some(-9999.0),
                &values,
            )
            .expect("legacy chunk asset writes");
            if crs_wkt.is_empty() {
                crs_wkt = declared_wkt(engine, &asset.path);
            }
            let connection = library.catalogue().unwrap();
            catalogue::insert_raster_asset(
                &connection,
                &generation::asset_row(paths, &asset, &crs_wkt).unwrap(),
            )
            .unwrap();
            rows.push(catalogue::GenerationChunkRow {
                role: generation::RESULT_ROLE.to_string(),
                chunk_x: *chunk_x,
                chunk_y: *chunk_y,
                asset_sha256: asset.sha256.clone(),
                valid_cells: i64::from(grid.width) * i64::from(grid.height),
                min_value: f64::from(*value),
                max_value: f64::from(*value),
                sum_value: f64::from(*value) * f64::from(grid.width) * f64::from(grid.height),
            });
        }
        let mut min_value = f64::INFINITY;
        let mut max_value = f64::NEG_INFINITY;
        let mut coverage = 0i64;
        for row in &rows {
            coverage += row.valid_cells;
            min_value = min_value.min(row.min_value);
            max_value = max_value.max(row.max_value);
        }
        if !min_value.is_finite() {
            min_value = 0.0;
            max_value = 0.0;
        }
        let manifest = serde_json::json!({
            "grid": {
                "width": lattice.width,
                "height": lattice.height,
                "geotransform": lattice.geotransform,
            },
            "nodata": -9999.0,
            "crs_wkt": crs_wkt.clone(),
            "members": [],
            "engine_version": "fixture",
            "created_at": "0",
            "format": "cog-chunks-v1",
        })
        .to_string();
        let bounds = raster_bounds_3857(engine, &cancel, lattice, &crs_wkt).unwrap();
        {
            let connection = library.catalogue().unwrap();
            catalogue::insert_unpublished_chunks(&connection, &generation_id, &rows).unwrap();
            catalogue::publish_generation_chunks(&connection, &generation_id).unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_generations(
                         id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                         coverage_cells, min_value, max_value, bounds_3857, base_generation_id,
                         undo_available, operation)
                     VALUES(?1, ?2, '0', NULL, NULL, ?3, ?4, ?5, ?6, ?7, ?8, 0, NULL)",
                    rusqlite::params![
                        generation_id,
                        layer_id,
                        manifest,
                        coverage,
                        min_value,
                        max_value,
                        serde_json::to_string(&bounds).unwrap(),
                        base_generation_id,
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES(?1, ?2)
                     ON CONFLICT(layer_id) DO UPDATE SET generation_id = excluded.generation_id",
                    rusqlite::params![layer_id, generation_id],
                )
                .unwrap();
        }
        let _ = std::fs::remove_dir_all(&scratch);
        generation_id
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

    /// Drive the real caller flow up to a staged review.
    fn stage_review(
        library: &LidarLibrary,
        layer_id: &str,
        sources: &[PathBuf],
        cancel: &AtomicBool,
    ) -> (String, StagedImport) {
        let job_id = library.record_import_job(layer_id).expect("job recorded");
        let output = stage_import(library, &job_id, layer_id, sources, cancel).expect("staging");
        assert!(
            output.review.compatible,
            "fixtures must be admitted: {:?}",
            output.review.issues
        );
        library.finish_staging(
            &job_id,
            Ok(StagingOutput {
                review: output.review.clone(),
            }),
        );
        let staging: StagedImport = serde_json::from_str(
            &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                .unwrap(),
        )
        .unwrap();
        (job_id, staging)
    }

    /// The accepted head row of a layer.
    fn head_of(library: &LidarLibrary, layer_id: &str) -> catalogue::GenerationRow {
        let connection = library.catalogue().unwrap();
        catalogue::head_generation(&connection, layer_id)
            .unwrap()
            .expect("layer has a head")
    }

    /// Published resolved-chunk rows of a generation.
    ///
    /// An ordered collection materializes none; a preserved generation keeps
    /// whatever the superseded route published for it.
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
        .unwrap()
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
        let numeric = head_numeric_read(
            library,
            Some(&head),
            Some(&manifest),
            &AtomicBool::new(false),
        )
        .unwrap();
        // Read exactly the requested window: the layer lattice's origin is
        // fixed, so window coordinates are lattice coordinates and a synthetic
        // union equal to the window keeps the indexing trivial.
        let union = RasterGrid {
            width: window.width,
            height: window.height,
            geotransform: [
                manifest.grid.geotransform[0] + window.x as f64 * manifest.grid.geotransform[1],
                manifest.grid.geotransform[1],
                0.0,
                manifest.grid.geotransform[3] + window.y as f64 * manifest.grid.geotransform[5],
                0.0,
                manifest.grid.geotransform[5],
            ],
        };
        let (values, valid) = head_values_on_union(
            library,
            Some(&head),
            Some(&manifest),
            &numeric,
            &union,
            manifest.nodata,
            &AtomicBool::new(false),
        )
        .unwrap();
        let values = values.expect("head has numeric values");
        let valid = valid.expect("head has coverage");
        let mut samples = Vec::new();
        let mut mask = Vec::new();
        for row in 0..window.height {
            for column in 0..window.width {
                let index = row as usize * window.width as usize + column as usize;
                samples.push(values[index]);
                mask.push(u8::from(valid.get(column, row)));
            }
        }
        (samples, mask)
    }

    #[test]
    fn manifest_format_defaults_to_dense_and_reads_the_chunked_name() {
        let dense = r#"{"grid":{"width":2,"height":2,"geotransform":[0.0,1.0,0.0,2.0,0.0,-1.0]},
            "nodata":-9999.0,"crs_wkt":"EPSG:3857","members":["a"],"engine_version":"3.8",
            "created_at":"0"}"#;
        let manifest = read_generation_manifest(dense).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::LegacyDenseV1);
        let chunked = dense.replace(
            "\"created_at\"",
            "\"format\":\"cog-chunks-v1\",\"created_at\"",
        );
        let manifest = read_generation_manifest(&chunked).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::CogChunksV1);
    }

    #[test]
    fn sparse_publication_is_the_production_default_and_can_be_forced_dense() {
        assert!(
            generation::chunked_publication_enabled(),
            "every reader and the display transport consume the sparse format"
        );
        {
            let _dense = generation::chunked_publication::without_sparse();
            assert!(!generation::chunked_publication_enabled());
        }
        assert!(generation::chunked_publication_enabled());
    }

    /// The first production vertical slice on the sparse format: stage,
    /// review, Apply, reopen the library, review again, undo.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn ordered_stage_review_apply_reorder_remove_undo_and_restore_keep_exact_values() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-ordered-slice"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // The decisive example: the bottom source covers columns 0..60 with the
        // value 5; the later source covers 20..80 with 9, so it overlaps 40
        // columns and adds 20.
        let bottom =
            write_placed_fixture(&engine, &root, "bottom", 0.0, 1000.0, 60, 45, -9999.0, 5.0);
        let top = write_placed_fixture(&engine, &root, "top", 20.0, 1000.0, 60, 45, -9999.0, 9.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "ordered slice",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        let (job_one, staging_one) = stage_review(&library, &layer_id, &[bottom], &cancel);
        assert_eq!(staging_one.uncovered_cells, 60 * 45);
        assert_eq!(staging_one.overlap_cells, 0);
        library.prepare_apply(&job_one).expect("review accepted");
        let applied = apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
        assert!(applied.changed);

        // The published head is an ordered collection: member metadata only.
        let head = head_of(&library, &layer_id);
        assert_eq!(head.id, applied.generation_id);
        assert!(head.mosaic_path.is_none() && head.coverage_mask_path.is_none());
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::OrderedMembersV1);
        assert_eq!(head.coverage_cells, 60 * 45);
        assert_eq!(head.min_value, Some(5.0));
        assert_eq!(head.max_value, Some(5.0));
        assert_eq!(published_chunk_count(&library, &head.id), 0);
        assert_eq!(head_member_count(&library, &layer_id), 1);
        let first_member_id = {
            let connection = library.catalogue().unwrap();
            catalogue::collection_members(&connection, &head.id).unwrap()[0]
                .member_id
                .clone()
        };

        // Reopen the library: the accepted head must read back exactly.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        let full = generation::LatticeWindow {
            x: 0,
            y: 0,
            width: 80,
            height: 45,
        };
        let (values, valid) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            if x < 60 {
                assert_eq!(valid[index], 1, "cell {index}");
                assert_eq!(*value, 5.0, "cell {index}");
            } else {
                assert_eq!(valid[index], 0, "cell {index} is outside the composition");
            }
        }

        // Add a second source: it is inserted ABOVE the accepted member, so the
        // first displayed source is topmost.
        let (job_two, staging_two) = stage_review(&reopened, &layer_id, &[top], &cancel);
        assert_eq!(staging_two.overlap_cells, 40 * 45);
        assert_eq!(staging_two.uncovered_cells, 20 * 45);
        reopened
            .prepare_apply(&job_two)
            .expect("second review accepted");
        let stacked =
            apply_import(&reopened, &staging_two, true, false, &cancel).expect("second applies");
        assert!(stacked.changed);
        let stacked_head = head_of(&reopened, &layer_id);
        assert_eq!(stacked_head.coverage_cells, 80 * 45);
        assert_eq!(stacked_head.min_value, Some(5.0));
        assert_eq!(stacked_head.max_value, Some(9.0));
        assert_eq!(published_chunk_count(&reopened, &stacked_head.id), 0);
        let members = {
            let connection = reopened.catalogue().unwrap();
            catalogue::collection_members(&connection, &stacked_head.id).unwrap()
        };
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].position, 0, "the new source is topmost");
        let top_member_id = members[0].member_id.clone();
        assert_eq!(members[1].member_id, first_member_id);
        let (values, valid) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            assert_eq!(valid[index], 1, "cell {index}");
            assert_eq!(*value, if x < 20 { 5.0 } else { 9.0 }, "cell {index}");
        }

        // Move the top source below the bottom one: the composition changes and
        // neither source COG is re-encoded.
        let moved = move_member(
            &reopened,
            &layer_id,
            &top_member_id,
            false,
            Some(&stacked_head.id),
            &cancel,
        )
        .expect("move publishes");
        assert!(moved.changed);
        let (values, valid) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            assert_eq!(valid[index], 1, "cell {index} is still covered");
            assert_eq!(*value, if x < 60 { 5.0 } else { 9.0 }, "cell {index}");
        }

        // Undo the move: the recorded predecessor restores the stacked order.
        let undone = undo_last_change(&reopened, &layer_id, None, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let (values, _) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            assert_eq!(*value, if x < 20 { 5.0 } else { 9.0 }, "cell {index}");
        }

        // Repeated Undo walks further back through user changes instead of
        // toggling between the two newest heads.
        let undone_again =
            undo_last_change(&reopened, &layer_id, None, &cancel).expect("second undo publishes");
        assert!(undone_again.changed);
        let (values, valid) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            if x < 60 {
                assert_eq!(valid[index], 1, "cell {index}");
                assert_eq!(*value, 5.0, "cell {index}");
            } else {
                assert_eq!(valid[index], 0, "cell {index}");
            }
        }

        // Restore the moved version explicitly: it publishes a new head and
        // deletes nothing in between.
        let restored = restore_version(&reopened, &layer_id, &moved.generation_id, None, &cancel)
            .expect("restore publishes");
        assert!(restored.changed);
        let (values, valid) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            assert_eq!(valid[index], 1, "cell {index}");
            assert_eq!(*value, if x < 60 { 5.0 } else { 9.0 }, "cell {index}");
        }

        // Remove one occurrence: its asset and every version stay in the library.
        let removed = remove_member(&reopened, &layer_id, &top_member_id, None, &cancel)
            .expect("remove publishes");
        assert!(removed.changed);
        assert_eq!(head_member_count(&reopened, &layer_id), 1);
        let (values, valid) = head_window(&reopened, &layer_id, full);
        for (index, value) in values.iter().enumerate() {
            let x = index % 80;
            if x < 60 {
                assert_eq!(valid[index], 1, "cell {index}");
                assert_eq!(*value, 5.0, "cell {index}");
            } else {
                assert_eq!(valid[index], 0, "cell {index}");
            }
        }
        // Every earlier version is still listed and still restorable.
        let history = reopened.layer_history_page(&layer_id, None).unwrap();
        assert!(
            history.versions.len() >= 6,
            "every publication stays in history: {}",
            history.versions.len()
        );
        assert_eq!(
            history
                .versions
                .iter()
                .filter(|entry| entry.is_head)
                .count(),
            1,
            "exactly one head is marked current"
        );
        assert!(
            history
                .versions
                .iter()
                .any(|entry| entry.id == stacked_head.id),
            "the removed source's version is retained"
        );
        assert!(
            history
                .versions
                .iter()
                .all(|entry| entry.operation.is_some() && entry.source_count <= 2),
            "each version names its recorded operation and its source count"
        );
        assert!(
            history
                .versions
                .iter()
                .filter(|entry| entry.is_head)
                .all(|entry| !entry.restorable),
            "the current version is not offered as a restore of itself"
        );
        // A stale edit is refused by name instead of applying to a newer order.
        let stale = move_member(
            &reopened,
            &layer_id,
            &top_member_id,
            true,
            Some(&stacked_head.id),
            &cancel,
        )
        .expect_err("a stale edit is refused");
        assert!(stale.contains("changed since this edit"), "{stale}");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// `canopi-kko3`: an undo that changes the layer head refreshes the
    /// dependent analysis instead of leaving the slope of the removed coverage
    /// presented as the current ready result.
    ///
    /// The control is the Apply path, whose refresh was already correct: both
    /// numeric changes run through the same dependent-refresh orchestration, so
    /// the analysis is recomputed from the restored composition rather than
    /// re-pointed at a historical result.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn an_undo_refreshes_the_dependent_analysis_it_restored() {
        use super::super::analysis;

        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-undo-refresh"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let bottom =
            write_placed_fixture(&engine, &root, "bottom", 0.0, 1000.0, 60, 45, -9999.0, 5.0);
        let top = write_placed_fixture(&engine, &root, "top", 20.0, 1000.0, 60, 45, -9999.0, 9.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "undo refresh",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job_one, staging_one) = stage_review(&library, &layer_id, &[bottom], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("first applies");
        let first_generation = head_of(&library, &layer_id).id;

        // Create the analysis and run its first job exactly as the command path
        // does, so a real result is published for the first generation.
        let receipt = library
            .create_analysis(
                &layer_id,
                common_types::lidar::LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
                },
            )
            .expect("analysis definition is created");
        let parameters = {
            let connection = library.catalogue().unwrap();
            let json: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .unwrap();
            analysis::parse_parameters(&json).unwrap()
        };
        let run_job = |job_id: &str, source_generation: &str| {
            let outcome = analysis::run_slope_job(
                &library,
                job_id,
                &receipt.definition_id,
                &parameters,
                source_generation,
                &cancel,
            )
            .expect("the slope job runs");
            assert!(outcome.published, "a result is published");
        };
        // One catalogue read at a time: the connection is a single mutex-guarded
        // handle, so a nested lock would deadlock rather than wait.
        let analysis_source = || -> String {
            let connection = library.catalogue().unwrap();
            let head: String = connection
                .query_row(
                    "SELECT generation_id FROM lidar_analysis_heads WHERE definition_id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .unwrap();
            connection
                .query_row(
                    "SELECT source_generation_id FROM lidar_analysis_generations WHERE id = ?1",
                    [&head],
                    |row| row.get(0),
                )
                .unwrap()
        };
        let latest_job = || -> (String, String) {
            let connection = library.catalogue().unwrap();
            connection
                .query_row(
                    "SELECT id, source_generation_id FROM lidar_analysis_jobs
                     WHERE definition_id = ?1 ORDER BY rowid DESC LIMIT 1",
                    [&receipt.definition_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap()
        };
        run_job(&receipt.job_id, &first_generation);
        assert_eq!(analysis_source(), first_generation);

        // Control: the Apply path refreshes its dependent analysis, and that
        // refresh publishes a result for the new head.
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[top], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        let stacked = apply_import(&library, &staging_two, true, false, &cancel).expect("applies");
        library.finish_apply(&job_two, Ok(stacked.clone()));
        let (apply_job, apply_source) = latest_job();
        assert_ne!(apply_job, receipt.job_id, "Apply enqueues a refresh");
        assert_eq!(apply_source, stacked.generation_id);
        run_job(&apply_job, &apply_source);
        assert_eq!(
            analysis_source(),
            stacked.generation_id,
            "the Apply path's refresh makes the new composition current"
        );

        // The undo must refresh too: it goes through the same settlement path.
        let undone = undo_last_change(&library, &layer_id, None, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let settled = library
            .settle_layer_edit(&layer_id, "undo-refresh-test", Ok(undone.clone()))
            .expect("a committed undo settles");
        assert!(settled.changed, "the undo reported its publication");
        let (undo_job, undo_source) = latest_job();
        assert_ne!(undo_job, apply_job, "the undo enqueues its own refresh");
        assert_eq!(
            undo_source, undone.generation_id,
            "the refresh recomputes from the composition the undo restored"
        );
        run_job(&undo_job, &undo_source);
        assert_eq!(
            analysis_source(),
            undone.generation_id,
            "the analysis head matches the restored generation"
        );
        assert_ne!(
            analysis_source(),
            stacked.generation_id,
            "no current result still describes the composition the user undid"
        );

        // An idempotent no-op publishes nothing and enqueues no meaningless
        // work: restoring the version that is already current is refused as a
        // no-op rather than published as a new head.
        let current_head = head_of(&library, &layer_id).id;
        let no_change = restore_version(&library, &layer_id, &current_head, None, &cancel)
            .expect("restore runs");
        assert!(
            !no_change.changed,
            "restoring the current version changes nothing"
        );
        let settled_noop = library
            .settle_layer_edit(&layer_id, "undo-refresh-noop", Ok(no_change))
            .expect("a no-op settles");
        assert!(
            !settled_noop.changed,
            "a no-op edit reports that it published nothing"
        );
        let (after_noop, _) = latest_job();
        assert_eq!(
            after_noop, undo_job,
            "a no-op edit publishes and refreshes nothing"
        );

        let _ = std::fs::remove_dir_all(&root);
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
            )
            .unwrap();
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let output = stage_import(
            &library,
            &job_id,
            &layer_id,
            &[web_mercator, lambert],
            &cancel,
        )
        .expect("staging completes");
        assert!(
            !output.review.compatible,
            "a mixed-CRS batch is not compatible"
        );
        assert!(
            output
                .review
                .issues
                .iter()
                .any(|issue| issue.contains("horizontal CRS differs")),
            "the refusal names the CRS disagreement: {:?}",
            output.review.issues
        );
        assert_eq!(
            output
                .review
                .sources
                .iter()
                .filter(|source| source.compatible)
                .count(),
            1,
            "the anchor source stays admissible; the disagreeing one does not"
        );
        // The same batch is refused by the publication boundary, not only by
        // the panel that disables its confirmation.
        library.finish_staging(
            &job_id,
            Ok(StagingOutput {
                review: output.review.clone(),
            }),
        );
        let staging: StagedImport = serde_json::from_str(
            &std::fs::read_to_string(library.inner.paths.job_dir(&job_id).join("staging.json"))
                .unwrap(),
        )
        .unwrap();
        let refused = library
            .prepare_apply(&job_id)
            .expect_err("a mixed batch never enters applying");
        assert!(refused.contains("cannot be published"), "{refused}");
        assert!(
            apply_import(&library, &staging, true, false, &cancel)
                .expect_err("the backend refuses the whole batch")
                .contains("cannot be published"),
            "the whole selected batch is atomic"
        );
        assert_eq!(
            generation_count(&library, &layer_id),
            0,
            "nothing was published"
        );
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
            )
            .unwrap();
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let output = stage_import(&library, &job_id, &layer_id, &[empty, real], &cancel)
            .expect("staging completes");
        let empty_facts = output
            .review
            .sources
            .iter()
            .find(|source| source.filename.contains("empty"))
            .expect("the empty source is listed");
        assert!(
            !empty_facts.compatible,
            "an all-NoData source is not admissible"
        );
        assert!(
            empty_facts
                .issues
                .iter()
                .any(|issue| issue.contains("no valid samples")),
            "the refusal names the reason: {:?}",
            empty_facts.issues
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-4: the admission envelope follows the current composition.
    ///
    /// Three small sources are admitted one at a time. Each import's own union
    /// with the fixed lattice anchor stays far below the limit, while the
    /// composition's real extent crosses it — which is how an oversized
    /// collection was admitted before.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn the_admission_envelope_follows_the_current_composition() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-cumulative-envelope"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let anchor = write_placed_fixture(&engine, &root, "anchor", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let east = write_placed_fixture(&engine, &root, "east", 6000.0, 4.0, 4, 4, -9999.0, 6.0);
        let south = write_placed_fixture(&engine, &root, "south", 0.0, 4204.0, 4, 4, -9999.0, 7.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "cumulative envelope",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        let (job_one, staging_one) = stage_review(&library, &layer_id, &[anchor], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("anchor publishes");

        // The east source extends the composition to 6004 x 4 cells: admitted.
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[east], &cancel);
        assert!(
            admission::union_envelope_cells(
                staging_two.union_grid.width,
                staging_two.union_grid.height
            )
            .unwrap()
                < admission::MAX_DENSE_ENVELOPE_CELLS,
            "the second import's own envelope is small"
        );
        library.prepare_apply(&job_two).expect("review accepted");
        apply_import(&library, &staging_two, true, false, &cancel).expect("east publishes");
        let composed = head_of(&library, &layer_id);
        assert_eq!(
            composed.coverage_cells,
            2 * 16,
            "both accepted sources are one composition"
        );

        // The south source leaves the anchor-relative envelope small, but the
        // composition now spans 6004 x 4204 cells, above the unchanged limit.
        let staging_three_error = stage_import(
            &library,
            &library.record_import_job(&layer_id).expect("job recorded"),
            &layer_id,
            &[south],
            &cancel,
        )
        .err();
        let anchor_relative = {
            let mut admitted = RasterGrid {
                width: 4,
                height: 4,
                geotransform: [0.0, 1.0, 0.0, 4204.0, 0.0, -1.0],
            };
            admitted = union_grid(
                &admitted,
                &RasterGrid {
                    width: 4,
                    height: 4,
                    geotransform: [0.0, 1.0, 0.0, 4204.0, 0.0, -1.0],
                },
            )
            .unwrap();
            admission::union_envelope_cells(admitted.width, admitted.height).unwrap()
        };
        assert!(
            anchor_relative < admission::MAX_DENSE_ENVELOPE_CELLS,
            "the anchor-relative envelope is what the superseded check measured: {anchor_relative}"
        );
        let south_grid = RasterGrid {
            width: 4,
            height: 4,
            geotransform: [0.0, 1.0, 0.0, 4204.0, 0.0, -1.0],
        };
        let mut with_incoming = composition_extent_grid(&library, Some(&composed))
            .unwrap()
            .expect("the composition has an extent");
        with_incoming = union_grid(&with_incoming, &south_grid).unwrap();
        assert!(
            admission::union_envelope_cells(with_incoming.width, with_incoming.height).unwrap()
                > admission::MAX_DENSE_ENVELOPE_CELLS,
            "the composition's real extent exceeds the limit"
        );
        let refused = staging_three_error.expect("staging refuses the oversized composition");
        assert!(
            refused.contains("exceeds") || refused.contains("25000000"),
            "the refusal names the envelope: {refused}"
        );
        assert_eq!(
            head_of(&library, &layer_id).id,
            composed.id,
            "the accepted head is untouched"
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
            )
            .unwrap();
        let (job_one, staging_one) = stage_review(&library, &layer_id, &[five], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("first applies");

        let (job_two, staging_two) = stage_review(&library, &layer_id, &[nine], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        let applied = apply_import(&library, &staging_two, true, false, &cancel).expect("second");
        let head = head_of(&library, &layer_id);
        assert_eq!(head.id, applied.generation_id);
        assert_eq!(head.coverage_cells, 16);
        assert_eq!(
            head.min_value,
            Some(9.0),
            "the published range is the composed one"
        );
        assert_eq!(head.max_value, Some(9.0));

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

    /// P1-5: a sparse preserved composition keeps its signed extent.
    ///
    /// Its manifest rectangle describes the lattice its chunks are addressed
    /// in, not how far they reach. A published chunk beyond that rectangle must
    /// stay readable through the transition, or accepted coverage silently
    /// disappears.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_sparse_previous_composition_keeps_its_signed_extent() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-sparse-extent"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "sparse extent",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        // The anchor lattice is a 4x4 rectangle; the published chunks reach a
        // third block far to the east, exactly as a pre-repair library does.
        let lattice = RasterGrid {
            width: 4,
            height: 4,
            geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        publish_legacy_chunked_head(
            &library,
            &layer_id,
            &lattice,
            &[(0, 0, 5.0), (2, 0, 7.0)],
            None,
        );
        let manifest =
            read_generation_manifest(&head_of(&library, &layer_id).manifest_json).unwrap();
        assert_eq!(
            manifest.grid.width, 4,
            "the anchor rectangle is only the coordinate frame"
        );

        // A new source above it wraps the accepted head as one member.
        let top = write_placed_fixture(&engine, &root, "top", 0.0, 4.0, 4, 4, -9999.0, 6.0);
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[top], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        apply_import(&library, &staging_two, true, false, &cancel).expect("wraps");

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
        assert_eq!(sample(2048, 0).1, 1, "the far chunk is still valid");
        assert_eq!(sample(2048, 0).0, 7.0, "with its own value");
        assert_eq!(sample(0, 0), (6.0, 1), "the new source is on top");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-5: the previous composition wraps the accepted head, not the base
    /// ancestor it may overlay.
    ///
    /// Following `base_generation_id` silently replaced accepted values with an
    /// older composition: a historical overlay valued 7 became the base's 5.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn the_previous_composition_wraps_the_actual_accepted_head() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-wrap-head"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let top = write_placed_fixture(&engine, &root, "top", 20.0, 4.0, 4, 4, -9999.0, 3.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "wrap head",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        // The accepted head is a historical overlay: a sparse generation that
        // records the dense base it replaced, valued 7 over the base's 5.
        let lattice = RasterGrid {
            width: 4,
            height: 4,
            geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        let base = publish_legacy_chunked_head(&library, &layer_id, &lattice, &[(0, 0, 5.0)], None);
        let accepted =
            publish_legacy_chunked_head(&library, &layer_id, &lattice, &[(0, 0, 7.0)], Some(&base));
        let accepted_row = head_of(&library, &layer_id);
        assert_eq!(accepted_row.id, accepted);
        assert_eq!(accepted_row.min_value, Some(7.0));
        assert_eq!(
            accepted_row.base_generation_id.as_deref(),
            Some(base.as_str()),
            "the accepted head records the base it overlays"
        );

        // A third source wraps whatever the layer accepted, so the overlay
        // stays visible underneath it.
        let (job_three, staging_three) = stage_review(&library, &layer_id, &[top], &cancel);
        library.prepare_apply(&job_three).expect("review accepted");
        apply_import(&library, &staging_three, true, false, &cancel).expect("wraps");
        let head = head_of(&library, &layer_id);
        let members = {
            let connection = library.catalogue().unwrap();
            catalogue::collection_members(&connection, &head.id).unwrap()
        };
        assert_eq!(members.len(), 2);
        assert_eq!(
            members[1].base_generation_id.as_deref(),
            Some(accepted.as_str()),
            "the wrapped member is the accepted head itself, not its base ancestor"
        );
        let (samples, valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(
            samples.iter().all(|value| *value == 7.0),
            "the accepted overlay value survives the transition: {samples:?}"
        );
        assert_eq!(head.max_value, Some(7.0), "and the statistics agree");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-6: a Previous-composition-only layer is a valid slope input.
    ///
    /// After an Undo the layer's composition can be one preserved member with
    /// no source COG of its own. Eligibility has to come from the shared
    /// generation reader, not from a source path that no longer exists.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn slope_accepts_a_previous_composition_only_layer() {
        use super::super::analysis;

        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-legacy-slope"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "legacy slope",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let lattice = RasterGrid {
            width: 4,
            height: 4,
            geotransform: [0.0, 1.0, 0.0, 4.0, 0.0, -1.0],
        };
        publish_legacy_chunked_head(&library, &layer_id, &lattice, &[(0, 0, 5.0)], None);

        // The layer is a valid analysis input while it is still a preserved
        // generation.
        let receipt = library
            .create_analysis(
                &layer_id,
                common_types::lidar::LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
                },
            )
            .expect("analysis definition is created");

        // A new source above it, then Undo: the head is now one ordered
        // snapshot whose only member is the preserved composition.
        let top = write_placed_fixture(&engine, &root, "top", 0.0, 4.0, 4, 4, -9999.0, 6.0);
        let (job, staging) = stage_review(&library, &layer_id, &[top], &cancel);
        library.prepare_apply(&job).expect("review accepted");
        apply_import(&library, &staging, true, false, &cancel).expect("top publishes");
        let undone = undo_last_change(&library, &layer_id, None, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let head = head_of(&library, &layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::OrderedMembersV1);
        let members = {
            let connection = library.catalogue().unwrap();
            catalogue::collection_members(&connection, &head.id).unwrap()
        };
        assert_eq!(members.len(), 1);
        assert_eq!(members[0].kind, "previous-composition");
        assert!(
            head.mosaic_path.is_none(),
            "the composition owns no source raster of its own"
        );

        // Slope must still run: eligibility comes from the composition.
        let parameters = {
            let connection = library.catalogue().unwrap();
            let json: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .unwrap();
            analysis::parse_parameters(&json).unwrap()
        };
        let outcome = analysis::run_slope_job(
            &library,
            &receipt.job_id,
            &receipt.definition_id,
            &parameters,
            &head.id,
            &cancel,
        )
        .expect("a preserved composition is a valid slope input");
        assert!(
            outcome.published && !outcome.stale,
            "the slope result is published: {}",
            outcome.summary()
        );
        let result = library
            .library_snapshot()
            .unwrap()
            .analyses
            .into_iter()
            .find(|analysis| analysis.id == receipt.definition_id)
            .expect("the analysis is listed");
        assert_eq!(result.state, common_types::lidar::LidarResultState::Ready);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-6: a superseded job settles as the scheduler's stale outcome.
    ///
    /// Reporting it as a plain failure ended the refresh chain, so the newest
    /// composition could be left without a current result.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_superseded_sparse_slope_job_settles_as_stale() {
        use super::super::analysis;

        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-superseded-slope"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let first = write_placed_fixture(&engine, &root, "first", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let second = write_placed_fixture(&engine, &root, "second", 20.0, 4.0, 4, 4, -9999.0, 9.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "superseded slope",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job_one, staging_one) = stage_review(&library, &layer_id, &[first], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("first publishes");
        let superseded = head_of(&library, &layer_id).id;

        let receipt = library
            .create_analysis(
                &layer_id,
                common_types::lidar::LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
                },
            )
            .expect("analysis definition is created");
        let parameters = {
            let connection = library.catalogue().unwrap();
            let json: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .unwrap();
            analysis::parse_parameters(&json).unwrap()
        };

        // The layer moves on while the captured job is still queued.
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[second], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        apply_import(&library, &staging_two, true, false, &cancel).expect("second publishes");
        assert_ne!(head_of(&library, &layer_id).id, superseded);

        let outcome = analysis::run_slope_job(
            &library,
            &receipt.job_id,
            &receipt.definition_id,
            &parameters,
            &superseded,
            &cancel,
        )
        .expect("a superseded job coalesces instead of failing");
        assert!(
            outcome.stale && !outcome.published,
            "the superseded job is stale, not failed: {}",
            outcome.summary()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-6: readiness is a fact about identity, not about a job having once
    /// succeeded.
    ///
    /// A result whose captured source is no longer the head must not present
    /// itself as current — including after a restart, where no callback runs.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn an_old_result_is_not_ready_after_the_head_changes() {
        use super::super::analysis;

        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-stale-ready"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let first = write_placed_fixture(&engine, &root, "first", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let second = write_placed_fixture(&engine, &root, "second", 20.0, 4.0, 4, 4, -9999.0, 9.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "stale ready",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job_one, staging_one) = stage_review(&library, &layer_id, &[first], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("first publishes");
        let receipt = library
            .create_analysis(
                &layer_id,
                common_types::lidar::LidarAnalysisKind::Slope,
                common_types::lidar::LidarAnalysisParameters {
                    slope_unit: Some(common_types::lidar::LidarSlopeUnit::Degrees),
                },
            )
            .expect("analysis definition is created");
        let parameters = {
            let connection = library.catalogue().unwrap();
            let json: String = connection
                .query_row(
                    "SELECT parameters_json FROM lidar_analysis_definitions WHERE id = ?1",
                    [&receipt.definition_id],
                    |row| row.get(0),
                )
                .unwrap();
            analysis::parse_parameters(&json).unwrap()
        };
        let head = head_of(&library, &layer_id).id;
        let outcome = analysis::run_slope_job(
            &library,
            &receipt.job_id,
            &receipt.definition_id,
            &parameters,
            &head,
            &cancel,
        )
        .expect("the slope job runs");
        assert!(outcome.published);
        let state_of = |library: &LidarLibrary| {
            library
                .library_snapshot()
                .unwrap()
                .analyses
                .into_iter()
                .find(|analysis| analysis.id == receipt.definition_id)
                .expect("the analysis is listed")
        };
        assert_eq!(
            state_of(&library).state,
            common_types::lidar::LidarResultState::Ready
        );

        // The head changes without a refresh having run.
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[second], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        apply_import(&library, &staging_two, true, false, &cancel).expect("second publishes");
        // Cancel the enqueued refresh so the state is derived, not settled.
        let queued = {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "UPDATE lidar_analysis_jobs SET state = 'cancelled'
                     WHERE definition_id = ?1 AND state IN ('preparing', 'refreshing')",
                    [&receipt.definition_id],
                )
                .unwrap()
        };
        let _ = queued;
        let stale = state_of(&library);
        assert_ne!(
            stale.state,
            common_types::lidar::LidarResultState::Ready,
            "an old result is not current for a new head: {stale:?}"
        );
        assert_eq!(
            stale.state,
            common_types::lidar::LidarResultState::Incomplete
        );
        assert!(
            stale.detail.is_some(),
            "the stale state explains itself: {stale:?}"
        );

        // A restart derives the same state, because nothing depends on a
        // callback having fired.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        let after_restart = state_of(&reopened);
        assert_eq!(
            after_restart.state,
            common_types::lidar::LidarResultState::Incomplete,
            "a restart does not resurrect a Ready result: {after_restart:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// P1-7: Undo reaches the empty composition once, then stops; restoring an
    /// equal composition publishes nothing.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn undo_stops_at_empty_and_restoring_an_equal_composition_is_a_no_op() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-undo-boundary"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let first = write_placed_fixture(&engine, &root, "first", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "undo boundary",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job, staging) = stage_review(&library, &layer_id, &[first], &cancel);
        library.prepare_apply(&job).expect("review accepted");
        apply_import(&library, &staging, true, false, &cancel).expect("publishes");
        let imported = head_of(&library, &layer_id).id;

        // The first change can be undone to the empty composition.
        let summary = library.layer_collection(&layer_id, None).unwrap();
        assert!(summary.undo_available, "the import can be undone");
        assert_eq!(
            summary.undo_target, None,
            "its target is the empty composition"
        );
        assert_eq!(summary.sources.len(), 1);

        let undone = undo_last_change(&library, &layer_id, Some(&imported), &cancel)
            .expect("undo publishes");
        assert!(undone.changed);
        let empty = library.layer_collection(&layer_id, None).unwrap();
        assert_eq!(empty.member_count, 0, "the layer is empty");
        assert!(!empty.undo_available, "the walk is exhausted");
        assert_eq!(empty.undo_target, None);

        // Another Undo is refused without publishing anything.
        let exhausted = undo_last_change(&library, &layer_id, None, &cancel).expect("undo runs");
        assert!(!exhausted.changed, "an exhausted Undo publishes nothing");
        assert_eq!(
            exhausted.generation_id, undone.generation_id,
            "and it keeps the head it already had"
        );
        assert!(exhausted.message.is_some(), "and it explains itself");

        // Restoring the import is an ordinary change and is itself undoable.
        let restored =
            restore_version(&library, &layer_id, &imported, None, &cancel).expect("restores");
        assert!(restored.changed);
        assert_eq!(
            library
                .layer_collection(&layer_id, None)
                .unwrap()
                .member_count,
            1
        );
        let restored_summary = library.layer_collection(&layer_id, None).unwrap();
        assert!(restored_summary.undo_available);
        assert_eq!(
            restored_summary.undo_target.as_deref(),
            Some(undone.generation_id.as_str()),
            "restoring records the head it replaced"
        );

        // Restoring the same composition again is a no-op: the ordered
        // occurrence identities already match.
        let equal =
            restore_version(&library, &layer_id, &imported, None, &cancel).expect("restore runs");
        assert!(
            !equal.changed,
            "an equal composition is not republished: {:?}",
            equal.message
        );

        // History records what happened rather than inferring it.
        let history = library.layer_history_page(&layer_id, None).unwrap();
        let operations: Vec<Option<String>> = history
            .versions
            .iter()
            .map(|entry| entry.operation.clone())
            .collect();
        assert_eq!(
            operations,
            vec![
                Some("restore".to_string()),
                Some("undo".to_string()),
                Some("import".to_string())
            ],
            "each version names its own operation"
        );
        assert_eq!(
            history
                .versions
                .iter()
                .map(|entry| entry.sequence)
                .collect::<Vec<_>>(),
            vec![3, 2, 1],
            "and a unique cue"
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
            )
            .unwrap();
        let (job, staging) = stage_review(&library, &layer_id, &[source], &cancel);
        assert_eq!(
            staging.uncovered_cells, 1024,
            "the exact review coverage is the valid half"
        );
        library.prepare_apply(&job).expect("review accepted");
        apply_import(&library, &staging, true, false, &cancel).expect("publishes");

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
            )
            .unwrap();
        let (job, staging) = stage_review(&library, &layer_id, &[near, far], &cancel);
        library.prepare_apply(&job).expect("review accepted");
        apply_import(&library, &staging, true, false, &cancel).expect("publishes");
        let head = head_of(&library, &layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();

        let whole = super::super::collection::load_reader(&library, &head.id, &manifest, &cancel)
            .unwrap()
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
        .unwrap()
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

    /// P2-11: the caller's cancellation reaches a cold compatibility lease.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_cancelled_read_does_not_prepare_a_compatibility_lease() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-compat-cancel"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let source = write_placed_fixture(&engine, &root, "legacy", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "compat cancel",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job, staging) = stage_review(&library, &layer_id, &[source], &cancel);
        library.prepare_apply(&job).expect("review accepted");
        {
            let _dense = generation::chunked_publication::without_sparse();
            apply_import(&library, &staging, true, false, &cancel).expect("dense publishes");
        }
        let head = head_of(&library, &layer_id);
        assert_eq!(
            read_generation_manifest(&head.manifest_json)
                .unwrap()
                .format,
            GenerationStorageFormat::LegacyDenseV1,
            "the preserved generation needs the compatibility lease"
        );

        let cancelled = AtomicBool::new(false);
        cancelled.store(true, std::sync::atomic::Ordering::SeqCst);
        let refused =
            super::super::collection::previous_composition_member(&library, &head.id, &cancelled)
                .err()
                .expect("a cancelled read does not prepare a legacy derivative");
        assert_eq!(refused, "cancelled", "{refused}");

        // Healthy control: the same read with a live token prepares the lease
        // and resolves.
        let member =
            super::super::collection::previous_composition_member(&library, &head.id, &cancel)
                .expect("a live read prepares the lease");
        let resolved = generation::resolve_window(
            std::slice::from_ref(&member.resolved),
            &read_generation_manifest(&head.manifest_json).unwrap().grid,
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

    /// A preserved legacy generation keeps its dense files and can be extended
    /// by a sparse publication without rewriting its history.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn chunked_publication_extends_a_legacy_generation_without_rewriting_it() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-chunked-legacy"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let first =
            write_placed_fixture(&engine, &root, "first", 0.0, 1000.0, 60, 45, -9999.0, 5.0);
        let apart =
            write_placed_fixture(&engine, &root, "apart", 500.0, 1000.0, 40, 30, -9999.0, 7.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "legacy base",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        // First import through the accepted dense route, forced for this step
        // only: the rest of the test exercises the sparse extension.
        let (job_one, staging_one) = stage_review(&library, &layer_id, &[first], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        {
            let _dense = generation::chunked_publication::without_sparse();
            apply_import(&library, &staging_one, true, false, &cancel).expect("dense apply");
        }
        let legacy = head_of(&library, &layer_id);
        let legacy_manifest = read_generation_manifest(&legacy.manifest_json).unwrap();
        assert_eq!(
            legacy_manifest.format,
            GenerationStorageFormat::LegacyDenseV1,
            "the gate is off, so the accepted dense route publishes"
        );
        let legacy_mosaic = legacy.mosaic_path.clone().expect("dense mosaic");
        assert!(
            Path::new(&legacy_mosaic).exists(),
            "the legacy mosaic is a real file"
        );
        assert_eq!(published_chunk_count(&library, &legacy.id), 0);

        // Extend it with a separated source through the sparse route.
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[apart], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        let applied = apply_import(&library, &staging_two, true, false, &cancel).expect("apply");
        assert!(applied.changed);

        let head = head_of(&library, &layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::OrderedMembersV1);
        assert_eq!(head.coverage_cells, 60 * 45 + 40 * 30);
        assert_eq!(head.min_value, Some(5.0));
        assert_eq!(head.max_value, Some(7.0));
        assert_eq!(
            published_chunk_count(&library, &head.id),
            0,
            "the composition stores member metadata only"
        );

        // The preserved generation is untouched: same row, same files, and it
        // is exposed as one indivisible bottom member rather than split into
        // reorderable historical sources.
        {
            let connection = library.catalogue().unwrap();
            let stored: Option<String> = connection
                .query_row(
                    "SELECT mosaic_path FROM lidar_layer_generations WHERE id = ?1",
                    [&legacy.id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(stored.as_deref(), Some(legacy_mosaic.as_str()));
            assert!(Path::new(&legacy_mosaic).exists());
            let members = catalogue::collection_members(&connection, &head.id).unwrap();
            assert_eq!(members.len(), 2, "previous composition plus the new source");
            assert_eq!(
                members[0].job_id.as_deref(),
                Some(job_two.as_str()),
                "the new source is topmost and carries its job"
            );
            assert_eq!(members[1].kind, "previous-composition");
            assert_eq!(
                members[1].base_generation_id.as_deref(),
                Some(legacy.id.as_str()),
                "the preserved generation is referenced directly"
            );
        }

        // Both members read back through the sparse head.
        let (values, valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 540,
                height: 45,
            },
        );
        let width = 540usize;
        for row in 0..45usize {
            for column in 0..width {
                let index = row * width + column;
                let expected = match column {
                    // The legacy member occupies the left 60 columns for the
                    // full height of its own 60x45 grid.
                    0..=59 => Some(5.0),
                    // The new member is 40 wide and 30 tall at x=500.
                    500..=539 if row < 30 => Some(7.0),
                    _ => None,
                };
                match expected {
                    Some(value) => {
                        assert_eq!(valid[index], 1, "cell {column},{row} is covered");
                        assert_eq!(values[index], value, "cell {column},{row}");
                    }
                    None => {
                        // The 440-column gap between the members is exactly
                        // invalid: sparse storage never reads it as data.
                        assert_eq!(valid[index], 0, "gap cell {column},{row} is invalid");
                    }
                }
            }
        }

        // Undo the sparse extension: the legacy member is republished alone.
        let undone = undo_import(&library, &job_two, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let undone_head = head_of(&library, &layer_id);
        assert_eq!(undone_head.coverage_cells, 60 * 45);
        let (values, _) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 60,
                height: 45,
            },
        );
        assert!(values.iter().all(|value| *value == 5.0));
        assert!(Path::new(&legacy_mosaic).exists());

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
            )
            .unwrap();
        // The lattice anchors on the first selected source, so selecting the
        // anchor first makes the left member extend it into negative cells.
        let (job_id, staging) = stage_review(&library, &layer_id, &[anchor, left, far], &cancel);
        assert!(
            staging.union_grid.width > 1_000_000,
            "the union spans the gap: {}",
            staging.union_grid.width
        );
        assert_eq!(staging.uncovered_cells, expected_cells);
        library.prepare_apply(&job_id).expect("review accepted");
        let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
        assert!(applied.changed);

        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, expected_cells as i64);
        assert_eq!(head.min_value, Some(3.0));
        assert_eq!(head.max_value, Some(7.0));
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
    /// The layer anchor is fixed: extending the layer left does not move the
    /// lattice, so an unchanged member keeps its chunk coordinates and the new
    /// member lands in negative lattice cells.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_lattice_anchor_never_moves_when_the_layer_extends_left() {
        let root = std::env::temp_dir().join(new_id("canopi-anchor"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");

        let anchor =
            write_placed_fixture(&engine, &root, "anchor", 0.0, 1000.0, 60, 45, -9999.0, 5.0);
        let left = write_placed_fixture(
            &engine, &root, "left", -1200.0, 1000.0, 40, 30, -9999.0, 3.0,
        );

        let layer_id = library
            .create_layer(
                "anchor",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job_one, staging_one) = stage_review(&library, &layer_id, &[anchor], &cancel);
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("first apply");
        let first_head = head_of(&library, &layer_id);
        let first_manifest = read_generation_manifest(&first_head.manifest_json).unwrap();
        assert_eq!(
            head_occupied_chunks(&library, &layer_id),
            vec![(0, 0)],
            "the first member occupies chunk 0 of the fixed anchor"
        );

        // Extending left must keep the anchor and put the new member before it.
        let (job_two, staging_two) =
            stage_review(&library, &layer_id, std::slice::from_ref(&left), &cancel);
        assert!(
            staging_two.union_grid.geotransform[0] < first_manifest.grid.geotransform[0],
            "the union does extend left"
        );
        library.prepare_apply(&job_two).expect("review accepted");
        apply_import(&library, &staging_two, true, false, &cancel).expect("second apply");
        let head = head_of(&library, &layer_id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        assert_eq!(
            manifest.grid.geotransform[0], first_manifest.grid.geotransform[0],
            "the layer anchor never moves"
        );
        assert_eq!(
            head_occupied_chunks(&library, &layer_id),
            vec![(-2, 0), (0, 0)],
            "the unchanged member keeps chunk 0 and the extension lands before the anchor"
        );
        assert_eq!(
            published_chunk_count(&library, &head.id),
            0,
            "the composition stores member metadata only"
        );
        // Both members read back at their own lattice positions.
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
        assert_eq!(sample(0, 0), (5.0, 1));
        assert_eq!(sample(-1200, 0), (3.0, 1));
        assert_eq!(sample(-1000, 0).1, 0, "the gap between them stays invalid");

        // Review over the sparse head maps the lattice onto the new union.
        let (job_three, staging_three) =
            stage_review(&library, &layer_id, std::slice::from_ref(&left), &cancel);
        assert_eq!(
            staging_three.overlap_cells,
            (40 * 30) as u64,
            "the accepted left member is seen through the head read"
        );
        let overlap = staging_three.overlap_cells;
        let _ = (job_three, overlap);

        drop(library);
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
            )
            .unwrap();
        let (job_id, staging) = stage_review(&library, &layer_id, &sources, &cancel);
        assert_eq!(staging.uncovered_cells, 24 * 32 * 24);
        library.prepare_apply(&job_id).expect("review accepted");
        let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
        assert!(applied.changed);

        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, 24 * 32 * 24);
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
            .map(|_| admission::ProcessingCost::Dense {
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
            "the arranged union still exceeds the old dense envelope ceiling"
        );
        assert!(
            admission::check_dense_envelope(union_cells, "sparse 24-tile batch").is_err(),
            "the retained dense envelope guard would still refuse this geometry"
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
    /// A snapshot-only legacy head (no member rows) is overlaid sparsely: the
    /// new generation points at the original base, replays it, and an undo
    /// restores that base without chaining to the intermediate generation.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_publication_overlays_an_opaque_legacy_base() {
        let root = std::env::temp_dir().join(new_id("canopi-base"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");

        let legacy =
            write_placed_fixture(&engine, &root, "legacy", 0.0, 1000.0, 60, 45, -9999.0, 4.0);
        let extension = write_placed_fixture(
            &engine,
            &root,
            "extension",
            500.0,
            1000.0,
            40,
            30,
            -9999.0,
            6.0,
        );

        // First publish dense, then strip its member history: that is exactly
        // the preserved legacy head this overlay exists for.
        let layer_id = library
            .create_layer(
                "legacy base",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job, staging) = stage_review(&library, &layer_id, &[legacy], &cancel);
        library.prepare_apply(&job).expect("review accepted");
        {
            // The legacy head this test overlays must have been published
            // dense, so the preserved route is forced for this step only.
            let _dense = generation::chunked_publication::without_sparse();
            apply_import(&library, &staging, true, false, &cancel).expect("dense apply");
        }
        let base = head_of(&library, &layer_id);
        let base_manifest = read_generation_manifest(&base.manifest_json).unwrap();
        assert_eq!(
            base_manifest.format,
            GenerationStorageFormat::LegacyDenseV1,
            "the first publication is the accepted dense route"
        );
        {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "DELETE FROM lidar_generation_members WHERE generation_id = ?1",
                    [&base.id],
                )
                .unwrap();
        }
        {
            let connection = library.catalogue().unwrap();
            assert!(
                resolved_occurrences(&connection, &library.inner.paths, &base)
                    .unwrap()
                    .is_none(),
                "without member rows the head is not reconstructible"
            );
        }

        // A sparse publication now overlays it instead of rewriting it.
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[extension], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        let applied = apply_import(&library, &staging_two, true, false, &cancel).expect("overlay");
        assert!(applied.changed);
        let head = head_of(&library, &layer_id);
        assert_ne!(head.id, base.id);
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::OrderedMembersV1);
        let members = {
            let connection = library.catalogue().unwrap();
            catalogue::collection_members(&connection, &head.id).unwrap()
        };
        assert_eq!(members.len(), 2);
        assert_eq!(members[0].kind, "source");
        assert_eq!(members[1].kind, "previous-composition");
        assert_eq!(
            members[1].base_generation_id.as_deref(),
            Some(base.id.as_str()),
            "the previous composition points at the original opaque base"
        );
        assert_eq!(head.coverage_cells, 60 * 45 + 40 * 30);
        assert_eq!(head.min_value, Some(4.0));
        assert_eq!(head.max_value, Some(6.0));
        // The preserved base is untouched.
        {
            let connection = library.catalogue().unwrap();
            let preserved = catalogue::generation_row(&connection, &base.id)
                .unwrap()
                .expect("base row survives");
            assert_eq!(preserved.mosaic_path, base.mosaic_path);
            assert!(preserved.base_generation_id.is_none());
        }

        // Both the preserved coverage and the extension read back through the
        // resolver; nothing is materialized.
        assert_eq!(published_chunk_count(&library, &head.id), 0);
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
        assert_eq!(sample(0, 0), (4.0, 1), "the base coverage is replayed");
        assert_eq!(sample(59, 44), (4.0, 1));
        assert_eq!(sample(500, 0), (6.0, 1), "the extension is painted over it");
        assert_eq!(sample(400, 0).1, 0, "the space between them stays invalid");

        // Undo restores the base alone, still pointing at the original base.
        let undone = undo_import(&library, &job_two, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let after = head_of(&library, &layer_id);
        assert_eq!(after.coverage_cells, 60 * 45);
        let after_members = {
            let connection = library.catalogue().unwrap();
            catalogue::collection_members(&connection, &after.id).unwrap()
        };
        assert_eq!(after_members.len(), 1);
        assert_eq!(
            after_members[0].base_generation_id.as_deref(),
            Some(base.id.as_str()),
            "a preserved composition never chains to an intermediate generation"
        );
        assert_eq!(published_chunk_count(&library, &after.id), 0);
        let (samples, valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: 0,
                y: 0,
                width: 60,
                height: 45,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(samples.iter().all(|value| *value == 4.0));

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }
    // -----------------------------------------------------------------------
    // BG5: admission is one policy, decided before review and rechecked at Apply
    // -----------------------------------------------------------------------

    /// Two sources whose data is tiny but whose union envelope is exactly the
    /// admission limit: admitted through the real sparse staging and Apply.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn admission_admits_a_union_exactly_at_the_envelope_limit() {
        let root = std::env::temp_dir().join(new_id("canopi-admit-exact"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");
        // A 5000x5000 envelope with four sample cells in each far corner.
        let south_west = write_placed_fixture(&engine, &root, "sw", 0.0, 4.0, 4, 4, -9999.0, 3.0);
        let north_east =
            write_placed_fixture(&engine, &root, "ne", 4996.0, 5000.0, 4, 4, -9999.0, 7.0);
        let layer_id = library
            .create_layer(
                "envelope exact",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job_id, staging) =
            stage_review(&library, &layer_id, &[south_west, north_east], &cancel);
        assert_eq!(
            admission::union_envelope_cells(staging.union_grid.width, staging.union_grid.height)
                .unwrap(),
            25_000_000,
            "5000x5000 is exactly the admitted envelope"
        );
        library.prepare_apply(&job_id).expect("review accepted");
        let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
        assert!(applied.changed);
        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, 32);
        assert_eq!(
            head_occupied_chunks(&library, &layer_id).len(),
            2,
            "only the two occupied blocks are visited"
        );
        assert_eq!(
            published_chunk_count(&library, &head.id),
            0,
            "the composition stores no resolved source raster"
        );
        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The same two small sources, one lattice column further apart. Their
    /// union envelope is now *over* the retired 25M bound, and the ordered path
    /// admits them anyway: the governing bound is the processing cells the
    /// collection proposes, and two 4x4 sources propose 32.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn admission_admits_a_separated_pair_whose_union_exceeds_the_retired_envelope() {
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
            )
            .unwrap();
        // No override: this must run under the real production policy.
        assert_eq!(
            admission::limits(),
            admission::AdmissionLimits::production()
        );
        let (job_id, staging) =
            stage_review(&library, &layer_id, &[south_west, north_east], &cancel);
        let envelope =
            admission::union_envelope_cells(staging.union_grid.width, staging.union_grid.height)
                .unwrap();
        assert!(
            envelope > admission::MAX_DENSE_ENVELOPE_CELLS,
            "the arrangement must exceed the retired envelope bound, got {envelope}"
        );
        assert!(
            admission::check_dense_envelope(envelope, "separated pair").is_err(),
            "the retained dense guard would refuse this geometry"
        );
        assert_eq!(staging.processing_cells, 32);
        library.prepare_apply(&job_id).expect("review accepted");
        let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
        assert!(
            applied.changed,
            "the processing budget admits the pair, charging the sources and not the gap"
        );
        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, 32);
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
            )
            .unwrap();
        // Only the processing budget is lowered, below the pair's own 32 cells,
        // so a refusal can only come from the processing-budget check.
        let _lowered = admission::limits_probe::set(admission::AdmissionLimits {
            files: 24,
            source_bytes: 2 * 1024 * 1024 * 1024,
            import_bytes: 2 * 1024 * 1024 * 1024,
            processing_cells: 16,
            dense_envelope_cells: admission::MAX_DENSE_ENVELOPE_CELLS,
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

    /// A generation admitted under a representative-run override stays fully
    /// readable, displayable and undoable once the override is gone.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn grandfathered_large_generations_stay_readable_after_the_override_expires() {
        let root = std::env::temp_dir().join(new_id("canopi-grandfathered"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let library = LidarLibrary::open(&root).expect("library opens");
        let south_west = write_placed_fixture(&engine, &root, "sw", 0.0, 4.0, 4, 4, -9999.0, 3.0);
        let north_east =
            write_placed_fixture(&engine, &root, "ne", 9000.0, 10_000.0, 4, 4, -9999.0, 7.0);
        let layer_id = library
            .create_layer(
                "grandfathered",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        // Admitted only because a representative run raised the envelope for
        // both staging and the Apply recheck, which is how that run proceeds.
        let (job_id, _staging, applied) = {
            let _raised = admission::limits_probe::raise(128 * 1024 * 1024, 16, 1024 * 1024 * 1024);
            let (job_id, staging) =
                stage_review(&library, &layer_id, &[south_west, north_east], &cancel);
            assert!(
                admission::union_envelope_cells(
                    staging.union_grid.width,
                    staging.union_grid.height
                )
                .unwrap()
                    > admission::MAX_DENSE_ENVELOPE_CELLS
            );
            library.prepare_apply(&job_id).expect("review accepted");
            let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
            (job_id, staging, applied)
        };
        assert!(applied.changed);
        assert_eq!(
            admission::limits(),
            admission::AdmissionLimits::production(),
            "the override is gone before the reads below"
        );

        // Reads: the accepted window is exactly what was published.
        // Reads: a grandfathered oversized layer is still readable after the
        // override expires, through the same resolver every other read uses.
        let (samples, valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: 9000,
                // The far member lies above the anchor lattice: its own grid
                // origin is y=10000 while the layer anchor is y=4.
                y: -9996,
                width: 4,
                height: 4,
            },
        );
        assert!(valid.iter().all(|byte| *byte == 1));
        assert!(samples.iter().all(|value| *value == 7.0));

        // Display: the layer still presents and renders a native tile.
        let snapshot = library.library_snapshot().expect("snapshot");
        let tileset = snapshot.layers[0]
            .tilesets
            .iter()
            .find(|tileset| tileset.style == "elevation")
            .expect("displayable");
        let generation_id = match &tileset.source {
            common_types::lidar::LidarTileSource::NativeGeneration { generation_id } => {
                generation_id.clone()
            }
            _ => panic!("a sparse generation has no asset template"),
        };
        let span = 40_075_016.685_578_49 / f64::from(1u32 << 20);
        let half = 20_037_508.342_789_244;
        library
            .render_tile(
                "source",
                &layer_id,
                &generation_id,
                "elevation",
                20,
                ((250.0 + half) / span).floor() as u32,
                ((half - 250.0) / span).floor() as u32,
                &cancel,
            )
            .expect("tile renders");

        // Undo restores accepted history without re-admitting anything.
        let undone = undo_import(&library, &job_id, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let after = head_of(&library, &layer_id);
        assert_eq!(
            after.coverage_cells, 0,
            "undoing the only import leaves no coverage"
        );

        // Deletion still removes the whole graph.
        library.delete_layer(&layer_id).expect("layer deletes");
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
                dense_envelope_cells: 1_000_000,
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
        let (job_id, staging) =
            stage_review(&library, &layer_id, std::slice::from_ref(&source), &cancel);
        assert!(staging.uncovered_cells > 0);
        let _ = job_id;
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
            )
            .unwrap();
        let (job_one, staging_one) =
            stage_review(&library, &layer_id, std::slice::from_ref(&first), &cancel);

        // Staging retained exactly one COG and no disposable second payload.
        let staged = &staging_one.sources[0];
        let retained = staged
            .source_cog
            .as_ref()
            .expect("staging retains a source COG");
        assert!(staged.raw_samples_path.as_os_str().is_empty());
        assert!(staged.valid_mask_path.as_os_str().is_empty());
        // Ownership: the COG is the job's own file until publication, and no
        // global asset exists yet.
        let job_cog = retained
            .resolve(&library.inner.paths, staged.job_id.as_deref())
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
        // The review read the source through its own effective rule.
        assert_eq!(staging_one.uncovered_cells, u64::from(width * height) - 2);
        assert_eq!(staging_one.overlap_cells, 0);

        library.prepare_apply(&job_one).expect("review accepted");
        let applied = apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
        assert!(applied.changed);

        // The interpretation references the shared digest, and no per-member
        // durable raw/mask/native.tif copy exists anywhere.
        let interpretation_id = format!("interp-{}", staged.interp_hash);
        {
            let connection = library.catalogue().unwrap();
            let (row, nodata) = catalogue::interpretation_cog(&connection, &interpretation_id)
                .unwrap()
                .expect("the interpretation references its retained COG");
            assert_eq!(row.sha256, retained.sha256);
            assert_eq!(nodata, Some(-9999.0));
        }
        let member_dir = member_prepared_dir(&library.inner.paths, &staged.interp_hash);
        assert!(!member_dir.exists(), "no legacy member payload is written");
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
        let manifest = read_generation_manifest(&head.manifest_json).unwrap();
        assert_eq!(manifest.format, GenerationStorageFormat::OrderedMembersV1);
        let (values, valid) = head_window(&reopened, &layer_id, window);
        assert_eq!(valid, first_valid, "validity is the source's own rule");
        assert_eq!(values, first_values, "Float32 values round-trip exactly");
        assert!(
            observability::tiles_decoded() > 0,
            "the committed reader decoded the retained source COG"
        );
        assert_eq!(
            tree_files(&root),
            before_read,
            "reading a published generation prepares nothing"
        );

        // A replacement publishes from its own retained source; the first
        // source's shared asset stays byte-identical.
        let shared_before = crate::services::lidar::raster_assets::hash_file(&asset).unwrap();
        let (job_two, staging_two) =
            stage_review(&reopened, &layer_id, std::slice::from_ref(&second), &cancel);
        let replacement = staging_two.sources[0]
            .source_cog
            .as_ref()
            .expect("the replacement retains its own COG");
        assert_ne!(
            replacement.sha256, retained.sha256,
            "different content is a different asset"
        );
        reopened.prepare_apply(&job_two).expect("review accepted");
        let replaced =
            apply_import(&reopened, &staging_two, false, true, &cancel).expect("replace applies");
        assert!(replaced.changed);
        let (values, valid) = head_window(&reopened, &layer_id, window);
        assert_eq!(valid, first_valid);
        assert_eq!(values, second_values);
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&asset).unwrap(),
            shared_before,
            "a retained asset is immutable"
        );

        // Undo removes the replacement and restores the first source exactly,
        // still from its own retained COG.
        let undone = undo_import(&reopened, &job_two, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let (values, valid) = head_window(&reopened, &layer_id, window);
        assert_eq!(valid, first_valid);
        assert_eq!(values, first_values, "undo restores the retained source");
        {
            let connection = reopened.catalogue().unwrap();
            let (row, _) = catalogue::interpretation_cog(&connection, &interpretation_id)
                .unwrap()
                .expect("the first reference survives undo");
            assert_eq!(row.sha256, retained.sha256);
        }
        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A member published before source retention keeps its raw/mask payload and
    /// replays beside a retained COG member: mixed history stays exact, and undo
    /// removes only the occurrence it names.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn legacy_and_retained_members_replay_together_and_undo_exactly() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-mixed-history"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        let (width, height) = (6u32, 5u32);
        let (first_values, first_valid) = oracle_grid(width, height);
        let first = write_oracle_fixture(
            &engine,
            &root,
            "legacy",
            0.0,
            100.0,
            width,
            height,
            -9999.0,
            &first_values,
        );
        let overlap_width = 3u32;
        let overlap_values: Vec<f32> = (0..(overlap_width * height))
            .map(|index| 40.0 + index as f32)
            .collect();
        let overlap = write_oracle_fixture(
            &engine,
            &root,
            "retained-overlap",
            0.0,
            100.0,
            overlap_width,
            height,
            -9999.0,
            &overlap_values,
        );

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "mixed history",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        // Stage the first source, then rewrite its job into the shape a
        // pre-retention import had: no retained COG, an explicit raw/mask pair.
        let (job_one, mut staging_one) =
            stage_review(&library, &layer_id, std::slice::from_ref(&first), &cancel);
        let job_dir = library.inner.paths.job_dir(&job_one);
        let raw = job_dir.join("values.raw");
        write_f32_raw(&raw, &first_values).expect("legacy samples write");
        let mask = job_dir.join("valid.bin");
        let mut legacy_mask = ValidMask::empty(width, height);
        for (index, valid) in first_valid.iter().enumerate() {
            if *valid == 1 {
                legacy_mask.set(index as u32 % width, index as u32 / width, true);
            }
        }
        legacy_mask.write_to(&mask).expect("legacy mask writes");
        {
            let source = &mut staging_one.sources[0];
            source.source_cog = None;
            source.raw_samples_path = raw;
            source.valid_mask_path = mask;
        }
        std::fs::write(
            job_dir.join("staging.json"),
            serde_json::to_string(&staging_one).unwrap(),
        )
        .unwrap();
        let staging_one: StagedImport =
            serde_json::from_str(&std::fs::read_to_string(job_dir.join("staging.json")).unwrap())
                .unwrap();

        // The preserved dense route records this member the old way.
        {
            let _dense = generation::chunked_publication::without_sparse();
            library.prepare_apply(&job_one).expect("review accepted");
            let applied = apply_import(&library, &staging_one, true, false, &cancel)
                .expect("the legacy member publishes");
            assert!(applied.changed);
        }
        let legacy_interp = format!("interp-{}", staging_one.sources[0].interp_hash);
        let legacy_dir =
            member_prepared_dir(&library.inner.paths, &staging_one.sources[0].interp_hash);
        {
            let connection = library.catalogue().unwrap();
            assert!(
                catalogue::interpretation_cog(&connection, &legacy_interp)
                    .unwrap()
                    .is_none(),
                "the first member predates retention"
            );
        }
        for name in ["values.raw", "valid.bin", "native.tif"] {
            assert!(
                legacy_dir.join(name).exists(),
                "the old member keeps {name}"
            );
        }
        let legacy_digest =
            crate::services::lidar::raster_assets::hash_file(&legacy_dir.join("values.raw"))
                .unwrap();

        // Publish the retained source over it: the head's history is now a
        // legacy payload and a retained COG at once.
        let (job_two, staging_two) =
            stage_review(&library, &layer_id, std::slice::from_ref(&overlap), &cancel);
        assert!(
            staging_two.sources[0].source_cog.is_some(),
            "the new member retains its COG"
        );
        library.prepare_apply(&job_two).expect("review accepted");
        let applied =
            apply_import(&library, &staging_two, false, true, &cancel).expect("sparse apply");
        assert!(applied.changed);
        let head = head_of(&library, &layer_id);
        assert_eq!(
            read_generation_manifest(&head.manifest_json)
                .unwrap()
                .format,
            GenerationStorageFormat::OrderedMembersV1,
            "a mixed history publishes an ordered composition"
        );
        let retained_interp = format!("interp-{}", staging_two.sources[0].interp_hash);
        {
            let connection = library.catalogue().unwrap();
            let members = catalogue::collection_members(&connection, &head.id).unwrap();
            assert_eq!(members.len(), 2, "both occurrences are recorded");
            assert_eq!(members[0].kind, "source");
            assert_eq!(
                members[0].interpretation_id.as_deref(),
                Some(retained_interp.as_str()),
                "the new source is topmost"
            );
            assert_eq!(members[1].kind, "previous-composition");
            assert!(
                members[1].base_generation_id.is_some(),
                "the pre-transition head is one indivisible bottom member"
            );
            assert!(
                catalogue::interpretation_cog(&connection, &retained_interp)
                    .unwrap()
                    .is_some(),
                "the new member references its retained COG"
            );
            assert!(
                catalogue::interpretation_cog(&connection, &legacy_interp)
                    .unwrap()
                    .is_some()
                    || catalogue::get_interpretation(&connection, &legacy_interp)
                        .unwrap()
                        .is_some(),
                "the preserved composition keeps its own interpretation"
            );
        }

        // A restart replays the legacy member from raw/mask and the retained
        // member from its COG, with no cell invented and no value shifted.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        let window = generation::LatticeWindow {
            x: 0,
            y: 0,
            width,
            height,
        };
        let (values, valid) = head_window(&reopened, &layer_id, window);
        for index in 0..(width * height) as usize {
            let column = index as u32 % width;
            let row = index as u32 / width;
            if column < overlap_width {
                // The topmost valid sample wins: the new source covers these
                // columns even where the preserved composition had no sample,
                // which is exactly what the superseded overlap-only rule could
                // not do.
                assert_eq!(valid[index], 1, "cell {index} is covered by the top source");
                assert_eq!(
                    values[index],
                    overlap_values[(row * overlap_width + column) as usize],
                    "cell ({column},{row})"
                );
                continue;
            }
            if first_valid[index] == 0 {
                assert_eq!(valid[index], 0, "cell {index} stays uncovered");
                continue;
            }
            assert_eq!(valid[index], 1, "cell {index} stays covered");
            assert_eq!(values[index], first_values[index], "cell ({column},{row})");
        }

        // Undo removes the retained occurrence and restores the legacy member
        // untouched, still from its own raw/mask payload.
        let undone = undo_import(&reopened, &job_two, &cancel).expect("undo publishes");
        assert!(undone.changed);
        let (values, valid) = head_window(&reopened, &layer_id, window);
        assert_eq!(valid, first_valid);
        assert_eq!(values, first_values, "undo restores the legacy member");
        assert!(legacy_dir.join("values.raw").exists());
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&legacy_dir.join("values.raw"))
                .unwrap(),
            legacy_digest,
            "undo never rewrites a legacy payload"
        );
        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An Apply that fails after its review publishes nothing, and a shared
    /// asset another publication already references survives exactly as it was.
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
            )
            .unwrap();

        // One small source published normally: its COG is now a shared asset.
        let small = write_placed_fixture(&engine, &root, "small", 0.0, 4.0, 4, 4, -9999.0, 3.0);
        let (job_one, staging_one) =
            stage_review(&library, &layer_id, std::slice::from_ref(&small), &cancel);
        let retained = staging_one.sources[0]
            .source_cog
            .clone()
            .expect("the published source retains its COG");
        library.prepare_apply(&job_one).expect("review accepted");
        let applied = apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
        assert!(applied.changed);
        let asset = library.inner.paths.asset_cog(&retained.sha256);
        let shared_digest = crate::services::lidar::raster_assets::hash_file(&asset).unwrap();
        let head_before = head_of(&library, &layer_id);

        // A second job reuses the same file and is cancelled before it
        // publishes: nothing changes and the shared asset is untouched.
        let (job_two, staging_two) =
            stage_review(&library, &layer_id, std::slice::from_ref(&small), &cancel);
        assert_eq!(
            staging_two.sources[0]
                .source_cog
                .as_ref()
                .expect("the same content retains the same digest")
                .sha256,
            retained.sha256,
            "content addressing reuses the admitted asset"
        );
        library.prepare_apply(&job_two).expect("review accepted");
        cancel.store(true, Ordering::Relaxed);
        let cancelled = apply_import(&library, &staging_two, true, false, &cancel)
            .expect_err("a cancelled Apply publishes nothing");
        assert!(cancelled.contains("cancelled"), "{cancelled}");
        cancel.store(false, Ordering::Relaxed);
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&asset).unwrap(),
            shared_digest,
            "a cancelled Apply never touches a shared asset"
        );
        assert_eq!(head_of(&library, &layer_id).id, head_before.id);

        // A third job reuses that file beside a far source, staged under a
        // raised envelope so staging itself succeeds.
        let far = write_placed_fixture(&engine, &root, "far", 5004.0, 5004.0, 4, 4, -9999.0, 7.0);
        let (job_three, staging_three) = {
            let _raised = admission::limits_probe::raise(u64::MAX / 2, 16, 512 * 1024 * 1024);
            stage_review(&library, &layer_id, &[small.clone(), far], &cancel)
        };
        assert_eq!(
            staging_three.sources[0]
                .source_cog
                .as_ref()
                .expect("the reused source keeps its digest")
                .sha256,
            retained.sha256
        );
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

        // The review accepted the pair under the override; Apply rechecks the
        // production envelope and refuses before publishing anything.
        library.prepare_apply(&job_three).expect("review accepted");
        let error = apply_import(&library, &staging_three, true, false, &cancel)
            .expect_err("the envelope is rechecked at Apply");
        assert!(error.contains("import publication"), "{error}");
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
            crate::services::lidar::raster_assets::hash_file(&asset).unwrap(),
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

    /// Two single-cell sources a million cells apart: the review composes only
    /// the occupied blocks, so its work does not grow with the empty gap, and
    /// adjacent placement costs the same visit count.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_review_visits_only_occupied_blocks() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-lazy-review"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "lazy review",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        let west = write_cell_fixture(&engine, &root, "west", 0.0, 1.0, 5.0);
        let far = write_cell_fixture(&engine, &root, "far", 1_000_000.0, 1.0, 5.0);
        review_probe::reset();
        let (_job, staging) = stage_review(&library, &layer_id, &[west.clone(), far], &cancel);
        assert_eq!(staging.union_grid.width, 1_000_001);
        assert_eq!(staging.union_grid.height, 1);
        assert_eq!(staging.uncovered_cells, 2, "two incoming cells");
        assert_eq!(staging.overlap_cells, 0);
        assert_eq!(
            staging.invalid_cells,
            1_000_001 - 2,
            "the gap is arithmetic, not a walk"
        );
        let far_blocks = review_probe::blocks();
        // The west cell lies in one lattice block; the far source's occupied
        // region block is 1024 cells wide starting at its own origin, so it
        // straddles two lattice blocks. Either way the visit count is a handful,
        // not the 977 envelope windows that contain no data.
        assert_eq!(far_blocks, 3, "occupied blocks only: {far_blocks}");
        assert!(
            review_probe::pages() <= 8,
            "at most four translated pages per admitted source: {}",
            review_probe::pages()
        );

        // The same two cells adjacent: both occupy one block, so the visit
        // count does not depend on the distance between them.
        let adjacent = write_cell_fixture(&engine, &root, "adjacent", 1.0, 1.0, 5.0);
        let layer_two = library
            .create_layer(
                "lazy review adjacent",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        review_probe::reset();
        let (_job_two, staging_two) =
            stage_review(&library, &layer_two, &[west, adjacent], &cancel);
        assert_eq!(staging_two.union_grid.width, 2);
        assert_eq!(staging_two.uncovered_cells, 2);
        let adjacent_blocks = review_probe::blocks();
        assert!(
            adjacent_blocks <= 4,
            "two occupied region blocks touch at most four lattice blocks: {adjacent_blocks}"
        );

        // The same file selected twice: one coordinate, visited once.
        let layer_duplicate = library
            .create_layer(
                "lazy review duplicate",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        review_probe::reset();
        let duplicate = write_cell_fixture(&engine, &root, "duplicate", 0.0, 1.0, 5.0);
        let (_job_duplicate, staging_duplicate) = stage_review(
            &library,
            &layer_duplicate,
            &[duplicate.clone(), duplicate],
            &cancel,
        );
        assert_eq!(
            staging_duplicate.uncovered_cells, 1,
            "an overlapping member does not count twice"
        );
        assert_eq!(
            review_probe::blocks(),
            1,
            "duplicate occupied coordinates are visited once"
        );

        // Ten times farther apart: the visit count is the same, so gap length
        // does not drive review work.
        let layer_three = library
            .create_layer(
                "lazy review far",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let farther = write_cell_fixture(&engine, &root, "farther", 10_000_000.0, 1.0, 5.0);
        review_probe::reset();
        let (_job_three, staging_three) = stage_review(
            &library,
            &layer_three,
            &[
                write_cell_fixture(&engine, &root, "near-zero", 0.0, 1.0, 5.0),
                farther,
            ],
            &cancel,
        );
        assert_eq!(staging_three.union_grid.width, 10_000_001);
        assert_eq!(staging_three.uncovered_cells, 2);
        assert_eq!(
            review_probe::blocks(),
            far_blocks,
            "the gap grew tenfold and the visits did not"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The decision preview keeps the accepted head in Before and shows the
    /// selected composition in After: replacing 5 with 9 must not rewrite
    /// Before, and accepted-only coverage stays visible in both.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_review_previews_keep_accepted_values_before_the_change() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-preview-before"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "preview before",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        // An accepted 4x4 block of 5 next to a cell the change never touches.
        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let untouched =
            write_placed_fixture(&engine, &root, "untouched", 8.0, 4.0, 1, 1, -9999.0, 5.0);
        let (job, staging) =
            stage_review(&library, &layer_id, &[accepted.clone(), untouched], &cancel);
        library.prepare_apply(&job).expect("review accepted");
        let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
        assert!(applied.changed);

        // A replacement over the accepted block only.
        let replacement =
            write_placed_fixture(&engine, &root, "replacement", 0.0, 4.0, 4, 4, -9999.0, 9.0);
        let (job_two, _staging_two) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&replacement),
            &cancel,
        );
        review_probe::reset();
        let preview = library
            .preview_import_decision(&job_two)
            .expect("decision preview");
        assert!(
            review_probe::blocks() >= 1,
            "the preview reuses the occupied traversal"
        );
        let before_path = preview
            .before_preview_path
            .as_deref()
            .expect("an accepted head has a before preview");
        let ramp = ColorRamp::elevation_range(5.0, 9.0);
        let before = decode_preview(Path::new(before_path));
        let after = decode_preview(Path::new(&preview.after_preview_path));
        for pixel in &before {
            assert_eq!(
                *pixel,
                ramp.colour_for(5.0).expect("ramp covers 5"),
                "the before preview shows the accepted value"
            );
        }
        for pixel in &after {
            assert_eq!(
                *pixel,
                ramp.colour_for(9.0).expect("ramp covers 9"),
                "the after preview shows the selected replacement"
            );
        }
        assert!(
            !before.is_empty() && !after.is_empty(),
            "both previews paint the covered area"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Read the painted RGB of one preview PNG, ignoring transparent pixels.
    fn decode_preview(path: &Path) -> Vec<(u8, u8, u8)> {
        let bytes = std::fs::read(path).expect("preview png exists");
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
            .expect("preview decodes")
            .to_rgba8();
        image
            .pixels()
            .filter(|pixel| pixel.0[3] != 0)
            .map(|pixel| (pixel.0[0], pixel.0[1], pixel.0[2]))
            .collect()
    }

    /// Overlapping members count once, invalid incoming cells never erase
    /// accepted values, replacement adds no coverage by itself, and an
    /// extension into negative lattice cells is visited and counted.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_review_counts_once_and_keeps_accepted_values_under_invalid_input() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-review-invalid"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "review invalid",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        // Accepted 4x4 head of 5.
        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let (job, staging) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job).expect("review accepted");
        apply_import(&library, &staging, true, false, &cancel).expect("apply");

        // An incoming candidate that is valid only in half its cells, selected
        // twice so the overlap is exact.
        let mut values = vec![9.0f32; 16];
        for value in values.iter_mut().take(8) {
            *value = -9999.0;
        }
        let incoming =
            write_oracle_fixture(&engine, &root, "incoming", 0.0, 4.0, 4, 4, -9999.0, &values);
        review_probe::reset();
        let (_job_duplicate, staging_duplicate) = stage_review(
            &library,
            &layer_id,
            &[incoming.clone(), incoming.clone()],
            &cancel,
        );
        assert_eq!(
            staging_duplicate.uncovered_cells, 0,
            "the accepted head covers every valid incoming cell"
        );
        assert_eq!(
            staging_duplicate.overlap_cells, 8,
            "eight valid incoming cells, counted once each"
        );
        assert_eq!(
            staging_duplicate.invalid_cells,
            u64::from(staging_duplicate.union_grid.width)
                * u64::from(staging_duplicate.union_grid.height)
                - 8,
            "invalid is envelope arithmetic minus unique valid incoming cells"
        );
        assert!(
            review_probe::blocks() <= 4,
            "one occupied block area: {}",
            review_probe::blocks()
        );

        // The decision preview keeps the accepted 5 where the input is invalid.
        let (job_two, staging_two) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&incoming),
            &cancel,
        );
        let preview = library
            .preview_import_decision(&job_two)
            .expect("decision preview");
        let before = decode_preview(Path::new(
            preview
                .before_preview_path
                .as_deref()
                .expect("before preview"),
        ));
        let after = decode_preview(Path::new(&preview.after_preview_path));
        let ramp = ColorRamp::elevation_range(5.0, 9.0);
        assert!(
            before.contains(&ramp.colour_for(5.0).expect("ramp covers 5")),
            "the before preview shows the accepted value"
        );
        assert!(
            after.contains(&ramp.colour_for(9.0).expect("ramp covers 9")),
            "the after preview shows the selected value where the input is valid"
        );
        assert!(
            after.contains(&ramp.colour_for(5.0).expect("ramp covers 5")),
            "invalid input leaves the accepted value in place"
        );

        library.prepare_apply(&job_two).expect("review accepted");
        let replaced = apply_import(&library, &staging_two, false, true, &cancel)
            .expect("replace-overlap applies");
        assert!(replaced.changed);
        let head = head_of(&library, &layer_id);
        assert_eq!(head.coverage_cells, 16, "replacement adds no new coverage");
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
        for (index, value) in values.iter().enumerate() {
            assert_eq!(*value, if index < 8 { 5.0 } else { 9.0 }, "cell {index}");
        }

        // An extension into negative lattice cells is discovered from its own
        // occupied region, not by walking the widened envelope.
        let extension =
            write_placed_fixture(&engine, &root, "extension", -4.0, 4.0, 4, 4, -9999.0, 7.0);
        review_probe::reset();
        let (job_three, staging_three) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&extension),
            &cancel,
        );
        assert_eq!(staging_three.uncovered_cells, 16);
        assert_eq!(staging_three.overlap_cells, 0);
        assert!(
            review_probe::blocks() <= 8,
            "negative extension stays a handful of blocks: {}",
            review_probe::blocks()
        );
        library.prepare_apply(&job_three).expect("review accepted");
        let extended = apply_import(&library, &staging_three, true, false, &cancel).expect("apply");
        assert!(extended.changed);
        assert_eq!(head_of(&library, &layer_id).coverage_cells, 32);

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// More occupied coordinates than two pages: the review streams bounded
    /// pages, deduplicates, cancels cleanly and succeeds on the next healthy
    /// call.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn sparse_review_pages_many_occupied_regions_and_survives_cancellation() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-review-pages"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "review pages",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let (job, staging) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job).expect("review accepted");
        apply_import(&library, &staging, true, false, &cancel).expect("apply");

        let incoming =
            write_placed_fixture(&engine, &root, "incoming", 0.0, 4.0, 4, 4, -9999.0, 9.0);
        let (_job_two, staging_two) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&incoming),
            &cancel,
        );
        // Seed more than two pages of occupied coordinates for this source on
        // top of its real one: the same rows the review streams, no new shape.
        let interpretation_id = format!("interp-{}", staging_two.sources[0].interp_hash);
        {
            let connection = library.catalogue().unwrap();
            for block_x in 4_000..4_600 {
                connection
                    .execute(
                        "INSERT OR REPLACE INTO lidar_interpretation_regions(
                            interpretation_id, block_x, block_y, valid_cells, min_value,
                            max_value, sum_value)
                         VALUES(?1, ?2, 0, 1, 9.0, 9.0, 9.0)",
                        rusqlite::params![interpretation_id, block_x],
                    )
                    .unwrap();
            }
        }
        review_probe::reset();
        let preview = render_composition_preview(&library, &staging_two, &cancel)
            .expect("decision preview over many occupied regions");
        let pages = review_probe::pages();
        assert!(
            pages >= 3,
            "601 occupied coordinates need at least three bounded pages: {pages}"
        );
        assert!(
            review_probe::blocks() >= 601,
            "every occupied coordinate is visited: {}",
            review_probe::blocks()
        );
        assert!(
            !decode_preview(Path::new(&preview.after_preview_path)).is_empty(),
            "the preview still paints the accepted coverage"
        );

        // Cancellation stops the walk cleanly, and the next healthy call works.
        cancel.store(true, Ordering::Relaxed);
        assert!(
            render_composition_preview(&library, &staging_two, &cancel).is_err(),
            "a cancelled review stops between pages"
        );
        cancel.store(false, Ordering::Relaxed);
        let preview = render_composition_preview(&library, &staging_two, &cancel)
            .expect("the same review succeeds after cancellation");
        assert!(!decode_preview(Path::new(&preview.after_preview_path)).is_empty());

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // BG7: job-owned source COGs, promotion journals and recovery
    // -----------------------------------------------------------------------

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

    /// Journal contents by path, for assertions after the library is dropped.
    fn journal_of_paths(paths: &LidarPaths, job_id: &str) -> Option<PromotionJournal> {
        std::fs::read_to_string(promotion_journal_path(paths, job_id))
            .ok()
            .map(|json| serde_json::from_str(&json).expect("journal parses"))
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
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        // 1. An accepted generation, so the layer has history to protect.
        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
        let accepted_hash = staging_one.sources[0].interp_hash.clone();
        let accepted_asset = committed_asset(&library, &accepted_hash).expect("committed");
        let head_before = head_of(&library, &layer_id);

        // 2. A new source: promotion then an injected failure before the
        // transaction. Its asset and reference must not survive; the accepted
        // asset must.
        let fresh = write_placed_fixture(&engine, &root, "fresh", 16.0, 8.0, 4, 4, -9999.0, 9.0);
        let (job_two, staging_two) =
            stage_review(&library, &layer_id, std::slice::from_ref(&fresh), &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        let fresh_hash = staging_two.sources[0].interp_hash.clone();
        let fresh_cog = staging_two.sources[0]
            .source_cog
            .clone()
            .expect("retained COG");
        let fresh_asset = paths.asset_cog(&fresh_cog.sha256);
        promotion_probe::fail_at(FaultPoint::BeforeTransaction);
        let error = apply_import(&library, &staging_two, true, false, &cancel)
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
                .resolve(&paths, staging_two.sources[0].job_id.as_deref())
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
        let applied = apply_import(&library, &staging_two, true, false, &cancel).expect("apply");
        assert!(applied.changed);
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
        let (job_reuse, staging_reuse) =
            stage_review(&library, &layer_id, &[accepted.clone(), reuse_new], &cancel);
        library.prepare_apply(&job_reuse).expect("review accepted");
        let reuse_new_hash = staging_reuse.sources[1].interp_hash.clone();
        let reuse_new_asset = paths.asset_cog(
            &staging_reuse.sources[1]
                .source_cog
                .as_ref()
                .expect("retained COG")
                .sha256,
        );
        promotion_probe::fail_at(FaultPoint::BeforeTransaction);
        let _ = apply_import(&library, &staging_reuse, true, false, &cancel)
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
        library.prepare_apply(&job_three).expect("review accepted");
        let third_hash = staging_three.sources[0].interp_hash.clone();
        let third_cog = staging_three.sources[0]
            .source_cog
            .clone()
            .expect("retained COG");
        promotion_probe::fail_at(FaultPoint::AfterCommitBeforeCleanup);
        let committed = apply_import(&library, &staging_three, true, false, &cancel)
            .expect("a committed publication is success even when cleanup fails");
        promotion_probe::clear();
        assert!(committed.changed);
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
            &layer_id,
            generation::LatticeWindow {
                x: 32,
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

    /// Recovery is idempotent at each interruption point: an intent without a
    /// file removes nothing, an uncommitted promotion is removed, a committed
    /// one is kept, and an unresolvable journal is retained rather than
    /// silently declared clean.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn promotion_recovery_is_idempotent_at_every_interruption_point() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-promotion-recovery"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "promotion recovery",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let paths = &library.inner.paths;
        let source = write_placed_fixture(&engine, &root, "source", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_id, staging) =
            stage_review(&library, &layer_id, std::slice::from_ref(&source), &cancel);
        let cog = staging.sources[0].source_cog.clone().expect("retained COG");
        let local = cog
            .resolve(paths, staging.sources[0].job_id.as_deref())
            .expect("job-local COG");
        assert!(local.exists());

        // Intent recorded, promotion never happened: recovery finds no file and
        // simply settles the journal.
        let destination = paths.asset_cog(&cog.sha256);
        let relative = destination
            .strip_prefix(paths.root())
            .unwrap()
            .to_string_lossy()
            .into_owned();
        write_promotion_journal(
            paths,
            &job_id,
            &PromotionJournal {
                entries: vec![PromotionEntry {
                    interpretation_id: format!("interp-{}", staging.sources[0].interp_hash),
                    sha256: cog.sha256.clone(),
                    destination: relative.clone(),
                    witness: None,
                }],
            },
        )
        .unwrap();
        let removed =
            reconcile_promotion_journals(&library, std::slice::from_ref(&job_id)).unwrap();
        assert_eq!(removed, 0, "nothing was promoted, so nothing is removed");
        assert!(journal_of(&library, &job_id).is_none());
        assert!(local.exists(), "the job-local COG is untouched");

        // Promotion happened, the transaction never did: recovery removes the
        // uncommitted asset and keeps the job's own file.
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::hard_link(&local, &destination).unwrap();
        // The journal records the job-local file it linked, which is what
        // licenses deleting the destination later.
        let witness = cog
            .relative_path
            .clone()
            .expect("a staged COG records its job-relative location");
        write_promotion_journal(
            paths,
            &job_id,
            &PromotionJournal {
                entries: vec![PromotionEntry {
                    interpretation_id: format!("interp-{}", staging.sources[0].interp_hash),
                    sha256: cog.sha256.clone(),
                    destination: relative.clone(),
                    witness: Some(witness),
                }],
            },
        )
        .unwrap();
        let removed =
            reconcile_promotion_journals(&library, std::slice::from_ref(&job_id)).unwrap();
        assert_eq!(removed, 1, "the uncommitted promotion is removed");
        assert!(!destination.exists());
        assert!(local.exists());
        assert!(journal_of(&library, &job_id).is_none());

        // A journal that cannot be resolved is retained, never declared clean.
        write_promotion_journal(
            paths,
            &job_id,
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
        let error = reconcile_promotion_journals(&library, std::slice::from_ref(&job_id))
            .expect_err("an escaping destination is refused");
        assert!(error.contains("leaves its owning root"), "{error}");
        assert!(
            journal_of(&library, &job_id).is_some(),
            "recoverable evidence is retained for retry"
        );
        let _ = std::fs::remove_file(promotion_journal_path(paths, &job_id));

        // Two awaiting-review jobs with the same content stay independent: one
        // being settled never touches the other's payload.
        let layer_two = library
            .create_layer(
                "promotion recovery two",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (job_a, staging_a) =
            stage_review(&library, &layer_two, std::slice::from_ref(&source), &cancel);
        let (job_b, staging_b) =
            stage_review(&library, &layer_two, std::slice::from_ref(&source), &cancel);
        assert_ne!(job_a, job_b);
        let local_a = staging_a.sources[0]
            .source_cog
            .as_ref()
            .unwrap()
            .resolve(paths, staging_a.sources[0].job_id.as_deref())
            .unwrap();
        let local_b = staging_b.sources[0]
            .source_cog
            .as_ref()
            .unwrap()
            .resolve(paths, staging_b.sources[0].job_id.as_deref())
            .unwrap();
        assert!(local_a.exists() && local_b.exists());
        assert_ne!(local_a, local_b, "each job owns its own prepared file");
        let _ = std::fs::remove_dir_all(paths.job_dir(&job_a));
        assert!(
            local_b.exists(),
            "settling one job never removes another job's payload"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A job awaiting review survives a restart and publishes without another
    /// preparation, including when an older staged job has no job-local record.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn awaiting_review_jobs_survive_restart_and_old_staged_jobs_stay_readable() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-await-review"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "await review",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let source = write_placed_fixture(&engine, &root, "awaiting", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_id, staging) =
            stage_review(&library, &layer_id, std::slice::from_ref(&source), &cancel);
        let cog = staging.sources[0].source_cog.clone().expect("retained COG");
        let local = cog
            .resolve(&paths, staging.sources[0].job_id.as_deref())
            .expect("job-local COG");
        let digest = crate::services::lidar::raster_assets::hash_file(&local).unwrap();

        // Restart with the job still awaiting review.
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        let staged_json = std::fs::read_to_string(paths.job_dir(&job_id).join("staging.json"))
            .expect("staging survives the restart");
        let restaged: StagedImport = serde_json::from_str(&staged_json).unwrap();
        {
            let connection = reopened.catalogue().unwrap();
            let state = catalogue::get_import_job(&connection, &job_id)
                .unwrap()
                .expect("the job row survives")
                .state;
            assert_eq!(state, "awaiting_review");
        }
        assert!(local.exists(), "the job keeps its own prepared COG");
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&local).unwrap(),
            digest,
            "no re-preparation happened"
        );
        let preview = render_composition_preview(&reopened, &restaged, &cancel)
            .expect("the review still previews without re-preparing");
        assert!(preview.after_preview_path.ends_with(".png"));

        reopened.prepare_apply(&job_id).expect("review accepted");
        let applied =
            apply_import(&reopened, &restaged, true, false, &cancel).expect("apply after restart");
        assert!(applied.changed);
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
        assert!(values.iter().all(|value| *value == 5.0));

        // An older staged job (no job-local record) reads the global digest
        // non-owningly, and a failed publication never deletes it.
        let historic =
            write_placed_fixture(&engine, &root, "historic", 16.0, 8.0, 4, 4, -9999.0, 9.0);
        let (job_old, mut staging_old) = stage_review(
            &reopened,
            &layer_id,
            std::slice::from_ref(&historic),
            &cancel,
        );
        let old_cog = staging_old.sources[0]
            .source_cog
            .clone()
            .expect("retained COG");
        let old_local = old_cog
            .resolve(&paths, staging_old.sources[0].job_id.as_deref())
            .unwrap();
        let global = paths.asset_cog(&old_cog.sha256);
        std::fs::create_dir_all(global.parent().unwrap()).unwrap();
        std::fs::hard_link(&old_local, &global).unwrap();
        // Present the pre-BG7 shape: a global digest and no job-local location.
        let source_row = &mut staging_old.sources[0];
        source_row.job_id = None;
        source_row.source_cog = Some(RetainedSourceCog {
            relative_path: None,
            ..old_cog.clone()
        });
        std::fs::write(
            paths.job_dir(&job_old).join("staging.json"),
            serde_json::to_string(&staging_old).unwrap(),
        )
        .unwrap();
        let staging_old: StagedImport = serde_json::from_str(
            &std::fs::read_to_string(paths.job_dir(&job_old).join("staging.json")).unwrap(),
        )
        .unwrap();
        assert!(
            staging_old.sources[0]
                .source_cog
                .as_ref()
                .unwrap()
                .resolve(&paths, None)
                .unwrap()
                .exists(),
            "an old staged job reads the global digest"
        );
        reopened.prepare_apply(&job_old).expect("review accepted");
        let applied =
            apply_import(&reopened, &staging_old, true, false, &cancel).expect("old job applies");
        assert!(applied.changed);
        assert!(
            global.exists(),
            "the reused global asset is never deleted by an old-format job"
        );

        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A refused or cancelled staging owns nothing durable: no global asset, no
    /// journal, no settled job payload, and untouched originals and head.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn refused_or_cancelled_staging_leaves_no_owned_payloads() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-stage-ownership"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "stage ownership",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let paths = library.inner.paths.clone();

        // Two individually small sources whose union is over the envelope: the
        // COGs are prepared first, then the union is refused.
        let west = write_placed_fixture(&engine, &root, "west", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let east = write_placed_fixture(&engine, &root, "east", 5004.0, 5004.0, 4, 4, -9999.0, 5.0);
        let digest_before = crate::services::lidar::raster_assets::hash_file(&west).unwrap();
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        let error = stage_import(
            &library,
            &job_id,
            &layer_id,
            &[west.clone(), east.clone()],
            &cancel,
        )
        .expect_err("the union envelope is refused");
        assert!(error.contains("import envelope limit"), "{error}");
        library.finish_staging(&job_id, Err(error));
        let assets: Vec<_> = std::fs::read_dir(paths.asset_dir(""))
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(assets.is_empty(), "no asset is admitted: {assets:?}");
        assert!(
            !paths.job_dir(&job_id).exists(),
            "a refused job leaves no owned payload"
        );
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&west).unwrap(),
            digest_before,
            "the original bytes are untouched"
        );
        assert_eq!(
            library.inner.paths.root(),
            paths.root(),
            "the library root is unchanged"
        );

        // Cancellation after the COG exists: the job owns the file until it is
        // settled, and settling removes it.
        let cancelled_source =
            write_placed_fixture(&engine, &root, "cancelled", 0.0, 4.0, 4, 4, -9999.0, 7.0);
        let job_two = library.record_import_job(&layer_id).expect("job recorded");
        stage_import(
            &library,
            &job_two,
            &layer_id,
            std::slice::from_ref(&cancelled_source),
            &cancel,
        )
        .expect("staging completes");
        let staged: StagedImport = serde_json::from_str(
            &std::fs::read_to_string(paths.job_dir(&job_two).join("staging.json")).unwrap(),
        )
        .unwrap();
        let cog = staged.sources[0].source_cog.clone().expect("retained COG");
        let local = cog
            .resolve(&paths, staged.sources[0].job_id.as_deref())
            .expect("job-local COG");
        assert!(local.exists(), "the job owns its prepared COG");
        library.finish_staging(&job_two, Err("cancelled".to_string()));
        assert!(!local.exists(), "a cancelled job leaves no payload behind");
        assert!(!paths.asset_cog(&cog.sha256).exists());
        assert!(journal_of(&library, &job_two).is_none());

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // BG6-A: globally ordered transformed coverage
    // -----------------------------------------------------------------------

    /// A staged source in the shape the traversal reads, without raster files:
    /// the iterator tests below author the occupied index directly.
    fn traversal_source(interp_hash: &str, origin_x: f64, origin_y: f64) -> StagedSource {
        StagedSource {
            filename: format!("{interp_hash}.tif"),
            sha256: format!("sha-{interp_hash}"),
            managed_original: PathBuf::new(),
            interp_hash: interp_hash.to_string(),
            width: 1024,
            height: 1024,
            geotransform: [origin_x, 1.0, 0.0, origin_y, 0.0, -1.0],
            crs_wkt: "EPSG:3857".to_string(),
            nodata: Some(-9999.0),
            value_range: [0.0, 0.0],
            valid_cells: Some(1024 * 1024),
            size_bytes: 0,
            job_id: None,
            source_cog: None,
            valid_mask_path: PathBuf::new(),
            raw_samples_path: PathBuf::new(),
            compatible: true,
            issues: Vec::new(),
        }
    }

    /// Seed one source's occupied-region index.
    fn seed_regions(library: &LidarLibrary, interp_hash: &str, blocks: &[(i64, i64)]) {
        let connection = library.catalogue().unwrap();
        let interpretation_id = format!("interp-{interp_hash}");
        let sha = format!("sha-{interp_hash}");
        connection
            .execute(
                "INSERT INTO lidar_sources(sha256, original_filename, size_bytes, probe_json, imported_at)
                 VALUES(?1, 'authored.tif', 4, '{}', '2026-01-01T00:00:00Z')
                 ON CONFLICT(sha256) DO NOTHING",
                rusqlite::params![sha],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_interpretations(
                    id, source_sha256, band_index, measurement_kind, units, scale, offset,
                    crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                 VALUES(?1, ?2, 1, 'ground-elevation', 'm', 1, 0,
                    'EPSG:3857', 'unspecified', -9999, '[0,1,0,0,0,-1]', 1024, 1024, ?3)
                 ON CONFLICT(interp_hash) DO NOTHING",
                rusqlite::params![interpretation_id, sha, interp_hash],
            )
            .unwrap();
        let rows: Vec<(i64, i64, i64, f64, f64, f64)> = blocks
            .iter()
            .map(|(block_x, block_y)| (*block_x, *block_y, 4, 0.0, 1.0, 2.0))
            .collect();
        catalogue::replace_interpretation_regions(&connection, &interpretation_id, &rows).unwrap();
    }

    /// Every coordinate one traversal emits, in order.
    fn traversal_blocks(
        library: &LidarLibrary,
        lattice: &RasterGrid,
        source: &StagedSource,
    ) -> Vec<(i64, i64)> {
        let head = HeadBlockSource::None;
        let cancel = AtomicBool::new(false);
        let mut traversal =
            ReviewTraversal::open(&head, std::slice::from_ref(&source), lattice, library)
                .expect("traversal opens");
        let mut blocks = Vec::new();
        while let Some(block) = traversal.next_block(library, &cancel).expect("next block") {
            blocks.push(block);
        }
        blocks
    }

    /// The counterexample the review found: 257 regions in one row, an offset
    /// that expands each source block into two lattice rows, and a page boundary
    /// in the middle. Every expanded coordinate must appear exactly once, in
    /// order — the earlier per-page sort-and-discard dropped `(0, 256)`.
    #[test]
    fn transformed_region_pages_are_globally_ordered() {
        let root = std::env::temp_dir().join(new_id("canopi-transformed-pages"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let lattice = RasterGrid {
            width: 1024,
            height: 1024,
            geotransform: [0.0, 1.0, 0.0, 0.0, 0.0, -1.0],
        };

        // Control: an aligned source keeps one coordinate per region.
        let aligned = traversal_source("aligned", 0.0, 0.0);
        seed_regions(
            &library,
            "aligned",
            &(0..257).map(|x| (x, 0)).collect::<Vec<_>>(),
        );
        let blocks = traversal_blocks(&library, &lattice, &aligned);
        assert_eq!(blocks.len(), 257, "one lattice block per aligned region");
        assert!(blocks.windows(2).all(|pair| pair[0] < pair[1]));

        // The counterexample: one cell below the lattice origin, so each source
        // block covers two lattice rows, split across a 256-record page.
        let offset = traversal_source("offset", 0.0, -1.0);
        seed_regions(
            &library,
            "offset",
            &(0..257).map(|x| (x, 0)).collect::<Vec<_>>(),
        );
        let blocks = traversal_blocks(&library, &lattice, &offset);
        let mut expected: Vec<(i64, i64)> = (0..257).flat_map(|x| [(0, x), (1, x)]).collect();
        expected.sort_unstable();
        assert_eq!(
            blocks, expected,
            "all 514 expanded coordinates, in order, exactly once"
        );
        assert!(
            blocks.contains(&(0, 256)),
            "the coordinate the discard rule dropped is present"
        );

        // Both axes non-aligned: each region expands to four lattice blocks.
        // Offsets are (origin_x - lattice_x, lattice_top - origin_y): negative
        // on both axes here, so both remainders are non-zero.
        let both = traversal_source("both", -3.0, 5.0);
        seed_regions(
            &library,
            "both",
            &(0..257).map(|x| (x, 0)).collect::<Vec<_>>(),
        );
        let blocks = traversal_blocks(&library, &lattice, &both);
        let mut expected: Vec<(i64, i64)> = (0..257)
            .flat_map(|x| {
                let qx = (-3i64).div_euclid(1024);
                let rx = (-3i64).rem_euclid(1024);
                let qy = (-5i64).div_euclid(1024);
                let ry = (-5i64).rem_euclid(1024);
                let dxs: Vec<i64> = if rx == 0 { vec![0] } else { vec![0, 1] };
                let dys: Vec<i64> = if ry == 0 { vec![0] } else { vec![0, 1] };
                dys.iter()
                    .flat_map(|dy| dxs.iter().map(move |dx| (qy + dy, x + qx + dx)))
                    .collect::<Vec<_>>()
            })
            .collect();
        expected.sort_unstable();
        expected.dedup();
        assert_eq!(blocks, expected, "negative two-axis offset stays exact");

        // Duplicate coordinates from two sources are visited once.
        let head = HeadBlockSource::None;
        let cancel = AtomicBool::new(false);
        let duplicate = traversal_source("duplicate", 0.0, 0.0);
        seed_regions(&library, "duplicate", &[(0, 0), (1, 0)]);
        let mut traversal =
            ReviewTraversal::open(&head, &[&aligned, &duplicate], &lattice, &library)
                .expect("traversal opens");
        let mut shared = Vec::new();
        while let Some(block) = traversal.next_block(&library, &cancel).expect("next") {
            shared.push(block);
        }
        assert_eq!(
            shared.iter().filter(|block| **block == (0, 0)).count(),
            1,
            "a coordinate two sources occupy is visited once"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A real source wider than one index page, placed one cell below the layer
    /// anchor: every incoming cell must reach the review classification and the
    /// far end must appear in the decision preview with the authored value.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn wide_transformed_source_reviews_every_cell() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-wide-review"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "wide review",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();

        // The anchor fixes the layer lattice at world (0, 4), 4x4 cells.
        let anchor = write_placed_fixture(&engine, &root, "anchor", 0.0, 4.0, 4, 4, -9999.0, 5.0);
        let (job_anchor, staging_anchor) =
            stage_review(&library, &layer_id, std::slice::from_ref(&anchor), &cancel);
        library.prepare_apply(&job_anchor).expect("review accepted");
        apply_import(&library, &staging_anchor, true, false, &cancel).expect("anchor publishes");

        // 257 index regions in one source row, one cell below the anchor, so the
        // source origin is not lattice-aligned on the y axis. The sentinel block
        // sits in the middle and the final index page stays fully valid, so
        // dropping that page loses authored coverage from the count and the
        // published values rather than merely omitting an all-NoData block.
        let width = 263_168usize;
        let sentinel_block = 128usize;
        let mut values = vec![7.0f32; width];
        for value in values.iter_mut().skip(sentinel_block * 1024).take(1024) {
            *value = -9999.0;
        }
        let wide = write_oracle_fixture(
            &engine,
            &root,
            "wide",
            0.0,
            0.0,
            width as u32,
            1,
            -9999.0,
            &values,
        );
        review_probe::reset();
        let (job, staging) = stage_review(&library, &layer_id, &[wide], &cancel);
        assert_eq!(staging.union_grid.width, width as u32);
        assert_eq!(staging.union_grid.height, 5);
        let incoming = u64::try_from(width - 1024).unwrap();
        assert_eq!(
            staging.uncovered_cells, incoming,
            "every authored finite cell is incoming coverage, including the final page"
        );
        assert_eq!(staging.overlap_cells, 0, "the anchor occupies another row");
        assert_eq!(
            staging.invalid_cells,
            u64::from(staging.union_grid.width) * u64::from(staging.union_grid.height) - incoming,
            "the envelope gap is arithmetic"
        );
        assert!(
            review_probe::pages() >= 3,
            "more than two region pages were read: {}",
            review_probe::pages()
        );

        // The decision preview walks the same traversal and completes for this
        // extreme aspect ratio. Its 512x1 raster is a degenerate display
        // derivative that GDAL renders transparent, so the preview is asserted
        // to exist rather than to carry colour.
        let preview = library
            .preview_import_decision(&job)
            .expect("decision preview");
        let before_path = preview
            .before_preview_path
            .as_deref()
            .expect("an accepted head has a before preview");
        for path in [before_path, preview.after_preview_path.as_str()] {
            let bytes = std::fs::read(path).expect("preview png exists");
            let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                .expect("preview decodes")
                .to_rgba8();
            assert_eq!(image.height(), 1, "the preview keeps the union aspect");
            assert_eq!(image.width(), 512);
        }

        // Apply publishes the reviewed coverage, and the last index page's own
        // values are readable while the middle sentinel block stays invalid.
        library.prepare_apply(&job).expect("review accepted");
        let applied = apply_import(&library, &staging, true, false, &cancel).expect("apply");
        assert!(applied.changed);
        let (far_values, far_valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: (width - 1024) as i64,
                y: 4,
                width: 1024,
                height: 1,
            },
        );
        assert!(
            far_valid.iter().all(|byte| *byte == 1),
            "the final index page is covered"
        );
        assert!(
            far_values.iter().all(|value| *value == 7.0),
            "the final index page carries its authored values"
        );
        let (sentinel_values, sentinel_valid) = head_window(
            &library,
            &layer_id,
            generation::LatticeWindow {
                x: (sentinel_block * 1024) as i64,
                y: 4,
                width: 1024,
                height: 1,
            },
        );
        assert!(
            sentinel_valid.iter().all(|byte| *byte == 0),
            "the authored NoData block stays invalid"
        );
        assert!(
            sentinel_values
                .iter()
                .all(|value| !value.is_finite() || *value == -9999.0),
            "invalid cells carry the layer marker, not authored data"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    // -----------------------------------------------------------------------
    // Product closure: collision ownership (C1) and journal clearing (C2)
    // -----------------------------------------------------------------------

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
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
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
        library.prepare_apply(&job_two).expect("review accepted");
        let hashes: Vec<String> = staging_two
            .sources
            .iter()
            .map(|source| source.interp_hash.clone())
            .collect();
        let assets: Vec<_> = staging_two
            .sources
            .iter()
            .map(|source| {
                paths.asset_cog(&source.source_cog.as_ref().expect("retained COG").sha256)
            })
            .collect();
        promotion_probe::fail_at(FaultPoint::AfterPromotion);
        let error = apply_import(&library, &staging_two, true, false, &cancel)
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
                .as_ref()
                .expect("retained COG")
                .resolve(&paths, source.job_id.as_deref())
                .expect("job-local COG");
            assert!(local.exists(), "the job keeps its own COG for retry");
        }

        let applied =
            apply_import(&library, &staging_two, true, false, &cancel).expect("retry applies");
        assert!(applied.changed);
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
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
        let accepted_asset =
            committed_asset(&library, &staging_one.sources[0].interp_hash).expect("committed");
        let head_before = head_of(&library, &layer_id);

        // Two new sources: the first links normally, the second collides.
        let first = write_placed_fixture(&engine, &root, "first", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let second = write_placed_fixture(&engine, &root, "second", 32.0, 8.0, 4, 4, -9999.0, 9.0);
        let (job_two, staging_two) = stage_review(&library, &layer_id, &[first, second], &cancel);
        library.prepare_apply(&job_two).expect("review accepted");
        let locals: Vec<PathBuf> = staging_two
            .sources
            .iter()
            .map(|source| {
                source
                    .source_cog
                    .as_ref()
                    .expect("retained COG")
                    .resolve(&paths, source.job_id.as_deref())
                    .expect("job-local COG")
            })
            .collect();
        let destinations: Vec<PathBuf> = staging_two
            .sources
            .iter()
            .map(|source| {
                paths.asset_cog(&source.source_cog.as_ref().expect("retained COG").sha256)
            })
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
        let error = apply_import(&library, &staging_two, true, false, &cancel)
            .expect_err("the collision refuses the publication");
        promotion_probe::clear();
        assert!(error.contains("refusing to adopt"), "{error}");
        assert!(
            error.contains(&destinations[1].display().to_string()),
            "the refusal names the destination: {error}"
        );

        // The competing file is byte-for-byte intact and never referenced.
        let declared = staging_two.sources[1]
            .source_cog
            .as_ref()
            .expect("retained COG")
            .clone();
        assert!(
            destinations[1].exists(),
            "a file this job did not create is preserved"
        );
        assert_eq!(
            crate::services::lidar::raster_assets::hash_file(&destinations[1]).unwrap(),
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
            crate::services::lidar::raster_assets::hash_file(&destinations[1]).unwrap(),
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
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let waiting = write_placed_fixture(&engine, &root, "waiting", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_wait, staging_wait) =
            stage_review(&library, &layer_id, std::slice::from_ref(&waiting), &cancel);
        let wait_local = staging_wait.sources[0]
            .source_cog
            .as_ref()
            .expect("retained COG")
            .resolve(&paths, staging_wait.sources[0].job_id.as_deref())
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
        assert!(paths.job_dir(&job_wait).exists());
        assert!(wait_local.exists());
        let staged_json = std::fs::read_to_string(paths.job_dir(&job_wait).join("staging.json"))
            .expect("the awaiting-review job survives");
        let restaged: StagedImport = serde_json::from_str(&staged_json).unwrap();
        let preview = render_composition_preview(&reopened, &restaged, &cancel)
            .expect("the intact job still previews");
        assert!(preview.after_preview_path.ends_with(".png"));
        reopened.prepare_apply(&job_wait).expect("review accepted");
        let applied = apply_import(&reopened, &restaged, true, false, &cancel)
            .expect("the intact job still applies");
        assert!(applied.changed);
        drop(reopened);
        let twice = LidarLibrary::open(&root).expect("the second reopen is clean");
        drop(twice);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// A committed publication is irreversible success: a journal-clear failure
    /// keeps the retry evidence, reports a diagnostic, and still settles as a
    /// complete job through the real caller, including its dependent refresh.
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
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("apply");

        let incoming =
            write_placed_fixture(&engine, &root, "incoming", 16.0, 8.0, 4, 4, -9999.0, 7.0);
        let (job_two, staging_two) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&incoming),
            &cancel,
        );
        let staged = library.prepare_apply(&job_two).expect("review accepted");
        let hash = staging_two.sources[0].interp_hash.clone();
        let asset = paths.asset_cog(
            &staging_two.sources[0]
                .source_cog
                .as_ref()
                .expect("retained COG")
                .sha256,
        );

        promotion_probe::fail_at(FaultPoint::BeforeJournalClear);
        let applied = apply_import(&library, &staged, true, false, &cancel)
            .expect("a committed publication reports success");
        promotion_probe::clear();
        assert!(applied.changed, "the generation is published");
        let diagnostic = applied
            .message
            .as_deref()
            .expect("the retained evidence is reported as a diagnostic");
        assert!(
            diagnostic.contains("promotion evidence retained"),
            "{diagnostic}"
        );
        let head = head_of(&library, &layer_id);
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
        library.finish_apply(&job_two, Ok(applied));
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
            assert!(
                refreshes >= 1,
                "the committed layer enqueued its dependent refresh"
            );
        }

        let generations_before = generation_count(&library, &layer_id);
        drop(library);
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        assert!(journal_of(&reopened, &job_two).is_none());
        assert_eq!(generation_count(&reopened, &layer_id), generations_before);
        let (values, valid) = head_window(
            &reopened,
            &layer_id,
            generation::LatticeWindow {
                x: 16,
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
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let accepted =
            write_placed_fixture(&engine, &root, "accepted", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_one, staging_one) = stage_review(
            &library,
            &layer_id,
            std::slice::from_ref(&accepted),
            &cancel,
        );
        library.prepare_apply(&job_one).expect("review accepted");
        apply_import(&library, &staging_one, true, false, &cancel).expect("apply");
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
        let staged = library.prepare_apply(&job_two).expect("review accepted");
        let asset = paths.asset_cog(
            &staging_two.sources[0]
                .source_cog
                .as_ref()
                .expect("retained COG")
                .sha256,
        );

        // The publication fails before the commit and the rollback cannot clear
        // its journal: the evidence must survive rather than report clean.
        promotion_probe::fail_at(FaultPoint::BeforeTransaction);
        promotion_probe::fail_at(FaultPoint::BeforeJournalClear);
        let error = apply_import(&library, &staged, true, false, &cancel)
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

    /// Ownership that cannot be proven preserves the file and reports
    /// uncertainty, including for journals written before witnesses existed.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn unproven_ownership_preserves_an_interrupted_intent() {
        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-unproven"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "unproven",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let paths = LidarPaths::open(&root).expect("library paths");

        let source = write_placed_fixture(&engine, &root, "source", 0.0, 8.0, 4, 4, -9999.0, 5.0);
        let (job_id, staging) =
            stage_review(&library, &layer_id, std::slice::from_ref(&source), &cancel);

        // A file that looks like an asset of this digest but was not created by
        // this job, with an intent that records no witness.
        let digest = "unproven-digest";
        let destination = paths.asset_cog(digest);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(&destination, b"a separately created file").unwrap();
        write_promotion_journal(
            &paths,
            &job_id,
            &PromotionJournal {
                entries: vec![PromotionEntry {
                    interpretation_id: "interp-unproven".to_string(),
                    sha256: digest.to_string(),
                    destination: destination
                        .strip_prefix(paths.root())
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    witness: None,
                }],
            },
        )
        .unwrap();

        drop(library);
        let error = LidarLibrary::open(&root)
            .err()
            .expect("unproven ownership fails opening");
        assert!(error.contains("recovery is incomplete"), "{error}");
        assert!(
            destination.exists(),
            "an unproven destination is preserved, never deleted"
        );
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"a separately created file"
        );
        assert!(
            journal_of_paths(&paths, &job_id).is_some(),
            "the journal is retained"
        );

        // Removing the unresolvable intent lets reopening finish; the orphan
        // file itself stays, because general reclamation is deferred.
        let _ = std::fs::remove_file(promotion_journal_path(&paths, &job_id));
        let reopened = LidarLibrary::open(&root).expect("library reopens");
        assert!(destination.exists());
        drop(reopened);

        // A stale intent that does record a witness is still not proof: the
        // destination is a separate file with the same content, so identity
        // fails and the file is preserved with the uncertainty named.
        let witness = staging.sources[0]
            .source_cog
            .as_ref()
            .expect("retained COG")
            .relative_path
            .clone()
            .expect("the retained COG records its job-relative location");
        write_promotion_journal(
            &paths,
            &job_id,
            &PromotionJournal {
                entries: vec![PromotionEntry {
                    interpretation_id: "interp-stale".to_string(),
                    sha256: digest.to_string(),
                    destination: destination
                        .strip_prefix(paths.root())
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                    witness: Some(witness),
                }],
            },
        )
        .unwrap();
        let error = LidarLibrary::open(&root)
            .err()
            .expect("a foreign destination fails opening even with a witness");
        assert!(error.contains("recovery is incomplete"), "{error}");
        assert!(
            error.contains("is not the file this job linked"),
            "the uncertainty is named: {error}"
        );
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            b"a separately created file",
            "content equality is not identity"
        );
        assert!(journal_of_paths(&paths, &job_id).is_some());

        let _ = std::fs::remove_file(promotion_journal_path(&paths, &job_id));
        let reopened = LidarLibrary::open(&root).expect("library reopens cleanly");
        assert!(destination.exists());
        drop(reopened);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A tile whose samples read reduced cells keeps every source that reaches
    /// those footprints, including one that lies outside the sample centres.
    ///
    /// Tile 14/8192/8191 starts at the layer anchor with a 1 m lattice, so its
    /// samples are ~9.55 native cells apart and the first one is minified to
    /// level 3. That sample reads reduced cells (0, 0) and (1, 0) plus their
    /// vertical neighbours, whose footprints cover native cells `[0, 16)` while
    /// the mapped sample centres start at cell 4. A candidate prefilter built
    /// from the sample centres alone therefore drops a source holding only
    /// cells 0..2 and draws nothing, even though those cells are exactly what
    /// the first reduction cell averages.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn a_tile_near_its_edge_keeps_the_sources_inside_its_reduction_footprint() {
        use super::super::display::ColorRamp;
        use super::super::tiles;

        let engine = GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("ordered-tile-edge"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // The layer anchor is the north-west corner of the tile, so both
        // sources sit on lattice cells [0, 2) — the footprint of the first
        // reduced cell, reached by no sample centre.
        let bounds = tiles::tile_bounds_3857(14, 8192, 8191);
        let bottom = write_placed_fixture(
            &engine,
            &root,
            "edge-bottom",
            bounds[0],
            bounds[3],
            2,
            2,
            -9999.0,
            7.0,
        );
        // Imported second, so it is the topmost occurrence and wins where the
        // two overlap: the composed cells are 7 above 9 below the seam.
        let top = write_placed_fixture(
            &engine,
            &root,
            "edge-top",
            bounds[0],
            bounds[3] - 1.0,
            2,
            2,
            -9999.0,
            9.0,
        );

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "tile edge",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let (first_job, first_staging) = stage_review(&library, &layer_id, &[bottom], &cancel);
        library.prepare_apply(&first_job).expect("first review");
        apply_import(&library, &first_staging, true, false, &cancel).expect("first applies");
        let (second_job, second_staging) = stage_review(&library, &layer_id, &[top], &cancel);
        library.prepare_apply(&second_job).expect("second review");
        let stacked =
            apply_import(&library, &second_staging, true, false, &cancel).expect("second applies");

        // The published composition overlaps by two cells, so its exact values
        // are 7 and 9 rather than either source's constant.
        let head = head_of(&library, &layer_id);
        assert_eq!(head.id, stacked.generation_id);
        assert_eq!(head.coverage_cells, 6);
        assert_eq!(head.min_value, Some(7.0));
        assert_eq!(head.max_value, Some(9.0));

        let request = |z: u32, x: u32, y: u32| tiles::TileRequest {
            entity_kind: "source".to_string(),
            entity_id: layer_id.clone(),
            generation_id: stacked.generation_id.clone(),
            style: "elevation".to_string(),
            z,
            x,
            y,
        };

        // The minified tile resolves its first reduced cell from both sources:
        // the composed cell mean is (2 * 7 + 4 * 9) / 6, and only that cell
        // holds coverage, so exactly the corner sample is painted. Its index is
        // the one the fixture was placed against: the floor of the derived index
        // sits on a tile boundary where the floating-point value rounds down.
        let png = match tiles::render_tile(&library, &request(14, 8192, 8191), &cancel).unwrap() {
            tiles::TileOutcome::Png(bytes) => bytes,
            tiles::TileOutcome::Empty => {
                panic!("the two edge sources contribute to the first level-3 reduction cell")
            }
        };
        let (width, height, rgba) = decode_tile(&png);
        assert_eq!((width, height), (tiles::TILE_PIXELS, tiles::TILE_PIXELS));
        let ramp = ColorRamp::elevation_range(7.0, 9.0);
        let composed = (2.0 * 7.0 + 4.0 * 9.0) / 6.0;
        let expected = ramp.colour_for(composed).expect("8.33 is inside the ramp");
        let painted: Vec<[u8; 4]> = rgba
            .chunks_exact(4)
            .filter(|pixel| pixel[3] == 255)
            .map(|pixel| [pixel[0], pixel[1], pixel[2], pixel[3]])
            .collect();
        assert_eq!(
            painted.len(),
            1,
            "only the corner sample interpolates the one occupied reduced cell"
        );
        assert_eq!(
            (painted[0][0], painted[0][1], painted[0][2]),
            expected,
            "the painted sample is the composed overlap mean"
        );

        // Native scale reads the same composition through its own two-cell
        // window: the source is still found and the tile is mostly transparent.
        // The tile is the one holding the source's own centre, away from the
        // boundary that makes a derived index ambiguous.
        let world = {
            let world = tiles::tile_bounds_3857(0, 0, 0);
            world[2] - world[0]
        };
        let span = world / f64::from(1u32 << 17);
        let half = world / 2.0;
        let png = match tiles::render_tile(
            &library,
            &request(
                17,
                ((bounds[0] + 1.0 + half) / span).floor() as u32,
                ((half - bounds[3] + 1.0) / span).floor() as u32,
            ),
            &cancel,
        )
        .unwrap()
        {
            tiles::TileOutcome::Png(bytes) => bytes,
            tiles::TileOutcome::Empty => panic!("the source is present at native scale"),
        };
        let (_, _, rgba) = decode_tile(&png);
        let painted = rgba.chunks_exact(4).filter(|pixel| pixel[3] == 255).count();
        assert!(painted > 0, "the source draws at native scale");
        assert!(
            painted < (tiles::TILE_PIXELS * tiles::TILE_PIXELS) as usize,
            "a 2x2 m source does not fill a 305 m tile"
        );

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Decode a rendered tile into RGBA8 pixels.
    fn decode_tile(bytes: &[u8]) -> (u32, u32, Vec<u8>) {
        let image = image::load_from_memory_with_format(bytes, image::ImageFormat::Png)
            .expect("tile is a PNG")
            .to_rgba8();
        (image.width(), image.height(), image.into_raw())
    }
}
