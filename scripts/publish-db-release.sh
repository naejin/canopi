#!/usr/bin/env bash

set -euo pipefail

log() {
  printf '[publish-db] %s\n' "$*"
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
  scripts/publish-db-release.sh --export-path PATH [options]

Options:
  --export-path PATH   Source canopi-data export database (required)
  --output-path PATH   Temporary output path for generated DB
  --tag TAG            GitHub release tag to upload to (default: canopi-core-db)
  --repo OWNER/REPO    GitHub repository (default: detected from git remote)
EOF
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

require_cmd gh
require_cmd python3
require_cmd sha256sum

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

export_path=""
output_path=""
tag="canopi-core-db"
repo="$(detect_repo || true)"
tmpdir=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --export-path)
      export_path="$2"
      shift 2
      ;;
    --output-path)
      output_path="$2"
      shift 2
      ;;
    --tag)
      tag="$2"
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

if [[ -z "$export_path" ]]; then
  echo "ERROR: --export-path is required." >&2
  usage >&2
  exit 1
fi

if [[ -z "$repo" ]]; then
  echo "ERROR: --repo is required when the GitHub repository cannot be detected from git remote.origin.url." >&2
  exit 1
fi

python3 scripts/species_catalog_contract.py check
expected_schema_version="$(python3 scripts/species_catalog_contract.py value prepared-schema-version)"
asset_name="$(python3 scripts/species_catalog_contract.py value prepared-db-asset-name)"

tmpdir="$(mktemp -d)"
trap '[[ -n "$tmpdir" ]] && rm -rf "$tmpdir"' EXIT
upload_dir="$tmpdir/upload"
mkdir -p "$upload_dir"
upload_path="$upload_dir/$asset_name"
checksum_path="$upload_dir/${asset_name}.sha256"
if [[ -z "$output_path" ]]; then
  output_path="$tmpdir/prepared.db"
fi

log "Building bundled DB from export: $export_path"
log "Target release: $repo@$tag"
python3 scripts/prepare-db.py --export-path "$export_path" --output-path "$output_path"

if [[ ! -s "$output_path" ]]; then
  echo "ERROR: Generated DB is missing or empty: $output_path" >&2
  exit 1
fi

python3 scripts/species_catalog_contract.py verify-db --profile prepared "$output_path"
python3 scripts/species_catalog_contract.py verify-source-export "$export_path"
python3 scripts/species_catalog_contract.py check
publication_asset_name="$(python3 scripts/species_catalog_contract.py value prepared-db-asset-name)"
if [[ "$publication_asset_name" != "$asset_name" ]]; then
  echo "ERROR: Species Catalog release identity changed during preparation: expected $asset_name, observed $publication_asset_name" >&2
  exit 1
fi

if [[ "$output_path" != "$upload_path" ]] && ! ln "$output_path" "$upload_path" 2>/dev/null; then
  cp "$output_path" "$upload_path"
fi
db_sha256="$(sha256sum "$upload_path" | awk '{print $1}')"
printf '%s  %s\n' "$db_sha256" "$asset_name" > "$checksum_path"

log "Checking GitHub release tag exists: $tag"
gh release view "$tag" --repo "$repo" >/dev/null

log "Uploading DB asset and checksum"
gh release upload "$tag" \
  "$upload_path" \
  "$checksum_path" \
  --repo "$repo"

log "Published $asset_name to $repo@$tag"
log "Schema version: $expected_schema_version"
log "SHA256: $db_sha256"
