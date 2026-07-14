#![cfg(target_os = "windows")]
//! Windows native platform support for Canopi.
//!
//! Provides platform-specific adapters for:
//! - PNG export with DPI scaling (Windows Imaging Component / Direct2D)
//! - PDF export with layout (XPS-to-PDF or DirectWrite)
//!
//! High-DPI PNG and PDF rendering currently return explicit stub errors.
//! The `Platform` trait impl lives in `desktop/src/platform/mod.rs` (same
//! pattern as lib-c) to avoid circular dependencies.

pub mod pdf_export;
pub mod png_export;

/// Marker struct for Windows platform capabilities.
///
/// Does not implement `Platform` directly (that lives in the desktop crate
/// to avoid circular deps). The desktop implementation delegates through
/// this crate's PNG and PDF export modules.
pub struct WindowsPlatform;
