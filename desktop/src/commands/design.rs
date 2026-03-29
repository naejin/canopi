use common_types::design::{AutosaveEntry, CanopiFile, DesignSummary};
use tauri::AppHandle;

use crate::db::UserDb;
use crate::design::{autosave, format};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Record a file in recent_files, converting errors to warnings (non-fatal).
fn try_record_recent(user_db: &tauri::State<'_, UserDb>, path: &str, name: &str) {
    let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
    if let Err(e) = crate::db::recent_files::record_recent_file(&conn, path, name) {
        tracing::warn!("Failed to record recent file '{}': {e}", path);
    }
}

// ---------------------------------------------------------------------------
// IPC commands — NO file dialogs here. Dialogs run in the frontend (JS)
// to avoid GTK deadlock on Linux. Rust only handles file I/O.
// ---------------------------------------------------------------------------

/// Create a new empty design with 7 default layers.
#[tauri::command]
pub fn new_design() -> Result<CanopiFile, String> {
    Ok(format::create_default())
}

/// Save a design to `path` (atomic write + .prev backup).
/// The frontend shows the save dialog and passes the chosen path.
#[tauri::command]
pub fn save_design(
    user_db: tauri::State<'_, UserDb>,
    path: String,
    content: CanopiFile,
) -> Result<String, String> {
    let dest = std::path::PathBuf::from(&path);
    format::save_to_file(&dest, &content)?;
    try_record_recent(&user_db, &path, &content.name);
    tracing::info!("Design '{}' saved to {}", content.name, path);
    Ok(path)
}

/// Load a design from `path`.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub fn load_design(user_db: tauri::State<'_, UserDb>, path: String) -> Result<CanopiFile, String> {
    let dest = std::path::PathBuf::from(&path);
    let design = format::load_from_file(&dest)?;
    try_record_recent(&user_db, &path, &design.name);
    tracing::info!("Design '{}' loaded from {}", design.name, path);
    Ok(design)
}

/// Return up to 20 recently opened files, most recent first.
#[tauri::command]
pub fn get_recent_files(user_db: tauri::State<'_, UserDb>) -> Result<Vec<DesignSummary>, String> {
    let conn = user_db.0.lock().unwrap_or_else(|e| e.into_inner());
    crate::db::recent_files::get_recent_files(&conn, 20)
        .map_err(|e| format!("Failed to get recent files: {e}"))
}

/// Autosave `content` to the autosave directory.
#[tauri::command]
pub fn autosave_design(
    app: AppHandle,
    content: CanopiFile,
    path: Option<String>,
) -> Result<(), String> {
    autosave::autosave(&app, &content, path.as_deref())
}

/// List all autosave files available for crash recovery.
#[tauri::command]
pub fn list_autosaves(app: AppHandle) -> Result<Vec<AutosaveEntry>, String> {
    autosave::list_autosaves(&app)
}

/// Recover a design from an autosave file.
#[tauri::command]
pub fn recover_autosave(app: AppHandle, autosave_path: String) -> Result<CanopiFile, String> {
    autosave::recover_autosave(&app, &autosave_path)
}
