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
use super::grid::ValidMask;
use super::import::{
    publish_display, raw_f32_bytes, read_generation_manifest, remove_display_publication,
    validate_working_grid,
};
use common_types::lidar::{LidarAnalysisKind, LidarSlopeUnit};
use serde::{Deserialize, Serialize};
use std::path::Path;
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

    let job_dir_id = new_id("anl");
    let pipeline_dir = paths.analysis_pipeline_dir(definition_id);
    let staging_dir = pipeline_dir.join(format!("staging-{job_dir_id}"));
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create analysis staging: {e}"))?;

    // Numeric analysis via the pinned engine. Slope is terrain geometry in
    // layer units; scale 1 (vertical metres, horizontal metres), or percent.
    let result_path = staging_dir.join("result.tif");
    let mut args = vec![
        "slope".to_string(),
        "-s".to_string(),
        "1".to_string(),
        "-q".to_string(),
        Path::new(&head.mosaic_path).display().to_string(),
        result_path.display().to_string(),
    ];
    if parameters.slope_unit == Some(LidarSlopeUnit::Percent) {
        args.insert(2, "-p".to_string());
    }
    engine.run(super::engine::GdalProgram::Dem, &args, Some(cancel))?;

    // Neighborhood quality mask: cells whose full 3×3 accepted neighborhood
    // is not valid are flagged so unknown areas never masquerade as data.
    let coverage = ValidMask::read_from(
        Path::new(&head.coverage_mask_path),
        manifest.grid.width,
        manifest.grid.height,
    )?;
    let quality = coverage.eroded_checked(|_| super::import::check_cancel(cancel))?;
    let quality_path = staging_dir.join("quality.bin");
    quality.write_to(&quality_path)?;

    // The analysis engine chooses the output nodata marker; read it back so
    // statistics and display treat unknown cells as unknown.
    let result_info = super::display::gdalinfo_json(engine, cancel, &result_path)?;
    let result_nodata = super::display::band_nodata(&result_info).or(Some(manifest.nodata));

    // Exact result statistics from the raw buffer.
    let raw = raw_f32_bytes(
        engine,
        &result_path,
        manifest.grid.width,
        manifest.grid.height,
        cancel,
    )?;
    let (mut min_value, mut max_value, mut result_cells) = (f64::INFINITY, f64::NEG_INFINITY, 0u64);
    for (index, chunk) in raw.chunks_exact(4).enumerate() {
        if index % (256 * 1024) == 0 {
            super::import::check_cancel(cancel)?;
        }
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if value.is_finite() && Some(value) != result_nodata {
            result_cells += 1;
            min_value = min_value.min(value as f64);
            max_value = max_value.max(value as f64);
        }
    }
    if !min_value.is_finite() {
        min_value = 0.0;
        max_value = 0.0;
    }

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
        // Stale completion: never replace a newer result; drop artifacts.
        let _ = std::fs::remove_dir_all(&staging_dir);
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
