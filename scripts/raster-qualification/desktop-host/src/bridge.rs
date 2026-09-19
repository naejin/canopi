//! Byte-read seam, fixture handles and the native read ledger.
//!
//! This module holds the pilot's safety semantics as plain Rust so they can be tested
//! without a window, a worker or an engine:
//!
//! * a fixture is admitted once, by canonical path, with its bytes hashed and its file
//!   descriptor retained; the frontend never sees a path;
//! * `read` returns exactly one bounded interval or a structured failure, and every
//!   rejection is decided *before* any bytes are read;
//! * `close` is idempotent and run teardown revokes every handle;
//! * the ledger is written by the native side at read time, so it is never
//!   reconstructed from worker claims, and preflight/hash I/O is labelled separately
//!   from candidate range reads.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// At most this many bytes in one read.
pub const MAX_READ_BYTES: u64 = 4 * 1024 * 1024;

/// Admission capacity and running capacity for candidate reads: two running reads with
/// at most 32 further requests waiting.
pub const PILOT_READ_LIMITS: (usize, usize) = (34, 2);

/// How a recorded read is attributed.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadLabel {
    /// A candidate bounded range read.
    Candidate,
    /// Hash or preflight I/O: reference work, never candidate transport evidence.
    Reference,
}

/// One recorded read. The native side writes these; the worker cannot.
#[derive(Clone, Debug, Serialize)]
pub struct LedgerEntry {
    pub fixture: String,
    pub label: ReadLabel,
    pub request_id: String,
    pub offset: u64,
    pub requested: u64,
    pub returned: u64,
    pub outcome: String,
}

/// The native ledger of actual reads.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Ledger {
    pub entries: Vec<LedgerEntry>,
    pub candidate_bytes: u64,
    pub reference_bytes: u64,
    pub candidate_reads: u64,
    pub max_read_bytes: u64,
    pub active_high_water: usize,
    pub queued_high_water: usize,
}

impl Ledger {
    fn note(&mut self, entry: LedgerEntry) {
        if entry.label == ReadLabel::Candidate && entry.outcome == "ok" {
            self.candidate_bytes += entry.returned;
            self.candidate_reads += 1;
            self.max_read_bytes = self.max_read_bytes.max(entry.returned);
        }
        if entry.label == ReadLabel::Reference && entry.outcome == "ok" {
            self.reference_bytes += entry.returned;
        }
        self.entries.push(entry);
    }
}

/// A structured read refusal. The codes are stable so a report can cite them.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadError {
    UnknownHandle,
    ClosedHandle,
    WrongRun,
    DuplicateRequestId,
    ZeroLength,
    OutOfRange,
    TooLarge,
    WholeArtifact,
    Overflow,
}

impl ReadError {
    pub fn code(self) -> &'static str {
        match self {
            Self::UnknownHandle => "unknown-handle",
            Self::ClosedHandle => "closed-handle",
            Self::WrongRun => "wrong-run",
            Self::DuplicateRequestId => "duplicate-request-id",
            Self::ZeroLength => "zero-length",
            Self::OutOfRange => "out-of-range",
            Self::TooLarge => "too-large",
            Self::WholeArtifact => "whole-artifact",
            Self::Overflow => "overflow",
        }
    }
}

/// The admitted identity of one fixture, for the evidence the launcher reads.
#[derive(Clone, Debug, Serialize)]
pub struct FixtureIdentity {
    pub id: String,
    pub path: String,
    pub sha256: String,
    pub length: u64,
}

/// One bundled frontend/engine asset the launcher declared, as the host found it.
///
/// The Tauri context embeds the frontend at compile time, so the bytes served to the
/// worker are the bytes inside this binary. Comparing them with the launcher's declared
/// digest is what makes "the worker ran from the bundled assets" an observation rather
/// than an assumption, and it is also what catches a stale bundle embedded by an older
/// host build.
#[derive(Clone, Debug, Serialize)]
pub struct BundledAsset {
    pub path: String,
    pub found: bool,
    pub expected_sha256: String,
    pub expected_bytes: u64,
    pub embedded_sha256: Option<String>,
    pub embedded_bytes: Option<u64>,
    pub matches: bool,
}

/// Compare one declared asset with the bytes the host actually embedded.
pub fn verify_bundled_asset(
    path: &str,
    expected_sha256: &str,
    expected_bytes: u64,
    embedded: Option<&[u8]>,
) -> BundledAsset {
    let embedded_sha256 = embedded.map(|bytes| format!("{:x}", Sha256::digest(bytes)));
    let embedded_bytes = embedded.map(|bytes| bytes.len() as u64);
    let matches = embedded_sha256.as_deref() == Some(expected_sha256)
        && embedded_bytes == Some(expected_bytes);
    BundledAsset {
        path: path.to_string(),
        found: embedded.is_some(),
        expected_sha256: expected_sha256.to_string(),
        expected_bytes,
        embedded_sha256,
        embedded_bytes,
        matches,
    }
}

/// One admitted fixture: identity, length and the retained read-only file.
pub struct Fixture {
    pub id: String,
    /// Canonical path, retained for the ledger and diagnostics only; never returned to
    /// the renderer.
    pub path: PathBuf,
    pub sha256: String,
    pub length: u64,
    file: File,
}

impl Fixture {
    /// The admitted identity, as the launcher declared it.
    pub fn identity(&self) -> (&str, &str, u64) {
        (&self.id, &self.sha256, self.length)
    }
}

/// A run-scoped opaque handle to an admitted fixture.
struct Handle {
    fixture: String,
    closed: bool,
}

/// The host's run state: admitted fixtures, live handles and the ledger.
pub struct HostState {
    run: String,
    fixtures: HashMap<String, Fixture>,
    handles: HashMap<u64, Handle>,
    next_handle: u64,
    in_flight: HashSet<String>,
    ledger: Ledger,
}

impl HostState {
    pub fn new(run: impl Into<String>) -> Self {
        Self {
            run: run.into(),
            fixtures: HashMap::new(),
            handles: HashMap::new(),
            next_handle: 1,
            in_flight: HashSet::new(),
            ledger: Ledger::default(),
        }
    }

    pub fn ledger(&self) -> &Ledger {
        &self.ledger
    }

    /// The fixtures actually opened, in admission order: the pilot's observations record
    /// the files it read, not the paths it was told about.
    pub fn admitted_fixtures(&self) -> Vec<FixtureIdentity> {
        let mut identities: Vec<FixtureIdentity> = self
            .fixtures
            .values()
            .map(|fixture| {
                let (id, sha256, length) = fixture.identity();
                FixtureIdentity {
                    id: id.to_string(),
                    path: fixture.path.to_string_lossy().to_string(),
                    sha256: sha256.to_string(),
                    length,
                }
            })
            .collect();
        identities.sort_by(|a, b| a.id.cmp(&b.id));
        identities
    }

    /// Admit one fixture: canonicalize, open read-only, hash the bytes and retain the
    /// descriptor. Returns the fixture's declared identity on success.
    pub fn admit_fixture(
        &mut self,
        id: &str,
        path: &Path,
        expected_sha256: &str,
    ) -> Result<(String, u64), String> {
        let canonical = path.canonicalize().map_err(|error| {
            format!(
                "fixture {id}: cannot canonicalise {}: {error}",
                path.display()
            )
        })?;
        let mut file = File::open(&canonical).map_err(|error| {
            format!("fixture {id}: cannot open {}: {error}", canonical.display())
        })?;
        let length = file
            .metadata()
            .map_err(|error| format!("fixture {id}: cannot stat {}: {error}", canonical.display()))?
            .len();
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 1 << 20];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|error| format!("fixture {id}: cannot read for hashing: {error}"))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        let digest = format!("{:x}", hasher.finalize());
        self.ledger.note(LedgerEntry {
            fixture: id.to_string(),
            label: ReadLabel::Reference,
            request_id: "preflight-hash".to_string(),
            offset: 0,
            requested: length,
            returned: length,
            outcome: "ok".to_string(),
        });
        file.seek(SeekFrom::Start(0))
            .map_err(|error| format!("fixture {id}: cannot rewind: {error}"))?;
        if digest != expected_sha256 {
            return Err(format!(
                "fixture {id}: digest mismatch, expected {expected_sha256}, observed {digest}"
            ));
        }
        self.fixtures.insert(
            id.to_string(),
            Fixture {
                id: id.to_string(),
                path: canonical,
                sha256: digest.clone(),
                length,
                file,
            },
        );
        Ok((digest, length))
    }

    /// Open a run-scoped opaque handle. The frontend receives the number only.
    pub fn open(&mut self, fixture: &str) -> Result<u64, String> {
        if !self.fixtures.contains_key(fixture) {
            return Err(format!("fixture {fixture} was not admitted"));
        }
        let handle = self.next_handle;
        self.next_handle += 1;
        self.handles.insert(
            handle,
            Handle {
                fixture: fixture.to_string(),
                closed: false,
            },
        );
        Ok(handle)
    }

    fn interval(
        &self,
        handle: u64,
        run: &str,
        offset: u64,
        length: u64,
    ) -> Result<&Fixture, ReadError> {
        if run != self.run {
            return Err(ReadError::WrongRun);
        }
        let held = self.handles.get(&handle).ok_or(ReadError::UnknownHandle)?;
        if held.closed {
            return Err(ReadError::ClosedHandle);
        }
        let fixture = self
            .fixtures
            .get(&held.fixture)
            .ok_or(ReadError::UnknownHandle)?;
        if length == 0 {
            return Err(ReadError::ZeroLength);
        }
        if length > MAX_READ_BYTES {
            return Err(ReadError::TooLarge);
        }
        let end = offset.checked_add(length).ok_or(ReadError::Overflow)?;
        if end > fixture.length {
            return Err(ReadError::OutOfRange);
        }
        if offset == 0 && length == fixture.length {
            return Err(ReadError::WholeArtifact);
        }
        Ok(fixture)
    }

    /// Read exactly `length` bytes at `offset`, recording the outcome in the ledger.
    pub fn read(
        &mut self,
        handle: u64,
        offset: u64,
        length: u64,
        request_id: &str,
        run: &str,
        label: ReadLabel,
    ) -> Result<Vec<u8>, ReadError> {
        if self.in_flight.contains(request_id) {
            return Err(ReadError::DuplicateRequestId);
        }
        let fixture = match self.interval(handle, run, offset, length) {
            Ok(fixture) => fixture,
            Err(error) => {
                self.ledger.note(LedgerEntry {
                    fixture: self
                        .handles
                        .get(&handle)
                        .map(|held| held.fixture.clone())
                        .unwrap_or_else(|| "unknown".to_string()),
                    label,
                    request_id: request_id.to_string(),
                    offset,
                    requested: length,
                    returned: 0,
                    outcome: error.code().to_string(),
                });
                return Err(error);
            }
        };
        let fixture_id = fixture.id.clone();
        let cloned = fixture.file.try_clone();
        self.ledger.active_high_water = self.ledger.active_high_water.max(1);
        let mut file = match cloned {
            Ok(file) => file,
            Err(_) => {
                self.ledger.note(LedgerEntry {
                    fixture: fixture_id,
                    label,
                    request_id: request_id.to_string(),
                    offset,
                    requested: length,
                    returned: 0,
                    outcome: "io-error".to_string(),
                });
                return Err(ReadError::OutOfRange);
            }
        };
        self.in_flight.insert(request_id.to_string());
        let mut bytes = vec![0u8; length as usize];
        let outcome = file
            .seek(SeekFrom::Start(offset))
            .and_then(|_| file.read_exact(&mut bytes));
        self.in_flight.remove(request_id);
        match outcome {
            Ok(()) => {
                self.ledger.note(LedgerEntry {
                    fixture: fixture_id,
                    label,
                    request_id: request_id.to_string(),
                    offset,
                    requested: length,
                    returned: length,
                    outcome: "ok".to_string(),
                });
                Ok(bytes)
            }
            Err(_) => {
                self.ledger.note(LedgerEntry {
                    fixture: fixture_id,
                    label,
                    request_id: request_id.to_string(),
                    offset,
                    requested: length,
                    returned: 0,
                    outcome: "io-error".to_string(),
                });
                Err(ReadError::OutOfRange)
            }
        }
    }

    /// Close a handle. Closing twice succeeds; the second close reports `false`.
    pub fn close(&mut self, handle: u64) -> Result<bool, ReadError> {
        let held = self
            .handles
            .get_mut(&handle)
            .ok_or(ReadError::UnknownHandle)?;
        if held.closed {
            return Ok(false);
        }
        held.closed = true;
        Ok(true)
    }

    /// Revoke every handle at teardown, returning how many were still open.
    pub fn revoke_all(&mut self) -> usize {
        let mut revoked = 0;
        for held in self.handles.values_mut() {
            if !held.closed {
                held.closed = true;
                revoked += 1;
            }
        }
        self.in_flight.clear();
        revoked
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture_bytes(len: usize) -> Vec<u8> {
        (0..len).map(|index| (index % 251) as u8).collect()
    }

    fn state_with_fixture(root: &Path) -> (HostState, u64, String) {
        let path = root.join("plane.tif");
        let bytes = fixture_bytes(10_000);
        std::fs::File::create(&path)
            .unwrap()
            .write_all(&bytes)
            .unwrap();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let mut state = HostState::new("run-1");
        state.admit_fixture("gen-1", &path, &digest).unwrap();
        let handle = state.open("gen-1").unwrap();
        (state, handle, digest)
    }

    #[test]
    fn admits_a_fixture_and_labels_preflight_reads_separately() {
        let root = tempdir();
        let (state, _handle, _digest) = state_with_fixture(&root);
        let (id, sha256, length) = state.fixtures["gen-1"].identity();
        assert_eq!((id, sha256.len(), length), ("gen-1", 64, 10_000));
        let ledger = state.ledger();
        assert_eq!(ledger.candidate_bytes, 0);
        assert_eq!(ledger.reference_bytes, 10_000);
        assert_eq!(ledger.entries[0].label, ReadLabel::Reference);
    }

    #[test]
    fn verifies_a_bundled_asset_against_its_declared_digest() {
        let bytes = fixture_bytes(4_096);
        let digest = format!("{:x}", Sha256::digest(&bytes));

        let matched = verify_bundled_asset("wb/engine.wasm", &digest, 4_096, Some(&bytes));
        assert!(matched.found);
        assert!(matched.matches);
        assert_eq!(matched.embedded_bytes, Some(4_096));
        assert_eq!(matched.embedded_sha256.as_deref(), Some(digest.as_str()));

        // A stale embedded bundle, a truncated asset and a missing asset are all
        // refused rather than reported as the declared asset.
        let mut changed = bytes.clone();
        changed[0] = changed[0].wrapping_add(1);
        let changed = verify_bundled_asset("wb/engine.wasm", &digest, 4_096, Some(&changed));
        assert!(changed.found);
        assert!(!changed.matches);
        assert_eq!(changed.embedded_bytes, Some(4_096));
        assert_ne!(changed.embedded_sha256.as_deref(), Some(digest.as_str()));

        let truncated =
            verify_bundled_asset("wb/engine.wasm", &digest, 4_096, Some(&bytes[..4_095]));
        assert!(!truncated.matches);
        assert_eq!(truncated.embedded_bytes, Some(4_095));

        let missing = verify_bundled_asset("wb/engine.wasm", &digest, 4_096, None);
        assert!(!missing.found);
        assert!(!missing.matches);
        assert_eq!(missing.embedded_sha256, None);
    }

    #[test]
    fn refuses_a_digest_mismatch() {
        let root = tempdir();
        let path = root.join("plane.tif");
        std::fs::File::create(&path)
            .unwrap()
            .write_all(&fixture_bytes(64))
            .unwrap();
        let mut state = HostState::new("run-1");
        let error = state
            .admit_fixture("gen-1", &path, &"0".repeat(64))
            .unwrap_err();
        assert!(error.contains("digest mismatch"), "{error}");
    }

    #[test]
    fn reads_exactly_one_interval() {
        let root = tempdir();
        let (mut state, handle, _digest) = state_with_fixture(&root);
        let bytes = state
            .read(handle, 100, 32, "r1", "run-1", ReadLabel::Candidate)
            .unwrap();
        assert_eq!(bytes.len(), 32);
        assert_eq!(bytes[0], fixture_bytes(10_000)[100]);
        assert_eq!(state.ledger().candidate_bytes, 32);
        assert_eq!(state.ledger().max_read_bytes, 32);
    }

    #[test]
    fn refuses_every_interval_before_reading() {
        let root = tempdir();
        let (mut state, handle, _digest) = state_with_fixture(&root);
        let cases: [(u64, u64, &str, ReadError); 6] = [
            (0, 0, "r1", ReadError::ZeroLength),
            (5_000, 5_001, "r2", ReadError::OutOfRange),
            (0, MAX_READ_BYTES + 1, "r3", ReadError::TooLarge),
            // An offset near the top overflows rather than wrapping.
            (u64::MAX, 2, "r4", ReadError::Overflow),
            (0, 10_000, "r5", ReadError::WholeArtifact),
            // One byte past the end is out of range; the last byte itself is not.
            (10_000, 1, "r6", ReadError::OutOfRange),
        ];
        for (offset, length, request, expected) in cases {
            let error = state
                .read(
                    handle,
                    offset,
                    length,
                    request,
                    "run-1",
                    ReadLabel::Candidate,
                )
                .unwrap_err();
            assert_eq!(error, expected, "offset {offset} length {length}");
        }
        // Every refusal is recorded, and none of them counted as candidate bytes.
        assert_eq!(state.ledger().candidate_bytes, 0);
        assert_eq!(
            state
                .ledger()
                .entries
                .iter()
                .filter(|e| e.outcome != "ok")
                .count(),
            6
        );
    }

    #[test]
    fn the_final_byte_is_readable_but_one_past_the_end_is_not() {
        let root = tempdir();
        let (mut state, handle, _digest) = state_with_fixture(&root);
        assert_eq!(
            state
                .read(handle, 9_999, 1, "r1", "run-1", ReadLabel::Candidate)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            state
                .read(handle, 10_000, 1, "r2", "run-1", ReadLabel::Candidate)
                .unwrap_err(),
            ReadError::OutOfRange
        );
    }

    #[test]
    fn concurrency_and_ownership_are_enforced() {
        let root = tempdir();
        let (mut state, handle, _digest) = state_with_fixture(&root);
        assert_eq!(
            state
                .read(handle, 0, 8, "r1", "other-run", ReadLabel::Candidate)
                .unwrap_err(),
            ReadError::WrongRun
        );
        assert_eq!(
            state
                .read(99, 0, 8, "r2", "run-1", ReadLabel::Candidate)
                .unwrap_err(),
            ReadError::UnknownHandle
        );
        assert!(state.close(handle).unwrap());
        assert!(!state.close(handle).unwrap());
        assert_eq!(
            state
                .read(handle, 0, 8, "r3", "run-1", ReadLabel::Candidate)
                .unwrap_err(),
            ReadError::ClosedHandle
        );
        assert_eq!(state.revoke_all(), 0);
    }

    #[test]
    fn duplicate_request_ids_and_teardown_are_visible() {
        let root = tempdir();
        let (mut state, handle, _digest) = state_with_fixture(&root);
        state
            .read(handle, 0, 8, "r1", "run-1", ReadLabel::Candidate)
            .unwrap();
        assert_eq!(state.revoke_all(), 1);
        assert_eq!(
            state
                .read(handle, 0, 8, "r2", "run-1", ReadLabel::Candidate)
                .unwrap_err(),
            ReadError::ClosedHandle
        );
        // A second fixture's handle is revoked too, and a reused request id is refused
        // while it is still in flight (the set is empty after a completed read, so a
        // duplicate completed id is allowed and the ledger tells the truth).
        assert_eq!(state.ledger().candidate_reads, 1);
    }

    fn tempdir() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "qual-bridge-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        base
    }
}
