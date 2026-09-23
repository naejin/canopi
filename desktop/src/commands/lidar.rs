//! Tauri IPC commands for the LiDAR library.
//!
//! UI callers never orchestrate SQL, GDAL, masks, engine processes, cache
//! publication or recovery: every capability here returns library identities,
//! receipts or snapshots. All heavy work runs through the managed Native
//! Operation Executor.

use crate::services::lidar::import;
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
    // `unit_label` and `unit_unknown` declare the unit of an "other continuous"
    // dataset. Elevation and height are always metres and refuse both.
    unit_label: Option<String>,
    unit_unknown: Option<bool>,
) -> Result<String, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar create layer",
            move || {
                library.create_layer(
                    &name,
                    measurement_kind,
                    unit_label.as_deref(),
                    unit_unknown.unwrap_or(false),
                )
            },
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
) -> Result<common_types::lidar::LidarImportDecisionPreview, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar import decision preview",
            move || library.preview_import_decision(&job_id),
        )
        .await
}

/// Bounded cancellation signal delivery; must bypass queued executor work so
/// a busy Local class cannot make Cancel unresponsive.
/// Render one bounded display tile from an immutable generation.
///
/// Returns encoded PNG bytes (never base64) or an explicit failure, so the map
/// protocol can mark a tile unavailable instead of drawing it as empty. Every
/// value in the request is an identifier, a style name or an integer tile
/// coordinate: no path, CRS string or engine argument crosses this boundary.
// The command boundary takes one flat argument list so the generated contract
// stays a plain set of scalars.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn lidar_raster_tile(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    request_id: String,
    entity_kind: String,
    entity_id: String,
    generation_id: String,
    style: String,
    z: u32,
    x: u32,
    y: u32,
) -> Result<tauri::ipc::Response, String> {
    let library = library.inner().clone();
    let mut ticket = library.admit_display_request(&request_id)?;
    // Wait for a slot without holding an executor permit, so a queued display
    // read can never sit in front of a heavy raster job.
    loop {
        if ticket.try_activate()? {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    }
    let cancel = ticket.cancel_flag();
    let bytes = executor
        .run(
            crate::native_operation::NativeOperationClass::Local,
            "lidar raster tile",
            move || {
                let _ticket = ticket;
                library.render_tile(
                    &entity_kind,
                    &entity_id,
                    &generation_id,
                    &style,
                    z,
                    x,
                    y,
                    &cancel,
                )
            },
        )
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Stop waiting for, or stop rendering, one display tile.
///
/// Synchronous by design: it only signals bounded in-memory state, and the
/// renderer checks it between bounded reads.
#[tauri::command]
pub fn lidar_cancel_raster_tile(library: State<'_, LidarLibrary>, request_id: String) {
    library.cancel_display_request(&request_id);
}

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

/// One bounded page of a layer's publication history.
#[tauri::command]
pub async fn lidar_layer_history(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    cursor: Option<String>,
) -> Result<common_types::lidar::LidarLayerHistoryPage, String> {
    let library = library.inner().clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar layer history",
            move || library.layer_history_page(&layer_id, cursor.as_deref()),
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

/// Admit one ordered-member edit before any work is created.
async fn admit_layer_edit(
    library: &LidarLibrary,
    executor: &NativeOperationExecutor,
    layer_id: String,
    member_id: Option<String>,
    expected_head: Option<String>,
) -> Result<(), String> {
    let library = library.clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar layer edit admission",
            move || {
                library.validate_layer_edit(
                    &layer_id,
                    member_id.as_deref(),
                    expected_head.as_deref(),
                )
            },
        )
        .await
}

/// Move one source one position in the layer's priority list.
#[tauri::command]
pub async fn lidar_move_layer_source(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    member_id: String,
    towards_top: bool,
    expected_head: Option<String>,
) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
    admit_layer_edit(
        library.inner(),
        executor.inner(),
        layer_id.clone(),
        Some(member_id.clone()),
        expected_head.clone(),
    )
    .await?;
    library
        .inner()
        .apply_move(&layer_id, &member_id, towards_top, expected_head)
        .await
}

/// Detach one source from the layer's current composition.
#[tauri::command]
pub async fn lidar_remove_layer_source(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    member_id: String,
    expected_head: Option<String>,
) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
    admit_layer_edit(
        library.inner(),
        executor.inner(),
        layer_id.clone(),
        Some(member_id.clone()),
        expected_head.clone(),
    )
    .await?;
    library
        .inner()
        .apply_remove(&layer_id, &member_id, expected_head)
        .await
}

/// Undo the layer's last change by publishing the preceding snapshot.
#[tauri::command]
pub async fn lidar_undo_layer_change(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    expected_head: Option<String>,
) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
    admit_layer_edit(
        library.inner(),
        executor.inner(),
        layer_id.clone(),
        None,
        expected_head.clone(),
    )
    .await?;
    library.inner().apply_undo(&layer_id, expected_head).await
}

/// Publish one older version as the layer's new head.
#[tauri::command]
pub async fn lidar_restore_layer_version(
    library: State<'_, LidarLibrary>,
    executor: State<'_, NativeOperationExecutor>,
    layer_id: String,
    version_id: String,
    expected_head: Option<String>,
) -> Result<common_types::lidar::LidarLayerEditOutcome, String> {
    let library_for_check = library.inner().clone();
    let layer_for_check = layer_id.clone();
    let version_for_check = version_id.clone();
    executor
        .run(
            crate::native_operation::NativeOperationClass::UserData,
            "lidar version admission",
            move || {
                let owner = import::version_layer(&library_for_check, &version_for_check)?;
                if owner != layer_for_check {
                    return Err(format!(
                        "version {version_for_check} belongs to another layer"
                    ));
                }
                Ok(())
            },
        )
        .await?;
    library
        .inner()
        .apply_restore(&layer_id, &version_id, expected_head)
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
