# Build, Release, And Platform

Use this guide when changing build scripts, Tauri config, CI workflows, native platform code, packaging, release candidates, or generated desktop assets.

## Local Build Commands

```bash
# Rust workspace check without local bundled plant DB
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# Rust formatting check matching CI
cargo fmt --all -- --check

# Rust lint gate matching CI expectations
CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings

# Rust tests
cargo test --workspace

# Frontend build
cd desktop/web && npm run build

# Web Edition static build plus browser-boundary scan
cd desktop/web && npm run build:web

# Web Edition versioned release artifact
cd desktop/web && npm run package:web

# Reduced Web Edition Species Catalog assets
cd desktop/web && npm run generate:web-catalog

# Release build
cargo build --release
```

## Bundled DB

- `CANOPI_SKIP_BUNDLED_DB=1` is checked in `desktop/build.rs`.
- When set, it overrides Tauri bundle resources to an empty list so the crate compiles without `desktop/resources/canopi-core.db`.
- CI lint/test jobs set this flag.
- CI release builds download `canopi-core.db` from the `canopi-core-db` GitHub release tag into `desktop/resources/` before `tauri build`.
- The bundled DB is large; package size is expected to be hundreds of MB.

## Release Workflow

- Release candidate workflow: `.github/workflows/release-candidate.yml`.
- Promotion script: `scripts/promote-release.sh`.
- DB release upload script: `scripts/publish-db-release.sh`.
- `desktop/tauri.conf.json` is the app release-version authority. Keep `Cargo.toml`, `desktop/web/package.json`, and `desktop/web/package-lock.json` synchronized with it; the About dialog reads the Tauri config version, and release-candidate preflight validates drift.
- Linux bundles are deb and AppImage, not RPM.
- Debian dependencies in `tauri.conf.json` intentionally use alternatives for Ubuntu t64 transitions. Tauri merges custom depends with detected depends.
- See `docs/release.md` for the detailed human release process.

## Web Edition Static Bundle

- Web Edition source belongs in this repository, not in `canopi-website`. Implement it as a separate browser Vite entry/build that reuses shared frontend modules behind browser-specific shell and adapter seams.
- The Web Edition local build command is `cd desktop/web && npm run build:web`. It emits `desktop/web/dist-web/` and runs the browser-boundary scanner; keep `dist-web/` uncommitted.
- The Web Edition artifact command is `cd desktop/web && npm run package:web`. It builds the web entry, scans browser chunks, and emits a versioned directory plus `.tar.gz` under `desktop/web/dist-web-artifacts/`; keep that output uncommitted.
- The Web Edition Species Catalog command is `cd desktop/web && npm run generate:web-catalog`. It should emit ignored DuckDB-queryable Parquet catalog shards under `desktop/web/public/canopi-catalog/`; run it from a checkout with local canopi-data exports when catalog assets are needed for packaging or adapter testing. The current Parquet migration must keep the existing Web Edition data scope while making search/filter execution faster and keeping Web Edition Plant Detail reduced.
- The Canopi website should publish the built Web Edition artifact under a route such as `/app/`; it should not import Canopi app source as an Astro component package, workspace dependency, submodule, or copied component tree. See `docs/adr/0012-web-edition-static-app-bundle.md`.
- Do not commit generated Web Edition `/app` assets to `canopi-website` long term. The production website deploy should download the versioned Web Edition release asset from the Canopi app release tag and verify its manifest/checksums before publishing it under `/app/`. A local script may copy from a sibling Canopi checkout for preview/dev only.
- The web build uses the `/app/` base path. The package manifest records the required SPA fallback: serve `/app/*` as `/app/index.html` with status `200`. It also records a catalog summary with `canopi-catalog/manifest.json`, the generated catalog asset format, supported filter keys, and required catalog file paths.
- Web Edition uses compile-time browser adapters, not runtime feature flags in shared modules. Web Edition build checks should reject Tauri-only imports in browser chunks and fail if any generated app, WASM, worker, catalog, template, or image-metadata asset exceeds the Cloudflare Pages per-asset limit. Design Template catalog/import adapters are selected through `#design-template-catalog` and `#design-template-import-workflow`; static template assets and any allowed static asset origins are configured in `desktop/web/src/web/static-design-templates.ts`. See `docs/adr/0021-web-edition-compile-time-adapters.md`.
- Keep web catalog and DuckDB-WASM assets sharded/compressed enough for Cloudflare Pages limits; do not hide oversized files inside the website build. As of Cloudflare Pages docs last checked 2026-07-04, a single Pages asset is limited to 25 MiB and Free-plan sites contain up to 20,000 files. `npm run package:web` enforces those conservative limits, verifies required catalog and supported-filter metadata assets, rejects raw `duckdb-*.wasm` files, and scans emitted chunks for Tauri runtime markers such as `__TAURI_INTERNALS__`.
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
- `FileWatchHandle` contains closures and is not serializable.
- Lib crates export marker structs; `platform/mod.rs` implements the trait through conditional modules.
- `FileWatchHandle` must cancel on drop and join watcher threads.
- macOS and Windows platform code is stubbed behind `#[cfg(target_os = "...")]`.
- CI validates platform compilation on actual platforms.

## Linux Native

- Linux native code uses Cairo PNG/PDF and inotify.
- Cairo deps use `cairo-rs` with `png` and `pdf` features.
- Linux system deps include GTK/WebKitGTK, librsvg, and patchelf.
- Linux desktop startup sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` in process before Tauri/WebKitGTK initializes. Keep `cargo tauri dev` as the normal local command; do not move this workaround into shell-only launch instructions or release wrappers.
- Do not add `libappindicator3-dev`.

## Cross-Platform File Replace

- `std::fs::rename` can fail on Windows when files are locked.
- Use the project `atomic_replace()` path for design file writes and rollback sidecars.

## Tauri Config Gotchas

- `beforeDevCommand` uses object form with cwd `web` relative to `desktop/`.
- CSP is strict. Update directives when adding resource origins.
- Asset protocol scope is limited to app data image-cache paths.
- Window dragging with `decorations: false` requires window permissions in `capabilities/main-window.json`.
- `core:window:allow-destroy` is required for discard-without-save close behavior.
