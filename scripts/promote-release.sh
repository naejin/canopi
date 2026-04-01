#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[promote-release] %s\n' "$*"
}

format_bytes() {
  python3 - "$1" <<'PY'
import sys

value = int(sys.argv[1])
units = ["B", "KB", "MB", "GB", "TB"]
size = float(value)
for unit in units:
    if size < 1024 or unit == units[-1]:
        if unit == "B":
            print(f"{int(size)} {unit}")
        else:
            print(f"{size:.1f} {unit}")
        break
    size /= 1024
PY
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: Required command '$1' is not installed or not on PATH." >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage:
  scripts/promote-release.sh --run-id ID --tag TAG --title TITLE [options]

Options:
  --run-id ID         GitHub Actions run ID for the release-candidate workflow (required)
  --tag TAG           Git tag / release tag to create or update (required)
  --title TITLE       GitHub Release title (required)
  --repo OWNER/REPO   GitHub repository (default: detected from git remote)
EOF
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

require_cmd gh
require_cmd python3
require_cmd sha256sum
require_cmd unzip

detect_repo() {
  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  case "$remote" in
    git@github.com:*.git)
      printf '%s\n' "${remote#git@github.com:}" | sed 's/\.git$//'
      ;;
    https://github.com/*.git)
      printf '%s\n' "${remote#https://github.com/}" | sed 's/\.git$//'
      ;;
    https://github.com/*)
      printf '%s\n' "${remote#https://github.com/}"
      ;;
    *)
      return 1
      ;;
  esac
}

run_id=""
tag=""
title=""
repo="$(detect_repo || true)"
tmpdir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)
      run_id="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
      shift 2
      ;;
    --title)
      title="$2"
      shift 2
      ;;
    --repo)
      repo="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$run_id" || -z "$tag" || -z "$title" ]]; then
  echo "ERROR: --run-id, --tag, and --title are required." >&2
  usage >&2
  exit 1
fi

if [[ -z "$repo" ]]; then
  echo "ERROR: --repo is required when the GitHub repository cannot be detected from git remote.origin.url." >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

log "Downloading artifacts from run $run_id in $repo"
artifact_json="$(gh api "repos/$repo/actions/runs/$run_id/artifacts")"
mapfile -t artifact_lines < <(
  ARTIFACT_JSON="$artifact_json" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["ARTIFACT_JSON"])
for artifact in payload.get("artifacts", []):
    if artifact.get("expired"):
        continue
    print(f"{artifact['id']}\t{artifact['name']}\t{artifact['size_in_bytes']}")
PY
)

if [[ "${#artifact_lines[@]}" -eq 0 ]]; then
  echo "ERROR: No downloadable artifacts found for run $run_id." >&2
  exit 1
fi

for artifact_line in "${artifact_lines[@]}"; do
  artifact_id="${artifact_line%%$'\t'*}"
  artifact_rest="${artifact_line#*$'\t'}"
  artifact_name="${artifact_rest%%$'\t'*}"
  artifact_size="${artifact_rest#*$'\t'}"
  artifact_dir="$tmpdir/$artifact_name"
  artifact_zip="$tmpdir/$artifact_name.zip"
  log "Downloading artifact '$artifact_name' ($(format_bytes "$artifact_size"))"
  mkdir -p "$artifact_dir"
  gh api "repos/$repo/actions/artifacts/$artifact_id/zip" > "$artifact_zip"
  unzip -oq "$artifact_zip" -d "$artifact_dir"
  rm -f "$artifact_zip"
done

manifest_dir="$tmpdir/canopi-release-candidate-manifest"
manifest_path="$manifest_dir/SHA256SUMS.txt"
metadata_path="$manifest_dir/release-metadata.json"

if [[ ! -f "$manifest_path" || ! -f "$metadata_path" ]]; then
  echo "ERROR: Release-candidate manifest artifact is missing from run $run_id." >&2
  exit 1
fi

log "Verifying packaged artifact checksums"
(
  cd "$tmpdir"
  sha256sum -c "$manifest_path"
)

mapfile -t release_files < <(
  find "$tmpdir" -type f \( \
    -name '*.deb' -o \
    -name '*.AppImage' -o \
    -name '*.dmg' -o \
    -name '*.msi' -o \
    -name '*.exe' \
  \) | sort
)

if [[ "${#release_files[@]}" -eq 0 ]]; then
  echo "ERROR: No packaged release artifacts were downloaded from run $run_id." >&2
  exit 1
fi

notes_file="$tmpdir/release-notes.md"
python3 - "$metadata_path" "$run_id" <<'PY' > "$notes_file"
import json
import sys
from pathlib import Path

metadata = json.loads(Path(sys.argv[1]).read_text())
run_id = sys.argv[2]

print("Release candidate promoted from GitHub Actions artifacts.")
print()
print(f"- Source run: {run_id}")
print(f"- Source ref: {metadata['ref']}")
print(f"- Source commit: {metadata['head_sha']}")
print(f"- App version: {metadata['release_version']}")
print(f"- Bundled DB: {metadata['db_asset_name']} from tag {metadata['db_release_tag']}")
print(f"- Bundled DB sha256: {metadata['db_sha256']}")
print(f"- Expected DB schema version: {metadata['expected_db_schema_version']}")
print()
print("Promoted artifacts were checksum-verified before upload.")
PY

if gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  log "Updating existing release $repo@$tag"
  gh release edit "$tag" --repo "$repo" --title "$title" --notes-file "$notes_file"
else
  log "Creating draft release $repo@$tag"
  gh release create "$tag" --repo "$repo" --draft --title "$title" --notes-file "$notes_file"
fi

log "Uploading packaged artifacts and manifest"
gh release upload "$tag" \
  "${release_files[@]}" \
  "$manifest_path#SHA256SUMS.txt" \
  "$metadata_path#release-metadata.json" \
  --repo "$repo" \
  --clobber

log "Promoted run $run_id to release $repo@$tag"
log "Uploaded ${#release_files[@]} packaged artifacts plus checksum manifest."
