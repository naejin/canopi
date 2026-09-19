/**
 * The C1-C8 boundary families.
 *
 * Each family is parameterized across the wrong types, absences and conflicts that
 * can reach it, rather than testing the one example a review happened to record.
 * Every case starts from the coherent control in `contractFixture` and perturbs one
 * input, so a result cannot be explained by an unrelated gap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, FIXTURE_HASH, traceRun, PLAN } from './fixtures.js';

function writeRequest(
  root: TempRoot,
  reports: Record<string, Record<string, unknown>>,
  options: {
    manifest?: unknown;
    pins?: unknown;
    omits?: readonly string[];
    now?: unknown;
  } = {},
): string {
  const omitted = new Set(options.omits ?? []);
  const sources = SOURCE_ROLES.filter((role) => !omitted.has(role)).map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  return root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: options.manifest ?? fixtureManifest(),
    pins: options.pins ?? candidatePins(),
    now: options.now ?? NOW,
    sources,
  });
}

/** The reported verdict for one requirement, for a compact assertion. */
function verdictOf(result: ReturnType<typeof runCli>, id: string): string | undefined {
  const requirements = result.decision?.['requirements'] as { id: string; verdict: string }[] | undefined;
  return requirements?.find((entry) => entry.id === id)?.verdict;
}

function reasonsOf(result: ReturnType<typeof runCli>, id: string): string {
  const requirements = result.decision?.['requirements'] as
    | { id: string; reasons: string[] }[]
    | undefined;
  return requirements?.find((entry) => entry.id === id)?.reasons.join(' ') ?? '';
}

// --------------------------------------------------------------------------
// C1 - strict leaf values and keyed records
// --------------------------------------------------------------------------

/** Values a boolean leaf must reject. `true`/`false` are the only usable ones. */
const NOT_BOOLEANS: readonly [string, unknown][] = [
  ['string false', 'false'],
  ['string true', 'true'],
  ['int one', 1],
  ['int zero', 0],
  ['float', 1.5],
  ['empty string', ''],
  ['list', [true]],
  ['object', { ok: true }],
  ['null', null],
];

test('C1: an assertion outcome accepts only a boolean', () => {
  for (const [label, value] of NOT_BOOLEANS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q2 = reports['q2']!;
      const assertions = (q2['assertions'] as Record<string, unknown>[]).map((entry, index) =>
        index === 0 ? { ...entry, ok: value } : entry,
      );
      reports['q2'] = { ...q2, assertions };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail', `ok=${label} was accepted`);
      assert.match(reasonsOf(result, 'Q-LOCAL-1'), /not a boolean/, `ok=${label}`);
    } finally {
      root.cleanup();
    }
  }
});

test('C1: a precondition outcome accepts only a boolean', () => {
  for (const [label, value] of NOT_BOOLEANS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q2 = reports['q2']!;
      reports['q2'] = { ...q2, preconditions: [{ name: 'range-supported', met: value }] };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail', `met=${label} was accepted`);
    } finally {
      root.cleanup();
    }
  }
});

test('C1: a present null leaf is invalid while an absent one stays a gap', () => {
  for (const [label, expected] of [['null', 'fail'], ['absent', 'pass']] as const) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q2 = reports['q2']!;
      const assertions = (q2['assertions'] as Record<string, unknown>[]).map((entry) =>
        label === 'null' ? { ...entry, ok: null } : { ...entry },
      );
      if (label === 'absent') {
        for (const entry of assertions) delete entry['ok'];
      }
      reports['q2'] = { ...q2, assertions };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      if (expected === 'fail') {
        assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail', `${label} must be invalid`);
      } else {
        // An absent outcome is a gap, and the requirement is already blocked by the
        // unsupported obligations, so the assertion itself is what is checked.
        assert.match(reasonsOf(result, 'Q-LOCAL-1'), /assertion .* has no usable evidence/);
      }
    } finally {
      root.cleanup();
    }
  }
});

test('C1: duplicate assertion and precondition names are rejected', () => {
  const cases: readonly [string, (report: Record<string, unknown>) => void][] = [
    ['duplicate assertion', (report) => {
      const assertions = report['assertions'] as Record<string, unknown>[];
      report['assertions'] = [...assertions, { ...assertions[0]! }];
    }],
    ['duplicate precondition', (report) => {
      report['preconditions'] = [
        { name: 'range-supported', met: true },
        { name: 'range-supported', met: true },
      ];
    }],
  ];
  for (const [label, mutate] of cases) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q2 = { ...reports['q2']! };
      mutate(q2);
      reports['q2'] = q2;
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail', label);
      assert.match(reasonsOf(result, 'Q-LOCAL-1'), /duplicate|repeats/, label);
    } finally {
      root.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// C2 - total loading and parsing
// --------------------------------------------------------------------------

test('C2: removing each source in turn never crashes and never passes', () => {
  for (const role of SOURCE_ROLES) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const result = runCli(
        writeRequest(root, reports, { omits: [role] }),
        join(root.path, 'd.json'),
      );
      assert.doesNotMatch(result.stderr, /TypeError|AttributeError|at Object\./, role);
      assert.notEqual(result.decision?.['verdict'], 'pass', `missing ${role} still passed`);
    } finally {
      root.cleanup();
    }
  }
});

/** Wrong shapes for fields the mappings and admission read. */
const WRONG_SHAPES: readonly [string, unknown][] = [
  ['string', 'not-a-container'],
  ['list', ['a']],
  ['nonempty list', ['a', 'b']],
  ['int', 17],
  ['boolean', true],
  ['float', 1.5],
];

test('C2: wrong nested container shapes are diagnostics, not crashes', () => {
  const fields: readonly [string, string][] = [
    ['q2', 'identity'],
    ['q2', 'identity.artifact'],
    ['q3prepare', 'identity'],
    ['q4slope', 'identity'],
    ['q5lifecycle', 'identity'],
    ['q6resources', 'identity'],
    ['trace', 'identity'],
    ['q2', 'windows'],
    ['q6resources', 'measurements'],
    ['trace', 'runs'],
    ['q1', 'sourceCorrespondence'],
    ['q1', 'verifiedArtifacts'],
    ['q2', 'serverLedger'],
  ];
  for (const [role, field] of fields) {
    for (const [shape, value] of WRONG_SHAPES) {
      const root = new TempRoot();
      try {
        const reports = roleReports();
        const target = { ...reports[role]! };
        if (field.includes('.')) {
          const [outer, inner] = field.split('.') as [string, string];
          target[outer] = { ...(target[outer] as Record<string, unknown>), [inner]: value };
        } else {
          target[field] = value;
        }
        reports[role] = target;
        const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
        assert.doesNotMatch(
          result.stderr,
          /TypeError|AttributeError|at Object\./,
          `${role}.${field}=${shape}`,
        );
        assert.notEqual(result.decision?.['verdict'], 'pass', `${role}.${field}=${shape}`);
      } finally {
        root.cleanup();
      }
    }
  }
});

test('C2: corruption is a failure while absence is a gap', () => {
  // Both cases leave the file present but unusable, which is corruption. Genuine
  // absence - no file at all - is exercised by the per-role removal test above.
  const corrupt: readonly [string, string][] = [
    ['truncated JSON', '{"experiment": "q2-numeric"'],
    ['empty file', ''],
    ['not an object', '[]'],
    ['non-finite number', '{"testedWindows": NaN}'],
  ];
  for (const [label, body] of corrupt) {
    const root = new TempRoot();
    try {
      const requestPath = writeRequest(root, roleReports());
      root.writeRaw('reports/q2.json', body);
      const result = runCli(requestPath, join(root.path, 'd.json'));
      assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail', label);
      assert.match(reasonsOf(result, 'Q-LOCAL-1'), /malformed/, label);
    } finally {
      root.cleanup();
    }
  }
});

test('C2: a genuinely absent source is a gap rather than corruption', () => {
  const root = new TempRoot();
  try {
    // The source is declared in the request but its file was never written, so the
    // decision sees absence rather than corruption.
    const requestPath = writeRequest(root, roleReports());
    rmSync(join(root.path, 'reports/q2.json'));
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'inconclusive');
    assert.match(reasonsOf(result, 'Q-LOCAL-1'), /is missing/);
  } finally {
    root.cleanup();
  }
});

test('C2: an undeclared source role is refused rather than admitted on trust', () => {
  const root = new TempRoot();
  try {
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: [{ role: 'invented-role', path: root.write('r.json', {}) }],
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no declared expectations/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// C3 - required identity and correspondence
// --------------------------------------------------------------------------

test('C3: a wrong recorded identity cannot qualify', () => {
  const mutations: readonly [string, (reports: Record<string, Record<string, unknown>>) => void][] = [
    ['renamed experiment', (reports) => {
      const q2 = reports['q2']!;
      q2['identity'] = { ...(q2['identity'] as Record<string, unknown>), experiment: 'q1-artifacts' };
    }],
    ['renamed route', (reports) => {
      const q2 = reports['q2']!;
      q2['identity'] = { ...(q2['identity'] as Record<string, unknown>), routeId: 'other-route' };
    }],
    ['renamed environment', (reports) => {
      const q2 = reports['q2']!;
      q2['identity'] = { ...(q2['identity'] as Record<string, unknown>), environment: 'other-env' };
    }],
    ['bumped artifact version', (reports) => {
      const q2 = reports['q2']!;
      const identity = q2['identity'] as Record<string, unknown>;
      q2['identity'] = { ...identity, artifact: { name: 'whitebox-wasm', version: '9.9.9' } };
    }],
    ['wrong fixture hash', (reports) => {
      const q2 = reports['q2']!;
      const identity = q2['identity'] as Record<string, unknown>;
      q2['identity'] = {
        ...identity,
        fixtures: [{ name: 'derived_cog', sha256: 'b'.repeat(64) }],
      };
    }],
    ['missing identity block', (reports) => {
      reports['q2'] = { ...reports['q2']!, identity: null };
    }],
  ];
  for (const [label, mutate] of mutations) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      mutate(reports);
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.notEqual(verdictOf(result, 'Q-LOCAL-1'), 'pass', label);
    } finally {
      root.cleanup();
    }
  }
});

test('C3: an HTTP-only measurement cannot qualify the proposed local transport', () => {
  // The plan qualifies the scoped local bridge and states that a remote HTTP demo
  // does not qualify bounded local access, so the assertion fails rather than
  // passing on an adjacent capability.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    q2['identity'] = { ...(q2['identity'] as Record<string, unknown>), transport: 'http-range' };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail', reasonsOf(result, 'Q-LOCAL-1'));
    assert.match(reasonsOf(result, 'Q-LOCAL-1'), /http-range/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// C4 - explicit evidence for each assertion
// --------------------------------------------------------------------------

test('C4: an assertion cannot pass from the absence of a failure string', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    reports['q2'] = { ...q2, windows: [], failures: [] };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'inconclusive');
    assert.match(reasonsOf(result, 'Q-LOCAL-1'), /window bound was never observed/);
  } finally {
    root.cleanup();
  }
});

test('C4: a window over the plan bound fails with the measured size', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    reports['q2'] = {
      ...q2,
      windows: [
        {
          fixture: 'plane2000',
          label: 'oversized',
          classification: 'measured',
          window: { x: 0, y: 0, w: 4096, h: 4096, haloCells: 1 },
          cells: 4096 * 4096,
        },
      ],
    };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'fail');
    assert.match(reasonsOf(result, 'Q-LOCAL-1'), /4096x4096/);
  } finally {
    root.cleanup();
  }
});

test('C4: artifact correspondence does not depend on a prose note', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q1'] = { ...reports['q1']!, notes: [] };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-ART-1'), 'pass', reasonsOf(result, 'Q-ART-1'));
  } finally {
    root.cleanup();
  }
});

test('C4: a prose note cannot substitute for a missing correspondence record', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q1 = reports['q1']!;
    reports['q1'] = {
      ...q1,
      sourceCorrespondence: [],
      notes: ['whitebox-wasm: no published artifact matches the pinned commit'],
    };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.notEqual(verdictOf(result, 'Q-ART-1'), 'pass');
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// C5 - quantitative budgets
// --------------------------------------------------------------------------

test('C5: each plan budget is enforced on its own counter', () => {
  const overBudget: readonly [string, string, number][] = [
    ['decodedCacheBytes', 'decoded cache', PLAN.decodedCacheBytes + 1],
    ['decodedCacheBytes', 'decoded cache', 2 ** 30],
    ['activeReads', 'active reads', PLAN.activeReads + 1],
    ['queueDepth', 'pending display requests', PLAN.queueDepth + 1],
  ];
  for (const [counter, label, value] of overBudget) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) =>
        index === 0 ? { ...entry, [counter]: value } : entry,
      );
      reports['q6resources'] = { ...q6, measurements };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.equal(verdictOf(result, 'Q-RES-1'), 'fail', `${label} ${value} was accepted`);
      assert.match(reasonsOf(result, 'Q-RES-1'), /exceeds the plan/);
    } finally {
      root.cleanup();
    }
  }
});

test('C5: a missing counter is a gap, not a fabricated complete run', () => {
  for (const counter of ['temporaryDiskHighWaterBytes', 'decodedCacheBytes', 'activeReads', 'queueDepth', 'maxConcurrentChildren']) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) => {
        if (index !== 0) return entry;
        const copy: Record<string, unknown> = { ...entry };
        delete copy[counter];
        return copy;
      });
      reports['q6resources'] = { ...q6, measurements };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.notEqual(verdictOf(result, 'Q-RES-1'), 'pass', `missing ${counter} still passed`);
    } finally {
      root.cleanup();
    }
  }
});

test('C5: a measured violation survives an unrelated gap', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q6 = reports['q6resources']!;
    const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) => {
      if (index !== 0) return entry;
      const copy: Record<string, unknown> = { ...entry, decodedCacheBytes: 2 ** 30 };
      delete copy['queueDepth'];
      return copy;
    });
    reports['q6resources'] = { ...q6, measurements };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-RES-1'), 'fail');
    assert.match(reasonsOf(result, 'Q-RES-1'), /decoded cache/);
  } finally {
    root.cleanup();
  }
});

test('C5: a 900 ms display stall survives an unrelated gap, in either order', () => {
  const mutations: readonly [string, (runs: Record<string, unknown>[]) => Record<string, unknown>[]][] = [
    ['stall then unknown field', (runs) => {
      const next = runs.map((run) => ({ ...run }));
      next[0]!['longTaskMaxMs'] = 900;
      next[0]!['someOptionalField'] = 1;
      return next;
    }],
    ['unknown field then stall', (runs) => {
      const next = runs.map((run) => ({ ...run }));
      next[0]!['someOptionalField'] = 1;
      next[0]!['longTaskMaxMs'] = 900;
      return next;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const trace = reports['trace']!;
      reports['trace'] = { ...trace, runs: mutate(trace['runs'] as Record<string, unknown>[]) };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.equal(verdictOf(result, 'Q-DISPLAY-1'), 'fail', label);
      assert.match(reasonsOf(result, 'Q-DISPLAY-1'), /900 ms/, label);
    } finally {
      root.cleanup();
    }
  }
});

test('C5: display runs must be complete and self-consistent', () => {
  const mutations: readonly [string, (runs: Record<string, unknown>[]) => Record<string, unknown>[]][] = [
    ['only two runs', (runs) => runs.slice(0, 2)],
    ['short latency list', (runs) => runs.map((run, index) =>
      index === 0 ? { ...run, individualLatenciesMs: [1, 2] } : run)],
    ['failed run', (runs) => runs.map((run, index) =>
      index === 0 ? { ...run, ok: false, failedTiles: 127, tilesRendered: 1 } : run)],
    ['recorded p95 disagrees with samples', (runs) => runs.map((run, index) =>
      index === 0 ? { ...run, p95Ms: 9999 } : run)],
    ['missing cache state', (runs) => runs.map((run, index) => {
      if (index !== 0) return run;
      const copy = { ...run };
      delete copy['cachesCleared'];
      return copy;
    })],
  ];
  for (const [label, mutate] of mutations) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const trace = reports['trace']!;
      reports['trace'] = { ...trace, runs: mutate(trace['runs'] as Record<string, unknown>[]) };
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.notEqual(verdictOf(result, 'Q-DISPLAY-1'), 'pass', label);
    } finally {
      root.cleanup();
    }
  }
});

test('C5: a record without the plan sampling cannot evidence a budget', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q6 = reports['q6resources']!;
    const measurements = q6['measurements'] as Record<string, unknown>[];
    reports['q6resources'] = {
      ...q6,
      measurements: [{ ...measurements[0]!, sampleIntervalMs: 900 }, measurements[1]!],
    };
    const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-RES-1'), 'fail');
    assert.match(reasonsOf(result, 'Q-RES-1'), /900 ms/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// C6 - public bundle and contract admission
// --------------------------------------------------------------------------

test('C6: the gate cannot pass a bundle with no admission, because there is no bundle input', () => {
  // The CLI takes a contract, declarations and raw sources. There is no path by
  // which a serialized admission label can be presented as evidence.
  const root = new TempRoot();
  try {
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: [],
      bundle: { requirements: { 'Q-LOCAL-1': { admission: { verdict: 'pass' } } } },
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('C6: an unsupported bundle version is refused', () => {
  const root = new TempRoot();
  try {
    const contract = JSON.parse(readFileSync(realContractPath(), 'utf8')) as Record<string, unknown>;
    contract['contractVersion'] = 99;
    const requestPath = root.write('request.json', {
      contract,
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: [],
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unsupported contractVersion/);
  } finally {
    root.cleanup();
  }
});

test('C6: a malformed contract is refused without a traceback', () => {
  const cases: readonly [string, unknown][] = [
    ['not an object', 'nope'],
    ['null', null],
    ['requirements not a list', { contractVersion: 1, source: 'x', requirements: {} }],
    ['requirement not an object', { contractVersion: 1, source: 'x', requirements: ['x'] }],
    ['duplicate requirement id', {
      contractVersion: 1, source: 'x', requirements: [
        { id: 'Q-A', title: 't', phase: 'Q', required: true, role: 'r', assertions: ['a'], requiresRasterFixture: true },
        { id: 'Q-A', title: 't', phase: 'Q', required: true, role: 'r', assertions: ['a'], requiresRasterFixture: true },
      ],
    }],
    ['required not a boolean', {
      contractVersion: 1, source: 'x', requirements: [
        { id: 'Q-A', title: 't', phase: 'Q', required: 'yes', role: 'r', assertions: ['a'], requiresRasterFixture: true },
      ],
    }],
    ['empty assertions', {
      contractVersion: 1, source: 'x', requirements: [
        { id: 'Q-A', title: 't', phase: 'Q', required: true, role: 'r', assertions: [], requiresRasterFixture: true },
      ],
    }],
  ];
  for (const [label, contract] of cases) {
    const root = new TempRoot();
    try {
      const requestPath = root.write('request.json', {
        contract,
        fixtureManifest: fixtureManifest(),
        pins: candidatePins(),
        now: NOW,
        sources: [],
      });
      const result = runCli(requestPath, join(root.path, 'd.json'));
      assert.doesNotMatch(result.stderr, /TypeError|AttributeError|at Object\./, label);
      assert.notEqual(result.status, 0, label);
    } finally {
      root.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// C7 - CLI authority
// --------------------------------------------------------------------------

test('C7: the CLI exits zero only on full eligibility', () => {
  const root = new TempRoot();
  try {
    // The coherent contract still has unsupported obligations, so it is not
    // eligible and must not exit zero.
    const requestPath = writeRequest(root, roleReports());
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.notEqual(result.status, 0);
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('C7: a malformed request is a structured diagnostic', () => {
  const cases: readonly [string, string][] = [
    ['not JSON', '{'],
    ['not an object', '[]'],
    ['no sources', '{"contract": null, "now": 1}'],
    ['no evaluation time', '{"contract": null, "sources": []}'],
    ['duplicate key', '{"now": 1, "now": 2, "sources": []}'],
    ['non-finite time', '{"now": Infinity, "sources": []}'],
  ];
  for (const [label, body] of cases) {
    const root = new TempRoot();
    try {
      const requestPath = root.writeRaw('request.json', body);
      const out = join(root.path, 'd.json');
      const result = runCli(requestPath, out);
      assert.equal(result.status, 2, label);
      assert.doesNotMatch(result.stderr, /TypeError|AttributeError|at Object\./, label);
      assert.notEqual(result.stderr.trim(), '', label);
      // A malformed request publishes an explicitly labelled refusal, never a
      // decision. When its sources cannot be recovered the requested destination is
      // left untouched and the diagnostic is written into a directory this run owns.
      const reported = /non-qualifying diagnostic was written to (.+)/.exec(result.stderr)?.[1]?.trim();
      const diagnostic = reported ?? out;
      const document = JSON.parse(readFileSync(diagnostic, 'utf8')) as Record<string, unknown>;
      assert.equal(document['kind'], 'rejected-input', label);
      assert.deepEqual(document['requirements'], [], label);
      assert.notEqual(document['verdict'], 'pass', label);
      if (reported !== undefined) {
        assert.equal(root.has('d.json'), false, `${label}: the destination was used anyway`);
      }
    } finally {
      root.cleanup();
    }
  }
});

test('C7: a missing request file is a diagnostic, not a traceback', () => {
  const root = new TempRoot();
  try {
    const result = runCli(join(root.path, 'absent.json'), join(root.path, 'd.json'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot read request/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// C8 - cross-layer invariants
// --------------------------------------------------------------------------

/** Faults that are independently sufficient to fail the requirement they belong to. */
const FAULTS: readonly [string, string, (reports: Record<string, Record<string, unknown>>) => void][] = [
  ['numeric assertion failure', 'Q-LOCAL-1', (reports) => {
    const q2 = reports['q2']!;
    const assertions = (q2['assertions'] as Record<string, unknown>[]).map((entry, index) =>
      index === 0 ? { ...entry, ok: false } : entry);
    reports['q2'] = { ...q2, assertions };
  }],
  ['numeric result failure', 'Q-LOCAL-1', (reports) => {
    reports['q2'] = { ...reports['q2']!, result: 'fail', failures: ['known failure'] };
  }],
  ['window over the contract limit', 'Q-LOCAL-1', (reports) => {
    const q2 = reports['q2']!;
    reports['q2'] = {
      ...q2,
      windows: [{ classification: 'measured', window: { w: 4096, h: 4096 }, cells: 4096 * 4096 }],
    };
  }],
  ['resource budget exceeded', 'Q-RES-1', (reports) => {
    const q6 = reports['q6resources']!;
    const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) =>
      index === 0 ? { ...entry, decodedCacheBytes: 2 ** 30 } : entry);
    reports['q6resources'] = { ...q6, measurements };
  }],
];

/** Independent gaps that make a requirement inconclusive on their own. */
const GAPS: readonly [string, string, (reports: Record<string, Record<string, unknown>>) => void][] = [
  ['numeric identity removed', 'Q-LOCAL-1', (reports) => {
    reports['q2'] = { ...reports['q2']!, identity: null };
  }],
  ['numeric runId removed', 'Q-LOCAL-1', (reports) => {
    const q2 = reports['q2']!;
    const identity = { ...(q2['identity'] as Record<string, unknown>) };
    delete identity['runId'];
    reports['q2'] = { ...q2, identity };
  }],
  ['numeric recorded time removed', 'Q-LOCAL-1', (reports) => {
    const q2 = reports['q2']!;
    const identity = { ...(q2['identity'] as Record<string, unknown>) };
    delete identity['recordedAt'];
    reports['q2'] = { ...q2, identity };
  }],
  ['numeric validation outcome withdrawn', 'Q-LOCAL-1', (reports) => {
    // A gap on a different path from the window bound and from the source identity:
    // the report stops recording one of its validation outcomes, so that assertion
    // has no evidence while the fault's own observation is untouched.
    const q2 = reports['q2']!;
    const assertions = (q2['assertions'] as Record<string, unknown>[]).filter(
      (entry) => !String(entry['name']).startsWith('validity:'),
    );
    reports['q2'] = { ...q2, assertions };
  }],
  ['resource queue depth removed', 'Q-RES-1', (reports) => {
    const q6 = reports['q6resources']!;
    const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) => {
      if (index !== 0) return entry;
      const copy = { ...entry };
      delete copy['queueDepth'];
      return copy;
    });
    reports['q6resources'] = { ...q6, measurements };
  }],
];

test('C8: each fault alone fails its requirement', () => {
  for (const [label, requirementId, mutate] of FAULTS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      mutate(reports);
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.equal(verdictOf(result, requirementId), 'fail', label);
    } finally {
      root.cleanup();
    }
  }
});

test('C8: every fault survives every independent gap, in either order', () => {
  for (const [faultLabel, requirementId, applyFault] of FAULTS) {
    for (const [gapLabel, gapRequirement, applyGap] of GAPS) {
      if (gapRequirement !== requirementId) continue;
      for (const order of ['fault-first', 'gap-first'] as const) {
        const root = new TempRoot();
        try {
          const reports = roleReports();
          if (order === 'fault-first') {
            applyFault(reports);
            applyGap(reports);
          } else {
            applyGap(reports);
            applyFault(reports);
          }
          const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
          assert.equal(
            verdictOf(result, requirementId),
            'fail',
            `${faultLabel} + ${gapLabel} (${order})`,
          );
        } finally {
          root.cleanup();
        }
      }
    }
  }
});

test('C8: removing evidence never creates a pass, and adding evidence never closes a gap', () => {
  // Removing required evidence.
  for (const [label, requirementId, mutate] of GAPS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      mutate(reports);
      const result = runCli(writeRequest(root, reports), join(root.path, 'd.json'));
      assert.notEqual(verdictOf(result, requirementId), 'pass', label);
    } finally {
      root.cleanup();
    }
  }
  // Adding unrelated evidence.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    const identity = { ...(q2['identity'] as Record<string, unknown>) };
    delete identity['runId'];
    reports['q2'] = { ...q2, identity, unrelatedExtra: { note: 'irrelevant' } };
    const before = runCli(writeRequest(root, reports), join(root.path, 'before.json'));
    assert.equal(verdictOf(before, 'Q-LOCAL-1'), 'inconclusive');
  } finally {
    root.cleanup();
  }
});
