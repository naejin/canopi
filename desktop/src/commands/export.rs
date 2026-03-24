// ---------------------------------------------------------------------------
// Export / Import commands — NO file dialogs here.
// Dialogs run in the frontend (JS) to avoid GTK deadlock on Linux.
// Rust only handles file I/O — the frontend passes the chosen path.
// ---------------------------------------------------------------------------

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
    std::fs::write(&path, &data)
        .map_err(|e| format!("Failed to write to {path}: {e}"))?;
    tracing::info!("Exported binary file to {path}");
    Ok(path)
}

/// Read a file and return `(bytes, filename)`. Used for background image import.
/// The frontend shows the open dialog and passes the chosen path.
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<(Vec<u8>, String), String> {
    let p = std::path::Path::new(&path);
    let data = std::fs::read(p)
        .map_err(|e| format!("Failed to read {path}: {e}"))?;
    let filename = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();
    tracing::info!("Read file '{}' ({} bytes)", filename, data.len());
    Ok((data, filename))
}
