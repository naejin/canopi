//! Start › Recent Designs previews: plant and zone counts, ground bounds and a
//! symbolic sketch, read from each Design's file when the list is shown.
//!
//! Nothing is stored in the user database. Previews are cached in memory by
//! path, modification time and size, so an unchanged file is read once per
//! session. Logs never name a Design or its path.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, PoisonError},
    time::SystemTime,
};

use common_types::design::{RecentDesignPreview, RecentDesignSummary};

use crate::design::format::{self, DesignLoadError};

/// Files larger than this are not read for a preview; the row shows the name only.
pub(crate) const RECENT_PREVIEW_MAX_BYTES: u64 = 16 * 1024 * 1024;
/// Cached previews kept at most; Recent Designs lists 20.
const PREVIEW_CACHE_LIMIT: usize = 64;

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    modified: Option<SystemTime>,
    len: u64,
}

struct CachedPreview {
    stamp: FileStamp,
    preview: RecentDesignPreview,
}

/// Managed state: the in-memory preview cache.
#[derive(Clone, Default)]
pub struct RecentDesignPreviews {
    cache: Arc<Mutex<HashMap<String, CachedPreview>>>,
}

impl RecentDesignPreviews {
    /// Previews of `paths`, in order. Blocking file work: run it in the executor.
    pub(crate) fn previews(&self, paths: &[String]) -> Vec<RecentDesignSummary> {
        paths
            .iter()
            .map(|path| RecentDesignSummary {
                path: path.clone(),
                preview: self.preview(path),
            })
            .collect()
    }

    fn preview(&self, path: &str) -> RecentDesignPreview {
        let stamp = match std::fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => FileStamp {
                modified: metadata.modified().ok(),
                len: metadata.len(),
            },
            _ => return RecentDesignPreview::Unreadable,
        };
        if let Some(cached) = self.cached(path, stamp) {
            return cached;
        }
        let (preview, cacheable) = read_preview(Path::new(path), stamp.len);
        if cacheable {
            let mut cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
            if cache.len() >= PREVIEW_CACHE_LIMIT && !cache.contains_key(path) {
                cache.clear();
            }
            cache.insert(
                path.to_owned(),
                CachedPreview {
                    stamp,
                    preview: preview.clone(),
                },
            );
        }
        preview
    }

    fn cached(&self, path: &str, stamp: FileStamp) -> Option<RecentDesignPreview> {
        let cache = self.cache.lock().unwrap_or_else(PoisonError::into_inner);
        cache
            .get(path)
            .filter(|cached| cached.stamp == stamp && stamp.modified.is_some())
            .map(|cached| cached.preview.clone())
    }

    #[cfg(test)]
    fn cached_len(&self) -> usize {
        self.cache
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }
}

/// The preview and whether it describes the file's content (and may be
/// cached), rather than a read error that could clear without the file changing.
fn read_preview(path: &Path, len: u64) -> (RecentDesignPreview, bool) {
    if len > RECENT_PREVIEW_MAX_BYTES {
        return (RecentDesignPreview::TooLarge, true);
    }
    match format::load_within(path, RECENT_PREVIEW_MAX_BYTES) {
        Ok(file) => (crate::design::preview::preview_of(&file), true),
        Err(DesignLoadError::TooLarge { .. }) => (RecentDesignPreview::TooLarge, true),
        Err(DesignLoadError::Read { .. }) => {
            tracing::warn!("A Recent Design could not be read for its preview");
            (RecentDesignPreview::Unreadable, false)
        }
        Err(DesignLoadError::InvalidJson { .. } | DesignLoadError::Ingestion { .. }) => {
            tracing::info!("A Recent Design is not a current Design file; no preview");
            (RecentDesignPreview::Unreadable, true)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use common_types::design::CanopiFile;
    use std::path::PathBuf;

    fn scratch(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "canopi_recent_previews_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn with_plants(count: usize) -> CanopiFile {
        let mut file = format::create_new_design("Orchard", "2026-09-27T00:00:00Z");
        file.plants = (0..count)
            .map(|index| {
                serde_json::from_value(serde_json::json!({
                    "id": format!("plant-{index}"),
                    "canonical_name": "Malus domestica",
                    "position": { "lon": 0.1 + index as f64 * 1e-5, "lat": 47.0 },
                }))
                .unwrap()
            })
            .collect();
        file
    }

    fn write(path: &Path, file: &CanopiFile) {
        std::fs::write(path, format::encode_design(file).unwrap()).unwrap();
    }

    fn plant_count(preview: &RecentDesignPreview) -> Option<u32> {
        match preview {
            RecentDesignPreview::Read { plant_count, .. } => Some(*plant_count),
            _ => None,
        }
    }

    #[test]
    fn previews_follow_the_file_and_are_cached_until_it_changes() {
        let root = scratch("cache");
        let path = root.join("orchard.canopi");
        write(&path, &with_plants(3));
        let previews = RecentDesignPreviews::default();
        let listed = vec![path.to_string_lossy().into_owned()];

        let first = previews.previews(&listed);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].path, listed[0]);
        assert_eq!(plant_count(&first[0].preview), Some(3));
        assert_eq!(previews.cached_len(), 1);

        // A different size is a different file: it is read again.
        write(&path, &with_plants(5));
        assert_eq!(plant_count(&previews.previews(&listed)[0].preview), Some(5));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unreadable_moved_and_other_version_files_have_no_preview() {
        let root = scratch("unreadable");
        let garbage = root.join("garbage.canopi");
        std::fs::write(&garbage, "not json").unwrap();
        let old = root.join("old.canopi");
        std::fs::write(&old, r#"{"version": 8, "name": "Old"}"#).unwrap();
        let moved = root.join("moved.canopi");
        let previews = RecentDesignPreviews::default();

        let (result, logs) = crate::services::design_files::capture_logs(|| {
            previews.previews(&[
                garbage.to_string_lossy().into_owned(),
                old.to_string_lossy().into_owned(),
                moved.to_string_lossy().into_owned(),
                root.to_string_lossy().into_owned(),
            ])
        });
        assert!(
            result
                .iter()
                .all(|summary| summary.preview == RecentDesignPreview::Unreadable)
        );
        assert!(!logs.contains(&*root.to_string_lossy()), "{logs}");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_file_over_the_preview_cap_is_not_read() {
        let root = scratch("large");
        let path = root.join("large.canopi");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(RECENT_PREVIEW_MAX_BYTES + 1).unwrap();
        let previews = RecentDesignPreviews::default();

        let result = previews.previews(&[path.to_string_lossy().into_owned()]);
        assert_eq!(result[0].preview, RecentDesignPreview::TooLarge);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_cache_stays_bounded() {
        let root = scratch("bounded");
        let previews = RecentDesignPreviews::default();
        let paths: Vec<String> = (0..PREVIEW_CACHE_LIMIT + 5)
            .map(|index| {
                let path = root.join(format!("design-{index}.canopi"));
                write(&path, &with_plants(1));
                path.to_string_lossy().into_owned()
            })
            .collect();

        previews.previews(&paths);
        assert!(previews.cached_len() <= PREVIEW_CACHE_LIMIT);

        let _ = std::fs::remove_dir_all(root);
    }
}
