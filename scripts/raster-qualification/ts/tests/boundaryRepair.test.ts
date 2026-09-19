/**
 * B1-B3 acceptance — the three families the settled-design review confirmed.
 *
 * Every case starts from the coherent control, perturbs one relationship, and
 * asserts the target assertion or requirement, an identifying failure or gap
 * reason, and the unaffected neighbours. The expectations come from the review's
 * disposition and C1-C8, not from the checks under test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, runCliArgs, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, FIXTURE_HASH } from './fixtures.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

const CONTRACT = JSON.parse(readFileSync(realContractPath(), 'utf8')) as unknown;

interface Setup {
  readonly reports?: Reports;
  readonly omitSources?: readonly string[];
  readonly now?: unknown;
  readonly outName?: string;
}

function request(root: TempRoot, options: Setup = {}): string {
  const reports = options.reports ?? roleReports();
  const omitted = new Set(options.omitSources ?? []);
  const sources = SOURCE_ROLES.filter((role) => !omitted.has(role)).map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  return root.write('request.json', {
    contract: CONTRACT,
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: options.now ?? NOW,
    sources,
  });
}

function decide(root: TempRoot, options: Setup = {}) {
  const out = join(root.path, options.outName ?? 'decision.json');
  return runCli(request(root, options), out);
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

function withQ2(root: TempRoot, mutate: (q2: Rec) => Rec, options: Setup = {}) {
  const reports = options.reports ?? roleReports();
  reports['q2'] = mutate(reports['q2']!);
  return decide(root, { ...options, reports });
}

// --------------------------------------------------------------------------
// B1 — absent-input aliases must not be created
// --------------------------------------------------------------------------

interface AliasFixture {
  readonly root: TempRoot;
  readonly request: string;
  readonly actual: string;
  readonly alias: string;
  readonly absentInput: string;
}

/** A request whose q2 source is an absent file reached through a directory alias. */
function aliasRequest(root: TempRoot, inputPath: string): string {
  const reports = roleReports();
  const sources: { role: string; path: string }[] = SOURCE_ROLES.filter((role) => role !== 'q2').map(
    (role) => ({
      role,
      path: root.write(`reports/${role}.json`, reports[role]!),
    }),
  );
  sources.push({ role: 'q2', path: inputPath });
  return root.write('request.json', {
    contract: CONTRACT,
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
}

function aliasFixture(): AliasFixture {
  const root = new TempRoot();
  const actual = join(root.path, 'actual');
  mkdirSync(actual, { recursive: true });
  const alias = join(root.path, 'alias');
  symlinkSync(actual, alias);
  return {
    root,
    request: '',
    actual,
    alias,
    absentInput: join(alias, 'not-yet.json'),
  };
}

test('B1: an absent input reached through an alias is not created by publication', () => {
  const fixture = aliasFixture();
  try {
    const request = aliasRequest(fixture.root, fixture.absentInput);
    const out = join(fixture.actual, 'not-yet.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(out), false, 'publication created the absent input');
    assert.equal(existsSync(fixture.absentInput), false);
    assert.match(result.stderr, /input|already exists/);
    const diagnostic = /non-qualifying diagnostic was written to (.+)/.exec(result.stderr)?.[1]?.trim();
    assert.ok(diagnostic !== undefined, result.stderr);
  } finally {
    fixture.root.cleanup();
  }
});

test('B1: the alias may be on the output side', () => {
  const root = new TempRoot();
  try {
    const actual = join(root.path, 'actual');
    mkdirSync(actual, { recursive: true });
    const alias = join(root.path, 'alias');
    symlinkSync(actual, alias);
    const absent = join(actual, 'not-yet.json');
    const request = aliasRequest(root, absent);
    const out = join(alias, 'not-yet.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(out), false);
    assert.equal(existsSync(absent), false);
  } finally {
    root.cleanup();
  }
});

test('B1: a rejected request cannot create an absent aliased input', () => {
  const fixture = aliasFixture();
  try {
    const reports = roleReports();
    const sources: { role: string; path: string }[] = SOURCE_ROLES.filter((role) => role !== 'q2').map(
      (role) => ({
        role,
        path: fixture.root.write(`reports/${role}.json`, reports[role]!),
      }),
    );
    sources.push({ role: 'q2', path: fixture.absentInput });
    const request = fixture.root.write('request.json', {
      contract: CONTRACT,
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: 'invalid',
      sources,
    });
    const out = join(fixture.actual, 'not-yet.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(out), false, 'the rejection path created the absent input');
  } finally {
    fixture.root.cleanup();
  }
});

test('B1: directory mode protects an absent declared report behind an alias', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const files: readonly (readonly [string, string])[] = [
      ['q1', 'q1-artifacts.json'],
      ['q2', 'q2-numeric.json'],
      ['q3prepare', 'q3-prepare.json'],
      ['q3members', 'q3-members.json'],
      ['q4slope', 'q4-slope.json'],
      ['q4crs', 'q4-crs.json'],
      ['q5lifecycle', 'q5-lifecycle.json'],
      ['q6resources', 'q6-resources.json'],
    ];
    const actual = join(root.path, 'actual');
    mkdirSync(actual, { recursive: true });
    for (const [role, file] of files) root.write(join('actual', file), reports[role]!);
    const alias = join(root.path, 'alias');
    symlinkSync(actual, alias);
    const out = join(alias, 'q6-trace.json');
    const result = runCliArgs(
      ['--reports', actual, '--contract', realContractPath(), '--out', out],
      out,
    );
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(out), false, 'the absent declared report was created');
  } finally {
    root.cleanup();
  }
});

test('B1: a missing intermediate directory refuses without creating it', () => {
  const root = new TempRoot();
  try {
    const actual = join(root.path, 'actual');
    mkdirSync(actual, { recursive: true });
    const alias = join(root.path, 'alias');
    symlinkSync(actual, alias);
    const absent = join(actual, 'missing-dir', 'not-yet.json');
    const request = aliasRequest(root, absent);
    const out = join(alias, 'missing-dir', 'not-yet.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(existsSync(join(actual, 'missing-dir')), false, 'the input directory was created');
  } finally {
    root.cleanup();
  }
});

test('B1: a distinct fresh output still receives the decision for an absent input', () => {
  const fixture = aliasFixture();
  try {
    const request = aliasRequest(fixture.root, fixture.absentInput);
    const out = join(fixture.root.path, 'unrelated', 'decision.json');
    mkdirSync(join(fixture.root.path, 'unrelated'), { recursive: true });
    const result = runCli(request, out);
    assert.equal(result.status, 1, result.stderr);
    const decision = JSON.parse(readFileSync(out, 'utf8')) as Rec;
    assert.equal(decision['version'], 2);
    assert.equal(existsSync(fixture.absentInput), false);
  } finally {
    fixture.root.cleanup();
  }
});

// --------------------------------------------------------------------------
// B2 — independent failures before cross-field comparisons
// --------------------------------------------------------------------------

test('B2: a width above the edge limit fails without a height, and the gap is also recorded', () => {
  const root = new TempRoot();
  try {
    const result = withQ2(root, (q2) => ({
      ...q2,
      windows: [
        {
          classification: 'measured',
          window: { x: 0, y: 0, w: 2048, haloCells: 1 },
        },
      ],
    }));
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['window-size-within-contract-limit'], 'fail');
    assert.match(current.reasons, /2048/);
    assert.match(current.reasons, /exceeds the 1024x1024 window contract/);
    assert.match(current.reasons, /does not record .*h|height/);
  } finally {
    root.cleanup();
  }
});

test('B2: negative served bytes fail without a request count, and the gap is also recorded', () => {
  const root = new TempRoot();
  try {
    const result = withQ2(root, (q2) => ({
      ...q2,
      serverLedger: { fixtureBytesServed: -1 },
    }));
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['transport-ledger-corroborates-bytes'], 'fail');
    assert.match(current.reasons, /-1 byte/);
    assert.match(current.reasons, /does not record both bytes served and request count/);
  } finally {
    root.cleanup();
  }
});

test('B2: an area comparison without operands does not erase a dimension failure', () => {
  const root = new TempRoot();
  try {
    const result = withQ2(root, (q2) => ({
      ...q2,
      windows: [
        { classification: 'measured', window: { w: 4096 } },
        { classification: 'measured', window: { h: 4096 } },
      ],
    }));
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    // Both widths/heights that were recorded individually exceed the edge contract.
    assert.match(current.reasons, /4096/);
    assert.match(current.reasons, /does not record/);
  } finally {
    root.cleanup();
  }
});

test('B2: a recorded sidecar disappearance fails even when the policy is absent', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q3 = reports['q3prepare']!;
    const identity = { ...(q3['identity'] as Rec) };
    delete identity['sidecarPolicy'];
    reports['q3prepare'] = {
      ...q3,
      identity,
      sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, before: true, after: false },
    };
    const result = decide(root, { reports });
    const current = requirementState(result, 'Q-PREP-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['sidecar-unchanged'], 'fail');
    assert.match(current.reasons, /did not survive preparation/);
    assert.match(current.reasons, /sidecar policy/);
  } finally {
    root.cleanup();
  }
});

test('B2: a genuinely not-applicable sidecar policy keeps its behaviour', () => {
  const root = new TempRoot();
  try {
    const result = decide(root);
    const current = requirementState(result, 'Q-PREP-1');
    assert.equal(current.assertions['sidecar-unchanged'], 'pass', current.reasons);
    assert.equal(current.verdict, 'pass', current.reasons);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// B3 — malformed present leaves fail, absent leaves gap
// --------------------------------------------------------------------------

test('B3: a present unusable window dimension fails rather than gapping', () => {
  const cases: readonly [string, unknown][] = [
    ['string', 'bad'],
    ['null', null],
    ['list', [1]],
    ['object', { value: 1 }],
    ['boolean', true],
  ];
  for (const [label, value] of cases) {
    const root = new TempRoot();
    try {
      const result = withQ2(root, (q2) => ({
        ...q2,
        windows: [{ classification: 'measured', window: { w: value, h: 8 } }],
      }));
      const current = requirementState(result, 'Q-LOCAL-1');
      assert.equal(current.assertions['window-size-within-contract-limit'], 'fail', `${label}: ${current.reasons}`);
      assert.equal(current.verdict, 'fail', `${label}: ${current.reasons}`);
    } finally {
      root.cleanup();
    }
  }
});

test('B3: an absent window dimension is a gap, and a boundary control passes', () => {
  const root = new TempRoot();
  try {
    const result = withQ2(root, (q2) => ({
      ...q2,
      windows: [{ classification: 'measured', window: { h: 8 } }],
    }));
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.assertions['window-size-within-contract-limit'], 'inconclusive', current.reasons);
    assert.match(current.reasons, /does not record w/);
  } finally {
    root.cleanup();
  }

  const boundary = new TempRoot();
  try {
    const result = withQ2(boundary, (q2) => ({
      ...q2,
      windows: [{ classification: 'measured', window: { w: 1024, h: 1024 } }],
    }));
    const current = requirementState(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'pass', current.reasons);
  } finally {
    boundary.cleanup();
  }
});

test('B3: a present unusable route role fails rather than becoming a gap', () => {
  const cases: readonly [string, unknown][] = [
    ['null', null],
    ['number', 3],
    ['list', ['candidate']],
    ['object', { role: 'candidate' }],
    ['empty string', ''],
  ];
  for (const [label, value] of cases) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const measurements = (q6['measurements'] as Rec[]).map((entry, index) =>
        index === 0 ? { ...entry, routeRole: value } : entry,
      );
      reports['q6resources'] = { ...q6, measurements };
      const result = decide(root, { reports });
      const current = requirementState(result, 'Q-RES-1');
      assert.equal(
        current.assertions['measurement-is-of-candidate-route'],
        'fail',
        `${label}: ${current.reasons}`,
      );
      assert.equal(
        current.assertions['reference-measurements-labelled-separately'],
        'fail',
        `${label}: ${current.reasons}`,
      );
      assert.notEqual(current.verdict, 'pass');
    } finally {
      root.cleanup();
    }
  }
});

test('B3: an absent route role still gaps, and the reference label stays the control', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q6 = reports['q6resources']!;
    const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) => {
      if (index !== 0) return entry;
      const copy: Rec = { ...entry };
      delete copy['routeRole'];
      return copy;
    });
    reports['q6resources'] = { ...q6, measurements };
    const result = decide(root, { reports });
    const current = requirementState(result, 'Q-RES-1');
    assert.equal(current.assertions['measurement-is-of-candidate-route'], 'inconclusive', current.reasons);
    assert.equal(
      current.assertions['reference-measurements-labelled-separately'],
      'inconclusive',
      current.reasons,
    );
    assert.match(current.reasons, /route role/);
  } finally {
    root.cleanup();
  }
});

test('B3: unaffected requirements stay decided while the repaired ones fail', () => {
  const root = new TempRoot();
  try {
    const result = withQ2(root, (q2) => ({
      ...q2,
      windows: [{ classification: 'measured', window: { w: 'bad', h: 8 } }],
    }));
    const requirements = result.decision?.['requirements'] as { id: string; verdict: string }[];
    assert.equal(requirements.find((entry) => entry.id === 'Q-ART-1')?.verdict, 'pass');
    assert.equal(requirements.find((entry) => entry.id === 'Q-CRS-1')?.verdict, 'pass');
    assert.equal(requirements.find((entry) => entry.id === 'Q-DISPLAY-1')?.verdict, 'pass');
  } finally {
    root.cleanup();
  }
});
