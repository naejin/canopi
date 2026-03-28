#![cfg(target_os = "linux")]
//! Linux native platform support for Canopi.
//!
//! Provides:
//! - PNG export with DPI scaling (Cairo)
//! - PDF export with layout (Cairo PdfSurface)
//! - File watching (inotify)
//! - XDG desktop integration

pub mod file_watcher;
pub mod pdf_export;
pub mod png_export;
pub mod xdg;

/// Marker struct for Linux platform capabilities.
///
/// Does not implement `Platform` directly (that lives in the desktop crate
/// to avoid circular deps). The desktop crate's `platform::mod.rs` bridges
/// this struct's associated functions to the `Platform` trait.
pub struct LinuxPlatform;
