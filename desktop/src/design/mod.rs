// .canopi file format: serialize, deserialize, migrate, autosave
pub mod autosave;
pub mod format;
mod new_design_defaults;

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicU64, Ordering},
    },
};

type WriteAdmissionRegistry = Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>;

static WRITE_ADMISSIONS: OnceLock<WriteAdmissionRegistry> = OnceLock::new();
static NEXT_SIDECAR_ID: AtomicU64 = AtomicU64::new(0);

fn operation_sidecar_path(dest: &Path, role: &str) -> PathBuf {
    let parent = dest
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    loop {
        let id = NEXT_SIDECAR_ID.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".canopi-{:x}-{id:x}.{role}", std::process::id()));
        if !path.exists() {
            return path;
        }
    }
}

/// Run one write operation at a time for a process-local storage resource.
///
/// The permit deliberately spans blocking file I/O: its invariant is that the
/// complete backup/write/replace sequence for one target or store is indivisible.
fn with_write_admission<T>(resource: &Path, operation: impl FnOnce() -> T) -> T {
    with_write_admissions(&[resource], operation)
}

/// Run one write operation while holding every named storage resource.
///
/// Keys are normalized, sorted, and deduplicated before their permits are
/// acquired. Deterministic ordering lets overlapping resource families share
/// a boundary without deadlocking one another.
fn with_write_admissions<T>(resources: &[&Path], operation: impl FnOnce() -> T) -> T {
    let mut keys = resources
        .iter()
        .map(|resource| write_admission_key(resource))
        .collect::<Vec<_>>();
    keys.sort();
    keys.dedup();

    let registry = WRITE_ADMISSIONS.get_or_init(|| Mutex::new(HashMap::new()));
    let admissions = {
        let mut admissions = registry.lock().unwrap_or_else(|poisoned| {
            tracing::warn!("Recovering poisoned Design write admission registry");
            poisoned.into_inner()
        });
        admissions.retain(|_, admission| admission.strong_count() > 0);
        keys.into_iter()
            .map(|key| {
                let admission = admissions
                    .get(&key)
                    .and_then(Weak::upgrade)
                    .unwrap_or_else(|| {
                        let admission = Arc::new(Mutex::new(()));
                        admissions.insert(key.clone(), Arc::downgrade(&admission));
                        admission
                    });
                (key, admission)
            })
            .collect::<Vec<_>>()
    };
    let _permits = admissions
        .iter()
        .map(|(key, admission)| {
            admission.lock().unwrap_or_else(|poisoned| {
                tracing::warn!(
                    "Recovering poisoned Design write admission for {}",
                    key.display()
                );
                poisoned.into_inner()
            })
        })
        .collect::<Vec<_>>();
    operation()
}

fn write_admission_key(resource: &Path) -> PathBuf {
    if resource.is_dir() {
        return resource
            .canonicalize()
            .unwrap_or_else(|_| absolute_path(resource));
    }

    let parent = resource
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = parent
        .canonicalize()
        .unwrap_or_else(|_| absolute_path(parent));
    resource
        .file_name()
        .map_or(parent.clone(), |name| parent.join(name))
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

/// Atomic replace: rename `src` to `dest`, cross-platform safe.
///
/// On Unix, `rename` replaces an existing destination atomically.
/// On Windows, `rename` can fail if the destination is held by another process.
///
/// Fallback strategy (preserves the original on failure):
/// 1. Try direct rename (works on Unix, works on Windows if dest is unlocked).
/// 2. If that fails and dest is a regular file, rename dest to an operation-owned
///    rollback sidecar first, then rename src to dest. If that also fails, restore
///    the destination from the sidecar. Only remove the rollback sidecar after
///    success. Non-regular destinations are rejected without being moved.
pub fn atomic_replace(src: &Path, dest: &Path) -> std::io::Result<()> {
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(first_err) if dest.exists() => atomic_replace_fallback(src, dest, first_err),
        Err(first_err) => Err(first_err),
    }
}

fn atomic_replace_fallback(
    src: &Path,
    dest: &Path,
    first_err: std::io::Error,
) -> std::io::Result<()> {
    let destination_type = std::fs::symlink_metadata(dest).map_err(|metadata_error| {
        std::io::Error::new(
            metadata_error.kind(),
            format!(
                "atomic_replace: failed to inspect destination after direct rename failed: {metadata_error} (original: {first_err})"
            ),
        )
    })?;
    if !destination_type.file_type().is_file() {
        return Err(std::io::Error::new(
            first_err.kind(),
            format!(
                "atomic_replace: refusing to move non-regular destination {} after direct rename failed: {first_err}",
                dest.display()
            ),
        ));
    }

    // Fallback: direct rename failed (common on Windows with file locks).
    tracing::warn!(
        "atomic_replace: direct rename failed for {}, entering fallback: {first_err}",
        dest.display()
    );
    let old = operation_sidecar_path(dest, "old");
    std::fs::rename(dest, &old).map_err(|e| {
        std::io::Error::new(
            e.kind(),
            format!("atomic_replace: failed to move dest aside: {e} (original: {first_err})"),
        )
    })?;

    match std::fs::rename(src, dest) {
        Ok(()) => {
            if let Err(e) = std::fs::remove_file(&old) {
                // This sidecar still owns the only copy of the predecessor, so
                // preserving it is safer than treating cleanup as destructive.
                tracing::warn!(
                    "atomic_replace: could not remove rollback sidecar {}: {e}",
                    old.display()
                );
            }
            Ok(())
        }
        Err(e) => match std::fs::rename(&old, dest) {
            Ok(()) => Err(std::io::Error::new(
                e.kind(),
                format!("atomic_replace: rename failed, original restored: {e}"),
            )),
            Err(restore_error) => Err(std::io::Error::new(
                e.kind(),
                format!(
                    "atomic_replace: rename failed: {e}; failed to restore original from {}: {restore_error}",
                    old.display()
                ),
            )),
        },
    }
}

/// Format a Unix timestamp (seconds since epoch) as an ISO 8601 UTC string.
///
/// Uses a Gregorian calendar algorithm so there is no chrono dependency.
pub fn unix_to_iso8601(secs: u64) -> String {
    let secs_per_day = 86_400u64;
    let days = secs / secs_per_day;
    let tod = secs % secs_per_day;
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;

    // Gregorian calendar conversion from Julian Day Number.
    let jd = days + 2_440_588; // JDN of Unix epoch (1970-01-01)
    let a = jd + 32_044;
    let b = (4 * a + 3) / 146_097;
    let c = a - (b * 146_097) / 4;
    let d = (4 * c + 3) / 1_461;
    let e = c - (1_461 * d) / 4;
    let m = (5 * e + 2) / 153;

    let day = e - (153 * m + 2) / 5 + 1;
    let month = m + 3 - 12 * (m / 10);
    let year = b * 100 + d - 4_800 + m / 10;

    format!("{year:04}-{month:02}-{day:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::mpsc;
    use std::time::Duration;

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(name)
    }

    fn unique_root(name: &str) -> PathBuf {
        tmp(&format!(
            "canopi_{name}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ))
    }

    fn operation_sidecars(root: &Path, role: &str) -> Vec<PathBuf> {
        let suffix = format!(".{role}");
        fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                    return false;
                };
                name.starts_with(".canopi-") && name.ends_with(&suffix)
            })
            .collect()
    }

    #[test]
    fn test_atomic_replace_new_dest() {
        let src = tmp("canopi_ar_src_new.txt");
        let dest = tmp("canopi_ar_dest_new.txt");
        let _ = fs::remove_file(&src);
        let _ = fs::remove_file(&dest);

        fs::write(&src, "new content").unwrap();
        atomic_replace(&src, &dest).unwrap();

        assert!(!src.exists(), "src should be gone after rename");
        assert_eq!(fs::read_to_string(&dest).unwrap(), "new content");

        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn test_atomic_replace_overwrites_existing() {
        let root = unique_root("atomic_replace_overwrite");
        fs::create_dir_all(&root).unwrap();
        let src = root.join("replacement.tmp");
        let dest = root.join("garden.canopi");

        fs::write(&dest, "old content").unwrap();
        fs::write(&src, "new content").unwrap();
        atomic_replace(&src, &dest).unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "new content");
        assert!(
            operation_sidecars(&root, "old").is_empty(),
            "successful replacement must not leak an owned rollback sidecar"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_atomic_replace_with_stale_old_succeeds() {
        // The stable legacy .old name is outside this operation's ownership.
        // Its presence must neither block the save nor be claimed as rollback
        // state, regardless of whether the platform needs the fallback path.
        let src = tmp("canopi_ar_src_stale.txt");
        let dest = tmp("canopi_ar_dest_stale.txt");
        let old = dest.with_extension("canopi.old");

        fs::write(&dest, "original").unwrap();
        fs::write(&old, "stale old").unwrap();
        fs::write(&src, "replacement").unwrap();

        // Must succeed regardless of stale .old
        atomic_replace(&src, &dest).unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "replacement");
        assert_eq!(fs::read_to_string(&old).unwrap(), "stale old");

        let _ = fs::remove_file(&dest);
        let _ = fs::remove_file(&old);
    }

    #[test]
    fn atomic_replace_fallback_does_not_claim_legacy_rollback_sidecar() {
        let root = unique_root("atomic_owned_rollback");
        fs::create_dir_all(&root).unwrap();
        let src = root.join("replacement.tmp");
        let dest = root.join("garden.canopi");
        let legacy_old = dest.with_extension("canopi.old");
        fs::write(&src, "replacement").unwrap();
        fs::write(&dest, "original").unwrap();
        fs::write(&legacy_old, "another operation owns this").unwrap();

        atomic_replace_fallback(
            &src,
            &dest,
            std::io::Error::other("forced fallback for test"),
        )
        .unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "replacement");
        assert_eq!(
            fs::read_to_string(&legacy_old).unwrap(),
            "another operation owns this"
        );
        assert!(
            operation_sidecars(&root, "old").is_empty(),
            "successful fallback must clean its owned rollback sidecar"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn atomic_replace_rejects_directory_destination_without_moving_it() {
        let root = unique_root("atomic_directory_destination");
        fs::create_dir_all(&root).unwrap();
        let src = root.join("replacement.tmp");
        let dest = root.join("garden.canopi");
        let marker = dest.join("marker.txt");
        fs::write(&src, "replacement").unwrap();
        fs::create_dir(&dest).unwrap();
        fs::write(&marker, "directory content").unwrap();

        let result = atomic_replace(&src, &dest);

        assert!(result.is_err(), "a directory destination must be rejected");
        assert!(
            dest.is_dir(),
            "the destination directory must remain in place"
        );
        assert_eq!(fs::read_to_string(&marker).unwrap(), "directory content");
        assert_eq!(
            fs::read_to_string(&src).unwrap(),
            "replacement",
            "the uncommitted source must remain available to the caller"
        );
        assert!(
            operation_sidecars(&root, "old").is_empty(),
            "rejecting a directory must not create an owned rollback sidecar"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_atomic_replace_fails_if_src_missing() {
        let root = unique_root("atomic_missing_source");
        fs::create_dir_all(&root).unwrap();
        let src = root.join("missing.tmp");
        let dest = root.join("garden.canopi");
        fs::write(&dest, "original").unwrap();

        let result = atomic_replace(&src, &dest);
        assert!(result.is_err(), "should fail when src doesn't exist");
        assert_eq!(
            fs::read_to_string(&dest).unwrap(),
            "original",
            "fallback should restore the original destination"
        );
        assert!(
            operation_sidecars(&root, "old").is_empty(),
            "a successfully restored fallback must not leak its rollback sidecar"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn same_resource_write_admission_serializes_operations() {
        let resource = tmp(&format!(
            "canopi_write_admission_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
        ));
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first_resource = resource.clone();
        let first = std::thread::spawn(move || {
            with_write_admission(&first_resource, || {
                first_entered_tx.send(()).unwrap();
                release_first_rx.recv().unwrap();
            });
        });
        first_entered_rx.recv().unwrap();

        let (second_started_tx, second_started_rx) = mpsc::channel();
        let (second_entered_tx, second_entered_rx) = mpsc::channel();
        let second = std::thread::spawn(move || {
            second_started_tx.send(()).unwrap();
            with_write_admission(&resource, || second_entered_tx.send(()).unwrap());
        });
        second_started_rx.recv().unwrap();

        assert!(
            second_entered_rx
                .recv_timeout(Duration::from_millis(200))
                .is_err(),
            "a second operation entered while the same resource was admitted"
        );

        release_first_tx.send(()).unwrap();
        second_entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("second operation should enter after the first releases admission");
        first.join().unwrap();
        second.join().unwrap();
    }

    #[test]
    fn different_resource_write_admissions_proceed_concurrently() {
        let root = unique_root("independent_write_admission");
        fs::create_dir_all(&root).unwrap();
        let first_resource = root.join("first.canopi");
        let second_resource = root.join("second.canopi");
        let (first_entered_tx, first_entered_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first = std::thread::spawn(move || {
            with_write_admission(&first_resource, || {
                first_entered_tx.send(()).unwrap();
                release_first_rx.recv().unwrap();
            });
        });
        first_entered_rx.recv().unwrap();

        let (second_entered_tx, second_entered_rx) = mpsc::channel();
        let second = std::thread::spawn(move || {
            with_write_admission(&second_resource, || second_entered_tx.send(()).unwrap());
        });

        let second_entered = second_entered_rx.recv_timeout(Duration::from_secs(2));
        release_first_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        second_entered.expect("a different resource must not wait for the first admission");

        let _ = fs::remove_dir_all(root);
    }
}
