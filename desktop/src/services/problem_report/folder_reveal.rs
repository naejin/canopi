use std::path::Path;
use std::process::Command;

use super::{BUNDLE_FILENAME, SUMMARY_FILENAME};

pub(crate) trait ProblemReportFolderRevealer {
    fn reveal_folder(&self, folder: &Path) -> Result<(), String>;
}

pub(crate) struct SystemProblemReportFolderRevealer;

impl ProblemReportFolderRevealer for SystemProblemReportFolderRevealer {
    fn reveal_folder(&self, folder: &Path) -> Result<(), String> {
        let mut command = platform_reveal_command(folder);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Failed to show the Problem Report folder: {error}"))?;
        // The opener may run as long as the file manager it hands off to, so
        // reap it off the calling thread instead of leaving a zombie.
        std::thread::Builder::new()
            .name("problem-report-reveal-reaper".to_owned())
            .spawn(move || {
                if let Err(error) = child.wait() {
                    tracing::warn!("Problem Report folder opener could not be reaped: {error}");
                }
            })
            .map_err(|error| {
                format!("Failed to watch the Problem Report folder opener: {error}")
            })?;
        Ok(())
    }
}

/// Reveal `folder` if it is a generated report folder directly inside
/// `output_root`, the folder reports are written to.
pub(crate) fn show_problem_report_folder(
    folder: &Path,
    output_root: &Path,
    revealer: &impl ProblemReportFolderRevealer,
) -> Result<(), String> {
    validate_problem_report_folder(folder, output_root)?;
    revealer.reveal_folder(folder)
}

fn validate_problem_report_folder(folder: &Path, output_root: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(folder).map_err(|error| {
        format!(
            "Problem Report folder was not found at {}: {error}",
            folder.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a folder", folder.display()));
    }

    let not_a_report = || format!("{} is not a Canopi Problem Report folder", folder.display());
    let folder_name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(not_a_report)?;
    if !folder_name.starts_with("Canopi Problem Report ") {
        return Err(not_a_report());
    }
    let canonical_parent = folder
        .canonicalize()
        .ok()
        .and_then(|folder| folder.parent().map(Path::to_path_buf));
    let canonical_root = output_root.canonicalize().ok();
    if canonical_parent.is_none() || canonical_parent != canonical_root {
        return Err(not_a_report());
    }

    for required_file in [SUMMARY_FILENAME, BUNDLE_FILENAME] {
        let required_path = folder.join(required_file);
        if !required_path.is_file() {
            return Err(format!(
                "Problem Report folder {} is missing {required_file}",
                folder.display()
            ));
        }
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn platform_reveal_command(folder: &Path) -> Command {
    let mut command = Command::new("open");
    command.arg(folder);
    command
}

#[cfg(target_os = "windows")]
fn platform_reveal_command(folder: &Path) -> Command {
    let mut command = Command::new("explorer");
    command.arg(folder);
    command
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_reveal_command(folder: &Path) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(folder);
    command
}
