# Release Verification

This document is the verification checklist for Canopi release candidates, beta promotions, and stable promotions.

Use it together with [`docs/release-operations.md`](/home/daylon/projects/canopi/docs/release-operations.md), which is the operator runbook for building and promoting releases.

## Purpose

This checklist exists to answer four questions before a release is promoted:

1. Did the requested release candidate build from the exact intended commit?
2. Are the packaged artifacts and updater metadata internally consistent?
3. Did the packaged app pass the required smoke checks on supported platforms?
4. If normal release gates were bypassed, is the override recorded clearly?

## Current Release Policy

- `beta` is the normal gate before `stable`.
- `beta` is opt-in only. Stable users must never receive beta automatically.
- beta builds use prerelease versions such as `0.4.0-beta.1`.
- stable builds are rebuilt from the exact accepted beta commit, with no code changes between accepted beta and stable packaging.
- default soak window before stable promotion is `48 hours`.
- the release owner may override the soak window, missing smoke evidence, or beta entirely, but each override must include a short written reason.
- beta builds must not introduce irreversible local migrations before stable.
- switching from `beta` back to `stable` changes only future update checks; it does not downgrade the installed app.

## Required Automated Gates

These checks must pass before a release candidate is treated as promotable:

- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `npx --prefix desktop/web tsc --noEmit -p desktop/web/tsconfig.json`
- `npm test --prefix desktop/web`
- `npm run build --prefix desktop/web`
- GitHub Actions Tauri build matrix for:
  - Linux AppImage
  - macOS Apple Silicon
  - macOS Intel
  - Windows
- `Release Candidate` workflow preflight for:
  - release-version format
  - committed updater public key availability
  - bundled DB availability
  - bundled DB schema compatibility
  - packaged artifact manifest generation
- updater signing and `latest.json` generation in the release-candidate manifest job
- i18n completeness coverage in the frontend test suite

## Artifact Provenance Checklist

Capture and retain all of the following for the release candidate run before any promotion:

- workflow run ID
- source commit SHA
- requested release version
- expected release tag `v<release_version>`
- bundled DB release tag
- bundled DB asset name
- bundled DB SHA256
- packaged artifact checksum manifest `SHA256SUMS.txt`
- updater manifest `latest.json`
- release metadata file `release-metadata.json`

Promotion must use the exact artifacts produced by that run.

Before promoting:

- verify `release-metadata.json.head_sha` matches the intended source commit
- verify `release-metadata.json.release_tag` matches the intended release tag
- verify `SHA256SUMS.txt` validates successfully against the downloaded run artifacts
- verify `latest.json` exists and references signed updater artifacts

## Beta Verification

Before promoting a release candidate to `beta`, verify:

- the release version is a prerelease version such as `0.4.0-beta.1`
- the Windows prerelease artifact is the NSIS `.exe` bundle, not an MSI
- the release candidate artifacts come from the intended commit
- packaged artifacts, signatures, `latest.json`, and `release-metadata.json` are present
- the target beta tag/title are correct

After beta promotion:

- verify the versioned GitHub prerelease exists and is public
- verify the moving `canopi-beta-manifest` release points to the promoted beta build
- verify beta users would receive that build through the updater feed

## Stable Verification

Before promoting a release candidate to `stable`, verify:

- the stable release candidate was rebuilt from the exact accepted beta commit
- `release-metadata.json.head_sha` matches the accepted beta commit
- the accepted beta completed the normal soak/signoff path, or an override has been recorded
- packaged artifacts, signatures, `latest.json`, and `release-metadata.json` are present
- the target stable tag/title are correct

After stable promotion:

- verify the versioned GitHub stable release exists
- verify the moving `canopi-stable-manifest` release points to the promoted stable build
- verify `canopi-beta-manifest` now points to the accepted stable build until a newer beta is promoted
- verify stable users would receive the stable build and beta users would continue on their channel behavior correctly

## Supported Platform Smoke Matrix

Every supported packaged artifact needs a smoke result recorded here before stable promotion, unless explicitly overridden.

| Platform / target | Artifact source | Tester / owner | Test date | Status | Defects / follow-up |
| --- | --- | --- | --- | --- | --- |
| Linux desktop (`.AppImage`) | Release Candidate run artifact or promoted beta asset |  |  | Pending |  |
| macOS Apple Silicon (`aarch64-apple-darwin`) | Release Candidate run artifact or promoted beta asset |  |  | Pending |  |
| macOS Intel (`x86_64-apple-darwin`) | Release Candidate run artifact or promoted beta asset |  |  | Pending |  |
| Windows desktop (NSIS `.exe` for prerelease beta builds) | Release Candidate run artifact or promoted beta asset |  |  | Pending |  |

## Minimum Packaged-App Smoke Script

Run this script against the packaged app for each supported platform artifact:

1. Launch the app and confirm clean startup with no packaged-resource failure.
2. Create a design, edit it, save it, reload it, and switch documents without losing work.
3. Search the plant database, inspect plant detail, and place a plant on canvas.
4. Edit canvas content and verify undo/redo still works.
5. Open layer controls and confirm required display/layer flows still function.
6. Open the `location` flow, search, drag, zoom, and confirm the selected location updates correctly.
7. Switch theme and locale and confirm there are no missing labels or unreadable retained surfaces.
8. Confirm there is no startup-path, save-path, or packaged-resource regression.
9. Trigger `Check for Updates` against a newer signed release and confirm the packaged build detects the update, installs it, and relaunches correctly.

## Release Owner Signoff

Record release-owner signoff before stable promotion:

| Release version | Channel | Source commit | Release owner | Signoff date | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | Pending |  |

## Override Log

Record every policy override here.

Examples:

- beta bypassed entirely
- stable promoted before `48 hours`
- missing platform smoke evidence overridden
- stable promoted with a known non-blocking defect

| Date | Release version | Override type | Owner | Reason |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## Blocking Defects

Do not promote while any of these remain unresolved unless the release owner explicitly records an override:

- app fails to launch
- packaged resources required for core app flows are missing or inaccessible
- create/save/load/switch loses work
- plant search/detail/placement is broken
- undo/redo or persistence regresses
- layer controls or location flows are broken
- updater detection/install/restart is broken for the packaged app
- supported theme/locale usage has missing labels or unreadable surfaces

## Operator Notes

- Do not rebuild release artifacts locally as part of normal promotion.
- Do not promote from partially downloaded or manually altered artifacts.
- Do not assume the moving manifest tags are correct without checking them after promotion.
- If a beta is bad, fix forward with a newer beta instead of attempting automatic downgrade behavior.
