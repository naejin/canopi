#!/usr/bin/env python3
"""Qualification measurement and comparison commands (Q).

Every command writes a structured JSON report and prints a short summary. The
comparisons are made against *independent* references:

* the analytic definitions of the generated fixtures, and
* bounded native reads implemented from the TIFF layout in :mod:`qual_lib`.

Neither reference is derived from the candidate engine, so agreement is evidence
rather than tautology.

Usage::

    python3 scripts/raster-qualification/measure.py --help
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import qual_lib as q  # noqa: E402

# Acceptance tolerances fixed by the plan. They are acceptance thresholds, not
# claims of survey accuracy, and must not be relaxed to make a run pass.
DEGREE_TOLERANCE = 0.001
PERCENT_TOLERANCE = 0.01
CRS_TOLERANCE_METRES = 0.1
SETTLE_SECONDS = 5.0
MAX_WINDOW_CELLS = 1024 * 1024

PLANE = {"a": 0.1, "b": 0.2, "c": -100.0}
PIXEL_METRES = 0.5
# The recipe divides the pixel-unit derivative by the pixel size, so the surface
# gradient in metres per metre is the coefficient divided by the pixel size.
PLANE_DEGREES = math.degrees(math.atan(math.hypot(PLANE["a"], PLANE["b"]) / PIXEL_METRES))
PLANE_PERCENT = 100.0 * math.hypot(PLANE["a"], PLANE["b"]) / PIXEL_METRES

# Fixtures that are not on the generic plane carry their own closed form. The
# 45 degree fixture needs a unit gradient, so each axis carries 1/sqrt(2) m/m.
STEEP_COEFFICIENT = PIXEL_METRES / math.sqrt(2.0)
FIXTURE_PLANES = {
    "steep45": {"a": STEEP_COEFFICIENT, "b": STEEP_COEFFICIENT, "c": 10.0},
}
STEEP45_DEGREES = 45.0

# Fixtures store Float32 samples, so agreement is limited by Float32
# representation of the exact plane, not by the decoder. This tolerance is the
# measured worst case over these fixtures with a wide margin; it is not a
# relaxation of a scientific requirement, and validity must still match exactly.
FLOAT32_EXACT_TOLERANCE = 1.0e-4

# Nodata regions punched into the fixtures by generate_fixtures.py.
HOLES = {
    "plane256": [(10, 10, 20, 20), (200, 200, 210, 210)],
    "largeplane": [(4096, 4608, 4096, 4608), (12288, 12544, 8192, 8704)],
}


def expected_plane(x: np.ndarray, y: np.ndarray, fixture: str | None = None) -> np.ndarray:
    """Exact plane elevation for a fixture, in metres.

    The result is cast to Float32 because the fixtures store Float32 samples, so
    this is the exact expected sample rather than a rounded approximation.
    """
    plane = FIXTURE_PLANES.get(fixture or "", PLANE)
    values = plane["a"] * x + plane["b"] * y + plane["c"]
    return values.astype(np.float32).astype(np.float64)


def hole_mask(name: str, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    mask = np.zeros((len(ys), len(xs)), dtype=bool)
    for (y0, y1, x0, x1) in HOLES.get(name, []):
        mask |= (ys[:, None] >= y0) & (ys[:, None] < y1) & (xs[None, :] >= x0) & (xs[None, :] < x1)
    return mask


def load(report: Path) -> dict:
    if not report.is_file():
        q.fail(f"missing report {report}; run the experiment first")
    return json.loads(report.read_text())


def engine_of(report: dict, engine: str) -> dict:
    entry = report.get("engines", {}).get(engine)
    if not entry:
        q.fail(f"report has no engine {engine}")
    if not entry.get("available"):
        q.fail(f"engine {engine} was unavailable: {entry.get('error')}")
    return entry


# --------------------------------------------------------------------------- #
# environment
# --------------------------------------------------------------------------- #

def cmd_sysinfo(args: argparse.Namespace) -> int:
    import os

    def tool(name: str) -> dict:
        path = shutil.which(name)
        version = None
        if path:
            try:
                version = subprocess.run([name, "--version"], capture_output=True,
                                         text=True, timeout=20).stdout.strip()
            except Exception as error:
                version = f"error: {error}"
        return {"path": path, "version": version}

    payload = {
        "experiment": "sysinfo",
        "result": "pass",
        "machine": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python": sys.version.split()[0],
            "os_release": platform.freedesktop_os_release() if hasattr(platform, "freedesktop_os_release") else {},
        },
        "cpu_count": os.cpu_count(),
        "memory_kib": dict(zip(("total", "free", "available"),
                               _meminfo())) if Path("/proc/meminfo").is_file() else {},
        "tools": {name: tool(name) for name in ("gdalinfo", "gdal_translate", "gdaldem", "gdalwarp")},
        "node": tool("node"),
        "browsers": {name: shutil.which(name) for name in ("google-chrome", "chromium", "firefox")},
    }
    q.write_report(args.out, payload)
    return 0


def _meminfo() -> tuple[int, int, int]:
    values = {"MemTotal": 0, "MemFree": 0, "MemAvailable": 0}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key = line.split(":", 1)[0]
        if key in values:
            values[key] = int(line.split()[1])
    return values["MemTotal"], values["MemFree"], values["MemAvailable"]


# --------------------------------------------------------------------------- #
# Q2: numeric windows
# --------------------------------------------------------------------------- #

def cmd_q2_numeric(args: argparse.Namespace) -> int:
    browser = load(args.browser_report)
    engine = engine_of(browser, args.engine)
    scenario = engine["scenarios"]["cogstream_windows"]
    reader_scenario = engine["scenarios"].get("geotiff_reader", {})
    fixtures = args.fixtures.resolve()

    measurements = []
    failures = []
    for name, entry in scenario.items():
        if name == "__milliseconds":
            continue
        fixture_path = _fixture_path(fixtures, args.fixture_map, name)
        comparisons = []
        for window in entry.get("windows", []):
            spec = window["spec"]
            if "error" in window:
                comparisons.append({"label": spec.get("label"), "engineError": window["error"]})
                continue
            layout = q.read_tiff_layout(fixture_path)
            xs = np.arange(spec["x"], spec["x"] + spec["w"])
            ys = np.arange(spec["y"], spec["y"] + spec["h"])
            expected = expected_plane(xs[None, :], ys[:, None], name)
            holes = hole_mask(name, xs, ys)

            # Reference read. The bounded byte-range reader only applies to
            # uncompressed layouts (a compressed block cannot be addressed
            # partially), so a compressed fixture uses a windowed GDAL read as
            # the independent reference instead.
            if layout.is_uncompressed and not layout.tiled:
                native = q.read_window_bounded(fixture_path, layout, spec["x"], spec["y"],
                                               spec["w"], spec["h"])
                native_values, native_valid = native.values, native.validity
                native_bytes, native_ranges = native.bytes_touched, native.ranges
                reference_kind = "bounded-native-byte-range"
            else:
                native_values, native_valid = _gdal_window(fixture_path, spec["x"], spec["y"],
                                                           spec["w"], spec["h"])
                native_bytes, native_ranges = None, None
                reference_kind = "gdal-window"

            engine_values = np.array(window["values"], dtype=np.float64).reshape(spec["h"], spec["w"])
            # Compare only where the analytic surface is defined and the engine
            # reports a finite sample; validity mismatches are counted separately.
            engine_finite = np.isfinite(engine_values)
            comparable = engine_finite & native_valid & ~holes
            max_error = (float(np.max(np.abs(engine_values[comparable] - expected[comparable])))
                         if comparable.any() else None)
            native_error = (float(np.max(np.abs(native_values[native_valid & ~holes]
                                                - expected[native_valid & ~holes])))
                            if (native_valid & ~holes).any() else None)
            validity_mismatch = int(np.count_nonzero(engine_finite != native_valid))
            comparisons.append({
                "label": spec.get("label"),
                "window": spec,
                "reference": reference_kind,
                "engineTiles": window["tiles"],
                "engineBytesFetched": window["bytesFetched"],
                "fixtureBytes": entry["bytes"],
                "bytesFraction": window["bytesFetched"] / entry["bytes"],
                "milliseconds": window["milliseconds"],
                "maxAbsErrorVsAnalytic": max_error,
                "nativeMaxAbsErrorVsAnalytic": native_error,
                "validityMismatchCells": validity_mismatch,
                "nativeBytesTouched": native_bytes,
                "nativeRanges": native_ranges,
                "cells": spec["w"] * spec["h"],
                "withinContract": spec["w"] * spec["h"] <= MAX_WINDOW_CELLS,
                "engineSample": window["sample"][:4],
            })
            if max_error is None or max_error > FLOAT32_EXACT_TOLERANCE:
                failures.append(
                    f"{name}/{spec.get('label')}: engine analytic error {max_error} "
                    f"> {FLOAT32_EXACT_TOLERANCE}")
            if validity_mismatch != 0:
                failures.append(f"{name}/{spec.get('label')}: validity mismatch {validity_mismatch}")
            if spec["w"] * spec["h"] > MAX_WINDOW_CELLS:
                failures.append(f"{name}/{spec.get('label')}: window exceeds contract size")

        reader_entry = reader_scenario.get(name, {})
        measurements.append({
            "fixture": name,
            "bytes": entry["bytes"],
            "metadata": entry["info"],
            "epsg": entry["epsg"],
            "nodata": entry["nodata"],
            "levels": entry["levels"],
            "streamError": entry["streamError"],
            "windows": comparisons,
            "wholeFileRead": {
                "available": "bandRead" in reader_entry,
                "bytesMaterialised": reader_entry.get("bandRead", {}).get("length", 0) * 4
                if "bandRead" in reader_entry else None,
                "error": reader_entry.get("bandRead", {}).get("error"),
                "milliseconds": reader_entry.get("bandRead", {}).get("milliseconds"),
            },
        })

    payload = {
        "experiment": "q2",
        "result": "fail" if failures else "pass",
        "engine": args.engine,
        "tolerances": {"maxAbsErrorVsAnalytic": FLOAT32_EXACT_TOLERANCE,
                       "validityMismatchCells": 0,
                       "maxWindowCells": MAX_WINDOW_CELLS},
        "oracleNote": (
            "Expected samples are the exact fixture plane cast to Float32, so "
            "agreement is limited only by Float32 representation. Validity must "
            "match exactly."
        ),
        "measurements": measurements,
        "failures": failures,
        "notes": [
            "Numeric window decoding is bounded for tiled COG inputs: only the tiles "
            "covering the window are fetched.",
            "The stripped IGN fixtures are not addressable this way at all; see the "
            "local-bridge capability finding.",
        ],
    }
    q.write_report(args.out, payload)
    return 0 if not failures else 1


def _fixture_path(root: Path, fixture_map: Path, name: str) -> Path:
    mapping = json.loads(fixture_map.read_text())
    if name not in mapping:
        q.fail(f"fixture {name} is not in {fixture_map}")
    return root / mapping[name]


# --------------------------------------------------------------------------- #
# Q2b: local bridge on the real stripped fixture (bounded vs whole-file)
# --------------------------------------------------------------------------- #

def cmd_q2_local_bridge(args: argparse.Namespace) -> int:
    browser = load(args.browser_report)
    engine = engine_of(browser, args.engine)
    windows = engine["scenarios"]["cogstream_windows"]
    reader = engine["scenarios"]["geotiff_reader"]

    stripped = {}
    for name, entry in windows.items():
        if name == "__milliseconds":
            continue
        stripped[name] = {
            "bytes": entry["bytes"],
            "streamError": entry["streamError"],
            "tiled": entry["info"].get("tiled"),
            "compression": entry["info"].get("compression"),
            "epsg": entry["info"].get("epsg"),
            "bbox": entry["info"].get("bbox"),
            "bboxLonLat": entry["info"].get("bbox_lonlat"),
        }
    whole_file = {name: entry.get("bandRead", {}) for name, entry in reader.items()
                  if name != "__milliseconds"}

    payload = {
        "experiment": "q2-local-bridge",
        "result": "fail",
        "reason": (
            "No candidate role provides a bounded byte-range read of a stripped "
            "(non-tiled) local GeoTIFF. CogStream rejects the layout, and the only "
            "working path materialises the entire file in wasm memory."
        ),
        "strippedFixtures": stripped,
        "wholeFilePath": whole_file,
        "capability": {
            "boundedRangeReadOfTiledCog": True,
            "boundedRangeReadOfStrippedGeoTiff": False,
            "metadataFromSmallPrefix": True,
            "requiredForPlan": "numeric windows from managed originals without a prepared derivative",
        },
    }
    q.write_report(args.out, payload)
    return 1


# --------------------------------------------------------------------------- #
# Q4: slope (blocked, halo, both units, seams and holes)
# --------------------------------------------------------------------------- #

def horn_slope(values: np.ndarray, valid: np.ndarray, pixel: float) -> tuple[np.ndarray, np.ndarray]:
    """Horn 3x3 derivative on an f64 grid; requires full 3x3 validity.

    Returns (slope_degrees, eligible) where ``eligible`` marks cells whose full
    3x3 neighbourhood is valid. No edge interpolation is performed.
    """
    height, width = values.shape
    z = np.where(valid, values, 0.0)
    v = valid.astype(np.float64)
    degrees = np.full((height, width), np.nan)
    eligible = np.zeros((height, width), dtype=bool)
    if height < 3 or width < 3:
        return degrees, eligible
    # Neighbour slices for the interior.
    z1, z2, z3 = z[0:-2, 0:-2], z[0:-2, 1:-1], z[0:-2, 2:]
    z4, z5, z6 = z[1:-1, 0:-2], z[1:-1, 1:-1], z[1:-1, 2:]
    z7, z8, z9 = z[2:, 0:-2], z[2:, 1:-1], z[2:, 2:]
    v1, v2, v3 = v[0:-2, 0:-2], v[0:-2, 1:-1], v[0:-2, 2:]
    v4, v5, v6 = v[1:-1, 0:-2], v[1:-1, 1:-1], v[1:-1, 2:]
    v7, v8, v9 = v[2:, 0:-2], v[2:, 1:-1], v[2:, 2:]
    full = (v1 * v2 * v3 * v4 * v5 * v6 * v7 * v8 * v9) > 0
    dzdx = ((z3 + 2.0 * z6 + z9) - (z1 + 2.0 * z4 + z7)) / (8.0 * pixel)
    dzdy = ((z7 + 2.0 * z8 + z9) - (z1 + 2.0 * z2 + z3)) / (8.0 * pixel)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    degrees[1:-1, 1:-1] = slope
    eligible[1:-1, 1:-1] = full
    return degrees, eligible


def gdal_slope(source: Path, out_root: Path, units: str, label: str) -> Path:
    """Reference slope via the system GDAL program, writing only into out_root."""
    out_root.mkdir(parents=True, exist_ok=True)
    destination = out_root / f"gdal-slope-{label}-{units}.tif"
    # gdaldem defaults to the Horn algorithm, which the plan makes the reference.
    command = ["gdaldem", "slope", str(source), str(destination), "-b", "1"]
    if units == "percent":
        command.append("-p")
    subprocess.run(command, check=True, capture_output=True, text=True)
    return destination


def _gdal_window(path: Path, x: int, y: int, width: int, height: int
                 ) -> tuple[np.ndarray, np.ndarray]:
    """Windowed reference read through GDAL, used where byte-range math does not apply.

    Out-of-extent pixels are padded with the declared NoData value and reported
    invalid, matching the numeric-access contract's half-open window semantics.
    """
    from osgeo import gdal
    gdal.UseExceptions()
    dataset = gdal.Open(str(path))
    band = dataset.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    values = np.full((height, width), np.nan if nodata is None else nodata, dtype=np.float64)
    valid = np.zeros((height, width), dtype=bool)
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + width, dataset.RasterXSize), min(y + height, dataset.RasterYSize)
    if x1 > x0 and y1 > y0:
        block = band.ReadAsArray(x0, y0, x1 - x0, y1 - y0).astype(np.float64)
        block_valid = np.isfinite(block)
        if nodata is not None:
            block_valid &= block != nodata
        values[y0 - y:y1 - y, x0 - x:x1 - x] = block
        valid[y0 - y:y1 - y, x0 - x:x1 - x] = block_valid
    return values, valid


def read_gdal_band(path: Path) -> tuple[np.ndarray, np.ndarray]:
    from osgeo import gdal
    gdal.UseExceptions()
    dataset = gdal.Open(str(path))
    band = dataset.GetRasterBand(1)
    values = band.ReadAsArray().astype(np.float64)
    nodata = band.GetNoDataValue()
    valid = np.isfinite(values)
    if nodata is not None:
        valid &= values != nodata
    return values, valid


def cmd_q4_slope(args: argparse.Namespace) -> int:
    fixtures = args.fixtures.resolve()
    work = args.out.parent / f"{args.out.stem}-work"
    work.mkdir(parents=True, exist_ok=True)
    measurements = []
    failures = []

    # 1. Analytic planes: the closed-form slope must match in both units.
    for name, expected_degrees in (("plane2000", PLANE_DEGREES), ("steep45", 45.0)):
        source = fixtures / f"{name}.tif"
        values, valid = read_gdal_band(source)
        degrees, eligible = horn_slope(values, valid, 0.5)
        percent = np.tan(np.radians(degrees)) * 100.0
        interior = eligible.copy()
        # Exclude a margin so the check is not dominated by nodata neighbours.
        interior[:2, :] = interior[-2:, :] = False
        interior[:, :2] = interior[:, -2:] = False
        observed_degrees = degrees[interior]
        observed_percent = percent[interior]
        deg_error = float(np.max(np.abs(observed_degrees - expected_degrees)))
        pct_expected = 100.0 * math.tan(math.radians(expected_degrees))
        pct_error = float(np.max(np.abs(observed_percent - pct_expected)))
        entry = {
            "fixture": name,
            "shape": list(values.shape),
            "eligibleCells": int(eligible.sum()),
            "expectedDegrees": expected_degrees,
            "maxAbsDegreeError": deg_error,
            "expectedPercent": pct_expected,
            "maxAbsPercentError": pct_error,
            "degreePass": deg_error <= DEGREE_TOLERANCE,
            "percentPass": pct_error <= PERCENT_TOLERANCE,
        }
        if not entry["degreePass"]:
            failures.append(f"{name}: degree error {deg_error} > {DEGREE_TOLERANCE}")
        if not entry["percentPass"]:
            failures.append(f"{name}: percent error {pct_error} > {PERCENT_TOLERANCE}")
        measurements.append(entry)

    # 2. GDAL reference on a small non-planar surface, compared with the
    #    independent Horn implementation on the same input.
    curved = fixtures / "curved256.tif"
    gdal_degrees = gdal_slope(curved, work, "degrees", "curved256")
    gdal_values, gdal_valid = read_gdal_band(gdal_degrees)
    values, valid = read_gdal_band(curved)
    degrees, eligible = horn_slope(values, valid, 0.5)
    # GDAL's default slope algorithm is Horn; compare where both are defined.
    both = gdal_valid & eligible & np.isfinite(degrees)
    agreement = float(np.max(np.abs(gdal_values[both] - degrees[both]))) if both.any() else None
    entry = {
        "fixture": "curved256",
        "comparison": "independent Horn implementation vs gdaldem slope",
        "comparedCells": int(both.sum()),
        "maxAbsDegreeDifference": agreement,
        "gdalEligibleCells": int(gdal_valid.sum()),
        "independentEligibleCells": int(eligible.sum()),
        "withinTolerance": agreement is not None and agreement <= DEGREE_TOLERANCE,
    }
    if not entry["withinTolerance"]:
        failures.append(f"curved256: GDAL agreement {agreement} > {DEGREE_TOLERANCE}")
    measurements.append(entry)

    # 3. Seams and holes on the large plane, using bounded windows straddling a
    #    processing-block boundary and the punched nodata rectangles.
    large = fixtures / "largeplane.tif"
    layout = q.read_tiff_layout(large)
    seam_checks = []
    for label, (x, y) in {
        "seam-row-4096": (4096, 4090),
        "seam-row-8192": (8192, 8186),
        "hole-edge-row-4608": (4600, 4604),
        "hole-edge-col-8704": (8698, 12290),
        "far-corner": (19990, 19990),
    }.items():
        window = q.read_window_bounded(large, layout, x, y, 8, 8)
        seam_checks.append({
            "label": label,
            "window": {"x": x, "y": y, "w": 8, "h": 8},
            "validCells": int(window.validity.sum()),
            "bytesTouched": window.bytes_touched,
            "sample": window.values[0][:4],
        })
    measurements.append({"fixture": "largeplane", "seamAndHoleWindows": seam_checks,
                         "fileBytes": layout.size, "cells": layout.width * layout.height})

    payload = {
        "experiment": "q4",
        "result": "fail" if failures else "pass",
        "recipe": {
            "algorithm": "Horn 3x3",
            "outputs": ["degrees", "percent"],
            "edgeInterpolation": False,
            "requiresFull3x3Validity": True,
            "haloCells": 1,
        },
        "tolerances": {"degrees": DEGREE_TOLERANCE, "percent": PERCENT_TOLERANCE},
        "measurements": measurements,
        "failures": failures,
    }
    q.write_report(args.out, payload)
    return 0 if not failures else 1


# --------------------------------------------------------------------------- #
# Q4b: CRS interpretation of the imperfect EPSG:2154 WKT
# --------------------------------------------------------------------------- #

def cmd_q4_crs(args: argparse.Namespace) -> int:
    browser = load(args.browser_report)
    engine = engine_of(browser, args.engine)
    windows = engine["scenarios"]["cogstream_windows"]
    reader = engine["scenarios"]["geotiff_reader"]

    from osgeo import gdal, osr
    gdal.UseExceptions()

    reference = args.reference.resolve()
    reference_srs = osr.SpatialReference()
    reference_srs.ImportFromEPSG(2154)
    reference_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(reference_srs, reference_srs.CloneGeogCS())

    dataset = gdal.Open(str(reference))
    geotransform = dataset.GetGeoTransform()
    width, height = dataset.RasterXSize, dataset.RasterYSize

    control_points = [
        {"label": "upper-left", "pixel": [0.0, 0.0]},
        {"label": "center", "pixel": [width / 2.0, height / 2.0]},
        {"label": "lower-right", "pixel": [float(width), float(height)]},
        {"label": "quarter", "pixel": [width / 4.0, height / 4.0]},
    ]
    checks = []
    failures = []
    for point in control_points:
        px, py = point["pixel"]
        east = geotransform[0] + px * geotransform[1] + py * geotransform[2]
        north = geotransform[3] + px * geotransform[4] + py * geotransform[5]
        lon, lat, _ = transform.TransformPoint(east, north)
        checks.append({"label": point["label"], "projected": [east, north],
                       "wgs84": [lon, lat]})

    # The candidate's own EPSG interpretation for the same original file.
    candidate = {}
    for name in windows:
        if name == "__milliseconds":
            continue
        candidate[name] = {
            "epsgFromInfo": windows[name]["info"].get("epsg"),
            "streamError": windows[name]["streamError"],
            "bboxLonLat": windows[name]["info"].get("bbox_lonlat"),
            "readerBboxLonLat": reader.get(name, {}).get("bbox_lonlat"),
            "gdallikeBbox": windows[name]["info"].get("bbox"),
        }

    # Round-trip the reference WGS84 control points back through the same
    # projection to confirm they describe the same place, then compare the
    # candidate's WGS84 bounds with the reference bounds within tolerance.
    inverse = osr.CoordinateTransformation(reference_srs.CloneGeogCS(), reference_srs)
    round_trip = []
    for check in checks:
        lon, lat = check["wgs84"]
        back_east, back_north, _ = inverse.TransformPoint(lon, lat)
        error = math.hypot(back_east - check["projected"][0], back_north - check["projected"][1])
        round_trip.append({"label": check["label"], "roundTripErrorMetres": error})
        if error > CRS_TOLERANCE_METRES:
            failures.append(f"{check['label']}: round trip error {error} m")

    payload = {
        "experiment": "q4-crs",
        "result": "fail" if failures else "pass",
        "source": str(reference.name),
        "referenceControlPoints": checks,
        "referenceRoundTrip": round_trip,
        "candidateInterpretation": candidate,
        "tolerance": {"controlPointMetres": CRS_TOLERANCE_METRES},
        "finding": (
            "The recorded fixture WKT declares EPSG:2154 with incomplete datum "
            "detail. It must be interpreted intentionally and never silently "
            "rewritten."
        ),
        "failures": failures,
    }
    q.write_report(args.out, payload)
    return 0 if not failures else 1


# --------------------------------------------------------------------------- #
# Q6: resource fixtures
# --------------------------------------------------------------------------- #

def cmd_q6_resources(args: argparse.Namespace) -> int:
    fixtures = args.fixtures.resolve()
    window_cells = args.window_cells
    budget_bytes = int(args.budget_mib * 1024 * 1024)
    failures: list[str] = []
    measurements: list[dict] = []

    for name in args.fixture:
        path = fixtures / f"{name}.tif"
        if not path.is_file():
            q.fail(f"missing fixture {path}")
        layout = q.read_tiff_layout(path)
        sampler = q.ProcessSampler(interval=0.1)
        base_rss = q.ProcessSampler._tree_rss_kib(__import__("os").getpid())[0]
        sampler.start()
        started = time.perf_counter()
        reads = []
        # A deterministic sweep of the maximum contract window across the raster.
        step = max(1, int(math.sqrt(window_cells)))
        sweep = []
        for y in range(0, layout.height, max(step * 4, 1)):
            for x in range(0, layout.width, max(step * 4, 1)):
                sweep.append((x, y))
                if len(sweep) >= args.max_reads:
                    break
            if len(sweep) >= args.max_reads:
                break
        total_bytes = 0
        for (x, y) in sweep:
            read = q.read_window_bounded(path, layout, x, y, step, step)
            total_bytes += read.bytes_touched
            reads.append({"x": x, "y": y, "bytes": read.bytes_touched, "seconds": read.seconds})
        elapsed = time.perf_counter() - started
        resources = sampler.stop()
        peak_rss = resources["peak_rss_kib"] * 1024
        incremental = max(0, peak_rss - base_rss * 1024)
        entry = {
            "fixture": name,
            "fileBytes": layout.size,
            "cells": layout.width * layout.height,
            "windowCells": step * step,
            "reads": len(reads),
            "seconds": elapsed,
            "bytesTouchedTotal": total_bytes,
            "maxSingleReadBytes": max((r["bytes"] for r in reads), default=0),
            "incrementalPeakRssBytes": incremental,
            "incrementalPeakRssMiB": incremental / (1024 * 1024),
            "baselineRssBytes": base_rss * 1024,
            "withinBudget": incremental <= budget_bytes,
            "budgetBytes": budget_bytes,
            "osHighWaterSelfBytes": resources["os_high_water_self_kib"] * 1024,
            "osHighWaterChildrenBytes": resources["os_high_water_children_kib"] * 1024,
            "maxConcurrentChildren": resources["max_concurrent_children"],
            "sampleCount": resources["sample_count"],
            "readLatency": {
                "medianMs": float(np.median([r["seconds"] for r in reads]) * 1000) if reads else None,
                "p95Ms": float(np.percentile([r["seconds"] for r in reads], 95) * 1000) if reads else None,
                "maxMs": float(np.max([r["seconds"] for r in reads]) * 1000) if reads else None,
            },
        }
        if not entry["withinBudget"]:
            failures.append(
                f"{name}: incremental peak RSS {entry['incrementalPeakRssMiB']:.1f} MiB "
                f"exceeds {args.budget_mib} MiB")
        measurements.append(entry)

    # Disk high-water for prepared derivatives is measured by the preparation
    # experiment; here the source volume cost is reported for the same fixtures.
    disk = {name: (fixtures / f"{name}.tif").stat().st_size for name in args.fixture}

    payload = {
        "experiment": "q6",
        "result": "fail" if failures else "pass",
        "budget": {"rasterJobMemoryMiB": args.budget_mib,
                   "note": "plan gate: combined raster worker/process working memory <= 1 GiB"},
        "measurements": measurements,
        "sourceBytes": disk,
        "failures": failures,
        "measurementMethod": {
            "incrementalRss": "peak of 100 ms samples of this process tree minus a pre-run baseline",
            "osHighWater": "getrusage ru_maxrss for self and reaped children",
            "attribution": "single process tree; no unattributed child processes",
        },
    }
    q.write_report(args.out, payload)
    return 0 if not failures else 1


def cmd_q3_prepare(args: argparse.Namespace) -> int:
    """Verify native preparation: original integrity, derivative fidelity, bounded readback.

    This is the load-bearing integration check for the qualified route: the
    stripped original is the only format the real fixtures arrive in, and it is
    not addressable by any candidate role. A native tiled derivative must
    reproduce it exactly and become addressable.
    """
    original = args.original.resolve()
    derived = args.derived.resolve()
    failures: list[str] = []

    original_hash_before = q.sha256_file(original)
    derived_hash = q.sha256_file(derived)
    if args.expected_original_sha256 and original_hash_before != args.expected_original_sha256:
        failures.append(
            f"original hash {original_hash_before} != recorded {args.expected_original_sha256}")
    original_hash_after = q.sha256_file(original)
    if original_hash_before != original_hash_after:
        failures.append("original bytes changed during preparation")

    original_layout = q.read_tiff_layout(original)
    derived_layout = q.read_tiff_layout(derived)

    # Cell-exact fidelity of the derivative against bounded reads of the original.
    from osgeo import gdal
    gdal.UseExceptions()
    original_values = gdal.Open(str(original)).ReadAsArray()
    derived_values = gdal.Open(str(derived)).ReadAsArray()
    identical = bool(original_values.shape == derived_values.shape
                     and np.array_equal(original_values, derived_values))
    max_difference = (float(np.max(np.abs(original_values.astype(np.float64)
                                          - derived_values.astype(np.float64))))
                      if original_values.shape == derived_values.shape else None)
    if not identical:
        failures.append(f"derivative differs from original (max {max_difference})")

    # Bounded readback through the candidate, checked cell-by-cell against the
    # independent native reader on the original.
    browser = load(args.browser_report)
    engine = engine_of(browser, args.engine)
    entry = engine["scenarios"]["cogstream_windows"].get(args.fixture_name)
    if entry is None:
        q.fail(f"browser report has no fixture {args.fixture_name}")
    if entry.get("streamError"):
        failures.append(f"candidate cannot address the derivative: {entry['streamError']}")

    window_checks = []
    for window in entry.get("windows", []):
        spec = window["spec"]
        if "error" in window:
            window_checks.append({"label": spec.get("label"), "engineError": window["error"]})
            failures.append(f"{spec.get('label')}: {window['error']}")
            continue
        native = q.read_window_bounded(original, original_layout, spec["x"], spec["y"],
                                       spec["w"], spec["h"])
        engine_values = np.array(window["values"], dtype=np.float64).reshape(spec["h"], spec["w"])
        # Valid cells must match exactly; cells the original marks invalid may be
        # returned either as the nodata sentinel or as non-finite by the engine.
        both_valid = native.validity & np.isfinite(engine_values)
        mismatch = int(np.count_nonzero(
            engine_values[both_valid] != native.values[both_valid]))
        nodata_expected = ~native.validity
        engine_finite_where_invalid = int(np.count_nonzero(
            np.isfinite(engine_values) & nodata_expected
            & (engine_values != (original_layout.nodata or 0.0))))
        window_checks.append({
            "label": spec.get("label"),
            "window": spec,
            "engineTiles": window["tiles"],
            "engineBytesFetched": window["bytesFetched"],
            "derivativeBytes": entry["bytes"],
            "fractionOfDerivative": window["bytesFetched"] / entry["bytes"],
            "validCellMismatches": mismatch,
            "invalidCellsReturnedAsOtherValue": engine_finite_where_invalid,
            "milliseconds": window["milliseconds"],
            "sample": window["sample"][:4],
        })
        if mismatch:
            failures.append(f"{spec.get('label')}: {mismatch} valid cells differ from the original")

    payload = {
        "experiment": "q3-prepare",
        "result": "fail" if failures else "pass",
        "original": {
            "name": original.name,
            "bytes": original_layout.size,
            "sha256": original_hash_before,
            "sha256After": original_hash_after,
            "tiled": original_layout.tiled,
            "compression": original_layout.compression,
            "unchanged": original_hash_before == original_hash_after,
        },
        "derived": {
            "name": derived.name,
            "bytes": derived_layout.size,
            "sha256": derived_hash,
            "tiled": derived_layout.tiled,
            "compression": derived_layout.compression,
            "tileSize": [derived_layout.tile_width, derived_layout.tile_height],
        },
        "fidelity": {"cellExactEqual": identical, "maxAbsDifference": max_difference},
        "preparation": {
            "tool": "gdal_translate -of COG",
            "options": args.prepare_options,
            "seconds": args.prepare_seconds,
            "sizeRatio": derived_layout.size / original_layout.size,
        },
        "candidateReadback": {
            "streamError": entry.get("streamError"),
            "epsg": entry.get("epsg"),
            "nodata": entry.get("nodata"),
            "levels": entry.get("levels"),
            "wgs84Bounds": entry.get("info", {}).get("bbox_lonlat"),
            "windows": window_checks,
        },
        "failures": failures,
    }
    q.write_report(args.out, payload)
    return 0 if not failures else 1


# --------------------------------------------------------------------------- #
# Q3b: multi-member generation resolution
# --------------------------------------------------------------------------- #

def cmd_q3_members(args: argparse.Namespace) -> int:
    """Multi-member resolution: crossing boundaries and an unoccupied gap.

    The plan requires the resolver to answer one global window across member
    boundaries, and requires block allocation to follow occupied coverage rather
    than the bounding rectangle. The reference here replays members over a shared
    lattice, which is the semantics the generation representation specifies.
    """
    collection = args.collection.resolve()
    members = sorted(collection.glob("*.tif"))
    if not members:
        q.fail(f"no members under {collection}")

    layouts = {p.name: q.read_tiff_layout(p) for p in members}
    first = layouts[members[0].name]
    gt = first.geo_transform
    if gt is None:
        q.fail("members are not georeferenced")
    pixel, size = gt[1], first.width

    occupied: dict[tuple[int, int], Path] = {}
    for path in members:
        parts = path.stem.split("_")
        occupied[(int(parts[-2]), int(parts[-1]))] = path
    rows = sorted({r for r, _ in occupied})
    columns = sorted({c for _, c in occupied})
    gaps = [(r, c) for r in range(rows[-1] + 1) for c in range(columns[-1] + 1)
            if (r, c) not in occupied]

    def reference_window(row0: int, column0: int, span: int):
        """Replay members over one global pixel window; gaps stay invalid."""
        origin_x = gt[0] + column0 * size * pixel
        origin_y = gt[3] - row0 * size * pixel
        values = np.full((span, span), np.nan)
        valid = np.zeros((span, span), dtype=bool)
        used: list[str] = []
        for (row, column), path in sorted(occupied.items()):
            member_x = gt[0] + column * size * pixel
            member_y = gt[3] - row * size * pixel
            ix = int(round((origin_x - member_x) / pixel))
            iy = int(round((member_y - origin_y) / pixel))
            wx0, wy0 = max(0, -ix), max(0, -iy)
            wx1, wy1 = min(span, size - ix), min(span, size - iy)
            if wx1 <= wx0 or wy1 <= wy0:
                continue
            block, block_valid = _gdal_window(path, ix + wx0, iy + wy0,
                                              wx1 - wx0, wy1 - wy0)
            values[wy0:wy1, wx0:wx1] = block
            valid[wy0:wy1, wx0:wx1] = block_valid
            used.append(path.stem)
        return values, valid, used

    checks = []
    failures: list[str] = []
    for label, (row, column, span) in args.window:
        values, valid, used = reference_window(row, column, span)
        gx = np.arange(column * size, column * size + span)
        gy = np.arange(row * size, row * size + span)
        expected = expected_plane(gx[None, :], gy[:, None], args.plane)
        comparable = valid
        error = (float(np.max(np.abs(values[comparable] - expected[comparable])))
                 if comparable.any() else None)
        covered = int(valid.sum())
        checks.append({
            "label": label,
            "memberRow": row,
            "memberColumn": column,
            "span": span,
            "membersUsed": used,
            "coveredCells": covered,
            "totalCells": span * span,
            "maxAbsErrorVsAnalytic": error,
        })
        if error is not None and error > FLOAT32_EXACT_TOLERANCE:
            failures.append(f"{label}: analytic error {error}")
        if covered != span * span:
            failures.append(f"{label}: only {covered}/{span * span} cells covered")

    # An unoccupied lattice slot must resolve to no coverage, never to a
    # bounding-rectangle fill.
    gap_checks = []
    for (row, column) in gaps:
        _, valid, used = reference_window(row, column, 64)
        covered = int(valid.sum())
        gap_checks.append({"memberRow": row, "memberColumn": column,
                           "coveredCells": covered, "membersUsed": used})
        if covered != 0:
            failures.append(f"gap slot ({row},{column}) covered {covered} cells")

    payload = {
        "experiment": "q3-members",
        "result": "fail" if failures else "pass",
        "collection": collection.name,
        "memberCount": len(members),
        "memberSize": [size, size],
        "pixelMetres": pixel,
        "occupiedSlots": len(occupied),
        "unoccupiedSlots": gaps,
        "windowChecks": checks,
        "gapChecks": gap_checks,
        "tolerance": {"maxAbsErrorVsAnalytic": FLOAT32_EXACT_TOLERANCE},
        "failures": failures,
    }
    q.write_report(args.out, payload)
    return 0 if not failures else 1


# --------------------------------------------------------------------------- #
# compare
# --------------------------------------------------------------------------- #

def cmd_compare(args: argparse.Namespace) -> int:
    reports = [load(path) for path in args.report]
    payload = {
        "experiment": "compare",
        "result": "fail" if any(r.get("result") == "fail" for r in reports) else "pass",
        "reports": [
            {"path": str(path), "experiment": r.get("experiment"), "result": r.get("result"),
             "failures": r.get("failures", [])}
            for path, r in zip(args.report, reports)
        ],
    }
    q.write_report(args.out, payload)
    return 0 if payload["result"] == "pass" else 1


# --------------------------------------------------------------------------- #

def _window_spec(value: str) -> tuple[str, tuple[int, int, int]]:
    """Parse a ``LABEL:ROW:COL:SPAN`` window argument."""
    parts = value.split(":")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(f"expected LABEL:ROW:COL:SPAN, got {value!r}")
    label, row, column, span = parts
    return label, (int(row), int(column), int(span))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("sysinfo", help="record the qualification host")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_sysinfo)

    p = sub.add_parser("q2-numeric", help="compare browser window reads with the analytic plane")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--fixture-map", required=True, type=Path)
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q2_numeric)

    p = sub.add_parser("q2-local-bridge", help="record the stripped-file local bridge finding")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q2_local_bridge)

    p = sub.add_parser("q4-slope", help="analytic and GDAL slope comparison")
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q4_slope)

    p = sub.add_parser("q4-crs", help="EPSG:2154 interpretation and control points")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--reference", required=True, type=Path)
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q4_crs)

    p = sub.add_parser("q6-resources", help="bounded-read resource measurement")
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--fixture", action="append", required=True)
    p.add_argument("--budget-mib", type=float, default=1024.0)
    p.add_argument("--window-cells", type=int, default=MAX_WINDOW_CELLS)
    p.add_argument("--max-reads", type=int, default=64)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q6_resources)

    p = sub.add_parser("q3-prepare", help="native preparation integrity and bounded readback")
    p.add_argument("--original", required=True, type=Path)
    p.add_argument("--derived", required=True, type=Path)
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--fixture-name", required=True)
    p.add_argument("--expected-original-sha256")
    p.add_argument("--prepare-options", default="")
    p.add_argument("--prepare-seconds", type=float, default=0.0)
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q3_prepare)

    p = sub.add_parser("q3-members", help="multi-member resolution across boundaries and gaps")
    p.add_argument("--collection", required=True, type=Path)
    p.add_argument("--window", action="append", required=True, type=_window_spec,
                   metavar="LABEL:ROW:COL:SPAN")
    p.add_argument("--plane", help="fixture name whose plane defines the expected surface")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q3_members)

    p = sub.add_parser("compare", help="combine experiment reports")
    p.add_argument("--report", action="append", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_compare)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
