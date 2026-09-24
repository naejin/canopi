//! Managed filesystem layout for the LiDAR library.
//!
//! The library owns immutable originals, prepared numeric rasters, analysis
//! outputs and the bounded display cache under the app data directory. The
//! `.canopi` document never references these paths.
//!
//! Capacity is checked here rather than guessed: preparing a bounded raster
//! derivative and writing new numeric outputs both need measurable free space,
//! and a platform that cannot report it fails with a named reason instead of
//! risking a half-written result.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct LidarPaths {
    root: PathBuf,
}

impl LidarPaths {
    pub fn open(app_data_dir: &Path) -> Result<Self, String> {
        let root = app_data_dir.join("lidar");
        for dir in [
            root.clone(),
            self_sources_dir(&root),
            self_prepared_dir(&root),
            self_display_dir(&root),
            root.join("display-tiles"),
            root.join("display-cog"),
            root.join("display-cog-staging"),
            root.join("assets"),
            root.join("jobs"),
        ] {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create LiDAR dir {}: {e}", dir.display()))?;
        }
        Ok(Self { root })
    }

    pub fn catalogue_path(&self) -> PathBuf {
        self.root.join("lidar-library.sqlite")
    }

    /// Library root. Catalogue asset references stay relative to it, so a
    /// moved library stays readable.
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn display_cache_path(&self) -> PathBuf {
        self.root.join("lidar-display-cache.sqlite")
    }

    /// Reproducible on-demand display tiles. Never authority: entries are
    /// derivatives of immutable generations and may be evicted at any time.
    pub fn tile_cache_dir(&self) -> PathBuf {
        self.root.join("display-tiles")
    }

    /// Content-addressed immutable resolved/quality COG assets.
    pub fn asset_dir(&self, sha256: &str) -> PathBuf {
        self.root.join("assets").join(sha256)
    }

    /// One immutable COG asset by digest: a retained source, a resolved
    /// generation chunk or an analysis quality chunk.
    pub fn asset_cog(&self, sha256: &str) -> PathBuf {
        self.asset_dir(sha256).join("cog.tif")
    }

    /// Immutable imported originals: `sources/<sha256>/original`.
    ///
    /// A retained source COG is not stored here: it is content-addressed under
    /// `assets/<sha256>/cog.tif`, so identical content is shared rather than
    /// copied beside the original.
    pub fn source_dir(&self, sha256: &str) -> PathBuf {
        self.root.join("sources").join(sha256)
    }

    pub fn source_original(&self, sha256: &str) -> PathBuf {
        self.source_dir(sha256).join("original")
    }

    pub fn source_manifest(&self, sha256: &str) -> PathBuf {
        self.source_dir(sha256).join("manifest.json")
    }

    /// Prepared per-layer generation mosaics, staging dirs and coverage masks.
    pub fn layer_pipeline_dir(&self, layer_id: &str) -> PathBuf {
        self.prepared_dir().join("layers").join(layer_id)
    }

    /// Prepared analysis outputs, staging dirs and quality masks.
    pub fn analysis_pipeline_dir(&self, definition_id: &str) -> PathBuf {
        self.prepared_dir().join("analysis").join(definition_id)
    }

    pub fn prepared_dir(&self) -> PathBuf {
        self.root.join("prepared")
    }

    pub fn display_dir(&self) -> PathBuf {
        self.root.join("display")
    }

    /// Bounded display tile pyramid for one published entity generation.
    pub fn display_generation_dir(
        &self,
        entity_kind: &str,
        entity_id: &str,
        generation_id: &str,
        style: &str,
    ) -> PathBuf {
        self.display_dir()
            .join(entity_kind)
            .join(entity_id)
            .join(generation_id)
            .join(style)
    }

    /// Published display derivatives: immutable, content-keyed tiled COGs the
    /// WebView reads through the scoped asset protocol. Regenerable, never
    /// numeric authority.
    pub fn display_cog_dir(&self) -> PathBuf {
        self.root.join("display-cog")
    }

    /// Derivatives being written; outside the asset scope so a partial file is
    /// never readable. A file is renamed into `display_cog_dir` only once complete.
    pub fn display_cog_staging_dir(&self) -> PathBuf {
        self.root.join("display-cog-staging")
    }

    pub fn jobs_dir(&self) -> PathBuf {
        self.root.join("jobs")
    }

    /// Per-job scratch directory; removed when the job settles.
    pub fn job_dir(&self, job_id: &str) -> PathBuf {
        self.jobs_dir().join(job_id)
    }
}

/// Fail unless `directory` can hold `required_bytes` more data.
///
/// `what` names the work the requirement belongs to so a failed job reports
/// which output could not be safely written. An unreadable capacity is an
/// error, never a silent pass: guessing here is what produces truncated
/// numeric outputs.
pub(crate) fn require_free_space(
    directory: &Path,
    required_bytes: u64,
    what: &str,
) -> Result<(), String> {
    let available = available_bytes(directory)?;
    if available < required_bytes {
        return Err(format!(
            "{what} needs at least {} MiB ({required_bytes} bytes) free in {}, but only {} MiB ({available} bytes) is available",
            required_bytes / (1024 * 1024),
            directory.display(),
            available / (1024 * 1024),
        ));
    }
    Ok(())
}

/// Free bytes available to this process on the filesystem holding `directory`.
///
/// This is a measurement, not a reservation: another process can consume the
/// space immediately afterwards, so every caller still propagates ordinary
/// write errors and rechecks between bounded writes.
pub(crate) fn available_bytes(directory: &Path) -> Result<u64, String> {
    #[cfg(test)]
    {
        if let Some(available) = capacity_probe::observed() {
            return Ok(available);
        }
    }
    platform_available_bytes(directory).map_err(|error| {
        format!(
            "Cannot verify free space in {}: {error}",
            directory.display()
        )
    })
}

#[cfg(unix)]
// `statvfs` fields differ in width across unix targets, so each one is widened
// explicitly rather than compared in its native type.
#[allow(clippy::unnecessary_cast)]
fn platform_available_bytes(directory: &Path) -> Result<u64, std::io::Error> {
    use std::os::unix::ffi::OsStrExt as _;
    let mut path = directory.as_os_str().as_bytes().to_vec();
    path.push(0);
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a NUL-terminated byte string and `stats` is valid
    // writable memory for one `statvfs`; the call is checked before use.
    let status = unsafe { libc::statvfs(path.as_ptr().cast(), stats.as_mut_ptr()) };
    if status != 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: a zero return from `statvfs` initializes the whole struct.
    let stats = unsafe { stats.assume_init() };
    Ok((stats.f_bavail as u64).saturating_mul(stats.f_frsize as u64))
}

#[cfg(windows)]
fn platform_available_bytes(directory: &Path) -> Result<u64, std::io::Error> {
    use std::os::windows::ffi::OsStrExt as _;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut path: Vec<u16> = directory.as_os_str().encode_wide().collect();
    path.push(0);
    let mut available = 0u64;
    // SAFETY: `path` is NUL-terminated and `available` is valid writable
    // memory; the returned status is checked before the value is used.
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(available)
}

#[cfg(not(any(unix, windows)))]
fn platform_available_bytes(_directory: &Path) -> Result<u64, std::io::Error> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "this platform has no free-space facility",
    ))
}

fn self_sources_dir(root: &Path) -> PathBuf {
    root.join("sources")
}

fn self_prepared_dir(root: &Path) -> PathBuf {
    root.join("prepared")
}

fn self_display_dir(root: &Path) -> PathBuf {
    root.join("display")
}

/// Test-only seam for the capacity observation.
///
/// Tests that must exercise a specific budget override the observation for
/// their own thread instead of filling a real filesystem. Only the
/// observation is replaced; the budget decision under test stays production
/// code, and nothing in a production build reads this.
#[cfg(test)]
pub(crate) mod capacity_probe {
    use std::cell::Cell;

    thread_local! {
        static OBSERVED: Cell<Option<u64>> = const { Cell::new(None) };
    }

    pub(crate) fn observed() -> Option<u64> {
        OBSERVED.with(Cell::get)
    }

    pub(crate) fn set(available: Option<u64>) {
        OBSERVED.with(|slot| slot.set(available));
    }

    /// Override the observed capacity until the guard is dropped.
    pub(crate) fn override_available(available: u64) -> Guard {
        set(Some(available));
        Guard
    }

    pub(crate) struct Guard;

    impl Drop for Guard {
        fn drop(&mut self) {
            set(None);
        }
    }
}
