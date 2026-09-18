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
    # One cold and three warm runs, as the plan's display trace requires. The
    # reported statistics are the nearest-rank values for the sample below, so a
    # control that is physically consistent is available to every test.
    sample = [0.5 + (i % 7) * 0.3 for i in range(128)]
    ordered = sorted(sample)
    median = ordered[63]
    p95 = ordered[121]
    maximum = ordered[-1]
    for index in range(4):
        base.append({
            "name": "cold" if index == 0 else "warm",
            "ok": True,
            "tileRequests": 128,
            "tilesRendered": 128,
            "failedTiles": 0,
            "medianMs": median,
            "p95Ms": p95,
            "maxMs": maximum,
            "individualLatenciesMs": list(sample),
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

#: Values the declared route/environment in ASSEMBLY and the report identities
#: must agree on. A mismatch between these is an identity conflict, not a gap.
ROUTE_ID = "candidate-raster-route-v1"
ENVIRONMENT_ID = "qualification-host-chromium-150"
HOST_ID = "chromium"
FIXTURE_HASH = "a" * 64
CANDIDATE_ARTIFACT = {"name": "whitebox-wasm", "version": "0.5.1"}
DISPLAY_ARTIFACT = {"name": "cog-tiler-wasm", "version": "0.3.6"}
GDAL_ARTIFACT = {"name": "gdal", "version": "3.8.4"}
REFERENCE_ARTIFACT = {"name": "reference-resolver", "version": "harness"}


def report_identity(experiment: str, *, route_id: str = ROUTE_ID,
                    environment: str = ENVIRONMENT_ID, host: str = HOST_ID,
                    fixtures: list[dict] | None = None,
                    fixture_policy: str = "measured",
                    sidecar_policy: str = "unmeasured",
                    artifact: dict | None = None,
                    digest: str | None = None,
                    run_id: str = "run-0001") -> dict:
    """The identity block a raw report must carry to be admitted as evidence."""
    return {
        "id": experiment,
        "experiment": experiment,
        # No self-reported digest by default: the evaluator computes the digest of
        # the bytes it read, so a fixture cannot fabricate one. A test that wants
        # to exercise the digest conflict sets `digest` explicitly.
        "digest": digest,
        "runId": run_id,
        "recordedAt": time.time(),
        "command": f"measure.py {experiment} --out reports/",
        "routeId": route_id,
        "environment": environment,
        "host": host,
        "fixturePolicy": fixture_policy,
        "sidecarPolicy": sidecar_policy,
        "fixtures": fixtures if fixtures is not None else [
            {"name": "derived_cog", "sha256": FIXTURE_HASH}],
        "artifact": artifact or dict(CANDIDATE_ARTIFACT),
    }


def assembly() -> dict:
    """A fresh copy of the declared route/environment for each assembly.

    Returned as a deep copy so a test that amends the declared route cannot leak
    that change into the next test through a shared nested dict.
    """
    return copy.deepcopy(ASSEMBLY)


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
        "experiment": "q1-artifacts", "result": "pass", "failures": [],
        "identity": report_identity("q1-artifacts", fixture_policy="artifact-only",
                                    fixtures=[], artifact=CANDIDATE_ARTIFACT),
        "fixturesTested": 0,
        # The pinned revision this artifact must correspond to, recorded as the
        # real report would: the artifact was built from the pinned revision.
        "sourceCorrespondence": [
            {"artifact": "whitebox-wasm", "version": "0.5.1",
             "pinnedRevision": "pin-abc123", "artifactRevision": "pin-abc123",
             "matches": True},
            {"artifact": "cog-tiler-wasm", "version": "0.3.6",
             "pinnedRevision": "pin-cog-tiler-1", "artifactRevision": "pin-cog-tiler-1",
             "matches": True},
        ],
        "notes": ["whitebox-wasm: no published artifact matches the pinned commit"],
        "verifiedArtifacts": [
            {"name": "whitebox-wasm", "version": "0.5.1", "license": "MIT", "wasm": []},
            {"name": "cog-tiler-wasm", "version": "0.3.6", "license": "MIT", "wasm": []},
        ],
        "assertions": [
            {"name": "version:whitebox-wasm", "ok": True},
            {"name": "version:cog-tiler-wasm", "ok": True},
            {"name": "integrity:whitebox-wasm", "ok": True},
            {"name": "integrity:cog-tiler-wasm", "ok": True},
            {"name": "license-recorded:whitebox-wasm", "ok": True},
            {"name": "license-recorded:cog-tiler-wasm", "ok": True},
            {"name": "correspondence-recorded:whitebox-wasm", "ok": True},
            {"name": "apis-and-worker-target-recorded", "ok": True},
        ],
    })
    q2 = write("q2-numeric.json", {
        "experiment": "q2-numeric", "result": "pass", "failures": [],
        "identity": report_identity("q2-numeric", artifact=CANDIDATE_ARTIFACT),
        "fixturesTested": 1,
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
        "identity": report_identity("q3-prepare", artifact=GDAL_ARTIFACT,
                                    sidecar_policy="not_applicable"),
        "fixturesTested": 1,
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
        "identity": report_identity("q3-members", artifact=REFERENCE_ARTIFACT),
        "fixturesTested": 1,
        "assertions": [
            {"name": "multi-member:across-columns-0-1", "ok": True},
            {"name": "gap-empty:1-2", "ok": True},
            {"name": "precedence-last-wins", "ok": True},
            {"name": "nodata-does-not-erase", "ok": True},
        ],
    })
    q4slope = write("q4-slope.json", {
        "experiment": "q4-slope", "result": "pass", "failures": [],
        "identity": report_identity("q4-slope", artifact=GDAL_ARTIFACT),
        "fixturesTested": 1,
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
        "identity": report_identity("q4-crs", artifact=GDAL_ARTIFACT),
        "fixturesTested": 1,
        "assertions": [
            {"name": "reference-epsg-configured-explicitly", "ok": True},
            {"name": "crs-resolver-identified", "ok": True},
            {"name": "candidate-projection-matches-reference", "ok": True},
            {"name": "candidate-returned-coordinate-addresses-requested-pixel", "ok": True},
            {"name": "original-metadata-untouched", "ok": True},
        ],
    })
    q5 = write("q5-lifecycle.json", {
        "experiment": "q5-lifecycle", "result": "pass", "failures": [],
        "identity": report_identity("q5-lifecycle", artifact=CANDIDATE_ARTIFACT),
        "fixturesTested": 1,
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
        "identity": report_identity("q6-resources", artifact=CANDIDATE_ARTIFACT),
        "fixturesTested": 1,
        "assertions": [
            {"name": "reference-read-bounded", "ok": True},
            {"name": "reference-memory-within-budget", "ok": True},
        ],
        "measurements": [
            {"route": "candidate (wasm ranged transport)", "routeRole": "candidate",
             "perFixture": [],
             "combined": {"largestRequest": 65536},
             # The candidate route's own memory, sampled at the plan's interval.
             "incrementalPeakRssMiB": 300.0, "sampleIntervalMs": 100,
             "sampleCount": 12, "maxConcurrentChildren": 1,
             "temporaryDiskHighWaterBytes": 4096, "decodedCacheBytes": 1024,
             "activeReads": 2, "queueDepth": 1},
            {"route": "reference reader (native byte-range, NOT the candidate route)",
             "routeRole": "reference",
             "incrementalPeakRssMiB": 18.32, "maxSingleReadBytes": 4194304},
        ],
    })
    trace_payload = valid_trace(long_task_ms=20.0)
    trace_payload.update({
        "experiment": "q6-trace", "result": "pass", "failures": [],
        "identity": report_identity("q6-trace", artifact=DISPLAY_ARTIFACT),
        "fixturesTested": 1,
        "assertions": [{"name": "trace-recorded", "ok": True}],
    })
    trace = write("q6-trace.json", trace_payload)
    # The ledger is the transport's own byte accounting, not a measured report, so
    # it is not admitted as evidence and carries no identity block.
    ledger = write("ledger.json", {"bytes": 1000, "requests": 10, "ranged": 8,
                                   "full": 2, "perFile": {}})
    return {"q1": q1, "q2": q2, "q3prepare": q3prepare, "q3members": q3members,
            "q4slope": q4slope, "q4crs": q4crs, "q5lifecycle": q5,
            "q6resources": q6, "trace": trace, "ledger": ledger}


ASSEMBLY = {
    "environment": {"host": "qualification host", "engine": "Chromium 150",
                    "environment": ENVIRONMENT_ID},
    "route": {
        "routeId": ROUTE_ID,
        "numeric": "whitebox-wasm CogStream over HTTP Range requests",
        "numericArtifact": dict(CANDIDATE_ARTIFACT),
        "artifacts": "candidate artifact resolution",
        "prepare": "native GDAL preparation",
        "member": "ordered member replay",
        "slope": "blocked Horn slope",
        "crs": "native CRS resolution",
        "lifecycle": "cooperative tile-level cancellation",
        "display": "cog-tiler-wasm renderTilePNG over a disk-backed File",
        "displayArtifact": dict(DISPLAY_ARTIFACT),
        "prepareArtifact": dict(GDAL_ARTIFACT),
        "slopeArtifact": dict(GDAL_ARTIFACT),
        "crsArtifact": dict(GDAL_ARTIFACT),
        "unpinnedRoles": [
            {"name": "gdal", "version": "3.8.4",
             "reason": "the plan allows native GDAL to retain preparation and slope"},
            {"name": "reference-resolver", "version": "harness",
             "reason": "harness reference implementation, not a shipped artifact"},
        ],
    },
    # Both candidate artifacts the route uses. Native GDAL is deliberately absent:
    # it stays under the plan-authorized unpinned policy.
    "artifacts": [dict(CANDIDATE_ARTIFACT), dict(DISPLAY_ARTIFACT)],
    # The declared source pins, independent of any report's own claim.
    "declared_artifact_pins": {
        "whitebox-wasm": "pin-abc123",
        "cog-tiler-wasm": "pin-cog-tiler-1",
    },
    "fixtures": [{"name": "derived_cog", "sha256": "a" * 64}],
    # The declared fixture manifest the control is measured against. Coverage is
    # judged from this declaration, never from the observed set.
    "fixture_manifest": {
        "declared": [{"name": "derived_cog", "sha256": "a" * 64}],
    },
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
                                 reports=reports, host=host, **assembly())

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
                             if m.get("routeRole") != "candidate"]))
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
             "routeRole": "candidate",
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
             "routeRole": "candidate",
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
        exercised = {"name": CANDIDATE_ARTIFACT["name"], "version": "9.9.9"}
        verdict, notes = evidence._from_versions(
            [dict(CANDIDATE_ARTIFACT)], [exercised])
        self.assertEqual(verdict, evidence.FAIL)
        self.assertIn("9.9.9", " ".join(notes))
        self.assertIn(CANDIDATE_ARTIFACT["version"], " ".join(notes))

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
        return gate.evaluate(self.contract,
                             self.bundle(self.assemble(), "reproduced.json"))

    def test_empty_runs_list_no_longer_passes(self) -> None:
        """Review input {"runs": []} previously produced exit 0 / pass."""
        self.write_reports()
        self.amend("trace", lambda p: p.__setitem__("runs", []))
        bundle_path = self.bundle(self.assemble(), "empty-runs.json")
        decision = gate.evaluate(self.contract, bundle_path)
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
        bundle_path = self.bundle(self.assemble(), "failed-run.json")
        decision = gate.evaluate(self.contract, bundle_path)
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

    def test_unobserved_requirements_stay_blocking_without_their_measurement(self) -> None:
        """Level 3: a complete, consistent probe set still is not enough (R3-03).

        This is the distinction the gate exists to make. Each requirement below is
        one no probe observes, and it stays blocking even when every report that
        does exist passes its own checks.
        """
        self.write_reports()
        # Remove the candidate's own memory measurement, which the recorded
        # evidence does not have: only request bytes were recorded there.
        self.amend("q6resources", lambda p: p["measurements"].__setitem__(
            0, {k: v for k, v in p["measurements"][0].items()
                if k not in ("incrementalPeakRssMiB", "sampleIntervalMs",
                             "sampleCount", "temporaryDiskHighWaterBytes",
                             "decodedCacheBytes", "activeReads", "queueDepth",
                             "maxConcurrentChildren")}))
        bundle_path = self.bundle(self.assemble(), "gaps.json")
        decision = gate.evaluate(self.contract, bundle_path)
        self.assertNotEqual(decision.verdict, gate.PASS)
        blocking = set(decision.as_dict()["blockingRequirementIds"])
        for requirement_id in ("Q-HOST-1", "Q-RES-1", "Q-CANCEL-1",
                               "Q-TEARDOWN-1", "Q-MEMBER-1", "Q-FAILINJ-1"):
            self.assertIn(requirement_id, blocking,
                          f"{requirement_id} must remain unresolved")


# --------------------------------------------------------------------------- #
# R3-01: a source report's own failures must reach the gate
# --------------------------------------------------------------------------- #

class SourceReportFailures(GateTestBase):
    """Admission must not promote observations from a report that failed itself."""

    def assemble_and_evaluate(self, mutate) -> gate.Decision:
        """Amend exactly one report, assemble, and evaluate the whole bundle."""
        write = getattr(self, "reports", None) or None
        if write is None:
            self.reports = passing_reports(self.root)
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **assembly())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def display_control(self) -> gate.Decision:
        self.reports = passing_reports(self.root)
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **assembly())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_passes_the_numeric_requirement(self) -> None:
        """Control: with an intact report, Q-LOCAL-1 is satisfied."""
        decision = self.display_control()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_failed_precondition_fails_the_requirement(self) -> None:
        """A failing fixture-hash check fails Q-LOCAL-1 even if values pass."""
        def mutate(payload):
            for assertion in payload["assertions"]:
                if assertion["name"] == "no-whole-file-request:plane2000":
                    assertion["ok"] = False
            payload["result"] = "fail"
            payload["failures"] = [
                "fixture-hash:plane2000: sha256 mismatch on the measured fixture"]
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn("q2-numeric", reasons, "the source report must be named")
        self.assertIn("fixture-hash", reasons, "the failed precondition must be named")

    def test_result_contradiction_fails_even_when_assertions_pass(self) -> None:
        """A report claiming pass while recording failures is corrupt."""
        def mutate(payload):
            payload["failures"] = ["something the report itself recorded"]
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("records failures", " ".join(requirement.reasons))

    def test_inconclusive_source_does_not_pass(self) -> None:
        """An inconclusive report cannot supply a passing observation."""
        def mutate(payload):
            payload["result"] = "inconclusive"
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertNotEqual(decision.verdict, gate.PASS)

    def test_partial_successes_stay_visible_but_do_not_satisfy(self) -> None:
        """A failed source keeps its measured detail without passing the gate."""
        def mutate(payload):
            payload["result"] = "fail"
            payload["failures"] = ["fixture-hash:plane2000: mismatch"]
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        # The value/validity observations are still recorded for review, in a
        # field that cannot be mistaken for satisfying evidence.
        self.assertTrue(requirement.observed_assertions,
                        "measured observations must stay visible")
        self.assertIn("values-match-independent-reference",
                      requirement.observed_assertions)
        self.assertEqual(requirement.assertions, {},
                         "a non-admitted source must promote nothing")

    def test_unrelated_requirements_are_preserved_when_one_source_fails(self) -> None:
        """One failing source must not erase another requirement's evidence."""
        def mutate(payload):
            payload["result"] = "fail"
            payload["failures"] = ["fixture-hash:plane2000: mismatch"]
        decision = self.assemble_and_evaluate(mutate)
        self.assertEqual(self.requirement(decision, "Q-PREP-1").verdict, gate.PASS)
        self.assertEqual(self.requirement(decision, "Q-CRS-1").verdict, gate.PASS)


# --------------------------------------------------------------------------- #
# R3-02: identity and hash admission
# --------------------------------------------------------------------------- #

class IdentityAdmission(GateTestBase):
    """Identity is extracted from the report and compared, never copied."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_identity(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload["identity"])
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self) -> gate.Decision:
        """Assemble from the (possibly amended) reports and evaluate the bundle.

        Named distinctly from the base `evaluate(payload)` helper: shadowing it
        made these tests depend on which class ran first.
        """
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **assembly())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_matching_identities_pass(self) -> None:
        decision = self.assemble_and_evaluate()
        for requirement_id in ("Q-LOCAL-1", "Q-PREP-1", "Q-RES-1"):
            with self.subTest(requirement=requirement_id):
                self.assertEqual(self.requirement(decision, requirement_id).verdict,
                                 gate.PASS,
                                 self.requirement(decision, requirement_id).reasons)

    def test_missing_fixture_hash_is_inconclusive(self) -> None:
        """A measured fixture without a hash cannot be matched to the manifest."""
        self.amend_identity("q2", lambda ident: ident["fixtures"][0].pop("sha256"))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("records no hash", " ".join(requirement.reasons))

    def test_fixture_hash_conflict_fails_with_both_values(self) -> None:
        self.amend_identity(
            "q2", lambda ident: ident["fixtures"][0].update({"sha256": "b" * 64}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn("hash conflict", reasons)
        self.assertIn("b" * 8, reasons, "the observed value must be named")
        self.assertIn("a" * 8, reasons, "the expected value must be named")

    def test_artifact_version_conflict_fails(self) -> None:
        """A source that measured a different artifact version conflicts.

        The declared route is copied before it is changed: mutating the shared
        ASSEMBLY fixture in place leaked this conflict into every later test.
        """
        # Only the declared route changes: the report still records 1.0.0, so the
        # two disagree.
        bundle = evidence.assemble(
            self.contract, out=self.root / "b.json", reports=self.reports,
            host="chromium",
            **{**ASSEMBLY,
               "route": {**ASSEMBLY["route"],
                         "numericArtifact": {**CANDIDATE_ARTIFACT, "version": "9.9.9"}}})
        decision = gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn("9.9.9", reasons)
        self.assertIn(CANDIDATE_ARTIFACT["version"], reasons)

    def test_route_conflict_fails(self) -> None:
        """A report measured on a different route cannot evidence the declared one."""
        self.amend_identity("q2", lambda ident: ident.update({"routeId": "other-route"}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn("route conflict", reasons)
        self.assertIn("other-route", reasons)
        self.assertIn(ROUTE_ID, reasons)

    def test_environment_conflict_fails(self) -> None:
        self.amend_identity(
            "q2", lambda ident: ident.update({"environment": "some-other-host"}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("environment conflict", " ".join(requirement.reasons))

    def test_missing_route_identity_is_inconclusive_not_silently_accepted(self) -> None:
        """An unlabelled report cannot inherit the declared route by default."""
        self.amend_identity("q2", lambda ident: ident.pop("routeId"))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("does not record the route", " ".join(requirement.reasons))

    def test_measured_policy_without_fixtures_is_inconclusive(self) -> None:
        def mutate(payload):
            payload["identity"]["fixtures"] = []
            payload["fixturesTested"] = 0
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("names no fixture", " ".join(requirement.reasons))

    def test_artifact_only_policy_cannot_excuse_a_raster_requirement(self) -> None:
        """Declaring no fixture cannot bypass a requirement measured on a raster."""
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        payload["identity"].update({"fixturePolicy": "artifact-only", "fixtures": []})
        payload["fixturesTested"] = 0
        path.write_text(json.dumps(payload))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("must be evidenced by a measured raster fixture",
                      " ".join(requirement.reasons))

    def test_fixture_count_disagreement_fails(self) -> None:
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        payload["fixturesTested"] = 7
        path.write_text(json.dumps(payload))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("fixturesTested=7", " ".join(requirement.reasons))

    def test_legacy_report_without_identity_is_inconclusive(self) -> None:
        """A report predating identity blocks stays readable, never upgraded."""
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        payload.pop("identity")
        path.write_text(json.dumps(payload))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("no identity block", " ".join(requirement.reasons))
        self.assertTrue(requirement.admission.get("legacy"))

    def test_reassembly_cannot_launder_a_conflict(self) -> None:
        """Assembling twice from unchanged sources reproduces the same conflict."""
        self.amend_identity(
            "q2", lambda ident: ident["fixtures"][0].update({"sha256": "c" * 64}))
        first = self.assemble_and_evaluate()
        second = self.assemble_and_evaluate()
        self.assertEqual(first.verdict, gate.FAIL)
        self.assertEqual(second.verdict, gate.FAIL)
        self.assertEqual(self.requirement(first, "Q-LOCAL-1").verdict,
                         self.requirement(second, "Q-LOCAL-1").verdict)

    def test_provenance_is_recorded_from_the_report_not_the_call(self) -> None:
        """The entry's provenance comes from the report's own identity block."""
        decision = self.assemble_and_evaluate()
        bundle = evidence.assemble(self.contract, out=self.root / "c.json",
                                   reports=self.reports, host="chromium", **assembly())
        entry = bundle["requirements"]["Q-LOCAL-1"]
        self.assertEqual(entry["provenance"]["routeId"], ROUTE_ID)
        # The digest is the one computed from the bytes read, not a value the
        # fixture asserted about itself.
        digest = entry["provenance"]["sourceDigest"]
        self.assertTrue(str(digest).startswith("sha256:"), digest)
        self.assertEqual(len(str(digest)), len("sha256:") + 64)
        self.assertEqual(entry["provenance"]["fixtures"][0]["sha256"], FIXTURE_HASH)


# --------------------------------------------------------------------------- #
# R3-03: route sufficiency and source correspondence
# --------------------------------------------------------------------------- #

class RouteSufficiency(GateTestBase):
    """Naming a route in a report does not make it the required route."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_identity(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload["identity"])
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self, **route_overrides) -> gate.Decision:
        declared = assembly()
        declared["route"] = {**declared["route"], **route_overrides}
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **declared)
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_declared_and_recorded_transport_agree(self) -> None:
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_http_only_transport_cannot_satisfy_the_local_bridge(self) -> None:
        """HTTP-range evidence is a real capability but not the required bridge."""
        self.amend_identity(
            "q2", lambda ident: ident.update({"transport": "http-range"}))
        decision = self.assemble_and_evaluate(
            numericExpectedTransport="scoped-local-bridge")
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        reasons = " ".join(requirement.reasons)
        self.assertIn("http-range", reasons)
        self.assertIn("scoped-local-bridge", reasons)
        # The HTTP capability observations stay visible for review.
        self.assertTrue(requirement.observed_assertions or requirement.assertions)

    def test_renaming_the_route_string_does_not_change_the_transport(self) -> None:
        """Reassembly with a different label must not launder the transport."""
        self.amend_identity(
            "q2", lambda ident: ident.update({"transport": "http-range"}))
        decision = self.assemble_and_evaluate(
            numeric="the intended scoped Desktop/native/worker bridge",
            numericExpectedTransport="scoped-local-bridge")
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict,
                         gate.INCONCLUSIVE)

    def test_matching_local_bridge_transport_passes(self) -> None:
        self.amend_identity(
            "q2", lambda ident: ident.update({"transport": "scoped-local-bridge"}))
        decision = self.assemble_and_evaluate(
            numericExpectedTransport="scoped-local-bridge")
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS)


class SourceCorrespondence(GateTestBase):
    """Artifact/source correspondence cannot be satisfied by recording a mismatch."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def declared(self) -> dict:
        """The shared declaration, whose pins the fixture records cite."""
        return assembly()

    def amend_q1(self, mutate) -> None:
        path = self.reports["q1"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self) -> gate.Decision:
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium",
                                   **self.declared())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_matching_source_passes(self) -> None:
        """The shared fixture's own matching correspondence satisfies the control."""
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-ART-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-ART-1").reasons)

    def test_different_source_revision_cannot_pass(self) -> None:
        """A published artifact at another revision is not correspondence."""
        pinned = ASSEMBLY["declared_artifact_pins"]["whitebox-wasm"]
        other = ASSEMBLY["declared_artifact_pins"]["cog-tiler-wasm"]
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                {"artifact": "whitebox-wasm", "version": "0.5.1",
                 "pinnedRevision": pinned, "artifactRevision": "def456",
                 "matches": False},
                {"artifact": "cog-tiler-wasm", "version": "0.3.6",
                 "pinnedRevision": other, "artifactRevision": other,
                 "matches": True}]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn(pinned, reasons)
        self.assertIn("def456", reasons)

    def test_matching_revision_control_satisfies_correspondence(self) -> None:
        """The control for a matching revision, kept alongside the R4-02 build case."""
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-ART-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-ART-1").reasons)

    def test_unverified_correspondence_is_inconclusive(self) -> None:
        """No correspondence record at all is a gap, not a silent pass.

        The shared fixture records correspondence for its control, so the record
        is removed here to isolate the gap.
        """
        self.amend_q1(lambda payload: payload.pop("sourceCorrespondence", None))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("correspondence", " ".join(requirement.reasons).lower())


# --------------------------------------------------------------------------- #
# R3-04: sidecar evidence and fixture policy
# --------------------------------------------------------------------------- #

class SidecarEvidence(GateTestBase):
    """Absence of sidecar evidence is a gap; only policy can settle it."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_q3(self, mutate) -> None:
        path = self.reports["q3prepare"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self) -> gate.Decision:
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **assembly())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_declared_absent_sidecar_passes(self) -> None:
        """The shared fixture declares that no sidecar applies."""
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-PREP-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-PREP-1").reasons)

    def test_measured_sidecar_that_changed_fails(self) -> None:
        self.amend_q3(lambda payload: payload.update({
            "sidecar": {"expectedSha256": "d" * 64, "sha256": "e" * 64}}))
        self.amend_q3(lambda payload: payload["identity"].update(
            {"sidecarPolicy": "measured"}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-PREP-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("sidecar changed", " ".join(requirement.reasons))

    def test_measured_sidecar_that_survived_passes(self) -> None:
        self.amend_q3(lambda payload: payload.update({
            "sidecar": {"expectedSha256": "d" * 64, "sha256": "d" * 64}}))
        self.amend_q3(lambda payload: payload["identity"].update(
            {"sidecarPolicy": "measured"}))
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-PREP-1").verdict, gate.PASS)

    def test_unobserved_sidecar_is_inconclusive(self) -> None:
        """An unmeasured sidecar cannot be assumed absent."""
        self.amend_q3(lambda payload: payload["identity"].update(
            {"sidecarPolicy": "unmeasured"}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-PREP-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("sidecar", " ".join(requirement.reasons).lower())

    def test_measured_policy_without_a_sidecar_record_is_inconclusive(self) -> None:
        self.amend_q3(lambda payload: payload["identity"].update(
            {"sidecarPolicy": "measured"}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-PREP-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("not recorded", " ".join(requirement.reasons))


# --------------------------------------------------------------------------- #
# R3-05: display statistics derived from samples
# --------------------------------------------------------------------------- #

class PercentileConvention(unittest.TestCase):
    """The percentile convention, frozen against hand-calculated values.

    Expected values below are computed by hand from the producer's documented
    convention, not by calling the implementation under test.
    """

    def test_small_samples_match_hand_calculation(self) -> None:
        # sorted [1,2,3,4]: median index ceil(0.5*4)-1 = 1 -> 2
        #                    p95    index ceil(0.95*4)-1 = 3 -> 4
        self.assertEqual(evidence.sample_percentile([4, 1, 3, 2], 50), 2)
        self.assertEqual(evidence.sample_percentile([4, 1, 3, 2], 95), 4)

    def test_single_sample_returns_that_sample(self) -> None:
        self.assertEqual(evidence.sample_percentile([7.5], 50), 7.5)
        self.assertEqual(evidence.sample_percentile([7.5], 95), 7.5)

    def test_boundary_rounding_picks_the_next_rank(self) -> None:
        # 100 samples 1..100: p95 index ceil(95)-1 = 94 -> 95
        values = [float(i) for i in range(1, 101)]
        self.assertEqual(evidence.sample_percentile(values, 95), 95.0)
        # 20 samples: ceil(0.95*20)-1 = 18 -> the 19th smallest = 19
        self.assertEqual(evidence.sample_percentile([float(i) for i in range(1, 21)], 95),
                         19.0)
        # p100 clamps to the largest
        self.assertEqual(evidence.sample_percentile(values, 100), 100.0)

    def test_empty_and_invalid_samples(self) -> None:
        self.assertIsNone(evidence.sample_percentile([], 95))
        self.assertIsNone(evidence.sample_percentile([float("nan")], 95))


class DisplayStatistics(GateTestBase):
    """Reported statistics must agree with the sample and with the counters."""

    def assertions(self, trace: dict) -> tuple[dict, list[str], dict]:
        return evidence.display_trace_assertions(trace, **TRACE_LIMITS)

    def sample_run(self, **overrides) -> dict:
        """A run whose reported statistics match its own sample.

        The latencies are a fixed 128-point sample; the median, p95 and max are
        the nearest-rank values for that sample, calculated by hand:
        sorted sample is 0.0..5.9 in steps of 0.1, repeated; index for p50 is 63
        (2.7), for p95 is 121 (5.6), and the maximum is 5.9.
        """
        base = {
            "name": "warm", "ok": True, "tileRequests": 128, "tilesRendered": 128,
            "failedTiles": 0, "medianMs": 2.7, "p95Ms": 5.6, "maxMs": 5.9,
            "individualLatenciesMs": [0.1 * (i % 60) for i in range(128)],
            "cachesCleared": "fresh page", "longTaskMaxMs": 5.0,
            "longTaskCount": 0, "longTaskObserverSupported": True,
        }
        base.update(overrides)
        return base

    def test_control_consistent_run_passes_its_statistics(self) -> None:
        results, notes, observed = self.assertions({"runs": [self.sample_run()]})
        self.assertEqual(results["statistics-agree-with-samples"], evidence.PASS, notes)
        self.assertAlmostEqual(observed["sampleP95Ms"], 5.6, places=6)

    def test_one_failed_tile_fails_rendering(self) -> None:
        results, _, _ = self.assertions(
            {"runs": [self.sample_run(failedTiles=1, tilesRendered=127)]})
        self.assertEqual(results["runs-report-successful-rendering"], evidence.FAIL)

    def test_missing_counters_are_rejected(self) -> None:
        for field in ("tileRequests", "tilesRendered", "failedTiles"):
            with self.subTest(field=field):
                run = self.sample_run()
                del run[field]
                results, _, _ = self.assertions({"runs": [run]})
                self.assertEqual(results["runs-report-successful-rendering"],
                                 evidence.UNKNOWN)

    def test_invalid_counts_are_rejected(self) -> None:
        for value in (-1, 1.5):
            with self.subTest(value=value):
                results, _, _ = self.assertions(
                    {"runs": [self.sample_run(tilesRendered=value)]})
                self.assertEqual(results["runs-report-successful-rendering"],
                                 evidence.FAIL)

    def test_counts_disagreeing_with_samples_are_rejected(self) -> None:
        """128 samples but only one rendered tile is an inconsistency."""
        results, notes, _ = self.assertions(
            {"runs": [self.sample_run(tilesRendered=1, tileRequests=1)]})
        self.assertEqual(results["statistics-agree-with-samples"], evidence.FAIL)
        self.assertTrue(any("rendered" in n for n in notes), notes)

    def test_inconsistent_reported_p95_is_rejected(self) -> None:
        """A reported p95 that disagrees with the samples is not accepted."""
        results, notes, observed = self.assertions({"runs": [self.sample_run(p95Ms=999.0)]})
        self.assertEqual(results["statistics-agree-with-samples"], evidence.FAIL)
        self.assertIn("p95", " ".join(notes))
        # The sample-derived value is reported so the disagreement is visible.
        self.assertAlmostEqual(observed["sampleP95Ms"], 5.6, places=6)

    def test_sample_derived_statistic_is_used_not_the_reported_one(self) -> None:
        """Even a plausible reported number cannot replace the sample."""
        results, _, observed = self.assertions({"runs": [self.sample_run(p95Ms=5.0)]})
        self.assertEqual(results["statistics-agree-with-samples"], evidence.FAIL)
        self.assertAlmostEqual(observed["sampleP95Ms"], 5.6, places=6)

    def test_invalid_latency_values_are_rejected(self) -> None:
        for bad in (float("nan"), -1.0, "fast"):
            with self.subTest(bad=bad):
                values = [0.1] * 127 + [bad]
                results, _, _ = self.assertions(
                    {"runs": [self.sample_run(individualLatenciesMs=values)]})
                self.assertEqual(results["hundred-valid-latencies-per-run"], evidence.FAIL)


# --------------------------------------------------------------------------- #
# Same-class audit: assertions that were admitted without evidence
# --------------------------------------------------------------------------- #

class UnconditionalAssertions(GateTestBase):
    """An assertion must rest on an observation, not on the absence of one."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def assemble_and_evaluate(self, mutate=None) -> gate.Decision:
        if mutate:
            path = self.reports["q4crs"]
            payload = json.loads(path.read_text())
            mutate(payload)
            path.write_text(json.dumps(payload))
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **assembly())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_crs_control_still_passes(self) -> None:
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-CRS-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-CRS-1").reasons)

    def test_metadata_rewrite_assertion_requires_an_observation(self) -> None:
        """The original-metadata claim must cite the report that checked it.

        The CRS report records that the original metadata was not rewritten; with
        that observation removed the assertion is a gap, not an automatic pass.
        """
        def mutate(payload):
            payload["assertions"] = [
                a for a in payload["assertions"]
                if a["name"] != "original-metadata-untouched"]
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-CRS-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("no-metadata-rewritten-or-inferred", requirement.assertions)
        self.assertEqual(requirement.assertions["no-metadata-rewritten-or-inferred"],
                         evidence.UNKNOWN)

    def test_metadata_rewrite_observation_failing_fails_the_requirement(self) -> None:
        def mutate(payload):
            for assertion in payload["assertions"]:
                if assertion["name"] == "original-metadata-untouched":
                    assertion["ok"] = False
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-CRS-1")
        self.assertEqual(requirement.verdict, gate.FAIL)


class RouteAttribution(GateTestBase):
    """A measurement's role is declared, not inferred from its label."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def assemble_and_evaluate(self, mutate=None) -> gate.Decision:
        if mutate:
            path = self.reports["q6resources"]
            payload = json.loads(path.read_text())
            mutate(payload)
            path.write_text(json.dumps(payload))
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **assembly())
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_declared_roles_pass(self) -> None:
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-RES-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-RES-1").reasons)

    def test_reference_measurement_relabelled_as_candidate_is_rejected(self) -> None:
        """Renaming a reference measurement must not make it candidate evidence."""
        def mutate(payload):
            for measurement in payload["measurements"]:
                if measurement.get("routeRole") == "reference":
                    measurement["route"] = "candidate (wasm ranged transport)"
        self.assemble_and_evaluate(mutate)
        # The declared role still marks the entry as a reference measurement, so
        # renaming its route text cannot move its figures into the candidate's.
        bundle = evidence.assemble(self.contract, out=self.root / "c.json",
                                   reports=self.reports, host="chromium",
                                   **assembly())
        self.assertEqual(bundle["requirements"]["Q-RES-1"]["observations"]
                         ["candidateMemoryMiB"], 300.0,
                         "the candidate figure must not come from the renamed "
                         "reference measurement")

    def test_relabelling_both_role_and_text_is_rejected_as_a_contradiction(self) -> None:
        """A record that disagrees with itself cannot attribute the measurement."""
        def mutate(payload):
            for measurement in payload["measurements"]:
                if measurement.get("routeRole") == "reference":
                    measurement["routeRole"] = "candidate"
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-RES-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("reference route", " ".join(requirement.reasons))

    def test_measurement_without_a_declared_role_is_not_candidate_evidence(self) -> None:
        def mutate(payload):
            for measurement in payload["measurements"]:
                measurement.pop("routeRole", None)
        decision = self.assemble_and_evaluate(mutate)
        requirement = self.requirement(decision, "Q-RES-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("role", " ".join(requirement.reasons).lower())


# --------------------------------------------------------------------------- #
# R4-01: fixture membership and coverage
# --------------------------------------------------------------------------- #

FIXTURE_A = {"name": "plane2000", "sha256": "1" * 64}
FIXTURE_B = {"name": "steep45", "sha256": "2" * 64}

#: The declared fixture manifest: which fixtures each role is required to cover,
#: and whether the role may cover an explicit subset of them.
FIXTURE_MANIFEST = {
    "declared": [dict(FIXTURE_A), dict(FIXTURE_B)],
    "requiredFixtures": {
        "q2": ["plane2000", "steep45"],
    },
    "subsetAllowed": {"q2": True},
}


def fixture_manifest() -> dict:
    """A fresh deep copy, so a test cannot leak a change into the next one."""
    return copy.deepcopy(FIXTURE_MANIFEST)


class FixtureCoverage(GateTestBase):
    """Observed fixture identities are compared with the required set for the role."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)
        self.reports = passing_reports(self.root)
        # The numeric report measures both required fixtures.
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        payload["identity"]["fixtures"] = [dict(FIXTURE_A), dict(FIXTURE_B)]
        payload["fixturesTested"] = 2
        path.write_text(json.dumps(payload))

    def amend_q2(self, mutate) -> None:
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self, manifest: dict | None = None) -> gate.Decision:
        declared = assembly()
        declared["fixture_manifest"] = fixture_manifest() if manifest is None else manifest
        # The fixtures the shared assembler call passes must match the declaration,
        # so the control is internally consistent.
        declared["fixtures"] = [dict(FIXTURE_A), dict(FIXTURE_B)]
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **declared)
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_covering_every_required_fixture_passes(self) -> None:
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_unexpected_fixture_is_a_conflict(self) -> None:
        self.amend_q2(lambda p: p["identity"]["fixtures"].append(
            {"name": "plane256", "sha256": "3" * 64}))
        self.amend_q2(lambda p: p.__setitem__("fixturesTested", 3))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("plane256", " ".join(requirement.reasons))

    def test_missing_required_fixture_is_inconclusive(self) -> None:
        """Covering only part of a required set is a gap, not a pass."""
        self.amend_q2(lambda p: p["identity"].__setitem__("fixtures", [dict(FIXTURE_A)]))
        self.amend_q2(lambda p: p.__setitem__("fixturesTested", 1))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("steep45", " ".join(requirement.reasons))

    def test_declared_explicit_subset_passes(self) -> None:
        """A report may cover a declared subset; the declaration is the contract."""
        self.amend_q2(lambda p: p["identity"].__setitem__("fixtures", [dict(FIXTURE_A)]))
        self.amend_q2(lambda p: p.__setitem__("fixturesTested", 1))
        manifest = fixture_manifest()
        manifest["requiredFixtures"]["q2"] = ["plane2000"]
        decision = self.assemble_and_evaluate(manifest)
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_duplicate_fixture_identity_is_rejected(self) -> None:
        self.amend_q2(lambda p: p["identity"]["fixtures"].append(dict(FIXTURE_A)))
        self.amend_q2(lambda p: p.__setitem__("fixturesTested", 3))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("duplicate", " ".join(requirement.reasons).lower())

    def test_replaced_fixture_hash_is_a_conflict(self) -> None:
        def mutate(payload):
            payload["identity"]["fixtures"][0]["sha256"] = "9" * 64
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn("9" * 8, reasons)
        self.assertIn("1" * 8, reasons)

    def test_malformed_hash_is_not_a_valid_identity(self) -> None:
        """A digest of the wrong shape is malformed, not merely missing.

        R5-01 changed this verdict. It used to be read as a gap because the value
        merely failed to match; a declared digest that cannot be a digest is a
        malformed declaration, and a malformed declaration fails. The declared
        manifest carries the same malformed value, so the only condition under
        test is the shape of the digest rather than a conflict between two values.
        """
        self.amend_q2(lambda p: p["identity"]["fixtures"][0].__setitem__(
            "sha256", "not-a-sha256"))
        manifest = fixture_manifest()
        manifest["declared"][0]["sha256"] = "not-a-sha256"
        decision = self.assemble_and_evaluate(manifest)
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL,
                         requirement.reasons)
        self.assertIn("malformed sha256", " ".join(requirement.reasons).lower())

    def test_omitted_declared_manifest_is_inconclusive(self) -> None:
        """No declared manifest means coverage cannot be established."""
        decision = self.assemble_and_evaluate(manifest={})
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("manifest", " ".join(requirement.reasons).lower())


# --------------------------------------------------------------------------- #
# R4-02: artifact correspondence coverage
# --------------------------------------------------------------------------- #

#: The pins the qualification route declares, independent of any report. These
#: mirror the candidate manifest, not the correspondence the report supplies.
DECLARED_PINS = {
    "whitebox-wasm": "pin-whitebox-abc123",
    "cog-tiler-wasm": "pin-cog-tiler-def456",
}


def correspondence(artifact: str, version: str, *, pinned: str | None = None,
                   built_from: str | None = None, **extra) -> dict:
    """One correspondence record. The pin comes from the declaration, not the report."""
    record = {
        "artifact": artifact,
        "version": version,
        "pinnedRevision": DECLARED_PINS.get(artifact) if pinned is None else pinned,
        "artifactRevision": (DECLARED_PINS.get(artifact) if built_from is None
                             else built_from),
        "matches": True,
    }
    record.update(extra)
    return record


class ArtifactCorrespondence(GateTestBase):
    """Every required measured artifact needs its own matching correspondence."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_q1(self, mutate) -> None:
        path = self.reports["q1"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self) -> gate.Decision:
        declared = assembly()
        declared["declared_artifact_pins"] = dict(DECLARED_PINS)
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **declared)
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def produce(self) -> dict:
        declared = assembly()
        declared["declared_artifact_pins"] = dict(DECLARED_PINS)
        return evidence.assemble(self.contract, out=self.root / "b.json",
                                 reports=self.reports, host="chromium", **declared)

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_full_matching_correspondence_passes(self) -> None:
        """Both required artifacts are recorded against their declared pins."""
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-ART-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-ART-1").reasons)

    def test_missing_record_for_one_required_artifact_is_inconclusive(self) -> None:
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [correspondence("whitebox-wasm", "0.5.1")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("cog-tiler-wasm", " ".join(requirement.reasons))

    def test_unrelated_correspondence_does_not_satisfy_a_required_artifact(self) -> None:
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1"),
                correspondence("some-other-library", "1.0.0")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertNotEqual(requirement.verdict, gate.PASS)
        self.assertIn("cog-tiler-wasm", " ".join(requirement.reasons))

    def test_wrong_version_for_a_required_artifact_is_inconclusive(self) -> None:
        """A record for another version does not cover the required version."""
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.4.1"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertNotEqual(requirement.verdict, gate.PASS)
        reasons = " ".join(requirement.reasons)
        self.assertIn("whitebox-wasm@0.5.1", reasons)
        self.assertIn("no correspondence record", reasons)

    def test_revision_mismatch_fails(self) -> None:
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1", built_from="other-rev"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertEqual(requirement.verdict, gate.FAIL)

    def test_build_flag_alone_cannot_excuse_a_revision_mismatch(self) -> None:
        """A boolean is not build evidence."""
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1", built_from="other-rev",
                               buildReproduced=True),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("build evidence", " ".join(requirement.reasons).lower())

    def test_fully_evidenced_pinned_build_is_accepted(self) -> None:
        """A reproducible build needs built identity, source revision and evidence."""
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence(
                    "whitebox-wasm", "0.5.1", built_from="other-rev",
                    buildReproduced=True,
                    builtArtifact={"name": "whitebox-wasm", "version": "0.5.1",
                                   "sha256": "b" * 64},
                    sourceRevision="pin-whitebox-abc123",
                    buildEvidence={"command": "cargo build --target wasm32-unknown-unknown",
                                   "log": "build-log.txt", "sha256": "c" * 64}),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-ART-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-ART-1").reasons)

    def test_duplicate_correspondence_records_fail(self) -> None:
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1"),
                correspondence("whitebox-wasm", "0.5.1", built_from="other-rev"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("duplicate", " ".join(requirement.reasons).lower())

    def test_pin_claimed_only_by_the_report_is_not_an_expected_pin(self) -> None:
        """A report cannot establish its own expectation."""
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                # The report asserts a pin that disagrees with the declaration and
                # claims it matches.
                correspondence("whitebox-wasm", "0.5.1", pinned="report-invented-pin"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertNotEqual(requirement.verdict, gate.PASS)
        self.assertIn("report-invented-pin", " ".join(requirement.reasons))

    def test_absent_declared_pins_leave_correspondence_inconclusive(self) -> None:
        """Without a declared pin there is nothing to correspond to."""
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        declared = assembly()
        declared["declared_artifact_pins"] = None
        bundle = evidence.assemble(self.contract, out=self.root / "c.json",
                                   reports=self.reports, host="chromium", **declared)
        decision = gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))
        requirement = self.requirement(decision, "Q-ART-1")
        self.assertNotEqual(requirement.verdict, gate.PASS)

    def test_unpinned_tool_is_excluded_from_the_required_artifact_set(self) -> None:
        """Native GDAL stays under the plan-authorized unpinned policy.

        The exclusion must be explicit: a retained tool is declared unpinned with
        a reason, not silently dropped from the required set.
        """
        self.amend_q1(lambda payload: payload.update({
            "sourceCorrespondence": [
                correspondence("whitebox-wasm", "0.5.1"),
                correspondence("cog-tiler-wasm", "0.3.6")]}))
        bundle = self.produce()
        entry = bundle["requirements"]["Q-ART-1"]
        self.assertEqual(entry["assertions"]["qualified-roles-name-artifact-version"],
                         evidence.PASS, entry["observations"])
        self.assertIn("gdal", entry["observations"]["unpinnedRoleNames"])
        self.assertNotIn("gdal", entry["observations"]["requiredArtifactNames"])
        # And no correspondence is demanded for it.
        self.assertFalse(any("gdal" in reason for reason in entry["observations"]["notes"]))


# --------------------------------------------------------------------------- #
# R4-04: failure precedence before identity gaps
# --------------------------------------------------------------------------- #

class FailurePrecedence(GateTestBase):
    """A known failure must not be erased by a missing identity block."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_q2(self, mutate) -> None:
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self, **overrides) -> gate.Decision:
        declared = assembly()
        declared.update(overrides)
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **declared)
        return gate.evaluate(self.contract, self.bundle(bundle, "bundle.json"))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_passes_the_numeric_requirement(self) -> None:
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_failed_report_without_identity_is_still_a_failure(self) -> None:
        """The legacy early-return must not hide a recorded failure."""
        def mutate(payload):
            payload.pop("identity")
            payload["result"] = "fail"
            payload["failures"] = ["fixture-hash:plane2000: sha256 mismatch"]
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        reasons = " ".join(requirement.reasons)
        self.assertIn("fail", reasons.lower())
        self.assertIn("sha256 mismatch", reasons)

    def test_failed_precondition_without_identity_is_still_a_failure(self) -> None:
        def mutate(payload):
            payload.pop("identity")
            payload["preconditions"] = [
                {"name": "fixture-hash", "met": False}]
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("fixture-hash", " ".join(requirement.reasons))

    def test_malformed_result_without_identity_fails(self) -> None:
        """A verdict that is present but unusable is a failure, not a gap."""
        def mutate(payload):
            payload.pop("identity")
            payload["result"] = "probably-fine"
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("unusable result", " ".join(requirement.reasons))

    def test_absent_result_without_identity_is_inconclusive(self) -> None:
        """A raw producer artifact that never claimed a verdict is a gap."""
        def mutate(payload):
            payload.pop("identity")
            payload.pop("result", None)
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("not a qualification report", " ".join(requirement.reasons))

    def test_legacy_passing_report_without_identity_is_inconclusive(self) -> None:
        """A gap-only legacy report stays readable but cannot pass."""
        self.amend_q2(lambda payload: payload.pop("identity"))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("no identity block", " ".join(requirement.reasons))

    def test_failure_outranks_a_stale_timestamp_gap(self) -> None:
        """A failure plus a provenance gap is a failure, not inconclusive."""
        def mutate(payload):
            payload["result"] = "fail"
            payload["failures"] = ["measurement aborted"]
            payload["identity"]["recordedAt"] = 1
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("measurement aborted", " ".join(requirement.reasons))

    def test_negative_control_failure_is_not_a_positive_failure(self) -> None:
        """An expected rejection failing is scoped to the control, not the run."""
        def mutate(payload):
            payload["negativeControlScopes"] = ["expected-rejection:"]
            payload["failures"] = ["expected-rejection:stripped: control did not reject"]
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        # The positive observations are unaffected, so the requirement is not
        # failed by the control's own failure.
        self.assertNotEqual(requirement.verdict, gate.FAIL)

    def test_failure_reaches_every_requirement_using_that_source(self) -> None:
        """A source feeds several requirements; all of them must see the failure."""
        def mutate(payload):
            payload["result"] = "fail"
            payload["failures"] = ["shared source failure"]
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        for requirement_id in ("Q-LOCAL-1", "Q-VALUE-1"):
            with self.subTest(requirement=requirement_id):
                self.assertEqual(self.requirement(decision, requirement_id).verdict,
                                 gate.FAIL)

    def test_unrelated_requirements_are_unchanged_by_one_source_failure(self) -> None:
        def mutate(payload):
            payload["result"] = "fail"
            payload["failures"] = ["shared source failure"]
        self.amend_q2(mutate)
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-PREP-1").verdict, gate.PASS)
        self.assertEqual(self.requirement(decision, "Q-CRS-1").verdict, gate.PASS)

    def test_duplicate_identity_keys_in_raw_json_fail(self) -> None:
        """A duplicated identity key must not be collapsed by dict conversion."""
        path = self.reports["q2"]
        text = path.read_text()
        payload = json.loads(text)
        inner = json.dumps(payload["identity"])
        broken = text.replace('"identity": {',
                              '"identity": ' + inner + ',"identity": {', 1)
        path.write_text(broken)
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("repeats identity key",
                      " ".join(requirement.reasons).lower())


# --------------------------------------------------------------------------- #
# R4-03: source-run provenance and freshness
# --------------------------------------------------------------------------- #

#: A fixed evaluation time so age statements are exact rather than approximate.
FIXED_NOW = 1_800_000_000.0
DAY = 86400.0


class SourceProvenance(GateTestBase):
    """Run identity, recorded time and freshness are part of admission."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)
        self.stamp_all(FIXED_NOW - 3600.0)

    def stamp_all(self, when: float) -> None:
        for role, path in self.reports.items():
            payload = json.loads(path.read_text())
            identity = payload.get("identity")
            if isinstance(identity, dict):
                identity["recordedAt"] = when
            path.write_text(json.dumps(payload))

    def amend_identity(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload["identity"])
        path.write_text(json.dumps(payload))

    def assemble_and_evaluate(self, now: float | None = FIXED_NOW) -> gate.Decision:
        declared = assembly()
        declared["now"] = now
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **declared)
        path = self.bundle(bundle, "provenance.json")
        return gate.evaluate(self.contract, path, now=now)

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def test_control_fresh_run_with_identity_passes(self) -> None:
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_missing_run_identity_is_inconclusive(self) -> None:
        self.amend_identity("q2", lambda ident: ident.pop("runId"))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("runId", " ".join(requirement.reasons))

    def test_missing_recorded_time_is_inconclusive(self) -> None:
        self.amend_identity("q2", lambda ident: ident.pop("recordedAt"))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.INCONCLUSIVE)
        self.assertIn("recordedAt", " ".join(requirement.reasons))

    def test_epoch_one_timestamp_fails_as_expired(self) -> None:
        self.amend_identity("q2", lambda ident: ident.update({"recordedAt": 1}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("stale", " ".join(requirement.reasons).lower())

    def test_non_finite_timestamps_fail(self) -> None:
        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                self.reports = passing_reports(self.root)
                self.stamp_all(FIXED_NOW - 3600.0)
                self.amend_identity("q2", lambda ident, v=value: ident.update(
                    {"recordedAt": v}))
                decision = self.assemble_and_evaluate()
                requirement = self.requirement(decision, "Q-LOCAL-1")
                self.assertEqual(requirement.verdict, gate.FAIL)
                self.assertIn("finite", " ".join(requirement.reasons).lower())

    def test_boolean_timestamp_fails(self) -> None:
        self.amend_identity("q2", lambda ident: ident.update({"recordedAt": True}))
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.FAIL)

    def test_future_timestamp_fails(self) -> None:
        self.amend_identity("q2", lambda ident: ident.update(
            {"recordedAt": FIXED_NOW + 3600.0}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("future", " ".join(requirement.reasons).lower())

    def test_exactly_at_the_age_limit_is_accepted(self) -> None:
        self.amend_identity("q2", lambda ident: ident.update(
            {"recordedAt": FIXED_NOW - 7 * DAY}))
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS,
                         self.requirement(decision, "Q-LOCAL-1").reasons)

    def test_just_over_the_age_limit_fails(self) -> None:
        self.amend_identity("q2", lambda ident: ident.update(
            {"recordedAt": FIXED_NOW - 7 * DAY - 1}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("stale", " ".join(requirement.reasons).lower())

    def test_reassembly_does_not_refresh_source_age(self) -> None:
        """A fresh bundle must not make old source evidence current."""
        self.amend_identity("q2", lambda ident: ident.update(
            {"recordedAt": FIXED_NOW - 30 * DAY}))
        first = self.assemble_and_evaluate()
        second = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(first, "Q-LOCAL-1").verdict, gate.FAIL)
        self.assertEqual(self.requirement(second, "Q-LOCAL-1").verdict, gate.FAIL)

    def test_source_digest_is_computed_from_the_bytes_read(self) -> None:
        """A self-reported digest cannot stand in for the content read."""
        self.amend_identity("q2", lambda ident: ident.update(
            {"digest": "sha256:" + "0" * 64}))
        decision = self.assemble_and_evaluate()
        requirement = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(requirement.verdict, gate.FAIL)
        self.assertIn("digest", " ".join(requirement.reasons).lower())

    def test_matching_self_reported_digest_is_accepted(self) -> None:
        """The control with a truthful digest passes."""
        decision = self.assemble_and_evaluate()
        self.assertEqual(self.requirement(decision, "Q-LOCAL-1").verdict, gate.PASS)


# --------------------------------------------------------------------------- #
# Metamorphic invariants over the bounded evidence fields
# --------------------------------------------------------------------------- #

class EvidenceMonotonicity(GateTestBase):
    """Deleting evidence never helps; unrelated evidence never satisfies."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_q2(self, mutate) -> None:
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def verdict(self) -> tuple[str, dict]:
        declared = assembly()
        bundle_path = self.bundle(
            evidence.assemble(self.contract, out=self.root / "b.json",
                              reports=self.reports, host="chromium", **declared),
            "monotonic.json")
        decision = gate.evaluate(self.contract, bundle_path)
        local = next(r for r in decision.as_dict()["requirements"]
                     if r["requirementId"] == "Q-LOCAL-1")
        return decision.verdict, local

    def test_deleting_a_fixture_never_improves_eligibility(self) -> None:
        before = self.verdict()
        self.amend_q2(lambda p: p["identity"].__setitem__("fixtures", []))
        self.amend_q2(lambda p: p.__setitem__("fixturesTested", 0))
        after = self.verdict()
        self.assertLessEqual(_rank(after[0]), _rank(before[0]),
                             f"{before[0]} -> {after[0]}")

    def test_deleting_the_identity_never_improves_eligibility(self) -> None:
        before = self.verdict()
        self.amend_q2(lambda p: p.pop("identity", None))
        after = self.verdict()
        self.assertLessEqual(_rank(after[0]), _rank(before[0]))

    def test_adding_an_unrelated_fixture_never_satisfies(self) -> None:
        before = self.verdict()
        self.amend_q2(lambda p: p["identity"]["fixtures"].append(
            {"name": "unrelated", "sha256": "7" * 64}))
        self.amend_q2(lambda p: p.__setitem__("fixturesTested", 2))
        after = self.verdict()
        self.assertLessEqual(_rank(after[0]), _rank(before[0]))

    def test_adding_an_unrelated_correspondence_never_satisfies(self) -> None:
        before = self.verdict()
        path = self.reports["q1"]
        payload = json.loads(path.read_text())
        payload["sourceCorrespondence"].append({
            "artifact": "unrelated-library", "version": "9.9.9",
            "pinnedRevision": "x", "artifactRevision": "x", "matches": True})
        path.write_text(json.dumps(payload))
        after = self.verdict()
        self.assertLessEqual(_rank(after[0]), _rank(before[0]))

    def test_adding_a_gap_never_downgrades_a_failure(self) -> None:
        """A failure plus a new gap stays a failure."""
        self.amend_q2(lambda p: p.update(
            {"result": "fail", "failures": ["known failure"]}))
        before = self.verdict()
        self.assertEqual(before[0], gate.FAIL)
        self.amend_q2(lambda p: p.pop("identity", None))
        after = self.verdict()
        self.assertEqual(after[0], gate.FAIL,
                         "a provenance gap must not soften a known failure")
        self.assertIn("known failure", " ".join(after[1]["reasons"]))

    def test_fresh_bundle_never_refreshes_a_stale_source(self) -> None:
        self.amend_q2(lambda p: p["identity"].update({"recordedAt": 1}))
        first = self.verdict()
        second = self.verdict()
        self.assertEqual(first[0], second[0])
        self.assertEqual(first[0], gate.FAIL)


def _rank(verdict: str) -> int:
    """Eligibility ordering: deleting evidence must never move this up."""
    return {"fail": 0, "inconclusive": 1, "pass": 2}.get(verdict, 1)


# --------------------------------------------------------------------------- #
# R5-01: declaration validation before lookup construction
# --------------------------------------------------------------------------- #

def valid_manifest() -> dict:
    """A declaration whose members and per-role requirements are all valid."""
    return {
        "declared": [{"name": "plane2000", "sha256": "1" * 64},
                     {"name": "steep45", "sha256": "2" * 64}],
        "requiredFixtures": {"q2": ["plane2000", "steep45"]},
        "subsetAllowed": {"q2": True},
    }


def manifest_fixtures() -> list[dict]:
    return [{"name": "plane2000", "sha256": "1" * 64},
            {"name": "steep45", "sha256": "2" * 64}]


class DeclarationValidationTest(GateTestBase):
    """A declaration is an input and is validated before it is indexed."""

    def validate(self, manifest) -> evidence.DeclarationValidation:
        return evidence.validate_fixture_manifest(manifest, "fixture-manifest.json")

    def test_control_valid_declaration_passes(self) -> None:
        verdict = self.validate(valid_manifest())
        self.assertEqual(verdict.verdict, evidence.PASS, verdict.problems)
        self.assertEqual(verdict.required_for("q2"), ["plane2000", "steep45"])

    def test_conflicting_duplicate_declaration_fails_in_either_order(self) -> None:
        """Whichever order the duplicate appears, the declaration is invalid."""
        for label, members in (
                ("bad-first", [{"name": "a", "sha256": "b" * 64},
                               {"name": "a", "sha256": "1" * 64}]),
                ("bad-last", [{"name": "a", "sha256": "1" * 64},
                              {"name": "a", "sha256": "b" * 64}])):
            with self.subTest(order=label):
                verdict = self.validate({"declared": members, "requiredFixtures": {}})
                self.assertEqual(verdict.verdict, evidence.FAIL, verdict.problems)
                reasons = " ".join(verdict.problems)
                self.assertIn("repeats declared fixture", reasons)
                # Both conflicting values are identified, not just the survivor.
                self.assertIn("b" * 8, reasons)
                self.assertIn("1" * 8, reasons)

    def test_identical_duplicate_declaration_fails(self) -> None:
        verdict = self.validate({"declared": [{"name": "a", "sha256": "1" * 64},
                                              {"name": "a", "sha256": "1" * 64}],
                                 "requiredFixtures": {}})
        self.assertEqual(verdict.verdict, evidence.FAIL, verdict.problems)
        reasons = " ".join(verdict.problems)
        self.assertIn("repeats declared fixture 'a'", reasons)
        # An identical duplicate is still ambiguous, so both values are named.
        self.assertIn("both record", reasons)

    def test_malformed_member_type_names_the_declaration(self) -> None:
        verdict = self.validate({"declared": ["a"], "requiredFixtures": {}})
        self.assertEqual(verdict.verdict, evidence.FAIL)
        self.assertIn("not an object", " ".join(verdict.problems).lower())

    def test_malformed_declared_hash_fails(self) -> None:
        for bad in ("zz", "abc", 12345, "a" * 63):
            with self.subTest(hash=str(bad)[:12]):
                verdict = self.validate(
                    {"declared": [{"name": "a", "sha256": bad}], "requiredFixtures": {}})
                self.assertEqual(verdict.verdict, evidence.FAIL, verdict.problems)
                self.assertIn("sha256", " ".join(verdict.problems).lower())

    def test_missing_declared_hash_is_inconclusive(self) -> None:
        verdict = self.validate({"declared": [{"name": "a"}], "requiredFixtures": {}})
        self.assertEqual(verdict.verdict, evidence.INCONCLUSIVE)
        self.assertIn("hash", " ".join(verdict.problems).lower())

    def test_required_referencing_undeclared_fixture_fails(self) -> None:
        verdict = self.validate({"declared": [{"name": "a", "sha256": "1" * 64}],
                                 "requiredFixtures": {"q2": ["ghost"]}})
        self.assertEqual(verdict.verdict, evidence.FAIL)
        self.assertIn("ghost", " ".join(verdict.problems))

    def test_malformed_required_list_fails(self) -> None:
        for bad in ("a", {"a": 1}, [123], [""]):
            with self.subTest(required=str(bad)[:12]):
                verdict = self.validate(
                    {"declared": [{"name": "a", "sha256": "1" * 64}],
                     "requiredFixtures": {"q2": bad}})
                self.assertEqual(verdict.verdict, evidence.FAIL, verdict.problems)

    def test_explicit_empty_required_list_does_not_waive_raster_evidence(self) -> None:
        """An empty required list must not be read as 'no raster evidence needed'."""
        verdict = self.validate({"declared": [{"name": "a", "sha256": "1" * 64}],
                                 "requiredFixtures": {"q2": []}})
        self.assertEqual(verdict.verdict, evidence.FAIL)
        self.assertIn("empty", " ".join(verdict.problems).lower())

    def test_absent_manifest_is_inconclusive(self) -> None:
        for absent in (None, {}):
            with self.subTest(manifest=absent):
                verdict = self.validate(absent)
                self.assertEqual(verdict.verdict, evidence.INCONCLUSIVE)

    def test_declared_not_a_list_is_malformed(self) -> None:
        verdict = self.validate({"declared": {"a": 1}, "requiredFixtures": {}})
        self.assertEqual(verdict.verdict, evidence.FAIL)

    def test_duplicate_json_keys_are_detected_before_decoding(self) -> None:
        """A repeated key would be hidden by normal JSON decoding."""
        text = ('{"declared": [{"name": "a", "sha256": "' + "1" * 64 + '"}],'
                ' "requiredFixtures": {}, "declared": [{"name": "z", "sha256": "'
                + "2" * 64 + '"}]}')
        verdict = evidence.validate_fixture_manifest_text(text, "fixture-manifest.json")
        self.assertEqual(verdict.verdict, evidence.FAIL)
        reasons = " ".join(verdict.problems)
        self.assertIn("repeats key", reasons)
        self.assertIn("declared", reasons)


# --------------------------------------------------------------------------- #
# R5-02 / R5-03: every independently evaluable finding is collected
# --------------------------------------------------------------------------- #
#
# The bounded evidence fields admit two kinds of finding: a conflict, which is
# information that contradicts the declaration, and a gap, which is information
# that is not there. These tests exercise the cross product rather than each kind
# alone, because the defect they protect against was exactly the interaction: a
# gap discovered before a comparison stopped that comparison from being made, so
# a known conflict vanished from the record.

#: Each conflict kind mutates the admitted Q-LOCAL-1 report into a disagreement
#: with the declaration, and each names the text its explanation must contain.
CONFLICT_KINDS = {
    "fixture hash": (
        lambda p: p["identity"]["fixtures"][0].__setitem__("sha256", "9" * 64),
        "hash conflict"),
    "artifact version": (
        lambda p: p["identity"].setdefault("artifact", {}).__setitem__(
            "version", "9.9.9"),
        "artifact version conflict"),
    "route": (
        lambda p: p["identity"].__setitem__("routeId", "some-other-route"),
        "route conflict"),
    "environment": (
        lambda p: p["identity"].__setitem__("environment", "some-other-env"),
        "environment conflict"),
}

#: Each gap kind removes information the comparison needs. None of them is a
#: disagreement, so none of them may erase one.
GAP_KINDS = {
    "runId": (
        lambda p: p["identity"].pop("runId"),
        "runId"),
    "recordedAt": (
        lambda p: p["identity"].pop("recordedAt"),
        "recordedAt"),
    "command": (
        lambda p: p["identity"].pop("command"),
        "command"),
}

#: Removing the whole identity block removes the compared values themselves, so no
#: conflict can remain to be found. It is the boundary of the cross product rather
#: than a member of it: the verdict must fall to inconclusive, never to a pass.
IDENTITY_BLOCK_GAP = (lambda p: p.pop("identity"), "identity block")


class AdmissionPrecedence(GateTestBase):
    """A known conflict survives any gap that accompanies it, in either order."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_q2(self, mutate) -> None:
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def evaluate(self) -> dict:
        declared = assembly()
        bundle_path = self.bundle(
            evidence.assemble(self.contract, out=self.root / "b.json",
                              reports=self.reports, host="chromium", **declared),
            "precedence.json")
        return gate.evaluate(self.contract, bundle_path).as_dict()

    def local(self, decision: dict) -> dict:
        return next(r for r in decision["requirements"]
                    if r["requirementId"] == "Q-LOCAL-1")

    def test_control_is_a_pass(self) -> None:
        """The control every case below moves away from."""
        self.assertEqual(self.local(self.evaluate())["verdict"], "pass",
                         self.local(self.evaluate())["reasons"])

    def test_each_conflict_alone_fails(self) -> None:
        """Control: every conflict kind is independently sufficient to fail."""
        for name, (mutate, expected_text) in CONFLICT_KINDS.items():
            with self.subTest(conflict=name):
                self.setUp()
                self.amend_q2(mutate)
                local = self.local(self.evaluate())
                self.assertEqual(local["verdict"], "fail", local["reasons"])
                self.assertIn(expected_text, " ".join(local["reasons"]))

    def test_conflict_then_gap_still_fails_and_names_both(self) -> None:
        """The gap must not short-circuit the comparison that finds the conflict."""
        for conflict, (mutate_conflict, conflict_text) in CONFLICT_KINDS.items():
            for gap, (mutate_gap, gap_text) in GAP_KINDS.items():
                with self.subTest(conflict=conflict, gap=gap, order="conflict-first"):
                    self.setUp()
                    self.amend_q2(mutate_conflict)
                    self.amend_q2(mutate_gap)
                    local = self.local(self.evaluate())
                    reasons = " ".join(local["reasons"])
                    self.assertEqual(local["verdict"], "fail", local["reasons"])
                    self.assertIn(conflict_text, reasons)
                    self.assertIn(gap_text, reasons)

    def test_gap_then_conflict_still_fails_and_names_both(self) -> None:
        """The same combination in the other mutation order.

        The defect was order-dependent: whichever field the reader happened to
        examine first decided whether the conflict was ever compared.
        """
        for conflict, (mutate_conflict, conflict_text) in CONFLICT_KINDS.items():
            for gap, (mutate_gap, gap_text) in GAP_KINDS.items():
                with self.subTest(conflict=conflict, gap=gap, order="gap-first"):
                    self.setUp()
                    self.amend_q2(mutate_gap)
                    self.amend_q2(mutate_conflict)
                    local = self.local(self.evaluate())
                    reasons = " ".join(local["reasons"])
                    self.assertEqual(local["verdict"], "fail", local["reasons"])
                    self.assertIn(conflict_text, reasons)
                    self.assertIn(gap_text, reasons)

    def test_adding_an_unrelated_gap_never_downgrades_a_known_conflict(self) -> None:
        """Metamorphic invariant across every gap kind, not just one example."""
        mutate_conflict, conflict_text = CONFLICT_KINDS["fixture hash"]
        self.amend_q2(mutate_conflict)
        before = self.local(self.evaluate())
        self.assertEqual(before["verdict"], "fail", before["reasons"])
        for gap, (mutate_gap, _gap_text) in GAP_KINDS.items():
            with self.subTest(gap=gap):
                self.setUp()
                self.amend_q2(mutate_conflict)
                self.amend_q2(mutate_gap)
                after = self.local(self.evaluate())
                self.assertEqual(
                    after["verdict"], "fail",
                    f"gap {gap!r} downgraded a known conflict to {after['verdict']}")
                self.assertIn(conflict_text, " ".join(after["reasons"]))

    def test_no_gap_alone_is_reported_as_a_conflict(self) -> None:
        """Control: a gap is a gap. It must not be tightened into a failure."""
        for gap, (mutate_gap, _gap_text) in GAP_KINDS.items():
            with self.subTest(gap=gap):
                self.setUp()
                self.amend_q2(mutate_gap)
                local = self.local(self.evaluate())
                self.assertEqual(local["verdict"], "inconclusive", local["reasons"])

    def test_removing_the_declared_manifest_does_not_hide_a_conflict(self) -> None:
        """A missing declaration is a gap, not a reason to skip every comparison.

        The fixture-hash comparison genuinely needs the declaration, so it cannot
        be made without one. The route comparison needs only the declared route,
        which is still present, so losing the manifest must not swallow it.
        """
        mutate_route, route_text = CONFLICT_KINDS["route"]
        self.amend_q2(mutate_route)
        declared = assembly()
        declared["fixture_manifest"] = None
        bundle_path = self.bundle(
            evidence.assemble(self.contract, out=self.root / "b.json",
                              reports=self.reports, host="chromium", **declared),
            "no-manifest.json")
        local = self.local(gate.evaluate(self.contract, bundle_path).as_dict())
        reasons = " ".join(local["reasons"])
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn(route_text, reasons)
        self.assertIn("fixture manifest", reasons)

    def test_removing_the_identity_block_cannot_improve_the_verdict(self) -> None:
        """The boundary case: without the compared values there is no conflict.

        The verdict must fall to a gap. It must never become a pass, and it must
        never manufacture a conflict out of the missing values.
        """
        mutate_gap, gap_text = IDENTITY_BLOCK_GAP
        self.amend_q2(mutate_gap)
        local = self.local(self.evaluate())
        self.assertEqual(local["verdict"], "inconclusive", local["reasons"])
        self.assertIn(gap_text, " ".join(local["reasons"]).lower())

    def test_isolated_conflict_leaves_unrelated_requirements_alone(self) -> None:
        """Isolation: one source's defect is scoped to the requirements it feeds."""
        clean = self.evaluate()
        self.amend_q2(lambda p: p["identity"]["fixtures"][0].__setitem__(
            "sha256", "9" * 64))
        after = self.evaluate()
        self.assertEqual(self.local(after)["verdict"], "fail")
        for requirement_id in ("Q-DISPLAY-1", "Q-PREP-1", "Q-CRS-1"):
            with self.subTest(requirement=requirement_id):
                before_verdict = next(
                    r["verdict"] for r in clean["requirements"]
                    if r["requirementId"] == requirement_id)
                after_verdict = next(
                    r["verdict"] for r in after["requirements"]
                    if r["requirementId"] == requirement_id)
                self.assertEqual(after_verdict, before_verdict)


class ResultIndependentFailures(GateTestBase):
    """Failures the report recorded are read whatever its `result` says."""

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend_q2(self, mutate) -> None:
        path = self.reports["q2"]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def local(self) -> dict:
        declared = assembly()
        bundle_path = self.bundle(
            evidence.assemble(self.contract, out=self.root / "b.json",
                              reports=self.reports, host="chromium", **declared),
            "result-independent.json")
        decision = gate.evaluate(self.contract, bundle_path).as_dict()
        return next(r for r in decision["requirements"]
                    if r["requirementId"] == "Q-LOCAL-1")

    def test_positive_failure_with_the_result_key_absent_still_fails(self) -> None:
        self.amend_q2(lambda p: p.update(
            {"failures": ["measurement aborted"]}))
        self.amend_q2(lambda p: p.pop("result", None))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("measurement aborted", " ".join(local["reasons"]))

    def test_absent_result_with_no_known_failure_stays_inconclusive(self) -> None:
        """Compatibility: an absent key alone is a gap, not a manufactured failure."""
        self.amend_q2(lambda p: p.pop("result", None))
        local = self.local()
        self.assertEqual(local["verdict"], "inconclusive", local["reasons"])

    def test_explicitly_null_result_is_invalid_not_absent(self) -> None:
        """A present-but-unusable declaration is not the same as a missing key."""
        self.amend_q2(lambda p: p.__setitem__("result", None))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("unusable result None", " ".join(local["reasons"]))

    def test_failed_assertion_with_absent_result_fails(self) -> None:
        def mutate(payload):
            payload.pop("result", None)
            payload.setdefault("assertions", []).append(
                {"name": "range-bytes-served", "ok": False})
        self.amend_q2(mutate)
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("range-bytes-served", " ".join(local["reasons"]))

    def test_failed_assertion_with_inconclusive_result_fails(self) -> None:
        """A failed assertion outranks the conclusion the report wrote down."""
        def mutate(payload):
            payload["result"] = "inconclusive"
            payload["failures"] = []
            payload.setdefault("assertions", []).append(
                {"name": "range-bytes-served", "ok": False})
        self.amend_q2(mutate)
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("range-bytes-served", " ".join(local["reasons"]))

    def test_failed_precondition_with_absent_result_fails(self) -> None:
        def mutate(payload):
            payload.pop("result", None)
            payload["preconditions"] = [
                {"name": "range-requests-supported", "met": False}]
        self.amend_q2(mutate)
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("range-requests-supported", " ".join(local["reasons"]))

    def test_malformed_failures_container_is_an_input_failure(self) -> None:
        """A malformed container is not an empty list, and it is not iterated."""
        self.amend_q2(lambda p: p.__setitem__("failures", "not-a-list"))
        local = self.local()
        reasons = " ".join(local["reasons"])
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("not a list", reasons)
        # Iterating the string would have produced these one-character "failures".
        self.assertNotIn("n; o; t", reasons)

    def test_malformed_assertions_container_is_an_input_failure(self) -> None:
        self.amend_q2(lambda p: p.__setitem__("assertions", {"ok": False}))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("not a list", " ".join(local["reasons"]))

    def test_malformed_container_never_becomes_silent_absence(self) -> None:
        """A malformed container is a failure, measured against a fresh control."""
        self.amend_q2(lambda p: p.__setitem__("failures", 17))
        malformed = self.local()
        self.assertEqual(malformed["verdict"], "fail", malformed["reasons"])

        # Control: the same report with a well-formed empty failure list passes, so
        # the failure above is caused by the malformation and nothing else.
        self.setUp()
        self.amend_q2(lambda p: p.__setitem__("failures", []))
        clean = self.local()
        self.assertEqual(clean["verdict"], "pass", clean["reasons"])

    def test_malformed_preconditions_container_is_an_input_failure(self) -> None:
        """A malformed container is not evidence that the preconditions held."""
        self.amend_q2(lambda p: p.__setitem__("preconditions", "not-a-list"))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("preconditions container is not a list",
                      " ".join(local["reasons"]))

    def test_malformed_precondition_entry_is_an_input_failure(self) -> None:
        self.amend_q2(lambda p: p.__setitem__("preconditions", [{"met": True}]))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("no usable name", " ".join(local["reasons"]))


class CombinedFaultSensitivity(GateTestBase):
    """One check that detects a reintroduced gap-based early return.

    The isolated tests above each prove one behavior. This one is the composed
    probe: it stacks a conflict, a gap and an unrelated failure from more than one
    contributing source, and asserts every one of them is still visible in the
    reduced verdict. A short-circuit anywhere in admission collapses the set, so
    this fails loudly if one is reintroduced even when the isolated tests still
    pass for a different code path.
    """

    def setUp(self) -> None:
        super().setUp()
        self.reports = passing_reports(self.root)

    def amend(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def decision(self) -> dict:
        declared = assembly()
        bundle = self.bundle(
            evidence.assemble(self.contract, out=self.root / "b.json",
                              reports=self.reports, host="chromium", **declared),
            "combined.json")
        return gate.evaluate(self.contract, bundle).as_dict()

    def requirement(self, decision: dict, requirement_id: str) -> dict:
        return next(r for r in decision["requirements"]
                    if r["requirementId"] == requirement_id)

    def test_every_contributed_finding_survives_the_reduction(self) -> None:
        """The combined-fault probe.

        Stacked on one run: a fixture hash conflict, a missing runId, a missing
        recorded time, a missing command, a recorded positive failure, a failed
        assertion, an unmet precondition, and a malformed container. Every one of
        them must be visible, and the overall verdict must be a failure.
        """
        def stack(payload):
            payload["identity"].pop("runId", None)
            payload["identity"].pop("recordedAt", None)
            payload["identity"].pop("command", None)
            # Two conflicts, not one: the fixture-hash comparison reports through
            # the fixture checks while the route comparison reports through the
            # identity comparisons. A short-circuit in either path is caught.
            payload["identity"]["fixtures"][0]["sha256"] = "9" * 64
            payload["identity"]["routeId"] = "some-other-route"
            payload["failures"] = ["measurement aborted", "window exceeds the limit"]
            payload.setdefault("assertions", []).append(
                {"name": "range-bytes-served", "ok": False})
            payload["preconditions"] = [
                {"name": "range-requests-supported", "met": False}]
        self.amend("q2", stack)
        decision = self.decision()
        local = self.requirement(decision, "Q-LOCAL-1")
        reasons = " ".join(local["reasons"])

        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertEqual(decision["result"], "fail",
                         decision.get("verdictReason"))
        for expected in ("hash conflict", "route conflict", "runId", "recordedAt",
                         "command", "measurement aborted", "range-bytes-served",
                         "range-requests-supported"):
            with self.subTest(finding=expected):
                self.assertIn(expected, reasons)

    def test_a_failure_in_one_source_reaches_a_shared_requirement(self) -> None:
        """A requirement drawing on several sources keeps every contributing failure.

        Q-DISPLAY-1 is fed by the trace report and the numeric report's memory
        sampling. A failure in one must not be replaced by the other's passing
        reading.
        """
        self.amend("trace", lambda p: p.update(
            {"result": "fail", "failures": ["ui thread blocked"]}))
        decision = self.decision()
        display = self.requirement(decision, "Q-DISPLAY-1")
        self.assertEqual(display["verdict"], "fail", display["reasons"])
        self.assertIn("ui thread blocked", " ".join(display["reasons"]))
