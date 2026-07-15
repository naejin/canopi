mod contracts;
mod design_format;
mod external_contracts;
mod plant_filter;
mod publication;
mod settings;

use external_contracts::{ExternalContractRenderer, PythonContractRenderer};
use publication::{AdmissionMode, GenerationPlan, acquire_generation_admission};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CONTRACTS_TS: &str = "desktop/web/src/generated/contracts.ts";
const KNOWN_KEYS_TS: &str = "desktop/web/src/generated/known-canopi-keys.ts";
const DESIGN_FORMAT_TS: &str = "desktop/web/src/generated/canopi-design-format.ts";
const SETTINGS_TS: &str = "desktop/web/src/generated/settings.ts";
const PLANT_FILTER_TS: &str = "desktop/web/src/generated/plant-filter-fields.ts";
const PLANT_FILTER_RUST: &str = "desktop/src/db/plant_filter_fields.rs";
const WEB_CATALOG_MODULE: &str = "desktop/web/src/generated/web-catalog-artifact.mjs";
const WEB_CATALOG_DECLARATION: &str = "desktop/web/src/generated/web-catalog-artifact.d.mts";

pub fn run_from_env() -> Result<(), Box<dyn std::error::Error>> {
    let mode = GenerationMode::from_args(std::env::args().skip(1))?;
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .ok_or("bindings-gen manifest directory has no repository parent")?;
    execute_generation(repo_root, repo_root, &PythonContractRenderer, mode)
}

#[derive(Clone, Copy)]
enum GenerationMode {
    Write,
    Check,
}

impl GenerationMode {
    fn from_args(
        args: impl IntoIterator<Item = String>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let args = args.into_iter().collect::<Vec<_>>();
        match args.as_slice() {
            [] => Ok(Self::Write),
            [flag] if flag == "--check" => Ok(Self::Check),
            _ => Err("usage: bindings-gen [--check]".into()),
        }
    }

    fn admission(self) -> AdmissionMode {
        match self {
            Self::Write => AdmissionMode::Publish,
            Self::Check => AdmissionMode::Check,
        }
    }
}

fn execute_generation(
    source_root: &Path,
    destination_root: &Path,
    external: &impl ExternalContractRenderer,
    mode: GenerationMode,
) -> Result<(), Box<dyn std::error::Error>> {
    let admission = acquire_generation_admission(destination_root, mode.admission())?;
    external.validate_species_catalog(source_root)?;
    let mut plan = compile_native_plan(source_root, destination_root)?;
    let web_catalog = external.render_web_catalog(source_root)?;
    plan.add(
        destination_root.join(WEB_CATALOG_MODULE),
        web_catalog.module,
    )?;
    plan.add(
        destination_root.join(WEB_CATALOG_DECLARATION),
        web_catalog.declaration,
    )?;
    match mode {
        GenerationMode::Write => plan.publish_admitted(admission)?,
        GenerationMode::Check => plan.check_admitted(admission)?,
    }
    Ok(())
}

fn compile_native_plan(
    source_root: &Path,
    destination_root: &Path,
) -> Result<GenerationPlan, Box<dyn std::error::Error>> {
    let (plant_filter_ts, plant_filter_rust) = plant_filter::render_plant_filter_adapters(
        &source_root.join("common-types/plant-filter-fields.json"),
    )?;
    let plant_filter_rust = format_rust_source(&plant_filter_rust, source_root)?;
    let mut plan = GenerationPlan::new(destination_root);
    plan.add(
        destination_root.join(CONTRACTS_TS),
        contracts::render_typescript_contracts()?,
    )?;
    plan.add(
        destination_root.join(KNOWN_KEYS_TS),
        design_format::render_known_canopi_keys()?,
    )?;
    plan.add(
        destination_root.join(DESIGN_FORMAT_TS),
        design_format::render_canopi_design_format()?,
    )?;
    plan.add(
        destination_root.join(SETTINGS_TS),
        settings::render_settings_runtime()?,
    )?;
    plan.add(destination_root.join(PLANT_FILTER_TS), plant_filter_ts)?;
    plan.add(destination_root.join(PLANT_FILTER_RUST), plant_filter_rust)?;
    Ok(plan)
}

fn format_rust_source(
    source: &str,
    repo_root: &Path,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut child = Command::new("rustfmt")
        .args(["--edition", "2024", "--emit", "stdout"])
        .current_dir(repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to launch rustfmt before publication: {error}"))?;
    let write_result = child
        .stdin
        .take()
        .ok_or("rustfmt stdin was unavailable")?
        .write_all(source.as_bytes());
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to collect rustfmt output: {error}"))?;
    write_result.map_err(|error| format!("failed to stream generated Rust to rustfmt: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "rustfmt failed before generated Rust publication: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::{
        AdmissionMode, CONTRACTS_TS, DESIGN_FORMAT_TS, ExternalContractRenderer, GenerationMode,
        KNOWN_KEYS_TS, PLANT_FILTER_RUST, PLANT_FILTER_TS, SETTINGS_TS, WEB_CATALOG_DECLARATION,
        WEB_CATALOG_MODULE, acquire_generation_admission, execute_generation,
    };
    use crate::external_contracts::WebCatalogArtifacts;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ROOT: AtomicU64 = AtomicU64::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "canopi_bindings_gen_late_renderer_{}_{}",
                std::process::id(),
                NEXT_TEMP_ROOT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct LateFailure;

    impl ExternalContractRenderer for LateFailure {
        fn validate_species_catalog(
            &self,
            _repo_root: &Path,
        ) -> Result<(), Box<dyn std::error::Error>> {
            Ok(())
        }

        fn render_web_catalog(
            &self,
            _repo_root: &Path,
        ) -> Result<WebCatalogArtifacts, Box<dyn std::error::Error>> {
            Err("forced late Web Catalog renderer failure".into())
        }
    }

    struct AdmissionLifetimeProbe {
        admission: PathBuf,
    }

    impl AdmissionLifetimeProbe {
        fn assert_exclusive_admission_is_blocked(&self) -> Result<(), Box<dyn std::error::Error>> {
            let file = fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(&self.admission)?;
            match file.try_lock() {
                Err(fs::TryLockError::WouldBlock) => Ok(()),
                Err(fs::TryLockError::Error(error)) => Err(error.into()),
                Ok(()) => Err("external rendering began before generation admission".into()),
            }
        }
    }

    impl ExternalContractRenderer for AdmissionLifetimeProbe {
        fn validate_species_catalog(
            &self,
            _repo_root: &Path,
        ) -> Result<(), Box<dyn std::error::Error>> {
            self.assert_exclusive_admission_is_blocked()
        }

        fn render_web_catalog(
            &self,
            _repo_root: &Path,
        ) -> Result<WebCatalogArtifacts, Box<dyn std::error::Error>> {
            self.assert_exclusive_admission_is_blocked()?;
            Err("forced renderer failure after admission probe".into())
        }
    }

    #[test]
    fn late_renderer_failure_leaves_every_destination_unchanged() {
        let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let destination = TempRoot::new();
        let relative_paths = [
            CONTRACTS_TS,
            KNOWN_KEYS_TS,
            DESIGN_FORMAT_TS,
            SETTINGS_TS,
            PLANT_FILTER_TS,
            PLANT_FILTER_RUST,
            WEB_CATALOG_MODULE,
            WEB_CATALOG_DECLARATION,
        ];
        for relative in relative_paths {
            let path = destination.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, format!("sentinel:{relative}")).unwrap();
        }

        let error = execute_generation(
            source_root,
            &destination.0,
            &LateFailure,
            GenerationMode::Write,
        )
        .expect_err("the late renderer should stop generation");

        assert!(
            error
                .to_string()
                .contains("forced late Web Catalog renderer failure")
        );
        for relative in relative_paths {
            assert_eq!(
                fs::read_to_string(destination.0.join(relative)).unwrap(),
                format!("sentinel:{relative}"),
            );
        }
        assert!(
            !destination
                .0
                .join("target/bindings-gen-publication.in-progress")
                .exists()
        );
    }

    #[test]
    fn generation_admission_is_held_through_external_rendering() {
        let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let destination = TempRoot::new();
        let renderer = AdmissionLifetimeProbe {
            admission: destination.0.join("target/bindings-gen-publication.lock"),
        };

        let error = execute_generation(
            source_root,
            &destination.0,
            &renderer,
            GenerationMode::Write,
        )
        .expect_err("the renderer probe stops generation after checking admission");

        assert!(
            error
                .to_string()
                .contains("forced renderer failure after admission probe")
        );
        let _released = acquire_generation_admission(&destination.0, AdmissionMode::Publish)
            .expect("renderer failure must release generation admission");
    }

    #[test]
    fn drift_check_admission_is_held_through_external_rendering() {
        let source_root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let destination = TempRoot::new();
        let renderer = AdmissionLifetimeProbe {
            admission: destination.0.join("target/bindings-gen-publication.lock"),
        };

        let error = execute_generation(
            source_root,
            &destination.0,
            &renderer,
            GenerationMode::Check,
        )
        .expect_err("the renderer probe stops checking after testing admission");

        assert!(
            error
                .to_string()
                .contains("forced renderer failure after admission probe")
        );
        let _released = acquire_generation_admission(&destination.0, AdmissionMode::Publish)
            .expect("renderer failure must release drift-check admission");
    }
}
