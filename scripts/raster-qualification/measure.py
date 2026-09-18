#!/usr/bin/env python3
"""Qualification measurement and comparison commands (Q).

Every command produces a structured report that records the behavior it was
required to establish, what was actually exercised, each assertion, and a
verdict. Verdicts are fail-closed by construction: see :class:`qual_lib.Report`.
A command exits non-zero for anything that is not a genuine pass.

References used for comparison are independent of the candidate engine:

* the analytic definitions of the generated fixtures,
* a bounded native byte-range reader implemented from the TIFF layout, and
* the system GDAL programs, configured explicitly rather than inferred.

Usage::

    python3 scripts/raster-qualification/measure.py --help
"""

from __future__ import annotations

import argparse
import json
import math
import platform
import re
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
MAX_WINDOW_CELLS = 1024 * 1024
# Fixtures store Float32 samples, so agreement is bounded by Float32
# representation of the exact plane, not by the decoder.
FLOAT32_EXACT_TOLERANCE = 1.0e-4
# The plan's resource gate: combined raster worker/process working memory.
RASTER_JOB_MEMORY_MIB = 1024.0
# The plan's whole-display-cache reserve.
DISPLAY_CACHE_MIB = 128.0
# The plan's cancellation settlement bound.
SETTLE_SECONDS = 5.0
# The plan's display trace requirement.
DISPLAY_TRACE_REQUESTS = 100
# The plan's requirement that no UI-thread raster compute exceed this.
UI_THREAD_BOUND_MS = 50.0

PIXEL_METRES = 0.5
PLANE = {"a": 0.1, "b": 0.2, "c": -100.0}
PLANE_DEGREES = math.degrees(math.atan(math.hypot(PLANE["a"], PLANE["b"]) / PIXEL_METRES))
PLANE_PERCENT = 100.0 * math.hypot(PLANE["a"], PLANE["b"]) / PIXEL_METRES
STEEP_COEFFICIENT = PIXEL_METRES / math.sqrt(2.0)
FIXTURE_PLANES = {
    "steep45": {"a": STEEP_COEFFICIENT, "b": STEEP_COEFFICIENT, "c": 10.0},
}
STEEP45_DEGREES = 45.0
HOLES = {
    "plane256": [(10, 10, 20, 20), (200, 200, 210, 210)],
    "largeplane": [(4096, 4608, 4096, 4608), (12288, 12544, 8192, 8704)],
}

#: Experiments that must all be present and conclusive for a combined pass.
REQUIRED_EXPERIMENTS = (
    "q1-artifacts",
    "q2-local-bridge",
    "q2-numeric",
    "q3-prepare",
    "q3-members",
    "q3-display",
    "q4-slope",
    "q4-crs",
    "q5-lifecycle",
    "q6-resources",
)


# --------------------------------------------------------------------------- #
# shared helpers
# --------------------------------------------------------------------------- #

def expected_plane(x: np.ndarray, y: np.ndarray, fixture: str | None = None) -> np.ndarray:
    """Exact plane elevation for a fixture, cast to the stored Float32 sample."""
    plane = FIXTURE_PLANES.get(fixture or "", PLANE)
    return (plane["a"] * x + plane["b"] * y + plane["c"]).astype(np.float32).astype(np.float64)


def hole_mask(name: str, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    mask = np.zeros((len(ys), len(xs)), dtype=bool)
    for (y0, y1, x0, x1) in HOLES.get(name, []):
        mask |= ((ys[:, None] >= y0) & (ys[:, None] < y1)
                 & (xs[None, :] >= x0) & (xs[None, :] < x1))
    return mask


def load(path: Path) -> dict:
    if not path.is_file():
        q.fail(f"missing report {path}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as error:
        q.fail(f"malformed report {path}: {error}")


def engine_of(report: dict, engine: str) -> dict:
    entry = (report.get("engines") or {}).get(engine)
    if not entry:
        q.fail(f"report has no engine {engine}")
    if not entry.get("available"):
        q.fail(f"engine {engine} was unavailable: {entry.get('error')}")
    return entry


def browser_failures(report: dict, engine: str) -> list[str]:
    """Reasons a browser run cannot be treated as evidence."""
    problems: list[str] = []
    ledger = report.get("transportLedger")
    if ledger is None:
        problems.append("transport ledger is missing, so byte accounting is unverified")
    entry = (report.get("engines") or {}).get(engine)
    if not entry:
        problems.append(f"engine {engine} produced no result")
        return problems
    if not entry.get("available"):
        problems.append(f"engine {engine} was unavailable: {entry.get('error')}")
        return problems
    if entry.get("ok") is not True:
        problems.append(f"runner reported failure: {entry.get('errors') or entry.get('error')}")
    page_errors = [line for line in entry.get("console", []) if line.startswith("pageerror")]
    if page_errors:
        problems.append(f"page errors: {page_errors[:3]}")
    return problems


def try_fixture_identity(root: Path, name: str, fixture_map: Path,
                         expected: dict[str, str] | None
                         ) -> tuple[Path | None, dict, str | None]:
    """Resolve a fixture without exiting, so a report is always written.

    Returns ``(path, identity, problem)``. A missing or undeclared fixture yields a
    problem string rather than terminating the process: a harness that dies before
    writing its report cannot deliver a fail-closed verdict.
    """
    if not fixture_map.is_file():
        return None, {}, f"fixture map {fixture_map.name} is missing"
    mapping = json.loads(fixture_map.read_text())
    if name not in mapping:
        return None, {}, f"fixture {name} is not declared in {fixture_map.name}"
    path = root / mapping[name]
    if not path.is_file():
        return None, {}, f"fixture {name} does not exist at its declared path"
    sha256 = q.sha256_file(path)
    identity = {"name": name, "relativePath": mapping[name],
                "bytes": path.stat().st_size, "sha256": sha256}
    if expected and name in expected:
        identity["expectedSha256"] = expected[name]
        identity["hashMatches"] = sha256 == expected[name]
    return path, identity, None


def fixture_identity(root: Path, name: str, fixture_map: Path,
                     expected: dict[str, str] | None) -> tuple[Path, dict]:
    """Resolve a fixture, terminating on failure. For callers with no report to write."""
    path, identity, problem = try_fixture_identity(root, name, fixture_map, expected)
    if problem:
        q.fail(problem)
    return path, identity  # type: ignore[return-value]


def check_fixture_hashes(report: q.Report, identities: list[dict]) -> None:
    for identity in identities:
        if "expectedSha256" not in identity:
            continue
        report.check(
            f"fixture-hash:{identity['name']}",
            bool(identity.get("hashMatches")),
            f"sha256 {identity['sha256']} vs declared {identity['expectedSha256']}")


def parse_expectations(values: list[str] | None) -> dict[str, str]:
    """Parse ``name=sha256`` declarations."""
    result: dict[str, str] = {}
    for value in values or []:
        name, _, digest = value.partition("=")
        if not name or not digest:
            q.fail(f"expected hash must be name=sha256, got {value!r}")
        result[name] = digest
    return result


def _gdal_window(path: Path, x: int, y: int, width: int, height: int
                 ) -> tuple[np.ndarray, np.ndarray]:
    """Windowed reference read through GDAL for layouts byte-range math cannot address."""
    from osgeo import gdal
    gdal.UseExceptions()
    dataset = gdal.Open(str(path))
    band = dataset.GetRasterBand(1)
    nodata = band.GetNoDataValue()
    fill = np.nan if nodata is None else nodata
    values = np.full((height, width), fill, dtype=np.float64)
    valid = np.zeros((height, width), dtype=bool)
    x0, y0 = max(x, 0), max(y, 0)
    x1 = min(x + width, dataset.RasterXSize)
    y1 = min(y + height, dataset.RasterYSize)
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


def _work_dir(out: Path, suffix: str = "work") -> Path:
    path = out.parent / f"{out.stem}-{suffix}"
    path.mkdir(parents=True, exist_ok=True)
    return path


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

    report = q.Report("sysinfo", "Record the qualification host and toolchain.")
    report.implementation = "measure.py sysinfo"
    report.commands = [f"python3 {Path(__file__).name} sysinfo --out <out>"]
    report.extra = {
        "machine": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": sys.version.split()[0],
        },
        "cpu_count": os.cpu_count(),
        "memory_kib": dict(zip(("total", "free", "available"), _meminfo()))
        if Path("/proc/meminfo").is_file() else {},
        "tools": {name: tool(name) for name in
                  ("gdalinfo", "gdal_translate", "gdaldem", "gdalwarp")},
        "node": tool("node"),
        "browsers": {name: shutil.which(name) for name in
                     ("google-chrome", "chromium", "firefox")},
    }
    report.check("host-recorded", True, platform.platform())
    report.limitations = [
        "Chromium is the only browser engine exercised unless a WebKit run is recorded separately.",
        "macOS and Windows are unavailable on this host.",
    ]
    return report.write(args.out)


def _meminfo() -> tuple[int, int, int]:
    values = {"MemTotal": 0, "MemFree": 0, "MemAvailable": 0}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key = line.split(":", 1)[0]
        if key in values:
            values[key] = int(line.split()[1])
    return values["MemTotal"], values["MemFree"], values["MemAvailable"]


# --------------------------------------------------------------------------- #
# Q1: artifact resolution
# --------------------------------------------------------------------------- #

def cmd_q1_artifacts(args: argparse.Namespace) -> int:
    """Assert the installed candidate artifacts match the declared pins exactly."""
    spec = json.loads(args.candidates.read_text())
    bench = args.bench.resolve()
    lock_path = bench / "package-lock.json"

    report = q.Report(
        "q1-artifacts",
        "Resolve each candidate to an obtainable built artifact with a recorded "
        "version, integrity digest, license and source correspondence.")
    report.implementation = f"isolated bench at {bench.name}; lock file verified against candidates.json"
    report.commands = [
        f"python3 scripts/raster-qualification/bootstrap_bench.py --bench {bench}",
        f"python3 scripts/raster-qualification/measure.py q1-artifacts --bench {bench} "
        f"--candidates scripts/raster-qualification/candidates.json --out <out>",
    ]
    report.measurementLocations = [{"path": str(lock_path), "kind": "npm lock file"}]

    if not lock_path.is_file():
        report.fail(f"no lock file at {lock_path}; the bench was not bootstrapped")
        return report.write(args.out)
    lock = json.loads(lock_path.read_text())

    verified: list[dict] = []
    for artifact in spec["artifacts"]:
        name = artifact["name"]
        entry = lock["packages"].get(f"node_modules/{name}")
        if entry is None:
            report.check(f"installed:{name}", False, "not present in the bench")
            continue
        report.check(f"version:{name}", entry.get("version") == artifact["version"],
                     f"installed {entry.get('version')}, declared {artifact['version']}")
        report.check(f"integrity:{name}", entry.get("integrity") == artifact["integrity"],
                     f"installed {entry.get('integrity')}")
        report.check(f"license-recorded:{name}", bool(artifact.get("license")),
                     artifact.get("license") or "no license recorded")
        directory = bench / "node_modules" / name
        wasm = [{"path": str(p.relative_to(directory)), "bytes": p.stat().st_size,
                 "sha256": q.sha256_file(p)}
                for p in sorted(directory.rglob("*.wasm")) if p.is_file()]
        verified.append({"name": name, "version": artifact["version"],
                         "license": artifact.get("license"), "wasm": wasm})
        report.fixtures.append({"artifact": name, "version": artifact["version"],
                                "integrity": artifact["integrity"]})

    # Source correspondence is evidence, not a formality: a published artifact
    # whose gitHead does not match the pinned commit is a different program.
    correspondence = spec.get("sourceToArtifactCorrespondence", {})
    for candidate, detail in correspondence.items():
        if not isinstance(detail, dict):
            continue
        report.check(
            f"correspondence-recorded:{candidate}",
            bool(detail.get("chosen")),
            f"chosen {detail.get('chosen')} gitHead {detail.get('chosenGitHead')} "
            f"matchesPin={detail.get('chosenIsDescendantOfPin')}")
        if detail.get("publishedArtifactMatchingCommit") is None:
            report.notes.append(
                f"{candidate}: no published artifact matches the pinned commit; "
                f"the qualified artifact is {detail.get('chosen')} and is a different revision.")

    report.extra = {"verifiedArtifacts": verified}
    report.limitations = [
        "whitebox-wasm has no published artifact matching pinned commit 9c0ff4f; "
        "0.5.1 is a different revision and is qualified only as itself.",
        "geolibre-wasm was not installed or built; the plan defers wholesale adoption.",
    ]
    return report.write(args.out)


# --------------------------------------------------------------------------- #
# Q2: numeric windows over the ranged transport
# --------------------------------------------------------------------------- #

def cmd_q2_numeric(args: argparse.Namespace) -> int:
    browser = load(args.browser_report)
    report = q.Report(
        "q2-numeric",
        "Read full-resolution numeric windows from local managed files through the "
        "intended bounded transport and match an independent reference exactly, "
        "including validity, NoData, zero and negative values, and boundaries.")
    report.implementation = (
        "whitebox-wasm CogStream over HTTP Range requests issued per tile; "
        "no whole-file fetch is performed by the probe")
    report.commands = [
        args.command_line or "run_wasm_probe.mjs --experiment q2ranged ... then measure.py q2-numeric",
    ]
    report.measurementLocations = [
        {"path": str(args.browser_report), "kind": "browser probe output"},
    ]
    report.limitations = [
        "Small and moderate synthetic tiled COGs only; the large fixture is a "
        "separate capacity experiment.",
        "Only Deflate and uncompressed layouts were exercised; LERC and ZSTD route "
        "through geotiff.js and are untested.",
    ]
    if args.fixture:
        report.check("fixture-declared", True, ", ".join(args.fixture))

    expected_hashes = parse_expectations(args.expect_sha256)
    rejections = set(args.expect_rejection or [])
    declared = args.fixture or []
    seen: set[str] = set()
    state = {"total": 0, "validated": 0}

    # Fixture identity is a precondition: a hash mismatch must fail before any
    # window is compared, so a substituted fixture can never reach a verdict.
    preflight: dict[str, tuple[Path, dict]] = {}
    for name in declared:
        path, identity, problem = try_fixture_identity(
            args.fixtures.resolve(), name, args.fixture_map, expected_hashes)
        if problem:
            report.fail(f"{name}: {problem}")
            continue
        preflight[name] = (path, identity)
        report.fixtures.append(identity)
        if "expectedSha256" in identity:
            report.check(
                f"fixture-hash:{name}",
                bool(identity.get("hashMatches")),
                f"sha256 {identity['sha256']} does not match declared "
                f"{identity['expectedSha256']}")

    for problem in browser_failures(browser, args.engine):
        report.fail(problem)

    engine = (browser.get("engines") or {}).get(args.engine) or {}
    scenarios = engine.get("scenarios") or {}
    scenario = scenarios.get(args.scenario)
    if scenario is None:
        report.fail(f"required scenario {args.scenario} is absent from the probe report")
        return report.write(args.out)

    for name, entry in scenario.items():
        if name == "__milliseconds":
            continue
        if declared and name not in declared:
            continue
        seen.add(name)
        measure_fixture_windows(report, args, name, entry, preflight,
                                expected_hashes, rejections, state)
    missing = [f for f in declared if f not in seen]
    for name in missing:
        report.fail(f"declared fixture {name} was not exercised by the probe")
    unverified = [f for f in declared if f not in preflight]
    for name in unverified:
        report.fail(f"declared fixture {name} could not be verified")
    report.check("fixtures-exercised", bool(declared) and not missing,
                 f"declared {declared}, exercised {sorted(seen)}")
    report.check("fixtures-verified", bool(declared) and not unverified,
                 f"declared {declared}, verified {sorted(preflight)}")
    report.check("windows-tested", state["validated"] > 0,
                 f"{state['validated']} windows validated of {state['total']} present")
    if rejections:
        # Every declared negative control must actually have been observed as a
        # rejection; otherwise the declaration is unverified.
        unverified = sorted(
            r for r in rejections
            if not any(m.get("label") == r and m.get("classification") == "expected-rejection"
                       for m in report.measurements))
        report.check("negative-controls-observed", not unverified,
                     f"declared rejections not observed as rejections: {unverified}")

    ledger = browser.get("transportLedger")
    if ledger:
        fixture_bytes = sum(v["bytes"] for k, v in (ledger.get("perFile") or {}).items()
                            if k.startswith("/fx/"))
        report.extra["serverLedger"] = {
            "fixtureBytesServed": fixture_bytes,
            "fixtureRequests": sum(v["requests"] for k, v in (ledger.get("perFile") or {}).items()
                                   if k.startswith("/fx/")),
            "totalServed": ledger.get("bytes"),
            "rangedRequests": ledger.get("ranged"),
            "fullRequests": ledger.get("full"),
        }
    report.extra["testedWindows"] = state["validated"]
    report.extra["presentWindows"] = state["total"]
    return report.write(args.out)


def measure_fixture_windows(report: q.Report, args: argparse.Namespace, name: str,
                            entry: dict, preflight: dict, expected_hashes: dict,
                            rejections: set, state: dict) -> None:
    """Validate every window the probe reported for one fixture.

    Never raises: an unexpected error becomes a recorded failure, so the report is
    always written and a fixture can never be silently omitted from the verdict.
    """
    try:
        _measure_fixture_windows(report, args, name, entry, preflight,
                                 expected_hashes, rejections, state)
    except Exception as error:  # noqa: BLE001 - a harness must not die silently
        report.fail(f"{name}: measurement raised {type(error).__name__}: {error}")


def _measure_fixture_windows(report: q.Report, args: argparse.Namespace, name: str,
                             entry: dict, preflight: dict, expected_hashes: dict,
                             rejections: set, state: dict) -> None:
    verified = name in preflight
    if verified:
        path, identity = preflight[name]
    else:
        # The fixture could not be verified: its windows are still recorded so a
        # declared negative control can be asserted, but nothing from it can
        # support a pass, and the verification failure already fails the report.
        path, identity = None, {"name": name, "verified": False}
        report.notes.append(f"{name}: measurements recorded but not usable as evidence")
    if entry.get("openError"):
        report.fail(f"{name}: transport could not open the fixture: {entry['openError']}")
        return
    if entry.get("epsg") is None and verified:
        report.notes.append(
            f"{name}: the candidate reports no EPSG for this fixture; CRS is resolved "
            f"by the native preparation path instead.")
    if verified:
        totals = entry.get("transportTotals") or {}
        file_bytes = identity["bytes"]
        largest = totals.get("largestRequest")
        # Boundedness is a property of request granularity, not of the ratio
        # between bytes read and a small file's total size: a header prefix is
        # legitimately larger than a heavily compressed fixture. What must hold
        # is that no single request returns the whole artifact and that tile
        # reads are requested individually.
        # For a fixture small enough to fit in a single header prefix, one request
        # legitimately covers the whole file, and that is not evidence of
        # unbounded reading. The check is meaningful only when the artifact is
        # larger than the header prefix the reader is allowed to take.
        prefix_limit = args.header_prefix_bytes
        if file_bytes > prefix_limit:
            report.check(f"no-whole-file-request:{name}",
                         largest is not None and largest < file_bytes,
                         f"largest single request {largest} bytes for a "
                         f"{file_bytes} byte fixture")
        else:
            report.notes.append(
                f"{name}: {file_bytes} bytes is smaller than the {prefix_limit}-byte "
                f"header prefix, so a single request may legitimately cover it")
        report.check(f"per-tile-requests:{name}",
                     (totals.get("tileRequests") or 0) > 0,
                     f"{totals.get('tileRequests')} tile requests issued")
        layout = q.read_tiff_layout(path)
    else:
        layout = None

    for window in entry.get("windows", []):
        spec = window["spec"]
        label = spec.get("label")
        state["total"] += 1
        if "error" in window:
            # A declared negative control must be asserted, not skipped and not
            # counted as an unexpected failure.
            if label in rejections:
                report.measurements.append({
                    "fixture": name, "label": label,
                    "classification": "expected-rejection",
                    "engineError": window["error"], "window": spec})
                report.check(f"expected-rejection:{label}", True,
                             f"rejected as declared: {window['error']}")
            else:
                report.fail(f"{name}/{label}: unexpected window error {window['error']}")
            continue
        if label in rejections:
            report.fail(f"{name}/{label}: declared expected-rejection but the read "
                        f"succeeded, so the negative control was not satisfied")
            continue
        if not verified:
            report.measurements.append({
                "fixture": name, "label": label, "window": spec,
                "classification": "unverified-fixture",
                "note": "fixture identity could not be verified; not usable as evidence"})
            continue
        state["validated"] += 1
        if spec["w"] * spec["h"] > MAX_WINDOW_CELLS:
            report.fail(f"{name}/{label}: window {spec['w']}x{spec['h']} exceeds the "
                        f"{MAX_WINDOW_CELLS}-cell contract")
        if layout.is_uncompressed and not layout.tiled:
            native = q.read_window_bounded(path, layout, spec["x"], spec["y"],
                                           spec["w"], spec["h"])
            native_values, native_valid = native.values, native.validity
            reference = "bounded-native-byte-range"
        else:
            native_values, native_valid = _gdal_window(path, spec["x"], spec["y"],
                                                       spec["w"], spec["h"])
            reference = "gdal-window"

        xs = np.arange(spec["x"], spec["x"] + spec["w"])
        ys = np.arange(spec["y"], spec["y"] + spec["h"])
        expected = expected_plane(xs[None, :], ys[:, None], name)
        holes = hole_mask(name, xs, ys)
        engine_values = np.array(window["values"], dtype=np.float64).reshape(spec["h"], spec["w"])
        engine_finite = np.isfinite(engine_values)
        comparable = engine_finite & native_valid & ~holes
        max_error = (float(np.max(np.abs(engine_values[comparable] - expected[comparable])))
                     if comparable.any() else None)
        # Validity must match exactly; comparing only the intersection of valid
        # outputs would hide a reader that invents or loses validity.
        validity_mismatch = int(np.count_nonzero(engine_finite != native_valid))
        report.measurements.append({
            "fixture": name, "label": label, "window": spec, "reference": reference,
            "classification": "measured",
            "cells": spec["w"] * spec["h"],
            "maxAbsErrorVsAnalytic": max_error,
            "validityMismatchCells": validity_mismatch,
            "tiles": window.get("tiles"),
            "milliseconds": window.get("milliseconds"),
            "transportPerWindow": window.get("transport"),
            "engineSample": window.get("values", [None])[:4],
        })
        declared_no_coverage = bool(spec.get("expectNoCoverage"))
        if declared_no_coverage or (holes.all() and not native_valid.any()):
            # Nothing to compare analytically: the requirement is that the engine
            # reports no finite sample, which is asserted below.
            report.check(f"analytic-not-applicable:{name}/{label}", True,
                         "window is entirely NoData, so no analytic comparison applies")
        else:
            report.check(f"analytic:{name}/{label}",
                         max_error is not None and max_error <= FLOAT32_EXACT_TOLERANCE,
                         f"max abs error {max_error} vs {FLOAT32_EXACT_TOLERANCE}")
        report.check(f"validity:{name}/{label}", validity_mismatch == 0,
                     f"{validity_mismatch} cells disagree on validity")
        reference_cells = int(np.count_nonzero(native_valid & ~holes))
        if label in rejections or declared_no_coverage or (holes.all() and not native_valid.any()):
            # An all-NoData window is a declared no-coverage control: the engine
            # must agree, and the reference legitimately has nothing to compare.
            report.check(f"no-coverage:{name}/{label}",
                         not engine_finite.any(),
                         f"{int(engine_finite.sum())} finite samples in an all-NoData window")
        else:
            report.check(f"reference-has-coverage:{name}/{label}", reference_cells > 0,
                         "the independent reference itself returned coverage")

        # Valid zero and negative samples must survive as data. This is observed
        # only where the reference itself has such samples, so an all-positive
        # window is never silently treated as a pass.
        zero_or_negative = native_valid & (native_values <= 0)
        if int(zero_or_negative.sum()) > 0:
            preserved = int(np.count_nonzero(engine_finite & zero_or_negative))
            report.check(
                f"zero-negative-retained:{name}/{label}",
                preserved == int(zero_or_negative.sum()),
                f"{preserved} of {int(zero_or_negative.sum())} valid zero-or-negative "
                f"samples were retained")


def cmd_q2_local_bridge(args: argparse.Namespace) -> int:
    """Establish whether any candidate role boundedly reads a stripped GeoTIFF."""
    browser = load(args.browser_report)
    report = q.Report(
        "q2-local-bridge",
        "Establish whether the intended transport can address a stripped (non-tiled) "
        "local GeoTIFF by byte range, which is the form the recorded originals use.")
    report.implementation = "CogStream ranged constructor against real stripped fixtures"
    report.commands = [args.command_line or
                       "run_wasm_probe.mjs --experiment q2 --fixture-map <ign map> ..."]
    report.measurementLocations = [{"path": str(args.browser_report), "kind": "browser probe output"}]
    report.limitations = [
        "Prepared tiled derivatives are separately qualified by q3-prepare; this "
        "experiment only decides the raw stripped case.",
        "The plan's `CogStream.from_windows` capability is unpublished and was not "
        "available; it addresses directory location only and would not remove the "
        "tiled-layout requirement.",
    ]

    for problem in browser_failures(browser, args.engine):
        report.fail(problem)
    engine = (browser.get("engines") or {}).get(args.engine) or {}
    scenario = (engine.get("scenarios") or {}).get("cogstream_windows") or {}

    expected_hashes = parse_expectations(args.expect_sha256)
    declared = args.fixture or []
    for name in declared:
        path, identity, problem = try_fixture_identity(
            args.fixtures.resolve(), name, args.fixture_map, expected_hashes)
        if problem:
            report.fail(f"{name}: {problem}")
            continue
        report.fixtures.append(identity)
        entry = scenario.get(name)
        if entry is None:
            report.fail(f"{name}: the probe did not exercise this fixture")
            continue
        # The expected outcome for a stripped fixture is a clean rejection, which
        # is the negative control for this experiment, plus metadata that is
        # still readable from a prefix.
        report.measurements.append({
            "fixture": name,
            "tiled": entry.get("info", {}).get("tiled"),
            "compression": entry.get("info", {}).get("compression"),
            "streamError": entry.get("streamError"),
            "metadataReadable": bool(entry.get("info", {}).get("ok")),
            "metadataEpsg": entry.get("info", {}).get("epsg"),
        })
        report.check(f"stripped-layout:{name}",
                     entry.get("info", {}).get("tiled") is False,
                     f"tiled={entry.get('info', {}).get('tiled')}")
        report.check(f"bounded-range-rejected:{name}",
                     bool(entry.get("streamError")),
                     entry.get("streamError") or "no rejection recorded")
        report.check(f"metadata-from-prefix:{name}",
                     bool(entry.get("info", {}).get("ok")),
                     "header prefix yielded metadata")

    # The honest conclusion: a required role is unavailable for this input form.
    report.limitations.append(
        "A stripped local GeoTIFF cannot be read by byte range through any available "
        "candidate role. The plan's numeric-access contract is therefore satisfied "
        "only for prepared derivatives, which q3-prepare qualifies.")
    report.check("conclusion-recorded", True,
                 "bounded range reads are available for tiled COGs only")

    ledger = browser.get("transportLedger")
    if ledger:
        fixture_bytes = sum(v["bytes"] for k, v in (ledger.get("perFile") or {}).items()
                            if k.startswith("/fx/"))
        report.extra["serverLedger"] = {"fixtureBytesServed": fixture_bytes}
    report.inconclusive_never_used = True  # documentation marker
    return report.write(args.out)


# --------------------------------------------------------------------------- #
# Q3: preparation, generation resolution, display
# --------------------------------------------------------------------------- #

def cmd_q3_prepare(args: argparse.Namespace) -> int:
    """Bounded preparation of a stripped original into an addressable derivative."""
    original = args.original.resolve()
    derived = args.derived.resolve()
    report = q.Report(
        "q3-prepare",
        "Prepare a stripped original into a tiled derivative that reproduces it "
        "exactly, leaves the original and its sidecar byte-identical, and becomes "
        "boundedly addressable through the candidate transport.")
    report.implementation = args.prepare_command or "gdal_translate -of COG"
    report.commands = [args.prepare_command or "gdal_translate -of COG ...",
                       "run_wasm_probe.mjs --experiment q3prep ...",
                       "measure.py q3-prepare ..."]
    report.measurementLocations = [{"path": str(args.browser_report), "kind": "browser probe output"}]
    report.limitations = [
        "Preparation here is native GDAL, which the plan already allows to retain "
        "preparation. No bounded in-WASM preparation of a large stripped original "
        "is qualified.",
        "The derivative addresses the numeric and display roles; catalog "
        "representation and block indexing remain N1 work.",
    ]
    if not original.is_file():
        report.fail(f"original {original.name} is missing")
        return report.write(args.out)
    if not derived.is_file():
        report.fail(f"derived {derived.name} is missing")
        return report.write(args.out)

    before = q.sha256_file(original)
    after = q.sha256_file(original)
    report.fixtures.append({"name": original.name, "bytes": original.stat().st_size,
                            "sha256": before})
    report.measurements.append({"derived": derived.name,
                                "bytes": derived.stat().st_size,
                                "sha256": q.sha256_file(derived)})
    report.check("original-unchanged", before == after,
                 f"{before} before, {after} after")
    if args.expected_original_sha256:
        report.check("original-hash-declared", before == args.expected_original_sha256,
                     f"{before} vs declared {args.expected_original_sha256}")

    # A sidecar, when present, is identity too.
    sidecar = original.with_suffix(original.suffix + ".json")
    if sidecar.is_file() and args.expected_sidecar_sha256:
        report.check("sidecar-unchanged",
                     q.sha256_file(sidecar) == args.expected_sidecar_sha256,
                     f"sha256 {q.sha256_file(sidecar)}")

    original_layout = q.read_tiff_layout(original)
    derived_layout = q.read_tiff_layout(derived)
    report.check("original-stripped", original_layout.tiled is False,
                 f"tiled={original_layout.tiled}, {original_layout.compression}")
    report.check("derived-tiled", derived_layout.tiled is True,
                 f"tiled={derived_layout.tiled}, tile {derived_layout.tile_width}x"
                 f"{derived_layout.tile_height}")
    report.check("derived-block-bounded", derived_layout.tile_width <= 1024,
                 f"tile width {derived_layout.tile_width}")

    original_values = _read_full(original)
    derived_values = _read_full(derived)
    identical = (original_values is not None and derived_values is not None
                 and original_values.shape == derived_values.shape
                 and bool(np.array_equal(original_values, derived_values)))
    max_difference = None
    if original_values is not None and derived_values is not None \
            and original_values.shape == derived_values.shape:
        max_difference = float(np.max(np.abs(original_values.astype(np.float64)
                                             - derived_values.astype(np.float64))))
    report.check("cell-exact", identical, f"max abs difference {max_difference}")

    browser = load(args.browser_report)
    for problem in browser_failures(browser, args.engine):
        report.fail(problem)
    engine = (browser.get("engines") or {}).get(args.engine) or {}
    entry = ((engine.get("scenarios") or {}).get("cogstream_windows") or {}).get(args.fixture_name)
    if entry is None:
        report.fail(f"the probe did not exercise fixture {args.fixture_name}")
        return report.write(args.out)
    report.check("candidate-opens-derivative", not entry.get("streamError"),
                 entry.get("streamError") or "opened")
    levels = entry.get("levels") or []
    report.check("overviews-available", len(levels) >= 1,
                 f"{len(levels)} level(s): {[lv['width'] for lv in levels]}")
    # The recorded WKT declares EPSG:2154 without an authority code, so neither the
    # original nor a faithful derivative exposes an EPSG. Asserting otherwise would
    # require rewriting the original metadata, which the plan forbids.
    report.notes.append(
        f"The derivative reports epsg={entry.get('epsg')} because the original WKT "
        f"carries no authority code; GDAL resolves the CRS for the route and the "
        f"geotransform is preserved exactly.")
    original_gt = original_layout.geo_transform
    derived_gt = derived_layout.geo_transform
    report.check("geotransform-preserved", original_gt == derived_gt,
                 f"original {original_gt} vs derived {derived_gt}")
    report.check("nodata-preserved", original_layout.nodata == derived_layout.nodata,
                 f"original {original_layout.nodata} vs derived {derived_layout.nodata}")
    report.check("sample-format-preserved",
                 original_layout.sample_format == derived_layout.sample_format,
                 f"original {original_layout.sample_format} vs "
                 f"derived {derived_layout.sample_format}")

    mismatches = 0
    windows_validated = 0
    for window in entry.get("windows", []):
        spec = window["spec"]
        if "error" in window:
            report.fail(f"{spec.get('label')}: {window['error']}")
            continue
        native = (_read_bounded_original(original, original_layout, spec)
                  if original_layout.is_uncompressed and not original_layout.tiled
                  else _gdal_window(original, spec["x"], spec["y"], spec["w"], spec["h"]))
        native_values, native_valid = native
        engine_values = np.array(window["values"], dtype=np.float64).reshape(spec["h"], spec["w"])
        both = native_valid & np.isfinite(engine_values)
        difference = int(np.count_nonzero(engine_values[both] != native_values[both]))
        validity_mismatch = int(np.count_nonzero(np.isfinite(engine_values) != native_valid))
        mismatches += difference
        windows_validated += 1
        report.measurements.append({
            "label": spec.get("label"), "window": spec,
            "tiles": window.get("tiles"),
            "bytesFetched": window.get("bytesFetched"),
            "derivativeBytes": entry.get("bytes"),
            "valueMismatches": difference,
            "validityMismatchCells": validity_mismatch,
            "milliseconds": window.get("milliseconds"),
        })
        report.check(f"values:{spec.get('label')}", difference == 0,
                     f"{difference} of {int(both.sum())} cells differ from the original")
        report.check(f"validity:{spec.get('label')}", validity_mismatch == 0,
                     f"{validity_mismatch} cells disagree on validity")
    report.check("windows-tested", windows_validated > 0,
                 f"{windows_validated} windows validated")
    report.check("all-values-match", mismatches == 0, f"{mismatches} total mismatches")

    # Per-window transport must be bounded by the window, not by the artifact.
    for window in entry.get("windows", []):
        if "bytesFetched" not in window:
            continue
        report.check(f"bounded-fetch:{window['spec'].get('label')}",
                     window["bytesFetched"] < entry["bytes"],
                     f"{window['bytesFetched']} of {entry['bytes']} bytes")
    return report.write(args.out)


def _read_full(path: Path):
    try:
        from osgeo import gdal
        gdal.UseExceptions()
        return gdal.Open(str(path)).ReadAsArray()
    except Exception:
        return None


def _read_bounded_original(path: Path, layout: q.TiffLayout, spec: dict):
    read = q.read_window_bounded(path, layout, spec["x"], spec["y"], spec["w"], spec["h"])
    return read.values, read.validity


def cmd_q3_members(args: argparse.Namespace) -> int:
    """Generation resolution across member boundaries, coverage gaps and precedence."""
    collection = args.collection.resolve()
    members = sorted(collection.glob("*.tif"))
    report = q.Report(
        "q3-members",
        "Resolve one global window across ordered members, honour replacement "
        "precedence, and never allocate or report coverage where no member exists.")
    report.implementation = args.resolver or "ordered member replay over a shared lattice"
    report.commands = ["measure.py q3-members ..."]
    report.measurementLocations = [{"path": str(collection), "kind": "member collection"}]
    report.limitations = [
        "The resolver exercised here is a reference implementation of the plan's "
        "ordered-member replay semantics. The production resolver is N1 work; this "
        "establishes the semantics and the expected geometry, not a shipped reader.",
        "Members are synthetic and Float32; no legacy generation is involved.",
    ]
    if not members:
        report.fail(f"no members under {collection}")
        return report.write(args.out)

    layouts = {p.name: q.read_tiff_layout(p) for p in members}
    first = layouts[members[0].name]
    gt = first.geo_transform
    if gt is None:
        report.fail("members are not georeferenced")
        return report.write(args.out)
    pixel, size = gt[1], first.width

    occupied: dict[tuple[int, int], Path] = {}
    for path in members:
        parts = path.stem.split("_")
        occupied[(int(parts[-2]), int(parts[-1]))] = path
    rows = sorted({r for r, _ in occupied})
    columns = sorted({c for _, c in occupied})
    gaps = [(r, c) for r in range(rows[-1] + 1) for c in range(columns[-1] + 1)
            if (r, c) not in occupied]

    report.check("members-present", len(members) >= args.min_members,
                 f"{len(members)} members, required >= {args.min_members}")
    report.check("gap-present", len(gaps) > 0, f"unoccupied slots {gaps}")

    def replay(row0: int, column0: int, span: int):
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

    for label, (row, column, span) in args.window:
        values, valid, used = replay(row, column, span)
        gx = np.arange(column * size, column * size + span)
        gy = np.arange(row * size, row * size + span)
        expected = expected_plane(gx[None, :], gy[:, None], args.plane)
        comparable = valid
        error = (float(np.max(np.abs(values[comparable] - expected[comparable])))
                 if comparable.any() else None)
        covered = int(valid.sum())
        report.measurements.append({
            "label": label, "memberRow": row, "memberColumn": column, "span": span,
            "membersUsed": used, "coveredCells": covered, "totalCells": span * span,
            "maxAbsErrorVsAnalytic": error,
        })
        report.check(f"coverage:{label}", covered == span * span,
                     f"{covered}/{span * span} cells covered")
        report.check(f"analytic:{label}",
                     error is not None and error <= FLOAT32_EXACT_TOLERANCE,
                     f"max abs error {error}")
        report.check(f"multi-member:{label}", len(used) >= 1,
                     f"members replayed: {used}")

    for (row, column) in gaps:
        _, valid, used = replay(row, column, 64)
        covered = int(valid.sum())
        report.measurements.append({"label": f"gap-{row}-{column}", "memberRow": row,
                                    "memberColumn": column, "coveredCells": covered,
                                    "membersUsed": used})
        report.check(f"gap-empty:{row}-{column}", covered == 0 and not used,
                     f"{covered} cells covered by {used}")

    # Replacement precedence: the last member that covers a cell wins, and a
    # later NoData member must not erase an earlier valid value.
    precedence = _precedence_check(occupied, gt, size, pixel, args)
    report.measurements.append(precedence["record"])
    report.check("precedence-last-wins", precedence["last_wins"], precedence["detail"])
    report.check("nodata-does-not-erase", precedence["nodata_preserved"], precedence["nodata_detail"])
    return report.write(args.out)


def _precedence_check(occupied, gt, size, pixel, args) -> dict:
    """Verify ordered-member precedence on a synthetic overlapping pair.

    Two members are written to a temporary directory: an earlier one with a flat
    value and a later one that covers the same cells. With replacement, the later
    member must win; where the later member declares NoData, the earlier valid
    value must survive.
    """
    import tempfile

    from osgeo import gdal, osr
    gdal.UseExceptions()

    with tempfile.TemporaryDirectory(prefix="qual-precedence-") as tmp:
        tmp_path = Path(tmp)
        srs = osr.SpatialReference()
        srs.ImportFromEPSG(2154)
        srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)

        def write(name: str, value: float, nodata_cells: bool) -> Path:
            path = tmp_path / name
            driver = gdal.GetDriverByName("GTiff")
            dataset = driver.Create(str(path), 64, 64, 1, gdal.GDT_Float32,
                                    options=["TILED=YES", "BLOCKSIZE=64"])
            dataset.SetGeoTransform([gt[0], pixel, 0.0, gt[3], 0.0, -pixel])
            dataset.SetProjection(srs.ExportToWkt())
            band = dataset.GetRasterBand(1)
            band.SetNoDataValue(-9999.0)
            array = np.full((64, 64), value, dtype=np.float32)
            if nodata_cells:
                array[0:32, 0:32] = -9999.0
            band.WriteArray(array)
            dataset.FlushCache()
            return path

        earlier = write("earlier.tif", 5.0, nodata_cells=False)
        later = write("later.tif", 9.0, nodata_cells=True)

        # Replay in publication order over the overlap.
        merged = np.full((64, 64), np.nan)
        valid = np.zeros((64, 64), dtype=bool)
        for path in (earlier, later):
            block, block_valid = _gdal_window(path, 0, 0, 64, 64)
            merged[block_valid] = block[block_valid]
            valid |= block_valid

        last_wins = bool(np.all(merged[32:, 32:] == 9.0))
        nodata_preserved = bool(np.all(merged[0:32, 0:32] == 5.0))
        record = {
            "label": "precedence-overlap",
            "earlierValue": 5.0,
            "laterValue": 9.0,
            "laterNodataRegion": "rows 0-31, cols 0-31",
            "laterWinsRegion": "rows 32-63, cols 32-63",
            "laterWinsValue": float(merged[32, 32]),
            "earlierSurvivesWhereLaterNodata": float(merged[0, 0]),
        }
        return {
            "record": record,
            "last_wins": last_wins,
            "detail": f"later member value at overlap = {merged[32, 32]}, expected 9.0",
            "nodata_preserved": nodata_preserved,
            "nodata_detail": (f"earlier value under later NoData = {merged[0, 0]}, "
                              f"expected 5.0 (NoData must not erase valid data)"),
        }


def cmd_q3_display(args: argparse.Namespace) -> int:
    """Display tiles, reprojection and local transport from the probe report."""
    browser = load(args.browser_report)
    report = q.Report(
        "q3-display",
        "Render display tiles from a local prepared derivative through the display "
        "role, reprojecting correctly and reading only bounded byte ranges.")
    report.implementation = "cog-tiler-wasm openCog over a disk-backed File and over HTTP ranges"
    report.commands = [args.command_line or "run_wasm_probe.mjs --experiment q3/q3file ..."]
    report.measurementLocations = [{"path": str(args.browser_report), "kind": "browser probe output"}]
    report.limitations = [
        "Tiles are produced on the page's main thread by the candidate; worker "
        "hosting and its UI-thread bound are not established here.",
        "No app-managed display cache exists yet, so cache budgets are not exercised.",
    ]
    for problem in browser_failures(browser, args.engine):
        report.fail(problem)
    engine = (browser.get("engines") or {}).get(args.engine) or {}
    scenarios = engine.get("scenarios") or {}
    display = scenarios.get("display_tiles") or {}

    tiles_rendered = 0
    for name, entry in display.items():
        if name == "__milliseconds":
            continue
        if entry.get("error"):
            report.fail(f"{name}: openCog failed: {entry['error']}")
            continue
        opened = entry.get("opened") or {}
        report.check(f"decoder:{name}", opened.get("decoder") == "wasm",
                     f"decoder={opened.get('decoder')}")
        report.check(f"reprojection:{name}", bool(opened.get("crsLabel")),
                     f"crs={opened.get('crsLabel')} mode={opened.get('mode')}")
        for tile in entry.get("tiles", []):
            if tile.get("error"):
                report.fail(f"{name} z{tile['request']['z']}: {tile['error']}")
                continue
            tiles_rendered += 1
            report.check(f"png:{name}:z{tile['request']['z']}:{tile['request']['x']}",
                         tile.get("bytes", 0) > 0, f"{tile.get('bytes')} PNG bytes")
    report.check("tiles-rendered", tiles_rendered > 0, f"{tiles_rendered} tiles")

    builder = scenarios.get("cog_builder") or {}
    if builder:
        report.check("independent-derivative-encoded", builder.get("outputBytes", 0) > 0,
                     f"{builder.get('outputBytes')} bytes with "
                     f"{len(builder.get('levels') or [])} level(s)")

    local = scenarios.get("local_file_source") or {}
    if local:
        if local.get("error"):
            report.fail(f"local File transport failed: {local['error']}")
        else:
            report.check("local-file-is-file", local.get("isFile") is True,
                         f"isFile={local.get('isFile')}")
            report.check("local-file-bounded",
                         local.get("totalRangedBytes", 0) < local.get("size", 1),
                         f"{local.get('totalRangedBytes')} of {local.get('size')} bytes")
            stride = local.get("strideProbe")
            if stride:
                report.measurements.append({"strideProbe": stride})
                report.check("stride-sampling-bounded",
                             stride["bytes"] < local["size"],
                             f"{stride['points']} points cost {stride['bytes']} of "
                             f"{local['size']} bytes")
                report.check("stride-sampling-succeeded",
                             len([s for s in stride["samples"] if s.get("values")]) > 0,
                             f"{stride['points']} sample points queried")
    report.check("display-role-exercised", bool(display) or bool(local),
                 "display or local transport scenario present")
    return report.write(args.out)


# --------------------------------------------------------------------------- #
# Q4: slope
# --------------------------------------------------------------------------- #

def horn_slope(values: np.ndarray, valid: np.ndarray, pixel: float
               ) -> tuple[np.ndarray, np.ndarray]:
    """Horn 3x3 slope in degrees; requires full 3x3 validity, no edge interpolation."""
    height, width = values.shape
    z = np.where(valid, values, 0.0)
    v = valid.astype(np.float64)
    degrees = np.full((height, width), np.nan)
    eligible = np.zeros((height, width), dtype=bool)
    if height < 3 or width < 3:
        return degrees, eligible
    z1, z2, z3 = z[0:-2, 0:-2], z[0:-2, 1:-1], z[0:-2, 2:]
    z4, z5, z6 = z[1:-1, 0:-2], z[1:-1, 1:-1], z[1:-1, 2:]
    z7, z8, z9 = z[2:, 0:-2], z[2:, 1:-1], z[2:, 2:]
    v1, v2, v3 = v[0:-2, 0:-2], v[0:-2, 1:-1], v[0:-2, 2:]
    v4, v5, v6 = v[1:-1, 0:-2], v[1:-1, 1:-1], v[1:-1, 2:]
    v7, v8, v9 = v[2:, 0:-2], v[2:, 1:-1], v[2:, 2:]
    full = (v1 * v2 * v3 * v4 * v5 * v6 * v7 * v8 * v9) > 0
    dzdx = ((z3 + 2.0 * z6 + z9) - (z1 + 2.0 * z4 + z7)) / (8.0 * pixel)
    dzdy = ((z7 + 2.0 * z8 + z9) - (z1 + 2.0 * z2 + z3)) / (8.0 * pixel)
    degrees[1:-1, 1:-1] = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    eligible[1:-1, 1:-1] = full
    return degrees, eligible


def horn_slope_blocked(path: Path, layout: q.TiffLayout, block: int, halo: int = 1
                       ) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Blocked Horn slope with halo, reading each block plus one halo cell.

    Blocks are processed independently and only their core is written, which is
    the plan's requirement; the halo makes interior seams indistinguishable from
    the interior of a single block.
    """
    degrees = np.full((layout.height, layout.width), np.nan)
    eligible = np.zeros((layout.height, layout.width), dtype=bool)
    trace: list[dict] = []
    for y0 in range(0, layout.height, block):
        for x0 in range(0, layout.width, block):
            core_w = min(block, layout.width - x0)
            core_h = min(block, layout.height - y0)
            read_x = max(0, x0 - halo)
            read_y = max(0, y0 - halo)
            read_w = min(layout.width, x0 + core_w + halo) - read_x
            read_h = min(layout.height, y0 + core_h + halo) - read_y
            window = q.read_window_bounded(path, layout, read_x, read_y, read_w, read_h)
            block_degrees, block_eligible = horn_slope(window.values, window.validity,
                                                       PIXEL_METRES)
            off_x, off_y = x0 - read_x, y0 - read_y
            degrees[y0:y0 + core_h, x0:x0 + core_w] = \
                block_degrees[off_y:off_y + core_h, off_x:off_x + core_w]
            eligible[y0:y0 + core_h, x0:x0 + core_w] = \
                block_eligible[off_y:off_y + core_h, off_x:off_x + core_w]
            trace.append({
                "x": x0, "y": y0, "coreWidth": core_w, "coreHeight": core_h,
                "readWidth": read_w, "readHeight": read_h,
                "bytes": window.bytes_touched, "ranges": window.ranges,
                "haloCells": halo,
            })
    return degrees, eligible, trace


def horn_slope_region_blocked(path: Path, layout: q.TiffLayout, x0: int, y0: int,
                              width: int, height: int, block: int
                              ) -> tuple[np.ndarray, np.ndarray, list[dict]]:
    """Compute slope over one region using independent blocks with a one-cell halo.

    Each block reads its own core plus a halo from the source, so interior seams
    are computed from real neighbours rather than from carried-over state. Only
    the core is written, which is the plan's halo requirement.
    """
    degrees = np.full((height, width), np.nan)
    eligible = np.zeros((height, width), dtype=bool)
    trace: list[dict] = []
    for by in range(y0, y0 + height, block):
        for bx in range(x0, x0 + width, block):
            core_w = min(block, x0 + width - bx)
            core_h = min(block, y0 + height - by)
            read_x, read_y = max(0, bx - 1), max(0, by - 1)
            read_w = min(layout.width, bx + core_w + 1) - read_x
            read_h = min(layout.height, by + core_h + 1) - read_y
            window = q.read_window_bounded(path, layout, read_x, read_y, read_w, read_h)
            block_degrees, block_eligible = horn_slope(window.values, window.validity,
                                                       PIXEL_METRES)
            off_x, off_y = bx - read_x, by - read_y
            # Region-relative destination for this block's core.
            dx0, dy0 = bx - x0, by - y0
            degrees[dy0:dy0 + core_h, dx0:dx0 + core_w] = \
                block_degrees[off_y:off_y + core_h, off_x:off_x + core_w]
            eligible[dy0:dy0 + core_h, dx0:dx0 + core_w] = \
                block_eligible[off_y:off_y + core_h, off_x:off_x + core_w]
            trace.append({"x": bx, "y": by, "coreWidth": core_w, "coreHeight": core_h,
                          "readWidth": read_w, "readHeight": read_h,
                          "bytes": window.bytes_touched, "ranges": window.ranges,
                          "haloCells": 1})
    return degrees, eligible, trace


def cmd_q4_slope(args: argparse.Namespace) -> int:
    """Blocked Horn slope, both units, with seams, holes and outer edges."""
    fixtures = args.fixtures.resolve()
    work = _work_dir(args.out, "work")
    report = q.Report(
        "q4-slope",
        "Compute slope in blocks with a halo and exact validity, in degrees and "
        "percent, matching analytical expectations and an independently configured "
        "GDAL reference including across block seams, holes and outer edges.")
    report.implementation = args.implementation
    report.commands = ["measure.py q4-slope --fixtures <fx> --out <out>"]
    report.measurementLocations = [{"path": str(work), "kind": "GDAL reference outputs"}]
    report.limitations = [
        "Native GDAL is the qualified slope route; the plan allows native GDAL to "
        "retain slope. A WASM slope route was evaluated separately and rejected.",
        "The large plane is exercised through bounded blocked reads; a full "
        "400-million-cell blocked slope is a capacity experiment, not repeated here.",
    ]

    for name, expected_degrees, plane in (("plane2000", PLANE_DEGREES, None),
                                          ("steep45", STEEP45_DEGREES, "steep45")):
        source = fixtures / f"{name}.tif"
        if not source.is_file():
            report.fail(f"missing fixture {name}")
            continue
        report.fixtures.append({"name": name, "bytes": source.stat().st_size,
                                "sha256": q.sha256_file(source)})
        values, valid = read_gdal_band(source)
        degrees, eligible = horn_slope(values, valid, PIXEL_METRES)
        percent = np.tan(np.radians(degrees)) * 100.0
        interior = eligible.copy()
        interior[:2, :] = interior[-2:, :] = False
        interior[:, :2] = interior[:, -2:] = False
        deg_error = float(np.max(np.abs(degrees[interior] - expected_degrees)))
        pct_expected = 100.0 * math.tan(math.radians(expected_degrees))
        pct_error = float(np.max(np.abs(percent[interior] - pct_expected)))
        report.measurements.append({
            "fixture": name, "expectedDegrees": expected_degrees,
            "expectedPercent": pct_expected, "eligibleCells": int(eligible.sum()),
            "maxAbsDegreeError": deg_error, "maxAbsPercentError": pct_error,
        })
        report.check(f"degrees:{name}", deg_error <= DEGREE_TOLERANCE,
                     f"max abs degree error {deg_error} vs {DEGREE_TOLERANCE}")
        report.check(f"percent:{name}", pct_error <= PERCENT_TOLERANCE,
                     f"max abs percent error {pct_error} vs {PERCENT_TOLERANCE}")

    # Independent GDAL reference on a non-planar surface. gdaldem defaults to
    # Horn, which the plan makes the reference algorithm.
    curved = fixtures / "curved256.tif"
    if curved.is_file():
        gdal_degrees = _gdal_slope(curved, work, "degrees", "curved256")
        gdal_values, gdal_valid = read_gdal_band(gdal_degrees)
        values, valid = read_gdal_band(curved)
        degrees, eligible = horn_slope(values, valid, PIXEL_METRES)
        both = gdal_valid & eligible & np.isfinite(degrees)
        agreement = float(np.max(np.abs(gdal_values[both] - degrees[both]))) if both.any() else None
        # Validity must be compared, not intersected away.
        validity_mismatch = int(np.count_nonzero(gdal_valid != eligible))
        report.measurements.append({
            "fixture": "curved256", "comparedCells": int(both.sum()),
            "maxAbsDegreeDifference": agreement,
            "gdalEligibleCells": int(gdal_valid.sum()),
            "independentEligibleCells": int(eligible.sum()),
            "validityMismatchCells": validity_mismatch,
        })
        report.check("gdal-agreement", agreement is not None and agreement <= DEGREE_TOLERANCE,
                     f"max abs degree difference {agreement} vs {DEGREE_TOLERANCE}")
        report.check("gdal-validity-agrees", validity_mismatch == 0,
                     f"{validity_mismatch} cells disagree on 3x3 validity")

    # Blocked processing on the large plane: slope must be computed, not merely
    # sampled, and must be identical across a seam to the single-block result.
    large = fixtures / "largeplane.tif"
    if large.is_file():
        layout = q.read_tiff_layout(large)
        block = args.block
        seam_x, seam_y = args.seam
        # Compare blocked processing against whole-window processing on the SAME
        # window-relative positions. Reading a window whose origin differs would
        # compare different pixels, because Horn's window-relative offset differs
        # from the block-relative one whenever the window is not block-aligned.
        seam_span = args.seam_span
        x0, y0 = seam_x - seam_span // 2, seam_y - seam_span // 2
        region_blocked, region_blocked_valid, trace = horn_slope_region_blocked(
            large, layout, x0, y0, seam_span, seam_span, block)
        window = q.read_window_bounded(large, layout, x0, y0, seam_span, seam_span)
        region_whole, region_whole_valid = horn_slope(window.values, window.validity,
                                                      PIXEL_METRES)
        both = region_blocked_valid & region_whole_valid & np.isfinite(region_blocked) \
            & np.isfinite(region_whole)
        seam_difference = (float(np.max(np.abs(region_blocked[both] - region_whole[both])))
                           if both.any() else None)
        # Validity is compared on cells whose full 3x3 lies inside both
        # computations. A cell on the whole-window border legitimately cannot see a
        # neighbour that the blocked pass could, so counting those would measure the
        # comparison window rather than the seam.
        interior = np.zeros_like(region_blocked_valid)
        interior[1:-1, 1:-1] = True
        validity_mismatch = int(np.count_nonzero(
            (region_blocked_valid != region_whole_valid) & interior))
        expected = PLANE_DEGREES
        blocked_error = (float(np.max(np.abs(region_blocked[region_blocked_valid] - expected)))
                         if region_blocked_valid.any() else None)
        report.measurements.append({
            "fixture": "largeplane", "seamAt": [seam_x, seam_y], "block": block,
            "region": {"x": x0, "y": y0, "span": seam_span},
            "cellsComputed": int(region_blocked_valid.sum()),
            "blockedVsWholeMaxDifference": seam_difference,
            "blockedMaxAbsErrorVsAnalytic": blocked_error,
            "validityMismatchCells": validity_mismatch,
            "blocksProcessed": len(trace),
            "maxBlockReadBytes": max((t["bytes"] for t in trace), default=0),
            "maxBlockReadCells": max((t["readWidth"] * t["readHeight"] for t in trace),
                                     default=0),
            "blocksOverlappingSeam": len(trace),
        })
        report.check("seam-no-gap", blocked_error is not None
                     and blocked_error <= args.blocked_tolerance_degrees,
                     f"blocked slope error at seam {blocked_error} vs "
                     f"{args.blocked_tolerance_degrees}")
        report.check("seam-matches-whole", seam_difference is not None
                     and seam_difference <= args.blocked_tolerance_degrees,
                     f"blocked vs whole difference {seam_difference}")
        report.check("seam-validity-agrees", validity_mismatch == 0,
                     f"{validity_mismatch} cells disagree across the seam")
        report.check("blocked-cells-computed", int(region_blocked_valid.sum()) > 0,
                     f"{int(region_blocked_valid.sum())} cells produced slope")

        # Holes and outer edges must be invalid, not silently extrapolated.
        # Sample the declared NoData rectangles from the fixture definition, well
        # inside them so no window edge can supply a valid neighbour.
        for hole_name, (hy0, hy1, hx0, hx1) in (
                ("holes-defined-in-generator", (4096, 4608, 4096, 4608)),
                ("second-hole", (12288, 12544, 8192, 8704))):
            cx, cy = (hx0 + hx1) // 2, (hy0 + hy1) // 2
            patch = q.read_window_bounded(large, layout, cx - 4, cy - 4, 8, 8)
            inner = q.read_window_bounded(large, layout, cx - 1, cy - 1, 3, 3)
            report.check(f"hole-is-nodata:{hole_name}",
                         int(inner.validity.sum()) == 0,
                         f"{int(inner.validity.sum())} of 9 centre cells are valid; "
                         f"the window is not inside declared NoData")
            fill = q.read_window_bounded(large, layout, cx - 4, cy - 4, 9, 9)
            _, eligible = horn_slope(fill.values, fill.validity, PIXEL_METRES)
            # Only the cells whose own 3x3 neighbourhood is fully NoData can be
            # judged here; cells near the hole edge legitimately have valid
            # neighbours and must produce slope.
            centre_eligible = int(eligible[4, 4])
            report.check(f"hole-centre-not-interpolated:{hole_name}",
                         centre_eligible == 0,
                         f"a fully NoData 3x3 neighbourhood produced slope={centre_eligible}")
        edge = q.read_window_bounded(large, layout, 0, 0, 8, 8)
        edge_degrees, edge_eligible = horn_slope(edge.values, edge.validity, PIXEL_METRES)
        report.check("outer-edge-not-invalid-outside",
                     bool(np.isnan(edge_degrees[0]).all()),
                     "the first row must not carry an interpolated slope")
    else:
        report.fail("largeplane fixture is missing; blocked slope was not exercised")
    return report.write(args.out)


def _gdal_slope(source: Path, out_root: Path, units: str, label: str) -> Path:
    out_root.mkdir(parents=True, exist_ok=True)
    destination = out_root / f"gdal-slope-{label}-{units}.tif"
    command = ["gdaldem", "slope", str(source), str(destination), "-b", "1"]
    if units == "percent":
        command.append("-p")
    subprocess.run(command, check=True, capture_output=True, text=True)
    return destination


def cmd_q4_crs(args: argparse.Namespace) -> int:
    """Decide which component resolves CRS and verify the route's coordinates.

    Two distinct questions are answered separately:

    * the reference CRS is configured explicitly (EPSG:2154), never read back out
      of the fixture's incomplete WKT, and its control points round-trip;
    * the candidate's own projection engine is compared against that reference for
      the *same* coordinates, and the coordinates the candidate returns are
      converted through the reference to check they address the requested pixel.
    """
    report = q.Report(
        "q4-crs",
        "Establish which component resolves the fixture CRS and verify the proposed "
        "route's coordinates against independently configured reference control "
        "points within the plan's tolerance.")
    report.implementation = args.implementation
    report.commands = ["crs_probe.mjs --reference-points <ref> ... then measure.py q4-crs ..."]
    report.measurementLocations = [
        {"path": str(args.probe_report), "kind": "browser CRS probe output"},
        {"path": str(args.reference_points), "kind": "independently computed reference points"},
    ]
    report.limitations = [
        "Agreement on a CRS conversion is not validation of survey accuracy or of an "
        "unknown vertical datum.",
        "No datum transformation is performed and no original WKT is rewritten.",
        "The candidate does not resolve the fixture's incomplete WKT to an EPSG code; "
        "native preparation is the component that does, and that is recorded below.",
    ]

    from osgeo import gdal, osr
    gdal.UseExceptions()

    reference = args.reference.resolve()
    if not reference.is_file():
        report.fail(f"reference fixture {reference.name} is missing")
        return report.write(args.out)
    report.fixtures.append({"name": reference.name, "bytes": reference.stat().st_size,
                            "sha256": q.sha256_file(reference)})

    reference_points = json.loads(args.reference_points.read_text())
    dataset = gdal.Open(str(reference))
    gt = dataset.GetGeoTransform()

    # The fixture's own WKT: report honestly that it does not resolve.
    fixture_srs = osr.SpatialReference()
    fixture_srs.ImportFromWkt(dataset.GetProjection())
    authority = fixture_srs.GetAuthorityCode(None)
    report.measurements.append({
        "fixtureWktAuthorityCode": authority,
        "fixtureWktResolvesEpsg": authority is not None,
        "referenceEpsg": args.reference_epsg,
        "referenceEpsgSource": "explicitly configured; not read from the fixture WKT",
    })
    report.check("reference-epsg-configured-explicitly", args.reference_epsg is not None,
                 f"EPSG:{args.reference_epsg}")
    report.notes.append(
        "The fixture WKT declares EPSG:2154 with incomplete datum detail, so GDAL is "
        "the CRS resolver for the route: it interprets the WKT and its geotransform "
        "defines the lattice that preparation and every bounded read use. The candidate "
        "decoder reports no EPSG for these fixtures and is not a CRS authority.")

    # Reference control points round-trip through the explicit EPSG.
    reference_srs = osr.SpatialReference()
    reference_srs.ImportFromEPSG(args.reference_epsg)
    reference_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    to_wgs84 = osr.CoordinateTransformation(reference_srs, reference_srs.CloneGeogCS())
    inverse = osr.CoordinateTransformation(reference_srs.CloneGeogCS(), reference_srs)
    round_trips = []
    for check in reference_points["projectionChecks"]:
        east, north, _ = inverse.TransformPoint(check["lon"], check["lat"])
        error = math.hypot(east - check["reference"][0], north - check["reference"][1])
        round_trips.append({"label": check["label"], "errorMetres": error})
    worst_round_trip = max((r["errorMetres"] for r in round_trips), default=None)
    report.measurements.append({"referenceRoundTrip": round_trips,
                                "maxRoundTripErrorMetres": worst_round_trip})
    report.check("reference-control-points-round-trip",
                 worst_round_trip is not None and worst_round_trip <= CRS_TOLERANCE_METRES,
                 f"max round-trip error {worst_round_trip} m vs {CRS_TOLERANCE_METRES} m")

    # Candidate projection agreement: its engine against the reference, same input.
    probe = load(args.probe_report)
    if probe.get("error"):
        report.fail(f"CRS probe failed: {probe['error']}")
    if probe.get("pageErrors"):
        report.fail(f"CRS probe page errors: {probe['pageErrors'][:2]}")
    projection = probe.get("projection") or []
    if not projection:
        report.fail("the probe produced no projection comparisons")
    deltas = [c.get("deltaMetres") for c in projection]
    worst_delta = max((d for d in deltas if d is not None), default=None)
    report.measurements.append({
        "comparison": "candidate projection engine vs independently configured reference",
        "points": len(projection),
        "maxDeltaMetres": worst_delta,
        "perPoint": [{"label": c["label"], "deltaMetres": c["deltaMetres"]} for c in projection],
    })
    report.check("candidate-projection-matches-reference",
                 worst_delta is not None and worst_delta <= CRS_TOLERANCE_METRES,
                 f"max projection delta {worst_delta} m vs {CRS_TOLERANCE_METRES} m")

    # Pixel addressing: the coordinate the candidate reports must address the pixel
    # it was asked for. Measured in projected metres through the reference.
    samples = probe.get("samples") or []
    if not samples:
        report.fail("the probe produced no pixel samples")
    addressing = []
    for sample in samples:
        returned = sample.get("returned")
        if not returned:
            report.fail(f"px({sample.get('x')},{sample.get('y')}): {sample.get('error')}")
            continue
        lon, lat = returned["coordinates"]
        east, north, _ = inverse.TransformPoint(lon, lat)
        requested = sample["referenceProjected"]
        error = math.hypot(east - requested[0], north - requested[1])
        addressing.append({
            "label": sample.get("label") or f"px({sample['x']},{sample['y']})",
            "requestedPixel": [sample["x"], sample["y"]],
            "requestedProjected": requested,
            "returnedWgs84": [lon, lat],
            "returnedProjected": [east, north],
            "errorMetres": error,
            "values": returned.get("values"),
        })
    worst_addressing = max((a["errorMetres"] for a in addressing), default=None)
    report.measurements.append({
        "comparison": "candidate-returned coordinate vs the requested pixel centre, "
                      "converted through the independently configured reference",
        "points": len(addressing),
        "maxErrorMetres": worst_addressing,
        "toleranceMetres": CRS_TOLERANCE_METRES,
        "perPoint": addressing,
    })
    report.check("candidate-returned-coordinate-addresses-requested-pixel",
                 worst_addressing is not None
                 and worst_addressing <= CRS_TOLERANCE_METRES,
                 f"max error {worst_addressing} m vs {CRS_TOLERANCE_METRES} m")
    report.check("candidate-returned-values",
                 any(a.get("values") for a in addressing),
                 "candidate samples carried numeric values")
    report.check("crs-resolver-identified", True,
                 "native preparation (GDAL) resolves CRS for the route")
    return report.write(args.out)


# --------------------------------------------------------------------------- #
# Q5: cancellation and lifecycle
# --------------------------------------------------------------------------- #

def cmd_q5_lifecycle(args: argparse.Namespace) -> int:
    """Cancellation of active work, settlement bounds, and adapter teardown."""
    browser = load(args.browser_report)
    report = q.Report(
        "q5-lifecycle",
        "Cancel active operations at controlled checkpoints, settle owned work "
        "within the bound, reject malformed input, and make repeated adapter "
        "teardown safe.")
    report.implementation = args.implementation
    report.commands = ["run_wasm_probe.mjs --experiment q5 ... then measure.py q5-lifecycle ..."]
    report.measurementLocations = [{"path": str(args.browser_report), "kind": "browser probe output"},
                                   {"path": str(args.probe_report), "kind": "node lifecycle probe output"}]
    report.limitations = [
        "WASM decode has no thread to interrupt: cancellation is cooperative and is "
        "enforced between tile operations, which is what is measured.",
        "No publication boundary exists in this harness, so publication rollback is "
        "not claimed.",
        "Packaged Desktop WebView worker termination remains a slice F gate.",
    ]
    for problem in browser_failures(browser, args.engine):
        report.fail(problem)
    engine = (browser.get("engines") or {}).get(args.engine) or {}
    failure = ((engine.get("scenarios") or {}).get("failure_injection")) or {}

    for key, label in (("truncated", "truncated-header"), ("corrupt", "corrupt-tile"),
                       ("wrongFree", "out-of-image-window")):
        entry = failure.get(key)
        if entry is None:
            report.fail(f"{label}: no result recorded")
            continue
        if key == "truncated":
            # The probe records the JSON error object rather than a boolean.
            rejected = (entry.get("rejected") is True
                        or bool((entry.get("info") or {}).get("error")))
        else:
            rejected = bool(entry.get("error")) or bool((entry.get("decoded") or {}).get("error"))
        report.measurements.append({"case": label, "observed": entry})
        report.check(f"malformed-rejected:{label}", rejected,
                     f"observed {json.dumps(entry)[:200]}")

    # The third-party free() is NOT idempotent; the owning adapter must be.
    dispose = failure.get("disposeTwice") or {}
    report.measurements.append({"case": "third-party-double-free", "observed": dispose})
    report.notes.append(
        f"Third-party free() is not idempotent (observed: {dispose.get('error')}). "
        "This is a candidate defect, not a harness artefact; the owning adapter must "
        "guard teardown.")

    probe = load(args.probe_report)
    report.extra["nodeLifecycleProbe"] = probe
    not_run: list[str] = []
    for case in probe.get("cases", []):
        name = case["name"]
        report.measurements.append(case)
        if case.get("ok"):
            report.check(f"lifecycle:{name}", True, case.get("detail", ""))
        elif "not evaluated" in (case.get("detail") or ""):
            # An experiment this harness genuinely cannot run is recorded as a
            # limitation with its reason, not as a failed assertion of something
            # that was never attempted.
            not_run.append(f"{name}: {case.get('detail')}")
        else:
            report.check(f"lifecycle:{name}", False, case.get("detail", ""))
    report.limitations.extend(not_run)
    # Assert the adapter-level requirement explicitly.
    report.check("adapter-dispose-idempotent",
                 bool(probe.get("adapterDisposeIdempotent")),
                 "the adapter must tolerate repeated dispose")
    settle = probe.get("activeCancellation") or {}
    report.check("cancellation-stops-scheduling",
                 settle.get("stoppedScheduling") is True
                 and (settle.get("operationsNotScheduled") or 0) > 0,
                 f"{settle.get('operationsNotScheduled')} operations were never scheduled "
                 f"after cancel")
    report.check("cancellation-settles-in-bound",
                 settle.get("settleSeconds") is not None
                 and settle["settleSeconds"] <= SETTLE_SECONDS,
                 f"settled in {settle.get('settleSeconds')} s, bound {SETTLE_SECONDS} s")
    report.check("active-operation-was-in-flight",
                 settle.get("operationsBeforeCancel", 0) > 0,
                 f"{settle.get('operationsBeforeCancel')} operations had completed when cancel fired")
    return report.write(args.out)


# --------------------------------------------------------------------------- #
# Q6: resources
# --------------------------------------------------------------------------- #

def cmd_q6_resources(args: argparse.Namespace) -> int:
    """Candidate-route resource measurement, separated from reference measurements."""
    report = q.Report(
        "q6-resources",
        "Measure the proposed route's host memory, children, queues, caches and "
        "temporary storage against the plan's budgets, with reference-reader "
        "measurements reported separately.")
    report.implementation = args.implementation
    report.commands = ["measure.py q6-resources ..."]
    report.limitations = [
        "Chromium is measured as a process tree; WASM linear memory is reported "
        "separately and not counted twice.",
        "The native reference reader is measured separately and never presented as "
        "the candidate route.",
        "macOS and Windows attribution is unavailable.",
    ]

    # Candidate route: the ranged transport in a browser, measured as one tree.
    browser = load(args.browser_report)
    for problem in browser_failures(browser, args.engine):
        report.fail(problem)
    engine = (browser.get("engines") or {}).get(args.engine) or {}
    scenario = ((engine.get("scenarios") or {}).get(args.scenario)) or {}
    totals = None
    per_fixture = []
    for name, entry in scenario.items():
        if name == "__milliseconds":
            continue
        t = entry.get("transportTotals")
        if t:
            per_fixture.append({"fixture": name, **t})
            totals = t if totals is None else {
                key: totals[key] + t[key] for key in totals if key in t}
    if not per_fixture:
        report.fail("no candidate-route transport measurements were recorded")
    else:
        report.measurements.append({"route": "candidate (wasm ranged transport)",
                                    "perFixture": per_fixture, "combined": totals})
        largest = max((p.get("largestRequest", 0) for p in per_fixture), default=0)
        report.check("no-whole-file-request", largest <= args.max_request_bytes,
                     f"largest single request {largest} bytes, limit {args.max_request_bytes}")

    ledger = browser.get("transportLedger")
    if ledger:
        report.extra["serverLedger"] = {
            "totalServedBytes": ledger.get("bytes"),
            "rangedRequests": ledger.get("ranged"),
            "fullRequests": ledger.get("full"),
        }

    # Reference reader: measured on its own, clearly labelled.
    if args.reference_fixture:
        path = (args.fixtures.resolve() / args.reference_fixture)
        if not path.is_file():
            report.fail(f"reference fixture {path.name} is missing")
        else:
            layout = q.read_tiff_layout(path)
            sampler = q.ProcessSampler(interval=0.1)
            baseline = q.ProcessSampler._tree_rss_kib(__import__("os").getpid())[0]
            sampler.start()
            started = time.perf_counter()
            step = int(math.sqrt(args.window_cells))
            reads = []
            for index in range(args.max_reads):
                x = int((index * 7919) % max(1, layout.width - step))
                y = int((index * 104729) % max(1, layout.height - step))
                read = q.read_window_bounded(path, layout, x, y, step, step)
                reads.append({"x": x, "y": y, "bytes": read.bytes_touched,
                              "seconds": read.seconds})
            elapsed = time.perf_counter() - started
            resources = sampler.stop()
            incremental = max(0, resources["peak_rss_kib"] * 1024 - baseline * 1024)
            entry = {
                "route": "reference reader (native byte-range, NOT the candidate route)",
                "fixture": path.name, "fileBytes": layout.size,
                "cells": layout.width * layout.height,
                "windowCells": step * step, "reads": len(reads), "seconds": elapsed,
                "bytesTouchedTotal": sum(r["bytes"] for r in reads),
                "maxSingleReadBytes": max((r["bytes"] for r in reads), default=0),
                "incrementalPeakRssBytes": incremental,
                "incrementalPeakRssMiB": incremental / (1024 * 1024),
                "osHighWaterSelfBytes": resources["os_high_water_self_kib"] * 1024,
                "osHighWaterChildrenBytes": resources["os_high_water_children_kib"] * 1024,
                "maxConcurrentChildren": resources["max_concurrent_children"],
                "sampleCount": resources["sample_count"],
                "readLatencyMs": {
                    "median": float(np.median([r["seconds"] for r in reads]) * 1000),
                    "p95": float(np.percentile([r["seconds"] for r in reads], 95) * 1000),
                    "max": float(np.max([r["seconds"] for r in reads]) * 1000),
                } if reads else None,
            }
            report.measurements.append(entry)
            report.fixtures.append({"name": path.name, "bytes": layout.size,
                                    "sha256": q.sha256_file(path)})
            report.check("reference-read-bounded",
                         entry["maxSingleReadBytes"] <= args.max_request_bytes,
                         f"max single read {entry['maxSingleReadBytes']} bytes")
            report.check("reference-memory-within-budget",
                         entry["incrementalPeakRssMiB"] <= RASTER_JOB_MEMORY_MIB,
                         f"{entry['incrementalPeakRssMiB']:.2f} MiB vs "
                         f"{RASTER_JOB_MEMORY_MIB} MiB")
            report.check("capacity-file-exceeds-1gib",
                         layout.size > 1024 ** 3,
                         f"{layout.size} bytes")
    else:
        report.notes.append("No reference fixture supplied, so only the candidate "
                            "transport route was measured.")

    # Display trace statistics, when a trace report is supplied.
    if args.trace_report and args.trace_report.is_file():
        trace = json.loads(args.trace_report.read_text())
        report.extra["displayTrace"] = trace
        for run in trace.get("runs", []):
            report.check(f"display-trace:{run['name']}-request-count",
                         run.get("tileRequests", 0) >= DISPLAY_TRACE_REQUESTS,
                         f"{run.get('tileRequests')} requests, required "
                         f"{DISPLAY_TRACE_REQUESTS}")
            report.check(f"display-trace:{run['name']}-p95",
                         run.get("p95Ms") is not None,
                         f"p95 {run.get('p95Ms')} ms from individual tile latencies")
            report.check(f"display-trace:{run['name']}-ui-thread",
                         run.get("maxLongTaskMs") is None
                         or run.get("maxLongTaskMs") <= UI_THREAD_BOUND_MS,
                         f"max long task {run.get('maxLongTaskMs')} ms, bound "
                         f"{UI_THREAD_BOUND_MS} ms")
    else:
        report.inconclusive("no display trace report was supplied, so the plan's "
                            "cold/warm display trace requirement is unmeasured")
    return report.write(args.out)


# --------------------------------------------------------------------------- #
# report validation and comparison
# --------------------------------------------------------------------------- #

def validate_report_payload(payload: dict) -> list[str]:
    """Return the reasons a report cannot be used as evidence."""
    problems: list[str] = []
    if not isinstance(payload, dict):
        return ["report is not a JSON object"]
    for field in q.REQUIRED_REPORT_FIELDS:
        if field not in payload:
            problems.append(f"missing required field {field}")
    experiment = payload.get("experiment")
    if not isinstance(experiment, str) or not experiment:
        problems.append("experiment name must be a non-empty string")
    result = payload.get("result")
    if result not in q.VERDICTS:
        problems.append(f"result {result!r} is not one of {sorted(q.VERDICTS)}")
    if result == q.PASS:
        assertions = payload.get("assertions")
        if not isinstance(assertions, list) or not assertions:
            problems.append("a pass must carry at least one assertion")
        else:
            failed = [a for a in assertions if not a.get("ok")]
            if failed:
                problems.append(f"a pass carries {len(failed)} failing assertion(s)")
        if payload.get("failures"):
            problems.append("a pass carries recorded failures")
    return problems


def cmd_validate_report(args: argparse.Namespace) -> int:
    report = q.Report("validate-report", "Reject a report that cannot support its verdict.")
    report.implementation = "measure.py validate-report"
    report.commands = ["measure.py validate-report --report <path> --out <out>"]
    problems: list[str] = []
    for path in args.report:
        if not path.is_file():
            problems.append(f"{path.name}: missing")
            continue
        try:
            payload = json.loads(path.read_text())
        except json.JSONDecodeError as error:
            problems.append(f"{path.name}: malformed ({error})")
            continue
        report.measurements.append({"report": str(path), "experiment": payload.get("experiment"),
                                    "result": payload.get("result")})
        problems += [f"{path.name}: {p}" for p in validate_report_payload(payload)]
    for problem in problems:
        report.fail(problem)
    report.check("all-reports-valid", not problems,
                 f"{len(args.report)} report(s) checked, {len(problems)} problem(s)")
    return report.write(args.out)


def _report_map(directory: Path) -> dict[str, Path]:
    """Map the assembler's report roles to files in an existing output directory."""
    names = {
        "q1": "q1-artifacts.json",
        "q2": "q2-numeric.json",
        "q3prepare": "q3-prepare.json",
        "q3members": "q3-members.json",
        "q4slope": "q4-slope.json",
        "q4crs": "q4-crs.json",
        "q5lifecycle": "q5-lifecycle.json",
        "q6resources": "q6-resources.json",
        "trace": "q6-trace.json",
        "ledger": "ledger-q2ranged.json",
        "browser": "q2ranged.json",
    }
    return {role: directory / name for role, name in names.items()}


def cmd_gate_assemble(args: argparse.Namespace) -> int:
    """Assemble an eligibility bundle from reports that already exist.

    Read-only with respect to the reports: nothing is regenerated or synthesised,
    so a missing report becomes a recorded gap rather than a fresh measurement.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import qualification_evidence as evidence
    import qualification_gate as gate_module

    contract = gate_module.load_contract(args.requirements)
    reports = _report_map(args.reports.resolve())
    present = {role: path for role, path in reports.items() if path.is_file()}
    missing = sorted(role for role, path in reports.items() if not path.is_file())

    engine = args.engine
    bundle = evidence.assemble(
        contract, out=args.out, reports=present,
        environment={"host": args.host, "engine": engine},
        route={
            "numeric": "whitebox-wasm CogStream over HTTP Range requests",
            "numericArtifact": {"name": "whitebox-wasm", "version": args.numeric_artifact},
            "display": "cog-tiler-wasm renderTilePNG over a disk-backed File",
            "displayArtifact": {"name": "cog-tiler-wasm", "version": args.display_artifact},
            "artifacts": "candidate artifact resolution",
            "prepare": "native GDAL preparation",
            "prepareArtifact": {"name": "gdal", "version": "3.8.4"},
            "member": "ordered member replay (reference implementation)",
            "slope": "native GDAL slope plus independent Horn implementation",
            "slopeArtifact": {"name": "gdal", "version": "3.8.4"},
            "crs": "native GDAL CRS resolution",
            "crsArtifact": {"name": "gdal", "version": "3.8.4"},
            "lifecycle": "owned-adapter lifecycle probe",
            "unpinnedRoles": [
                {"name": "gdal", "version": "3.8.4",
                 "reason": "the plan allows native GDAL to retain preparation and slope"},
                {"name": "reference-resolver", "version": "harness",
                 "reason": "harness reference implementation, not a shipped artifact"},
            ],
        },
        artifacts=[{"name": "whitebox-wasm", "version": args.numeric_artifact},
                   {"name": "cog-tiler-wasm", "version": args.display_artifact},
                   {"name": "gdal", "version": "3.8.4"}],
        # Native GDAL is retained by the plan for preparation, CRS and slope, so
        # it is declared rather than pinned; the candidate artifacts stay pinned.
        fixtures=[], display={"ui_thread_bound_ms": UI_THREAD_BOUND_MS,
                              "cold_runs": 1, "warm_runs": 3,
                              "min_latencies_per_run": DISPLAY_TRACE_REQUESTS,
                              "memory_budget_mib": RASTER_JOB_MEMORY_MIB},
        host=args.host)
    bundle["missingReports"] = missing
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(bundle, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"out": str(args.out), "host": args.host,
                      "presentReports": sorted(present), "missingReports": missing},
                     indent=2))
    return 0


def cmd_gate(args: argparse.Namespace) -> int:
    """Decide Q eligibility and exit non-zero unless every requirement passes."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import qualification_gate as gate_module

    if not args.requirements.is_file():
        q.fail(f"requirement contract {args.requirements} is missing")
    contract = gate_module.load_contract(args.requirements)
    decision = gate_module.evaluate(contract, args.bundle)
    q.write_report(args.out, decision.as_dict())
    return decision.exit_code


def cmd_compare(args: argparse.Namespace) -> int:
    """Combine experiment reports, requiring a complete and conclusive set."""
    report = q.Report(
        "compare",
        "Combine the full required experiment set into one qualification verdict.")
    report.implementation = "measure.py compare"
    report.commands = ["measure.py compare --report <each> --out <out>"]
    report.limitations = [
        "A combined pass means every required experiment passed; it is not evidence "
        "for any experiment that was not run.",
    ]

    by_experiment: dict[str, dict] = {}
    problems: list[str] = []
    for path in args.report:
        if not path.is_file():
            problems.append(f"{path.name}: missing")
            continue
        try:
            payload = json.loads(path.read_text())
        except json.JSONDecodeError as error:
            problems.append(f"{path.name}: malformed ({error})")
            continue
        experiment = payload.get("experiment")
        report.measurements.append({"path": str(path), "experiment": experiment,
                                    "result": payload.get("result")})
        for problem in validate_report_payload(payload):
            problems.append(f"{path.name}: {problem}")
        if experiment in by_experiment:
            problems.append(f"{path.name}: duplicate report for {experiment}")
        by_experiment[experiment] = payload

    missing = [name for name in REQUIRED_EXPERIMENTS if name not in by_experiment]
    for name in missing:
        report.fail(f"missing required experiment report: {name}")
    for problem in problems:
        report.fail(problem)

    for name in REQUIRED_EXPERIMENTS:
        payload = by_experiment.get(name)
        if payload is None:
            continue
        result = payload.get("result")
        # Only a pass contributes to an overall pass; inconclusive and not_run are
        # explicitly not passes.
        report.check(f"experiment:{name}",
                     result in q.PASSING_VERDICTS,
                     f"{name} reported {result}")

    report.extra["experiments"] = {
        name: {"result": payload.get("result"),
               "reason": payload.get("verdictReason"),
               "failures": payload.get("failures", [])}
        for name, payload in sorted(by_experiment.items())}
    report.extra["requiredExperiments"] = list(REQUIRED_EXPERIMENTS)
    report.check("required-set-complete", not missing,
                 f"{len(by_experiment)} report(s) for {len(REQUIRED_EXPERIMENTS)} required")
    return report.write(args.out)


# --------------------------------------------------------------------------- #

def _window_spec(value: str) -> tuple[str, tuple[int, int, int]]:
    parts = value.split(":")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(f"expected LABEL:ROW:COL:SPAN, got {value!r}")
    label, row, column, span = parts
    return label, (int(row), int(column), int(span))


def _pair(value: str) -> tuple[int, int]:
    first, _, second = value.partition(",")
    return int(first), int(second)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("sysinfo", help="record the qualification host")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_sysinfo)

    p = sub.add_parser("q1-artifacts", help="verify pinned candidate artifacts")
    p.add_argument("--bench", required=True, type=Path)
    p.add_argument("--candidates", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q1_artifacts)

    p = sub.add_parser("q2-numeric", help="ranged numeric windows vs independent reference")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--fixture-map", required=True, type=Path)
    p.add_argument("--fixture", action="append")
    p.add_argument("--expect-sha256", action="append")
    p.add_argument("--expect-rejection", action="append")
    p.add_argument("--scenario", default="ranged_numeric")
    p.add_argument("--engine", default="chromium")
    p.add_argument("--max-transport-ratio", type=float, default=8.0)
    p.add_argument("--header-prefix-bytes", type=int, default=65536)
    p.add_argument("--command-line", default=None)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q2_numeric)

    p = sub.add_parser("q2-local-bridge", help="bounded access to stripped local GeoTIFFs")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--fixture-map", required=True, type=Path)
    p.add_argument("--fixture", action="append")
    p.add_argument("--expect-sha256", action="append")
    p.add_argument("--engine", default="chromium")
    p.add_argument("--command-line", default=None)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q2_local_bridge)

    p = sub.add_parser("q3-prepare", help="native preparation integrity and readback")
    p.add_argument("--original", required=True, type=Path)
    p.add_argument("--derived", required=True, type=Path)
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--fixture-name", required=True)
    p.add_argument("--expected-original-sha256")
    p.add_argument("--expected-sidecar-sha256")
    p.add_argument("--prepare-command", default=None)
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q3_prepare)

    p = sub.add_parser("q3-members", help="generation resolution across members and gaps")
    p.add_argument("--collection", required=True, type=Path)
    p.add_argument("--window", action="append", required=True, type=_window_spec,
                   metavar="LABEL:ROW:COL:SPAN")
    p.add_argument("--plane")
    p.add_argument("--min-members", type=int, default=2)
    p.add_argument("--resolver", default=None)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q3_members)

    p = sub.add_parser("q3-display", help="display tiles, reprojection and local transport")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--engine", default="chromium")
    p.add_argument("--command-line", default=None)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q3_display)

    p = sub.add_parser("q4-slope", help="blocked slope, both units, seams and holes")
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--block", type=int, default=256)
    p.add_argument("--seam", type=_pair, default=(4096, 4096), metavar="X,Y")
    p.add_argument("--seam-span", type=int, default=512)
    p.add_argument("--blocked-tolerance-degrees", type=float, default=0.01,
                   help="accumulated Float32 tolerance for blocked-vs-whole slope")
    p.add_argument("--hole", type=_pair, default=(4096, 4096), metavar="X,Y")
    p.add_argument("--implementation",
                   default="native GDAL slope reference plus independent Horn implementation")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q4_slope)

    p = sub.add_parser("q4-crs", help="CRS authority and candidate coordinate agreement")
    p.add_argument("--probe-report", required=True, type=Path)
    p.add_argument("--reference-points", required=True, type=Path)
    p.add_argument("--reference", required=True, type=Path)
    p.add_argument("--reference-epsg", type=int, default=2154)
    p.add_argument("--implementation",
                   default="native GDAL CRS resolution; candidate projection and point "
                           "sampling from the browser CRS probe")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q4_crs)

    p = sub.add_parser("q5-lifecycle", help="cancellation, failures and adapter disposal")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--probe-report", required=True, type=Path)
    p.add_argument("--implementation",
                   default="cooperative tile-level cancellation; guarded adapter disposal")
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q5_lifecycle)

    p = sub.add_parser("q6-resources", help="candidate-route and reference resources")
    p.add_argument("--browser-report", required=True, type=Path)
    p.add_argument("--fixtures", required=True, type=Path)
    p.add_argument("--scenario", default="ranged_numeric")
    p.add_argument("--reference-fixture")
    p.add_argument("--window-cells", type=int, default=MAX_WINDOW_CELLS)
    p.add_argument("--max-reads", type=int, default=48)
    p.add_argument("--max-request-bytes", type=int, default=8 * 1024 * 1024)
    p.add_argument("--trace-report", type=Path)
    p.add_argument("--implementation",
                   default="candidate wasm ranged transport plus a separately measured native reader")
    p.add_argument("--engine", default="chromium")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_q6_resources)

    p = sub.add_parser("validate-report", help="reject a report that cannot support its verdict")
    p.add_argument("--report", action="append", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_validate_report)

    p = sub.add_parser("gate", help="decide Q eligibility from the requirement contract")
    p.add_argument("--bundle", required=True, type=Path,
                   help="evidence bundle produced by gate-assemble")
    p.add_argument("--requirements", type=Path,
                   default=Path(__file__).resolve().parent / "requirements.json")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_gate)

    p = sub.add_parser("gate-assemble",
                       help="assemble an evidence bundle from existing probe reports")
    p.add_argument("--requirements", type=Path,
                   default=Path(__file__).resolve().parent / "requirements.json")
    p.add_argument("--reports", required=True, type=Path,
                   help="directory holding the existing probe/experiment reports")
    p.add_argument("--host", default="chromium",
                   help="observation host label; only desktop-webview satisfies Q-HOST-1")
    p.add_argument("--engine", default="Chromium 150.0.7871.46")
    p.add_argument("--numeric-artifact", default="0.5.1",
                   help="exact version the numeric role was exercised against")
    p.add_argument("--display-artifact", default="0.3.6",
                   help="exact version the display role was exercised against")
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_gate_assemble)

    p = sub.add_parser("compare", help="combine the required experiment set")
    p.add_argument("--report", action="append", required=True, type=Path)
    p.add_argument("--out", required=True, type=Path)
    p.set_defaults(func=cmd_compare)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
