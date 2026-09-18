#!/usr/bin/env python3
"""Fail-closed regression tests for the raster qualification harness.

These tests are deliberately small, deterministic and free of private fixtures:
every case builds a throwaway output root under the platform temporary directory
and drives the measurement CLI as a subprocess, asserting on both the
machine-readable report and the process exit status.

They exist because an earlier revision of this harness reported `pass` for
inconclusive input. A qualification harness that cannot fail is worse than no
harness, so each test below encodes one way the harness must refuse to pass.

Run with either::

    python3 scripts/raster-qualification/tests/test_qualification_verdicts.py
    python3 -m unittest discover -s scripts/raster-qualification/tests
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent
MEASURE = HARNESS / "measure.py"


def run_measure(*args: str) -> tuple[int, dict | None, str]:
    """Run a measure.py subcommand; return (exit code, parsed --out report, stderr)."""
    result = subprocess.run([sys.executable, str(MEASURE), *args],
                            capture_output=True, text=True)
    out_path = None
    for index, value in enumerate(args):
        if value == "--out" and index + 1 < len(args):
            out_path = Path(args[index + 1])
    report = None
    if out_path and out_path.is_file():
        try:
            report = json.loads(out_path.read_text())
        except json.JSONDecodeError:
            report = None
    return result.returncode, report, result.stderr


class TempRoot(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="qual-verdict-")
        self.root = Path(self._temp.name)

    def tearDown(self) -> None:
        self._temp.cleanup()

    def write(self, name: str, payload: object) -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload))
        return path

    def browser_report(self, scenarios: dict, *, ok: bool = True,
                       engine: str = "chromium") -> Path:
        return self.write("browser.json", {
            "experiment": "q2",
            "engines": {engine: {"available": True, "ok": ok,
                                 "scenarios": scenarios, "errors": []}},
        })

    def fixture_map(self) -> Path:
        return self.write("fixture-map.json", {"fixture": "fixture.tif"})

    def fixture(self, name: str = "fixture.tif") -> Path:
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
        return path


class Q2Verdicts(TempRoot):
    """Q2 numeric comparison must pass only on measured, matching windows."""

    def test_decoder_failure_is_not_a_pass(self) -> None:
        """A stream error that prevents every window read must fail closed."""
        report = self.browser_report({
            "ranged_numeric": {
                "fixture": {"bytes": 100, "streamError": "image is striped, not tiled; "
                                                       "tile range streaming requires a tiled COG",
                            "windows": [], "info": {}, "levels": None},
            },
        })
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0, "decoder failure must not exit 0")
        self.assertIsNotNone(payload)
        self.assertEqual(payload["result"], "fail")
        self.assertTrue(payload["failures"], "a fail verdict must name its failures")

    def test_zero_windows_is_not_a_pass(self) -> None:
        """A successful stream with no windows tested proves nothing."""
        report = self.browser_report({
            "ranged_numeric": {
                "fixture": {"bytes": 100, "streamError": None, "windows": [], "info": {},
                            "levels": [{"level": 0}]},
            },
        })
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0, "zero tested windows must not exit 0")
        self.assertEqual(payload["result"], "fail")

    def test_missing_fixture_name_is_not_a_pass(self) -> None:
        """A required fixture absent from the report must fail, not be ignored."""
        report = self.browser_report({"ranged_numeric": {}})
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0)
        self.assertEqual(payload["result"], "fail")

    def test_fixture_hash_mismatch_fails(self) -> None:
        """A fixture whose hash does not match the declared identity must fail."""
        fixture = self.fixture()
        report = self.browser_report({
            "ranged_numeric": {
                "fixture": {"bytes": 0, "streamError": None, "info": {},
                            "levels": [{"level": 0}],
                            "windows": [{"spec": {"x": 0, "y": 0, "w": 1, "h": 1,
                                                  "label": "one"},
                                         "tiles": 1, "bytesFetched": 4,
                                         "milliseconds": 1.0, "values": [0.0],
                                         "sample": [0.0]}]},
            },
        })
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"),
            "--expect-sha256", "fixture=0000000000000000000000000000000000000000"
                               "000000000000000000000000")
        self.assertNotEqual(code, 0, "a hash mismatch must not exit 0")
        self.assertEqual(payload["result"], "fail")
        self.assertTrue(any("hash" in f.lower() for f in payload["failures"]),
                        f"failures must name the hash problem: {payload['failures']}")


class Q2NegativeControls(TempRoot):
    """Expected rejections must be declared and asserted, not counted as failures."""

    def test_undeclared_error_is_a_failure(self) -> None:
        report = self.browser_report({
            "ranged_numeric": {
                "fixture": {"bytes": 100, "streamError": None, "info": {},
                            "levels": [{"level": 0}],
                            "windows": [{"spec": {"x": 0, "y": 0, "w": 1, "h": 1,
                                                  "label": "boom"},
                                         "error": "surprise engine explosion"}]},
            },
        })
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0)
        self.assertEqual(payload["result"], "fail")

    def test_declared_negative_control_is_asserted_not_failed(self) -> None:
        """A window declared as an expected rejection must be asserted, and it
        must be a hard failure if the expectation is not met."""
        report = self.browser_report({
            "ranged_numeric": {
                "fixture": {"bytes": 100, "streamError": None, "info": {},
                            "levels": [{"level": 0}],
                            "windows": [
                                {"spec": {"x": 0, "y": 0, "w": 1, "h": 1,
                                          "label": "expected-rejection"},
                                 "error": "window origin outside image"},
                                {"spec": {"x": 0, "y": 0, "w": 1, "h": 1,
                                          "label": "must-succeed"},
                                 "tiles": 1, "bytesFetched": 4, "milliseconds": 1.0,
                                 "values": [0.0], "sample": [0.0]},
                            ]},
            },
        })
        # `must-succeed` cannot be validated because its fixture is absent from
        # disk, so this run must still fail; the point of the case is that the
        # declared rejection itself is not reported as an unexpected failure.
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"),
            "--expect-rejection", "expected-rejection")
        self.assertIsNotNone(payload)
        declared = [c for c in payload.get("measurements", [])
                    if c.get("label") == "expected-rejection"]
        self.assertTrue(declared, "the declared rejection must appear in windows")
        self.assertEqual(declared[0].get("classification"), "expected-rejection")
        self.assertFalse(any("expected-rejection" in f for f in payload["failures"]),
                         f"a satisfied negative control must not be a failure: "
                         f"{payload['failures']}")

    def test_unsatisfied_negative_control_fails(self) -> None:
        """If a window declared as an expected rejection succeeds, that is a failure."""
        report = self.browser_report({
            "ranged_numeric": {
                "fixture": {"bytes": 100, "streamError": None, "info": {},
                            "levels": [{"level": 0}],
                            "windows": [
                                {"spec": {"x": 0, "y": 0, "w": 1, "h": 1,
                                          "label": "expected-rejection"},
                                 "tiles": 1, "bytesFetched": 4, "milliseconds": 1.0,
                                 "values": [0.0], "sample": [0.0]},
                            ]},
            },
        })
        code, payload, _ = run_measure(
            "q2-numeric", "--browser-report", str(report),
            "--fixtures", str(self.root), "--fixture-map", str(self.fixture_map()),
            "--fixture", "fixture", "--out", str(self.root / "out.json"),
            "--expect-rejection", "expected-rejection")
        self.assertNotEqual(code, 0)
        self.assertEqual(payload["result"], "fail")
        self.assertTrue(any("expected-rejection" in f for f in payload["failures"]))


class CompareVerdicts(TempRoot):
    """The combined verdict must require a complete, conclusive experiment set."""

    EXPERIMENTS = ["q1-artifacts", "q2-local-bridge", "q2-numeric", "q3-prepare",
                   "q3-members", "q3-display", "q4-slope", "q4-crs",
                   "q5-lifecycle", "q6-resources"]

    def report(self, name: str, experiment: str, result: str) -> Path:
        payload = {
            "experiment": experiment, "result": result, "failures": [],
            "requiredBehavior": "declared behavior", "implementationExercised": "harness",
            "commands": ["run"], "fixtures": [], "measurementLocations": [],
            "limitations": [], "assertions": [{"name": "a", "ok": True, "detail": "d"}],
        }
        return self.write(name, payload)

    def test_inconclusive_input_is_not_a_pass(self) -> None:
        path = self.report("a.json", "q2-numeric", "inconclusive")
        code, payload, _ = run_measure("compare", "--report", str(path),
                                       "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0, "an inconclusive report must not combine to pass")
        self.assertEqual(payload["result"], "fail")

    def test_malformed_report_is_not_a_pass(self) -> None:
        path = self.root / "bad.json"
        path.write_text("{not json")
        code, payload, _ = run_measure("compare", "--report", str(path),
                                       "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0)
        self.assertEqual(payload["result"], "fail")

    def test_missing_report_is_not_a_pass(self) -> None:
        code, payload, _ = run_measure("compare",
                                       "--report", str(self.root / "absent.json"),
                                       "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0)
        self.assertEqual(payload["result"], "fail")

    def test_partial_experiment_set_is_not_a_pass(self) -> None:
        """Summarising whichever reports the caller happens to supply proves nothing."""
        path = self.report("a.json", "q2-numeric", "pass")
        code, payload, _ = run_measure("compare", "--report", str(path),
                                       "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0, "an incomplete experiment set must not pass")
        self.assertEqual(payload["result"], "fail")
        self.assertTrue(any("missing" in f.lower() for f in payload["failures"]),
                        f"failures must name the missing experiments: {payload['failures']}")

    def test_complete_passing_set_passes(self) -> None:
        paths = [self.report(f"{name}.json", name, "pass") for name in self.EXPERIMENTS]
        args = ["compare", "--out", str(self.root / "out.json")]
        for path in paths:
            args += ["--report", str(path)]
        code, payload, _ = run_measure(*args)
        self.assertEqual(code, 0, f"a complete passing set must pass: {payload}")
        self.assertEqual(payload["result"], "pass")

    def test_one_failing_member_fails_the_set(self) -> None:
        paths = [self.report(f"{name}.json", name, "pass") for name in self.EXPERIMENTS]
        self.report("q4-slope.json", "q4-slope", "fail")
        args = ["compare", "--out", str(self.root / "out.json")]
        for path in paths:
            args += ["--report", str(path)]
        code, payload, _ = run_measure(*args)
        self.assertNotEqual(code, 0)
        self.assertEqual(payload["result"], "fail")


class ReportContract(TempRoot):
    """Required report fields must be present, or the report is unusable."""

    def test_report_without_verdict_fields_is_rejected(self) -> None:
        """A report missing `assertions` cannot support a pass."""
        payload = {
            "experiment": "q2-numeric",
            "result": "pass",
            "failures": [],
            "assertions": [],
            "requiredBehavior": "compare windows",
            "implementationExercised": "probe",
            "commands": ["measure.py q2-numeric"],
            "fixtures": [],
            "measurementLocations": [],
            "limitations": [],
        }
        path = self.write("r.json", payload)
        code, report, _ = run_measure("validate-report", "--report", str(path),
                                      "--out", str(self.root / "out.json"))
        self.assertNotEqual(code, 0,
                            "a pass with zero assertions must not validate")
        self.assertEqual(report["result"], "fail")


if __name__ == "__main__":
    unittest.main(verbosity=2)
