use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const TILE_FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_TILE_BYTES: u64 = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileDownloadProgress {
    pub downloaded: u32,
    pub total: u32,
    pub current_zoom: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OfflineStatus {
    pub available: bool,
    pub bbox: Option<[f64; 4]>,
    pub min_zoom: Option<u32>,
    pub max_zoom: Option<u32>,
    pub tile_count: u32,
    pub size_bytes: u64,
}

/// Manifest stored alongside tiles to track what's been downloaded.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct TileManifest {
    bbox: [f64; 4],
    min_zoom: u32,
    max_zoom: u32,
    tile_count: u32,
    tile_url_template: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Get the tiles directory under the app data dir.
fn tiles_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("tiles");
    Ok(dir)
}

/// Read the manifest file if it exists.
fn read_manifest(tiles_root: &Path) -> Option<TileManifest> {
    let manifest_path = tiles_root.join("manifest.json");
    let data = fs::read_to_string(&manifest_path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Write the manifest file.
fn write_manifest(tiles_root: &Path, manifest: &TileManifest) -> Result<(), String> {
    let manifest_path = tiles_root.join("manifest.json");
    let data = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;
    fs::write(&manifest_path, data).map_err(|e| format!("Failed to write manifest: {e}"))?;
    Ok(())
}

/// Convert lat/lon bounding box to tile x/y ranges for a given zoom level.
/// bbox = [west, south, east, north]
fn bbox_to_tile_range(bbox: &[f64; 4], zoom: u32) -> (u32, u32, u32, u32) {
    let n = 2_u32.pow(zoom);
    let nf = n as f64;

    // Longitude to tile X
    let x_min = ((bbox[0] + 180.0) / 360.0 * nf).floor() as u32;
    let x_max = ((bbox[2] + 180.0) / 360.0 * nf).floor() as u32;

    // Latitude to tile Y (Mercator)
    let lat_rad_south = bbox[1].to_radians();
    let lat_rad_north = bbox[3].to_radians();

    let y_min =
        ((1.0 - lat_rad_north.tan().asinh() / std::f64::consts::PI) / 2.0 * nf).floor() as u32;
    let y_max =
        ((1.0 - lat_rad_south.tan().asinh() / std::f64::consts::PI) / 2.0 * nf).floor() as u32;

    // Clamp
    let x_min = x_min.min(n.saturating_sub(1));
    let x_max = x_max.min(n.saturating_sub(1));
    let y_min = y_min.min(n.saturating_sub(1));
    let y_max = y_max.min(n.saturating_sub(1));

    (x_min, x_max, y_min, y_max)
}

/// Count total tiles to download for a bbox and zoom range.
fn count_tiles(bbox: &[f64; 4], min_zoom: u32, max_zoom: u32) -> u32 {
    let mut total = 0u32;
    for z in min_zoom..=max_zoom {
        let (x_min, x_max, y_min, y_max) = bbox_to_tile_range(bbox, z);
        let x_count = x_max.saturating_sub(x_min) + 1;
        let y_count = y_max.saturating_sub(y_min) + 1;
        total = total.saturating_add(x_count * y_count);
    }
    total
}

/// Calculate total size of all files in the tiles directory (recursively).
fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let ft = entry.file_type();
            if let Ok(ft) = ft {
                if ft.is_file() {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                } else if ft.is_dir() {
                    total += dir_size(&entry.path());
                }
            }
        }
    }
    total
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
    crate::blocking::run_blocking("tile download", move || {
        download_tiles_blocking(app, bbox, min_zoom, max_zoom)
    })
    .await
}

fn download_tiles_blocking(
    app: AppHandle,
    bbox: [f64; 4],
    min_zoom: u32,
    max_zoom: u32,
) -> Result<(), String> {
    // Validate inputs
    if min_zoom > max_zoom {
        return Err("min_zoom must be <= max_zoom".to_string());
    }
    if max_zoom > 18 {
        return Err("max_zoom must be <= 18".to_string());
    }
    if bbox[0] >= bbox[2] || bbox[1] >= bbox[3] {
        return Err("Invalid bounding box: west < east and south < north required".to_string());
    }

    let total = count_tiles(&bbox, min_zoom, max_zoom);
    if total > 50_000 {
        return Err(format!(
            "Too many tiles ({total}). Reduce zoom range or bounding box area."
        ));
    }

    let tiles_root = tiles_dir(&app)?;

    // Clean existing tiles before a fresh download
    if tiles_root.exists() {
        fs::remove_dir_all(&tiles_root).map_err(|e| format!("Failed to clear old tiles: {e}"))?;
    }
    fs::create_dir_all(&tiles_root).map_err(|e| format!("Failed to create tiles dir: {e}"))?;

    let tile_url_template = "https://tile.openstreetmap.org/{z}/{x}/{y}.png".to_string();

    let mut downloaded = 0u32;

    for z in min_zoom..=max_zoom {
        let (x_min, x_max, y_min, y_max) = bbox_to_tile_range(&bbox, z);

        // Create zoom level directory
        let z_dir = tiles_root.join(z.to_string());
        fs::create_dir_all(&z_dir).map_err(|e| format!("Failed to create zoom dir: {e}"))?;

        for x in x_min..=x_max {
            let x_dir = z_dir.join(x.to_string());
            fs::create_dir_all(&x_dir).map_err(|e| format!("Failed to create x dir: {e}"))?;

            for y in y_min..=y_max {
                let url = tile_url_template
                    .replace("{z}", &z.to_string())
                    .replace("{x}", &x.to_string())
                    .replace("{y}", &y.to_string());

                let tile_path = x_dir.join(format!("{y}.png"));

                // Download the tile
                let persisted = match crate::http::build_get_request(
                    &url,
                    "Canopi/1.0",
                    std::time::Duration::from_secs(TILE_FETCH_TIMEOUT_SECS),
                )
                .call()
                {
                    Ok(mut response) => {
                        match crate::http::read_limited_bytes(
                            &mut response,
                            MAX_TILE_BYTES,
                            "tile body",
                        ) {
                            Ok(bytes) => {
                                if let Err(e) = fs::write(&tile_path, &bytes) {
                                    tracing::warn!("Failed to write tile z={z} x={x} y={y}: {e}");
                                    false
                                } else {
                                    true
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Failed to read tile z={z} x={x} y={y}: {e}");
                                false
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Failed to download tile z={z} x={x} y={y}: {e}");
                        // Continue with other tiles — partial download is acceptable
                        false
                    }
                };

                if persisted {
                    downloaded += 1;
                }

                // Emit progress event every 10 tiles (or on first/last)
                if downloaded == 1 || downloaded == total || downloaded.is_multiple_of(10) {
                    let _ = app.emit(
                        "tile-download-progress",
                        TileDownloadProgress {
                            downloaded,
                            total,
                            current_zoom: z,
                        },
                    );
                }
            }
        }
    }

    // Write manifest
    let manifest = TileManifest {
        bbox,
        min_zoom,
        max_zoom,
        tile_count: downloaded,
        tile_url_template,
    };
    write_manifest(&tiles_root, &manifest)?;

    // Emit completion event
    let _ = app.emit(
        "tile-download-progress",
        TileDownloadProgress {
            downloaded,
            total,
            current_zoom: max_zoom,
        },
    );

    tracing::info!(
        "Tile download complete: {downloaded} tiles, bbox={bbox:?}, z={min_zoom}-{max_zoom}"
    );

    Ok(())
}

/// Read a single tile from the local tile cache.
/// Returns raw PNG bytes as a base64-encoded string (for frontend consumption).
#[tauri::command]
pub fn get_tile(app: AppHandle, z: u32, x: u32, y: u32) -> Result<Vec<u8>, String> {
    let tiles_root = tiles_dir(&app)?;
    let tile_path = tiles_root.join(format!("{z}/{x}/{y}.png"));

    if !tile_path.exists() {
        return Err(format!("Tile not found: z={z} x={x} y={y}"));
    }

    fs::read(&tile_path).map_err(|e| format!("Failed to read tile z={z} x={x} y={y}: {e}"))
}

/// Check if offline tiles are available and return status info.
#[tauri::command]
pub fn get_offline_status(app: AppHandle) -> Result<OfflineStatus, String> {
    let tiles_root = tiles_dir(&app)?;

    if !tiles_root.exists() {
        return Ok(OfflineStatus {
            available: false,
            bbox: None,
            min_zoom: None,
            max_zoom: None,
            tile_count: 0,
            size_bytes: 0,
        });
    }

    match read_manifest(&tiles_root) {
        Some(manifest) => {
            let size_bytes = dir_size(&tiles_root);
            Ok(OfflineStatus {
                available: true,
                bbox: Some(manifest.bbox),
                min_zoom: Some(manifest.min_zoom),
                max_zoom: Some(manifest.max_zoom),
                tile_count: manifest.tile_count,
                size_bytes,
            })
        }
        None => Ok(OfflineStatus {
            available: false,
            bbox: None,
            min_zoom: None,
            max_zoom: None,
            tile_count: 0,
            size_bytes: 0,
        }),
    }
}

/// Remove all offline tiles and the manifest.
#[tauri::command]
pub fn remove_offline_tiles(app: AppHandle) -> Result<(), String> {
    let tiles_root = tiles_dir(&app)?;

    if tiles_root.exists() {
        fs::remove_dir_all(&tiles_root)
            .map_err(|e| format!("Failed to remove offline tiles: {e}"))?;
        tracing::info!("Offline tiles removed");
    }

    Ok(())
}
