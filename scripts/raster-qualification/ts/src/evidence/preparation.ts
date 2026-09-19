/**
 * Q-PREP-1 - bounded preparation preserving originals, as explicit checks.
 *
 * The producer's own checks are read individually, and the sidecar obligation is
 * split into the three facts it actually needs: a declared policy, agreeing hashes,
 * and a survival observation before and after preparation. Two equal hashes say only
 * that the same value was written twice, so survival is decided on its own
 * observations and a recorded disappearance fails even when a hash is missing.
 */

import { describe, isNonEmptyString, isRecord } from '../fields.js';
import { isSha256 } from '../declaration.js';
import {
  contradicted,
  satisfied,
  sourceEvidence,
  unsatisfied,
  violated,
  type Check,
  type CheckContext,
  type EvidenceRef,
  type RequirementChecks,
} from './checks.js';
import { combinedCheck, namedCheck } from './records.js';

const ASSERTIONS = [
  'original-bytes-unchanged',
  'original-matches-recorded-hash',
  'sidecar-unchanged',
  'derivative-is-tiled-and-bounded',
  'derivative-cell-exact',
  'derivative-preserves-metadata',
  'derivative-windows-match-original',
];

const ROLE = 'q3prepare';

/** The declared sidecar policy, or the reason it cannot be read. */
function policyOf(context: CheckContext): {
  readonly policy?: string;
  readonly problem?: string;
  readonly reference?: EvidenceRef;
} {
  const view = context.byRole.get(ROLE);
  const reference = sourceEvidence(view, 'identity.sidecarPolicy');
  const policy = view?.facts?.identity?.['sidecarPolicy'];
  if (view === undefined || view.facts === undefined || view.shape === undefined || reference === undefined) {
    return { problem: 'no preparation report was available' };
  }
  if (!isNonEmptyString(policy)) {
    return { reference, problem: 'the preparation report does not declare a sidecar policy' };
  }
  return { policy, reference };
}

/** The sidecar record and the facts every sidecar check needs. */
function sidecarOf(context: CheckContext): {
  readonly present?: boolean;
  readonly malformed?: boolean;
  readonly record?: Record<string, unknown>;
  readonly problem?: string;
  readonly reference?: EvidenceRef;
} {
  const view = context.byRole.get(ROLE);
  const reference = sourceEvidence(view, 'sidecar');
  const raw = view?.shape?.value['sidecar'];
  if (view === undefined || view.shape === undefined || reference === undefined) {
    return { problem: 'no preparation report was available' };
  }
  if (raw === undefined) {
    return { reference, problem: 'the sidecar policy is measured but no sidecar record was supplied' };
  }
  if (!isRecord(raw)) {
    // A present record of the wrong shape is invalid input, not missing evidence.
    return {
      reference,
      problem: `the sidecar record is ${describe(raw)}, not an object`,
      present: true,
      malformed: true,
    };
  }
  return { present: true, record: raw, reference };
}

const sidecarPolicy: Check = {
  id: 'prep.sidecar-policy',
  assertion: 'sidecar-unchanged',
  run: (context) => {
    const read = policyOf(context);
    if (read.problem !== undefined) {
      return read.reference === undefined
        ? unsatisfied([read.problem])
        : unsatisfied([read.problem], [read.reference]);
    }
    if (read.policy === 'not_applicable') {
      // A declared absence of a sidecar is a deliberate statement about the fixture,
      // not an omission, so the obligation is satisfied by that declaration.
      return satisfied(read.reference === undefined ? [] : [read.reference]);
    }
    if (read.policy !== 'measured') {
      return unsatisfied(
        [`the preparation report declares an unrecognised sidecar policy ${JSON.stringify(read.policy)}`],
        read.reference === undefined ? [] : [read.reference],
      );
    }
    return satisfied(read.reference === undefined ? [] : [read.reference]);
  },
};

const sidecarHashes: Check = {
  id: 'prep.sidecar-hashes',
  assertion: 'sidecar-unchanged',
  run: (context) => {
    const policy = policyOf(context);
    if (policy.problem !== undefined) {
      return policy.reference === undefined
        ? unsatisfied([policy.problem])
        : unsatisfied([policy.problem], [policy.reference]);
    }
    if (policy.policy === 'not_applicable') {
      return satisfied(policy.reference === undefined ? [] : [policy.reference]);
    }
    const read = sidecarOf(context);
    if (read.problem !== undefined && read.record === undefined) {
      const refs = read.reference === undefined ? [] : [read.reference];
      return read.malformed === true ? violated([read.problem], refs) : unsatisfied([read.problem], refs);
    }
    const record = read.record ?? {};
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = read.reference === undefined ? [] : [read.reference];
    const expected = record['expectedSha256'];
    const actual = record['sha256'];
    // A present value that cannot be a digest is malformed input, while an absent one
    // is a gap. The distinction is what keeps a mistyped hash from reading as missing.
    for (const [key, value] of [
      ['expected', expected],
      ['observed', actual],
    ] as const) {
      if (value === undefined || value === null) continue;
      if (!isSha256(value)) {
        failures.push(`the sidecar ${key} hash is ${describe(value)}, which is not a SHA-256 digest`);
      }
    }
    if (failures.length === 0) {
      if (!isSha256(expected) || !isSha256(actual)) {
        gaps.push('the sidecar record does not record both its expected and observed hash');
      } else if (expected !== actual) {
        failures.push(`sidecar changed: observed ${actual} but expected ${expected}`);
      } else {
        const ref = sourceEvidence(context.byRole.get(ROLE), 'sidecar.sha256', actual);
        if (ref !== undefined) evidence.push(ref);
      }
    }
    const identity = context.byRole.get(ROLE)?.facts?.identity;
    const declared = isRecord(identity?.['sidecarSha256']) ? identity['sidecarSha256']['expected'] : undefined;
    if (declared !== undefined && declared !== null) {
      if (!isSha256(declared)) {
        failures.push(`the declared sidecar hash is ${describe(declared)}, which is not a SHA-256 digest`);
      } else if (isSha256(expected) && declared !== expected) {
        failures.push(`sidecar hash conflict: declared ${declared} but the report records ${expected}`);
      }
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const sidecarSurvival: Check = {
  id: 'prep.sidecar-survival',
  assertion: 'sidecar-unchanged',
  run: (context) => {
    const policy = policyOf(context);
    if (policy.problem !== undefined) {
      return policy.reference === undefined
        ? unsatisfied([policy.problem])
        : unsatisfied([policy.problem], [policy.reference]);
    }
    if (policy.policy === 'not_applicable') {
      return satisfied(policy.reference === undefined ? [] : [policy.reference]);
    }
    const read = sidecarOf(context);
    if (read.problem !== undefined && read.record === undefined) {
      const refs = read.reference === undefined ? [] : [read.reference];
      return read.malformed === true ? violated([read.problem], refs) : unsatisfied([read.problem], refs);
    }
    const record = read.record ?? {};
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = read.reference === undefined ? [] : [read.reference];
    const before = record['before'];
    const after = record['after'];
    // A present observation that the sidecar is gone is a failure, and it is read
    // before any missing-observation gap: survival is independent of the hashes.
    if (after === 'absent' || after === false) {
      failures.push('the sidecar did not survive preparation');
    } else if (after === 'present' || after === true) {
      const ref = sourceEvidence(context.byRole.get(ROLE), 'sidecar.after', 'present');
      if (ref !== undefined) evidence.push(ref);
    } else {
      gaps.push(
        'the sidecar record does not observe that the sidecar survived preparation, so its preservation is unmeasured',
      );
    }
    if (before === false || (before !== undefined && before !== null && before !== true && before !== 'present')) {
      failures.push(
        `the sidecar was recorded as ${describe(before)} before preparation, so it was not there to preserve`,
      );
    } else if (before === true || before === 'present') {
      const ref = sourceEvidence(context.byRole.get(ROLE), 'sidecar.before', 'present');
      if (ref !== undefined) evidence.push(ref);
    } else {
      gaps.push(
        'the sidecar record does not observe that the sidecar was present before preparation, so its preservation is unmeasured',
      );
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

export const PREPARATION_CHECKS: RequirementChecks = {
  requirementId: 'Q-PREP-1',
  assertions: ASSERTIONS,
  required: [
    'prep.original-unchanged',
    'prep.original-hash',
    'prep.derivative-tiled-and-bounded',
    'prep.cell-exact',
    'prep.metadata-preserved',
    'prep.windows-match',
    'prep.sidecar-policy',
    'prep.sidecar-hashes',
    'prep.sidecar-survival',
  ],
  unsupported: new Map<string, string>(),
  checks: [
    namedCheck('prep.original-unchanged', 'original-bytes-unchanged', ROLE, 'original-unchanged'),
    namedCheck('prep.original-hash', 'original-matches-recorded-hash', ROLE, 'original-hash-declared'),
    // The producer reports tiling and block bounding separately, while the contract
    // asks whether the derivative is both tiled *and* bounded.
    combinedCheck('prep.derivative-tiled-and-bounded', 'derivative-is-tiled-and-bounded', ROLE, [
      'derived-tiled',
      'derived-block-bounded',
    ]),
    namedCheck('prep.cell-exact', 'derivative-cell-exact', ROLE, 'cell-exact'),
    namedCheck(
      'prep.metadata-preserved',
      'derivative-preserves-metadata',
      ROLE,
      'geotransform-preserved',
    ),
    namedCheck('prep.windows-match', 'derivative-windows-match-original', ROLE, 'all-values-match'),
    sidecarPolicy,
    sidecarHashes,
    sidecarSurvival,
  ],
};

export const PREPARATION_PROVENANCE = {
  sourceRoles: ['q3prepare'] as const,
  source: 'reports/q3-prepare.json',
  legacyProducerCommand:
    'measure.py q3-prepare --original <tif> --derived <cog> --out reports/q3-prepare.json',
  route: 'native preparation of a managed original into a bounded, addressable derivative',
  artifact: { name: 'gdal', version: '3.8.4' },
  fixtures: [] as { name: string; sha256?: string }[],
};
