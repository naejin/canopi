/**
 * Q-PREP-1 - bounded preparation preserving originals.
 *
 * Preparation is measured through the q3-prepare report's own named assertions,
 * paired with the sidecar policy the declaration records. The sidecar assertion is
 * decided by that policy and the recorded hashes, never by the absence of a record:
 * "unmeasured" is a gap, while "measured" with disagreeing hashes is a failure.
 */

import { asArray, describe, isNonEmptyString, isRecord } from '../fields.js';
import { isSha256 } from '../declaration.js';
import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { named } from './numericTransport.js';
import { worse, type Verdict } from '../verdict.js';

/** Producer assertion name for each contract assertion. */
const SOURCE_NAMES: ReadonlyMap<string, string> = new Map([
  ['original-bytes-unchanged', 'original-unchanged'],
  ['original-matches-recorded-hash', 'original-hash-declared'],
  ['derivative-cell-exact', 'cell-exact'],
  ['derivative-preserves-metadata', 'geotransform-preserved'],
  ['derivative-windows-match-original', 'all-values-match'],
]);

/**
 * Assertions the contract obligation spans more than one producer check for.
 *
 * The producer reports tiling and block bounding separately, while the contract asks
 * whether the derivative is both tiled *and* bounded. Reading only `derived-tiled`
 * would accept an unbounded tiled derivative, so both are required.
 */
const COMBINED_SOURCE_NAMES: ReadonlyMap<string, readonly string[]> = new Map([
  ['derivative-is-tiled-and-bounded', ['derived-tiled', 'derived-block-bounded']],
]);

const ASSERTIONS = [
  'original-bytes-unchanged',
  'original-matches-recorded-hash',
  'sidecar-unchanged',
  'derivative-is-tiled-and-bounded',
  'derivative-cell-exact',
  'derivative-preserves-metadata',
  'derivative-windows-match-original',
];

export function mapPreparation(source: SourceView | undefined): MappingResult {
  const assertions = unresolved(ASSERTIONS);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['q3prepare'] as const,
    source: 'reports/q3-prepare.json',
    legacyProducerCommand: 'measure.py q3-prepare --original <tif> --derived <cog> --out reports/q3-prepare.json',
    route: 'native preparation of a managed original into a bounded, addressable derivative',
    artifact: { name: 'gdal', version: '3.8.4' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  if (source === undefined || source.facts === undefined || source.shape === undefined) {
    return { assertions, observations, failures, gaps: ['no preparation report was available'], ...base };
  }

  const named_ = source.facts.assertions;
  for (const [assertion, sourceName] of SOURCE_NAMES) {
    assertions.set(assertion, named(named_, sourceName));
  }
  for (const [assertion, sourceNames] of COMBINED_SOURCE_NAMES) {
    // The more severe of the contributing checks decides the obligation.
    assertions.set(
      assertion,
      sourceNames
        .map((sourceName) => named(named_, sourceName))
        .reduce((a, b) => worse(a, b), 'pass' as Verdict),
    );
  }
  assertions.set('sidecar-unchanged', sidecarVerdict(source, failures, gaps, observations));

  return { assertions, observations, failures, gaps, ...base };
}

/**
 * The sidecar assertion, decided by the declared policy.
 *
 * - `not_applicable` passes, because a declared absence of a sidecar is a
 *   deliberate statement;
 * - `measured` requires both recorded hashes to agree, the sidecar to have
 *   survived, and any declared expected hash to match;
 * - an unstated policy is a gap, because nothing established whether one applies.
 */
/**
 * The sidecar assertion, decided by the declared policy and the recorded evidence.
 *
 * A `measured` policy asserts that a sidecar was present and still present
 * afterwards. Equality of two recorded hashes does not establish that on its own: the
 * record must say when each hash was taken and that the sidecar survived, or the
 * claim is unmeasured. A digest that cannot be a digest is malformed input, so it
 * fails rather than becoming a gap.
 */
function sidecarVerdict(
  source: SourceView,
  failures: string[],
  gaps: string[],
  observations: Record<string, unknown>,
): Verdict {
  const identity = source.facts?.identity;
  const policy = identity?.['sidecarPolicy'];
  if (!isNonEmptyString(policy)) {
    gaps.push('the preparation report does not declare a sidecar policy');
    return 'inconclusive';
  }
  observations['sidecarPolicy'] = policy;
  if (policy === 'not_applicable') {
    // A declared absence of a sidecar is a deliberate statement about the fixture,
    // not an omission, so the obligation is satisfied.
    return 'pass';
  }
  if (policy !== 'measured') {
    gaps.push(
      `the preparation report declares an unrecognised sidecar policy ${JSON.stringify(policy)}`,
    );
    return 'inconclusive';
  }

  const rawSidecar = source.shape?.value['sidecar'];
  if (rawSidecar === undefined) {
    gaps.push('the sidecar policy is measured but no sidecar record was supplied');
    return 'inconclusive';
  }
  if (!isRecord(rawSidecar)) {
    failures.push(`the sidecar record is ${describe(rawSidecar)}, not an object`);
    return 'fail';
  }

  const expected = rawSidecar['expectedSha256'];
  const actual = rawSidecar['sha256'];
  // A present value that cannot be a digest is malformed input, while an absent one
  // is a gap. The distinction is what keeps a mistyped hash from reading as missing.
  if (expected !== undefined && expected !== null && !isSha256(expected)) {
    failures.push(
      `the sidecar expected hash is ${describe(expected)}, which is not a SHA-256 digest`,
    );
    return 'fail';
  }
  if (actual !== undefined && actual !== null && !isSha256(actual)) {
    failures.push(
      `the sidecar observed hash is ${describe(actual)}, which is not a SHA-256 digest`,
    );
    return 'fail';
  }
  // A present observation that the sidecar is gone is a failure, and it is read
  // before any missing-hash gap: the survival observation is independent of the
  // hashes, so an absent hash must not soften a recorded disappearance.
  const before = rawSidecar['before'];
  const after = rawSidecar['after'];
  observations['sidecar'] = { expected: expected ?? null, actual: actual ?? null, before: before ?? null, after: after ?? null };

  const gone = after === 'absent' || after === false;
  if (gone) {
    failures.push('the sidecar did not survive preparation');
    return 'fail';
  }
  const presentBefore = before === undefined || before === null
    ? undefined
    : before === 'present' || before === true;
  if (presentBefore === false) {
    failures.push(
      `the sidecar was recorded as ${describe(before)} before preparation, so it was not there to preserve`,
    );
    return 'fail';
  }

  if (!isSha256(expected) || !isSha256(actual)) {
    gaps.push('the sidecar record does not record both its expected and observed hash');
    return 'inconclusive';
  }

  if (expected !== actual) {
    failures.push(`sidecar changed: observed ${actual} but expected ${expected}`);
    return 'fail';
  }

  // Preservation is a *pair* of observations: the sidecar was there, and it was still
  // there afterwards. Either half alone is unmeasured, and two equal hashes say only
  // that the same value was written twice.
  const survived = after === 'present' || after === true;
  if (!survived) {
    gaps.push(
      'the sidecar record does not observe that the sidecar survived preparation, so its preservation is unmeasured',
    );
    return 'inconclusive';
  }
  if (presentBefore === undefined) {
    gaps.push(
      'the sidecar record does not observe that the sidecar was present before preparation, so its preservation is unmeasured',
    );
    return 'inconclusive';
  }
  const declared = isRecord(identity?.['sidecarSha256'])
    ? identity['sidecarSha256']['expected']
    : undefined;
  if (declared !== undefined && declared !== null) {
    if (!isSha256(declared)) {
      failures.push(
        `the declared sidecar hash is ${describe(declared)}, which is not a SHA-256 digest`,
      );
      return 'fail';
    }
    if (declared !== expected) {
      failures.push(`sidecar hash conflict: declared ${declared} but the report records ${expected}`);
      return 'fail';
    }
  }
  return 'pass';
}
