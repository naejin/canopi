//! The isolated qualification Desktop host.
//!
//! The host owns the run: it admits fixtures into the native bridge, serves bounded
//! reads to the bundled worker over opaque handles, keeps its own ledger of those
//! reads, and returns raw evidence to the launcher. It never accepts a path from the
//! renderer, never decodes rasters itself, and never writes a report.
//!
//! The production executor module is reused by path so the harness has one blocking
//! policy, not a second one.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Reused by path from production. `dead_code` is allowed here because this isolated
// crate exercises only the local-operation surface of that module; the module itself is
// not modified.
#[allow(dead_code)]
#[path = "../../../../desktop/src/native_operation.rs"]
mod native_operation;

mod bridge;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use bridge::{read_exact_at, verify_bundled_asset, BundledAsset, HostState};
use native_operation::{
    NativeOperationClass, NativeOperationClassLimits, NativeOperationExecutor,
    NativeOperationLimits,
};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

/// A fixture the launcher declares at startup. The renderer never supplies a path.
#[derive(Clone, Deserialize, Serialize)]
struct FixtureDeclaration {
    id: String,
    path: String,
    sha256: String,
}

/// One asset the launcher bundled and expects the host to have embedded.
#[derive(Clone, Deserialize, Serialize)]
struct AssetDeclaration {
    /// Path relative to the frontend root, as the WebView requests it.
    path: String,
    sha256: String,
    bytes: u64,
}

/// One refused-read control the launcher declares: the request is issued through the
/// same native path as a real read, and the run records whether the refusal code is the
/// declared one. Expected failures are never counted as positive transport evidence, but
/// observing them is evidence that the boundary refuses what it must.
#[derive(Clone, Deserialize, Serialize)]
struct RefusalSpec {
    id: String,
    /// Absent means the admitted fixture's own handle; a number must not be admitted.
    #[serde(default)]
    handle: Option<u64>,
    offset: u64,
    length: u64,
    expected: String,
}

/// The run request the launcher passes on the command line.
#[derive(Clone, Deserialize, Serialize)]
struct RunSpec {
    run: String,
    run_directory: String,
    fixtures: Vec<FixtureDeclaration>,
    /// Where the bundled engine assets are served from, and which module to load.
    asset_base: String,
    wasm_url: String,
    header_bytes: u64,
    /// How long the WebView may work before it cancels the worker cooperatively. The
    /// launcher's hard deadline is later, so a cancelled run still publishes evidence.
    #[serde(default = "default_deadline_ms")]
    deadline_ms: u64,
    windows: Vec<WindowSpec>,
    /// The frontend and engine bytes the launcher copied into the bundle. The host
    /// verifies them against its own embedded snapshot, so a stale bundle is a measured
    /// failure rather than a silent substitution.
    #[serde(default)]
    bundled_assets: Vec<AssetDeclaration>,
    /// Refused-read controls, issued over the real read path.
    #[serde(default)]
    refusals: Vec<RefusalSpec>,
}

/// Nine minutes: the launcher's hard deadline is ten, so cooperative cancellation
/// happens while there is still time to record why.
fn default_deadline_ms() -> u64 {
    9 * 60 * 1000
}

#[derive(Clone, Deserialize, Serialize)]
struct WindowSpec {
    id: String,
    x: u64,
    y: u64,
    w: u64,
    h: u64,
}

struct HostRun {
    spec: RunSpec,
    /// Shared so a blocking read can own its handle into the executor instead of
    /// borrowing the command's state across the await.
    state: Arc<Mutex<HostState>>,
    executor: NativeOperationExecutor,
    /// Filled by `setup` from the embedded assets, never from renderer input.
    bundled_assets: Arc<Mutex<Vec<BundledAsset>>>,
    /// Evidence is published once per run.
    finished: Arc<AtomicBool>,
}

#[derive(Serialize)]
struct FixtureHandle {
    fixture: String,
    handle: u64,
    length: u64,
    sha256: String,
}

#[derive(Serialize)]
struct ReadReply {
    request_id: String,
    handle: u64,
    offset: u64,
    length: u64,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
struct ReadFailure {
    request_id: String,
    code: String,
    message: String,
}

/// The run description the WebView reads.
///
/// It carries no path: the fixture is named, not located, and the run directory is the
/// host's own business. The WebView receives the run nonce it must present on every
/// later call, so a stale or foreign caller cannot act on this run.
#[derive(Serialize)]
struct RunDescription {
    run: String,
    asset_base: String,
    wasm_url: String,
    header_bytes: u64,
    deadline_ms: u64,
    windows: Vec<WindowSpec>,
    refusals: Vec<RefusalSpec>,
    bundled_assets: Vec<String>,
}

#[tauri::command]
fn pilot_input(run: State<'_, HostRun>) -> RunDescription {
    eprintln!("host: pilot_input served to the webview");
    RunDescription {
        run: run.spec.run.clone(),
        asset_base: run.spec.asset_base.clone(),
        wasm_url: run.spec.wasm_url.clone(),
        header_bytes: run.spec.header_bytes,
        deadline_ms: run.spec.deadline_ms,
        windows: run.spec.windows.clone(),
        refusals: run.spec.refusals.clone(),
        bundled_assets: run
            .spec
            .bundled_assets
            .iter()
            .map(|asset| asset.path.clone())
            .collect(),
    }
}

#[tauri::command]
async fn admit_fixtures(
    run: State<'_, HostRun>,
    nonce: String,
) -> Result<Vec<FixtureHandle>, String> {
    require_nonce(&run, &nonce)?;
    let declarations = run.spec.fixtures.clone();
    let executor = run.executor.clone();
    let shared = Arc::clone(&run.state);
    let results = executor
        .run(
            NativeOperationClass::Local,
            "qualification-admit-fixtures",
            move || -> Result<Vec<FixtureHandle>, String> {
                let mut handles = Vec::new();
                // The lock is held only for the state transitions; hashing happens in
                // short operations that release it between fixtures.
                for fixture in &declarations {
                    let path = PathBuf::from(&fixture.path);
                    let (sha256, length) = {
                        let mut state = shared
                            .lock()
                            .map_err(|_| "host state poisoned".to_string())?;
                        state.admit_fixture(&fixture.id, &path, &fixture.sha256)?
                    };
                    let handle = {
                        let mut state = shared
                            .lock()
                            .map_err(|_| "host state poisoned".to_string())?;
                        state.open(&fixture.id)?
                    };
                    handles.push(FixtureHandle {
                        fixture: fixture.id.clone(),
                        handle,
                        length,
                        sha256,
                    });
                }
                Ok(handles)
            },
        )
        .await;
    match results {
        Ok(handles) => Ok(handles),
        Err(problem) => Err(problem),
    }
}

/// Validate the caller's run nonce.
///
/// The host never supplies the current nonce on a caller's behalf: a request that does
/// not name this run is refused, so a reply intended for another run cannot be accepted.
fn require_nonce(run: &State<'_, HostRun>, nonce: &str) -> Result<(), String> {
    if nonce != run.spec.run {
        return Err(format!(
            "wrong-run: this host is running {} but the request names {}",
            run.spec.run, nonce
        ));
    }
    Ok(())
}

#[tauri::command]
async fn read(
    run: State<'_, HostRun>,
    nonce: String,
    handle: u64,
    offset: u64,
    length: u64,
    request_id: String,
) -> Result<ReadReply, ReadFailure> {
    // There is no label parameter: a renderer request is a candidate read, and the host
    // owns that label. Preflight hashing is the host's own reference I/O.
    if let Err(problem) = require_nonce(&run, &nonce) {
        return Err(ReadFailure {
            request_id,
            code: "wrong-run".to_string(),
            message: problem,
        });
    }
    let run_id = run.spec.run.clone();
    let executor = run.executor.clone();
    let shared = Arc::clone(&run.state);

    // Reservation first, under a short lock: identity, handle state, capacity and the
    // interval are all decided before any work is queued, so two overlapping requests
    // with the same identity cannot both execute and excess work is refused rather than
    // queued without bound.
    let reservation = {
        let mut state = match shared.lock() {
            Ok(state) => state,
            Err(_) => {
                return Err(ReadFailure {
                    request_id,
                    code: "host-state-poisoned".to_string(),
                    message: "host state poisoned".to_string(),
                })
            }
        };
        state.reserve(handle, offset, length, &request_id, &run_id)
    };
    let mut reservation = match reservation {
        Ok(reservation) => reservation,
        Err(error) => {
            return Err(ReadFailure {
                request_id,
                code: error.code().to_string(),
                message: format!("read refused: {}", error.code()),
            })
        }
    };

    let work_shared = Arc::clone(&shared);
    let result = executor
        .run(
            NativeOperationClass::Local,
            "qualification-range-read",
            move || -> Result<Vec<u8>, String> {
                // Start and settle take short locks; the read itself holds none, and it
                // reads positionally through the reservation's own descriptor.
                if let Ok(mut state) = work_shared.lock() {
                    state.start(&mut reservation);
                }
                // One positional read: its bytes are the result and its outcome is what
                // the ledger records.
                let read = read_exact_at(&reservation.file, reservation.offset, reservation.length);
                let bytes = read.as_ref().ok().cloned();
                let outcome = read.map(|_| ()).map_err(|_| bridge::ReadError::OutOfRange);
                if let Ok(mut state) = work_shared.lock() {
                    state.settle(reservation, outcome);
                    // Descriptors are dropped only once nothing is outstanding, so a
                    // teardown can never pull a file out from under a running read.
                    if state.outstanding() == 0 && state.is_torn_down() {
                        state.drop_descriptors();
                    }
                }
                match bytes {
                    Some(bytes) => Ok(bytes),
                    None => Err(bridge::ReadError::OutOfRange.code().to_string()),
                }
            },
        )
        .await;

    match result {
        Ok(bytes) => Ok(ReadReply {
            request_id,
            handle,
            offset,
            length,
            bytes,
        }),
        Err(code) => Err(ReadFailure {
            request_id,
            message: format!("read failed: {code}"),
            code,
        }),
    }
}

#[tauri::command]
async fn close(run: State<'_, HostRun>, nonce: String, handle: u64) -> Result<bool, String> {
    require_nonce(&run, &nonce)?;
    let mut state = run
        .state
        .lock()
        .map_err(|_| "host state poisoned".to_string())?;
    state
        .close(handle)
        .map_err(|error| error.code().to_string())
}

/// Return raw evidence to the launcher: the native ledger and the runtime identity.
/// The host writes no report and takes no output path from the renderer.
#[tauri::command]
async fn finish(
    run: State<'_, HostRun>,
    app: tauri::AppHandle,
    nonce: String,
    evidence: serde_json::Value,
) -> Result<String, String> {
    require_nonce(&run, &nonce)?;
    // Single-shot: the first finish publishes this run's evidence, and a second cannot
    // replace it, whatever it carries.
    if run
        .finished
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(
            "the evidence for this run was already published; finish is single-shot".to_string(),
        );
    }
    let revoked = {
        let mut state = run
            .state
            .lock()
            .map_err(|_| "host state poisoned".to_string())?;
        state.revoke_all()
    };
    let ledger = {
        let state = run
            .state
            .lock()
            .map_err(|_| "host state poisoned".to_string())?;
        serde_json::to_value(state.ledger()).map_err(|error| error.to_string())?
    };
    let fixtures = {
        let state = run
            .state
            .lock()
            .map_err(|_| "host state poisoned".to_string())?;
        serde_json::to_value(state.admitted_fixtures()).map_err(|error| error.to_string())?
    };
    let bundled_assets = {
        let assets = run
            .bundled_assets
            .lock()
            .map_err(|_| "asset check poisoned".to_string())?;
        serde_json::to_value(&*assets).map_err(|error| error.to_string())?
    };
    let webview = app
        .get_webview_window("qualification")
        .map(|window| window.url().map(|url| url.to_string()).unwrap_or_default())
        .unwrap_or_default();
    eprintln!("host: finish received, revoking {revoked} handle(s)");
    let payload = serde_json::json!({
        "run": run.spec.run,
        "nativeLedger": ledger,
        "fixturesOpened": fixtures,
        "bundledAssets": bundled_assets,
        "handlesRevoked": revoked,
        "webviewOrigin": webview,
        "evidence": evidence,
    });
    let directory = PathBuf::from(&run.spec.run_directory);
    let target = directory.join("host-evidence.json");
    let document = format!("{}\n", serde_json::to_string_pretty(&payload).unwrap());
    // Staged inside the run directory this host owns, then linked into place: the
    // publication either happens completely or not at all, and never replaces an
    // existing evidence document.
    let staged = directory.join(format!(".host-evidence-stage-{}", std::process::id()));
    std::fs::write(&staged, document)
        .map_err(|error| format!("cannot stage host evidence: {error}"))?;
    let published = std::fs::hard_link(&staged, &target);
    let _ = std::fs::remove_file(&staged);
    published.map_err(|error| {
        format!(
            "cannot publish host evidence at {} without replacement: {error}",
            target.display()
        )
    })?;
    // The measurement is over once the evidence is on disk. The host stops itself
    // rather than waiting for a window that no one will close, so the launcher can
    // treat the run as finished without a deadline timeout.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        handle.exit(0);
    });
    Ok(target.to_string_lossy().to_string())
}

fn load_spec() -> RunSpec {
    let args: Vec<String> = std::env::args().collect();
    let index = args.iter().position(|arg| arg == "--run-spec");
    let path = index
        .and_then(|index| args.get(index + 1))
        .cloned()
        .expect("the qualification host requires --run-spec <file>");
    let text = std::fs::read_to_string(&path).expect("cannot read the run spec");
    serde_json::from_str(&text).expect("the run spec is not valid JSON")
}

fn main() {
    let spec = load_spec();
    // Two running reads with bounded admission, reusing the production limits type.
    let limits = NativeOperationLimits::new(
        NativeOperationClassLimits::new(2, 1),
        NativeOperationClassLimits::new(2, 1),
        NativeOperationClassLimits::new(bridge::PILOT_READ_LIMITS.0, bridge::PILOT_READ_LIMITS.1),
        NativeOperationClassLimits::new(2, 1),
    );
    let executor = NativeOperationExecutor::new(limits).expect("read limits must be valid");
    let state = HostState::new(spec.run.clone());
    let bundled_assets = Arc::new(Mutex::new(Vec::new()));
    let checks = Arc::clone(&bundled_assets);
    let finished = Arc::new(AtomicBool::new(false));
    tauri::Builder::default()
        .manage(HostRun {
            spec,
            state: Arc::new(Mutex::new(state)),
            executor,
            bundled_assets,
            finished,
        })
        .invoke_handler(tauri::generate_handler![
            pilot_input,
            admit_fixtures,
            read,
            close,
            finish
        ])
        .setup(move |app| {
            // The bundle is embedded at compile time, so these are the exact bytes the
            // WebView will serve; comparing them with the launcher's declaration is the
            // host's own check that no stale or substituted asset is being measured.
            {
                let resolver = app.asset_resolver();
                let spec = app.state::<HostRun>().spec.clone();
                let mut results = Vec::new();
                for declaration in &spec.bundled_assets {
                    let embedded = resolver.get(declaration.path.clone());
                    let bytes = embedded.as_ref().map(|asset| asset.bytes());
                    let check = verify_bundled_asset(
                        &declaration.path,
                        &declaration.sha256,
                        declaration.bytes,
                        bytes,
                    );
                    eprintln!(
                        "host: bundled asset {} matches={} (embedded {} bytes, declared {} bytes)",
                        check.path,
                        check.matches,
                        check.embedded_bytes.unwrap_or(0),
                        check.expected_bytes
                    );
                    results.push(check);
                }
                if let Ok(mut slot) = checks.lock() {
                    *slot = results;
                }
            }
            if let Some(window) = app.get_webview_window("qualification") {
                // The pilot is a measurement, not a product surface: keep the window
                // hidden unless the launcher asks for it.
                if std::env::var("QUAL_HOST_VISIBLE").is_err() {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the qualification host failed to start");
}
