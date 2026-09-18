/**
 * Q-PREP-1 - bounded preparation preserving originals.
 *
 * Preparation is measured through the q3-prepare report's own named assertions,
 * paired with the sidecar policy the declaration records. The sidecar assertion is
 * decided by that policy and the recorded hashes, never by the absence of a record:
 * "unmeasured" is a gap, while "measured" with disagreeing hashes is a failure.
 */

import { asArray, isNonEmptyString, isRecord } from '../fields.js';
import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { named } from './numericTransport.js';
import { type Verdict } from '../verdict.js';

/** Producer assertion name for each contract assertion. */
const SOURCE_NAMES: ReadonlyMap<string, string> = new Map([
  ['original-bytes-unchanged', 'original-unchanged'],
  ['original-matches-recorded-hash', 'original-hash-declared'],
  ['derivative-is-tiled-and-bounded', 'derived-tiled'],
  ['derivative-cell-exact', 'cell-exact'],
  ['derivative-preserves-metadata', 'geotransform-preserved'],
  ['derivative-windows-match-original', 'all-values-match'],
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
  if (policy === 'not_applicable') return 'pass';
  if (policy !== 'measured') {
    gaps.push(`the preparation report declares an unrecognised sidecar policy ${JSON.stringify(policy)}`);
    return 'inconclusive';
  }
  const sidecar = isRecord(source.shape?.value['sidecar']) ? source.shape.value['sidecar'] : undefined;
  if (sidecar === undefined) {
    gaps.push('the sidecar policy is measured but no sidecar record was supplied');
    return 'inconclusive';
  }
  const expected = sidecar['expectedSha256'];
  const actual = sidecar['sha256'];
  if (!isNonEmptyString(expected) || !isNonEmptyString(actual)) {
    gaps.push('the sidecar record does not record both its expected and observed hash');
    return 'inconclusive';
  }
  observations['sidecar'] = { expected, actual, after: sidecar['after'] ?? null };
  if (expected !== actual) {
    failures.push(`sidecar changed: observed ${actual} but expected ${expected}`);
    return 'fail';
  }
  if (sidecar['after'] === false) {
    failures.push('the sidecar did not survive preparation');
    return 'fail';
  }
  const declared = isRecord(identity?.['sidecarSha256']) ? identity['sidecarSha256']['expected'] : undefined;
  if (isNonEmptyString(declared) && declared !== expected) {
    failures.push(`sidecar hash conflict: declared ${declared} but the report records ${expected}`);
    return 'fail';
  }
  return 'pass';
}

void asArray;
