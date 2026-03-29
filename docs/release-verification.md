# Rewrite Exit Release Verification

Date: 2026-03-29
Status: Wave 5 release hardening checklist

## Rewrite-Exit Scope

Supported release targets:
- Linux desktop via Tauri
- macOS desktop via Tauri
- Windows desktop via Tauri

Not release targets:
- browser-only product
- iOS / Android

Explicitly deferred until post-rewrite:
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
- GitHub Actions 3-platform Tauri build matrix with artifact upload for Linux, macOS, and Windows
- i18n completeness test for all supported locales against `en.json`

Current status in this tree:

- frontend tests: passing
- frontend production build: passing
- workspace clippy: passing
- workspace tests: passing

## Required Product Journeys

These journeys must remain green at rewrite exit:

1. Create a design, edit it, and switch documents without losing work.
2. Search the plant database, inspect detail, favorite plants, and place plants on the canvas.
3. Edit canvas content, undo/redo, save, reload, and preserve roundtrip parity.
4. Use featured-design discovery and template import without bypassing the document boundary.
5. Use layer controls, location selection, timeline, budget, and consortium without lifecycle or persistence regressions.
6. Recover gracefully from network failure, disk failure, and invalid external data.
7. Use the app in supported themes and locales without broken labels or unreadable surfaces.
8. Build release artifacts for Linux, macOS, and Windows.

## Known Accepted Warnings

These are review items, not automatic blockers unless they become release-impacting:

- Vite chunk-size warnings for the main bundle and `maplibre-gl`
- dynamic+static import warning around `desktop/web/src/ipc/species.ts`
- Rust dead-code warnings in platform/tile-related types

## Manual Follow-Up Owned By Claude Code

This checklist intentionally does not include live Tauri MCP execution.

Claude Code should run the manual desktop verification pass for:
- featured-design world-map discovery and template import
- layer controls
- location search / drag / zoom / confirm
- timeline flows
- budget flows
- consortium flows

Any defects found there should be fixed as narrow follow-up patches.
