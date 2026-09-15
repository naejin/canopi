//! Local LiDAR raster library service.
//!
//! The subsystem owns files, jobs, engines and caches; the map host owns map
//! lifetime and documents own presentation references. Library mutations
//! never dirty a Design, and no catalogue lock is held during raster
//! computation.

pub mod analysis;
pub mod catalogue;
pub mod display;
#[cfg(test)]
mod e2e;
pub mod engine;
pub mod grid;
pub mod import;
pub mod paths;
pub mod presentation;
pub mod probe;

use catalogue::{new_id, now_iso};
use common_types::lidar::{
    LidarAnalysisJobStatus, LidarAnalysisKind, LidarAnalysisParameters, LidarImportJob,
    LidarImportJobState, LidarResultState,
};
use engine::GdalEngine;
use paths::LidarPaths;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::MutexGuard;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub type LidarSnapshot = common_types::lidar::LidarLibrarySnapshot;

#[derive(Clone)]
pub struct LidarLibrary {
    pub(crate) inner: Arc<LidarLibraryInner>,
}

pub(crate) struct LidarLibraryInner {
    pub(crate) paths: LidarPaths,
    catalogue: Mutex<Connection>,
    display_cache: Mutex<Connection>,
    pub(crate) engine: GdalEngine,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    executor: Mutex<Option<crate::native_operation::NativeOperationExecutor>>,
}

impl LidarLibrary {
    pub fn open(app_data_dir: &std::path::Path) -> Result<Self, String> {
        let paths = LidarPaths::open(app_data_dir)?;
        let catalogue = catalogue::open(&paths.catalogue_path())?;
        let display_cache = open_display_cache(&paths.display_cache_path())?;
        let library = Self {
            inner: Arc::new(LidarLibraryInner {
                paths,
                catalogue: Mutex::new(catalogue),
                display_cache: Mutex::new(display_cache),
                engine: GdalEngine::new(),
                cancel_flags: Mutex::new(HashMap::new()),
                executor: Mutex::new(None),
            }),
        };
        // Recovery: interrupted jobs fail explicitly; published results and
        // immutable originals are unaffected.
        {
            let connection = library.catalogue()?;
            analysis::recover_interrupted_jobs(&connection)?;
        }
        library.prune_transient_artifacts()?;
        Ok(library)
    }

    /// Attach the managed Native Operation Executor so service-initiated
    /// refreshes run through the same bounded admission as command work.
    pub fn attach_executor(&self, executor: crate::native_operation::NativeOperationExecutor) {
        if let Ok(mut slot) = self.inner.executor.lock() {
            *slot = Some(executor);
        }
    }

    fn executor(&self) -> Result<crate::native_operation::NativeOperationExecutor, String> {
        self.inner
            .executor
            .lock()
            .map_err(|_| "LiDAR executor slot poisoned".to_string())?
            .clone()
            .ok_or_else(|| "LiDAR executor is not attached".to_string())
    }

    pub(crate) fn catalogue(&self) -> Result<CatalogueGuard<'_>, String> {
        Ok(CatalogueGuard(self.inner.catalogue.lock().map_err(
            |_| "LiDAR catalogue lock poisoned".to_string(),
        )?))
    }

    pub(crate) fn display(&self) -> Result<MutexGuard<'_, Connection>, String> {
        self.inner
            .display_cache
            .lock()
            .map_err(|_| "LiDAR display cache lock poisoned".to_string())
    }

    /// Best-effort bounded cleanup at startup: job scratch dirs for settled
    /// jobs, abandoned analysis staging dirs, and display tilesets of
    /// superseded generations (they can be re-rendered on demand).
    fn prune_transient_artifacts(&self) -> Result<(), String> {
        let connection = self.catalogue()?;
        let settled: Vec<(String, String)> = {
            let mut statement = connection
                .prepare(
                    "SELECT id, state FROM lidar_import_jobs WHERE state != 'staging'
                     AND state != 'awaiting_review' AND state != 'applying'",
                )
                .map_err(|e| e.to_string())?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        drop(connection);
        for (job_id, _state) in settled {
            let _ = std::fs::remove_dir_all(self.inner.paths.job_dir(&job_id));
        }
        // Superseded generations keep their immutable numeric history but
        // lose their display tilesets (re-renderable on demand).
        let live_generation_ids: Vec<String> = {
            let connection = self.catalogue()?;
            let mut statement = connection
                .prepare(
                    "SELECT generation_id FROM lidar_layer_heads
                     UNION SELECT generation_id FROM lidar_analysis_heads",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            drop(statement);
            rows
        };
        {
            let display = self.display()?;
            if live_generation_ids.is_empty() {
                display
                    .execute_batch("DELETE FROM tilesets")
                    .map_err(|e| format!("Failed to prune display tilesets: {e}"))?;
            } else {
                let placeholders = vec!["?"; live_generation_ids.len()].join(", ");
                let sql =
                    format!("DELETE FROM tilesets WHERE generation_id NOT IN ({placeholders})");
                let mut statement = display
                    .prepare(&sql)
                    .map_err(|e| format!("Failed to prune display tilesets: {e}"))?;
                statement
                    .execute(rusqlite::params_from_iter(live_generation_ids.iter()))
                    .map_err(|e| format!("Failed to prune display tilesets: {e}"))?;
            }
        }
        // Remove on-disk display generation dirs that have no tileset row.
        let live: std::collections::HashSet<String> = {
            let display = self.display()?;
            let mut statement = display
                .prepare(
                    "SELECT entity_kind || '/' || entity_id || '/' || generation_id FROM tilesets",
                )
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows.into_iter().collect()
        };
        let display_root = self.inner.paths.display_dir();
        for kind_dir in std::fs::read_dir(&display_root)
            .into_iter()
            .flatten()
            .flatten()
        {
            for entity_dir in std::fs::read_dir(kind_dir.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                for gen_dir in std::fs::read_dir(entity_dir.path())
                    .into_iter()
                    .flatten()
                    .flatten()
                {
                    let key = format!(
                        "{}/{}/{}",
                        kind_dir.file_name().to_string_lossy(),
                        entity_dir.file_name().to_string_lossy(),
                        gen_dir.file_name().to_string_lossy()
                    );
                    // Style subdirectories live inside a generation. Keep the
                    // directory only when the display registry owns that exact
                    // entity generation.
                    if !live.contains(&key) {
                        let _ = std::fs::remove_dir_all(gen_dir.path());
                    }
                }
            }
        }
        Ok(())
    }

    fn refresh_snapshot_quiet(&self) {
        let _ = self.library_snapshot();
    }

    pub fn engine_status(&self) -> common_types::lidar::LidarEngineStatus {
        match self.inner.engine.discover() {
            Ok(tools) => common_types::lidar::LidarEngineStatus {
                available: true,
                version: Some(tools.version),
                detail: None,
            },
            Err(error) => common_types::lidar::LidarEngineStatus {
                available: false,
                version: None,
                detail: Some(error),
            },
        }
    }

    pub fn library_snapshot(&self) -> Result<LidarSnapshot, String> {
        let connection = self.catalogue()?;
        let display = self.display()?;
        presentation::library_snapshot(&connection, &display, &self.inner.engine)
    }

    pub fn create_layer(
        &self,
        name: &str,
        measurement_kind: common_types::lidar::LidarMeasurementKind,
    ) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Layer name must not be empty".to_string());
        }
        let id = new_id("lyr");
        let units = default_units(measurement_kind);
        let connection = self.catalogue()?;
        connection
            .execute(
                "INSERT INTO lidar_source_layers(id, name, measurement_kind, units, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![id, name, measurement_kind.as_str(), units, now_iso()],
            )
            .map_err(|e| format!("Failed to create layer: {e}"))?;
        Ok(id)
    }

    pub fn rename_layer(&self, layer_id: &str, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Layer name must not be empty".to_string());
        }
        // Renaming changes no hashes and invalidates no results.
        let connection = self.catalogue()?;
        let changed = connection
            .execute(
                "UPDATE lidar_source_layers SET name = ?2 WHERE id = ?1",
                rusqlite::params![layer_id, name],
            )
            .map_err(|e| format!("Failed to rename layer: {e}"))?;
        if changed == 0 {
            return Err(format!("Layer {layer_id} does not exist"));
        }
        Ok(())
    }

    pub fn delete_impact(
        &self,
        layer_id: &str,
    ) -> Result<common_types::lidar::LidarDeleteImpact, String> {
        let connection = self.catalogue()?;
        let layer = catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        let definitions = catalogue::list_definitions_for_layer(&connection, layer_id)?;
        Ok(common_types::lidar::LidarDeleteImpact {
            layer_name: layer.name,
            analysis_count: definitions.len() as u32,
            analysis_ids: definitions.iter().map(|d| d.id.clone()).collect(),
        })
    }

    /// Delete a layer, its analyses and results. Managed originals of dedupe
    /// shared sources stay until explicit cleanup (slice 2).
    pub fn delete_layer(&self, layer_id: &str) -> Result<(), String> {
        let connection = self.catalogue()?;
        let definitions = catalogue::list_definitions_for_layer(&connection, layer_id)?;
        connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            for definition in &definitions {
                for (table, column) in [
                    ("lidar_analysis_heads", "definition_id"),
                    ("lidar_analysis_jobs", "definition_id"),
                    ("lidar_analysis_generations", "definition_id"),
                    ("lidar_dependencies", "definition_id"),
                ] {
                    connection
                        .execute(
                            &format!("DELETE FROM {table} WHERE {column} = ?1"),
                            [&definition.id],
                        )
                        .map_err(|e| e.to_string())?;
                }
            }
            connection
                .execute(
                    "DELETE FROM lidar_analysis_definitions WHERE layer_id = ?1",
                    [layer_id],
                )
                .map_err(|e| e.to_string())?;
            connection
                .execute(
                    "DELETE FROM lidar_layer_heads WHERE layer_id = ?1",
                    [layer_id],
                )
                .map_err(|e| e.to_string())?;
            connection
                .execute(
                    "DELETE FROM lidar_import_jobs WHERE layer_id = ?1",
                    [layer_id],
                )
                .map_err(|e| e.to_string())?;
            connection
                .execute("DELETE FROM lidar_source_layers WHERE id = ?1", [layer_id])
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        match result {
            Ok(()) => connection
                .execute_batch("COMMIT")
                .map_err(|e| e.to_string()),
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Immutable publication history of a source layer, oldest first.
    pub fn layer_history(
        &self,
        layer_id: &str,
    ) -> Result<Vec<common_types::lidar::LidarGenerationHistoryEntry>, String> {
        let connection = self.catalogue()?;
        let entries = catalogue::layer_history(&connection, layer_id)?;
        Ok(entries
            .into_iter()
            .map(|entry| common_types::lidar::LidarGenerationHistoryEntry {
                id: entry.id,
                created_at: entry.created_at,
                coverage_cells: entry.coverage_cells.max(0) as u64,
                members: entry.members,
                roles: entry.roles,
                job_ids: entry.job_ids,
                is_head: entry.is_head,
            })
            .collect())
    }

    /// Validate that an import job has an accepted publication to undo
    /// (short catalogue read; called through the executor from the command).
    pub fn validate_undo(&self, job_id: &str) -> Result<String, String> {
        let connection = self.catalogue()?;
        connection
            .query_row(
                "SELECT g.layer_id FROM lidar_acceptance_regions a
                 JOIN lidar_layer_generations g ON g.id = a.generation_id
                 WHERE a.job_id = ?1 LIMIT 1",
                [job_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| "import has no accepted publication to undo".to_string())
    }

    /// Spawn the undo: republish the layer without the import's
    /// interpretation. Immutable history stays on disk.
    pub fn begin_undo(&self, job_id: &str) -> Result<(), String> {
        let executor = self.executor()?;
        let flag = self.register_cancel(job_id);
        let library = self.clone();
        let job_id_for_work = job_id.to_string();
        let job_id_owned = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            let library_for_work = library.clone();
            let outcome = executor
                .run(
                    crate::native_operation::NativeOperationClass::Local,
                    "lidar import undo",
                    move || import::undo_import(&library_for_work, &job_id_for_work, &flag),
                )
                .await;
            match outcome {
                Ok(applied) => {
                    tracing::info!(
                        job_id = job_id_owned,
                        summary = applied.summary(),
                        "LiDAR import undone"
                    );
                }
                Err(error) => {
                    tracing::warn!(job_id = job_id_owned, error, "LiDAR import undo failed");
                }
            }
            library.settle_cancel(&job_id_owned);
            library.refresh_snapshot_quiet();
        });
        Ok(())
    }

    pub fn get_import_job(&self, job_id: &str) -> Result<Option<LidarImportJob>, String> {
        let connection = self.catalogue()?;
        let Some(row) = catalogue::get_import_job(&connection, job_id)? else {
            return Ok(None);
        };
        let review = row
            .review_json
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|e| format!("Invalid stored review: {e}"))?;
        Ok(Some(LidarImportJob {
            job_id: row.id,
            layer_id: row.layer_id,
            state: parse_import_state(&row.state),
            review,
            message: row.message,
        }))
    }

    pub fn analysis_job_status(
        &self,
        job_id: &str,
    ) -> Result<Option<LidarAnalysisJobStatus>, String> {
        let connection = self.catalogue()?;
        connection
            .query_row(
                "SELECT id, definition_id, state, message FROM lidar_analysis_jobs WHERE id = ?1",
                [job_id],
                |row| {
                    Ok(LidarAnalysisJobStatus {
                        job_id: row.get(0)?,
                        definition_id: row.get(1)?,
                        state: parse_result_state(&row.get::<_, String>(2)?),
                        message: row.get(3)?,
                    })
                },
            )
            .map(Some)
            .or_else(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other.to_string()),
            })
    }

    // ------------------------------------------------------------------
    // Job orchestration
    // ------------------------------------------------------------------

    fn register_cancel(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut flags) = self.inner.cancel_flags.lock() {
            flags.insert(job_id.to_string(), Arc::clone(&flag));
        }
        flag
    }

    fn settle_cancel(&self, job_id: &str) {
        if let Ok(mut flags) = self.inner.cancel_flags.lock() {
            flags.remove(job_id);
        }
    }

    pub fn cancel_job(&self, job_id: &str) {
        // Bounded in-memory signal delivery; the running job observes the
        // flag between steps and kills its engine processes.
        if let Ok(flags) = self.inner.cancel_flags.lock()
            && let Some(flag) = flags.get(job_id)
        {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Record the import job row (short catalogue write; called through the
    /// executor from the command).
    pub fn record_import_job(&self, layer_id: &str) -> Result<String, String> {
        let job_id = new_id("imp");
        let connection = self.catalogue()?;
        connection
            .execute(
                "INSERT INTO lidar_import_jobs(id, layer_id, state, created_at, updated_at)
                 VALUES(?1, ?2, 'staging', ?3, ?3)",
                rusqlite::params![job_id, layer_id, now_iso()],
            )
            .map_err(|e| format!("Failed to record import job: {e}"))?;
        Ok(job_id)
    }

    /// Spawn staging: probe, mask, classify and plan the review.
    pub fn begin_staging(
        &self,
        job_id: &str,
        layer_id: &str,
        source_paths: Vec<PathBuf>,
    ) -> Result<(), String> {
        let executor = self.executor()?;
        let flag = self.register_cancel(job_id);
        let library = self.clone();
        let layer_id_for_work = layer_id.to_string();
        let job_id_for_work = job_id.to_string();
        let job_id_clone = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            let library_for_work = library.clone();
            let outcome = executor
                .run(
                    crate::native_operation::NativeOperationClass::Local,
                    "lidar import staging",
                    move || {
                        import::stage_import(
                            &library_for_work,
                            &job_id_for_work,
                            &layer_id_for_work,
                            &source_paths,
                            &flag,
                        )
                    },
                )
                .await;
            library.finish_staging(&job_id_clone, outcome);
        });
        Ok(())
    }

    fn finish_staging(&self, job_id: &str, outcome: Result<import::StagingOutput, String>) {
        let connection = self.catalogue();
        if let Ok(connection) = connection {
            match outcome {
                Ok(output) => {
                    let review_json = serde_json::to_string(&output.review).unwrap_or_default();
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs SET state = 'awaiting_review', review_json = ?2, updated_at = ?3 WHERE id = ?1",
                        rusqlite::params![job_id, review_json, now_iso()],
                    );
                }
                Err(error) => {
                    let (state, message) = if error == "cancelled" {
                        ("cancelled", "import cancelled".to_string())
                    } else {
                        ("failed", error)
                    };
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs SET state = ?2, message = ?3, updated_at = ?4 WHERE id = ?1",
                        rusqlite::params![job_id, state, message, now_iso()],
                    );
                }
            }
        }
        self.settle_cancel(job_id);
    }

    /// Validate the review decision and mark the job applying (short
    /// catalogue write; called through the executor from the command).
    pub fn prepare_apply(&self, job_id: &str) -> Result<import::StagedImport, String> {
        let connection = self.catalogue()?;
        let row = catalogue::get_import_job(&connection, job_id)?
            .ok_or_else(|| format!("Import job {job_id} does not exist"))?;
        if row.state != "awaiting_review" {
            return Err(format!(
                "Import job is not awaiting review (state {})",
                row.state
            ));
        }
        connection
            .execute(
                "UPDATE lidar_import_jobs SET state = 'applying', updated_at = ?2 WHERE id = ?1",
                rusqlite::params![job_id, now_iso()],
            )
            .map_err(|e| e.to_string())?;
        let staging_json =
            std::fs::read_to_string(self.inner.paths.job_dir(job_id).join("staging.json"))
                .map_err(|e| format!("Staged import data is missing: {e}"))?;
        serde_json::from_str(&staging_json).map_err(|e| format!("Invalid staging data: {e}"))
    }

    /// Spawn apply: compose the mosaic, publish the generation and refresh
    /// dependent analyses.
    pub fn begin_apply(
        &self,
        staging: import::StagedImport,
        add_uncovered: bool,
        replace_overlap: bool,
    ) -> Result<(), String> {
        let executor = self.executor()?;
        let job_id = staging.job_id.clone();
        let flag = self.register_cancel(&job_id);
        let library = self.clone();
        let job_id_owned = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            let library_for_work = library.clone();
            let outcome = executor
                .run(
                    crate::native_operation::NativeOperationClass::Local,
                    "lidar import apply",
                    move || {
                        import::apply_import(
                            &library_for_work,
                            &staging,
                            add_uncovered,
                            replace_overlap,
                            &flag,
                        )
                    },
                )
                .await;
            library.finish_apply(&job_id_owned, outcome);
        });
        Ok(())
    }

    fn finish_apply(&self, job_id: &str, outcome: Result<import::ApplyOutcome, String>) {
        let mut published_layer: Option<String> = None;
        let connection = self.catalogue();
        if let Ok(connection) = connection {
            match outcome {
                Ok(applied) => {
                    tracing::info!(job_id, summary = applied.summary(), "LiDAR import applied");
                    if applied.changed {
                        published_layer = connection
                            .query_row(
                                "SELECT layer_id FROM lidar_import_jobs WHERE id = ?1",
                                [job_id],
                                |row| row.get::<_, String>(0),
                            )
                            .ok();
                    } else if let Some(message) = applied.message {
                        let _ = connection.execute(
                            "UPDATE lidar_import_jobs SET message = ?2, updated_at = ?3 WHERE id = ?1",
                            rusqlite::params![job_id, message, now_iso()],
                        );
                    }
                }
                Err(error) => {
                    let (state, message) = if error == "cancelled" {
                        ("cancelled", "import cancelled".to_string())
                    } else {
                        ("failed", error)
                    };
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs SET state = ?2, message = ?3, updated_at = ?4 WHERE id = ?1",
                        rusqlite::params![job_id, state, message, now_iso()],
                    );
                }
            }
        }
        self.settle_cancel(job_id);
        // Dependency-aware invalidation: enqueue one refresh per definition.
        if let Some(layer_id) = published_layer.filter(|id| !id.is_empty()) {
            self.refresh_dependents(&layer_id);
        }
    }

    fn refresh_dependents(&self, layer_id: &str) {
        let enqueued = {
            let connection = self.catalogue();
            let Ok(connection) = connection else {
                return;
            };
            analysis::enqueue_refreshes(&connection, layer_id)
        };
        for (job_id, definition_id, parameters_json, source_generation_id) in enqueued {
            let library = self.clone();
            tauri::async_runtime::spawn(async move {
                library
                    .run_refresh(job_id, definition_id, parameters_json, source_generation_id)
                    .await;
            });
        }
    }

    async fn run_refresh(
        self,
        job_id: String,
        definition_id: String,
        parameters_json: String,
        source_generation_id: String,
    ) {
        let Ok(executor) = self.executor() else {
            return;
        };
        let parameters = analysis::parse_parameters(&parameters_json)
            .unwrap_or(analysis::AnalysisParameters { slope_unit: None });
        let flag = self.register_cancel(&job_id);
        let library = self.clone();
        let job_id_for_run = job_id.clone();
        let definition_id_for_run = definition_id.clone();
        let source_generation = source_generation_id.clone();
        let library_for_work = library.clone();
        let outcome = executor
            .run(
                crate::native_operation::NativeOperationClass::Local,
                "lidar analysis refresh",
                move || {
                    analysis::run_slope_job(
                        &library_for_work,
                        &job_id_for_run,
                        &definition_id_for_run,
                        &parameters,
                        &source_generation,
                        &flag,
                    )
                },
            )
            .await;
        match outcome {
            Ok(analysis::AnalysisOutcome { stale: true, .. }) => {
                let connection = self.catalogue();
                if let Ok(connection) = connection {
                    let _ = connection.execute(
                        "UPDATE lidar_analysis_jobs SET state = 'cancelled', message = 'superseded by a newer source generation', updated_at = ?2 WHERE id = ?1",
                        rusqlite::params![job_id, now_iso()],
                    );
                }
            }
            Ok(outcome) => {
                tracing::info!(
                    definition_id,
                    summary = outcome.summary(),
                    "LiDAR analysis refresh settled"
                );
            }
            Err(error) => {
                let state = if error == "cancelled" {
                    "cancelled"
                } else {
                    "failed"
                };
                let connection = self.catalogue();
                if let Ok(connection) = connection {
                    let _ = connection.execute(
                        "UPDATE lidar_analysis_jobs SET state = ?2, message = ?3, updated_at = ?4 WHERE id = ?1",
                        rusqlite::params![job_id, state, error, now_iso()],
                    );
                }
            }
        }
        self.settle_cancel(&job_id);
    }

    /// Create an analysis definition and run its first job through the
    /// standard enqueue path.
    pub fn create_analysis(
        &self,
        layer_id: &str,
        kind: LidarAnalysisKind,
        parameters: LidarAnalysisParameters,
    ) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
        let connection = self.catalogue()?;
        let layer = catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        analysis::capability(kind, layer.measurement_kind.as_str())?;
        catalogue::head_generation(&connection, layer_id)?
            .ok_or_else(|| "Layer has no accepted coverage to analyse yet".to_string())?;
        let definition_id = new_id("adef");
        let parameters_json = serde_json::to_string(&parameters).map_err(|e| e.to_string())?;
        connection
            .execute(
                "INSERT INTO lidar_analysis_definitions(id, layer_id, kind, version, parameters_json, created_at)
                 VALUES(?1, ?2, ?3, 1, ?4, ?5)",
                rusqlite::params![definition_id, layer_id, kind.as_str(), parameters_json, now_iso()],
            )
            .map_err(|e| format!("Failed to create analysis definition: {e}"))?;
        connection
            .execute(
                "INSERT INTO lidar_dependencies(definition_id, layer_id, kind) VALUES(?1, ?2, 'source')",
                rusqlite::params![definition_id, layer_id],
            )
            .map_err(|e| e.to_string())?;
        // Enqueue the first job through the standard refresh path so the
        // receipt carries the real job identity.
        let enqueued = analysis::enqueue_refreshes(&connection, layer_id);
        let receipt = enqueued
            .iter()
            .find(|(_, definition, _, _)| definition == &definition_id)
            .map(
                |(job_id, definition, _, _)| common_types::lidar::LidarAnalysisReceipt {
                    definition_id: definition.clone(),
                    job_id: job_id.clone(),
                },
            );
        for (job_id, definition_id, parameters_json, source_generation_id) in enqueued {
            let library = self.clone();
            tauri::async_runtime::spawn(async move {
                library
                    .run_refresh(job_id, definition_id, parameters_json, source_generation_id)
                    .await;
            });
        }
        receipt.ok_or_else(|| "analysis refresh could not be enqueued".to_string())
    }

    pub fn delete_analysis(&self, definition_id: &str) -> Result<(), String> {
        let connection = self.catalogue()?;
        connection
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            for table in [
                "lidar_analysis_heads",
                "lidar_analysis_jobs",
                "lidar_analysis_generations",
                "lidar_dependencies",
                "lidar_analysis_definitions",
            ] {
                connection
                    .execute(
                        &format!("DELETE FROM {table} WHERE id = ?1 OR definition_id = ?1"),
                        [definition_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match result {
            Ok(()) => connection
                .execute_batch("COMMIT")
                .map_err(|e| e.to_string()),
            Err(error) => {
                let _ = connection.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_pruning_keeps_live_display_generation_and_removes_stale_one() {
        let root = std::env::temp_dir().join(new_id("lidar-prune-test"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Pruning fixture",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
            )
            .unwrap();
        let live_generation = new_id("gen");
        let stale_generation = new_id("gen");
        {
            let connection = library.catalogue().unwrap();
            connection.execute(
                "INSERT INTO lidar_layer_generations
                 (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                  coverage_cells, min_value, max_value, bounds_3857)
                 VALUES (?1, ?2, ?3, '', '', '{}', 1, 0, 1, '[0,0,1,1]')",
                rusqlite::params![live_generation, layer_id, now_iso()],
            ).unwrap();
            connection.execute(
                "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES (?1, ?2)",
                rusqlite::params![layer_id, live_generation],
            ).unwrap();
        }
        let live_dir = library.inner.paths.display_generation_dir(
            "source", &layer_id, &live_generation, "elevation",
        );
        let stale_dir = library.inner.paths.display_generation_dir(
            "source", &layer_id, &stale_generation, "elevation",
        );
        std::fs::create_dir_all(&live_dir).unwrap();
        std::fs::create_dir_all(&stale_dir).unwrap();
        std::fs::write(live_dir.join("13_0_0.png"), b"live").unwrap();
        std::fs::write(stale_dir.join("13_0_0.png"), b"stale").unwrap();
        {
            let display = library.display().unwrap();
            for (generation, dir) in [
                (&live_generation, &live_dir),
                (&stale_generation, &stale_dir),
            ] {
                display.execute(
                    "INSERT INTO tilesets
                     (key, entity_kind, entity_id, generation_id, style, dir, path_template,
                      min_zoom, max_zoom, bounds_3857, tile_count, bytes, created_at)
                     VALUES (?1, 'source', ?2, ?3, 'elevation', ?4, ?5,
                             13, 13, '[0,0,1,1]', 1, 4, ?6)",
                    rusqlite::params![
                        format!("source/{layer_id}/{generation}/elevation"),
                        layer_id,
                        generation,
                        dir.display().to_string(),
                        dir.join("{z}_{x}_{y}.png").display().to_string(),
                        now_iso(),
                    ],
                ).unwrap();
            }
        }
        drop(library);

        let reopened = LidarLibrary::open(&root).unwrap();
        assert!(live_dir.join("13_0_0.png").is_file());
        assert!(!stale_dir.exists());
        let display = reopened.display().unwrap();
        let remaining: i64 = display
            .query_row("SELECT COUNT(*) FROM tilesets", [], |row| row.get(0))
            .unwrap();
        assert_eq!(remaining, 1);
        drop(display);
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub(crate) struct CatalogueGuard<'a>(std::sync::MutexGuard<'a, Connection>);

impl std::ops::Deref for CatalogueGuard<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        &self.0
    }
}

fn open_display_cache(path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|e| format!("Failed to open display cache {}: {e}", path.display()))?;
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS tilesets (
                key TEXT PRIMARY KEY,
                entity_kind TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                generation_id TEXT NOT NULL,
                style TEXT NOT NULL,
                dir TEXT NOT NULL,
                path_template TEXT NOT NULL,
                min_zoom INTEGER NOT NULL,
                max_zoom INTEGER NOT NULL,
                bounds_3857 TEXT NOT NULL,
                tile_count INTEGER NOT NULL,
                bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to init display cache: {e}"))?;
    Ok(connection)
}

fn parse_import_state(raw: &str) -> LidarImportJobState {
    match raw {
        "awaiting_review" => LidarImportJobState::AwaitingReview,
        "applying" => LidarImportJobState::Applying,
        "complete" => LidarImportJobState::Complete,
        "cancelled" => LidarImportJobState::Cancelled,
        "failed" => LidarImportJobState::Failed,
        _ => LidarImportJobState::Staging,
    }
}

fn parse_result_state(raw: &str) -> LidarResultState {
    match raw {
        "ready" | "complete" => LidarResultState::Ready,
        "refreshing" => LidarResultState::Refreshing,
        "incomplete" => LidarResultState::Incomplete,
        "failed" | "cancelled" => LidarResultState::Failed,
        _ => LidarResultState::Preparing,
    }
}

fn default_units(kind: common_types::lidar::LidarMeasurementKind) -> String {
    match kind {
        common_types::lidar::LidarMeasurementKind::GroundElevation
        | common_types::lidar::LidarMeasurementKind::SurfaceElevation
        | common_types::lidar::LidarMeasurementKind::AboveGroundHeight => "m".to_string(),
        common_types::lidar::LidarMeasurementKind::OtherContinuous => "unitless".to_string(),
    }
}
