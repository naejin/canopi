# Beta Release Verification

Date: 2026-04-01
Status: Wave 4 coherence is landed, the `v0.1.0` desktop beta is published, and the packaged-app smoke table has been signed off

Wave 5 is a beta-release gate on the current retained-surface architecture. It does not claim the broader roadmap is complete.

## Packaged DB Root Cause

The beta build initially showed `Plant database not found` even though the bundled DB asset existed in CI. Root cause: the desktop app resolved `BaseDirectory::Resource` as `canopi-core.db`, but Tauri bundles the resource under the relative path declared in `tauri.conf.json`.

For this app, `bundle.resources` is `resources/canopi-core.db`, so the packaged runtime lookup must resolve `resources/canopi-core.db` first. On Linux that maps to `usr/lib/Canopi/resources/canopi-core.db`; on macOS and Windows the same relative path applies inside the app bundle / install root.

This is a packaging-path issue, not a `prepare-db.py` generation issue.

## Wave 5 Beta Scope

Supported release targets:
- Linux desktop via Tauri
- macOS desktop via Tauri
- Windows desktop via Tauri

Not release targets:
- browser-only product
- iOS / Android

Explicitly deferred beyond Wave 5 beta at beta-cut time:
- color by plants
- frontend lazy loading / performance improvements
- detail-card photo fit polish
- map layers
- world map with featured designs / template import
- timeline workflows
- budget workflows
- consortium workflows
- geo / terrain workflows
- export workflows
- knowledge / learning surfaces

`color by plants` landed later on 2026-04-01 as post-beta work. This section is a historical record of beta scope, not the current active backlog.

## Required Automated Gates

These checks must pass before a beta release candidate is declared ready:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace -- -D warnings`
- `cargo test --workspace`
- `npx --prefix desktop/web tsc --noEmit -p desktop/web/tsconfig.json`
- `npm test --prefix desktop/web`
- `npm run build --prefix desktop/web`
- GitHub Actions Tauri build matrix with artifact upload for Linux, macOS Apple Silicon, macOS Intel, and Windows
- Linux CI packaging is intentionally constrained to the Debian bundle in GitHub Actions to avoid non-essential RPM packaging hangs during release-candidate assembly
- manual `Release Candidate` GitHub Actions workflow preflight for app version, bundled DB asset availability, bundled DB schema version, and checksum manifest generation
- i18n completeness test for all supported locales against `en.json`

Current status in this tree:

- `cargo fmt --all -- --check`: passing locally on 2026-03-30
- `cargo clippy --workspace -- -D warnings`: passing locally on 2026-03-30
- `cargo test --workspace`: passing locally on 2026-03-30
- `npx --prefix desktop/web tsc --noEmit -p desktop/web/tsconfig.json`: passing locally on 2026-03-31
- frontend tests: passing locally on 2026-03-31
- frontend i18n completeness: passing via the frontend test suite on 2026-03-31
- frontend production build: passing locally on 2026-03-31
- GitHub Actions workflow: includes rust fmt, clippy, TypeScript check, workspace tests, frontend tests, frontend build, and 4-target Tauri artifact builds
- `Release Candidate` workflow: lands manual preflight validation for `desktop/tauri.conf.json` version, bundled DB asset availability, bundled DB schema compatibility, and packaged-artifact checksum manifest upload

## Required Product Journeys

These journeys must remain green for the beta release:

1. Create a design, edit it, and switch documents without losing work.
2. Search the plant database, inspect detail, favorite plants, and place plants on the canvas.
3. Edit canvas content, undo/redo, save, reload, and preserve roundtrip parity.
4. Use layer controls and location selection without lifecycle or persistence regressions.
5. Recover gracefully from network failure, disk failure, and invalid external data.
6. Use the app in supported themes and locales without broken labels or unreadable surfaces.
7. Build release artifacts for Linux, macOS, and Windows.

## Supported-Platform Smoke Verification

Artifact builds are automated in CI, and the beta release also requires one packaged-app smoke pass per supported release artifact.

Use the packaged artifact produced by the manual `Release Candidate` workflow for each target and record the result here.

| Platform / target | Artifact source | Tester / owner | Test date | Status | Defects / follow-up |
| --- | --- | --- | --- | --- | --- |
| Linux desktop (`.deb`) | GitHub Actions Linux Tauri build artifact | Release owner | 2026-04-01 | Verified | Signed off for beta release |
| macOS Apple Silicon (`aarch64-apple-darwin`) | GitHub Actions macOS 14 Tauri build artifact | Release owner | 2026-04-01 | Verified | Signed off for beta release |
| macOS Intel (`x86_64-apple-darwin`) | GitHub Actions macOS 13 Tauri build artifact | Release owner | 2026-04-01 | Verified | Signed off for beta release |
| Windows desktop | GitHub Actions Windows Tauri build artifact | Release owner | 2026-04-01 | Verified | Signed off for beta release |

This smoke pass is release-hardening work. It does not replace the separate live verification and renderer validation flows tracked elsewhere.

## Release Operator Sequence

The beta-release operator flow is:

1. Publish or verify the bundled DB asset with `scripts/publish-db-release.sh`.
2. Run the `Release Candidate` GitHub Actions workflow for the exact candidate ref and release version.
3. Use the artifacts from that run for manual smoke verification on each supported platform.
4. Record tester, date, result, and any follow-up in the table above.
5. Promote the exact verified run artifacts to a draft or final GitHub Release with `scripts/promote-release.sh`.

Do not rebuild artifacts locally for promotion unless the release process is explicitly being run in emergency/manual-only mode.
See [`docs/release-operations.md`](/home/daylon/projects/canopi/docs/release-operations.md) for the operator runbook and command examples.

## Artifact Provenance Requirements

Before promoting a beta-release candidate, capture and retain all of the following from the `Release Candidate` workflow run:

- workflow run ID
- source commit SHA
- requested release version
- bundled DB release tag and asset name
- bundled DB SHA256
- packaged artifact checksum manifest (`SHA256SUMS.txt`)

Promotion should only upload the exact artifacts whose checksums were produced by that run.

## Minimum Packaged-App Smoke Script

Run this script against each packaged artifact:

1. Launch the app and confirm clean startup with no bundled-resource failure.
2. Create a design, edit it, save it, reload it, and switch documents without data loss.
3. Open plant search, inspect plant detail, favorite a plant if available, and place a plant on canvas.
4. Edit canvas content and verify undo/redo still works in the packaged build.
5. Open layer controls and confirm required display/layer flows still function.
6. Open the bottom-bar `location` tab, perform search, drag, zoom, and confirm the selected location updates correctly.
7. Switch theme and locale and confirm there are no missing labels or unreadable retained surfaces.
8. Confirm there is no startup-path, save-path, or packaged-resource regression.

## Known Accepted Warnings

These are review items, not automatic blockers unless they become release-impacting:

- Vite chunk-size warnings for the main bundle and `maplibre-gl`
- dynamic+static import warning around `desktop/web/src/ipc/species.ts`
- Rust dead-code warnings in platform/tile-related types

## Wave 5 Blocking Defects

Fix only defects that block the beta release:

- app fails to launch
- packaged resources needed for core retained-surface flows are missing or inaccessible
- create/save/load/switch loses work
- plant search/detail/placement is broken
- undo/redo or roundtrip persistence regresses
- layer controls or `location` retained-surface flows are broken
- supported theme/locale usage has missing labels or unreadable surfaces

## Smoke Verification Ownership

Packaged-app smoke execution is owned by external platform testers or release operators.

Repo follow-up from smoke feedback should stay narrow:
- capture the evidence in the table above
- fix only beta-blocking defects
- rerun the affected target smoke pass after a fix lands

## Remaining Wave 5 Work

What remains after the automated checks and shipped beta:

- keep the CI workflow green on `main`
- fix only defects that block beta usability or packaging on supported targets
- carry forward only the release-operator steps that still apply to future beta patches
