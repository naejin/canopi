/**
 * D1 acceptance — explicit check outcomes, and the display family that proves them.
 *
 * Two layers are covered deliberately:
 *
 * - the driver's own guards, through the narrow interface, because a malformed
 *   outcome, a duplicate id or a thrown check cannot be staged from a report;
 * - the display requirement through the real emitted CLI, because that is where the
 *   lost-failure families were observed.
 *
 * Each case asserts the target assertion, the requirement and an identifying reason,
 * and checks that unrelated requirements are undisturbed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';
import {
  runChecks,
  satisfied,
  unsatisfied,
  violated,
  type Check,
  type CheckContext,
  type RequirementChecks,
} from '../src/evidence/checks.js';
import type { SourceView } from '../src/decide.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

// --------------------------------------------------------------------------
// The driver's guards, exercised through the narrow interface
// --------------------------------------------------------------------------

const DIGEST = `sha256:${'a'.repeat(64)}`;

function view(role: string, digest = DIGEST): SourceView {
  return {
    role,
    label: `reports/${role}.json`,
    status: 'present',
    digest,
    // The snapshot must record the fields a check cites; `runs` is the field the
    // driver cases use.
    shape: { value: { runs: [] }, problems: [], gaps: [] },
    admission: {
      label: role,
      verdict: 'pass',
      sourceAdmitted: true,
      reasons: [],
      identity: {},
      positiveFailures: [],
      negativeControlFailures: [],
    },
    expectations: {} as SourceView['expectations'],
  };
}

function context(byRole: ReadonlyMap<string, SourceView> = new Map([['trace', view('trace')]])): CheckContext {
  return { requirementId: 'Q-TEST-1', byRole };
}

function spec(checks: readonly Check[], overrides: Partial<RequirementChecks> = {}): RequirementChecks {
  return {
    requirementId: 'Q-TEST-1',
    assertions: ['a1', 'a2'],
    required: checks.map((check) => check.id),
    unsupported: new Map<string, string>(),
    checks,
    ...overrides,
  };
}

function check(id: string, assertion: string, run: Check['run']): Check {
  return { id, assertion, run };
}

function pass(id: string, assertion = 'a1'): Check {
  return check(id, assertion, () => satisfied([{ role: 'trace', field: 'runs', digest: DIGEST }]));
}

test('driver: a satisfied check with validated evidence passes through the one reduction', () => {
  const result = runChecks(spec([pass('c.ok')], { assertions: ['a1'] }), context());
  assert.equal(result.assertions.get('a1'), 'pass');
  assert.deepEqual(result.defects, []);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0]!.verdict, 'pass');
});

test('driver: a missing outcome is an internal defect, not a pass and not an engine failure', () => {
  const checks = [check('c.none', 'a1', () => undefined as never), pass('c.ok', 'a2')];
  const result = runChecks(spec(checks), context());
  assert.equal(result.assertions.get('a1'), 'inconclusive');
  assert.equal(result.assertions.get('a2'), 'pass');
  assert.match(result.defects.join(' '), /c\.none returned .*not a check outcome/);
  assert.match(result.gaps.join(' '), /internal check defect/);
});

test('driver: a malformed outcome, a non-boolean and a contradictory success all defect', () => {
  const cases: readonly [string, unknown][] = [
    ['not an object', 'pass'],
    ['satisfied not boolean', { satisfied: 'yes', evidence: [], failures: [], gaps: [] }],
    [
      'satisfied with a failure',
      { satisfied: true, evidence: [{ role: 'trace', field: 'runs', digest: DIGEST }], failures: ['x'], gaps: [] },
    ],
    [
      'satisfied without evidence',
      { satisfied: true, evidence: [], failures: [], gaps: [] },
    ],
    [
      'failures not a list',
      { satisfied: false, evidence: [], failures: 'nope', gaps: [] },
    ],
  ];
  for (const [label, raw] of cases) {
    const result = runChecks(spec([check('c.bad', 'a1', () => raw as never)]), context());
    assert.equal(result.assertions.get('a1'), 'inconclusive', label);
    assert.equal(result.defects.length, 1, label);
    assert.equal(result.receipts[0]!.defect !== undefined, true, label);
  }
});

test('driver: evidence must match the admitted snapshot', () => {
  const wrongDigest = runChecks(
    spec([
      check('c.digest', 'a1', () =>
        satisfied([{ role: 'trace', field: 'runs', digest: `sha256:${'b'.repeat(64)}` }]),
      ),
    ]),
    context(),
  );
  assert.equal(wrongDigest.assertions.get('a1'), 'inconclusive');
  assert.match(wrongDigest.defects.join(' '), /digest does not match/);

  const unknownRole = runChecks(
    spec([
      check('c.role', 'a1', () =>
        satisfied([{ role: 'q9', field: 'runs', digest: DIGEST }]),
      ),
    ]),
    context(),
  );
  assert.equal(unknownRole.assertions.get('a1'), 'inconclusive');
  assert.match(unknownRole.defects.join(' '), /does not read/);

  const missingField = runChecks(
    spec([
      check('c.field', 'a1', () => satisfied([{ role: 'trace', field: 'runs[0].nope', digest: DIGEST }])),
    ]),
    context(),
  );
  assert.equal(missingField.assertions.get('a1'), 'inconclusive');
  assert.match(missingField.defects.join(' '), /does not record/);

  const missingRoot = runChecks(
    spec([check('c.root', 'a1', () => satisfied([{ role: 'trace', field: 'nope', digest: DIGEST }]))]),
    context(),
  );
  assert.equal(missingRoot.assertions.get('a1'), 'inconclusive');
  assert.match(missingRoot.defects.join(' '), /does not record/);

  // A failure cites its evidence for review: a reference into a record that is
  // absent is a gap, not an internal defect, because the outcome claims no support.
  const citedByFailure = runChecks(
    spec([
      check('c.fail', 'a1', () =>
        violated(['run 9 does not reconcile'], [
          { role: 'trace', field: 'runs[9].tileRequests', digest: DIGEST },
        ]),
      ),
    ]),
    context(),
  );
  assert.equal(citedByFailure.assertions.get('a1'), 'fail');
  assert.deepEqual(citedByFailure.defects, []);

  const absentSource = runChecks(
    spec([check('c.absent', 'a1', () => satisfied([{ role: 'trace', field: 'runs', digest: DIGEST }]))]),
    context(new Map([['trace', { ...view('trace'), status: 'absent' } as unknown as SourceView]])),
  );
  assert.equal(absentSource.assertions.get('a1'), 'inconclusive');
  assert.match(absentSource.defects.join(' '), /not admitted as a readable source/);
});

test('driver: an unregistered or duplicated check id is a defect and is not executed twice', () => {
  let runs = 0;
  const counted = check('c.counted', 'a1', () => {
    runs += 1;
    return satisfied([{ role: 'trace', field: 'runs', digest: DIGEST }]);
  });
  const unregistered = runChecks(
    spec([counted], { assertions: ['a1'], required: [] }),
    context(),
  );
  assert.equal(runs, 0, 'an unregistered check must not run');
  assert.match(unregistered.defects.join(' '), /not in the declared inventory/);
  assert.equal(unregistered.assertions.get('a1'), 'inconclusive');

  const duplicated = runChecks(spec([counted, counted], { assertions: ['a1'] }), context());
  assert.equal(runs, 1, 'a duplicate id must not run twice');
  assert.match(duplicated.defects.join(' '), /declared more than once/);

  const unknownAssertion = runChecks(
    spec([check('c.unknown', 'a9', () => satisfied([{ role: 'trace', field: 'runs', digest: DIGEST }]))], {
      assertions: ['a1'],
    }),
    context(),
  );
  assert.match(unknownAssertion.defects.join(' '), /which Q-TEST-1 does not declare/);
});

test('driver: missing implementation, unsupported coverage and uncovered assertions are named', () => {
  const missing = runChecks(
    spec([], { assertions: ['a1'], required: ['c.never'] }),
    context(),
  );
  assert.match(missing.defects.join(' '), /required check "c\.never" is not implemented/);

  const unsupported = runChecks(
    spec([], { assertions: ['a1'], required: [], unsupported: new Map([['a1', 'no probe emits this']]) }),
    context(),
  );
  assert.deepEqual(unsupported.defects, []);
  assert.equal(unsupported.assertions.get('a1'), 'inconclusive');
  assert.match(unsupported.gaps.join(' '), /no probe emits this/);

  const uncovered = runChecks(spec([], { assertions: ['a1'], required: [] }), context());
  assert.equal(uncovered.assertions.get('a1'), 'inconclusive');
  assert.match(uncovered.gaps.join(' '), /no evidence check decides a1/);

  const both = runChecks(
    spec([pass('c.both', 'a1')], { assertions: ['a1'], unsupported: new Map([['a1', 'reason']]) }),
    context(),
  );
  assert.match(both.defects.join(' '), /declared unsupported and also has an implemented check/);
});

test('driver: an unexplained unsatisfied outcome is a gap, and a defect never stops its siblings', () => {
  const unexplained = runChecks(
    spec([check('c.silent', 'a1', () => unsatisfied([]))]),
    context(),
  );
  assert.equal(unexplained.assertions.get('a1'), 'inconclusive');
  assert.match(unexplained.gaps.join(' '), /recorded no reason/);

  const throwing = runChecks(
    spec([
      check('c.throws', 'a1', () => {
        throw new Error('boom');
      }),
      pass('c.after', 'a1'),
    ]),
    context(),
  );
  // The defect is a gap, not a measured engine failure, so the assertion cannot pass
  // even though its sibling check succeeded; both outcomes are retained.
  assert.equal(throwing.assertions.get('a1'), 'inconclusive');
  assert.match(throwing.defects.join(' '), /"c\.throws" threw: boom/);
  assert.equal(throwing.receipts.length, 2, 'every check still ran');
  assert.equal(throwing.receipts.find((entry) => entry.check === 'c.after')?.verdict, 'pass');
});

test('driver: a recorded failure survives an independent gap in the same assertion', () => {
  const result = runChecks(
    spec([
      check('c.fail', 'a1', () => violated(['run 0 (cold) rendered 0 tiles'])),
      check('c.gap', 'a1', () => unsatisfied(['run 1 (warm) does not record its cache state'])),
    ]),
    context(),
  );
  assert.equal(result.assertions.get('a1'), 'fail');
  assert.match(result.failures.join(' '), /rendered 0 tiles/);
  assert.match(result.gaps.join(' '), /does not record its cache state/);
});

// --------------------------------------------------------------------------
// The display requirement through the real CLI
// --------------------------------------------------------------------------

interface Setup {
  readonly reports?: Reports;
  readonly outName?: string;
}

function decide(root: TempRoot, options: Setup = {}) {
  const reports = options.reports ?? roleReports();
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const request = root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
  return runCli(request, join(root.path, options.outName ?? 'decision.json'));
}

function requirementState(result: ReturnType<typeof runCli>, id: string): {
  readonly verdict: string | undefined;
  readonly assertions: globalThis.Record<string, string>;
  readonly reasons: string;
  readonly checks: readonly Rec[];
} {
  const found = (result.decision?.['requirements'] as
    | {
        id: string;
        verdict: string;
        assertions: globalThis.Record<string, string>;
        reasons: string[];
        checks?: Rec[];
      }[]
    | undefined)?.find((entry) => entry.id === id);
  return {
    verdict: found?.verdict,
    assertions: found?.assertions ?? {},
    reasons: found?.reasons.join(' ') ?? '',
    checks: found?.checks ?? [],
  };
}

function traceWith(root: TempRoot, mutate: (runs: Rec[]) => Rec[], options: Setup = {}) {
  const reports = options.reports ?? roleReports();
  const trace = reports['trace']!;
  reports['trace'] = { ...trace, runs: mutate(trace['runs'] as Rec[]) };
  return decide(root, { reports, ...options });
}

test('display: the coherent 100/100/100 trace passes its requirement and publishes receipts', () => {
  const root = new TempRoot();
  try {
    const result = decide(root);
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.verdict, 'pass', state.reasons);
    assert.equal(state.assertions['one-cold-and-three-warm-runs'], 'pass');
    assert.equal(state.assertions['hundred-valid-latencies-per-run'], 'pass');
    assert.equal(state.assertions['runs-report-successful-rendering'], 'pass');
    const ids = state.checks.map((entry) => entry['check']);
    assert.ok(ids.includes('display.failed-tiles'), 'the decision carries check receipts');
    assert.ok(ids.includes('display.sample-count-matches-rendered'));
    assert.equal(ids.length, 14);
    for (const receipt of state.checks) {
      assert.equal(typeof receipt['assertion'], 'string');
      assert.equal(receipt['defect'], undefined);
    }
  } finally {
    root.cleanup();
  }
});

test('display: one requested tile with 100 samples no longer qualifies', () => {
  const root = new TempRoot();
  try {
    const result = traceWith(root, (runs) =>
      runs.map((run, index) =>
        index === 0 ? { ...run, tileRequests: 1, tilesRendered: 1, failedTiles: 0 } : run,
      ),
    );
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.equal(state.assertions['runs-report-successful-rendering'], 'fail');
    assert.match(state.reasons, /requires at least 100/);
  } finally {
    root.cleanup();
  }
});

test('display: a run whose sample list is shorter than its render count fails', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const trace = reports['trace']!;
    const runs = trace['runs'] as Rec[];
    reports['trace'] = {
      ...trace,
      runs: runs.map((run, index) =>
        index === 0
          ? { ...run, individualLatenciesMs: (run['individualLatenciesMs'] as number[]).slice(0, 99) }
          : run,
      ),
    };
    const result = decide(root, { reports });
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.equal(state.assertions['hundred-valid-latencies-per-run'], 'fail');
    assert.match(state.reasons, /valid latency sample\(s\); the plan requires at least 100/);
    assert.match(state.reasons, /records 99 individual latency sample\(s\)/);
  } finally {
    root.cleanup();
  }
});

test('display: the former 128-render/100-sample control is not an oracle', () => {
  const root = new TempRoot();
  try {
    // The producer records one latency per rendered tile, so this shape is
    // physically inconsistent: it must fail rather than be blessed as a control.
    const result = traceWith(root, (runs) =>
      runs.map((run, index) =>
        index === 0 ? { ...run, tileRequests: 128, tilesRendered: 128, failedTiles: 0 } : run,
      ),
    );
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.equal(state.assertions['hundred-valid-latencies-per-run'], 'fail');
    assert.match(state.reasons, /rendered 128 tile\(s\) but records 100 individual latency sample\(s\)/);
  } finally {
    root.cleanup();
  }
});

test('display: a failed tile survives a missing ok, and a page error survives a missing count', () => {
  const root = new TempRoot();
  try {
    const result = traceWith(root, (runs) =>
      runs.map((run, index) => {
        if (index !== 0) return run;
        const copy: Rec = { ...run, failedTiles: 1 };
        delete copy['ok'];
        return copy;
      }),
    );
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.equal(state.assertions['runs-report-successful-rendering'], 'fail');
    assert.match(state.reasons, /with 1 failure/);
    assert.match(state.reasons, /does not record whether it rendered successfully/);
  } finally {
    root.cleanup();
  }

  const root2 = new TempRoot();
  try {
    const result = traceWith(root2, (runs) =>
      runs.map((run, index) => {
        if (index !== 0) return run;
        const copy: Rec = { ...run, pageErrors: ['render crashed'] };
        delete copy['tilesRendered'];
        return copy;
      }),
    );
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.equal(state.assertions['runs-report-successful-rendering'], 'fail');
    assert.match(state.reasons, /page error/);
  } finally {
    root2.cleanup();
  }
});

test('display: an over-bound stall fails with another run missing its counters', () => {
  const root = new TempRoot();
  try {
    const result = traceWith(root, (runs) =>
      runs.map((run, index) => {
        if (index === 0) return { ...run, longTaskMaxMs: 900 };
        const copy: Rec = { ...run };
        delete copy['tileRequests'];
        return copy;
      }),
    );
    const state = requirementState(result, 'Q-DISPLAY-1');
    assert.equal(state.assertions['no-ui-thread-task-above-bound'], 'fail');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /900 ms exceeds/);
  } finally {
    root.cleanup();
  }
});

test('display: unrelated requirements are undisturbed by a display failure', () => {
  const root = new TempRoot();
  try {
    const result = traceWith(root, (runs) =>
      runs.map((run, index) => (index === 0 ? { ...run, failedTiles: 1 } : run)),
    );
    const requirements = result.decision?.['requirements'] as { id: string; verdict: string }[];
    const other = requirements.find((entry) => entry.id === 'Q-CRS-1');
    assert.equal(other?.verdict, 'pass');
    assert.equal(requirements.find((entry) => entry.id === 'Q-ART-1')?.verdict, 'pass');
  } finally {
    root.cleanup();
  }
});
