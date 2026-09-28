//! Test-only scratch directories that clean up after themselves.
//!
//! Every Rust test that touches the filesystem takes a [`TestScratch`] instead
//! of a bare `std::env::temp_dir()` child, so a full `cargo test` run leaves the
//! system temp folder as it found it. The guard removes its whole tree on drop
//! and ignores removal errors, so a test that already deleted its directory (or
//! never created a file inside it) still passes.

use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SCRATCH: AtomicU64 = AtomicU64::new(0);

/// A unique, created directory under the system temp folder, removed on drop.
///
/// Bind it to a named variable (not `_`) so it outlives every file handle and
/// SQLite connection the test opens inside it.
#[derive(Debug)]
pub struct TestScratch {
    path: PathBuf,
}

impl TestScratch {
    /// Creates `canopi-test-<label>-<pid>-<nanos>-<n>` under `temp_dir()`.
    pub fn new(label: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = NEXT_SCRATCH.fetch_add(1, Ordering::Relaxed);
        let label: String = label
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        let path = std::env::temp_dir().join(format!(
            "canopi-test-{label}-{}-{nanos}-{sequence}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create test scratch directory");
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn join(&self, name: impl AsRef<Path>) -> PathBuf {
        self.path.join(name)
    }
}

impl Deref for TestScratch {
    type Target = Path;

    fn deref(&self) -> &Path {
        &self.path
    }
}

impl AsRef<Path> for TestScratch {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestScratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::TestScratch;

    #[test]
    fn scratch_is_created_unique_and_removed_on_drop() {
        let first = TestScratch::new("guard/self");
        let second = TestScratch::new("guard/self");
        assert_ne!(first.path(), second.path());
        assert!(first.is_dir());
        std::fs::write(first.join("file.txt"), b"x").unwrap();
        std::fs::create_dir_all(second.join("deep").join("tree")).unwrap();
        let (first_path, second_path) = (first.path().to_path_buf(), second.path().to_path_buf());
        drop(first);
        drop(second);
        assert!(!first_path.exists());
        assert!(!second_path.exists());
    }

    #[test]
    fn dropping_an_already_removed_scratch_does_not_panic() {
        let scratch = TestScratch::new("guard-gone");
        std::fs::remove_dir_all(scratch.path()).unwrap();
        drop(scratch);
    }
}
