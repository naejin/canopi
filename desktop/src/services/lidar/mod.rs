//! Local LiDAR raster library service.
//!
//! The subsystem owns files, jobs, engines and caches; the map host owns map
//! lifetime and documents own presentation references. Library mutations
//! never dirty a Design, and no catalogue lock is held during raster
//! computation.

#[cfg(test)]
mod acceptance_hooks;
pub mod admission;
pub(crate) mod analyses;
mod analysis_registry_generated;
pub mod catalogue;
mod collection;
mod coverage;
mod display_cog;
#[cfg(test)]
mod e2e;
pub mod engine;
#[cfg(test)]
mod gdal_engine;
mod generation;
mod geolibre;
pub mod grid;
pub mod import;
mod inspection;
#[cfg(test)]
mod measurement;
pub mod paths;
mod prepared_raster;
pub mod presentation;
mod process;
mod raster_assets;
pub(crate) mod recovery;
pub(crate) mod rust_engine;
pub(crate) mod source_meta;

use catalogue::{new_id, now_iso};
use common_types::library::{
    AnalysisReceipt, AnalysisRequest, LibraryDeleteImpact, ProcessingHistoryPage, ProcessingRun,
    ProcessingRunOutput, RasterQuantity,
};
use common_types::lidar::{
    LidarImportJob, LidarImportJobState, LidarImportProgress, LidarImportProgressPhase,
};
use engine::RasterEngine;
use paths::LidarPaths;
use rusqlite::{Connection, OptionalExtension as _};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::MutexGuard;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

pub type LidarSnapshot = common_types::library::LibrarySnapshot;

#[derive(Clone)]
pub struct LidarLibrary {
    pub(crate) inner: Arc<LidarLibraryInner>,
}

pub(crate) struct LidarLibraryInner {
    pub(crate) paths: LidarPaths,
    catalogue: Mutex<Connection>,
    /// How the catalogue opened; anything but `Ready` is a diagnostic, and a
    /// refused library takes no mutation.
    status: recovery::LibraryOpenStatus,
    display_cache: Mutex<Connection>,
    pub(crate) engine: Box<dyn RasterEngine>,
    /// The pinned GeoLibre CLI sidecar every registered analysis runs on.
    pub(crate) geolibre: geolibre::GeolibreEngine,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    executor: Mutex<Option<crate::native_operation::NativeOperationExecutor>>,
    /// One exclusive heavy raster job at a time, library-wide. Import and
    /// analysis jobs hold it.
    heavy_job: Mutex<Option<String>>,
    /// Bounded display read admission, separate from the heavy lease.
    display: Mutex<DisplayAdmission>,
    /// Signalled whenever a waiting read may now proceed or must stop: a slot
    /// or queue place was released, or a read was cancelled.
    display_changed: tokio::sync::Notify,
    /// One lane preparing display derivatives, separate from numeric jobs.
    display_preparation: Mutex<display_cog::DisplayPreparation>,
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
/// Total size of the regular files under `root`; symbolic links are not
/// followed, and a file removed during the walk is skipped.
fn directory_size(root: &std::path::Path) -> std::io::Result<u64> {
    let mut total = 0u64;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        for entry in entries {
            let entry = entry?;
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.is_dir() {
                pending.push(entry.path());
            } else if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
    }
    Ok(total)
}

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

    /// Wait until this request holds a slot, without occupying an executor
    /// permit. Woken by a released slot or a cancel, never by a timer; a
    /// cancelled request stops waiting with `cancelled`.
    pub(crate) async fn activate(&mut self) -> Result<(), String> {
        let inner = Arc::clone(&self.inner);
        loop {
            // Registered before the check, so a release between the check and
            // the wait is not missed.
            let mut changed = std::pin::pin!(inner.display_changed.notified());
            changed.as_mut().enable();
            if self.try_activate()? {
                return Ok(());
            }
            changed.await;
        }
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
        self.inner.display_changed.notify_waiters();
    }
}

/// Exclusive ownership of the library's heavy raster work.
///
/// The lease is held for exactly as long as the work runs and released when
/// the guard drops, so a queued submission is refused promptly instead of
/// creating running work that would compete for the same disk, memory and
/// in-process raster buffers.
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
    /// Open the library under the app data directory.
    ///
    /// A bad catalogue never stops the app: an older or corrupt one is set
    /// aside and rebuilt from the originals, a newer one is refused and the
    /// library runs empty in memory (`recovery.rs`). The display cache and the
    /// startup sweep are best effort too. Only the managed directories failing
    /// to exist is an error.
    pub fn open(app_data_dir: &std::path::Path) -> Result<Self, String> {
        let paths = LidarPaths::open(app_data_dir)?;
        let recovery::OpenedCatalogue {
            connection: catalogue,
            status,
        } = recovery::open_catalogue(&paths)?;
        match &status {
            recovery::LibraryOpenStatus::Ready => {}
            recovery::LibraryOpenStatus::Recovered {
                reason,
                set_aside,
                items,
                generated,
            } => tracing::warn!(
                ?reason,
                set_aside = %set_aside.display(),
                items,
                generated,
                "LiDAR catalogue set aside and rebuilt from the originals"
            ),
            recovery::LibraryOpenStatus::RefusedNewer { found, supported } => tracing::warn!(
                found,
                supported,
                "LiDAR catalogue written by a newer Canopi; the library is empty and read-only"
            ),
            recovery::LibraryOpenStatus::Unavailable { reason } => tracing::error!(
                %reason,
                "LiDAR catalogue could not be opened or rebuilt; the library is empty and read-only"
            ),
        }
        let display_cache = open_display_cache_or_recreate(&paths.display_cache_path())?;
        let engine_logs = paths.engine_log_dir();
        let library = Self {
            inner: Arc::new(LidarLibraryInner {
                paths,
                catalogue: Mutex::new(catalogue),
                status,
                display_cache: Mutex::new(display_cache),
                engine: Box::new(rust_engine::RustRasterEngine),
                geolibre: geolibre::GeolibreEngine::in_dir(engine_logs),
                cancel_flags: Mutex::new(HashMap::new()),
                executor: Mutex::new(None),
                heavy_job: Mutex::new(None),
                display: Mutex::new(DisplayAdmission::default()),
                display_changed: tokio::sync::Notify::new(),
                display_preparation: Mutex::new(display_cog::DisplayPreparation::default()),
            }),
        };
        // A library that does not own its catalogue file sweeps nothing: the
        // files belong to the catalogue that was refused.
        if library.inner.status.refusal().is_some() {
            return Ok(library);
        }
        // Recovery: interrupted jobs fail explicitly; published results and
        // immutable originals are unaffected.
        {
            let connection = library.catalogue()?;
            analyses::recover_interrupted_jobs(&connection)?;
        }
        library.prune_transient_artifacts();
        library.refresh_source_meta();
        Ok(library)
    }

    /// How the catalogue opened at startup.
    pub fn open_status(&self) -> &recovery::LibraryOpenStatus {
        &self.inner.status
    }

    /// Refuse a mutation while the library does not own its catalogue file.
    fn ensure_writable(&self) -> Result<(), String> {
        match self.inner.status.refusal() {
            Some(reason) => Err(reason),
            None => Ok(()),
        }
    }

    /// Rewrite every original's `meta.json` from the catalogue, best effort:
    /// the catalogue stays the authority and a failed write is only logged.
    /// Never called while a catalogue guard is held.
    fn refresh_source_meta(&self) {
        let result = self
            .catalogue()
            .and_then(|connection| source_meta::refresh(&connection, &self.inner.paths));
        if let Err(error) = result {
            tracing::warn!(%error, "failed to refresh LiDAR source meta files");
        }
    }

    /// Attach the managed Native Operation Executor so queued calculations run
    /// through the same bounded admission as command work.
    pub fn attach_executor(&self, executor: crate::native_operation::NativeOperationExecutor) {
        if let Ok(mut slot) = self.inner.executor.lock() {
            *slot = Some(executor);
        }
        // Nothing is enqueued here: a saved result is a fixed library item and
        // no analysis runs merely because the library reopened.
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

    /// Remove analysis scratch that no running job owns.
    ///
    /// A job removes its own scratch when it settles; a crash leaves it. Only
    /// a job still `preparing` keeps its directory, and startup recovery has
    /// already failed every job the previous run left preparing.
    fn prune_analysis_scratch(&self) -> Result<(), String> {
        let prepared = self.inner.paths.prepared_dir();
        let entries = match std::fs::read_dir(&prepared) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(format!("Failed to list {}: {error}", prepared.display()));
            }
        };
        let connection = self.catalogue()?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(job_id) = name.strip_prefix(paths::ANALYSIS_SCRATCH_PREFIX) else {
                continue;
            };
            let running = connection
                .query_row(
                    "SELECT 1 FROM lidar_analysis_jobs WHERE id = ?1 AND state = 'preparing'",
                    [job_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_some();
            if running {
                continue;
            }
            if let Err(error) = std::fs::remove_dir_all(entry.path()) {
                tracing::warn!(job_id, %error, "failed to remove settled analysis scratch");
            }
        }
        Ok(())
    }

    /// Best-effort bounded cleanup at startup: job roots of settled jobs,
    /// unregistered display derivatives, settled analysis scratch, leftover engine
    /// output, unpublished chunk rows and unreferenced assets. Each step that
    /// fails is logged and left for the next start; none stops the library.
    fn prune_transient_artifacts(&self) {
        type Step = fn(&LidarLibrary) -> Result<(), String>;
        let steps: [(&str, Step); 6] = [
            ("settled job roots", Self::prune_settled_job_roots),
            // Display derivatives nobody registered, and interrupted writes,
            // can go now: no WebView reader exists before the library opens.
            (
                "display derivatives",
                display_cog::prune_display_derivatives,
            ),
            ("analysis scratch", Self::prune_analysis_scratch),
            ("engine output", Self::prune_leftover_engine_logs),
            (
                "unpublished chunk rows",
                Self::discard_unpublished_chunk_rows,
            ),
            ("unreferenced assets", Self::prune_unreferenced_assets),
        ];
        for (step, prune) in steps {
            if let Err(error) = prune(self) {
                tracing::warn!(step, %error, "startup cleanup step failed; kept until the next start");
            }
        }
    }

    fn prune_settled_job_roots(&self) -> Result<(), String> {
        let connection = self.catalogue()?;
        let settled: Vec<(String, String)> = {
            let mut statement = connection
                .prepare(
                    "SELECT id, state FROM lidar_import_jobs
                     WHERE state != 'staging' AND state != 'applying'",
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
            if let Err(error) = import::remove_job_root(self, &job_id) {
                tracing::warn!(job_id, %error, "a settled job root was kept until the next start");
            }
        }
        Ok(())
    }

    /// Output files of engine children an earlier process never reaped.
    fn prune_leftover_engine_logs(&self) -> Result<(), String> {
        let removed = process::prune_engine_logs(&self.inner.paths.engine_log_dir())?;
        if removed > 0 {
            tracing::info!(removed, "removed leftover engine output files");
        }
        Ok(())
    }

    /// A job that crashed before its publish transaction left chunk rows that
    /// were never readable. Removing them cannot revoke an accepted
    /// generation; the files they named are swept with the other unreferenced
    /// assets afterwards.
    fn discard_unpublished_chunk_rows(&self) -> Result<(), String> {
        let connection = self.catalogue()?;
        let discarded = catalogue::discard_unpublished_chunks(&connection)?;
        if discarded > 0 {
            tracing::info!(discarded, "discarded unpublished raster chunk rows");
        }
        Ok(())
    }

    /// Delete asset directories and metadata rows no catalogue reference owns.
    ///
    /// Files reach the store before the transaction that references them, so a
    /// crash or failure between the two leaves unreferenced files; they are
    /// removed here. A digest a source interpretation or any chunk row names is
    /// never touched, and nothing is swept while an import or calculation is
    /// in flight, because its files may not be referenced yet. Startup
    /// recovery has already failed every job the previous run left running.
    fn prune_unreferenced_assets(&self) -> Result<(), String> {
        let connection = self.catalogue()?;
        if catalogue::jobs_in_flight(&connection)? {
            return Ok(());
        }
        let referenced = catalogue::referenced_asset_digests(&connection)?;
        let asset_root = self.inner.paths.root().join("assets");
        let entries = std::fs::read_dir(&asset_root)
            .map_err(|e| format!("Failed to list {}: {e}", asset_root.display()))?;
        let mut removed = 0usize;
        for entry in entries.flatten() {
            if referenced.contains(entry.file_name().to_string_lossy().as_ref()) {
                continue;
            }
            let path = entry.path();
            let result = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
            match result {
                Ok(()) => removed += 1,
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "failed to remove an unreferenced asset");
                }
            }
        }
        catalogue::discard_unreferenced_asset_rows(&connection)?;
        if removed > 0 {
            tracing::info!(removed, "removed unreferenced raster assets");
        }
        Ok(())
    }

    #[cfg(test)]
    pub fn engine_status(&self) -> common_types::lidar::LidarEngineStatus {
        match self.inner.engine.version() {
            Ok(version) => common_types::lidar::LidarEngineStatus {
                available: true,
                version: Some(version),
                detail: None,
            },
            Err(error) => common_types::lidar::LidarEngineStatus {
                available: false,
                version: None,
                detail: Some(error),
            },
        }
    }

    /// Import › "Covers your site": the WGS84 box around the chosen files.
    /// Reads metadata only; nothing is copied or recorded.
    pub fn import_coverage(
        &self,
        paths: &[std::path::PathBuf],
    ) -> Result<common_types::lidar::LidarImportCoverage, String> {
        coverage::import_coverage(self.inner.engine.as_ref(), paths)
    }

    /// Bytes the Data library folder occupies on this device: sources,
    /// prepared data, results, display files and the catalogue.
    pub fn disk_usage(&self) -> Result<u64, String> {
        directory_size(self.inner.paths.root())
            .map_err(|error| format!("Canopi could not measure the Data library: {error}"))
    }

    pub fn library_snapshot(&self) -> Result<LidarSnapshot, String> {
        let geolibre = self.inner.geolibre.discover();
        let connection = self.catalogue()?;
        presentation::library_snapshot(&connection, self.inner.engine.as_ref(), &geolibre)
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
        inspection::sample(self, self.inner.engine.as_ref(), cancel, request)
    }

    /// Test support: an empty item row, before any import job is recorded.
    #[cfg(test)]
    pub fn create_layer(
        &self,
        name: &str,
        quantity: RasterQuantity,
        unit_label: Option<&str>,
        unit_unknown: bool,
    ) -> Result<String, String> {
        self.ensure_writable()?;
        let name = name.trim();
        if name.is_empty() {
            return Err("Layer name must not be empty".to_string());
        }
        let id = new_id("lyr");
        let units = resolve_units(quantity, unit_label, unit_unknown)?;
        let connection = self.catalogue()?;
        connection
            .execute(
                "INSERT INTO lidar_source_layers(id, name, item_kind, quantity, units, created_at)
                 VALUES(?1, ?2, 'raster', ?3, ?4, ?5)",
                rusqlite::params![id, name, quantity.key(), units, now_iso()],
            )
            .map_err(|e| format!("Failed to create layer: {e}"))?;
        Ok(id)
    }

    /// Rename one library item. The name is library metadata: values, inputs
    /// and identity are unchanged, and nothing becomes out of date.
    pub fn rename_item(&self, item_id: &str, name: &str) -> Result<(), String> {
        self.ensure_writable()?;
        let name = name.trim();
        if name.is_empty() {
            return Err("Name must not be empty".to_string());
        }
        let connection = self.catalogue()?;
        let mut changed = 0;
        for sql in [
            "UPDATE lidar_source_layers SET name = ?2 WHERE id = ?1",
            "UPDATE lidar_derived_items SET name = ?2 WHERE id = ?1",
        ] {
            changed += connection
                .execute(sql, rusqlite::params![item_id, name])
                .map_err(|e| format!("Failed to rename: {e}"))?;
        }
        if changed == 0 {
            return Err(format!("Item {item_id} does not exist"));
        }
        drop(connection);
        self.refresh_source_meta();
        Ok(())
    }

    /// What deleting one item would affect: the derived items calculated
    /// from it, which must be deleted first.
    pub fn delete_impact(&self, item_id: &str) -> Result<LibraryDeleteImpact, String> {
        let connection = self.catalogue()?;
        if analyses::item_facts(&connection, item_id)?.is_none() {
            return Err(format!("Item {item_id} does not exist"));
        }
        Ok(LibraryDeleteImpact {
            dependent_item_ids: catalogue::dependent_items(&connection, item_id)?,
        })
    }

    /// Delete one library item.
    ///
    /// Refused while results were calculated from it: they keep their meaning
    /// only while their input exists, so they are deleted explicitly first and
    /// there is no cascade. A derived item takes its generations with it, and
    /// its definition, runs and history go with the definition's last item.
    pub fn delete_item(&self, item_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        let job_ids = {
            let connection = self.catalogue()?;
            refuse_dependents(&connection, item_id)?;
            if catalogue::get_layer(&connection, item_id)?.is_some() {
                string_column(
                    &connection,
                    "SELECT id FROM lidar_import_jobs WHERE layer_id = ?1",
                    item_id,
                )?
            } else if let Some(item) = catalogue::get_derived_item(&connection, item_id)? {
                if catalogue::definition_items(&connection, &item.definition_id)?.len() == 1 {
                    string_column(
                        &connection,
                        "SELECT id FROM lidar_analysis_jobs WHERE definition_id = ?1",
                        &item.definition_id,
                    )?
                } else {
                    Vec::new()
                }
            } else {
                return Err(format!("Item {item_id} does not exist"));
            }
        };
        for job_id in &job_ids {
            self.cancel_job(job_id);
        }
        let connection = self.catalogue()?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        // Recheck inside the transaction: a result created meanwhile keeps its
        // input.
        refuse_dependents(&transaction, item_id)?;
        if catalogue::get_layer(&transaction, item_id)?.is_some() {
            delete_source_rows(&transaction, item_id)?;
        } else {
            delete_derived_rows(&transaction, item_id)?;
        }
        transaction.commit().map_err(|e| e.to_string())?;
        drop(connection);
        self.refresh_source_meta();
        Ok(())
    }

    /// One bounded page of a definition's runs, newest first.
    pub fn processing_history(
        &self,
        definition_id: &str,
        cursor: Option<&str>,
    ) -> Result<ProcessingHistoryPage, String> {
        let before = cursor
            .map(|cursor| {
                cursor
                    .split_once(':')
                    .map(|(created_at, id)| (created_at.to_string(), id.to_string()))
                    .ok_or_else(|| "invalid processing history cursor".to_string())
            })
            .transpose()?;
        let connection = self.catalogue()?;
        if catalogue::get_definition(&connection, definition_id)?.is_none() {
            return Err(format!("Analysis {definition_id} does not exist"));
        }
        let page = common_types::library::PROCESSING_HISTORY_PAGE;
        let mut jobs = catalogue::analysis_job_page(
            &connection,
            definition_id,
            before
                .as_ref()
                .map(|(created_at, id)| (created_at.as_str(), id.as_str())),
            page + 1,
        )?;
        let has_more = jobs.len() as i64 > page;
        jobs.truncate(usize::try_from(page).unwrap_or(usize::MAX));
        let next_cursor = match (has_more, jobs.last()) {
            (true, Some(last)) => Some(format!("{}:{}", last.created_at, last.id)),
            _ => None,
        };
        let runs = jobs
            .into_iter()
            .map(|job| {
                let outputs = catalogue::job_generations(&connection, &job.id)?
                    .into_iter()
                    .map(|generation| ProcessingRunOutput {
                        item_id: generation.item_id,
                        generation_id: generation.id,
                        coverage_cells: generation
                            .coverage_cells
                            .and_then(|cells| u64::try_from(cells).ok()),
                    })
                    .collect();
                Ok(ProcessingRun {
                    state: analyses::parse_job_state(&job.state),
                    message: job.message,
                    recipe_version: u32::try_from(job.recipe_version).unwrap_or(0),
                    tool: analyses::parse_tool(job.tool_provenance.as_deref()),
                    inputs: analyses::parse_pinned_inputs(&job.input_generations_json)?,
                    created_at: job.created_at,
                    finished_at: job.finished_at,
                    outputs,
                    job_id: job.id,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(ProcessingHistoryPage {
            definition_id: definition_id.to_string(),
            runs,
            next_cursor,
        })
    }

    /// The ordered composition of one Data Layer, one bounded member page at a
    /// time.
    ///
    /// Membership and order are library data, so the Design is never dirtied by
    /// a reorder and every referencing Design sees the same list. A member page
    /// is bound to the immutable snapshot it was requested from: a late page of
    /// a different head is refused by name rather than mixed into its list.
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
        let head_id = catalogue::head_generation(&connection, layer_id)?.map(|row| row.id);
        let (member_rows, member_count) = match head_id.as_deref() {
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
            None => (Vec::new(), 0),
        };
        let last_position = member_rows.last().map(|row| row.position);
        let sources = member_rows
            .iter()
            .map(|member| {
                let id = member.interpretation_id.as_str();
                let interpretation = catalogue::get_interpretation(&connection, id)?
                    .ok_or_else(|| format!("missing interpretation {id}"))?;
                let (coverage_cells, min_value, max_value) =
                    catalogue::interpretation_coverage(&connection, id)?;
                let filename = catalogue::interpretation_filename(&connection, id)?
                    .ok_or_else(|| format!("missing source of interpretation {id}"))?;
                let width = u32::try_from(interpretation.width.max(0)).unwrap_or(u32::MAX);
                let height = u32::try_from(interpretation.height.max(0)).unwrap_or(u32::MAX);
                let pixel_size_m = import::parse_geotransform(&interpretation.geotransform)
                    .map(|transform| transform[1].abs())
                    .unwrap_or(0.0);
                Ok(common_types::lidar::LidarLayerSource {
                    member_id: member.member_id.clone(),
                    filename,
                    interpretation_id: member.interpretation_id.clone(),
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
            sources,
            next_member_cursor,
        })
    }

    /// Admit one display read, or decline it when the budget is full.
    ///
    /// The caller waits for a slot with [`DisplayTicket::activate`], so a
    /// waiting display read never occupies a Native Operation Executor permit
    /// behind another heavy job.
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
    /// Inspection deliberately shares the display budget, so a burst of
    /// abandoned lookups is bounded by the same active/queued limits tiles use.
    /// An unnamed lookup is refused: it could never be cancelled.
    pub(crate) fn admit_sample_request(&self, request_id: &str) -> Result<DisplayTicket, String> {
        if request_id.is_empty() {
            return Err("sample request identity must not be empty".to_string());
        }
        self.admit_display_request(&sample_admission_name(request_id))
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
        self.inner.display_changed.notify_waiters();
    }

    #[cfg(test)]
    pub fn get_import_job(&self, job_id: &str) -> Result<Option<LidarImportJob>, String> {
        let connection = self.catalogue()?;
        import_job_summary(&connection, job_id)
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

    /// Cancel from the UI. Sets the job's flag on the caller's thread, a
    /// bounded in-memory step, and moves the row update onto the executor's
    /// `UserData` lane: the synchronous cancel commands must never wait for
    /// the catalogue lock a running import or deletion holds. The flag is
    /// registered before a job's receipt is returned, so a job that has not
    /// started yet finds it set; the job settles its own row either way.
    pub fn signal_cancel(&self, job_id: &str) {
        self.set_cancel_flag(job_id);
        let Ok(executor) = self.executor() else {
            return;
        };
        let library = self.clone();
        let job_id = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = executor
                .run(
                    crate::native_operation::NativeOperationClass::UserData,
                    "lidar cancel job",
                    move || {
                        library.mark_job_cancelled(&job_id);
                        Ok(())
                    },
                )
                .await
            {
                tracing::warn!(error = %error, "cancelled job row left to the job's own settlement");
            }
        });
    }

    /// Cancel from inside library work that already runs on the executor
    /// (deleting an item): flag and rows together.
    pub fn cancel_job(&self, job_id: &str) {
        self.set_cancel_flag(job_id);
        self.mark_job_cancelled(job_id);
    }

    fn set_cancel_flag(&self, job_id: &str) {
        // The running job observes the flag between steps and kills its
        // engine processes.
        if let Ok(flags) = self.inner.cancel_flags.lock()
            && let Some(flag) = flags.get(job_id)
        {
            flag.store(true, Ordering::Relaxed);
        }
    }

    fn mark_job_cancelled(&self, job_id: &str) {
        if let Ok(connection) = self.catalogue() {
            let _ = connection.execute(
                "UPDATE lidar_import_jobs
                 SET state = 'cancelled', message = 'import cancelled', updated_at = ?2
                 WHERE id = ?1 AND state IN ('staging', 'applying')",
                rusqlite::params![job_id, now_iso()],
            );
            let _ = connection.execute(
                "UPDATE lidar_analysis_jobs
                 SET state = 'cancelled', message = 'analysis cancelled', finished_at = ?2,
                     updated_at = ?2
                 WHERE id = ?1 AND state = 'preparing'",
                rusqlite::params![job_id, now_iso()],
            );
        }
    }

    /// Record one import as a new fixed library item and its first job.
    ///
    /// Picking files creates nothing; submitting them creates exactly one item
    /// and one job, together. The saved request keeps the selection order,
    /// which is the item's source priority, so Retry resubmits it unchanged.
    pub fn record_import_item(
        &self,
        name: &str,
        quantity: RasterQuantity,
        unit_label: Option<&str>,
        unit_unknown: bool,
        paths: &[PathBuf],
    ) -> Result<(String, String), String> {
        self.ensure_writable()?;
        if paths.is_empty() {
            return Err("no files were selected for import".to_string());
        }
        let name = name.trim();
        if name.is_empty() {
            return Err("Layer name must not be empty".to_string());
        }
        let units = resolve_units(quantity, unit_label, unit_unknown)?;
        let request = import_request_json(paths)?;
        let layer_id = new_id("lyr");
        let job_id = new_id("imp");
        let connection = self.catalogue()?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| format!("Failed to start the import record: {e}"))?;
        let now = now_iso();
        transaction
            .execute(
                "INSERT INTO lidar_source_layers(id, name, item_kind, quantity, units, created_at)
                 VALUES(?1, ?2, 'raster', ?3, ?4, ?5)",
                rusqlite::params![layer_id, name, quantity.key(), units, now],
            )
            .map_err(|e| format!("Failed to create the library item: {e}"))?;
        transaction
            .execute(
                "INSERT INTO lidar_import_jobs(id, layer_id, state, request_json, created_at, updated_at)
                 VALUES(?1, ?2, 'staging', ?3, ?4, ?4)",
                rusqlite::params![job_id, layer_id, request, now],
            )
            .map_err(|e| format!("Failed to record the import: {e}"))?;
        transaction
            .commit()
            .map_err(|e| format!("Failed to record the import: {e}"))?;
        Ok((layer_id, job_id))
    }

    /// Record a new job for an unpublished item whose import failed or was
    /// cancelled, reusing the item identity and its saved request.
    pub fn record_import_retry(
        &self,
        layer_id: &str,
    ) -> Result<(String, String, Vec<PathBuf>), String> {
        self.ensure_writable()?;
        let connection = self.catalogue()?;
        catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        if catalogue::head_generation(&connection, layer_id)?.is_some() {
            return Err(
                "this item is already published; import new files as a new item".to_string(),
            );
        }
        let latest: Option<(String, Option<String>)> = connection
            .query_row(
                "SELECT state, request_json FROM lidar_import_jobs WHERE layer_id = ?1
                 ORDER BY created_at DESC, rowid DESC LIMIT 1",
                [layer_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to read the import: {e}"))?;
        let Some((state, request)) = latest else {
            return Err("this item has no saved import to retry".to_string());
        };
        if !matches!(state.as_str(), "failed" | "cancelled") {
            return Err("this import is still running".to_string());
        }
        let request = request.ok_or_else(|| {
            "this import was recorded before its selection was saved; choose the files again"
                .to_string()
        })?;
        let paths = parse_import_request(&request)?;
        let job_id = new_id("imp");
        connection
            .execute(
                "INSERT INTO lidar_import_jobs(id, layer_id, state, request_json, created_at, updated_at)
                 VALUES(?1, ?2, 'staging', ?3, ?4, ?4)",
                rusqlite::params![job_id, layer_id, request, now_iso()],
            )
            .map_err(|e| format!("Failed to record the import retry: {e}"))?;
        Ok((layer_id.to_string(), job_id, paths))
    }

    /// Remove an unpublished item whose import failed or was cancelled.
    ///
    /// Only that operation's own metadata and scratch go; a published item is
    /// deleted through the library deletion guard instead.
    pub fn dismiss_import(&self, layer_id: &str) -> Result<(), String> {
        self.ensure_writable()?;
        let job_ids: Vec<String> = {
            let connection = self.catalogue()?;
            if catalogue::head_generation(&connection, layer_id)?.is_some() {
                return Err(
                    "this item is published; delete it from the library instead".to_string()
                );
            }
            let running: bool = connection
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM lidar_import_jobs WHERE layer_id = ?1
                     AND state IN ('staging', 'applying'))",
                    [layer_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if running {
                return Err("this import is still running; cancel it first".to_string());
            }
            let mut statement = connection
                .prepare("SELECT id FROM lidar_import_jobs WHERE layer_id = ?1")
                .map_err(|e| e.to_string())?;
            statement
                .query_map([layer_id], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let connection = self.catalogue()?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        // Recheck inside the transaction: a publication that committed after
        // the read above keeps its item.
        if catalogue::head_generation(&transaction, layer_id)?.is_some() {
            return Err("this item is published; delete it from the library instead".to_string());
        }
        transaction
            .execute(
                "DELETE FROM lidar_import_jobs WHERE layer_id = ?1",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
        transaction
            .execute("DELETE FROM lidar_source_layers WHERE id = ?1", [layer_id])
            .map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        drop(connection);
        for job_id in job_ids {
            if let Err(error) = import::remove_job_root(self, &job_id) {
                tracing::warn!(job_id, error = %error, "dismissed import kept its root");
            }
        }
        Ok(())
    }

    /// Record and start one import as a new library item.
    pub fn import_item(
        &self,
        name: &str,
        quantity: RasterQuantity,
        unit_label: Option<&str>,
        unit_unknown: bool,
        paths: Vec<PathBuf>,
    ) -> Result<common_types::lidar::LidarImportReceipt, String> {
        // A file Canopi cannot place is refused here, in the import dialog,
        // before any item or job exists (canopi-try2, U31).
        import::validate_source_selection(&paths)?;
        admission::check_sources_placeable(
            self.inner.engine.as_ref(),
            &paths,
            &AtomicBool::new(false),
        )?;
        let (layer_id, job_id) =
            self.record_import_item(name, quantity, unit_label, unit_unknown, &paths)?;
        self.start_recorded_import(&layer_id, &job_id, paths)
    }

    /// Retry a failed or cancelled unpublished import with its saved request.
    pub fn retry_import(
        &self,
        layer_id: &str,
    ) -> Result<common_types::lidar::LidarImportReceipt, String> {
        let (layer_id, job_id, paths) = self.record_import_retry(layer_id)?;
        if let Some(missing) = paths.iter().find(|path| !path.is_file()) {
            let message = format!(
                "{} is no longer available; choose the files again",
                missing
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| missing.display().to_string())
            );
            self.fail_import_job(&job_id, &message);
            return Err(message);
        }
        self.start_recorded_import(&layer_id, &job_id, paths)
    }

    fn start_recorded_import(
        &self,
        layer_id: &str,
        job_id: &str,
        paths: Vec<PathBuf>,
    ) -> Result<common_types::lidar::LidarImportReceipt, String> {
        if let Err(error) = self.begin_import_sources(job_id, layer_id, paths) {
            // A job that could not start is an honest failed operation.
            self.fail_import_job(job_id, &error);
            return Err(error);
        }
        Ok(common_types::lidar::LidarImportReceipt {
            layer_id: layer_id.to_string(),
            job_id: job_id.to_string(),
        })
    }

    fn fail_import_job(&self, job_id: &str, message: &str) {
        if let Ok(connection) = self.catalogue() {
            let _ = connection.execute(
                "UPDATE lidar_import_jobs SET state = 'failed', message = ?2, updated_at = ?3
                 WHERE id = ?1 AND state = 'staging'",
                rusqlite::params![job_id, message, now_iso()],
            );
        }
    }

    /// Record the import job row (short catalogue write; called through the
    /// executor from the command).
    #[cfg(test)]
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

    /// Prepare and publish a new item's sources in one job.
    ///
    /// Each selected source is prepared and validated in order under one
    /// heavy-job lease, and the batch is published atomically as the item's
    /// only generation. A pre-commit failure or cancellation publishes nothing.
    pub fn begin_import_sources(
        &self,
        job_id: &str,
        layer_id: &str,
        source_paths: Vec<PathBuf>,
    ) -> Result<(), String> {
        {
            // A published item's content is fixed. Refusing here, before any
            // lease or job work, also stops a stale caller that still thinks
            // it can append to an item.
            let connection = self.catalogue()?;
            if catalogue::head_generation(&connection, layer_id)?.is_some() {
                return Err(
                    "this item is already published and its content is fixed; import the files as a new item"
                        .to_string(),
                );
            }
        }
        let lease = HeavyJobLease::acquire(self, job_id)?;
        let executor = self.executor()?;
        let flag = self.register_cancel(job_id);
        let library = self.clone();
        let layer_for_stage = layer_id.to_string();
        let job_id_for_stage = job_id.to_string();
        let job_id_clone = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            let library_for_work = library.clone();
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
                        // Display derivatives are staged under the same job, so
                        // the item can be drawn as soon as it is published.
                        library_for_work.prepare_staged_display(&staging, &flag)?;
                        // Publication refuses an item that already has a head:
                        // items are fixed once published.
                        import::apply_import(&library_for_work, &staging, &flag).map(|outcome| {
                            tracing::info!(summary = outcome.summary(), "LiDAR import published");
                        })
                    },
                )
                .await;
            library.finish_import_sources(&job_id_clone, outcome);
        });
        Ok(())
    }

    /// Record the outcome of a one-step import.
    ///
    /// Import publishes a new fixed item; it never touches another item or
    /// enqueues analysis.
    fn finish_import_sources(&self, job_id: &str, outcome: Result<(), String>) {
        if let Ok(connection) = self.catalogue() {
            match outcome {
                Ok(()) => {
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs
                         SET state = 'complete', message = NULL,
                             updated_at = ?2
                         WHERE id = ?1 AND state IN ('staging', 'applying')",
                        rusqlite::params![job_id, now_iso()],
                    );
                    // Publication reports its own finalising progress as it
                    // commits, so the settled job's phase is cleared here
                    // whether or not the guarded state update above matched.
                    let _ = connection.execute(
                        "UPDATE lidar_import_jobs
                         SET progress_phase = NULL, progress_percent = NULL
                         WHERE id = ?1",
                        [job_id],
                    );
                    drop(connection);
                    // The published item is now what the originals' meta
                    // must describe.
                    self.refresh_source_meta();
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
                    if let Err(cleanup) = import::remove_job_root(self, job_id) {
                        tracing::warn!(
                            job_id,
                            error = %cleanup,
                            "failed import kept its root until the next start"
                        );
                    }
                }
            }
        }
        self.settle_cancel(job_id);
    }

    /// Wait for the library-wide heavy lease without holding an executor
    /// permit: a queued calculation must never occupy a permit while another
    /// heavy job runs, and one cancelled or deleted meanwhile stops waiting.
    async fn await_heavy_lease(&self, job_id: &str) -> Option<HeavyJobLease> {
        loop {
            match HeavyJobLease::acquire(self, job_id) {
                Ok(lease) => return Some(lease),
                Err(_) => {
                    // Only a job still preparing keeps waiting.
                    let queued = self.catalogue().ok().is_some_and(|connection| {
                        connection
                            .query_row(
                                "SELECT state FROM lidar_analysis_jobs WHERE id = ?1",
                                [job_id],
                                |row| row.get::<_, String>(0),
                            )
                            .is_ok_and(|state| state == "preparing")
                    });
                    if !queued {
                        return None;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
            }
        }
    }

    /// Run one recorded analysis job to its settled state.
    async fn run_analysis(self, job_id: String) {
        let Some(lease) = self.await_heavy_lease(&job_id).await else {
            return;
        };
        let Ok(executor) = self.executor() else {
            return;
        };
        let flag = self.register_cancel(&job_id);
        let library = self.clone();
        let job = job_id.clone();
        let outcome = executor
            .run(
                crate::native_operation::NativeOperationClass::Local,
                "lidar analysis",
                move || {
                    let _lease = lease;
                    analyses::run_job(&library, &job, &flag)
                },
            )
            .await;
        match outcome {
            Ok(outcome) => {
                tracing::info!(
                    job_id,
                    summary = outcome.summary(),
                    "LiDAR analysis published"
                );
            }
            Err(error) => {
                if let Ok(connection) = self.catalogue() {
                    analyses::settle_unpublished(&connection, &job_id, &error);
                }
            }
        }
        self.settle_cancel(&job_id);
    }

    fn start_analysis(&self, job_id: &str) {
        let library = self.clone();
        let job_id = job_id.to_string();
        tauri::async_runtime::spawn(async move {
            library.run_analysis(job_id).await;
        });
    }

    /// Create a definition of a registered analysis and start its first run.
    ///
    /// The request is validated against the registry and the inputs' stored
    /// facts; a missing GeoLibre engine refuses creation by name.
    pub fn create_analysis(&self, request: &AnalysisRequest) -> Result<AnalysisReceipt, String> {
        self.ensure_writable()?;
        let engine = self.inner.geolibre.discover();
        let receipt = {
            let connection = self.catalogue()?;
            analyses::record_definition(&connection, request, Some(&engine))?
        };
        self.refresh_source_meta();
        self.start_analysis(&receipt.job_id);
        Ok(receipt)
    }

    /// Run a definition again with its saved settings and current inputs:
    /// Retry before a first result, Refresh after one. A refresh updates the
    /// definition's items in place; the earlier run stays in its history.
    pub fn rerun_analysis(&self, definition_id: &str) -> Result<AnalysisReceipt, String> {
        self.ensure_writable()?;
        let engine = self.inner.geolibre.discover();
        let receipt = {
            let connection = self.catalogue()?;
            analyses::record_rerun(&connection, definition_id, Some(&engine))?
        };
        self.start_analysis(&receipt.job_id);
        Ok(receipt)
    }
}

/// Refuse to delete an item other results were calculated from.
fn refuse_dependents(connection: &Connection, item_id: &str) -> Result<(), String> {
    let dependents = catalogue::dependent_items(connection, item_id)?.len();
    if dependents == 0 {
        return Ok(());
    }
    let name = catalogue::get_layer(connection, item_id)?
        .map(|layer| layer.name)
        .or(catalogue::get_derived_item(connection, item_id)?.and_then(|item| item.name))
        .unwrap_or_else(|| item_id.to_string());
    Err(format!(
        "{name} has {dependents} saved result{} calculated from it; delete {} first",
        if dependents == 1 { "" } else { "s" },
        if dependents == 1 {
            "that result"
        } else {
            "those results"
        }
    ))
}

fn string_column(connection: &Connection, sql: &str, key: &str) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
    statement
        .query_map([key], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn delete_source_rows(connection: &Connection, layer_id: &str) -> Result<(), String> {
    // Ordered snapshots keep their own member rows, which reference the
    // generations deleted below. Chunk rows carry no foreign key to their
    // generation (they are inserted before it commits), so they are revoked
    // with it explicitly.
    for sql in [
        "DELETE FROM lidar_collection_members WHERE generation_id IN
         (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
        "DELETE FROM lidar_generation_chunks WHERE generation_id IN
         (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
        "DELETE FROM lidar_layer_heads WHERE layer_id = ?1",
        "DELETE FROM lidar_import_jobs WHERE layer_id = ?1",
        "DELETE FROM lidar_layer_generations WHERE layer_id = ?1",
        "DELETE FROM lidar_source_layers WHERE id = ?1",
    ] {
        connection
            .execute(sql, [layer_id])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn delete_derived_rows(connection: &Connection, item_id: &str) -> Result<(), String> {
    let item = catalogue::get_derived_item(connection, item_id)?
        .ok_or_else(|| format!("Item {item_id} does not exist"))?;
    for sql in [
        "DELETE FROM lidar_generation_chunks WHERE generation_id IN
         (SELECT id FROM lidar_derived_generations WHERE item_id = ?1)",
        "DELETE FROM lidar_derived_heads WHERE item_id = ?1",
        "DELETE FROM lidar_derived_generations WHERE item_id = ?1",
        "DELETE FROM lidar_derived_items WHERE id = ?1",
    ] {
        connection
            .execute(sql, [item_id])
            .map_err(|e| e.to_string())?;
    }
    if catalogue::definition_items(connection, &item.definition_id)?.is_empty() {
        for sql in [
            "DELETE FROM lidar_analysis_jobs WHERE definition_id = ?1",
            "DELETE FROM lidar_analysis_inputs WHERE definition_id = ?1",
            "DELETE FROM lidar_analysis_definitions WHERE id = ?1",
        ] {
            connection
                .execute(sql, [&item.definition_id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// Runtime helpers remain below this large in-file regression module so the
// production service implementation above stays contiguous.
#[cfg(test)]
mod fixed_library_tests;

#[allow(clippy::items_after_test_module)]
#[cfg(test)]
mod tests {
    #[test]
    fn the_library_size_counts_files_in_every_folder() {
        let root = crate::test_scratch::TestScratch::new("canopi-library-size");
        std::fs::create_dir_all(root.join("sources").join("abc")).unwrap();
        std::fs::write(root.join("lidar-library.sqlite"), vec![0u8; 100]).unwrap();
        std::fs::write(
            root.join("sources").join("abc").join("original.tif"),
            vec![0u8; 23],
        )
        .unwrap();
        assert_eq!(super::directory_size(&root).unwrap(), 123);
        assert_eq!(
            super::directory_size(&root.join("absent")).unwrap(),
            0,
            "a library never used has nothing on disk"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    use super::*;

    /// The UI cancel path is what the synchronous cancel commands call: it
    /// must return while a job holds the catalogue, or Cancel would block the
    /// main thread behind the very work it is trying to stop.
    #[test]
    fn signalling_a_cancel_never_waits_for_the_catalogue_lock() {
        let root = crate::test_scratch::TestScratch::new("canopi-cancel-signal");
        let library = LidarLibrary::open(&root).unwrap();
        library.attach_executor(crate::native_operation::NativeOperationExecutor::production());
        let flag = library.register_cancel("job-held");

        let held = library.catalogue().unwrap();
        let (done, signalled) = std::sync::mpsc::channel();
        let signaller = library.clone();
        std::thread::spawn(move || {
            signaller.signal_cancel("job-held");
            let _ = done.send(());
        });
        assert!(
            signalled
                .recv_timeout(std::time::Duration::from_secs(5))
                .is_ok(),
            "signal_cancel blocked on the catalogue lock"
        );
        assert!(
            flag.load(Ordering::Relaxed),
            "the job's flag is set at once"
        );
        drop(held);

        let _ = std::fs::remove_dir_all(root);
    }

    fn row_count(connection: &Connection, table: &str) -> i64 {
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    fn seed_analysis(connection: &Connection, layer_id: &str, item_id: &str) {
        analyses::test_support::seed_published_slope(
            connection,
            layer_id,
            "source-gen",
            &format!("adef-{item_id}"),
            item_id,
            &format!("dgen-{item_id}"),
            None,
        );
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
        // A real label is stored as given, trimmed.
        assert_eq!(
            resolve_units(RasterQuantity::OtherContinuous, Some("  mg/kg "), false).unwrap(),
            "mg/kg"
        );
        // An explicit unknown is stored as the sentinel, not as a label the
        // author never chose.
        assert_eq!(
            resolve_units(RasterQuantity::OtherContinuous, None, true).unwrap(),
            common_types::lidar::LIDAR_UNITS_UNKNOWN
        );
        // Undeclared is refused.
        assert!(
            resolve_units(RasterQuantity::OtherContinuous, None, false).is_err(),
            "an undeclared unit must not be stored"
        );
        // Whitespace is not a label.
        assert!(
            resolve_units(RasterQuantity::OtherContinuous, Some("   "), false).is_err(),
            "a blank label is undeclared, not a unit"
        );
        // Claiming both is contradictory.
        assert!(
            resolve_units(RasterQuantity::OtherContinuous, Some("mg/kg"), true).is_err(),
            "a label and an explicit unknown cannot both hold"
        );

        // Elevation and height are always metres and refuse both declarations,
        // so a caller cannot relabel a measurement that has an inherent unit.
        for kind in [
            RasterQuantity::GroundElevation,
            RasterQuantity::SurfaceElevation,
            RasterQuantity::AboveGroundHeight,
        ] {
            assert_eq!(resolve_units(kind, None, false).unwrap(), "m");
            assert!(
                resolve_units(kind, Some("ft"), false).is_err(),
                "{} must not accept a substitute unit",
                kind.key()
            );
            assert!(
                resolve_units(kind, None, true).is_err(),
                "{} is not of unknown unit",
                kind.key()
            );
        }
        // A derived quantity only ever comes from an analysis.
        let error = resolve_units(RasterQuantity::Slope, None, false).unwrap_err();
        assert!(error.contains("cannot be imported"), "{error}");
    }

    #[test]
    fn deleting_a_derived_item_removes_its_complete_row_graph() {
        let root = crate::test_scratch::TestScratch::new("lidar-delete-analysis-test");
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Delete analysis fixture",
                RasterQuantity::GroundElevation,
                None,
                false,
            )
            .unwrap();
        {
            let connection = library.catalogue().unwrap();
            seed_analysis(&connection, &layer_id, "item-1");
        }

        library.delete_item("item-1").unwrap();
        let connection = library.catalogue().unwrap();
        for table in [
            "lidar_derived_heads",
            "lidar_derived_generations",
            "lidar_derived_items",
            "lidar_analysis_jobs",
            "lidar_analysis_inputs",
            "lidar_analysis_definitions",
        ] {
            assert_eq!(row_count(&connection, table), 0, "{table}");
        }
        assert_eq!(row_count(&connection, "lidar_source_layers"), 1);
        drop(connection);
        assert!(
            library.delete_item("item-1").is_err(),
            "a deleted item is gone"
        );
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// P1-1: a public collection read must not re-acquire its own catalogue
    /// lock.
    ///
    /// `layer_collection` holds the catalogue connection while it reads the
    /// layer's members. Calling a public method that takes the same mutex again
    /// deadlocks the whole library, and an empty layer — the case a user hits
    /// first — took exactly that path. The read runs on its own thread with a
    /// deadline so a regression fails instead of hanging the suite.
    #[test]
    fn a_public_collection_read_does_not_re_acquire_the_catalogue_lock() {
        let root = crate::test_scratch::TestScratch::new("canopi-collection-lock");
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).expect("library opens");
        let layer_id = library
            .create_layer("Empty", RasterQuantity::GroundElevation, None, false)
            .unwrap();

        let read = |name: &'static str, library: LidarLibrary, layer_id: String| {
            let (sender, receiver) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let page = library.layer_collection(&layer_id, None);
                let _ = sender.send(page);
            });
            receiver
                .recv_timeout(std::time::Duration::from_secs(20))
                .unwrap_or_else(|_| {
                    panic!("{name} deadlocked on the catalogue lock it already holds")
                })
        };

        let page = read(
            "a collection read of an empty layer",
            library.clone(),
            layer_id.clone(),
        );
        let page = page.expect("the summary reads");
        assert_eq!(page.layer_id, layer_id);
        assert_eq!(page.member_count, 0, "an empty layer has no occurrences");
        assert!(page.sources.is_empty());
        assert!(page.head_generation_id.is_none());

        let page = read(
            "a paged read of an empty layer",
            library.clone(),
            layer_id.clone(),
        );
        assert!(page.expect("the paged summary reads").sources.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deleting_a_source_removes_all_referencing_rows_with_foreign_keys_enabled() {
        let root = crate::test_scratch::TestScratch::new("lidar-delete-layer-test");
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Delete layer fixture",
                RasterQuantity::GroundElevation,
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
                 (id, source_sha256, band_index, quantity, units, scale, offset,
                  crs_ref, vertical_ref, nodata, geotransform, width, height, interp_hash,
                  valid_cells)
                 VALUES ('interp-delete', 'sha-delete', 1, 'ground-elevation', 'm', 1, 0,
                         'test', 'unknown', -9999, '[0,1,0,1,0,-1]', 1, 1, 'hash-delete', 1)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_layer_generations
                 (id, layer_id, created_at, manifest_json,
                  coverage_cells, min_value, max_value, bounds_3857, crs_class)
                 VALUES ('source-gen', ?1, '0', '{}', 1, 0, 1, '[0,0,1,1]', 'projected-metre')",
                    [&layer_id],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO lidar_collection_members
                 (generation_id, member_id, position, interpretation_id, created_at)
                 VALUES ('source-gen', 'member-delete', 0, 'interp-delete', '0')",
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
            connection
                .execute(
                    "INSERT INTO lidar_raster_assets
                        (sha256, rel_path, bytes, profile, width, height, geotransform,
                         crs_ref, nodata, created_at)
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
            seed_analysis(&connection, &layer_id, "item-delete");
        }

        // A saved result is deleted explicitly first; the source then removes
        // every row that references it.
        let refused = library.delete_item(&layer_id).unwrap_err();
        assert!(refused.contains("1 saved result"), "{refused}");
        assert_eq!(
            library.delete_impact(&layer_id).unwrap().dependent_item_ids,
            ["item-delete"]
        );
        library.delete_item("item-delete").unwrap();
        library.delete_item(&layer_id).unwrap();
        let connection = library.catalogue().unwrap();
        for table in [
            "lidar_source_layers",
            "lidar_layer_heads",
            "lidar_layer_generations",
            "lidar_collection_members",
            "lidar_import_jobs",
            "lidar_derived_heads",
            "lidar_analysis_jobs",
            "lidar_derived_generations",
            "lidar_analysis_inputs",
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
        let root = crate::test_scratch::TestScratch::new("lidar-heavy-lease-test");
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Lease fixture",
                RasterQuantity::GroundElevation,
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
            .begin_import_sources(&competing, &layer_id, Vec::new())
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
                .begin_import_sources(&holding, &layer_id, Vec::new())
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
    fn one_step_import_publishes_without_review_and_refuses_an_invalid_batch() {
        let engine = crate::services::lidar::rust_engine::RustRasterEngine;
        let cancel = AtomicBool::new(false);
        let root = crate::test_scratch::TestScratch::new("canopi-one-step-import");
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
            .create_layer("one step", RasterQuantity::GroundElevation, None, false)
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
        // Preparation ends by moving the validated batch to publishing, so the
        // job never rests in a state that waits for a person.
        let job = library
            .get_import_job(&job_id)
            .unwrap()
            .expect("job exists");
        assert_eq!(
            format!("{:?}", job.state),
            "Applying",
            "the one-step route does not stop for review"
        );
        let staging = import::read_staged_import(&library, &job_id).expect("staged payload");
        import::ensure_whole_batch_compatible(&staging).expect("every source is compatible");
        import::apply_import(&library, &staging, &cancel).expect("apply publishes");
        library.finish_import_sources(&job_id, Ok(()));

        let job = library
            .get_import_job(&job_id)
            .unwrap()
            .expect("job exists");
        assert_eq!(format!("{:?}", job.state), "Complete");
        assert_eq!(
            format!("{:?}", job.progress),
            "None",
            "progress is cleared once the job settles"
        );

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

        // A published item is fixed: a further import into it is refused.
        let again = library.record_import_job(&layer_id).expect("job recorded");
        let refused = import::stage_import(
            &library,
            &again,
            &layer_id,
            std::slice::from_ref(&east),
            &cancel,
        )
        .expect_err("a published item accepts no further sources");
        assert!(refused.contains("published"), "{refused}");

        // A batch whose second file cannot be used publishes nothing and names
        // the file.
        let broken = root.join("broken.tif");
        std::fs::write(&broken, b"not a raster").expect("broken file");
        let other = library
            .create_layer("broken batch", RasterQuantity::GroundElevation, None, false)
            .expect("layer created");
        let second_job = library.record_import_job(&other).expect("job recorded");
        let failure = import::stage_import(
            &library,
            &second_job,
            &other,
            &[east.clone(), broken.clone()],
            &cancel,
        )
        .expect_err("an unusable source refuses the batch");
        assert!(
            failure.contains("broken.tif"),
            "the refusal names the file: {failure}"
        );
        assert!(
            catalogue::head_generation(&library.catalogue().unwrap(), &other)
                .unwrap()
                .is_none(),
            "a refused batch publishes nothing"
        );

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
        let root = crate::test_scratch::TestScratch::new("lidar-sample-admission-test");
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();

        // A named lookup takes a real slot, and cancelling it signals the flag
        // the read is actually given.
        let mut sample = library.admit_sample_request("lookup-1").unwrap();
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
        let sample_two = library.admit_sample_request("lookup-2").unwrap();
        let sample_two_flag = sample_two.cancel_flag();
        library.cancel_display_request("lookup-2");
        assert!(!sample_two_flag.load(Ordering::Relaxed));
        library.cancel_sample_request("lookup-2");
        assert!(sample_two_flag.load(Ordering::Relaxed));

        // An unnamed lookup is refused: it could hold a slot no one can release.
        assert!(library.admit_sample_request("").is_err());

        // Dropping a finished lookup frees its slot for the next one.
        drop(sample);
        drop(sample_two);
        drop(tile);
        let mut next = library.admit_sample_request("lookup-3").unwrap();
        assert!(next.try_activate().unwrap());
        drop(next);

        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn display_reads_are_bounded_in_order_and_cancellable() {
        let root = crate::test_scratch::TestScratch::new("lidar-display-admission-test");
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

    /// A waiting lookup is woken by a released slot or by its own cancel, not
    /// by a timer.
    #[test]
    fn a_waiting_read_wakes_on_release_and_on_cancel() {
        let root = crate::test_scratch::TestScratch::new("lidar-display-wakeup-test");
        std::fs::create_dir_all(&root).unwrap();
        let library = LidarLibrary::open(&root).unwrap();
        let first = library.admit_sample_request("held-1").unwrap();
        let _second = library.admit_sample_request("held-2").unwrap();
        let waiting = library.admit_sample_request("waiting").unwrap();
        let cancelled = library.admit_sample_request("abandoned").unwrap();

        let (sender, receiver) = std::sync::mpsc::channel();
        let waiter = std::thread::spawn(move || {
            let mut waiting = waiting;
            let mut cancelled = cancelled;
            let activated =
                tauri::async_runtime::block_on(async { waiting.activate().await.is_ok() });
            sender.send(activated).unwrap();
            let refused =
                tauri::async_runtime::block_on(async { cancelled.activate().await.is_err() });
            sender.send(refused).unwrap();
        });
        let deadline = std::time::Duration::from_secs(10);
        assert!(
            receiver
                .recv_timeout(std::time::Duration::from_millis(200))
                .is_err(),
            "no slot is free yet"
        );
        drop(first);
        assert!(
            receiver.recv_timeout(deadline).unwrap(),
            "a released slot wakes the waiter"
        );
        library.cancel_sample_request("abandoned");
        assert!(
            receiver.recv_timeout(deadline).unwrap(),
            "a cancel wakes and stops the waiter"
        );
        waiter.join().unwrap();
        drop(library);
        // Best-effort: Windows refuses to delete a file another handle still has open.
        let _ = std::fs::remove_dir_all(root);
    }

    /// Startup removes analysis scratch that no running job owns.
    #[test]
    fn startup_sweeps_settled_analysis_scratch_and_keeps_a_running_jobs() {
        let root = crate::test_scratch::TestScratch::new("lidar-analysis-scratch-sweep");
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Scratch fixture",
                RasterQuantity::GroundElevation,
                None,
                false,
            )
            .unwrap();
        {
            let connection = library.catalogue().unwrap();
            seed_analysis(&connection, &layer_id, "item-1");
            connection
                .execute(
                    "INSERT INTO lidar_analysis_jobs
                 (id, definition_id, state, recipe_version, input_generations_json,
                  created_at, updated_at)
                 VALUES ('ajob-running', 'adef-item-1', 'preparing', 1, '[]', '3', '3')",
                    [],
                )
                .unwrap();
        }
        let prepared = library.inner.paths.prepared_dir();
        let scratch = |job: &str| prepared.join(format!("scratch-analysis-{job}"));
        for job in ["adef-item-1-job", "ajob-running", "ajob-unknown"] {
            std::fs::create_dir_all(scratch(job)).unwrap();
            std::fs::write(scratch(job).join("window.tif"), b"partial").unwrap();
        }
        library.prune_transient_artifacts();
        assert!(
            !scratch("adef-item-1-job").exists(),
            "a settled job's scratch is swept"
        );
        assert!(
            !scratch("ajob-unknown").exists(),
            "an unowned scratch is swept"
        );
        assert!(
            scratch("ajob-running").exists(),
            "a running job keeps its scratch"
        );
        drop(library);
        // Reopening fails the interrupted job, so its scratch goes too.
        let reopened = LidarLibrary::open(&root).unwrap();
        assert!(!scratch("ajob-running").exists());
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Startup deletes asset directories no catalogue row references, never a
    /// referenced one, and leaves the store alone while any job is in flight.
    #[test]
    fn startup_sweeps_unreferenced_assets_and_keeps_referenced_ones() {
        let root = crate::test_scratch::TestScratch::new("lidar-asset-sweep");
        let library = LidarLibrary::open(&root).unwrap();
        let layer_id = library
            .create_layer(
                "Asset fixture",
                RasterQuantity::GroundElevation,
                None,
                false,
            )
            .unwrap();
        {
            let connection = library.catalogue().unwrap();
            seed_analysis(&connection, &layer_id, "item-1");
            for sha in ["referenced", "orphan"] {
                connection
                    .execute(
                        "INSERT INTO lidar_raster_assets(sha256, rel_path, bytes, profile,
                            width, height, geotransform, crs_ref, nodata, created_at)
                         VALUES(?1, ?2, 1, 'test', 1, 1, '0,1,0,0,0,-1', '', NULL, '0')",
                        rusqlite::params![sha, format!("assets/{sha}/cog.tif")],
                    )
                    .unwrap();
            }
            connection
                .execute(
                    "INSERT INTO lidar_generation_chunks(generation_id, role, chunk_x, chunk_y,
                        asset_sha256, valid_cells, state)
                     VALUES('dgen-item-1', 'result', 0, 0, 'referenced', 1, 'published')",
                    [],
                )
                .unwrap();
        }
        let asset = |sha: &str| library.inner.paths.asset_cog(sha);
        for sha in ["referenced", "orphan", "unrecorded"] {
            std::fs::create_dir_all(asset(sha).parent().unwrap()).unwrap();
            std::fs::write(asset(sha), b"cog").unwrap();
        }
        let in_flight = library.record_import_job(&layer_id).unwrap();
        library.prune_unreferenced_assets().unwrap();
        for sha in ["referenced", "orphan", "unrecorded"] {
            assert!(
                asset(sha).exists(),
                "nothing is swept while {in_flight} runs"
            );
        }
        drop(library);
        // Reopening fails the interrupted job, so the sweep runs.
        let reopened = LidarLibrary::open(&root).unwrap();
        let asset = |sha: &str| reopened.inner.paths.asset_cog(sha);
        assert!(
            asset("referenced").exists(),
            "referenced data is never deleted"
        );
        assert!(!asset("orphan").exists(), "an unreferenced asset is swept");
        assert!(!asset("unrecorded").exists(), "a file with no row is swept");
        let connection = reopened.catalogue().unwrap();
        let rows: Vec<String> = connection
            .prepare("SELECT sha256 FROM lidar_raster_assets ORDER BY sha256")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec!["referenced".to_string()],
            "orphan metadata goes too"
        );
        drop(connection);
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Engine output files live under the library root, and startup removes
    /// the ones an earlier process left; this process's are never touched.
    #[test]
    fn startup_sweeps_engine_logs_left_by_an_earlier_process() {
        let root = crate::test_scratch::TestScratch::new("lidar-engine-log-sweep");
        let library = LidarLibrary::open(&root).unwrap();
        let logs = library.inner.paths.engine_log_dir();
        assert!(logs.starts_with(library.inner.paths.root()));
        let stale = logs.join("0-0-1-out.log");
        let own = logs.join(format!("{}-999999-err.log", process::process_log_tag()));
        std::fs::write(&stale, b"left by a crash").unwrap();
        std::fs::write(&own, b"a live child").unwrap();
        drop(library);
        let reopened = LidarLibrary::open(&root).unwrap();
        assert!(!stale.exists(), "an earlier process's output is swept");
        assert!(own.exists(), "this process's output is never swept");
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// The display cache and the startup sweep are best effort: a display
    /// cache that is not a database is replaced, and a scratch directory the
    /// sweep cannot list is left for the next start. Neither stops the app.
    #[cfg(unix)]
    #[test]
    fn a_damaged_display_cache_or_unreadable_scratch_never_stops_the_library() {
        use std::os::unix::fs::PermissionsExt;
        let root = crate::test_scratch::TestScratch::new("lidar-best-effort-open");
        let library = LidarLibrary::open(&root).unwrap();
        let cache = library.inner.paths.display_cache_path();
        let prepared = library.inner.paths.prepared_dir();
        drop(library);
        std::fs::write(&cache, b"definitely not a sqlite display cache").unwrap();
        std::fs::set_permissions(&prepared, std::fs::Permissions::from_mode(0o000)).unwrap();
        let unreadable = std::fs::read_dir(&prepared).is_err();

        let opened = LidarLibrary::open(&root);
        std::fs::set_permissions(&prepared, std::fs::Permissions::from_mode(0o755)).unwrap();
        let library = opened.expect("a damaged cache or sweep never fails the open");
        assert!(
            unreadable,
            "the scratch directory was unreadable during the open"
        );
        assert_eq!(*library.open_status(), recovery::LibraryOpenStatus::Ready);
        library
            .display()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM display_cogs", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("the display cache was recreated");
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    // -- Catalogue recovery (ADR 0021) -------------------------------------

    fn write_original(
        lidar: &std::path::Path,
        sha256: &str,
        meta: Option<&source_meta::SourceMeta>,
    ) {
        let dir = lidar.join("sources").join(sha256);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("original"), format!("bytes of {sha256}")).unwrap();
        if let Some(meta) = meta {
            source_meta::write(&dir.join(source_meta::META_FILE), meta).unwrap();
        }
    }

    fn single_item_meta(
        sha256: &str,
        item_id: &str,
        name: &str,
        quantity: &str,
        units: &str,
    ) -> source_meta::SourceMeta {
        source_meta::SourceMeta {
            version: source_meta::META_VERSION,
            sha256: sha256.to_string(),
            original_filename: format!("{name}.tif"),
            size_bytes: 3,
            imported_at: "10".to_string(),
            items: vec![source_meta::ItemMeta {
                id: item_id.to_string(),
                name: name.to_string(),
                quantity: quantity.to_string(),
                units: units.to_string(),
                created_at: item_id.to_string(),
                members: vec![sha256.to_string()],
                analyses: Vec::new(),
            }],
        }
    }

    fn write_catalogue_with_version(path: &std::path::Path, version: &str) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(&format!(
                "CREATE TABLE lidar_catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO lidar_catalogue_meta VALUES ('schema_version', '{version}');
                 CREATE TABLE lidar_source_layers (id TEXT PRIMARY KEY);"
            ))
            .unwrap();
    }

    fn set_aside_files(lidar: &std::path::Path) -> Vec<PathBuf> {
        let mut files: Vec<PathBuf> = std::fs::read_dir(lidar.join(recovery::SET_ASIDE_DIR))
            .map(|entries| entries.flatten().map(|entry| entry.path()).collect())
            .unwrap_or_default();
        files.sort();
        files
    }

    fn saved_selection(library: &LidarLibrary, layer_id: &str) -> Vec<PathBuf> {
        let request: String = library
            .catalogue()
            .unwrap()
            .query_row(
                "SELECT request_json FROM lidar_import_jobs WHERE layer_id = ?1",
                [layer_id],
                |row| row.get(0),
            )
            .unwrap();
        parse_import_request(&request).unwrap()
    }

    /// An older catalogue is set aside byte for byte and rebuilt from the
    /// originals' meta: both items come back named, typed and retryable over
    /// their managed originals; the analysis defined over one comes back with
    /// its result unpublished. A second open finds a current catalogue.
    #[test]
    fn an_older_catalogue_is_set_aside_and_rebuilt_from_the_originals() {
        let root = crate::test_scratch::TestScratch::new("lidar-older-library");
        let lidar = paths::library_root(&root);
        std::fs::create_dir_all(&lidar).unwrap();
        write_original(
            &lidar,
            "sha-1",
            Some(&single_item_meta(
                "sha-1",
                "lyr-1",
                "Orchard",
                RasterQuantity::GroundElevation.key(),
                "m",
            )),
        );
        let mut second = single_item_meta(
            "sha-2",
            "lyr-2",
            "Canopy",
            RasterQuantity::OtherContinuous.key(),
            "index",
        );
        second.items[0].analyses.push(source_meta::AnalysisMeta {
            definition_id: "adef-1".into(),
            analysis_id: "terrain.slope".into(),
            parameters: serde_json::json!([{"key":"unit","value":{"Choice":"degrees"}}]),
            outputs: serde_json::json!(["slope"]),
            created_at: "11".into(),
            inputs: vec![source_meta::AnalysisInputMeta {
                input_key: "dem".into(),
                item_id: "lyr-2".into(),
            }],
            items: vec![source_meta::DerivedItemMeta {
                id: "item-slope".into(),
                output_key: "slope".into(),
                quantity: "slope".into(),
                units: "°".into(),
                name: Some("Steepness".into()),
                created_at: "11".into(),
            }],
        });
        write_original(&lidar, "sha-2", Some(&second));
        let catalogue_path = lidar.join(paths::CATALOGUE_FILE);
        write_catalogue_with_version(&catalogue_path, "20");
        let older_bytes = std::fs::read(&catalogue_path).unwrap();

        let library = LidarLibrary::open(&root).unwrap();
        match library.open_status() {
            recovery::LibraryOpenStatus::Recovered {
                reason,
                items,
                generated,
                ..
            } => {
                assert_eq!(*reason, recovery::RecoveryReason::OlderVersion(20));
                assert_eq!((*items, *generated), (2, 0));
            }
            other => panic!("expected a recovered library, got {other:?}"),
        }
        let set_aside = set_aside_files(&lidar);
        assert_eq!(set_aside.len(), 1, "{set_aside:?}");
        assert!(set_aside[0].extension().is_some_and(|ext| ext == "sqlite"));
        assert_eq!(
            std::fs::read(&set_aside[0]).unwrap(),
            older_bytes,
            "set aside byte for byte"
        );
        assert_eq!(
            catalogue::stored_version(&catalogue_path).unwrap(),
            Some(catalogue::CATALOGUE_VERSION)
        );
        for sha256 in ["sha-1", "sha-2"] {
            assert_eq!(
                std::fs::read(lidar.join("sources").join(sha256).join("original")).unwrap(),
                format!("bytes of {sha256}").into_bytes(),
                "originals are never touched"
            );
        }

        let snapshot = library.library_snapshot().unwrap();
        let names: Vec<(String, common_types::library::LibraryItemRole)> = snapshot
            .items
            .iter()
            .map(|item| (item.name.clone().unwrap_or_default(), item.role))
            .collect();
        assert_eq!(
            names,
            vec![
                (
                    "Orchard".to_string(),
                    common_types::library::LibraryItemRole::Source
                ),
                (
                    "Canopy".to_string(),
                    common_types::library::LibraryItemRole::Source
                ),
                (
                    "Steepness".to_string(),
                    common_types::library::LibraryItemRole::Derived
                ),
            ]
        );
        let canopy = &snapshot.items[1];
        assert_eq!(canopy.id, "lyr-2");
        assert_eq!(canopy.units, "index");
        assert_eq!(canopy.state, common_types::lidar::LidarResultState::Failed);
        let job = canopy.import_job.as_ref().expect("a retryable import");
        assert_eq!(job.state, LidarImportJobState::Failed);
        assert_eq!(
            job.message.as_deref(),
            Some(recovery::RECOVERED_IMPORT_MESSAGE)
        );
        assert_eq!(
            saved_selection(&library, "lyr-2"),
            vec![library.inner.paths.source_original("sha-2")]
        );
        let slope = &snapshot.items[2];
        assert_eq!(slope.state, common_types::lidar::LidarResultState::Failed);
        assert_eq!(slope.units, "°");
        assert_eq!(
            library.delete_impact("lyr-2").unwrap().dependent_item_ids,
            vec!["item-slope"]
        );

        drop(library);
        let reopened = LidarLibrary::open(&root).unwrap();
        assert_eq!(*reopened.open_status(), recovery::LibraryOpenStatus::Ready);
        assert_eq!(reopened.library_snapshot().unwrap().items.len(), 3);
        assert_eq!(
            set_aside_files(&lidar).len(),
            1,
            "a current catalogue is not set aside"
        );
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A catalogue that is not a database at all takes the same road.
    #[test]
    fn a_corrupt_catalogue_is_set_aside_and_rebuilt() {
        let root = crate::test_scratch::TestScratch::new("lidar-corrupt-library");
        let lidar = paths::library_root(&root);
        write_original(
            &lidar,
            "sha-9",
            Some(&single_item_meta(
                "sha-9",
                "lyr-9",
                "Ridge",
                RasterQuantity::GroundElevation.key(),
                "m",
            )),
        );
        let garbage = b"definitely not sqlite".to_vec();
        std::fs::write(lidar.join(paths::CATALOGUE_FILE), &garbage).unwrap();

        let library = LidarLibrary::open(&root).unwrap();
        assert!(
            matches!(
                library.open_status(),
                recovery::LibraryOpenStatus::Recovered {
                    reason: recovery::RecoveryReason::Corrupt(_),
                    items: 1,
                    ..
                }
            ),
            "{:?}",
            library.open_status()
        );
        let set_aside = set_aside_files(&lidar);
        assert_eq!(std::fs::read(&set_aside[0]).unwrap(), garbage);
        assert_eq!(
            library.library_snapshot().unwrap().items[0].name.as_deref(),
            Some("Ridge")
        );
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// An original nothing describes is still listed, under a generated name
    /// with the default quantity, so it can be prepared or deleted by the user.
    #[test]
    fn an_original_without_meta_is_listed_under_a_generated_name() {
        let root = crate::test_scratch::TestScratch::new("lidar-orphan-original");
        let lidar = paths::library_root(&root);
        write_original(&lidar, "0123456789abcdef", None);
        write_catalogue_with_version(&lidar.join(paths::CATALOGUE_FILE), "20");

        let library = LidarLibrary::open(&root).unwrap();
        assert!(matches!(
            library.open_status(),
            recovery::LibraryOpenStatus::Recovered {
                items: 0,
                generated: 1,
                ..
            }
        ));
        let snapshot = library.library_snapshot().unwrap();
        assert_eq!(snapshot.items.len(), 1);
        let item = &snapshot.items[0];
        assert_eq!(item.name.as_deref(), Some("Recovered raster 01234567"));
        assert_eq!(
            item.item_type,
            common_types::library::LibraryItemType::Raster {
                quantity: RasterQuantity::GroundElevation
            }
        );
        assert_eq!(item.units, "m");
        assert_eq!(
            saved_selection(&library, &item.id),
            vec![library.inner.paths.source_original("0123456789abcdef")]
        );
        assert!(lidar.join("sources/0123456789abcdef/original").is_file());
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A recovered library that is rebuilt again before anything was retried
    /// keeps every item: the metas the first recovered open rewrites still
    /// describe the unpublished items, their member order and their analyses,
    /// and an original first listed under a generated name keeps that item.
    #[test]
    fn a_second_rebuild_before_any_retry_keeps_every_item() {
        let root = crate::test_scratch::TestScratch::new("lidar-double-rebuild");
        let lidar = paths::library_root(&root);
        let mut orchard = single_item_meta(
            "sha-1",
            "lyr-1",
            "Orchard",
            RasterQuantity::GroundElevation.key(),
            "m",
        );
        orchard.items[0].analyses.push(source_meta::AnalysisMeta {
            definition_id: "adef-1".into(),
            analysis_id: "terrain.slope".into(),
            parameters: serde_json::json!([{"key":"unit","value":{"Choice":"degrees"}}]),
            outputs: serde_json::json!(["slope"]),
            created_at: "11".into(),
            inputs: vec![source_meta::AnalysisInputMeta {
                input_key: "dem".into(),
                item_id: "lyr-1".into(),
            }],
            items: vec![source_meta::DerivedItemMeta {
                id: "item-slope".into(),
                output_key: "slope".into(),
                quantity: "slope".into(),
                units: "°".into(),
                name: Some("Steepness".into()),
                created_at: "11".into(),
            }],
        });
        write_original(&lidar, "sha-1", Some(&orchard));
        write_original(&lidar, "0123456789abcdef", None);
        let catalogue_path = lidar.join(paths::CATALOGUE_FILE);
        write_catalogue_with_version(&catalogue_path, "20");

        let items_of = |library: &LidarLibrary| -> Vec<(String, String, String)> {
            library
                .library_snapshot()
                .unwrap()
                .items
                .iter()
                .map(|item| {
                    (
                        item.id.clone(),
                        item.name.clone().unwrap_or_default(),
                        item.units.clone(),
                    )
                })
                .collect()
        };
        let library = LidarLibrary::open(&root).unwrap();
        let first = items_of(&library);
        assert_eq!(first.len(), 3, "{first:?}");
        drop(library);

        // A second rebuild, before any Retry: the catalogue is older again.
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", catalogue_path.display()));
        }
        write_catalogue_with_version(&catalogue_path, "20");
        let reopened = LidarLibrary::open(&root).unwrap();
        assert!(
            matches!(
                reopened.open_status(),
                recovery::LibraryOpenStatus::Recovered { .. }
            ),
            "{:?}",
            reopened.open_status()
        );
        assert_eq!(items_of(&reopened), first, "no item is lost");
        assert_eq!(
            saved_selection(&reopened, "lyr-1"),
            vec![reopened.inner.paths.source_original("sha-1")]
        );
        assert_eq!(
            reopened.delete_impact("lyr-1").unwrap().dependent_item_ids,
            vec!["item-slope"],
            "the analysis over the item survives"
        );
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// Member order is the item's source priority and survives the rebuild.
    #[test]
    fn a_rebuilt_item_keeps_its_member_order() {
        let root = crate::test_scratch::TestScratch::new("lidar-member-order");
        let lidar = paths::library_root(&root);
        let mut meta_b = single_item_meta(
            "sha-b",
            "lyr-ab",
            "Pair",
            RasterQuantity::GroundElevation.key(),
            "m",
        );
        meta_b.items[0].members = vec!["sha-b".into(), "sha-a".into()];
        let mut meta_a = meta_b.clone();
        meta_a.sha256 = "sha-a".into();
        write_original(&lidar, "sha-a", Some(&meta_a));
        write_original(&lidar, "sha-b", Some(&meta_b));
        write_catalogue_with_version(&lidar.join(paths::CATALOGUE_FILE), "20");

        let library = LidarLibrary::open(&root).unwrap();
        assert_eq!(library.library_snapshot().unwrap().items.len(), 1);
        let paths = &library.inner.paths;
        assert_eq!(
            saved_selection(&library, "lyr-ab"),
            vec![
                paths.source_original("sha-b"),
                paths.source_original("sha-a")
            ]
        );
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A newer catalogue belongs to a newer Canopi: it is refused and nothing
    /// under the library is moved, written or swept. The app still starts with
    /// an empty, read-only library that names the refusal.
    #[test]
    fn a_newer_catalogue_is_refused_without_touching_files() {
        let root = crate::test_scratch::TestScratch::new("lidar-newer-library");
        let lidar = paths::library_root(&root);
        write_original(
            &lidar,
            "sha-n",
            Some(&single_item_meta(
                "sha-n",
                "lyr-n",
                "Future",
                RasterQuantity::GroundElevation.key(),
                "m",
            )),
        );
        std::fs::create_dir_all(lidar.join("assets/unreferenced")).unwrap();
        std::fs::write(lidar.join("assets/unreferenced/cog.tif"), b"kept").unwrap();
        let catalogue_path = lidar.join(paths::CATALOGUE_FILE);
        write_catalogue_with_version(&catalogue_path, "99");
        let newer_bytes = std::fs::read(&catalogue_path).unwrap();

        let library = LidarLibrary::open(&root).expect("the app starts");
        assert_eq!(
            *library.open_status(),
            recovery::LibraryOpenStatus::RefusedNewer {
                found: 99,
                supported: catalogue::CATALOGUE_VERSION
            }
        );
        assert!(library.library_snapshot().unwrap().items.is_empty());
        let refused = library
            .record_import_item(
                "Later",
                RasterQuantity::GroundElevation,
                None,
                false,
                &[root.join("a.tif")],
            )
            .unwrap_err();
        assert!(refused.contains("newer version of Canopi"), "{refused}");
        assert!(
            library
                .rename_item("lyr-n", "x")
                .unwrap_err()
                .contains("newer version")
        );
        assert_eq!(
            std::fs::read(&catalogue_path).unwrap(),
            newer_bytes,
            "left byte for byte"
        );
        assert!(!lidar.join(recovery::SET_ASIDE_DIR).exists());
        assert!(
            lidar.join("assets/unreferenced/cog.tif").is_file(),
            "nothing is swept"
        );
        assert!(lidar.join("sources/sha-n/original").is_file());
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// The meta the library writes after publication is what a rebuild reads:
    /// a published item with a result, set aside, comes back as the same items
    /// in the same order.
    #[test]
    fn the_meta_a_library_writes_rebuilds_its_own_items() {
        let root = crate::test_scratch::TestScratch::new("lidar-meta-roundtrip");
        let lidar = paths::library_root(&root);
        let library = LidarLibrary::open(&root).unwrap();
        for sha256 in ["sha-x", "sha-y"] {
            write_original(&lidar, sha256, None);
        }
        {
            let connection = library.catalogue().unwrap();
            source_meta::test_support::seed_published_item(
                &connection,
                "lyr-xy",
                "Valley",
                RasterQuantity::GroundElevation.key(),
                "m",
                &[("sha-y", "y.tif"), ("sha-x", "x.tif")],
            );
            seed_analysis(&connection, "lyr-xy", "item-v");
        }
        library.rename_item("item-v", "Valley slope").unwrap();
        let meta =
            source_meta::read(&library.inner.paths.source_meta("sha-x")).expect("meta written");
        assert_eq!(meta.original_filename, "x.tif");
        assert_eq!(meta.items[0].members, vec!["sha-y", "sha-x"]);
        assert_eq!(
            meta.items[0].analyses[0].items[0].name.as_deref(),
            Some("Valley slope")
        );
        drop(library);

        // The same files under a catalogue from another Canopi.
        std::fs::remove_file(lidar.join(paths::CATALOGUE_FILE)).unwrap();
        write_catalogue_with_version(&lidar.join(paths::CATALOGUE_FILE), "1");
        let rebuilt = LidarLibrary::open(&root).unwrap();
        assert!(matches!(
            rebuilt.open_status(),
            recovery::LibraryOpenStatus::Recovered {
                items: 1,
                generated: 0,
                ..
            }
        ));
        let snapshot = rebuilt.library_snapshot().unwrap();
        let listed: Vec<(String, Option<String>)> = snapshot
            .items
            .iter()
            .map(|item| (item.id.clone(), item.name.clone()))
            .collect();
        assert_eq!(
            listed,
            vec![
                ("lyr-xy".to_string(), Some("Valley".to_string())),
                ("item-v".to_string(), Some("Valley slope".to_string())),
            ]
        );
        let paths = &rebuilt.inner.paths;
        assert_eq!(
            saved_selection(&rebuilt, "lyr-xy"),
            vec![
                paths.source_original("sha-y"),
                paths.source_original("sha-x")
            ]
        );
        drop(rebuilt);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A real import writes the meta a rebuild needs, and Retry on
    /// the rebuilt item prepares it again from the managed originals alone,
    /// under the same item id, with the same members in the same order.
    #[test]
    fn a_rebuilt_item_is_prepared_again_from_its_managed_originals() {
        let engine = crate::services::lidar::rust_engine::RustRasterEngine;
        let cancel = AtomicBool::new(false);
        let root = crate::test_scratch::TestScratch::new("canopi-rebuild-retry");
        std::fs::create_dir_all(&root).unwrap();
        let plane = |name: &str, value: f32, origin_x: f64| -> PathBuf {
            let raw = root.join(format!("{name}.raw"));
            import::write_f32_raw(&raw, &[value; 16]).expect("raw plane");
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
        let lidar = paths::library_root(&root);

        let library = LidarLibrary::open(&root).unwrap();
        let (layer_id, job_id) = library
            .record_import_item(
                "Two planes",
                RasterQuantity::GroundElevation,
                None,
                false,
                &[east.clone(), west.clone()],
            )
            .unwrap();
        import::stage_and_publish(&library, &job_id, &layer_id, &[east, west], &cancel)
            .expect("the batch publishes");
        library.finish_import_sources(&job_id, Ok(()));
        let members: Vec<String> = {
            let connection = library.catalogue().unwrap();
            let head = catalogue::head_generation(&connection, &layer_id)
                .unwrap()
                .expect("published");
            catalogue::collection_members(&connection, &head.id)
                .unwrap()
                .iter()
                .map(|member| {
                    connection
                        .query_row(
                            "SELECT source_sha256 FROM lidar_interpretations WHERE id = ?1",
                            [&member.interpretation_id],
                            |row| row.get(0),
                        )
                        .unwrap()
                })
                .collect()
        };
        assert_eq!(members.len(), 2);
        for sha256 in &members {
            let meta = source_meta::read(&library.inner.paths.source_meta(sha256))
                .expect("meta written after publication");
            assert_eq!(meta.items[0].id, layer_id);
            assert_eq!(meta.items[0].name, "Two planes");
            assert_eq!(meta.items[0].members, members);
        }
        assert_eq!(
            source_meta::read(&library.inner.paths.source_meta(&members[0]))
                .unwrap()
                .original_filename,
            "east.tif"
        );
        drop(library);

        std::fs::remove_file(lidar.join(paths::CATALOGUE_FILE)).unwrap();
        write_catalogue_with_version(&lidar.join(paths::CATALOGUE_FILE), "1");
        let rebuilt = LidarLibrary::open(&root).unwrap();
        assert!(matches!(
            rebuilt.open_status(),
            recovery::LibraryOpenStatus::Recovered {
                items: 1,
                generated: 0,
                ..
            }
        ));
        let listed = &rebuilt.library_snapshot().unwrap().items[0];
        assert_eq!(listed.id, layer_id);
        assert_eq!(listed.state, common_types::lidar::LidarResultState::Failed);

        // Retry, as the command does it, minus the spawned wrapper.
        let (retry_layer, retry_job, selection) = rebuilt.record_import_retry(&layer_id).unwrap();
        assert_eq!(retry_layer, layer_id);
        assert!(
            selection
                .iter()
                .all(|path| path.starts_with(lidar.join("sources")))
        );
        import::stage_and_publish(&rebuilt, &retry_job, &layer_id, &selection, &cancel)
            .expect("the managed originals publish again");
        rebuilt.finish_import_sources(&retry_job, Ok(()));
        let snapshot = rebuilt.library_snapshot().unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert_eq!(
            snapshot.items[0].state,
            common_types::lidar::LidarResultState::Ready
        );
        let collection = rebuilt.layer_collection(&layer_id, None).unwrap();
        let again: Vec<String> = collection
            .sources
            .iter()
            .map(|member| member.filename.clone())
            .collect();
        assert_eq!(
            again,
            vec!["east.tif", "west.tif"],
            "order and filenames survive"
        );
        drop(rebuilt);
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

/// Open the display cache, best effort: it only indexes regenerable display
/// derivatives, so a file that cannot be opened or initialised is removed and
/// recreated, and when that fails too the cache runs in memory for this run.
/// Derivatives the lost index named are swept at startup as unregistered.
fn open_display_cache_or_recreate(path: &std::path::Path) -> Result<Connection, String> {
    match open_display_cache(path) {
        Ok(connection) => return Ok(connection),
        Err(error) => {
            tracing::warn!(%error, "LiDAR display cache is unusable; recreating it");
        }
    }
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let file = std::path::PathBuf::from(format!("{}{suffix}", path.display()));
        if let Err(error) = std::fs::remove_file(&file)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(path = %file.display(), %error, "failed to remove the display cache");
        }
    }
    match open_display_cache(path) {
        Ok(connection) => Ok(connection),
        Err(error) => {
            tracing::error!(%error, "LiDAR display cache could not be recreated; using memory");
            let connection = Connection::open_in_memory()
                .map_err(|e| format!("Failed to open an in-memory display cache: {e}"))?;
            init_display_cache(&connection)?;
            Ok(connection)
        }
    }
}

fn open_display_cache(path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|e| format!("Failed to open display cache {}: {e}", path.display()))?;
    init_display_cache(&connection)?;
    Ok(connection)
}

fn init_display_cache(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS display_cogs (
                key TEXT PRIMARY KEY,
                file TEXT NOT NULL,
                bytes INTEGER NOT NULL,
                west REAL NOT NULL,
                south REAL NOT NULL,
                east REAL NOT NULL,
                north REAL NOT NULL,
                created_at TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Failed to init display cache: {e}"))?;
    Ok(())
}

/// One import job as the UI reads it.
pub(crate) fn import_job_summary(
    connection: &Connection,
    job_id: &str,
) -> Result<Option<LidarImportJob>, String> {
    let Some(row) = catalogue::get_import_job(connection, job_id)? else {
        return Ok(None);
    };
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
        message: row.message,
        progress,
    }))
}

/// The saved selection of one import, in priority order.
pub(crate) fn import_request_json(paths: &[PathBuf]) -> Result<String, String> {
    let paths: Vec<String> = paths
        .iter()
        .map(|path| {
            path.to_str()
                .map(str::to_string)
                .ok_or_else(|| format!("{} is not a valid file path", path.display()))
        })
        .collect::<Result<_, _>>()?;
    serde_json::to_string(&serde_json::json!({ "paths": paths }))
        .map_err(|e| format!("Failed to save the import selection: {e}"))
}

fn parse_import_request(json: &str) -> Result<Vec<PathBuf>, String> {
    #[derive(serde::Deserialize)]
    struct Request {
        paths: Vec<String>,
    }
    let request: Request = serde_json::from_str(json)
        .map_err(|e| format!("The saved import selection is unreadable: {e}"))?;
    Ok(request.paths.into_iter().map(PathBuf::from).collect())
}

fn parse_import_state(raw: &str) -> LidarImportJobState {
    match raw {
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

/// The unit label for a new source, or a refusal when none was declared.
///
/// Elevation and height have an inherent unit, so their label is fixed and a
/// caller cannot contradict it. An "other continuous" dataset has no inherent
/// unit, so its author must either supply one or state that it is unknown:
/// silently storing a label such as `unitless` would assert the values are
/// dimensionless, which is a measurement claim nobody made. Derived quantities
/// are never imported.
fn resolve_units(
    quantity: RasterQuantity,
    unit_label: Option<&str>,
    unit_unknown: bool,
) -> Result<String, String> {
    if !quantity.is_importable() {
        return Err(format!(
            "{} is calculated by an analysis and cannot be imported",
            quantity.key()
        ));
    }
    match quantity {
        RasterQuantity::OtherContinuous => {
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
        _ => {
            if unit_label.is_some() || unit_unknown {
                return Err(format!(
                    "A {} dataset is measured in metres; its unit is not selectable",
                    quantity.key()
                ));
            }
            Ok("m".to_string())
        }
    }
}
