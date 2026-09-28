#!/usr/bin/env bash
# Prove that a `tauri build` output ships the GeoLibre CLI sidecar beside the
# Canopi executable, in the layout the installed app sees, by unpacking every
# package of one target and running the packaged `geolibre version`.
#
#   scripts/smoke-bundled-sidecar.sh <target-triple> [<bundle dir>]
#
# Linux: every .deb (dpkg-deb -x, sidecar at usr/bin/) and every .AppImage
# (--appimage-extract, no FUSE needed). macOS: every .app under bundle/macos
# (Contents/MacOS/). Windows: every NSIS installer under bundle/nsis, unpacked
# with 7-Zip (the sidecar sits beside Canopi.exe at the install root); the .msi
# is not unpacked here. Any target without a package to check fails.
set -euo pipefail

triple=${1:?target triple}
root=$(cd "$(dirname "$0")/.." && pwd)
bundle=${2:-$root/target/$triple/release/bundle}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
checked=0

run_sidecar() {
  local sidecar=$1
  if [ ! -f "$sidecar" ]; then
    echo "missing sidecar: $sidecar" >&2
    exit 1
  fi
  local dir
  dir=$(dirname "$sidecar")
  # The application executable must be beside it: that is where discovery
  # looks. Linux packages name it after the crate (canopi-desktop), macOS and
  # Windows after the product (Canopi, Canopi.exe).
  local app
  app=$(find "$dir" -maxdepth 1 -type f \( -iname 'canopi' -o -iname 'canopi-desktop' -o -iname 'canopi.exe' -o -iname 'canopi-desktop.exe' \) | head -n 1)
  if [ -z "$app" ]; then
    echo "no Canopi executable beside $sidecar" >&2
    ls -l "$dir" >&2
    exit 1
  fi
  chmod +x "$sidecar" 2>/dev/null || true
  local version
  version=$("$sidecar" version)
  echo "$sidecar -> $version (beside $(basename "$app"))"
  checked=$((checked + 1))
}

case "$triple" in
  *linux*)
    for deb in "$bundle"/deb/*.deb; do
      [ -e "$deb" ] || continue
      out="$scratch/deb-$(basename "$deb" .deb)"
      dpkg-deb -x "$deb" "$out"
      run_sidecar "$out/usr/bin/geolibre"
    done
    for appimage in "$bundle"/appimage/*.AppImage; do
      [ -e "$appimage" ] || continue
      out="$scratch/appimage-$(basename "$appimage" .AppImage)"
      mkdir -p "$out"
      chmod +x "$appimage"
      (cd "$out" && "$appimage" --appimage-extract >/dev/null)
      run_sidecar "$out/squashfs-root/usr/bin/geolibre"
    done
    ;;
  *darwin*)
    for app in "$bundle"/macos/*.app; do
      [ -e "$app" ] || continue
      run_sidecar "$app/Contents/MacOS/geolibre"
    done
    ;;
  *windows*)
    for installer in "$bundle"/nsis/*-setup.exe; do
      [ -e "$installer" ] || continue
      out="$scratch/nsis-$(basename "$installer" .exe)"
      7z x -y -o"$out" "$installer" >/dev/null
      run_sidecar "$out/geolibre.exe"
    done
    ;;
  *)
    echo "unknown target: $triple" >&2
    exit 1
    ;;
esac

if [ "$checked" -eq 0 ]; then
  echo "no package under $bundle carried a sidecar to check" >&2
  exit 1
fi
echo "sidecar verified in $checked package(s) for $triple"
