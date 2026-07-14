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

// ── Error type ──────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum PlatformError {
    /// Feature not available on this platform.
    #[allow(dead_code)]
    NotImplemented,
    /// Export (PNG/PDF) failed.
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

    /// Export design as PDF with layout metadata.
    fn export_pdf(
        &self,
        snapshot: &CanvasSnapshot,
        layout: &PrintLayout,
    ) -> Result<Vec<u8>, PlatformError>;
}

// ── Stub (all platforms, fallback) ──────────────────────────────────────────

/// Returns `PlatformError::NotImplemented` for snapshot exports.
#[allow(dead_code)]
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

        fn export_pdf(
            &self,
            snapshot: &CanvasSnapshot,
            layout: &PrintLayout,
        ) -> Result<Vec<u8>, PlatformError> {
            lib_c::pdf_export::render_pdf(
                &snapshot.png_data,
                snapshot.width,
                snapshot.height,
                lib_c::pdf_export::PdfPageLayout {
                    page_width_mm: layout.page_width_mm,
                    page_height_mm: layout.page_height_mm,
                    margin_mm: layout.margin_mm,
                    title: &layout.title,
                    scale_text: &layout.scale_text,
                    include_legend: layout.include_legend,
                    include_plant_schedule: layout.include_plant_schedule,
                },
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
