# Release Operations

This runbook covers the bundled DB asset, the manual `Release Candidate` workflow, and explicit beta/stable promotion with dedicated updater manifests.

## Recommended Dev Flow

Use this sequence from feature work to a published release:

1. Develop on a feature branch.
2. Open a PR into `main`.
3. Merge only after CI is green.
4. Refresh the bundled DB release if the DB changed.
5. Run the `Release Candidate` workflow from the exact commit you want to ship, with the exact version to package.
6. Promote that run to `beta` when you want an opt-in prerelease.
7. Smoke and soak the published beta, or override that gate as release owner.
8. Re-run `Release Candidate` from the same commit with the final stable version when you are ready to ship stable.
9. Promote that stable run and update the moving updater manifests.

## Prerequisites

- `gh` installed and authenticated for the target repo
- access to the canopi-data export DB used to build `canopi-core.db`
- smoke-test owners available for Linux, macOS Apple Silicon, macOS Intel, and Windows
- committed updater public key present at [`desktop/updater-public.key`](/home/daylon/projects/canopi/desktop/updater-public.key)
- `TAURI_SIGNING_PRIVATE_KEY` configured in GitHub Actions secrets
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` configured in GitHub Actions secrets if the updater key is password-protected

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
- `release_version`: the exact version to inject at build time, such as `0.4.0-beta.1` or `0.4.0`
- `db_release_tag`: usually `canopi-core-db`
- `db_asset_name`: usually `canopi-core.db`

The workflow preflight validates:

- candidate ref resolves cleanly
- requested release version is valid release-version syntax
- committed updater public key exists and is non-empty
- bundled DB asset exists and is non-empty
- bundled DB schema version matches the app expectation
- packaged artifacts exist before the checksum manifest is uploaded
- updater artifacts are signed during the release build when signing secrets are present

The workflow compiles the app with fixed updater manifest endpoints:

- `https://github.com/<repo>/releases/download/canopi-stable-manifest/latest.json`
- `https://github.com/<repo>/releases/download/canopi-beta-manifest/latest.json`

Artifacts to retain from the run:

- `canopi-<target>` per platform
- `canopi-release-candidate-manifest`

## 3. Promote To Beta

Promote the exact run to a public prerelease:

```bash
scripts/promote-release.sh --run-id <run-id> --channel beta --tag v<version> --title "Canopi <version>"
```

For beta builds, use prerelease versions such as `v0.4.0-beta.1`.

This promotion does all of the following:

- verifies `SHA256SUMS.txt`
- creates or updates the versioned GitHub prerelease
- uploads packaged artifacts, updater signatures, `SHA256SUMS.txt`, `latest.json`, and `release-metadata.json`
- updates the moving `canopi-beta-manifest` release so opted-in beta users receive that build

The beta promotion is published immediately. Do not rely on draft releases for updater-visible beta builds.

## 4. Smoke And Soak Beta

Use only the artifacts from the promoted beta release or from the matching release-candidate run. Record results in [`docs/release-verification.md`](/home/daylon/projects/canopi/docs/release-verification.md).

Required evidence:

- workflow run ID
- source commit SHA
- bundled DB SHA256
- `SHA256SUMS.txt`
- `latest.json`
- tester, date, platform result, and any defects

Default policy:

- beta is the normal gate before stable
- default soak window is 48 hours
- release-owner signoff is sufficient
- the release owner may override missing smoke evidence, the soak window, or beta entirely, but must record a short reason

Operational rule:

- do not start re-checking the release every few minutes; wait for the publish step to settle, then inspect the published metadata once
- verify the published `release-metadata.json` `head_sha` matches the intended run

## 5. Promote To Stable

When the accepted commit is ready for stable, run `Release Candidate` again from the same commit with the final stable version, then promote that stable run:

```bash
scripts/promote-release.sh --run-id <run-id> --channel stable --tag v<version> --title "Canopi <version>"
```

Stable promotion does all of the following:

- creates or updates the versioned stable GitHub release
- uploads packaged artifacts, updater signatures, `SHA256SUMS.txt`, `latest.json`, and `release-metadata.json`
- updates the moving `canopi-stable-manifest` release
- repoints `canopi-beta-manifest` to the accepted stable build until a newer beta is promoted

Stable releases are expected to be rebuilt from the same accepted commit as the beta being promoted, with no code changes between the accepted commit and the stable packaging run. The release operator must verify that the published `release-metadata.json` `head_sha` matches the accepted beta commit, or record an explicit override reason.

## Failure Triage

- Invalid release version:
  Re-run the workflow with a valid version such as `0.4.0-beta.1` or `0.4.0`.
- Bundled DB asset missing:
  Re-run `scripts/publish-db-release.sh` or confirm the target release tag/asset name.
- Bundled DB schema mismatch:
  Rebuild and republish the DB from the matching contract version before packaging.
- Promotion checksum failure:
  Do not publish. Re-download artifacts from the run and investigate whether the run artifacts or manifest are incomplete.
- Updater manifest or signature failure:
  Do not publish. Confirm `desktop/updater-public.key` is present, the release-candidate run had signing secrets, produced `.sig` files for updater artifacts, and generated a valid `latest.json`.
- Channel manifest mismatch:
  Do not publish. Confirm `canopi-stable-manifest` and `canopi-beta-manifest` point to the intended versioned release assets.
