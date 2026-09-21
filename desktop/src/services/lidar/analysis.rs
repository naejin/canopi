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
use super::grid::RasterGrid;
use super::import::{
    publish_display, read_generation_manifest, remove_display_publication, validate_working_grid,
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
    pub nodata: f32,
    pub created_at: String,
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
    // Slope still reads the accepted dense mosaic. A generation stored as
    // sparse resolved chunks has none, so it is refused explicitly here until
    // the bounded core+halo slope reader lands in B3 (`canopi-jv8a.4`) rather
    // than being handed a path that does not exist.
    let (Some(source_mosaic), Some(source_coverage)) = (
        head.mosaic_path.as_deref(),
        head.coverage_mask_path.as_deref(),
    ) else {
        return Err(
            "slope analysis needs the dense source mosaic; sparse-generation slope is not implemented yet"
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
        nodata: manifest.nodata,
        created_at: now_iso(),
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
}
