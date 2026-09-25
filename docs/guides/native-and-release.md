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
- Validation workflows cancel superseded runs only within the same PR. `windows-compression-benchmark.yml` is an isolated experiment and must never publish release assets.
- CI polling: avoid streaming `gh run watch`. Poll quietly with `gh run view <id> --json status,conclusion,jobs`. Wait at least 2 minutes between checks once only packaging remains, and 5 minutes when only Windows packaging remains.

## Native execution rules

- Rust commands return `Result<T, String>` and map errors with context (`.map_err(|e| format!("Failed to <action>: {e}"))`). IPC types come from `common-types` with `specta::Type`, never typeshare.
- SQLite uses one `Mutex<Connection>` per DB (no pools), locked through `db::acquire(&mutex, "PlantDb")`, which recovers from poison. SQL uses placeholders, never string formatting.
- Every `#[tauri::command]` is registered once in `tauri::generate_handler!` and is either executor-backed async or a reviewed synchronous allowance in `desktop/src/native_command_policy.rs`. The policy test parses production sources with test-only `syn` and fails on missing executor use, registry drift, blocking-pool bypasses and new synchronous commands.
- The synchronous allowlist is `new_design`, `get_health`, `supersede_species_search` and the three LiDAR cancel signals. Each entry has a reviewed reason. Never extend it to avoid moving a command onto the executor.
- Filesystem, SQLite, network, rendering, encoding, compression, process, sleeping and unbounded CPU work never run synchronously in a command body. Direct `spawn_blocking`/`block_in_place` calls belong only in `desktop/src/native_operation.rs`.

### Native operation executor

- Commands carry and await the Tauri-managed `NativeOperationExecutor`. Classes are chosen by the constrained resource:
  - `Catalog` (admitted 8 / running 1): species search, detail, batches, filters, names, media.
  - `UserData` (8/1): settings, favorites, Recent Designs, Design Notebook, stamp CRUD.
  - `Local` (6/2): Design save/load, autosave and recovery, exports (`export_file`, `save_canvas_pdf`, PNG), GeoJSON read, stamp files, Problem Reports, LiDAR raster work.
  - `Network` (12/4): HTTP such as geocoding and remote assets.
- Admission is immediate. A full class returns its stable busy error before touching any destination, DB or folder. Admitted work waits FIFO for running capacity, and classes are isolated.
- Admission and running permits move into the started blocking closure. Validation, locks, transactions and publication stay inside it. Dropping the async caller may cancel queued work but never releases capacity for work that cannot be aborted.
- Labels are static and payload-safe. Never trace request values, paths, URLs, Design content or error payloads.
- The direct Tokio dependency enables only `sync`. Never build a second runtime.
- Command tests use `tauri::test::mock_builder().manage(service).manage(executor)` and invoke the real command through `app.state()`. A copied closure passed to `executor.run` does not prove command wiring.

### Platform, files and Linux

- The platform trait (`desktop/src/platform/mod.rs`) exposes only native PNG snapshot export. macOS and Windows implementations sit behind `#[cfg(target_os)]`, and CI compiles each platform. There is no OS PDF renderer, file watching or thumbnailing.
- Design writes use `atomic_replace()` (`desktop/src/design/mod.rs`) because `std::fs::rename` can fail on locked Windows files. Temporary and rollback sidecars are operation-owned and live in the same directory. `.canopi.prev` is target-owned. Saves admit the normalized target family, and autosave admits the whole store.
- Linux: native PNG uses `cairo-rs` (`png` feature). System deps are GTK/WebKitGTK, librsvg and patchelf; do not add `libappindicator3-dev`. `desktop/src/main.rs` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before WebKitGTK starts. Keep `cargo tauri dev` the normal command. Bundles are deb and AppImage. Debian depends use alternatives for Ubuntu t64 transitions.
- Desktop icons come from `scripts/generate-desktop-icons.sh` (PNG, ICNS, ICO). Every icon referenced by `tauri.conf.json` must exist or `generate_context!()` panics. Commit generated assets with their source.

### Tauri config gotchas

- `beforeDevCommand` is `{ "script": "npm run dev", "cwd": "web" }`, relative to `desktop/`.
- The CSP allows scripts from `'self'` plus `'wasm-unsafe-eval'` (raster decode), blob workers and HTTPS image and connection sources. Review it when you add a resource type or origin.
- The asset protocol scope is `$APPDATA/image-cache/**` and `$APPDATA/lidar/display-cog/*.tif` only.
- `decorations: false` window dragging needs the window permissions in `capabilities/main-window.json`. `core:window:allow-destroy` enables discard-without-save close, which uses `destroy()` rather than `close()`.
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

- `CANOPI_SKIP_BUNDLED_DB=1` (read by `desktop/build.rs`) empties the bundle resources so the crate builds without `desktop/resources/canopi-core.db`. CI lint and test jobs set it.
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
- Output: a timestamped `Canopi Problem Report ...` folder with `Report Summary.txt` and `Diagnostic Bundle.zip`. The success screen can reveal it through `show_problem_report_folder`, which validates that the path is a generated report folder and runs a fixed `open`, `explorer` or `xdg-open` inside `Local`.
- Privacy boundary: by default the bundle excludes Design contents, object coordinates, screenshots, raw filesystem paths, the Google key and personal libraries (Saved Object Stamps). The current Design may be attached only through an explicit, off-by-default consent control. When it is, the manifest and summary name that attachment. Settings summaries include only preferences with a live consumer.
- Seams: types in `common-types/src/support.rs`, orchestration in `desktop/src/services/problem_report/mod.rs`, with `bundle.rs`, `redactions.rs`, `summary.rs`, `zip.rs` and `folder_reveal.rs` as siblings. The command reads diagnostic settings through `UserData`, then creates and publishes the folder in `Local`, rejecting before creating anything when the class is full. The frontend enters through the App Command Graph. `app/problem-report/submission.ts` owns request assembly and state. The Design attachment is captured through the document-session persistence seam.
- Tests exercise the service through its artifacts and privacy exclusions, and the frontend through dialog and command behaviour. Tests inject the reveal seam and never launch a file manager.
