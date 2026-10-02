//! Design drafts: Untitled Designs kept in app data until they are saved as a
//! file or deleted. Each draft is `{app_data}/drafts/<id>.canopi` in the same
//! `.canopi` wire format, encoder, durable write and load admission as a Design file.

use common_types::design::{CanopiFile, DesignDraftSummary};
use std::path::{Path, PathBuf};

use super::format;

const DRAFTS_DIR: &str = "drafts";
/// The store of the retired interval autosave (Canopi 1.x); moved aside at startup.
const RETIRED_AUTOSAVE_DIR: &str = "autosave";
/// Name suffix of local data Canopi 2.0 moves aside instead of reading (ADR 0021).
const BEFORE_2_0_SUFFIX: &str = "before-2.0";
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

/// The Design Drafts folder under the app data directory.
pub(crate) fn drafts_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DRAFTS_DIR)
}

impl DesignDrafts {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            dir: drafts_root(app_data_dir),
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

/// Canopi 2.0 breaks stored data (ADR 0021): drafts in an older `.canopi`
/// format are no longer listed or opened. Move them, byte for byte, into
/// `{app_data}/drafts.before-2.0-<unix-seconds>/` so the user can still find
/// them; current, newer and damaged drafts stay where they are. Returns how
/// many drafts moved. Never deletes anything; a draft that cannot be moved
/// stays in place, hidden as before.
pub(crate) fn set_aside_drafts_from_before_2_0(app_data_dir: &Path) -> usize {
    let dir = drafts_root(app_data_dir);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return 0,
        Err(error) => {
            tracing::warn!("Could not read the drafts store: {:?}", error.kind());
            return 0;
        }
    };
    let older: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| draft_id_of(path).is_some() && is_from_before_2_0(path))
        .collect();
    if older.is_empty() {
        return 0;
    }
    let Some(aside) = free_set_aside_path(app_data_dir, DRAFTS_DIR) else {
        tracing::warn!("Found no free name to move earlier Design drafts aside");
        return 0;
    };
    if let Err(error) = std::fs::create_dir(&aside) {
        tracing::warn!(
            "Could not create the folder for earlier Design drafts: {:?}",
            error.kind()
        );
        return 0;
    }
    let mut moved = 0;
    for path in older {
        let Some(name) = path.file_name() else {
            continue;
        };
        match std::fs::rename(&path, aside.join(name)) {
            Ok(()) => moved += 1,
            Err(error) => tracing::warn!(
                "Could not move an earlier Design draft aside: {:?}",
                error.kind()
            ),
        }
    }
    tracing::info!(moved, "Moved Design drafts from before Canopi 2.0 aside");
    moved
}

fn is_from_before_2_0(path: &Path) -> bool {
    format::load_from_file(path).is_err_and(|error| {
        error.failure().kind == common_types::design::DesignLoadFailureKind::OlderVersion
    })
}

/// Move the retired interval-autosave store (`{app_data}/autosave`, written
/// by Canopi 1.x and read by nothing since) to
/// `{app_data}/autosave.before-2.0-<unix-seconds>` (ADR 0021). An empty store
/// holds nothing and is removed. Returns whether user data was moved aside.
pub(crate) fn set_aside_retired_autosave_store(app_data_dir: &Path) -> bool {
    let store = app_data_dir.join(RETIRED_AUTOSAVE_DIR);
    match std::fs::symlink_metadata(&store) {
        Ok(metadata) if metadata.is_dir() => {
            if std::fs::remove_dir(&store).is_ok() {
                // `remove_dir` only removes an empty directory.
                return false;
            }
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return false,
        Err(error) => {
            tracing::warn!(
                "Could not inspect the retired autosave store: {:?}",
                error.kind()
            );
            return false;
        }
    }
    let Some(aside) = free_set_aside_path(app_data_dir, RETIRED_AUTOSAVE_DIR) else {
        tracing::warn!("Found no free name to move the retired autosave store aside");
        return false;
    };
    match std::fs::rename(&store, &aside) {
        Ok(()) => {
            tracing::info!("Moved the retired autosave store aside");
            true
        }
        Err(error) => {
            tracing::warn!(
                "Could not move the retired autosave store aside: {:?}",
                error.kind()
            );
            false
        }
    }
}

/// `{app_data}/<name>.before-2.0-<unix-seconds>`, or with `-<n>` appended
/// when that name is taken, so nothing moved aside is ever overwritten.
fn free_set_aside_path(app_data_dir: &Path, name: &str) -> Option<PathBuf> {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let base = format!("{name}.{BEFORE_2_0_SUFFIX}-{seconds}");
    (1u32..=10_000)
        .map(|attempt| match attempt {
            1 => app_data_dir.join(&base),
            n => app_data_dir.join(format!("{base}-{n}")),
        })
        .find(|candidate| std::fs::symlink_metadata(candidate).is_err())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_scratch::TestScratch;
    use std::fs;

    fn unique_dir(label: &str) -> TestScratch {
        TestScratch::new(&format!("drafts-{label}"))
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
    }

    #[test]
    fn loading_a_draft_uses_design_file_admission() {
        let root = unique_dir("admission");
        let drafts = DesignDrafts::new(&root);
        let dir = drafts.dir.clone();
        fs::create_dir_all(&dir).unwrap();
        let mut old_version = serde_json::to_value(design("Old")).unwrap();
        old_version["version"] =
            serde_json::json!(common_types::design::CURRENT_CANOPI_FILE_VERSION - 1);
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
    }

    fn entries_starting_with(root: &Path, prefix: &str) -> Vec<PathBuf> {
        let mut found = fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with(prefix))
            })
            .collect::<Vec<_>>();
        found.sort();
        found
    }

    fn write_at_version(path: &Path, name: &str, version: u32) -> Vec<u8> {
        let mut value = serde_json::to_value(design(name)).unwrap();
        value["version"] = serde_json::json!(version);
        let bytes = serde_json::to_vec(&value).unwrap();
        fs::write(path, &bytes).unwrap();
        bytes
    }

    /// Canopi 2.0 breaks stored data (ADR 0021): drafts in an earlier format
    /// move aside byte for byte; current, newer and damaged drafts stay.
    #[test]
    fn drafts_from_before_2_0_are_moved_aside_and_the_rest_stay() {
        use common_types::design::CURRENT_CANOPI_FILE_VERSION;
        let root = unique_dir("before_2_0");
        let drafts = DesignDrafts::new(&root);
        drafts.save("current", &design("Current")).unwrap();
        let dir = drafts.dir.clone();
        let v8 = write_at_version(
            &dir.join("v8.canopi"),
            "Preview v8",
            CURRENT_CANOPI_FILE_VERSION - 1,
        );
        let v7 = write_at_version(
            &dir.join("v7.canopi"),
            "Preview v7",
            CURRENT_CANOPI_FILE_VERSION - 2,
        );
        write_at_version(
            &dir.join("newer.canopi"),
            "Newer",
            CURRENT_CANOPI_FILE_VERSION + 1,
        );
        fs::write(dir.join("damaged.canopi"), "not json").unwrap();

        let (moved, logs) =
            crate::services::design_files::capture_logs(|| set_aside_drafts_from_before_2_0(&root));

        assert_eq!(moved, 2);
        let aside = entries_starting_with(&root, "drafts.before-2.0-");
        assert_eq!(aside.len(), 1, "{aside:?}");
        assert_eq!(fs::read(aside[0].join("v8.canopi")).unwrap(), v8);
        assert_eq!(fs::read(aside[0].join("v7.canopi")).unwrap(), v7);
        for kept in ["current", "newer", "damaged"] {
            assert!(dir.join(format!("{kept}.canopi")).exists(), "{kept} stays");
        }
        let ids = drafts
            .list()
            .unwrap()
            .into_iter()
            .map(|draft| draft.id)
            .collect::<Vec<_>>();
        assert_eq!(ids, ["current"]);
        assert!(!logs.contains(&*root.to_string_lossy()), "{logs}");
        assert!(!logs.contains("Preview v8"), "{logs}");

        // Once moved, a second start finds nothing and creates nothing.
        assert_eq!(set_aside_drafts_from_before_2_0(&root), 0);
        assert_eq!(entries_starting_with(&root, "drafts.before-2.0-").len(), 1);
    }

    #[test]
    fn without_earlier_drafts_nothing_is_moved_or_created() {
        let root = unique_dir("no_earlier_drafts");
        assert_eq!(set_aside_drafts_from_before_2_0(&root), 0);
        DesignDrafts::new(&root)
            .save("current", &design("Current"))
            .unwrap();

        assert_eq!(set_aside_drafts_from_before_2_0(&root), 0);

        assert!(entries_starting_with(&root, "drafts.").is_empty());
    }

    #[test]
    fn the_retired_autosave_store_is_moved_aside_not_deleted() {
        let root = unique_dir("retired_autosave");
        let retired = root.join("autosave");
        fs::create_dir_all(retired.join("nested")).unwrap();
        fs::write(retired.join("0123456789abcdef.canopi"), "{}").unwrap();
        DesignDrafts::new(&root)
            .save("kept", &design("Kept"))
            .unwrap();

        let (moved, logs) =
            crate::services::design_files::capture_logs(|| set_aside_retired_autosave_store(&root));

        assert!(moved);
        assert!(!retired.exists());
        let aside = entries_starting_with(&root, "autosave.before-2.0-");
        assert_eq!(aside.len(), 1, "{aside:?}");
        assert_eq!(
            fs::read_to_string(aside[0].join("0123456789abcdef.canopi")).unwrap(),
            "{}"
        );
        assert!(aside[0].join("nested").is_dir());
        assert!(
            logs.contains("Moved the retired autosave store aside"),
            "{logs}"
        );
        assert!(!logs.contains(&*root.to_string_lossy()), "{logs}");
        assert_eq!(DesignDrafts::new(&root).load("kept").unwrap().name, "Kept");

        // Nothing left to move is not an error and logs nothing.
        let (moved, logs) =
            crate::services::design_files::capture_logs(|| set_aside_retired_autosave_store(&root));
        assert!(!moved);
        assert!(!logs.contains("autosave store"), "{logs}");
    }

    #[test]
    fn an_empty_retired_autosave_store_is_removed_without_a_notice() {
        let root = unique_dir("empty_autosave");
        fs::create_dir_all(root.join("autosave")).unwrap();

        assert!(!set_aside_retired_autosave_store(&root));

        assert!(!root.join("autosave").exists());
        assert!(entries_starting_with(&root, "autosave.").is_empty());
    }
}
