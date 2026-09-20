/**
 * The Desktop pilot producer — observed coverage, never declared coverage.
 *
 * The cases build raw host evidence the way the host writes it, run the real producer,
 * write its reports, and then run the real evaluator CLI over them. Nothing here
 * calls an internal comparison helper or hand-writes a passing report: the point of
 * these tests is that changed raw evidence reaches the requirement verdict.
 *
 * The expectations are hand-derived from the plane's specification
 * (`z(column,row) = column - row`, nodata `-9999` at `(100,100)` and `(1024,1024)`),
 * and the five windows are the ones the pilot requests. The plane is not computed by
 * the module under test here: `observedWindow` writes literal values from that formula
 * as an independent producer of evidence would.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runCliArgs, TempRoot } from './helpers.js';
import { candidatePins } from './fixtures.js';
import { realContractPath } from './contractFixture.js';
import {
  PILOT_NODATA,
  producePilotReports,
  type DeclaredWindow,
  type PilotOutcome,
  type RunDescriptor,
} from '../src/pilot/producer.js';

type Rec = globalThis.Record<string, unknown>;

const FIXTURE = { name: 'plane-cog.tif', sha256: 'f'.repeat(64), bytes: 16_778_048 };
const ENGINE = { name: 'whitebox-wasm', version: '0.5.1' };
const WINDOWS: readonly DeclaredWindow[] = [
  { id: 'origin', x: 0, y: 0, w: 128, h: 128 },
  { id: 'mid', x: 480, y: 480, w: 128, h: 128 },
  { id: 'hole', x: 1000, y: 1000, w: 128, h: 128 },
  { id: 'far', x: 1920, y: 1920, w: 128, h: 128 },
  { id: 'lower-left', x: 0, y: 1800, w: 128, h: 128 },
];
const HOLES: readonly (readonly [number, number])[] = [
  [100, 100],
  [1024, 1024],
];
const REFUSALS = [
  { id: 'whole-artifact', offset: 0, length: FIXTURE.bytes, expected: 'too-large' },
  { id: 'zero-length', offset: 0, length: 0, expected: 'zero-length' },
  { id: 'past-end', offset: FIXTURE.bytes, length: 1, expected: 'out-of-range' },
  { id: 'unknown-handle', handle: 4_294_967_295, offset: 0, length: 16, expected: 'unknown-handle' },
].map((control, index) => ({ ...control, requestId: `r${index}` }));

/** The declared run, as the launcher writes it before the host starts. */
function descriptor(overrides: Partial<RunDescriptor> = {}): RunDescriptor {
  return {
    runId: 'pilot-test-0001',
    command: 'qualification-desktop-host --run-spec <spec>',
    recordedAt: 1_760_000_000,
    headerBytes: 65_536,
    fixture: FIXTURE,
    windows: WINDOWS,
    refusals: REFUSALS.map((control) => ({ ...control })),
    engine: ENGINE,
    bundledAssets: [{ path: 'main.js', sha256: 'b'.repeat(64), bytes: 2_077 }],
    networkDenial: 'unshare -rn (network namespace); no interface other than loopback',
    x11Relay: 'local X11 relay /tmp/.X11-unix/X0',
    ...overrides,
  };
}

/** The plane's specified value at a cell, written independently of the producer. */
function planeValue(column: number, row: number): number {
  return HOLES.some(([x, y]) => x === column && y === row) ? PILOT_NODATA : column - row;
}

/** One observed window exactly as the host returns it. */
function observedWindow(window: DeclaredWindow, mutate: (record: Rec) => void = () => {}): Rec {
  const values: number[] = [];
  for (let row = 0; row < window.h; row += 1) {
    for (let column = 0; column < window.w; column += 1) {
      values.push(planeValue(window.x + column, window.y + row));
    }
  }
  const record: Rec = {
    id: window.id,
    x: window.x,
    y: window.y,
    w: window.w,
    h: window.h,
    nodata: PILOT_NODATA,
    values,
  };
  mutate(record);
  return record;
}

/** The native ledger the host writes for a complete run of the five windows. */
function ledgerEntries(): Rec[] {
  const entries: Rec[] = [
    {
      fixture: 'plane',
      label: 'reference',
      request_id: 'preflight-hash',
      offset: 0,
      requested: FIXTURE.bytes,
      returned: FIXTURE.bytes,
      outcome: 'ok',
    },
    { fixture: 'plane', label: 'candidate', request_id: 'w0', offset: 0, requested: 65_536, returned: 65_536, outcome: 'ok' },
  ];
  for (let index = 0; index < 11; index += 1) {
    entries.push({
      fixture: 'plane',
      label: 'candidate',
      request_id: `w${index + 1}`,
      offset: 708 + index * 1_048_576,
      requested: 1_048_576,
      returned: 1_048_576,
      outcome: 'ok',
    });
  }
  for (const control of REFUSALS) {
    entries.push({
      fixture: 'plane',
      label: 'candidate',
      request_id: control.requestId,
      offset: control.offset,
      requested: control.length,
      returned: 0,
      outcome: control.expected,
    });
  }
  return entries;
}

/** Raw host evidence, with the knobs each case needs. */
function hostEvidence(options: {
  readonly windows?: readonly Rec[];
  readonly refusals?: readonly Rec[];
  readonly counters?: Rec | null;
  readonly ledger?: Rec;
  readonly run?: string;
  readonly assets?: readonly Rec[];
  readonly origin?: string;
} = {}): Rec {
  const windows = options.windows ?? WINDOWS.map((window) => observedWindow(window));
  const counters = options.counters === undefined
    ? {
        headerRequests: 1,
        headerBytes: 65_536,
        tileRequests: 11,
        tileBytes: 11_534_336,
        totalBytes: 11_599_872,
        largestRequest: 1_048_576,
        readFailures: [],
      }
    : options.counters;
  const refusals = options.refusals ?? REFUSALS.map((control) => ({
    id: control.id,
    requestId: control.requestId,
    expected: control.expected,
    observed: control.expected,
    ok: true,
  }));
  return {
    run: options.run ?? 'pilot-test-0001',
    nativeLedger: options.ledger ?? {
      entries: ledgerEntries(),
      candidate_bytes: 11_599_872,
      reference_bytes: FIXTURE.bytes,
      candidate_reads: 12,
      max_read_bytes: 1_048_576,
      active_high_water: 1,
      queued_high_water: 0,
    },
    bundledAssets: options.assets ?? [
      {
        path: 'main.js',
        found: true,
        expected_sha256: 'b'.repeat(64),
        expected_bytes: 2_077,
        embedded_sha256: 'b'.repeat(64),
        embedded_bytes: 2_077,
        matches: true,
      },
    ],
    fixturesOpened: [{ id: 'plane', path: '<owned>/fixture/plane-cog.tif', sha256: FIXTURE.sha256, length: FIXTURE.bytes }],
    handlesRevoked: 1,
    webviewOrigin: options.origin ?? 'tauri://localhost',
    evidence: { windows, counters, refusals, levels: 1, nodata: PILOT_NODATA },
  };
}

/** Write the producer's reports and decide them with the real evaluator CLI. */
function evaluate(outcome: PilotOutcome, root: TempRoot, tag: string, recordedAt: number): {
  readonly status: number;
  readonly decision: Rec | undefined;
  readonly stderr: string;
} {
  assert.ok(outcome.reports, 'the producer produced no reports to evaluate');
  const reports = join(root.path, `reports-${tag}`);
  mkdirSync(reports, { recursive: true });
  root.write(`reports-${tag}/q2-numeric.json`, outcome.reports.q2);
  root.write(`reports-${tag}/host.json`, outcome.reports.host);
  const manifest = join(root.path, `fixtures-${tag}.json`);
  root.write(`fixtures-${tag}.json`, {
    declared: [{ name: FIXTURE.name, sha256: FIXTURE.sha256 }],
    requiredFixtures: { q2: [FIXTURE.name] },
  });
  const pins = join(root.path, `pins-${tag}.json`);
  root.write(`pins-${tag}.json`, candidatePins());
  const out = join(root.path, `decision-${tag}.json`);
  return runCliArgs(
    [
      '--reports', reports,
      '--contract', realContractPath(),
      '--fixture-manifest', manifest,
      '--pins', pins,
      '--profile', 'desktop-local',
      // The pilot records when it ran; the evaluator refuses stale evidence, so the
      // decision is taken at that recorded time rather than at the wall clock.
      '--now', String(recordedAt),
      '--out', out,
    ],
    out,
  );
}

function requirement(decision: Rec | undefined, id: string): Rec {
  const requirements = (decision?.['requirements'] ?? []) as readonly Rec[];
  const found = requirements.find((entry) => entry['id'] === id);
  assert.ok(found, `the decision records no ${id}`);
  return found;
}

function reasonsOf(decision: Rec | undefined, id: string): string {
  return JSON.stringify(requirement(decision, id)['reasons'] ?? []);
}

function assertion(name: string, outcome: PilotOutcome): Rec | undefined {
  const assertions = ((outcome.reports?.q2 as Rec | undefined)?.['assertions'] ?? []) as readonly Rec[];
  return assertions.find((entry) => entry['name'] === name);
}

test('five observed windows are measured cell by cell and decide Q-LOCAL-1', () => {
  const root = new TempRoot();
  try {
    const outcome = producePilotReports({ descriptor: descriptor(), hostEvidence: hostEvidence() });
    assert.deepEqual(outcome.instrumentProblems, []);
    assert.deepEqual(outcome.failures, []);
    assert.deepEqual(outcome.gaps, []);
    assert.equal(outcome.measurement.measuredWindows, 5);
    assert.equal(outcome.measurement.declaredWindows, 5);
    assert.equal(outcome.measurement.cells, 81_920);
    assert.equal(outcome.measurement.expectedCells, 81_920);
    assert.equal(outcome.measurement.nodataCells, 2);
    assert.equal(outcome.measurement.expectedNodataCells, 2);
    assert.equal(outcome.measurement.ledger.reconciles, true);
    assert.equal(outcome.measurement.refusals.matched, 4);
    assert.equal(outcome.measurement.bundledAssets.verified, 1);
    assert.ok(outcome.measurement.windows.every((window) => window.mismatches === 0));
    assert.ok(outcome.measurement.windows.every((window) => window.validityMismatches === 0));
    assert.ok(outcome.measurement.windows.some((window) => window.zeroValues > 0));
    assert.ok(outcome.measurement.windows.some((window) => window.negativeValues > 0));

    const result = evaluate(outcome, root, 'control', descriptor().recordedAt);
    assert.equal(requirement(result.decision, 'Q-LOCAL-1')['verdict'], 'pass', reasonsOf(result.decision, 'Q-LOCAL-1'));
    assert.equal(requirement(result.decision, 'Q-HOST-1')['verdict'], 'pass', reasonsOf(result.decision, 'Q-HOST-1'));
    // Ten requirements have no producer in this pilot, so the run is not a full-Q pass.
    assert.equal(result.decision?.['verdict'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('five empty duplicate windows measure nothing and cannot pass', () => {
  const root = new TempRoot();
  try {
    // The reviewer's counterexample: every record claims the origin identity with no
    // dimensions and no values.
    const windows = Array.from({ length: 5 }, () => ({ id: 'origin', x: 0, y: 0, w: 0, h: 0, values: [] as number[] }));
    const outcome = producePilotReports({ descriptor: descriptor(), hostEvidence: hostEvidence({ windows }) });
    assert.equal(outcome.measurement.measuredWindows, 0);
    assert.equal(outcome.measurement.cells, 0);
    assert.notEqual(outcome.measurement.cells, outcome.measurement.expectedCells);
    assert.ok(outcome.failures.some((failure) => /identity must be observed exactly once/.test(failure)), outcome.failures.join('; '));
    assert.equal(assertion('windows-tested', outcome)?.['ok'], undefined);
    assert.equal((outcome.reports?.q2 as Rec)['result'], 'fail');

    const result = evaluate(outcome, root, 'empty-duplicates', descriptor().recordedAt);
    assert.equal(requirement(result.decision, 'Q-LOCAL-1')['verdict'], 'fail', reasonsOf(result.decision, 'Q-LOCAL-1'));
    assert.match(reasonsOf(result.decision, 'Q-LOCAL-1'), /identity must be observed exactly once/);
  } finally {
    root.cleanup();
  }
});

test('copies of a valid window cannot cover the other requests', () => {
  const root = new TempRoot();
  try {
    const origin = observedWindow(WINDOWS[0] as DeclaredWindow);
    const windows = WINDOWS.map((window) => ({ ...origin, id: window.id }));
    const outcome = producePilotReports({ descriptor: descriptor(), hostEvidence: hostEvidence({ windows }) });
    assert.equal(outcome.measurement.measuredWindows, 1);
    assert.equal(outcome.measurement.cells, 16_384);
    assert.ok(
      outcome.failures.some((failure) => /was requested at x=480 but observed at x=0/.test(failure)),
      outcome.failures.join('; '),
    );
    assert.ok(outcome.gaps.some((gap) => /was requested but never observed/.test(gap)) === false);

    const result = evaluate(outcome, root, 'copies', descriptor().recordedAt);
    assert.equal(requirement(result.decision, 'Q-LOCAL-1')['verdict'], 'fail', reasonsOf(result.decision, 'Q-LOCAL-1'));
  } finally {
    root.cleanup();
  }
});

test('a changed identity, coordinate or value count fails', () => {
  const root = new TempRoot();
  try {
    const renamed = producePilotReports({
      descriptor: descriptor(),
      hostEvidence: hostEvidence({
        windows: WINDOWS.map((window, index) => observedWindow(window, (record) => {
          if (index === 0) record['id'] = 'origin-renamed';
        })),
      }),
    });
    assert.ok(renamed.failures.some((failure) => /never requested/.test(failure)), renamed.failures.join('; '));
    assert.ok(renamed.gaps.some((gap) => /"origin" .* was requested but never observed/.test(gap)), renamed.gaps.join('; '));

    const moved = producePilotReports({
      descriptor: descriptor(),
      hostEvidence: hostEvidence({
        windows: WINDOWS.map((window, index) => observedWindow(window, (record) => {
          if (index === 0) record['x'] = 1;
        })),
      }),
    });
    assert.ok(moved.failures.some((failure) => /requested at x=0 but observed at x=1/.test(failure)), moved.failures.join('; '));

    const short = producePilotReports({
      descriptor: descriptor(),
      hostEvidence: hostEvidence({
        windows: WINDOWS.map((window, index) => observedWindow(window, (record) => {
          if (index === 0) (record['values'] as number[]).pop();
        })),
      }),
    });
    assert.ok(
      short.failures.some((failure) => /records 16383 value\(s\), but 128x128 requires exactly 16384/.test(failure)),
      short.failures.join('; '),
    );

    for (const [outcome, tag] of [[renamed, 'renamed'], [moved, 'moved'], [short, 'short']] as const) {
      assert.equal((outcome.reports?.q2 as Rec)['result'], 'fail');
      const result = evaluate(outcome, root, tag, descriptor().recordedAt);
      assert.equal(requirement(result.decision, 'Q-LOCAL-1')['verdict'], 'fail', reasonsOf(result.decision, 'Q-LOCAL-1'));
    }
  } finally {
    root.cleanup();
  }
});

test('a missing window is a gap and does not erase a wrong value elsewhere', () => {
  const root = new TempRoot();
  try {
    const windows = WINDOWS
      .filter((window) => window.id !== 'far')
      .map((window) => observedWindow(window, (record) => {
        if (window.id === 'mid') (record['values'] as number[])[0] = 999;
      }));
    const outcome = producePilotReports({ descriptor: descriptor(), hostEvidence: hostEvidence({ windows }) });
    assert.equal(outcome.measurement.measuredWindows, 4);
    assert.ok(outcome.gaps.some((gap) => /"far" .* was requested but never observed/.test(gap)), outcome.gaps.join('; '));
    assert.ok(
      outcome.failures.some((failure) => /window values differ from the analytic expectation/.test(failure)),
      outcome.failures.join('; '),
    );
    assert.equal(assertion('windows-tested', outcome)?.['ok'], undefined);
    assert.equal(assertion(`analytic:${FIXTURE.name}`, outcome)?.['ok'], false);

    const result = evaluate(outcome, root, 'gap-plus-failure', descriptor().recordedAt);
    // The measured violation survives the missing observation: it is reported as a
    // failure, not hidden behind the gap.
    assert.equal(requirement(result.decision, 'Q-LOCAL-1')['verdict'], 'fail', reasonsOf(result.decision, 'Q-LOCAL-1'));
    assert.match(reasonsOf(result.decision, 'Q-LOCAL-1'), /window values differ from the analytic expectation/);
  } finally {
    root.cleanup();
  }
});

test('coverage without any zero or negative sample leaves retention undecided', () => {
  const root = new TempRoot();
  try {
    // A window that cannot contain a zero or negative value: every cell is at least
    // 500 - 127 = 373. The comparison still succeeds, so retention is a gap, not a
    // claim and not a failure.
    const positive = { id: 'positive-only', x: 500, y: 0, w: 128, h: 128 };
    const outcome = producePilotReports({
      descriptor: descriptor({ windows: [positive] }),
      hostEvidence: hostEvidence({
        windows: [observedWindow(positive)],
        ledger: {
          entries: ledgerEntries(),
          candidate_bytes: 11_599_872,
          reference_bytes: FIXTURE.bytes,
          candidate_reads: 12,
          max_read_bytes: 1_048_576,
        },
      }),
    });
    assert.deepEqual(outcome.failures, []);
    assert.equal(outcome.measurement.windows[0]?.zeroValues, 0);
    assert.equal(outcome.measurement.windows[0]?.negativeValues, 0);
    assert.equal(assertion(`zero-negative-retained:${FIXTURE.name}`, outcome)?.['ok'], undefined);
    assert.ok(
      outcome.gaps.some((gap) => /retention of zero and negative values was not observed/.test(gap)),
      outcome.gaps.join('; '),
    );
    assert.equal((outcome.reports?.q2 as Rec)['result'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('the ledger and the worker counters must agree, and reads keep their host-owned label', () => {
  const counterDrift = producePilotReports({
    descriptor: descriptor(),
    hostEvidence: hostEvidence({
      counters: {
        headerRequests: 1,
        headerBytes: 65_536,
        tileRequests: 11,
        tileBytes: 11_534_336,
        totalBytes: 11_599_873,
        largestRequest: 1_048_576,
        readFailures: [],
      },
    }),
  });
  assert.ok(
    counterDrift.failures.some((failure) => /worker counted 11599873 byte\(s\), the native ledger 11599872/.test(failure)),
    counterDrift.failures.join('; '),
  );
  assert.equal(assertion('native-ledger-reconciles-worker-counters', counterDrift)?.['ok'], undefined);

  const relabelled = hostEvidence();
  const entries = (relabelled['nativeLedger'] as Rec)['entries'] as Rec[];
  const workerRead = entries.find((entry) => entry['request_id'] === 'w1') as Rec;
  workerRead['label'] = 'reference';
  const relabelledOutcome = producePilotReports({ descriptor: descriptor(), hostEvidence: relabelled });
  assert.ok(
    relabelledOutcome.failures.some((failure) => /labels request "w1" as reference I\/O/.test(failure)),
    relabelledOutcome.failures.join('; '),
  );
});

test('a refusal is evidence only for the request identity that was declared', () => {
  const swapped = hostEvidence({
    refusals: REFUSALS.map((control) => ({
      id: control.id,
      requestId: control.id === 'zero-length' ? 'r9' : control.requestId,
      expected: control.expected,
      observed: control.expected,
      ok: true,
    })),
  });
  const outcome = producePilotReports({ descriptor: descriptor(), hostEvidence: swapped });
  assert.ok(
    outcome.failures.some((failure) =>
      /"zero-length" was declared with request identity "r1" but observed as "r9"/.test(failure),
    ),
    outcome.failures.join('; '),
  );
  assert.equal(assertion('no-whole-file-request:refused-before-read', outcome)?.['ok'], undefined);

  const unrelated = hostEvidence();
  const entries = (unrelated['nativeLedger'] as Rec)['entries'] as Rec[];
  const control = entries.find((entry) => entry['request_id'] === 'r1') as Rec;
  control['outcome'] = 'too-large';
  const unrelatedOutcome = producePilotReports({ descriptor: descriptor(), hostEvidence: unrelated });
  assert.ok(
    unrelatedOutcome.failures.some((failure) => /"zero-length" \(request r1\) is recorded natively as "too-large"/.test(failure)),
    unrelatedOutcome.failures.join('; '),
  );
});

test('evidence from another run is an instrument problem, not a measurement', () => {
  const outcome = producePilotReports({
    descriptor: descriptor(),
    hostEvidence: hostEvidence({ run: 'pilot-other' }),
  });
  assert.equal(outcome.instrumentProblems.length, 1);
  assert.match(outcome.instrumentProblems[0] ?? '', /records run "pilot-other", but this run is "pilot-test-0001"/);
  assert.equal(outcome.reports, undefined);
  assert.equal(outcome.measurement.measuredWindows, 0);
});

test('a worker error is a reported failure, never a successful measurement', () => {
  const evidence = hostEvidence();
  (evidence['evidence'] as Rec)['error'] = 'TypeError: the engine refused the tile';
  const outcome = producePilotReports({ descriptor: descriptor(), hostEvidence: evidence });
  assert.ok(
    outcome.failures.some((failure) => /the bundled worker failed: TypeError: the engine refused the tile/.test(failure)),
    outcome.failures.join('; '),
  );
  assert.equal((outcome.reports?.q2 as Rec)['result'], 'fail');
});
