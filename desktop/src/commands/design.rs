use common_types::design::{AutosaveEntry, CanopiFile, DesignSummary};
use tauri::{AppHandle, State};

use crate::{
    db::UserDb,
    native_operation::{NativeOperationClass, NativeOperationExecutor},
};

// ---------------------------------------------------------------------------
// IPC commands — NO file dialogs here. Dialogs run in the frontend (JS)
// to avoid GTK deadlock on Linux. Rust only handles file I/O.
// ---------------------------------------------------------------------------

/// Create a new Design from the canonical shared defaults.
#[tauri::command]
pub fn new_design() -> Result<CanopiFile, String> {
    crate::services::design_files::new_design()
}

/// Save a design to `path` (atomic write + .prev backup).
/// The frontend shows the save dialog and passes the chosen path.
#[tauri::command]
pub async fn save_design(
    executor: State<'_, NativeOperationExecutor>,
    user_db: State<'_, UserDb>,
    path: String,
    content: CanopiFile,
) -> Result<String, String> {
    let user_db = user_db.inner().clone();
    executor
        .run(NativeOperationClass::Local, "design save", move || {
            crate::services::design_files::save_design(&user_db, path, content)
        })
        .await
}

/// Load a design from `path`.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub async fn load_design(
    executor: State<'_, NativeOperationExecutor>,
    user_db: State<'_, UserDb>,
    path: String,
) -> Result<CanopiFile, String> {
    let user_db = user_db.inner().clone();
    executor
        .run(NativeOperationClass::Local, "design load", move || {
            crate::services::design_files::load_design(&user_db, path)
        })
        .await
}

/// Return up to 20 recently opened files, most recent first.
#[tauri::command]
pub async fn get_recent_files(
    executor: State<'_, NativeOperationExecutor>,
    user_db: State<'_, UserDb>,
) -> Result<Vec<DesignSummary>, String> {
    let user_db = user_db.inner().clone();
    executor
        .run(
            NativeOperationClass::UserData,
            "recent designs read",
            move || crate::services::design_files::get_recent_files(&user_db),
        )
        .await
}

/// Autosave `content` to the autosave directory.
#[tauri::command]
pub async fn autosave_design(
    executor: State<'_, NativeOperationExecutor>,
    app: AppHandle,
    content: CanopiFile,
    path: Option<String>,
) -> Result<(), String> {
    executor
        .run(NativeOperationClass::Local, "design autosave", move || {
            crate::services::design_files::autosave_design(&app, content, path)
        })
        .await
}

/// List all autosave files available for crash recovery.
#[tauri::command]
pub async fn list_autosaves(
    executor: State<'_, NativeOperationExecutor>,
    app: AppHandle,
) -> Result<Vec<AutosaveEntry>, String> {
    executor
        .run(NativeOperationClass::Local, "autosave listing", move || {
            crate::services::design_files::list_autosaves(&app)
        })
        .await
}

/// Recover a design from an autosave file.
#[tauri::command]
pub async fn recover_autosave(
    executor: State<'_, NativeOperationExecutor>,
    app: AppHandle,
    autosave_path: String,
) -> Result<CanopiFile, String> {
    executor
        .run(
            NativeOperationClass::Local,
            "autosave recovery",
            move || crate::services::design_files::recover_autosave(&app, autosave_path),
        )
        .await
}
