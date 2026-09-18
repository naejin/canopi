#!/usr/bin/env python3
"""Behaviour tests for the qualification gate.

These tests are deliberately small and synthetic. They prove the gate's verdict
semantics; they are **not** qualification evidence and are marked as synthetic so
they can never be published as such.

Two layers are covered:

* :mod:`qualification_gate` — the verdict contract (pass / fail / inconclusive,
  precedence, negative controls, evidence identity);
* the evidence assembler — the mapping from real probe reports to assertion
  results, where producer/consumer field agreement lives.

Run with::

    python3 -m unittest discover -s scripts/raster-qualification/tests -v
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS))

import qualification_gate as gate  # noqa: E402
import qualification_evidence as evidence  # noqa: E402

CONTRACT_PATH = HARNESS / "requirements.json"


def passing_evidence(environment: str = "Chromium 150") -> dict:
    """A complete, self-consistent evidence bundle that satisfies the contract.

    Built from the contract itself so it stays valid as the contract evolves. It
    is an in-memory stand-in for a real bundle, so it is not marked synthetic:
    the gate's own verdict semantics are what these tests exercise. Synthesised
    bundles are marked explicitly by the tests that prove the marker works.
    """
    contract = gate.load_contract(CONTRACT_PATH)
    requirements = {}
    for requirement in contract.required():
        entry = {
            "requirementId": requirement.id,
            "source": f"reports/{requirement.id.lower()}.json",
            "command": f"measure.py {requirement.id.lower()} --out reports/",
            "environment": environment,
            "route": requirement.role,
            "artifact": {"name": "candidate", "version": "1.0.0"},
            "fixtures": [{"name": "fixture", "sha256": "0" * 64}],
            "observations": {},
            "assertions": {a: "pass" for a in requirement.assertions},
        }
        rules = requirement.host_evidence_rules or {}
        if rules:
            entry["host"] = (rules.get("acceptedHosts") or [None])[0]
        requirements[requirement.id] = entry
    return {
        "generatedAt": time.time(),
        "environment": {"host": "qualification host", "engine": environment},
        "route": {"numeric": "candidate numeric route", "display": "candidate display route"},
        "requirements": requirements,
    }


class GateTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="qual-gate-")
        self.root = Path(self._temp.name)
        self.contract = gate.load_contract(CONTRACT_PATH)

    def tearDown(self) -> None:
        self._temp.cleanup()

    def bundle(self, payload: dict, name: str = "bundle.json") -> Path:
        path = self.root / name
        path.write_text(json.dumps(payload))
        return path

    def evaluate(self, payload: dict) -> gate.Decision:
        return gate.evaluate(self.contract, self.bundle(payload))

    def verdict_of(self, decision: gate.Decision, requirement_id: str) -> str:
        for requirement in decision.requirements:
            if requirement.requirement_id == requirement_id:
                return requirement.verdict
        raise AssertionError(f"no verdict for {requirement_id}")


class PassingControl(GateTestBase):
    def test_complete_evidence_passes_both_levels(self) -> None:
        """Level 1 and level 2: a complete, consistent bundle qualifies.

        This is the control every negative case below is measured against, so a
        failure there cannot be explained by an unrelated missing precondition.
        """
        decision = self.evaluate(passing_evidence())
        self.assertEqual(decision.verdict, gate.PASS,
                         f"expected a passing control, got {decision.as_dict()['verdictReason']}")
        self.assertEqual(decision.exit_code, 0)
        self.assertFalse(decision.blocking())

    def test_every_required_requirement_is_evaluated(self) -> None:
        """Level 3: eligibility covers the whole contract, not whichever parts ran."""
        decision = self.evaluate(passing_evidence())
        self.assertEqual(len(decision.requirements), len(self.contract.required()),
                         "every required requirement must receive a verdict")

    def test_contract_covers_the_expected_requirement_families(self) -> None:
        """The contract is derived from the plan, not from the probes' subcommands."""
        ids = {r.id for r in self.contract.required()}
        for expected in ("Q-ART-1", "Q-LOCAL-1", "Q-PREP-1", "Q-MEMBER-1",
                         "Q-VALUE-1", "Q-CRS-1", "Q-CANCEL-1", "Q-TEARDOWN-1",
                         "Q-FAILINJ-1", "Q-HOST-1", "Q-RES-1", "Q-DISPLAY-1"):
            self.assertIn(expected, ids)
        self.assertGreaterEqual(len(ids), 12)


class MissingEvidence(GateTestBase):
    def test_omitting_a_requirement_is_inconclusive(self) -> None:
        payload = passing_evidence()
        del payload["requirements"]["Q-HOST-1"]
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-HOST-1"), gate.INCONCLUSIVE)
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)
        self.assertNotEqual(decision.exit_code, 0)
        self.assertIn("Q-HOST-1", decision.as_dict()["blockingRequirementIds"])

    def test_omitting_one_assertion_is_inconclusive(self) -> None:
        """Absence of evidence for one assertion cannot pass as success."""
        payload = passing_evidence()
        entry = payload["requirements"]["Q-DISPLAY-1"]
        del entry["assertions"]["no-ui-thread-task-above-bound"]
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-DISPLAY-1"), gate.INCONCLUSIVE)
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)

    def test_any_inconclusive_requirement_blocks_overall_pass(self) -> None:
        payload = passing_evidence()
        payload["requirements"]["Q-RES-1"]["assertions"] = {
            "candidate-memory-within-budget": "inconclusive"}
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)
        self.assertNotEqual(decision.exit_code, 0)


class FailingEvidence(GateTestBase):
    def test_a_single_failing_assertion_fails_the_requirement(self) -> None:
        payload = passing_evidence()
        payload["requirements"]["Q-RES-1"]["assertions"] = {
            "candidate-memory-within-budget": "fail"}
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-RES-1"), gate.FAIL)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertNotEqual(decision.exit_code, 0)

    def test_fail_outranks_inconclusive_overall(self) -> None:
        """Precedence is fail, then inconclusive, then pass."""
        payload = passing_evidence()
        payload["requirements"]["Q-RES-1"]["assertions"] = {
            "candidate-memory-within-budget": "fail"}
        del payload["requirements"]["Q-HOST-1"]
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)

    def test_missing_evidence_identity_is_inconclusive(self) -> None:
        """Evidence that does not identify its own observation is unusable.

        A per-entry gap is inconclusive: it says nothing about the capability, so
        it cannot be reported as a measured violation.
        """
        for field in ("environment", "command", "source"):
            with self.subTest(field=field):
                payload = passing_evidence()
                payload["requirements"]["Q-LOCAL-1"][field] = ""
                decision = self.evaluate(payload)
                self.assertEqual(self.verdict_of(decision, "Q-LOCAL-1"),
                                 gate.INCONCLUSIVE)
                entry = next(r for r in decision.as_dict()["requirements"]
                             if r["requirementId"] == "Q-LOCAL-1")
                self.assertIn(field, entry["missingEvidenceFields"])

    def test_entry_without_a_route_is_inconclusive(self) -> None:
        """An entry that cannot say what it measured is a gap, not a violation.

        The contract reserves ``fail`` for measured violations and corrupt input.
        An unattributable entry is missing evidence, so it is inconclusive and
        blocks the pass without overstating what was observed.
        """
        payload = passing_evidence()
        payload["requirements"]["Q-LOCAL-1"]["route"] = ""
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-LOCAL-1"), gate.INCONCLUSIVE)
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)
        self.assertIn("route", " ".join(decision.as_dict()["failures"]))


class MalformedEvidence(GateTestBase):
    def test_malformed_bundle_fails(self) -> None:
        path = self.root / "bad.json"
        path.write_text("{ not json")
        decision = gate.evaluate(self.contract, path)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertNotEqual(decision.exit_code, 0)

    def test_missing_bundle_is_inconclusive(self) -> None:
        decision = gate.evaluate(self.contract, self.root / "absent.json")
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)
        self.assertNotEqual(decision.exit_code, 0)

    def test_non_object_entry_fails(self) -> None:
        payload = passing_evidence()
        payload["requirements"]["Q-CRS-1"] = "not an object"
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-CRS-1"), gate.FAIL)


class HostScopedEvidence(GateTestBase):
    def test_chromium_cannot_satisfy_the_desktop_host_requirement(self) -> None:
        """A wrong-host observation is inconclusive, never a pass."""
        payload = passing_evidence()
        payload["requirements"]["Q-HOST-1"]["host"] = "chromium"
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-HOST-1"), gate.INCONCLUSIVE)
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)

    def test_node_cannot_satisfy_the_desktop_host_requirement(self) -> None:
        payload = passing_evidence()
        payload["requirements"]["Q-HOST-1"]["host"] = "node"
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-HOST-1"), gate.INCONCLUSIVE)


if __name__ == "__main__":
    unittest.main(verbosity=2)


# --------------------------------------------------------------------------- #
# R2-01: display-trace producer/consumer field agreement
# --------------------------------------------------------------------------- #

def valid_trace(*, long_task_ms: float | None = 20.0,
                observer_supported: bool = True,
                runs: list[dict] | None = None) -> dict:
    """A display trace shaped exactly like the producer's output.

    ``run_display_trace.mjs`` emits ``longTaskMaxMs``; the evaluator previously
    read ``maxLongTaskMs``, so a 900 ms stall passed a 50 ms bound.
    """
    if runs is not None:
        return {"runs": runs}
    base = []
    # One cold and three warm runs, as the plan's display trace requires.
    for index in range(4):
        base.append({
            "name": "cold" if index == 0 else "warm",
            "ok": True,
            "tileRequests": 128,
            "tilesRendered": 128,
            "failedTiles": 0,
            "medianMs": 0.4,
            "p95Ms": 16.7,
            "maxMs": 31.3,
            "individualLatenciesMs": [0.5 + (i % 7) * 0.3 for i in range(128)],
            "cachesCleared": "fresh page",
            "longTaskMaxMs": long_task_ms,
            "longTaskCount": 0 if long_task_ms is None else 1,
            "longTaskObserverSupported": observer_supported,
        })
    return {"runs": base}


TRACE_LIMITS = {"bound_ms": 50.0, "cold_runs": 1, "warm_runs": 3,
                "min_latencies": 100}


class DisplayTraceFieldContract(unittest.TestCase):
    """Level 1 and 2: the assembler must read what the producer writes."""

    def assertions(self, trace: dict) -> tuple[dict, list[str]]:
        results, notes, _ = evidence.display_trace_assertions(
            trace, **TRACE_LIMITS)
        return results, notes

    def assert_only_the_bound_fails(self, results: dict, notes: list[str]) -> None:
        """Guard against a failure explained by any other assertion.

        The run set is complete and every other trace assertion passes, so the
        UI-thread verdict is the only thing under test. Without this the test
        could pass for the wrong reason, as an earlier revision of it did.
        """
        for name, value in results.items():
            if name == "no-ui-thread-task-above-bound":
                continue
            self.assertEqual(value, evidence.PASS,
                             f"{name} should pass in this fixture; notes={notes}")
        self.assertEqual(results["no-ui-thread-task-above-bound"], evidence.FAIL,
                         f"the bound must be the failing assertion; notes={notes}")

    def test_valid_trace_passes_the_ui_thread_requirement(self) -> None:
        """Passing control: a 20 ms worst case is inside the 50 ms bound."""
        results, notes = self.assertions(valid_trace(long_task_ms=20.0))
        self.assertEqual(results["no-ui-thread-task-above-bound"], evidence.PASS,
                         f"control should pass; notes={notes}")

    def test_900ms_long_task_fails_the_bound(self) -> None:
        """R2-01: the producer's field must be the one the consumer reads.

        Every other trace assertion passes, so a failure here can only come from
        the UI-thread bound.
        """
        results, notes = self.assertions(valid_trace(long_task_ms=900.0))
        self.assert_only_the_bound_fails(results, notes)
        self.assertTrue(any("900" in n and "50" in n for n in notes),
                        f"the reason must report the observed value and the bound: {notes}")

    def test_unrecognised_producer_field_is_inconclusive(self) -> None:
        """A renamed producer field must fail closed, not pass by default."""
        trace = valid_trace()
        for run in trace["runs"]:
            run["maxLongTaskMs"] = run.pop("longTaskMaxMs")
        results, notes = self.assertions(trace)
        self.assertEqual(results["no-ui-thread-task-above-bound"], evidence.UNKNOWN)
        self.assertTrue(any("does not recognise" in n for n in notes), notes)

    def test_unsupported_observer_is_inconclusive(self) -> None:
        results, notes = self.assertions(valid_trace(observer_supported=False))
        self.assertEqual(results["no-ui-thread-task-above-bound"], evidence.UNKNOWN)
        self.assertEqual(results["unsupported-observation-is-inconclusive"],
                         evidence.UNKNOWN)

    def test_missing_long_task_measurement_is_inconclusive(self) -> None:
        results, _ = self.assertions(valid_trace(long_task_ms=None))
        self.assertEqual(results["no-ui-thread-task-above-bound"], evidence.UNKNOWN)

    def test_negative_postponed_duration_is_not_a_measurement(self) -> None:
        results, _ = self.assertions(valid_trace(long_task_ms=-1.0))
        self.assertEqual(results["no-ui-thread-task-above-bound"], evidence.UNKNOWN)


# --------------------------------------------------------------------------- #
# Assembler: route, host and measurement scoping
# --------------------------------------------------------------------------- #

def passing_reports(root: Path) -> dict[str, Path]:
    """Minimal reports that assemble into a complete, passing bundle.

    Shaped after the real probe output so the assembler is exercised through its
    real field contract rather than a convenience stub.
    """
    def write(name: str, payload: dict) -> Path:
        path = root / name
        path.write_text(json.dumps(payload))
        return path

    q1 = write("q1-artifacts.json", {
        "experiment": "q1-artifacts", "result": "pass",
        "notes": ["whitebox-wasm: no published artifact matches the pinned commit"],
        "verifiedArtifacts": [{"name": "candidate", "version": "1.0.0",
                               "license": "MIT", "wasm": []}],
        "assertions": [
            {"name": "version:candidate", "ok": True},
            {"name": "integrity:candidate", "ok": True},
            {"name": "license-recorded:candidate", "ok": True},
            {"name": "correspondence-recorded:whitebox-wasm", "ok": True},
        ],
    })
    q2 = write("q2-numeric.json", {
        "experiment": "q2-numeric", "result": "pass", "failures": [],
        "testedWindows": 9,
        "serverLedger": {"fixtureBytesServed": 488502, "fixtureRequests": 66},
        "assertions": [
            {"name": "no-whole-file-request:plane2000", "ok": True},
            {"name": "analytic:plane2000/origin", "ok": True},
            {"name": "validity:plane2000/origin", "ok": True},
        ],
    })
    q3prepare = write("q3-prepare.json", {
        "experiment": "q3-prepare", "result": "pass", "failures": [],
        "assertions": [
            {"name": "original-unchanged", "ok": True},
            {"name": "original-hash-declared", "ok": True},
            {"name": "sidecar-unchanged", "ok": True},
            {"name": "derived-tiled", "ok": True},
            {"name": "cell-exact", "ok": True},
            {"name": "geotransform-preserved", "ok": True},
            {"name": "all-values-match", "ok": True},
        ],
    })
    q3members = write("q3-members.json", {
        "experiment": "q3-members", "result": "pass", "failures": [],
        "assertions": [
            {"name": "multi-member:across-columns-0-1", "ok": True},
            {"name": "gap-empty:1-2", "ok": True},
            {"name": "precedence-last-wins", "ok": True},
            {"name": "nodata-does-not-erase", "ok": True},
        ],
    })
    q4slope = write("q4-slope.json", {
        "experiment": "q4-slope", "result": "pass", "failures": [],
        "assertions": [
            {"name": "analytic:plane2000/origin", "ok": True},
            {"name": "validity:plane2000/origin", "ok": True},
            {"name": "hole-centre-not-interpolated:holes-defined-in-generator", "ok": True},
            {"name": "degrees:plane2000", "ok": True},
            {"name": "percent:plane2000", "ok": True},
            {"name": "seam-matches-whole", "ok": True},
            {"name": "outer-edge-not-invalid-outside", "ok": True},
        ],
    })
    q4crs = write("q4-crs.json", {
        "experiment": "q4-crs", "result": "pass", "failures": [],
        "assertions": [
            {"name": "reference-epsg-configured-explicitly", "ok": True},
            {"name": "crs-resolver-identified", "ok": True},
            {"name": "candidate-projection-matches-reference", "ok": True},
            {"name": "candidate-returned-coordinate-addresses-requested-pixel", "ok": True},
        ],
    })
    q5 = write("q5-lifecycle.json", {
        "experiment": "q5-lifecycle", "result": "pass", "failures": [],
        "assertions": [
            {"name": "cancellation-stops-scheduling", "ok": True},
            {"name": "cancellation-settles-in-bound", "ok": True},
            {"name": "uncancelled-control", "ok": True},
            {"name": "adapter-dispose-idempotent", "ok": True},
            {"name": "stalled-worker-termination", "ok": True},
            {"name": "dead-worker-detection", "ok": True},
            {"name": "malformed-rejected:truncated-header", "ok": True},
            {"name": "malformed-rejected:corrupt-tile", "ok": True},
            {"name": "malformed-rejected:out-of-image-window", "ok": True},
            {"name": "lifecycle:stalled-worker-termination", "ok": True},
        ],
    })
    q6 = write("q6-resources.json", {
        "experiment": "q6-resources", "result": "pass", "failures": [],
        "measurements": [
            {"route": "candidate (wasm ranged transport)", "perFixture": [],
             "combined": {"largestRequest": 65536}},
            {"route": "reference reader (native byte-range, NOT the candidate route)",
             "incrementalPeakRssMiB": 18.32, "maxSingleReadBytes": 4194304},
        ],
    })
    trace = write("q6-trace.json", valid_trace(long_task_ms=20.0))
    ledger = write("ledger.json", {"bytes": 1000, "requests": 10, "ranged": 8,
                                   "full": 2, "perFile": {}})
    return {"q1": q1, "q2": q2, "q3prepare": q3prepare, "q3members": q3members,
            "q4slope": q4slope, "q4crs": q4crs, "q5lifecycle": q5,
            "q6resources": q6, "trace": trace, "ledger": ledger}


ASSEMBLY = {
    "environment": {"host": "qualification host", "engine": "Chromium 150"},
    "route": {
        "numeric": "whitebox-wasm CogStream over HTTP Range requests",
        "numericArtifact": {"name": "candidate", "version": "1.0.0"},
        "artifacts": "candidate artifact resolution",
        "prepare": "native GDAL preparation",
        "member": "ordered member replay",
        "slope": "blocked Horn slope",
        "crs": "native CRS resolution",
        "lifecycle": "cooperative tile-level cancellation",
        "display": "cog-tiler-wasm renderTilePNG over a disk-backed File",
        "displayArtifact": {"name": "candidate", "version": "1.0.0"},
        "prepareArtifact": {"name": "gdal", "version": "3.8.4"},
        "slopeArtifact": {"name": "gdal", "version": "3.8.4"},
        "crsArtifact": {"name": "gdal", "version": "3.8.4"},
    },
    "artifacts": [{"name": "candidate", "version": "1.0.0"}],
    "fixtures": [{"name": "derived_cog", "sha256": "a" * 64}],
    "display": {"ui_thread_bound_ms": 50.0, "cold_runs": 1, "warm_runs": 3,
                "min_latencies_per_run": 100, "memory_budget_mib": 1024.0},
}


class AssemblerTestBase(GateTestBase):
    def write_reports(self) -> dict[str, Path]:
        """Create the probe reports once, so a test can amend them in place."""
        self.reports = passing_reports(self.root)
        return self.reports

    def amend(self, name: str, mutate) -> None:
        """Change one report on disk, leaving every other report untouched."""
        path = self.reports[name]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble(self, *, host: str = "chromium", **overrides) -> dict:
        reports = getattr(self, "reports", None) or self.write_reports()
        reports = dict(reports)
        reports.update(overrides)
        return evidence.assemble(self.contract, out=self.root / "bundle.json",
                                 reports=reports, host=host, **ASSEMBLY)

    def entry(self, bundle: dict, requirement_id: str) -> dict:
        return bundle["requirements"][requirement_id]


class CandidateMeasurementScope(AssemblerTestBase):
    """The candidate route must be measured; a reference cannot substitute."""

    def test_assembled_bundle_reaches_the_gate_with_candidate_gaps(self) -> None:
        """Control: assembly succeeds and the gate decides the whole contract."""
        self.write_reports()
        bundle = self.assemble()
        path = self.bundle(bundle, "assembled.json")
        decision = gate.evaluate(self.contract, path)
        # The bundle is assembled from probe reports; it is not synthetic.
        self.assertFalse(decision.synthetic)
        self.assertEqual(len(decision.requirements), len(self.contract.required()))

    def test_omitting_candidate_memory_is_inconclusive_not_reference_substituted(self) -> None:
        """The reference reader's 18.32 MiB must not stand in for the candidate."""
        self.write_reports()
        self.amend("q6resources", lambda p: p.__setitem__(
            "measurements", [m for m in p["measurements"]
                             if not str(m.get("route", "")).startswith("candidate")]))
        bundle = self.assemble()
        assertions = self.entry(bundle, "Q-RES-1")["assertions"]
        self.assertEqual(assertions["candidate-memory-within-budget"], evidence.UNKNOWN)
        self.assertEqual(assertions["measurement-is-of-candidate-route"], evidence.UNKNOWN)
        self.assertIsNone(self.entry(bundle, "Q-RES-1")["observations"]["candidateMemoryMiB"])

    def test_candidate_memory_over_budget_fails_with_values(self) -> None:
        """A measured violation fails, and records the value, unit and budget."""
        self.write_reports()
        self.amend("q6resources", lambda p: p["measurements"].append(
            {"route": "candidate (wasm ranged transport)",
             "incrementalPeakRssMiB": 2048.0}))
        bundle = self.assemble()
        entry = self.entry(bundle, "Q-RES-1")
        self.assertEqual(entry["assertions"]["candidate-memory-within-budget"], evidence.FAIL)
        self.assertEqual(entry["observations"]["candidateMemoryMiB"], 2048.0)
        self.assertEqual(entry["observations"]["budgetMiB"], 1024.0)

    def test_candidate_memory_within_budget_passes(self) -> None:
        self.write_reports()
        self.amend("q6resources", lambda p: p["measurements"].append(
            {"route": "candidate (wasm ranged transport)",
             "incrementalPeakRssMiB": 300.0}))
        bundle = self.assemble()
        self.assertEqual(self.entry(bundle, "Q-RES-1")["assertions"]
                         ["candidate-memory-within-budget"], evidence.PASS)


class HostScoping(AssemblerTestBase):
    def test_chromium_evidence_cannot_satisfy_the_desktop_host_requirement(self) -> None:
        self.write_reports()
        bundle = self.assemble(host="chromium")
        entry = self.entry(bundle, "Q-HOST-1")
        self.assertEqual(entry["host"], "chromium")
        self.assertTrue(all(v == evidence.UNKNOWN for v in entry["assertions"].values()))

    def test_artifact_version_mismatch_fails(self) -> None:
        """A role exercised against a different version than verified is a mismatch."""
        self.write_reports()
        bundle = self.assemble()
        self.assertEqual(bundle["requirements"]["Q-ART-1"]["assertions"]
                         ["qualified-roles-name-artifact-version"], evidence.PASS)
        # One change: the role was exercised at a version the bench never verified.
        bundle["route"]["numericArtifact"] = {"name": "candidate", "version": "9.9.9"}
        verdict, notes = evidence._from_versions(
            [{"name": "candidate", "version": "1.0.0"}],
            [bundle["route"]["numericArtifact"]])
        self.assertEqual(verdict, evidence.FAIL)
        self.assertIn("9.9.9", " ".join(notes))
        self.assertIn("1.0.0", " ".join(notes))

    def test_role_that_is_neither_verified_nor_declared_is_inconclusive(self) -> None:
        verdict, notes = evidence._from_versions(
            [{"name": "candidate", "version": "1.0.0"}],
            [{"name": "mystery-tool", "version": "1.0"}])
        self.assertEqual(verdict, evidence.UNKNOWN)
        self.assertIn("neither bench-verified nor declared unpinned", " ".join(notes))

    def test_declared_unpinned_tool_passes_and_is_recorded(self) -> None:
        """The plan retains native GDAL, so it is declared rather than pinned."""
        verdict, notes = evidence._from_versions(
            [{"name": "candidate", "version": "1.0.0"}],
            [{"name": "gdal", "version": "3.8.4"}],
            unpinned_roles=[{"name": "gdal", "reason": "plan allows retention"}])
        self.assertEqual(verdict, evidence.PASS)
        self.assertTrue(any("unpinned system tool" in n for n in notes))


class TraceRunCompleteness(AssemblerTestBase):
    def test_one_cold_and_three_warm_required(self) -> None:
        for runs, expected in (
                ([], evidence.UNKNOWN),
                ([valid_trace()["runs"][0]], evidence.FAIL),
                (valid_trace()["runs"][:3], evidence.FAIL),
                (valid_trace()["runs"], evidence.PASS)):
            with self.subTest(runs=len(runs)):
                results, _, _ = evidence.display_trace_assertions(
                    {"runs": runs}, **TRACE_LIMITS)
                self.assertEqual(results["one-cold-and-three-warm-runs"], expected)

    def test_failed_run_does_not_count_as_rendering(self) -> None:
        runs = valid_trace()["runs"]
        runs[1] = dict(runs[1], ok=False, tilesRendered=1, failedTiles=127)
        results, _, _ = evidence.display_trace_assertions({"runs": runs}, **TRACE_LIMITS)
        self.assertEqual(results["runs-report-successful-rendering"], evidence.FAIL)
        _, _, observed = evidence.display_trace_assertions({"runs": runs}, **TRACE_LIMITS)
        self.assertTrue(any("warm" in entry for entry in observed["failedRuns"]),
                        f"the failed run must be named: {observed['failedRuns']}")

    def test_one_failed_tile_fails_rendering(self) -> None:
        """Attempts are not successes: a single failed tile fails the assertion.

        ``ok`` stays true here, so the failure can only come from the tile counts.
        """
        runs = valid_trace()["runs"]
        runs[2] = dict(runs[2], failedTiles=1, tilesRendered=127)
        results, _, observed = evidence.display_trace_assertions(
            {"runs": runs}, **TRACE_LIMITS)
        self.assertEqual(results["runs-report-successful-rendering"], evidence.FAIL)
        self.assertTrue(any("warm" in entry for entry in observed["failedRuns"]))

    def test_aggregate_only_latencies_are_not_individual_evidence(self) -> None:
        runs = [dict(r, individualLatenciesMs=[]) for r in valid_trace()["runs"]]
        results, _, _ = evidence.display_trace_assertions({"runs": runs}, **TRACE_LIMITS)
        self.assertEqual(results["hundred-valid-latencies-per-run"], evidence.FAIL)

    def test_missing_cache_state_fails(self) -> None:
        runs = [dict(r, cachesCleared="") for r in valid_trace()["runs"]]
        results, _, _ = evidence.display_trace_assertions({"runs": runs}, **TRACE_LIMITS)
        self.assertEqual(results["cache-state-recorded"], evidence.FAIL)


class MandatoryLifecycleGaps(AssemblerTestBase):
    def test_mandatory_cases_are_inconclusive_even_when_reports_pass(self) -> None:
        """A passing probe cannot close a requirement its probe cannot observe."""
        self.write_reports()
        bundle = self.assemble()
        self.assertEqual(
            self.entry(bundle, "Q-CANCEL-1")["assertions"]
            ["cancellation-issued-while-work-in-flight"], evidence.UNKNOWN)
        self.assertEqual(
            self.entry(bundle, "Q-CANCEL-1")["assertions"]
            ["concurrent-in-flight-work-measured"], evidence.UNKNOWN)
        self.assertEqual(
            self.entry(bundle, "Q-TEARDOWN-1")["assertions"]
            ["teardown-observably-releases-resource"], evidence.UNKNOWN)
        self.assertEqual(
            self.entry(bundle, "Q-FAILINJ-1")["assertions"]
            ["disk-write-failure-exercised"], evidence.UNKNOWN)
        self.assertEqual(
            self.entry(bundle, "Q-MEMBER-1")["assertions"]
            ["overviews-do-not-resurrect-replaced-pixels"], evidence.UNKNOWN)

    def test_missing_lifecycle_report_leaves_every_assertion_inconclusive(self) -> None:
        self.write_reports()
        bundle = self.assemble(q5lifecycle=self.root / "absent.json")
        for assertion, value in self.entry(bundle, "Q-TEARDOWN-1")["assertions"].items():
            self.assertEqual(value, evidence.UNKNOWN, assertion)


class BundleCoherence(GateTestBase):
    """One route is qualified as a whole; mixed or stale evidence cannot qualify."""

    def test_environment_mismatch_fails_with_a_named_reason(self) -> None:
        payload = passing_evidence()
        payload["requirements"]["Q-DISPLAY-1"]["environment"] = "a different host"
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        reasons = " ".join(decision.as_dict()["failures"])
        self.assertIn("mixed evidence environments", reasons)

    def test_bundle_without_a_declared_environment_fails(self) -> None:
        payload = passing_evidence()
        payload["environment"] = {}
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertIn("does not declare the environment",
                      " ".join(decision.as_dict()["failures"]))

    def test_bundle_without_a_declared_route_fails(self) -> None:
        payload = passing_evidence()
        payload["route"] = {}
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertIn("does not declare the route",
                      " ".join(decision.as_dict()["failures"]))

    def test_entry_without_an_artifact_is_inconclusive(self) -> None:
        """Evidence that cannot name its artifact cannot support a capability."""
        payload = passing_evidence()
        payload["requirements"]["Q-LOCAL-1"]["artifact"] = {}
        decision = self.evaluate(payload)
        self.assertEqual(self.verdict_of(decision, "Q-LOCAL-1"), gate.INCONCLUSIVE)
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)
        self.assertIn("does not name the artifact",
                      " ".join(decision.as_dict()["failures"]))

    def test_stale_bundle_is_a_non_pass_with_its_age(self) -> None:
        payload = passing_evidence()
        payload["generatedAt"] = time.time() - 30 * 86400
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertIn("stale", " ".join(decision.as_dict()["failures"]))

    def test_bundle_without_a_generation_time_is_a_non_pass(self) -> None:
        payload = passing_evidence()
        del payload["generatedAt"]
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertIn("does not record when its evidence was generated",
                      " ".join(decision.as_dict()["failures"]))

    def test_future_generation_time_is_a_non_pass(self) -> None:
        payload = passing_evidence()
        payload["generatedAt"] = time.time() + 3600
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertIn("in the future", " ".join(decision.as_dict()["failures"]))

    def test_duplicate_requirement_key_cannot_hide_a_failure(self) -> None:
        """A duplicated key is a corrupt report, not a second chance to pass."""
        payload = passing_evidence()
        entry = json.dumps(payload["requirements"]["Q-RES-1"])
        text = json.dumps(payload)
        # Inject one extra entry for Q-RES-1 at the head of the requirements map.
        marker = '"requirements": {'
        self.assertIn(marker, text)
        broken = text.replace(marker, marker + f'"Q-RES-1": {entry},', 1)
        path = self.root / "duplicate.json"
        path.write_text(broken)
        # The raw text really does carry the key twice.
        self.assertEqual(broken.count('"Q-RES-1":'), 2)
        decision = gate.evaluate(self.contract, path)
        self.assertNotEqual(decision.verdict, gate.PASS)
        self.assertIn("repeats requirement", " ".join(decision.as_dict()["failures"]))


class SyntheticMarking(AssemblerTestBase):
    def test_synthetic_bundles_are_marked_and_never_qualification_evidence(self) -> None:
        """Evaluator fixtures prove gate behaviour only and are labelled as such."""
        payload = passing_evidence()
        payload[gate.SYNTHETIC_MARKER] = True
        decision = self.evaluate(payload)
        self.assertTrue(decision.synthetic)
        self.assertTrue(decision.as_dict()["synthetic"])

    def test_assembled_bundles_are_not_marked_synthetic(self) -> None:
        self.write_reports()
        bundle = self.assemble()
        self.assertNotIn(gate.SYNTHETIC_MARKER, bundle)


class ReproducedReviewCases(AssemblerTestBase):
    """The exact false passes the review reproduced must now be refused.

    Each case starts from the complete assembled bundle and changes one trace
    field, so nothing else can explain the outcome.
    """

    def evaluate_assembled(self) -> gate.Decision:
        self.write_reports()
        return gate.evaluate(self.contract, self.bundle(self.assemble(), "b.json"))

    def test_empty_runs_list_no_longer_passes(self) -> None:
        """Review input {"runs": []} previously produced exit 0 / pass."""
        self.write_reports()
        self.amend("trace", lambda p: p.__setitem__("runs", []))
        decision = gate.evaluate(self.contract, self.bundle(self.assemble(), "b.json"))
        self.assertEqual(decision.verdict, gate.INCONCLUSIVE)
        self.assertNotEqual(decision.exit_code, 0)
        # The run-count gap is named, and it is the only reason display fails.
        display = next(r for r in decision.requirements
                       if r.requirement_id == "Q-DISPLAY-1")
        self.assertEqual(display.verdict, gate.INCONCLUSIVE)
        self.assertIn("one-cold-and-three-warm-runs", display.assertions)
        self.assertEqual(display.assertions["one-cold-and-three-warm-runs"],
                         evidence.UNKNOWN)

    def test_failed_run_with_a_long_task_no_longer_passes(self) -> None:
        """Review input: ok=false, 127 of 128 tiles failed, 900 ms long task.

        Previously exit 0 / pass. This combined input asserts the specific reasons
        now that the defects are separated; each defect also has its own
        single-change test above.
        """
        self.write_reports()
        self.amend("trace", lambda p: p.__setitem__("runs", [{
            "name": "cold", "ok": False, "tileRequests": 128, "tilesRendered": 1,
            "failedTiles": 127, "medianMs": 0.4, "p95Ms": 1.0, "maxMs": 31.3,
            "individualLatenciesMs": [1.0],
            "cachesCleared": "fresh", "longTaskMaxMs": 900.0, "longTaskCount": 1,
            "longTaskObserverSupported": True}]))
        decision = gate.evaluate(self.contract, self.bundle(self.assemble(), "b.json"))
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertNotEqual(decision.exit_code, 0)
        display = next(r for r in decision.requirements
                       if r.requirement_id == "Q-DISPLAY-1")
        self.assertEqual(display.assertions["no-ui-thread-task-above-bound"],
                         evidence.FAIL)
        self.assertEqual(display.assertions["runs-report-successful-rendering"],
                         evidence.FAIL)
        self.assertEqual(display.assertions["one-cold-and-three-warm-runs"],
                         evidence.FAIL)

    def test_current_q_evidence_set_cannot_reach_a_pass(self) -> None:
        """Level 3: a full, internally consistent run of probes still is not enough.

        Every probe report passed its own checks, yet requirements no probe
        observes remain unsatisfied. This is the distinction the gate exists to
        make, and it must not be softened by better probe results alone.
        """
        decision = self.evaluate_assembled()
        self.assertNotEqual(decision.verdict, gate.PASS)
        blocking = set(decision.as_dict()["blockingRequirementIds"])
        # Requirements no probe currently observes must remain blocking.
        for requirement_id in ("Q-HOST-1", "Q-RES-1", "Q-CANCEL-1",
                               "Q-TEARDOWN-1", "Q-MEMBER-1"):
            self.assertIn(requirement_id, blocking,
                          f"{requirement_id} must remain unresolved")
