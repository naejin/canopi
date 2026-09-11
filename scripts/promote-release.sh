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
  --artifact-dir DIR Reuse packages in a downloaded candidate directory; always fetch a fresh manifest
EOF
}

caller_dir="$PWD"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

require_cmd gh
require_cmd python3
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
local_artifact_dir=""

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
    --artifact-dir)
      local_artifact_dir="${2:?--artifact-dir requires a directory}"
      if [[ "$local_artifact_dir" != /* ]]; then
        local_artifact_dir="$caller_dir/$local_artifact_dir"
      fi
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

gh api "repos/$repo/actions/runs/$run_id" > "$tmpdir/run.json"
python3 - "$tmpdir/run.json" <<'PY'
import json
import sys
from pathlib import Path

run = json.loads(Path(sys.argv[1]).read_text())
if (run.get("path") != ".github/workflows/release-candidate.yml"
        or run.get("status") != "completed" or run.get("conclusion") != "success"):
    raise SystemExit("ERROR: Promotion requires a successful, completed Release Candidate run.")
PY

log "Reading candidate artifacts from run $run_id in $repo"
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
  if [[ -n "$local_artifact_dir" && "$artifact_name" != "canopi-release-candidate-manifest" ]]; then
    continue
  fi
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

stage_args=()
if [[ -n "$local_artifact_dir" ]]; then
  log "Staging local packages against the freshly downloaded candidate manifest"
  stage_args=(--stage-dir "$tmpdir/staged")
fi
log "Verifying packaged artifact checksums"
python3 "$repo_root/scripts/release_candidate_artifacts.py" \
  --manifest "$manifest_path" --source-dir "${local_artifact_dir:-$tmpdir}" \
  "${stage_args[@]}" > "$tmpdir/release-files.txt"
mapfile -t release_files < "$tmpdir/release-files.txt"

release_identity="$(python3 - "$metadata_path" "$repo" "$tag" <<'PY'
import json
import re
import sys
from pathlib import Path

metadata = json.loads(Path(sys.argv[1]).read_text())
version = metadata.get("release_version", "")
commit = metadata.get("head_sha", "")
if metadata.get("repository") != sys.argv[2]:
    raise SystemExit("ERROR: Candidate metadata belongs to a different repository.")
if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
    raise SystemExit("ERROR: Candidate metadata must identify an exact source commit.")
if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version):
    raise SystemExit("ERROR: Candidate metadata must identify a release version.")
if sys.argv[3] != "v" + version:
    raise SystemExit("ERROR: Release tag does not match the candidate version.")
print(version, commit)
PY
)"
read -r release_version source_sha <<< "$release_identity"
release_notes_path="$repo_root/docs/release-notes/v${release_version}.md"
notes_file="$tmpdir/release-notes.md"

if [[ -f "$release_notes_path" ]]; then
  log "Using release notes from $release_notes_path"
  cp "$release_notes_path" "$notes_file"
else
  printf '# Canopi %s Release Notes\n\n' "$release_version" > "$notes_file"
fi

{
  printf "\n## Release Artifact Metadata\n\n"
  python3 - "$metadata_path" "$run_id" <<'PY'
import json
import sys
from pathlib import Path

metadata = json.loads(Path(sys.argv[1]).read_text())
run_id = sys.argv[2]

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
  printf "\n## Download Links\n\n"
  printf -- "-- This section links to assets attached to this release.\n\n"
  for release_file in "${release_files[@]}"; do
    release_name="$(basename "$release_file")"
    printf -- '- [%s](https://github.com/%s/releases/download/%s/%s)\n' \
      "$release_name" \
      "$repo" \
      "$tag" \
      "$release_name"
  done
  printf -- "- [SHA256SUMS.txt](https://github.com/%s/releases/download/%s/SHA256SUMS.txt)\n" "$repo" "$tag"
  printf -- "- [release-metadata.json](https://github.com/%s/releases/download/%s/release-metadata.json)\n\n" "$repo" "$tag"
} >> "$notes_file"

gh api "repos/$repo/git/matching-refs/tags/$tag" > "$tmpdir/tags.json"
existing_tag="$(python3 - "$tmpdir/tags.json" "$tag" <<'PY'
import json
import sys
from pathlib import Path

print("yes" if any(ref["ref"] == "refs/tags/" + sys.argv[2]
                   for ref in json.loads(Path(sys.argv[1]).read_text())) else "no")
PY
)"
if [[ "$existing_tag" == "yes" ]]; then
  tag_sha="$(gh api "repos/$repo/commits/$tag" --jq .sha)"
  if [[ "$tag_sha" != "$source_sha" ]]; then
    echo "ERROR: Existing tag '$tag' does not resolve to candidate commit '$source_sha'." >&2
    exit 1
  fi
fi

if gh release view "$tag" --repo "$repo" --json isDraft > "$tmpdir/release.json" 2>/dev/null; then
  python3 - "$tmpdir/release.json" <<'PY'
import json
import sys
from pathlib import Path

if json.loads(Path(sys.argv[1]).read_text()).get("isDraft") is not True:
    raise SystemExit("ERROR: Published releases cannot be replaced; prepare a new release version.")
PY
  log "Updating existing release $repo@$tag"
  gh release edit "$tag" --repo "$repo" --target "$source_sha" --title "$title" --notes-file "$notes_file"
else
  log "Creating draft release $repo@$tag"
  gh release create "$tag" --repo "$repo" --target "$source_sha" --draft --title "$title" --notes-file "$notes_file"
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
