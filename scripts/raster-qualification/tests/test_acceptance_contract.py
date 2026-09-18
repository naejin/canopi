#!/usr/bin/env python3
"""Acceptance tests for the consolidated admission contract (C1-C8).

This module is the executable mapping from
``docs/design/raster-rework/q-admission-acceptance.md`` to tests. Each class names
the matrix row it covers. Cases are parameterized rather than copy-pasted, and
expected values are hand-derived from the contract, never recomputed by the code
under test.

The existing suites stay where they are: ``test_qualification_gate`` owns the
admission and assembler boundaries, ``test_cli_integration`` owns the real CLI and
``test_runner_exit`` owns the runner. This module covers the boundary categories
those suites did not reach, and is the place the acceptance matrix is traced from.
"""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HARNESS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import qualification_evidence as evidence  # noqa: E402
import qualification_gate as gate  # noqa: E402
import test_qualification_gate as fixtures  # noqa: E402

CONTRACT_PATH = HARNESS / "requirements.json"


class AcceptanceBase(unittest.TestCase):
    """Shared fresh-root harness. Nothing here is shared between tests."""

    def setUp(self) -> None:
        self._temp = tempfile.TemporaryDirectory(prefix="qual-accept-")
        self.root = Path(self._temp.name)
        self.contract = gate.load_contract(CONTRACT_PATH)

    def tearDown(self) -> None:
        self._temp.cleanup()

    def write_bundle(self, payload: dict, name: str = "bundle.json") -> Path:
        path = self.root / name
        path.write_text(json.dumps(payload))
        return path

    def evaluate(self, payload: dict) -> gate.Decision:
        return gate.evaluate(self.contract, self.write_bundle(payload))

    def requirement(self, decision: gate.Decision, requirement_id: str):
        return next(r for r in decision.requirements
                    if r.requirement_id == requirement_id)

    def reasons(self, decision: gate.Decision, requirement_id: str) -> str:
        return " ".join(self.requirement(decision, requirement_id).reasons)


class C6AssertionVerdictTypes(AcceptanceBase):
    """C6: validate assertion verdict types before membership tests.

    The acceptance contract's C6 row requires the public gate to admit only
    well-formed bundles. A verdict slot that holds something other than a verdict
    is malformed input: it must not crash the gate and it must not be silently
    read as "no evidence recorded", because that turns invalid input into an
    inconclusive gap instead of a diagnostic failure.
    """

    #: Values that are present in a verdict slot but are not verdicts. Hand-derived
    #: from the contract: a verdict is one of ``pass``/``fail``/``inconclusive``.
    NOT_VERDICTS = (
        ("list", ["pass"]),
        ("dict", {"ok": True}),
        ("true", True),
        ("false", False),
        ("int", 1),
        ("zero", 0),
        ("float", 1.0),
        ("uppercase", "PASS"),
        ("prefixed", " pass"),
        ("empty string", ""),
        ("unknown word", "passed"),
    )

    def assert_rejected(self, value, *, label: str) -> None:
        with self.subTest(value=label):
            payload = fixtures.passing_evidence()
            payload["requirements"]["Q-LOCAL-1"]["assertions"][
                "window-size-within-contract-limit"] = value
            decision = self.evaluate(payload)
            local = self.requirement(decision, "Q-LOCAL-1")
            self.assertEqual(
                local.verdict, gate.FAIL,
                f"a {label} verdict slot was not rejected: {local.reasons}")

    def test_non_verdict_assertion_values_fail(self) -> None:
        for label, value in self.NOT_VERDICTS:
            with self.subTest(value=label):
                self.assert_rejected(value, label=label)

    def test_absent_assertion_value_stays_inconclusive(self) -> None:
        """Absence is a gap; nothing was recorded for the assertion."""
        payload = fixtures.passing_evidence()
        payload["requirements"]["Q-LOCAL-1"]["assertions"].pop(
            "window-size-within-contract-limit")
        local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.INCONCLUSIVE, local.reasons)

    def test_null_assertion_value_is_invalid_not_absent(self) -> None:
        """C1/C6: explicit null is invalid unless the schema permits it as absent.

        The verdict schema for an assertion is ``pass``/``fail``/``inconclusive``,
        so a null that is *present* is malformed input, not a missing observation.
        """
        payload = fixtures.passing_evidence()
        payload["requirements"]["Q-LOCAL-1"]["assertions"][
            "window-size-within-contract-limit"] = None
        local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.FAIL, local.reasons)
        self.assertIn("null", " ".join(local.reasons).lower())

    def test_control_still_passes(self) -> None:
        decision = self.evaluate(fixtures.passing_evidence())
        self.assertEqual(decision.verdict, gate.PASS,
                         decision.as_dict().get("verdictReason"))


class C6AdmissionRequired(AcceptanceBase):
    """C6: the normal gate cannot pass a bundle with no admission at all.

    The assembler's admission checks only protect bundles that went through the
    assembler. Ingesting a bundle directly must not be a weaker path: an entry
    whose source was never admitted has not established that its observations
    refer to the declared evidence, so its assertion verdicts cannot carry a
    requirement however they read.
    """

    def test_entry_without_an_admission_block_cannot_pass(self) -> None:
        payload = fixtures.passing_evidence()
        del payload["requirements"]["Q-LOCAL-1"]["admission"]
        local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.FAIL, local.reasons)
        self.assertIn("admission", " ".join(local.reasons).lower())

    def test_no_entry_anywhere_can_pass_without_admission(self) -> None:
        """Every required entry, not just the first one checked."""
        for requirement_id in ("Q-ART-1", "Q-LOCAL-1", "Q-DISPLAY-1", "Q-RES-1"):
            with self.subTest(requirement=requirement_id):
                payload = fixtures.passing_evidence()
                del payload["requirements"][requirement_id]["admission"]
                local = self.requirement(self.evaluate(payload), requirement_id)
                self.assertEqual(local.verdict, gate.FAIL, local.reasons)

    def test_whole_bundle_without_admission_is_not_a_pass(self) -> None:
        payload = fixtures.passing_evidence()
        for entry in payload["requirements"].values():
            del entry["admission"]
        decision = self.evaluate(payload)
        self.assertEqual(decision.verdict, gate.FAIL)
        self.assertNotEqual(decision.exit_code, 0)

    #: Malformed admission blocks. ``verdict`` is the field the gate reads to
    #: decide whether a source may contribute, so every unusable shape must be
    #: rejected rather than read as "no admission recorded".
    MALFORMED_ADMISSION = (
        ("not an object", "pass"),
        ("null", None),
        ("list", []),
        ("no verdict", {"reasons": []}),
        ("null verdict", {"verdict": None, "reasons": []}),
        ("unknown verdict", {"verdict": "admitted", "reasons": []}),
        ("boolean verdict", {"verdict": True, "reasons": []}),
        ("uppercase verdict", {"verdict": "PASS", "reasons": []}),
        ("reasons not a list", {"verdict": "pass", "reasons": "none"}),
        ("reasons holding an object", {"verdict": "pass", "reasons": [{"a": 1}]}),
    )

    def test_malformed_admission_blocks_fail(self) -> None:
        for label, value in self.MALFORMED_ADMISSION:
            with self.subTest(admission=label):
                payload = fixtures.passing_evidence()
                payload["requirements"]["Q-LOCAL-1"]["admission"] = value
                local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
                self.assertEqual(local.verdict, gate.FAIL,
                                 f"{label}: {local.reasons}")

    def test_not_admitted_sources_keep_their_own_severity(self) -> None:
        """A source admitted on a gap is inconclusive; on a failure it is a fail."""
        for verdict, expected in (("inconclusive", gate.INCONCLUSIVE),
                                  ("fail", gate.FAIL)):
            with self.subTest(admission_verdict=verdict):
                payload = fixtures.passing_evidence()
                payload["requirements"]["Q-LOCAL-1"]["admission"] = {
                    "verdict": verdict, "reasons": [f"source was not admitted: {verdict}"]}
                local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
                self.assertEqual(local.verdict, expected, local.reasons)

    def test_admitted_source_with_passing_assertions_still_passes(self) -> None:
        """Control: the admitted shape is not rejected by the new requirement."""
        decision = self.evaluate(fixtures.passing_evidence())
        self.assertEqual(decision.verdict, gate.PASS,
                         decision.as_dict().get("verdictReason"))


class C6FailureOutranksGap(AcceptanceBase):
    """C6: a missing route cannot hide an existing fail.

    Identity gaps and measured failures are independent findings. The gate must
    reduce them once, in the contract's order (fail, then inconclusive), rather
    than returning at the first gap it finds and dropping a failure it never
    looked for.
    """

    #: Entry-level gaps that are independent of the assertion verdicts.
    ENTRY_GAPS = (
        ("route", lambda e: e.pop("route")),
        ("source", lambda e: e.pop("source")),
        ("command", lambda e: e.pop("command")),
        ("environment", lambda e: e.pop("environment")),
        ("route blank", lambda e: e.__setitem__("route", "")),
        ("artifact absent", lambda e: e.pop("artifact")),
    )

    def test_failing_assertion_survives_every_entry_gap(self) -> None:
        for label, mutate_gap in self.ENTRY_GAPS:
            with self.subTest(gap=label):
                payload = fixtures.passing_evidence()
                entry = payload["requirements"]["Q-LOCAL-1"]
                entry["assertions"]["window-size-within-contract-limit"] = "fail"
                mutate_gap(entry)
                local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
                self.assertEqual(local.verdict, gate.FAIL,
                                 f"{label} hid a known failure: {local.reasons}")
                self.assertIn("window-size-within-contract-limit",
                              " ".join(local.reasons))

    def test_failing_assertion_survives_a_bundle_wide_gap(self) -> None:
        """A whole-bundle gap must not erase a local measured failure either."""
        payload = fixtures.passing_evidence()
        payload["requirements"]["Q-RES-1"]["assertions"][
            "candidate-memory-within-budget"] = "fail"
        del payload["requirements"]["Q-LOCAL-1"]["route"]
        decision = self.evaluate(payload)
        self.assertEqual(self.requirement(decision, "Q-RES-1").verdict, gate.FAIL)

    def test_gap_alone_stays_inconclusive(self) -> None:
        """Control: without a failure the same gap is a gap, not a failure."""
        for label, mutate_gap in self.ENTRY_GAPS:
            with self.subTest(gap=label):
                payload = fixtures.passing_evidence()
                mutate_gap(payload["requirements"]["Q-LOCAL-1"])
                local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
                self.assertEqual(local.verdict, gate.INCONCLUSIVE, local.reasons)


class C2LoaderTotality(AcceptanceBase):
    """C2: every report role loads totally, and absence differs from corruption.

    The assembler reads nine report roles through nine different code paths. An
    unhandled shape in any of them escapes as a traceback from the real CLI, which
    is neither a diagnostic nor a verdict.
    """

    def reports(self) -> dict[str, Path]:
        root = self.root / "reports"
        root.mkdir(exist_ok=True)
        return fixtures.passing_reports(root)

    def amend(self, reports: dict[str, Path], role: str, mutate) -> None:
        path = reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def assemble(self, reports: dict[str, Path], **declared) -> dict:
        call = fixtures.assembly()
        call.update(declared)
        return evidence.assemble(self.contract, out=self.root / "b.json",
                                 reports=reports, host="chromium", **call)

    def decide(self, reports: dict[str, Path], **declared) -> gate.Decision:
        bundle = self.assemble(reports, **declared)
        return gate.evaluate(self.contract, self.write_bundle(bundle))

    #: Container shapes a report field can wrongly take. Each is a wrong type for
    #: a field the assembler reads, not an absent one.
    WRONG_SHAPES = (
        ("string", "not-a-container"),
        ("list", ["a"]),
        ("nonempty list", ["a", "b"]),
        ("int", 17),
        ("bool", True),
        ("float", 1.5),
    )

    def test_missing_each_report_role_produces_a_verdict(self) -> None:
        """Remove each role in turn: no traceback, and never a pass without it."""
        probe = self.root / "probe"
        probe.mkdir()
        roles = sorted(fixtures.passing_reports(probe).keys())
        self.assertTrue(roles, "no report roles discovered")
        for role in roles:
            with self.subTest(missing=role):
                self.setUp()
                reports = self.reports()
                del reports[role]
                decision = self.decide(reports)
                self.assertNotEqual(decision.verdict, gate.PASS)
                self.assertNotEqual(decision.exit_code, 0)

    def test_missing_q1_does_not_crash_the_artifact_entry(self) -> None:
        """The reviewed counterexample: q1 removed reached an unbound local."""
        reports = self.reports()
        del reports["q1"]
        decision = self.decide(reports)
        art = self.requirement(decision, "Q-ART-1")
        self.assertEqual(art.verdict, gate.INCONCLUSIVE, art.reasons)

    #: Fields that are read as mappings somewhere in the assembler. A wrong shape
    #: in any of them must be reported, not raised.
    MAPPING_FIELDS = (
        ("q2", "identity"),
        ("q2", "identity.artifact"),
        ("q1", "identity"),
        ("q3prepare", "identity"),
        ("q4slope", "identity"),
        ("q5lifecycle", "identity"),
        ("q6resources", "identity"),
        ("trace", "identity"),
    )

    def test_wrong_nested_mapping_shapes_do_not_crash(self) -> None:
        for role, field in self.MAPPING_FIELDS:
            for label, value in self.WRONG_SHAPES:
                with self.subTest(role=role, field=field, shape=label):
                    self.setUp()
                    reports = self.reports()

                    def mutate(payload, field=field, value=value):
                        if "." in field:
                            outer, inner = field.split(".", 1)
                            payload.setdefault(outer, {})[inner] = copy.deepcopy(value)
                        else:
                            payload[field] = copy.deepcopy(value)

                    self.amend(reports, role, mutate)
                    decision = self.decide(reports)
                    self.assertNotEqual(decision.verdict, gate.PASS,
                                        f"{role}.{field}={label} passed")

    def test_truncated_report_keeps_its_malformed_reason(self) -> None:
        """Corruption must not be reported as absence: the reason must survive."""
        reports = self.reports()
        reports["q2"].write_text('{"experiment": "q2-numeric", "resu')
        decision = self.decide(reports)
        local = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.FAIL, local.reasons)
        reasons = " ".join(local.reasons)
        self.assertIn("malformed", reasons)
        self.assertNotIn("is missing", reasons)

    def test_completely_absent_report_is_a_gap_not_corruption(self) -> None:
        """Control: absence stays a gap, so corruption and absence stay distinct."""
        reports = self.reports()
        reports["q2"].unlink()
        local = self.requirement(self.decide(reports), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.INCONCLUSIVE, local.reasons)
        self.assertIn("missing", " ".join(local.reasons))


if __name__ == "__main__":
    unittest.main(verbosity=2)


class C3RoleIdentity(AcceptanceBase):
    """C3: a source's identity is fixed by the role it is read for.

    Expectations come from the accepted declarations, not from the report being
    checked and not from whether a caller chose to declare them. A caller that
    omits an expectation must block the comparison, not withdraw it.
    """

    def setUp(self) -> None:
        super().setUp()
        reports_dir = self.root / "reports"
        reports_dir.mkdir()
        self.reports = fixtures.passing_reports(reports_dir)

    def amend(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def decide(self, role: str, **declared) -> gate.Decision:
        call = fixtures.assembly()
        call.update(declared)
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **call)
        return gate.evaluate(self.contract, self.write_bundle(bundle))

    def test_role_experiment_identity_is_required(self) -> None:
        """The report read for a role must say it is that role's experiment."""
        for role, wrong in (("q2", "q1-artifacts"), ("trace", "q2-numeric"),
                            ("q5lifecycle", "q6-resources")):
            with self.subTest(role=role):
                self.setUp()
                self.amend(role, lambda p, wrong=wrong: p["identity"].__setitem__(
                    "experiment", wrong))
                decision = self.decide(role)
                self.assertNotEqual(decision.verdict, gate.PASS,
                                    f"{role} admitting {wrong} passed")

    def test_control_still_passes(self) -> None:
        """The unmutated fixture satisfies the requirement under test.

        The shared fixture does not carry the observations several other
        requirements need (cancellation, teardown, host), so the control is the
        requirement this class mutates rather than the whole bundle.
        """
        local = self.requirement(self.decide("q2"), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.PASS, local.reasons)

    def test_declared_transport_is_compared(self) -> None:
        """A source that used another transport cannot satisfy the role.

        A measured but different capability is insufficient rather than invalid:
        the observation is real, it is simply not the required route. It blocks a
        pass either way, and the reason names both transports.
        """
        route = dict(fixtures.assembly()["route"])
        route["numericExpectedTransport"] = "local-bridge"
        decision = self.decide("q2", route=route)
        local = self.requirement(decision, "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.INCONCLUSIVE, local.reasons)
        reasons = " ".join(local.reasons)
        self.assertIn("http-range", reasons)
        self.assertIn("local-bridge", reasons)

    #: Declaration keys a role needs. Omitting one must not withdraw the check.
    REQUIRED_DECLARATIONS = (
        ("numericExpectedTransport", "Q-LOCAL-1"),
        ("displayExpectedTransport", "Q-DISPLAY-1"),
    )

    def test_missing_required_declaration_blocks_rather_than_skips(self) -> None:
        for key, requirement_id in self.REQUIRED_DECLARATIONS:
            with self.subTest(declaration=key):
                route = dict(fixtures.assembly()["route"])
                del route[key]
                decision = self.decide("q2", route=route)
                local = self.requirement(decision, requirement_id)
                self.assertEqual(local.verdict, gate.INCONCLUSIVE, local.reasons)
                self.assertIn(key, " ".join(local.reasons))

    def test_missing_declaration_does_not_disable_the_comparison(self) -> None:
        """The report cannot pass by observing a transport nobody declared."""
        route = dict(fixtures.assembly()["route"])
        del route["numericExpectedTransport"]
        self.amend("q2", lambda p: p["identity"].__setitem__(
            "transport", "something-else-entirely"))
        decision = self.decide("q2", route=route)
        self.assertNotEqual(decision.verdict, gate.PASS,
                            "an undeclared transport comparison was skipped")


class C1StrictLeaves(AcceptanceBase):
    """C1: strict leaf values, and unique keyed records.

    A leaf that decides a verdict is a boolean or it is malformed. Truthiness is
    never a substitute: ``"false"`` is a nonempty string, ``1`` is a number, and
    a container is neither. Duplicate keyed evidence is ambiguous, so an
    assertion or precondition name that appears twice is rejected whether or not
    the duplicates agree.
    """

    def setUp(self) -> None:
        super().setUp()
        reports_dir = self.root / "reports"
        reports_dir.mkdir()
        self.reports = fixtures.passing_reports(reports_dir)

    def amend(self, mutate, role: str = "q2") -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def local(self) -> dict:
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium",
                                   **fixtures.assembly())
        decision = gate.evaluate(self.contract, self.write_bundle(bundle)).as_dict()
        return next(r for r in decision["requirements"]
                    if r["requirementId"] == "Q-LOCAL-1")

    def set_assertion_ok(self, value) -> None:
        """Set the leaf on the report's own first assertion.

        Rewriting an existing record rather than appending one keeps the case
        about the leaf's type, not about which name a fixture happens to use.
        """
        def mutate(payload):
            self.assertTrue(payload["assertions"],
                            "the fixture must carry at least one assertion")
            payload["assertions"][0]["ok"] = value
        self.amend(mutate)

    #: Values a boolean leaf must not accept. ``True``/``False`` are the only
    #: usable ones and are covered by the control and by the existing suites.
    NOT_BOOLEANS = (
        ("string false", "false"),
        ("string true", "true"),
        ("int one", 1),
        ("int zero", 0),
        ("float", 1.0),
        ("empty string", ""),
        ("list", [True]),
        ("dict", {"ok": True}),
        ("explicit null", None),
    )

    def test_assertion_ok_accepts_only_booleans(self) -> None:
        for label, value in self.NOT_BOOLEANS:
            with self.subTest(ok=label):
                self.setUp()
                self.set_assertion_ok(value)
                local = self.local()
                self.assertEqual(local["verdict"], "fail",
                                 f"ok={label} passed: {local['reasons']}")

    def test_precondition_met_accepts_only_booleans(self) -> None:
        for label, value in self.NOT_BOOLEANS:
            with self.subTest(met=label):
                self.setUp()
                self.amend(lambda p, value=value: p.__setitem__(
                    "preconditions",
                    [{"name": "range-requests-supported", "met": value}]))
                local = self.local()
                self.assertEqual(local["verdict"], "fail",
                                 f"met={label} passed: {local['reasons']}")

    def test_control_still_passes(self) -> None:
        local = self.local()
        self.assertEqual(local["verdict"], "pass", local["reasons"])

    def test_duplicate_assertion_names_are_rejected(self) -> None:
        """Identical duplicates are ambiguous evidence, not harmless repetition."""
        self.amend(lambda p: p["assertions"].append(dict(p["assertions"][0])))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("duplicate", " ".join(local["reasons"]).lower())

    def test_duplicate_precondition_names_are_rejected(self) -> None:
        self.amend(lambda p: p.__setitem__("preconditions", [
            {"name": "range-requests-supported", "met": True},
            {"name": "range-requests-supported", "met": True}]))
        local = self.local()
        self.assertEqual(local["verdict"], "fail", local["reasons"])
        self.assertIn("duplicate", " ".join(local["reasons"]).lower())

    def test_a_true_control_and_a_negative_control_stay_meaningful(self) -> None:
        """Control: strictness must not break the legitimate shapes.

        A passing positive assertion and an explicitly scoped expected rejection
        are both valid, and the scoped rejection is not a positive failure.
        """
        self.amend(lambda p: p.__setitem__("negativeControlScopes", ["expected-rejection:"]))
        self.amend(lambda p: p.__setitem__(
            "failures", ["expected-rejection: negative control refused the input"]))
        local = self.local()
        self.assertEqual(local["verdict"], "pass", local["reasons"])


class C4AssertionEvidence(AcceptanceBase):
    """C4: every requirement assertion has required evidence or an explicit gap.

    An assertion must not pass because a failure string is absent, or because a
    prose note happens to be present. Each mapping names the observation it needs;
    when the observation is missing the assertion is an explicit gap.
    """

    def setUp(self) -> None:
        super().setUp()
        reports_dir = self.root / "reports"
        reports_dir.mkdir()
        self.reports = fixtures.passing_reports(reports_dir)

    def amend(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def bundle(self) -> dict:
        return evidence.assemble(self.contract, out=self.root / "b.json",
                                 reports=self.reports, host="chromium",
                                 **fixtures.assembly())

    def entry(self, requirement_id: str) -> dict:
        return self.bundle()["requirements"][requirement_id]

    def test_numeric_window_bound_needs_a_positive_observation(self) -> None:
        """Passing by absence of an 'exceeds the' string is not evidence.

        The plan bounds a numeric window at 1024x1024 cells. Removing every
        recorded window leaves nothing to check, so the assertion must be an
        explicit gap rather than a pass.
        """
        self.amend("q2", lambda p: p.__setitem__("windows", []))
        entry = self.entry("Q-LOCAL-1")
        self.assertNotEqual(
            entry["assertions"].get("window-size-within-contract-limit"), "pass",
            "an unobserved window bound passed by absence of a failure string")

    def test_numeric_window_bound_fails_when_a_window_exceeds_the_limit(self) -> None:
        def widen(payload):
            payload["windows"] = [{
                "fixture": "plane2000", "label": "oversized",
                "classification": "measured",
                "window": {"x": 0, "y": 0, "w": 4096, "h": 4096, "haloCells": 1},
                "cells": 4096 * 4096}]
        self.amend("q2", widen)
        entry = self.entry("Q-LOCAL-1")
        self.assertEqual(
            entry["assertions"].get("window-size-within-contract-limit"), "fail")
        # The failure is explained with the measured size, not merely asserted.
        reasons = " ".join((entry.get("observations") or {}).get("notes") or []) \
            + " " + " ".join(entry["admission"].get("reasons") or [])
        self.assertIn("4096", reasons)

    def test_numeric_window_bound_passes_on_a_recorded_valid_window(self) -> None:
        def record(payload):
            payload["windows"] = [{
                "fixture": "plane2000", "label": "bounded",
                "classification": "measured",
                "window": {"x": 0, "y": 0, "w": 1024, "h": 1024, "haloCells": 1},
                "cells": 1024 * 1024}]
        self.amend("q2", record)
        entry = self.entry("Q-LOCAL-1")
        self.assertEqual(
            entry["assertions"].get("window-size-within-contract-limit"), "pass")

    def test_artifact_inventory_does_not_depend_on_a_prose_note(self) -> None:
        """The matched inventory is the evidence; the note is commentary.

        A declaration whose artifacts all match needs no "no published artifact
        matches" note. Requiring one made the assertion fail on a control whose
        inventory was complete.
        """
        self.amend("q1", lambda p: p.__setitem__("notes", []))
        entry = self.entry("Q-ART-1")
        self.assertEqual(
            entry["assertions"].get("non-corresponding-artifacts-recorded"), "pass",
            "a complete matching inventory failed because a note was removed")


class C5QuantitativeBudgets(AcceptanceBase):
    """C5: the plan's numeric budgets, and per-run reductions.

    A counter that is merely present is not a counter within its limit. Each
    budget is checked independently, an over-limit value fails even when it
    accompanies another run's gap, and a record with no applicable sampling
    cannot be combined into a fictional complete run.
    """

    def setUp(self) -> None:
        super().setUp()
        reports_dir = self.root / "reports"
        reports_dir.mkdir()
        self.reports = fixtures.passing_reports(reports_dir)

    def amend(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def resource_assertions(self) -> dict:
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium",
                                   **fixtures.assembly())
        return bundle["requirements"]["Q-RES-1"]["assertions"]

    def candidate(self, payload) -> dict:
        for measurement in payload["measurements"]:
            if measurement.get("routeRole") == "candidate":
                return measurement
        raise AssertionError("the fixture must record a candidate measurement")

    def set_counter(self, name: str, value) -> None:
        self.amend("q6resources",
                   lambda p, name=name, value=value: self.candidate(p).__setitem__(
                       name, value))

    #: The plan's bounds, hand-derived from the acceptance contract. Each is a
    #: limit on the candidate route's own accounting.
    OVER_BUDGET = (
        ("decodedCacheBytes", 2 ** 30, "decoded"),
        ("activeReads", 3, "read"),
        ("queueDepth", 33, "queue"),
    )

    def test_control_within_every_budget_passes(self) -> None:
        assertions = self.resource_assertions()
        self.assertNotEqual(
            assertions.get("disk-cache-reads-queue-and-children-recorded"),
            "fail", assertions)

    def test_over_budget_counters_fail(self) -> None:
        for name, value, label in self.OVER_BUDGET:
            with self.subTest(counter=name):
                self.setUp()
                self.set_counter(name, value)
                assertions = self.resource_assertions()
                self.assertEqual(
                    assertions.get("disk-cache-reads-queue-and-children-recorded"),
                    "fail", f"{label} budget not enforced: {assertions}")

    def test_missing_counter_is_a_gap_not_a_pass(self) -> None:
        for name, _value, _label in self.OVER_BUDGET:
            with self.subTest(counter=name):
                self.setUp()
                self.amend("q6resources",
                           lambda p, name=name: self.candidate(p).pop(name, None))
                assertions = self.resource_assertions()
                self.assertEqual(
                    assertions.get("disk-cache-reads-queue-and-children-recorded"),
                    "inconclusive", assertions)

    def test_unsampled_record_cannot_substitute_for_a_sampled_run(self) -> None:
        """A record without the plan's sampling describes no measured run.

        Replacing the sampled candidate records with an unsampled one that carries
        small compliant numbers previously passed, because the reduction took
        whichever record it met first. The counters of an unsampled record cannot
        establish a budget, so the assertion becomes a gap.
        """
        def only_unsampled(payload):
            payload["measurements"] = [
                measurement for measurement in payload["measurements"]
                if measurement.get("routeRole") != "candidate"]
            payload["measurements"].append(
                {"routeRole": "candidate", "route": "candidate",
                 "incrementalPeakRssMiB": 1, "decodedCacheBytes": 1,
                 "activeReads": 1, "queueDepth": 1,
                 "temporaryDiskHighWaterBytes": 1, "maxConcurrentChildren": 1})
        self.amend("q6resources", only_unsampled)
        assertions = self.resource_assertions()
        self.assertEqual(
            assertions.get("disk-cache-reads-queue-and-children-recorded"),
            "inconclusive",
            "an unsampled record was combined into a complete run")

    def test_over_budget_still_fails_alongside_a_missing_counter(self) -> None:
        """An over-limit counter is a measured violation, not a gap.

        C8's invariant in miniature: a missing counter must not soften a budget
        that another record was measured to exceed.
        """
        def over_and_missing(payload):
            self.candidate(payload)["decodedCacheBytes"] = 2 ** 30
            self.candidate(payload).pop("queueDepth", None)
        self.amend("q6resources", over_and_missing)
        assertions = self.resource_assertions()
        self.assertEqual(
            assertions.get("disk-cache-reads-queue-and-children-recorded"), "fail",
            assertions)


class C5DisplayBudgets(AcceptanceBase):
    """C5: a measured stall outranks an unrelated gap, in either order.

    The display trace asserts a 50 ms bound on UI-thread compute. A recorded 900 ms
    stall is a measured violation: an unrecognised optional field elsewhere in the
    trace is a separate finding about producer agreement, and it must not erase the
    violation.
    """

    def stall(self, mutate=None, unrecognised: bool = False) -> tuple[str, list[str]]:
        trace = fixtures.valid_trace(long_task_ms=900.0)
        if unrecognised:
            trace["runs"][0]["someOptionalField"] = 1
        if mutate:
            mutate(trace)
        assertions, notes, _observed = evidence.display_trace_assertions(
            trace, bound_ms=50.0, cold_runs=1, warm_runs=3, min_latencies=100)
        return assertions["no-ui-thread-task-above-bound"], notes

    def test_stall_alone_fails(self) -> None:
        verdict, notes = self.stall()
        self.assertEqual(verdict, "fail", notes)

    def test_stall_survives_an_unrecognised_optional_field(self) -> None:
        verdict, notes = self.stall(unrecognised=True)
        self.assertEqual(verdict, "fail", notes)
        self.assertIn("900", " ".join(notes))

    def test_control_within_bound_passes(self) -> None:
        trace = fixtures.valid_trace(long_task_ms=20.0)
        assertions, notes, _observed = evidence.display_trace_assertions(
            trace, bound_ms=50.0, cold_runs=1, warm_runs=3, min_latencies=100)
        self.assertEqual(assertions["no-ui-thread-task-above-bound"], "pass", notes)


class C8CrossLayerInvariants(AcceptanceBase):
    """C8: the invariants that hold across every layer of the decision path.

    One fault kind crossed with one independent gap kind, at the source, run and
    bundle layers. Order does not change severity; removing required evidence
    never creates a pass; adding unrelated evidence never closes a gap; and a
    failure keeps its reason wherever it was found.
    """

    def setUp(self) -> None:
        super().setUp()
        reports_dir = self.root / "reports"
        reports_dir.mkdir()
        self.reports = fixtures.passing_reports(reports_dir)
        self.no_manifest = False

    def amend(self, role: str, mutate) -> None:
        path = self.reports[role]
        payload = json.loads(path.read_text())
        mutate(payload)
        path.write_text(json.dumps(payload))

    def decide(self) -> gate.Decision:
        call = fixtures.assembly()
        if self.no_manifest:
            call["fixture_manifest"] = None
        bundle = evidence.assemble(self.contract, out=self.root / "b.json",
                                   reports=self.reports, host="chromium", **call)
        return gate.evaluate(self.contract, self.write_bundle(bundle))

    def verdict(self, requirement_id: str) -> str:
        return self.requirement(self.decide(), requirement_id).verdict

    # -- mutations --------------------------------------------------------- #

    def fault_assertion(self) -> None:
        def fail_first(payload):
            assertions = payload.get("assertions") or []
            self.assertTrue(assertions, "fixture has no assertion to fail")
            assertions[0]["ok"] = False
        self.amend("q2", fail_first)

    def fault_result(self) -> None:
        self.amend("q2", lambda p: p.update(
            {"result": "fail", "failures": ["known failure"]}))

    def fault_window(self) -> None:
        self.amend("q2", lambda p: p.__setitem__("windows", [
            {"classification": "measured",
             "window": {"w": 4096, "h": 4096}, "cells": 4096 * 4096}]))

    def fault_budget(self) -> None:
        def exceed(payload):
            for measurement in payload["measurements"]:
                if measurement.get("routeRole") == "candidate":
                    measurement["decodedCacheBytes"] = 2 ** 30
        self.amend("q6resources", exceed)

    def gap_identity(self) -> None:
        self.amend("q2", lambda p: p.pop("identity", None))

    def gap_run_id(self) -> None:
        self.amend("q2", lambda p: p["identity"].pop("runId", None))

    def gap_manifest(self) -> None:
        self.no_manifest = True

    def gap_fixture_coverage(self) -> None:
        # A declaration-level gap that is independent of every fault below: the
        # numeric report records no measured fixture, so fixture coverage has
        # nothing to establish. Nothing contradicts the declaration, so this is a
        # gap and not a failure.
        def drop_fixtures(payload):
            payload["identity"]["fixtures"] = []
            payload["fixturesTested"] = 0
        self.amend("q2", drop_fixtures)

    FAULTS = {
        "source assertion failure": ("Q-LOCAL-1", "fault_assertion"),
        "source result failure": ("Q-LOCAL-1", "fault_result"),
        "window over the contract limit": ("Q-LOCAL-1", "fault_window"),
        "resource budget exceeded": ("Q-RES-1", "fault_budget"),
    }
    GAPS = {
        "source identity removed": ("Q-LOCAL-1", "gap_identity"),
        "source runId removed": ("Q-LOCAL-1", "gap_run_id"),
        "fixture manifest removed": ("Q-LOCAL-1", "gap_manifest"),
        "fixture coverage lost": ("Q-LOCAL-1", "gap_fixture_coverage"),
    }

    def apply(self, name: str, table: dict) -> str:
        requirement_id, method = table[name]
        getattr(self, method)()
        return requirement_id

    def test_each_fault_alone_fails_its_requirement(self) -> None:
        for label in self.FAULTS:
            with self.subTest(fault=label):
                self.setUp()
                requirement_id = self.apply(label, self.FAULTS)
                self.assertEqual(self.verdict(requirement_id), gate.FAIL,
                                 f"{label} did not fail")

    def test_each_gap_alone_is_a_gap_for_its_requirement(self) -> None:
        for label in self.GAPS:
            with self.subTest(gap=label):
                self.setUp()
                requirement_id = self.apply(label, self.GAPS)
                self.assertEqual(self.verdict(requirement_id), gate.INCONCLUSIVE,
                                 f"{label} was not a gap")

    def test_fault_survives_every_cross_layer_gap(self) -> None:
        for fault_label in self.FAULTS:
            for gap_label in self.GAPS:
                with self.subTest(fault=fault_label, gap=gap_label):
                    self.setUp()
                    requirement_id = self.apply(fault_label, self.FAULTS)
                    self.apply(gap_label, self.GAPS)
                    self.assertEqual(
                        self.verdict(requirement_id), gate.FAIL,
                        f"{gap_label} erased {fault_label}")

    def test_order_does_not_change_severity(self) -> None:
        for fault_label in self.FAULTS:
            for gap_label in self.GAPS:
                with self.subTest(fault=fault_label, gap=gap_label,
                                  order="fault-first"):
                    self.setUp()
                    requirement_id = self.apply(fault_label, self.FAULTS)
                    self.apply(gap_label, self.GAPS)
                    first = self.verdict(requirement_id)
                with self.subTest(fault=fault_label, gap=gap_label,
                                  order="gap-first"):
                    self.setUp()
                    self.apply(gap_label, self.GAPS)
                    self.apply(fault_label, self.FAULTS)
                    second = self.verdict(requirement_id)
                self.assertEqual(
                    first, second,
                    f"{fault_label} with {gap_label} is order-dependent")

    def test_adding_unrelated_evidence_never_closes_a_gap(self) -> None:
        self.gap_run_id()
        before = self.verdict("Q-LOCAL-1")
        self.amend("q6resources", lambda p: p["measurements"][0].__setitem__(
            "someUnrelatedCounter", 1))
        self.assertEqual(before, gate.INCONCLUSIVE, before)
        self.assertEqual(self.verdict("Q-LOCAL-1"), before)

    def test_removing_required_evidence_never_creates_a_pass(self) -> None:
        for label in self.GAPS:
            with self.subTest(gap=label):
                self.setUp()
                requirement_id = self.apply(label, self.GAPS)
                decision = self.decide()
                self.assertNotEqual(
                    self.requirement(decision, requirement_id).verdict, gate.PASS)
                self.assertNotEqual(decision.verdict, gate.PASS)


class C7OutputFailure(AcceptanceBase):
    """C7/C4: an unwritable destination exits nonzero with a clear error.

    The contract is explicit: if the output itself cannot be written, exit nonzero
    with a clear stderr error and never claim an output was saved. A traceback is
    not a clear error, and it does not tell an operator what to fix.
    """

    def setUp(self) -> None:
        super().setUp()
        reports_dir = self.root / "reports"
        reports_dir.mkdir()
        self.reports = fixtures.passing_reports(reports_dir)
        # A regular file where the output's parent directory would go, so the
        # destination genuinely cannot be created or written.
        self.blocker = self.root / "blocker"
        self.blocker.write_text("not a directory")

    def run_cli(self, *args: str):
        import os
        import subprocess
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(HARNESS)
        return subprocess.run(
            [sys.executable, str(HARNESS / "measure.py"), *args],
            capture_output=True, text=True, env=environment, timeout=600)

    def test_unwritable_gate_assemble_destination_reports_cleanly(self) -> None:
        target = self.blocker / "bundle.json"
        result = self.run_cli(
            "gate-assemble", "--reports", str(self.reports), "--host", "chromium",
            "--out", str(target))
        diagnostic = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("Traceback", diagnostic,
                         "an unwritable destination produced a traceback")
        self.assertIn("bundle.json", diagnostic)
        # It must not claim the bundle was saved.
        self.assertNotIn('"out"', result.stdout)

    def test_unwritable_gate_destination_reports_cleanly(self) -> None:
        bundle = self.write_bundle(fixtures.passing_evidence())
        result = self.run_cli(
            "gate", "--bundle", str(bundle), "--out",
            str(self.blocker / "decision.json"))
        diagnostic = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn("Traceback", diagnostic,
                         "an unwritable destination produced a traceback")
        self.assertIn("decision.json", diagnostic)


class C8ObservedFailureSeverity(AcceptanceBase):
    """C8: a recorded failure keeps its severity however the source was admitted.

    An unusable record cannot carry a requirement, but grading a measured
    violation down to a gap because the same record is also incomplete is how a
    known failure disappears. The two findings are independent.
    """

    def test_observed_failure_in_an_unadmitted_entry_stays_a_failure(self) -> None:
        payload = fixtures.passing_evidence()
        entry = payload["requirements"]["Q-LOCAL-1"]
        entry["admission"] = {
            "verdict": "inconclusive",
            "reasons": ["source was not admitted: identity is incomplete"],
            "sourceAdmitted": False,
        }
        entry["observed"] = {"window-size-within-contract-limit": "fail"}
        entry["assertions"] = {}
        local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.FAIL, local.reasons)
        self.assertIn("window-size-within-contract-limit", " ".join(local.reasons))

    def test_observed_gap_in_an_unadmitted_entry_stays_a_gap(self) -> None:
        """Control: an unadmitted entry with no failure stays inconclusive."""
        payload = fixtures.passing_evidence()
        entry = payload["requirements"]["Q-LOCAL-1"]
        entry["admission"] = {
            "verdict": "inconclusive",
            "reasons": ["source was not admitted: identity is incomplete"],
            "sourceAdmitted": False,
        }
        entry["observed"] = {"window-size-within-contract-limit": "inconclusive"}
        entry["assertions"] = {}
        local = self.requirement(self.evaluate(payload), "Q-LOCAL-1")
        self.assertEqual(local.verdict, gate.INCONCLUSIVE, local.reasons)


class C4MappingDrift(AcceptanceBase):
    """C4: the assertion-to-evidence map stays in step with the contract.

    The mapping is documentation, so it drifts silently unless something checks
    it. This test fails when the contract gains or loses an assertion without the
    map being updated, which is the only way a reader can keep trusting it.
    """

    MAP_PATH = HARNESS / "assertion_evidence_map.md"

    def mapping_rows(self) -> list[tuple[str, str]]:
        import re
        text = self.MAP_PATH.read_text()
        # Rows are grouped under a `## <REQUIREMENT-ID> — ...` heading.
        rows: list[tuple[str, str]] = []
        current = None
        for line in text.splitlines():
            heading = re.match(r"^##\s+(Q-[A-Z]+-\d+)\b", line)
            if heading:
                current = heading.group(1)
                continue
            row = re.match(r"^\|\s*`([a-z0-9-]+)`\s*\|", line)
            if row and current:
                rows.append((current, row.group(1)))
        return rows

    def test_every_contract_assertion_is_mapped(self) -> None:
        mapped = set(self.mapping_rows())
        expected = {(r.id, assertion) for r in self.contract.requirements
                    for assertion in r.assertions}
        self.assertEqual(sorted(expected - mapped), [],
                         "contract assertions missing from the mapping")
        self.assertEqual(sorted(mapped - expected), [],
                         "mapping rows that no requirement declares")
