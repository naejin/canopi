/**
 * Q-VALUE-1 - scientific values and exact validity.
 *
 * This requirement draws on two sources: the numeric report for value and validity
 * agreement, and the slope report for the derived product. Both must be admitted,
 * because a requirement drawing on several sources cannot be satisfied on the
 * strength of the passing ones alone.
 */

import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { allNamed, named } from './numericTransport.js';

const ASSERTIONS = [
  'values-match-analytic-expectation',
  'validity-matches-reference-exactly',
  'nodata-reported-invalid',
  'valid-zero-and-negative-retained',
  'slope-degrees-within-tolerance',
  'slope-percent-within-tolerance',
  'blocked-slope-agrees-at-seams',
  'holes-and-edges-not-interpolated',
  'required-fixture-classes-covered',
];

/** Assertions no producer observes, with the reason each stays a gap. */
export const UNSUPPORTED_ASSERTIONS: ReadonlyMap<string, string> = new Map([
  [
    'required-fixture-classes-covered',
    'no producer reports per-fixture-class coverage of the required fixture set',
  ],
]);

export function mapValues(
  numeric: SourceView | undefined,
  slope: SourceView | undefined,
): MappingResult {
  const assertions = unresolved(ASSERTIONS);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['q2', 'q4slope'] as const,
    source: 'reports/q4-slope.json',
    legacyProducerCommand: 'measure.py q4-slope --fixtures <fx> --out reports/q4-slope.json',
    route: 'native GDAL slope plus independent Horn implementation',
    artifact: { name: 'gdal', version: '3.8.4' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  for (const [assertion, reason] of UNSUPPORTED_ASSERTIONS) {
    assertions.set(assertion, 'inconclusive');
    gaps.push(`${assertion}: ${reason}`);
  }

  const numericAssertions = numeric?.facts?.assertions;
  const slopeAssertions = slope?.facts?.assertions;

  // Value and validity agreement come from the numeric report.
  assertions.set(
    'values-match-analytic-expectation',
    numericAssertions === undefined ? 'inconclusive' : allNamed(numericAssertions, 'analytic:'),
  );
  assertions.set(
    'validity-matches-reference-exactly',
    numericAssertions === undefined ? 'inconclusive' : allNamed(numericAssertions, 'validity:'),
  );
  assertions.set(
    'valid-zero-and-negative-retained',
    numericAssertions === undefined
      ? 'inconclusive'
      : allNamed(numericAssertions, 'zero-negative-retained:'),
  );

  if (slopeAssertions === undefined) {
    gaps.push('no slope report was available, so the derived-product assertions are gaps');
  } else {
    assertions.set(
      'nodata-reported-invalid',
      allNamed(slopeAssertions, 'hole-centre-not-interpolated:'),
    );
    assertions.set('slope-degrees-within-tolerance', allNamed(slopeAssertions, 'degrees:'));
    assertions.set('slope-percent-within-tolerance', allNamed(slopeAssertions, 'percent:'));
    assertions.set('blocked-slope-agrees-at-seams', named(slopeAssertions, 'seam-matches-whole'));
    assertions.set('holes-and-edges-not-interpolated', allNamed(slopeAssertions, 'outer-edge'));
  }

  return { assertions, observations, failures, gaps, ...base };
}
