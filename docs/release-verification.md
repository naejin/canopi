# Rewrite Exit Release Verification

Date: 2026-03-30
Status: Wave 5 release hardening checklist for the landed reconciler tree

## Rewrite-Exit Scope

Supported release targets:
- Linux desktop via Tauri
- macOS desktop via Tauri
- Windows desktop via Tauri

Not release targets:
- browser-only product
- iOS / Android

Explicitly deferred until post-rewrite:
- featured-design world-map discovery and template import
- timeline workflows
- budget workflows
- geo / terrain workflows
- export workflows
- knowledge / learning surfaces

## Required Automated Gates

These checks must pass before rewrite completion:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace -- -D warnings`
- `cargo test --workspace`
- `npm test --prefix desktop/web`
- `npm run build --prefix desktop/web`
- GitHub Actions Tauri build matrix with artifact upload for Linux, macOS Apple Silicon, macOS Intel, and Windows
- i18n completeness test for all supported locales against `en.json`

Current status in this tree:

- `cargo fmt --all -- --check`: passing locally on 2026-03-30
- `cargo clippy --workspace -- -D warnings`: passing locally on 2026-03-30
- `cargo test --workspace`: passing locally on 2026-03-30
- frontend tests: passing
- frontend i18n completeness: passing via the frontend test suite
- frontend production build: passing
- GitHub Actions workflow: includes rust fmt, clippy, workspace tests, frontend tests, frontend build, and 4-target Tauri artifact builds

## Required Product Journeys

These journeys must remain green at rewrite exit:

1. Create a design, edit it, and switch documents without losing work.
2. Search the plant database, inspect detail, favorite plants, and place plants on the canvas.
3. Edit canvas content, undo/redo, save, reload, and preserve roundtrip parity.
4. Use layer controls, location selection, and consortium without lifecycle or persistence regressions.
5. Recover gracefully from network failure, disk failure, and invalid external data.
6. Use the app in supported themes and locales without broken labels or unreadable surfaces.
7. Build release artifacts for Linux, macOS, and Windows.

## Supported-Platform Smoke Verification

Artifact builds are automated in CI, but rewrite exit still requires one packaged-app smoke pass per supported release artifact.

Use the packaged artifact produced by CI for each target and record the result here.

| Platform / target | Artifact source | Status | Minimum smoke pass |
| --- | --- | --- | --- |
| Linux desktop | GitHub Actions Linux Tauri build artifact | Pending | Launch app, create/edit/save/reload a design, open plant search/detail, place a plant, switch theme/locale, confirm no startup or save-path regressions |
| macOS Apple Silicon (`aarch64-apple-darwin`) | GitHub Actions macOS 14 Tauri build artifact | Pending | Launch app, create/edit/save/reload a design, open plant search/detail, place a plant, switch theme/locale, confirm no startup or save-path regressions |
| macOS Intel (`x86_64-apple-darwin`) | GitHub Actions macOS 13 Tauri build artifact | Pending | Launch app, create/edit/save/reload a design, open plant search/detail, place a plant, switch theme/locale, confirm no startup or save-path regressions |
| Windows desktop | GitHub Actions Windows Tauri build artifact | Pending | Launch app, create/edit/save/reload a design, open plant search/detail, place a plant, switch theme/locale, confirm no startup or save-path regressions |

This smoke pass is release-hardening work. It does not replace the separate live verification and renderer validation flows tracked elsewhere.

## Known Accepted Warnings

These are review items, not automatic blockers unless they become release-impacting:

- Vite chunk-size warnings for the main bundle and `maplibre-gl`
- dynamic+static import warning around `desktop/web/src/ipc/species.ts`
- Rust dead-code warnings in platform/tile-related types

## Manual Follow-Up Owned By Claude Code

This checklist intentionally does not include live Tauri MCP execution.

Claude Code should run the manual desktop verification pass for:
- layer controls
- location search / drag / zoom / confirm
- consortium flows

Any defects found there should be fixed as narrow follow-up patches.

## Remaining Wave 5 Work

What is still left after the current automated checks:

- keep the CI workflow green on the release branch
- complete the supported-platform smoke table above using packaged artifacts
- rerun the rewrite-exit checklist once product and renderer blockers are cleared
- archive or remove stale future-tense instructions after rewrite exit is actually reached
