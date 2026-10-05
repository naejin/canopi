//! Tauri IPC commands for the LiDAR library.
//!
//! UI callers never orchestrate SQL, rasters, masks, engine processes, cache
//! publication or recovery: every capability here returns library identities,
//! receipts or snapshots. All heavy work runs through the managed Native
//! Operation Executor.

use crate::{native_operation::NativeOperationExecutor, services::lidar::LidarLibrary};
use common_types::library::{
    AnalysisReceipt, AnalysisRequest, LibraryDeleteImpact, LibrarySnapshot, ProcessingHistoryPage,
    RasterQuantity,
};
use tauri::State;

#[tauri::command]
pub async fn lidar_list_library(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
) -> Result<LibrarySnapshot, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar library snapshot",
            move || library.library_snapshot(),
        )
        .await
}

/// Rename one library item, source or derived; metadata only.
#[tauri::command]
pub async fn lidar_rename_item(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    item_id: String,
    name: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar rename item",
            move || library.rename_item(&item_id, &name),
        )
        .await
}

/// The derived items calculated from one item, shown before deletion.
#[tauri::command]
pub async fn lidar_delete_impact(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    item_id: String,
) -> Result<LibraryDeleteImpact, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar delete impact",
            move || library.delete_impact(&item_id),
        )
        .await
}

/// Delete one library item; refused while results were calculated from it.
#[tauri::command]
pub async fn lidar_delete_item(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    item_id: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar delete item",
            move || library.delete_item(&item_id),
        )
        .await
}

/// Bounded cancellation signal delivery; must bypass queued executor work so
/// a busy Local class cannot make Cancel unresponsive. Only the in-memory
/// flag is set here; the job row is updated on the executor.
#[tauri::command]
pub fn lidar_cancel_import(library: State<'_, LidarLibrary>, job_id: String) {
    library.signal_cancel(&job_id);
}

/// Bounded cancellation signal delivery; must bypass queued executor work so
/// a busy Local class cannot make Cancel unresponsive. Only the in-memory
/// flag is set here; the job row is updated on the executor.
#[tauri::command]
pub fn lidar_cancel_analysis_job(library: State<'_, LidarLibrary>, job_id: String) {
    library.signal_cancel(&job_id);
}

/// Create a definition of a registered analysis and start its first run.
#[tauri::command]
pub async fn lidar_create_analysis(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    request: AnalysisRequest,
) -> Result<AnalysisReceipt, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar create analysis",
            move || library.create_analysis(&request),
        )
        .await
}

/// Run a definition again: Retry before a first result, Refresh after one.
#[tauri::command]
pub async fn lidar_rerun_analysis(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    definition_id: String,
) -> Result<AnalysisReceipt, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar rerun analysis",
            move || library.rerun_analysis(&definition_id),
        )
        .await
}

/// One bounded page of a definition's processing history, newest first.
#[tauri::command]
pub async fn lidar_processing_history(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    definition_id: String,
    cursor: Option<String>,
) -> Result<ProcessingHistoryPage, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar processing history",
            move || library.processing_history(&definition_id, cursor.as_deref()),
        )
        .await
}

/// One bounded page of a layer's ordered source composition.
#[tauri::command]
pub async fn lidar_layer_collection(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    cursor: Option<String>,
) -> Result<common_types::lidar::LidarLayerCollection, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar layer collection",
            move || library.layer_collection(&layer_id, cursor.as_deref()),
        )
        .await
}

/// Read one physical value for inspection through the shared display admission.
///
/// Inspection reuses the same bounded read admission, cancellation and queue
/// budget the raster display path owns, instead of passing a local flag that
/// nothing could ever set: a superseded lookup then stops at its next bounded
/// read, and a burst of abandoned lookups cannot outrun the active-request
/// budget. The admission name is scoped to the inspection surface, so a caller
/// can only ever cancel its own lookup. The read opens raster files, so it
/// belongs to the `Local` class, never to `UserData`.
#[tauri::command]
pub async fn lidar_sample_pixel(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    request: common_types::lidar::LidarSampleRequest,
) -> Result<common_types::lidar::LidarSampleOutcome, String> {
    let library = library.inner().clone();
    let mut ticket = library.admit_sample_request(&request.request_id)?;
    // Wait for a slot without holding an executor permit, so an inspection
    // read can never sit in front of a heavy raster job.
    ticket.activate().await?;
    let cancel = ticket.cancel_flag();
    executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar sample pixel",
            move || {
                // The ticket is held for the whole read and released with it,
                // so a cancelled or finished lookup never keeps a slot.
                let _slot = ticket;
                library.sample(&request, &cancel)
            },
        )
        .await
}

/// Stop waiting for, or stop reading, one inspection lookup.
///
/// Synchronous by design: it only signals bounded in-memory state, and the
/// reader checks the flag between bounded reads.
#[tauri::command]
pub fn lidar_cancel_sample_pixel(library: State<'_, LidarLibrary>, request_id: String) {
    library.cancel_sample_request(&request_id);
}

/// Describe the display derivatives of one entity's current generation.
///
/// Missing derivatives start preparing in the library's display lane; the
/// response then says `Preparing` and the caller asks again. Only managed file
/// paths inside the scoped display directory are returned, never bytes.
#[tauri::command]
pub async fn lidar_display_descriptor(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    request: common_types::lidar::LidarDisplayRequest,
) -> Result<common_types::lidar::LidarDisplayDescriptor, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar display descriptor",
            move || library.display_descriptor(&request),
        )
        .await
}

/// Import selected files as one new fixed library item.
///
/// The item and its job are created together only when the user submits the
/// selection; cancelling the file picker creates nothing. Preparation,
/// display derivatives and publication run as one job: a failure or
/// cancellation publishes none of the batch.
#[tauri::command]
pub async fn lidar_import_item(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    name: String,
    quantity: RasterQuantity,
    // `unit_label` and `unit_unknown` declare the unit of an "other continuous"
    // dataset. Elevation and height are always metres and refuse both.
    unit_label: Option<String>,
    unit_unknown: Option<bool>,
    paths: Vec<String>,
) -> Result<common_types::lidar::LidarImportReceipt, String> {
    import_item_with_executor(
        executor.inner(),
        library.inner().clone(),
        ImportSelection {
            name,
            quantity,
            unit_label,
            unit_unknown: unit_unknown.unwrap_or(false),
            paths: paths.into_iter().map(std::path::PathBuf::from).collect(),
        },
    )
    .await
}

/// What the import dialog submits.
struct ImportSelection {
    name: String,
    quantity: RasterQuantity,
    unit_label: Option<String>,
    unit_unknown: bool,
    paths: Vec<std::path::PathBuf>,
}

async fn import_item_with_executor(
    executor: &NativeOperationExecutor,
    library: LidarLibrary,
    selection: ImportSelection,
) -> Result<common_types::lidar::LidarImportReceipt, String> {
    // A running raster job holds Local for minutes; refuse before waiting.
    library.refuse_while_raster_job_runs()?;
    // File headers are read on the Local lane, so the probes never
    // queue settings, favorites or the catalogue behind them on UserData.
    let checking = library.clone();
    let selection = executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar import check",
            move || {
                checking.check_import_selection(&selection.paths)?;
                Ok(selection)
            },
        )
        .await?;
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar import item",
            move || {
                library.start_import(
                    &selection.name,
                    selection.quantity,
                    selection.unit_label.as_deref(),
                    selection.unit_unknown,
                    selection.paths,
                )
            },
        )
        .await
}

/// Import › "Covers your site": the WGS84 box around the chosen files, read
/// from their metadata before anything is imported.
#[tauri::command]
pub async fn lidar_import_coverage(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    paths: Vec<String>,
) -> Result<common_types::lidar::LidarImportCoverage, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar import coverage",
            move || {
                let paths: Vec<std::path::PathBuf> =
                    paths.into_iter().map(std::path::PathBuf::from).collect();
                library.import_coverage(&paths)
            },
        )
        .await
}

/// Data library footer: bytes the library occupies on this device.
#[tauri::command]
pub async fn lidar_library_disk_usage(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
) -> Result<u64, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar library size",
            move || library.disk_usage(),
        )
        .await
}

/// Retry a failed or cancelled import with its saved selection, keeping the
/// same library item. A published item cannot be retried.
#[tauri::command]
pub async fn lidar_retry_import(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
) -> Result<common_types::lidar::LidarImportReceipt, String> {
    retry_import_with_executor(executor.inner(), library.inner().clone(), layer_id).await
}

async fn retry_import_with_executor(
    executor: &NativeOperationExecutor,
    library: LidarLibrary,
    layer_id: String,
) -> Result<common_types::lidar::LidarImportReceipt, String> {
    // As Import: refused before waiting, and not kept as the item's failure.
    library.refuse_while_raster_job_runs()?;
    let reading = library.clone();
    let read_id = layer_id.clone();
    let selection = executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar retry selection",
            move || reading.retry_selection(&read_id),
        )
        .await?;
    // The saved files' headers are read on the Local lane, as Import's are.
    let checking = library.clone();
    let (selection, checked) = executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar retry check",
            move || {
                let checked = checking.check_retry_selection(&selection);
                Ok((selection, checked))
            },
        )
        .await?;
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar retry import",
            move || library.finish_retry(&layer_id, selection, checked),
        )
        .await
}

/// Remove an unpublished item whose import failed or was cancelled.
#[tauri::command]
pub async fn lidar_dismiss_import(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar dismiss import",
            move || library.dismiss_import(&layer_id),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_operation::{
        NativeOperationClass, NativeOperationClassLimits, NativeOperationLimits,
    };
    use std::{sync::mpsc, time::Duration};

    const WAIT_TIMEOUT: Duration = Duration::from_secs(2);

    fn one_at_a_time() -> NativeOperationExecutor {
        let limits = NativeOperationClassLimits::new(1, 1);
        NativeOperationExecutor::new(NativeOperationLimits::new(limits, limits, limits, limits))
            .unwrap()
    }

    /// Holds one lane until the returned sender is dropped or sent to.
    fn occupy(
        executor: &NativeOperationExecutor,
        class: NativeOperationClass,
    ) -> (
        mpsc::SyncSender<()>,
        tauri::async_runtime::JoinHandle<Result<(), String>>,
    ) {
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel::<()>(1);
        let executor = executor.clone();
        let blocker = tauri::async_runtime::spawn(async move {
            executor
                .run(class, "test lane blocker", move || {
                    started_tx.send(()).unwrap();
                    let _ = release_rx.recv();
                    Ok(())
                })
                .await
        });
        started_rx.recv_timeout(WAIT_TIMEOUT).unwrap();
        (release_tx, blocker)
    }

    fn selection(paths: Vec<std::path::PathBuf>) -> ImportSelection {
        ImportSelection {
            name: "Delft".to_string(),
            quantity: RasterQuantity::GroundElevation,
            unit_label: None,
            unit_unknown: false,
            paths,
        }
    }

    /// Import reads file headers on the Local lane: a missing file is refused
    /// while the one-at-a-time UserData lane (settings, favorites, the
    /// catalogue) is busy, and other Local work holds the check back (a
    /// running raster job refuses it at once instead; test below).
    #[test]
    fn import_checks_its_files_on_the_local_lane_and_only_records_on_user_data() {
        tauri::async_runtime::block_on(async {
            let root = crate::test_scratch::TestScratch::new("lidar-import-lanes");
            let library = LidarLibrary::open(&root).unwrap();
            let executor = one_at_a_time();
            let missing = vec![root.join("gone.tif")];

            let (release, blocker) = occupy(&executor, NativeOperationClass::UserData);
            let error =
                import_item_with_executor(&executor, library.clone(), selection(missing.clone()))
                    .await
                    .unwrap_err();
            assert!(error.contains("gone.tif cannot be found"), "{error}");
            release.send(()).unwrap();
            blocker.await.unwrap().unwrap();

            let (release, blocker) = occupy(&executor, NativeOperationClass::Local);
            let error = import_item_with_executor(&executor, library.clone(), selection(missing))
                .await
                .unwrap_err();
            assert!(error.contains("local operations are busy"), "{error}");
            release.send(()).unwrap();
            blocker.await.unwrap().unwrap();
            drop(library);
            std::fs::remove_dir_all(&root).unwrap();
        });
    }

    /// A raster job holds the library-wide heavy lease and a Local slot for
    /// minutes. Import and Retry would only fail behind it, so both are refused
    /// at once, before their header check waits for Local, and leave no row.
    #[test]
    fn import_and_retry_are_refused_at_once_while_a_raster_job_runs() {
        tauri::async_runtime::block_on(async {
            let root = crate::test_scratch::TestScratch::new("lidar-import-heavy-busy");
            let library = LidarLibrary::open(&root).unwrap();
            let (layer_id, job_id) = library
                .record_import_item(
                    "Delft",
                    RasterQuantity::GroundElevation,
                    None,
                    false,
                    &[root.join("gone.tif")],
                )
                .unwrap();
            library
                .catalogue()
                .unwrap()
                .execute(
                    "UPDATE lidar_import_jobs SET state = 'failed', message = 'earlier' WHERE id = ?1",
                    [&job_id],
                )
                .unwrap();
            // Local admits a second operation but runs one: the raster job's.
            let lane = NativeOperationClassLimits::new(8, 1);
            let executor = NativeOperationExecutor::new(NativeOperationLimits::new(
                lane,
                lane,
                NativeOperationClassLimits::new(2, 1),
                lane,
            ))
            .unwrap();
            let lease = library.hold_heavy_lease("imp-running");
            let (release, blocker) = occupy(&executor, NativeOperationClass::Local);

            let error = tokio::time::timeout(
                WAIT_TIMEOUT,
                import_item_with_executor(
                    &executor,
                    library.clone(),
                    selection(vec![root.join("gone.tif")]),
                ),
            )
            .await
            .expect("Import must not wait behind the running raster job")
            .unwrap_err();
            assert!(error.contains("another raster job is running"), "{error}");
            let error = tokio::time::timeout(
                WAIT_TIMEOUT,
                retry_import_with_executor(&executor, library.clone(), layer_id.clone()),
            )
            .await
            .expect("Retry must not wait behind the running raster job")
            .unwrap_err();
            assert!(error.contains("another raster job is running"), "{error}");
            {
                let connection = library.catalogue().unwrap();
                let count = |table: &str| -> i64 {
                    connection
                        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                            row.get(0)
                        })
                        .unwrap()
                };
                assert_eq!(count("lidar_source_layers"), 1, "Import recorded no item");
                assert_eq!(count("lidar_import_jobs"), 1, "neither recorded a job");
                let message: String = connection
                    .query_row(
                        "SELECT message FROM lidar_import_jobs WHERE id = ?1",
                        [&job_id],
                        |row| row.get(0),
                    )
                    .unwrap();
                assert_eq!(
                    message, "earlier",
                    "a busy library is not the item's failure"
                );
            }

            release.send(()).unwrap();
            blocker.await.unwrap().unwrap();
            drop(lease);
            drop(library);
            std::fs::remove_dir_all(&root).unwrap();
        });
    }

    /// Retry reads its saved selection and records on UserData, but checks
    /// the files' headers on the Local lane, behind other Local work.
    #[test]
    fn retry_checks_its_saved_files_on_the_local_lane() {
        tauri::async_runtime::block_on(async {
            let root = crate::test_scratch::TestScratch::new("lidar-retry-lanes");
            let library = LidarLibrary::open(&root).unwrap();
            let (layer_id, job_id) = library
                .record_import_item(
                    "Delft",
                    RasterQuantity::GroundElevation,
                    None,
                    false,
                    &[root.join("gone.tif")],
                )
                .unwrap();
            library
                .catalogue()
                .unwrap()
                .execute(
                    "UPDATE lidar_import_jobs SET state = 'failed' WHERE id = ?1",
                    [&job_id],
                )
                .unwrap();
            let executor = one_at_a_time();

            let (release, blocker) = occupy(&executor, NativeOperationClass::Local);
            let error = retry_import_with_executor(&executor, library.clone(), layer_id.clone())
                .await
                .unwrap_err();
            assert!(error.contains("local operations are busy"), "{error}");
            release.send(()).unwrap();
            blocker.await.unwrap().unwrap();

            let error = retry_import_with_executor(&executor, library.clone(), layer_id)
                .await
                .unwrap_err();
            assert!(error.contains("gone.tif cannot be found"), "{error}");
            drop(library);
            std::fs::remove_dir_all(&root).unwrap();
        });
    }
}
