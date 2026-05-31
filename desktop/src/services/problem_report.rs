use common_types::health::SubsystemHealth;
use common_types::settings::Settings;
use common_types::support::{ProblemReportRequest, ProblemReportResult};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;

const SUMMARY_FILENAME: &str = "Report Summary.txt";
const BUNDLE_FILENAME: &str = "Diagnostic Bundle.zip";
const CURRENT_DESIGN_ATTACHMENT_FILENAME: &str = "current-design.canopi";
const MAX_LOG_FILES: usize = 3;
const MAX_LOG_BYTES_PER_FILE: usize = 64 * 1024;
const MAX_LOG_LINES: usize = 200;

pub struct ProblemReportContext {
    pub output_root: PathBuf,
    pub log_dir: Option<PathBuf>,
    pub app_data_dir: Option<PathBuf>,
    pub timestamp_secs: u64,
    pub app_version: String,
    pub target: String,
    pub settings: Option<Settings>,
    pub settings_error: Option<String>,
    pub health: SubsystemHealth,
}

pub fn create_problem_report(
    request: &ProblemReportRequest,
    context: ProblemReportContext,
) -> Result<ProblemReportResult, String> {
    let timestamp_iso = crate::design::unix_to_iso8601(context.timestamp_secs);
    let folder_name = format!("Canopi Problem Report {}", folder_stamp(&timestamp_iso));
    let folder = create_unique_report_folder(&context.output_root, &folder_name)?;
    let redactions = Redactions::from_context(&context);

    let summary = build_report_summary(request, &context, &timestamp_iso, &redactions);
    let summary_path = folder.join(SUMMARY_FILENAME);
    std::fs::write(&summary_path, &summary).map_err(|error| {
        format!(
            "Failed to write report summary to {}: {error}",
            summary_path.display()
        )
    })?;

    let bundle = build_diagnostic_bundle(request, &context, &timestamp_iso, &summary, &redactions)?;
    let bundle_path = folder.join(BUNDLE_FILENAME);
    std::fs::write(&bundle_path, bundle).map_err(|error| {
        format!(
            "Failed to write diagnostic bundle to {}: {error}",
            bundle_path.display()
        )
    })?;

    Ok(ProblemReportResult {
        folder_path: folder.to_string_lossy().into_owned(),
        summary_path: summary_path.to_string_lossy().into_owned(),
        bundle_path: bundle_path.to_string_lossy().into_owned(),
        report_summary: summary,
    })
}

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

fn folder_stamp(timestamp_iso: &str) -> String {
    timestamp_iso
        .trim_end_matches('Z')
        .replace('T', " ")
        .replace(':', "-")
}

fn create_unique_report_folder(root: &Path, folder_name: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root)
        .map_err(|error| format!("Failed to create report root {}: {error}", root.display()))?;

    for suffix in 0..100 {
        let candidate = if suffix == 0 {
            root.join(folder_name)
        } else {
            root.join(format!("{folder_name}-{suffix}"))
        };
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!(
                    "Failed to create report folder {}: {error}",
                    candidate.display()
                ));
            }
        }
    }

    Err(format!(
        "Failed to create report folder in {}: too many existing reports for {folder_name}",
        root.display()
    ))
}

fn build_report_summary(
    request: &ProblemReportRequest,
    context: &ProblemReportContext,
    timestamp_iso: &str,
    redactions: &Redactions,
) -> String {
    let description = normalized_description(&request.description);
    let includes_current_design = request.sensitive_attachments.current_design.is_some();
    let sensitive_attachments = if includes_current_design {
        "- Current Design (.canopi) included by explicit consent"
    } else {
        "- None selected"
    };
    let privacy_note = if includes_current_design {
        "The diagnostic bundle includes the current Design because you opted in. It may include canvas contents, notes, timeline, budget, and saved location. Screenshots are still excluded by default."
    } else {
        "The diagnostic bundle excludes Design contents, precise Location, screenshots, and raw filesystem paths by default."
    };
    let settings_line = match (&context.settings, &context.settings_error) {
        (Some(settings), _) => format!(
            "Settings: locale {}, theme {}, measurement {}",
            locale_label(settings),
            theme_label(settings),
            settings.measurement_units
        ),
        (None, Some(error)) => format!("Settings: unavailable ({})", redactions.sanitize(error)),
        (None, None) => "Settings: unavailable".to_owned(),
    };

    let summary = format!(
        "Canopi Problem Report\n\
         Created: {timestamp_iso}\n\
         App: Canopi {app_version}\n\
         Platform: {target}\n\
         Health: plant catalog {plant_db}\n\
         {settings_line}\n\
         \n\
         What happened:\n\
         {description}\n\
         \n\
         Attached files:\n\
         - {summary_file}\n\
         - {bundle_file}\n\
         \n\
         Sensitive attachments:\n\
         {sensitive_attachments}\n\
         \n\
         Privacy note:\n\
         {privacy_note}\n",
        app_version = context.app_version,
        target = context.target,
        plant_db = plant_db_label(&context.health),
        summary_file = SUMMARY_FILENAME,
        bundle_file = BUNDLE_FILENAME,
    );

    redactions.sanitize(&summary)
}

fn build_diagnostic_bundle(
    request: &ProblemReportRequest,
    context: &ProblemReportContext,
    timestamp_iso: &str,
    summary: &str,
    redactions: &Redactions,
) -> Result<Vec<u8>, String> {
    let includes_current_design = request.sensitive_attachments.current_design.is_some();
    let mut manifest_files = vec![
        "report-summary.txt",
        "system.json",
        "frontend-diagnostics.json",
        "backend-log.txt",
    ];
    if includes_current_design {
        manifest_files.push(CURRENT_DESIGN_ATTACHMENT_FILENAME);
    }
    let privacy_defaults = if includes_current_design {
        vec![
            "Current Design included by explicit user consent",
            "Screenshots excluded",
            "Filesystem paths sanitized in diagnostics",
        ]
    } else {
        vec![
            "Design contents excluded",
            "Precise Location excluded",
            "Screenshots excluded",
            "Filesystem paths sanitized",
        ]
    };
    let sensitive_attachments = if includes_current_design {
        vec![json!({
            "kind": "current_design",
            "file": CURRENT_DESIGN_ATTACHMENT_FILENAME,
            "included_by_user_consent": true,
        })]
    } else {
        Vec::new()
    };
    let system = json!({
        "app": {
            "name": "Canopi",
            "version": context.app_version,
            "target": context.target,
        },
        "created_at": timestamp_iso,
        "health": context.health,
        "settings": settings_summary(context),
        "privacy": {
            "includes_design_contents": includes_current_design,
            "includes_precise_location": includes_current_design,
            "includes_screenshot": false,
            "filesystem_paths_sanitized": true,
        },
    });
    let manifest = json!({
        "format": "canopi-diagnostic-bundle-v1",
        "created_at": timestamp_iso,
        "files": manifest_files,
        "privacy_defaults": privacy_defaults,
        "sensitive_attachments": sensitive_attachments,
    });

    let backend_log = collect_backend_log_excerpt(context, redactions);
    let description = redactions.sanitize(&normalized_description(&request.description));
    let frontend_diagnostics = json!({
        "entries": &request.frontend_diagnostics,
    });

    let system_json = serde_json::to_string_pretty(&system)
        .map_err(|error| format!("Failed to encode diagnostic system info: {error}"))?;
    let frontend_diagnostics_json = serde_json::to_string_pretty(&frontend_diagnostics)
        .map_err(|error| format!("Failed to encode frontend diagnostics: {error}"))?;
    let mut entries = vec![
        ZipEntry::new(
            "manifest.json",
            serde_json::to_vec_pretty(&manifest)
                .map_err(|error| format!("Failed to encode diagnostic manifest: {error}"))?,
        ),
        ZipEntry::new(
            "system.json",
            redactions.sanitize(&system_json).into_bytes(),
        ),
        ZipEntry::new(
            "report-summary.txt",
            format!("{summary}\n\nDescription only:\n{description}\n").into_bytes(),
        ),
        ZipEntry::new(
            "frontend-diagnostics.json",
            redactions.sanitize(&frontend_diagnostics_json).into_bytes(),
        ),
        ZipEntry::new("backend-log.txt", backend_log.into_bytes()),
    ];
    if let Some(current_design) = &request.sensitive_attachments.current_design {
        entries.push(ZipEntry::new(
            CURRENT_DESIGN_ATTACHMENT_FILENAME,
            current_design.as_bytes().to_vec(),
        ));
    }

    create_stored_zip(&entries)
}

fn normalized_description(description: &str) -> String {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        "No description provided.".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn settings_summary(context: &ProblemReportContext) -> serde_json::Value {
    if let Some(settings) = &context.settings {
        json!({
            "locale": settings.locale,
            "theme": settings.theme,
            "measurement_units": settings.measurement_units,
            "show_botanical_names": settings.show_botanical_names,
            "auto_save_interval_s": settings.auto_save_interval_s,
            "debug_logging": settings.debug_logging,
            "map_style": settings.map_style,
            "map_layer_visible": settings.map_layer_visible,
            "contour_visible": settings.contour_visible,
            "hillshade_visible": settings.hillshade_visible,
        })
    } else {
        json!({
            "available": false,
            "error": context.settings_error.as_deref().unwrap_or("unknown"),
        })
    }
}

fn locale_label(settings: &Settings) -> &'static str {
    match settings.locale {
        common_types::settings::Locale::En => "en",
        common_types::settings::Locale::Fr => "fr",
        common_types::settings::Locale::Es => "es",
        common_types::settings::Locale::Pt => "pt",
        common_types::settings::Locale::It => "it",
        common_types::settings::Locale::Zh => "zh",
        common_types::settings::Locale::De => "de",
        common_types::settings::Locale::Ja => "ja",
        common_types::settings::Locale::Ko => "ko",
        common_types::settings::Locale::Nl => "nl",
        common_types::settings::Locale::Ru => "ru",
    }
}

fn theme_label(settings: &Settings) -> &'static str {
    match settings.theme {
        common_types::settings::Theme::Light => "light",
        common_types::settings::Theme::Dark => "dark",
    }
}

fn plant_db_label(health: &SubsystemHealth) -> &'static str {
    match health.plant_db {
        common_types::health::PlantDbStatus::Available => "available",
        common_types::health::PlantDbStatus::Missing => "missing",
        common_types::health::PlantDbStatus::Corrupt => "corrupt",
    }
}

fn collect_backend_log_excerpt(context: &ProblemReportContext, redactions: &Redactions) -> String {
    let Some(log_dir) = &context.log_dir else {
        return "No backend log directory was available.\n".to_owned();
    };

    let mut files = match std::fs::read_dir(log_dir) {
        Ok(entries) => entries
            .filter_map(Result::ok)
            .filter_map(|entry| {
                let path = entry.path();
                let name = path.file_name()?.to_str()?;
                if !name.starts_with("canopi") {
                    return None;
                }
                let modified = entry
                    .metadata()
                    .and_then(|metadata| metadata.modified())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                Some((modified, path))
            })
            .collect::<Vec<_>>(),
        Err(error) => {
            return format!(
                "Backend log directory could not be read: {}\n",
                redactions.sanitize(&error.to_string())
            );
        }
    };

    files.sort_by_key(|(modified, _)| *modified);
    let mut excerpts = Vec::new();
    for (_, path) in files.into_iter().rev().take(MAX_LOG_FILES).rev() {
        let Ok(bytes) = std::fs::read(&path) else {
            continue;
        };
        let start = bytes.len().saturating_sub(MAX_LOG_BYTES_PER_FILE);
        let text = String::from_utf8_lossy(&bytes[start..]);
        let lines = text
            .lines()
            .rev()
            .take(MAX_LOG_LINES)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        excerpts.push(format!(
            "== {} ==\n{}\n",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("canopi.log"),
            redactions.sanitize(&lines)
        ));
    }

    if excerpts.is_empty() {
        "No backend log files were available.\n".to_owned()
    } else {
        excerpts.join("\n")
    }
}

struct Redactions {
    known_paths: Vec<(String, &'static str)>,
}

impl Redactions {
    fn from_context(context: &ProblemReportContext) -> Self {
        let mut known_paths = Vec::new();
        push_redaction(&mut known_paths, &context.output_root, "<report-root>");
        if let Some(path) = &context.log_dir {
            push_redaction(&mut known_paths, path, "<log-dir>");
        }
        if let Some(path) = &context.app_data_dir {
            push_redaction(&mut known_paths, path, "<app-data-dir>");
        }
        if let Some(settings) = &context.settings {
            let default_dir = settings.default_design_dir.trim();
            if !default_dir.is_empty() {
                known_paths.push((default_dir.to_owned(), "<default-design-dir>"));
            }
        }
        if let Some(home) = std::env::var_os("HOME") {
            let path = PathBuf::from(home);
            push_redaction(&mut known_paths, &path, "<home-dir>");
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let path = PathBuf::from(profile);
            push_redaction(&mut known_paths, &path, "<home-dir>");
        }

        known_paths.sort_by(|left, right| right.0.len().cmp(&left.0.len()));
        Self { known_paths }
    }

    fn sanitize(&self, text: &str) -> String {
        let mut sanitized = text.to_owned();
        for (path, replacement) in &self.known_paths {
            sanitized = sanitized.replace(path, replacement);
        }
        redact_absolute_path_tokens(&sanitized)
    }
}

fn push_redaction(paths: &mut Vec<(String, &'static str)>, path: &Path, replacement: &'static str) {
    let value = path.to_string_lossy();
    if !value.is_empty() {
        paths.push((value.into_owned(), replacement));
    }
}

fn redact_absolute_path_tokens(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;

    while index < chars.len() {
        if starts_unix_path(&chars, index) || starts_windows_path(&chars, index) {
            output.push_str("<path>");
            index = consume_path_token(&chars, index);
        } else {
            output.push(chars[index]);
            index += 1;
        }
    }

    output
}

fn starts_unix_path(chars: &[char], index: usize) -> bool {
    chars[index] == '/' && (index == 0 || is_path_boundary(chars[index - 1]))
}

fn starts_windows_path(chars: &[char], index: usize) -> bool {
    index + 2 < chars.len()
        && chars[index].is_ascii_alphabetic()
        && chars[index + 1] == ':'
        && matches!(chars[index + 2], '\\' | '/')
        && (index == 0 || is_path_boundary(chars[index - 1]))
}

fn is_path_boundary(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '"' | '\'' | '(' | '[' | '{' | '=')
}

fn consume_path_token(chars: &[char], start: usize) -> usize {
    let mut index = start;
    while index < chars.len() {
        let ch = chars[index];
        if matches!(ch, '\n' | '\r' | '"' | '\'' | ')' | ']' | '}' | ',' | ';') {
            break;
        }
        index += 1;
    }
    index
}

struct ZipEntry {
    name: &'static str,
    data: Vec<u8>,
}

impl ZipEntry {
    fn new(name: &'static str, data: Vec<u8>) -> Self {
        Self { name, data }
    }
}

fn create_stored_zip(entries: &[ZipEntry]) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut central_directory = Vec::new();

    for entry in entries {
        let name = entry.name.as_bytes();
        let size = u32::try_from(entry.data.len())
            .map_err(|_| format!("Diagnostic bundle entry '{}' is too large", entry.name))?;
        let offset =
            u32::try_from(output.len()).map_err(|_| "Diagnostic bundle is too large".to_owned())?;
        let name_len = u16::try_from(name.len())
            .map_err(|_| format!("Diagnostic bundle entry name '{}' is too long", entry.name))?;
        let crc = crc32(&entry.data);

        write_u32(&mut output, 0x0403_4b50);
        write_u16(&mut output, 20);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u32(&mut output, crc);
        write_u32(&mut output, size);
        write_u32(&mut output, size);
        write_u16(&mut output, name_len);
        write_u16(&mut output, 0);
        output.extend_from_slice(name);
        output.extend_from_slice(&entry.data);

        write_u32(&mut central_directory, 0x0201_4b50);
        write_u16(&mut central_directory, 20);
        write_u16(&mut central_directory, 20);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u32(&mut central_directory, crc);
        write_u32(&mut central_directory, size);
        write_u32(&mut central_directory, size);
        write_u16(&mut central_directory, name_len);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u32(&mut central_directory, 0);
        write_u32(&mut central_directory, offset);
        central_directory.extend_from_slice(name);
    }

    let central_directory_offset =
        u32::try_from(output.len()).map_err(|_| "Diagnostic bundle is too large".to_owned())?;
    let central_directory_size = u32::try_from(central_directory.len())
        .map_err(|_| "Diagnostic bundle central directory is too large".to_owned())?;
    let entry_count = u16::try_from(entries.len())
        .map_err(|_| "Diagnostic bundle has too many entries".to_owned())?;

    output.extend_from_slice(&central_directory);
    write_u32(&mut output, 0x0605_4b50);
    write_u16(&mut output, 0);
    write_u16(&mut output, 0);
    write_u16(&mut output, entry_count);
    write_u16(&mut output, entry_count);
    write_u32(&mut output, central_directory_size);
    write_u32(&mut output, central_directory_offset);
    write_u16(&mut output, 0);

    Ok(output)
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use common_types::health::{PlantDbStatus, SubsystemHealth};
    use common_types::settings::Settings;
    use common_types::support::{
        FrontendDiagnosticEntry, ProblemReportRequest, ProblemReportSensitiveAttachments,
    };
    use std::cell::RefCell;
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    struct TempProblemReportDir {
        root: PathBuf,
    }

    impl TempProblemReportDir {
        fn new(label: &str) -> Self {
            let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "canopi-problem-report-{label}-{}-{sequence}",
                std::process::id(),
            ));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }
    }

    impl Drop for TempProblemReportDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    struct RecordingFolderRevealer {
        opened: RefCell<Vec<PathBuf>>,
    }

    impl RecordingFolderRevealer {
        fn new() -> Self {
            Self {
                opened: RefCell::new(Vec::new()),
            }
        }
    }

    impl super::ProblemReportFolderRevealer for RecordingFolderRevealer {
        fn reveal_folder(&self, folder: &Path) -> Result<(), String> {
            self.opened.borrow_mut().push(folder.to_path_buf());
            Ok(())
        }
    }

    #[test]
    fn creates_report_summary_and_diagnostic_bundle_in_visible_folder() {
        let temp = TempProblemReportDir::new("bundle");
        let log_dir = temp.root.join("logs");
        std::fs::create_dir_all(&log_dir).unwrap();
        std::fs::write(
            log_dir.join("canopi.log"),
            "Loaded design from /home/alice/Garden Site.canopi\nCanopi starting\n",
        )
        .unwrap();

        let result = super::create_problem_report(
            &ProblemReportRequest {
                description: "Canvas froze after placing a species".to_owned(),
                frontend_diagnostics: vec![FrontendDiagnosticEntry {
                    level: "error".to_owned(),
                    source: "ErrorBoundary".to_owned(),
                    message: "Render failed at /home/alice/Garden Site.canopi".to_owned(),
                    timestamp_ms: 1_801_440_010_000.0,
                }],
                sensitive_attachments: ProblemReportSensitiveAttachments::default(),
            },
            super::ProblemReportContext {
                output_root: temp.root.join("Desktop"),
                log_dir: Some(log_dir.clone()),
                app_data_dir: Some(temp.root.join("app-data")),
                timestamp_secs: 1_801_440_000,
                app_version: "0.5.0".to_owned(),
                target: "test-os/test-arch".to_owned(),
                settings: Some(Settings {
                    default_design_dir: "/home/alice/designs".to_owned(),
                    ..Settings::default()
                }),
                settings_error: None,
                health: SubsystemHealth {
                    plant_db: PlantDbStatus::Available,
                },
            },
        )
        .unwrap();

        let folder = PathBuf::from(&result.folder_path);
        assert!(folder.ends_with("Canopi Problem Report 2027-02-01 00-00-00"));
        assert!(folder.join("Report Summary.txt").exists());
        assert!(folder.join("Diagnostic Bundle.zip").exists());
        assert_eq!(
            PathBuf::from(&result.summary_path),
            folder.join("Report Summary.txt")
        );
        assert_eq!(
            PathBuf::from(&result.bundle_path),
            folder.join("Diagnostic Bundle.zip")
        );

        let summary = std::fs::read_to_string(folder.join("Report Summary.txt")).unwrap();
        assert!(summary.contains("Canvas froze after placing a species"));
        assert!(summary.contains("Canopi 0.5.0"));
        assert!(!summary.contains("/home/alice"));

        let bundle = std::fs::read(folder.join("Diagnostic Bundle.zip")).unwrap();
        assert!(bundle.starts_with(b"PK\x03\x04"));
        assert!(bundle.windows(4).any(|window| window == b"PK\x05\x06"));
        let bundle_text = String::from_utf8_lossy(&bundle);
        assert!(bundle_text.contains("manifest.json"));
        assert!(bundle_text.contains("backend-log.txt"));
        assert!(bundle_text.contains("frontend-diagnostics.json"));
        assert!(bundle_text.contains("Render failed"));
        assert!(!bundle_text.contains("current-design.canopi"));
        assert!(!bundle_text.contains("/home/alice"));
        assert!(!bundle_text.contains("Garden Site.canopi"));
        assert!(!bundle_text.contains("default_design_dir"));
    }

    #[test]
    fn create_problem_report_includes_current_design_after_explicit_consent() {
        let temp = TempProblemReportDir::new("current-design");

        let result = super::create_problem_report(
            &ProblemReportRequest {
                description: "Budget panel failed after editing notes".to_owned(),
                frontend_diagnostics: Vec::new(),
                sensitive_attachments: ProblemReportSensitiveAttachments {
                    current_design: Some(
                        "{\n  \"name\": \"Secret Orchard\",\n  \"location\": {\"lat\": 48.8566, \"lon\": 2.3522}\n}\n"
                            .to_owned(),
                    ),
                },
            },
            super::ProblemReportContext {
                output_root: temp.root.join("Desktop"),
                log_dir: None,
                app_data_dir: Some(temp.root.join("app-data")),
                timestamp_secs: 1_801_440_000,
                app_version: "0.5.0".to_owned(),
                target: "test-os/test-arch".to_owned(),
                settings: Some(Settings::default()),
                settings_error: None,
                health: SubsystemHealth {
                    plant_db: PlantDbStatus::Available,
                },
            },
        )
        .unwrap();

        let summary = std::fs::read_to_string(&result.summary_path).unwrap();
        assert!(summary.contains("Current Design (.canopi) included by explicit consent"));

        let bundle = std::fs::read(&result.bundle_path).unwrap();
        let bundle_text = String::from_utf8_lossy(&bundle);
        assert!(bundle_text.contains("current-design.canopi"));
        assert!(bundle_text.contains("Secret Orchard"));
        assert!(bundle_text.contains("Current Design included by explicit user consent"));
        assert!(bundle_text.contains("\"includes_design_contents\": true"));
        assert!(bundle_text.contains("\"includes_precise_location\": true"));
    }

    #[test]
    fn show_problem_report_folder_reveals_generated_report_folder() {
        let temp = TempProblemReportDir::new("show-folder");
        let report_folder = temp.root.join("Canopi Problem Report 2027-02-01 00-00-00");
        std::fs::create_dir_all(&report_folder).unwrap();
        std::fs::write(report_folder.join("Report Summary.txt"), "summary").unwrap();
        std::fs::write(report_folder.join("Diagnostic Bundle.zip"), b"bundle").unwrap();
        let revealer = RecordingFolderRevealer::new();

        super::show_problem_report_folder(&report_folder, &revealer).unwrap();

        assert_eq!(revealer.opened.borrow().as_slice(), &[report_folder]);
    }

    #[test]
    fn show_problem_report_folder_rejects_non_report_folders_before_revealing() {
        let temp = TempProblemReportDir::new("show-folder-invalid");
        let not_a_report = temp.root.join("Downloads");
        std::fs::create_dir_all(&not_a_report).unwrap();
        let revealer = RecordingFolderRevealer::new();

        let error = super::show_problem_report_folder(&not_a_report, &revealer).unwrap_err();

        assert!(error.contains("is not a Canopi Problem Report folder"));
        assert!(revealer.opened.borrow().is_empty());
    }
}
