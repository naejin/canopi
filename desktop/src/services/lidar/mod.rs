//! Local LiDAR raster library service.
//!
//! The subsystem owns files, jobs, engines and caches; the map host owns map
//! lifetime and documents own presentation references. Library mutations
//! never dirty a Design, and no catalogue lock is held during raster
//! computation.

#[cfg(test)]
mod acceptance_hooks;
pub mod admission;
pub mod analysis;
pub mod catalogue;
mod collection;
mod display_cog;
#[cfg(test)]
mod e2e;
pub mod engine;
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
pub mod probe;
mod raster_assets;
mod raster_info;

use catalogue::{new_id, now_iso};
use common_types::lidar::{
    LidarAnalysisJobStatus, LidarAnalysisKind, LidarAnalysisParameters, LidarImportJob,
    LidarImportJobState, LidarImportProgress, LidarImportProgressPhase, LidarResultState,
};
use engine::GdalEngine;
use paths::LidarPaths;
use rusqlite::{Connection, OptionalExtension as _};
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
    /// The pinned GeoLibre runner for recipe-2 slope definitions.
    pub(crate) geolibre: geolibre::GeolibreEngine,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    executor: Mutex<Option<crate::native_operation::NativeOperationExecutor>>,
    /// One exclusive heavy raster job at a time, library-wide. Import and
    /// analysis jobs hold it.
    heavy_job: Mutex<Option<String>>,
    /// Bounded display read admission, separate from the heavy lease.
    display: Mutex<DisplayAdmission>,
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
        discard_unsupported_library(&paths::library_root(app_data_dir))?;
        let paths = LidarPaths::open(app_data_dir)?;
        let catalogue = catalogue::open(&paths.catalogue_path())?;
        let display_cache = open_display_cache(&paths.display_cache_path())?;
        let library = Self {
            inner: Arc::new(LidarLibraryInner {
                paths,
                catalogue: Mutex::new(catalogue),
                display_cache: Mutex::new(display_cache),
                engine: GdalEngine::new(),
                geolibre: geolibre::GeolibreEngine::new(),
                cancel_flags: Mutex::new(HashMap::new()),
                executor: Mutex::new(None),
                heavy_job: Mutex::new(None),
                display: Mutex::new(DisplayAdmission::default()),
                display_preparation: Mutex::new(display_cog::DisplayPreparation::default()),
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

    /// Best-effort bounded cleanup at startup: job scratch dirs for settled
    /// jobs, abandoned staging dirs, unregistered display derivatives and the
    /// retired PNG display stores.
    fn prune_transient_artifacts(&self) -> Result<(), String> {
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
        // Display derivatives nobody registered, and interrupted writes, can go
        // now: no WebView reader exists before the library opens.
        display_cog::prune_display_derivatives(self)?;
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
        Ok(())
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
        let slope_engine = match self.inner.geolibre.discover() {
            Ok(tool) => common_types::lidar::LidarEngineStatus {
                available: true,
                version: Some(tool.provenance()),
                detail: None,
            },
            Err(error) => common_types::lidar::LidarEngineStatus {
                available: false,
                version: None,
                detail: Some(error),
            },
        };
        presentation::library_snapshot(&connection, &self.inner.engine, slope_engine)
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

    /// Test support: an empty item row, as older builds created before import.
    #[cfg(test)]
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

    /// Rename a saved result. The name is library metadata: values, input and
    /// identity are unchanged, and a failed operation's Retry keeps the name.
    pub fn rename_analysis(&self, definition_id: &str, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Result name must not be empty".to_string());
        }
        let connection = self.catalogue()?;
        let definition = analysis::definition_row(&connection, definition_id)?
            .ok_or_else(|| format!("Analysis {definition_id} does not exist"))?;
        let mut parameters = analysis::parse_parameters(&definition.parameters_json)?;
        parameters.name = Some(name.to_string());
        let parameters_json = serde_json::to_string(&parameters).map_err(|e| e.to_string())?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        transaction
            .execute(
                "UPDATE lidar_analysis_definitions SET parameters_json = ?2 WHERE id = ?1",
                rusqlite::params![definition_id, parameters_json],
            )
            .map_err(|e| format!("Failed to rename the result: {e}"))?;
        transaction
            .execute(
                "UPDATE lidar_analysis_generations SET name = ?2 WHERE definition_id = ?1",
                rusqlite::params![definition_id, name],
            )
            .map_err(|e| format!("Failed to rename the result: {e}"))?;
        transaction.commit().map_err(|e| e.to_string())
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
            refuse_dependent_results(&connection, layer_id, definitions.len())?;
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
        // Recheck inside the transaction: a result created meanwhile keeps its
        // input.
        let dependents: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM lidar_analysis_definitions WHERE layer_id = ?1",
                [layer_id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        refuse_dependent_results(
            &transaction,
            layer_id,
            usize::try_from(dependents).unwrap_or(usize::MAX),
        )?;
        for definition_id in &definition_ids {
            delete_analysis_rows(&transaction, definition_id)?;
        }
        // Ordered snapshots keep their own member rows, which reference the
        // generations deleted below.
        transaction
            .execute(
                "DELETE FROM lidar_collection_members WHERE generation_id IN
                 (SELECT id FROM lidar_layer_generations WHERE layer_id = ?1)",
                [layer_id],
            )
            .map_err(|e| e.to_string())?;
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
        Ok(())
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
        if let Ok(connection) = self.catalogue() {
            let _ = connection.execute(
                "UPDATE lidar_import_jobs
                 SET state = 'cancelled', message = 'import cancelled', updated_at = ?2
                 WHERE id = ?1 AND state IN ('staging', 'applying')",
                rusqlite::params![job_id, now_iso()],
            );
            let _ = connection.execute(
                "UPDATE lidar_analysis_jobs
                 SET state = 'cancelled', message = 'analysis cancelled', updated_at = ?2
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
        measurement_kind: common_types::lidar::LidarMeasurementKind,
        unit_label: Option<&str>,
        unit_unknown: bool,
        paths: &[PathBuf],
    ) -> Result<(String, String), String> {
        if paths.is_empty() {
            return Err("no files were selected for import".to_string());
        }
        let name = name.trim();
        if name.is_empty() {
            return Err("Layer name must not be empty".to_string());
        }
        let units = resolve_units(measurement_kind, unit_label, unit_unknown)?;
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
                "INSERT INTO lidar_source_layers(id, name, measurement_kind, units, created_at)
                 VALUES(?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![layer_id, name, measurement_kind.as_str(), units, now],
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
            if let Err(error) = import::settle_job_root(self, &job_id) {
                tracing::warn!(job_id, error = %error, "dismissed import kept its root for recovery");
            }
        }
        Ok(())
    }

    /// Record and start one import as a new library item.
    pub fn import_item(
        &self,
        name: &str,
        measurement_kind: common_types::lidar::LidarMeasurementKind,
        unit_label: Option<&str>,
        unit_unknown: bool,
        paths: Vec<PathBuf>,
    ) -> Result<common_types::lidar::LidarImportReceipt, String> {
        let (layer_id, job_id) =
            self.record_import_item(name, measurement_kind, unit_label, unit_unknown, &paths)?;
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
                        // Display derivatives are staged under the same job, so
                        // the item can be drawn as soon as it is published.
                        library_for_work.record_import_progress(
                            &job_id_for_stage,
                            LidarImportProgressPhase::RenderingMap,
                            1,
                        );
                        library_for_work.prepare_staged_display(&staging, &flag)?;
                        // Publication refuses an item that already has a head:
                        // items are fixed once published.
                        import::apply_import(&library_for_work, &staging, &flag)
                            .map(|outcome| {
                                tracing::info!(summary = outcome.summary(), message = ?outcome.message, "LiDAR import published");
                            })
                    },
                )
                .await;
            library.finish_import_sources(&job_id_clone, &layer_id_for_work, outcome);
        });
        Ok(())
    }

    /// Record the outcome of a one-step import.
    fn finish_import_sources(&self, job_id: &str, layer_id: &str, outcome: Result<(), String>) {
        let mut published = false;
        if let Ok(connection) = self.catalogue() {
            match outcome {
                Ok(()) => {
                    published = true;
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
        // Import publishes a new fixed item; it never touches another item or
        // enqueues analysis.
        let _ = (published, layer_id);
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
        // Malformed stored parameters fail the job by name; they are never
        // replaced by defaults that would compute something else.
        let parameters = match analysis::parse_parameters(&parameters_json) {
            Ok(parameters) => parameters,
            Err(error) => {
                if let Ok(connection) = self.catalogue() {
                    let _ = connection.execute(
                        "UPDATE lidar_analysis_jobs SET state = 'failed', message = ?2, updated_at = ?3 WHERE id = ?1",
                        rusqlite::params![job_id, format!("the saved calculation settings are unreadable: {error}"), now_iso()],
                    );
                }
                return;
            }
        };
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
                // The pinned input is no longer the source head: nothing is
                // published and nothing is re-targeted to the newer head.
                if let Ok(connection) = self.catalogue() {
                    let _ = connection.execute(
                        "UPDATE lidar_analysis_jobs SET state = 'failed', message = 'the input changed before the result was published', updated_at = ?2 WHERE id = ?1",
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

    /// Create a new slope result with the current method, the pinned GeoLibre
    /// projected slope (recipe 2), and run its first job.
    ///
    /// A missing GeoLibre engine refuses creation by name.
    pub fn create_analysis(
        &self,
        layer_id: &str,
        kind: LidarAnalysisKind,
        parameters: LidarAnalysisParameters,
        result_name: Option<String>,
    ) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
        self.inner.geolibre.discover()?;
        self.create_analysis_unchecked(layer_id, kind, parameters, result_name)
    }

    /// Record a definition and its first job without checking for the engine.
    ///
    /// Production goes through [`Self::create_analysis`]; tests that only need
    /// the catalogue rows call this directly.
    pub(crate) fn create_analysis_unchecked(
        &self,
        layer_id: &str,
        kind: LidarAnalysisKind,
        parameters: LidarAnalysisParameters,
        result_name: Option<String>,
    ) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
        let recipe = analysis::SlopeRecipe::GeolibreProjected;
        let connection = self.catalogue()?;
        let layer = catalogue::get_layer(&connection, layer_id)?
            .ok_or_else(|| format!("Layer {layer_id} does not exist"))?;
        analysis::capability(kind, layer.measurement_kind.as_str())?;
        let input = catalogue::head_generation(&connection, layer_id)?
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
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![definition_id, layer_id, kind.as_str(), recipe.version(), parameters_json, now_iso()],
            )
            .map_err(|e| format!("Failed to create analysis definition: {e}"))?;
        connection
            .execute(
                "INSERT INTO lidar_dependencies(definition_id, layer_id, kind) VALUES(?1, ?2, 'source')",
                rusqlite::params![definition_id, layer_id],
            )
            .map_err(|e| e.to_string())?;
        // One job for this new definition only, pinned to the input generation
        // it was created from; other results are never touched.
        let job_id = new_id("anl");
        connection
            .execute(
                "INSERT INTO lidar_analysis_jobs(id, definition_id, source_generation_id, state, created_at, updated_at)
                 VALUES(?1, ?2, ?3, 'preparing', ?4, ?4)",
                rusqlite::params![job_id, definition_id, input.id, now_iso()],
            )
            .map_err(|e| format!("Failed to enqueue the analysis: {e}"))?;
        {
            let library = self.clone();
            let job_id = job_id.clone();
            let definition_id = definition_id.clone();
            let source_generation_id = input.id.clone();
            tauri::async_runtime::spawn(async move {
                library
                    .run_refresh(job_id, definition_id, parameters_json, source_generation_id)
                    .await;
            });
        }
        Ok(common_types::lidar::LidarAnalysisReceipt {
            definition_id,
            job_id,
        })
    }

    /// Retry one failed or cancelled calculation with its saved definition.
    ///
    /// Retry reruns the stored recipe, parameters and name against the input
    /// the failed operation was pinned to; it is never a way to recalculate a
    /// result. A definition that already has a result is refused (make a new
    /// calculation instead), as is a failed attempt whose pinned input is not
    /// the one expected or is no longer the source's current generation.
    pub fn retry_analysis(
        &self,
        definition_id: &str,
        expected_source_generation_id: &str,
    ) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
        let connection = self.catalogue()?;
        let definition = analysis::definition_row(&connection, definition_id)?
            .ok_or_else(|| format!("Analysis {definition_id} does not exist"))?;
        analysis::SlopeRecipe::from_version(definition.version)?;
        if catalogue::head_analysis_generation(&connection, definition_id)?.is_some() {
            return Err(
                "this result is complete; calculate a new slope instead of retrying it".to_string(),
            );
        }
        let pinned: Option<String> = connection
            .query_row(
                "SELECT source_generation_id FROM lidar_analysis_jobs
                 WHERE definition_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
                [definition_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(pinned) = pinned else {
            return Err(
                "this calculation has no recorded input to retry; calculate a new slope instead"
                    .to_string(),
            );
        };
        if pinned != expected_source_generation_id {
            return Err("the input of this calculation is not the one expected".to_string());
        }
        let head = catalogue::head_generation(&connection, &definition.layer_id)?
            .ok_or_else(|| "source layer has no accepted coverage to analyse yet".to_string())?;
        if head.id != pinned {
            return Err(
                "the input of this calculation is no longer available; calculate a new slope instead"
                    .to_string(),
            );
        }
        let active = matches!(
            catalogue::latest_analysis_job_state(&connection, definition_id)
                .ok()
                .flatten()
                .as_deref(),
            Some("preparing")
        );
        if active {
            return Err("analysis is already running".to_string());
        }
        let job_id = new_id("anl");
        connection
            .execute(
                "INSERT INTO lidar_analysis_jobs(id, definition_id, source_generation_id, state, created_at, updated_at)
                 VALUES(?1, ?2, ?3, 'preparing', ?4, ?4)",
                rusqlite::params![job_id, definition_id, head.id, now_iso()],
            )
            .map_err(|e| format!("Failed to enqueue analysis retry: {e}"))?;
        let parameters_json = definition.parameters_json.clone();
        let source_generation_id = head.id.clone();
        let definition_id = definition_id.to_string();
        {
            let library = self.clone();
            let job_id = job_id.clone();
            let definition_id = definition_id.clone();
            let parameters_json = parameters_json.clone();
            let source_generation_id = source_generation_id.clone();
            tauri::async_runtime::spawn(async move {
                library
                    .run_refresh(job_id, definition_id, parameters_json, source_generation_id)
                    .await;
            });
        }
        Ok(common_types::lidar::LidarAnalysisReceipt {
            definition_id,
            job_id,
        })
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
        let transaction = connection
            .unchecked_transaction()
            .map_err(|e| e.to_string())?;
        delete_analysis_rows(&transaction, definition_id)?;
        transaction.commit().map_err(|e| e.to_string())?;
        drop(connection);
        Ok(())
    }
}

/// Refuse to delete a source that saved results were calculated from.
///
/// Results keep their meaning only while their input exists, so they are
/// deleted explicitly first; there is no cascade and no orphan result.
fn refuse_dependent_results(
    connection: &Connection,
    layer_id: &str,
    dependents: usize,
) -> Result<(), String> {
    if dependents == 0 {
        return Ok(());
    }
    let name = catalogue::get_layer(connection, layer_id)?
        .map(|layer| layer.name)
        .unwrap_or_else(|| layer_id.to_string());
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
#[cfg(test)]
mod fixed_library_tests;

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
             VALUES (?1, ?2, 'slope', 2, '{}', '0')",
                rusqlite::params![definition_id, layer_id],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO lidar_analysis_generations
             (id, definition_id, source_generation_id, engine_version, state,
              manifest_json, coverage_cells, min_value, max_value,
              bounds_3857, published_at, method_id, recipe_version)
             VALUES ('agen-1', ?1, 'source-gen', 'test', 'ready', '{}',
                     1, 0, 1, '[0,0,1,1]', '0', 'geolibre-projected-slope-v1', 2)",
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
    /// layer's members. Calling a public method that takes the same mutex again
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
                  crs_wkt, vertical_ref, nodata, geotransform, width, height, interp_hash,
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
                  coverage_cells, min_value, max_value, bounds_3857)
                 VALUES ('source-gen', ?1, '0', '{}', 1, 0, 1, '[0,0,1,1]')",
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

        // A saved result is deleted explicitly first; the source then removes
        // every row that references it.
        assert!(library.delete_layer(&layer_id).is_err());
        library.delete_analysis("analysis-delete").unwrap();
        library.delete_layer(&layer_id).unwrap();
        let connection = library.catalogue().unwrap();
        for table in [
            "lidar_source_layers",
            "lidar_layer_heads",
            "lidar_layer_generations",
            "lidar_collection_members",
            "lidar_import_jobs",
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
        library.finish_import_sources(&job_id, &layer_id, Ok(()));

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
            .create_layer(
                "broken batch",
                common_types::lidar::LidarMeasurementKind::GroundElevation,
                None,
                false,
            )
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

    /// Canopi v2 does not read a v1 library: opening deletes it (catalogue,
    /// originals, assets and derivatives) and starts an empty one.
    #[test]
    fn an_older_library_is_deleted_and_a_fresh_one_opens() {
        let root = std::env::temp_dir().join(new_id("lidar-v1-library"));
        let lidar = paths::library_root(&root);
        std::fs::create_dir_all(lidar.join("sources/abc")).unwrap();
        std::fs::write(lidar.join("sources/abc/original"), b"v1 original").unwrap();
        {
            let v1 = Connection::open(lidar.join("lidar-library.sqlite")).unwrap();
            v1.execute_batch(
                "CREATE TABLE lidar_catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                 INSERT INTO lidar_catalogue_meta VALUES ('schema_version', '19');
                 CREATE TABLE lidar_source_layers (id TEXT PRIMARY KEY);",
            )
            .unwrap();
        }

        let library = LidarLibrary::open(&root).unwrap();
        assert!(
            !lidar.join("sources/abc").exists(),
            "v1 originals are deleted"
        );
        assert!(library.library_snapshot().unwrap().layers.is_empty());
        assert_eq!(
            catalogue::stored_version(&library.inner.paths.catalogue_path()).unwrap(),
            Some(catalogue::CATALOGUE_VERSION)
        );
        drop(library);
        std::fs::remove_dir_all(root).unwrap();
    }

    /// A newer catalogue belongs to a newer Canopi: it is refused, never deleted.
    #[test]
    fn a_newer_library_is_refused_and_kept() {
        let root = std::env::temp_dir().join(new_id("lidar-newer-library"));
        let lidar = paths::library_root(&root);
        std::fs::create_dir_all(&lidar).unwrap();
        {
            let newer = Connection::open(lidar.join("lidar-library.sqlite")).unwrap();
            newer
                .execute_batch(
                    "CREATE TABLE lidar_catalogue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                     INSERT INTO lidar_catalogue_meta VALUES ('schema_version', '99');",
                )
                .unwrap();
        }
        let error = LidarLibrary::open(&root)
            .err()
            .expect("newer library refused");
        assert!(error.contains("is not supported"), "{error}");
        assert_eq!(
            catalogue::stored_version(&lidar.join("lidar-library.sqlite")).unwrap(),
            Some(99)
        );
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

/// Delete a library written by an older Canopi.
///
/// Canopi v2 keeps no migration path for v1 LiDAR libraries: an older
/// catalogue means the whole managed library directory is removed before a
/// fresh one is created. A newer catalogue is left in place for
/// `catalogue::open` to refuse.
fn discard_unsupported_library(root: &std::path::Path) -> Result<(), String> {
    let catalogue_path = root.join(paths::CATALOGUE_FILE);
    match catalogue::stored_version(&catalogue_path)? {
        Some(version) if version < catalogue::CATALOGUE_VERSION => {
            std::fs::remove_dir_all(root).map_err(|e| {
                format!(
                    "Failed to remove the unsupported LiDAR library {} (schema v{version}): {e}",
                    root.display()
                )
            })?;
            tracing::warn!(
                "removed LiDAR library {} written by an older Canopi (schema v{version})",
                root.display()
            );
            Ok(())
        }
        _ => Ok(()),
    }
}

fn open_display_cache(path: &std::path::Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|e| format!("Failed to open display cache {}: {e}", path.display()))?;
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
    Ok(connection)
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
fn import_request_json(paths: &[PathBuf]) -> Result<String, String> {
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

fn parse_result_state(raw: &str) -> LidarResultState {
    match raw {
        "ready" | "complete" => LidarResultState::Ready,
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
