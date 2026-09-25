//! Design drafts: Untitled Designs kept in app data until they are saved as a
//! file or deleted. Each draft is `{app_data}/drafts/<id>.canopi` in the same
//! v7 wire format, encoder, durable write and load admission as a Design file.

use common_types::design::{CanopiFile, DesignDraftSummary};
use std::path::{Path, PathBuf};

use super::format;

const DRAFTS_DIR: &str = "drafts";
/// The store of the retired interval autosave; deleted at startup.
const RETIRED_AUTOSAVE_DIR: &str = "autosave";
const DRAFT_EXTENSION: &str = "canopi";
const MAX_DRAFT_ID_LEN: usize = 64;
const UNTITLED_DRAFT_NAME: &str = "Untitled";

/// The drafts store (`{app_data}/drafts`), managed as Tauri state.
#[derive(Debug, Clone)]
pub struct DesignDrafts {
    dir: PathBuf,
}

/// A draft id is `[a-z0-9-]{1,64}`, so it can only name a file directly
/// inside the drafts store.
fn is_valid_draft_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_DRAFT_ID_LEN
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn draft_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_valid_draft_id(id) {
        return Err("Invalid Design draft id".to_owned());
    }
    Ok(dir.join(format!("{id}.{DRAFT_EXTENSION}")))
}

impl DesignDrafts {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            dir: app_data_dir.join(DRAFTS_DIR),
        }
    }

    /// Durably write the draft `id`, creating the store when needed.
    pub(crate) fn save(&self, id: &str, content: &CanopiFile) -> Result<(), String> {
        let dir = self.dir.as_path();
        let path = draft_path(dir, id)?;
        let bytes = format::encode_design(content)?;
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create the drafts store: {e}"))?;
        super::with_write_admission(&path, || super::write_file_durably(&path, &bytes, "tmp"))
            .map_err(|e| format!("Failed to save the Design draft: {e}"))
    }

    /// Load the draft `id` with the same size cap and version admission as a
    /// Design file.
    pub(crate) fn load(&self, id: &str) -> Result<CanopiFile, String> {
        let path = draft_path(&self.dir, id)?;
        format::load_from_file(&path).map_err(|error| error.to_string())
    }

    /// Every readable draft, most recently written first. A draft that cannot be
    /// read or decoded is skipped with a warning instead of failing the list.
    pub(crate) fn list(&self) -> Result<Vec<DesignDraftSummary>, String> {
        let entries = match std::fs::read_dir(&self.dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(format!("Failed to read the drafts store: {error}")),
        };
        let mut drafts = Vec::new();
        for entry in entries {
            let path = match entry {
                Ok(entry) => entry.path(),
                Err(error) => {
                    tracing::warn!("Skipped an unreadable Design draft entry: {error}");
                    continue;
                }
            };
            let Some(id) = draft_id_of(&path) else {
                continue;
            };
            match summarize_draft(&path, id) {
                Some(draft) => drafts.push(draft),
                // Names and paths are user content; logs reach Diagnostic Bundles.
                None => tracing::warn!("Skipped an unreadable Design draft"),
            }
        }
        drafts.sort_by(|(left_time, left), (right_time, right)| {
            right_time
                .cmp(left_time)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(drafts.into_iter().map(|(_, draft)| draft).collect())
    }

    /// Delete the draft `id`. Deleting a draft that is already gone succeeds.
    pub(crate) fn delete(&self, id: &str) -> Result<(), String> {
        let path = draft_path(&self.dir, id)?;
        super::with_write_admission(&path, || match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("Failed to delete the Design draft: {error}")),
        })
    }
}

/// The draft id a store entry names, or `None` for anything else (temporary
/// sidecars, other files).
fn draft_id_of(path: &Path) -> Option<&str> {
    if path.extension().and_then(|extension| extension.to_str()) != Some(DRAFT_EXTENSION) {
        return None;
    }
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| is_valid_draft_id(stem))
}

fn summarize_draft(path: &Path, id: &str) -> Option<(std::time::SystemTime, DesignDraftSummary)> {
    let modified = std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()?;
    let file = format::load_from_file(path).ok()?;
    let name = if file.name.trim().is_empty() {
        UNTITLED_DRAFT_NAME.to_owned()
    } else {
        file.name
    };
    let seconds = modified
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Some((
        modified,
        DesignDraftSummary {
            id: id.to_owned(),
            name,
            updated_at: super::unix_to_iso8601(seconds),
        },
    ))
}

/// Delete the retired interval-autosave store (`{app_data}/autosave`). Its
/// snapshots are old data with no reader.
pub(crate) fn remove_retired_autosave_store(app_data_dir: &Path) {
    let store = app_data_dir.join(RETIRED_AUTOSAVE_DIR);
    let removed = match std::fs::symlink_metadata(&store) {
        Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&store),
        Ok(_) => std::fs::remove_file(&store),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => Err(error),
    };
    match removed {
        Ok(()) => tracing::info!("Removed the retired autosave store"),
        Err(error) => tracing::warn!(
            "Could not remove the retired autosave store: {:?}",
            error.kind()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn unique_dir(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "canopi_drafts_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ))
    }

    fn design(name: &str) -> CanopiFile {
        format::create_new_design(name, "2026-09-25T00:00:00Z")
    }

    fn set_modified(path: &Path, seconds: u64) {
        let file = fs::File::options().write(true).open(path).unwrap();
        file.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
            .unwrap();
    }

    #[test]
    fn a_draft_round_trips_through_the_design_wire_format() {
        let root = unique_dir("round_trip");
        let drafts = DesignDrafts::new(&root);
        let dir = drafts.dir.clone();

        drafts.save("draft-1", &design("Orchard sketch")).unwrap();

        let path = dir.join("draft-1.canopi");
        let bytes = fs::read(&path).unwrap();
        assert_eq!(
            bytes,
            format::encode_design(&design("Orchard sketch")).unwrap()
        );
        assert_eq!(drafts.load("draft-1").unwrap().name, "Orchard sketch");
        let names = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(names, ["draft-1.canopi"], "no temporary is left behind");

        drafts
            .save("draft-1", &design("Orchard sketch, later"))
            .unwrap();
        assert_eq!(
            drafts.load("draft-1").unwrap().name,
            "Orchard sketch, later"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn draft_ids_that_could_leave_the_store_are_refused() {
        let root = unique_dir("traversal");
        let drafts = DesignDrafts::new(&root);
        let dir = drafts.dir.clone();
        fs::create_dir_all(&dir).unwrap();
        let outside = root.join("outside.canopi");
        format::save_to_file(&outside, &design("Outside"), None).unwrap();
        let too_long = "a".repeat(MAX_DRAFT_ID_LEN + 1);

        for id in [
            "",
            "../outside",
            "..",
            ".",
            "a/b",
            "a\\b",
            "/tmp/x",
            "Draft",
            "draft_1",
            "draft.1",
            "draft 1",
            "draft\0",
            "é",
            too_long.as_str(),
        ] {
            assert!(drafts.save(id, &design("Escaped")).is_err(), "{id:?}");
            assert!(drafts.load(id).is_err(), "{id:?}");
            assert!(drafts.delete(id).is_err(), "{id:?}");
        }

        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        assert_eq!(format::load_from_file(&outside).unwrap().name, "Outside");
        assert!(
            drafts
                .save(&"a".repeat(MAX_DRAFT_ID_LEN), &design("Longest"))
                .is_ok()
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn drafts_list_newest_first_with_names_and_utc_times() {
        let root = unique_dir("list");
        let drafts = DesignDrafts::new(&root);
        let dir = drafts.dir.clone();
        drafts.save("older", &design("Older")).unwrap();
        drafts.save("newer", &design("Newer")).unwrap();
        drafts.save("unnamed", &design("  ")).unwrap();
        set_modified(&dir.join("older.canopi"), 1_700_000_000);
        set_modified(&dir.join("newer.canopi"), 1_800_000_000);
        set_modified(&dir.join("unnamed.canopi"), 1_750_000_000);

        let drafts = drafts.list().unwrap();

        let listed = drafts
            .iter()
            .map(|draft| {
                (
                    draft.id.as_str(),
                    draft.name.as_str(),
                    draft.updated_at.as_str(),
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            listed,
            [
                ("newer", "Newer", "2027-01-15T08:00:00Z"),
                ("unnamed", "Untitled", "2025-06-15T15:06:40Z"),
                ("older", "Older", "2023-11-14T22:13:20Z"),
            ]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_missing_store_lists_no_drafts() {
        let root = unique_dir("missing_store");
        assert!(DesignDrafts::new(&root).list().unwrap().is_empty());
    }

    #[test]
    fn unreadable_drafts_are_skipped_without_logging_names_or_paths() {
        let root = unique_dir("corrupt");
        let drafts = DesignDrafts::new(&root);
        let dir = drafts.dir.clone();
        drafts.save("good", &design("Good")).unwrap();
        fs::write(dir.join("corrupt.canopi"), "{ not json").unwrap();
        let mut old_version = serde_json::to_value(design("Secret Orchard")).unwrap();
        old_version["version"] = serde_json::json!(6);
        fs::write(
            dir.join("old-version.canopi"),
            serde_json::to_vec(&old_version).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("notes.txt"), "not a draft").unwrap();
        fs::write(dir.join("Bad_Id.canopi"), "not a draft id").unwrap();

        let (drafts, logs) = crate::services::design_files::capture_logs(|| drafts.list());

        let drafts = drafts.unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].id, "good");
        assert_eq!(
            logs.matches("Skipped an unreadable Design draft").count(),
            2
        );
        assert!(!logs.contains("Secret Orchard"), "{logs}");
        assert!(!logs.contains(&*root.to_string_lossy()), "{logs}");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn loading_a_draft_uses_design_file_admission() {
        let root = unique_dir("admission");
        let drafts = DesignDrafts::new(&root);
        let dir = drafts.dir.clone();
        fs::create_dir_all(&dir).unwrap();
        let mut old_version = serde_json::to_value(design("Old")).unwrap();
        old_version["version"] = serde_json::json!(6);
        fs::write(
            dir.join("old.canopi"),
            serde_json::to_vec(&old_version).unwrap(),
        )
        .unwrap();
        let huge = fs::File::create(dir.join("huge.canopi")).unwrap();
        huge.set_len(format::MAX_CANOPI_FILE_BYTES + 1).unwrap();
        drop(huge);

        let old = drafts.load("old").unwrap_err();
        assert!(old.contains("unsupported_version"), "{old}");
        let huge = drafts.load("huge").unwrap_err();
        assert!(huge.contains("64 MiB"), "{huge}");
        assert!(drafts.load("absent").is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn deleting_a_draft_removes_it_and_is_idempotent() {
        let root = unique_dir("delete");
        let drafts = DesignDrafts::new(&root);
        drafts.save("gone", &design("Gone")).unwrap();
        drafts.save("kept", &design("Kept")).unwrap();

        drafts.delete("gone").unwrap();
        drafts.delete("gone").unwrap();

        let ids = drafts
            .list()
            .unwrap()
            .into_iter()
            .map(|draft| draft.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["kept"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_retired_autosave_store_is_deleted_and_drafts_are_kept() {
        let root = unique_dir("retired_autosave");
        let retired = root.join("autosave");
        fs::create_dir_all(retired.join("nested")).unwrap();
        fs::write(retired.join("0123456789abcdef.canopi"), "{}").unwrap();
        DesignDrafts::new(&root)
            .save("kept", &design("Kept"))
            .unwrap();

        let ((), logs) =
            crate::services::design_files::capture_logs(|| remove_retired_autosave_store(&root));

        assert!(!retired.exists());
        assert!(
            logs.contains("Removed the retired autosave store"),
            "{logs}"
        );
        assert!(!logs.contains(&*root.to_string_lossy()), "{logs}");
        assert_eq!(DesignDrafts::new(&root).load("kept").unwrap().name, "Kept");

        // Nothing to delete is not an error and logs nothing.
        let ((), logs) =
            crate::services::design_files::capture_logs(|| remove_retired_autosave_store(&root));
        assert!(!logs.contains("autosave store"), "{logs}");

        let _ = fs::remove_dir_all(root);
    }
}
