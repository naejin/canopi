use tauri::{AppHandle, Emitter, Manager};

pub type OfflineStatus = crate::services::tiles::OfflineStatus;

fn resolve_tiles_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("tiles"))
}

// ---------------------------------------------------------------------------
// IPC commands
// ---------------------------------------------------------------------------

/// Download tiles for the given bounding box and zoom range.
/// Uses OpenStreetMap raster tiles (same as the online source).
/// Emits `tile-download-progress` events during download.
#[tauri::command]
pub async fn download_tiles(
    app: AppHandle,
    bbox: [f64; 4],
    min_zoom: u32,
    max_zoom: u32,
) -> Result<(), String> {
    let tiles_root = resolve_tiles_root(&app)?;
    crate::blocking::run_blocking("tile download", move || {
        crate::services::tiles::download_tiles_blocking(&tiles_root, bbox, min_zoom, max_zoom, |progress| {
            let _ = app.emit("tile-download-progress", progress);
        })
    })
    .await
}

/// Read a single tile from the local tile cache.
/// Returns raw PNG bytes as a base64-encoded string (for frontend consumption).
#[tauri::command]
pub fn get_tile(app: AppHandle, z: u32, x: u32, y: u32) -> Result<Vec<u8>, String> {
    let tiles_root = resolve_tiles_root(&app)?;
    crate::services::tiles::get_tile(&tiles_root, z, x, y)
}

/// Check if offline tiles are available and return status info.
#[tauri::command]
pub fn get_offline_status(app: AppHandle) -> Result<OfflineStatus, String> {
    let tiles_root = resolve_tiles_root(&app)?;
    crate::services::tiles::get_offline_status(&tiles_root)
}

/// Remove all offline tiles and the manifest.
#[tauri::command]
pub fn remove_offline_tiles(app: AppHandle) -> Result<(), String> {
    let tiles_root = resolve_tiles_root(&app)?;
    crate::services::tiles::remove_offline_tiles(&tiles_root)
}
