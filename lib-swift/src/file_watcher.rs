//! File watching via macOS FSEvents — stub.
//!
//! Will use FSEvents (or kqueue) to watch a single file for modifications.
//! For now, returns a stub error.

use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// Start watching `path` for modifications.
///
/// `on_change` is called (from the watcher thread) each time the file is
/// written to or closed-after-write. The callback receives the path that
/// was passed in.
///
/// Returns `(cancel_flag, join_handle)`. Set the flag to `true` to stop.
pub fn watch_file<F>(
    _path: &Path,
    _on_change: F,
) -> Result<(Arc<AtomicBool>, std::thread::JoinHandle<()>), String>
where
    F: Fn(&Path) + Send + 'static,
{
    // TODO: Implement via FSEvents or kqueue.
    Err("macOS native file watching not yet implemented — requires FSEvents FFI".into())
}
