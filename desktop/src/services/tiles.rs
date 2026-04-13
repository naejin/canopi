use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const TILE_FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_TILE_BYTES: u64 = 10 * 1024 * 1024;
const OSM_TILE_URL_TEMPLATE: &str = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_USER_AGENT: &str = "Canopi/1.0";
static DOWNLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileDownloadProgress {
    pub downloaded: u32,
    pub total: u32,
    pub current_zoom: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OfflineStatus {
    pub available: bool,
    pub bbox: Option<[f64; 4]>,
    pub min_zoom: Option<u32>,
    pub max_zoom: Option<u32>,
    pub tile_count: u32,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TileManifest {
    bbox: [f64; 4],
    min_zoom: u32,
    max_zoom: u32,
    tile_count: u32,
    tile_url_template: String,
}

pub fn get_tile(tiles_root: &Path, z: u32, x: u32, y: u32) -> Result<Vec<u8>, String> {
    let tile_path = tile_path(tiles_root, z, x, y);
    if !tile_path.exists() {
        return Err(format!("Tile not found: z={z} x={x} y={y}"));
    }

    fs::read(&tile_path).map_err(|e| format!("Failed to read tile z={z} x={x} y={y}: {e}"))
}

pub fn get_offline_status(tiles_root: &Path) -> Result<OfflineStatus, String> {
    offline_status_for_root(tiles_root)
}

pub fn remove_offline_tiles(tiles_root: &Path) -> Result<(), String> {
    remove_offline_tiles_in_dir(tiles_root)
}

pub fn download_tiles_blocking<F>(
    tiles_root: &Path,
    bbox: [f64; 4],
    min_zoom: u32,
    max_zoom: u32,
    emit_progress: F,
) -> Result<(), String>
where
    F: FnMut(TileDownloadProgress),
{
    download_tiles_blocking_with_fetch(
        tiles_root,
        bbox,
        min_zoom,
        max_zoom,
        emit_progress,
        fetch_tile_bytes,
    )
}

fn download_tiles_blocking_with_fetch<F, D>(
    tiles_root: &Path,
    bbox: [f64; 4],
    min_zoom: u32,
    max_zoom: u32,
    mut emit_progress: F,
    mut download_tile_bytes: D,
) -> Result<(), String>
where
    F: FnMut(TileDownloadProgress),
    D: FnMut(u32, u32, u32) -> Result<Vec<u8>, String>,
{
    validate_download_request(&bbox, min_zoom, max_zoom)?;

    let total = count_tiles(&bbox, min_zoom, max_zoom);
    if total > 50_000 {
        return Err(format!(
            "Too many tiles ({total}). Reduce zoom range or bounding box area."
        ));
    }

    let staging_root = prepare_staging_root(tiles_root)?;
    let mut downloaded = 0u32;

    for z in min_zoom..=max_zoom {
        let (x_min, x_max, y_min, y_max) = bbox_to_tile_range(&bbox, z);
        let z_dir = staging_root.join(z.to_string());
        fs::create_dir_all(&z_dir).map_err(|e| format!("Failed to create zoom dir: {e}"))?;

        for x in x_min..=x_max {
            let x_dir = z_dir.join(x.to_string());
            fs::create_dir_all(&x_dir).map_err(|e| format!("Failed to create x dir: {e}"))?;

            for y in y_min..=y_max {
                let persisted = download_tile_into(
                    &x_dir.join(format!("{y}.png")),
                    z,
                    x,
                    y,
                    &mut download_tile_bytes,
                );
                if persisted {
                    downloaded += 1;
                }

                if downloaded == 1 || downloaded == total || downloaded.is_multiple_of(10) {
                    emit_progress(TileDownloadProgress {
                        downloaded,
                        total,
                        current_zoom: z,
                    });
                }
            }
        }
    }

    if downloaded == 0 {
        let _ = fs::remove_dir_all(&staging_root);
        return Err("Failed to download any tiles".to_string());
    }

    write_manifest(
        &staging_root,
        &TileManifest {
            bbox,
            min_zoom,
            max_zoom,
            tile_count: downloaded,
            tile_url_template: OSM_TILE_URL_TEMPLATE.to_string(),
        },
    )?;

    replace_tiles_root(tiles_root, &staging_root)?;

    emit_progress(TileDownloadProgress {
        downloaded,
        total,
        current_zoom: max_zoom,
    });

    tracing::info!(
        "Tile download complete: {downloaded} tiles, bbox={bbox:?}, z={min_zoom}-{max_zoom}"
    );

    Ok(())
}

fn tile_path(tiles_root: &Path, z: u32, x: u32, y: u32) -> PathBuf {
    tiles_root.join(format!("{z}/{x}/{y}.png"))
}

fn tile_url(z: u32, x: u32, y: u32) -> String {
    OSM_TILE_URL_TEMPLATE
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string())
}

fn read_manifest(tiles_root: &Path) -> Option<TileManifest> {
    let manifest_path = tiles_root.join("manifest.json");
    let data = fs::read_to_string(&manifest_path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_manifest(tiles_root: &Path, manifest: &TileManifest) -> Result<(), String> {
    let manifest_path = tiles_root.join("manifest.json");
    let data = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;
    fs::write(&manifest_path, data).map_err(|e| format!("Failed to write manifest: {e}"))?;
    Ok(())
}

fn bbox_to_tile_range(bbox: &[f64; 4], zoom: u32) -> (u32, u32, u32, u32) {
    let n = 2_u32.pow(zoom);
    let nf = n as f64;

    let x_min = ((bbox[0] + 180.0) / 360.0 * nf).floor() as u32;
    let x_max = ((bbox[2] + 180.0) / 360.0 * nf).floor() as u32;

    let lat_rad_south = bbox[1].to_radians();
    let lat_rad_north = bbox[3].to_radians();

    let y_min =
        ((1.0 - lat_rad_north.tan().asinh() / std::f64::consts::PI) / 2.0 * nf).floor() as u32;
    let y_max =
        ((1.0 - lat_rad_south.tan().asinh() / std::f64::consts::PI) / 2.0 * nf).floor() as u32;

    (
        x_min.min(n.saturating_sub(1)),
        x_max.min(n.saturating_sub(1)),
        y_min.min(n.saturating_sub(1)),
        y_max.min(n.saturating_sub(1)),
    )
}

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

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    total += entry.metadata().map(|m| m.len()).unwrap_or(0);
                } else if file_type.is_dir() {
                    total += dir_size(&entry.path());
                }
            }
        }
    }
    total
}

fn validate_download_request(bbox: &[f64; 4], min_zoom: u32, max_zoom: u32) -> Result<(), String> {
    if min_zoom > max_zoom {
        return Err("min_zoom must be <= max_zoom".to_string());
    }
    if max_zoom > 18 {
        return Err("max_zoom must be <= 18".to_string());
    }
    if bbox[0] >= bbox[2] || bbox[1] >= bbox[3] {
        return Err("Invalid bounding box: west < east and south < north required".to_string());
    }
    Ok(())
}

fn prepare_tiles_root(tiles_root: &Path) -> Result<(), String> {
    if tiles_root.exists() {
        fs::remove_dir_all(tiles_root).map_err(|e| format!("Failed to clear old tiles: {e}"))?;
    }
    fs::create_dir_all(tiles_root).map_err(|e| format!("Failed to create tiles dir: {e}"))?;
    Ok(())
}

fn fetch_tile_bytes(z: u32, x: u32, y: u32) -> Result<Vec<u8>, String> {
    let url = tile_url(z, x, y);
    let mut response = crate::http::build_get_request(
        &url,
        TILE_USER_AGENT,
        std::time::Duration::from_secs(TILE_FETCH_TIMEOUT_SECS),
    )
    .call()
    .map_err(|error| format!("Failed to download tile z={z} x={x} y={y}: {error}"))?;

    crate::http::read_limited_bytes(&mut response, MAX_TILE_BYTES, "tile body")
        .map_err(|error| format!("Failed to read tile z={z} x={x} y={y}: {error}"))
}

fn download_tile_into<D>(
    tile_path: &Path,
    z: u32,
    x: u32,
    y: u32,
    download_tile_bytes: &mut D,
) -> bool
where
    D: FnMut(u32, u32, u32) -> Result<Vec<u8>, String>,
{
    match download_tile_bytes(z, x, y) {
        Ok(bytes) => {
            if let Err(error) = fs::write(tile_path, &bytes) {
                tracing::warn!("Failed to write tile z={z} x={x} y={y}: {error}");
                false
            } else {
                true
            }
        }
        Err(error) => {
            tracing::warn!("{error}");
            false
        }
    }
}

fn offline_status_for_root(tiles_root: &Path) -> Result<OfflineStatus, String> {
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

    match read_manifest(tiles_root) {
        Some(manifest) => Ok(OfflineStatus {
            available: true,
            bbox: Some(manifest.bbox),
            min_zoom: Some(manifest.min_zoom),
            max_zoom: Some(manifest.max_zoom),
            tile_count: manifest.tile_count,
            size_bytes: dir_size(tiles_root),
        }),
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

fn remove_offline_tiles_in_dir(tiles_root: &Path) -> Result<(), String> {
    if tiles_root.exists() {
        fs::remove_dir_all(tiles_root).map_err(|e| format!("Failed to remove offline tiles: {e}"))?;
        tracing::info!("Offline tiles removed");
    }
    Ok(())
}

fn prepare_staging_root(tiles_root: &Path) -> Result<PathBuf, String> {
    let staging_root = unique_staging_root(tiles_root);
    if let Some(parent) = staging_root.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create tiles parent dir: {e}"))?;
    }
    prepare_tiles_root(&staging_root)?;
    Ok(staging_root)
}

fn unique_staging_root(tiles_root: &Path) -> PathBuf {
    let sequence = DOWNLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = tiles_root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("tiles");
    tiles_root.with_file_name(format!("{name}.download-{stamp}-{sequence}"))
}

fn replace_tiles_root(tiles_root: &Path, staging_root: &Path) -> Result<(), String> {
    if tiles_root.exists() {
        fs::remove_dir_all(tiles_root).map_err(|e| format!("Failed to clear old tiles: {e}"))?;
    }
    fs::rename(staging_root, tiles_root)
        .map_err(|e| format!("Failed to install downloaded tiles: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        bbox_to_tile_range, count_tiles, download_tiles_blocking_with_fetch, get_tile,
        offline_status_for_root, remove_offline_tiles_in_dir, validate_download_request,
        write_manifest, OfflineStatus, TileManifest,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> std::path::PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("canopi-{label}-{stamp}"));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn bbox_to_tile_range_clamps_within_zoom_extent() {
        let (x_min, x_max, y_min, y_max) = bbox_to_tile_range(&[-180.0, -85.0, 180.0, 85.0], 2);
        assert_eq!((x_min, x_max, y_min, y_max), (0, 3, 0, 3));
    }

    #[test]
    fn count_tiles_accumulates_each_zoom_band() {
        let bbox = [-1.0, 50.0, 1.0, 52.0];
        assert!(count_tiles(&bbox, 4, 5) >= count_tiles(&bbox, 4, 4));
    }

    #[test]
    fn validates_download_request_bounds() {
        assert!(validate_download_request(&[1.0, 0.0, 2.0, 1.0], 5, 4).is_err());
        assert!(validate_download_request(&[1.0, 0.0, 2.0, 1.0], 1, 19).is_err());
        assert!(validate_download_request(&[2.0, 0.0, 1.0, 1.0], 1, 2).is_err());
        assert!(validate_download_request(&[1.0, 0.0, 2.0, 1.0], 1, 2).is_ok());
    }

    #[test]
    fn offline_status_reads_manifest_and_directory_size() {
        let root = unique_temp_dir("tiles-status");
        std::fs::create_dir_all(&root).unwrap();
        write_manifest(
            &root,
            &TileManifest {
                bbox: [-1.0, 50.0, 1.0, 52.0],
                min_zoom: 4,
                max_zoom: 6,
                tile_count: 12,
                tile_url_template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png".into(),
            },
        )
        .unwrap();
        std::fs::create_dir_all(root.join("4/1")).unwrap();
        std::fs::write(root.join("4/1/2.png"), [1, 2, 3, 4]).unwrap();

        let status = offline_status_for_root(&root).unwrap();
        assert!(status.available);
        assert_eq!(status.tile_count, 12);
        assert!(status.size_bytes >= 4);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn remove_offline_tiles_clears_directory() {
        let root = unique_temp_dir("tiles-remove");
        std::fs::create_dir_all(root.join("4/1")).unwrap();
        std::fs::write(root.join("4/1/2.png"), [1, 2, 3]).unwrap();

        remove_offline_tiles_in_dir(&root).unwrap();

        let status = offline_status_for_root(&root).unwrap();
        assert_eq!(
            status,
            OfflineStatus {
                available: false,
                bbox: None,
                min_zoom: None,
                max_zoom: None,
                tile_count: 0,
                size_bytes: 0,
            }
        );
    }

    #[test]
    fn get_tile_reads_cached_bytes() {
        let root = unique_temp_dir("tiles-get");
        std::fs::create_dir_all(root.join("4/1")).unwrap();
        std::fs::write(root.join("4/1/2.png"), [7, 8, 9]).unwrap();

        let bytes = get_tile(&root, 4, 1, 2).unwrap();
        assert_eq!(bytes, vec![7, 8, 9]);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn failed_download_preserves_existing_cache() {
        let root = unique_temp_dir("tiles-preserve");
        std::fs::create_dir_all(root.join("4/1")).unwrap();
        std::fs::write(root.join("4/1/2.png"), [1, 2, 3]).unwrap();
        write_manifest(
            &root,
            &TileManifest {
                bbox: [-1.0, 50.0, 1.0, 52.0],
                min_zoom: 4,
                max_zoom: 4,
                tile_count: 1,
                tile_url_template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png".into(),
            },
        )
        .unwrap();

        let result = download_tiles_blocking_with_fetch(
            &root,
            [-1.0, 50.0, 1.0, 52.0],
            4,
            4,
            |_| {},
            |_, _, _| Err("network down".into()),
        );

        assert!(result.is_err());
        let status = offline_status_for_root(&root).unwrap();
        assert!(status.available);
        assert_eq!(status.tile_count, 1);

        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn successful_download_replaces_cache_and_writes_manifest() {
        let root = unique_temp_dir("tiles-download");

        let mut progress_events = Vec::new();
        download_tiles_blocking_with_fetch(
            &root,
            [-1.0, 50.0, -0.5, 50.5],
            1,
            1,
            |progress| progress_events.push(progress),
            |_, _, _| Ok(vec![4, 5, 6]),
        )
        .unwrap();

        let status = offline_status_for_root(&root).unwrap();
        assert!(status.available);
        assert!(status.tile_count >= 1);
        assert!(!progress_events.is_empty());

        std::fs::remove_dir_all(&root).unwrap();
    }
}
