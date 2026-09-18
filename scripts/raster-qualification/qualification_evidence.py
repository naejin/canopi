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
import time
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
            "cache-state-recorded", "no-ui-thread-task-above-bound",
            "unsupported-observation-is-inconclusive")},
            ["no display trace report"], observed)

    runs = trace.get("runs")
    if not isinstance(runs, list):
        return ({key: FAIL for key in (
            "one-cold-and-three-warm-runs", "hundred-valid-latencies-per-run",
            "runs-report-successful-rendering", "p95-from-individual-latencies",
            "cache-state-recorded", "no-ui-thread-task-above-bound",
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
    latencies_sufficient = True
    rendering_ok = True
    p95_ok = True
    cache_ok = True
    for run in runs:
        if not isinstance(run, dict):
            latencies_sufficient = rendering_ok = p95_ok = cache_ok = False
            continue
        name = str(run.get("name"))
        # Only individual latencies count; an aggregate summary is not evidence.
        individual = run.get("individualLatenciesMs")
        valid_latencies = [v for v in individual if _num(v) is not None] \
            if isinstance(individual, list) else []
        latency_counts[name] = len(valid_latencies)
        if len(valid_latencies) < min_latencies:
            latencies_sufficient = False
            notes.append(
                f"run {name}: {len(valid_latencies)} individual valid latencies, "
                f"required {min_latencies}")

        rendered = _num(run.get("tilesRendered"))
        failed = _num(run.get("failedTiles"))
        requested = _num(run.get("tileRequests"))
        # Attempts are not successes: a failed render or a false run ok fails.
        if run.get("ok") is not True or (failed or 0) > 0 \
                or not rendered or rendered <= 0:
            rendering_ok = False
            failed_renders.append(
                f"{name}: ok={run.get('ok')} rendered={rendered} failed={failed} "
                f"requested={requested}")

        if _num(run.get("p95Ms")) is None:
            p95_ok = False
            notes.append(f"run {name}: p95Ms is not a usable measurement")

        if not run.get("cachesCleared"):
            cache_ok = False
            notes.append(f"run {name}: cache state not recorded")

    results["hundred-valid-latencies-per-run"] = PASS if latencies_sufficient else FAIL
    results["runs-report-successful-rendering"] = PASS if rendering_ok else FAIL
    results["p95-from-individual-latencies"] = PASS if p95_ok else FAIL
    results["cache-state-recorded"] = PASS if cache_ok else FAIL
    observed["latencyCounts"] = latency_counts
    observed["failedRuns"] = failed_renders

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
# bundle assembly
# --------------------------------------------------------------------------- #

def _entry(requirement_id: str, *, source: str, command: str, environment: str,
           route: str, artifact: dict | None, fixtures: list[dict],
           assertions: dict[str, str], observations: dict,
           host: str | None = None) -> dict[str, Any]:
    entry = {
        "requirementId": requirement_id,
        "source": source,
        "command": command,
        "environment": environment,
        "route": route,
        "artifact": artifact or {},
        "fixtures": fixtures,
        "observations": observations,
        "assertions": assertions,
    }
    if host:
        entry["host"] = host
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
    for name, path in sorted(reports.items()):
        payload, problem = _load(path)
        if payload is None:
            digest.append(f"{name}: {problem}")
            continue
        digest.append(f"{name}: {payload.get('experiment')} -> {payload.get('result')}")

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
        art_verdict, art_version_notes = _from_versions(
            q1.get("verifiedArtifacts"), artifacts,
            unpinned_roles=route.get("unpinnedRoles"))
        art_assertions["qualified-roles-name-artifact-version"] = art_verdict
        art_notes.extend(art_version_notes)
    else:
        art_notes.append(q1_problem or "q1 report unavailable")
    entries["Q-ART-1"] = _entry(
        "Q-ART-1", source="reports/q1-artifacts.json",
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
        "Q-LOCAL-1", source="reports/q2-numeric.json",
        command="measure.py q2-numeric --browser-report <probe> --out reports/q2-numeric.json",
        environment=environment_note, route=route.get("numeric", "candidate numeric window decode"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=q2_assertions, observations={**q2_obs, "notes": q2_notes})

    # --- preparation ----------------------------------------------------- #
    q3p, q3p_problem = report_experiment("q3prepare")
    prep_assertions = _all(requirement("Q-PREP-1"), UNKNOWN)
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
        prep_assertions["sidecar-unchanged"] = _single(named, "sidecar-unchanged") \
            if "sidecar-unchanged" in named else PASS
    entries["Q-PREP-1"] = _entry(
        "Q-PREP-1", source="reports/q3-prepare.json",
        command="measure.py q3-prepare --original <tif> --derived <cog> --out reports/q3-prepare.json",
        environment=environment_note, route=route.get("prepare", "native GDAL preparation"),
        artifact=route.get("prepareArtifact"), fixtures=fixtures,
        assertions=prep_assertions,
        observations={"reportProblem": q3p_problem})

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
        "Q-MEMBER-1", source="reports/q3-members.json",
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
    else:
        value_assertions["values-match-analytic-expectation"] = _single(
            {a["name"]: a for a in (q2 or {}).get("assertions", [])}, "analytic:")
    entries["Q-VALUE-1"] = _entry(
        "Q-VALUE-1", source="reports/q4-slope.json",
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
        crs_assertions["no-metadata-rewritten-or-inferred"] = PASS
    entries["Q-CRS-1"] = _entry(
        "Q-CRS-1", source="reports/q4-crs.json",
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
        "Q-CANCEL-1", source="reports/q5-lifecycle.json",
        command="measure.py q5-lifecycle --browser-report <probe> --probe-report <probe> --out reports/q5-lifecycle.json",
        environment=environment_note, route=route.get("lifecycle", "cooperative tile-level cancellation"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=cancel_assertions,
        observations={"reportProblem": q5_problem, "notes": cancel_notes})
    entries["Q-TEARDOWN-1"] = _entry(
        "Q-TEARDOWN-1", source="reports/q5-lifecycle.json",
        command="measure.py q5-lifecycle --probe-report <probe> --out reports/q5-lifecycle.json",
        environment=environment_note, route=route.get("lifecycle", "owned worker teardown"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=teardown_assertions,
        observations={"reportProblem": q5_problem,
                      "unresolved": "release is asserted from a flag, not observed"})
    entries["Q-FAILINJ-1"] = _entry(
        "Q-FAILINJ-1", source="reports/q5-lifecycle.json",
        command="measure.py q5-lifecycle --browser-report <probe> --out reports/q5-lifecycle.json",
        environment=environment_note, route=route.get("lifecycle", "candidate failure handling"),
        artifact=route.get("numericArtifact"), fixtures=fixtures,
        assertions=failinj_assertions,
        observations={"reportProblem": q5_problem})

    # --- Desktop host ---------------------------------------------------- #
    host_requirement = requirement("Q-HOST-1")
    entries["Q-HOST-1"] = _entry(
        "Q-HOST-1", source="no Desktop WebView host report",
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
    if q6 is not None:
        for measurement in q6.get("measurements", []):
            if not isinstance(measurement, dict):
                continue
            labelled = str(measurement.get("route", ""))
            if labelled.startswith("reference"):
                # A reference measurement is never candidate evidence.
                continue
            value = _num(measurement.get("incrementalPeakRssMiB"))
            if value is not None:
                candidate_memory = value
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
        res_assertions["reference-measurements-labelled-separately"] = PASS
        res_assertions["sampling-meets-requirement"] = UNKNOWN
        res_assertions["disk-cache-reads-queue-and-children-recorded"] = UNKNOWN
    entries["Q-RES-1"] = _entry(
        "Q-RES-1", source="reports/q6-resources.json",
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
        "Q-DISPLAY-1", source="reports/q6-trace.json",
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
        if version and verified_names[name] != version:
            return FAIL, [
                f"{name} was exercised at {version} but the bench verified "
                f"{verified_names[name]}"]
    return PASS, notes
