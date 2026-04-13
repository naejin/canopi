use common_types::design::{AutosaveEntry, CanopiFile, DesignSummary};

use crate::db::{self, UserDb};
use crate::design::{autosave, format};

pub fn new_design() -> Result<CanopiFile, String> {
    Ok(format::create_default())
}

pub fn save_design(user_db: &UserDb, path: String, content: CanopiFile) -> Result<String, String> {
    let dest = std::path::PathBuf::from(&path);
    format::save_to_file(&dest, &content)?;
    try_record_recent(user_db, &path, &content.name);
    tracing::info!("Design '{}' saved to {}", content.name, path);
    Ok(path)
}

pub fn load_design(user_db: &UserDb, path: String) -> Result<CanopiFile, String> {
    let dest = std::path::PathBuf::from(&path);
    let design = format::load_from_file(&dest)?;
    try_record_recent(user_db, &path, &design.name);
    tracing::info!("Design '{}' loaded from {}", design.name, path);
    Ok(design)
}

pub fn get_recent_files(user_db: &UserDb) -> Result<Vec<DesignSummary>, String> {
    let conn = db::acquire(&user_db.0, "UserDb");
    crate::db::recent_files::get_recent_files(&conn, 20)
        .map_err(|e| format!("Failed to get recent files: {e}"))
}

pub fn autosave_design(
    app: &tauri::AppHandle,
    content: CanopiFile,
    path: Option<String>,
) -> Result<(), String> {
    autosave::autosave(app, &content, path.as_deref())
}

pub fn list_autosaves(app: &tauri::AppHandle) -> Result<Vec<AutosaveEntry>, String> {
    autosave::list_autosaves(app)
}

pub fn recover_autosave(app: &tauri::AppHandle, autosave_path: String) -> Result<CanopiFile, String> {
    autosave::recover_autosave(app, &autosave_path)
}

fn try_record_recent(user_db: &UserDb, path: &str, name: &str) {
    let conn = db::acquire(&user_db.0, "UserDb");
    if let Err(error) = crate::db::recent_files::record_recent_file(&conn, path, name) {
        tracing::warn!("Failed to record recent file '{}': {error}", path);
    }
}

#[cfg(test)]
mod tests {
    use super::{get_recent_files, load_design, save_design};
    use crate::db::UserDb;
    use common_types::design::CanopiFile;
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::sync::Mutex;

    fn test_user_db() -> UserDb {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::user_db::init(&conn).unwrap();
        UserDb(Mutex::new(conn))
    }

    fn test_design(name: &str) -> CanopiFile {
        let mut design = crate::design::format::create_default();
        design.name = name.to_owned();
        design
    }

    fn temp_design_path(name: &str) -> PathBuf {
        let unique = format!(
            "canopi_design_service_{}_{}_{}.canopi",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        );
        std::env::temp_dir().join(unique)
    }

    #[test]
    fn save_and_load_design_round_trip_records_recent_file() {
        let user_db = test_user_db();
        let design = test_design("Service Demo");
        let path = temp_design_path("round_trip");

        let saved_path = save_design(&user_db, path.to_string_lossy().into_owned(), design.clone()).unwrap();
        let loaded = load_design(&user_db, saved_path.clone()).unwrap();
        let recent = get_recent_files(&user_db).unwrap();

        assert_eq!(loaded.name, "Service Demo");
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].path, saved_path);
        assert_eq!(recent[0].name, "Service Demo");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_missing_design_returns_error() {
        let user_db = test_user_db();
        let path = temp_design_path("missing");

        let result = load_design(&user_db, path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }
}
