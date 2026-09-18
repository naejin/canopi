/**
 * The declared qualification run.
 *
 * This module turns declared expectations plus raw source paths into the one
 * authoritative decision. It is the only place that knows which report role feeds
 * which requirement, and the only place that assembles the full verdict.
 *
 * A bundle is never an input. If a caller wants a decision re-derived, it supplies
 * the original sources and the declarations again, so admission and verdicts are
 * recomputed rather than read back from a serialized label.
 */

import { DECLARATIONS, declaredRoute, expectationsForRole } from './declared/route.js';
import { prepare, decideRequirement, overallVerdict, type Decision, type Prepared, type QualificationInput, type RequirementVerdict } from './decide.js';
import type { Contract, Validation, FixtureManifest, PinDeclaration } from './declaration.js';
import type { SourceExpectations } from './admit.js';
import { MAPPINGS } from './evidence/registry.js';
import type { SourceView } from './decide.js';

export interface QualificationRequest {
  readonly contract: Contract;
  readonly sources: readonly {
    readonly role: string;
    readonly path: string;
  }[];
  readonly now: number;
  readonly synthetic?: boolean;
  readonly fixtureManifest: Validation<FixtureManifest>;
  readonly pins: Validation<PinDeclaration>;
}

export type QualificationOutcome =
  | { ok: true; decision: Decision; exitCode: number }
  | { ok: false; problems: readonly string[]; exitCode: number };

/** The decision document version this build emits. */
export const DECISION_VERSION = 1;

export function runQualification(request: QualificationRequest): QualificationOutcome {
  const problems: string[] = [];
  // A declaration this build cannot use is an evaluator-input failure. It is
  // reported rather than downgraded, because a declaration that cannot be read is
  // not the same finding as evidence that was never collected.
  if (request.fixtureManifest.verdict === 'fail') {
    problems.push(
      ...request.fixtureManifest.problems.map((problem) => `invalid declaration: ${problem}`),
    );
  }
  if (request.pins.verdict === 'fail') {
    problems.push(...request.pins.problems.map((problem) => `invalid declaration: ${problem}`));
  }
  if (problems.length > 0) {
    return { ok: false, problems, exitCode: 2 };
  }

  const input: QualificationInput = {
    contract: request.contract,
    now: request.now,
    synthetic: request.synthetic === true,
    sources: request.sources.map((source) => {
      // The expectations come from the declared route for the role. A caller cannot
      // supply them, so a source cannot nominate what it should be checked against.
      const declared = expectationsForRole(source.role);
      if (declared === undefined) {
        throw new Error(`no declared expectations for role ${source.role}`);
      }
      return {
      role: source.role,
      label: source.path,
      path: source.path,
      expectations: {
        ...declared,
        now: request.now,
        // The declaration travels with every source, so a source cannot be read
        // without the expectations it is checked against.
        ...(request.fixtureManifest.value === undefined
          ? {}
          : { fixtureManifest: request.fixtureManifest.value }),
        ...(request.pins.value === undefined ? {} : { declaredPins: request.pins.value }),
        fixtureManifestVerdict: request.fixtureManifest.verdict,
        fixtureManifestProblems: request.fixtureManifest.problems,
        pinVerdict: request.pins.verdict,
        pinProblems: request.pins.problems,
      },
      };
    }),
  };

  const prepared = prepare(input);
  const requirements: RequirementVerdict[] = [];
  for (const spec of request.contract.requirements) {
    if (!spec.required) {
      requirements.push({
        id: spec.id,
        title: spec.title,
        verdict: 'inconclusive',
        assertions: new Map(),
        observed: new Map(),
        reasons: [`no Q obligation recorded (${spec.phase})`],
        admission: {
          label: spec.id,
          verdict: 'inconclusive',
          sourceAdmitted: false,
          reasons: [`${spec.id} is not a required obligation`],
          identity: {},
          positiveFailures: [],
          negativeControlFailures: [],
        },
        source: 'not applicable',
        observations: {},
      });
      continue;
    }
    const mapping = MAPPINGS.get(spec.id);
    if (mapping === undefined) {
      // An obligation with no mapping is a gap, never a pass. It is also a build
      // defect, so it is stated explicitly rather than silently skipped.
      requirements.push(unmapped(spec.id, spec.title, spec.assertions));
      continue;
    }
    requirements.push(decideRequirement(request.contract, prepared, mapping, spec.id));
  }

  const decision: Decision = {
    version: DECISION_VERSION,
    verdict: overallVerdict(requirements),
    requirements,
    generatedAt: request.now,
    synthetic: request.synthetic === true,
    contractSource: request.contract.source,
    sources: prepared.admitted.map((entry) => ({
      label: entry.label,
      status: entry.snapshot.status,
      ...(entry.snapshot.digest === undefined ? {} : { digest: entry.snapshot.digest }),
    })),
  };
  return { ok: true, decision, exitCode: decision.verdict === 'pass' ? 0 : 1 };
}

function unmapped(
  id: string,
  title: string,
  assertions: readonly string[],
): RequirementVerdict {
  return {
    id,
    title,
    verdict: 'inconclusive',
    assertions: new Map(assertions.map((assertion) => [assertion, 'inconclusive' as const])),
    observed: new Map(),
    reasons: [`no evidence mapping is implemented for ${id}, so it cannot pass`],
    admission: {
      label: id,
      verdict: 'inconclusive',
      sourceAdmitted: false,
      reasons: [`no evidence mapping is implemented for ${id}`],
      identity: {},
      positiveFailures: [],
      negativeControlFailures: [],
    },
    source: 'not mapped',
    observations: {},
  };
}

export { DECLARATIONS, declaredRoute, prepare };
export type { Prepared, SourceView };
