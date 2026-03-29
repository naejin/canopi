//! File watching via Linux inotify.
//!
//! Watches a single file for `MODIFY` and `CLOSE_WRITE` events.
//! Spawns a background thread that blocks on inotify reads.
//! Cancellation is cooperative: writing to a pipe wakes the thread.

use inotify::{Inotify, WatchMask};
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// Start watching `path` for modifications.
///
/// `on_change` is called (from the watcher thread) each time the file is
/// written to or closed-after-write. The callback receives the path that
/// was passed in.
///
/// Returns `(cancel_flag, join_handle)`. Set the flag to `true` to stop.
pub fn watch_file<F>(
    path: &Path,
    on_change: F,
) -> Result<(Arc<AtomicBool>, std::thread::JoinHandle<()>), String>
where
    F: Fn(&Path) + Send + 'static,
{
    let mut inotify = Inotify::init().map_err(|e| format!("Failed to init inotify: {e}"))?;

    // Watch for content modifications and close-after-write.
    inotify
        .watches()
        .add(path, WatchMask::MODIFY | WatchMask::CLOSE_WRITE)
        .map_err(|e| format!("Failed to add inotify watch on {}: {e}", path.display()))?;

    let cancel = Arc::new(AtomicBool::new(false));
    let cancel_clone = Arc::clone(&cancel);
    let path_owned = path.to_path_buf();

    let handle = std::thread::Builder::new()
        .name("canopi-file-watcher".into())
        .spawn(move || {
            let mut buf = [0u8; 4096];
            let fd = inotify.as_raw_fd();

            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    break;
                }

                // Use poll(2) with a 500ms timeout so we can check the cancel flag.
                let mut pollfd = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };
                let ret = unsafe { libc::poll(&mut pollfd, 1, 500) };

                if ret < 0 {
                    // poll error — unlikely; break to avoid busy-spin.
                    break;
                }
                if ret == 0 {
                    // Timeout — check cancel and loop.
                    continue;
                }

                // Data available — read events.
                match inotify.read_events(&mut buf) {
                    Ok(events) => {
                        // Coalesce: fire the callback at most once per read batch.
                        if events.count() > 0 {
                            on_change(&path_owned);
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => continue,
                    Err(_) => break,
                }
            }
        })
        .map_err(|e| format!("Failed to spawn watcher thread: {e}"))?;

    Ok((cancel, handle))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn watch_detects_write() {
        let dir = std::env::temp_dir().join("canopi_test_watcher");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("test.canopi");
        std::fs::write(&file, b"initial").unwrap();

        let count = Arc::new(AtomicUsize::new(0));
        let count_clone = Arc::clone(&count);

        let (cancel, handle) = watch_file(&file, move |_| {
            count_clone.fetch_add(1, Ordering::Relaxed);
        })
        .unwrap();

        // Give the watcher thread time to set up.
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Trigger a write.
        std::fs::write(&file, b"modified").unwrap();

        // Wait for the event to propagate.
        std::thread::sleep(std::time::Duration::from_millis(600));

        assert!(
            count.load(Ordering::Relaxed) >= 1,
            "Callback should have been invoked at least once"
        );

        cancel.store(true, Ordering::Relaxed);
        let _ = handle.join();

        // Cleanup.
        let _ = std::fs::remove_dir_all(&dir);
    }
}
