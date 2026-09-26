//! Tauri IPC commands for the LiDAR library.
//!
//! UI callers never orchestrate SQL, GDAL, masks, engine processes, cache
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
/// a busy Local class cannot make Cancel unresponsive.
#[tauri::command]
pub fn lidar_cancel_import(library: State<'_, LidarLibrary>, job_id: String) {
    library.cancel_job(&job_id);
}

/// Bounded cancellation signal delivery; must bypass queued executor work so
/// a busy Local class cannot make Cancel unresponsive.
#[tauri::command]
pub fn lidar_cancel_analysis_job(library: State<'_, LidarLibrary>, job_id: String) {
    library.cancel_job(&job_id);
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
/// can only ever cancel its own lookup. The read runs GDAL against raster
/// files, so it belongs to the `Local` class, never to `UserData`.
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
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar import item",
            move || {
                library.import_item(
                    &name,
                    quantity,
                    unit_label.as_deref(),
                    unit_unknown.unwrap_or(false),
                    paths.into_iter().map(std::path::PathBuf::from).collect(),
                )
            },
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
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar retry import",
            move || library.retry_import(&layer_id),
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
