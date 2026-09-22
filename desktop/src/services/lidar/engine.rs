//! Bounded adapter around the external GDAL command-line engine.
//!
//! The LiDAR subsystem never shells out ad hoc: every raster operation goes
//! through this adapter, which discovers the pinned tool set once, builds
//! fixed argument vectors (no shell), caps captured output, and honors a
//! cancellation flag while a child process runs. Engine detection results are
//! recorded so manifests can prove which engine produced a numeric output.

use std::io::Write as _;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_PROCESS_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
/// GDAL's block cache for every engine process.
///
/// Matches the resource policy's 128 MiB reserve for decoded raster data, so a
/// conversion cannot take memory the pipeline has not budgeted.
const GDAL_CACHE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_OUTPUT_FILE_BYTES: u64 = (MAX_OUTPUT_BYTES as u64) * 2;
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone)]
pub struct GdalEngine {
    discovery: ArcDiscovery,
}

#[derive(Clone)]
struct ArcDiscovery(Arc<Mutex<Option<Result<DiscoveredTools, String>>>>);

impl std::fmt::Debug for ArcDiscovery {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("ArcDiscovery").finish()
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveredTools {
    pub gdalinfo: PathBuf,
    pub gdal_translate: PathBuf,
    pub gdalwarp: PathBuf,
    pub gdaldem: PathBuf,
    pub gdaltransform: PathBuf,
    pub version: String,
}

impl GdalEngine {
    pub fn new() -> Self {
        Self {
            discovery: ArcDiscovery(Arc::new(Mutex::new(None))),
        }
    }

    /// Detect the tool set once per process; detection failures are cached so
    /// a missing engine degrades to explicit errors instead of repeated PATH
    /// scans.
    pub fn discover(&self) -> Result<DiscoveredTools, String> {
        let mut guard = self
            .discovery
            .0
            .lock()
            .map_err(|_| "LiDAR engine discovery lock poisoned".to_string())?;
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
        let discovered = Self::discover_uncached();
        *guard = Some(discovered.clone());
        discovered
    }

    fn discover_uncached() -> Result<DiscoveredTools, String> {
        let search_dir = std::env::var_os("CANOPI_LIDAR_GDAL_BIN").map(PathBuf::from);
        let find = |name: &str| -> Result<PathBuf, String> {
            if let Some(dir) = &search_dir {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
                return Err(format!("GDAL tool {name} not found in {}", dir.display()));
            }
            which_on_path(name).ok_or_else(|| format!("GDAL tool {name} not found on PATH"))
        };

        let gdalinfo = find("gdalinfo")?;
        let tools = DiscoveredTools {
            gdalinfo: gdalinfo.clone(),
            gdal_translate: find("gdal_translate")?,
            gdalwarp: find("gdalwarp")?,
            gdaldem: find("gdaldem")?,
            gdaltransform: find("gdaltransform")?,
            version: String::new(),
        };
        let version_output = Self::run_once(
            &gdalinfo,
            &["--version".to_string()],
            None,
            None,
            DEFAULT_PROCESS_TIMEOUT,
        )?;
        let mut tools = tools;
        tools.version = version_output.stdout.trim().to_string();
        if tools.version.is_empty() {
            return Err("GDAL engine reported an empty version".to_string());
        }
        Ok(tools)
    }

    /// Run one GDAL tool to completion. Fixed argv, no shell, bounded output,
    /// bounded duration, cancellable while running.
    pub fn run(
        &self,
        program: GdalProgram,
        args: &[String],
        cancel: Option<&AtomicBool>,
    ) -> Result<RunOutput, String> {
        let tools = self.discover()?;
        let path = match program {
            GdalProgram::Info => tools.gdalinfo,
            GdalProgram::Translate => tools.gdal_translate,
            GdalProgram::Warp => tools.gdalwarp,
            GdalProgram::Dem => tools.gdaldem,
            GdalProgram::Transform => tools.gdaltransform,
        };
        Self::run_once(&path, args, None, cancel, DEFAULT_PROCESS_TIMEOUT)
    }

    /// Run a GDAL tool with a small caller-owned stdin payload. This keeps
    /// transform operations under the same timeout, cancellation and output
    /// limits as every other engine command.
    pub fn run_with_input(
        &self,
        program: GdalProgram,
        args: &[String],
        input: &[u8],
        cancel: Option<&AtomicBool>,
    ) -> Result<RunOutput, String> {
        if input.len() > MAX_OUTPUT_BYTES {
            return Err("raster process input exceeds the adapter limit".to_string());
        }
        let tools = self.discover()?;
        let path = match program {
            GdalProgram::Info => tools.gdalinfo,
            GdalProgram::Translate => tools.gdal_translate,
            GdalProgram::Warp => tools.gdalwarp,
            GdalProgram::Dem => tools.gdaldem,
            GdalProgram::Transform => tools.gdaltransform,
        };
        Self::run_once(&path, args, Some(input), cancel, DEFAULT_PROCESS_TIMEOUT)
    }

    fn run_once(
        path: &std::path::Path,
        args: &[String],
        input: Option<&[u8]>,
        cancel: Option<&AtomicBool>,
        timeout: Duration,
    ) -> Result<RunOutput, String> {
        let started = Instant::now();
        // Output is captured through temp files instead of pipes so no
        // worker thread is needed and cancellation still kills the child.
        let token = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let stdout_path = std::env::temp_dir().join(format!("canopi-gdal-out-{token}.log"));
        let stderr_path = std::env::temp_dir().join(format!("canopi-gdal-err-{token}.log"));
        let stdout_file = std::fs::File::create(&stdout_path)
            .map_err(|e| format!("Failed to create engine output file: {e}"))?;
        let stderr_file = std::fs::File::create(&stderr_path)
            .map_err(|e| format!("Failed to create engine error file: {e}"))?;
        let child = Command::new(path)
            .args(args)
            // GDAL's block cache defaults to a share of *system* RAM, not to
            // anything this pipeline budgeted: measured on the representative
            // 400-million-cell plane it grew to the size of the whole raster
            // (1.66 GiB) while converting, which breaks the combined working-set
            // gate on its own. The resource policy already reserves 128 MiB for
            // decoded raster data, so the engine is given exactly that and no
            // tool can silently exceed the pipeline's own bound.
            .env("GDAL_CACHEMAX", GDAL_CACHE_BYTES.to_string())
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn()
            .map_err(|e| format!("Failed to start {}: {e}", path.display()))?;
        let mut child = child;
        if let Some(input) = input {
            let write_result = match child.stdin.as_mut() {
                Some(stdin) => stdin.write_all(input),
                None => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = std::fs::remove_file(&stdout_path);
                    let _ = std::fs::remove_file(&stderr_path);
                    return Err("Failed to open raster process input".to_string());
                }
            };
            drop(child.stdin.take());
            if let Err(error) = write_result {
                let _ = child.kill();
                let _ = child.wait();
                let _ = std::fs::remove_file(&stdout_path);
                let _ = std::fs::remove_file(&stderr_path);
                return Err(format!("Failed to write raster process input: {error}"));
            }
        }

        let status = wait_cancellable(&mut child, cancel, timeout, [&stdout_path, &stderr_path]);
        let status = match status {
            Ok(status) => status,
            Err(error) => {
                let _ = child.kill();
                let _ = std::fs::remove_file(&stdout_path);
                let _ = std::fs::remove_file(&stderr_path);
                return Err(error);
            }
        };
        let stdout = read_capped_file(&stdout_path);
        let stderr = read_capped_file(&stderr_path);
        let _ = std::fs::remove_file(&stdout_path);
        let _ = std::fs::remove_file(&stderr_path);

        let output = RunOutput {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            exit_code: status.code().unwrap_or(-1),
            duration: started.elapsed(),
        };

        if !status.success() {
            return Err(format!(
                "{} failed (exit {}): {}",
                path.display(),
                output.exit_code,
                truncate_message(&output.stderr),
            ));
        }
        Ok(output)
    }
}

impl Default for GdalEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GdalProgram {
    Info,
    Translate,
    Warp,
    Dem,
    Transform,
}

#[derive(Debug)]
pub struct RunOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    #[allow(dead_code)]
    pub duration: Duration,
}

fn wait_cancellable(
    child: &mut Child,
    cancel: Option<&AtomicBool>,
    timeout: Duration,
    output_paths: [&std::path::Path; 2],
) -> Result<std::process::ExitStatus, String> {
    let started = Instant::now();
    loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("cancelled".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(e) => return Err(format!("Failed to poll raster process: {e}")),
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err("raster process timed out".to_string());
        }
        if output_paths.iter().any(|path| {
            std::fs::metadata(path)
                .map(|metadata| metadata.len() > MAX_OUTPUT_FILE_BYTES)
                .unwrap_or(false)
        }) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("raster process output exceeds the adapter limit".to_string());
        }
        std::thread::sleep(CANCEL_POLL_INTERVAL);
    }
}

fn read_capped_file(path: &std::path::Path) -> Vec<u8> {
    let Ok(mut file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    use std::io::Read;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match file.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                let remaining = MAX_OUTPUT_BYTES - buf.len();
                let take = n.min(remaining);
                buf.extend_from_slice(&chunk[..take]);
                if buf.len() >= MAX_OUTPUT_BYTES {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    buf
}

fn truncate_message(message: &str) -> String {
    const LIMIT: usize = 2000;
    if message.len() <= LIMIT {
        message.to_string()
    } else {
        let mut cut = LIMIT;
        while !message.is_char_boundary(cut) {
            cut -= 1;
        }
        format!("{}…", &message[..cut])
    }
}

fn which_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}
