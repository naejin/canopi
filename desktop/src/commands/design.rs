use common_types::design::{AutosaveEntry, CanopiFile, DesignSummary};
use tauri::AppHandle;

use crate::db::UserDb;

// ---------------------------------------------------------------------------
// IPC commands — NO file dialogs here. Dialogs run in the frontend (JS)
// to avoid GTK deadlock on Linux. Rust only handles file I/O.
// ---------------------------------------------------------------------------

/// Create a new empty design with 7 default layers.
#[tauri::command]
pub fn new_design() -> Result<CanopiFile, String> {
    crate::services::design_files::new_design()
}

/// Save a design to `path` (atomic write + .prev backup).
/// The frontend shows the save dialog and passes the chosen path.
#[tauri::command]
pub fn save_design(
    user_db: tauri::State<'_, UserDb>,
    path: String,
    content: CanopiFile,
) -> Result<String, String> {
    crate::services::design_files::save_design(&user_db, path, content)
}

/// Load a design from `path`.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub fn load_design(user_db: tauri::State<'_, UserDb>, path: String) -> Result<CanopiFile, String> {
    crate::services::design_files::load_design(&user_db, path)
}

/// Return up to 20 recently opened files, most recent first.
#[tauri::command]
pub fn get_recent_files(user_db: tauri::State<'_, UserDb>) -> Result<Vec<DesignSummary>, String> {
    crate::services::design_files::get_recent_files(&user_db)
}

/// Autosave `content` to the autosave directory.
#[tauri::command]
pub fn autosave_design(
    app: AppHandle,
    content: CanopiFile,
    path: Option<String>,
) -> Result<(), String> {
    crate::services::design_files::autosave_design(&app, content, path)
}

/// List all autosave files available for crash recovery.
#[tauri::command]
pub fn list_autosaves(app: AppHandle) -> Result<Vec<AutosaveEntry>, String> {
    crate::services::design_files::list_autosaves(&app)
}

/// Recover a design from an autosave file.
#[tauri::command]
pub fn recover_autosave(app: AppHandle, autosave_path: String) -> Result<CanopiFile, String> {
    crate::services::design_files::recover_autosave(&app, autosave_path)
}
