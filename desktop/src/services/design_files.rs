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
    // Design names and paths are user content; logs reach Diagnostic Bundles.
    tracing::info!("Design saved");
    Ok(path)
}

pub fn export_design_file(path: String, content: CanopiFile) -> Result<String, String> {
    let dest = std::path::PathBuf::from(&path);
    format::export_to_file(&dest, &content)?;
    tracing::info!("Design file exported");
    Ok(path)
}

pub fn load_design(user_db: &UserDb, path: String) -> Result<CanopiFile, String> {
    let dest = std::path::PathBuf::from(&path);
    let design = format::load_from_file(&dest).map_err(|error| error.to_string())?;
    try_record_recent(user_db, &path, &design.name);
    tracing::info!("Design loaded");
    Ok(design)
}

pub fn load_design_file(path: String) -> Result<CanopiFile, String> {
    let dest = std::path::PathBuf::from(&path);
    let design = format::load_from_file(&dest).map_err(|error| error.to_string())?;
    tracing::info!("Design file loaded for import");
    Ok(design)
}

pub fn get_recent_files(user_db: &UserDb) -> Result<Vec<DesignSummary>, String> {
    let recent = {
        let conn = user_db.acquire();
        crate::db::recent_files::get_recent_files(&conn, u32::MAX)
            .map_err(|e| format!("Failed to get recent files: {e}"))?
    };

    let filtered = partition_by_availability(
        recent,
        |file| &file.path,
        Some(RECENT_DESIGNS_LIMIT),
        design_path_availability,
    );
    for path in &filtered.missing_paths {
        let conn = user_db.acquire();
        if let Err(error) = crate::db::recent_files::remove_recent_file(&conn, path) {
            tracing::warn!("Failed to prune a missing Recent Design: {error}");
        }
    }
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
        tracing::warn!("Failed to record a Recent Design: {error}");
    }
}

/// Whether a remembered Design path (Recent Designs, Design Notebook) can be
/// shown, must be forgotten, or is temporarily out of reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesignPathAvailability {
    /// A regular file is at the path.
    Available,
    /// The parent directory is readable and the file is gone (deleted or
    /// renamed): the reference is safe to forget.
    Missing,
    /// The file cannot be checked right now, e.g. its drive is unplugged or
    /// unmounted, or permission is denied. The reference is kept and hidden.
    Unavailable,
}

pub(crate) fn design_path_availability(path: &Path) -> DesignPathAvailability {
    match path.metadata() {
        Ok(metadata) if metadata.is_file() => DesignPathAvailability::Available,
        Ok(_) => DesignPathAvailability::Missing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent_is_present = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .and_then(|parent| parent.metadata().ok())
                .is_some_and(|metadata| metadata.is_dir());
            if parent_is_present {
                DesignPathAvailability::Missing
            } else {
                DesignPathAvailability::Unavailable
            }
        }
        Err(error) => {
            tracing::warn!("A remembered Design could not be checked for availability: {error}");
            DesignPathAvailability::Unavailable
        }
    }
}

pub(crate) struct AvailabilityPartition<T> {
    pub(crate) visible: Vec<T>,
    pub(crate) missing_paths: Vec<String>,
}

/// Split remembered Design references into the ones to show (up to `limit`)
/// and the missing ones to forget. Unavailable references are neither shown
/// nor forgotten.
pub(crate) fn partition_by_availability<T>(
    entries: Vec<T>,
    path_of: impl Fn(&T) -> &str,
    limit: Option<usize>,
    mut availability: impl FnMut(&Path) -> DesignPathAvailability,
) -> AvailabilityPartition<T> {
    let mut visible = Vec::new();
    let mut missing_paths = Vec::new();
    for entry in entries {
        match availability(Path::new(path_of(&entry))) {
            DesignPathAvailability::Available => {
                if limit.is_none_or(|limit| visible.len() < limit) {
                    visible.push(entry);
                }
            }
            DesignPathAvailability::Missing => missing_paths.push(path_of(&entry).to_owned()),
            DesignPathAvailability::Unavailable => {}
        }
    }
    AvailabilityPartition {
        visible,
        missing_paths,
    }
}

/// Run `operation` and return the log lines it emitted on this thread,
/// formatted as the backend log file would receive them.
///
/// Uses one process-wide subscriber that writes into a per-thread buffer: a
/// scoped subscriber would race other test threads for the callsite interest
/// cache and could silently miss events.
#[cfg(test)]
pub(crate) fn capture_logs<R>(operation: impl FnOnce() -> R) -> (R, String) {
    use std::cell::RefCell;

    thread_local! {
        static CAPTURED: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
    }

    struct ThreadBuffer;
    impl std::io::Write for ThreadBuffer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            CAPTURED.with(|captured| {
                if let Some(buffer) = captured.borrow_mut().as_mut() {
                    buffer.extend_from_slice(bytes);
                }
            });
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    static INSTALL: std::sync::Once = std::sync::Once::new();
    INSTALL.call_once(|| {
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .with_max_level(tracing::Level::TRACE)
            .with_writer(|| ThreadBuffer)
            .finish();
        tracing::subscriber::set_global_default(subscriber)
            .expect("no other test installs a global log subscriber");
    });
    tracing::callsite::rebuild_interest_cache();

    CAPTURED.with(|captured| *captured.borrow_mut() = Some(Vec::new()));
    let result = operation();
    let logs = CAPTURED
        .with(|captured| captured.borrow_mut().take())
        .unwrap_or_default();
    (result, String::from_utf8_lossy(&logs).into_owned())
}

#[cfg(test)]
mod tests {
    use super::{
        DesignPathAvailability, design_path_availability, export_design_file, get_recent_files,
        load_design, load_design_file, partition_by_availability, save_design,
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
            crate::db::design_notebook::get_design_notebook_entries_with_sections(&conn).unwrap()
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
        let result = partition_by_availability(
            vec![
                design_summary("/available.canopi", "Available"),
                design_summary("/stale.canopi", "Stale"),
                design_summary("/unavailable.canopi", "Unavailable"),
            ],
            |file| &file.path,
            Some(20),
            |path| match path.to_string_lossy().as_ref() {
                "/available.canopi" => DesignPathAvailability::Available,
                "/stale.canopi" => DesignPathAvailability::Missing,
                "/unavailable.canopi" => DesignPathAvailability::Unavailable,
                other => panic!("unexpected path {other}"),
            },
        );

        assert_eq!(result.visible.len(), 1);
        assert_eq!(result.visible[0].path, "/available.canopi");
        assert_eq!(result.visible[0].name, "Available");
        assert_eq!(result.missing_paths, vec!["/stale.canopi"]);
    }

    #[test]
    fn availability_forgets_only_files_whose_folder_is_present() {
        let folder = temp_design_path("availability_folder").with_extension("");
        std::fs::create_dir_all(&folder).unwrap();
        let present = folder.join("present.canopi");
        std::fs::write(&present, "{}").unwrap();

        assert_eq!(
            design_path_availability(&present),
            DesignPathAvailability::Available
        );
        assert_eq!(
            design_path_availability(&folder.join("deleted.canopi")),
            DesignPathAvailability::Missing
        );
        assert_eq!(
            design_path_availability(&folder),
            DesignPathAvailability::Missing,
            "a folder where a Design used to be is not a Design"
        );
        // An unplugged or unmounted drive: the file's folder is gone too.
        assert_eq!(
            design_path_availability(&folder.join("unmounted-drive").join("garden.canopi")),
            DesignPathAvailability::Unavailable
        );

        let _ = std::fs::remove_dir_all(folder);
    }

    #[test]
    fn recent_designs_keep_entries_on_an_unavailable_drive() {
        let user_db = test_user_db();
        let unmounted = temp_design_path("unmounted_drive")
            .with_extension("")
            .join("garden.canopi");
        {
            let conn = user_db.acquire();
            crate::db::recent_files::record_recent_file(
                &conn,
                &unmounted.to_string_lossy(),
                "Garden on a USB drive",
            )
            .unwrap();
        }

        let recent = get_recent_files(&user_db).unwrap();
        let stored = {
            let conn = user_db.acquire();
            crate::db::recent_files::get_recent_files(&conn, 20).unwrap()
        };

        assert!(recent.is_empty(), "an unreachable Design is hidden");
        assert_eq!(stored.len(), 1, "an unreachable Design is not forgotten");
    }

    #[test]
    fn saving_and_loading_do_not_log_design_names_or_paths() {
        let user_db = test_user_db();
        let path = temp_design_path("private_log");
        let (_, logs) = super::capture_logs(|| {
            save_design(
                &user_db,
                path.to_string_lossy().into_owned(),
                test_design("Secret Orchard"),
            )
            .unwrap();
            load_design(&user_db, path.to_string_lossy().into_owned()).unwrap();
            export_design_file(
                path.to_string_lossy().into_owned(),
                test_design("Secret Orchard"),
            )
            .unwrap();
            load_design_file(path.to_string_lossy().into_owned()).unwrap();
        });

        assert!(logs.contains("Design saved"), "{logs}");
        assert!(!logs.contains("Secret Orchard"), "{logs}");
        assert!(!logs.contains(&*path.to_string_lossy()), "{logs}");

        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("canopi.prev"));
    }
}
