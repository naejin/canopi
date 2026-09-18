/**
 * Q-HOST-1 - local Desktop worker and asset hosting without network.
 *
 * Only a real Desktop WebView run can satisfy the host assertion. A host label the
 * caller supplies is compared against the declared accepted hosts, and a host that
 * cannot satisfy the requirement is a gap rather than a failure: the run may be
 * perfectly good evidence for a different host, it is simply not this one.
 */

import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { named } from './numericTransport.js';
import { ALLOWED_HOSTS } from '../declared/route.js';

const ASSERTIONS = [
  'bundled-worker-and-asset-path-exercised',
  'no-network-origin-required',
  'observed-in-desktop-webview',
];

export function mapHost(source: SourceView | undefined): MappingResult {
  const assertions = unresolved(ASSERTIONS);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['host'] as const,
    source: 'reports/host.json',
    legacyProducerCommand: 'Desktop WebView host report',
    route: 'bundled worker and asset path with no network origin',
    artifact: { name: 'desktop-webview', version: 'bundled' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  if (source === undefined || source.facts === undefined) {
    gaps.push('no Desktop host report was available');
    return { assertions, observations, failures, gaps, ...base };
  }
  const named_ = source.facts.assertions;
  assertions.set(
    'bundled-worker-and-asset-path-exercised',
    named(named_, 'bundled-worker-and-asset-path-exercised'),
  );
  assertions.set('no-network-origin-required', named(named_, 'no-network-origin-required'));

  const host = source.facts.identity?.['host'];
  observations['host'] = host ?? null;
  if (typeof host !== 'string' || host.length === 0) {
    gaps.push('the host report does not record which host it observed');
    assertions.set('observed-in-desktop-webview', 'inconclusive');
  } else if (!ALLOWED_HOSTS.includes(host)) {
    gaps.push(
      `host ${JSON.stringify(host)} cannot satisfy this requirement; accepted hosts: ${ALLOWED_HOSTS.join(', ')}`,
    );
    assertions.set('observed-in-desktop-webview', 'inconclusive');
  } else {
    assertions.set('observed-in-desktop-webview', 'pass');
  }
  return { assertions, observations, failures, gaps, ...base };
}
