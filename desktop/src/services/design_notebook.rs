use common_types::design::DesignSummary;
use std::path::Path;

use crate::db::{self, UserDb};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NotebookPathStatus {
    Available,
    Stale,
    Unavailable,
}

#[derive(Debug)]
struct NotebookFilterResult {
    visible: Vec<DesignSummary>,
    stale_paths: Vec<String>,
}

pub fn get_design_notebook_entries(user_db: &UserDb) -> Result<Vec<DesignSummary>, String> {
    let entries = {
        let conn = db::acquire(&user_db.0, "UserDb");
        crate::db::design_notebook::get_design_notebook_entries(&conn)
            .map_err(|e| format!("Failed to get Design Notebook entries: {e}"))?
    };

    let filtered = filter_design_notebook_entries(entries, notebook_path_status);
    prune_stale_design_notebook_entries(user_db, &filtered.stale_paths);
    Ok(filtered.visible)
}

fn filter_design_notebook_entries(
    entries: Vec<DesignSummary>,
    mut status_for_path: impl FnMut(&Path) -> NotebookPathStatus,
) -> NotebookFilterResult {
    let mut visible = Vec::new();
    let mut stale_paths = Vec::new();

    for entry in entries {
        let path = entry.path.clone();
        match status_for_path(Path::new(&path)) {
            NotebookPathStatus::Available => visible.push(entry),
            NotebookPathStatus::Stale => stale_paths.push(path),
            NotebookPathStatus::Unavailable => {}
        }
    }

    NotebookFilterResult {
        visible,
        stale_paths,
    }
}

fn notebook_path_status(path: &Path) -> NotebookPathStatus {
    match path.metadata() {
        Ok(metadata) if metadata.is_file() => NotebookPathStatus::Available,
        Ok(_) => NotebookPathStatus::Stale,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => NotebookPathStatus::Stale,
        Err(error) => {
            tracing::warn!(
                "Design Notebook entry '{}' could not be checked for availability: {error}",
                path.display()
            );
            NotebookPathStatus::Unavailable
        }
    }
}

fn prune_stale_design_notebook_entries(user_db: &UserDb, paths: &[String]) {
    if paths.is_empty() {
        return;
    }

    let conn = db::acquire(&user_db.0, "UserDb");
    for path in paths {
        if let Err(error) = crate::db::design_notebook::remove_design_reference(&conn, path) {
            tracing::warn!(
                "Failed to prune stale Design Notebook entry '{}': {error}",
                path
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NotebookPathStatus, filter_design_notebook_entries};
    use crate::db::{self, UserDb};
    use common_types::design::DesignSummary;
    use rusqlite::Connection;
    use std::path::PathBuf;
    use std::sync::Mutex;

    fn test_user_db() -> UserDb {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::user_db::init(&conn).unwrap();
        UserDb(Mutex::new(conn))
    }

    fn temp_design_path(name: &str) -> PathBuf {
        let unique = format!(
            "canopi_notebook_service_{}_{}_{}.canopi",
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
    fn notebook_listing_prunes_missing_paths() {
        let user_db = test_user_db();
        let existing_path = temp_design_path("existing");
        let missing_path = temp_design_path("missing");
        std::fs::write(&existing_path, "{}").unwrap();
        {
            let conn = db::acquire(&user_db.0, "UserDb");
            crate::db::design_notebook::record_design_reference(
                &conn,
                &existing_path.to_string_lossy(),
                "Existing Design",
                3,
            )
            .unwrap();
            crate::db::design_notebook::record_design_reference(
                &conn,
                &missing_path.to_string_lossy(),
                "Missing Design",
                1,
            )
            .unwrap();
        }

        let entries = super::get_design_notebook_entries(&user_db).unwrap();
        let stored = {
            let conn = db::acquire(&user_db.0, "UserDb");
            crate::db::design_notebook::get_design_notebook_entries(&conn).unwrap()
        };

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, existing_path.to_string_lossy());
        assert!(
            stored
                .iter()
                .all(|entry| entry.path != missing_path.to_string_lossy()),
            "missing Design Notebook entry should be pruned"
        );

        let _ = std::fs::remove_file(existing_path);
    }

    #[test]
    fn notebook_filter_hides_unavailable_paths_without_pruning() {
        let result = filter_design_notebook_entries(
            vec![
                design_summary("/available.canopi", "Available"),
                design_summary("/stale.canopi", "Stale"),
                design_summary("/unavailable.canopi", "Unavailable"),
            ],
            |path| match path.to_string_lossy().as_ref() {
                "/available.canopi" => NotebookPathStatus::Available,
                "/stale.canopi" => NotebookPathStatus::Stale,
                "/unavailable.canopi" => NotebookPathStatus::Unavailable,
                other => panic!("unexpected path {other}"),
            },
        );

        assert_eq!(result.visible.len(), 1);
        assert_eq!(result.visible[0].path, "/available.canopi");
        assert_eq!(result.stale_paths, vec!["/stale.canopi"]);
    }
}
