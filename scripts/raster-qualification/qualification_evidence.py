#!/usr/bin/env python3
"""Evidence assembly: probe reports to qualification assertion results.

This module owns the mapping between what the probes record and the assertions the
[requirement contract](requirements.json) demands. It is deliberately separate
from :mod:`qualification_gate`, which decides eligibility:

* the assembler answers *"what did this report actually observe?"*;
* the gate answers *"is that enough evidence for the requirement?"*.

Keeping them apart is what stops a probe's output shape from redefining the
requirement, and it puts every producer/consumer field agreement in one place
that can be tested directly.

Two rules apply throughout:

* A number is not an observation. Values must be finite, non-negative, in the
  expected unit, and produced by a measurement the probe reports as successful
  and supported.
* A producer field the assembler does not recognise makes the affected assertion
  inconclusive. A renamed field must never silently degrade into a passing one.
"""

from __future__ import annotations

import json
import math
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import qualification_gate as gate

PASS = "pass"
FAIL = "fail"
INCONCLUSIVE = "inconclusive"

#: Verdict for an assertion the supplied report cannot decide.
UNKNOWN = INCONCLUSIVE

#: Per-run fields this consumer understands. ``run_display_trace.mjs`` must emit
#: exactly these; anything else is reported as unrecognised so a producer rename
#: surfaces as a finding instead of silently degrading into a passing assertion.
DISPLAY_RUN_FIELDS = frozenset({
    "name", "ok", "error", "pageErrors", "wallSeconds", "tileRequests",
    "tilesRendered", "failedTiles", "medianMs", "p95Ms", "maxMs",
    "individualLatenciesMs", "cachesCleared", "longTaskMaxMs", "longTaskCount",
    "longTaskObserverSupported",
})


def _num(value: Any) -> float | None:
    """A usable measurement: a finite, non-negative real number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if math.isnan(number) or math.isinf(number) or number < 0:
        return None
    return number


def _load(path: Path | None) -> tuple[dict[str, Any] | None, str | None]:
    if path is None:
        return None, "no report supplied"
    if not path.is_file():
        return None, f"{path.name} is missing"
    try:
        payload = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        return None, f"{path.name} is malformed: {error}"
    if not isinstance(payload, dict):
        return None, f"{path.name} is not a JSON object"
    return payload, None


# --------------------------------------------------------------------------- #
# display trace
# --------------------------------------------------------------------------- #

def sample_percentile(values: list[float], p: float) -> float | None:
    """Nearest-rank percentile over a sample, matching the producer's convention.

    The producer computes ``sorted[clamp(ceil(p/100 * n) - 1, 0, n-1)]``. The
    convention is restated here rather than imported, so this consumer and its
    tests share a definition that is independent of the producer's code. The
    tests freeze it with hand-calculated examples, including boundary rounding.
    """
    clean = sorted(v for v in values if _num(v) is not None)
    if not clean:
        return None
    index = min(len(clean) - 1, math.ceil((p / 100.0) * len(clean)) - 1)
    return clean[max(0, index)]


def display_trace_assertions(trace: dict[str, Any] | None,
                             *, bound_ms: float, cold_runs: int, warm_runs: int,
                             min_latencies: int) -> tuple[dict[str, str], list[str], dict]:
    """Assertion results for the plan's display-trace requirement.

    Field names here are the producer's, verified against
    ``run_display_trace.mjs``. The long-task field is ``longTaskMaxMs``; reading a
    different name is how a 900 ms UI stall previously passed a 50 ms bound, so
    that agreement is asserted explicitly rather than assumed.
    """
    results: dict[str, str] = {}
    notes: list[str] = []
    observed: dict[str, Any] = {}

    if trace is None:
        return ({key: UNKNOWN for key in (
            "one-cold-and-three-warm-runs", "hundred-valid-latencies-per-run",
            "runs-report-successful-rendering", "p95-from-individual-latencies",
            "cache-state-recorded", "statistics-agree-with-samples",
            "no-ui-thread-task-above-bound",
            "unsupported-observation-is-inconclusive")},
            ["no display trace report"], observed)

    runs = trace.get("runs")
    if not isinstance(runs, list):
        return ({key: FAIL for key in (
            "one-cold-and-three-warm-runs", "hundred-valid-latencies-per-run",
            "runs-report-successful-rendering", "p95-from-individual-latencies",
            "cache-state-recorded", "statistics-agree-with-samples",
            "no-ui-thread-task-above-bound",
            "unsupported-observation-is-inconclusive")},
            ["display trace has no runs list"], observed)

    cold = [r for r in runs if isinstance(r, dict) and r.get("name") == "cold"]
    warm = [r for r in runs if isinstance(r, dict) and r.get("name") == "warm"]
    observed["runNames"] = [r.get("name") for r in runs if isinstance(r, dict)]
    observed["runCounts"] = {"cold": len(cold), "warm": len(warm)}

    # Producer field coverage. A renamed field must not pass silently: report it
    # and make the affected assertions inconclusive.
    unrecognised = sorted({
        key for run in runs if isinstance(run, dict) for key in run
        if key not in DISPLAY_RUN_FIELDS
    })
    observed["unrecognisedRunFields"] = unrecognised
    if unrecognised:
        notes.append(
            "display trace contains fields this consumer does not recognise: "
            + ", ".join(unrecognised))

    # Run completeness. One cold and three warm runs are required; a missing or
    # empty list is inconclusive, not a zero-duration observation.
    complete = len(cold) >= cold_runs and len(warm) >= warm_runs
    if not runs:
        results["one-cold-and-three-warm-runs"] = UNKNOWN
        notes.append("display trace recorded no runs")
    else:
        results["one-cold-and-three-warm-runs"] = PASS if complete else FAIL
        if not complete:
            notes.append(
                f"trace has {len(cold)} cold and {len(warm)} warm run(s); "
                f"required {cold_runs} cold and {warm_runs} warm")

    # Per-run validity.
    latency_counts: dict[str, int] = {}
    failed_renders: list[str] = []
    missing_counters: list[str] = []
    run_counts: dict[str, tuple[float, float, int]] = {}
    observed_p95: dict[str, float | None] = {}
    latencies_sufficient = True
    rendering_ok = True
    p95_ok = True
    cache_ok = True
    statistics_ok = True
    for run in runs:
        if not isinstance(run, dict):
            latencies_sufficient = rendering_ok = p95_ok = cache_ok = False
            continue
        name = str(run.get("name"))
        # Only individual latencies count; an aggregate summary is not evidence.
        individual = run.get("individualLatenciesMs")
        entries = individual if isinstance(individual, list) else []
        valid_latencies = [v for v in entries if _num(v) is not None]
        latency_counts[name] = len(valid_latencies)
        if len(valid_latencies) < min_latencies:
            latencies_sufficient = False
            notes.append(
                f"run {name}: {len(valid_latencies)} individual valid latencies, "
                f"required {min_latencies}")
        if len(valid_latencies) != len(entries):
            # A malformed latency is a defect, not a sample to be skipped.
            latencies_sufficient = False
            notes.append(
                f"run {name}: {len(entries) - len(valid_latencies)} latency "
                f"value(s) are not usable measurements")

        # Counters must be present, whole and non-negative. A missing counter is
        # a gap; a malformed one is a report defect.
        counters: dict[str, float] = {}
        counter_problem: str | None = None
        counter_gap = False
        for field in ("tileRequests", "tilesRendered", "failedTiles"):
            raw = run.get(field)
            if raw is None:
                # Absent evidence: a gap rather than a measured defect.
                counter_problem = f"{name}: {field} is missing"
                counter_gap = True
                break
            value = _num(raw)
            if value is None:
                # Present but unusable: a defect in the report.
                counter_problem = f"{name}: {field}={raw!r} is not a usable count"
                break
            if float(value) != int(value):
                counter_problem = f"{name}: {field}={raw!r} is not a whole count"
                break
            counters[field] = value
        if counter_problem:
            rendering_ok = False
            if counter_gap:
                missing_counters.append(counter_problem)
            else:
                failed_renders.append(counter_problem)
            notes.append(counter_problem)
        else:
            rendered, failed, requested = (counters["tilesRendered"],
                                           counters["failedTiles"],
                                           counters["tileRequests"])
            # Attempts are not successes.
            if run.get("ok") is not True or failed > 0 or rendered <= 0:
                rendering_ok = False
                failed_renders.append(
                    f"{name}: ok={run.get('ok')} rendered={rendered} failed={failed} "
                    f"requested={requested}")
            if rendered + failed != requested:
                rendering_ok = False
                failed_renders.append(
                    f"{name}: rendered {rendered} + failed {failed} != requested "
                    f"{requested}")
            run_counts[name] = (rendered, requested, len(valid_latencies))

        if _num(run.get("p95Ms")) is None:
            p95_ok = False
            notes.append(f"run {name}: p95Ms is not a usable measurement")

        if not run.get("cachesCleared"):
            cache_ok = False
            notes.append(f"run {name}: cache state not recorded")

        # Statistics must be derivable from the sample, and the counters must
        # agree with how many samples the run actually has.
        if name in run_counts:
            rendered, requested, sample_count = run_counts[name]
            sample_p95 = sample_percentile(valid_latencies, 95)
            sample_median = sample_percentile(valid_latencies, 50)
            sample_max = max(valid_latencies) if valid_latencies else None
            reported_p95 = _num(run.get("p95Ms"))
            reported_median = _num(run.get("medianMs"))
            reported_max = _num(run.get("maxMs"))
            problems: list[str] = []
            if rendered != sample_count:
                problems.append(
                    f"{name}: rendered {rendered} tile(s) but {sample_count} "
                    f"individual latency sample(s)")
            if reported_p95 is None or sample_p95 is None \
                    or abs(reported_p95 - sample_p95) > STATISTIC_TOLERANCE_MS:
                problems.append(
                    f"{name}: reported p95 {reported_p95} disagrees with the "
                    f"sample-derived p95 {sample_p95}")
            if reported_median is not None and sample_median is not None \
                    and abs(reported_median - sample_median) > STATISTIC_TOLERANCE_MS:
                problems.append(
                    f"{name}: reported median {reported_median} disagrees with the "
                    f"sample-derived median {sample_median}")
            if reported_max is not None and sample_max is not None \
                    and abs(reported_max - sample_max) > STATISTIC_TOLERANCE_MS:
                problems.append(
                    f"{name}: reported max {reported_max} disagrees with the "
                    f"sample-derived max {sample_max}")
            if problems:
                statistics_ok = False
                notes.extend(problems)
            observed_p95[name] = sample_p95

    results["hundred-valid-latencies-per-run"] = PASS if latencies_sufficient else FAIL
    if rendering_ok:
        results["runs-report-successful-rendering"] = PASS
    elif missing_counters and not failed_renders:
        # Nothing malformed was seen; the counters simply are not there.
        results["runs-report-successful-rendering"] = UNKNOWN
    else:
        results["runs-report-successful-rendering"] = FAIL
    results["p95-from-individual-latencies"] = PASS if p95_ok else FAIL
    results["statistics-agree-with-samples"] = PASS if statistics_ok else FAIL
    results["cache-state-recorded"] = PASS if cache_ok else FAIL
    observed["latencyCounts"] = latency_counts
    observed["failedRuns"] = failed_renders
    observed["missingCounters"] = missing_counters
    observed["sampleP95Ms"] = max(
        (v for v in observed_p95.values() if v is not None), default=None)

    # UI-thread bound. Read the producer's own field name and require the
    # observation mechanism to have been supported.
    unsupported = [str(r.get("name")) for r in runs
                   if isinstance(r, dict) and r.get("longTaskObserverSupported") is not True]
    if unrecognised:
        results["unsupported-observation-is-inconclusive"] = UNKNOWN
        results["no-ui-thread-task-above-bound"] = UNKNOWN
    elif unsupported:
        results["unsupported-observation-is-inconclusive"] = UNKNOWN
        results["no-ui-thread-task-above-bound"] = UNKNOWN
        notes.append(
            "long-task observation unsupported or unreported for runs: "
            + ", ".join(unsupported))
    else:
        results["unsupported-observation-is-inconclusive"] = PASS
        worst: float | None = None
        violation: str | None = None
        for run in runs:
            name = str(run.get("name"))
            value = _num(run.get("longTaskMaxMs"))
            if value is None:
                notes.append(f"run {name}: longTaskMaxMs is not a usable measurement")
                worst = None
                break
            if worst is None or value > worst:
                worst = value
            if value > bound_ms:
                violation = f"run {name}: {value} ms exceeds the {bound_ms} ms bound"
        if violation:
            results["no-ui-thread-task-above-bound"] = FAIL
            notes.append(violation)
        elif worst is None:
            results["no-ui-thread-task-above-bound"] = UNKNOWN
            notes.append("no usable long-task measurement in any run")
        else:
            results["no-ui-thread-task-above-bound"] = PASS
        observed["maxLongTaskMs"] = worst
    return results, notes, observed


# --------------------------------------------------------------------------- #
# report admission: identity, provenance and preconditions
# --------------------------------------------------------------------------- #
#
# A report is not evidence until it is admitted. Admission answers, for one raw
# report, three questions the gate must not answer for itself:
#
#   1. did the report's own run succeed, and are its declared preconditions met?
#   2. does the identity it recorded match the route, environment, fixture and
#      artifact the bundle claims to have measured?
#   3. does it carry enough provenance to be traceable at all?
#
# The assembler promotes observations only from an admitted report. A failed
# precondition is a failure; a missing identity field is a gap; a disagreement
# between what the report measured and what the bundle declares is a conflict.
# None of the three may be silently ignored, and none may be invented.

#: Report identity fields that must be present to admit a report as evidence.
REQUIRED_IDENTITY_FIELDS = ("id", "experiment", "digest", "command", "environment")

#: Identity fields compared against the declared route/environment.
COMPARED_IDENTITY_FIELDS = (
    ("routeId", "routeId", "route"),
    ("environment", "environment", "environment"),
    ("host", "host", "host"),
)

#: Fixture policies a report may declare.
FIXTURE_POLICIES = ("measured", "artifact-only")

#: Sidecar policies a report may declare.
#:
#: ``measured``   — the sidecar was hashed before and after preparation.
#: ``not_applicable`` — an explicit fixture policy establishes that the fixture
#:                  has no sidecar, so there is nothing to preserve.
#: ``unmeasured`` — the sidecar was not examined. This is the default, and it is
#:                  a gap: absence of evidence is not evidence of absence.
SIDECAR_POLICIES = ("measured", "not_applicable", "unmeasured")

#: The plan's sampling cadence for resource measurement.
REQUIRED_SAMPLE_INTERVAL_MS = 100.0

#: Tolerance when comparing a reported statistic with the sample-derived one.
#: The producer round-trips through JSON, so exact float equality is too strict.
STATISTIC_TOLERANCE_MS = 1e-6


@dataclass
class Admission:
    """The outcome of admitting one raw report as evidence."""

    report: str
    verdict: str
    reasons: list[str] = field(default_factory=list)
    identity: dict[str, Any] = field(default_factory=dict)
    #: Failures that belong to a separate, declared negative-control scope.
    negative_control_failures: list[str] = field(default_factory=list)
    #: Failures the positive run itself recorded.
    positive_failures: list[str] = field(default_factory=list)
    #: True when the report carries no identity block at all.
    legacy: bool = False

    @property
    def admitted(self) -> bool:
        return self.verdict == PASS

    def as_dict(self) -> dict[str, Any]:
        return {
            "report": self.report,
            "verdict": self.verdict,
            "reasons": self.reasons,
            "identity": self.identity,
            "negativeControlFailures": self.negative_control_failures,
            "positiveFailures": self.positive_failures,
            "legacy": self.legacy,
        }


def _negative_control_scopes(payload: dict[str, Any]) -> set[str]:
    """Assertion-name prefixes the report declares as negative-control scope.

    A failure inside a declared control scope is evidence that the control
    rejects what it should; it is not a failure of the positive run. The scope is
    read from the report rather than inferred, so a failure cannot be discarded by
    guessing which prefix looked like a control.
    """
    declared = payload.get("negativeControlScopes")
    if not isinstance(declared, list):
        return set()
    return {str(scope) for scope in declared if isinstance(scope, str) and scope}


def _split_failures(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Split recorded failures into (positive, negative-control) scopes."""
    scopes = _negative_control_scopes(payload)
    positive: list[str] = []
    controls: list[str] = []
    for failure in payload.get("failures") or []:
        text = str(failure)
        if any(text.startswith(scope) for scope in scopes):
            controls.append(text)
        else:
            positive.append(text)
    return positive, controls


def admit_report(payload: dict[str, Any] | None, *, report_name: str,
                 expected: dict[str, Any] | None = None,
                 requires_raster_fixture: bool = True) -> Admission:
    """Decide whether one raw report may contribute evidence.

    ``expected`` carries the declared values to compare against. Only fields the
    caller actually declares are compared; an undeclared expectation is not a
    licence to skip a check the report itself makes possible.
    """
    if payload is None:
        return Admission(report=report_name, verdict=UNKNOWN,
                         reasons=[f"{report_name} is missing"])

    result = Admission(report=report_name, verdict=PASS)
    identity = payload.get("identity")
    if not isinstance(identity, dict) or not identity:
        # Legacy reports stay readable, but as incomplete evidence only.
        result.legacy = True
        result.verdict = UNKNOWN
        result.reasons.append(
            f"{report_name} carries no identity block, so its route, environment and "
            f"fixture provenance cannot be verified")
        return result
    result.identity = identity

    # 1. The report's own verdict. A report that failed its own checks cannot
    #    supply a passing observation, however its individual assertions read.
    recorded_result = payload.get("result")
    if recorded_result not in (PASS, FAIL, INCONCLUSIVE):
        result.verdict = FAIL
        result.reasons.append(
            f"{report_name} declares an unusable result {recorded_result!r}")
        return result
    positive_failures, control_failures = _split_failures(payload)
    result.positive_failures = positive_failures
    result.negative_control_failures = control_failures

    if recorded_result == FAIL:
        result.verdict = FAIL
        detail = ""
        if positive_failures:
            # Name the report's own failures so a failed precondition is
            # traceable to the report that recorded it.
            detail = " with failures: " + "; ".join(positive_failures[:5])
        result.reasons.append(f"{report_name} reports result=fail{detail}")
    contradictions = _result_contradictions(payload, recorded_result, positive_failures)
    if contradictions:
        result.verdict = FAIL
        result.reasons.extend(contradictions)
    elif recorded_result == INCONCLUSIVE:
        result.verdict = UNKNOWN
        result.reasons.append(f"{report_name} reports result=inconclusive")
    if positive_failures and recorded_result != FAIL:
        result.verdict = FAIL
        result.reasons.append(
            f"{report_name} reports result={recorded_result} but records failures: "
            + "; ".join(positive_failures[:3]))

    # 2. Preconditions the report names as gating its observations.
    unmet = _unmet_preconditions(payload)
    if unmet:
        result.verdict = FAIL
        result.reasons.extend(
            f"{report_name} precondition not met: {name}" for name in unmet)

    # 3. Required identity fields.
    missing = [name for name in REQUIRED_IDENTITY_FIELDS if not identity.get(name)]
    if missing:
        result.verdict = FAIL if result.verdict == FAIL else UNKNOWN
        result.reasons.append(
            f"{report_name} identity does not record " + ", ".join(missing))

    # 4. The recorded experiment must be the one this report claims to be.
    expected_experiment = (expected or {}).get("experiment")
    if expected_experiment and identity.get("experiment") != expected_experiment:
        result.verdict = FAIL
        result.reasons.append(
            f"{report_name} identity names experiment {identity.get('experiment')!r} "
            f"but {expected_experiment!r} was expected")

    # 5. Declared route/environment/host must agree with the recorded values.
    for identity_key, _expected_key, label in COMPARED_IDENTITY_FIELDS:
        declared = (expected or {}).get(identity_key)
        observed = identity.get(identity_key)
        if declared is None:
            continue
        if observed is None:
            result.verdict = FAIL if result.verdict == FAIL else UNKNOWN
            result.reasons.append(
                f"{report_name} does not record the {label} it measured, so it cannot "
                f"be matched to the declared {label} ({declared!r})")
        elif str(observed) != str(declared):
            result.verdict = FAIL
            result.reasons.append(
                f"{report_name} {label} conflict: expected {declared!r}, "
                f"observed {observed!r}")

    # 6. The artifact each source recorded must be the one declared for its role.
    declared_artifact = (expected or {}).get("artifact")
    observed_artifact = identity.get("artifact")
    if isinstance(declared_artifact, dict) and declared_artifact:
        if not isinstance(observed_artifact, dict) or not observed_artifact:
            result.verdict = FAIL if result.verdict == FAIL else UNKNOWN
            result.reasons.append(
                f"{report_name} does not record which artifact it exercised, so it "
                f"cannot be matched to the declared artifact "
                f"{declared_artifact!r}")
        else:
            for key in ("name", "version", "sourceRevision"):
                declared_value = declared_artifact.get(key)
                observed_value = observed_artifact.get(key)
                if declared_value is None:
                    continue
                if observed_value is None:
                    result.verdict = FAIL if result.verdict == FAIL else UNKNOWN
                    result.reasons.append(
                        f"{report_name} artifact does not record its {key}, so it "
                        f"cannot be matched to the declared {key} "
                        f"({declared_value!r})")
                elif str(observed_value) != str(declared_value):
                    result.verdict = FAIL
                    result.reasons.append(
                        f"{report_name} artifact {key} conflict: expected "
                        f"{declared_value!r}, observed {observed_value!r}")

    # 7. The transport the source actually used must be the one required.
    #
    # A route string is a label; the transport is what was exercised. Comparing
    # the kind structurally is what stops a renamed route from qualifying an
    # HTTP-only measurement as the required local bridge.
    required_transport = (expected or {}).get("transport")
    observed_transport = identity.get("transport")
    if required_transport:
        if observed_transport is None:
            result.verdict = FAIL if result.verdict == FAIL else UNKNOWN
            result.reasons.append(
                f"{report_name} does not record which transport it used, so it "
                f"cannot be matched to the required transport {required_transport!r}")
        elif str(observed_transport) != str(required_transport):
            # A real but different capability: insufficient, not a violation.
            if result.verdict != FAIL:
                result.verdict = UNKNOWN
            result.reasons.append(
                f"{report_name} measured transport {observed_transport!r} but "
                f"{required_transport!r} is required; the recorded capability is "
                f"real but is not the required route")

    # 8. Fixture identity and hash.
    result.reasons.extend(_fixture_problems(
        identity, payload, report_name,
        requires_raster_fixture=requires_raster_fixture,
        expected=(expected or {}).get("fixtures"),
        verdict=result))

    if result.verdict == FAIL and not result.reasons:
        result.reasons.append(f"{report_name} failed admission")
    return result


def _result_contradictions(payload: dict[str, Any], recorded_result: str,
                           positive_failures: list[str]) -> list[str]:
    """A report whose result disagrees with its own failure list is corrupt."""
    problems: list[str] = []
    failures = payload.get("failures")
    if failures is None:
        problems.append("report records no failures list, so its result cannot be checked")
    elif not isinstance(failures, list):
        problems.append("report failures list is not a list")
    assertions = payload.get("assertions")
    if assertions is not None and not isinstance(assertions, list):
        problems.append("report assertions are not a list")
        return problems
    failed_assertions = [a for a in (assertions or [])
                         if isinstance(a, dict) and a.get("ok") is False]
    if recorded_result == PASS and failed_assertions:
        problems.append(
            f"report reports result=pass but {len(failed_assertions)} assertion(s) failed")
    if recorded_result == PASS and not assertions:
        problems.append("report reports result=pass but records no assertions")
    return problems


def _unmet_preconditions(payload: dict[str, Any]) -> list[str]:
    """Preconditions the report marks as not met, by name."""
    unmet: list[str] = []
    for entry in payload.get("preconditions") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("met") is False:
            unmet.append(str(entry.get("name") or "unnamed precondition"))
    return unmet


def _fixture_problems(identity: dict[str, Any], payload: dict[str, Any],
                      report_name: str, *, requires_raster_fixture: bool,
                      expected: list[dict] | None,
                      verdict: "Admission") -> list[str]:
    """Fixture-policy, identity and hash checks for one report."""
    problems: list[str] = []
    policy = identity.get("fixturePolicy")
    fixtures = identity.get("fixtures")
    if policy not in FIXTURE_POLICIES:
        problems.append(
            f"{report_name} does not declare a fixture policy "
            f"(one of {list(FIXTURE_POLICIES)})")
        if verdict.verdict != FAIL:
            verdict.verdict = UNKNOWN
        return problems

    if not isinstance(fixtures, list):
        problems.append(f"{report_name} identity fixtures are not a list")
        if verdict.verdict != FAIL:
            verdict.verdict = UNKNOWN
        return problems

    if requires_raster_fixture and policy != "measured":
        # Declaring an artifact-only policy cannot excuse a requirement that the
        # plan measures on a raster.
        problems.append(
            f"{report_name} declares fixturePolicy={policy!r} but this requirement "
            f"must be evidenced by a measured raster fixture")
        if verdict.verdict != FAIL:
            verdict.verdict = UNKNOWN
        return problems
    if not requires_raster_fixture and policy == "measured" and not fixtures:
        problems.append(
            f"{report_name} declares fixturePolicy=measured but names no fixture")
        if verdict.verdict != FAIL:
            verdict.verdict = UNKNOWN

    if policy == "measured":
        if not fixtures:
            problems.append(
                f"{report_name} measures a raster but names no fixture identity")
            if verdict.verdict != FAIL:
                verdict.verdict = UNKNOWN
        tested = _num(payload.get("fixturesTested"))
        if tested is None:
            problems.append(
                f"{report_name} does not record how many fixtures it measured")
            if verdict.verdict != FAIL:
                verdict.verdict = UNKNOWN
        elif len(fixtures) != int(tested):
            problems.append(
                f"{report_name} names {len(fixtures)} fixture(s) but records "
                f"fixturesTested={int(tested)}")
            verdict.verdict = FAIL
        for fixture in fixtures:
            if not isinstance(fixture, dict) or not fixture.get("name"):
                problems.append(f"{report_name} names a fixture without an identity")
                if verdict.verdict != FAIL:
                    verdict.verdict = UNKNOWN
                continue
            if not fixture.get("sha256"):
                problems.append(
                    f"{report_name} fixture {fixture.get('name')!r} records no hash")
                if verdict.verdict != FAIL:
                    verdict.verdict = UNKNOWN

    # Compare against the declared fixture manifest when one is supplied.
    if expected and isinstance(fixtures, list):
        declared = {f.get("name"): f.get("sha256") for f in expected
                    if isinstance(f, dict)}
        for fixture in fixtures:
            if not isinstance(fixture, dict):
                continue
            name = fixture.get("name")
            observed_hash = fixture.get("sha256")
            # A missing hash is a gap, not a conflict: only an observed value that
            # disagrees with the declared manifest is a conflict.
            if name in declared and observed_hash and observed_hash != declared[name]:
                problems.append(
                    f"{report_name} fixture {name!r} hash conflict: expected "
                    f"{declared[name]!r}, observed {observed_hash!r}")
                verdict.verdict = FAIL
    return problems


def _sidecar_verdicts(identity: dict[str, Any] | None, payload: dict[str, Any] | None,
                      report_name: str) -> tuple[dict[str, str], list[str]]:
    """Sidecar assertions for a preparation report.

    Absence of sidecar evidence is inconclusive. Only an explicit fixture policy
    can establish that no sidecar applies, and a measured sidecar whose hash
    changed fails.
    """
    identity = identity or {}
    payload = payload or {}
    policy = identity.get("sidecarPolicy")
    results: dict[str, str] = {}
    notes: list[str] = []
    if policy == "not_applicable":
        results["sidecar-unchanged"] = PASS
        notes.append("fixture policy records that no sidecar applies")
        return results, notes
    if policy == "measured":
        observed = payload.get("sidecar") or {}
        expected_hash = observed.get("expectedSha256")
        actual_hash = observed.get("sha256")
        if not expected_hash or not actual_hash:
            results["sidecar-unchanged"] = UNKNOWN
            notes.append(f"{report_name}: sidecar hash not recorded")
            return results, notes
        if expected_hash != actual_hash:
            results["sidecar-unchanged"] = FAIL
            notes.append(
                f"{report_name}: sidecar changed ({actual_hash} vs {expected_hash})")
            return results, notes
        if observed.get("after") is False:
            results["sidecar-unchanged"] = FAIL
            notes.append(f"{report_name}: sidecar did not survive preparation")
            return results, notes
        # The recorded hash must match the fixture manifest's declared sidecar.
        declared = (identity.get("sidecarSha256") or {}).get("expected")
        if declared and declared != expected_hash:
            results["sidecar-unchanged"] = FAIL
            notes.append(
                f"{report_name}: sidecar hash conflict, declared {declared}, "
                f"report records {expected_hash}")
            return results, notes
        results["sidecar-unchanged"] = PASS
        return results, notes
    results["sidecar-unchanged"] = UNKNOWN
    notes.append(
        f"{report_name}: sidecar evidence unobserved; absence alone does not "
        f"establish that no sidecar applies")
    return results, notes


# --------------------------------------------------------------------------- #
# bundle assembly
# --------------------------------------------------------------------------- #

def _entry(requirement_id: str, *, admission: "Admission", source: str, command: str,
           environment: str, route: str, artifact: dict | None,
           fixtures: list[dict], assertions: dict[str, str], observations: dict,
           host: str | None = None,
           provenance: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build a requirement entry, gated on its source's admission.

    Admission is a required argument so an entry cannot be constructed without a
    decision about whether its source may contribute evidence. When the source did
    not admit, the observations are moved to ``observed`` and no assertion is
    promoted, which keeps partial measured successes visible without letting them
    satisfy the requirement.
    """
    identity = admission.identity or {}
    entry: dict[str, Any] = {
        "requirementId": requirement_id,
        "source": source,
        "command": command,
        "environment": environment,
        "route": route,
        "artifact": artifact or {},
        "fixtures": fixtures,
        "observations": observations,
        "assertions": dict(assertions),
        "admission": admission.as_dict(),
        "provenance": {
            "source": source,
            "sourceDigest": identity.get("digest"),
            "reportExperiment": identity.get("experiment"),
            "runId": identity.get("runId"),
            "recordedAt": identity.get("recordedAt"),
            "fixtures": identity.get("fixtures") or [],
            "artifact": identity.get("artifact") or {},
            "routeId": identity.get("routeId"),
            "environment": identity.get("environment"),
            "host": identity.get("host"),
            "command": identity.get("command"),
            "fixturePolicy": identity.get("fixturePolicy"),
            "sidecarPolicy": identity.get("sidecarPolicy"),
            **(provenance or {}),
        },
    }
    if host:
        entry["host"] = host
    if not admission.admitted:
        entry["observed"] = entry["assertions"]
        entry["assertions"] = {}
        # Admission reasons are the authoritative explanation for why this source
        # could not be promoted; keep them where the gate surfaces diagnostic detail.
        existing = list(entry["observations"].get("notes") or []) \
            if isinstance(entry["observations"], dict) else []
        entry.setdefault("observations", {})
        entry["observations"]["notes"] = existing + list(admission.reasons)
    return entry


def _all(requirement: gate.Requirement, verdict: str) -> dict[str, str]:
    return {assertion: verdict for assertion in requirement.assertions}


def assemble(contract: gate.Contract, *, out: Path, reports: dict[str, Path],
             environment: dict[str, Any], route: dict[str, Any],
             artifacts: list[dict], fixtures: list[dict],
             display: dict[str, Any], host: str,
             synthetic: bool = False) -> dict[str, Any]:
    """Assemble a gate bundle from the reports named in ``reports``.

    Anything a report does not establish is left ``inconclusive``; this function
    never promotes absence into a pass, and it never relabels reference-only or
    wrong-host measurements as candidate evidence.
    """
    ledger, ledger_problem = _load(reports.get("ledger"))
    browser, browser_problem = _load(reports.get("browser"))
    trace, trace_problem = _load(reports.get("trace"))
    verdicts = {r["experiment"]: r for r in ([])}

    environment_note = ", ".join(f"{k}={v}" for k, v in sorted(environment.items()))
    entries: dict[str, Any] = {}

    def requirement(requirement_id: str) -> gate.Requirement:
        found = contract.by_id(requirement_id)
        if found is None:
            raise KeyError(requirement_id)
        return found

    # Reports carry their own verdicts; a report that failed its own checks is a
    # failure of the corresponding requirement, and a missing report is a gap.
    def report_experiment(name: str) -> tuple[dict | None, str | None]:
        payload, problem = _load(reports.get(name))
        if payload is None:
            return None, problem
        return payload, None

    digest: list[str] = []
    loaded: dict[str, dict | None] = {}
    for name, path in sorted(reports.items()):
        payload, problem = _load(path)
        loaded[name] = payload
        if payload is None:
            digest.append(f"{name}: {problem}")
            continue
        digest.append(f"{name}: {payload.get('experiment')} -> {payload.get('result')}")

    # One admission per source, computed once so every entry that draws on a
    # report shares the same verdict and the same reasons.
    admissions: dict[str, Admission] = {}

    #: Which declared artifact each requirement's source is expected to have used.
    artifact_role_for = {
        "Q-LOCAL-1": "numericArtifact", "Q-CANCEL-1": "numericArtifact",
        "Q-TEARDOWN-1": "numericArtifact", "Q-FAILINJ-1": "numericArtifact",
        "Q-RES-1": "numericArtifact", "Q-DISPLAY-1": "displayArtifact",
        "Q-PREP-1": "prepareArtifact", "Q-VALUE-1": "slopeArtifact",
        "Q-CRS-1": "crsArtifact",
    }

    #: Which declared transport requirement each source must satisfy.
    transport_role_for = {
        "Q-LOCAL-1": "numericExpectedTransport",
        "Q-DISPLAY-1": "displayExpectedTransport",
    }

    def admission_for(role: str, requirement_id: str,
                      expectations: dict[str, Any] | None = None) -> Admission:
        key = f"{role}:{requirement_id}"
        if key in admissions:
            return admissions[key]
        requirement_obj = contract.by_id(requirement_id)
        needs_raster = True if requirement_obj is None \
            else requirement_obj.requires_raster_fixture
        expectation = dict(expectations or {})
        expectation.setdefault("routeId", route.get("routeId"))
        expectation.setdefault("environment", environment.get("environment"))
        expectation.setdefault("host", host)
        expectation.setdefault("fixtures", fixtures)
        artifact_key = artifact_role_for.get(requirement_id)
        if artifact_key and route.get(artifact_key):
            expectation.setdefault("artifact", route.get(artifact_key))
        transport_key = transport_role_for.get(requirement_id)
        if transport_key and route.get(transport_key) is not None:
            expectation.setdefault("transport", route.get(transport_key))
        result = admit_report(
            loaded.get(role), report_name=str(reports.get(role) or role),
            expected=expectation, requires_raster_fixture=needs_raster)
        admissions[key] = result
        return result

    # --- artifacts ------------------------------------------------------- #
    q1, q1_problem = report_experiment("q1")
    art_assertions = _all(requirement("Q-ART-1"), UNKNOWN)
    art_notes: list[str] = []
    if q1 is not None:
        recorded = {a["name"]: a for a in q1.get("assertions", [])}
        art_assertions["artifacts-present-at-declared-version"] = _from_assertions(
            recorded, "version:", None)
        art_assertions["artifacts-match-integrity-digest"] = _from_assertions(
            recorded, "integrity:", None)
        art_assertions["artifacts-record-license"] = _from_assertions(
            recorded, "license-recorded:", None)
        art_assertions["non-corresponding-artifacts-recorded"] = PASS \
            if any("no published artifact matches" in n for n in q1.get("notes", [])) else FAIL
        exercised = list(artifacts)
        source_artifact = ((admission_for("q1", "Q-ART-1").identity or {})
                           .get("artifact") or {})
        if source_artifact.get("name") and source_artifact not in exercised:
            exercised.append(source_artifact)

        # The assertion covers two independent obligations: the version each role
        # used must be the bench-verified one, and each artifact must correspond to
        # the pinned source revision. Both are required, so the more severe verdict
        # wins and neither can overwrite the other. A missing correspondence record
        # is a gap, so it must be surfaced as a note as well as a verdict.
        version_verdict, version_notes = _from_versions(
            q1.get("verifiedArtifacts"), exercised,
            unpinned_roles=route.get("unpinnedRoles"))
        correspondence_verdict, correspondence_notes = _source_correspondence(
            q1.get("sourceCorrespondence"), exercised,
            unpinned_roles=route.get("unpinnedRoles"))
        art_assertions["qualified-roles-name-artifact-version"] = _worse(
            version_verdict, correspondence_verdict)
        art_notes.extend(version_notes)
        art_notes.extend(correspondence_notes)
        # The API set actually called and the worker build target are required by
        # the plan's first experiment; the artifact report records them.
        art_assertions["apis-called-and-worker-target-recorded"] = _single(
            recorded, "apis-and-worker-target-recorded")
        if art_assertions["apis-called-and-worker-target-recorded"] == UNKNOWN:
            art_notes.append(
                "the artifact report does not record the APIs called and the "
                "worker build target")
    else:
        art_notes.append(q1_problem or "q1 report unavailable")
    entries["Q-ART-1"] = _entry(
        "Q-ART-1", admission=admission_for("q1", "Q-ART-1"), source="reports/q1-artifacts.json",
        command="measure.py q1-artifacts --bench <bench> --out reports/q1-artifacts.json",
        environment=environment_note, route=route.get("artifacts", "candidate artifact resolution"),
        artifact={"name": "multiple"}, fixtures=[],
        assertions=art_assertions,
        observations={"reportDigest": digest, "artifacts": artifacts,
                      "unpinnedRoles": route.get("unpinnedRoles") or [],
                      "notes": art_notes})

    # --- numeric local transport ----------------------------------------- #
    q2, q2_problem = report_experiment("q2")
    q2_assertions = _all(requirement("Q-LOCAL-1"), UNKNOWN)
    q2_notes: list[str] = []
    q2_obs: dict[str, Any] = {}
    if q2 is not None:
        tested = _num(q2.get("testedWindows")) or 0
        ledger_observed = q2.get("serverLedger") or {}
        fixture_requests = _num(ledger_observed.get("fixtureRequests")) or 0
        q2_assertions["reads-over-proposed-local-transport"] = PASS if tested > 0 else FAIL
        q2_assertions["transport-ledger-corroborates-bytes"] = PASS \
            if fixture_requests > 0 else UNKNOWN
        if fixture_requests <= 0:
            q2_notes.append("transport ledger did not record fixture reads")
        names = [a["name"] for a in q2.get("assertions", [])]
        q2_assertions["no-single-request-returns-whole-artifact"] = _all_named(
            q2, [], "no-whole-file-request")
        q2_assertions["values-match-independent-reference"] = _all_named(
            q2, names, "analytic:")
        q2_assertions["validity-matches-reference-exactly"] = _all_named(
            q2, names, "validity:")
        q2_assertions["window-size-within-contract-limit"] = PASS \
            if not any("exceeds the" in f for f in q2.get("failures", [])) else FAIL
        q2_obs = {"testedWindows": tested, "serverLedger": ledger_observed,
                  "failures": q2.get("failures", [])}
    else:
        q2_notes.append(q2_problem or "q2 report unavailable")
    entries["Q-LOCAL-1"] = _entry(
        "Q-LOCAL-1", admission=admission_for("q2", "Q-LOCAL-1"), source="reports/q2-numeric.json",
        command="measure.py q2-numeric --browser-report <probe> --out reports/q2-numeric.json",
        environment=environment_note, route=route.get("numeric", "candidate numeric window decode"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=q2_assertions, observations={**q2_obs, "notes": q2_notes})

    # --- preparation ----------------------------------------------------- #
    q3p, q3p_problem = report_experiment("q3prepare")
    prep_assertions = _all(requirement("Q-PREP-1"), UNKNOWN)
    prep_notes: list[str] = []
    if q3p is not None:
        named = {a["name"]: a for a in q3p.get("assertions", [])}
        mapping = {
            "original-bytes-unchanged": "original-unchanged",
            "original-matches-recorded-hash": "original-hash-declared",
            "derivative-is-tiled-and-bounded": "derived-tiled",
            "derivative-cell-exact": "cell-exact",
            "derivative-preserves-metadata": "geotransform-preserved",
            "derivative-windows-match-original": "all-values-match",
        }
        for assertion_id, source_name in mapping.items():
            prep_assertions[assertion_id] = _single(named, source_name)
        # Sidecar evidence is decided by the report's declared fixture policy and
        # its measured hashes, never by the absence of a record.
        prep_admission = admission_for("q3prepare", "Q-PREP-1")
        sidecar_assertions, sidecar_notes = _sidecar_verdicts(
            prep_admission.identity, q3p, "q3-prepare")
        # The policy decides this assertion outright; it is not combined with a
        # report-level value, because the report's own list does not carry it.
        prep_assertions["sidecar-unchanged"] = sidecar_assertions.get(
            "sidecar-unchanged", UNKNOWN)
        prep_notes.extend(sidecar_notes)
    entries["Q-PREP-1"] = _entry(
        "Q-PREP-1", admission=admission_for("q3prepare", "Q-PREP-1"), source="reports/q3-prepare.json",
        command="measure.py q3-prepare --original <tif> --derived <cog> --out reports/q3-prepare.json",
        environment=environment_note, route=route.get("prepare", "native GDAL preparation"),
        artifact=route.get("prepareArtifact"), fixtures=fixtures,
        assertions=prep_assertions,
        observations={"reportProblem": q3p_problem, "notes": prep_notes})

    # --- member resolution ----------------------------------------------- #
    q3m, q3m_problem = report_experiment("q3members")
    member_assertions = _all(requirement("Q-MEMBER-1"), UNKNOWN)
    if q3m is not None:
        named = {a["name"]: a for a in q3m.get("assertions", [])}
        member_assertions["window-spanning-members-resolves"] = _all_named(
            q3m, list(named), "multi-member:")
        member_assertions["unoccupied-slots-zero-coverage"] = _all_named(
            q3m, list(named), "gap-empty:")
        member_assertions["ordered-replacement-precedence"] = _single(
            named, "precedence-last-wins")
        member_assertions["nodata-does-not-erase-earlier-value"] = _single(
            named, "nodata-does-not-erase")
        # Overview precedence has no probe; it stays inconclusive until measured.
        member_assertions["overviews-do-not-resurrect-replaced-pixels"] = UNKNOWN
    entries["Q-MEMBER-1"] = _entry(
        "Q-MEMBER-1", admission=admission_for("q3members", "Q-MEMBER-1"), source="reports/q3-members.json",
        command="measure.py q3-members --collection <dir> --out reports/q3-members.json",
        environment=environment_note, route=route.get("member", "ordered member replay"),
        # The resolver exercised here is a reference implementation; it ships no
        # candidate artifact, and saying so is more honest than naming one.
        artifact={"name": "reference-resolver", "version": "harness"},
        fixtures=fixtures, assertions=member_assertions,
        observations={"reportProblem": q3m_problem,
                      "unresolved": "overview precedence is not exercised by any probe"})

    # --- scientific values ----------------------------------------------- #
    q4, q4_problem = report_experiment("q4slope")
    value_assertions = _all(requirement("Q-VALUE-1"), UNKNOWN)
    q2_values = q2 or {}
    value_assertions["values-match-analytic-expectation"] = _all_named(
        q2_values, [], "analytic:")
    value_assertions["validity-matches-reference-exactly"] = _all_named(
        q2_values, [], "validity:")
    if q4 is not None:
        named = {a["name"]: a for a in q4.get("assertions", [])}
        value_assertions["nodata-reported-invalid"] = _all_named(
            q4, list(named), "hole-centre-not-interpolated:")
        value_assertions["valid-zero-and-negative-retained"] = _all_named(
            q2_values, [], "zero-negative-retained:")
        value_assertions["slope-degrees-within-tolerance"] = _all_named(
            q4, list(named), "degrees:")
        value_assertions["slope-percent-within-tolerance"] = _all_named(
            q4, list(named), "percent:")
        value_assertions["blocked-slope-agrees-at-seams"] = _single(
            named, "seam-matches-whole")
        value_assertions["holes-and-edges-not-interpolated"] = _all_named(
            q4, list(named), "outer-edge")
        # Required fixture-class coverage (both one large raster and many small
        # rasters) is a plan acceptance case that no assertion reports yet.
        value_assertions["required-fixture-classes-covered"] = UNKNOWN
    else:
        value_assertions["values-match-analytic-expectation"] = _single(
            {a["name"]: a for a in (q2 or {}).get("assertions", [])}, "analytic:")
    entries["Q-VALUE-1"] = _entry(
        "Q-VALUE-1", admission=admission_for("q4slope", "Q-VALUE-1"), source="reports/q4-slope.json",
        command="measure.py q4-slope --fixtures <fx> --out reports/q4-slope.json",
        environment=environment_note, route=route.get("slope", "blocked Horn slope"),
        artifact=route.get("slopeArtifact"), fixtures=fixtures,
        assertions=value_assertions,
        observations={"reportProblem": q4_problem or q4_problem})

    # --- CRS ------------------------------------------------------------- #
    q4c, q4c_problem = report_experiment("q4crs")
    crs_assertions = _all(requirement("Q-CRS-1"), UNKNOWN)
    if q4c is not None:
        named = {a["name"]: a for a in q4c.get("assertions", [])}
        crs_assertions["reference-crs-configured-explicitly"] = _single(
            named, "reference-epsg-configured-explicitly")
        crs_assertions["crs-resolver-identified"] = _single(
            named, "crs-resolver-identified")
        crs_assertions["candidate-projection-within-tolerance"] = _single(
            named, "candidate-projection-matches-reference")
        crs_assertions["returned-coordinate-addresses-requested-pixel"] = _single(
            named, "candidate-returned-coordinate-addresses-requested-pixel")
        # This claim must be observed, not assumed: the report records that the
        # original metadata was examined and left untouched.
        crs_assertions["no-metadata-rewritten-or-inferred"] = _single(
            named, "original-metadata-untouched")
    entries["Q-CRS-1"] = _entry(
        "Q-CRS-1", admission=admission_for("q4crs", "Q-CRS-1"), source="reports/q4-crs.json",
        command="measure.py q4-crs --probe-report <probe> --out reports/q4-crs.json",
        environment=environment_note, route=route.get("crs", "native CRS resolution"),
        artifact=route.get("crsArtifact"), fixtures=fixtures,
        assertions=crs_assertions, observations={"reportProblem": q4c_problem})

    # --- lifecycle: cancellation, teardown, failure injection ------------ #
    q5, q5_problem = report_experiment("q5lifecycle")
    cancel_assertions = _all(requirement("Q-CANCEL-1"), UNKNOWN)
    teardown_assertions = _all(requirement("Q-TEARDOWN-1"), UNKNOWN)
    failinj_assertions = _all(requirement("Q-FAILINJ-1"), UNKNOWN)
    cancel_notes: list[str] = []
    if q5 is not None:
        named = {a["name"]: a for a in q5.get("assertions", [])}
        # The current probe slices a resident buffer and counts completed
        # operations, so it cannot establish cancellation of the proposed route.
        cancel_assertions["cancellation-issued-while-work-in-flight"] = UNKNOWN
        cancel_assertions["concurrent-in-flight-work-measured"] = UNKNOWN
        cancel_assertions["unstarted-work-never-scheduled"] = _single(
            named, "cancellation-stops-scheduling")
        cancel_assertions["owned-work-settles-within-bound"] = _single(
            named, "cancellation-settles-in-bound")
        cancel_assertions["uncancelled-control-completes"] = _single(
            named, "lifecycle:uncancelled-control")
        cancel_notes.append(
            "the probe slices a resident in-memory buffer and reports completed "
            "operations, so in-flight work on the proposed route is not measured")

        teardown_assertions["adapter-tolerates-repeated-dispose"] = _single(
            named, "adapter-dispose-idempotent")
        # The probe asserts teardown by flipping a flag, so release is not
        # observed for the candidate route's own resources.
        teardown_assertions["teardown-observably-releases-resource"] = UNKNOWN
        teardown_assertions["stalled-worker-terminated-within-bound"] = _single(
            named, "lifecycle:stalled-worker-termination")
        teardown_assertions["silently-dead-worker-detectable"] = _single(
            named, "lifecycle:dead-worker-detection")

        for assertion_id, source_name in {
            "truncated-header-rejected": "malformed-rejected:truncated-header",
            "corrupt-tile-rejected": "malformed-rejected:corrupt-tile",
            "out-of-extent-window-rejected": "malformed-rejected:out-of-image-window",
            "stalled-worker-forced": "lifecycle:stalled-worker-termination",
        }.items():
            failinj_assertions[assertion_id] = _single(named, source_name)
        failinj_assertions["disk-write-failure-exercised"] = UNKNOWN
    entries["Q-CANCEL-1"] = _entry(
        "Q-CANCEL-1", admission=admission_for("q5lifecycle", "Q-CANCEL-1"), source="reports/q5-lifecycle.json",
        command="measure.py q5-lifecycle --browser-report <probe> --probe-report <probe> --out reports/q5-lifecycle.json",
        environment=environment_note, route=route.get("lifecycle", "cooperative tile-level cancellation"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=cancel_assertions,
        observations={"reportProblem": q5_problem, "notes": cancel_notes})
    entries["Q-TEARDOWN-1"] = _entry(
        "Q-TEARDOWN-1", admission=admission_for("q5lifecycle", "Q-TEARDOWN-1"), source="reports/q5-lifecycle.json",
        command="measure.py q5-lifecycle --probe-report <probe> --out reports/q5-lifecycle.json",
        environment=environment_note, route=route.get("lifecycle", "owned worker teardown"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=teardown_assertions,
        observations={"reportProblem": q5_problem,
                      "unresolved": "release is asserted from a flag, not observed"})
    entries["Q-FAILINJ-1"] = _entry(
        "Q-FAILINJ-1", admission=admission_for("q5lifecycle", "Q-FAILINJ-1"), source="reports/q5-lifecycle.json",
        command="measure.py q5-lifecycle --browser-report <probe> --out reports/q5-lifecycle.json",
        environment=environment_note, route=route.get("lifecycle", "candidate failure handling"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=failinj_assertions,
        observations={"reportProblem": q5_problem})

    # --- Desktop host ---------------------------------------------------- #
    host_requirement = requirement("Q-HOST-1")
    entries["Q-HOST-1"] = _entry(
        "Q-HOST-1", admission=admission_for("host", "Q-HOST-1"), source="no Desktop WebView host report",
        command="not run",
        environment=environment_note,
        route="intended bundled Desktop worker and asset path",
        # The host was not exercised, so no bundled artifact was verified there.
        artifact={"name": "none", "version": "not exercised"}, fixtures=[],
        assertions=_all(host_requirement, UNKNOWN),
        observations={"unresolved": "no Desktop WebView host evidence exists; "
                                    "Chromium evidence cannot satisfy this requirement"},
        host=host)

    # --- resources ------------------------------------------------------- #
    q6, q6_problem = report_experiment("q6resources")
    res_assertions = _all(requirement("Q-RES-1"), UNKNOWN)
    res_notes: list[str] = []
    candidate_memory = None
    # Role is declared on each measurement. Inferring it from the route label let
    # a renamed reference measurement masquerade as candidate evidence.
    all_measurements = [m for m in (q6 or {}).get("measurements", [])
                        if isinstance(m, dict)]
    undeclared = [m for m in all_measurements if m.get("routeRole") not in
                  ("candidate", "reference")]
    candidate_measurements = [
        m for m in all_measurements if m.get("routeRole") == "candidate"]
    reference_measurements = [
        m for m in all_measurements if m.get("routeRole") == "reference"]

    #: How a route label indicates it describes the reference measurement.
    #: Anchored to the whole word: "candidate (wasm ranged transport)" must not be
    #: read as a reference label just because the sentence contrasts with one.
    REFERENCE_LABEL = re.compile(r"\breference\b", re.IGNORECASE)
    CANDIDATE_LABEL = re.compile(r"\bcandidate\b", re.IGNORECASE)

    def role_conflicts(role: str) -> list[dict]:
        """Measurements whose declared role contradicts their own route label.

        Role is authoritative, but a label that names the other role means the
        record disagrees with itself, so it cannot be used to attribute a
        measurement to the candidate route.
        """
        other = REFERENCE_LABEL if role == "candidate" else CANDIDATE_LABEL
        return [m for m in all_measurements
                if m.get("routeRole") == role and other.search(str(m.get("route", "")))]

    candidate_role_conflicts = role_conflicts("candidate")
    if q6 is not None:
        # The budget applies to the route's working memory, so the worst candidate
        # measurement decides it; a later small measurement must not mask a large one.
        candidate_memories = [
            _num(m.get("incrementalPeakRssMiB")) for m in candidate_measurements]
        candidate_memories = [v for v in candidate_memories if v is not None]
        if candidate_memories:
            candidate_memory = max(candidate_memories)
        if candidate_memory is None:
            res_assertions["candidate-memory-within-budget"] = UNKNOWN
            res_assertions["measurement-is-of-candidate-route"] = UNKNOWN
            res_notes.append(
                "no candidate-route memory measurement; reference-reader memory "
                "cannot substitute")
        else:
            res_assertions["measurement-is-of-candidate-route"] = PASS
            res_assertions["candidate-memory-within-budget"] = \
                PASS if candidate_memory <= display["memory_budget_mib"] else FAIL
        # A record that disagrees with itself cannot attribute a measurement to the
        # candidate route, whatever the numbers say.
        if candidate_role_conflicts:
            res_assertions["measurement-is-of-candidate-route"] = FAIL
            res_assertions["candidate-memory-within-budget"] = FAIL
        candidate_entries = [
            m for m in candidate_measurements
            if m not in candidate_role_conflicts
            and _num(m.get("incrementalPeakRssMiB")) is not None]
        if undeclared:
            res_assertions["reference-measurements-labelled-separately"] = UNKNOWN
            res_notes.append(
                f"{len(undeclared)} measurement(s) record no route role, so their "
                f"role in the qualified route cannot be established")
        if candidate_role_conflicts:
            res_assertions["measurement-is-of-candidate-route"] = FAIL
            res_notes.append(
                f"{len(candidate_role_conflicts)} measurement(s) declare the "
                f"candidate route role but describe a reference route")
        elif not reference_measurements:
            # Nothing to separate: the assertion cannot be established from a
            # bundle that records only candidate measurements.
            res_assertions["reference-measurements-labelled-separately"] = UNKNOWN
            res_notes.append("no reference measurement is recorded to separate")
        else:
            res_assertions["reference-measurements-labelled-separately"] = PASS
        # Sampling must be the plan's 100 ms cadence with a usable sample count,
        # measured on the candidate route rather than the reference reader.
        sample_interval = next(
            (_num(m.get("sampleIntervalMs")) for m in candidate_entries
             if _num(m.get("sampleIntervalMs")) is not None), None)
        sample_count = next(
            (_num(m.get("sampleCount")) for m in candidate_entries
             if _num(m.get("sampleCount")) is not None), None)
        if sample_interval is None or sample_count is None:
            res_assertions["sampling-meets-requirement"] = UNKNOWN
            res_notes.append("candidate memory sampling interval or count not recorded")
        else:
            res_assertions["sampling-meets-requirement"] = PASS \
                if sample_interval <= REQUIRED_SAMPLE_INTERVAL_MS and sample_count > 0 else FAIL
            if res_assertions["sampling-meets-requirement"] == FAIL:
                res_notes.append(
                    f"sampling interval {sample_interval} ms with {sample_count} sample(s); "
                    f"required <= {REQUIRED_SAMPLE_INTERVAL_MS} ms and at least one sample")

        # Cache, queue, read and child accounting must all be present.
        counters = ("temporaryDiskHighWaterBytes", "decodedCacheBytes", "activeReads",
                    "queueDepth", "maxConcurrentChildren")
        measured = set()
        for measurement in candidate_entries:
            for counter in counters:
                if _num(measurement.get(counter)) is not None:
                    measured.add(counter)
        missing_counters = [c for c in counters if c not in measured]
        if not candidate_entries:
            res_assertions["disk-cache-reads-queue-and-children-recorded"] = UNKNOWN
        elif missing_counters:
            res_assertions["disk-cache-reads-queue-and-children-recorded"] = UNKNOWN
            res_notes.append(
                "candidate route does not record " + ", ".join(missing_counters))
        else:
            res_assertions["disk-cache-reads-queue-and-children-recorded"] = PASS
    entries["Q-RES-1"] = _entry(
        "Q-RES-1", admission=admission_for("q6resources", "Q-RES-1"), source="reports/q6-resources.json",
        command="measure.py q6-resources --browser-report <probe> --out reports/q6-resources.json",
        environment=environment_note, route=route.get("numeric", "candidate route resources"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=res_assertions,
        observations={"reportProblem": q6_problem, "notes": res_notes,
                      "candidateMemoryMiB": candidate_memory,
                      "budgetMiB": display["memory_budget_mib"]})

    # --- display --------------------------------------------------------- #
    display_requirement = requirement("Q-DISPLAY-1")
    trace_assertions, trace_notes, trace_observed = display_trace_assertions(
        trace, bound_ms=display["ui_thread_bound_ms"],
        cold_runs=display["cold_runs"], warm_runs=display["warm_runs"],
        min_latencies=display["min_latencies_per_run"])
    entries["Q-DISPLAY-1"] = _entry(
        "Q-DISPLAY-1", admission=admission_for("trace", "Q-DISPLAY-1"), source="reports/q6-trace.json",
        command="run_display_trace.mjs --fixture <tif> --out reports/q6-trace.json",
        environment=environment_note, route=route.get("display", "candidate display route"),
        artifact=route.get("displayArtifact"), fixtures=fixtures,
        assertions=trace_assertions,
        observations={"reportProblem": trace_problem, "notes": trace_notes, **trace_observed})

    payload: dict[str, Any] = {
        "generatedAt": time.time(),
        "environment": environment,
        "artifacts": artifacts,
        "route": route,
        "reportDigest": digest,
        "requirements": entries,
    }
    if synthetic:
        payload[gate.SYNTHETIC_MARKER] = True
    return payload


# --------------------------------------------------------------------------- #
# small helpers for reading an existing report's assertion list
# --------------------------------------------------------------------------- #

def _single(named: dict[str, dict], name: str) -> str:
    """Verdict for one report assertion, by exact name."""
    entry = named.get(name)
    if entry is None:
        return UNKNOWN
    return PASS if entry.get("ok") else FAIL


def _all_named(report: dict, names: list[str], prefix: str) -> str:
    """Combined verdict for every report assertion whose name starts with prefix."""
    matched = [a for a in report.get("assertions", [])
               if isinstance(a, dict) and str(a.get("name", "")).startswith(prefix)]
    if not matched:
        return UNKNOWN
    return PASS if all(a.get("ok") for a in matched) else FAIL


def _from_assertions(named: dict[str, dict], prefix: str, default: str | None) -> str:
    matched = [a for name, a in named.items() if name.startswith(prefix)]
    if not matched:
        return UNKNOWN
    return PASS if all(a.get("ok") for a in matched) else FAIL


#: Severity order for combining verdicts on one assertion: fail, then
#: inconclusive, then pass. A gap must not be outranked by a pass.
SEVERITY = {FAIL: 3, UNKNOWN: 2, PASS: 1}


def _worse(first: str, second: str) -> str:
    """Combine two verdicts for one assertion, keeping the more severe."""
    return first if SEVERITY.get(first, 0) >= SEVERITY.get(second, 0) else second


def _source_correspondence(recorded: Any, artifacts: list[dict],
                           unpinned_roles: list[dict] | None = None
                           ) -> tuple[str, list[str]]:
    """Check each role's artifact against the source revision it was built from.

    ``recorded`` is whatever the artifact report states about correspondence. A
    mismatch is a failure whatever else the report claims; a role with no
    correspondence record at all is a gap, because nothing establishes that the
    artifact exercised is the pinned source.
    """
    if not isinstance(recorded, list) or not recorded:
        return UNKNOWN, ["no artifact/source correspondence was recorded"]
    unpinned = {entry.get("name") for entry in (unpinned_roles or [])
                if isinstance(entry, dict)}
    notes: list[str] = []
    for entry in recorded:
        if not isinstance(entry, dict):
            return UNKNOWN, ["a correspondence record is not an object"]
        name = entry.get("artifact")
        if not name:
            return UNKNOWN, ["a correspondence record names no artifact"]
        pinned = entry.get("pinnedRevision")
        observed = entry.get("artifactRevision")
        if name in unpinned:
            continue
        if not pinned or not observed:
            return UNKNOWN, [f"{name} correspondence does not record both revisions"]
        if str(pinned) != str(observed):
            # Recording the mismatch does not satisfy correspondence.
            if not entry.get("buildReproduced"):
                return FAIL, [
                    f"{name} source correspondence conflict: pinned {pinned!r}, "
                    f"artifact built from {observed!r}, and no reproducible build "
                    f"from the pinned revision"]
            notes.append(f"{name}: reproducible build from {pinned!r} recorded")
            continue
        notes.append(f"{name}: artifact revision matches the pinned revision")
    if not notes:
        return UNKNOWN, ["no correspondence record applied to a measured artifact"]
    return PASS, notes


def _from_versions(verified: Any, artifacts: list[dict],
                   unpinned_roles: list[dict] | None = None) -> tuple[str, list[str]]:
    """Check every exercised artifact role against what the bench verified.

    Returns ``(verdict, notes)``. Two kinds of role are legitimate:

    * a pinned candidate artifact, whose exact version must match the verified
      bench entry — a mismatch is a failure;
    * a system tool the plan explicitly allows to be retained (native GDAL for
      preparation, CRS and slope), declared as unpinned with its discovered
      version, which cannot be verified against an npm lock file.

    A role that is neither is a gap: the bundle cannot show that the route used
    an artifact anything verified.
    """
    if not isinstance(verified, list) or not verified:
        return UNKNOWN, ["no verified artifact list was supplied"]
    verified_names = {a.get("name"): a.get("version") for a in verified
                      if isinstance(a, dict)}
    if not artifacts:
        return UNKNOWN, ["the bundle names no exercised artifact"]

    unpinned = {entry.get("name"): entry for entry in (unpinned_roles or [])
                if isinstance(entry, dict) and entry.get("name")}
    notes: list[str] = []
    for artifact in artifacts:
        name = artifact.get("name")
        version = artifact.get("version")
        if not name:
            return UNKNOWN, ["an exercised artifact has no name"]
        if name in unpinned:
            entry = unpinned[name]
            notes.append(
                f"{name} {version}: unpinned system tool retained by the plan "
                f"({entry.get('reason', 'no reason recorded')})")
            continue
        if name not in verified_names:
            return UNKNOWN, [f"{name} is neither bench-verified nor declared unpinned"]
        if not version:
            return UNKNOWN, [f"{name} was exercised without a recorded version"]
        if verified_names[name] != version:
            return FAIL, [
                f"{name} version conflict: expected {verified_names[name]!r} "
                f"(bench-verified), observed {version!r}"]
    return PASS, notes
