use common_types::health::SubsystemHealth;
use common_types::settings::Settings;
use common_types::support::{ProblemReportRequest, ProblemReportResult};
use std::path::{Path, PathBuf};

mod bundle;
mod folder_reveal;
mod redactions;
mod summary;
mod zip;

#[cfg(test)]
pub(crate) use folder_reveal::ProblemReportFolderRevealer;
pub(crate) use folder_reveal::{SystemProblemReportFolderRevealer, show_problem_report_folder};

use bundle::build_diagnostic_bundle;
use redactions::Redactions;
use summary::build_report_summary;

const SUMMARY_FILENAME: &str = "Report Summary.txt";
const BUNDLE_FILENAME: &str = "Diagnostic Bundle.zip";
const CURRENT_DESIGN_ATTACHMENT_FILENAME: &str = "current-design.canopi";

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
                    plant_spacing_interval_m: 0.75,
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
        assert!(bundle_text.contains("\"plant_spacing_interval_m\""));
        assert!(bundle_text.contains("0.75"));
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
