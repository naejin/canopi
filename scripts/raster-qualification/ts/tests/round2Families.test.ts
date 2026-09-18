/**
 * Round 2 — the six remaining families from the Round 1 independent disposition.
 *
 * Every case starts from the coherent control and perturbs one input, then checks the
 * target requirement, its individual assertion verdicts and its reasons. An overall
 * non-pass is not sufficient: permanent gaps already prevent overall qualification,
 * which is exactly how the Round 1 review's false individual passes stayed hidden.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, PIN_COG_TILER, PIN_WHITEBOX } from './fixtures.js';
import { validateContract } from '../src/declaration.js';
import { runQualification } from '../src/qualification.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

interface Setup {
  readonly reports?: Reports;
  readonly pins?: unknown;
  readonly omitPins?: boolean;
  readonly manifest?: unknown;
  readonly synthetic?: boolean;
  readonly rawQ2?: string;
  readonly outPath?: (root: TempRoot) => string;
  readonly extraSources?: { role: string; path: string }[];
}

function request(root: TempRoot, options: Setup): string {
  const reports = options.reports ?? roleReports();
  const sources: { role: string; path: string }[] = SOURCE_ROLES.map((role) => ({
    role,
    path: options.rawQ2 !== undefined && role === 'q2'
      ? root.writeRaw('q2.json', options.rawQ2)
      : root.write(`reports/${role}.json`, reports[role]!),
  }));
  for (const extra of options.extraSources ?? []) sources.push(extra);
  const body: Rec = {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: options.manifest ?? fixtureManifest(),
    now: NOW,
    sources,
  };
  if (options.omitPins !== true) body['pins'] = options.pins ?? candidatePins();
  if (options.synthetic === true) body['synthetic'] = true;
  return root.write('request.json', body);
}

function decide(root: TempRoot, options: Setup = {}) {
  const out = options.outPath === undefined ? join(root.path, 'd.json') : options.outPath(root);
  return runCli(request(root, options), out);
}

function requirement(result: ReturnType<typeof runCli>, id: string): {
  verdict: string | undefined;
  assertions: globalThis.Record<string, string>;
  reasons: string;
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

function withReport(role: string, mutate: (report: Rec) => Rec, base?: Reports): Reports {
  const reports = base ?? roleReports();
  reports[role] = mutate(reports[role]!);
  return reports;
}

// --------------------------------------------------------------------------
// R1-A — declaration correspondence
// --------------------------------------------------------------------------

test('R1-A: omitting the declared pins blocks correspondence rather than passing', () => {
  const root = new TempRoot();
  try {
    const state = requirement(decide(root, { omitPins: true }), 'Q-ART-1');
    assert.notEqual(state.verdict, 'pass');
    assert.match(state.reasons, /pin/i, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a self-consistent but undeclared revision pair fails', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q1', (report) => ({
      ...report,
      sourceCorrespondence: (report['sourceCorrespondence'] as Rec[]).map((entry) => ({
        ...entry,
        pinnedRevision: '0'.repeat(40),
        artifactRevision: '0'.repeat(40),
        matches: true,
      })),
    }));
    const state = requirement(decide(root, { reports }), 'Q-ART-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.equal(state.assertions['qualified-roles-name-artifact-version'], 'fail');
  } finally {
    root.cleanup();
  }
});

test('R1-A: a correspondence version that is not the required one fails', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q1', (report) => ({
      ...report,
      sourceCorrespondence: (report['sourceCorrespondence'] as Rec[]).map((entry, index) =>
        index === 0 ? { ...entry, version: '999' } : entry,
      ),
    }));
    const state = requirement(decide(root, { reports }), 'Q-ART-1');
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a missing record for a required artifact is a gap', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q1', (report) => ({
      ...report,
      sourceCorrespondence: (report['sourceCorrespondence'] as Rec[]).filter(
        (entry) => entry['artifact'] !== 'cog-tiler-wasm',
      ),
    }));
    const state = requirement(decide(root, { reports }), 'Q-ART-1');
    assert.equal(state.verdict, 'inconclusive', state.reasons);
    assert.match(state.reasons, /cog-tiler-wasm/);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a wrong-version duplicate in verifiedArtifacts fails', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q1', (report) => ({
      ...report,
      verifiedArtifacts: [
        { name: 'whitebox-wasm', version: '0.0.1' },
        ...(report['verifiedArtifacts'] as Rec[]),
      ],
    }));
    const state = requirement(decide(root, { reports }), 'Q-ART-1');
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a boolean claim cannot excuse revisions that disagree with the pin', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q1', (report) => ({
      ...report,
      sourceCorrespondence: (report['sourceCorrespondence'] as Rec[]).map((entry, index) =>
        index === 0 ? { ...entry, artifactRevision: 'deadbeef', matches: true } : entry,
      ),
    }));
    const state = requirement(decide(root, { reports }), 'Q-ART-1');
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// R1-B — failure retained before gaps
// --------------------------------------------------------------------------

test('R1-B: a cadence violation survives a missing sample count', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q6resources', (report) => {
      const measurements = (report['measurements'] as Rec[]).map((entry) => ({ ...entry }));
      measurements[0]!['sampleIntervalMs'] = 900;
      delete measurements[0]!['sampleCount'];
      return { ...report, measurements };
    });
    const state = requirement(decide(root, { reports }), 'Q-RES-1');
    assert.equal(state.assertions['sampling-meets-requirement'], 'fail', state.reasons);
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /900 ms/);
  } finally {
    root.cleanup();
  }
});

test('R1-B: an over-budget peak after a leading non-record fails the memory assertion', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q6resources', (report) => {
      const measurements = report['measurements'] as Rec[];
      return {
        ...report,
        measurements: [null, { ...measurements[0]!, incrementalPeakRssMiB: 2048 }, measurements[1]!],
      };
    });
    const state = requirement(decide(root, { reports }), 'Q-RES-1');
    assert.equal(state.assertions['candidate-memory-within-budget'], 'fail', state.reasons);
    assert.match(state.reasons, /2048|budget/);
  } finally {
    root.cleanup();
  }
});

test('R1-B: a sidecar that did not survive fails despite a missing observed hash', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q3prepare', (report) => ({
      ...report,
      identity: { ...(report['identity'] as Rec), sidecarPolicy: 'measured' },
      sidecar: { expectedSha256: 'a'.repeat(64), before: true, after: false },
    }));
    const state = requirement(decide(root, { reports }), 'Q-PREP-1');
    assert.equal(state.assertions['sidecar-unchanged'], 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-B: a conflicting fixture hash survives a gap in the declaration', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q2', (report) => ({
      ...report,
      identity: {
        ...(report['identity'] as Rec),
        fixtures: [{ name: 'derived_cog', sha256: 'b'.repeat(64) }],
      },
    }));
    const state = requirement(
      decide(root, {
        reports,
        manifest: {
          declared: [{ name: 'derived_cog', sha256: 'a'.repeat(64) }, { name: 'extra' }],
          requiredFixtures: {},
        },
      }),
      'Q-LOCAL-1',
    );
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /hash conflict/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// R1-C — scientific sufficiency
// --------------------------------------------------------------------------

test('R1-C: a render that does not reconcile with its requests fails', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('trace', (report) => ({
      ...report,
      runs: (report['runs'] as Rec[]).map((run, index) =>
        index === 0 ? { ...run, tilesRendered: 1, tileRequests: 999 } : run,
      ),
    }));
    const state = requirement(decide(root, { reports }), 'Q-DISPLAY-1');
    assert.equal(state.assertions['runs-report-successful-rendering'], 'fail', state.reasons);
    assert.match(state.reasons, /reconcile/);
  } finally {
    root.cleanup();
  }
});

test('R1-C: negative latency samples fail rather than passing as fast runs', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('trace', (report) => ({
      ...report,
      runs: (report['runs'] as Rec[]).map((run) => ({
        ...run,
        individualLatenciesMs: (run['individualLatenciesMs'] as number[]).map(() => -1),
        medianMs: -1,
        p95Ms: -1,
        maxMs: -1,
      })),
    }));
    const state = requirement(decide(root, { reports }), 'Q-DISPLAY-1');
    assert.equal(state.assertions['hundred-valid-latencies-per-run'], 'fail', state.reasons);
    assert.match(state.reasons, /negative/);
  } finally {
    root.cleanup();
  }
});

test('R1-C: a ledger accounting for nothing cannot corroborate validated windows', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q2', (report) => ({
      ...report,
      serverLedger: { fixtureBytesServed: 0, fixtureRequests: 0 },
    }));
    const state = requirement(decide(root, { reports }), 'Q-LOCAL-1');
    assert.equal(state.assertions['transport-ledger-corroborates-bytes'], 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-C: a fractional window dimension fails rather than being compared', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q2', (report) => ({
      ...report,
      windows: [{ classification: 'measured', window: { w: 0.5, h: 1024 } }],
    }));
    const state = requirement(decide(root, { reports }), 'Q-LOCAL-1');
    assert.equal(state.assertions['window-size-within-contract-limit'], 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-C: an HTTP-only measurement cannot qualify the proposed local transport', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q2', (report) => ({
      ...report,
      identity: { ...(report['identity'] as Rec), transport: 'http-range' },
    }));
    const state = requirement(decide(root, { reports }), 'Q-LOCAL-1');
    assert.equal(state.assertions['reads-over-proposed-local-transport'], 'fail', state.reasons);
    assert.match(state.reasons, /http-range/);
  } finally {
    root.cleanup();
  }
});

test('R1-C: preparation requires both tiling and bounded blocks', () => {
  // The producer reports the two halves separately; an unbounded tiled derivative
  // must not satisfy the combined obligation.
  for (const failing of ['derived-tiled', 'derived-block-bounded']) {
    const root = new TempRoot();
    try {
      const reports = withReport('q3prepare', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
          entry.name === failing ? { ...entry, ok: false } : entry,
        ),
      }));
      const state = requirement(decide(root, { reports }), 'Q-PREP-1');
      assert.equal(
        state.assertions['derivative-is-tiled-and-bounded'],
        'fail',
        `${failing} failed but the combined assertion was ${state.assertions['derivative-is-tiled-and-bounded']}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// R1-D — admission and policy boundary
// --------------------------------------------------------------------------

test('R1-D: a precondition that records no outcome blocks the requirement', () => {
  for (const preconditions of [[{ name: 'hash-valid' }], null]) {
    const root = new TempRoot();
    try {
      const reports = withReport('q2', (report) => ({ ...report, preconditions }));
      const state = requirement(decide(root, { reports }), 'Q-LOCAL-1');
      assert.notEqual(state.verdict, 'pass', JSON.stringify(preconditions));
      assert.equal(state.verdict, 'fail', JSON.stringify(preconditions));
    } finally {
      root.cleanup();
    }
  }
});

test('R1-D: an arbitrary report-chosen prefix cannot exempt a positive failure', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q2', (report) => ({
      ...report,
      failures: ['window read failed'],
      negativeControlScopes: ['window'],
    }));
    const state = requirement(decide(root, { reports }), 'Q-LOCAL-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /window read failed/);
  } finally {
    root.cleanup();
  }
});

test('R1-D: a declared negative-control scope still exempts its own rejection', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q5lifecycle', (report) => ({
      ...report,
      negativeControlScopes: ['expected-rejection:'],
      failures: ['expected-rejection: the control refused the malformed input'],
    }));
    const state = requirement(decide(root, { reports }), 'Q-FAILINJ-1');
    assert.equal(state.assertions['truncated-header-rejected'], 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-D: an envelope that disagrees with its own identity fails', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q2', (report) => ({ ...report, experiment: 'not-q2' }));
    const state = requirement(decide(root, { reports }), 'Q-LOCAL-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /envelope names experiment/);
  } finally {
    root.cleanup();
  }
});

test('R1-D: a numeric overflow after decoding is rejected', () => {
  const root = new TempRoot();
  try {
    const raw = JSON.stringify(roleReports()['q2']).replace(
      '"testedWindows":9',
      '"testedWindows":9,"optionalRaw":1e999',
    );
    const state = requirement(decide(root, { rawQ2: raw }), 'Q-LOCAL-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /overflows to a non-finite/);
  } finally {
    root.cleanup();
  }
});

test('R1-D: a measured sidecar needs both the before and after observations', () => {
  for (const [label, sidecar] of [
    ['after only', { expectedSha256: 'a'.repeat(64), sha256: 'a'.repeat(64), after: true }],
    ['before only', { expectedSha256: 'a'.repeat(64), sha256: 'a'.repeat(64), before: true }],
    ['neither', { expectedSha256: 'a'.repeat(64), sha256: 'a'.repeat(64) }],
  ] as const) {
    const root = new TempRoot();
    try {
      const reports = withReport('q3prepare', (report) => ({
        ...report,
        identity: { ...(report['identity'] as Rec), sidecarPolicy: 'measured' },
        sidecar,
      }));
      const state = requirement(decide(root, { reports }), 'Q-PREP-1');
      assert.equal(
        state.assertions['sidecar-unchanged'],
        'inconclusive',
        `${label}: ${state.reasons}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

// --------------------------------------------------------------------------
// R1-E — synthetic isolation and the programmatic boundary
// --------------------------------------------------------------------------

test('R1-E: a synthetic control cannot publish a qualifying result', () => {
  // A reduced contract with coherent reports is sufficient on its own, so nothing
  // unrelated is blocking it; the marker alone must prevent publication.
  const reduced = {
    contractVersion: 1,
    source: 'reduced control',
    title: 'reduced',
    requirements: [
      {
        id: 'Q-ART-1',
        title: 'artifacts',
        phase: 'Q',
        required: true,
        role: 'artifacts',
        assertions: ['artifacts-match-integrity-digest'],
        requiresRasterFixture: false,
        noFixtureReason: 'artifact-only control',
      },
    ],
  };
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: root.write(`reports/${role}.json`, reports[role]!),
    }));
    const plain = root.write('plain.json', {
      contract: reduced, fixtureManifest: fixtureManifest(), pins: candidatePins(), now: NOW, sources,
    });
    const withMarker = root.write('synthetic.json', {
      contract: reduced, fixtureManifest: fixtureManifest(), pins: candidatePins(), now: NOW, sources,
      synthetic: true,
    });
    const control = runCli(plain, join(root.path, 'plain-decision.json'));
    assert.equal(control.status, 0, `the reduced control must be eligible: ${control.stderr}`);
    assert.equal(control.decision?.['verdict'], 'pass');
    assert.equal(control.decision?.['synthetic'], false);

    const marked = runCli(withMarker, join(root.path, 'synthetic-decision.json'));
    assert.notEqual(marked.status, 0, 'a synthetic control exited zero');
    assert.notEqual(marked.decision?.['verdict'], 'pass');
    assert.equal(marked.decision?.['synthetic'], true);
  } finally {
    root.cleanup();
  }
});

test('R1-E: the programmatic entry point returns a structured outcome, not a throw', () => {
  // The CLI validates source roles before it reaches this seam, so only a direct
  // call can observe how the library itself handles an unknown role.
  const contract = validateContract(
    JSON.parse(readFileSync(realContractPath(), 'utf8')),
    'contract',
  );
  assert.equal(contract.verdict, 'pass');
  const outcome = runQualification({
    contract: contract.value!,
    fixtureManifest: { verdict: 'pass', value: { declared: [], requiredByRole: new Map() }, problems: [] },
    pins: { verdict: 'pass', value: { contracts: new Map() }, problems: [] },
    now: NOW,
    sources: [{ role: 'unknown-role', path: '/nonexistent' }],
  });
  assert.equal(outcome.ok, false, 'an unknown role was accepted');
  if (!outcome.ok) {
    assert.equal(outcome.exitCode, 2);
    assert.match(outcome.problems.join(' '), /no declared expectations for this role/);
  }
});

// --------------------------------------------------------------------------
// R1-F — output safety and diagnostics
// --------------------------------------------------------------------------

test('R1-F: the output path may not be one of the inputs', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2Path = root.write('reports/q2.json', reports['q2']!);
    const before = readFileSync(q2Path, 'utf8');
    const result = decide(root, { reports, outPath: () => q2Path });
    assert.notEqual(result.status, 0, 'writing over an input was accepted');
    assert.equal(readFileSync(q2Path, 'utf8'), before, 'the source bytes were overwritten');
    assert.match(result.stderr, /also an input/);
  } finally {
    root.cleanup();
  }
});

test('R1-F: a refused input leaves a labelled diagnostic when the destination is writable', () => {
  const root = new TempRoot();
  try {
    const out = join(root.path, 'out', 'decision.json');
    const result = decide(root, { pins: 7, outPath: () => out });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /candidate pins/);
    assert.equal(result.decision?.['kind'], 'rejected-input');
    assert.deepEqual(result.decision?.['requirements'], []);
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('R1-F: a diagnostic is not written over an input either', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2Path = root.write('reports/q2.json', reports['q2']!);
    const before = readFileSync(q2Path, 'utf8');
    const result = decide(root, { reports, pins: 7, outPath: () => q2Path });
    assert.equal(result.status, 2);
    assert.equal(readFileSync(q2Path, 'utf8'), before, 'a diagnostic overwrote a source');
  } finally {
    root.cleanup();
  }
});

void PIN_WHITEBOX;
void PIN_COG_TILER;
void writeFileSync;
