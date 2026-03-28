#![cfg(target_os = "windows")]
//! Windows native platform support for Canopi.
//!
//! Will provide:
//! - PNG export with DPI scaling (Windows Imaging Component / Direct2D)
//! - PDF export with layout (XPS-to-PDF or DirectWrite)
//! - File watching (ReadDirectoryChangesW)
//! - Thumbnail generation for Explorer previews
//!
//! Currently all methods return stub errors. The `Platform` trait impl lives
//! in `desktop/src/platform/mod.rs` (same pattern as lib-c) to avoid circular
//! dependencies.

pub mod png_export;
pub mod pdf_export;
pub mod file_watcher;

/// Marker struct for Windows platform capabilities.
///
/// Does not implement `Platform` directly (that lives in the desktop crate
/// to avoid circular deps). The desktop crate's `platform/mod.rs` bridges
/// this struct's associated functions to the `Platform` trait.
pub struct WindowsPlatform;
