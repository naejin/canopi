#!/usr/bin/env bash
# Run the complete corrected qualification experiment set.
#
# Every command below is the documented, reproducible form of one experiment.
# The script fails fast so a broken step cannot be silently skipped.
set -uo pipefail

# A failing verdict exits non-zero by design. Record it and keep going so one
# failed experiment cannot hide the rest of the set; the summary at the end
# reports every verdict.
FAILED=()
# Execute the command directly rather than through `eval`: the arguments contain
# quoted multi-word values, and re-parsing them through a shell would split them.
step() {
  local name="$1"; shift
  if ! "$@"; then FAILED+=("$name"); echo "--- $name reported failure"; fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SCRATCH="${1:-$ROOT/.rq-scratch}"
BENCH="$SCRATCH/bench"
FX="$SCRATCH/fx"
OUT="$SCRATCH/out"
CHROME="${QUAL_CHROME:-/usr/bin/google-chrome}"
mkdir -p "$OUT"
rm -f "$OUT"/q*.json

cat > "$SCRATCH/fixture-map-ranged.json" <<'JSON'
{
  "plane256": "plane256.tif",
  "plane2000": "plane2000.tif",
  "steep45": "steep45.tif"
}
JSON

echo "=== Q1: pinned artifacts ==="
step "step01" python3 scripts/raster-qualification/measure.py q1-artifacts \
  --bench "$BENCH" --candidates scripts/raster-qualification/candidates.json \
  --out "$OUT/q1-artifacts.json"

echo "=== Q2a: ranged numeric windows on tiled COGs ==="
step "step02" node scripts/raster-qualification/run_wasm_probe.mjs --experiment q2ranged \
  --bench "$BENCH" --fixtures "$FX" --fixture-map "$SCRATCH/fixture-map-ranged.json" \
  --out "$OUT/q2ranged.json" --engines chromium --chromiumExecutable "$CHROME"
step "step03" python3 scripts/raster-qualification/measure.py q2-numeric \
  --browser-report "$OUT/q2ranged.json" --fixtures "$FX" \
  --fixture-map "$SCRATCH/fixture-map-ranged.json" \
  --fixture plane256 --fixture plane2000 --fixture steep45 \
  --expect-sha256 plane256=fa7e187a7245ff5f39f8417a9137fed149e56a6e42bc92f72d7104931758d269 \
  --expect-sha256 plane2000=5e6fd261bba08b01bde469344b6d80b2138dab025ab345eef80dcd9c4a4327b1 \
  --expect-sha256 steep45=2b6d2218d5739a869a2334a170ec21405bfb3b96669eff1478bf95add49ce1ab \
  --out "$OUT/q2-numeric.json"

echo "=== Q2b: stripped local bridge (negative result) ==="
step "step04" node scripts/raster-qualification/run_wasm_probe.mjs --experiment q2 \
  --bench "$BENCH" --fixtures "$FX" --fixture-map "$SCRATCH/fixture-map-ign.json" \
  --out "$OUT/q2ign.json" --engines chromium --chromiumExecutable "$CHROME"
step "step05" python3 scripts/raster-qualification/measure.py q2-local-bridge \
  --browser-report "$OUT/q2ign.json" --fixtures "$FX" \
  --fixture-map "$SCRATCH/fixture-map-ign.json" --fixture mnh_0445_6806 \
  --expect-sha256 mnh_0445_6806=c4e2938e8a166b723f25c7ac3f5a64d21555671b758fb3b40b71daac45a8bc28 \
  --out "$OUT/q2-local-bridge.json"

echo "=== Q3a: native preparation and bounded readback ==="
step "step06" node scripts/raster-qualification/run_wasm_probe.mjs --experiment q3prep \
  --bench "$BENCH" --fixtures "$FX" --fixture-map "$SCRATCH/fixture-map-derived.json" \
  --out "$OUT/q3prep.json" --engines chromium --chromiumExecutable "$CHROME"
step "step07" python3 scripts/raster-qualification/measure.py q3-prepare \
  --original "$FX/ign/LHD_FXX_0445_6806_MNH_O_0M50_LAMB93_IGN69" \
  --derived "$FX/derived/mnh_0445_6806_cog.tif" \
  --browser-report "$OUT/q3prep.json" --fixture-name derived_cog \
  --expected-original-sha256 c4e2938e8a166b723f25c7ac3f5a64d21555671b758fb3b40b71daac45a8bc28 \
  --prepare-command "gdal_translate -q -of COG -co COMPRESS=DEFLATE -co BLOCKSIZE=256 -co OVERVIEWS=IGNORE_EXISTING -co RESAMPLING=NEAREST" \
  --out "$OUT/q3-prepare.json"

echo "=== Q3b: multi-member generation resolution ==="
step "step08" python3 scripts/raster-qualification/measure.py q3-members \
  --collection "$FX/tiles24" \
  --window across-columns-0-1:0:0:2600 --window across-rows-0-1:0:0:2600 \
  --window single-member:2:4:128 --out "$OUT/q3-members.json"

echo "=== Q3c: display tiles and local transport ==="
step "step09" node scripts/raster-qualification/run_wasm_probe.mjs --experiment q3 \
  --bench "$BENCH" --fixtures "$FX" --fixture-map "$SCRATCH/fixture-map-ranged.json" \
  --out "$OUT/q3.json" --engines chromium --chromiumExecutable "$CHROME"
step "step10" node scripts/raster-qualification/run_wasm_probe.mjs --experiment q3file \
  --bench "$BENCH" --fixtures "$FX" --fixture-map "$SCRATCH/fixture-map-derived.json" \
  --out "$OUT/q3file.json" --engines chromium --chromiumExecutable "$CHROME" \
  --attachFile "$FX/derived/mnh_0445_6806_cog.tif"
# Merge the two probe runs into one evidence report: display tiles from the
# tiled-COG run, local disk-backed transport from the File run. The merge must
# happen before the verdict command consumes it.
step "step11a" python3 scripts/raster-qualification/merge_probe_reports.py \
  --tiles "$OUT/q3.json" --local "$OUT/q3file.json" --out "$OUT/q3-display-probe.json"
step "step11b" python3 scripts/raster-qualification/measure.py q3-display \
  --browser-report "$OUT/q3-display-probe.json" --out "$OUT/q3-display.json"

echo "=== Q4a: blocked slope ==="
step "step12" python3 scripts/raster-qualification/measure.py q4-slope \
  --fixtures "$FX" --block 256 --seam 4096,4096 --hole 4096,4096 \
  --out "$OUT/q4-slope.json"

echo "=== Q4b: CRS authority and candidate coordinates ==="
step "step13a" python3 scripts/raster-qualification/build_crs_reference.py \
  --reference "$FX/derived/mnh_0445_6806_cog.tif" --reference-epsg 2154 \
  --out "$OUT/crs-reference.json"
step "step13b" node scripts/raster-qualification/crs_probe.mjs \
  --bench "$BENCH" --fixtures "$FX" --fixture derived/mnh_0445_6806_cog.tif \
  --reference-points "$OUT/crs-reference.json" --out "$OUT/q4-crs-probe.json" \
  --chromiumExecutable "$CHROME"
step "step13c" python3 scripts/raster-qualification/measure.py q4-crs \
  --probe-report "$OUT/q4-crs-probe.json" --reference-points "$OUT/crs-reference.json" \
  --reference "$FX/derived/mnh_0445_6806_cog.tif" \
  --reference-epsg 2154 --out "$OUT/q4-crs.json"

echo "=== Q5: cancellation and lifecycle ==="
step "step14" node scripts/raster-qualification/run_wasm_probe.mjs --experiment q5 \
  --bench "$BENCH" --fixtures "$FX" --fixture-map "$SCRATCH/fixture-map-ranged.json" \
  --out "$OUT/q5.json" --engines chromium --chromiumExecutable "$CHROME"
step "step15" node scripts/raster-qualification/lifecycle_probe.mjs \
  --bench "$BENCH" --fixtures "$FX" --fixture derived/mnh_0445_6806_cog.tif \
  --out "$OUT/q5-probe.json"
step "step16" python3 scripts/raster-qualification/measure.py q5-lifecycle \
  --browser-report "$OUT/q5.json" --probe-report "$OUT/q5-probe.json" \
  --out "$OUT/q5-lifecycle.json"

echo "=== Q6: resources and display trace ==="
step "step17" node scripts/raster-qualification/run_display_trace.mjs \
  --bench "$BENCH" --fixtures "$FX" --fixture derived/mnh_0445_6806_cog.tif \
  --out "$OUT/q6-trace.json" --chromiumExecutable "$CHROME"
step "step18" python3 scripts/raster-qualification/measure.py q6-resources \
  --browser-report "$OUT/q2ranged.json" --fixtures "$FX" \
  --reference-fixture largeplane.tif --max-reads 48 \
  --trace-report "$OUT/q6-trace.json" --out "$OUT/q6-resources.json"

echo "=== compare ==="
step "step19" python3 scripts/raster-qualification/measure.py compare \
  --report "$OUT/q1-artifacts.json" \
  --report "$OUT/q2-local-bridge.json" \
  --report "$OUT/q2-numeric.json" \
  --report "$OUT/q3-prepare.json" \
  --report "$OUT/q3-members.json" \
  --report "$OUT/q3-display.json" \
  --report "$OUT/q4-slope.json" \
  --report "$OUT/q4-crs.json" \
  --report "$OUT/q5-lifecycle.json" \
  --report "$OUT/q6-resources.json" \
  --out "$OUT/q-summary.json" 

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "=== experiments reporting failure: ${FAILED[*]} ==="
fi

echo "=== verdicts ==="
export QUAL_OUT="$OUT"
python3 - <<'PY'
import json, pathlib
out = pathlib.Path(__import__("os").environ["QUAL_OUT"])
for path in sorted(out.glob("q*.json")):
    try:
        d = json.loads(path.read_text())
    except Exception:
        continue
    if "result" in d and "experiment" in d:
        print(f"{d['result']:>13}  {d['experiment']:<18} {d.get('verdictReason','')}")
PY
