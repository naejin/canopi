/**
 * Q-CANCEL-1, Q-TEARDOWN-1 and Q-FAILINJ-1 - lifecycle obligations as checks.
 *
 * These share one producer report but ask different questions, so each requirement
 * owns its own check inventory. Assertions no probe observes are declared
 * unsupported with the reason recorded; treating an adjacent result as support would
 * be a false pass, and a declared negative-control rejection is never positive
 * capability evidence.
 */

import { namedCheck } from './records.js';
import type { RequirementChecks } from './checks.js';

const ROLE = 'q5lifecycle';
const SOURCE = 'reports/q5-lifecycle.json';
const COMMAND = 'measure.py q5-lifecycle --browser-report <probe> --out reports/q5-lifecycle.json';

export const CANCEL_CHECKS: RequirementChecks = {
  requirementId: 'Q-CANCEL-1',
  assertions: [
    'cancellation-issued-while-work-in-flight',
    'unstarted-work-never-scheduled',
    'concurrent-in-flight-work-measured',
    'owned-work-settles-within-bound',
    'uncancelled-control-completes',
  ],
  required: ['cancel.unstarted-work', 'cancel.settles-in-bound', 'cancel.uncancelled-control'],
  unsupported: new Map<string, string>([
    [
      'cancellation-issued-while-work-in-flight',
      "the recorded probe slices a resident buffer rather than the plan's route, so in-flight work on the proposed route is not measured",
    ],
    [
      'concurrent-in-flight-work-measured',
      'the recorded probe counts completed operations, which is not concurrent in-flight work',
    ],
  ]),
  checks: [
    namedCheck(
      'cancel.unstarted-work',
      'unstarted-work-never-scheduled',
      ROLE,
      'cancellation-stops-scheduling',
    ),
    namedCheck(
      'cancel.settles-in-bound',
      'owned-work-settles-within-bound',
      ROLE,
      'cancellation-settles-in-bound',
    ),
    // The control is a producer-recorded negative control: it shows a rejection was
    // observed, which is exactly what this assertion claims and nothing more.
    namedCheck(
      'cancel.uncancelled-control',
      'uncancelled-control-completes',
      ROLE,
      'expected-rejection:uncancelled-control',
    ),
  ],
};

export const CANCEL_PROVENANCE = {
  sourceRoles: [ROLE] as const,
  source: SOURCE,
  legacyProducerCommand: COMMAND,
  route: 'cooperative tile-level cancellation',
  artifact: { name: 'whitebox-wasm', version: '0.5.1' },
  fixtures: [] as { name: string; sha256?: string }[],
};

export const TEARDOWN_CHECKS: RequirementChecks = {
  requirementId: 'Q-TEARDOWN-1',
  assertions: [
    'adapter-tolerates-repeated-dispose',
    'teardown-observably-releases-resource',
    'stalled-worker-terminated-within-bound',
    'silently-dead-worker-detectable',
  ],
  required: ['teardown.repeated-dispose', 'teardown.stalled-worker', 'teardown.dead-worker'],
  unsupported: new Map<string, string>([
    [
      'teardown-observably-releases-resource',
      "release is asserted from a flag rather than observed on the route's own handles",
    ],
  ]),
  checks: [
    namedCheck(
      'teardown.repeated-dispose',
      'adapter-tolerates-repeated-dispose',
      ROLE,
      'adapter-dispose-idempotent',
    ),
    namedCheck(
      'teardown.stalled-worker',
      'stalled-worker-terminated-within-bound',
      ROLE,
      'lifecycle:stalled-worker-termination',
    ),
    namedCheck(
      'teardown.dead-worker',
      'silently-dead-worker-detectable',
      ROLE,
      'lifecycle:dead-worker-detectable',
    ),
  ],
};

export const TEARDOWN_PROVENANCE = {
  sourceRoles: [ROLE] as const,
  source: SOURCE,
  legacyProducerCommand: COMMAND,
  route: 'owned-adapter lifecycle probe',
  artifact: { name: 'whitebox-wasm', version: '0.5.1' },
  fixtures: [] as { name: string; sha256?: string }[],
};

export const FAILURE_INJECTION_CHECKS: RequirementChecks = {
  requirementId: 'Q-FAILINJ-1',
  assertions: [
    'truncated-header-rejected',
    'corrupt-tile-rejected',
    'out-of-extent-window-rejected',
    'stalled-worker-forced',
    'disk-write-failure-exercised',
  ],
  required: [
    'failinj.truncated-header',
    'failinj.corrupt-tile',
    'failinj.out-of-extent-window',
    'failinj.stalled-worker',
  ],
  unsupported: new Map<string, string>([
    ['disk-write-failure-exercised', 'no probe injects a disk-write failure'],
  ]),
  checks: [
    namedCheck(
      'failinj.truncated-header',
      'truncated-header-rejected',
      ROLE,
      'malformed-rejected:truncated-header',
    ),
    namedCheck('failinj.corrupt-tile', 'corrupt-tile-rejected', ROLE, 'malformed-rejected:corrupt-tile'),
    namedCheck(
      'failinj.out-of-extent-window',
      'out-of-extent-window-rejected',
      ROLE,
      'malformed-rejected:out-of-image-window',
    ),
    namedCheck(
      'failinj.stalled-worker',
      'stalled-worker-forced',
      ROLE,
      'lifecycle:stalled-worker-termination',
    ),
  ],
};

export const FAILURE_INJECTION_PROVENANCE = {
  sourceRoles: [ROLE] as const,
  source: SOURCE,
  legacyProducerCommand: COMMAND,
  route: 'owned-adapter lifecycle probe',
  artifact: { name: 'whitebox-wasm', version: '0.5.1' },
  fixtures: [] as { name: string; sha256?: string }[],
};
