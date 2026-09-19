/**
 * Q-VALUE-1 - scientific values and exact validity.
 *
 * Two sources decide this requirement and both must be admitted: the numeric report
 * for value and validity agreement, and the slope report for the derived product.
 * Fixture-class coverage has no producer and is declared unsupported.
 */

import { namedCheck, prefixCheck } from './records.js';
import type { RequirementChecks } from './checks.js';

export const VALUE_CHECKS: RequirementChecks = {
  requirementId: 'Q-VALUE-1',
  assertions: [
    'values-match-analytic-expectation',
    'validity-matches-reference-exactly',
    'nodata-reported-invalid',
    'valid-zero-and-negative-retained',
    'slope-degrees-within-tolerance',
    'slope-percent-within-tolerance',
    'blocked-slope-agrees-at-seams',
    'holes-and-edges-not-interpolated',
    'required-fixture-classes-covered',
  ],
  required: [
    'values.analytic',
    'values.validity',
    'values.zero-negative',
    'values.nodata',
    'values.slope-degrees',
    'values.slope-percent',
    'values.seams',
    'values.holes-edges',
  ],
  unsupported: new Map<string, string>([
    [
      'required-fixture-classes-covered',
      'no producer reports per-fixture-class coverage of the required fixture set',
    ],
  ]),
  checks: [
    prefixCheck(
      'values.analytic',
      'values-match-analytic-expectation',
      'q2',
      'analytic:',
      'analytic comparison(s)',
    ),
    prefixCheck(
      'values.validity',
      'validity-matches-reference-exactly',
      'q2',
      'validity:',
      'validity comparison(s)',
    ),
    prefixCheck(
      'values.zero-negative',
      'valid-zero-and-negative-retained',
      'q2',
      'zero-negative-retained:',
      'zero/negative retention assertion(s)',
    ),
    prefixCheck(
      'values.nodata',
      'nodata-reported-invalid',
      'q4slope',
      'hole-centre-not-interpolated:',
      'hole-centre assertion(s)',
    ),
    prefixCheck(
      'values.slope-degrees',
      'slope-degrees-within-tolerance',
      'q4slope',
      'degrees:',
      'degree tolerance assertion(s)',
    ),
    prefixCheck(
      'values.slope-percent',
      'slope-percent-within-tolerance',
      'q4slope',
      'percent:',
      'percent tolerance assertion(s)',
    ),
    namedCheck('values.seams', 'blocked-slope-agrees-at-seams', 'q4slope', 'seam-matches-whole'),
    prefixCheck(
      'values.holes-edges',
      'holes-and-edges-not-interpolated',
      'q4slope',
      'outer-edge',
      'outer-edge assertion(s)',
    ),
  ],
};

export const VALUE_PROVENANCE = {
  sourceRoles: ['q2', 'q4slope'] as const,
  source: 'reports/q4-slope.json',
  legacyProducerCommand: 'measure.py q4-slope --fixtures <fx> --out reports/q4-slope.json',
  route: 'native GDAL slope plus independent Horn implementation',
  artifact: { name: 'gdal', version: '3.8.4' },
  fixtures: [] as { name: string; sha256?: string }[],
};
