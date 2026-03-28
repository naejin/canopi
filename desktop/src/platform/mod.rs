/// Platform-specific native operations.
/// Each OS implements this via its native lib (lib-swift, lib-cpp, lib-c).

use std::fmt;
use std::path::Path;

// ── Supporting types ────────────────────────────────────────────────────────

/// Raw canvas snapshot data from Konva `toDataURL`.
#[derive(Debug)]
pub struct CanvasSnapshot {
    pub width: u32,
    pub height: u32,
    /// Raw PNG bytes from the frontend canvas.
    pub png_data: Vec<u8>,
}

/// Print/PDF layout parameters.
#[derive(Debug)]
pub struct PrintLayout {
    pub page_width_mm: f32,
    pub page_height_mm: f32,
    pub margin_mm: f32,
    pub title: String,
    pub scale_text: String,
    pub include_legend: bool,
    pub include_plant_schedule: bool,
}

/// Handle returned by `watch_file`. Dropping it cancels the watch.
pub struct FileWatchHandle {
    _cancel: Option<Box<dyn FnOnce() + Send>>,
}

impl FileWatchHandle {
    pub fn new(cancel: impl FnOnce() + Send + 'static) -> Self {
        Self {
            _cancel: Some(Box::new(cancel)),
        }
    }

    /// Explicitly stop watching.
    pub fn cancel(mut self) {
        if let Some(f) = self._cancel.take() {
            f();
        }
    }
}

impl Drop for FileWatchHandle {
    fn drop(&mut self) {
        if let Some(f) = self._cancel.take() {
            f();
        }
    }
}

impl fmt::Debug for FileWatchHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("FileWatchHandle").finish()
    }
}

// ── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum PlatformError {
    /// Feature not available on this platform.
    NotImplemented,
    /// Export (PNG/PDF/thumbnail) failed.
    ExportFailed(String),
    /// File watch setup or operation failed.
    WatchFailed(String),
    /// File I/O error.
    Io(std::io::Error),
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlatformError::NotImplemented => write!(f, "Not implemented on this platform"),
            PlatformError::ExportFailed(msg) => write!(f, "Export failed: {msg}"),
            PlatformError::WatchFailed(msg) => write!(f, "Watch failed: {msg}"),
            PlatformError::Io(e) => write!(f, "IO error: {e}"),
        }
    }
}

impl std::error::Error for PlatformError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            PlatformError::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for PlatformError {
    fn from(e: std::io::Error) -> Self {
        PlatformError::Io(e)
    }
}

// ── Trait ────────────────────────────────────────────────────────────────────

pub trait Platform: Send + Sync {
    /// Export canvas snapshot as PNG at given DPI (72, 150, 300).
    /// 72 DPI = 1x (pass-through), higher DPI scales up.
    fn export_png(&self, snapshot: &CanvasSnapshot, dpi: u32) -> Result<Vec<u8>, PlatformError>;

    /// Export design as PDF with layout metadata.
    fn export_pdf(
        &self,
        snapshot: &CanvasSnapshot,
        layout: &PrintLayout,
    ) -> Result<Vec<u8>, PlatformError>;

    /// Watch a file for external modifications.
    /// Returns a handle whose drop/cancel stops the watch.
    fn watch_file(&self, path: &Path) -> Result<FileWatchHandle, PlatformError>;

    /// Generate a small PNG thumbnail (e.g. for Quick Look / file browser).
    fn generate_thumbnail(
        &self,
        snapshot: &CanvasSnapshot,
        size: u32,
    ) -> Result<Vec<u8>, PlatformError>;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/// Compute the effective DPI for a thumbnail of `size` pixels on the longest side.
/// Returns `Err` if the snapshot has zero dimensions or the computed DPI is zero.
fn thumbnail_dpi(snapshot: &CanvasSnapshot, size: u32) -> Result<u32, PlatformError> {
    let max_dim = snapshot.width.max(snapshot.height);
    if max_dim == 0 {
        return Err(PlatformError::ExportFailed(
            "Snapshot has zero dimensions".into(),
        ));
    }
    // At 72 DPI output is 1:1 with source. Scale down proportionally.
    let effective_dpi = (72.0 * size as f64 / max_dim as f64).round() as u32;
    // Cap at 72 — no upscale for thumbnails.
    let dpi = effective_dpi.min(72);
    if dpi == 0 {
        return Err(PlatformError::ExportFailed(
            "Computed thumbnail DPI is zero".into(),
        ));
    }
    Ok(dpi)
}

// ── Stub (all platforms, fallback) ──────────────────────────────────────────

/// Returns `PlatformError::NotImplemented` for every method.
pub struct StubPlatform;

impl Platform for StubPlatform {
    fn export_png(&self, _snapshot: &CanvasSnapshot, _dpi: u32) -> Result<Vec<u8>, PlatformError> {
        Err(PlatformError::NotImplemented)
    }

    fn export_pdf(
        &self,
        _snapshot: &CanvasSnapshot,
        _layout: &PrintLayout,
    ) -> Result<Vec<u8>, PlatformError> {
        Err(PlatformError::NotImplemented)
    }

    fn watch_file(&self, _path: &Path) -> Result<FileWatchHandle, PlatformError> {
        Err(PlatformError::NotImplemented)
    }

    fn generate_thumbnail(
        &self,
        _snapshot: &CanvasSnapshot,
        _size: u32,
    ) -> Result<Vec<u8>, PlatformError> {
        Err(PlatformError::NotImplemented)
    }
}

// ── Linux implementation (delegates to lib-c) ───────────────────────────────

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::*;
    use std::sync::atomic::Ordering;

    impl Platform for lib_c::LinuxPlatform {
        fn export_png(
            &self,
            snapshot: &CanvasSnapshot,
            dpi: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_c::png_export::render_png_at_dpi(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                dpi,
            )
            .map_err(PlatformError::ExportFailed)
        }

        fn export_pdf(
            &self,
            snapshot: &CanvasSnapshot,
            layout: &PrintLayout,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_c::pdf_export::render_pdf(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                layout.page_width_mm,
                layout.page_height_mm,
                layout.margin_mm,
                &layout.title,
                &layout.scale_text,
                layout.include_legend,
                layout.include_plant_schedule,
            )
            .map_err(PlatformError::ExportFailed)
        }

        fn watch_file(&self, path: &Path) -> Result<FileWatchHandle, PlatformError> {
            let (cancel_flag, join_handle) = lib_c::file_watcher::watch_file(path, |p| {
                tracing::info!("File changed externally: {}", p.display());
            })
            .map_err(PlatformError::WatchFailed)?;

            Ok(FileWatchHandle::new(move || {
                cancel_flag.store(true, Ordering::Relaxed);
                // Wait for the watcher thread to exit (within 500ms poll cycle).
                let _ = join_handle.join();
            }))
        }

        fn generate_thumbnail(
            &self,
            snapshot: &CanvasSnapshot,
            size: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            let dpi = thumbnail_dpi(snapshot, size)?;
            lib_c::png_export::render_png_at_dpi(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                dpi,
            )
            .map_err(PlatformError::ExportFailed)
        }
    }
}

// ── macOS implementation (delegates to lib-swift) ────────────────────────────

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::*;
    use std::sync::atomic::Ordering;

    impl Platform for lib_swift::MacOSPlatform {
        fn export_png(
            &self,
            snapshot: &CanvasSnapshot,
            dpi: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_swift::png_export::render_png_at_dpi(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                dpi,
            )
            .map_err(PlatformError::ExportFailed)
        }

        fn export_pdf(
            &self,
            snapshot: &CanvasSnapshot,
            layout: &PrintLayout,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_swift::pdf_export::render_pdf(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                layout.page_width_mm,
                layout.page_height_mm,
                layout.margin_mm,
                &layout.title,
                &layout.scale_text,
                layout.include_legend,
                layout.include_plant_schedule,
            )
            .map_err(PlatformError::ExportFailed)
        }

        fn watch_file(&self, path: &Path) -> Result<FileWatchHandle, PlatformError> {
            let (cancel_flag, join_handle) = lib_swift::file_watcher::watch_file(path, |p| {
                tracing::info!("File changed externally: {}", p.display());
            })
            .map_err(PlatformError::WatchFailed)?;

            Ok(FileWatchHandle::new(move || {
                cancel_flag.store(true, Ordering::Relaxed);
                let _ = join_handle.join();
            }))
        }

        fn generate_thumbnail(
            &self,
            snapshot: &CanvasSnapshot,
            size: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            let dpi = thumbnail_dpi(snapshot, size)?;
            lib_swift::png_export::render_png_at_dpi(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                dpi,
            )
            .map_err(PlatformError::ExportFailed)
        }
    }
}

// ── Windows implementation (delegates to lib-cpp) ────────────────────────────

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use std::sync::atomic::Ordering;

    impl Platform for lib_cpp::WindowsPlatform {
        fn export_png(
            &self,
            snapshot: &CanvasSnapshot,
            dpi: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_cpp::png_export::render_png_at_dpi(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                dpi,
            )
            .map_err(PlatformError::ExportFailed)
        }

        fn export_pdf(
            &self,
            snapshot: &CanvasSnapshot,
            layout: &PrintLayout,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_cpp::pdf_export::render_pdf(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                layout.page_width_mm,
                layout.page_height_mm,
                layout.margin_mm,
                &layout.title,
                &layout.scale_text,
                layout.include_legend,
                layout.include_plant_schedule,
            )
            .map_err(PlatformError::ExportFailed)
        }

        fn watch_file(&self, path: &Path) -> Result<FileWatchHandle, PlatformError> {
            let (cancel_flag, join_handle) = lib_cpp::file_watcher::watch_file(path, |p| {
                tracing::info!("File changed externally: {}", p.display());
            })
            .map_err(PlatformError::WatchFailed)?;

            Ok(FileWatchHandle::new(move || {
                cancel_flag.store(true, Ordering::Relaxed);
                let _ = join_handle.join();
            }))
        }

        fn generate_thumbnail(
            &self,
            snapshot: &CanvasSnapshot,
            size: u32,
        ) -> Result<Vec<u8>, PlatformError> {
            let dpi = thumbnail_dpi(snapshot, size)?;
            lib_cpp::png_export::render_png_at_dpi(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                dpi,
            )
            .map_err(PlatformError::ExportFailed)
        }
    }
}

// ── Conditional platform selection ──────────────────────────────────────────

#[cfg(target_os = "linux")]
pub type NativePlatform = lib_c::LinuxPlatform;

#[cfg(target_os = "macos")]
pub type NativePlatform = lib_swift::MacOSPlatform;

#[cfg(target_os = "windows")]
pub type NativePlatform = lib_cpp::WindowsPlatform;

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub type NativePlatform = StubPlatform;

/// Create a `NativePlatform` instance for the current OS.
pub fn native_platform() -> NativePlatform {
    #[cfg(target_os = "linux")]
    {
        lib_c::LinuxPlatform
    }
    #[cfg(target_os = "macos")]
    {
        lib_swift::MacOSPlatform
    }
    #[cfg(target_os = "windows")]
    {
        lib_cpp::WindowsPlatform
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        StubPlatform
    }
}
