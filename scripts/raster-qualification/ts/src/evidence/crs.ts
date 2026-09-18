/**
 * Q-CRS-1 - CRS agreement.
 *
 * Every assertion is a named comparison the CRS report makes. A missing record is a
 * gap, so an absent comparison never reads as agreement.
 */

import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { named } from './numericTransport.js';

/** Producer assertion name for each contract assertion. */
const SOURCE_NAMES: ReadonlyMap<string, string> = new Map([
  ['reference-crs-configured-explicitly', 'reference-epsg-configured-explicitly'],
  ['crs-resolver-identified', 'crs-resolver-identified'],
  ['candidate-projection-within-tolerance', 'candidate-projection-matches-reference'],
  [
    'returned-coordinate-addresses-requested-pixel',
    'candidate-returned-coordinate-addresses-requested-pixel',
  ],
  ['no-metadata-rewritten-or-inferred', 'original-metadata-untouched'],
]);

export function mapCrs(source: SourceView | undefined): MappingResult {
  const assertions = unresolved(Array.from(SOURCE_NAMES.keys()));
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['q4crs'] as const,
    source: 'reports/q4-crs.json',
    legacyProducerCommand: 'measure.py q4-crs --fixture <tif> --out reports/q4-crs.json',
    route: 'native GDAL CRS resolution',
    artifact: { name: 'gdal', version: '3.8.4' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  if (source === undefined || source.facts === undefined) {
    return { assertions, observations, failures, gaps: ['no CRS report was available'], ...base };
  }
  const named_ = source.facts.assertions;
  for (const [assertion, sourceName] of SOURCE_NAMES) {
    assertions.set(assertion, named(named_, sourceName));
  }
  return { assertions, observations, failures, gaps, ...base };
}
