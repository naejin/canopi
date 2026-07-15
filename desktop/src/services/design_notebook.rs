use common_types::design::{
    CanopiFile, DesignNotebookEntry, DesignNotebookSection, DesignNotebookSnapshot, DesignSummary,
};
use std::path::Path;

use crate::db::UserDb;

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

#[derive(Debug)]
struct NotebookSectionedFilterResult {
    visible: Vec<DesignNotebookEntry>,
    stale_paths: Vec<String>,
}

pub fn get_design_notebook_entries(user_db: &UserDb) -> Result<Vec<DesignSummary>, String> {
    let entries = {
        let conn = user_db.acquire();
        crate::db::design_notebook::get_design_notebook_entries(&conn)
            .map_err(|e| format!("Failed to get Design Notebook entries: {e}"))?
    };

    let filtered = filter_design_notebook_entries(entries, notebook_path_status);
    prune_stale_design_notebook_entries(user_db, &filtered.stale_paths);
    Ok(filtered.visible)
}

pub fn get_design_notebook(user_db: &UserDb) -> Result<DesignNotebookSnapshot, String> {
    let (entries, sections) = {
        let conn = user_db.acquire();
        let entries = crate::db::design_notebook::get_design_notebook_entries_with_sections(&conn)
            .map_err(|e| format!("Failed to get Design Notebook entries: {e}"))?;
        let sections = crate::db::design_notebook::get_notebook_sections(&conn)
            .map_err(|e| format!("Failed to get Design Notebook sections: {e}"))?;
        (entries, sections)
    };

    let filtered = filter_design_notebook_sectioned_entries(entries, notebook_path_status);
    prune_stale_design_notebook_entries(user_db, &filtered.stale_paths);
    Ok(DesignNotebookSnapshot {
        entries: filtered.visible,
        sections,
    })
}

pub fn create_notebook_section(
    user_db: &UserDb,
    name: &str,
) -> Result<DesignNotebookSection, String> {
    let name = normalize_section_name(name)?;
    let conn = user_db.acquire();
    crate::db::design_notebook::create_notebook_section(&conn, name)
        .map_err(|e| format!("Failed to create Notebook Section: {e}"))
}

pub fn add_design_reference(
    user_db: &UserDb,
    path: &str,
    design: &CanopiFile,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Design path is required".to_owned());
    }

    let conn = user_db.acquire();
    crate::db::design_notebook::record_design_reference(
        &conn,
        path,
        &design.name,
        design.plants.len() as u32,
    )
    .map_err(|e| format!("Failed to add Design to Notebook: {e}"))
}

pub fn rename_notebook_section(
    user_db: &UserDb,
    section_id: &str,
    name: &str,
) -> Result<(), String> {
    let name = normalize_section_name(name)?;
    let conn = user_db.acquire();
    crate::db::design_notebook::rename_notebook_section(&conn, section_id, name)
        .map_err(|e| format!("Failed to rename Notebook Section: {e}"))
}

pub fn delete_notebook_section(user_db: &UserDb, section_id: &str) -> Result<(), String> {
    let conn = user_db.acquire();
    crate::db::design_notebook::delete_notebook_section(&conn, section_id)
        .map_err(|e| format!("Failed to delete Notebook Section: {e}"))
}

pub fn move_design_reference_to_section(
    user_db: &UserDb,
    path: &str,
    section_id: Option<String>,
) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Design path is required".to_owned());
    }

    let conn = user_db.acquire();
    match section_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        Some(section_id) => {
            crate::db::design_notebook::assign_design_reference_to_section(&conn, path, section_id)
                .map_err(|e| format!("Failed to move Design into Notebook Section: {e}"))?;
        }
        None => {
            crate::db::design_notebook::remove_design_reference_from_section(&conn, path)
                .map_err(|e| format!("Failed to remove Design from Notebook Section: {e}"))?;
        }
    }

    Ok(())
}

pub fn remove_design_reference(user_db: &UserDb, path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("Design path is required".to_owned());
    }

    let conn = user_db.acquire();
    crate::db::design_notebook::remove_design_reference(&conn, path)
        .map_err(|e| format!("Failed to remove Design from Notebook: {e}"))
}

pub fn reorder_notebook_sections(user_db: &UserDb, section_ids: Vec<String>) -> Result<(), String> {
    validate_order_values(&section_ids, "Notebook Section id")?;
    let conn = user_db.acquire();
    crate::db::design_notebook::reorder_notebook_sections(&conn, &section_ids)
        .map_err(|e| format!("Failed to reorder Notebook Sections: {e}"))
}

pub fn reorder_design_references(user_db: &UserDb, paths: Vec<String>) -> Result<(), String> {
    validate_order_values(&paths, "Design path")?;
    let conn = user_db.acquire();
    crate::db::design_notebook::reorder_design_references(&conn, &paths)
        .map_err(|e| format!("Failed to reorder Design Notebook entries: {e}"))
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

fn filter_design_notebook_sectioned_entries(
    entries: Vec<DesignNotebookEntry>,
    mut status_for_path: impl FnMut(&Path) -> NotebookPathStatus,
) -> NotebookSectionedFilterResult {
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

    NotebookSectionedFilterResult {
        visible,
        stale_paths,
    }
}

fn normalize_section_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Notebook Section name is required".to_owned());
    }
    Ok(trimmed)
}

fn validate_order_values(values: &[String], label: &str) -> Result<(), String> {
    if values.iter().any(|value| value.trim().is_empty()) {
        return Err(format!("{label} is required"));
    }
    Ok(())
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

    let conn = user_db.acquire();
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
    use crate::db::UserDb;
    use common_types::design::DesignSummary;
    use rusqlite::Connection;
    use std::path::PathBuf;

    fn test_user_db() -> UserDb {
        let conn = Connection::open_in_memory().unwrap();
        UserDb::initialize(conn).unwrap()
    }

    fn test_user_db_at(path: &std::path::Path) -> UserDb {
        UserDb::open(path).unwrap()
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
            let conn = user_db.acquire();
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
            let conn = user_db.acquire();
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

    #[test]
    fn notebook_snapshot_includes_sections_and_membership() {
        let user_db = test_user_db();
        let design_path = temp_design_path("sectioned");
        std::fs::write(&design_path, "{}").unwrap();
        {
            let conn = user_db.acquire();
            crate::db::design_notebook::record_design_reference(
                &conn,
                &design_path.to_string_lossy(),
                "Sectioned Design",
                4,
            )
            .unwrap();
        }
        let section = super::create_notebook_section(&user_db, "Client work").unwrap();
        super::move_design_reference_to_section(
            &user_db,
            design_path.to_string_lossy().as_ref(),
            Some(section.id.clone()),
        )
        .unwrap();

        let snapshot = super::get_design_notebook(&user_db).unwrap();

        assert_eq!(snapshot.sections.len(), 1);
        assert_eq!(snapshot.sections[0].name, "Client work");
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].section_id, Some(section.id));

        let _ = std::fs::remove_file(design_path);
    }

    #[test]
    fn deleting_section_keeps_design_references_unsectioned() {
        let user_db = test_user_db();
        let design_path = temp_design_path("deleted_section");
        std::fs::write(&design_path, "{}").unwrap();
        {
            let conn = user_db.acquire();
            crate::db::design_notebook::record_design_reference(
                &conn,
                &design_path.to_string_lossy(),
                "Unsectioned Design",
                2,
            )
            .unwrap();
        }
        let section = super::create_notebook_section(&user_db, "Temporary").unwrap();
        super::move_design_reference_to_section(
            &user_db,
            design_path.to_string_lossy().as_ref(),
            Some(section.id.clone()),
        )
        .unwrap();

        super::delete_notebook_section(&user_db, &section.id).unwrap();
        let snapshot = super::get_design_notebook(&user_db).unwrap();

        assert!(snapshot.sections.is_empty());
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].section_id, None);

        let _ = std::fs::remove_file(design_path);
    }

    #[test]
    fn removing_design_reference_preserves_design_file() {
        let user_db = test_user_db();
        let design_path = temp_design_path("remove_reference");
        std::fs::write(&design_path, "{}").unwrap();
        {
            let conn = user_db.acquire();
            crate::db::design_notebook::record_design_reference(
                &conn,
                &design_path.to_string_lossy(),
                "Removable Design",
                2,
            )
            .unwrap();
        }

        super::remove_design_reference(&user_db, design_path.to_string_lossy().as_ref()).unwrap();
        let snapshot = super::get_design_notebook(&user_db).unwrap();

        assert!(snapshot.entries.is_empty());
        assert!(
            design_path.exists(),
            "removing a notebook reference must not delete the Design file"
        );

        let _ = std::fs::remove_file(design_path);
    }

    #[test]
    fn manual_order_survives_user_db_reopen() {
        let db_path = temp_design_path("ordered_user_db").with_extension("db");
        let first_design_path = temp_design_path("ordered_first");
        let second_design_path = temp_design_path("ordered_second");
        std::fs::write(&first_design_path, "{}").unwrap();
        std::fs::write(&second_design_path, "{}").unwrap();

        let (first_section_id, second_section_id) = {
            let user_db = test_user_db_at(&db_path);
            {
                let conn = user_db.acquire();
                crate::db::design_notebook::record_design_reference(
                    &conn,
                    &first_design_path.to_string_lossy(),
                    "First Design",
                    1,
                )
                .unwrap();
                crate::db::design_notebook::record_design_reference(
                    &conn,
                    &second_design_path.to_string_lossy(),
                    "Second Design",
                    2,
                )
                .unwrap();
            }
            let first_section = super::create_notebook_section(&user_db, "First Section").unwrap();
            let second_section =
                super::create_notebook_section(&user_db, "Second Section").unwrap();

            super::reorder_notebook_sections(
                &user_db,
                vec![second_section.id.clone(), first_section.id.clone()],
            )
            .unwrap();
            super::reorder_design_references(
                &user_db,
                vec![
                    second_design_path.to_string_lossy().to_string(),
                    first_design_path.to_string_lossy().to_string(),
                ],
            )
            .unwrap();

            (first_section.id, second_section.id)
        };

        let reopened = test_user_db_at(&db_path);
        let snapshot = super::get_design_notebook(&reopened).unwrap();

        assert_eq!(
            snapshot
                .sections
                .iter()
                .map(|section| section.id.as_str())
                .collect::<Vec<_>>(),
            [second_section_id.as_str(), first_section_id.as_str()]
        );
        assert_eq!(
            snapshot
                .entries
                .iter()
                .map(|entry| entry.path.as_str())
                .collect::<Vec<_>>(),
            [
                second_design_path.to_string_lossy().as_ref(),
                first_design_path.to_string_lossy().as_ref(),
            ]
        );

        let _ = std::fs::remove_file(first_design_path);
        let _ = std::fs::remove_file(second_design_path);
        let _ = std::fs::remove_file(db_path);
    }
}
