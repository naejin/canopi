use std::collections::HashSet;
use std::error::Error;
use std::fmt;
use std::fs::{self, OpenOptions, Permissions};
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
    marker: PathBuf,
    artifacts: Vec<GeneratedArtifact>,
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
        Self {
            marker: repo_root
                .join("target")
                .join("bindings-gen-publication.in-progress"),
            artifacts: Vec::new(),
        }
    }

    #[cfg(test)]
    fn new_with_marker(marker: PathBuf) -> Self {
        Self {
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
        mut replace: impl FnMut(&Path, &Path) -> io::Result<()>,
    ) -> Result<(), PublicationError> {
        self.reject_interrupted_publication()?;
        let mut prepared = self.prepare_all()?;
        self.create_marker()?;

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
                    format!("failed to publish generated artifact {destination}: {error}"),
                ));
            }
            prepared[index].published = true;
        }

        if let Err(error) = fs::remove_file(&self.marker) {
            return Err(self.rollback_after(
                &mut prepared,
                &mut replace,
                format!(
                    "generated artifacts were published but the in-progress marker could not be removed: {error}"
                ),
            ));
        }
        Ok(())
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

    fn create_marker(&self) -> Result<(), PublicationError> {
        let parent = self.marker.parent().ok_or_else(|| {
            PublicationError("bindings generation marker has no parent directory".to_owned())
        })?;
        fs::create_dir_all(parent).map_err(|error| {
            PublicationError(format!(
                "failed to create bindings generation marker directory {}: {error}",
                parent.display()
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
        writeln!(
            marker,
            "bindings-gen was publishing these generated destinations when it stopped:"
        )
        .and_then(|()| {
            self.artifacts
                .iter()
                .try_for_each(|artifact| writeln!(marker, "{}", artifact.destination.display()))
        })
        .and_then(|()| marker.sync_all())
        .map_err(|error| {
            let _ = fs::remove_file(&self.marker);
            PublicationError(format!(
                "failed to persist bindings generation in-progress marker {}: {error}",
                self.marker.display()
            ))
        })
    }

    fn rollback_after(
        &self,
        prepared: &mut [PreparedArtifact],
        replace: &mut impl FnMut(&Path, &Path) -> io::Result<()>,
        original_error: String,
    ) -> PublicationError {
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
            && let Err(error) = fs::remove_file(&self.marker)
        {
            rollback_errors.push(format!("{}: {error}", self.marker.display()));
        }

        if rollback_errors.is_empty() {
            PublicationError(format!(
                "{original_error}; every generated destination was restored"
            ))
        } else {
            PublicationError(format!(
                "{original_error}; rollback was incomplete: {}. The in-progress marker was preserved for crash detection",
                rollback_errors.join("; ")
            ))
        }
    }
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
    fn check_reports_every_stale_destination_without_writing() {
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
}
