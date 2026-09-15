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
pub async fn lidar_create_layer(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    name: String,
    measurement_kind: common_types::lidar::LidarMeasurementKind,
) -> Result<String, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar create layer",
            move || library.create_layer(&name, measurement_kind),
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
pub async fn lidar_stage_import(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    paths: Vec<String>,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err("no files were selected for import".to_string());
    }
    let library_for_record = library.inner().clone();
    let layer_id_for_record = layer_id.clone();
    let job_id = executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar import admission",
            move || library_for_record.record_import_job(&layer_id_for_record),
        )
        .await?;
    library.inner().begin_staging(
        &job_id,
        &layer_id,
        paths.into_iter().map(std::path::PathBuf::from).collect(),
    )?;
    Ok(job_id)
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

#[tauri::command]
pub async fn lidar_apply_import(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    job_id: String,
    add_uncovered: bool,
    replace_overlap: bool,
) -> Result<(), String> {
    let library_for_prepare = library.inner().clone();
    let job_id_for_prepare = job_id.clone();
    let staging = executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar import review commit",
            move || library_for_prepare.prepare_apply(&job_id_for_prepare),
        )
        .await?;
    library
        .inner()
        .begin_apply(staging, add_uncovered, replace_overlap)
}

#[tauri::command]
pub async fn lidar_preview_import_decision(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    job_id: String,
    add_uncovered: bool,
    replace_overlap: bool,
) -> Result<common_types::lidar::LidarImportDecisionPreview, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar import decision preview",
            move || library.preview_import_decision(&job_id, add_uncovered, replace_overlap),
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
) -> Result<common_types::lidar::LidarAnalysisReceipt, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar create analysis",
            move || library.create_analysis(&layer_id, kind, parameters),
        )
        .await
}

#[tauri::command]
pub async fn lidar_layer_history(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
) -> Result<Vec<common_types::lidar::LidarGenerationHistoryEntry>, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar layer history",
            move || library.layer_history(&layer_id),
        )
        .await
}

#[tauri::command]
pub async fn lidar_undo_import(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    job_id: String,
) -> Result<(), String> {
    let library_for_validate = library.inner().clone();
    let job_id_for_validate = job_id.clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar undo admission",
            move || library_for_validate.validate_undo(&job_id_for_validate),
        )
        .await?;
    library.inner().begin_undo(&job_id)
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
