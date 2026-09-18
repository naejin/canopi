import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import {
  contractWith,
  fixtureManifest,
  identity,
  PLAN,
  report,
  requirement,
  ROUTE_ID,
  ENVIRONMENT_ID,
  HOST_ID,
  FIXTURE_NAME,
  FIXTURE_HASH,
} from './fixtures.js';

const NOW = 1_760_000_100;

const ASSERTIONS = [
  'reads-over-proposed-local-transport',
  'transport-ledger-corroborates-bytes',
  'no-single-request-returns-whole-artifact',
  'values-match-independent-reference',
  'validity-matches-reference-exactly',
  'window-size-within-contract-limit',
];

/** A numeric report whose every recorded observation is within the plan. */
function numericReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return report({
    experiment: 'q2-numeric',
    assertions: [
      { name: 'no-whole-file-request:plane2000', ok: true },
      { name: 'analytic:plane2000/origin', ok: true },
      { name: 'validity:plane2000/origin', ok: true },
    ],
    extra: {
      testedWindows: 9,
      serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 12 },
      windows: [
        {
          fixture: 'plane2000',
          label: 'bounded',
          classification: 'measured',
          window: { x: 0, y: 0, w: PLAN.windowEdge, h: PLAN.windowEdge, haloCells: 1 },
          cells: PLAN.windowCells,
        },
      ],
      ...overrides,
    },
  });
}

function request(root: TempRoot, options: { reportPath: string; manifest?: unknown }): string {
  return root.write('request.json', {
    contract: contractWith([requirement('Q-LOCAL-1', ASSERTIONS)]),
    fixtureManifest: options.manifest ?? fixtureManifest(),
    pins: { 'whitebox-wasm': '9c0ff4fdf3513f27b89c78e294610c3b418b3a4f' },
    now: NOW,
    sources: [{ role: 'q2', path: options.reportPath }],
  });
}

test('a complete numeric report yields an eligible decision and exit zero', () => {
  const root = new TempRoot();
  try {
    const reportPath = root.write('reports/q2-numeric.json', numericReport());
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0, `expected eligible, got ${result.status}: ${result.stderr}`);
    assert.equal(result.decision?.['verdict'], 'pass');
    const requirements = result.decision?.['requirements'] as { id: string; verdict: string }[];
    assert.deepEqual(
      requirements.map((entry) => ({ id: entry.id, verdict: entry.verdict })),
      [{ id: 'Q-LOCAL-1', verdict: 'pass' }],
    );
  } finally {
    root.cleanup();
  }
});

test('a missing numeric report is inconclusive, not a crash', () => {
  const root = new TempRoot();
  try {
    const requestPath = request(root, { reportPath: join(root.path, 'absent.json') });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /Traceback|at Object\./);
    assert.equal(result.decision?.['verdict'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('a malformed numeric report is a failure with a diagnostic reason', () => {
  const root = new TempRoot();
  try {
    const reportPath = root.writeRaw('reports/q2-numeric.json', '{"experiment": "q2-numeric"');
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
    const requirements = result.decision?.['requirements'] as { reasons: string[] }[];
    assert.match(requirements[0]!.reasons.join(' '), /malformed JSON/);
  } finally {
    root.cleanup();
  }
});

test('a window over the plan limit fails with the measured size', () => {
  const root = new TempRoot();
  try {
    const reportPath = root.write(
      'reports/q2-numeric.json',
      numericReport({
        windows: [
          {
            fixture: 'plane2000',
            label: 'oversized',
            classification: 'measured',
            window: { x: 0, y: 0, w: 4096, h: 4096, haloCells: 1 },
            cells: 4096 * 4096,
          },
        ],
      }),
    );
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
    const requirements = result.decision?.['requirements'] as { reasons: string[] }[];
    assert.match(requirements[0]!.reasons.join(' '), /4096x4096/);
  } finally {
    root.cleanup();
  }
});

test('no recorded window is a gap, not a pass from a missing failure string', () => {
  const root = new TempRoot();
  try {
    const reportPath = root.write('reports/q2-numeric.json', numericReport({ windows: [] }));
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('a wrong recorded route fails rather than being ignored', () => {
  const root = new TempRoot();
  try {
    const base = numericReport();
    base['identity'] = identity({ experiment: 'q2-numeric', routeId: 'some-other-route' });
    const reportPath = root.write('reports/q2-numeric.json', base);
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
    const requirements = result.decision?.['requirements'] as { reasons: string[] }[];
    assert.match(requirements[0]!.reasons.join(' '), /route conflict/);
  } finally {
    root.cleanup();
  }
});

test('a renamed experiment fails rather than being admitted as the role', () => {
  const root = new TempRoot();
  try {
    const base = numericReport();
    base['identity'] = identity({ experiment: 'q1-artifacts' });
    base['experiment'] = 'q1-artifacts';
    const reportPath = root.write('reports/q2-numeric.json', base);
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
  } finally {
    root.cleanup();
  }
});

test('a duplicate JSON object key is rejected before decoding can lose it', () => {
  const root = new TempRoot();
  try {
    const body = JSON.stringify(numericReport());
    const duplicated = body.replace('"testedWindows":9', '"testedWindows":9,"testedWindows":1');
    assert.notEqual(body, duplicated, 'the fixture must actually contain the key to duplicate');
    const reportPath = root.writeRaw('reports/q2-numeric.json', duplicated);
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
    const requirements = result.decision?.['requirements'] as { reasons: string[] }[];
    assert.match(requirements[0]!.reasons.join(' '), /repeats object key/);
  } finally {
    root.cleanup();
  }
});

test('a non-finite measurement is rejected rather than compared', () => {
  const root = new TempRoot();
  try {
    const body = JSON.stringify(numericReport()).replace('"testedWindows":9', '"testedWindows":NaN');
    const reportPath = root.writeRaw('reports/q2-numeric.json', body);
    const requestPath = request(root, { reportPath });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
    const requirements = result.decision?.['requirements'] as { reasons: string[] }[];
    assert.match(requirements[0]!.reasons.join(' '), /not a finite JSON number/);
  } finally {
    root.cleanup();
  }
});

test('invalid declarations stop the run with a nonzero status and no decision', () => {
  const root = new TempRoot();
  try {
    const reportPath = root.write('reports/q2-numeric.json', numericReport());
    const requestPath = root.write('request.json', {
      contract: contractWith([requirement('Q-LOCAL-1', ASSERTIONS)]),
      // A member that is not an object is malformed input, which stops the run.
      // A merely missing hash would be a gap, which must not stop it.
      fixtureManifest: fixtureManifest({ declared: ['a'] }),
      pins: { 'whitebox-wasm': '9c0ff4fdf3513f27b89c78e294610c3b418b3a4f' },
      now: NOW,
      sources: [{ role: 'q2', path: reportPath }],
    });
    const out = join(root.path, 'decision.json');
    const result = runCli(requestPath, out);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /invalid declaration/);
    assert.equal(result.decision, undefined, 'no decision may be published');
  } finally {
    root.cleanup();
  }
});

test('an unwritable destination exits nonzero without claiming a saved output', () => {
  const root = new TempRoot();
  try {
    const reportPath = root.write('reports/q2-numeric.json', numericReport());
    const requestPath = request(root, { reportPath });
    const blocker = root.write('blocker', 'not a directory');
    const result = runCli(requestPath, join(blocker, 'decision.json'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot write decision/);
    assert.doesNotMatch(result.stdout, /"out"/);
  } finally {
    root.cleanup();
  }
});

void ROUTE_ID;
void ENVIRONMENT_ID;
void HOST_ID;
void FIXTURE_NAME;
void FIXTURE_HASH;
