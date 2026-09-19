/**
 * Q-HOST-1 - local Desktop worker and asset hosting without network.
 *
 * Only a real Desktop WebView run can satisfy the host assertion. A host label the
 * caller supplies is compared against the declared accepted hosts, and a host that
 * cannot satisfy the requirement is a gap rather than a failure: the run may be
 * perfectly good evidence for a different host, it is simply not this one.
 */

import { satisfied, sourceEvidence, unsatisfied, type Check, type RequirementChecks } from './checks.js';
import { namedCheck } from './records.js';
import { ALLOWED_HOSTS } from '../declared/route.js';

const ROLE = 'host';

const acceptedHost: Check = {
  id: 'host.accepted-webview',
  assertion: 'observed-in-desktop-webview',
  run: (context) => {
    const view = context.byRole.get(ROLE);
    const reference = sourceEvidence(view, 'identity.host');
    if (view === undefined || view.facts === undefined || reference === undefined) {
      return unsatisfied(['no Desktop host report was available']);
    }
    const host = view.facts.identity?.['host'];
    if (typeof host !== 'string' || host.length === 0) {
      return unsatisfied(['the host report does not record which host it observed'], [reference]);
    }
    if (!ALLOWED_HOSTS.includes(host)) {
      return unsatisfied(
        [
          `host ${JSON.stringify(host)} cannot satisfy this requirement; accepted hosts: ${ALLOWED_HOSTS.join(', ')}`,
        ],
        [reference],
      );
    }
    return satisfied([reference]);
  },
};

export const HOST_CHECKS: RequirementChecks = {
  requirementId: 'Q-HOST-1',
  assertions: [
    'bundled-worker-and-asset-path-exercised',
    'no-network-origin-required',
    'observed-in-desktop-webview',
  ],
  required: ['host.bundled-worker', 'host.no-network-origin', 'host.accepted-webview'],
  unsupported: new Map<string, string>(),
  checks: [
    namedCheck(
      'host.bundled-worker',
      'bundled-worker-and-asset-path-exercised',
      ROLE,
      'bundled-worker-and-asset-path-exercised',
    ),
    namedCheck('host.no-network-origin', 'no-network-origin-required', ROLE, 'no-network-origin-required'),
    acceptedHost,
  ],
};

export const HOST_PROVENANCE = {
  sourceRoles: ['host'] as const,
  source: 'reports/host.json',
  legacyProducerCommand: 'Desktop WebView host report',
  route: 'bundled worker and asset path with no network origin',
  artifact: { name: 'desktop-webview', version: 'bundled' },
  fixtures: [] as { name: string; sha256?: string }[],
};
