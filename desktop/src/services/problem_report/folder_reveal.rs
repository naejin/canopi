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
        command.spawn().map_err(|error| {
            format!(
                "Failed to show Problem Report folder {}: {error}",
                folder.display()
            )
        })?;
        Ok(())
    }
}

pub(crate) fn show_problem_report_folder(
    folder: &Path,
    revealer: &impl ProblemReportFolderRevealer,
) -> Result<(), String> {
    validate_problem_report_folder(folder)?;
    revealer.reveal_folder(folder)
}

fn validate_problem_report_folder(folder: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(folder).map_err(|error| {
        format!(
            "Problem Report folder was not found at {}: {error}",
            folder.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a folder", folder.display()));
    }

    let folder_name = folder
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} is not a Canopi Problem Report folder", folder.display()))?;
    if !folder_name.starts_with("Canopi Problem Report ") {
        return Err(format!(
            "{} is not a Canopi Problem Report folder",
            folder.display()
        ));
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
