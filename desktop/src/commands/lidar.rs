//! Tauri IPC commands for the LiDAR library.
//!
//! UI callers never orchestrate SQL, GDAL, masks, engine processes, cache
//! publication or recovery: every capability here returns library identities,
//! receipts or snapshots. All heavy work runs through the managed Native
//! Operation Executor.

use crate::{native_operation::NativeOperationExecutor, services::lidar::LidarLibrary};
use common_types::lidar::{
    LidarAnalysisKind, LidarAnalysisParameters, LidarEngineStatus, LidarLibrarySnapshot,
};
use tauri::State;

#[tauri::command]
pub async fn lidar_engine_status(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
) -> Result<LidarEngineStatus, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar engine status",
            move || Ok(library.engine_status()),
        )
        .await
}

#[tauri::command]
pub async fn lidar_list_library(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
) -> Result<LidarLibrarySnapshot, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar library snapshot",
            move || library.library_snapshot(),
        )
        .await
}

#[tauri::command]
pub async fn lidar_rename_layer(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    name: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar rename layer",
            move || library.rename_layer(&layer_id, &name),
        )
        .await
}

#[tauri::command]
pub async fn lidar_delete_layer_impact(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
) -> Result<common_types::lidar::LidarDeleteImpact, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar delete impact",
            move || library.delete_impact(&layer_id),
        )
        .await
}

#[tauri::command]
pub async fn lidar_delete_layer(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar delete layer",
            move || library.delete_layer(&layer_id),
        )
        .await
}

#[tauri::command]
pub async fn lidar_get_import_job(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    job_id: String,
) -> Result<Option<common_types::lidar::LidarImportJob>, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar import job status",
            move || library.get_import_job(&job_id),
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

#[tauri::command]
pub async fn lidar_create_analysis(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    kind: LidarAnalysisKind,
    parameters: LidarAnalysisParameters,
    // `result_name`: the name to publish the result under. Omitted or blank
    // publishes an unnamed result, which the UI shows by kind rather than
    // inventing a name.
    result_name: Option<String>,
) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar create analysis",
            move || library.create_analysis(&layer_id, kind, parameters, result_name),
        )
        .await
}

/// Retry one existing analysis definition against its expected source head.
#[tauri::command]
pub async fn lidar_retry_analysis(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    definition_id: String,
    expected_source_generation_id: String,
) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar retry analysis",
            move || library.retry_analysis(&definition_id, &expected_source_generation_id),
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

#[tauri::command]
pub async fn lidar_get_analysis_job_status(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    job_id: String,
) -> Result<Option<common_types::lidar::LidarAnalysisJobStatus>, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar analysis job status",
            move || library.analysis_job_status(&job_id),
        )
        .await
}

#[tauri::command]
pub async fn lidar_delete_analysis(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    definition_id: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar delete analysis",
            move || library.delete_analysis(&definition_id),
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
/// can only ever cancel its own lookup.
#[tauri::command]
pub async fn lidar_sample_pixel(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    request: common_types::lidar::LidarSampleRequest,
) -> Result<common_types::lidar::LidarSampleOutcome, String> {
    let library = library.inner().clone();
    let mut ticket = library.admit_sample_request(&request.request_id)?;
    if let Some(slot) = ticket.as_mut() {
        // Wait for a slot without holding an executor permit, so an inspection
        // read can never sit in front of a heavy raster job.
        loop {
            if slot.try_activate()? {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        }
    }
    let cancel = match ticket.as_ref() {
        Some(slot) => slot.cancel_flag(),
        // No admission: no one can signal this read, and that is what the flag
        // then says. It is never a stand-in for a cancellation that exists.
        None => std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
    };
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
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
    if request_id.is_empty() {
        return;
    }
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
    measurement_kind: common_types::lidar::LidarMeasurementKind,
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
                    measurement_kind,
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

/// Rename one saved result; metadata only.
#[tauri::command]
pub async fn lidar_rename_analysis(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    definition_id: String,
    name: String,
) -> Result<(), String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar rename analysis",
            move || library.rename_analysis(&definition_id, &name),
        )
        .await
}
