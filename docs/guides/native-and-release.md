# Native and release

This guide covers the Rust/Tauri backend rules, the build and check commands, dependency maintenance, the bundled plant DB, generated contract publication, the desktop release workflow and Problem Reports. LiDAR raster engine rules (GDAL, GeoLibre CLI, `wbgeotiff`, admission limits, ignored test lanes) are in [data library](data-library.md). Web artifact publishing is in [editions](editions.md#web-publishing).

## Commands

```bash
cargo tauri dev                                        # Desktop app (repository root)
cd desktop/web && npm run dev | dev:web | dev:ui       # Vite hosts on 1420 / 1421 / 1422
cargo fmt --all -- --check
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace
CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings
CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace
CANOPI_SKIP_BUNDLED_DB=1 cargo test -p canopi-desktop native_command_policy::tests
cd desktop/web && npx tsc --noEmit && npm test         # frontend gate
cd desktop/web && npm run test:coverage                # coverage ratchet (CI)
cd desktop/web && npm run check:ui && npm run build && npm run build:web
cd desktop/web && npm run check:editions               # tsc + gallery + both bundles, no tests
cd desktop/web && npm run gen:types                    # write generated contracts
cd desktop/web && npm run check:types                  # check generated contracts
python3 scripts/species_catalog_contract.py check
python3 scripts/species_search_unicode_facts.py check
python3 scripts/prepare-db.py                          # plant DB
python3 scripts/check_docs.py                          # docs links/anchors
cargo build --release
```

`AGENTS.md` maps changes to required gates. Build & Test (`.github/workflows/build.yml`) also runs the Python contract and promotion tests, the Unicode fact check, `check_docs`, the coverage ratchet and the `lidar-native` lane.

## Rust toolchain and CI

- `rust-toolchain.toml` pins the exact stable compiler. Every `dtolnay/rust-toolchain` step in Build & Test and Release Candidate uses the same version. Update them together and run the full matrix. The pin is not an MSRV, so do not add `rust-version`.
- `.github/actions/cache-rust` keys caches by OS/arch, compiler, workload and Cargo target. Do not collapse the keys to OS/compiler/lockfile: GitHub caches are immutable, so a tiny test cache would shadow packaging forever. Only dependency sources and compiled deps are cached.
- Runtime crates (`desktop`, `common-types`) deny `clippy::unwrap_used` and `clippy::expect_used`; tests may unwrap (`clippy.toml`). A true invariant uses `#[expect(clippy::expect_used, reason = "...")]` at its function, so every possible panic is reviewed and justified. Build tools (`bindings-gen`, `desktop/build.rs`) may fail loudly.
- Rust coverage: `cargo cov` (alias in `.cargo/config.toml`, needs `cargo-llvm-cov` and the `llvm-tools-preview` component) runs the workspace tests instrumented and fails below the recorded floor; CI runs it as the Rust test step. Raise the floor when coverage grows; never lower it.
- CI builds and tests with `--locked`, so a release is always built from the reviewed `Cargo.lock`.
- Validation workflows cancel superseded runs only within the same PR. `windows-compression-benchmark.yml` is an isolated experiment and must never publish release assets.
- CI polling: avoid streaming `gh run watch`. Poll quietly with `gh run view <id> --json status,conclusion,jobs`. Wait at least 2 minutes between checks once only packaging remains, and 5 minutes when only Windows packaging remains.

## Native execution rules

- Rust commands return `Result<T, String>` and map errors with context (`.map_err(|e| format!("Failed to <action>: {e}"))`). IPC types come from `common-types` with `specta::Type`, never typeshare.
- SQLite uses one `Mutex<Connection>` per DB (no pools), locked through `db::acquire(&mutex, "PlantDb")`, which recovers from poison. SQL uses placeholders, never string formatting.
- Every `#[tauri::command]` is registered once in `tauri::generate_handler!` and is either executor-backed async or a reviewed synchronous allowance in `desktop/src/native_command_policy.rs`. The policy test parses production sources with test-only `syn` and fails on missing executor use, registry drift, blocking-pool bypasses and new synchronous commands.
- The synchronous allowlist is `new_design`, `get_health`, `supersede_species_search` and the three LiDAR cancel signals. Each entry has a reviewed reason. Never extend it to avoid moving a command onto the executor.
- Filesystem, SQLite, network, rendering, encoding, compression, process, sleeping and unbounded CPU work never run synchronously in a command body. Direct `spawn_blocking`/`block_in_place` calls belong only in `desktop/src/native_operation.rs`.
- Outside the closure passed to `executor.run`, an async command only unwraps (`inner()`) and clones its `State<...>` handles, or passes them to a helper that also receives the executor. Any other method or free-function call on managed state, or on a value bound from it, needs a reviewed entry in `STATE_ACCESS_ALLOWLIST` (bounded in-memory work such as a supersession token or inspection admission). A cache-hit probe is filesystem work and runs inside the executor like the fetch it short-circuits.
- Every registered command has an `invoke('<name>'...)` call site in production frontend source (`desktop/web/src`, excluding tests). A command nothing invokes is deleted with everything only it uses. There is no exemption list: a new command lands with its frontend call site.

### Native operation executor

- Commands carry and await the Tauri-managed `NativeOperationExecutor`. Classes are chosen by the constrained resource:
  - `Catalog` (admitted 8 / running 1): species search, detail, batches, filters, names, media.
  - `UserData` (8/1): settings, favorites, Recent Designs, Design Notebook, stamp CRUD, LiDAR catalogue commands (library listing, presentation, display descriptors).
  - `Local` (6/2): Design save/load, Design drafts (save, load, list, delete), exports (`export_file`, `save_canvas_pdf`), GeoJSON read, stamp files, Problem Reports, LiDAR raster work (import, slope, pixel sampling).
  - `Network` (12/4): HTTP such as geocoding and the species image cache (hits included, so no cache probe runs on the async thread).
- Admission is immediate. A full class returns its stable busy error before touching any destination, DB or folder. Admitted work waits FIFO for running capacity, and classes are isolated.
- Admission and running permits move into the started blocking closure. Validation, locks, transactions and publication stay inside it. Dropping the async caller may cancel queued work but never releases capacity for work that cannot be aborted.
- Labels are static and payload-safe. Never trace request values, paths, URLs, Design content or error payloads.
- The direct Tokio dependency enables only `sync` and `time`. Never build a second runtime.
- Command tests use `tauri::test::mock_builder().manage(service).manage(executor)` and invoke the real command through `app.state()`. A copied closure passed to `executor.run` does not prove command wiring.

### Files, network and Linux

- There are no platform crates and no native rendering: PDF and every other export are produced by the frontend and delivered through the executor. There is no OS PDF renderer, file watching or thumbnailing.
- Derived files go through `write_derived_file()` (`desktop/src/design/mod.rs`): a same-directory temporary, `sync_all` and `atomic_replace()`. `save_canvas_pdf` admits only a `.pdf` destination and a bounded `%PDF-` payload. `export_file` (budget CSV and GeoJSON) admits only `.csv`, `.geojson` and `.json` destinations and at most 64 MiB; the frontend appends the chosen format's extension when the dialog returns a bare name. Export services never log destination paths.
- The species image cache (`desktop/src/image_cache.rs`) fetches only the plant DB's media hosts: `inaturalist-open-data.s3.amazonaws.com`, `commons.wikimedia.org` and its redirect target `upload.wikimedia.org`, on the default port and without credentials. Any other URL is refused (`ImageCacheError::DisallowedUrl`) before the cache or network is touched. The plant DB's `http://` Commons links are fetched over HTTPS. Redirects are followed by hand, at most five, each re-checked against the allowlist and HTTPS-only. Only `image/*` responses other than SVG are cached, at most 10 MB each. Requests identify as `Canopi/<version> (+https://projectcanopi.com)`, like geocoding.
- Design writes use `atomic_replace()` (`desktop/src/design/mod.rs`) because `std::fs::rename` can fail on locked Windows files. Temporary and rollback sidecars are operation-owned and live in the same directory. Every write admits its normalized target file, so a save's fingerprint check and write, and each draft write or delete, are indivisible per file.
- Linux: system deps are GTK/WebKitGTK, librsvg and patchelf; do not add `libappindicator3-dev`. `desktop/src/main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before WebKitGTK starts. Keep `cargo tauri dev` the normal command. Bundles are deb and AppImage. Debian depends use alternatives for Ubuntu t64 transitions.
- Desktop icons come from `scripts/generate-desktop-icons.sh` (PNG, ICNS, ICO). Every icon referenced by `tauri.conf.json` must exist or `generate_context!()` panics. Commit generated assets with their source.

### Tauri config gotchas

- `beforeDevCommand` is `{ "script": "npm run dev", "cwd": "web" }`, relative to `desktop/`.
- The CSP allows scripts from `'self'` plus `'wasm-unsafe-eval'` (raster decode), blob workers and HTTPS image and connection sources. Review it when you add a resource type or origin.
- The asset protocol scope is `$APPDATA/image-cache/**` and `$APPDATA/lidar/display-cog/*.tif` only.
- `capabilities/main-window.json` grants exactly what the frontend calls, never a `default` set: event listen/unlisten (the close guard's `onCloseRequested` and its `onFocusChanged` blur flush), the window start-dragging, minimize, toggle-maximize, close and destroy permissions (`decorations: false` title bar; `destroy()` closes once continuous save has flushed, or after Close without saving) and dialog open, save and message. Add a permission in the change that first calls the API.
- The MCP bridge (`tauri-plugin-mcp-bridge`, behind the default `mcp-bridge` Cargo feature) exists only for `cargo tauri dev` automation. Only a debug build registers it, bound to `127.0.0.1`, and only then does `desktop/build.rs` merge `withGlobalTauri: true` and the `mcp-bridge-dev` capability (`desktop/capabilities-dev/`, outside the release capability pattern) into the Tauri config. Release builds never expose `window.__TAURI__` or the bridge permissions, and `--no-default-features` drops the crate. A lib test checks both states.
- Use the JS dialog API (`@tauri-apps/plugin-dialog`), because Linux blocking dialogs can deadlock. Events emitted in `setup()` are lost because the frontend has not loaded yet. The shell plugin is removed: process execution happens only in admitted native services with fixed commands.

## Frontend dependency maintenance

- Before a release, run `npm audit --omit=dev` and `npm audit`. Keep security updates within ranges where possible. A major upgrade needs its migration notes, focused regressions and a production-build smoke check.
- `package.json` `overrides` lift `image-size` (≥2.0.4) and `fflate` (≥0.8.3) in the deck.gl loader tree required by `maplibre-gl-raster`. Canopi never reaches those paths, and `npm audit fix --force` would break the peer range. Drop an override when upstream ships the fix.
- If npm 10 fails on the Vitest peer graph (`edgesOut`), update the lockfile with npm 11 through `npx`, then verify a plain `npm ci`.
- Vite dev filesystem admission is the frontend directory plus exactly `desktop/tauri.conf.json` and its `?raw` id (for the About dialog version). Keep that exception narrow.
- Changes to raster dependencies update `desktop/THIRD_PARTY_NOTICES.md`, which `third-party-notices.test.ts` checks.

## Generated contract publication

- `cd desktop/web && npm run gen:types` (`cargo run -p bindings-gen`) is the only writer for the generated adapter set: frontend contracts, design, settings and filter adapters, New Design defaults, normalization facts, `desktop/src/db/plant_filter_fields.rs` and the Web catalog admission module. It first validates the conformance corpus, the New Design defaults and the species contract, then stages the whole set before replacing any file.
- `npm run check:types` renders the same set and reports stale files without writing. Generate and check coordinate through `target/bindings-gen-publication.lock`. Keep that file.
- If an interrupted run leaves `target/bindings-gen-publication.in-progress`, later runs refuse to start. Inspect the diff, restore or accept it, remove `.bindings-gen-*` sidecars and then remove the marker.
- `desktop/src/db/schema_contract_generated.rs` has its own writer: `python3 scripts/species_catalog_contract.py emit-rust --write`. Run it before `gen:types` after a storage contract change.
- Keep one Cargo target directory per worktree. `bindings-gen` embeds its checkout path, so a shared target can run a stale checkout. If that happens, run `cargo clean -p bindings-gen`.

## Bundled plant DB

- `CANOPI_SKIP_BUNDLED_DB=1` (read by `desktop/build.rs`) drops the plant DB from the bundle resources, keeping `THIRD_PARTY_NOTICES.md`, so the crate builds without `desktop/resources/canopi-core.db`. CI lint and test jobs set it. A release-profile build with it set emits a `cargo:warning`.
- Only debug builds fall back to `desktop/resources/canopi-core.db` in the repository when the bundled resource is absent; a release build reads only its bundle.
- Release builds derive an immutable asset name from the prepared schema version, the contract fingerprint and the source-export SHA-256 (`species_catalog_contract.py value prepared-db-asset-name`). They download it from the `canopi-core-db` release tag and verify it against the prepared profile before packaging. A matching `user_version` alone is not enough. Packages are hundreds of MB.
- Publish or refresh the DB: `scripts/publish-db-release.sh --export-path <export>.db [--tag <tag>] [--repo <owner/repo>]`. It verifies the export against `prepared_artifact.source_export_sha256`, prepares and verifies the DB, and refuses to overwrite an existing identity asset.
- When catalog content changes, update the source pin to the exact reviewed export and publish its asset before same-repository PR packaging can pass. Fork PRs skip trusted packaging; a maintainer reproduces the change on a same-repository branch. Details are in [species catalog](species-catalog.md#storage-contract).

## Release workflow

1. Develop and merge through PRs into `main` with CI green. For v2, see the branch rule in [workflow](../workflow.md).
2. Bump the version in `desktop/tauri.conf.json`, the version authority read by the About dialog. Keep `Cargo.toml`, `desktop/web/package.json` and `package-lock.json` in sync. Preflight fails on drift.
3. Run the `Release Candidate` workflow (`.github/workflows/release-candidate.yml`) from `main` with `ref`, `release_version` and `db_release_tag` (usually `canopi-core-db`). Preflight checks the ref, the versions, the DB asset and its prepared profile. Every packaging job checks out the resolved commit and matches the DB checksum from preflight.
4. Smoke test the exact CI artifacts on Linux, macOS arm64, macOS x64 and Windows. Record the run id, commit, DB SHA-256, `SHA256SUMS.txt`, tester, date and results. Minimum script: clean startup; create, edit, save, reopen and switch Designs; species search, detail, favorite and placement; undo and redo; layer controls; place search and fit (the view moves, objects do not); theme and locale switch; no startup, save or resource regression.
5. Promote: `scripts/promote-release.sh --run-id <run-id> --tag v<version> --title "Canopi <version>" [--artifact-dir <downloaded-root>]`. It admits only a successful candidate run with matching repository, version and commit, verifies every checksum, stages bytes privately and creates a draft targeting the manifest commit. Published releases are never replaced. `docs/release-notes/v<version>.md` becomes the release body when present ([release notes](../release-notes/)). Test changes with `python3 -m unittest scripts.test_promote_release`.
6. Publish: `gh release edit v<version> --draft=false --latest`. Never mark DB-only releases or prereleases as latest.

Promotion also creates six byte-identical stable copies from `STABLE_PACKAGES` in `scripts/release_candidate_artifacts.py`: `canopi-linux-x64.deb`, `canopi-linux-x64.AppImage`, `canopi-macos-arm64.dmg`, `canopi-macos-x64.dmg`, `canopi-windows-x64.exe` and `canopi-windows-x64.msi`. It also writes `RELEASE-SHA256SUMS.txt` (public basenames). Website buttons use `https://github.com/naejin/canopi/releases/latest/download/<stable-name>`. Change the target matrix, `STABLE_PACKAGES` and the promotion tests together.

Failure triage: on a version mismatch, fix `tauri.conf.json` or the input. When the DB asset is missing or mismatched, republish from the candidate's contract. On a promotion checksum failure, do not publish; re-download and investigate.

## Problem reports

- Desktop only ([ADR 0005](../adr/0005-web-edition-scope.md)). Reports are local-first, with no automatic upload, telemetry, email or issue creation.
- Output: a timestamped `Canopi Problem Report ...` folder with `Report Summary.txt` and `Diagnostic Bundle.zip`. A failure after the folder is created removes the folder, so no half-written report is left behind. The success screen can reveal it through `show_problem_report_folder`, which validates that the path is a generated report folder directly inside the report output root, runs a fixed `open`, `explorer` or `xdg-open` inside `Local` and reaps that process on a background thread.
- Privacy boundary: by default the bundle excludes Design contents (object coordinates are Design contents; there is no separate Design location), screenshots, raw filesystem paths, the Google key and personal libraries (Saved Object Stamps). The current Design may be attached only through an explicit, off-by-default consent control. When it is, the manifest and summary name that attachment. Settings summaries include only preferences with a live consumer.
- The bundle carries recent backend log lines, so backend logs never name a Design or its path; log the event only. Redaction (`redactions.rs`, mirrored for frontend diagnostics in `app/problem-report/diagnostics.ts`) replaces known folders and absolute paths, including the file name after a known folder, up to a `: ` separator so the error reason stays readable, and replaces `key=`, `api-key=`, `api_key=` and `apikey=` query values with `<redacted>`.
- Seams: types in `common-types/src/support.rs`, orchestration in `desktop/src/services/problem_report/mod.rs`, with `bundle.rs`, `redactions.rs`, `summary.rs`, `zip.rs` and `folder_reveal.rs` as siblings. The command reads diagnostic settings through `UserData`, then creates and publishes the folder in `Local`, rejecting before creating anything when the class is full. The frontend enters through the App Command Graph. `app/problem-report/submission.ts` owns request assembly and state. The Design attachment is captured through the document-session persistence seam.
- Tests exercise the service through its artifacts and privacy exclusions, and the frontend through dialog and command behaviour. Tests inject the reveal seam and never launch a file manager.
