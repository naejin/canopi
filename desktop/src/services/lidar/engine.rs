//! Bounded adapter around the external GDAL command-line engine.
//!
//! The LiDAR subsystem never shells out ad hoc: every raster operation goes
//! through this adapter, which discovers the pinned tool set once, builds
//! fixed argument vectors (no shell), caps captured output, and honors a
//! cancellation flag while a child process runs. Engine detection results are
//! recorded so manifests can prove which engine produced a numeric output.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const DEFAULT_PROCESS_TIMEOUT: Duration = Duration::from_secs(600);
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
/// GDAL's block cache for every engine process.
///
/// Matches the resource policy's 128 MiB reserve for decoded raster data, so a
/// conversion cannot take memory the pipeline has not budgeted.
/// The GDAL block-cache ceiling every managed child is launched with.
pub(super) const GDAL_CACHE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_OUTPUT_FILE_BYTES: u64 = (MAX_OUTPUT_BYTES as u64) * 2;
const CANCEL_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Sequence of captured-output files within this process.
static NEXT_LOG: AtomicU64 = AtomicU64::new(0);

/// Prefix of every captured-output file this process creates.
///
/// Process id plus start time, so a later process that reuses the id never
/// mistakes an earlier one's leftovers for its own. Startup sweeps every file
/// in the log directory without this prefix.
pub(super) fn process_log_tag() -> &'static str {
    static TAG: OnceLock<String> = OnceLock::new();
    TAG.get_or_init(|| {
        let started = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        format!("{}-{started}", std::process::id())
    })
}

/// Create one run's stdout and stderr capture files in `log_dir`.
///
/// `create_new` never truncates or follows an existing path, so a planted or
/// leftover file makes the run fail by name instead of being overwritten.
fn create_output_files(
    log_dir: &Path,
) -> Result<(PathBuf, std::fs::File, PathBuf, std::fs::File), String> {
    let sequence = NEXT_LOG.fetch_add(1, Ordering::Relaxed);
    let tag = process_log_tag();
    let stdout_path = log_dir.join(format!("{tag}-{sequence}-out.log"));
    let stderr_path = log_dir.join(format!("{tag}-{sequence}-err.log"));
    let create = |path: &Path, what: &str| {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| {
                format!(
                    "Failed to create engine {what} file {}: {e}",
                    path.display()
                )
            })
    };
    let stdout_file = create(&stdout_path, "output")?;
    let stderr_file = match create(&stderr_path, "error") {
        Ok(file) => file,
        Err(error) => {
            drop(stdout_file);
            let _ = std::fs::remove_file(&stdout_path);
            return Err(error);
        }
    };
    Ok((stdout_path, stdout_file, stderr_path, stderr_file))
}

/// Remove captured-output files an earlier process left in `log_dir`.
///
/// Files carrying this process's tag belong to children that may still be
/// running under another handle on the same library, so they stay.
pub(super) fn prune_engine_logs(log_dir: &Path) -> Result<usize, String> {
    let own = format!("{}-", process_log_tag());
    let entries = match std::fs::read_dir(log_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Failed to list engine logs {}: {error}",
                log_dir.display()
            ));
        }
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&own) {
            continue;
        }
        if std::fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

#[derive(Debug, Clone)]
pub struct GdalEngine {
    discovery: ArcDiscovery,
    /// Where child output is captured: inside the library root, never the
    /// shared system temp directory.
    log_dir: PathBuf,
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
    pub gdaltransform: PathBuf,
    pub version: String,
}

impl GdalEngine {
    /// An engine that captures child output in `log_dir`, which must exist.
    pub fn in_dir(log_dir: PathBuf) -> Self {
        Self {
            discovery: ArcDiscovery(Arc::new(Mutex::new(None))),
            log_dir,
        }
    }

    /// Test support: an engine outside any library, capturing output in a
    /// per-process scratch directory.
    #[cfg(test)]
    pub fn new() -> Self {
        let log_dir = std::env::temp_dir().join(format!(
            "canopi-lidar-engine-test-logs-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&log_dir).expect("test engine log directory");
        Self::in_dir(log_dir)
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
        let discovered = self.discover_uncached();
        *guard = Some(discovered.clone());
        discovered
    }

    fn discover_uncached(&self) -> Result<DiscoveredTools, String> {
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
            gdaltransform: find("gdaltransform")?,
            version: String::new(),
        };
        let version_output = self.run_once(
            &gdalinfo,
            &["--version".to_string()],
            None,
            None,
            Some(DEFAULT_PROCESS_TIMEOUT),
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
            GdalProgram::Transform => tools.gdaltransform,
        };
        self.run_once(&path, args, None, cancel, Some(DEFAULT_PROCESS_TIMEOUT))
    }

    /// Run the controlled source-conversion call with no elapsed-time ceiling.
    ///
    /// Only this call may outlive the common finite deadline: a real large
    /// conversion is the one operation the product contract exempts. Explicit
    /// cancel and shutdown still terminate and reap the child, and every call
    /// retains bounded output and process-reaping behavior. OS read/write/fsync
    /// stalls are not made interruptible by an atomic flag.
    pub fn run_uncapped_conversion(
        &self,
        program: GdalProgram,
        args: &[String],
        cancel: Option<&AtomicBool>,
    ) -> Result<RunOutput, String> {
        let tools = self.discover()?;
        let path = match program {
            GdalProgram::Info => tools.gdalinfo,
            GdalProgram::Translate => tools.gdal_translate,
            GdalProgram::Transform => tools.gdaltransform,
        };
        self.run_once(&path, args, None, cancel, None)
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
            GdalProgram::Transform => tools.gdaltransform,
        };
        self.run_once(
            &path,
            args,
            Some(input),
            cancel,
            Some(DEFAULT_PROCESS_TIMEOUT),
        )
    }

    /// Run one managed raster executable other than GDAL (the pinned GeoLibre
    /// CLI) under the same bounded contract: fixed argv, no shell, bounded
    /// output, the finite process deadline, and kill/reap on cancel.
    pub(super) fn run_managed(
        path: &Path,
        args: &[String],
        envs: &[(&str, &str)],
        cancel: Option<&AtomicBool>,
        log_dir: &Path,
    ) -> Result<RunOutput, String> {
        Self::run_once_with_env(
            path,
            args,
            None,
            envs,
            cancel,
            Some(DEFAULT_PROCESS_TIMEOUT),
            log_dir,
        )
    }

    fn run_once(
        &self,
        path: &Path,
        args: &[String],
        input: Option<&[u8]>,
        cancel: Option<&AtomicBool>,
        timeout: Option<Duration>,
    ) -> Result<RunOutput, String> {
        Self::run_once_with_env(path, args, input, &[], cancel, timeout, &self.log_dir)
    }

    fn run_once_with_env(
        path: &Path,
        args: &[String],
        input: Option<&[u8]>,
        envs: &[(&str, &str)],
        cancel: Option<&AtomicBool>,
        timeout: Option<Duration>,
        log_dir: &Path,
    ) -> Result<RunOutput, String> {
        // Output is captured through files instead of pipes so no worker
        // thread is needed and cancellation still kills the child.
        let (stdout_path, stdout_file, stderr_path, stderr_file) = create_output_files(log_dir)?;
        let spawned = Command::new(path)
            .args(args)
            // GDAL's block cache defaults to a share of *system* RAM, not to
            // anything this pipeline budgeted: measured on the representative
            // 400-million-cell plane it grew to the size of the whole raster
            // (1.66 GiB) while converting, which breaks the combined working-set
            // gate on its own. The resource policy already reserves 128 MiB for
            // decoded raster data, so the engine is given exactly that and no
            // tool can silently exceed the pipeline's own bound.
            .env("GDAL_CACHEMAX", GDAL_CACHE_BYTES.to_string())
            .envs(envs.iter().copied())
            .stdin(if input.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::from(stdout_file))
            .stderr(Stdio::from(stderr_file))
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                let _ = std::fs::remove_file(&stdout_path);
                let _ = std::fs::remove_file(&stderr_path);
                return Err(format!("Failed to start {}: {error}", path.display()));
            }
        };
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GdalProgram {
    Info,
    Translate,
    Transform,
}

#[derive(Debug)]
pub struct RunOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

fn wait_cancellable(
    child: &mut Child,
    cancel: Option<&AtomicBool>,
    timeout: Option<Duration>,
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
        if let Some(timeout) = timeout
            && started.elapsed() > timeout
        {
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

pub(super) fn which_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stalled bounded child is killed and reaped when its finite deadline
    /// expires, without waiting for the full production timeout.
    ///
    /// Uses a portable fixture process; Unix `sleep` is only a convenience on
    /// hosts that have it. Windows is explicitly unverified for this lane.
    #[cfg(unix)]
    #[test]
    fn a_stalled_bounded_child_is_killed_and_reaped_on_timeout() {
        let mut child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("sleep spawns");
        let out = std::env::temp_dir().join("canopi-engine-timeout-out.log");
        let err = std::env::temp_dir().join("canopi-engine-timeout-err.log");
        let started = Instant::now();
        let result = wait_cancellable(
            &mut child,
            None,
            Some(Duration::from_millis(120)),
            [&out, &err],
        );
        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_file(&err);
        assert!(result.is_err(), "timeout must report an error");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "timeout settled in {:?}",
            started.elapsed()
        );
        // The child was killed and reaped: try_wait reports a status, not a hang.
        let status = child.try_wait().expect("reaped child polls");
        assert!(status.is_some(), "child must be reaped after timeout");
    }

    /// Captured output lives in the caller's log directory under names private
    /// to this process and run, and is removed when the run settles.
    #[cfg(unix)]
    #[test]
    fn engine_output_is_captured_under_the_log_dir_and_removed() {
        let dir = std::env::temp_dir().join(format!(
            "canopi-engine-logs-{}-{}",
            std::process::id(),
            NEXT_LOG.load(Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let list = |dir: &std::path::Path| {
            GdalEngine::run_managed(
                std::path::Path::new("/bin/sh"),
                &[
                    "-c".to_string(),
                    "ls -1 \"$0\"".to_string(),
                    dir.display().to_string(),
                ],
                &[],
                None,
                dir,
            )
            .expect("sh lists the log directory")
            .stdout
        };
        let first = list(&dir);
        let second = list(&dir);
        let tag = format!("{}-", process_log_tag());
        let names: Vec<&str> = first.lines().chain(second.lines()).collect();
        assert_eq!(
            names.len(),
            4,
            "one out and one err file per run: {names:?}"
        );
        assert!(names.iter().all(|name| name.starts_with(&tag)), "{names:?}");
        assert!(
            first.lines().all(|name| !second.contains(name)),
            "each run has its own files"
        );
        assert!(
            std::fs::read_dir(&dir).unwrap().next().is_none(),
            "settled runs leave nothing behind"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// An explicit cancel settles a running child within the contract bound
    /// even when the elapsed deadline is absent (the source-conversion mode).
    #[cfg(unix)]
    #[test]
    fn an_explicit_cancel_settles_an_uncapped_child() {
        let cancel = AtomicBool::new(false);
        let mut child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("sleep spawns");
        let out = std::env::temp_dir().join("canopi-engine-cancel-out.log");
        let err = std::env::temp_dir().join("canopi-engine-cancel-err.log");
        let started = Instant::now();
        cancel.store(true, Ordering::Relaxed);
        let result = wait_cancellable(&mut child, Some(&cancel), None, [&out, &err]);
        let _ = std::fs::remove_file(&out);
        let _ = std::fs::remove_file(&err);
        assert!(result.is_err(), "cancel must report an error");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "cancel settled in {:?}",
            started.elapsed()
        );
    }
}
