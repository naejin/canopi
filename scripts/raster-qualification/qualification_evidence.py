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

import hashlib
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


@dataclass
class SourceDocument:
    """One parsed report, with the facts read from its bytes.

    Keeping these beside the payload rather than inside it means a caller's dict is
    never mutated with evaluator-private keys, so nothing internal can leak into a
    bundle or a report.
    """

    payload: dict[str, Any] | None
    problem: str | None = None
    digest: str | None = None
    duplicate_identity_keys: tuple[str, ...] = ()


def load_source(path: Path | None) -> SourceDocument:
    if path is None:
        return SourceDocument(None, "no report supplied")
    if not path.is_file():
        return SourceDocument(None, f"{path.name} is missing")
    try:
        text = path.read_text()
    except OSError as error:
        return SourceDocument(None, f"{path.name} is unreadable: {error}")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        return SourceDocument(None, f"{path.name} is malformed: {error}")
    if not isinstance(payload, dict):
        return SourceDocument(None, f"{path.name} is not a JSON object")
    # The digest of the bytes read, not of any value the report claims about
    # itself: hashing the parsed payload would be self-referential.
    digest = "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()
    duplicates = tuple(sorted(set(duplicate_keys_in_text(text, "identity"))))
    return SourceDocument(payload, None, digest, duplicates)


def _load(path: Path | None) -> tuple[dict[str, Any] | None, str | None]:
    """Adaptor for callers that only need the payload and any problem."""
    document = load_source(path)
    return document.payload, document.problem


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
# declaration validation
# --------------------------------------------------------------------------- #
#
# A declaration is an input, not a trusted constant: the evaluator owns the
# harness but not the manifest it is handed. It is therefore validated *before*
# any lookup is built from it, so a duplicate or malformed member cannot be
# collapsed by a dict comprehension into whichever entry happened to come last.

#: Declaration defects are evaluator-input failures, never measured engine
#: failures. Every problem string is prefixed with this so a reader can tell the
#: two apart.
DECLARATION_PREFIX = "invalid declaration: "


@dataclass
class DeclarationValidation:
    """The outcome of validating one declaration."""

    name: str
    verdict: str
    #: The validated declaration, usable only when the verdict is pass.
    manifest: dict[str, Any] | None = None
    problems: list[str] = field(default_factory=list)
    #: Per-role required fixture names, resolved through the validated members.
    required_by_role: dict[str, list[str]] = field(default_factory=dict)
    #: name -> validated SHA-256 of every declared member.
    members: dict[str, str] = field(default_factory=dict)

    @property
    def usable(self) -> bool:
        return self.verdict == PASS

    def declared_hashes(self) -> dict[str, str]:
        """The declared fixture identities, readable only from a usable manifest."""
        if not self.usable:
            return {}
        return dict(self.members)

    def required_for(self, role: str | None) -> list[str]:
        if not role:
            return list(self.required_by_role.get("*", []))
        if role in self.required_by_role:
            return list(self.required_by_role[role])
        return list(self.required_by_role.get("*", []))

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "verdict": self.verdict,
            "problems": self.problems,
            "requiredByRole": self.required_by_role,
            "usable": self.usable,
        }


def validate_fixture_manifest_text(text: str, name: str) -> DeclarationValidation:
    """Validate a fixture manifest from its raw text.

    Duplicate JSON object keys are reported while reading: normal decoding keeps
    only the last occurrence, which would silently hide a conflicting entry.
    """
    duplicates = duplicate_keys_in_text(text, "declared")
    duplicates += duplicate_keys_in_text(text, "requiredFixtures")
    if duplicates:
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + "repeats key "
                      + ", ".join(sorted(set(duplicates)))] )
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + f"is malformed: {error}"])
    return validate_fixture_manifest(payload, name)


def validate_fixture_manifest(manifest: Any, name: str) -> DeclarationValidation:
    """Validate a fixture manifest before anything is indexed from it.

    Missing information is inconclusive; malformed structure, malformed values,
    duplicate identities, conflicting members and undeclared references fail.
    """
    if manifest is None:
        return DeclarationValidation(
            name=name, verdict=UNKNOWN,
            problems=["no fixture manifest was supplied, so coverage cannot be "
                      "established"])
    if not isinstance(manifest, dict):
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + "is not a declaration object"])
    if not manifest:
        return DeclarationValidation(
            name=name, verdict=UNKNOWN,
            problems=["the fixture manifest is empty, so coverage cannot be "
                      "established"])
    if "declared" not in manifest:
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + "records no declared fixtures"])

    declared = manifest.get("declared")
    if not isinstance(declared, list):
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + "declared fixtures are not a list"])
    if not declared:
        return DeclarationValidation(
            name=name, verdict=UNKNOWN,
            problems=["fixture manifest declares no fixtures"])

    problems: list[str] = []
    failed = False
    gaps = False
    members: dict[str, str] = {}
    for index, member in enumerate(declared):
        if not isinstance(member, dict):
            failed = True
            problems.append(
                DECLARATION_PREFIX + f"declared member {index} is not an object "
                f"({type(member).__name__})")
            continue
        member_name = member.get("name")
        if not isinstance(member_name, str) or not member_name.strip():
            failed = True
            problems.append(
                DECLARATION_PREFIX + f"declared member {index} has no usable name")
            continue
        digest = member.get("sha256")
        if digest is None:
            # Missing information: the identity is incomplete, not malformed.
            gaps = True
            problems.append(
                f"declared fixture {member_name!r} records no hash, so its identity "
                f"is incomplete")
            members.setdefault(member_name, "")
            continue
        if not _is_sha256(digest):
            failed = True
            problems.append(
                DECLARATION_PREFIX + f"declared fixture {member_name!r} records a "
                f"malformed sha256 {str(digest)[:16]!r}")
            members.setdefault(member_name, "")
            continue
        if member_name in members:
            failed = True
            previous = members[member_name]
            detail = (f"both record {digest}" if previous == digest
                      else f"one records {previous!r}, another records {digest!r}")
            problems.append(
                DECLARATION_PREFIX + f"repeats declared fixture {member_name!r}: "
                + detail)
            continue
        members[member_name] = str(digest)

    required_by_role: dict[str, list[str]] = {}
    roles = manifest.get("requiredFixtures")
    if roles is None:
        required_by_role["*"] = list(members)
    elif not isinstance(roles, dict):
        failed = True
        problems.append(
            DECLARATION_PREFIX + "requiredFixtures is not an object of role lists")
    else:
        for role, required in roles.items():
            if not isinstance(role, str) or not role.strip():
                failed = True
                problems.append(
                    DECLARATION_PREFIX + "requiredFixtures has a role without a name")
                continue
            if not isinstance(required, list):
                failed = True
                problems.append(
                    DECLARATION_PREFIX + f"required fixture list for {role!r} is not "
                    f"a list")
                continue
            if not required:
                # An explicit empty list must not be read as "no raster evidence
                # is required for this role".
                failed = True
                problems.append(
                    DECLARATION_PREFIX + f"required fixture list for {role!r} is "
                    f"empty, which cannot waive that role's raster evidence")
                continue
            resolved: list[str] = []
            for entry in required:
                if not isinstance(entry, str) or not entry.strip():
                    failed = True
                    problems.append(
                        DECLARATION_PREFIX + f"required fixture list for {role!r} "
                        f"contains a non-name entry ({entry!r})")
                    continue
                if entry not in members:
                    failed = True
                    problems.append(
                        DECLARATION_PREFIX + f"required fixture {entry!r} for "
                        f"{role!r} is not declared")
                    continue
                resolved.append(entry)
            required_by_role[role] = resolved
        required_by_role.setdefault("*", list(members))

    if failed:
        verdict = FAIL
    elif gaps:
        verdict = INCONCLUSIVE
    else:
        verdict = PASS
    usable = verdict == PASS
    return DeclarationValidation(
        name=name, verdict=verdict,
        manifest=dict(manifest) if usable else None,
        problems=problems,
        members=dict(members) if usable else {},
        required_by_role={role: list(names)
                          for role, names in required_by_role.items()} if usable else {})


def validate_pin_declaration(pins: Any, name: str) -> DeclarationValidation:
    """Validate declared artifact pins before they are indexed by name.

    The same class of defect the fixture manifest is checked for applies here: a
    mapping that is not a mapping, a pin that is not a digest, or a repeated name
    whose later occurrence would silently overwrite the earlier one. A pin that is
    simply absent is a gap; a pin that is present but unusable is a failure.
    """
    if pins is None:
        return DeclarationValidation(
            name=name, verdict=UNKNOWN,
            problems=[f"no {name} was supplied, so pinned artifact versions cannot "
                      f"be cross-checked"])
    if not isinstance(pins, dict):
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + f"{name} is not an object of pins"])

    problems: list[str] = []
    failed = False
    gaps = False
    members: dict[str, str] = {}
    for pin_name, digest in pins.items():
        if not isinstance(pin_name, str) or not pin_name.strip():
            failed = True
            problems.append(
                DECLARATION_PREFIX + f"{name} has a pin without a name")
            continue
        if digest is None:
            gaps = True
            problems.append(
                f"{name} records no revision for {pin_name!r}, so its pin is "
                f"incomplete")
            continue
        if not isinstance(digest, str) or not digest.strip():
            failed = True
            problems.append(
                DECLARATION_PREFIX + f"{name} records a malformed pin for "
                f"{pin_name!r}: {str(digest)[:16]!r}")
            continue
        members[pin_name] = digest.strip()

    if failed:
        verdict = FAIL
    elif gaps:
        verdict = INCONCLUSIVE
    else:
        verdict = PASS
    return DeclarationValidation(name=name, verdict=verdict, problems=problems,
                                 members=dict(members) if verdict == PASS else {})


def validate_pin_declaration_text(text: str, name: str,
                                  key: str = "pinnedSourceCommits") -> DeclarationValidation:
    """Validate declared pins from raw text, before decoding hides a repeat.

    A repeated pin name is the same defect as a repeated fixture name: normal
    decoding keeps only the last occurrence, so whichever revision was written
    last would silently become the expectation.
    """
    duplicates = duplicate_keys_in_text(text, key)
    if duplicates:
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + "repeats key "
                      + ", ".join(sorted(set(duplicates)))])
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + f"is malformed: {error}"])
    if not isinstance(payload, dict):
        return DeclarationValidation(
            name=name, verdict=FAIL,
            problems=[DECLARATION_PREFIX + "is not a declaration object"])
    return validate_pin_declaration(payload.get(key), name)



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
#:
#: ``digest`` is deliberately absent: the evaluator computes the digest of the
#: bytes it read, so a self-reported digest is a claim to cross-check rather than
#: a field the report must supply.
REQUIRED_IDENTITY_FIELDS = ("id", "experiment", "command", "environment")

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

#: How old a source run may be and still support qualification. Shared with the
#: bundle-level freshness policy so one limit governs both.
MAX_SOURCE_AGE_DAYS = 7.0

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
    #: Digest of the source bytes the evaluator actually read.
    source_digest: str | None = None

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
            "sourceDigest": self.source_digest,
        }


def _duplicate_keys(payload: dict[str, Any], object_key: str) -> list[str]:
    """Keys that appear more than once inside ``payload[object_key]``.

    ``json.loads`` keeps only the last occurrence of a duplicated key, so a report
    carrying two identity blocks would silently present one of them. The parsed
    mapping cannot show this, so the check is made by re-serialising and scanning;
    callers that need byte fidelity use :func:`duplicate_keys_in_text`.
    """
    if not isinstance(payload, dict):
        return []
    return []


def duplicate_keys_in_text(text: str, object_key: str) -> list[str]:
    """Keys that repeat inside the object stored under ``object_key``.

    ``json.loads`` keeps only the last occurrence of a duplicated key, so a report
    carrying two identity blocks would silently present one of them. Parsing with
    a pair-preserving hook keeps every occurrence, and each object is then checked
    for a repeated key among its own entries.
    """
    try:
        root = json.loads(text, object_pairs_hook=lambda pairs: pairs)
    except json.JSONDecodeError:
        return []
    found: list[str] = []

    def repeated_keys(pairs: Any) -> list[str]:
        """Keys appearing more than once among one object's pairs."""
        if not isinstance(pairs, list):
            return []
        counts: dict[str, int] = {}
        for element in pairs:
            if isinstance(element, tuple) and len(element) == 2 \
                    and isinstance(element[0], str):
                counts[element[0]] = counts.get(element[0], 0) + 1
        return [key for key, count in counts.items() if count > 1]

    def visit(node: Any, inside_target: bool) -> None:
        if isinstance(node, list):
            # A pair-preserving object is a list of 2-tuples; a JSON array is a
            # list of arbitrary values. Both are traversed.
            repeated = repeated_keys(node)
            if inside_target:
                found.extend(repeated)
            # A duplicated `object_key` is itself the ambiguity that matters: two
            # identity blocks in one report would otherwise be collapsed to one.
            if object_key in repeated:
                found.append(object_key)
            for element in node:
                if isinstance(element, tuple) and len(element) == 2:
                    key, value = element
                    visit(value, inside_target or key == object_key)
                else:
                    visit(element, inside_target)
        elif isinstance(node, dict):
            for key, value in node.items():
                visit(value, inside_target or key == object_key)
                if inside_target:
                    found.extend(repeated_keys(value))

    visit(root, False)
    return sorted(set(found))


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


@dataclass
class FailureScan:
    """What a report's own failure record establishes.

    ``problems`` carries container malformations. A malformed container is an
    input failure, and it must never be read as an empty list: iterating a string
    would manufacture nonsense failure names out of its characters.
    """

    positive: list[str] = field(default_factory=list)
    controls: list[str] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)


def _split_failures(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Split recorded failures into (positive, negative-control) scopes."""
    scan = _scan_failures(payload)
    return scan.positive, scan.controls


def _scan_failures(payload: dict[str, Any]) -> FailureScan:
    """Read the report's recorded failures, checking the container's shape.

    Only a list of named failures is readable. Anything else is reported as a
    malformed container rather than being coerced into iterable entries.
    """
    recorded = payload.get("failures")
    if recorded is None:
        return FailureScan()
    if not isinstance(recorded, list):
        return FailureScan(problems=[
            f"report failures container is not a list "
            f"({type(recorded).__name__}), so its failures cannot be read"])

    scopes = _negative_control_scopes(payload)
    positive: list[str] = []
    controls: list[str] = []
    problems: list[str] = []
    for index, failure in enumerate(recorded):
        if not isinstance(failure, str) or not failure.strip():
            problems.append(
                f"report failure {index} is not a named failure "
                f"({type(failure).__name__})")
            continue
        if any(failure.startswith(scope) for scope in scopes):
            controls.append(failure)
        else:
            positive.append(failure)
    return FailureScan(positive=positive, controls=controls, problems=problems)


def _failed_assertions(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Assertions the report marked failed, and problems with the container.

    A failed assertion is a failure the report recorded, independent of whatever
    its ``result`` field claims or omits.
    """
    recorded = payload.get("assertions")
    if recorded is None:
        return [], []
    if not isinstance(recorded, list):
        return [], [f"report assertions container is not a list "
                    f"({type(recorded).__name__}), so its assertions cannot be read"]
    failed: list[str] = []
    problems: list[str] = []
    for index, assertion in enumerate(recorded):
        if not isinstance(assertion, dict):
            problems.append(
                f"report assertion {index} is not an object "
                f"({type(assertion).__name__})")
            continue
        name = assertion.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"report assertion {index} has no usable name")
            continue
        if assertion.get("ok") is False:
            failed.append(name)
    return failed, problems


def _texts(report: dict | None, container: str) -> list[str]:
    """A report's recorded text entries, or nothing if the container is unusable.

    Malformation is reported by admission; this reader exists so a downstream scan
    cannot iterate a non-list and raise instead of reporting.
    """
    if not isinstance(report, dict):
        return []
    recorded = report.get(container)
    if not isinstance(recorded, list):
        return []
    return [entry for entry in recorded if isinstance(entry, str)]


def _failure_texts(report: dict | None) -> list[str]:
    """A report's recorded failure texts, taken only from a usable container."""
    return _texts(report, "failures")


def _named_assertions(report: dict | None,
                      container: str = "assertions") -> tuple[dict[str, dict], list[str]]:
    """Index a report's assertions by name, reporting malformed entries.

    A dict comprehension over an unchecked container is what turned a malformed
    ``assertions`` value into an ``IndexError`` or ``TypeError`` deep inside the
    assembler. Every entry is checked here, and the problems are returned rather
    than raised, so a malformed container becomes a reported input failure.
    """
    if not isinstance(report, dict):
        return {}, []
    recorded = report.get(container)
    if recorded is None:
        return {}, []
    if not isinstance(recorded, list):
        return {}, [f"report {container} container is not a list "
                    f"({type(recorded).__name__}), so its entries cannot be read"]
    named: dict[str, dict] = {}
    problems: list[str] = []
    for index, entry in enumerate(recorded):
        if not isinstance(entry, dict):
            problems.append(f"report {container} entry {index} is not an object "
                            f"({type(entry).__name__})")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"report {container} entry {index} has no usable name")
            continue
        named.setdefault(name, entry)
    return named, problems


def admit_report(payload: dict[str, Any] | None, *, report_name: str,
                 expected: dict[str, Any] | None = None,
                 requires_raster_fixture: bool = True,
                 now: float | None = None,
                 document: "SourceDocument | None" = None) -> Admission:
    """Decide whether one raw report may contribute evidence.

    ``expected`` carries the declared values to compare against. Only fields the
    caller actually declares are compared; an undeclared expectation is not a
    licence to skip a check the report itself makes possible.
    """
    if payload is None:
        return Admission(report=report_name, verdict=UNKNOWN,
                         reasons=[f"{report_name} is missing"])

    result = Admission(report=report_name, verdict=PASS,
                       source_digest=(document.digest if document else None))

    # Known failures and gaps are accumulated, never short-circuited: a missing
    # identity block must not erase a failure the report already recorded. The
    # precedence fail > inconclusive > pass is applied once, at the end.
    failed = False
    gaps = False
    #: Comparisons that found a disagreement with the declaration. A conflict is a
    #: failure even when the same report also has gaps.
    conflicts: list[str] = []
    #: Comparisons that could not be made because information is missing.
    blocked: list[str] = []

    # 1. The report's own verdict. A report that failed its own checks cannot
    #    supply a passing observation, however its individual assertions read.
    #    The report's own failures, its failed assertions and its unmet
    #    preconditions are read independently of the result field: a report that
    #    omits or misstates `result` still records what actually happened.
    recorded_result = payload.get("result")
    result_declared = "result" in payload
    scan = _scan_failures(payload)
    positive_failures, control_failures = scan.positive, scan.controls
    result.positive_failures = positive_failures
    result.negative_control_failures = control_failures
    # A malformed container is an input failure. It is reported here rather than
    # being iterated, which would invent failure names from its characters.
    if scan.problems:
        failed = True
        result.reasons.extend(
            f"{report_name}: {problem}" for problem in scan.problems)

    failed_assertions, assertion_problems = _failed_assertions(payload)
    if assertion_problems:
        failed = True
        result.reasons.extend(
            f"{report_name}: {problem}" for problem in assertion_problems)
    _, malformed_named = _named_assertions(payload)
    if malformed_named:
        failed = True
        result.reasons.extend(
            f"{report_name}: {problem}" for problem in malformed_named)

    if not result_declared:
        # The key is absent: a raw producer artifact that never claimed a verdict.
        # It cannot evidence a requirement, but it is not corrupt either.
        gaps = True
        result.reasons.append(
            f"{report_name} declares no result, so it is not a qualification report")
    elif recorded_result is None:
        # Present but explicitly null. That is an unusable declaration, which is a
        # different condition from never having declared one.
        failed = True
        result.reasons.append(
            f"{report_name} declares an unusable result None")
    elif recorded_result not in (PASS, FAIL, INCONCLUSIVE):
        failed = True
        result.reasons.append(
            f"{report_name} declares an unusable result {recorded_result!r}")
    else:
        if recorded_result == FAIL:
            failed = True
            detail = ""
            if positive_failures:
                # Name the report's own failures so a failed precondition is
                # traceable to the report that recorded it.
                detail = " with failures: " + "; ".join(positive_failures[:5])
            result.reasons.append(f"{report_name} reports result=fail{detail}")
        contradictions = _result_contradictions(payload, recorded_result,
                                                positive_failures)
        if contradictions:
            failed = True
            result.reasons.extend(contradictions)
        elif recorded_result == INCONCLUSIVE:
            gaps = True
            result.reasons.append(f"{report_name} reports result=inconclusive")

    # The report's own recorded failures are a failure whatever its result field
    # says, and whatever else is missing from the record. When the report already
    # declared result=fail its failures are named there, so only the declarations
    # that disagree with the failures need a reason of their own.
    if positive_failures:
        failed = True
        if recorded_result != FAIL:
            result.reasons.append(
                f"{report_name} records failures while declaring "
                f"result={recorded_result!r}: "
                + "; ".join(positive_failures[:5]))

    # An assertion the report marked failed, or a precondition it recorded as
    # unmet, is a failure independently of the summary verdict it wrote down. A
    # report that omits `result` still records what actually happened.
    if failed_assertions:
        failed = True
        detail = "; ".join(failed_assertions[:5])
        if recorded_result == FAIL:
            # The result=fail reason already names the report's failures.
            result.reasons.append(
                f"{report_name} also records failed assertion(s): {detail}")
        else:
            result.reasons.append(
                f"{report_name} records {len(failed_assertions)} failed "
                f"assertion(s) while declaring result={recorded_result!r}: {detail}")

    # 2. Preconditions the report names as gating its observations.
    unmet, precondition_problems = _scan_preconditions(payload)
    if unmet:
        failed = True
        result.reasons.extend(
            f"{report_name} precondition not met: {name}" for name in unmet)
    if precondition_problems:
        failed = True
        result.reasons.extend(
            f"{report_name}: {problem}" for problem in precondition_problems)

    # 3. Duplicated identity keys, which dict conversion would collapse.
    for duplicate in (document.duplicate_identity_keys if document else ()):
        failed = True
        result.reasons.append(
            f"{report_name} repeats identity key {duplicate!r}, so the record is "
            f"ambiguous")

    # 4. Source-run provenance: identity of the run, a usable recorded time, and
    #    freshness under the shared policy. A newly assembled bundle does not make
    #    an old source run current.
    identity_payload = payload.get("identity")
    if isinstance(identity_payload, dict) and identity_payload:
        run_id = identity_payload.get("runId")
        if not isinstance(run_id, str) or not run_id.strip():
            gaps = True
            result.reasons.append(
                f"{report_name} identity does not record a nonempty runId")
        recorded_at = identity_payload.get("recordedAt")
        if recorded_at is None:
            gaps = True
            result.reasons.append(
                f"{report_name} identity does not record a usable recordedAt")
        elif isinstance(recorded_at, bool) or not isinstance(recorded_at, (int, float)):
            failed = True
            result.reasons.append(
                f"{report_name} recordedAt is not a number ({recorded_at!r})")
        else:
            seconds = float(recorded_at)
            if math.isnan(seconds) or math.isinf(seconds):
                failed = True
                result.reasons.append(
                    f"{report_name} recordedAt is not a finite time "
                    f"({recorded_at!r})")
            else:
                reference = time.time() if now is None else float(now)
                age_days = (reference - seconds) / 86400.0
                if age_days < 0:
                    failed = True
                    result.reasons.append(
                        f"{report_name} recordedAt is in the future by "
                        f"{-age_days:.2f} day(s)")
                elif age_days > MAX_SOURCE_AGE_DAYS:
                    failed = True
                    result.reasons.append(
                        f"{report_name} source evidence is stale: recorded "
                        f"{age_days:.2f} day(s) ago, limit "
                        f"{MAX_SOURCE_AGE_DAYS} day(s)")
        claimed = identity_payload.get("digest")
        computed = document.digest if document else None
        if claimed and computed and str(claimed) != str(computed):
            failed = True
            result.reasons.append(
                f"{report_name} digest conflict: the report claims {claimed!r} but "
                f"the bytes read hash to {computed!r}")

    identity = payload.get("identity")
    if not isinstance(identity, dict) or not identity:
        # Legacy reports stay readable as incomplete evidence. They are a gap
        # even when they also carry a failure, and the failure still wins.
        result.legacy = True
        gaps = True
        result.reasons.append(
            f"{report_name} carries no identity block, so its route, environment and "
            f"fixture provenance cannot be verified")
    else:
        result.identity = identity

    # 4. Required identity fields.
    if isinstance(identity, dict) and identity:
        missing = [name for name in REQUIRED_IDENTITY_FIELDS if not identity.get(name)]
        if missing:
            gaps = True
            result.reasons.append(
                f"{report_name} identity does not record " + ", ".join(missing))
        identity_expected = True
    else:
        identity_expected = False

    # The sections above only record what they found. Nothing is reduced to a
    # verdict yet: a gap discovered before a comparison must not stop that
    # comparison from running. A wrong hash is still a conflict when the report
    # also omits its runId, its recorded time or its command, and the reviewer must
    # see both. The precedence fail > inconclusive > pass is applied once, at the
    # end, over everything that was collected.

    # 5. The recorded experiment must be the one this report claims to be.
    expected_experiment = (expected or {}).get("experiment")
    if identity_expected and expected_experiment \
            and identity.get("experiment") != expected_experiment:
        failed = True
        result.reasons.append(
            f"{report_name} identity names experiment {identity.get('experiment')!r} "
            f"but {expected_experiment!r} was expected")

    # 6. Declared route/environment/host must agree with the recorded values.
    for identity_key, _expected_key, label in COMPARED_IDENTITY_FIELDS:
        declared = (expected or {}).get(identity_key)
        if declared is None:
            continue
        observed = (identity or {}).get(identity_key)
        if observed is None:
            blocked.append(
                f"{report_name} does not record the {label} it measured, so it cannot "
                f"be matched to the declared {label} ({declared!r})")
        elif str(observed) != str(declared):
            conflicts.append(
                f"{report_name} {label} conflict: expected {declared!r}, "
                f"observed {observed!r}")

    # 7. The artifact each source recorded must be the one declared for its role.
    declared_artifact = (expected or {}).get("artifact")
    observed_artifact = (identity or {}).get("artifact")
    if isinstance(declared_artifact, dict) and declared_artifact:
        if not isinstance(observed_artifact, dict) or not observed_artifact:
            blocked.append(
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
                    blocked.append(
                        f"{report_name} artifact does not record its {key}, so it "
                        f"cannot be matched to the declared {key} "
                        f"({declared_value!r})")
                elif str(observed_value) != str(declared_value):
                    conflicts.append(
                        f"{report_name} artifact {key} conflict: expected "
                        f"{declared_value!r}, observed {observed_value!r}")

    # 8. The transport the source actually used must be the one required.
    #
    # A route string is a label; the transport is what was exercised. Comparing
    # the kind structurally is what stops a renamed route from qualifying an
    # HTTP-only measurement as the required local bridge.
    required_transport = (expected or {}).get("transport")
    observed_transport = (identity or {}).get("transport")
    if required_transport:
        if observed_transport is None:
            blocked.append(
                f"{report_name} does not record which transport it used, so it "
                f"cannot be matched to the required transport {required_transport!r}")
        elif str(observed_transport) != str(required_transport):
            # A real but different capability: insufficient, not a violation.
            blocked.append(
                f"{report_name} measured transport {observed_transport!r} but "
                f"{required_transport!r} is required; the recorded capability is "
                f"real but is not the required route")

    # 9. Fixture identity and hash.
    declared_fixtures = (expected or {}).get("declaredFixtures")
    if not isinstance(declared_fixtures, list) or not declared_fixtures:
        declared_fixtures = None
    # The fixture checks are the last contributor. They already report severity on
    # `result`, so their verdict is folded back into the accumulator here rather
    # than left on a field that nothing reads after the reduction below.
    fixture_verdict_before = result.verdict
    fixture_problems = _fixture_problems(
        identity, payload, report_name,
        requires_raster_fixture=requires_raster_fixture,
        expected=declared_fixtures,
        verdict=result,
        fixture_declaration=(expected or {}).get("fixtureDeclaration"),
        fixture_role=(expected or {}).get("fixtureRole"))
    result.reasons.extend(fixture_problems)
    if result.verdict == FAIL and fixture_verdict_before != FAIL:
        failed = True
    elif result.verdict == UNKNOWN and fixture_verdict_before == PASS:
        blocked.extend(fixture_problems)

    # Reduce once, over everything every section collected. A conflict outranks a
    # gap: a hash that disagrees is a failure even when the same report is also
    # missing its runId, its recorded time or its command.
    result.reasons.extend(conflicts)
    result.reasons.extend(blocked)
    if conflicts:
        failed = True
    if failed:
        result.verdict = FAIL
    elif gaps or blocked or not identity_expected:
        result.verdict = UNKNOWN
    else:
        result.verdict = PASS
    result.reasons = _dedupe(result.reasons)
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


def _scan_preconditions(payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Preconditions the report marks as not met, and container malformations.

    A malformed container is reported rather than read as "no unmet
    preconditions": a record whose preconditions cannot be parsed has not
    established that they held.
    """
    recorded = payload.get("preconditions")
    if recorded is None:
        return [], []
    if not isinstance(recorded, list):
        return [], [f"report preconditions container is not a list "
                    f"({type(recorded).__name__}), so they cannot be read"]
    unmet: list[str] = []
    problems: list[str] = []
    for index, entry in enumerate(recorded):
        if not isinstance(entry, dict):
            problems.append(f"report precondition {index} is not an object "
                            f"({type(entry).__name__})")
            continue
        name = entry.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"report precondition {index} has no usable name")
            continue
        if entry.get("met") is False:
            unmet.append(name)
    return unmet, problems


def _unmet_preconditions(payload: dict[str, Any]) -> list[str]:
    """Preconditions the report marks as not met, by name."""
    return _scan_preconditions(payload)[0]


def _fixture_problems(identity: dict[str, Any], payload: dict[str, Any],
                      report_name: str, *, requires_raster_fixture: bool,
                      expected: list[dict] | None,
                      verdict: "Admission",
                      fixture_declaration: "DeclarationValidation | None" = None,
                      fixture_role: str | None = None) -> list[str]:
    """Fixture-policy, identity and hash checks for one report."""
    problems: list[str] = []
    # A report with no identity block now reaches these checks instead of being
    # skipped by an early return, so an absent block is a gap, not a crash.
    identity = identity if isinstance(identity, dict) else {}
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

    if policy != "measured" or not isinstance(fixtures, list):
        return problems

    # A fixture identity must carry a well-formed hash; the shape of the identity
    # is part of the evidence, not a formatting detail.
    seen: dict[str, int] = {}
    for fixture in fixtures:
        if not isinstance(fixture, dict):
            continue
        name = fixture.get("name")
        digest = fixture.get("sha256")
        if digest and not _is_sha256(digest):
            problems.append(
                f"{report_name} fixture {name!r} records a malformed sha256 "
                f"{str(digest)[:16]!r}")
            if verdict.verdict != FAIL:
                verdict.verdict = UNKNOWN
        if isinstance(name, str):
            seen[name] = seen.get(name, 0) + 1
    duplicated = sorted(name for name, count in seen.items() if count > 1)
    if duplicated:
        # Duplicates must be rejected, not collapsed: a dict would silently keep
        # whichever occurrence came last.
        problems.append(
            f"{report_name} records duplicate fixture identities: "
            + ", ".join(duplicated))
        verdict.verdict = FAIL

    problems.extend(_fixture_coverage(
        fixtures, report_name,
        declaration=(fixture_declaration
                     if isinstance(fixture_declaration, DeclarationValidation)
                     else validate_fixture_manifest(None, "fixture manifest")),
        role=fixture_role, verdict=verdict))
    return problems


def _fixture_coverage(fixtures: list[Any], report_name: str, *,
                      declaration: DeclarationValidation, role: str | None,
                      verdict: "Admission") -> list[str]:
    """Compare observed fixtures with the set the role is required to cover.

    The required set comes from the validated declaration, never from whichever
    fixtures the report happened to observe. The observed set may be a declared
    subset, but an undeclared extra fixture is a conflict and a missing required
    fixture is a gap.
    """
    problems: list[str] = []
    observed = [f for f in fixtures if isinstance(f, dict) and f.get("name")]
    observed_names = {str(f["name"]) for f in observed}

    if not declaration.usable:
        # A declaration that is missing, incomplete or malformed is an evaluator
        # input failure. It is reported as such, and it never quietly reduces the
        # required set to nothing.
        problems.extend(declaration.problems)
        if declaration.verdict == FAIL:
            verdict.verdict = FAIL
        elif verdict.verdict != FAIL:
            verdict.verdict = UNKNOWN
        return problems

    declared_hashes = {name: digest
                       for name, digest in declaration.declared_hashes().items()}
    required = declaration.required_for(role)

    missing = [name for name in required if name not in observed_names]
    if missing:
        problems.append(
            f"{report_name} does not cover required fixture(s): " + ", ".join(missing))
        if verdict.verdict != FAIL:
            verdict.verdict = UNKNOWN

    # An observed fixture outside the declared manifest is a conflict, not a
    # harmless extra.
    for name in sorted(observed_names - set(declared_hashes)):
        problems.append(
            f"{report_name} measures undeclared fixture {name!r}, which is not in "
            f"the declared fixture manifest")
        verdict.verdict = FAIL

    for fixture in observed:
        name = str(fixture["name"])
        declared_hash = declared_hashes.get(name)
        observed_hash = fixture.get("sha256")
        if declared_hash and observed_hash and observed_hash != declared_hash:
            problems.append(
                f"{report_name} fixture {name!r} hash conflict: expected "
                f"{declared_hash!r}, observed {observed_hash!r}")
            verdict.verdict = FAIL
    return problems


def _is_sha256(value: Any) -> bool:
    """Whether a value is a well-formed lowercase or uppercase SHA-256 hex digest."""
    if not isinstance(value, str) or len(value) != 64:
        return False
    return all(character in "0123456789abcdefABCDEF" for character in value)


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
            "sourceDigest": admission.source_digest,
            "reportedDigest": identity.get("digest"),
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


def _combine_admissions(admits: list["Admission"], report_names: list[str]) -> "Admission":
    """One admission representing several sources feeding one requirement.

    A requirement that draws on more than one report cannot be admitted on the
    strength of the passing ones alone: a failure in any contributing source must
    reach it, and reasons from every source are retained.
    """
    live = [a for a in admits if a is not None]
    if not live:
        return Admission(report=", ".join(report_names), verdict=UNKNOWN,
                         reasons=["no contributing source was available"])
    order = {FAIL: 3, UNKNOWN: 2, PASS: 1}
    worst = max(live, key=lambda a: order.get(a.verdict, 0))
    reasons: list[str] = []
    for admission in live:
        for reason in admission.reasons:
            if reason not in reasons:
                reasons.append(reason)
    return Admission(
        report=", ".join(report_names), verdict=worst.verdict, reasons=reasons,
        identity=worst.identity,
        positive_failures=[f for a in live for f in a.positive_failures],
        negative_control_failures=[f for a in live for f in a.negative_control_failures],
        legacy=all(a.legacy for a in live))


def assemble(contract: gate.Contract, *, out: Path, reports: dict[str, Path],
             environment: dict[str, Any], route: dict[str, Any],
             artifacts: list[dict], fixtures: list[dict],
             display: dict[str, Any], host: str,
             fixture_manifest: Any = None,
             declared_artifact_pins: Any = None,
             now: float | None = None,
             synthetic: bool = False) -> dict[str, Any]:
    """Assemble a gate bundle from the reports named in ``reports``.

    Anything a report does not establish is left ``inconclusive``; this function
    never promotes absence into a pass, and it never relabels reference-only or
    wrong-host measurements as candidate evidence.

    ``fixture_manifest`` and ``declared_artifact_pins`` accept either a raw
    declaration or an already-computed ``DeclarationValidation``. Raw declarations
    are validated here through the same functions the CLI uses, so no caller can
    reach a comparison built from an unvalidated declaration.
    """
    ledger, ledger_problem = _load(reports.get("ledger"))
    browser, browser_problem = _load(reports.get("browser"))
    trace, trace_problem = _load(reports.get("trace"))
    verdicts = {r["experiment"]: r for r in ([])}

    # Declarations are inputs too. They are validated once, here, before anything
    # is indexed from them: a dict or set built from an unvalidated declaration
    # would let a duplicate or malformed entry decide the outcome silently. The
    # validated objects are what every downstream comparison reads.
    #
    # A caller that already validated the declaration may hand the verdict in, so
    # the CLI and the programmatic entry point run the identical path and a
    # rejection keeps its own verdict instead of being reshaped into "absent".
    fixture_declaration = (
        fixture_manifest if isinstance(fixture_manifest, DeclarationValidation)
        else validate_fixture_manifest(fixture_manifest, "fixture manifest"))
    pin_declaration = (
        declared_artifact_pins
        if isinstance(declared_artifact_pins, DeclarationValidation)
        else validate_pin_declaration(declared_artifact_pins,
                                      "declared artifact pins"))
    validated_pins = pin_declaration.declared_hashes() if pin_declaration.usable \
        else None

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
    documents: dict[str, SourceDocument] = {}
    for name, path in sorted(reports.items()):
        document = load_source(path)
        documents[name] = document
        loaded[name] = document.payload
        if document.payload is None:
            digest.append(f"{name}: {document.problem}")
            continue
        digest.append(f"{name}: {document.payload.get('experiment')} -> "
                      f"{document.payload.get('result')}")

    # One admission per source, computed once so every entry that draws on a
    # report shares the same verdict and the same reasons.
    admissions: dict[str, Admission] = {}
    #: The artifacts each report role is required to cover, from the declaration.
    required_artifacts_by_role: dict[str, list[dict]] = {}

    #: Which declared artifact each report role is expected to have used.
    artifact_role_by_source = {
        "q1": None, "q3prepare": "prepareArtifact", "q3members": None,
        "q4slope": "slopeArtifact", "q4crs": "crsArtifact",
        "q5lifecycle": "numericArtifact", "q6resources": "numericArtifact",
        "trace": "displayArtifact", "q2": "numericArtifact",
    }

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
        expectation.setdefault("declaredFixtures", fixtures)
        # The declared manifest names the fixtures each role must cover. Coverage
        # comes from that declaration, never from whichever fixtures a report
        # happened to observe.
        expectation.setdefault("fixtureDeclaration", fixture_declaration)
        expectation.setdefault("fixtureRole", role)
        # The pins come from the declaration. A pin the report asserts about itself
        # is not an independent expectation.
        expectation.setdefault("declaredPins", validated_pins)
        # Which artifact a source is expected to have used follows the *source*,
        # not the requirement: a numeric report admitted on behalf of a
        # multi-source requirement still used the numeric artifact.
        artifact_key = artifact_role_for.get(requirement_id)
        if requirement_id == "Q-VALUE-1":
            artifact_key = None
        role_artifact_key = artifact_role_by_source.get(role)
        if role_artifact_key is None:
            role_artifact_key = artifact_key
        if role_artifact_key and route.get(role_artifact_key):
            expectation.setdefault("artifact", route.get(role_artifact_key))

        # The required measured artifacts come from the declaration: the pins the
        # route names, minus the roles the plan explicitly leaves unpinned. The
        # artifact report covers every pinned candidate artifact the route uses.
        pinned_artifacts = [
            {"name": artifact.get("name"), "version": artifact.get("version")}
            for artifact in artifacts
            if isinstance(artifact, dict) and artifact.get("name")
            and artifact.get("name") not in {
                entry.get("name") for entry in (route.get("unpinnedRoles") or [])
                if isinstance(entry, dict)}
        ]
        if role == "q1":
            required = pinned_artifacts
        else:
            expected_artifact = expectation.get("artifact")
            required = ([{"name": expected_artifact.get("name"),
                          "version": expected_artifact.get("version")}]
                        if isinstance(expected_artifact, dict)
                        and expected_artifact.get("name") else [])
        expectation.setdefault("requiredArtifacts", required)
        required_artifacts_by_role[role] = required
        transport_key = transport_role_for.get(requirement_id)
        if transport_key and route.get(transport_key) is not None:
            expectation.setdefault("transport", route.get(transport_key))
        result = admit_report(
            loaded.get(role), report_name=str(reports.get(role) or role),
            expected=expectation, requires_raster_fixture=needs_raster, now=now,
            document=documents.get(role))
        admissions[key] = result
        return result

    # --- artifacts ------------------------------------------------------- #
    q1, q1_problem = report_experiment("q1")
    art_assertions = _all(requirement("Q-ART-1"), UNKNOWN)
    art_notes: list[str] = []
    if q1 is not None:
        recorded, _ = _named_assertions(q1)
        art_assertions["artifacts-present-at-declared-version"] = _from_assertions(
            recorded, "version:", None)
        art_assertions["artifacts-match-integrity-digest"] = _from_assertions(
            recorded, "integrity:", None)
        art_assertions["artifacts-record-license"] = _from_assertions(
            recorded, "license-recorded:", None)
        art_assertions["non-corresponding-artifacts-recorded"] = PASS \
            if any("no published artifact matches" in n
                   for n in _texts(q1, "notes")) else FAIL
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
        admission_for("q1", "Q-ART-1")
        correspondence_verdict, correspondence_notes = _source_correspondence(
            q1.get("sourceCorrespondence"),
            required=required_artifacts_by_role.get("q1") or route.get("requiredArtifacts"),
            unpinned_roles=route.get("unpinnedRoles"),
            declared_pins=validated_pins)
        art_assertions["qualified-roles-name-artifact-version"] = _worse(
            version_verdict, correspondence_verdict)
        art_notes.extend(version_notes)
        art_notes.extend(correspondence_notes)
        art_required_names = sorted(
            str(a.get("name")) for a in (required_artifacts_by_role.get("q1") or []))
        art_unpinned_names = sorted(
            str(entry.get("name")) for entry in (route.get("unpinnedRoles") or [])
            if isinstance(entry, dict) and entry.get("name"))
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
                      "unpinnedRoleNames": art_unpinned_names,
                      "requiredArtifactNames": art_required_names,
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
        names = list(_named_assertions(q2)[0])
        q2_assertions["no-single-request-returns-whole-artifact"] = _all_named(
            q2, [], "no-whole-file-request")
        q2_assertions["values-match-independent-reference"] = _all_named(
            q2, names, "analytic:")
        q2_assertions["validity-matches-reference-exactly"] = _all_named(
            q2, names, "validity:")
        q2_assertions["window-size-within-contract-limit"] = PASS \
            if not any("exceeds the" in f for f in _failure_texts(q2)) else FAIL
        q2_obs = {"testedWindows": tested, "serverLedger": ledger_observed,
                  "failures": _failure_texts(q2)}
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
        named, _ = _named_assertions(q3p)
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
        named, _ = _named_assertions(q3m)
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
        named, _ = _named_assertions(q4)
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
            _named_assertions(q2)[0], "analytic:")
    # Q-VALUE-1 draws on the numeric report for its value and validity assertions
    # and on the slope report for the rest, so both sources must be admitted.
    value_admission = _combine_admissions(
        [admission_for("q2", "Q-VALUE-1", ) if q2 is not None else None,
         admission_for("q4slope", "Q-VALUE-1")],
        [str(reports.get("q2") or "q2"), str(reports.get("q4slope") or "q4slope")])
    entries["Q-VALUE-1"] = _entry(
        "Q-VALUE-1", admission=value_admission, source="reports/q4-slope.json",
        command="measure.py q4-slope --fixtures <fx> --out reports/q4-slope.json",
        environment=environment_note, route=route.get("slope", "blocked Horn slope"),
        artifact=route.get("slopeArtifact"), fixtures=fixtures,
        assertions=value_assertions,
        observations={"reportProblem": q4_problem or q4_problem})

    # --- CRS ------------------------------------------------------------- #
    q4c, q4c_problem = report_experiment("q4crs")
    crs_assertions = _all(requirement("Q-CRS-1"), UNKNOWN)
    if q4c is not None:
        named, _ = _named_assertions(q4c)
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
        named, _ = _named_assertions(q5)
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
        # Stamped with the same evaluation time used for source freshness, so one
        # consistent clock governs assembly, admission and the gate. This records
        # when the bundle was built; it never refreshes a source run's own age.
        "generatedAt": time.time() if now is None else float(now),
        "environment": environment,
        "artifacts": artifacts,
        "route": route,
        "reportDigest": digest,
        # Declaration validation is recorded even when no report is admitted: an
        # invalid declaration is an evaluator-input failure, and the reviewer must
        # be able to see which declaration was rejected and why.
        "declarations": {
            "fixtureManifest": fixture_declaration.as_dict(),
            "declaredPins": pin_declaration.as_dict(),
        },
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
    matched = [a for a in _named_assertions(report)[0].values()
               if str(a.get("name", "")).startswith(prefix)]
    if not matched:
        return UNKNOWN
    return PASS if all(a.get("ok") for a in matched) else FAIL


def _from_assertions(named: dict[str, dict], prefix: str, default: str | None) -> str:
    matched = [a for name, a in named.items() if name.startswith(prefix)]
    if not matched:
        return UNKNOWN
    return PASS if all(a.get("ok") for a in matched) else FAIL


def _dedupe(items: list[str]) -> list[str]:
    """Keep the first occurrence of each reason, preserving collection order."""
    seen: set[str] = set()
    unique: list[str] = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        unique.append(item)
    return unique


#: Severity order for combining verdicts on one assertion: fail, then
#: inconclusive, then pass. A gap must not be outranked by a pass.
SEVERITY = {FAIL: 3, UNKNOWN: 2, PASS: 1}


def _worse(first: str, second: str) -> str:
    """Combine two verdicts for one assertion, keeping the more severe."""
    return first if SEVERITY.get(first, 0) >= SEVERITY.get(second, 0) else second


def _source_correspondence(recorded: Any, required: list[dict] | None = None,
                           unpinned_roles: list[dict] | None = None,
                           declared_pins: dict[str, str] | None = None
                           ) -> tuple[str, list[str]]:
    """Check every required measured artifact against its declared source pin.

    Coverage is over the *required* artifacts, not over whichever correspondence
    records happen to be present: an unrelated record cannot satisfy a required
    artifact, and the expected pin comes from the declaration rather than from the
    record being checked.
    """
    unpinned = {entry.get("name") for entry in (unpinned_roles or [])
                if isinstance(entry, dict)}
    required = [a for a in (required or [])
                if isinstance(a, dict) and a.get("name")
                and a.get("name") not in unpinned]
    if not required:
        return UNKNOWN, [
            "no required measured artifact was declared, so correspondence cannot "
            "be established"]
    if not isinstance(declared_pins, dict) or not declared_pins:
        return UNKNOWN, [
            "no declared source pin was supplied, so correspondence has nothing to "
            "compare against"]
    if not isinstance(recorded, list) or not recorded:
        return UNKNOWN, ["no artifact/source correspondence was recorded"]

    # Duplicate records for one artifact/version are ambiguous, so they fail
    # rather than letting a later record win.
    counts: dict[tuple[str, str], int] = {}
    by_key: dict[tuple[str, str], dict] = {}
    for entry in recorded:
        if not isinstance(entry, dict):
            return UNKNOWN, ["a correspondence record is not an object"]
        name = entry.get("artifact")
        if not name:
            return UNKNOWN, ["a correspondence record names no artifact"]
        key = (str(name), str(entry.get("version")))
        counts[key] = counts.get(key, 0) + 1
        by_key.setdefault(key, entry)
    duplicated = sorted(f"{name}@{version}" for (name, version), count in counts.items()
                        if count > 1)
    if duplicated:
        return FAIL, ["duplicate artifact/source correspondence records: "
                      + ", ".join(duplicated)]

    notes: list[str] = []
    problems: list[str] = []
    failed = False
    for artifact in required:
        name = str(artifact["name"])
        version = artifact.get("version")
        declared_pin = declared_pins.get(name)
        if not declared_pin:
            problems.append(
                f"{name}: the declaration records no source pin, so correspondence "
                f"cannot be established")
            continue
        entry = by_key.get((name, str(version)))
        if entry is None:
            problems.append(
                f"{name}@{version}: no correspondence record for this required artifact")
            continue
        pinned = entry.get("pinnedRevision")
        built_from = entry.get("artifactRevision")
        if not pinned or not built_from:
            problems.append(
                f"{name}@{version}: correspondence does not record both revisions")
            continue
        if str(pinned) != str(declared_pin):
            # A report cannot establish its own expectation.
            failed = True
            problems.append(
                f"{name}@{version}: correspondence claims pin {pinned!r} but the "
                f"declaration records {declared_pin!r}")
            continue
        if str(built_from) == str(declared_pin):
            notes.append(f"{name}@{version}: artifact revision matches the declared pin")
            continue
        # A revision mismatch must be excused by real build evidence tied to the
        # measured artifact, never by a boolean alone.
        evidence_problems = _build_evidence_problems(name, version, entry, declared_pin)
        if evidence_problems:
            failed = True
            problems.extend(evidence_problems)
        else:
            notes.append(
                f"{name}@{version}: reproducible build from {declared_pin!r} recorded "
                f"with artifact, source and build evidence")

    if failed:
        return FAIL, problems
    if problems:
        return UNKNOWN, problems
    return PASS, notes


def _build_evidence_problems(name: str, version: Any, entry: dict[str, Any],
                             declared_pin: str) -> list[str]:
    """Reasons a revision mismatch is not excused by the supplied build evidence."""
    problems: list[str] = []
    observed_revision = entry.get("artifactRevision")
    built = entry.get("builtArtifact")
    if not isinstance(built, dict) or not built.get("name"):
        problems.append(
            f"{name}@{version}: revision mismatch (declared pin {declared_pin!r}, "
            f"artifact built from {observed_revision!r}) with no built-artifact "
            f"identity")
    else:
        if str(built.get("name")) != name:
            problems.append(
                f"{name}@{version}: build evidence names artifact "
                f"{built.get('name')!r}")
        if str(built.get("version")) != str(version):
            problems.append(
                f"{name}@{version}: build evidence names version "
                f"{built.get('version')!r}")
        digest = built.get("sha256")
        if not digest or not _is_sha256(digest):
            problems.append(
                f"{name}@{version}: build evidence records no usable artifact digest")
    if str(entry.get("sourceRevision")) != str(declared_pin):
        problems.append(
            f"{name}@{version}: build evidence records source revision "
            f"{entry.get('sourceRevision')!r}, not the declared pin {declared_pin!r}")
    evidence = entry.get("buildEvidence")
    if not isinstance(evidence, dict) or not evidence:
        problems.append(
            f"{name}@{version}: revision mismatch with only a build-evidence flag "
            f"and no recorded build evidence")
    else:
        if not evidence.get("command"):
            problems.append(f"{name}@{version}: build evidence records no command")
        if not evidence.get("sha256") or not _is_sha256(str(evidence.get("sha256"))):
            problems.append(
                f"{name}@{version}: build evidence records no usable digest")
    if not entry.get("buildReproduced"):
        problems.append(f"{name}@{version}: build was not reported as reproduced")
    return problems


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
