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
use std::sync::{Arc, Mutex};

use bridge::{verify_bundled_asset, BundledAsset, HostState, ReadLabel};
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

/// The pilot input the WebView reads. It is launcher input, not renderer input.
#[tauri::command]
fn pilot_input(run: State<'_, HostRun>) -> RunSpec {
    eprintln!("host: pilot_input served to the webview");
    run.spec.clone()
}

#[tauri::command]
async fn admit_fixtures(run: State<'_, HostRun>) -> Result<Vec<FixtureHandle>, String> {
    let declarations = run.spec.fixtures.clone();
    let mut handles = Vec::new();
    for fixture in declarations {
        let path = PathBuf::from(&fixture.path);
        let mut state = run
            .state
            .lock()
            .map_err(|_| "host state poisoned".to_string())?;
        let (sha256, length) = state.admit_fixture(&fixture.id, &path, &fixture.sha256)?;
        let handle = state.open(&fixture.id)?;
        handles.push(FixtureHandle {
            fixture: fixture.id,
            handle,
            length,
            sha256,
        });
    }
    Ok(handles)
}

#[tauri::command]
async fn read(
    run: State<'_, HostRun>,
    handle: u64,
    offset: u64,
    length: u64,
    request_id: String,
    label: Option<String>,
) -> Result<ReadReply, ReadFailure> {
    let label = match label.as_deref() {
        Some("reference") => ReadLabel::Reference,
        _ => ReadLabel::Candidate,
    };
    let run_id = run.spec.run.clone();
    let executor = run.executor.clone();
    let shared = Arc::clone(&run.state);
    let work_request = request_id.clone();
    let result = executor
        .run(
            NativeOperationClass::Local,
            "qualification-range-read",
            move || {
                // The lock is taken inside the blocking work so the UI thread never waits
                // on it, and it is released before the reply is serialised.
                let mut state = shared
                    .lock()
                    .map_err(|_| "host state poisoned".to_string())?;
                state
                    .read(handle, offset, length, &work_request, &run_id, label)
                    .map_err(|error| error.code().to_string())
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
            message: format!("read refused: {code}"),
            code,
        }),
    }
}

#[tauri::command]
async fn close(run: State<'_, HostRun>, handle: u64) -> Result<bool, String> {
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
    evidence: serde_json::Value,
) -> Result<String, String> {
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
    let target = PathBuf::from(&run.spec.run_directory).join("host-evidence.json");
    std::fs::write(
        &target,
        format!("{}\n", serde_json::to_string_pretty(&payload).unwrap()),
    )
    .map_err(|error| format!("cannot write host evidence: {error}"))?;
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
    tauri::Builder::default()
        .manage(HostRun {
            spec,
            state: Arc::new(Mutex::new(state)),
            executor,
            bundled_assets,
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
