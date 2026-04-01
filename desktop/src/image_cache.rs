use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    Arc, Condvar, Mutex,
    atomic::{AtomicU64, Ordering},
};
use std::time::{SystemTime, UNIX_EPOCH};

const IMAGE_FETCH_TIMEOUT_SECS: u64 = 10;
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Clone)]
pub struct ImageCache {
    cache_dir: PathBuf,
    /// Approximate tracked size — incremented on write, decremented on eviction.
    /// Avoids full directory scans on the hot path.
    tracked_size: Arc<AtomicU64>,
    /// Paths currently being fetched and atomically published.
    in_flight: Arc<(Mutex<HashSet<PathBuf>>, Condvar)>,
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
            tracked_size: Arc::new(AtomicU64::new(initial_size)),
            in_flight: Arc::new((Mutex::new(HashSet::new()), Condvar::new())),
        })
    }

    pub fn cached_path(&self, url: &str) -> PathBuf {
        self.cache_dir.join(Self::url_to_filename(url))
    }

    /// Return the cached path if the file already exists and is non-empty.
    pub fn cached_path_if_present(&self, url: &str) -> Option<PathBuf> {
        let path = self.cached_path(url);
        Self::path_is_ready(&path).then_some(path)
    }

    /// Fetch an image if needed, cache it to disk, and return the final path.
    /// On cache hit, this avoids reading the file body entirely.
    pub fn fetch_and_cache(&self, url: &str) -> Result<PathBuf, String> {
        if let Some(path) = self.cached_path_if_present(url) {
            return Ok(path);
        }

        let path = self.cached_path(url);
        let _write_guard = self.acquire_in_flight_slot(&path)?;

        if Self::path_is_ready(&path) {
            return Ok(path);
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

        // Write to disk (best-effort — if this fails, the command must surface it
        // because the frontend expects a path that exists).
        let byte_len = bytes.len() as u64;
        Self::write_bytes_atomically(&path, &bytes)?;
        self.tracked_size.fetch_add(byte_len, Ordering::Relaxed);
        self.evict_if_needed();

        Ok(path)
    }

    fn acquire_in_flight_slot(&self, path: &Path) -> Result<InFlightWriteGuard, String> {
        let (lock, cvar) = &*self.in_flight;
        let mut active = lock
            .lock()
            .map_err(|_| "Image cache lock poisoned".to_string())?;
        while active.contains(path) {
            active = cvar
                .wait(active)
                .map_err(|_| "Image cache lock poisoned".to_string())?;
        }

        if Self::path_is_ready(path) {
            return Ok(InFlightWriteGuard::noop());
        }

        active.insert(path.to_path_buf());
        Ok(InFlightWriteGuard::new(
            self.in_flight.clone(),
            path.to_path_buf(),
        ))
    }

    fn path_is_ready(path: &Path) -> bool {
        match fs::metadata(path) {
            Ok(meta) => meta.is_file() && meta.len() > 0,
            Err(_) => false,
        }
    }

    fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
        let tmp_path = Self::temp_path_for(path);
        fs::write(&tmp_path, bytes).map_err(|e| format!("Failed to cache image: {e}"))?;

        if matches!(fs::metadata(path), Ok(meta) if meta.is_file() && meta.len() == 0) {
            fs::remove_file(path)
                .map_err(|e| format!("Failed to clear stale cached image: {e}"))?;
        }

        if let Err(e) = fs::rename(&tmp_path, path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!("Failed to finalize cached image: {e}"));
        }

        Ok(())
    }

    fn temp_path_for(path: &Path) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_nanos();
        let file_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image");
        path.with_file_name(format!("{file_name}.tmp-{unique}"))
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

struct InFlightWriteGuard {
    state: Option<Arc<(Mutex<HashSet<PathBuf>>, Condvar)>>,
    path: Option<PathBuf>,
}

impl InFlightWriteGuard {
    fn new(state: Arc<(Mutex<HashSet<PathBuf>>, Condvar)>, path: PathBuf) -> Self {
        Self {
            state: Some(state),
            path: Some(path),
        }
    }

    fn noop() -> Self {
        Self {
            state: None,
            path: None,
        }
    }

    #[cfg(test)]
    fn is_noop(&self) -> bool {
        self.state.is_none()
    }
}

impl Drop for InFlightWriteGuard {
    fn drop(&mut self) {
        let Some(state) = self.state.take() else {
            return;
        };
        let Some(path) = self.path.take() else {
            return;
        };

        let (lock, cvar) = &*state;
        if let Ok(mut active) = lock.lock() {
            active.remove(&path);
            cvar.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ImageCache;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::{Arc, Barrier};
    use std::thread;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time should move forward")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("canopi-image-cache-test-{unique}"));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn cached_path_uses_hashed_filename_and_preserves_extension() {
        let temp_dir = TestDir::new();
        let cache = ImageCache::new(&temp_dir.path).expect("create cache");

        let path = cache.cached_path("https://example.com/photo.webp?size=large");

        assert_eq!(path.extension().and_then(|ext| ext.to_str()), Some("webp"));
        let name = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .expect("stem");
        assert_eq!(name.len(), 16);
    }

    #[test]
    fn cached_path_if_present_detects_seeded_cache_file() {
        let temp_dir = TestDir::new();
        let cache = ImageCache::new(&temp_dir.path).expect("create cache");
        let url = "https://example.com/image.jpg";
        let path = cache.cached_path(url);
        fs::write(&path, b"cached-bytes").expect("seed cached image");

        let resolved = cache
            .cached_path_if_present(url)
            .expect("cache hit should resolve");

        assert_eq!(resolved, path);
    }

    #[test]
    fn fetch_and_cache_returns_existing_path_without_requiring_network() {
        let temp_dir = TestDir::new();
        let cache = ImageCache::new(&temp_dir.path).expect("create cache");
        let url = "https://example.com/image.jpg";
        let path = cache.cached_path(url);
        fs::write(&path, b"cached-bytes").expect("seed cached image");

        let resolved = cache
            .fetch_and_cache(url)
            .expect("cache hit should succeed");

        assert_eq!(resolved, path);
    }

    #[test]
    fn write_bytes_atomically_replaces_stale_zero_byte_file() {
        let temp_dir = TestDir::new();
        let path = temp_dir.path.join("stale.jpg");
        fs::write(&path, b"").expect("seed zero-byte cached image");

        ImageCache::write_bytes_atomically(&path, b"fresh-bytes")
            .expect("zero-byte cached image should be replaced");

        assert_eq!(fs::read(&path).expect("read cached image"), b"fresh-bytes");
    }

    #[test]
    fn acquire_in_flight_slot_waits_for_existing_writer_and_reuses_published_file() {
        let temp_dir = TestDir::new();
        let cache = ImageCache::new(&temp_dir.path).expect("create cache");
        let url = "https://example.com/image.jpg";
        let path = cache.cached_path(url);
        let barrier = Arc::new(Barrier::new(3));
        let writer_cache = cache.clone();
        let waiter_cache = cache.clone();
        let writer_barrier = Arc::clone(&barrier);
        let waiter_barrier = Arc::clone(&barrier);
        let writer_path = path.clone();
        let waiter_path = path.clone();

        let writer = thread::spawn(move || {
            let write_guard = writer_cache
                .acquire_in_flight_slot(&writer_path)
                .expect("writer should acquire slot");
            writer_barrier.wait();
            thread::sleep(Duration::from_millis(75));
            ImageCache::write_bytes_atomically(&writer_path, b"cached-bytes")
                .expect("writer should publish cached bytes");
            drop(write_guard);
        });

        let waiter = thread::spawn(move || {
            waiter_barrier.wait();
            let started = Instant::now();
            let wait_guard = waiter_cache
                .acquire_in_flight_slot(&waiter_path)
                .expect("waiter should return after writer publishes");
            let waited = started.elapsed();
            (wait_guard.is_noop(), waited)
        });

        barrier.wait();
        writer.join().expect("join writer");
        let (noop_guard, waited) = waiter.join().expect("join waiter");

        assert!(
            noop_guard,
            "waiter should reuse the writer's published file"
        );
        assert!(
            waited >= Duration::from_millis(50),
            "waiter should block until the writer publishes the file"
        );
        assert_eq!(fs::read(&path).expect("read cached image"), b"cached-bytes");
    }
}
