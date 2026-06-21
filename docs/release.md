# Release Process

Scripts are the source of truth. This section provides the operator sequence.

## Recommended Dev Flow

1. Develop on a feature branch.
2. Open a PR into `main`.
3. Merge only after CI is green.
4. Bump the app release version in `desktop/tauri.conf.json` and keep `Cargo.toml`, `desktop/web/package.json`, and `desktop/web/package-lock.json` in sync.
5. Refresh the bundled DB release if the DB changed.
6. Run the `Release Candidate` workflow from `main` for the exact version to ship.
7. Smoke the packaged CI artifacts for Linux, macOS Apple Silicon, macOS Intel, and Windows.
8. Promote the exact verified run to a GitHub Release with `scripts/promote-release.sh`.

## Version Authority

`desktop/tauri.conf.json` is the app release-version authority. The About dialog reads this version, and the release-candidate preflight fails if `Cargo.toml`, `desktop/web/package.json`, or `desktop/web/package-lock.json` drift from it.

## 1. Publish Or Refresh The Bundled DB

```bash
scripts/publish-db-release.sh --export-path ~/projects/canopi-data/data/exports/<export>.db
```

Optional flags: `--tag <tag>`, `--asset-name <name>`, `--repo <owner/repo>`.

This script fails if: the generated DB is empty, schema version does not match `desktop/src/db/schema_contract.rs`, the target release tag does not exist, or `gh release upload` fails.

## 2. Run The Release Candidate Workflow

From GitHub Actions, run `Release Candidate` with:
- `ref`: the exact candidate ref to build
- `release_version`: must match `desktop/tauri.conf.json`
- `db_release_tag`: usually `canopi-core-db`
- `db_asset_name`: usually `canopi-core.db`

The workflow preflight validates: candidate ref resolves cleanly, requested release version matches app config, app version metadata is synchronized, bundled DB asset exists and is non-empty, bundled DB schema version matches the app expectation, packaged artifacts exist before checksum manifest upload.

## 3. Smoke-Test The Exact CI Artifacts

Use only the artifacts from the release-candidate run. Required evidence:
- workflow run ID
- source commit SHA
- bundled DB SHA256
- `SHA256SUMS.txt`
- tester, date, platform result, and any defects

Minimum packaged-app smoke script:
1. Launch the app and confirm clean startup with no bundled-resource failure.
2. Create a design, edit it, save it, reload it, and switch documents without data loss.
3. Open plant search, inspect plant detail, favorite a plant if available, and place a plant on canvas.
4. Edit canvas content and verify undo/redo still works in the packaged build.
5. Open layer controls and confirm required display/layer flows still function.
6. Open the visible PanelBar `location` entry, perform search, drag, zoom, and confirm the selected location updates correctly.
7. Switch theme and locale and confirm there are no missing labels or unreadable retained surfaces.
8. Confirm there is no startup-path, save-path, or packaged-resource regression.

## 4. Promote The Verified Run

```bash
scripts/promote-release.sh --run-id <run-id> --tag v<version> --title "Canopi <version>"
```

This script downloads artifacts from the specified run, requires the manifest artifact, verifies `SHA256SUMS.txt`, creates or updates the GitHub Release, and uploads packaged artifacts plus manifest.

When `docs/release-notes/v<version>.md` exists, the script uses it as the base release body and appends release metadata plus explicit download links.

## 5. Publish The Draft Release

```bash
gh release edit v<version> --draft=false
```

## Failure Triage

- **Preflight version mismatch**: Update `desktop/tauri.conf.json` or rerun the workflow with the correct `release_version`.
- **Bundled DB asset missing**: Re-run `scripts/publish-db-release.sh` or confirm the target release tag/asset name.
- **Bundled DB schema mismatch**: Rebuild and republish the DB from the matching contract version before packaging.
- **Promotion checksum failure**: Do not publish. Re-download artifacts from the run and investigate.
