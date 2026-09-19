/**
 * The one authoritative qualification operation.
 *
 * Everything the decision needs is supplied explicitly: the declared expectations,
 * the requirement contract, and a snapshot of every raw source. Nothing is read
 * from a path embedded in a bundle, and no serialized admission label is trusted.
 * A bundle is a diagnostic output of this operation, not an input to it.
 *
 * The operation reads each source once, admits each report once, and derives every
 * requirement from those admissions. There is no second path and no test-only
 * evaluation mode; a synthetic control exercises this same function.
 */

import { readSource, type SourceSnapshot } from './sources.js';
import {
  checkReportShape,
  readAdmissionFacts,
  type AdmissionFacts,
  type ReportShape,
} from './report.js';
import { admitReport, type Admission, type SourceExpectations } from './admit.js';
import type { Contract, FixtureManifest, PinDeclaration } from './declaration.js';
import { Findings } from './verdict.js';
import { PASS, PRECEDENCE, type Verdict } from './verdict.js';

/** One requirement's outcome, with the evidence that produced it. */
export interface RequirementVerdict {
  readonly id: string;
  readonly title: string;
  readonly verdict: Verdict;
  /** Structured internal-check defects; never a measured engine failure. */
  readonly defects: readonly string[];
  readonly assertions: ReadonlyMap<string, Verdict>;
  /** Partial measured successes that were not promoted. */
  readonly observed: ReadonlyMap<string, Verdict>;
  readonly reasons: readonly string[];
  readonly admission: Admission;
  readonly source: string;
  readonly observations: Record<string, unknown>;
}

export interface Decision {
  readonly version: number;
  readonly verdict: Verdict;
  /** Internal-check defects across every requirement, each stated once. */
  readonly internalDefects: readonly string[];
  readonly requirements: readonly RequirementVerdict[];
  readonly generatedAt: number;
  readonly synthetic: boolean;
  readonly contractSource: string;
  /** Sources this decision was computed from, with the digest of the bytes read. */
  readonly sources: readonly { label: string; digest?: string; status: string }[];
}

export interface DeclaredSource {
  /** The report role, e.g. `q2`. */
  readonly role: string;
  /** How the caller refers to it, used in diagnostics. */
  readonly label: string;
  /** The path to read. */
  readonly path: string;
  readonly expectations: SourceExpectations;
}

export interface QualificationInput {
  readonly contract: Contract;
  readonly sources: readonly DeclaredSource[];
  /** Evaluation time in epoch seconds. Supplied so a decision is reproducible. */
  readonly now: number;
  /** Marks a synthetic control. It cannot publish a qualifying result. */
  readonly synthetic?: boolean;
}

/**
 * A source as a requirement mapping sees it.
 *
 * The mapping gets the parsed value and the facts admission read from it, and
 * cannot re-read the file: one source is read once per decision, and every
 * requirement decides on those same bytes.
 */
export interface SourceView {
  readonly role: string;
  readonly label: string;
  readonly status: 'present' | 'absent' | 'corrupt';
  readonly shape?: ReportShape;
  readonly facts?: AdmissionFacts;
  readonly admission: Admission;
  readonly digest?: string;
  /**
   * The declared expectations this source is checked against.
   *
   * Reached through the source so a mapping can consult an independent declaration
   * (the candidate pins, for example) without a second input path.
   */
  readonly expectations: SourceExpectations;
}

/** One admitted source, shared by every requirement that draws on it. */
export interface AdmittedSource extends SourceView {
  readonly snapshot: SourceSnapshot;
}

export interface Prepared {
  readonly input: QualificationInput;
  readonly admitted: readonly AdmittedSource[];
  readonly byRole: ReadonlyMap<string, AdmittedSource>;
  /** Roles that more than one source claimed, and which therefore carry no report. */
  readonly duplicatedRoles: ReadonlySet<string>;
}

/**
 * Read, parse and admit every declared source exactly once.
 *
 * Kept separate from the requirement mapping so a caller can inspect the
 * admissions, and so the mapping cannot accidentally re-read a file and decide on
 * different bytes.
 */
export function prepare(input: QualificationInput): Prepared {
  // A source role names the one report a requirement reads for that role. Two
  // sources claiming one role are ambiguous evidence, so the role is rejected
  // before anything is indexed: resolving it by arrival order would let whichever
  // source happened to be read last decide the verdict.
  const roleCounts = new Map<string, number>();
  for (const declared of input.sources) {
    roleCounts.set(declared.role, (roleCounts.get(declared.role) ?? 0) + 1);
  }
  const duplicatedRoles = new Set(
    Array.from(roleCounts, ([role, count]) => (count > 1 ? role : undefined)).filter(
      (role): role is string => role !== undefined,
    ),
  );
  const labelsByRole = new Map<string, string[]>();
  for (const declared of input.sources) {
    const existing = labelsByRole.get(declared.role) ?? [];
    existing.push(declared.label);
    labelsByRole.set(declared.role, existing);
  }

  const admitted: AdmittedSource[] = [];
  for (const declared of input.sources) {
    if (duplicatedRoles.has(declared.role)) {
      admitted.push({
        role: declared.role,
        label: declared.label,
        status: 'corrupt',
        snapshot: { label: declared.label, path: declared.path, status: 'corrupt' },
        expectations: declared.expectations,
        admission: {
          label: declared.label,
          verdict: 'fail',
          sourceAdmitted: false,
          reasons: [
            `source role ${JSON.stringify(declared.role)} is declared more than once (${(
              labelsByRole.get(declared.role) ?? []
            ).join(', ')}), so which report it refers to is ambiguous`,
          ],
          identity: {},
          positiveFailures: [],
          negativeControlFailures: [],
        },
      });
      continue;
    }
    const snapshot = readSource(declared.path, declared.label);
    if (snapshot.status !== 'present') {
      admitted.push({
        role: declared.role,
        label: declared.label,
        status: snapshot.status,
        snapshot,
        expectations: declared.expectations,
        admission: admitReport(undefined, undefined, declared.label, declared.expectations, snapshot),
        ...(snapshot.digest === undefined ? {} : { digest: snapshot.digest }),
      });
      continue;
    }
    const shape = checkReportShape(snapshot.value, declared.label);
    const read = readAdmissionFacts(shape, declared.label);
    // Structural problems are folded into the shape so admission reports them once.
    const merged: ReportShape = {
      value: shape.value,
      problems: [...shape.problems, ...read.problems],
      gaps: shape.gaps,
    };
    for (const gap of merged.gaps) void gap;
    admitted.push({
      role: declared.role,
      label: declared.label,
      status: snapshot.status,
      snapshot,
      expectations: declared.expectations,
      shape: merged,
      facts: read.facts,
      admission: admitReport(merged, read.facts, declared.label, declared.expectations, snapshot),
      ...(snapshot.digest === undefined ? {} : { digest: snapshot.digest }),
    });
  }
  // Only roles that arrived exactly once are indexed. A duplicated role is absent
  // from the index rather than present twice, so no requirement can read one of the
  // duplicates and believe it read the role.
  const byRole = new Map(
    admitted.filter((entry) => !duplicatedRoles.has(entry.role)).map((entry) => [entry.role, entry]),
  );
  return { input, admitted, byRole, duplicatedRoles };
}

/** Reduce requirement verdicts to one overall verdict. */
export function overallVerdict(requirements: readonly RequirementVerdict[]): Verdict {
  const enforceable = requirements.filter((entry) => entry.id !== NOT_APPLICABLE_ID);
  for (const candidate of PRECEDENCE) {
    if (enforceable.some((entry) => entry.verdict === candidate)) return candidate;
  }
  if (enforceable.length === 0) return 'inconclusive';
  if (!enforceable.some((entry) => entry.verdict === PASS)) return 'inconclusive';
  return PASS;
}

const NOT_APPLICABLE_ID = '__not_applicable__';

/** Declarations the caller supplies alongside the contract. */
export interface DeclaredInputs {
  readonly fixtureManifest?: FixtureManifest;
  readonly fixtureManifestVerdict?: Verdict;
  readonly fixtureManifestProblems?: readonly string[];
  readonly pins?: PinDeclaration;
  readonly pinVerdict?: Verdict;
  readonly pinProblems?: readonly string[];
}

/**
 * Decide one requirement from the sources already admitted for it.
 *
 * The requirement's own assertions decide its verdict. An admission that did not
 * pass blocks promotion, but a finding the requirement itself recorded keeps its
 * own severity: a measured violation of a requirement whose source was also
 * incomplete is still a measured violation.
 */
export function decideRequirement(
  contract: Contract,
  prepared: Prepared,
  mapping: import('./evidence/mapping.js').RequirementMapping,
  requirementId: string,
): RequirementVerdict {
  const spec = contract.requirements.find((entry) => entry.id === requirementId);
  if (spec === undefined) {
    throw new Error(`contract declares no requirement ${requirementId}`);
  }
  const result = mapping({ byRole: prepared.byRole });
  const sourceAdmissions = result.sourceRoles.map((role) => prepared.byRole.get(role));
  const admission = combineAdmissions(
    sourceAdmissions,
    result.sourceRoles,
    prepared.duplicatedRoles,
    prepared.admitted,
  );

  const assertions = result.assertions;
  const assertionVerdicts = spec.assertions.map((id) => assertions.get(id) ?? 'inconclusive');

  // The requirement's own findings and its source's admission both contribute.
  const findings = new Findings();
  const observed = new Map<string, Verdict>();
  for (const id of spec.assertions) {
    const verdict = assertions.get(id) ?? 'inconclusive';
    if (verdict === 'fail') findings.fail(`assertion ${id} failed`);
    else if (verdict === 'inconclusive') findings.gap(`assertion ${id} has no usable evidence`);
  }
  for (const failure of result.failures) findings.fail(failure);
  for (const gap of result.gaps) findings.gap(gap);

  // The source's admission is authoritative about whether a failure was found: a
  // corrupt source or a conflicting identity *is* a failure, and reducing it to a
  // gap would hide a known defect behind the record's own incompleteness.
  if (admission.verdict === 'fail') findings.fail(`${admission.label} was not admitted`);
  for (const reason of admission.reasons) {
    if (admission.verdict === 'fail') findings.fail(reason);
    else findings.gap(reason);
  }

  // The source's observations are kept visible when it could not contribute, so a
  // partial measured success stays reviewable without being promoted.
  if (!admission.sourceAdmitted) {
    for (const [id, value] of assertions) observed.set(id, value);
  }

  const defects = [...(result.defects ?? [])];
  for (const defect of defects) findings.gap(`internal check defect: ${defect}`);

  const verdict = findings.verdict();

  return {
    id: spec.id,
    title: spec.title,
    verdict,
    defects,
    assertions,
    observed,
    reasons: [...admission.reasons, ...findings.reasons()],
    admission,
    source: result.source,
    observations: result.observations,
  };
}

/** One admission representing every source a requirement draws on. */
function combineAdmissions(
  admissions: readonly (AdmittedSource | undefined)[],
  roles: readonly string[],
  duplicatedRoles: ReadonlySet<string>,
  allAdmitted: readonly AdmittedSource[],
): Admission {
  const live = admissions.filter((entry): entry is AdmittedSource => entry !== undefined);

  // A requirement that draws on a duplicated role inherits the ambiguity as a
  // failure rather than as a gap: two sources claimed one role, which is invalid
  // input rather than missing evidence, and it must not read as "nothing measured".
  const duplicated = roles.filter((role) => duplicatedRoles.has(role));
  if (duplicated.length > 0) {
    const reasons = duplicated.map((role) => {
      const labels = allAdmitted.filter((entry) => entry.role === role).map((entry) => entry.label);
      return `source role ${JSON.stringify(role)} is declared more than once (${labels.join(', ')}), so which report it refers to is ambiguous`;
    });
    return {
      label: duplicated.join(', '),
      verdict: 'fail',
      sourceAdmitted: false,
      reasons,
      identity: {},
      positiveFailures: [],
      negativeControlFailures: [],
    };
  }

  if (live.length === 0) {
    return {
      label: roles.join(', '),
      verdict: 'inconclusive',
      sourceAdmitted: false,
      reasons: ['no contributing source was available'],
      identity: {},
      positiveFailures: [],
      negativeControlFailures: [],
    };
  }
  const worst = live.reduce((a, b) => (PRECEDENCE.indexOf(a.admission.verdict) <= PRECEDENCE.indexOf(b.admission.verdict) ? a : b));
  const reasons: string[] = [];
  for (const entry of live) {
    for (const reason of entry.admission.reasons) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }
  return {
    label: worst.admission.label,
    verdict: worst.admission.verdict,
    sourceAdmitted: live.every((entry) => entry.admission.sourceAdmitted),
    reasons,
    identity: worst.admission.identity,
    positiveFailures: live.flatMap((entry) => entry.admission.positiveFailures),
    negativeControlFailures: live.flatMap((entry) => entry.admission.negativeControlFailures),
  };
}
