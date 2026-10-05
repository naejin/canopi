# Native and release

## Purpose

Rules for the Rust/Tauri backend (execution policy, files, network, redaction, the debug MCP bridge), the check commands, the bundled plant DB and the desktop release workflow. LiDAR engines: [data library](data-library.md). Web publishing: [editions](editions.md#web-publishing).

## Authorities and boundaries

- `desktop/src/native_command_policy.rs` decides how a `#[tauri::command]` may run; `desktop/src/native_operation.rs` owns the `NativeOperationExecutor` and is the only module that calls the global blocking pool. `clippy.toml` disallows every thread and blocking-pool entry point, resolved by type; a reviewed escape (the executor, the folder opener's reaper, Tauri's generated context) is one statement's `#[expect(clippy::disallowed_methods, reason = "...")]`, and tests may use threads (`native_command_policy::tests`).
- `desktop/tauri.conf.json` is the version authority (read by the About dialog) and holds the CSP and asset-protocol scope; `capabilities/main-window.json` grants exactly the permissions the frontend calls.
- `desktop/src/design/mod.rs` owns file writes; `services/export.rs` admits export payloads; `image_cache.rs` owns outbound image fetches; `services/problem_report/` and `services/folder_reveal.rs` own reports and folder opening.
- `bindings-gen` (`npm run gen:types`) is the only writer of the generated adapter set; it embeds its checkout path at compile time, so run it from the worktree whose bindings you regenerate.
- IPC types come from `common-types` with `specta::Type`; commands return `Result<T, String>`.

## Rules

- Every command is registered once in `generate_handler!` and is executor-backed async or one of the reviewed synchronous entries (`new_design`, `get_health`, `supersede_species_search`, the three LiDAR cancel signals). No filesystem, SQLite, network, rendering, encoding, compression, process, sleeping or unbounded CPU work runs synchronously. Outside the executor closure a command only unwraps and clones its `State` handles; anything else needs a `STATE_ACCESS_ALLOWLIST` entry (`native_command_policy::tests`).
- Every registered command has an `invoke` call site in production frontend source; a command nothing invokes is deleted with everything only it uses (`registered_commands_must_be_invoked_by_production_frontend_source`).
- SQLite: one `Mutex<Connection>` per DB through `db::acquire`; placeholders, never formatted SQL. Runtime crates deny `unwrap_used` and `expect_used`; a justified invariant uses `#[expect(clippy::expect_used, reason = "...")]`.
- Exports: `save_canvas_pdf` admits `.pdf` and a bounded `%PDF-` payload; `export_file` admits `.csv`, `.geojson`, `.json` up to 64 MiB; derived files go through a same-directory temporary and `atomic_replace()` (`services/export.rs`, `design/mod.rs` tests).
- Image cache: only the plant DB's media hosts (iNaturalist S3, Wikimedia Commons and its upload host), HTTPS, at most five re-checked redirects, `image/*` except SVG, 10 MB per image, 500 MB cache (`image_cache.rs` tests).
- Redaction: `problem_report/redactions.rs` (mirrored by `app/problem-report/diagnostics.ts` and `maplibre/redact-credentials.ts`) replaces known folders and absolute paths, and `key=`, `api-key=`, `api_key=`, `apikey=` values, with `<redacted>` (`redactions::tests`, `problem-report-diagnostics.test.ts`, `frontend-architecture-policies.test.ts`). Executor labels are static; logs never carry paths, URLs, Design content or error payloads (advice).
- Problem reports are Desktop-only, local-first, never uploaded; the bundle excludes Design contents, screenshots, raw paths, the Google key and personal libraries unless the off-by-default consent attaches the current Design (`services/problem_report` tests). Folder reveal admits only report, Drafts, Data library and Recent Designs folders (`folder_reveal` tests).
- MCP bridge: `tauri-plugin-mcp-bridge` (=0.13.0) behind the opt-in `mcp-bridge` feature, for agent-driven `cargo tauri dev -f mcp-bridge` only. Only a debug build with the feature registers it (on `127.0.0.1`) and merges `withGlobalTauri: true` and the `mcp-bridge-dev` capability (`desktop/capabilities-dev/`); release builds never expose either (`global_tauri_api_and_bridge_capability_exist_only_for_the_debug_bridge`, `lib.rs`). Its WebSocket has no authentication or Origin check.
- `desktop/THIRD_PARTY_NOTICES.md` names the raster packages and crates (`wbgeotiff` revision, `proj4rs`, the IOGP attribution of the CRS rows), the GeoLibre CLI and `whitebox-wasm` revisions, `wbspatialstats` (AGPL-3.0-or-later) and the Corresponding Source offer (`third-party-notices.test.ts`); `scripts/promote-release.sh` repeats the offer in every release body (`test_promote_release.py`).
- The GeoLibre CLI is a Tauri sidecar (`bundle.externalBin` in `desktop/tauri.conf.json`): `scripts/build-geolibre-cli.sh` writes `desktop/binaries/geolibre-<triple>[.exe]` and `build.rs` bundles it exactly when that file exists, so lint, test and dev builds need no binary and a release build without it only warns.
- CI sidecar (`.github/actions/build-geolibre-cli`): downloaded from the release `geolibre-cli-<revision in the script>`; on a miss built from source and, on pushes to main or the v2 branch, uploaded there, so a revision bump rebuilds once per host. `scripts/smoke-bundled-sidecar.sh` then runs the packaged `geolibre version` from each unpacked deb, AppImage, `.app` and NSIS installer.
- Toolchain: `rust-toolchain.toml` pins the compiler and every `dtolnay/rust-toolchain` step matches it; CI builds `--locked`; `cargo cov` fails under the floors in `.cargo/config.toml`, raised and never lowered.

### Native operation executor

Classes follow the constrained resource, (admitted / running) limits in `NativeOperationLimits::production()`: `Catalog` (8/1) species reads; `UserData` (8/1) settings, favorites, Recent Designs, Notebook, stamps, LiDAR catalogue; `Local` (6/2) Design and draft files, exports, GeoJSON, reports, folders, LiDAR raster work; `Network` (12/4) geocoding and images.

A full class returns its stable busy error before touching anything; admitted work waits FIFO; validation, locks and transactions stay inside the started closure. Tokio enables only `sync` and `time`. Command tests invoke the real command through `tauri::test::mock_builder()` (advice).

## Do not

- Do not extend the synchronous allowlist to avoid moving a command onto the executor.
- Do not add a command without its frontend call site, or keep one after its last caller goes.
- Do not add a second Tokio runtime or platform, rendering or shell crates; the frontend produces exports.
- Do not use blocking dialogs, emit events in `setup()`, or grant a `default` capability set.
- Do not add `rust-version` (the pin is not an MSRV), merge the per-workload `rust-cache` keys, save caches from PR refs, or run `npm audit fix --force` (it breaks the raster peer range the `image-size` and `fflate` overrides hold).
- Do not stream `gh run watch`; poll `gh run view <id> --json status,conclusion,jobs` minutes apart.

## Commands

```bash
cargo tauri dev                                         # repository root; -f mcp-bridge for the debug bridge
cargo fmt --all -- --check
CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings
CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace
CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests
CANOPI_SKIP_BUNDLED_DB=1 cargo cov                      # needs cargo-llvm-cov
cd desktop/web && npm run gen:types && npm run check:types
cd desktop/web && npm audit --omit=dev && npm audit     # before a release
```

`gen:types` publishes under `target/bindings-gen-publication.lock`; an interrupted run leaves `target/bindings-gen-publication.in-progress`, which later runs refuse until you inspect the diff and remove the sidecars and marker. Linux deps: GTK/WebKitGTK, librsvg, patchelf (never `libappindicator3-dev`). Icons: `scripts/generate-desktop-icons.sh`.

## Bundled plant DB

- `CANOPI_SKIP_BUNDLED_DB=1` (read by `desktop/build.rs`) drops the DB from the bundle so the crate builds without `desktop/resources/canopi-core.db`; CI sets it and a release build with it warns. Only debug builds fall back to the repository DB (`lib.rs`).
- Release builds derive an immutable asset name (`species_catalog_contract.py value prepared-db-asset-name`), download it from the `canopi-core-db` tag and verify the prepared profile before packaging.
- Publish: `scripts/publish-db-release.sh --export-path <export>.db [--tag <tag>] [--repo <owner/repo>]` verifies the export against the pin, prepares the DB and refuses to overwrite an existing identity asset. A catalog change publishes its asset before same-repository PR packaging can pass ([species catalog](species-catalog.md)).

## Release workflow

1. Merge through PRs into `main` with CI green (v2 branch rule: [workflow](../workflow.md)).
2. Bump `desktop/tauri.conf.json`; keep `Cargo.toml`, `desktop/web/package.json` and `package-lock.json` in sync (preflight fails on drift).
3. Run `Release Candidate` (`.github/workflows/release-candidate.yml`) from `main` with `ref`, `release_version` and `db_release_tag` (usually `canopi-core-db`). Every packaging job checks out the resolved commit and matches the DB checksum from preflight.
4. Smoke test the exact artifacts on Linux, macOS arm64, macOS x64 and Windows (start; create, edit, save, reopen Designs; search, placement; undo; layers; place search moves the view only; theme and locale) and record run id, commit, DB SHA-256, tester and results. A platform nobody can test by hand is recorded as untested; its evidence is `Build & Test` running the native tests on that runner and the Web Edition driven in Chromium (WebView2's engine) and WebKit (WKWebView's). macOS needs 12 or later (`bundle.macOS.minimumSystemVersion`) for the WebKit the canvas uses.
5. Promote: `scripts/promote-release.sh --run-id <run-id> --tag v<version> --title "Canopi <version>" [--artifact-dir <root>]` admits only a matching successful candidate, verifies every checksum and creates a draft with `docs/release-notes/v<version>.md` as its body, plus the six stable copies from `STABLE_PACKAGES` (`scripts/release_candidate_artifacts.py`, used by the website's download buttons) and `RELEASE-SHA256SUMS.txt` (`scripts/test_promote_release.py`).
6. Publish: `gh release edit v<version> --draft=false --latest`. Never mark DB-only or prereleases as latest; never replace a published release.

The release body offers the Corresponding Source of the AGPL components it ships: Canopi's tagged source archive plus the `geolibre-rust` and `whitebox-wasm` revisions in `desktop/THIRD_PARTY_NOTICES.md` (`promote-release.sh`, `test_promote_release.py`); the user-facing release notes carry the same offer in their own words.

## Where to look

| Area | Module | Tests |
| --- | --- | --- |
| Command policy and executor | `desktop/src/native_command_policy.rs`, `native_operation.rs` | module tests |
| Files and exports | `desktop/src/design/mod.rs`, `services/export.rs` | module tests |
| Problem reports | `desktop/src/services/problem_report/`, `services/folder_reveal.rs`, `app/problem-report/` | module tests, `problem-report-*.test.ts(x)` |
| Tauri config and bridge | `desktop/tauri.conf.json`, `capabilities*/`, `build.rs`, `lib.rs` | `lib.rs` bridge test |
| Release tooling | `scripts/promote-release.sh`, `release_candidate_artifacts.py`, `publish-db-release.sh`, `.github/workflows/` | `scripts/test_promote_release.py` |
| Sidecar packaging | `desktop/build.rs`, `scripts/build-geolibre-cli.sh`, `smoke-bundled-sidecar.sh`, `.github/actions/build-geolibre-cli/` | `geolibre.rs` tests, CI smoke step |
