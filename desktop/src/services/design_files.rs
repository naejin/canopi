use common_types::design::{AutosaveEntry, CanopiFile, DesignSummary};
use std::path::Path;

use crate::db::UserDb;
use crate::design::{autosave, format};

const RECENT_DESIGNS_LIMIT: usize = 20;

pub fn new_design() -> Result<CanopiFile, String> {
    Ok(format::create_new_design("Untitled", now_iso8601()))
}

fn now_iso8601() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    crate::design::unix_to_iso8601(seconds)
}

pub fn save_design(user_db: &UserDb, path: String, content: CanopiFile) -> Result<String, String> {
    let dest = std::path::PathBuf::from(&path);
    format::save_to_file(&dest, &content)?;
    try_record_recent(user_db, &path, &content.name);
    tracing::info!("Design '{}' saved to {}", content.name, path);
    Ok(path)
}

pub fn export_design_file(path: String, content: CanopiFile) -> Result<String, String> {
    let dest = std::path::PathBuf::from(&path);
    format::save_to_file(&dest, &content)?;
    tracing::info!("Design '{}' exported to {}", content.name, path);
    Ok(path)
}

pub fn load_design(user_db: &UserDb, path: String) -> Result<CanopiFile, String> {
    let dest = std::path::PathBuf::from(&path);
    let design = format::load_from_file(&dest)?;
    try_record_recent(user_db, &path, &design.name);
    tracing::info!("Design '{}' loaded from {}", design.name, path);
    Ok(design)
}

pub fn load_design_file(path: String) -> Result<CanopiFile, String> {
    let dest = std::path::PathBuf::from(&path);
    let design = format::load_from_file(&dest)?;
    tracing::info!("Design '{}' loaded for import from {}", design.name, path);
    Ok(design)
}

pub fn get_recent_files(user_db: &UserDb) -> Result<Vec<DesignSummary>, String> {
    let recent = {
        let conn = user_db.acquire();
        crate::db::recent_files::get_recent_files(&conn, u32::MAX)
            .map_err(|e| format!("Failed to get recent files: {e}"))?
    };

    let filtered = filter_recent_designs(recent, RECENT_DESIGNS_LIMIT, recent_design_path_status);
    prune_stale_recent_designs(user_db, &filtered.stale_paths);
    Ok(filtered.visible)
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

pub fn recover_autosave(
    app: &tauri::AppHandle,
    autosave_path: String,
) -> Result<CanopiFile, String> {
    autosave::recover_autosave(app, &autosave_path)
}

fn try_record_recent(user_db: &UserDb, path: &str, name: &str) {
    let conn = user_db.acquire();
    if let Err(error) = crate::db::recent_files::record_recent_file(&conn, path, name) {
        tracing::warn!("Failed to record recent file '{}': {error}", path);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecentDesignPathStatus {
    Available,
    Stale,
    Unavailable,
}

#[derive(Debug, Clone)]
struct RecentDesignFilterResult {
    visible: Vec<DesignSummary>,
    stale_paths: Vec<String>,
}

fn filter_recent_designs(
    recent: Vec<DesignSummary>,
    limit: usize,
    mut status_for_path: impl FnMut(&Path) -> RecentDesignPathStatus,
) -> RecentDesignFilterResult {
    let mut visible = Vec::new();
    let mut stale_paths = Vec::new();

    for file in recent {
        let path = file.path.clone();
        match status_for_path(Path::new(&path)) {
            RecentDesignPathStatus::Available => {
                if visible.len() < limit {
                    visible.push(file);
                }
            }
            RecentDesignPathStatus::Stale => stale_paths.push(path),
            RecentDesignPathStatus::Unavailable => {}
        }
    }

    RecentDesignFilterResult {
        visible,
        stale_paths,
    }
}

fn recent_design_path_status(path: &Path) -> RecentDesignPathStatus {
    match path.metadata() {
        Ok(metadata) if metadata.is_file() => RecentDesignPathStatus::Available,
        Ok(_) => RecentDesignPathStatus::Stale,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => RecentDesignPathStatus::Stale,
        Err(error) => {
            tracing::warn!(
                "Recent Design '{}' could not be checked for availability: {error}",
                path.display()
            );
            RecentDesignPathStatus::Unavailable
        }
    }
}

fn prune_stale_recent_designs(user_db: &UserDb, paths: &[String]) {
    if paths.is_empty() {
        return;
    }

    let conn = user_db.acquire();
    for path in paths {
        if let Err(error) = crate::db::recent_files::remove_recent_file(&conn, path) {
            tracing::warn!("Failed to prune stale Recent Design '{}': {error}", path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        RecentDesignPathStatus, export_design_file, filter_recent_designs, get_recent_files,
        load_design, load_design_file, save_design,
    };
    use crate::db::UserDb;
    use common_types::design::{CanopiFile, DesignSummary};
    use rusqlite::Connection;
    use std::path::PathBuf;

    fn test_user_db() -> UserDb {
        let conn = Connection::open_in_memory().unwrap();
        UserDb::initialize(conn).unwrap()
    }

    fn test_design(name: &str) -> CanopiFile {
        crate::design::format::create_new_design(name, "2026-07-02T00:00:00Z")
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

    fn design_summary(path: &str, name: &str) -> DesignSummary {
        DesignSummary {
            path: path.to_owned(),
            name: name.to_owned(),
            updated_at: "2026-07-02T00:00:00Z".to_owned(),
            plant_count: 0,
        }
    }

    #[test]
    fn save_and_load_design_round_trip_records_recent_file() {
        let user_db = test_user_db();
        let design = test_design("Service Demo");
        let path = temp_design_path("round_trip");

        let saved_path = save_design(
            &user_db,
            path.to_string_lossy().into_owned(),
            design.clone(),
        )
        .unwrap();
        let loaded = load_design(&user_db, saved_path.clone()).unwrap();
        let recent = get_recent_files(&user_db).unwrap();

        assert_eq!(loaded.name, "Service Demo");
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].path, saved_path);
        assert_eq!(recent[0].name, "Service Demo");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn save_and_load_design_do_not_record_design_notebook_entry() {
        let user_db = test_user_db();
        let design = test_design("Notebook Demo");
        let path = temp_design_path("notebook_round_trip");

        let saved_path = save_design(
            &user_db,
            path.to_string_lossy().into_owned(),
            design.clone(),
        )
        .unwrap();
        let _ = load_design(&user_db, saved_path.clone()).unwrap();
        let notebook_entries = {
            let conn = user_db.acquire();
            crate::db::design_notebook::get_design_notebook_entries(&conn).unwrap()
        };

        assert!(
            notebook_entries.is_empty(),
            "save/load should not recreate a user-removed Design Notebook reference"
        );

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn export_design_file_round_trips_without_recording_recent_file() {
        let user_db = test_user_db();
        let design = test_design("Stamp Export");
        let path = temp_design_path("stamp_export");

        let saved_path =
            export_design_file(path.to_string_lossy().into_owned(), design.clone()).unwrap();
        let loaded = crate::design::format::load_from_file(&path).unwrap();
        let recent = get_recent_files(&user_db).unwrap();

        assert_eq!(saved_path, path.to_string_lossy());
        assert_eq!(loaded.name, "Stamp Export");
        assert!(recent.is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_design_file_round_trips_without_recording_recent_file() {
        let user_db = test_user_db();
        let design = test_design("Stamp Import");
        let path = temp_design_path("stamp_import");

        export_design_file(path.to_string_lossy().into_owned(), design).unwrap();
        let loaded = load_design_file(path.to_string_lossy().into_owned()).unwrap();
        let recent = get_recent_files(&user_db).unwrap();

        assert_eq!(loaded.name, "Stamp Import");
        assert!(recent.is_empty());

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn load_missing_design_returns_error() {
        let user_db = test_user_db();
        let path = temp_design_path("missing");

        let result = load_design(&user_db, path.to_string_lossy().into_owned());

        assert!(result.is_err());
    }

    #[test]
    fn recent_designs_prune_missing_paths() {
        let user_db = test_user_db();
        let existing_path = temp_design_path("existing_recent");
        let missing_path = temp_design_path("missing_recent");

        save_design(
            &user_db,
            existing_path.to_string_lossy().into_owned(),
            test_design("Existing Design"),
        )
        .unwrap();
        {
            let conn = user_db.acquire();
            crate::db::recent_files::record_recent_file(
                &conn,
                &missing_path.to_string_lossy(),
                "Missing Design",
            )
            .unwrap();
        }

        let recent = get_recent_files(&user_db).unwrap();
        let stored = {
            let conn = user_db.acquire();
            crate::db::recent_files::get_recent_files(&conn, 20).unwrap()
        };

        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].path, existing_path.to_string_lossy());
        assert!(
            stored
                .iter()
                .all(|file| file.path != missing_path.to_string_lossy()),
            "missing Recent Design should be removed from persisted recent designs"
        );

        let _ = std::fs::remove_file(existing_path);
    }

    #[test]
    fn recent_design_filter_hides_unavailable_paths_without_pruning() {
        let result = filter_recent_designs(
            vec![
                design_summary("/available.canopi", "Available"),
                design_summary("/stale.canopi", "Stale"),
                design_summary("/unavailable.canopi", "Unavailable"),
            ],
            20,
            |path| match path.to_string_lossy().as_ref() {
                "/available.canopi" => RecentDesignPathStatus::Available,
                "/stale.canopi" => RecentDesignPathStatus::Stale,
                "/unavailable.canopi" => RecentDesignPathStatus::Unavailable,
                other => panic!("unexpected path {other}"),
            },
        );

        assert_eq!(result.visible.len(), 1);
        assert_eq!(result.visible[0].path, "/available.canopi");
        assert_eq!(result.visible[0].name, "Available");
        assert_eq!(result.stale_paths, vec!["/stale.canopi"]);
    }
}
