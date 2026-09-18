#!/usr/bin/env python3
"""Qualification gate: requirement contract, evidence bundle and eligibility verdicts.

This module is the gate. It answers a different question from the probes:

* a probe records what a candidate did;
* this module decides whether what was recorded is **sufficient evidence** for the
  requirements the accepted plan imposes on qualification slice Q.

Three conclusions are kept distinct, because collapsing them is how an incomplete
qualification passes as complete:

1. an assertion or negative control executed as expected;
2. a candidate capability was demonstrated for a stated route, fixture and
   environment;
3. every mandatory Q requirement is supported by adequate evidence.

The requirement contract is loaded from :file:`requirements.json`, never inferred
from whatever the probes happened to measure. A requirement that has no evidence
is inconclusive; it cannot be waived by a limitation string, and a passing
negative control never satisfies a positive capability requirement.

Evidence bundle shape
---------------------

A bundle is a JSON object. Each required requirement id maps to an entry::

    {
      "requirementId": "Q-DISPLAY-1",
      "source": "reports/q6-trace.json",
      "command": "run_display_trace.mjs --out reports/q6-trace.json",
      "environment": "qualification host, Chromium 150",
      "route": "cog-tiler-wasm renderTilePNG over a disk-backed File",
      "artifact": {"name": "cog-tiler-wasm", "version": "0.3.6"},
      "fixtures": [{"name": "derived_cog", "sha256": "..."}],
      "observations": {"any": "raw measurement carried for review"},
      "assertions": {"assertion-id": "pass", ...}
    }

Assertion values are ``pass``, ``fail`` or ``inconclusive``. An assertion the
contract requires but the entry omits is ``inconclusive`` — absence of evidence is
never evidence of success.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

#: Verdicts a single assertion may carry.
ASSERTION_VERDICTS = frozenset({"pass", "fail", "inconclusive"})

#: Verdicts a requirement, or the qualification overall, may carry.
PASS = "pass"
FAIL = "fail"
INCONCLUSIVE = "inconclusive"
NOT_APPLICABLE = "not_applicable"

REQUIREMENT_VERDICTS = frozenset({PASS, FAIL, INCONCLUSIVE, NOT_APPLICABLE})

#: Evaluated in this order: any fail wins, then any inconclusive, then pass.
VERDICT_PRECEDENCE = (FAIL, INCONCLUSIVE, PASS)

#: Evidence identity fields a real requirement entry must carry to be usable.
REQUIRED_EVIDENCE_FIELDS = ("source", "command", "environment", "route")

#: Placeholder used to mark synthetic gate fixtures, which must never be
#: published as qualification evidence.
SYNTHETIC_MARKER = "synthetic-gate-fixture"

#: A bundle older than this is stale: its evidence describes a run that no longer
#: corresponds to the delivered harness and contract.
MAX_BUNDLE_AGE_DAYS = 7.0

#: Key an entry uses to declare the environment it was measured in.
ENTRY_ENVIRONMENT_KEY = "environment"


@dataclass(frozen=True)
class Requirement:
    """One mandatory Q requirement and the evidence it demands."""

    id: str
    title: str
    phase: str
    required: bool
    plan_basis: str
    role: str
    fixture_class: str
    environment: str
    units_or_budget: str
    evidence_source: str
    assertions: tuple[str, ...]
    negative_controls: tuple[str, ...] = ()
    host_evidence_rules: dict[str, Any] = field(default_factory=dict)
    unresolved_finding: str | None = None
    #: Whether evidence for this requirement must name a raster fixture.
    requires_raster_fixture: bool = True
    no_fixture_reason: str | None = None

    @property
    def assertion_ids(self) -> tuple[str, ...]:
        return self.assertions


@dataclass(frozen=True)
class Contract:
    """The accepted requirement set for Q."""

    version: int
    source: str
    requirements: tuple[Requirement, ...]

    def required(self) -> tuple[Requirement, ...]:
        return tuple(r for r in self.requirements if r.required)

    def by_id(self, requirement_id: str) -> Requirement | None:
        for requirement in self.requirements:
            if requirement.id == requirement_id:
                return requirement
        return None


def load_contract(path: Path) -> Contract:
    """Load and structurally validate the requirement contract."""
    payload = json.loads(path.read_text())
    version = payload.get("contractVersion")
    if not isinstance(version, int):
        raise ValueError(f"{path.name}: contractVersion must be an integer")
    requirements: list[Requirement] = []
    seen: set[str] = set()
    for raw in payload.get("requirements", []):
        requirement_id = raw.get("id")
        if not requirement_id:
            raise ValueError(f"{path.name}: a requirement is missing its id")
        if requirement_id in seen:
            raise ValueError(f"{path.name}: duplicate requirement id {requirement_id}")
        seen.add(requirement_id)
        assertions = tuple(raw.get("assertions") or ())
        if not assertions:
            raise ValueError(f"{path.name}: {requirement_id} declares no assertions")
        requirements.append(Requirement(
            id=requirement_id,
            title=raw.get("title", requirement_id),
            phase=raw.get("phase", "Q"),
            required=bool(raw.get("required", False)),
            plan_basis=raw.get("planBasis", ""),
            role=raw.get("role", ""),
            fixture_class=raw.get("fixtureClass", ""),
            environment=raw.get("environment", ""),
            units_or_budget=raw.get("unitsOrBudget", ""),
            evidence_source=raw.get("evidenceSource", ""),
            assertions=assertions,
            negative_controls=tuple(raw.get("negativeControls") or ()),
            host_evidence_rules=raw.get("hostEvidenceRules") or {},
            unresolved_finding=raw.get("unresolvedFinding"),
            requires_raster_fixture=bool(raw.get("requiresRasterFixture", True)),
            no_fixture_reason=raw.get("noFixtureReason"),
        ))
    if not requirements:
        raise ValueError(f"{path.name}: no requirements declared")
    return Contract(version=version, source=payload.get("source", ""),
                    requirements=tuple(requirements))


@dataclass
class RequirementVerdict:
    requirement_id: str
    title: str
    verdict: str
    reasons: list[str] = field(default_factory=list)
    assertions: dict[str, str] = field(default_factory=dict)
    missing_evidence_fields: list[str] = field(default_factory=list)
    synthetic: bool = False
    admission: dict[str, Any] = field(default_factory=dict)
    #: Assertions the source measured but which its admission does not promote.
    observed_assertions: dict[str, str] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "requirementId": self.requirement_id,
            "title": self.title,
            "verdict": self.verdict,
            "reasons": self.reasons,
            "assertions": self.assertions,
            "missingEvidenceFields": self.missing_evidence_fields,
            "synthetic": self.synthetic,
            "admission": self.admission,
            "observedAssertions": self.observed_assertions,
        }


@dataclass
class Decision:
    verdict: str
    requirements: list[RequirementVerdict]
    contract_version: int
    contract_source: str
    synthetic: bool = False

    @property
    def exit_code(self) -> int:
        """Only an overall pass exits zero."""
        return 0 if self.verdict == PASS else 1

    def blocking(self) -> list[RequirementVerdict]:
        return [r for r in self.requirements if r.verdict != PASS]

    def as_dict(self) -> dict[str, Any]:
        return {
            "experiment": "qualification-gate",
            "result": self.verdict,
            "verdictReason": self._reason(),
            "contractVersion": self.contract_version,
            "contractSource": self.contract_source,
            "synthetic": self.synthetic,
            "requirements": [r.as_dict() for r in self.requirements],
            "blockingRequirementIds": [r.requirement_id for r in self.blocking()],
            "assertions": [
                {"name": f"{r.requirement_id}", "ok": r.verdict == PASS,
                 "detail": "; ".join(r.reasons)}
                for r in self.requirements
            ],
            "failures": [f"{r.requirement_id}: {reason}"
                         for r in self.blocking()
                         for reason in (r.reasons or ["no reason recorded"])],
            # Reports must carry the standard fields so the existing report
            # contract validator applies to this one too.
            "requiredBehavior": "Decide Q eligibility from the requirement contract.",
            "implementationExercised": "qualification_gate.evaluate",
            "commands": ["measure.py gate --bundle <bundle.json> --out <decision.json>"],
            "fixtures": [],
            "measurementLocations": [],
            "limitations": [],
        }

    def _reason(self) -> str:
        blocking = self.blocking()
        if not blocking:
            return f"all {len(self.requirements)} required requirements pass"
        counts: dict[str, int] = {}
        for requirement in blocking:
            counts[requirement.verdict] = counts.get(requirement.verdict, 0) + 1
        parts = [f"{count} {verdict}" for verdict, count in sorted(counts.items())]
        return f"{len(blocking)} requirement(s) not passing: " + ", ".join(parts)


def _combine(verdicts: list[str]) -> str:
    """Requirement verdict from assertion verdicts, failing and gaps first."""
    if not verdicts:
        return INCONCLUSIVE
    if FAIL in verdicts:
        return FAIL
    if INCONCLUSIVE in verdicts:
        return INCONCLUSIVE
    return PASS


def _label(path: Path) -> str:
    return getattr(path, "name", str(path))


def _is_verdict(value: Any) -> bool:
    """Whether a value is one of the three assertion verdicts.

    Checked by identity rather than membership so a container cannot raise an
    unhashable-type error and a ``True`` cannot be mistaken for a verdict.
    """
    return isinstance(value, str) and value in ASSERTION_VERDICTS


def _describe(value: Any) -> str:
    """A short, safe description of a malformed value for a diagnostic reason."""
    if isinstance(value, str):
        return f"the string {value!r}"
    if isinstance(value, bool):
        return f"the boolean {value}"
    if isinstance(value, (int, float)):
        return f"the number {value!r}"
    if isinstance(value, (list, dict)):
        return f"a {type(value).__name__}"
    return f"{type(value).__name__} {value!r}"


def _duplicate_requirement_keys(text: str) -> list[str]:
    """Requirement keys that appear more than once under the bundle's requirements.

    ``json.loads`` keeps only the last duplicate, so a report carrying two entries
    for one requirement would silently discard the first — possibly the failing
    one. The raw text is parsed with a pair-preserving hook to detect this.
    """
    try:
        root = json.loads(text, object_pairs_hook=lambda pairs: pairs)
    except json.JSONDecodeError:
        return []
    if not isinstance(root, list):
        return []
    requirements = None
    for key, value in root:
        if key == "requirements":
            requirements = value
            break
    if not isinstance(requirements, list):
        return []
    seen: set[str] = set()
    duplicates: list[str] = []
    for entry in requirements:
        # The pair-preserving hook yields tuples, not lists.
        if not isinstance(entry, (list, tuple)) or not entry:
            continue
        # Each entry is a (key, value) pair; the key is the pair's first element.
        key = entry[0]
        if not isinstance(key, str):
            continue
        if key in seen:
            duplicates.append(key)
        seen.add(key)
    return duplicates


def _read_bundle(path: Path) -> tuple[dict[str, Any], str | None, bool]:
    """Read a bundle, distinguishing malformed input from a missing one.

    Returns ``(payload, problem, present)``. The distinction matters for the
    verdict: corruption is a failure, absence is inconclusive.
    """
    label = _label(path)
    if not path.is_file():
        return {}, f"evidence bundle {label} is missing", False
    try:
        text = path.read_text()
    except OSError as error:
        return {}, f"evidence bundle {label} is unreadable: {error}", True
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        return {}, f"evidence bundle {label} is malformed: {error}", True
    if not isinstance(payload, dict):
        return {}, f"evidence bundle {label} is not a JSON object", True
    duplicates = _duplicate_requirement_keys(text)
    if duplicates:
        return payload, (f"evidence bundle {label} repeats requirement "
                         f"{', '.join(sorted(set(duplicates)))}"), True
    return payload, None, True


def _bundle_corruption(payload: dict[str, Any], entries: dict[str, Any],
                       now: float | None = None) -> list[str]:
    """Defects that make the whole bundle unusable.

    Corruption, staleness, a missing bundle identity and mixed evidence
    environments are bundle-wide: they cannot be attributed to one requirement, so
    they block every requirement rather than being reported as a local gap.
    """
    problems: list[str] = []
    declared_environment = payload.get("environment")
    if not isinstance(declared_environment, dict) or not declared_environment:
        problems.append("bundle does not declare the environment it was measured in")
    if not isinstance(payload.get("route"), dict) or not payload.get("route"):
        problems.append("bundle does not declare the route it measured")

    entry_environments: dict[str, set[str]] = {}
    for requirement_id, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        environment = entry.get(ENTRY_ENVIRONMENT_KEY)
        if environment:
            entry_environments.setdefault(str(environment), set()).add(str(requirement_id))
    if len(entry_environments) > 1:
        described = "; ".join(f"{env!r} for {', '.join(sorted(ids))}"
                              for env, ids in sorted(entry_environments.items()))
        problems.append(f"mixed evidence environments in one bundle: {described}")

    generated_at = payload.get("generatedAt")
    if not isinstance(generated_at, (int, float)) or isinstance(generated_at, bool):
        problems.append("bundle does not record when its evidence was generated")
    else:
        reference = time.time() if now is None else now
        age_days = (reference - float(generated_at)) / 86400.0
        if age_days > MAX_BUNDLE_AGE_DAYS:
            problems.append(
                f"bundle evidence is stale: generated {age_days:.1f} days ago, "
                f"limit {MAX_BUNDLE_AGE_DAYS} days")
        elif age_days < 0:
            problems.append(
                "bundle records a generation time "
                f"{(reference - float(generated_at)) / 60:.1f} minutes in the future")
    return problems


def _admission_problems(admission: Any) -> list[str]:
    """Why an entry's admission block cannot be used, if it cannot be.

    Returns an empty list only for a block the gate may read. The block is
    required: the assembler always writes one, so its absence means the bundle did
    not come from the admission path, and reading its assertions anyway would make
    direct ingestion a weaker path than assembly.
    """
    if admission is None:
        return ["evidence carries no admission block, so its source was never "
                "admitted and its observations cannot be promoted"]
    if not isinstance(admission, dict):
        return [f"evidence admission block is {_describe(admission)}, not an object"]
    if "verdict" not in admission:
        return ["evidence admission block records no verdict, so the source's "
                "admission state is unknown"]
    verdict = admission.get("verdict")
    if not _is_verdict(verdict):
        if verdict is None:
            return ["evidence admission block records a null verdict, which is "
                    "not an admission state"]
        return [f"evidence admission block records {_describe(verdict)}, which is "
                f"not one of {sorted(ASSERTION_VERDICTS)}"]
    reasons = admission.get("reasons")
    if reasons is None:
        return ["evidence admission block records no reasons list"]
    if not isinstance(reasons, list):
        return [f"evidence admission reasons are {_describe(reasons)}, not a list"]
    for index, reason in enumerate(reasons):
        if not isinstance(reason, str):
            return [f"evidence admission reason {index} is "
                    f"{_describe(reason)}, not text"]
    return []


def _entry_problems(requirement_id: str, entry: dict[str, Any]) -> list[str]:
    """Defects confined to one entry.

    These stay inconclusive: an entry that does not identify what it measured is a
    gap in the evidence for that requirement, not a measured violation of it.
    """
    problems: list[str] = []
    if not entry.get("route"):
        problems.append(f"{requirement_id} does not name the route it measured")
    if not entry.get("artifact"):
        problems.append(f"{requirement_id} does not name the artifact it exercised")
    return problems


def evaluate(contract: Contract, bundle_path: Path, *,
             now: float | None = None, allow_synthetic: bool = False) -> Decision:
    """Decide Q eligibility for one evidence bundle against the contract.

    A requirement passes only when every assertion the contract names for it is
    present and ``pass``. A malformed or corrupt bundle fails; a missing or
    incomplete one is inconclusive. Neither can yield a passing overall verdict.
    """
    payload, problem, present = _read_bundle(bundle_path)
    entries = payload.get("requirements", {}) if isinstance(payload, dict) else {}
    if entries is None:
        entries = {}
    if not isinstance(entries, dict):
        entries = {}
    bundle_environment = payload.get("environment", {}) if isinstance(payload, dict) else {}
    synthetic = bool(payload.get(SYNTHETIC_MARKER)) if isinstance(payload, dict) else False

    # Whole-bundle defects. Corruption, staleness and a mixed environment make
    # every requirement unusable, so they are evaluated once, not per entry.
    corruption: list[str] = []
    if present and not problem:
        corruption = _bundle_corruption(payload, entries, now=now)
    elif problem:
        corruption = [problem]
    if synthetic and not allow_synthetic:
        # Synthetic controls prove evaluator behaviour and are useful in tests, but
        # they are not physically measured evidence and cannot qualify anything.
        corruption = list(corruption) + [
            "bundle is marked as a synthetic gate fixture, so it cannot be "
            "published as qualification evidence"]

    verdicts: list[RequirementVerdict] = []
    for requirement in contract.requirements:
        if not requirement.required:
            verdicts.append(RequirementVerdict(
                requirement_id=requirement.id, title=requirement.title,
                verdict=NOT_APPLICABLE,
                reasons=[f"no Q obligation recorded ({requirement.phase})"]))
            continue

        entry = entries.get(requirement.id)
        result = RequirementVerdict(requirement_id=requirement.id,
                                    title=requirement.title, verdict=INCONCLUSIVE)

        if entry is None:
            # A missing bundle is an inconclusive run: nothing was measured.
            # A supplied-but-corrupt bundle is a failure.
            result.verdict = FAIL if (problem and present) else INCONCLUSIVE
            result.reasons.append(
                problem or f"no evidence recorded for {requirement.id}")
            verdicts.append(result)
            continue
        if corruption:
            # A corrupt bundle is a failure wherever it is supplied. Corruption is
            # recorded explicitly rather than silently attributed to one entry.
            result.verdict = FAIL
            result.reasons.extend(corruption)
            verdicts.append(result)
            continue
        if not isinstance(entry, dict):
            result.verdict = FAIL
            result.reasons.append(f"{requirement.id} evidence is not a JSON object")
            verdicts.append(result)
            continue

        # Entry-level identity gaps. They are recorded, not returned on: a missing
        # route and a measured failure are independent findings, and reducing at
        # the first gap would drop a failure the gate never looked for. The gaps
        # are applied once, at the end, under the contract's precedence.
        entry_gaps: list[str] = []
        missing = [name for name in REQUIRED_EVIDENCE_FIELDS if not entry.get(name)]
        result.missing_evidence_fields = missing
        local = _entry_problems(requirement.id, entry)
        if missing:
            entry_gaps.append("evidence does not identify " + ", ".join(missing))
        entry_gaps.extend(local)

        # Host-scoped requirements declare which hosts can satisfy them.
        rules = requirement.host_evidence_rules or {}
        if rules:
            observed_host = entry.get("host") or bundle_environment.get("host")
            accepted = rules.get("acceptedHosts") or []
            result.assertions["host-identity"] = (
                "pass" if observed_host in accepted else "inconclusive")
            if observed_host not in accepted:
                result.reasons.append(
                    f"host {observed_host!r} cannot satisfy this requirement; "
                    f"accepted hosts: {accepted}")

        # Admission runs before any observation is promoted. When a source did
        # not admit, its individually passing assertions must not be able to
        # carry the requirement, but they stay recorded so partial measured
        # successes remain visible.
        admission = entry.get("admission")
        admission_problems = _admission_problems(admission)
        if admission_problems:
            result.verdict = FAIL
            result.reasons.extend(admission_problems)
            verdicts.append(result)
            continue

        result.admission = admission
        admitted_verdict = admission["verdict"]
        admission_reasons = [str(reason) for reason in admission["reasons"]]
        # Whether the *source* may contribute is a separate question from whether
        # the requirement is satisfied. ``sourceAdmitted`` records the former; a
        # record whose source was usable but whose measured assertion failed must
        # keep those assertions as the requirement's result rather than filing them
        # away as unusable partial evidence.
        source_admitted = admission.get("sourceAdmitted")
        if source_admitted is None:
            source_admitted = admitted_verdict == PASS
        if not source_admitted:
            # An unadmitted source cannot carry a requirement, but the findings it
            # already recorded keep their own severity. A measured violation in an
            # unusable record is still a measured violation, and a failure must not
            # be graded down to a gap because the record that contains it is also
            # incomplete.
            observed_assertion_failures = sorted(
                key for key, value in (entry.get("observed") or {}).items()
                if _is_verdict(value) and value == FAIL)
            if admitted_verdict == FAIL or observed_assertion_failures:
                result.verdict = FAIL
            else:
                result.verdict = INCONCLUSIVE
            result.reasons.extend(
                admission_reasons or [f"{requirement.id} source was not admitted"])
            result.reasons.extend(
                f"assertion {assertion_id} failed" for assertion_id
                in observed_assertion_failures)
            # Carry the source's own explanatory detail so a reader can trace
            # which identity conflicted and with what value.
            observations = entry.get("observations")
            if isinstance(observations, dict):
                for note in observations.get("notes") or []:
                    if note and note not in result.reasons:
                        result.reasons.append(str(note))
            # Partial measured successes stay visible for review, in their own
            # field. They are deliberately not promoted into `assertions`,
            # because the requirement verdict is already blocked and a reader
            # must not mistake them for satisfying evidence.
            observed = entry.get("observed")
            if isinstance(observed, dict):
                result.observed_assertions = {
                    key: value for key, value in observed.items()
                    if _is_verdict(value)}
            verdicts.append(result)
            continue

        declared = entry.get("assertions")
        if declared is None:
            # No observation was promoted at all, so nothing was measured. The
            # entry's own identity gaps still explain why.
            result.verdict = INCONCLUSIVE
            result.reasons.append(
                f"{requirement.id} has no promoted observations")
            result.reasons.extend(entry_gaps)
            verdicts.append(result)
            continue
        if not isinstance(declared, dict):
            result.verdict = FAIL
            result.reasons.append(f"{requirement.id} assertions are malformed")
            result.reasons.extend(entry_gaps)
            verdicts.append(result)
            continue

        assertion_verdicts: list[str] = []
        for assertion_id in requirement.assertions:
            value = declared.get(assertion_id)
            if value is None and assertion_id not in declared:
                # Absent: no evidence was recorded for this assertion.
                result.reasons.append(f"assertion {assertion_id} has no result")
                value = INCONCLUSIVE
            elif value is None:
                # Present but explicitly null. The documented schema does not
                # permit null as "unavailable" for a verdict slot, so this is
                # malformed input rather than an absence.
                result.reasons.append(
                    f"assertion {assertion_id} is null, which is not a verdict")
                value = FAIL
            elif not _is_verdict(value):
                # Checked by identity before membership: a container value is
                # unhashable, and reading it as "no result" would turn malformed
                # input into a gap instead of a diagnostic failure.
                result.reasons.append(
                    f"assertion {assertion_id} carries {_describe(value)}, which is "
                    f"not one of {sorted(ASSERTION_VERDICTS)}")
                value = FAIL
            result.assertions[assertion_id] = value
            assertion_verdicts.append(value)

        for assertion_id, value in result.assertions.items():
            if value == FAIL:
                result.reasons.append(f"assertion {assertion_id} failed")

        # Identity gaps and assertion verdicts are reduced together: a recorded
        # failure outranks any gap, and a gap outranks a pass.
        combined = _combine(assertion_verdicts + [INCONCLUSIVE] if entry_gaps
                            else assertion_verdicts)
        result.reasons.extend(entry_gaps)
        if combined == PASS and result.reasons:
            # A gap recorded alongside otherwise-passing assertions still blocks:
            # the reasons name evidence that was required and not usable.
            combined = INCONCLUSIVE
        # Surface the source's explanatory detail for a non-passing verdict so a
        # reader can trace which identity or obligation produced it.
        if combined != PASS:
            observations = entry.get("observations")
            if isinstance(observations, dict):
                for note in observations.get("notes") or []:
                    if note and note not in result.reasons:
                        result.reasons.append(str(note))
        result.verdict = combined
        verdicts.append(result)

    overall = PASS
    for candidate in VERDICT_PRECEDENCE:
        if any(v.verdict == candidate for v in verdicts):
            overall = candidate
            break
    else:
        overall = PASS
    if not any(v.verdict == PASS for v in verdicts):
        overall = INCONCLUSIVE if overall == PASS else overall

    return Decision(verdict=overall, requirements=verdicts,
                    contract_version=contract.version,
                    contract_source=contract.source, synthetic=synthetic)
