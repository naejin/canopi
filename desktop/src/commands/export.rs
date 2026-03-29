// ---------------------------------------------------------------------------
// Export / Import commands — NO file dialogs here.
// Dialogs run in the frontend (JS) to avoid GTK deadlock on Linux.
// Rust only handles file I/O — the frontend passes the chosen path.
// ---------------------------------------------------------------------------

use crate::platform::{self, CanvasSnapshot, Platform, PrintLayout};

/// Write `data` (UTF-8 text) to `path`. Used for SVG and CSV export.
#[tauri::command]
pub fn export_file(data: String, path: String) -> Result<String, String> {
    std::fs::write(&path, data.as_bytes())
        .map_err(|e| format!("Failed to write to {path}: {e}"))?;
    tracing::info!("Exported text file to {path}");
    Ok(path)
}

/// Write `data` (raw bytes) to `path`. Used for PNG export.
#[tauri::command]
pub fn export_binary(data: Vec<u8>, path: String) -> Result<String, String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write to {path}: {e}"))?;
    tracing::info!("Exported binary file to {path}");
    Ok(path)
}

/// Read a file and return `(bytes, filename)`. Used for background image import.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<(Vec<u8>, String), String> {
    let p = std::path::Path::new(&path);
    let data = std::fs::read(p).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    tracing::info!("Read file '{}' ({} bytes)", filename, data.len());
    Ok((data, filename))
}

// ---------------------------------------------------------------------------
// Native platform export commands (PNG at DPI, PDF with layout)
// ---------------------------------------------------------------------------

/// Export a canvas snapshot as PNG at the specified DPI.
///
/// `snapshot_base64`: base64-encoded PNG data from Konva `toDataURL`
/// `width`, `height`: logical canvas dimensions in pixels
/// `dpi`: target DPI (72 = 1x, 150, 300)
/// `path`: destination file path (chosen by frontend dialog)
#[tauri::command]
pub fn export_native_png(
    snapshot_base64: String,
    width: u32,
    height: u32,
    dpi: u32,
    path: String,
) -> Result<String, String> {
    use base64::Engine;

    let png_data = base64::engine::general_purpose::STANDARD
        .decode(&snapshot_base64)
        .map_err(|e| format!("Failed to decode base64 snapshot: {e}"))?;

    let snapshot = CanvasSnapshot {
        width,
        height,
        png_data,
    };

    let platform = platform::native_platform();
    let result = platform
        .export_png(&snapshot, dpi)
        .map_err(|e| format!("Failed to export PNG at {dpi} DPI: {e}"))?;

    std::fs::write(&path, &result).map_err(|e| format!("Failed to write PNG to {path}: {e}"))?;

    tracing::info!(
        "Exported native PNG ({dpi} DPI, {} bytes) to {path}",
        result.len()
    );
    Ok(path)
}

/// Export a canvas snapshot as PDF with the given layout.
///
/// `snapshot_base64`: base64-encoded PNG data from Konva `toDataURL`
/// `width`, `height`: logical canvas dimensions in pixels
/// Layout fields: page dimensions in mm, margins, title, etc.
/// `path`: destination file path (chosen by frontend dialog)
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri IPC currently exposes PDF export as flat named arguments"
)]
#[tauri::command]
pub fn export_native_pdf(
    snapshot_base64: String,
    width: u32,
    height: u32,
    page_width_mm: f32,
    page_height_mm: f32,
    margin_mm: f32,
    title: String,
    scale_text: String,
    include_legend: bool,
    include_plant_schedule: bool,
    path: String,
) -> Result<String, String> {
    use base64::Engine;

    let png_data = base64::engine::general_purpose::STANDARD
        .decode(&snapshot_base64)
        .map_err(|e| format!("Failed to decode base64 snapshot: {e}"))?;

    let snapshot = CanvasSnapshot {
        width,
        height,
        png_data,
    };

    let layout = PrintLayout {
        page_width_mm,
        page_height_mm,
        margin_mm,
        title,
        scale_text,
        include_legend,
        include_plant_schedule,
    };

    let platform = platform::native_platform();
    let result = platform
        .export_pdf(&snapshot, &layout)
        .map_err(|e| format!("Failed to export PDF: {e}"))?;

    std::fs::write(&path, &result).map_err(|e| format!("Failed to write PDF to {path}: {e}"))?;

    tracing::info!("Exported native PDF ({} bytes) to {path}", result.len());
    Ok(path)
}
