use common_types::design::{
    CanopiFile, DesignDraftSummary, DesignSaveOutcome, DesignSummary, LoadedDesign,
};
use tauri::State;

use crate::{
    db::UserDb,
    design::drafts::DesignDrafts,
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

/// Durably save a design to `path`.
///
/// With `expected_fingerprint`, the file is written only if it still has that
/// fingerprint; otherwise nothing is written and the outcome is `Conflict`.
/// `None` overwrites unconditionally (Save As, keeping this copy). The
/// frontend shows the save dialog and passes the chosen path.
#[tauri::command]
pub async fn save_design(
    executor: State<'_, NativeOperationExecutor>,
    user_db: State<'_, UserDb>,
    path: String,
    content: CanopiFile,
    expected_fingerprint: Option<String>,
) -> Result<DesignSaveOutcome, String> {
    let user_db = user_db.inner().clone();
    executor
        .run(NativeOperationClass::Local, "design save", move || {
            crate::services::design_files::save_design(
                &user_db,
                path,
                content,
                expected_fingerprint,
            )
        })
        .await
}

/// Load a design and the fingerprint of the bytes read from `path`.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub async fn load_design(
    executor: State<'_, NativeOperationExecutor>,
    user_db: State<'_, UserDb>,
    path: String,
) -> Result<LoadedDesign, String> {
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

/// Durably write the Design draft `id` to the app-data drafts store.
#[tauri::command]
pub async fn save_design_draft(
    executor: State<'_, NativeOperationExecutor>,
    drafts: State<'_, DesignDrafts>,
    id: String,
    content: CanopiFile,
) -> Result<(), String> {
    let drafts = drafts.inner().clone();
    executor
        .run(
            NativeOperationClass::Local,
            "design draft save",
            move || drafts.save(&id, &content),
        )
        .await
}

/// Load the Design draft `id`.
#[tauri::command]
pub async fn load_design_draft(
    executor: State<'_, NativeOperationExecutor>,
    drafts: State<'_, DesignDrafts>,
    id: String,
) -> Result<CanopiFile, String> {
    let drafts = drafts.inner().clone();
    executor
        .run(
            NativeOperationClass::Local,
            "design draft load",
            move || drafts.load(&id),
        )
        .await
}

/// List readable Design drafts, most recently written first.
#[tauri::command]
pub async fn list_design_drafts(
    executor: State<'_, NativeOperationExecutor>,
    drafts: State<'_, DesignDrafts>,
) -> Result<Vec<DesignDraftSummary>, String> {
    let drafts = drafts.inner().clone();
    executor
        .run(
            NativeOperationClass::Local,
            "design draft listing",
            move || drafts.list(),
        )
        .await
}

/// Delete the Design draft `id`; an absent draft is already deleted.
#[tauri::command]
pub async fn delete_design_draft(
    executor: State<'_, NativeOperationExecutor>,
    drafts: State<'_, DesignDrafts>,
    id: String,
) -> Result<(), String> {
    let drafts = drafts.inner().clone();
    executor
        .run(
            NativeOperationClass::Local,
            "design draft delete",
            move || drafts.delete(&id),
        )
        .await
}

#[cfg(test)]
mod tests {
    use common_types::design::DesignSaveOutcome;
    use tauri::Manager;

    use crate::{
        db::UserDb, design::drafts::DesignDrafts, native_operation::NativeOperationExecutor,
    };

    fn scratch_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "canopi_design_commands_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ))
    }

    fn mock_app(root: &std::path::Path) -> tauri::App<tauri::test::MockRuntime> {
        let user_db = UserDb::initialize(rusqlite::Connection::open_in_memory().unwrap()).unwrap();
        tauri::test::mock_builder()
            .manage(NativeOperationExecutor::production())
            .manage(user_db)
            .manage(DesignDrafts::new(root))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap()
    }

    fn design(name: &str) -> common_types::design::CanopiFile {
        crate::design::format::create_new_design(name, "2026-09-25T00:00:00Z")
    }

    #[test]
    fn save_and_load_commands_carry_fingerprints_and_refuse_outside_changes() {
        let root = scratch_root("save_load");
        std::fs::create_dir_all(&root).unwrap();
        let app = mock_app(&root);
        let path = root.join("garden.canopi").to_string_lossy().into_owned();
        let save = |name: &str, expected: Option<String>| {
            tauri::async_runtime::block_on(super::save_design(
                app.state(),
                app.state(),
                path.clone(),
                design(name),
                expected,
            ))
            .unwrap()
        };

        let DesignSaveOutcome::Saved { fingerprint, .. } = save("First", None) else {
            panic!("an unconditional save is written");
        };
        let loaded = tauri::async_runtime::block_on(super::load_design(
            app.state(),
            app.state(),
            path.clone(),
        ))
        .unwrap();
        assert_eq!(loaded.fingerprint, fingerprint);
        assert_eq!(loaded.file.name, "First");
        assert!(matches!(
            save("Second", Some(fingerprint.clone())),
            DesignSaveOutcome::Saved { .. }
        ));
        assert!(matches!(
            save("Third", Some(fingerprint)),
            DesignSaveOutcome::Conflict {
                current_fingerprint: Some(_)
            }
        ));
        let recent =
            tauri::async_runtime::block_on(super::get_recent_files(app.state(), app.state()))
                .unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].name, "Second");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn draft_commands_save_list_load_and_delete_through_managed_state() {
        let root = scratch_root("drafts");
        let app = mock_app(&root);

        tauri::async_runtime::block_on(super::save_design_draft(
            app.state(),
            app.state(),
            "draft-1".to_owned(),
            design("Sketch"),
        ))
        .unwrap();
        let listed =
            tauri::async_runtime::block_on(super::list_design_drafts(app.state(), app.state()))
                .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            (listed[0].id.as_str(), listed[0].name.as_str()),
            ("draft-1", "Sketch")
        );
        let loaded = tauri::async_runtime::block_on(super::load_design_draft(
            app.state(),
            app.state(),
            "draft-1".to_owned(),
        ))
        .unwrap();
        assert_eq!(loaded.name, "Sketch");
        assert!(
            tauri::async_runtime::block_on(super::load_design_draft(
                app.state(),
                app.state(),
                "../draft-1".to_owned(),
            ))
            .is_err()
        );
        tauri::async_runtime::block_on(super::delete_design_draft(
            app.state(),
            app.state(),
            "draft-1".to_owned(),
        ))
        .unwrap();
        assert!(
            tauri::async_runtime::block_on(super::list_design_drafts(app.state(), app.state()))
                .unwrap()
                .is_empty()
        );
        assert!(root.join("drafts").is_dir(), "drafts live under app data");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn new_design_command_returns_an_untitled_current_design() {
        let design = super::new_design().unwrap();
        assert_eq!(design.name, "Untitled");
        assert_eq!(
            design.version,
            common_types::design::CURRENT_CANOPI_FILE_VERSION
        );
    }
}
