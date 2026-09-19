/**
 * Requirement mappings.
 *
 * Each requirement owns the mapping that turns its admitted sources into assertion
 * verdicts. A mapping passes an assertion only on a positive observation the
 * producer recorded, or on a comparison the declaration makes possible; an absent
 * observation is an explicit gap, and a recorded value that contradicts the
 * declaration is a failure.
 */

import type { SourceView } from '../decide.js';
import type { Verdict } from '../verdict.js';
import { runChecks, type CheckReceipt, type RequirementChecks } from './checks.js';

export interface MappingContext {
  /** The admitted sources available to this requirement, by role. */
  readonly byRole: ReadonlyMap<string, SourceView>;
}

export interface MappingResult {
  readonly assertions: ReadonlyMap<string, Verdict>;
  readonly observations: Record<string, unknown>;
  /** Findings this mapping produced beyond the raw assertion verdicts. */
  readonly failures: readonly string[];
  readonly gaps: readonly string[];
  /** Structured internal-check defects the driver found, if any. */
  readonly defects?: readonly string[];
  /** One receipt per executed check, for the decision document. */
  readonly checks?: readonly CheckReceipt[];
  /** Which admitted sources this requirement draws on, in order. */
  readonly sourceRoles: readonly string[];
  readonly source: string;
  /** The legacy producer command that wrote this report, recorded for provenance. */
  readonly legacyProducerCommand: string;
  readonly route: string;
  readonly artifact: Record<string, unknown>;
  readonly fixtures: readonly { name: string; sha256?: string }[];
}

export type RequirementMapping = (context: MappingContext) => MappingResult;

/** The provenance every mapping records, independent of how it decides. */
export interface MappingProvenance {
  readonly sourceRoles: readonly string[];
  readonly source: string;
  readonly legacyProducerCommand: string;
  readonly route: string;
  readonly artifact: Record<string, unknown>;
  readonly fixtures: readonly { name: string; sha256?: string }[];
}

/**
 * A mapping whose assertions are decided by declared checks.
 *
 * The mapping owns provenance only: every verdict, reason and receipt comes from the
 * driver, so a migrated requirement has exactly one writer for its assertions.
 */
export function checkedMapping(
  spec: RequirementChecks,
  provenance: MappingProvenance,
): RequirementMapping {
  return (context) => {
    const result = runChecks(spec, { requirementId: spec.requirementId, byRole: context.byRole });
    return {
      assertions: result.assertions,
      observations: result.observations,
      failures: result.failures,
      gaps: result.gaps,
      defects: result.defects,
      checks: result.receipts,
      ...provenance,
    };
  };
}

/** Every assertion unknown, ready for a mapping to fill in. */
export function unresolved(assertions: readonly string[]): Map<string, Verdict> {
  return new Map(assertions.map((id) => [id, 'inconclusive' as Verdict]));
}
