// .canopi file format: serialize, deserialize, migrate, autosave
pub mod autosave;
pub mod format;

use std::path::Path;

/// Atomic replace: rename `src` to `dest`, cross-platform safe.
///
/// On Unix, `rename` replaces an existing destination atomically.
/// On Windows, `rename` can fail if the destination is held by another process.
///
/// Fallback strategy (preserves the original on failure):
/// 1. Try direct rename (works on Unix, works on Windows if dest is unlocked).
/// 2. If that fails and dest exists: rename dest to a `.old` sidecar first,
///    then rename src to dest. If that also fails, restore dest from `.old`.
///    Only remove `.old` after success.
pub fn atomic_replace(src: &Path, dest: &Path) -> std::io::Result<()> {
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(first_err) if dest.exists() => {
            // Fallback: direct rename failed (common on Windows with file locks).
            tracing::warn!(
                "atomic_replace: direct rename failed for {}, entering fallback: {first_err}",
                dest.display()
            );
            // Clean up any stale .old from a prior interrupted save first.
            let old = dest.with_extension("canopi.old");
            if old.exists() {
                let _ = std::fs::remove_file(&old);
            }
            std::fs::rename(dest, &old).map_err(|e| {
                std::io::Error::new(
                    e.kind(),
                    format!(
                        "atomic_replace: failed to move dest aside: {e} (original: {first_err})"
                    ),
                )
            })?;

            // Now try the real rename
            match std::fs::rename(src, dest) {
                Ok(()) => {
                    // Success — clean up the old file
                    let _ = std::fs::remove_file(&old);
                    Ok(())
                }
                Err(e) => {
                    // Restore the original from .old
                    let _ = std::fs::rename(&old, dest);
                    Err(std::io::Error::new(
                        e.kind(),
                        format!("atomic_replace: rename failed, original restored: {e}"),
                    ))
                }
            }
        }
        Err(first_err) => Err(first_err),
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

    fn tmp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(name)
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
        let src = tmp("canopi_ar_src_ow.txt");
        let dest = tmp("canopi_ar_dest_ow.txt");
        let _ = fs::remove_file(&src);

        fs::write(&dest, "old content").unwrap();
        fs::write(&src, "new content").unwrap();
        atomic_replace(&src, &dest).unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "new content");
        assert!(
            !tmp("canopi_ar_dest_ow.canopi.old").exists(),
            ".old cleaned up"
        );

        let _ = fs::remove_file(&dest);
    }

    #[test]
    fn test_atomic_replace_with_stale_old_succeeds() {
        // On Unix, the direct rename succeeds (replaces atomically), so the
        // fallback path that cleans .old is never entered. This test verifies
        // that the presence of a stale .old does NOT block the save.
        let src = tmp("canopi_ar_src_stale.txt");
        let dest = tmp("canopi_ar_dest_stale.txt");
        let old = dest.with_extension("canopi.old");

        fs::write(&dest, "original").unwrap();
        fs::write(&old, "stale old").unwrap();
        fs::write(&src, "replacement").unwrap();

        // Must succeed regardless of stale .old
        atomic_replace(&src, &dest).unwrap();

        assert_eq!(fs::read_to_string(&dest).unwrap(), "replacement");
        // On Unix, .old may remain since the fallback wasn't needed.
        // On Windows, the fallback would clean it up before proceeding.

        let _ = fs::remove_file(&dest);
        let _ = fs::remove_file(&old);
    }

    #[test]
    fn test_atomic_replace_fails_if_src_missing() {
        let src = tmp("canopi_ar_src_missing.txt");
        let dest = tmp("canopi_ar_dest_missing.txt");
        let _ = fs::remove_file(&src);
        let _ = fs::remove_file(&dest);

        let result = atomic_replace(&src, &dest);
        assert!(result.is_err(), "should fail when src doesn't exist");
    }
}
