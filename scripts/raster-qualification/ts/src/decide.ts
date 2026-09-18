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
}

/** One admitted source, shared by every requirement that draws on it. */
export interface AdmittedSource extends SourceView {
  readonly snapshot: SourceSnapshot;
}

export interface Prepared {
  readonly input: QualificationInput;
  readonly admitted: readonly AdmittedSource[];
  readonly byRole: ReadonlyMap<string, AdmittedSource>;
}

/**
 * Read, parse and admit every declared source exactly once.
 *
 * Kept separate from the requirement mapping so a caller can inspect the
 * admissions, and so the mapping cannot accidentally re-read a file and decide on
 * different bytes.
 */
export function prepare(input: QualificationInput): Prepared {
  const admitted: AdmittedSource[] = [];
  for (const declared of input.sources) {
    const snapshot = readSource(declared.path, declared.label);
    if (snapshot.status !== 'present') {
      admitted.push({
        role: declared.role,
        label: declared.label,
        status: snapshot.status,
        snapshot,
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
      shape: merged,
      facts: read.facts,
      admission: admitReport(merged, read.facts, declared.label, declared.expectations, snapshot),
      ...(snapshot.digest === undefined ? {} : { digest: snapshot.digest }),
    });
  }
  const byRole = new Map(admitted.map((entry) => [entry.role, entry]));
  return { input, admitted, byRole };
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
  const admission = combineAdmissions(sourceAdmissions, result.sourceRoles);

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

  const verdict = findings.verdict();

  return {
    id: spec.id,
    title: spec.title,
    verdict,
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
): Admission {
  const live = admissions.filter((entry): entry is AdmittedSource => entry !== undefined);
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
