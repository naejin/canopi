//! Local LiDAR raster library service.
//!
//! The subsystem owns files, jobs, engines and caches; the map host owns map
//! lifetime and documents own presentation references. Library mutations
//! never dirty a Design, and no catalogue lock is held during raster
//! computation.

pub mod admission;
pub mod analysis;
pub mod catalogue;
mod collection;
pub mod display;
#[cfg(test)]
mod e2e;
pub mod engine;
mod generation;
pub mod grid;
pub mod import;
mod inspection;
#[cfg(test)]
mod measurement;
pub mod paths;
mod prepared_raster;
pub mod presentation;
pub mod probe;
mod raster_assets;
mod tile_cache;
mod tiles;

use catalogue::{new_id, now_iso};
use common_types::lidar::{
    LidarAnalysisJobStatus, LidarAnalysisKind, LidarAnalysisParameters, LidarImportJob,
    LidarImportJobState, LidarImportProgress, LidarImportProgressPhase, LidarResultState,
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

/// One ordered-member edit request, dispatched under the heavy raster lease.
enum MemberEdit {
    Move(String, bool),
    Remove(String),
    Restore(String),
}

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
    /// Prepared compatibility leases for preserved dense compositions.
    ///
    /// A dense mosaic is not in the controlled COG profile, so replaying it
    /// needs one GDAL derivative per preserved generation. This cache is the
    /// single lifecycle owner: the derivative is prepared on first use, reused
    /// by every later read, and released when the layer is deleted or the
    /// library closes.
    compat_leases: Mutex<HashMap<String, Arc<Mutex<Option<generation::LegacyTiffLease>>>>>,
    /// One exclusive heavy raster job at a time, library-wide. Staging, apply,
    /// undo and analysis all hold it; awaiting review releases it.
    heavy_job: Mutex<Option<String>>,
    /// Bounded display read admission, separate from the heavy lease.
    display: Mutex<DisplayAdmission>,
    /// Shared reproducible tile cache, bounded in memory and on disk.
    tile_cache: Mutex<tile_cache::DisplayTileCache>,
}

/// Most display reads that may run at once, library-wide.
pub(crate) const MAX_ACTIVE_DISPLAY_REQUESTS: usize = 2;
/// Most display reads that may wait for a slot, library-wide.
pub(crate) const MAX_QUEUED_DISPLAY_REQUESTS: usize = 32;

/// Library-wide display read admission.
///
/// Display reads are bounded separately from the heavy raster lease: two may
/// run at once, thirty-two may wait, and anything beyond that is declined by
/// name instead of being allowed to exceed the bound. A cancelled request
/// stops waiting or stops at its next bounded read.
#[derive(Default)]
struct DisplayAdmission {
    active: HashMap<String, Arc<AtomicBool>>,
    queued: Vec<(String, Arc<AtomicBool>)>,
}

/// The display basis a stored label names.
///
/// An unrecognised or absent label is read as `Exact`: that is the conservative
/// reading, because a range presented as measured never claims more than it is.
pub(crate) fn display_range_basis(
    stored: Option<&str>,
) -> common_types::lidar::LidarDisplayRangeBasis {
    match stored {
        Some("source-envelope") => common_types::lidar::LidarDisplayRangeBasis::SourceEnvelope,
        _ => common_types::lidar::LidarDisplayRangeBasis::Exact,
    }
}

/// The stored label for one display basis.
pub(crate) fn display_basis_label(
    basis: common_types::lidar::LidarDisplayRangeBasis,
) -> &'static str {
    match basis {
        common_types::lidar::LidarDisplayRangeBasis::Exact => "exact",
        common_types::lidar::LidarDisplayRangeBasis::SourceEnvelope => "source-envelope",
    }
}

/// The admission name one inspection lookup occupies.
///
/// Scoped by surface so an inspection cancel can never signal a raster tile's
/// read, or another caller's lookup, that happens to share an id.
pub(crate) fn sample_admission_name(request_id: &str) -> String {
    format!("sample-{request_id}")
}

/// One admitted display read. Dropping it frees its slot.
pub(crate) struct DisplayTicket {
    inner: Arc<LidarLibraryInner>,
    request_id: String,
    cancel: Arc<AtomicBool>,
    active: bool,
}

impl DisplayTicket {
    pub(crate) fn cancel_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancel)
    }

    /// Whether this request has been cancelled while waiting or running.
    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Take a slot when one is free and this request is next in line.
    pub(crate) fn try_activate(&mut self) -> Result<bool, String> {
        if self.active {
            return Ok(true);
        }
        if self.is_cancelled() {
            return Err("cancelled".to_string());
        }
        let mut admission = self
            .inner
            .display
            .lock()
            .map_err(|_| "LiDAR display admission poisoned".to_string())?;
        if admission.active.len() >= MAX_ACTIVE_DISPLAY_REQUESTS {
            return Ok(false);
        }
        // Obsolete work is dropped first: a cancelled waiter never takes a
        // slot from a newer viewport request.
        while let Some((queued_id, flag)) = admission.queued.first() {
            let cancelled = flag.load(Ordering::Relaxed);
            let is_self = queued_id == &self.request_id;
            if !cancelled {
                break;
            }
            admission.queued.remove(0);
            if is_self {
                return Err("cancelled".to_string());
            }
        }
        match admission.queued.first() {
            Some((queued_id, _)) if queued_id == &self.request_id => {
                admission.queued.remove(0);
            }
            // A newer viewport request supersedes waiting work.
            _ => return Ok(false),
        }
        admission
            .active
            .insert(self.request_id.clone(), Arc::clone(&self.cancel));
        self.active = true;
        Ok(true)
    }
}

impl Drop for DisplayTicket {
    fn drop(&mut self) {
        if let Ok(mut admission) = self.inner.display.lock() {
            admission.active.remove(&self.request_id);
            admission
                .queued
                .retain(|(queued_id, _)| queued_id != &self.request_id);
        }
    }
}

/// Exclusive ownership of the library's heavy raster work.
///
/// The lease is held for exactly as long as the work runs and released when
/// the guard drops, so a queued submission is refused promptly instead of
/// creating running work that would compete for the same disk, memory and
/// GDAL children.
pub(crate) struct HeavyJobLease {
    inner: Arc<LidarLibraryInner>,
    job_id: String,
}

impl HeavyJobLease {
    fn acquire(library: &LidarLibrary, job_id: &str) -> Result<Self, String> {
        let mut holder = library
            .inner
            .heavy_job
            .lock()
            .map_err(|_| "LiDAR heavy job lease poisoned".to_string())?;
        if let Some(current) = holder.as_deref()
            && current != job_id
        {
            return Err(format!(
                "another raster job is already running ({current}); retry when it finishes"
            ));
        }
        *holder = Some(job_id.to_string());
        Ok(Self {
            inner: library.inner.clone(),
            job_id: job_id.to_string(),
        })
    }
}

impl Drop for HeavyJobLease {
    fn drop(&mut self) {
        if let Ok(mut holder) = self.inner.heavy_job.lock()
            && holder.as_deref() == Some(self.job_id.as_str())
        {
            *holder = None;
        }
    }
}

impl LidarLibrary {
    pub fn open(app_data_dir: &std::path::Path) -> Result<Self, String> {
        let paths = LidarPaths::open(app_data_dir)?;
        let display_cache_dir = paths.tile_cache_dir();
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
                heavy_job: Mutex::new(None),
                compat_leases: Mutex::new(HashMap::new()),
                display: Mutex::new(DisplayAdmission::default()),
                tile_cache: Mutex::new(tile_cache::DisplayTileCache::open(&display_cache_dir)?),
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
        // Startup reconciliation: a library opened after a source change whose
        // refresh never ran, failed or was cancelled is re-scheduled once the
        // executor exists. Enqueuing is not a retry loop — it is the once-per-
        // open version of what an Apply already does, and a definition whose
        // result is current is skipped by the same orchestration.
        self.schedule_startup_refreshes();
    }

    /// Re-schedule dependent refreshes for layers whose current result is not
    /// the current head.
    fn schedule_startup_refreshes(&self) {
        let stale_layers = {
            let Ok(connection) = self.catalogue() else {
                return;
            };
            let Ok(definitions) = catalogue::list_all_definitions(&connection) else {
                return;
            };
            let mut layers = Vec::new();
            for definition in definitions {
                let Ok(Some(head)) = catalogue::head_generation(&connection, &definition.layer_id)
                else {
                    continue;
                };
                let current = catalogue::head_analysis_generation(&connection, &definition.id)
                    .ok()
                    .flatten()
                    .is_some_and(|result| result.source_generation_id == head.id);
                if !current && !layers.contains(&definition.layer_id) {
                    layers.push(definition.layer_id.clone());
                }
            }
            layers
        };
        for layer_id in stale_layers {
            self.refresh_dependents(&layer_id);
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

    /// Drop cached display tiles of one generation. Best effort: the cache is
    /// a reproducible derivative, so a failure here is never user-visible.
    fn invalidate_tile_cache(&self, generation_id: &str) {
        if let Ok(mut cache) = self.tile_cache() {
            cache.invalidate_generation(generation_id);
        }
    }

    pub(crate) fn tile_cache(
        &self,
    ) -> Result<MutexGuard<'_, tile_cache::DisplayTileCache>, String> {
        self.inner
            .tile_cache
            .lock()
            .map_err(|_| "LiDAR display tile cache poisoned".to_string())
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
        // Reconcile promotion journals before any settled job payload is
        // removed: a committed asset stays, an uncommitted owned promotion is
        // removed, and a journal that cannot be settled is retained as
        // recoverable evidence instead of being silently declared clean.
        let journal_jobs: Vec<String> = {
            let connection = self.catalogue()?;
            let mut statement = connection
                .prepare("SELECT id FROM lidar_import_jobs")
                .map_err(|e| e.to_string())?;
            statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        // Recovery is a precondition for opening the library: an unresolved
        // journal leaves the only record of what an interrupted job promoted, so
        // opening fails with a named recoverable error and the unresolved root
        // stays intact. Removing the fault and reopening completes cleanup; no
        // retry loop and no background recovery service are involved.
        match import::reconcile_promotion_journals(self, &journal_jobs) {
            Ok(removed) if removed > 0 => {
                tracing::info!(removed, "removed uncommitted promoted source assets");
            }
            Ok(_) => {}
            Err(error) => {
                return Err(format!(
                    "LiDAR library recovery is incomplete; unresolved promotion evidence was retained and can be retried by reopening: {error}"
                ));
            }
        }
        for (job_id, _state) in settled {
            // One cleanup decision per root: a journal that cannot be settled
            // keeps its directory and its evidence.
            if let Err(error) = import::settle_job_root(self, &job_id) {
                return Err(format!(
                    "LiDAR library recovery is incomplete; job {job_id} was retained for retry: {error}"
                ));
            }
        }
        // Display cache writes are owned and atomic; a session that died
        // mid-write leaves only temp files, which are never readable entries.
        if let Ok(cache) = self.tile_cache() {
            cache.discard_interrupted_writes();
        }
        // Write jobs that crashed before publication left `staging-*` roots
        // behind. Only staging roots are removed: published `gen-*` dirs,
        // member assets and immutable originals are never candidates.
        self.prune_staging_roots()?;
        // A job that crashed before its publish transaction left chunk rows
        // that were never readable. Removing them cannot revoke an accepted
        // generation; only physical assets remain for reclamation.
        {
            let connection = self.catalogue()?;
            let discarded = catalogue::discard_unpublished_chunks(&connection)?;
            if discarded > 0 {
                tracing::info!(discarded, "discarded unpublished raster chunk rows");
            }
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

    /// Remove abandoned `staging-*` roots under the prepared pipeline dirs.
    ///
    /// Every staging root is unpublished scratch by construction, and no job
    /// is running while startup pruning executes, so each one is stale. The
    /// scan is one `read_dir` per pipeline directory.
    fn prune_staging_roots(&self) -> Result<(), String> {
        let prepared = self.inner.paths.prepared_dir();
        for family in ["layers", "analysis"] {
            let family_dir = prepared.join(family);
            for entity in std::fs::read_dir(&family_dir)
                .into_iter()
                .flatten()
                .flatten()
            {
                for entry in std::fs::read_dir(entity.path())
                    .into_iter()
                    .flatten()
                    .flatten()
                {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if !name.starts_with("staging-") {
                        continue;
                    }
                    if let Err(error) = std::fs::remove_dir_all(entry.path()) {
                        tracing::warn!(
                            path = %entry.path().display(),
                            error = %error,
                            "failed to remove abandoned staging root"
                        );
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

    /// One bounded numeric inspection lookup.
    ///
    /// The read is synchronous inside the caller's executor slot — it touches
    /// one pixel — and takes a caller-owned cancellation flag so a superseded
    /// aim releases the native work instead of leaving it running.
    pub fn sample(
        &self,
        request: &common_types::lidar::LidarSampleRequest,
        cancel: &std::sync::atomic::AtomicBool,
    ) -> Result<common_types::lidar::LidarSampleOutcome, String> {
        inspection::sample(self, &self.inner.engine, cancel, request)
    }

    pub fn create_layer(
        &self,
        name: &str,
        measurement_kind: common_types::lidar::LidarMeasurementKind,
        unit_label: Option<&str>,
        unit_unknown: bool,
    ) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Layer name must not be empty".to_string());
        }
        let id = new_id("lyr");
        let units = resolve_units(measurement_kind, unit_label, unit_unknown)?;
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
        let (definition_ids, job_ids) = {
            let connection = self.catalogue()?;
            let definitions = catalogue::list_definitions_for_layer(&connection, layer_id)?;
            let definition_ids = definitions
                .into_iter()
                .map(|definition| definition.id)
                .collect::<Vec<_>>();
            let mut statement = connection
                .prepare(
                    "SELECT id FROM lidar_import_jobs WHERE layer_id = ?1
                     UNION SELECT j.id FROM lidar_analysis_jobs j
                     JOIN lidar_analysis_definitions d ON d.id = j.definition_id
                     WHERE d.layer_id = ?1",
                )
                .map_err(|e| e.to_string())?;
            let job_ids = statement
                .query_map([layer_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            (definition_ids, job_ids)
        };
        for job_id in &job_ids {
            self.cancel_job(job_id);
        }

        let connection = self.catalogue()?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        for definition_id in &definition_ids {
            delete_analysis_rows(&transaction, definition_id)?;
        }
        transaction
            .execute(
                "DELETE FROM lidar_acceptance_regions WHERE generation_id IN
                 (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        transaction
            .execute(
                "DELETE FROM lidar_generation_members WHERE generation_id IN
                 (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        // Ordered snapshots keep their own member rows, which reference the
        // generations deleted below.
        transaction
            .execute(
                "DELETE FROM lidar_collection_members WHERE generation_id IN
                 (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        // A snapshot may also be the predecessor of another snapshot; clear the
        // lineage before the rows themselves so the self-reference never blocks
        // the delete.
        transaction
            .execute(
                "UPDATE lidar_layer_generations SET previous_generation_id = NULL
                 WHERE layer_id = ?1",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        transaction
            .execute(
                "UPDATE lidar_layer_generations SET base_generation_id = NULL
                 WHERE layer_id = ?1",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        let removed_generations: Vec<String> = {
            let mut statement = transaction
                .prepare("SELECT id FROM lidar_layer_generations WHERE layer_id = ?1")
                .map_err(|e| e.to_string())?;
            statement
                .query_map([layer_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let footprint_ids = {
            let mut statement = transaction
                .prepare("SELECT id FROM lidar_source_footprints WHERE layer_id = ?1")
                .map_err(|e| e.to_string())?;
            statement
                .query_map([layer_id], |row| row.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for footprint_id in footprint_ids {
            transaction
                .execute(
                    "DELETE FROM lidar_footprint_rtree WHERE id = ?1",
                    [footprint_id],
                )
                .map_err(|e| e.to_string())?;
        }
        // Chunk rows carry no foreign key to their generation (they are
        // inserted before it commits), so they are revoked with it explicitly.
        transaction
            .execute(
                "DELETE FROM lidar_generation_chunks WHERE generation_id IN
                 (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        for sql in [
            "DELETE FROM lidar_source_footprints WHERE layer_id = ?1",
            "DELETE FROM lidar_layer_heads WHERE layer_id = ?1",
            "DELETE FROM lidar_import_jobs WHERE layer_id = ?1",
            "DELETE FROM lidar_layer_generations WHERE layer_id = ?1",
            "DELETE FROM lidar_source_layers WHERE id = ?1",
        ] {
            transaction
                .execute(sql, [layer_id])
                .map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())?;
        drop(connection);

        self.remove_display_entity("source", layer_id);
        for generation_id in removed_generations {
            self.invalidate_tile_cache(&generation_id);
            // The layer's preserved compositions stop being readable here, so
            // this is the owner's release point for their prepared leases.
            self.release_compat_lease(&generation_id);
        }
        let _ = std::fs::remove_dir_all(self.inner.paths.layer_pipeline_dir(layer_id));
        for definition_id in definition_ids {
            self.remove_display_entity("analysis", &definition_id);
            let _ = std::fs::remove_dir_all(self.inner.paths.analysis_pipeline_dir(&definition_id));
        }
        Ok(())
    }

    /// One bounded page of a layer's publication history, newest first.
    ///
    /// The first call captures the traversal's upper bound; later pages carry
    /// it in the cursor, so versions published while the user pages through
    /// History cannot shift the window under them.
    pub fn layer_history_page(
        &self,
        layer_id: &str,
        cursor: Option<&str>,
    ) -> Result<common_types::lidar::LidarLayerHistoryPage, String> {
        let (upper_rowid, after_rowid) = match cursor {
            Some(cursor) => {
                let (upper, after) = collection::decode_version_cursor(cursor)?;
                (Some(upper), Some(after))
            }
            None => (None, None),
        };
        let connection = self.catalogue()?;
        let page = collection::history_page(
            &connection,
            layer_id,
            upper_rowid,
            after_rowid,
            common_types::lidar::LAYER_HISTORY_PAGE,
        )?;
        Ok(common_types::lidar::LidarLayerHistoryPage {
            layer_id: layer_id.to_string(),
            head_generation_id: catalogue::head_generation(&connection, layer_id)?
                .map(|row| row.id),
            versions: page
                .versions
                .into_iter()
                .map(|entry| common_types::lidar::LidarGenerationHistoryEntry {
                    id: entry.generation_id,
                    created_at: entry.created_at,
                    coverage_cells: entry.coverage_cells.map(|cells| cells.max(0) as u64),
                    display_range: entry.display_min_value.zip(entry.display_max_value).map(
                        |(min, max)| common_types::lidar::LidarDisplayRange {
                            min,
                            max,
                            basis: display_range_basis(entry.display_basis.as_deref()),
                        },
                    ),
                    source_count: u32::try_from(entry.member_count).unwrap_or(u32::MAX),
                    sequence: u32::try_from(entry.sequence.max(0)).unwrap_or(u32::MAX),
                    is_head: entry.is_current,
                    restorable: entry.restorable,
                    operation: entry.operation,
                })
                .collect(),
            next_cursor: page.next_cursor,
        })
    }

    /// The ordered composition of one Data Layer, one bounded member page at a
    /// time.
    ///
    /// Membership and order are library data, so the Design is never dirtied by
    /// a reorder and every referencing Design sees the same list. A member page
    /// is bound to the immutable snapshot it was requested from: a late page of
    /// a superseded head is refused by name rather than mixed into a newer
    /// list, and the summary reports Undo explicitly so an exhausted walk is
    /// distinguishable from one that targets the empty composition.
    pub fn layer_collection(
        &self,
        layer_id: &str,
        cursor: Option<&str>,
    ) -> Result<common_types::lidar::LidarLayerCollection, String> {
        let (cursor_head, after_position) = match cursor {
            Some(cursor) => {
                let (head, position) = collection::decode_member_cursor(cursor)?;
                (Some(head), Some(position))
            }
            None => (None, None),
        };
        let connection = self.catalogue()?;
        let head = catalogue::head_generation(&connection, layer_id)?;
        let head_manifest = head
            .as_ref()
            .map(|row| import::read_generation_manifest(&row.manifest_json))
            .transpose()?;
        let head_ordered = head.as_ref().is_some_and(|row| {
            head_manifest
                .as_ref()
                .is_some_and(|manifest| manifest.format.is_ordered_collection())
                && !row.id.is_empty()
        });
        let head_id = head.as_ref().map(|row| row.id.clone());
        let (undo_available, undo_target) = head
            .as_ref()
            .map(|row| (row.undo_available, row.previous_generation_id.clone()))
            .unwrap_or((false, None));
        let (member_rows, member_count) = match head_id.as_deref().filter(|_| head_ordered) {
            Some(head) => {
                if let Some(cursor_head) = cursor_head.as_deref()
                    && cursor_head != head
                {
                    return Err(
                        "the layer changed since this page was requested; refresh and try again"
                            .to_string(),
                    );
                }
                let rows = catalogue::collection_members_page(
                    &connection,
                    head,
                    after_position,
                    common_types::lidar::LAYER_MEMBER_PAGE,
                )?;
                let count = catalogue::collection_member_count(&connection, head)?;
                (rows, count)
            }
            // A pre-transition head presents the one divisible member its next
            // edit will produce, so the list agrees with the model the user is
            // about to enter instead of appearing empty.
            None => {
                let rows = head_id
                    .as_ref()
                    .map(|head| {
                        vec![catalogue::CollectionMemberRow {
                            member_id: format!("prev-{head}"),
                            position: 0,
                            kind: collection::PREVIOUS_COMPOSITION_KIND.to_string(),
                            interpretation_id: None,
                            base_generation_id: Some(head.clone()),
                            job_id: None,
                        }]
                    })
                    .unwrap_or_default();
                let count = rows.len() as i64;
                (rows, count)
            }
        };
        let last_position = member_rows.last().map(|row| row.position);
        let sources = member_rows
            .iter()
            .map(|member| {
                let interpretation = member
                    .interpretation_id
                    .as_deref()
                    .map(|id| catalogue::get_interpretation(&connection, id))
                    .transpose()?
                    .flatten();
                let (coverage_cells, min_value, max_value) =
                    match member.interpretation_id.as_deref() {
                        Some(id) => catalogue::interpretation_coverage(&connection, id)?,
                        None => (0, None, None),
                    };
                let filename = match member.interpretation_id.as_deref() {
                    Some(id) => catalogue::interpretation_filename(&connection, id)?,
                    None => None,
                };
                let (width, height, pixel_size_m) = match &interpretation {
                    Some(row) => (
                        u32::try_from(row.width.max(0)).unwrap_or(u32::MAX),
                        u32::try_from(row.height.max(0)).unwrap_or(u32::MAX),
                        import::parse_geotransform(&row.geotransform)
                            .map(|transform| transform[1].abs())
                            .unwrap_or(0.0),
                    ),
                    None => (0, 0, 0.0),
                };
                Ok(common_types::lidar::LidarLayerSource {
                    member_id: member.member_id.clone(),
                    kind: member.kind.clone(),
                    filename,
                    interpretation_id: member.interpretation_id.clone(),
                    base_generation_id: member.base_generation_id.clone(),
                    width,
                    height,
                    pixel_size_m,
                    coverage_cells: coverage_cells.max(0) as u64,
                    value_range: [min_value.unwrap_or(0.0), max_value.unwrap_or(0.0)],
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let has_more = sources.len() as i64 == common_types::lidar::LAYER_MEMBER_PAGE
            && (after_position.unwrap_or(-1) + sources.len() as i64) < member_count;
        let next_member_cursor = match (&head_id, last_position, has_more) {
            (Some(head), Some(position), true) => {
                Some(collection::encode_member_cursor(head, position))
            }
            _ => None,
        };
        Ok(common_types::lidar::LidarLayerCollection {
            layer_id: layer_id.to_string(),
            head_generation_id: head_id,
            member_count: u32::try_from(member_count.max(0)).unwrap_or(u32::MAX),
            undo_available,
            undo_target,
            sources,
            next_member_cursor,
        })
    }

    /// Admit one display read, or decline it when the budget is full.
    ///
    /// The caller waits for a slot by polling [`DisplayTicket::try_activate`]
    /// between short async sleeps, so a waiting display read never occupies a
    /// Native Operation Executor permit behind another heavy job.
    pub(crate) fn admit_display_request(&self, request_id: &str) -> Result<DisplayTicket, String> {
        if request_id.is_empty() {
            return Err("display request identity must not be empty".to_string());
        }
        let mut admission = self
            .inner
            .display
            .lock()
            .map_err(|_| "LiDAR display admission poisoned".to_string())?;
        let cancel = Arc::new(AtomicBool::new(false));
        if admission.active.len() >= MAX_ACTIVE_DISPLAY_REQUESTS {
            if admission.queued.len() >= MAX_QUEUED_DISPLAY_REQUESTS {
                return Err(format!(
                    "the display request budget is full ({MAX_QUEUED_DISPLAY_REQUESTS} queued)"
                ));
            }
            admission
                .queued
                .push((request_id.to_string(), Arc::clone(&cancel)));
            return Ok(DisplayTicket {
                inner: self.inner.clone(),
                request_id: request_id.to_string(),
                cancel,
                active: false,
            });
        }
        admission
            .active
            .insert(request_id.to_string(), Arc::clone(&cancel));
        Ok(DisplayTicket {
            inner: self.inner.clone(),
            request_id: request_id.to_string(),
            cancel,
            active: true,
        })
    }

    /// Admit one inspection lookup into the shared bounded read admission.
    ///
    /// `None` when the caller named no lookup: an older caller still works and
    /// simply occupies no cancellable slot rather than reserving one it cannot
    /// release. Inspection deliberately shares the display budget, so a burst of
    /// abandoned lookups is bounded by the same active/queued limits tiles use.
    pub(crate) fn admit_sample_request(
        &self,
        request_id: &str,
    ) -> Result<Option<DisplayTicket>, String> {
        if request_id.is_empty() {
            return Ok(None);
        }
        self.admit_display_request(&sample_admission_name(request_id))
            .map(Some)
    }

    /// Cancel one inspection lookup.
    ///
    /// The admission name is scoped to the inspection surface, so this can
    /// never signal a raster tile's read — or another surface's lookup — that
    /// happens to carry the same caller-chosen id.
    pub fn cancel_sample_request(&self, request_id: &str) {
        if request_id.is_empty() {
            return;
        }
        self.cancel_display_request(&sample_admission_name(request_id));
    }

    /// Cancel one display read: a waiting request stops waiting, a running one
    /// stops at its next bounded read. Bounded in-memory state only.
    pub fn cancel_display_request(&self, request_id: &str) {
        if let Ok(admission) = self.inner.display.lock() {
            if let Some(flag) = admission.active.get(request_id) {
                flag.store(true, Ordering::Relaxed);
            }
            if let Some((_, flag)) = admission
                .queued
                .iter()
                .find(|(queued_id, _)| queued_id == request_id)
            {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Render one bounded display tile as encoded PNG bytes.
    ///
    /// An empty tile returns the shared transparent PNG, so "no coverage" is a
    /// successful draw of nothing; an unreadable generation returns an error,
    /// which the caller must surface as unavailable rather than transparent.
    #[allow(clippy::too_many_arguments)]
    pub fn render_tile(
        &self,
        entity_kind: &str,
        entity_id: &str,
        generation_id: &str,
        style: &str,
        z: u32,
        x: u32,
        y: u32,
        cancel: &AtomicBool,
    ) -> Result<Vec<u8>, String> {
        let request = tiles::TileRequest {
            entity_kind: entity_kind.to_string(),
            entity_id: entity_id.to_string(),
            generation_id: generation_id.to_string(),
            style: style.to_string(),
            z,
            x,
            y,
        };
        match tiles::render_tile(self, &request, cancel)? {
            tiles::TileOutcome::Png(bytes) => Ok(bytes),
            tiles::TileOutcome::Empty => Ok(tiles::transparent_tile()?.to_vec()),
        }
    }

    /// The one prepared compatibility lease for a preserved dense generation.
    ///
    /// The library is the lifecycle owner: the derivative is prepared once for
    /// the generation and every later read of the same preserved composition
    /// reuses it. Two readers can hold the lease's handle at once, but only one
    /// conversion ever runs.
    fn compat_lease(
        &self,
        generation_id: &str,
        mosaic: &std::path::Path,
        grid: &grid::RasterGrid,
        nodata: Option<f32>,
        mask: Option<PathBuf>,
        cancel: &AtomicBool,
    ) -> Result<Arc<Mutex<Option<generation::LegacyTiffLease>>>, String> {
        if let Some(existing) = self
            .inner
            .compat_leases
            .lock()
            .map_err(|_| "compatibility lease cache poisoned".to_string())?
            .get(generation_id)
            .cloned()
        {
            return Ok(existing);
        }
        let scratch = self
            .inner
            .paths
            .prepared_dir()
            .join(format!("compat-{generation_id}"));
        std::fs::create_dir_all(&scratch)
            .map_err(|e| format!("Failed to create compatibility scratch dir: {e}"))?;
        let lease = generation::LegacyTiffLease::open(
            &self.inner.engine,
            mosaic,
            grid,
            nodata,
            mask,
            &scratch,
            cancel,
        )?;
        let handle = Arc::new(Mutex::new(Some(lease)));
        let mut cache = self
            .inner
            .compat_leases
            .lock()
            .map_err(|_| "compatibility lease cache poisoned".to_string())?;
        // Another reader may have prepared the same generation meanwhile: keep
        // the first handle so exactly one derivative exists per generation.
        let entry = cache
            .entry(generation_id.to_string())
            .or_insert_with(|| handle.clone())
            .clone();
        Ok(entry)
    }

    /// Release one preserved generation's compatibility lease and its scratch.
    ///
    /// Called when the generation stops being readable (its layer is deleted)
    /// and at library close. Dropping the lease removes the derivative.
    fn release_compat_lease(&self, generation_id: &str) {
        let removed = self
            .inner
            .compat_leases
            .lock()
            .ok()
            .and_then(|mut cache| cache.remove(generation_id));
        if let Some(handle) = removed
            && let Ok(mut slot) = handle.lock()
        {
            *slot = None;
        }
        let scratch = self
            .inner
            .paths
            .prepared_dir()
            .join(format!("compat-{generation_id}"));
        let _ = std::fs::remove_dir_all(scratch);
    }

    /// Short admission read for one ordered-member edit.
    ///
    /// The command path runs this through the native executor before any work
    /// is created, so a stale or unknown edit is refused without taking the
    /// heavy raster lease or spawning a job.
    /// Short admission read for one ordered-member edit.
    ///
    /// The command path runs this through the native executor before any work
    /// is created, so a stale or unknown edit is refused without taking the
    /// heavy raster lease or spawning a job.
    pub fn validate_layer_edit(
        &self,
        layer_id: &str,
        member_id: Option<&str>,
        expected_head: Option<&str>,
    ) -> Result<(), String> {
        let connection = self.catalogue()?;
        let head = catalogue::head_generation(&connection, layer_id)?
            .ok_or_else(|| "layer has no accepted coverage".to_string())?;
        if let Some(expected) = expected_head
            && expected != head.id
        {
            return Err(
                "the layer changed since this edit was prepared; refresh and try again".to_string(),
            );
        }
        if let Some(member_id) = member_id {
            let ordered = import::read_generation_manifest(&head.manifest_json)
                .map(|manifest| manifest.format.is_ordered_collection())
                .unwrap_or(false);
            let members = if ordered {
                catalogue::collection_members(&connection, &head.id)?
            } else {
                Vec::new()
            };
            // A pre-transition head has no ordered rows yet; it presents the one
            // previous-composition member its next edit will produce.
            let known = members.iter().any(|row| row.member_id == member_id)
                || (!ordered && member_id == format!("prev-{}", head.id));
            if !known {
                return Err(format!("no source {member_id} in this layer"));
            }
        }
        Ok(())
    }

    /// Run one ordered-member edit and settle it before returning.
    ///
    /// The command awaits the real work and its settlement, so the caller learns
    /// what actually happened — the authoritative head, whether a snapshot was
    /// published, or the named refusal — instead of an acknowledgement that the
    /// work was merely queued. Pre-commit failure is an error; a publication
    /// that committed is success even when a later cleanup or refresh step
    /// reports a diagnostic.
    async fn apply_member_edit(
        &self,
        layer_id: &str,
        expected_head: Option<String>,
        edit: Option<MemberEdit>,
    ) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
        let scope = format!("collection-{layer_id}");
        // The lease is taken before any work exists, so a competing heavy job is
        // refused promptly and never waits behind this one.
        let lease = HeavyJobLease::acquire(self, &scope)?;
        let executor = self.executor()?;
        let flag = self.register_cancel(&scope);
        let library = self.clone();
        let layer = layer_id.to_string();
        let layer_for_work = layer.clone();
        let outcome = executor
            .run(
                crate::native_operation::NativeOperationClass::Local,
                "lidar layer edit",
                move || {
                    let _lease = lease;
                    let head = expected_head.as_deref();
                    match edit {
                        Some(MemberEdit::Move(member_id, towards_top)) => import::move_member(
                            &library,
                            &layer_for_work,
                            &member_id,
                            towards_top,
                            head,
                            &flag,
                        ),
                        Some(MemberEdit::Remove(member_id)) => import::remove_member(
                            &library,
                            &layer_for_work,
                            &member_id,
                            head,
                            &flag,
                        ),
                        Some(MemberEdit::Restore(version_id)) => import::restore_version(
                            &library,
                            &layer_for_work,
                            &version_id,
                            head,
                            &flag,
                        ),
                        None => import::undo_last_change(&library, &layer_for_work, head, &flag),
                    }
                },
            )
            .await;
        self.settle_layer_edit(&layer, &scope, outcome)
    }

    /// Undo the last change of one layer from the version list.
    pub async fn apply_undo(
        &self,
        layer_id: &str,
        expected_head: Option<String>,
    ) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
        self.apply_member_edit(layer_id, expected_head, None).await
    }

    /// Restore one older version as the new head.
    pub async fn apply_restore(
        &self,
        layer_id: &str,
        version_id: &str,
        expected_head: Option<String>,
    ) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
        self.apply_member_edit(
            layer_id,
            expected_head,
            Some(MemberEdit::Restore(version_id.to_string())),
        )
        .await
    }

    /// Move one source one position in the layer's priority list.
    pub async fn apply_move(
        &self,
        layer_id: &str,
        member_id: &str,
        towards_top: bool,
        expected_head: Option<String>,
    ) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
        self.apply_member_edit(
            layer_id,
            expected_head,
            Some(MemberEdit::Move(member_id.to_string(), towards_top)),
        )
        .await
    }

    /// Detach one source from the layer's current composition.
    pub async fn apply_remove(
        &self,
        layer_id: &str,
        member_id: &str,
        expected_head: Option<String>,
    ) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
        self.apply_member_edit(
            layer_id,
            expected_head,
            Some(MemberEdit::Remove(member_id.to_string())),
        )
        .await
    }

    /// Settle one ordered-member edit and report what happened.
    ///
    /// A committed snapshot is success even when a later cleanup or refresh
    /// scheduling step reports a diagnostic; a pre-commit failure or
    /// cancellation stays a named error. The returned head is the
    /// authoritative one after settlement, so a caller never has to guess
    /// whether its request landed.
    pub(crate) fn settle_layer_edit(
        &self,
        layer_id: &str,
        scope: &str,
        outcome: Result<import::ApplyOutcome, String>,
    ) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
        let applied = match outcome {
            Ok(applied) => applied,
            Err(error) => {
                self.settle_cancel(scope);
                self.refresh_snapshot_quiet();
                tracing::warn!(layer_id, error, "LiDAR layer edit failed");
                return Err(error);
            }
        };
        self.settle_cancel(scope);
        self.refresh_snapshot_quiet();
        // A committed numeric edit invalidates every dependent result: the
        // refresh is what keeps Ready from describing a composition the layer
        // no longer has.
        if applied.changed {
            self.refresh_dependents(layer_id);
        }
        let head = self
            .catalogue()
            .ok()
            .and_then(|connection| {
                catalogue::head_generation(&connection, layer_id)
                    .ok()
                    .flatten()
            })
            .map(|row| row.id);
        tracing::info!(
            layer_id,
            summary = applied.summary(),
            "LiDAR layer snapshot settled"
        );
        Ok(common_types::lidar::LidarLayerEditOutcome {
            head_generation_id: head,
            changed: applied.changed,
            message: applied.message,
        })
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
        let progress = row
            .progress_phase
            .as_deref()
            .and_then(parse_import_progress_phase)
            .zip(row.progress_percent)
            .and_then(|(phase, percent)| {
                u8::try_from(percent)
                    .ok()
                    .filter(|percent| *percent <= 100)
                    .map(|percent| LidarImportProgress { phase, percent })
            });
        Ok(Some(LidarImportJob {
            job_id: row.id,
            layer_id: row.layer_id,
            state: parse_import_state(&row.state),
            review,
            message: row.message,
            progress,
        }))
    }

    pub(crate) fn record_import_progress(
        &self,
        job_id: &str,
        phase: LidarImportProgressPhase,
        percent: u8,
    ) {
        let result = self.catalogue().and_then(|connection| {
            catalogue::update_import_progress(
                &connection,
                job_id,
                import_progress_phase_key(phase),
                percent,
            )
            .map(|_| ())
        });
        if let Err(error) = result {
            tracing::warn!(job_id, error, "LiDAR import progress update failed");
        }
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
        let mut discard_review = false;
        if let Ok(connection) = self.catalogue() {
            let import_state = connection
                .query_row(
                    "SELECT state FROM lidar_import_jobs WHERE id = ?1",
                    [job_id],
                    |row| row.get::<_, String>(0),
                )
                .ok();
            discard_review = import_state.as_deref() == Some("awaiting_review");
            let _ = connection.execute(
                "UPDATE lidar_import_jobs
                 SET state = 'cancelled', message = 'import cancelled', updated_at = ?2
                 WHERE id = ?1 AND state IN ('staging', 'awaiting_review', 'applying')",
                rusqlite::params![job_id, now_iso()],
            );
            let _ = connection.execute(
                "UPDATE lidar_analysis_jobs
                 SET state = 'cancelled', message = 'analysis cancelled', updated_at = ?2
                 WHERE id = ?1 AND state IN ('preparing', 'refreshing')",
                rusqlite::params![job_id, now_iso()],
            );
        }
        if discard_review {
            let _ = std::fs::remove_dir_all(self.inner.paths.job_dir(job_id));
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
        // Refuse a competing heavy job before any running work is created;
        // the lease is released when staging settles, which is the moment the
        // user takes over for review.
        let lease = HeavyJobLease::acquire(self, job_id)?;
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
                        let _lease = lease;
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

    /// Prepare and publish a batch in one job, with no review in between.
    ///
    /// This is the production import route: the user's commit intent is the
    /// Import action, so each selected source is prepared and validated and the
    /// batch is published atomically without a second decision screen. The
    /// amendment's rules are enforced by the work below rather than by a
    /// reviewer: preparation is per source and sequential under one heavy-job
    /// lease, the target head is captured before any preparation starts and
    /// rechecked inside the publication transaction, and a pre-commit failure
    /// or cancellation publishes nothing.
    pub fn begin_import_sources(
        &self,
        job_id: &str,
        layer_id: &str,
        source_paths: Vec<PathBuf>,
    ) -> Result<(), String> {
        let lease = HeavyJobLease::acquire(self, job_id)?;
        let executor = self.executor()?;
        let flag = self.register_cancel(job_id);
        let library = self.clone();
        let layer_id_for_work = layer_id.to_string();
        let job_id_for_work = job_id.to_string();
        let job_id_clone = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            let library_for_work = library.clone();
            let job_id_for_stage = job_id_for_work.clone();
            let layer_for_stage = layer_id_for_work.clone();
            let outcome = executor
                .run(
                    crate::native_operation::NativeOperationClass::Local,
                    "lidar import sources",
                    move || {
                        let _lease = lease;
                        // Prepare and validate every selected source. The head
                        // is captured inside this call, before preparation
                        // begins, and carried by the staged payload.
                        match import::stage_import(
                            &library_for_work,
                            &job_id_for_stage,
                            &layer_for_stage,
                            &source_paths,
                            &flag,
                        ) {
                            Ok(_) => {}
                            Err(error) => return Err(error),
                        }
                        let staging =
                            import::read_staged_import(&library_for_work, &job_id_for_stage)?;
                        // Every occurrence is compatible and validated before
                        // anything becomes visible; a partial batch is never
                        // published as a success.
                        import::ensure_whole_batch_compatible(&staging)?;
                        library_for_work.mark_import_publishing(&job_id_for_stage)?;
                        // Publication rechecks the captured head inside its own
                        // transaction, so a head that moved during preparation
                        // is a conflict rather than a silently rebased import.
                        import::apply_import(&library_for_work, &staging, true, false, &flag)
                            .map(|_| ())
                    },
                )
                .await;
            library.finish_import_sources(&job_id_clone, outcome);
        });
        Ok(())
    }

    /// Record the outcome of a one-step import.
    fn finish_import_sources(&self, job_id: &str, outcome: Result<(), String>) {
        if let Ok(connection) = self.catalogue() {
            match outcome {
                Ok(()) => {
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs
                         SET state = 'complete', message = NULL, review_json = NULL,
                             progress_phase = NULL, progress_percent = NULL,
                             updated_at = ?2
                         WHERE id = ?1 AND state IN ('staging', 'applying')",
                        rusqlite::params![job_id, now_iso()],
                    );
                }
                Err(error) => {
                    let (state, message) = if error == "cancelled" {
                        ("cancelled", "import cancelled".to_string())
                    } else {
                        ("failed", error)
                    };
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs
                         SET state = ?2, message = ?3, progress_phase = NULL,
                             progress_percent = NULL, updated_at = ?4
                         WHERE id = ?1 AND state IN ('staging', 'applying')",
                        rusqlite::params![job_id, state, message, now_iso()],
                    );
                    drop(connection);
                    if let Err(cleanup) = import::settle_job_root(self, job_id) {
                        tracing::warn!(
                            job_id,
                            error = %cleanup,
                            "failed import kept its root for recovery"
                        );
                    }
                }
            }
        }
        self.settle_cancel(job_id);
    }

    /// Mark a one-step import as publishing, after its batch was validated.
    fn mark_import_publishing(&self, job_id: &str) -> Result<(), String> {
        let connection = self.catalogue()?;
        connection
            .execute(
                "UPDATE lidar_import_jobs
                 SET state = 'applying', message = NULL,
                     progress_phase = 'composing_layer', progress_percent = 0,
                     updated_at = ?2
                 WHERE id = ?1 AND state = 'staging'",
                rusqlite::params![job_id, now_iso()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn finish_staging(&self, job_id: &str, outcome: Result<import::StagingOutput, String>) {
        let connection = self.catalogue();
        if let Ok(connection) = connection {
            match outcome {
                Ok(output) => {
                    let review_json = serde_json::to_string(&output.review).unwrap_or_default();
                    let changed = connection
                        .execute(
                            "UPDATE lidar_import_jobs
                         SET state = 'awaiting_review', review_json = ?2, message = NULL,
                             progress_phase = NULL, progress_percent = NULL,
                             updated_at = ?3
                         WHERE id = ?1 AND state = 'staging'",
                            rusqlite::params![job_id, review_json, now_iso()],
                        )
                        .unwrap_or(0);
                    if changed == 0 {
                        let _ = std::fs::remove_dir_all(self.inner.paths.job_dir(job_id));
                    }
                }
                Err(error) => {
                    let (state, message) = if error == "cancelled" {
                        ("cancelled", "import cancelled".to_string())
                    } else {
                        ("failed", error)
                    };
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs
                         SET state = ?2, message = ?3, progress_phase = NULL,
                             progress_percent = NULL, updated_at = ?4 WHERE id = ?1",
                        rusqlite::params![job_id, state, message, now_iso()],
                    );
                    // A settled job owns no payload, but its root is removed
                    // only through the same reconciliation decision: a journal
                    // that cannot be settled keeps its evidence for retry.
                    drop(connection);
                    if let Err(cleanup) = import::settle_job_root(self, job_id) {
                        tracing::warn!(
                            job_id,
                            error = %cleanup,
                            "failed staging kept its root for recovery"
                        );
                    }
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
        let staging = import::read_staged_import(self, job_id)?;
        // The whole-batch rule is rechecked before the job leaves review, so a
        // partially rejected selection never even enters the applying state.
        import::ensure_whole_batch_compatible(&staging)?;
        connection
            .execute(
                "UPDATE lidar_import_jobs
                 SET state = 'applying', message = NULL,
                     progress_phase = 'composing_layer', progress_percent = 0,
                     updated_at = ?2 WHERE id = ?1",
                rusqlite::params![job_id, now_iso()],
            )
            .map_err(|e| e.to_string())?;
        Ok(staging)
    }

    /// Render the composition an Apply of this staging would publish.
    pub fn preview_import_decision(
        &self,
        job_id: &str,
    ) -> Result<common_types::lidar::LidarImportDecisionPreview, String> {
        let state: String = {
            let connection = self.catalogue()?;
            connection
                .query_row(
                    "SELECT state FROM lidar_import_jobs WHERE id = ?1",
                    [job_id],
                    |row| row.get(0),
                )
                .map_err(|_| format!("Import job {job_id} does not exist"))?
        };
        if state != "awaiting_review" {
            return Err(format!("Import job is not awaiting review (state {state})"));
        }
        let staging = import::read_staged_import(self, job_id)?;
        let cancel = AtomicBool::new(false);
        import::render_composition_preview(self, &staging, &cancel)
    }

    /// Spawn apply: compose the mosaic, publish the generation and refresh
    /// dependent analyses.
    pub fn begin_apply(
        &self,
        staging: import::StagedImport,
        add_uncovered: bool,
        replace_overlap: bool,
    ) -> Result<(), String> {
        let job_id = staging.job_id.clone();
        let lease = HeavyJobLease::acquire(self, &job_id)?;
        let executor = self.executor()?;
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
                        let _lease = lease;
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

    /// Settle one apply attempt: mark the job from the publication result and
    /// run the dependent-refresh path for a committed layer.
    ///
    /// The spawned apply task and the caller-level tests both drive this, so a
    /// committed publication cannot be reported as failed here.
    pub(crate) fn finish_apply(&self, job_id: &str, outcome: Result<import::ApplyOutcome, String>) {
        let mut published_layer: Option<String> = None;
        let mut refresh_stale_review = false;
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
                    } else {
                        let _ = connection.execute(
                            "UPDATE lidar_import_jobs
                             SET state = 'complete', message = ?2,
                                 progress_phase = 'finalizing', progress_percent = 100,
                                 updated_at = ?3 WHERE id = ?1 AND state = 'applying'",
                            rusqlite::params![job_id, applied.message, now_iso()],
                        );
                    }
                }
                Err(error) => {
                    let (state, message) = if error.starts_with("import review is stale") {
                        refresh_stale_review = true;
                        (
                            "staging",
                            "coverage changed; refreshing import review".to_string(),
                        )
                    } else if error == "cancelled" {
                        ("cancelled", "import cancelled".to_string())
                    } else {
                        ("failed", error)
                    };
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs
                         SET state = ?2, message = ?3,
                             review_json = CASE WHEN ?2 = 'staging' THEN NULL ELSE review_json END,
                             progress_phase = CASE WHEN ?2 = 'staging' THEN NULL ELSE progress_phase END,
                             progress_percent = CASE WHEN ?2 = 'staging' THEN NULL ELSE progress_percent END,
                             updated_at = ?4 WHERE id = ?1",
                        rusqlite::params![job_id, state, message, now_iso()],
                    );
                }
            }
        }
        self.settle_cancel(job_id);
        if refresh_stale_review {
            let staging =
                std::fs::read_to_string(self.inner.paths.job_dir(job_id).join("staging.json"))
                    .map_err(|error| error.to_string())
                    .and_then(|json| {
                        serde_json::from_str::<import::StagedImport>(&json)
                            .map_err(|error| error.to_string())
                    });
            match staging {
                Ok(staging) => {
                    let paths = staging
                        .sources
                        .into_iter()
                        .map(|source| source.managed_original)
                        .collect();
                    if let Err(error) = self.begin_staging(job_id, &staging.layer_id, paths) {
                        self.fail_import_job(job_id, &error);
                    }
                }
                Err(error) => self.fail_import_job(
                    job_id,
                    &format!("Could not refresh stale import review: {error}"),
                ),
            }
        }
        // Dependency-aware invalidation: enqueue one refresh per definition.
        if let Some(layer_id) = published_layer.filter(|id| !id.is_empty()) {
            self.refresh_dependents(&layer_id);
        }
    }

    fn fail_import_job(&self, job_id: &str, message: &str) {
        if let Ok(connection) = self.catalogue() {
            let _ = connection.execute(
                "UPDATE lidar_import_jobs
                 SET state = 'failed', message = ?2, updated_at = ?3 WHERE id = ?1",
                rusqlite::params![job_id, message, now_iso()],
            );
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

    /// Wait for the library-wide heavy lease without holding an executor
    /// permit: a queued refresh must never occupy a permit while another heavy
    /// job runs, and a refresh superseded meanwhile simply stops waiting.
    async fn await_heavy_lease(&self, job_id: &str) -> Option<HeavyJobLease> {
        loop {
            match HeavyJobLease::acquire(self, job_id) {
                Ok(lease) => return Some(lease),
                Err(_) => {
                    // Only a queued refresh keeps waiting; one that was
                    // cancelled or superseded meanwhile stops here.
                    let queued = self.catalogue().ok().is_some_and(|connection| {
                        connection
                            .query_row(
                                "SELECT state FROM lidar_analysis_jobs WHERE id = ?1",
                                [job_id],
                                |row| row.get::<_, String>(0),
                            )
                            .is_ok_and(|state| matches!(state.as_str(), "preparing" | "refreshing"))
                    });
                    if !queued {
                        return None;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        }
    }

    async fn run_refresh(
        self,
        job_id: String,
        definition_id: String,
        parameters_json: String,
        source_generation_id: String,
    ) {
        let Some(lease) = self.await_heavy_lease(&job_id).await else {
            return;
        };
        let Ok(executor) = self.executor() else {
            return;
        };
        let parameters =
            analysis::parse_parameters(&parameters_json).unwrap_or(analysis::AnalysisParameters {
                slope_unit: None,
                name: None,
            });
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
                    let _lease = lease;
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
                let layer_id = self.catalogue().ok().and_then(|connection| {
                    let _ = connection.execute(
                        "UPDATE lidar_analysis_jobs SET state = 'cancelled', message = 'superseded by a newer source generation', updated_at = ?2 WHERE id = ?1",
                        rusqlite::params![job_id, now_iso()],
                    );
                    connection.query_row(
                        "SELECT layer_id FROM lidar_analysis_definitions WHERE id = ?1",
                        [&definition_id],
                        |row| row.get::<_, String>(0),
                    ).ok()
                });
                if let Some(layer_id) = layer_id {
                    self.refresh_dependents(&layer_id);
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
        result_name: Option<String>,
    ) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
        let connection = self.catalogue()?;
        let layer = catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        analysis::capability(kind, layer.measurement_kind.as_str())?;
        catalogue::head_generation(&connection, layer_id)?
            .ok_or_else(|| "Layer has no accepted coverage to analyse yet".to_string())?;
        let definition_id = new_id("adef");
        // The name rides with the definition's parameters, so a refresh
        // publishes the same name instead of silently renaming the user's
        // result, and a caller that sends no name simply publishes unnamed.
        let parameters = analysis::AnalysisParameters {
            slope_unit: parameters.slope_unit,
            name: result_name,
        };
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
        let job_ids = {
            let connection = self.catalogue()?;
            let exists = connection
                .query_row(
                    "SELECT 1 FROM lidar_analysis_definitions WHERE id = ?1",
                    [definition_id],
                    |_| Ok(()),
                )
                .is_ok();
            if !exists {
                return Err(format!("Analysis {definition_id} does not exist"));
            }
            let mut statement = connection
                .prepare("SELECT id FROM lidar_analysis_jobs WHERE definition_id = ?1")
                .map_err(|e| e.to_string())?;
            statement
                .query_map([definition_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for job_id in job_ids {
            self.cancel_job(&job_id);
        }
        let connection = self.catalogue()?;
        let result_generations: Vec<String> = {
            let mut statement = connection
                .prepare("SELECT id FROM lidar_analysis_generations WHERE definition_id = ?1")
                .map_err(|e| e.to_string())?;
            statement
                .query_map([definition_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        delete_analysis_rows(&transaction, definition_id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        drop(connection);
        self.remove_display_entity("analysis", definition_id);
        invalidate_tile_cache_for_collected(self, &result_generations);
        let _ = std::fs::remove_dir_all(self.inner.paths.analysis_pipeline_dir(definition_id));
        Ok(())
    }

    fn remove_display_entity(&self, entity_kind: &str, entity_id: &str) {
        if let Ok(display) = self.display() {
            let _ = display.execute(
                "DELETE FROM tilesets WHERE entity_kind = ?1 AND entity_id = ?2",
                rusqlite::params![entity_kind, entity_id],
            );
        }
        let _ = std::fs::remove_dir_all(
            self.inner
                .paths
                .display_dir()
                .join(entity_kind)
                .join(entity_id),
        );
    }
}

/// Drop cached display tiles of generations a deletion removed.
fn invalidate_tile_cache_for_collected(library: &LidarLibrary, generation_ids: &[String]) {
    for generation_id in generation_ids {
        library.invalidate_tile_cache(generation_id);
    }
}

fn delete_analysis_rows(connection: &Connection, definition_id: &str) -> Result<(), String> {
    // Result and quality chunk rows carry no foreign key to their generation
    // (they are inserted before it commits), so they are revoked with it.
    connection
        .execute(
            "DELETE FROM lidar_generation_chunks WHERE generation_id IN
             (SELECT id FROM lidar_analysis_generations WHERE definition_id = ?1)",
            [definition_id],
        )
        .map_err(|e| e.to_string())?;
    for sql in [
        "DELETE FROM lidar_analysis_heads WHERE definition_id = ?1",
        "DELETE FROM lidar_analysis_jobs WHERE definition_id = ?1",
        "DELETE FROM lidar_analysis_generations WHERE definition_id = ?1",
        "DELETE FROM lidar_dependencies WHERE definition_id = ?1",
        "DELETE FROM lidar_analysis_definitions WHERE id = ?1",
    ] {
        connection
            .execute(sql, [definition_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Runtime helpers remain below this large in-file regression module so the
// production service implementation above stays contiguous.
#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    use super::*;

    fn row_count(connection: &Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn seed_analysis(connection: &Connection, layer_id: &str, definition_id: &str) {
        connection
            .execute(
                "INSERT INTO lidar_analysis_definitions
             (id, layer_id, kind, version, parameters_json, created_at)
             VALUES (?1, ?2, 'slope', 1, '{}', '0')",
                rusqlite::params![definition_id, layer_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_analysis_generations
             (id, definition_id, source_generation_id, engine_version, state, result_path,
              quality_mask_path, manifest_json, coverage_cells, min_value, max_value,
              bounds_3857, published_at)
             VALUES ('agen-1', ?1, 'source-gen', 'test', 'complete', '', NULL, '{}',
                     1, 0, 1, '[0,0,1,1]', '0')",
                [definition_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_analysis_heads(definition_id, generation_id)
             VALUES (?1, 'agen-1')",
                [definition_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_analysis_jobs
             (id, definition_id, source_generation_id, state, created_at, updated_at)
             VALUES ('ajob-1', ?1, 'source-gen', 'complete', '0', '0')",
                [definition_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_dependencies(definition_id, layer_id, kind)
             VALUES (?1, ?2, 'source')",
                rusqlite::params![definition_id, layer_id],
            )
            .unwrap();
    }

    /// An "other continuous" dataset must declare its unit.
    ///
    /// Elevation and height are measured in metres, so their label is fixed and
    /// a caller cannot contradict it. A continuous dataset that is neither has
    /// no inherent unit, and the three states must stay distinguishable: a real
    /// label, an explicit unknown, and undeclared. Undeclared is refused rather
    /// than stored, because a label like `unitless` would assert the values are
    /// dimensionless — a measurement claim nobody made.
    #[test]
    fn an_other_continuous_layer_must_declare_its_unit() {
        use common_types::lidar::LidarMeasurementKind;

        // A real label is stored as given, trimmed.
        assert_eq!(
            resolve_units(
                LidarMeasurementKind::OtherContinuous,
                Some("  mg/kg "),
                false
            )
            .unwrap(),
            "mg/kg"
        );
        // An explicit unknown is stored as the sentinel, not as a label the
        // author never chose.
        assert_eq!(
            resolve_units(LidarMeasurementKind::OtherContinuous, None, true).unwrap(),
            common_types::lidar::LIDAR_UNITS_UNKNOWN
        );
        // Undeclared is refused.
        assert!(
            resolve_units(LidarMeasurementKind::OtherContinuous, None, false).is_err(),
            "an undeclared unit must not be stored"
        );
        // Whitespace is not a label.
        assert!(
            resolve_units(LidarMeasurementKind::OtherContinuous, Some("   "), false).is_err(),
            "a blank label is undeclared, not a unit"
        );
        // Claiming both is contradictory.
        assert!(
            resolve_units(LidarMeasurementKind::OtherContinuous, Some("mg/kg"), true).is_err(),
            "a label and an explicit unknown cannot both hold"
        );

        // Elevation and height are always metres and refuse both declarations,
        // so a caller cannot relabel a measurement that has an inherent unit.
        for kind in [
            LidarMeasurementKind::GroundElevation,
            LidarMeasurementKind::SurfaceElevation,
            LidarMeasurementKind::AboveGroundHeight,
        ] {
            assert_eq!(resolve_units(kind, None, false).unwrap(), "m");
            assert!(
                resolve_units(kind, Some("ft"), false).is_err(),
                "{} must not accept a substitute unit",
                kind.as_str()
            );
            assert!(
                resolve_units(kind, None, true).is_err(),
                "{} is not of unknown unit",
                kind.as_str()
            );
        }
    }

    #[test]
    fn delete_analysis_removes_its_complete_row_graph() {
        let root = std::env::temp_dir().join(new_id("lidar-delete-analysis-test"));
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Delete analysis fixture",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        {
            let connection = library.catalogue().unwrap();
            seed_analysis(&connection, &layer_id, "analysis-1");
        }

        library.delete_analysis("analysis-1").unwrap();
        let connection = library.catalogue().unwrap();
        for table in [
            "lidar_analysis_heads",
            "lidar_analysis_jobs",
            "lidar_analysis_generations",
            "lidar_dependencies",
            "lidar_analysis_definitions",
        ] {
            assert_eq!(row_count(&connection, table), 0, "{table}");
        }
        assert_eq!(row_count(&connection, "lidar_source_layers"), 1);
        drop(connection);
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// P1-1: a public collection read must not re-acquire its own catalogue
    /// lock.
    ///
    /// `layer_collection` holds the catalogue connection while it reads the
    /// layer's history. Calling a public method that takes the same mutex again
    /// deadlocks the whole library, and an empty layer — the case a user hits
    /// first — took exactly that path. The read runs on its own thread with a
    /// deadline so a regression fails instead of hanging the suite.
    #[test]
    fn a_public_collection_read_does_not_re_acquire_the_catalogue_lock() {
        let root = std::env::temp_dir().join(new_id("canopi-collection-lock"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "Empty",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();

        let read = |name: &'static str, library: LidarLibrary, layer_id: String| {
            let (sender, receiver) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let page = library.layer_collection(&layer_id, None);
                let history = library.layer_history_page(&layer_id, None);
                let _ = sender.send((page, history));
            });
            receiver
                .recv_timeout(std::time::Duration::from_secs(20))
                .unwrap_or_else(|_| {
                    panic!("{name} deadlocked on the catalogue lock it already holds")
                })
        };

        let (page, history) = read(
            "a collection read of an empty layer",
            library.clone(),
            layer_id.clone(),
        );
        let page = page.expect("the summary reads");
        assert_eq!(page.layer_id, layer_id);
        assert_eq!(page.member_count, 0, "an empty layer has no occurrences");
        assert!(page.sources.is_empty());
        assert!(page.head_generation_id.is_none());
        assert!(!page.undo_available, "an empty layer has nothing to undo");
        let history = history.expect("the history page reads");
        assert!(history.versions.is_empty());

        // A bounded member page and a bounded history page are the same public
        // surface, so both are exercised on the same thread.
        let (page, history) = read(
            "a paged read of an empty layer",
            library.clone(),
            layer_id.clone(),
        );
        assert!(page.expect("the paged summary reads").sources.is_empty());
        assert!(
            history
                .expect("the paged history reads")
                .versions
                .is_empty()
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_layer_removes_all_referencing_rows_with_foreign_keys_enabled() {
        let root = std::env::temp_dir().join(new_id("lidar-delete-layer-test"));
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Delete layer fixture",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_sources
                 (sha256, original_filename, size_bytes, probe_json, imported_at)
                 VALUES ('sha-delete', 'source', 1, '{}', '0')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_interpretations
                 (id, source_sha256, band_index, measurement_kind, units, scale, offset,
                  crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash)
                 VALUES ('interp-delete', 'sha-delete', 1, 'ground-elevation', 'm', 1, 0,
                         'test', 'unknown', -9999, '[0,1,0,1,0,-1]', 1, 1, 'hash-delete')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_generations
                 (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                  coverage_cells, min_value, max_value, bounds_3857)
                 VALUES ('source-gen', ?1, '0', '', '', '{}', 1, 0, 1, '[0,0,1,1]')",
                    [&layer_id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_generation_members
                 (generation_id, interpretation_id, role, ordinal)
                 VALUES ('source-gen', 'interp-delete', 'add', 0)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_acceptance_regions
                 (id, generation_id, interpretation_id, decision, job_id)
                 VALUES ('accept-delete', 'source-gen', 'interp-delete', 'add', 'import-delete')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_heads(layer_id, generation_id)
                 VALUES (?1, 'source-gen')",
                    [&layer_id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_import_jobs
                 (id, layer_id, state, created_at, updated_at)
                 VALUES ('import-delete', ?1, 'complete', '0', '0')",
                    [&layer_id],
                )
                .unwrap();
            catalogue::upsert_footprint(
                &connection,
                "interp-delete",
                &layer_id,
                [0.0, 0.0, 1.0, 1.0],
            )
            .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_raster_assets
                        (sha256, rel_path, bytes, profile, width, height, geotransform,
                         crs_wkt, nodata, created_at)
                     VALUES ('sha-asset-delete', 'assets/sha-asset-delete/cog.tif', 4,
                             'cog-f32-t256-raw-v1', 1, 1, '[0,1,0,1,0,-1]', 'test', NULL, '0')",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_generation_chunks
                        (generation_id, role, chunk_x, chunk_y, asset_sha256,
                         valid_cells, min_value, max_value, sum_value, state)
                     VALUES ('source-gen', 'result', 0, 0, 'sha-asset-delete', 1, 1, 1, 1,
                             'published')",
                    [],
                )
                .unwrap();
            seed_analysis(&connection, &layer_id, "analysis-delete");
        }

        library.delete_layer(&layer_id).unwrap();
        let connection = library.catalogue().unwrap();
        for table in [
            "lidar_source_layers",
            "lidar_layer_heads",
            "lidar_layer_generations",
            "lidar_generation_members",
            "lidar_acceptance_regions",
            "lidar_import_jobs",
            "lidar_source_footprints",
            "lidar_analysis_heads",
            "lidar_analysis_jobs",
            "lidar_analysis_generations",
            "lidar_dependencies",
            "lidar_analysis_definitions",
            "lidar_generation_chunks",
        ] {
            assert_eq!(row_count(&connection, table), 0, "{table}");
        }
        assert_eq!(row_count(&connection, "lidar_interpretations"), 1);
        // Immutable content-addressed assets outlive the generation that
        // referenced them; only catalogue-aware reclamation removes bytes.
        assert_eq!(row_count(&connection, "lidar_raster_assets"), 1);
        drop(connection);
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn heavy_raster_lease_is_exclusive_and_released_on_every_path() {
        let root = std::env::temp_dir().join(new_id("lidar-heavy-lease-test"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Lease fixture",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let holding = library.record_import_job(&layer_id).unwrap();
        let competing = library.record_import_job(&layer_id).unwrap();

        // One heavy job holds the library-wide lease...
        let lease = HeavyJobLease::acquire(&library, &holding).unwrap();
        // ...so a competing submission is refused promptly instead of creating
        // running work.
        let error = library
            .begin_staging(&competing, &layer_id, Vec::new())
            .expect_err("a competing heavy submission must be refused");
        assert!(error.contains("already running"), "{error}");
        {
            let connection = library.catalogue().unwrap();
            let state: String = connection
                .query_row(
                    "SELECT state FROM lidar_import_jobs WHERE id = ?1",
                    [&competing],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(state, "staging", "the refused job was left untouched");
        }

        // Releasing admits the next holder, and an early failure releases the
        // lease instead of wedging the library for the rest of the session.
        drop(lease);
        drop(HeavyJobLease::acquire(&library, &competing).unwrap());
        assert!(
            library
                .begin_staging(&holding, &layer_id, Vec::new())
                .is_err(),
            "no executor is attached in this fixture"
        );
        drop(HeavyJobLease::acquire(&library, &holding).unwrap());

        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// The one-step import route prepares, validates and publishes in one job.
    ///
    /// The amendment's flow is: the Import action *is* the commit intent, so
    /// there is no review state and no second decision. This drives the same
    /// calls the orchestration makes, in the same order, and asserts the
    /// properties that flow depends on — including that a batch with an
    /// unusable file publishes nothing and names the file.
    #[test]
    #[ignore = "requires the GDAL command-line tools on PATH or CANOPI_LIDAR_GDAL_BIN"]
    fn one_step_import_publishes_without_review_and_refuses_an_invalid_batch() {
        let engine = engine::GdalEngine::new();
        let cancel = AtomicBool::new(false);
        let root = std::env::temp_dir().join(new_id("canopi-one-step-import"));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();

        // Two four-by-four planes over the same lattice: the second starts one
        // column east so the batch has uncovered coverage to add.
        let plane = |name: &str, value: f32, origin_x: f64| -> std::path::PathBuf {
            let values = vec![value; 16];
            let raw = root.join(format!("{name}.raw"));
            import::write_f32_raw(&raw, &values).expect("raw plane");
            let tif = root.join(format!("{name}.tif"));
            let grid = grid::RasterGrid {
                width: 4,
                height: 4,
                geotransform: [origin_x, 1.0, 0.0, 4.0, 0.0, -1.0],
            };
            import::raw_to_tif(&engine, &cancel, &raw, &tif, &grid, "EPSG:3857", -9999.0)
                .expect("plane converts");
            tif
        };
        let west = plane("west", 5.0, 0.0);
        let east = plane("east", 9.0, 3.0);

        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer(
                "one step",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .expect("layer created");

        // The production sequence, without the spawned wrapper around it.
        let job_id = library.record_import_job(&layer_id).expect("job recorded");
        import::stage_import(
            &library,
            &job_id,
            &layer_id,
            &[west.clone(), east.clone()],
            &cancel,
        )
        .expect("staging succeeds");
        // Preparation leaves the job staging: the one-step route never enters
        // the review state, so nothing can be waiting for a decision.
        let job = library
            .get_import_job(&job_id)
            .unwrap()
            .expect("job exists");
        assert_eq!(
            format!("{:?}", job.state),
            "Staging",
            "the one-step route must not stop for review"
        );
        let staging = import::read_staged_import(&library, &job_id).expect("staged payload");
        import::ensure_whole_batch_compatible(&staging).expect("every source is compatible");
        library
            .mark_import_publishing(&job_id)
            .expect("the job moves to publishing");
        import::apply_import(&library, &staging, true, false, &cancel).expect("apply publishes");
        library.finish_import_sources(&job_id, Ok(()));

        let job = library
            .get_import_job(&job_id)
            .unwrap()
            .expect("job exists");
        assert_eq!(format!("{:?}", job.state), "Complete");
        assert!(job.review.is_none(), "a review is not part of this route");

        // Two occurrences published as one generation, and the batch is visible.
        let connection = library.catalogue().unwrap();
        let head = catalogue::head_generation(&connection, &layer_id)
            .unwrap()
            .expect("a head was published");
        assert_eq!(
            catalogue::collection_member_count(&connection, &head.id).unwrap(),
            2
        );
        drop(connection);

        // A batch whose second file cannot be used publishes nothing and names
        // the file, leaving the accepted head exactly where it was.
        let broken = root.join("broken.tif");
        std::fs::write(&broken, b"not a raster").expect("broken file");
        let before = catalogue::head_generation(&library.catalogue().unwrap(), &layer_id)
            .unwrap()
            .expect("head")
            .id;
        let second_job = library.record_import_job(&layer_id).expect("job recorded");
        let failure = import::stage_import(
            &library,
            &second_job,
            &layer_id,
            &[east.clone(), broken.clone()],
            &cancel,
        )
        .expect_err("an unusable source refuses the batch");
        assert!(
            failure.contains("broken.tif"),
            "the refusal names the file: {failure}"
        );
        let after = catalogue::head_generation(&library.catalogue().unwrap(), &layer_id)
            .unwrap()
            .expect("head")
            .id;
        assert_eq!(after, before, "a refused batch leaves the head untouched");

        drop(library);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An inspection lookup shares the display admission and is cancellable.
    ///
    /// The defect this pins: the sample command passed an always-false flag and
    /// entered no admission at all, so a superseded or abandoned lookup could
    /// not be stopped and could not be accounted for. The scoping is part of
    /// the contract — a caller cancels *its* lookup, never a tile's read or
    /// another surface's entry that happens to carry the same id.
    #[test]
    fn inspection_reads_share_the_display_admission_and_are_scoped() {
        let root = std::env::temp_dir().join(new_id("lidar-sample-admission-test"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();

        // A named lookup takes a real slot, and cancelling it signals the flag
        // the read is actually given.
        let mut sample = library
            .admit_sample_request("lookup-1")
            .unwrap()
            .expect("a named lookup is admitted");
        assert!(sample.try_activate().unwrap());
        let flag = sample.cancel_flag();
        assert!(!flag.load(Ordering::Relaxed));
        library.cancel_sample_request("lookup-1");
        assert!(flag.load(Ordering::Relaxed));

        // The same caller-chosen id on another surface is a different entry:
        // cancelling the inspection lookup must not have signalled it.
        let tile = library.admit_display_request("lookup-1").unwrap();
        let tile_flag = tile.cancel_flag();
        assert!(!tile_flag.load(Ordering::Relaxed));
        library.cancel_sample_request("lookup-1");
        assert!(!tile_flag.load(Ordering::Relaxed));
        // ...and cancelling the tile leaves the inspection name alone.
        let sample_two = library
            .admit_sample_request("lookup-2")
            .unwrap()
            .expect("a named lookup is admitted");
        let sample_two_flag = sample_two.cancel_flag();
        library.cancel_display_request("lookup-2");
        assert!(!sample_two_flag.load(Ordering::Relaxed));
        library.cancel_sample_request("lookup-2");
        assert!(sample_two_flag.load(Ordering::Relaxed));

        // A caller that names no lookup still works and occupies no slot, so
        // it cannot hold admission it has no way to release.
        assert!(library.admit_sample_request("").unwrap().is_none());

        // Dropping a finished lookup frees its slot for the next one.
        drop(sample);
        drop(sample_two);
        drop(tile);
        let mut next = library
            .admit_sample_request("lookup-3")
            .unwrap()
            .expect("a named lookup is admitted");
        assert!(next.try_activate().unwrap());
        drop(next);

        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn display_reads_are_bounded_in_order_and_cancellable() {
        let root = std::env::temp_dir().join(new_id("lidar-display-admission-test"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();

        // Two reads may run at once.
        let first = library.admit_display_request("tile-1").unwrap();
        let second = library.admit_display_request("tile-2").unwrap();
        // The next thirty-two wait their turn...
        let mut queued = Vec::new();
        for index in 0..MAX_QUEUED_DISPLAY_REQUESTS {
            queued.push(
                library
                    .admit_display_request(&format!("tile-q{index}"))
                    .unwrap(),
            );
        }
        // ...and anything beyond the bound is declined by name.
        let error = match library.admit_display_request("tile-overflow") {
            Ok(_) => panic!("the display budget must decline extra work"),
            Err(error) => error,
        };
        assert!(error.contains("budget is full"), "{error}");

        // A waiting read neither runs early nor jumps the queue.
        assert!(!queued[0].try_activate().unwrap());
        let mut newcomer = {
            drop(queued.pop().unwrap());
            library.admit_display_request("tile-newcomer").unwrap()
        };
        drop(first);
        assert!(queued[0].try_activate().unwrap());
        assert!(!newcomer.try_activate().unwrap());

        // Cancelling a waiter stops it instead of letting it take a slot.
        library.cancel_display_request("tile-newcomer");
        assert!(newcomer.try_activate().is_err());
        drop(newcomer);

        // Cancelling a running read signals its own flag.
        let flag = second.cancel_flag();
        assert!(!flag.load(Ordering::Relaxed));
        library.cancel_display_request("tile-2");
        assert!(flag.load(Ordering::Relaxed));

        drop(second);
        drop(queued);
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_pruning_keeps_live_display_generation_and_removes_stale_one() {
        let root = std::env::temp_dir().join(new_id("lidar-prune-test"));
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Pruning fixture",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
            .unwrap();
        let live_generation = new_id("gen");
        let stale_generation = new_id("gen");
        {
            let connection = library.catalogue().unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_generations
                 (id, layer_id, created_at, mosaic_path, coverage_mask_path, manifest_json,
                  coverage_cells, min_value, max_value, bounds_3857)
                 VALUES (?1, ?2, ?3, '', '', '{}', 1, 0, 1, '[0,0,1,1]')",
                    rusqlite::params![live_generation, layer_id, now_iso()],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_heads(layer_id, generation_id) VALUES (?1, ?2)",
                    rusqlite::params![layer_id, live_generation],
                )
                .unwrap();
        }
        let live_dir = library.inner.paths.display_generation_dir(
            "source",
            &layer_id,
            &live_generation,
            "elevation",
        );
        let stale_dir = library.inner.paths.display_generation_dir(
            "source",
            &layer_id,
            &stale_generation,
            "elevation",
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
                display
                    .execute(
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
                    )
                    .unwrap();
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

fn import_progress_phase_key(phase: LidarImportProgressPhase) -> &'static str {
    match phase {
        LidarImportProgressPhase::ComposingLayer => "composing_layer",
        LidarImportProgressPhase::PreparingRaster => "preparing_raster",
        LidarImportProgressPhase::RenderingMap => "rendering_map",
        LidarImportProgressPhase::Finalizing => "finalizing",
    }
}

fn parse_import_progress_phase(raw: &str) -> Option<LidarImportProgressPhase> {
    match raw {
        "composing_layer" => Some(LidarImportProgressPhase::ComposingLayer),
        "preparing_raster" => Some(LidarImportProgressPhase::PreparingRaster),
        "rendering_map" => Some(LidarImportProgressPhase::RenderingMap),
        "finalizing" => Some(LidarImportProgressPhase::Finalizing),
        _ => None,
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
        // Only reachable through `resolve_units`, which refuses an undeclared
        // unit, so this arm is never the answer for a stored layer.
        common_types::lidar::LidarMeasurementKind::OtherContinuous => {
            common_types::lidar::LIDAR_UNITS_UNKNOWN.to_string()
        }
    }
}

/// The unit label for a new layer, or a refusal when none was declared.
///
/// Elevation and height have an inherent unit, so their label is fixed and a
/// caller cannot contradict it. An "other continuous" dataset has no inherent
/// unit, so its author must either supply one or state that it is unknown:
/// silently storing a label such as `unitless` would assert the values are
/// dimensionless, which is a measurement claim nobody made.
fn resolve_units(
    kind: common_types::lidar::LidarMeasurementKind,
    unit_label: Option<&str>,
    unit_unknown: bool,
) -> Result<String, String> {
    use common_types::lidar::LidarMeasurementKind;
    match kind {
        LidarMeasurementKind::GroundElevation
        | LidarMeasurementKind::SurfaceElevation
        | LidarMeasurementKind::AboveGroundHeight => {
            if unit_label.is_some() || unit_unknown {
                return Err(format!(
                    "A {} dataset is measured in metres; its unit is not selectable",
                    kind.as_str()
                ));
            }
            Ok(default_units(kind))
        }
        LidarMeasurementKind::OtherContinuous => {
            let label = unit_label.map(str::trim).filter(|value| !value.is_empty());
            match (label, unit_unknown) {
                (Some(_), true) => Err(
                    "Declare either a unit label or that the unit is unknown, not both".to_string(),
                ),
                (Some(label), false) => Ok(label.to_string()),
                (None, true) => Ok(common_types::lidar::LIDAR_UNITS_UNKNOWN.to_string()),
                (None, false) => Err(
                    "An other continuous dataset must declare a unit label or that its unit is unknown"
                        .to_string(),
                ),
            }
        }
    }
}
