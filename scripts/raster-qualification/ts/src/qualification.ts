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

/**
 * The decision document version this build emits.
 *
 * Version 2 adds the explicit per-requirement check receipts and the recorded
 * internal-check defects. Version-1 documents are historical outputs and are never
 * read back as evidence, so no version-1 reader is maintained.
 */
export const DECISION_VERSION = 2;

export function runQualification(request: QualificationRequest): QualificationOutcome {
  const problems: string[] = [];

  // Every source role must be one the declared route knows, or nothing could be
  // checked against it. This is validated here rather than thrown, so the
  // programmatic caller receives the same structured outcome the CLI prints.
  for (const source of request.sources) {
    if (expectationsForRole(source.role) === undefined) {
      problems.push(
        `error: source ${source.role} has no declared expectations for this role`,
      );
    }
  }
  if (problems.length > 0) return { ok: false, problems, exitCode: 2 };
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
      // Already validated above, so the lookup cannot fail here.
      const declared = expectationsForRole(source.role)!;
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
        defects: [],
        checks: [],
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
    const entry = MAPPINGS.get(spec.id);
    if (entry === undefined) {
      // An obligation with no mapping is a gap, never a pass. It is also a build
      // defect, so it is stated explicitly rather than silently skipped.
      requirements.push(unmapped(spec.id, spec.title, spec.assertions));
      continue;
    }
    requirements.push(decideRequirement(request.contract, prepared, entry.mapping, spec.id));
  }

  const overall = overallVerdict(requirements);
  // Internal-check defects are defects in this tool, not measurements of the
  // engine, so they are recorded separately and drive an input-class exit status.
  const internalDefects = Array.from(
    new Set(requirements.flatMap((entry) => entry.defects)),
  ).sort();
  const decision: Decision = {
    version: DECISION_VERSION,
    internalDefects,
    // A synthetic control exercises the same real path with complete internally
    // coherent evidence, and is explicitly marked. It must never publish a
    // qualifying result, whatever the rest of the contract happens to say: relying
    // on unrelated permanent gaps to block it would make the exclusion incidental.
    verdict: request.synthetic === true && overall === 'pass' ? 'inconclusive' : overall,
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
  return {
    ok: true,
    decision,
    exitCode: internalDefects.length > 0 ? 2 : decision.verdict === 'pass' ? 0 : 1,
  };
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
    defects: [],
    checks: [],
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
