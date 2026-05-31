use crate::{AppHealth, db::UserDb};
use common_types::support::{ProblemReportRequest, ProblemReportResult};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn create_problem_report(
    app: AppHandle,
    user_db: tauri::State<'_, UserDb>,
    health: tauri::State<'_, AppHealth>,
    request: ProblemReportRequest,
) -> Result<ProblemReportResult, String> {
    let output_root = report_output_root(&app)?;
    let app_data_dir = app.path().app_data_dir().ok();
    let log_dir = app.path().app_log_dir().ok();
    let timestamp_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let settings_result = crate::services::settings::get_settings(&user_db);
    let (settings, settings_error) = match settings_result {
        Ok(settings) => (Some(settings), None),
        Err(error) => (None, Some(error)),
    };

    crate::services::problem_report::create_problem_report(
        &request,
        crate::services::problem_report::ProblemReportContext {
            output_root,
            log_dir,
            app_data_dir,
            timestamp_secs,
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            target: format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
            settings,
            settings_error,
            health: crate::services::health::get_health(&health)?,
        },
    )
}

#[tauri::command]
pub fn show_problem_report_folder(path: String) -> Result<(), String> {
    let revealer = crate::services::problem_report::SystemProblemReportFolderRevealer;
    crate::services::problem_report::show_problem_report_folder(Path::new(&path), &revealer)
}

fn report_output_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(desktop_dir) = app.path().desktop_dir() {
        return Ok(desktop_dir);
    }

    app.path()
        .app_data_dir()
        .map(|path| path.join("Problem Reports"))
        .map_err(|error| format!("Failed to resolve a report output folder: {error}"))
}
