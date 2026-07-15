use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_STAGE: AtomicU64 = AtomicU64::new(0);

pub(crate) struct WebCatalogArtifacts {
    pub(crate) module: Vec<u8>,
    pub(crate) declaration: Vec<u8>,
}

pub(crate) trait ExternalContractRenderer {
    fn validate_species_catalog(&self, repo_root: &Path) -> Result<(), Box<dyn std::error::Error>>;

    fn render_web_catalog(
        &self,
        repo_root: &Path,
    ) -> Result<WebCatalogArtifacts, Box<dyn std::error::Error>>;
}

pub(crate) struct PythonContractRenderer;

impl ExternalContractRenderer for PythonContractRenderer {
    fn validate_species_catalog(&self, repo_root: &Path) -> Result<(), Box<dyn std::error::Error>> {
        run_python(
            repo_root,
            &repo_root.join("scripts/species_catalog_contract.py"),
            &[OsString::from("check")],
            "Species Catalog storage contract validation",
        )?;
        Ok(())
    }

    fn render_web_catalog(
        &self,
        repo_root: &Path,
    ) -> Result<WebCatalogArtifacts, Box<dyn std::error::Error>> {
        let stage = PythonStage::create(repo_root)?;
        run_python(
            repo_root,
            &repo_root.join("scripts/web_catalog_artifact_contract.py"),
            &[
                OsString::from("render"),
                OsString::from("--output-directory"),
                stage.path.as_os_str().to_owned(),
            ],
            "Web Species Catalog artifact rendering",
        )?;
        stage.read_artifacts()
    }
}

struct PythonStage {
    path: PathBuf,
}

impl PythonStage {
    fn create(repo_root: &Path) -> Result<Self, Box<dyn std::error::Error>> {
        let parent = repo_root.join("target");
        fs::create_dir_all(&parent)?;
        for _ in 0..100 {
            let path = parent.join(format!(
                "bindings-gen-python-{}-{}",
                std::process::id(),
                NEXT_STAGE.fetch_add(1, Ordering::Relaxed),
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path }),
                Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error.into()),
            }
        }
        Err("could not reserve a unique Python generation staging directory".into())
    }

    fn read_artifacts(self) -> Result<WebCatalogArtifacts, Box<dyn std::error::Error>> {
        let rendered = (|| {
            Ok(WebCatalogArtifacts {
                module: fs::read(self.path.join("web-catalog-artifact.mjs")).map_err(|error| {
                    format!("failed to read staged Web Catalog module: {error}")
                })?,
                declaration: fs::read(self.path.join("web-catalog-artifact.d.mts")).map_err(
                    |error| format!("failed to read staged Web Catalog declaration: {error}"),
                )?,
            })
        })();
        let cleanup = fs::remove_dir_all(&self.path);
        match (rendered, cleanup) {
            (Ok(artifacts), Ok(())) => Ok(artifacts),
            (Err(render_error), Ok(())) => Err(render_error),
            (Ok(_), Err(cleanup_error)) => Err(format!(
                "failed to remove Python generation staging directory {}: {cleanup_error}",
                self.path.display()
            )
            .into()),
            (Err(render_error), Err(cleanup_error)) => Err(format!(
                "{render_error}; also failed to remove Python generation staging directory {}: {cleanup_error}",
                self.path.display()
            )
            .into()),
        }
    }
}

impl Drop for PythonStage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn run_python(
    repo_root: &Path,
    script: &Path,
    args: &[OsString],
    operation: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let override_program = std::env::var_os("PYTHON").filter(|value| !value.is_empty());
    let candidates = python_command_candidates(override_program, cfg!(windows));
    let mut unavailable = Vec::new();
    for (program, prefix_args) in candidates {
        let display = std::iter::once(program.to_string_lossy().into_owned())
            .chain(
                prefix_args
                    .iter()
                    .map(|argument| argument.to_string_lossy().into_owned()),
            )
            .collect::<Vec<_>>()
            .join(" ");
        let output = Command::new(&program)
            .args(&prefix_args)
            .arg(script)
            .args(args)
            .current_dir(repo_root)
            .output();
        let output = match output {
            Ok(output) => output,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                unavailable.push(display);
                continue;
            }
            Err(error) => {
                return Err(
                    format!("failed to launch {operation} with '{display}': {error}").into(),
                );
            }
        };
        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let details = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(format!("{operation} failed using '{display}':\n{details}").into());
    }

    Err(format!(
        "no Python 3 interpreter was available for {operation} (tried: {}); set PYTHON to a Python 3 executable",
        unavailable.join(", ")
    )
    .into())
}

fn python_command_candidates(
    override_program: Option<OsString>,
    windows: bool,
) -> Vec<(OsString, Vec<OsString>)> {
    if let Some(program) = override_program {
        return vec![(program, Vec::new())];
    }
    if windows {
        return vec![
            (OsString::from("py"), vec![OsString::from("-3")]),
            (OsString::from("python"), Vec::new()),
            (OsString::from("python3"), Vec::new()),
        ];
    }
    vec![
        (OsString::from("python3"), Vec::new()),
        (OsString::from("python"), Vec::new()),
    ]
}

#[cfg(test)]
mod tests {
    use super::python_command_candidates;
    use std::ffi::OsString;

    #[test]
    fn python_candidates_respect_override_and_windows_launcher() {
        assert_eq!(
            python_command_candidates(Some(OsString::from("/custom/python")), false),
            vec![(OsString::from("/custom/python"), Vec::new())],
        );
        assert_eq!(
            python_command_candidates(None, true),
            vec![
                (OsString::from("py"), vec![OsString::from("-3")]),
                (OsString::from("python"), Vec::new()),
                (OsString::from("python3"), Vec::new()),
            ],
        );
    }
}
