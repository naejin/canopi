/**
 * Q-CRS-1 - CRS agreement.
 *
 * Every assertion is a named comparison the CRS report makes. A missing record is a
 * gap, so an absent comparison never reads as agreement.
 */

import { namedCheck } from './records.js';
import type { RequirementChecks } from './checks.js';

/** Producer assertion name for each contract assertion. */
const SOURCE_NAMES: readonly (readonly [string, string])[] = [
  ['reference-crs-configured-explicitly', 'reference-epsg-configured-explicitly'],
  ['crs-resolver-identified', 'crs-resolver-identified'],
  ['candidate-projection-within-tolerance', 'candidate-projection-matches-reference'],
  [
    'returned-coordinate-addresses-requested-pixel',
    'candidate-returned-coordinate-addresses-requested-pixel',
  ],
  ['no-metadata-rewritten-or-inferred', 'original-metadata-untouched'],
];

export const CRS_CHECKS: RequirementChecks = {
  requirementId: 'Q-CRS-1',
  assertions: SOURCE_NAMES.map(([assertion]) => assertion),
  required: SOURCE_NAMES.map(([assertion]) => `crs.${assertion}`),
  unsupported: new Map<string, string>(),
  checks: SOURCE_NAMES.map(([assertion, sourceName]) =>
    namedCheck(`crs.${assertion}`, assertion, 'q4crs', sourceName),
  ),
};

export const CRS_PROVENANCE = {
  sourceRoles: ['q4crs'] as const,
  source: 'reports/q4-crs.json',
  legacyProducerCommand: 'measure.py q4-crs --fixture <tif> --out reports/q4-crs.json',
  route: 'native GDAL CRS resolution',
  artifact: { name: 'gdal', version: '3.8.4' },
  fixtures: [] as { name: string; sha256?: string }[],
};
