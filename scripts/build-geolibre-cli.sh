#!/usr/bin/env bash
# Build the pinned GeoLibre CLI that runs recipe-2 slope.
#
# The revision must equal GEOLIBRE_REVISION in
# desktop/src/services/lidar/geolibre.rs (a unit test checks it). The binary is
# written to desktop/binaries/geolibre-<host-triple>, the name Tauri uses for a
# bundled sidecar. For development, point CANOPI_GEOLIBRE_BIN at it.
set -euo pipefail

REVISION=aac2b743978666f3c3119b5c93de1b30963b1493
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SOURCE=${GEOLIBRE_RUST_SRC:-$ROOT/target/geolibre-rust}
TARGET_DIR=${GEOLIBRE_TARGET_DIR:-$ROOT/target/geolibre}

if [ ! -d "$SOURCE/.git" ]; then
  git clone --filter=blob:none https://github.com/opengeos/geolibre-rust.git "$SOURCE"
fi
git -C "$SOURCE" fetch --quiet origin "$REVISION" || true
git -C "$SOURCE" checkout --quiet --detach "$REVISION"

cargo build --locked --release -p geolibre-cli \
  --manifest-path "$SOURCE/Cargo.toml" --target-dir "$TARGET_DIR"

TRIPLE=$(rustc -vV | sed -n 's/^host: //p')
EXT=""
case "$TRIPLE" in *windows*) EXT=".exe" ;; esac
mkdir -p "$ROOT/desktop/binaries"
OUT="$ROOT/desktop/binaries/geolibre-$TRIPLE$EXT"
cp "$TARGET_DIR/release/geolibre$EXT" "$OUT"
echo "$("$OUT" version) built at $REVISION"
echo "export CANOPI_GEOLIBRE_BIN=$OUT"
