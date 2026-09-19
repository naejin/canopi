/**
 * Explicit check outcomes and one verdict owner.
 *
 * A check evaluates exactly one independently decidable fact over the sources and
 * declarations this requirement reads: a run's failed-tile count, one artifact's
 * version, one budget on one record. It returns a structured outcome instead of
 * writing a verdict, so no check can produce a pass by accident and no finding can
 * disappear because a sibling check did not run.
 *
 * The rules the driver enforces:
 *
 * - **No default success.** A pass requires `satisfied: true`, at least one
 *   applicable evidence reference validated against the admitted snapshot, and no
 *   failures or gaps. An unsupported obligation is `satisfied: false` plus its own
 *   specific gap.
 * - **Independent findings survive each other.** Failures and gaps are separate
 *   lists, both may exist, and the assertion verdict comes from the single
 *   reduction in `verdict.ts`. A check may stop a comparison only when one of that
 *   comparison's own operands is unusable.
 * - **A defect is not a measurement.** An omitted or malformed outcome, a thrown
 *   check, evidence that does not match the snapshots, or a contradictory
 *   success-plus-failure is a structured internal-check defect: it fails closed,
 *   the other checks still run, the reason is retained, and the decision exits
 *   nonzero without pretending the engine failed.
 * - **Coverage is declared before observations are read.** Every contract assertion
 *   has at least one required check or an explicit unsupported reason. Duplicate or
 *   unregistered check ids are defects; an assertion nothing decides is a named gap.
 */

import { asArray, describe, isNonEmptyString, isRecord } from '../fields.js';
import { reduce, type Verdict } from '../verdict.js';
import type { SourceView } from '../decide.js';

/** Where a check's result comes from, in the already-read snapshot. */
export interface EvidenceRef {
  /** The source role the observation was read from. */
  readonly role: string;
  /** The concrete field or record the observation was read from. */
  readonly field: string;
  /** Digest of the exact source bytes the observation came from. */
  readonly digest?: string;
  /** Optional human detail, never the whole result. */
  readonly detail?: string;
  /** The declaration reference, when the check compared against one. */
  readonly declaration?: string;
}

export interface CheckOutcome {
  /** Whether affirmative applicable evidence established this fact. */
  readonly satisfied: boolean;
  readonly evidence: readonly EvidenceRef[];
  /** Attributed reasons that contradict the fact. */
  readonly failures: readonly string[];
  /** Attributed reasons the fact could not be established. */
  readonly gaps: readonly string[];
}

export interface CheckContext {
  readonly requirementId: string;
  /** The admitted sources this requirement reads, by role. */
  readonly byRole: ReadonlyMap<string, SourceView>;
}

/** One independently decidable fact. */
export interface Check {
  readonly id: string;
  /** The single contract assertion this check contributes to. */
  readonly assertion: string;
  run(context: CheckContext): CheckOutcome;
}

/** A requirement's declared check inventory. */
export interface RequirementChecks {
  readonly requirementId: string;
  /** Every contract assertion id the requirement declares. */
  readonly assertions: readonly string[];
  /** Check ids that must be implemented, declared before observations are read. */
  readonly required: readonly string[];
  /** Assertion id to the reason no check can decide it yet. */
  readonly unsupported: ReadonlyMap<string, string>;
  readonly checks: readonly Check[];
}

export interface CheckReceipt {
  readonly check: string;
  readonly assertion: string;
  readonly verdict: Verdict;
  readonly satisfied: boolean;
  readonly evidence: readonly EvidenceRef[];
  readonly failures: readonly string[];
  readonly gaps: readonly string[];
  /** Present only for a structured internal-check defect. */
  readonly defect?: string;
}

export interface CheckedResult {
  readonly assertions: ReadonlyMap<string, Verdict>;
  readonly failures: readonly string[];
  readonly gaps: readonly string[];
  readonly defects: readonly string[];
  readonly receipts: readonly CheckReceipt[];
  readonly observations: Record<string, unknown>;
}

/** Build an outcome. Check authors use the narrower helpers below. */
export function outcome(fields: {
  readonly satisfied: boolean;
  readonly evidence?: readonly EvidenceRef[];
  readonly failures?: readonly string[];
  readonly gaps?: readonly string[];
}): CheckOutcome {
  return {
    satisfied: fields.satisfied,
    evidence: fields.evidence ?? [],
    failures: fields.failures ?? [],
    gaps: fields.gaps ?? [],
  };
}

/** A fact established by affirmative evidence. */
export function satisfied(evidence: readonly EvidenceRef[]): CheckOutcome {
  return outcome({ satisfied: true, evidence });
}

/** A fact that could not be established. */
export function unsatisfied(
  gaps: readonly string[],
  evidence: readonly EvidenceRef[] = [],
): CheckOutcome {
  return outcome({ satisfied: false, gaps, evidence });
}

/** A fact contradicted by a recorded observation. */
export function violated(
  failures: readonly string[],
  evidence: readonly EvidenceRef[] = [],
): CheckOutcome {
  return outcome({ satisfied: false, failures, evidence });
}

/**
 * An evidence reference for a present admitted source.
 *
 * Returns `undefined` when there is no readable snapshot to cite, so a check cannot
 * cite evidence it does not have: the caller must then gap or fail instead.
 */
export function sourceEvidence(
  view: SourceView | undefined,
  field: string,
  detail?: string,
  declaration?: string,
): EvidenceRef | undefined {
  if (view === undefined || view.status !== 'present' || view.digest === undefined) return undefined;
  return {
    role: view.role,
    field,
    digest: view.digest,
    ...(detail === undefined ? {} : { detail }),
    ...(declaration === undefined ? {} : { declaration }),
  };
}

function stringList(value: unknown): string[] | undefined {
  const list = asArray(value);
  if (list === undefined) return undefined;
  const out: string[] = [];
  for (const entry of list) {
    if (!isNonEmptyString(entry)) return undefined;
    out.push(entry);
  }
  return out;
}

/** A validated outcome, or the defect that makes it unusable. */
function validateOutcome(
  check: Check,
  raw: unknown,
  context: CheckContext,
): { readonly outcome: CheckOutcome } | { readonly defect: string } {
  if (!isRecord(raw)) {
    return { defect: `check ${check.id} returned ${describe(raw)}, not a check outcome` };
  }
  const satisfiedValue = raw['satisfied'];
  if (typeof satisfiedValue !== 'boolean') {
    return {
      defect: `check ${check.id} returned satisfied=${describe(satisfiedValue)}, not a boolean`,
    };
  }
  const failures = stringList(raw['failures']);
  if (failures === undefined) {
    return { defect: `check ${check.id} returned failures that are not a list of reasons` };
  }
  const gaps = stringList(raw['gaps']);
  if (gaps === undefined) {
    return { defect: `check ${check.id} returned gaps that are not a list of reasons` };
  }
  const evidenceList = asArray(raw['evidence']);
  if (evidenceList === undefined) {
    return { defect: `check ${check.id} returned evidence that is not a list` };
  }
  const evidence: EvidenceRef[] = [];
  for (const entry of evidenceList) {
    if (!isRecord(entry)) {
      return { defect: `check ${check.id} cites evidence that is not an object` };
    }
    const role = entry['role'];
    const field = entry['field'];
    if (!isNonEmptyString(role) || !isNonEmptyString(field)) {
      return { defect: `check ${check.id} cites evidence without a usable role and field` };
    }
    const view = context.byRole.get(role);
    if (view === undefined) {
      return {
        defect: `check ${check.id} cites role ${JSON.stringify(role)}, which this requirement does not read`,
      };
    }
    if (view.status !== 'present' || view.digest === undefined) {
      return {
        defect: `check ${check.id} cites ${JSON.stringify(role)}, which was not admitted as a readable source`,
      };
    }
    if (entry['digest'] !== view.digest) {
      return {
        defect: `check ${check.id} cites evidence for ${JSON.stringify(field)} whose digest does not match the admitted source ${JSON.stringify(role)}`,
      };
    }
    evidence.push({
      role,
      field,
      digest: view.digest,
      ...(isNonEmptyString(entry['detail']) ? { detail: entry['detail'] } : {}),
      ...(isNonEmptyString(entry['declaration']) ? { declaration: entry['declaration'] } : {}),
    });
  }
  if (satisfiedValue && failures.length + gaps.length > 0) {
    return {
      defect: `check ${check.id} claims the fact is satisfied while also recording ${failures.length + gaps.length} finding(s)`,
    };
  }
  if (satisfiedValue && evidence.length === 0) {
    return { defect: `check ${check.id} claims the fact is satisfied without citing applicable evidence` };
  }
  return { outcome: { satisfied: satisfiedValue, evidence, failures, gaps } };
}

interface AssertionBucket {
  readonly failures: string[];
  readonly gaps: string[];
}

/**
 * Evaluate every declared check and derive the requirement's assertion verdicts.
 *
 * All checks run: one check's defect or failure never stops another. Verdicts come
 * only from the reduction, and every reason retains its attribution.
 */
export function runChecks(spec: RequirementChecks, context: CheckContext): CheckedResult {
  const declared = new Set(spec.assertions);
  const required = new Set(spec.required);
  const defects: string[] = [];
  const receipts: CheckReceipt[] = [];
  const buckets = new Map<string, AssertionBucket>();
  const bucket = (assertion: string): AssertionBucket => {
    const existing = buckets.get(assertion);
    if (existing !== undefined) return existing;
    const created: AssertionBucket = { failures: [], gaps: [] };
    buckets.set(assertion, created);
    return created;
  };

  // The inventory is validated against the contract before any observation is read.
  const implemented = new Map<string, Check>();
  const decided = new Set<string>();
  for (const check of spec.checks) {
    if (implemented.has(check.id)) {
      defects.push(`check id ${JSON.stringify(check.id)} is declared more than once`);
      continue;
    }
    if (!required.has(check.id)) {
      defects.push(
        `check ${JSON.stringify(check.id)} is not in the declared inventory for ${spec.requirementId}`,
      );
      continue;
    }
    if (!declared.has(check.assertion)) {
      defects.push(
        `check ${JSON.stringify(check.id)} names assertion ${JSON.stringify(check.assertion)}, which ${spec.requirementId} does not declare`,
      );
      continue;
    }
    implemented.set(check.id, check);
    decided.add(check.assertion);
  }
  for (const checkId of spec.required) {
    if (!implemented.has(checkId)) {
      defects.push(`required check ${JSON.stringify(checkId)} is not implemented`);
    }
  }
  for (const [assertion, reason] of spec.unsupported) {
    if (!declared.has(assertion)) {
      defects.push(
        `${spec.requirementId} declares ${JSON.stringify(assertion)} unsupported, but the contract does not declare it`,
      );
      continue;
    }
    if (decided.has(assertion)) {
      defects.push(
        `assertion ${JSON.stringify(assertion)} is declared unsupported and also has an implemented check`,
      );
      continue;
    }
    bucket(assertion).gaps.push(`${assertion}: ${reason}`);
  }

  for (const check of implemented.values()) {
    let raw: unknown;
    try {
      raw = check.run(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const defect = `check ${JSON.stringify(check.id)} threw: ${message}`;
      defects.push(defect);
      bucket(check.assertion).gaps.push(`internal check defect: ${defect}`);
      receipts.push({
        check: check.id,
        assertion: check.assertion,
        verdict: 'inconclusive',
        satisfied: false,
        evidence: [],
        failures: [],
        gaps: [],
        defect,
      });
      continue;
    }
    const validated = validateOutcome(check, raw, context);
    if ('defect' in validated) {
      defects.push(validated.defect);
      bucket(check.assertion).gaps.push(`internal check defect: ${validated.defect}`);
      receipts.push({
        check: check.id,
        assertion: check.assertion,
        verdict: 'inconclusive',
        satisfied: false,
        evidence: [],
        failures: [],
        gaps: [],
        defect: validated.defect,
      });
      continue;
    }
    const result = validated.outcome;
    // A well-formed outcome that neither establishes the fact nor explains why is
    // an unexplained result: it becomes an explicit gap, never a pass.
    const gaps = [...result.gaps];
    if (!result.satisfied && result.failures.length === 0 && gaps.length === 0) {
      gaps.push(
        `check ${JSON.stringify(check.id)} did not establish ${check.assertion} and recorded no reason`,
      );
    }
    const verdict = reduce(result.failures, gaps);
    const target = bucket(check.assertion);
    target.failures.push(...result.failures);
    target.gaps.push(...gaps);
    receipts.push({
      check: check.id,
      assertion: check.assertion,
      verdict,
      satisfied: result.satisfied,
      evidence: result.evidence,
      failures: result.failures,
      gaps,
    });
  }

  for (const assertion of spec.assertions) {
    if (!decided.has(assertion) && !spec.unsupported.has(assertion)) {
      bucket(assertion).gaps.push(
        `no evidence check decides ${assertion}, and no unsupported reason is declared for it`,
      );
    }
  }

  const assertions = new Map<string, Verdict>();
  const failures: string[] = [];
  const gaps: string[] = [];
  for (const assertion of spec.assertions) {
    const target = bucket(assertion);
    assertions.set(assertion, reduce(target.failures, target.gaps));
    failures.push(...target.failures);
    gaps.push(...target.gaps);
  }

  return {
    assertions,
    failures: Array.from(new Set(failures)),
    gaps: Array.from(new Set(gaps)),
    defects: Array.from(new Set(defects)),
    receipts,
    observations: {
      requirement: spec.requirementId,
      checksEvaluated: receipts.map((receipt) => receipt.check),
      ...(defects.length === 0 ? {} : { internalDefects: Array.from(new Set(defects)) }),
    },
  };
}
