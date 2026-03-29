use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const IMAGE_FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

pub struct ImageCache {
    cache_dir: PathBuf,
    /// Approximate tracked size — incremented on write, decremented on eviction.
    /// Avoids full directory scans on the hot path.
    tracked_size: AtomicU64,
}

impl ImageCache {
    pub fn new(app_data_dir: &Path) -> Result<Self, String> {
        let cache_dir = app_data_dir.join("image-cache");
        fs::create_dir_all(&cache_dir)
            .map_err(|e| format!("Failed to create image cache dir: {e}"))?;

        // Seed tracked size from disk on startup (one-time scan)
        let initial_size: u64 = fs::read_dir(&cache_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum();

        Ok(Self {
            cache_dir,
            tracked_size: AtomicU64::new(initial_size),
        })
    }

    /// Fetch an image, cache to disk, and return the raw bytes.
    /// On cache hit, reads from disk. On miss, downloads and caches.
    pub fn fetch_and_cache_bytes(&self, url: &str) -> Result<Vec<u8>, String> {
        // Cache hit — read from disk
        let filename = Self::url_to_filename(url);
        let path = self.cache_dir.join(&filename);
        if path.exists()
            && let Ok(bytes) = fs::read(&path)
            && !bytes.is_empty()
        {
            return Ok(bytes);
        }

        // Cache miss — download (10s timeout, 10MB max)
        let mut response = crate::http::build_get_request(
            url,
            "Canopi/1.0",
            std::time::Duration::from_secs(IMAGE_FETCH_TIMEOUT_SECS),
        )
        .call()
        .map_err(|e| format!("Failed to fetch image: {e}"))?;
        let bytes = crate::http::read_limited_bytes(&mut response, MAX_IMAGE_BYTES, "image bytes")?;

        // Write to disk (best-effort — don't fail the request if disk write fails)
        let byte_len = bytes.len() as u64;
        if fs::write(&path, &bytes).is_ok() {
            self.tracked_size.fetch_add(byte_len, Ordering::Relaxed);
            self.evict_if_needed();
        }

        Ok(bytes)
    }

    /// Convert URL to a safe filename using SHA256 hash prefix + extension.
    fn url_to_filename(url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        let url_path = url.split('?').next().unwrap_or(url);
        let ext = url_path
            .rsplit('.')
            .next()
            .filter(|e| e.len() <= 5 && e.chars().all(|c| c.is_alphanumeric()))
            .unwrap_or("jpg");

        format!("{}.{}", &hash[..16], ext)
    }

    /// Evict oldest files if cache exceeds 500 MB. Uses tracked size to skip
    /// the directory scan when under limit (the common case).
    fn evict_if_needed(&self) {
        const MAX_BYTES: u64 = 500 * 1024 * 1024;
        let current = self.tracked_size.load(Ordering::Relaxed);
        if current <= MAX_BYTES {
            return;
        }

        let mut entries: Vec<_> = fs::read_dir(&self.cache_dir)
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                let accessed = meta.accessed().or_else(|_| meta.modified()).ok()?;
                Some((e.path(), meta.len(), accessed))
            })
            .collect();

        entries.sort_by_key(|(_, _, t)| *t);

        let mut freed = 0u64;
        let target = current - MAX_BYTES;
        for (path, size, _) in entries {
            if freed >= target {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                freed += size;
            }
        }
        self.tracked_size.fetch_sub(freed, Ordering::Relaxed);
    }
}
