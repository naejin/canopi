/**
 * Q-CANCEL-1, Q-TEARDOWN-1 and Q-FAILINJ-1 - lifecycle obligations.
 *
 * These share one producer report but ask different questions, so each is mapped
 * separately. Several assertions have no producer at all; those stay explicit gaps
 * with the reason recorded, because the recorded probe does not exercise the plan's
 * route and treating an adjacent result as support would be a false pass.
 */

import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { named } from './numericTransport.js';

interface LifecycleMapping {
  readonly assertions: readonly string[];
  /** contract assertion -> producer assertion name. */
  readonly sourceNames: ReadonlyMap<string, string>;
  /** contract assertion -> why it cannot be measured yet. */
  readonly unsupported: ReadonlyMap<string, string>;
  readonly sourceRoles: readonly string[];
  readonly source: string;
  /** The legacy producer command that wrote this report, recorded for provenance. */
  readonly legacyProducerCommand: string;
  readonly route: string;
}

const COMMAND = 'measure.py q5-lifecycle --browser-report <probe> --out reports/q5-lifecycle.json';
const SOURCE = 'reports/q5-lifecycle.json';

const CANCEL: LifecycleMapping = {
  assertions: [
    'cancellation-issued-while-work-in-flight',
    'unstarted-work-never-scheduled',
    'concurrent-in-flight-work-measured',
    'owned-work-settles-within-bound',
    'uncancelled-control-completes',
  ],
  sourceNames: new Map([
    ['unstarted-work-never-scheduled', 'cancellation-stops-scheduling'],
    ['owned-work-settles-within-bound', 'cancellation-settles-in-bound'],
    ['uncancelled-control-completes', 'expected-rejection:uncancelled-control'],
  ]),
  unsupported: new Map([
    [
      'cancellation-issued-while-work-in-flight',
      'the recorded probe slices a resident buffer rather than the plan\'s route, so in-flight work on the proposed route is not measured',
    ],
    [
      'concurrent-in-flight-work-measured',
      'the recorded probe counts completed operations, which is not concurrent in-flight work',
    ],
  ]),
  sourceRoles: ['q5lifecycle'],
  source: SOURCE,
  legacyProducerCommand: COMMAND,
  route: 'cooperative tile-level cancellation',
};

const TEARDOWN: LifecycleMapping = {
  assertions: [
    'adapter-tolerates-repeated-dispose',
    'teardown-observably-releases-resource',
    'stalled-worker-terminated-within-bound',
    'silently-dead-worker-detectable',
  ],
  sourceNames: new Map([
    ['adapter-tolerates-repeated-dispose', 'adapter-dispose-idempotent'],
    ['stalled-worker-terminated-within-bound', 'lifecycle:stalled-worker-termination'],
    ['silently-dead-worker-detectable', 'lifecycle:dead-worker-detectable'],
  ]),
  unsupported: new Map([
    [
      'teardown-observably-releases-resource',
      'release is asserted from a flag rather than observed on the route\'s own handles',
    ],
  ]),
  sourceRoles: ['q5lifecycle'],
  source: SOURCE,
  legacyProducerCommand: COMMAND,
  route: 'owned-adapter lifecycle probe',
};

const FAILINJ: LifecycleMapping = {
  assertions: [
    'truncated-header-rejected',
    'corrupt-tile-rejected',
    'out-of-extent-window-rejected',
    'stalled-worker-forced',
    'disk-write-failure-exercised',
  ],
  sourceNames: new Map([
    ['truncated-header-rejected', 'malformed-rejected:truncated-header'],
    ['corrupt-tile-rejected', 'malformed-rejected:corrupt-tile'],
    ['out-of-extent-window-rejected', 'malformed-rejected:out-of-image-window'],
    ['stalled-worker-forced', 'lifecycle:stalled-worker-termination'],
  ]),
  unsupported: new Map([
    ['disk-write-failure-exercised', 'no probe injects a disk-write failure'],
  ]),
  sourceRoles: ['q5lifecycle'],
  source: SOURCE,
  legacyProducerCommand: COMMAND,
  route: 'owned-adapter lifecycle probe',
};

function mapLifecycle(mapping: LifecycleMapping, source: SourceView | undefined): MappingResult {
  const assertions = unresolved(mapping.assertions);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: mapping.sourceRoles,
    source: mapping.source,
    legacyProducerCommand: mapping.legacyProducerCommand,
    route: mapping.route,
    artifact: { name: 'whitebox-wasm', version: '0.5.1' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  for (const [assertion, reason] of mapping.unsupported) {
    assertions.set(assertion, 'inconclusive');
    gaps.push(`${assertion}: ${reason}`);
  }
  if (source === undefined || source.facts === undefined) {
    gaps.push('no lifecycle report was available');
    return { assertions, observations, failures, gaps, ...base };
  }
  const named_ = source.facts.assertions;
  for (const [assertion, sourceName] of mapping.sourceNames) {
    assertions.set(assertion, named(named_, sourceName));
  }
  return { assertions, observations, failures, gaps, ...base };
}

export function mapCancellation(source: SourceView | undefined): MappingResult {
  return mapLifecycle(CANCEL, source);
}

export function mapTeardown(source: SourceView | undefined): MappingResult {
  return mapLifecycle(TEARDOWN, source);
}

export function mapFailureInjection(source: SourceView | undefined): MappingResult {
  return mapLifecycle(FAILINJ, source);
}
