//! The pinned GeoLibre native tool runner used by new slope definitions.
//!
//! Recipe 2 runs the `geolibre` CLI built from `geolibre-rust` at
//! [`GEOLIBRE_REVISION`] as a job-owned child process: fixed argv, no shell,
//! bounded output, the finite process deadline, and kill/reap on cancel, all
//! through the same runner as the GDAL engine. Discovery is cached like GDAL's,
//! so a missing binary makes new slope unavailable with a named reason and never
//! falls back to another method.

use super::engine::GdalEngine;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

/// The `geolibre-rust` commit the shipped CLI is built from.
pub const GEOLIBRE_REVISION: &str = "aac2b743978666f3c3119b5c93de1b30963b1493";
/// Worker threads one slope window may use.
const RAYON_THREADS: &str = "2";
#[cfg(windows)]
const EXECUTABLE: &str = "geolibre.exe";
#[cfg(not(windows))]
const EXECUTABLE: &str = "geolibre";

#[derive(Debug, Clone)]
pub struct GeolibreTool {
    pub path: PathBuf,
    /// The runner's own version line, e.g. `geolibre-cli 1.5.3`.
    pub version: String,
}

impl GeolibreTool {
    /// What a published result records as the engine that actually ran.
    pub fn provenance(&self) -> String {
        format!(
            "{} (geolibre-rust {})",
            self.version,
            &GEOLIBRE_REVISION[..12]
        )
    }
}

#[derive(Debug, Clone)]
pub struct GeolibreEngine {
    /// A fixed binary instead of discovery; tests use it to name a missing one.
    fixed: Option<PathBuf>,
    discovery: Arc<Mutex<Option<Result<GeolibreTool, String>>>>,
    /// Where child output is captured, inside the library root.
    log_dir: PathBuf,
}

impl GeolibreEngine {
    /// A runner that captures child output in `log_dir`, which must exist.
    pub fn in_dir(log_dir: PathBuf) -> Self {
        Self {
            fixed: None,
            discovery: Arc::new(Mutex::new(None)),
            log_dir,
        }
    }

    #[cfg(test)]
    pub fn at(path: PathBuf) -> Self {
        Self {
            fixed: Some(path),
            ..Self::in_dir(std::env::temp_dir())
        }
    }

    /// Test support: fix what discovery reports.
    #[cfg(test)]
    pub fn preset(&self, discovered: Result<GeolibreTool, String>) {
        *self.discovery.lock().unwrap() = Some(discovered);
    }

    /// Find the runner once per process: `CANOPI_GEOLIBRE_BIN`, then beside
    /// the application executable (where packaging puts it), then `PATH`.
    pub fn discover(&self) -> Result<GeolibreTool, String> {
        let mut guard = self
            .discovery
            .lock()
            .map_err(|_| "GeoLibre discovery lock poisoned".to_string())?;
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
        let discovered = self.discover_uncached();
        *guard = Some(discovered.clone());
        discovered
    }

    fn discover_uncached(&self) -> Result<GeolibreTool, String> {
        let path = match &self.fixed {
            Some(path) => path.clone(),
            None => locate()?,
        };
        if !path.is_file() {
            return Err(format!(
                "the GeoLibre slope engine is not installed ({} is missing)",
                path.display()
            ));
        }
        let output =
            GdalEngine::run_managed(&path, &["version".to_string()], &[], None, &self.log_dir)?;
        let version = output.stdout.trim().to_string();
        if version.is_empty() {
            return Err("the GeoLibre slope engine reported no version".to_string());
        }
        Ok(GeolibreTool { path, version })
    }

    /// Run the pinned projected slope on one staged window.
    ///
    /// The tool reads `input` (Float32, a round-trip-safe NoData tag) and writes
    /// `output` in the same grid. Only a completed child with an output file
    /// counts as success; the caller owns both paths and their cleanup.
    pub fn slope(
        &self,
        input: &Path,
        output: &Path,
        percent: bool,
        cancel: &AtomicBool,
    ) -> Result<(), String> {
        let tool = self.discover()?;
        let args = vec![
            "slope".to_string(),
            format!("--input={}", input.display()),
            format!("--output={}", output.display()),
            format!("--units={}", if percent { "percent" } else { "degrees" }),
            "--z_factor=1".to_string(),
        ];
        GdalEngine::run_managed(
            &tool.path,
            &args,
            &[("RAYON_NUM_THREADS", RAYON_THREADS)],
            Some(cancel),
            &self.log_dir,
        )?;
        if !output.is_file() {
            return Err("the GeoLibre slope engine produced no output".to_string());
        }
        Ok(())
    }
}

fn locate() -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("CANOPI_GEOLIBRE_BIN") {
        return Ok(PathBuf::from(explicit));
    }
    if let Some(beside) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join(EXECUTABLE)))
        .filter(|candidate| candidate.is_file())
    {
        return Ok(beside);
    }
    super::engine::which_on_path(EXECUTABLE).ok_or_else(|| {
        "the GeoLibre slope engine is not installed; new slope results are unavailable".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The build script and the provenance name the same pinned revision.
    #[test]
    fn the_build_script_pins_the_recorded_revision() {
        let script = include_str!("../../../../scripts/build-geolibre-cli.sh");
        assert!(
            script.contains(&format!("REVISION={GEOLIBRE_REVISION}")),
            "scripts/build-geolibre-cli.sh must build {GEOLIBRE_REVISION}"
        );
    }

    #[test]
    fn a_missing_runner_is_a_named_unavailability_not_a_fallback() {
        let engine = GeolibreEngine::at(std::env::temp_dir().join("no-such-geolibre-binary"));
        let error = engine.discover().expect_err("missing binary");
        assert!(error.contains("not installed"), "{error}");
        let cancel = AtomicBool::new(false);
        let error = engine
            .slope(Path::new("in.tif"), Path::new("out.tif"), false, &cancel)
            .expect_err("no slope without the runner");
        assert!(error.contains("not installed"), "{error}");
    }
}
