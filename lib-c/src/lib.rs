#![cfg(target_os = "linux")]
//! Linux native platform support for Canopi.
//!
//! Provides:
//! - PNG export with DPI scaling (Cairo)
//! - PDF export with layout (Cairo PdfSurface)

pub mod pdf_export;
pub mod png_export;

/// Marker struct for Linux platform capabilities.
///
/// Does not implement `Platform` directly (that lives in the desktop crate
/// to avoid circular deps). The desktop implementation delegates through
/// this crate's PNG and PDF export modules.
pub struct LinuxPlatform;
