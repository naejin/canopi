#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ICON="$ROOT_DIR/desktop/web/src/assets/canopi-logo.svg"
OUTPUT_DIR="$ROOT_DIR/desktop/icons"

usage() {
  cat <<'EOF'
Usage: scripts/generate-desktop-icons.sh [--source path] [--output-dir path]

Regenerates the desktop icon set from the canonical SVG source.
Requires:
  - ImageMagick's `convert`
  - python3 with Pillow installed
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      SOURCE_ICON="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
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

if ! command -v convert >/dev/null 2>&1; then
  echo "Missing required dependency: convert" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Missing required dependency: python3" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

python3 - <<'PY' >/dev/null 2>&1 || {
from PIL import Image  # noqa: F401
PY
  echo "Missing required python dependency: Pillow" >&2
  exit 1
}

mkdir -p "$OUTPUT_DIR"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

MASTER_PNG="$TMP_DIR/master.png"
echo "Rasterizing source icon from $SOURCE_ICON"
convert -background none "$SOURCE_ICON" -resize 1024x1024 -gravity center -extent 1024x1024 "$MASTER_PNG"

echo "Writing PNG, ICO, and ICNS assets into $OUTPUT_DIR"
python3 - "$MASTER_PNG" "$OUTPUT_DIR" <<'PY'
from pathlib import Path
import sys

from PIL import Image

master_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
img = Image.open(master_path)

png_targets = {
    "32x32.png": 32,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "256x256.png": 256,
}

for filename, size in png_targets.items():
    frame = img.resize((size, size), Image.LANCZOS)
    frame.save(output_dir / filename)

img.save(
    output_dir / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
img.save(
    output_dir / "icon.icns",
    sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
)
PY

echo "Generated icon set:"
file "$OUTPUT_DIR"/32x32.png "$OUTPUT_DIR"/128x128.png "$OUTPUT_DIR"/128x128@2x.png "$OUTPUT_DIR"/256x256.png "$OUTPUT_DIR"/icon.ico "$OUTPUT_DIR"/icon.icns
