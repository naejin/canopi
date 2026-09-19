/**
 * Q-MEMBER-1 - resolved members and overview precedence.
 *
 * The overview-precedence assertion has no producer. It is declared unsupported with
 * its reason rather than inferred from adjacent results, so it stays an explicit gap.
 */

import { namedCheck, prefixCheck } from './records.js';
import type { RequirementChecks } from './checks.js';

const ROLE = 'q3members';

export const MEMBER_CHECKS: RequirementChecks = {
  requirementId: 'Q-MEMBER-1',
  assertions: [
    'window-spanning-members-resolves',
    'unoccupied-slots-zero-coverage',
    'ordered-replacement-precedence',
    'nodata-does-not-erase-earlier-value',
    'overviews-do-not-resurrect-replaced-pixels',
  ],
  required: [
    'members.multi-member',
    'members.gap-empty',
    'members.precedence',
    'members.nodata',
  ],
  unsupported: new Map<string, string>([
    [
      'overviews-do-not-resurrect-replaced-pixels',
      'no probe observes overview precedence, so the obligation remains unmeasured',
    ],
  ]),
  checks: [
    prefixCheck(
      'members.multi-member',
      'window-spanning-members-resolves',
      ROLE,
      'multi-member:',
      'multi-member assertion(s)',
    ),
    prefixCheck(
      'members.gap-empty',
      'unoccupied-slots-zero-coverage',
      ROLE,
      'gap-empty:',
      'gap-empty assertion(s)',
    ),
    namedCheck('members.precedence', 'ordered-replacement-precedence', ROLE, 'precedence-last-wins'),
    namedCheck(
      'members.nodata',
      'nodata-does-not-erase-earlier-value',
      ROLE,
      'nodata-does-not-erase',
    ),
  ],
};

export const MEMBER_PROVENANCE = {
  sourceRoles: ['q3members'] as const,
  source: 'reports/q3-members.json',
  legacyProducerCommand: 'measure.py q3-members --collection <dir> --out reports/q3-members.json',
  route: 'ordered member replay (reference implementation)',
  artifact: { name: 'reference-resolver', version: 'harness' },
  fixtures: [] as { name: string; sha256?: string }[],
};
