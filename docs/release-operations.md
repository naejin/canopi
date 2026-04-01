# Release Operations

This runbook covers the operator steps around the bundled DB asset, the manual `Release Candidate` workflow, and final GitHub Release promotion.

## Recommended Dev Flow

Use this sequence from feature work to published beta:

1. Develop on a feature branch.
2. Open a PR into `main`.
3. Merge only after CI is green.
4. Refresh the bundled DB release if the DB changed.
5. Run the `Release Candidate` workflow from `main` for the exact version to ship.
6. Smoke the packaged CI artifacts for Linux, macOS Apple Silicon, macOS Intel, and Windows.
7. Promote the exact verified run to a GitHub Release with `scripts/promote-release.sh`.

## Prerequisites

- `gh` installed and authenticated for the target repo
- access to the canopi-data export DB used to build `canopi-core.db`
- smoke-test owners available for Linux, macOS Apple Silicon, macOS Intel, and Windows

Verify local GitHub auth before starting:

```bash
gh auth status
```

## 1. Publish Or Refresh The Bundled DB

Build the DB from a canopi-data export and upload both the DB file and its checksum asset to the `canopi-core-db` release tag:

```bash
scripts/publish-db-release.sh --export-path ~/projects/canopi-data/data/exports/<export>.db
```

Optional flags:

- `--tag <tag>` to use a different DB release tag
- `--asset-name <name>` to change the uploaded DB filename
- `--repo <owner/repo>` if repo auto-detection is not correct

This script fails if:

- the generated DB is empty
- the generated DB schema version does not match `desktop/src/db/schema_contract.rs`
- the target GitHub release tag does not exist
- `gh release upload` fails

Note: a successful DB upload does not guarantee the packaged app will find it at runtime. The desktop app must resolve the bundled resource using the same relative path that appears in `desktop/tauri.conf.json` (`resources/canopi-core.db`), not just the filename.

## 2. Run The Release Candidate Workflow

From GitHub Actions, run `Release Candidate` with:

- `ref`: the exact candidate ref to build
- `release_version`: must match `desktop/tauri.conf.json`
- `db_release_tag`: usually `canopi-core-db`
- `db_asset_name`: usually `canopi-core.db`

The workflow preflight validates:

- candidate ref resolves cleanly
- requested release version matches app config
- bundled DB asset exists and is non-empty
- bundled DB schema version matches the app expectation
- packaged artifacts exist before the checksum manifest is uploaded

Artifacts to retain from the run:

- `canopi-<target>` per platform
- `canopi-release-candidate-manifest`

## 3. Smoke-Test The Exact CI Artifacts

Use only the artifacts from the release-candidate run. Record results in [`docs/release-verification.md`](/home/daylon/projects/canopi/docs/release-verification.md).

Required evidence:

- workflow run ID
- source commit SHA
- bundled DB SHA256
- `SHA256SUMS.txt`
- tester, date, platform result, and any defects

Observed timing on `2026-04-01` for run `23849252941`:

- Linux `.deb` build completed in about 6m 25s
- macOS Apple Silicon build completed in about 5m 25s
- macOS Intel build completed in about 10m 32s
- The full release-candidate run finished in about 13-14 minutes end to end before promotion
- Release promotion can take an additional 10-20 minutes because the Windows artifact is large and GitHub upload latency dominates

Operational rule:

- Do not start re-checking the release every few minutes. Wait at least 20 minutes after kicking off promotion, then inspect the published release metadata once.
- Verify the published `release-metadata.json` `head_sha` matches the promoted run instead of repeatedly polling the release page.

## 4. Promote The Verified Run

After smoke verification passes, create or update the GitHub Release from that exact run:

```bash
scripts/promote-release.sh --run-id <run-id> --tag v0.1.0 --title "Canopi 0.1.0"
```

This script:

- downloads artifacts from the specified run
- requires the manifest artifact to be present
- verifies `SHA256SUMS.txt`
- creates or updates the GitHub Release
- uploads the packaged artifacts, `SHA256SUMS.txt`, and `release-metadata.json`

## Failure Triage

- Preflight version mismatch:
  Update `desktop/tauri.conf.json` or rerun the workflow with the correct `release_version`.
- Bundled DB asset missing:
  Re-run `scripts/publish-db-release.sh` or confirm the target release tag/asset name.
- Bundled DB schema mismatch:
  Rebuild and republish the DB from the matching contract version before packaging.
- Promotion checksum failure:
  Do not publish. Re-download artifacts from the run and investigate whether the run artifacts or manifest are incomplete.
