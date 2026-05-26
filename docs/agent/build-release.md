# Build, Release, And Platform

Use this guide when changing build scripts, Tauri config, CI workflows, native platform code, packaging, release candidates, or generated desktop assets.

## Local Build Commands

```bash
# Rust workspace check without local bundled plant DB
CANOPI_SKIP_BUNDLED_DB=1 cargo check --workspace

# Rust lint gate matching CI expectations
CANOPI_SKIP_BUNDLED_DB=1 cargo clippy --workspace --all-targets -- -D warnings

# Rust tests
cargo test --workspace

# Frontend build
cd desktop/web && npm run build

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
- Linux bundles are deb and AppImage, not RPM.
- Debian dependencies in `tauri.conf.json` intentionally use alternatives for Ubuntu t64 transitions. Tauri merges custom depends with detected depends.
- See `docs/release.md` for the detailed human release process.

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
