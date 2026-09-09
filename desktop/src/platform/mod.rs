/// Platform-specific native operations.
/// Each OS implements this via its native lib (lib-swift, lib-cpp, lib-c).
use std::fmt;

// ── Supporting types ────────────────────────────────────────────────────────

/// Raw canvas snapshot data captured by the frontend renderer.
#[derive(Debug)]
pub struct CanvasSnapshot {
    pub width: u32,
    pub height: u32,
    /// Raw PNG bytes from the frontend canvas.
    pub png_data: Vec<u8>,
}

// ── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum PlatformError {
    /// Feature not available on this platform.
    #[allow(dead_code)]
    NotImplemented,
    /// PNG export failed.
    ExportFailed(String),
}

impl fmt::Display for PlatformError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PlatformError::NotImplemented => write!(f, "Not implemented on this platform"),
            PlatformError::ExportFailed(msg) => write!(f, "Export failed: {msg}"),
        }
    }
}

impl std::error::Error for PlatformError {}

// ── Trait ────────────────────────────────────────────────────────────────────

pub trait Platform: Send + Sync {
    /// Export canvas snapshot as PNG at given DPI (72, 150, 300).
    /// 72 DPI = 1x (pass-through), higher DPI scales up.
    fn export_png(&self, snapshot: &CanvasSnapshot, dpi: u32) -> Result<Vec<u8>, PlatformError>;
}

// ── Stub (all platforms, fallback) ──────────────────────────────────────────

/// Returns `PlatformError::NotImplemented` for snapshot exports.
#[allow(dead_code)]
pub struct StubPlatform;

impl Platform for StubPlatform {
    fn export_png(&self, _snapshot: &CanvasSnapshot, _dpi: u32) -> Result<Vec<u8>, PlatformError> {
        Err(PlatformError::NotImplemented)
    }
}

// ── Linux implementation (delegates to lib-c) ───────────────────────────────

#[cfg(target_os = "linux")]
mod linux_impl {
    use super::*;

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
    }
}

// ── macOS implementation (delegates to lib-swift) ────────────────────────────

#[cfg(target_os = "macos")]
mod macos_impl {
    use super::*;

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
    }
}

// ── Windows implementation (delegates to lib-cpp) ────────────────────────────

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;

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
