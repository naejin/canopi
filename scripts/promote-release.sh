#!/usr/bin/env bash

set -euo pipefail

readonly STABLE_MANIFEST_TAG="${CANOPI_STABLE_MANIFEST_TAG:-canopi-stable-manifest}"
readonly BETA_MANIFEST_TAG="${CANOPI_BETA_MANIFEST_TAG:-canopi-beta-manifest}"

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
  scripts/promote-release.sh --run-id ID --channel beta|stable --tag TAG --title TITLE [options]

Options:
  --run-id ID         GitHub Actions run ID for the release-candidate workflow (required)
  --channel CHANNEL   Promotion channel: beta or stable (required)
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
channel=""
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
    --channel)
      channel="$2"
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

if [[ -z "$run_id" || -z "$channel" || -z "$tag" || -z "$title" ]]; then
  echo "ERROR: --run-id, --channel, --tag, and --title are required." >&2
  usage >&2
  exit 1
fi

if [[ "$channel" != "beta" && "$channel" != "stable" ]]; then
  echo "ERROR: --channel must be 'beta' or 'stable' (received '$channel')." >&2
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
import sys

payload = json.loads(os.environ["ARTIFACT_JSON"])
latest_by_name = {}
duplicates = set()

for artifact in payload.get("artifacts", []):
    if artifact.get("expired"):
        continue
    name = artifact["name"]
    current = latest_by_name.get(name)
    if current is not None:
        duplicates.add(name)
    if current is None or artifact.get("updated_at", "") > current.get("updated_at", ""):
        latest_by_name[name] = artifact

for name in sorted(duplicates):
    print(
        f"WARNING: multiple artifacts named '{name}' found for this run; selecting the most recently updated copy.",
        file=sys.stderr,
    )

for name in sorted(latest_by_name):
    artifact = latest_by_name[name]
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
latest_json_path="$manifest_dir/latest.json"

if [[ ! -f "$manifest_path" || ! -f "$metadata_path" || ! -f "$latest_json_path" ]]; then
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
    -name '*.AppImage' -o \
    -name '*.AppImage.sig' -o \
    -name '*.app.tar.gz' -o \
    -name '*.app.tar.gz.sig' -o \
    -name '*.dmg' -o \
    -name '*.msi' -o \
    -name '*.msi.sig' -o \
    -name '*.exe' -o \
    -name '*.exe.sig' \
  \) | sort
)

if [[ "${#release_files[@]}" -eq 0 ]]; then
  echo "ERROR: No packaged release artifacts were downloaded from run $run_id." >&2
  exit 1
fi

upload_dir="$tmpdir/release-upload"
mkdir -p "$upload_dir"

mapfile -t release_upload_map < <(
  python3 - "$metadata_path" "$upload_dir" "${release_files[@]}" <<'PY'
import json
import sys
from pathlib import Path

from scripts.release_asset_name import canonical_asset_name

metadata = json.loads(Path(sys.argv[1]).read_text())
upload_dir = Path(sys.argv[2])
version = metadata["release_version"]
seen = set()

for artifact_path in sys.argv[3:]:
    canonical_name = canonical_asset_name(version, artifact_path)
    if canonical_name in seen:
        raise SystemExit(f"Duplicate canonical release asset name computed: {canonical_name}")
    seen.add(canonical_name)
    print(f"{artifact_path}\t{upload_dir / canonical_name}")
PY
)

release_upload_paths=()
for upload_entry in "${release_upload_map[@]}"; do
  src_path="${upload_entry%%$'\t'*}"
  dst_path="${upload_entry#*$'\t'}"
  rm -f "$dst_path"
  if ! ln "$src_path" "$dst_path" 2>/dev/null; then
    cp "$src_path" "$dst_path"
  fi
  release_upload_paths+=("$dst_path")
done

read -r metadata_release_version metadata_release_tag metadata_head_sha < <(
  python3 - "$metadata_path" <<'PY'
import json
import sys
from pathlib import Path

metadata = json.loads(Path(sys.argv[1]).read_text())
version = metadata["release_version"]
release_tag = metadata.get("release_tag", f"v{version}")
head_sha = metadata["head_sha"]
print(version, release_tag, head_sha)
PY
)

if [[ "$tag" != "$metadata_release_tag" ]]; then
  echo "ERROR: Tag '$tag' does not match manifest tag '$metadata_release_tag' from release metadata." >&2
  echo "ERROR: Re-run with --tag '$metadata_release_tag' or regenerate the release-candidate artifacts." >&2
  exit 1
fi

notes_file="$tmpdir/release-notes.md"
python3 - "$metadata_path" "$run_id" "$channel" "$STABLE_MANIFEST_TAG" "$BETA_MANIFEST_TAG" <<'PY' > "$notes_file"
import json
import sys
from pathlib import Path

metadata = json.loads(Path(sys.argv[1]).read_text())
run_id = sys.argv[2]
channel = sys.argv[3]
stable_manifest_tag = sys.argv[4]
beta_manifest_tag = sys.argv[5]

print("Release candidate promoted from GitHub Actions artifacts.")
print()
print(f"- Promotion channel: {channel}")
print(f"- Source run: {run_id}")
print(f"- Source ref: {metadata['ref']}")
print(f"- Source commit: {metadata['head_sha']}")
print(f"- App version: {metadata['release_version']}")
print(f"- Bundled DB: {metadata['db_asset_name']} from tag {metadata['db_release_tag']}")
print(f"- Bundled DB sha256: {metadata['db_sha256']}")
print(f"- Expected DB schema version: {metadata['expected_db_schema_version']}")
print(f"- Stable manifest tag: {stable_manifest_tag}")
print(f"- Beta manifest tag: {beta_manifest_tag}")
print()
print("Promoted artifacts were checksum-verified before upload.")
PY

release_prerelease="false"
release_latest="true"
if [[ "$channel" == "beta" ]]; then
  release_prerelease="true"
  release_latest="false"
fi

update_existing_release() {
  local release_tag="$1"
  local release_title="$2"
  local release_notes_path="$3"
  local prerelease="$4"
  local latest="$5"

  local release_id
  release_id="$(gh api "repos/$repo/releases/tags/$release_tag" --jq '.id')"

  gh api \
    --method PATCH \
    "repos/$repo/releases/$release_id" \
    --raw-field "tag_name=$release_tag" \
    --raw-field "name=$release_title" \
    --raw-field "body=$(<"$release_notes_path")" \
    -F draft=false \
    -F "prerelease=$prerelease" \
    -F "make_latest=$latest" \
    >/dev/null
}

assert_existing_release_matches() {
  local release_tag="$1"
  local expected_metadata_path="$2"
  local existing_dir="$tmpdir/existing-release-$release_tag"
  local existing_metadata_path="$existing_dir/release-metadata.json"

  rm -rf "$existing_dir"
  mkdir -p "$existing_dir"

  if ! gh release download "$release_tag" \
    --repo "$repo" \
    --pattern "release-metadata.json" \
    --dir "$existing_dir" \
    >/dev/null 2>&1; then
    local asset_count
    asset_count="$(gh api "repos/$repo/releases/tags/$release_tag" --jq '.assets | length')"
    if [[ "$asset_count" == "0" ]]; then
      log "Existing release '$release_tag' has no assets or release-metadata.json; treating it as an interrupted empty release."
      return
    fi
    echo "ERROR: Existing release '$release_tag' is missing release-metadata.json; refusing to mutate a versioned release without provenance." >&2
    exit 1
  fi

  python3 - "$expected_metadata_path" "$existing_metadata_path" "$release_tag" <<'PY'
import json
import sys
from pathlib import Path

expected = json.loads(Path(sys.argv[1]).read_text())
existing = json.loads(Path(sys.argv[2]).read_text())
release_tag = sys.argv[3]

fields = (
    "release_version",
    "release_tag",
    "head_sha",
    "db_release_tag",
    "db_asset_name",
    "db_sha256",
    "expected_db_schema_version",
)

mismatches = [
    field
    for field in fields
    if existing.get(field) != expected.get(field)
]

if mismatches:
    mismatch_summary = ", ".join(
        f"{field}: existing={existing.get(field)!r}, expected={expected.get(field)!r}"
        for field in mismatches
    )
    raise SystemExit(
        f"ERROR: Existing release {release_tag} does not match the incoming release metadata ({mismatch_summary}). "
        "Refusing to overwrite versioned release assets."
    )
PY
}

upsert_release() {
  local release_tag="$1"
  local release_title="$2"
  local release_notes_path="$3"
  local prerelease="$4"
  local latest="$5"
  local target_commit="${6:-}"
  local enforce_metadata_match="${7:-false}"

  if gh release view "$release_tag" --repo "$repo" >/dev/null 2>&1; then
    log "Updating existing release $repo@$release_tag"
    if [[ "$enforce_metadata_match" == "true" ]]; then
      assert_existing_release_matches "$release_tag" "$metadata_path"
    fi
    update_existing_release "$release_tag" "$release_title" "$release_notes_path" "$prerelease" "$latest"
    return
  fi

  log "Creating release $repo@$release_tag"
  create_args=(
    release create "$release_tag"
    --repo "$repo"
    --title "$release_title"
    --notes-file "$release_notes_path"
    --latest="$latest"
  )
  if [[ -n "$target_commit" ]]; then
    create_args+=(--target "$target_commit")
  fi
  if [[ "$prerelease" == "true" ]]; then
    create_args+=(--prerelease)
  fi
  gh "${create_args[@]}"
}

upsert_release "$tag" "$title" "$notes_file" "$release_prerelease" "$release_latest" "$metadata_head_sha" "true"

log "Uploading packaged artifacts and manifest"
gh release upload "$tag" \
  "${release_upload_paths[@]}" \
  "$manifest_path#SHA256SUMS.txt" \
  "$latest_json_path#latest.json" \
  "$metadata_path#release-metadata.json" \
  --repo "$repo" \
  --clobber

upsert_manifest_release() {
  local manifest_tag="$1"
  local manifest_title="$2"
  local source_channel="$3"

  local manifest_notes_path="$tmpdir/${manifest_tag}-notes.md"
  local manifest_metadata_path="$tmpdir/${manifest_tag}-release-metadata.json"

  python3 - "$manifest_notes_path" "$manifest_tag" "$manifest_title" "$source_channel" "$tag" "$run_id" "$metadata_head_sha" <<'PY'
import sys
from datetime import datetime, timezone
from pathlib import Path

notes_path = Path(sys.argv[1])
manifest_tag = sys.argv[2]
manifest_title = sys.argv[3]
source_channel = sys.argv[4]
source_tag = sys.argv[5]
run_id = sys.argv[6]
head_sha = sys.argv[7]

notes_path.write_text(
    "\n".join(
        [
            manifest_title,
            "",
            "Moving updater-manifest release tag used by in-app update checks.",
            "",
            f"- Manifest tag: {manifest_tag}",
            f"- Source release tag: {source_tag}",
            f"- Source promotion channel: {source_channel}",
            f"- Source workflow run: {run_id}",
            f"- Source commit: {head_sha}",
            f"- Updated at (UTC): {datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')}",
        ]
    )
    + "\n"
)
PY

  python3 - "$manifest_metadata_path" "$metadata_path" "$manifest_tag" "$source_channel" "$tag" "$run_id" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

out_path = Path(sys.argv[1])
metadata_path = Path(sys.argv[2])
manifest_tag = sys.argv[3]
source_channel = sys.argv[4]
source_release_tag = sys.argv[5]
run_id = sys.argv[6]

metadata = json.loads(metadata_path.read_text())
manifest_metadata = {
    "manifest_tag": manifest_tag,
    "source_channel": source_channel,
    "source_release_tag": source_release_tag,
    "source_release_version": metadata["release_version"],
    "source_run_id": run_id,
    "source_ref": metadata["ref"],
    "source_head_sha": metadata["head_sha"],
    "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
}
out_path.write_text(json.dumps(manifest_metadata, indent=2) + "\n")
PY

  upsert_release "$manifest_tag" "$manifest_title" "$manifest_notes_path" "false" "false" "$metadata_head_sha"

  gh release upload "$manifest_tag" \
    "$latest_json_path#latest.json" \
    "$manifest_metadata_path#release-metadata.json" \
    --repo "$repo" \
    --clobber
}

if [[ "$channel" == "beta" ]]; then
  upsert_manifest_release "$BETA_MANIFEST_TAG" "Canopi Beta Channel Manifest" "beta"
else
  upsert_manifest_release "$STABLE_MANIFEST_TAG" "Canopi Stable Channel Manifest" "stable"
  # Keep beta users on the accepted stable build until a newer beta is promoted.
  upsert_manifest_release "$BETA_MANIFEST_TAG" "Canopi Beta Channel Manifest" "stable"
fi

log "Promoted run $run_id to release $repo@$tag for channel '$channel'"
log "Release metadata version: $metadata_release_version"
log "Uploaded ${#release_files[@]} packaged artifacts plus checksum and updater manifests."
