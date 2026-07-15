use std::collections::HashSet;
use std::error::Error;
use std::fmt;
use std::fs::{self, File, OpenOptions, Permissions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT_SIDECAR: AtomicU64 = AtomicU64::new(0);

#[derive(Debug)]
pub(crate) struct PublicationError(String);

impl fmt::Display for PublicationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl Error for PublicationError {}

pub(crate) struct GenerationPlan {
    admission: PathBuf,
    marker: PathBuf,
    artifacts: Vec<GeneratedArtifact>,
}

struct OperationAdmission {
    _file: File,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum MarkerDisposition {
    RemoveOnDrop,
    Preserve,
    Removed,
}

struct PublicationMarker<'a, SyncDirectory>
where
    SyncDirectory: FnMut(&Path) -> io::Result<()>,
{
    path: PathBuf,
    contents: Vec<u8>,
    sync_directory: &'a mut SyncDirectory,
    disposition: MarkerDisposition,
}

impl<SyncDirectory> PublicationMarker<'_, SyncDirectory>
where
    SyncDirectory: FnMut(&Path) -> io::Result<()>,
{
    fn preserve_on_drop(&mut self) {
        self.disposition = MarkerDisposition::Preserve;
    }

    fn remove_durably(&mut self) -> io::Result<()> {
        if self.disposition == MarkerDisposition::Removed {
            return Ok(());
        }
        match remove_marker_durably(&self.path, self.sync_directory) {
            Ok(()) => {
                self.disposition = MarkerDisposition::Removed;
                Ok(())
            }
            Err(error) => {
                self.disposition = MarkerDisposition::Preserve;
                Err(error)
            }
        }
    }

    fn ensure_present(&mut self) -> io::Result<()> {
        self.disposition = MarkerDisposition::Preserve;
        match fs::metadata(&self.path) {
            Ok(metadata) if metadata.is_file() => return Ok(()),
            Ok(_) => {
                return Err(io::Error::other(
                    "in-progress marker path is not a regular file",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }

        let parent = self.path.parent().ok_or_else(|| {
            io::Error::other("bindings generation marker has no parent directory")
        })?;
        let mut marker = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&self.path)?;
        let persisted = marker
            .write_all(&self.contents)
            .and_then(|()| marker.sync_all());
        drop(marker);
        persisted?;
        (self.sync_directory)(parent)
    }

    fn cleanup_after(mut self, original_error: PublicationError) -> PublicationError {
        match self.remove_durably() {
            Ok(()) => original_error,
            Err(cleanup_error) => PublicationError(format!(
                "{original_error}; the in-progress marker could not be cleaned up: {cleanup_error}"
            )),
        }
    }
}

impl<SyncDirectory> Drop for PublicationMarker<'_, SyncDirectory>
where
    SyncDirectory: FnMut(&Path) -> io::Result<()>,
{
    fn drop(&mut self) {
        if self.disposition == MarkerDisposition::RemoveOnDrop {
            let _ = self.remove_durably();
        }
    }
}

#[derive(Clone, Copy)]
enum AdmissionMode {
    Check,
    Publish,
}

struct GeneratedArtifact {
    destination: PathBuf,
    content: Vec<u8>,
}

struct PreparedArtifact {
    destination: PathBuf,
    staged: PathBuf,
    original: Option<Vec<u8>>,
    original_permissions: Option<Permissions>,
    published: bool,
}

impl Drop for PreparedArtifact {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.staged);
    }
}

impl GenerationPlan {
    pub(crate) fn new(repo_root: &Path) -> Self {
        let marker = repo_root
            .join("target")
            .join("bindings-gen-publication.in-progress");
        Self {
            admission: marker.with_extension("lock"),
            marker,
            artifacts: Vec::new(),
        }
    }

    #[cfg(test)]
    fn new_with_marker(marker: PathBuf) -> Self {
        Self {
            admission: marker.with_extension("lock"),
            marker,
            artifacts: Vec::new(),
        }
    }

    pub(crate) fn add(
        &mut self,
        destination: PathBuf,
        content: impl Into<Vec<u8>>,
    ) -> Result<(), PublicationError> {
        if self
            .artifacts
            .iter()
            .any(|artifact| artifact.destination == destination)
        {
            return Err(PublicationError(format!(
                "generated destination was added more than once: {}",
                destination.display()
            )));
        }
        self.artifacts.push(GeneratedArtifact {
            destination,
            content: content.into(),
        });
        Ok(())
    }

    pub(crate) fn publish(&self) -> Result<(), PublicationError> {
        self.publish_with(replace_file)
    }

    pub(crate) fn check(&self) -> Result<(), PublicationError> {
        let _admission = self.acquire_admission(AdmissionMode::Check)?;
        self.reject_interrupted_publication()?;
        let mut stale = Vec::new();
        for artifact in &self.artifacts {
            let actual = match fs::read(&artifact.destination) {
                Ok(actual) => actual,
                Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
                Err(error) => {
                    return Err(PublicationError(format!(
                        "failed to read generated artifact {} during drift check: {error}",
                        artifact.destination.display()
                    )));
                }
            };
            if actual != artifact.content {
                stale.push(artifact.destination.display().to_string());
            }
        }
        if stale.is_empty() {
            Ok(())
        } else {
            Err(PublicationError(format!(
                "generated artifacts are stale:\n- {}",
                stale.join("\n- ")
            )))
        }
    }

    fn publish_with(
        &self,
        replace: impl FnMut(&Path, &Path) -> io::Result<()>,
    ) -> Result<(), PublicationError> {
        self.publish_with_io(replace, sync_directory)
    }

    fn publish_with_io(
        &self,
        mut replace: impl FnMut(&Path, &Path) -> io::Result<()>,
        mut sync_directory: impl FnMut(&Path) -> io::Result<()>,
    ) -> Result<(), PublicationError> {
        let _admission = self.acquire_admission(AdmissionMode::Publish)?;
        self.reject_interrupted_publication()?;
        let mut marker = self.create_marker(&mut sync_directory)?;
        let mut prepared = match self.prepare_all() {
            Ok(prepared) => prepared,
            Err(error) => return Err(marker.cleanup_after(error)),
        };
        marker.preserve_on_drop();

        for index in 0..prepared.len() {
            let result = replace(&prepared[index].staged, &prepared[index].destination);
            if let Err(error) = result {
                // A platform fallback may have removed or partially replaced the
                // destination before reporting its error, so restore this member
                // as well as every earlier successful member.
                prepared[index].published = true;
                let destination = prepared[index].destination.display().to_string();
                return Err(self.rollback_after(
                    &mut prepared,
                    &mut replace,
                    &mut marker,
                    format!("failed to publish generated artifact {destination}: {error}"),
                ));
            }
            prepared[index].published = true;
        }

        if let Err(error) = marker.remove_durably() {
            return Err(self.rollback_after(
                &mut prepared,
                &mut replace,
                &mut marker,
                format!(
                    "generated artifacts were published but the in-progress marker could not be removed: {error}"
                ),
            ));
        }
        Ok(())
    }

    fn acquire_admission(
        &self,
        mode: AdmissionMode,
    ) -> Result<OperationAdmission, PublicationError> {
        let parent = self.admission.parent().ok_or_else(|| {
            PublicationError("bindings generation admission file has no parent directory".into())
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            PublicationError(format!(
                "failed to create bindings generation admission directory {}: {error}",
                parent.display()
            ))
        })?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&self.admission)
            .map_err(|error| {
                PublicationError(format!(
                    "failed to open bindings generation admission file {}: {error}",
                    self.admission.display()
                ))
            })?;
        let lock = match mode {
            AdmissionMode::Check => file.try_lock_shared(),
            AdmissionMode::Publish => file.try_lock(),
        };
        lock.map_err(|error| {
            let message = match error {
                fs::TryLockError::WouldBlock => {
                    "another bindings generation or drift check is already active".to_owned()
                }
                fs::TryLockError::Error(error) => {
                    format!("failed to acquire bindings generation admission: {error}")
                }
            };
            PublicationError(format!("{message} at {}", self.admission.display()))
        })?;
        Ok(OperationAdmission { _file: file })
    }

    fn reject_interrupted_publication(&self) -> Result<(), PublicationError> {
        if self.marker.exists() {
            return Err(PublicationError(format!(
                "an interrupted bindings generation was detected at {}; inspect the generated-file diff, restore or accept it, then remove the marker before retrying",
                self.marker.display()
            )));
        }
        Ok(())
    }

    fn prepare_all(&self) -> Result<Vec<PreparedArtifact>, PublicationError> {
        let mut prepared = Vec::with_capacity(self.artifacts.len());
        let mut destinations = HashSet::new();
        for artifact in &self.artifacts {
            if !destinations.insert(&artifact.destination) {
                return Err(PublicationError(format!(
                    "generated destination was added more than once: {}",
                    artifact.destination.display()
                )));
            }
            prepared.push(prepare_artifact(artifact).map_err(|error| {
                PublicationError(format!(
                    "failed to stage generated artifact {}: {error}",
                    artifact.destination.display()
                ))
            })?);
        }
        Ok(prepared)
    }

    fn create_marker<'a, SyncDirectory>(
        &self,
        sync_directory: &'a mut SyncDirectory,
    ) -> Result<PublicationMarker<'a, SyncDirectory>, PublicationError>
    where
        SyncDirectory: FnMut(&Path) -> io::Result<()>,
    {
        let parent = self.marker.parent().ok_or_else(|| {
            PublicationError("bindings generation marker has no parent directory".to_owned())
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            PublicationError(format!(
                "failed to create bindings generation marker directory {}: {error}",
                parent.display()
            ))
        })?;
        let mut contents = Vec::new();
        writeln!(
            &mut contents,
            "bindings-gen was publishing these generated destinations when it stopped:"
        )
        .and_then(|()| {
            self.artifacts.iter().try_for_each(|artifact| {
                writeln!(&mut contents, "{}", artifact.destination.display())
            })
        })
        .map_err(|error| {
            PublicationError(format!(
                "failed to render bindings generation in-progress marker: {error}"
            ))
        })?;
        let mut marker = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&self.marker)
            .map_err(|error| {
                PublicationError(format!(
                    "failed to create bindings generation in-progress marker {}: {error}",
                    self.marker.display()
                ))
            })?;
        let persisted = marker
            .write_all(&contents)
            .and_then(|()| marker.sync_all())
            .and_then(|()| sync_directory(parent));
        drop(marker);
        if let Err(error) = persisted {
            let cleanup = remove_marker_durably(&self.marker, sync_directory);
            let cleanup = cleanup
                .err()
                .map(|cleanup_error| format!("; marker cleanup also failed: {cleanup_error}"))
                .unwrap_or_default();
            return Err(PublicationError(format!(
                "failed to persist bindings generation in-progress marker {}: {error}{cleanup}",
                self.marker.display()
            )));
        }
        Ok(PublicationMarker {
            path: self.marker.clone(),
            contents,
            sync_directory,
            disposition: MarkerDisposition::RemoveOnDrop,
        })
    }

    fn rollback_after<SyncDirectory>(
        &self,
        prepared: &mut [PreparedArtifact],
        replace: &mut impl FnMut(&Path, &Path) -> io::Result<()>,
        marker: &mut PublicationMarker<'_, SyncDirectory>,
        original_error: String,
    ) -> PublicationError
    where
        SyncDirectory: FnMut(&Path) -> io::Result<()>,
    {
        let mut rollback_errors = Vec::new();
        for artifact in prepared.iter_mut().rev().filter(|item| item.published) {
            let result = match &artifact.original {
                Some(content) => stage_bytes(
                    &artifact.destination,
                    content,
                    artifact.original_permissions.as_ref(),
                    "restore",
                )
                .and_then(|restore| {
                    let result = replace(&restore, &artifact.destination);
                    result.map_err(|error| {
                        io::Error::new(
                            error.kind(),
                            format!(
                                "{error}; prior bytes remain staged at {}",
                                restore.display()
                            ),
                        )
                    })
                }),
                None => match fs::remove_file(&artifact.destination) {
                    Ok(()) => Ok(()),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                    Err(error) => Err(error),
                },
            };
            if let Err(error) = result {
                rollback_errors.push(format!("{}: {error}", artifact.destination.display()));
            } else {
                artifact.published = false;
            }
        }

        for artifact in prepared.iter() {
            if let Err(error) = fs::remove_file(&artifact.staged)
                && error.kind() != io::ErrorKind::NotFound
            {
                rollback_errors.push(format!("{}: {error}", artifact.staged.display()));
            }
        }

        if rollback_errors.is_empty()
            && let Err(error) = marker.remove_durably()
        {
            rollback_errors.push(format!("{}: {error}", marker.path.display()));
        }

        let marker_preserved = if rollback_errors.is_empty() {
            true
        } else {
            match marker.ensure_present() {
                Ok(()) => true,
                Err(error) => {
                    rollback_errors.push(format!(
                        "{} could not be preserved: {error}",
                        marker.path.display()
                    ));
                    false
                }
            }
        };

        if rollback_errors.is_empty() {
            PublicationError(format!(
                "{original_error}; every generated destination was restored"
            ))
        } else {
            let evidence = if marker_preserved {
                "The in-progress marker was preserved for crash detection"
            } else {
                "The in-progress marker could not be fully preserved; inspect the generated destinations immediately"
            };
            PublicationError(format!(
                "{original_error}; rollback was incomplete: {}. {evidence}",
                rollback_errors.join("; ")
            ))
        }
    }
}

fn remove_marker_durably(
    marker: &Path,
    sync_directory: &mut impl FnMut(&Path) -> io::Result<()>,
) -> io::Result<()> {
    match fs::remove_file(marker) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let parent = marker
        .parent()
        .ok_or_else(|| io::Error::other("bindings generation marker has no parent directory"))?;
    sync_directory(parent)
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> io::Result<()> {
    let directory = File::open(directory)?;
    match directory.sync_all() {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::InvalidInput | io::ErrorKind::Unsupported
            ) =>
        {
            // Some Unix filesystems do not implement directory fsync. The marker
            // file itself is still flushed; callers retain the documented
            // best-effort crash evidence on those filesystems.
            Ok(())
        }
        Err(error) => Err(error),
    }
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> io::Result<()> {
    // Rust's portable filesystem API cannot open directory handles for syncing
    // on every supported host (notably Windows). The marker file is still
    // sync_all'd before publication, and the generated diff remains inspectable.
    Ok(())
}

fn prepare_artifact(artifact: &GeneratedArtifact) -> io::Result<PreparedArtifact> {
    let (original, original_permissions) = match fs::metadata(&artifact.destination) {
        Ok(metadata) => {
            if !metadata.is_file() {
                return Err(io::Error::other("destination is not a regular file"));
            }
            (
                Some(fs::read(&artifact.destination)?),
                Some(metadata.permissions()),
            )
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => (None, None),
        Err(error) => return Err(error),
    };
    let staged = stage_bytes(
        &artifact.destination,
        &artifact.content,
        original_permissions.as_ref(),
        "new",
    )?;
    Ok(PreparedArtifact {
        destination: artifact.destination.clone(),
        staged,
        original,
        original_permissions,
        published: false,
    })
}

fn stage_bytes(
    destination: &Path,
    content: &[u8],
    permissions: Option<&Permissions>,
    role: &str,
) -> io::Result<PathBuf> {
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("destination has no parent directory"))?;
    let filename = destination
        .file_name()
        .ok_or_else(|| io::Error::other("destination has no filename"))?
        .to_string_lossy();
    for _ in 0..100 {
        let candidate = parent.join(format!(
            ".{filename}.bindings-gen-{}-{}-{role}",
            std::process::id(),
            NEXT_SIDECAR.fetch_add(1, Ordering::Relaxed),
        ));
        let mut file = match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&candidate)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        if let Err(error) = file.write_all(content).and_then(|()| file.sync_all()) {
            let _ = fs::remove_file(&candidate);
            return Err(error);
        }
        if let Some(permissions) = permissions
            && let Err(error) = fs::set_permissions(&candidate, permissions.clone())
        {
            let _ = fs::remove_file(&candidate);
            return Err(error);
        }
        return Ok(candidate);
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not reserve a unique generated-artifact sidecar",
    ))
}

fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(first_error) if destination.is_file() => {
            fs::remove_file(destination)?;
            fs::rename(source, destination).map_err(|second_error| {
                io::Error::new(
                    second_error.kind(),
                    format!(
                        "direct replace failed ({first_error}); removing the destination then publishing also failed ({second_error})"
                    ),
                )
            })
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{GenerationPlan, replace_file};
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP_ROOT: AtomicU64 = AtomicU64::new(0);

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "canopi_bindings_gen_{name}_{}_{}",
                std::process::id(),
                NEXT_TEMP_ROOT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).expect("create publication test root");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn hold_exclusive_admission(marker: &Path) -> fs::File {
        let admission = marker.with_extension("lock");
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(admission)
            .unwrap();
        file.try_lock().unwrap();
        file
    }

    #[test]
    fn reported_partial_publication_restores_every_destination() {
        let root = TempRoot::new("rollback");
        let first = root.path().join("first.ts");
        let second = root.path().join("second.rs");
        let marker = root.path().join("publication.in-progress");
        fs::write(&first, b"first sentinel").unwrap();
        fs::write(&second, b"second sentinel").unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(first.clone(), b"new first".to_vec()).unwrap();
        plan.add(second.clone(), b"new second".to_vec()).unwrap();
        let mut replacements = 0;
        let error = plan
            .publish_with(|source, destination| {
                replacements += 1;
                if replacements == 2 {
                    return Err(io::Error::other("forced second publication failure"));
                }
                replace_file(source, destination)
            })
            .expect_err("the forced replacement failure should be reported");

        assert!(
            error
                .to_string()
                .contains("forced second publication failure")
        );
        assert_eq!(fs::read(&first).unwrap(), b"first sentinel");
        assert_eq!(fs::read(&second).unwrap(), b"second sentinel");
        assert!(!marker.exists());
        assert_eq!(
            fs::read_dir(root.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().contains("bindings-gen"))
                .count(),
            0,
        );
    }

    #[test]
    fn incomplete_rollback_preserves_prior_bytes_and_crash_marker() {
        let root = TempRoot::new("incomplete_rollback");
        let first = root.path().join("first.ts");
        let second = root.path().join("second.rs");
        let marker = root.path().join("publication.in-progress");
        fs::write(&first, b"first sentinel").unwrap();
        fs::write(&second, b"second sentinel").unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(first.clone(), b"new first".to_vec()).unwrap();
        plan.add(second.clone(), b"new second".to_vec()).unwrap();
        let mut replacements = 0;
        let error = plan
            .publish_with(|source, destination| {
                replacements += 1;
                if matches!(replacements, 2 | 3) {
                    return Err(io::Error::other("forced publication and restore failure"));
                }
                replace_file(source, destination)
            })
            .expect_err("the failed restore should preserve crash evidence");

        assert!(error.to_string().contains("rollback was incomplete"));
        assert!(error.to_string().contains("prior bytes remain staged"));
        assert!(marker.exists());
        assert_eq!(fs::read(&first).unwrap(), b"first sentinel");
        let preserved = fs::read_dir(root.path())
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| entry.file_name().to_string_lossy().ends_with("-restore"))
            .expect("a failed restore must preserve its prior bytes");
        assert_eq!(fs::read(preserved.path()).unwrap(), b"second sentinel");
    }

    #[test]
    fn incomplete_rollback_recreates_marker_after_removal_sync_failure() {
        let root = TempRoot::new("recreate_marker");
        let first = root.path().join("first.ts");
        let second = root.path().join("second.rs");
        let marker = root.path().join("publication.in-progress");
        fs::write(&first, b"first sentinel").unwrap();
        fs::write(&second, b"second sentinel").unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(first.clone(), b"new first".to_vec()).unwrap();
        plan.add(second.clone(), b"new second".to_vec()).unwrap();
        let mut replacements = 0;
        let mut directory_syncs = 0;

        let error = plan
            .publish_with_io(
                |source, destination| {
                    replacements += 1;
                    if replacements == 3 {
                        return Err(io::Error::other("forced restore failure"));
                    }
                    replace_file(source, destination)
                },
                |_| {
                    directory_syncs += 1;
                    if directory_syncs == 2 {
                        return Err(io::Error::other("forced marker removal sync failure"));
                    }
                    Ok(())
                },
            )
            .expect_err("an incomplete rollback must retain crash evidence");

        assert!(error.to_string().contains("rollback was incomplete"));
        assert!(error.to_string().contains("forced restore failure"));
        assert!(marker.exists());
        let marker_contents = fs::read_to_string(&marker).unwrap();
        assert!(marker_contents.contains(&first.display().to_string()));
        assert!(marker_contents.contains(&second.display().to_string()));
        assert_eq!(fs::read(&first).unwrap(), b"first sentinel");
        let preserved = fs::read_dir(root.path())
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| entry.file_name().to_string_lossy().ends_with("-restore"))
            .expect("failed restoration must retain the prior bytes");
        assert_eq!(fs::read(preserved.path()).unwrap(), b"second sentinel");
    }

    #[test]
    fn check_reports_every_stale_destination_without_refreshing_destinations() {
        let root = TempRoot::new("check");
        let first = root.path().join("first.ts");
        let second = root.path().join("second.rs");
        let marker = root.path().join("publication.in-progress");
        fs::write(&first, b"first sentinel").unwrap();
        fs::write(&second, b"second sentinel").unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(first.clone(), b"expected first".to_vec()).unwrap();
        plan.add(second.clone(), b"expected second".to_vec())
            .unwrap();

        let error = plan.check().expect_err("both destinations are stale");

        assert!(error.to_string().contains(&first.display().to_string()));
        assert!(error.to_string().contains(&second.display().to_string()));
        assert_eq!(fs::read(&first).unwrap(), b"first sentinel");
        assert_eq!(fs::read(&second).unwrap(), b"second sentinel");
        assert!(!marker.exists());
    }

    #[test]
    fn active_publication_admission_prevents_transient_check_success() {
        let root = TempRoot::new("active_check");
        let destination = root.path().join("contracts.ts");
        let marker = root.path().join("publication.in-progress");
        fs::write(&destination, b"transient expected bytes").unwrap();
        let _admission = hold_exclusive_admission(&marker);

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(destination.clone(), b"transient expected bytes".to_vec())
            .unwrap();

        let error = plan
            .check()
            .expect_err("a drift check must not read through an active publication");

        assert!(error.to_string().contains("already active"));
        assert_eq!(fs::read(&destination).unwrap(), b"transient expected bytes");
        assert!(!marker.exists());
    }

    #[test]
    fn interrupted_publication_marker_blocks_a_new_publication() {
        let root = TempRoot::new("crash_marker");
        let destination = root.path().join("contracts.ts");
        let marker = root.path().join("publication.in-progress");
        fs::write(&destination, b"sentinel").unwrap();
        fs::write(&marker, b"prior interrupted operation").unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(destination.clone(), b"replacement".to_vec())
            .unwrap();

        let error = plan
            .publish()
            .expect_err("an interrupted publication must be inspected first");

        assert!(
            error
                .to_string()
                .contains("interrupted bindings generation")
        );
        assert_eq!(fs::read(&destination).unwrap(), b"sentinel");
        assert_eq!(fs::read(&marker).unwrap(), b"prior interrupted operation");
    }

    #[test]
    fn active_generation_admission_prevents_snapshot_and_staging() {
        let root = TempRoot::new("active_admission");
        let destination = root.path().join("contracts.ts");
        let marker = root.path().join("publication.in-progress");
        fs::write(&destination, b"sentinel").unwrap();
        let _admission = hold_exclusive_admission(&marker);

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(destination.clone(), b"replacement".to_vec())
            .unwrap();

        let error = plan
            .publish()
            .expect_err("an active generator must own admission before snapshots are captured");

        assert!(error.to_string().contains("already active"));
        assert_eq!(fs::read(&destination).unwrap(), b"sentinel");
        assert!(!marker.exists());
        assert_eq!(
            fs::read_dir(root.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".bindings-gen-"))
                .count(),
            0,
        );
    }

    #[test]
    fn marker_directory_sync_failure_stops_before_publication_and_cleans_marker() {
        let root = TempRoot::new("marker_sync_failure");
        let destination = root.path().join("contracts.ts");
        let marker = root.path().join("publication.in-progress");
        fs::write(&destination, b"sentinel").unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(destination.clone(), b"replacement".to_vec())
            .unwrap();
        let mut sync_calls = 0;

        let error = plan
            .publish_with_io(replace_file, |_| {
                sync_calls += 1;
                if sync_calls == 1 {
                    Err(io::Error::other("forced marker directory sync failure"))
                } else {
                    Ok(())
                }
            })
            .expect_err("an undurable marker must prevent publication");

        assert!(
            error
                .to_string()
                .contains("forced marker directory sync failure")
        );
        assert_eq!(sync_calls, 2, "marker cleanup must also sync its parent");
        assert_eq!(fs::read(&destination).unwrap(), b"sentinel");
        assert!(!marker.exists());
        assert_eq!(
            fs::read_dir(root.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".bindings-gen-"))
                .count(),
            0,
        );
    }

    #[test]
    fn preparation_failure_durably_cleans_marker_and_staged_sidecars() {
        let root = TempRoot::new("preparation_failure");
        let first = root.path().join("first.ts");
        let invalid = root.path().join("not-a-file.rs");
        let marker = root.path().join("publication.in-progress");
        fs::write(&first, b"sentinel").unwrap();
        fs::create_dir(&invalid).unwrap();

        let mut plan = GenerationPlan::new_with_marker(marker.clone());
        plan.add(first.clone(), b"replacement".to_vec()).unwrap();
        plan.add(invalid, b"replacement".to_vec()).unwrap();
        let mut sync_calls = 0;

        let error = plan
            .publish_with_io(replace_file, |_| {
                sync_calls += 1;
                Ok(())
            })
            .expect_err("a preparation failure must abort before publication");

        assert!(
            error
                .to_string()
                .contains("destination is not a regular file")
        );
        assert_eq!(
            sync_calls, 2,
            "marker creation and cleanup must both sync the parent"
        );
        assert_eq!(fs::read(&first).unwrap(), b"sentinel");
        assert!(!marker.exists());
        assert_eq!(
            fs::read_dir(root.path())
                .unwrap()
                .filter_map(Result::ok)
                .filter(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".bindings-gen-"))
                .count(),
            0,
        );
    }
}
