/**
 * T2 — per-run completeness and precedence.
 *
 * Every required candidate run must carry every applicable observation, and a
 * measured violation must survive a gap in a *different* observation. The two
 * failure modes this guards against are distinct:
 *
 * - a run missing a mandatory field being combined with others into a fictional
 *   complete run;
 * - a recorded over-limit value being discarded before the reduction sees it,
 *   because the record it lived in also had a gap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, PLAN } from './fixtures.js';

type Measurements = Record<string, unknown>[];

/** A control whose candidate run carries every applicable observation. */
function candidateMeasurements(): Measurements {
  const measurements = roleReports()['q6resources']!['measurements'] as Measurements;
  return measurements.map((entry) => ({ ...entry }));
}

function requestWith(root: TempRoot, measurements: Measurements): string {
  const reports = roleReports();
  reports['q6resources'] = {
    ...reports['q6resources']!,
    measurements,
  };
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  return root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
}

function decide(root: TempRoot, measurements: Measurements) {
  return runCli(requestWith(root, measurements), join(root.path, 'd.json'));
}

function resources(result: ReturnType<typeof runCli>): {
  verdict: string | undefined;
  assertions: Record<string, string>;
  reasons: string;
} {
  const requirements = result.decision?.['requirements'] as
    | { id: string; verdict: string; assertions: Record<string, string>; reasons: string[] }[]
    | undefined;
  const found = requirements?.find((entry) => entry.id === 'Q-RES-1');
  return {
    verdict: found?.verdict,
    assertions: found?.assertions ?? {},
    reasons: found?.reasons.join(' ') ?? '',
  };
}

/** Every per-run field a candidate record must carry, per the plan. */
const REQUIRED_RUN_FIELDS = [
  'incrementalPeakRssMiB',
  'sampleIntervalMs',
  'sampleCount',
  'temporaryDiskHighWaterBytes',
  'decodedCacheBytes',
  'activeReads',
  'queueDepth',
  'maxConcurrentChildren',
] as const;

test('T2 control: a complete candidate run satisfies every reducible assertion', () => {
  const root = new TempRoot();
  try {
    const state = resources(decide(root, candidateMeasurements()));
    // The five contract assertions this mapping can decide all pass.
    assert.equal(state.assertions['candidate-memory-within-budget'], 'pass', state.reasons);
    assert.equal(state.assertions['measurement-is-of-candidate-route'], 'pass', state.reasons);
    assert.equal(state.assertions['sampling-meets-requirement'], 'pass', state.reasons);
    assert.equal(
      state.assertions['disk-cache-reads-queue-and-children-recorded'],
      'pass',
      state.reasons,
    );
    // The requirement itself stays a gap: the plan's display disk-cache bound has no
    // producer observation, so it is unmeasured rather than compliant.
    assert.equal(state.verdict, 'inconclusive', state.reasons);
    assert.match(state.reasons, /display disk-cache/i, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T2: every required per-run field is mandatory for every candidate run', () => {
  for (const field of REQUIRED_RUN_FIELDS) {
    const root = new TempRoot();
    try {
      const measurements = candidateMeasurements();
      const extra: Record<string, unknown> = { ...measurements[0]! };
      delete extra[field];
      // A second, otherwise complete run that omits one field must not be absorbed
      // into a fictional complete run built from the two.
      const state = resources(decide(root, [measurements[0]!, extra, measurements[1]!]));
      assert.notEqual(state.verdict, 'pass', `removing ${field} still passed: ${state.reasons}`);
      assert.match(
        state.reasons,
        new RegExp(field),
        `removing ${field} was not named in the reasons: ${state.reasons}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T2: an over-limit value fails even when its record has an unrelated gap', () => {
  // The gap and the violation must be different observations, or the case would be
  // "the field I deleted was also the field that was over limit".
  const pairs: readonly [string, string, Record<string, unknown>][] = [
    ['sampleCount removed', 'decoded cache', { decodedCacheBytes: 1024 ** 3 }],
    ['sampleCount removed', 'active reads', { activeReads: PLAN.activeReads + 1 }],
    ['sampleIntervalMs removed', 'queue depth', { queueDepth: PLAN.queueDepth + 1 }],
    ['temporaryDiskHighWaterBytes removed', 'decoded cache', { decodedCacheBytes: PLAN.decodedCacheBytes + 1 }],
    ['maxConcurrentChildren removed', 'queue depth', { queueDepth: PLAN.queueDepth + 1 }],
    ['queueDepth removed', 'decoded cache', { decodedCacheBytes: 1024 ** 3 }],
    ['decodedCacheBytes removed', 'active reads', { activeReads: PLAN.activeReads + 1 }],
  ];
  for (const [gapField, overLabel, over] of pairs) {
    const root = new TempRoot();
    try {
      const measurements = candidateMeasurements();
      const bad: Record<string, unknown> = { ...measurements[0]!, ...over };
      delete bad[gapField];
      const state = resources(decide(root, [bad, measurements[1]!]));
      assert.equal(
        state.verdict,
        'fail',
        `${overLabel} with ${gapField} removed became ${state.verdict}: ${state.reasons}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T2: an over-limit value is retained regardless of record order', () => {
  for (const order of ['first', 'last'] as const) {
    const root = new TempRoot();
    try {
      const measurements = candidateMeasurements();
      const bad: Record<string, unknown> = { ...measurements[0]!, decodedCacheBytes: 1024 ** 3 };
      const list = order === 'first' ? [bad, measurements[1]!] : [measurements[1]!, bad];
      const state = resources(decide(root, list));
      assert.equal(state.verdict, 'fail', `order=${order}: ${state.reasons}`);
    } finally {
      root.cleanup();
    }
  }
});

test('T2: an over-limit value in an unsampled record still fails', () => {
  // The over-limit record itself is the one with the sampling gap, and a second
  // healthy candidate run is present. Restricting the budget check to sampled
  // records would hide the violation behind the gap, so this case exists to keep the
  // budget check reading every record that recorded the counter.
  for (const order of ['first', 'last'] as const) {
    const root = new TempRoot();
    try {
      const measurements = candidateMeasurements();
      const bad: Record<string, unknown> = { ...measurements[0]!, decodedCacheBytes: 1024 ** 3 };
      delete bad['sampleCount'];
      const healthy: Record<string, unknown> = { ...measurements[0]! };
      const list = order === 'first' ? [bad, healthy, measurements[1]!] : [healthy, bad, measurements[1]!];
      const state = resources(decide(root, list));
      assert.equal(
        state.verdict,
        'fail',
        `order=${order}: an unsampled over-limit record became ${state.verdict}: ${state.reasons}`,
      );
      assert.match(state.reasons, /decoded cache/);
    } finally {
      root.cleanup();
    }
  }
});

test('T2: an unsampled record does not supply a reading for a healthy record to pass on', () => {
  // The inverse: the unsampled record's values must not be borrowed.
  const root = new TempRoot();
  try {
    const measurements = candidateMeasurements();
    const unsampled: Record<string, unknown> = { ...measurements[0]! };
    delete unsampled['sampleIntervalMs'];
    delete unsampled['sampleCount'];
    const state = resources(decide(root, [unsampled, measurements[1]!]));
    assert.equal(state.verdict, 'inconclusive', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T2: a missing per-run observation is a gap rather than a fabricated pass', () => {
  const root = new TempRoot();
  try {
    // Every candidate run is incomplete: no complete run was measured.
    const measurements = candidateMeasurements();
    const incomplete = { ...measurements[0]! };
    delete incomplete['incrementalPeakRssMiB'];
    const state = resources(decide(root, [incomplete, measurements[1]!]));
    assert.equal(state.verdict, 'inconclusive', state.reasons);
    assert.match(state.reasons, /incrementalPeakRssMiB/);
  } finally {
    root.cleanup();
  }
});

test('T2: a malformed per-run value fails rather than being skipped', () => {
  const malformed: readonly [string, unknown][] = [
    ['string', '1024'],
    ['negative', -1],
    ['fractional', 2.5],
    ['null', null],
    ['boolean', true],
    ['list', [1]],
    ['object', { value: 1 }],
  ];
  for (const [label, value] of malformed) {
    const root = new TempRoot();
    try {
      const measurements = candidateMeasurements();
      const bad: Record<string, unknown> = { ...measurements[0]!, decodedCacheBytes: value };
      const state = resources(decide(root, [bad, measurements[1]!]));
      assert.notEqual(state.verdict, 'pass', `decodedCacheBytes=${label} passed`);
      assert.equal(state.verdict, 'fail', `decodedCacheBytes=${label} was ${state.verdict}`);
    } finally {
      root.cleanup();
    }
  }
});

test('T2: an invented display disk-cache field is not accepted as the observation', () => {
  // No producer emits a display disk-cache observation, so the plan's 512 MiB bound
  // cannot be established from these records. A caller supplying a plausible extra
  // field must not be able to make it read as compliant, in either direction.
  for (const value of [1024 ** 3, 1, 0]) {
    const root = new TempRoot();
    try {
      const measurements = candidateMeasurements();
      const withUnknown: Record<string, unknown> = {
        ...measurements[0]!,
        displayDiskCacheBytes: value,
      };
      const state = resources(decide(root, [withUnknown, measurements[1]!]));
      assert.equal(
        state.verdict,
        'inconclusive',
        `displayDiskCacheBytes=${value} changed the verdict to ${state.verdict}`,
      );
      assert.match(state.reasons, /display disk-cache/i, state.reasons);
    } finally {
      root.cleanup();
    }
  }
});

test('T2: an unsampled record cannot supply a resource reading', () => {
  const root = new TempRoot();
  try {
    const measurements = candidateMeasurements();
    const unsampled: Record<string, unknown> = { ...measurements[0]! };
    delete unsampled['sampleIntervalMs'];
    delete unsampled['sampleCount'];
    unsampled['incrementalPeakRssMiB'] = 1;
    unsampled['decodedCacheBytes'] = 1;
    const state = resources(decide(root, [unsampled, measurements[1]!]));
    assert.equal(state.verdict, 'inconclusive', state.reasons);
  } finally {
    root.cleanup();
  }
});
