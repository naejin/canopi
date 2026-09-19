/**
 * B1-B3 bounded same-family sweep.
 *
 * One table-driven pass over the leaves the repair touched: each leaf is exercised
 * absent, present-but-unusable and at a valid boundary; each comparison is exercised
 * alone and alongside an independent gap; records are permuted; and both CLI entry
 * modes are exercised for publication. The expectations are derived from C1-C8 and
 * the review's disposition, not from the checks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, runCliArgs, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, FIXTURE_HASH } from './fixtures.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

const CONTRACT = JSON.parse(readFileSync(realContractPath(), 'utf8')) as unknown;

function decide(root: TempRoot, reports: Reports, outName = 'decision.json') {
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const request = root.write('request.json', {
    contract: CONTRACT,
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
  return runCli(request, join(root.path, outName));
}

function requirementState(result: ReturnType<typeof runCli>, id: string): {
  readonly verdict: string | undefined;
  readonly assertions: globalThis.Record<string, string>;
  readonly reasons: string;
} {
  const found = (result.decision?.['requirements'] as
    | { id: string; verdict: string; assertions: globalThis.Record<string, string>; reasons: string[] }[]
    | undefined)?.find((entry) => entry.id === id);
  return {
    verdict: found?.verdict,
    assertions: found?.assertions ?? {},
    reasons: found?.reasons.join(' ') ?? '',
  };
}

function q2With(mutate: (q2: Rec) => Rec): Reports {
  const reports = roleReports();
  reports['q2'] = mutate(reports['q2']!);
  return reports;
}

// --------------------------------------------------------------------------
// A. Window dimension leaves
// --------------------------------------------------------------------------

interface WindowCase {
  readonly label: string;
  readonly window: Rec;
  readonly assertion: string;
  readonly reason: RegExp;
}

const WINDOW_CASES: readonly WindowCase[] = [
  { label: 'width absent', window: { h: 8 }, assertion: 'inconclusive', reason: /does not record w/ },
  { label: 'height absent', window: { w: 8 }, assertion: 'inconclusive', reason: /does not record h/ },
  {
    label: 'width is a string',
    window: { w: 'bad', h: 8 },
    assertion: 'fail',
    reason: /w=the string "bad", which is not a usable window dimension/,
  },
  { label: 'width is null', window: { w: null, h: 8 }, assertion: 'fail', reason: /w=null/ },
  { label: 'width is a list', window: { w: [8], h: 8 }, assertion: 'fail', reason: /w=a list/ },
  { label: 'width is an object', window: { w: { v: 8 }, h: 8 }, assertion: 'fail', reason: /w=an object/ },
  {
    label: 'width is a boolean',
    window: { w: true, h: 8 },
    assertion: 'fail',
    reason: /w=the boolean true/,
  },
  {
    label: 'width is zero',
    window: { w: 0, h: 8 },
    assertion: 'fail',
    reason: /not a whole positive number of cells/,
  },
  {
    label: 'width is fractional',
    window: { w: 0.5, h: 8 },
    assertion: 'fail',
    reason: /not a whole positive number of cells/,
  },
  {
    label: 'width is negative',
    window: { w: -8, h: 8 },
    assertion: 'fail',
    reason: /not a whole positive number of cells/,
  },
  {
    label: 'width over the edge without a height',
    window: { w: 2048 },
    assertion: 'fail',
    reason: /width of 2048 exceeds the 1024x1024 window contract/,
  },
  {
    label: 'height over the edge without a width',
    window: { h: 2048 },
    assertion: 'fail',
    reason: /height of 2048 exceeds the 1024x1024 window contract/,
  },
  {
    label: 'both dimensions over the area limit',
    window: { w: 1024, h: 1025 },
    assertion: 'fail',
    reason: /exceeds the 1048576-cell contract limit/,
  },
  { label: 'edge boundary', window: { w: 1024, h: 1024 }, assertion: 'pass', reason: /./ },
  { label: 'smallest boundary', window: { w: 1, h: 1 }, assertion: 'pass', reason: /./ },
];

test('sweep: every window dimension leaf is classified on its own', () => {
  for (const entry of WINDOW_CASES) {
    const root = new TempRoot();
    try {
      const reports = q2With((q2) => ({
        ...q2,
        windows: [{ classification: 'measured', window: entry.window }],
      }));
      const current = requirementState(decide(root, reports), 'Q-LOCAL-1');
      const assertion = current.assertions['window-size-within-contract-limit'];
      if (entry.assertion === 'pass') {
        assert.equal(assertion, 'pass', `${entry.label}: ${current.reasons}`);
        assert.equal(current.verdict, 'pass', `${entry.label}: ${current.reasons}`);
      } else {
        assert.equal(assertion, entry.assertion, `${entry.label}: ${current.reasons}`);
        assert.match(current.reasons, entry.reason, entry.label);
      }
    } finally {
      root.cleanup();
    }
  }
});

test('sweep: record order and an unusable sibling do not change a window failure', () => {
  const cases: readonly (readonly [string, Rec[]])[] = [
    [
      'violation second',
      [
        { classification: 'measured', window: { w: 1024, h: 1024 } },
        { classification: 'measured', window: { w: 2048 } },
      ],
    ],
    [
      'violation first, unusable second',
      [
        { classification: 'measured', window: { w: 2048 } },
        { classification: 'measured', window: { w: 'bad', h: 8 } },
      ],
    ],
    [
      'unusable first, violation second',
      [
        { classification: 'measured', window: { h: 8 } },
        { classification: 'measured', window: { w: 2048, h: 8 } },
      ],
    ],
  ];
  for (const [label, windows] of cases) {
    const root = new TempRoot();
    try {
      const current = requirementState(
        decide(root, q2With((q2) => ({ ...q2, windows }))),
        'Q-LOCAL-1',
      );
      assert.equal(current.verdict, 'fail', `${label}: ${current.reasons}`);
      assert.equal(current.assertions['window-size-within-contract-limit'], 'fail', label);
    } finally {
      root.cleanup();
    }
  }
});

test('sweep: an unmeasured window record is reported, never silently dropped', () => {
  const root = new TempRoot();
  try {
    const current = requirementState(
      decide(
        root,
        q2With((q2) => ({
          ...q2,
          windows: [{ classification: 'simulated', window: { w: 4096, h: 4096 } }],
        })),
      ),
      'Q-LOCAL-1',
    );
    assert.equal(current.assertions['window-size-within-contract-limit'], 'inconclusive', current.reasons);
    assert.match(current.reasons, /classification the string "simulated"/);
  } finally {
    root.cleanup();
  }
});

test('sweep: a non-finite dimension is rejected by parsing, not compared', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    // JSON.stringify cannot emit that token, so the raw body is written directly.
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: role === 'q2'
        ? root.writeRaw(
            'reports/q2.json',
            JSON.stringify(reports['q2']).replace('"w":1024', '"w":1e999'),
          )
        : root.write(`reports/${role}.json`, reports[role]!),
    }));
    const request = root.write('request.json', {
      contract: CONTRACT,
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const result = runCli(request, join(root.path, 'decision.json'));
    assert.equal(result.status, 1, result.stderr);
    const current = requirementState(result, 'Q-LOCAL-1');
    // The report is corrupt input, so the requirement fails on that ground while the
    // window assertion itself never receives a value to compare.
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /non-finite JSON number/);
    assert.equal(current.assertions['window-size-within-contract-limit'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// B. Ledger counters
// --------------------------------------------------------------------------

interface LedgerCase {
  readonly label: string;
  readonly q2: Rec;
  readonly assertion: string;
  readonly reason: RegExp;
}

const LEDGER_CASES: readonly LedgerCase[] = [
  { label: 'bytes absent', q2: { serverLedger: { fixtureRequests: 2 } }, assertion: 'inconclusive', reason: /does not record both bytes served/ },
  { label: 'requests absent', q2: { serverLedger: { fixtureBytesServed: 10 } }, assertion: 'inconclusive', reason: /does not record both bytes served/ },
  {
    label: 'bytes not a number',
    q2: { serverLedger: { fixtureBytesServed: 'many', fixtureRequests: 2 } },
    assertion: 'fail',
    // The counters count discrete things, so the wording names the whole-number rule
    // rather than finiteness; the verdict is unchanged.
    reason: /fixtureBytesServed=the string "many", which is not a whole non-negative byte count/,
  },
  { label: 'bytes null', q2: { serverLedger: { fixtureBytesServed: null, fixtureRequests: 2 } }, assertion: 'fail', reason: /fixtureBytesServed=null/ },
  { label: 'bytes negative', q2: { serverLedger: { fixtureBytesServed: -1 } }, assertion: 'fail', reason: /-1 byte\(s\) served/ },
  { label: 'requests negative', q2: { serverLedger: { fixtureBytesServed: 10, fixtureRequests: -2 } }, assertion: 'fail', reason: /-2 request\(s\)/ },
  { label: 'zero ledger with validated windows', q2: { serverLedger: { fixtureBytesServed: 0, fixtureRequests: 0 } }, assertion: 'fail', reason: /does not corroborate the reads/ },
  { label: 'served bytes with no validated window', q2: { testedWindows: 0, serverLedger: { fixtureBytesServed: 10, fixtureRequests: 2 } }, assertion: 'fail', reason: /although no window was validated/ },
  { label: 'window count negative', q2: { testedWindows: -1 }, assertion: 'fail', reason: /not a possible count/ },
  {
    label: 'window count not a number',
    q2: { testedWindows: 'nine' },
    assertion: 'fail',
    reason: /testedWindows=the string "nine", which is not a whole non-negative validated-window count/,
  },
  { label: 'coherent ledger', q2: {}, assertion: 'pass', reason: /./ },
];

test('sweep: every ledger counter is classified on its own', () => {
  for (const entry of LEDGER_CASES) {
    const root = new TempRoot();
    try {
      const reports = q2With((q2) => ({ ...q2, ...entry.q2 }));
      const current = requirementState(decide(root, reports), 'Q-LOCAL-1');
      const assertion = current.assertions['transport-ledger-corroborates-bytes'];
      if (entry.assertion === 'pass') {
        assert.equal(assertion, 'pass', `${entry.label}: ${current.reasons}`);
      } else {
        assert.equal(assertion, entry.assertion, `${entry.label}: ${current.reasons}`);
        assert.match(current.reasons, entry.reason, entry.label);
      }
    } finally {
      root.cleanup();
    }
  }
});

test('sweep: a negative counter and a missing sibling are both recorded', () => {
  const root = new TempRoot();
  try {
    const current = requirementState(
      decide(root, q2With((q2) => ({ ...q2, serverLedger: { fixtureBytesServed: -1 } }))),
      'Q-LOCAL-1',
    );
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /-1 byte\(s\) served/);
    assert.match(current.reasons, /does not record both bytes served/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// C. Sidecar policy, hashes and survival
// --------------------------------------------------------------------------

interface SidecarCase {
  readonly label: string;
  readonly policy?: unknown;
  readonly sidecar?: unknown;
  readonly declared?: unknown;
  readonly assertion: string;
  readonly reason: RegExp;
}

const SIDECAR_CASES: readonly SidecarCase[] = [
  {
    label: 'complete measured record',
    policy: 'measured',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: true },
    assertion: 'pass',
    reason: /./,
  },
  {
    label: 'disappearance, measured policy',
    policy: 'measured',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: false },
    assertion: 'fail',
    reason: /did not survive preparation/,
  },
  {
    label: 'disappearance, policy absent',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: false },
    assertion: 'fail',
    reason: /sidecar policy/,
  },
  {
    label: 'disappearance, policy unrecognised',
    policy: 'maybe',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: false },
    assertion: 'fail',
    reason: /unrecognised sidecar policy/,
  },
  {
    label: 'disappearance, not-applicable declaration',
    policy: 'not_applicable',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: false },
    assertion: 'fail',
    reason: /did not survive preparation/,
  },
  { label: 'not-applicable, no record', policy: 'not_applicable', assertion: 'pass', reason: /./ },
  {
    label: 'not-applicable, consistent record',
    policy: 'not_applicable',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, after: true },
    assertion: 'pass',
    reason: /./,
  },
  {
    label: 'measured, no record',
    policy: 'measured',
    assertion: 'inconclusive',
    reason: /no sidecar record was supplied/,
  },
  { label: 'policy absent, no record', assertion: 'inconclusive', reason: /sidecar policy/ },
  {
    label: 'measured, record not an object',
    policy: 'measured',
    sidecar: 'x',
    assertion: 'fail',
    reason: /not an object/,
  },
  {
    label: 'measured, malformed expected hash',
    policy: 'measured',
    sidecar: { expectedSha256: 'x', sha256: 'x', before: true, after: true },
    assertion: 'fail',
    reason: /not a SHA-256 digest/,
  },
  {
    label: 'measured, hashes disagree',
    policy: 'measured',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: 'b'.repeat(64), before: true, after: true },
    assertion: 'fail',
    reason: /sidecar changed/,
  },
  {
    label: 'measured, hash conflicts with the declaration',
    policy: 'measured',
    declared: 'c'.repeat(64),
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: true },
    assertion: 'fail',
    reason: /hash conflict/,
  },
  {
    label: 'measured, survival unreported',
    policy: 'measured',
    sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true },
    assertion: 'inconclusive',
    reason: /does not observe that the sidecar survived/,
  },
];

test('sweep: sidecar leaves are judged independently of the declared policy', () => {
  for (const entry of SIDECAR_CASES) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q3 = reports['q3prepare']!;
      const identity = { ...(q3['identity'] as Rec) };
      delete identity['sidecarPolicy'];
      if (entry.policy !== undefined) identity['sidecarPolicy'] = entry.policy;
      if (entry.declared !== undefined) identity['sidecarSha256'] = { expected: entry.declared };
      const updated: Rec = { ...q3, identity };
      // The coherent control carries a sidecar record, so "no record" must remove it.
      delete updated['sidecar'];
      if (entry.sidecar !== undefined) updated['sidecar'] = entry.sidecar;
      reports['q3prepare'] = updated;
      const current = requirementState(decide(root, reports), 'Q-PREP-1');
      const assertion = current.assertions['sidecar-unchanged'];
      if (entry.assertion === 'pass') {
        assert.equal(assertion, 'pass', `${entry.label}: ${current.reasons}`);
      } else {
        assert.equal(assertion, entry.assertion, `${entry.label}: ${current.reasons}`);
        assert.match(current.reasons, entry.reason, entry.label);
      }
    } finally {
      root.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// D. Resource role labels
// --------------------------------------------------------------------------

test('sweep: role labels are attributed explicitly and classified by presence', () => {
  const referenceRoute = 'reference reader (native byte-range, NOT the candidate route)';
  const cases: readonly (readonly [string, unknown, string, string, RegExp])[] = [
    ['candidate', 'candidate', 'candidate (wasm ranged transport)', 'pass', /./],
    ['reference', 'reference', referenceRoute, 'inconclusive', /no measurement declares the candidate route role/],
    [
      'absent',
      undefined,
      'candidate (wasm ranged transport)',
      'inconclusive',
      /records no route role/,
    ],
    ['null', null, 'candidate (wasm ranged transport)', 'fail', /routeRole=null/],
    ['number', 3, 'candidate (wasm ranged transport)', 'fail', /routeRole=the number 3/],
    ['list', ['candidate'], 'candidate (wasm ranged transport)', 'fail', /routeRole=a list/],
    ['object', { role: 'candidate' }, 'candidate (wasm ranged transport)', 'fail', /routeRole=an object/],
    [
      'empty string',
      '',
      'candidate (wasm ranged transport)',
      'fail',
      /routeRole=the string ""/,
    ],
    ['unknown label', 'other', 'other route', 'fail', /neither candidate nor reference/],
  ];
  for (const [label, value, route, expected, reason] of cases) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const measurements = (q6['measurements'] as Rec[]).map((entry, index) => {
        if (index !== 0) return entry;
        const copy: Rec = { ...entry, route };
        if (value === undefined) delete copy['routeRole'];
        else copy['routeRole'] = value;
        return copy;
      });
      reports['q6resources'] = { ...q6, measurements };
      const current = requirementState(decide(root, reports), 'Q-RES-1');
      assert.equal(
        current.assertions['measurement-is-of-candidate-route'],
        expected,
        `${label}: ${current.reasons}`,
      );
      assert.match(current.reasons, reason, label);
      // A label that is present but unusable fails the reference-side assertion too.
      if (expected === 'fail') {
        assert.equal(
          current.assertions['reference-measurements-labelled-separately'],
          'fail',
          `${label}: ${current.reasons}`,
        );
      }
      assert.notEqual(current.verdict, 'pass', label);
    } finally {
      root.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// E. Publication entry modes
// --------------------------------------------------------------------------

function reportFiles(): readonly (readonly [string, string])[] {
  return [
    ['q1', 'q1-artifacts.json'],
    ['q2', 'q2-numeric.json'],
    ['q3prepare', 'q3-prepare.json'],
    ['q3members', 'q3-members.json'],
    ['q4slope', 'q4-slope.json'],
    ['q4crs', 'q4-crs.json'],
    ['q5lifecycle', 'q5-lifecycle.json'],
    ['q6resources', 'q6-resources.json'],
    ['trace', 'q6-trace.json'],
  ];
}

test('sweep: both entry modes refuse an aliased destination and publish to a fresh one', () => {
  // Directory mode: the declared reports live under `actual`, reached through `alias`.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const actual = join(root.path, 'actual');
    mkdirSync(actual, { recursive: true });
    for (const [role, file] of reportFiles()) {
      writeFileSync(join(actual, file), JSON.stringify(reports[role]!), 'utf8');
    }
    const alias = join(root.path, 'alias');
    symlinkSync(actual, alias);

    const collided = join(alias, 'q1-artifacts.json');
    const before = readFileSync(collided, 'utf8');
    const refused = runCliArgs(
      ['--reports', actual, '--contract', realContractPath(), '--out', collided],
      collided,
    );
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(collided, 'utf8'), before);

    const fresh = join(root.path, 'fresh', 'decision.json');
    mkdirSync(join(root.path, 'fresh'), { recursive: true });
    const published = runCliArgs(
      ['--reports', actual, '--contract', realContractPath(), '--out', fresh],
      fresh,
    );
    assert.equal(published.status, 1, published.stderr);
    const decision = JSON.parse(readFileSync(fresh, 'utf8')) as Rec;
    assert.equal(decision['version'], 2);
  } finally {
    root.cleanup();
  }
});

test('sweep: a dangling ancestor of an absent input refuses publication', () => {
  const root = new TempRoot();
  try {
    const dangling = join(root.path, 'dangling');
    symlinkSync(join(root.path, 'never-created'), dangling);
    const reports = roleReports();
    const sources: { role: string; path: string }[] = SOURCE_ROLES.filter(
      (role) => role !== 'q2',
    ).map((role) => ({
      role,
      path: root.write(`reports/${role}.json`, reports[role]!),
    }));
    sources.push({ role: 'q2', path: join(dangling, 'not-yet.json') });
    const request = root.write('request.json', {
      contract: CONTRACT,
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const out = join(root.path, 'decision.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(out), false);
    assert.equal(existsSync(join(root.path, 'never-created')), false);
    assert.match(result.stderr, /cannot resolve the existing ancestor/);
  } finally {
    root.cleanup();
  }
});

test('sweep: nested aliases are resolved through to the real directory', () => {
  const root = new TempRoot();
  try {
    const actual = join(root.path, 'actual');
    mkdirSync(actual, { recursive: true });
    const first = join(root.path, 'first');
    const second = join(root.path, 'second');
    symlinkSync(actual, first);
    symlinkSync(first, second);
    const reports = roleReports();
    const sources: { role: string; path: string }[] = SOURCE_ROLES.filter(
      (role) => role !== 'q2',
    ).map((role) => ({
      role,
      path: root.write(`reports/${role}.json`, reports[role]!),
    }));
    sources.push({ role: 'q2', path: join(second, 'not-yet.json') });
    const request = root.write('request.json', {
      contract: CONTRACT,
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const out = join(actual, 'not-yet.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(out), false);
  } finally {
    root.cleanup();
  }
});
