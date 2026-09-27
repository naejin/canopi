use common_types::settings::{AppFolder, AppFolderLocations};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::{
    native_operation::{NativeOperationClass, NativeOperationExecutor},
    services::folder_reveal::{FolderRevealer, SystemFolderRevealer},
};

/// Settings › Files and data: where Design Drafts and the Data library live.
#[tauri::command]
pub async fn get_app_folders<R: Runtime>(
    app: AppHandle<R>,
    executor: State<'_, NativeOperationExecutor>,
) -> Result<AppFolderLocations, String> {
    let app_data_dir = app_data_dir(&app)?;
    executor
        .run(
            NativeOperationClass::Local,
            "app folder locations",
            move || {
                Ok(crate::services::app_folders::app_folder_locations(
                    &app_data_dir,
                ))
            },
        )
        .await
}

/// Settings › Files and data › Show in folder.
#[tauri::command]
pub async fn show_app_folder<R: Runtime>(
    app: AppHandle<R>,
    executor: State<'_, NativeOperationExecutor>,
    folder: AppFolder,
) -> Result<(), String> {
    let app_data_dir = app_data_dir(&app)?;
    show_app_folder_with_executor(executor.inner(), app_data_dir, folder, SystemFolderRevealer)
        .await
}

async fn show_app_folder_with_executor(
    executor: &NativeOperationExecutor,
    app_data_dir: PathBuf,
    folder: AppFolder,
    revealer: impl FolderRevealer + Send + 'static,
) -> Result<(), String> {
    executor
        .run(
            NativeOperationClass::Local,
            "app folder reveal",
            move || crate::services::app_folders::show_app_folder(&app_data_dir, folder, &revealer),
        )
        .await
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve Canopi's app data folder: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct RecordingRevealer(Arc<Mutex<Vec<PathBuf>>>);

    impl FolderRevealer for RecordingRevealer {
        fn reveal_folder(&self, folder: &Path) -> Result<(), String> {
            self.0.lock().unwrap().push(folder.to_path_buf());
            Ok(())
        }
    }

    #[test]
    fn get_app_folders_names_the_folders_under_app_data() {
        let app = tauri::test::mock_builder()
            .manage(NativeOperationExecutor::production())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let app_data = app.path().app_data_dir().unwrap();
        let locations =
            tauri::async_runtime::block_on(get_app_folders(app.handle().clone(), app.state()))
                .unwrap();
        assert_eq!(
            locations,
            crate::services::app_folders::app_folder_locations(&app_data)
        );
    }

    #[test]
    fn show_app_folder_opens_the_folder_through_the_local_executor() {
        let app_data =
            std::env::temp_dir().join(format!("canopi-app-folders-command-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&app_data);
        let revealer = RecordingRevealer::default();
        tauri::async_runtime::block_on(show_app_folder_with_executor(
            &NativeOperationExecutor::production(),
            app_data.clone(),
            AppFolder::Drafts,
            revealer.clone(),
        ))
        .unwrap();
        assert_eq!(
            *revealer.0.lock().unwrap(),
            vec![crate::services::app_folders::app_folder_path(
                &app_data,
                AppFolder::Drafts
            )]
        );
        let _ = std::fs::remove_dir_all(&app_data);
    }
}
