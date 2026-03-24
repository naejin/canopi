use common_types::design::{AutosaveEntry, CanopiFile};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

/// Returns (and creates if needed) the autosave directory: `{app_data_dir}/autosave/`.
pub fn autosave_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
        .join("autosave");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create autosave dir {}: {e}", dir.display()))?;
    Ok(dir)
}

/// Derive a stable filename stem from the design's save path.
///
/// Uses a simple DJB2 hash so the stem is constant across calls for the same
/// path (letting us overwrite previous autosaves for the same file rather than
/// accumulating duplicates per-path).
fn stem_for_path(design_path: &str) -> String {
    let hash = design_path
        .bytes()
        .fold(5381u64, |h, b| h.wrapping_mul(33).wrapping_add(b as u64));
    format!("{hash:016x}")
}

/// Current UTC timestamp as a compact string suitable for use in a filename.
fn timestamp_filename() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}


/// Save `content` to the autosave directory.
///
/// - If `design_path` is `Some`, the filename is derived from a hash of the
///   path so repeated autosaves overwrite the previous one for that file.
/// - If `design_path` is `None`, the stem is `"untitled"` plus a timestamp.
/// - After writing, prune to keep at most 5 autosave files (oldest removed first).
pub fn autosave(
    app: &AppHandle,
    content: &CanopiFile,
    design_path: Option<&str>,
) -> Result<(), String> {
    let dir = autosave_dir(app)?;

    let filename = match design_path {
        Some(p) => format!("{}.canopi", stem_for_path(p)),
        None => format!("untitled_{}.canopi", timestamp_filename()),
    };
    let dest = dir.join(&filename);

    let json = serde_json::to_string(content)
        .map_err(|e| format!("Failed to serialize design for autosave: {e}"))?;
    // Write atomically: write to a .tmp sidecar, then rename into place so a
    // mid-write crash never leaves a corrupt autosave file.
    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, &json)
        .map_err(|e| format!("Failed to write autosave tmp {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &dest)
        .map_err(|e| format!("Failed to commit autosave to {}: {e}", dest.display()))?;

    prune_autosaves(&dir, 5);

    Ok(())
}

/// Remove the oldest autosave files when there are more than `max_keep`.
fn prune_autosaves(dir: &std::path::Path, max_keep: usize) {
    let mut entries: Vec<(std::time::SystemTime, PathBuf)> = match std::fs::read_dir(dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |x| x == "canopi"))
            .filter_map(|e| {
                let mtime = e.metadata().ok()?.modified().ok()?;
                Some((mtime, e.path()))
            })
            .collect(),
        Err(_) => return,
    };

    if entries.len() <= max_keep {
        return;
    }

    // Sort oldest first.
    entries.sort_by_key(|(t, _)| *t);

    for (_, path) in &entries[..entries.len() - max_keep] {
        if let Err(e) = std::fs::remove_file(path) {
            tracing::warn!("Failed to prune autosave {}: {e}", path.display());
        }
    }
}

/// List all autosave files available for crash recovery.
pub fn list_autosaves(app: &AppHandle) -> Result<Vec<AutosaveEntry>, String> {
    let dir = autosave_dir(app)?;

    let mut entries: Vec<(std::time::SystemTime, AutosaveEntry)> =
        match std::fs::read_dir(&dir) {
            Ok(rd) => rd
                .filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map_or(false, |x| x == "canopi"))
                .filter_map(|e| {
                    let path = e.path();
                    let mtime = e.metadata().ok()?.modified().ok()?;

                    // Try to read the name from the file; fall back to filename.
                    let name = read_design_name(&path).unwrap_or_else(|| {
                        path.file_stem()
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "Unknown".into())
                    });

                    let saved_at = mtime_to_iso(mtime);

                    Some((
                        mtime,
                        AutosaveEntry {
                            path: path.to_string_lossy().into_owned(),
                            name,
                            saved_at,
                        },
                    ))
                })
                .collect(),
            Err(e) => {
                return Err(format!(
                    "Failed to read autosave dir {}: {e}",
                    dir.display()
                ))
            }
        };

    // Sort newest first for display.
    entries.sort_by(|a, b| b.0.cmp(&a.0));

    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}

/// Load a previously autosaved file for crash recovery.
pub fn recover_autosave(app: &AppHandle, autosave_path: &str) -> Result<CanopiFile, String> {
    let dir = autosave_dir(app)?;
    let path = PathBuf::from(autosave_path);

    // Canonicalize both paths before comparing so that symlinks and `..`
    // components in the caller-supplied path cannot escape the autosave dir.
    let canonical_dir = dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve autosave dir: {e}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve autosave path: {e}"))?;

    if !canonical_path.starts_with(&canonical_dir) {
        return Err(format!(
            "Autosave path {} is not within the autosave directory",
            path.display()
        ));
    }

    crate::design::format::load_from_file(&canonical_path)
}

/// Attempt to read the `name` field from a design file without full deserialization.
fn read_design_name(path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&content).ok()?;
    value.get("name")?.as_str().map(|s| s.to_owned())
}

/// Convert a `SystemTime` to an ISO 8601 UTC string.
fn mtime_to_iso(t: std::time::SystemTime) -> String {
    use std::time::UNIX_EPOCH;
    let secs = t.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    crate::design::unix_to_iso8601(secs)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stem_for_path_is_stable() {
        let a = stem_for_path("/home/user/garden.canopi");
        let b = stem_for_path("/home/user/garden.canopi");
        assert_eq!(a, b);
    }

    #[test]
    fn test_stem_for_path_differs_for_different_paths() {
        let a = stem_for_path("/home/user/garden.canopi");
        let b = stem_for_path("/home/user/other.canopi");
        assert_ne!(a, b);
    }

    #[test]
    fn test_stem_for_path_is_16_hex_chars() {
        let stem = stem_for_path("/any/path");
        assert_eq!(stem.len(), 16);
        assert!(stem.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
