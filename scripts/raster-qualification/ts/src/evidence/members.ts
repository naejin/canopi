/**
 * Q-MEMBER-1 - resolved members and overview precedence.
 *
 * The overview-precedence assertion has no producer. It is an explicit gap rather
 * than a pass from adjacent results: the obligation is not met by evidence that was
 * never collected, and no probe currently observes it.
 */

import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { allNamed, named } from './numericTransport.js';

const ASSERTIONS = [
  'window-spanning-members-resolves',
  'unoccupied-slots-zero-coverage',
  'ordered-replacement-precedence',
  'nodata-does-not-erase-earlier-value',
  'overviews-do-not-resurrect-replaced-pixels',
];

/** Assertions no producer observes. Kept here so the gap is stated, not implied. */
export const UNSUPPORTED_ASSERTIONS: ReadonlyMap<string, string> = new Map([
  [
    'overviews-do-not-resurrect-replaced-pixels',
    'no probe observes overview precedence, so the obligation remains unmeasured',
  ],
]);

export function mapMembers(source: SourceView | undefined): MappingResult {
  const assertions = unresolved(ASSERTIONS);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['q3members'] as const,
    source: 'reports/q3-members.json',
    legacyProducerCommand: 'measure.py q3-members --collection <dir> --out reports/q3-members.json',
    route: 'ordered member replay (reference implementation)',
    artifact: { name: 'reference-resolver', version: 'harness' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  // Every unsupported assertion is reported, whether or not a report was supplied.
  for (const [assertion, reason] of UNSUPPORTED_ASSERTIONS) {
    assertions.set(assertion, 'inconclusive');
    gaps.push(`${assertion}: ${reason}`);
  }

  if (source === undefined || source.facts === undefined) {
    return { assertions, observations, failures, gaps: [...gaps, 'no member report was available'], ...base };
  }
  const named_ = source.facts.assertions;
  assertions.set('window-spanning-members-resolves', allNamed(named_, 'multi-member:'));
  assertions.set('unoccupied-slots-zero-coverage', allNamed(named_, 'gap-empty:'));
  assertions.set('ordered-replacement-precedence', named(named_, 'precedence-last-wins'));
  assertions.set('nodata-does-not-erase-earlier-value', named(named_, 'nodata-does-not-erase'));
  return { assertions, observations, failures, gaps, ...base };
}
