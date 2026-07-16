# Build, Release, And Platform

Use this guide when changing build scripts, Tauri config, CI workflows, native platform code, packaging, release candidates, or generated desktop assets.

## Rust Toolchain

- `rust-toolchain.toml` pins the Rust compiler used by local development to the exact stable point release validated by CI and release packaging. Rustup installs that toolchain automatically when a Rust command runs from this repository.
- Every `dtolnay/rust-toolchain` step in Build & Test and Release Candidate must select the same exact version. Update the toolchain file and every workflow reference together, then run the full Build & Test matrix before merging.
- Cargo cache keys include the installed toolchain's action-provided cache identity so a compiler upgrade cannot restore an incompatible `target` cache as an exact match.
- The toolchain pin is not Canopi's minimum supported Rust version. Do not add Cargo `rust-version` metadata unless the project separately chooses and verifies an MSRV policy.

## Local Build Commands

```bash
# Rust workspace check without local bundled plant DB
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# Rust formatting check matching CI
cargo fmt --all -- --check

# Rust lint gate matching CI expectations
CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings

# Rust tests
CANOPI_SKIP_BUNDLED_DB=1 cargo test --workspace

# Frontend build
cd desktop/web && npm run build

# Web Edition static build plus browser-boundary scan
cd desktop/web && npm run build:web

# Web Edition versioned release artifact
cd desktop/web && npm run package:web

# Web Edition root-subdomain release artifact
cd desktop/web && npm run package:web:root

# Reduced Web Edition Species Catalog assets
cd desktop/web && npm run generate:web-catalog

# Species Catalog contract/generated-fact drift
python3 scripts/species_catalog_contract.py check

# Refresh bindings-compiler-owned generated adapters, including Web Catalog admission
cd desktop/web && npm run gen:types

# Check the same bindings-compiler-owned adapters without publishing
cd desktop/web && npm run check:types

# Strictly verify the checked-in bundled DB
python3 scripts/species_catalog_contract.py verify-db --profile prepared desktop/resources/canopi-core.db

# Release build
cargo build --release
```

## Bundled DB

- `CANOPI_SKIP_BUNDLED_DB=1` is checked in `desktop/build.rs`.
- When set, it overrides Tauri bundle resources to an empty list so the crate compiles without `desktop/resources/canopi-core.db`.
- CI lint/test jobs set this flag.
- CI release builds derive an immutable asset name from the exact prepared schema version, prepared-contract fingerprint, and authored source-export SHA-256, download it from the stable `canopi-core-db` GitHub release tag, and install it as `desktop/resources/canopi-core.db` before `tauri build`.
- The normal Linux/macOS/Windows build matrix verifies that downloaded database against the prepared profile before packaging, so contract drift cannot hide outside the release-candidate workflow.
- Release-candidate preflight runs the Species Catalog contract check and full prepared-database verification: exact `PRAGMA user_version`, the four exact embedded identity values, Species affinities, required copied and generated tables, the FTS5 virtual-table shape, and every contracted index. Packaging jobs check out the resolved preflight commit and require their downloaded DB checksum to match the preflight checksum, so mutable refs or release assets cannot change between verification and packaging. A matching `PRAGMA user_version` alone is insufficient.
- The bundled DB is large; package size is expected to be hundreds of MB.

## Release Workflow

- Release candidate workflow: `.github/workflows/release-candidate.yml`.
- Promotion script: `scripts/promote-release.sh`.
- DB release upload script: `scripts/publish-db-release.sh`.
- Publishing and release workflows obtain schema metadata and the immutable prepared DB asset name through `scripts/species_catalog_contract.py value` and verify databases through `verify-db`; do not parse generated Rust or duplicate inline checks. `prepare-db.py` verifies exact source-export bytes through the same contract compiler before opening the export, and operators can run `verify-source-export` independently. After preparation, the publisher re-verifies the source bytes and refuses a changed compiled release identity before staging the exact derived asset basenames. It must not overwrite an existing identity asset.
- Same-repository PR packaging requires the candidate-derived DB asset to be published before the packaging gate runs. Fork PRs run lint, tests, and platform compilation but skip the trusted bundled-resource packaging job; reproduce catalog-identity changes on a maintainer branch before merge.
- Intentional storage changes must update `scripts/schema-contract.json`, including the pinned Species Search normalization version when normalized search storage changes, refresh `desktop/src/db/schema_contract_generated.rs` with `emit-rust --write`, and pass `check` before publishing.
- `desktop/tauri.conf.json` is the app release-version authority. Keep `Cargo.toml`, `desktop/web/package.json`, and `desktop/web/package-lock.json` synchronized with it; the About dialog reads the Tauri config version, and release-candidate preflight validates drift.
- Linux bundles are deb and AppImage, not RPM.
- Debian dependencies in `tauri.conf.json` intentionally use alternatives for Ubuntu t64 transitions. Tauri merges custom depends with detected depends.
- See `docs/release.md` for the detailed human release process.

## Web Edition Static Bundle

- Web Edition source belongs in this repository, not in `canopi-website`. Implement it as a separate browser Vite entry/build that reuses shared frontend modules behind browser-specific shell and adapter seams.
- The Web Edition local build command is `cd desktop/web && npm run build:web`. It emits `desktop/web/dist-web/` and runs the browser-boundary scanner; keep `dist-web/` uncommitted.
- The default Web Edition artifact command is `cd desktop/web && npm run package:web`. It builds the web entry for `/app/`, scans browser chunks, and emits a versioned directory plus `.tar.gz` under `desktop/web/dist-web-artifacts/`; keep that output uncommitted.
- The dedicated root-subdomain artifact command is `cd desktop/web && npm run package:web:root`. It sets `CANOPI_WEB_BASE_PATH=/` before Vite emits assets and packages a root-base artifact named `canopi-web-edition-root-v<version>-<commit>.tar.gz` with `basePath: "/"` and SPA fallback `/* -> /index.html`. Use this artifact for `https://web.projectcanopi.com/`; do not deploy the default `/app/` artifact at a domain root.
- The Web Edition Species Catalog command is `cd desktop/web && npm run generate:web-catalog`. It emits ignored DuckDB-queryable Parquet catalog shards under `desktop/web/public/canopi-catalog/` from the authored `common-types/web-species-catalog-artifact.json` contract; run it from a checkout with local canopi-data exports when catalog assets are needed for packaging or adapter testing. Refresh all bindings-compiler-owned adapters, including the browser/Node admission module, with `npm run gen:types`, and verify them with `npm run check:types`. The Python contract script's `check` and legacy `emit --write` commands delegate to those Rust operations; only its `render` command writes caller-owned staging output for the Rust compiler.

## Generated Contract Publication

- `python3 scripts/species_search_unicode_facts.py check` verifies the checked Species Search Unicode 15 decomposition, property-range, and lowercase facts. `write` is the explicit refresh command and requires a Python runtime whose `unicodedata` version exactly matches the pinned authority version. The build workflow runs the checker independently before generated bindings admission.
- `cd desktop/web && npm run gen:types` is the canonical write command for the bindings compiler's generated adapter set: frontend contracts, design/settings/filter adapters, typed Rust and TypeScript New Design defaults, Species Search normalization facts, `desktop/src/db/plant_filter_fields.rs`, and the Web Catalog browser/Node admission module. Before rendering, it also validates that `common-types/canopi-design-conformance.json` matches the authored Rust version, future-policy, and stable error-kind facts and validates `common-types/canopi-new-design-defaults.json`. The Rust transaction is the only checked-in publication authority; the legacy Python `emit --write` command delegates to it. The compiler takes exclusive admission before Python validation, Rust rendering/formatting, or Web Catalog rendering, then stages the whole set before changing a checked-in destination.
- `cd desktop/web && npm run check:types` renders the same adapter set under shared admission and reports every missing or stale destination without refreshing files. Generate and check coordinate through the persistent ignored `target/bindings-gen-publication.lock`; a conflicting operation fails before validation, rendering, destination snapshots, or drift reads. Multiple checks may run together.
- `desktop/src/db/schema_contract_generated.rs` has a separate, explicit authority: `python3 scripts/species_catalog_contract.py emit-rust --write`. It is validated by `python3 scripts/species_catalog_contract.py check` (which the bindings compiler runs before rendering), but it is not a member of the Rust publication transaction. Keep that file's Python-generated header and refresh it before `npm run gen:types` after an authored storage-contract change.
- Publication replaces staged adapter files one destination at a time. Before rollback it ensures durable marker evidence is still present or restores it after a failed marker removal; if that evidence cannot be ensured, rollback does not begin. It reports staged-sidecar cleanup failures and keeps the in-progress marker when cleanup or rollback is incomplete. After successful publication or a complete rollback, it syncs every changed destination parent before durably removing the marker. This is a recoverable multi-file protocol, not an atomic filesystem transaction; process or machine failure can still expose a partial set.
- Before destination staging, publication flushes `target/bindings-gen-publication.in-progress` and, where supported, its parent directory. Directory syncing is best-effort on platforms or filesystems without portable support, so inspect the generated-file diff after any abnormal stop. A later generate or check refuses to continue while the marker exists. Inspect the diff, restore or accept the interrupted result, remove operation-owned `.bindings-gen-*` sidecars, then remove the marker before retrying. Keep the persistent `.lock` file; it contains no publication state and must not be manually deleted between operations.
- The Canopi website should publish the built Web Edition artifact under a route such as `/app/`; it should not import Canopi app source as an Astro component package, workspace dependency, submodule, or copied component tree. See `docs/adr/0012-web-edition-static-app-bundle.md`.
- Do not commit generated Web Edition `/app` assets to `canopi-website` long term. The production website deploy should download the versioned Web Edition release asset from the Canopi app release tag and verify its manifest/checksums before publishing it under `/app/`. A local script may copy from a sibling Canopi checkout for preview/dev only.
- The web build uses the `/app/` base path by default. `CANOPI_WEB_BASE_PATH=/` is the only supported override for root-subdomain artifacts. The package manifest records the matching SPA fallback: `/app/* -> /app/index.html` for default artifacts or `/* -> /index.html` for root artifacts. It also records a catalog summary with `canopi-catalog/manifest.json`, the generated catalog asset format, supported filter keys, and required catalog file paths.
- Web Edition uses compile-time browser adapters, not runtime feature flags in shared modules. Web Edition build checks should reject Tauri-only imports in browser chunks and fail if any generated app, WASM, worker, catalog, template, or image-metadata asset exceeds the Cloudflare Pages per-asset limit. Design Template catalog/import adapters are selected through `#design-template-catalog` and `#design-template-import-workflow`; static template assets and any allowed static asset origins are configured in `desktop/web/src/web/static-design-templates.ts`. See `docs/adr/0021-web-edition-compile-time-adapters.md`.
- Keep web catalog and DuckDB-WASM assets sharded/compressed enough for Cloudflare Pages limits; do not hide oversized files inside the website build. As of Cloudflare Pages docs last checked 2026-07-04, a single Pages asset is limited to 25 MiB and Free-plan sites contain up to 20,000 files. `npm run package:web` admits the catalog through the generated contract module, verifies every admitted file's presence/size/checksum, rejects symbolic links and raw `duckdb-*.wasm` files, and scans emitted chunks for Tauri runtime markers such as `__TAURI_INTERNALS__`.
- Web Edition DuckDB-WASM should load DuckDB's own worker/WASM through CDN-selected bundles instead of self-hosting the npm package's raw WASM files in `dist-web`.
- Web Edition v1 is not offline-first: do not add service workers, PWA install flows, or app-managed precache behavior unless a later decision changes the cache/update model. See `docs/adr/0022-web-edition-not-offline-first.md`.

## CI Polling Cadence

- Avoid streaming `gh run watch` into agent context for long package builds; it repeats the full job table and burns tokens while nothing changes.
- Prefer one quiet status check, then wait before checking again:

```bash
gh run view <run-id> --json status,conclusion,jobs --jq '.status + " " + ((.conclusion // "")|tostring) + "\n" + ((.jobs // []) | map(.name + ": " + .status + " " + ((.conclusion // "")|tostring)) | join("\n"))'
```

- PR lint, tests, and platform compile jobs normally finish first. Package builds take longer; Windows Tauri packaging is commonly the last job.
- Once only package builds remain, wait at least 2 minutes between quiet checks. If only Windows packaging remains, wait 5 minutes between checks unless GitHub reports a failure.

## Desktop Assets

- Desktop icons are generated via `scripts/generate-desktop-icons.sh` from SVG source.
- Generated sizes include PNG, ICNS, and ICO outputs.
- Icon files referenced by `tauri.conf.json` must exist or `generate_context!()` panics.
- Generated desktop assets must be committed with the source change.

## Platform Boundary

- Platform trait lives in `desktop/src/platform/mod.rs`, not `common-types`.
- Lib crates export marker structs; `platform/mod.rs` implements the trait through conditional modules.
- The platform trait intentionally exposes only native PNG/PDF snapshot export. File watching, thumbnail generation, and Linux desktop registration are not supported platform capabilities.
- macOS and Windows platform code is stubbed behind `#[cfg(target_os = "...")]`.
- CI validates platform compilation on actual platforms.

## Native Operation Executor

- Async commands must carry and await the Tauri-managed `NativeOperationExecutor`; direct `spawn_blocking`/`block_in_place` calls outside `desktop/src/native_operation.rs` are architecture violations. `desktop/src/native_command_policy.rs` parses production Rust sources with the test-only `syn` dependency during the Rust test suite, cross-checks every `#[tauri::command]` against `tauri::generate_handler!`, and fails closed on missing executor state/use/await, registry drift, blocking-pool bypasses, or a new synchronous command. Keep this parser out of runtime dependencies.
- The synchronous allowlist is intentionally limited to bounded built-in Template metadata reads, New Design default construction, the immutable startup health snapshot, and the immediate in-memory Species Search cancellation signal. Every entry carries a reviewed reason; stale entries and direct filesystem, SQLite, network, rendering, encoding/decoding, compression, thread/process, sleeping, or unbounded-loop capabilities fail the guard. Do not expand it merely to avoid migrating a command.
- Classify operations by the constrained resource they consume: Species Catalog reads use `Catalog`, user app-data persistence uses `UserData`, Design/file/export work uses `Local`, and HTTP or remote-asset work uses `Network`.
- Desktop Design save/load, autosave/recovery, text and native rendering exports, Saved Object Stamp file import/export, Problem Report assembly, and Problem Report folder reveal use `Local`. Keep decoding, validation, rendering, and filesystem publication inside the admitted closure; overload rejection must happen before a destination file or report folder is touched.
- Desktop Species search, detail, batch, filter, Common Name, Flower Color, and media/link projections use `Catalog`. Do not acquire the shared Plant DB connection or reinterpret an overload as missing/corrupt catalog state before Catalog admission.
- Desktop Settings, Favorite mutations and personal indexes, Recent Designs, Design Notebook, and Saved Object Stamp CRUD use `UserData`. Cross-resource Favorites/Recently Viewed lists stage User Data index reads and Favorite hydration separately from their Catalog projection; never hold both database locks or trace personal names, paths, or payloads.
- Production admitted/running limits are Catalog 8/1, User Data 8/1, Local 6/2, and Network 12/4. Admission is immediate: a full class returns its stable busy error instead of creating another waiter. Admitted operations wait FIFO for their class's running capacity, while classes remain isolated.
- Both admission and running permits move into a started blocking closure. Dropping an async caller may cancel queued work, but it must not release capacity for native work that can no longer be aborted.
- Operation labels must be static and payload-safe. Trace class, label, settlement, and timings; never trace request values, paths, URLs, Design content, or returned error payloads at this boundary.
- The direct Tokio dependency enables only `sync` and supplies owned semaphores for Tauri's existing Tokio runtime. Do not construct a second runtime or expand Tokio features without a separate need.

## Linux Native

- Linux native code uses Cairo PNG/PDF.
- Cairo deps use `cairo-rs` with `png` and `pdf` features.
- Linux system deps include GTK/WebKitGTK, librsvg, and patchelf.
- Linux desktop startup sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` in process before Tauri/WebKitGTK initializes. Keep `cargo tauri dev` as the normal local command; do not move this workaround into shell-only launch instructions or release wrappers.
- Do not add `libappindicator3-dev`.

## Cross-Platform File Replace

- `std::fs::rename` can fail on Windows when files are locked.
- Use the project `atomic_replace()` path for design file writes. Design saves take process-local admission for the normalized target family across backup, temporary write, and replace; autosaves take one admission for the whole autosave store across write, replace, and prune.
- Temporary and rollback sidecars are operation-owned, same-directory files. Never return to fixed `.tmp` or `.old` ownership or clean up another operation's sidecar. The stable `.canopi.prev` backup intentionally remains target-owned and is protected by the target admission.

## Tauri Config Gotchas

- `beforeDevCommand` uses object form with cwd `web` relative to `desktop/`.
- CSP is strict. Update directives when adding resource origins.
- Asset protocol scope is limited to app data image-cache paths.
- Window dragging with `decorations: false` requires window permissions in `capabilities/main-window.json`.
- `core:window:allow-destroy` is required for discard-without-save close behavior.
