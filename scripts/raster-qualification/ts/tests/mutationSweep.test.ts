/**
 * The deterministic evidence mutation sweep.
 *
 * Every mutation is applied to one consumed field of the coherent control, then the
 * decision is checked against three independent expectations:
 *
 * - the *target* assertion and requirement, so a mutation is not merely reflected in
 *   the overall verdict;
 * - the *kind* of finding: a value that is present but invalid fails, while absent
 *   evidence is a gap;
 * - an unaffected requirement, so one mutation cannot silently move another.
 *
 * Order permutations, unrelated-identity substitution and failure-plus-gap
 * combinations are included. Mutations that cannot apply are marked with a reason
 * rather than silently skipped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, FIXTURE_HASH } from './fixtures.js';

type Report = Record<string, unknown>;
type Reports = Record<string, Report>;

interface Outcome {
  readonly verdict: string | undefined;
  /** Promoted assertions, present only when the source was admitted. */
  readonly assertions: Record<string, string>;
  /**
   * Assertions the mapping computed while the source was not admitted.
   *
   * A partial measured success is kept here rather than promoted, so a check of what
   * the requirement measured has to read both maps.
   */
  readonly observed: Record<string, string>;
  readonly reasons: string;
}

function decide(root: TempRoot, reports: Reports): {
  overall: string | undefined;
  requirement: (id: string) => Outcome;
} {
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const requestPath = root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
  const result = runCli(requestPath, join(root.path, 'd.json'));
  const requirements = (result.decision?.['requirements'] ?? []) as {
    id: string;
    verdict: string;
    assertions: Record<string, string>;
    observed: Record<string, string>;
    reasons: string[];
  }[];
  return {
    overall: result.decision?.['verdict'] as string | undefined,
    requirement: (id: string) => {
      const found = requirements.find((entry) => entry.id === id);
      return {
        verdict: found?.verdict,
        assertions: found?.assertions ?? {},
        observed: found?.observed ?? {},
        reasons: found?.reasons.join(' ') ?? '',
      };
    },
  };
}

/** A requirement that must not move when another requirement is mutated. */
const CONTROL_REQUIREMENTS: readonly [string, string][] = [
  ['Q-ART-1', 'artifacts-match-integrity-digest'],
  ['Q-LOCAL-1', 'window-size-within-contract-limit'],
  ['Q-PREP-1', 'sidecar-unchanged'],
  ['Q-CRS-1', 'crs-resolver-identified'],
  ['Q-DISPLAY-1', 'one-cold-and-three-warm-runs'],
];

/** Values that are present but cannot be the number the field declares. */
const INVALID_NUMBERS: readonly [string, unknown][] = [
  ['string', 'nope'],
  ['boolean', true],
  ['null', null],
  ['negative', -1],
  ['fractional', 1.5],
  ['list', [1]],
  ['object', { v: 1 }],
];

interface Mutation {
  readonly label: string;
  readonly target: string;
  readonly assertion: string;
  /**
   * The verdict the *target assertion* must carry.
   *
   * Several mutations are carried by the source's own admission rather than by the
   * assertion: a conflicting identity fails the requirement while the assertion it
   * accompanies keeps its own verdict. The two are declared separately so a test can
   * never accidentally accept one as evidence for the other.
   */
  readonly expect: 'fail' | 'inconclusive' | 'pass';
  /** The requirement verdict the mutation must produce. */
  readonly requirementVerdict?: 'fail' | 'inconclusive' | 'pass';
  readonly apply: (reports: Reports) => void;
}

function mutateReport(reports: Reports, role: string, change: (r: Report) => Report): void {
  reports[role] = change(reports[role]!);
}

/** Substituting an unrelated identity for a consumed identity field. */
function withIdentity(reports: Reports, role: string, patch: Report): void {
  mutateReport(reports, role, (report) => ({
    ...report,
    identity: { ...(report['identity'] as Report), ...patch },
  }));
}

const MUTATIONS: Mutation[] = [
  // ---- declaration-level -------------------------------------------------
  {
    // The report contradicts the declaration, so the requirement fails even though
    // the window assertion itself keeps its own verdict.
    label: 'fixture identity: declared hash replaced with a conflicting value',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) => {
      const identity = reports['q2']!['identity'] as Report;
      reports['q2'] = {
        ...reports['q2']!,
        identity: {
          ...identity,
          fixtures: [{ name: 'derived_cog', sha256: 'b'.repeat(64) }],
        },
      };
    },
  },
  {
    // The sources are unnamed, so coverage cannot be established. The window
    // assertion is about a size and keeps its own verdict; the requirement carries
    // the gap.
    label: 'fixture coverage: declared fixture removed from the report',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'inconclusive',
    apply: (reports) => {
      mutateReport(reports, 'q2', (report) => ({
        ...report,
        identity: { ...(report['identity'] as Report), fixtures: [] },
        fixturesTested: 0,
      }));
    },
  },
  // ---- source-level identity --------------------------------------------
  {
    label: 'source identity: runId removed',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'inconclusive',
    apply: (reports) => {
      const identity = { ...(reports['q2']!['identity'] as Report) };
      delete identity['runId'];
      reports['q2'] = { ...reports['q2']!, identity };
    },
  },
  {
    label: 'source identity: experiment substituted',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) => withIdentity(reports, 'q2', { experiment: 'q1-artifacts' }),
  },
  {
    label: 'source identity: route substituted',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) => withIdentity(reports, 'q2', { routeId: 'other-route' }),
  },
  {
    label: 'source identity: environment substituted',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) => withIdentity(reports, 'q2', { environment: 'other-env' }),
  },
  {
    label: 'source identity: artifact version substituted',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) =>
      withIdentity(reports, 'q2', { artifact: { name: 'whitebox-wasm', version: '9.9.9' } }),
  },
  {
    label: 'source identity: artifact replaced with an unrelated engine',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) =>
      withIdentity(reports, 'q2', { artifact: { name: 'unrelated-engine', version: '0.5.1' } }),
  },
  {
    label: 'source identity: transport substituted',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'inconclusive',
    apply: (reports) => withIdentity(reports, 'q2', { transport: 'local-bridge' }),
  },
  {
    label: 'source identity: block removed entirely',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'pass',
    requirementVerdict: 'inconclusive',
    apply: (reports) => {
      reports['q2'] = { ...reports['q2']!, identity: null };
    },
  },
  // ---- assertion-level ---------------------------------------------------
  {
    label: 'assertion: analytic record removed',
    target: 'Q-LOCAL-1',
    assertion: 'values-match-independent-reference',
    expect: 'inconclusive',
    requirementVerdict: 'inconclusive',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string }[]).filter(
          (entry) => !entry.name.startsWith('analytic:'),
        ),
      })),
  },
  {
    label: 'assertion: analytic record marked failed',
    target: 'Q-LOCAL-1',
    assertion: 'values-match-independent-reference',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
          entry.name.startsWith('analytic:') ? { ...entry, ok: false } : entry,
        ),
      })),
  },
  {
    label: 'assertion: a differently-labelled validity record still covers the prefix',
    target: 'Q-LOCAL-1',
    assertion: 'validity-matches-reference-exactly',
    expect: 'pass',
    requirementVerdict: 'pass',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => ({
        ...report,
        assertions: [
          ...(report['assertions'] as { name: string }[]).filter(
            (entry) => !entry.name.startsWith('validity:'),
          ),
          { name: 'validity:unrelated', ok: true },
        ],
      })),
  },
  {
    label: 'assertion: duplicate identical record',
    target: 'Q-LOCAL-1',
    assertion: 'values-match-independent-reference',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => {
        const assertions = report['assertions'] as Record<string, unknown>[];
        return { ...report, assertions: [...assertions, { ...assertions[0]! }] };
      }),
  },
  {
    label: 'assertion: duplicate conflicting record (one fails)',
    target: 'Q-LOCAL-1',
    assertion: 'values-match-independent-reference',
    expect: 'pass',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => {
        const assertions = report['assertions'] as Record<string, unknown>[];
        return {
          ...report,
          assertions: [...assertions, { ...assertions[0]!, ok: false }],
        };
      }),
  },
  // ---- window bounds -----------------------------------------------------
  {
    label: 'window: over the contract limit',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => ({
        ...report,
        windows: [
          { classification: 'measured', window: { w: 4096, h: 4096 }, cells: 4096 * 4096 },
        ],
      })),
  },
  {
    label: 'window: records removed',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'inconclusive',
    requirementVerdict: 'inconclusive',
    apply: (reports) => mutateReport(reports, 'q2', (report) => ({ ...report, windows: [] })),
  },
  {
    label: 'window: size substituted with an unusable value',
    target: 'Q-LOCAL-1',
    assertion: 'window-size-within-contract-limit',
    expect: 'inconclusive',
    requirementVerdict: 'inconclusive',
    apply: (reports) =>
      mutateReport(reports, 'q2', (report) => ({
        ...report,
        windows: [
          {
            classification: 'measured',
            window: { w: 'wide', h: 1024 },
            cells: 1024 * 1024,
          },
        ],
      })),
  },
  // ---- artifact report ---------------------------------------------------
  {
    label: 'artifacts: integrity record removed',
    target: 'Q-ART-1',
    assertion: 'artifacts-match-integrity-digest',
    expect: 'inconclusive',
    requirementVerdict: 'inconclusive',
    apply: (reports) =>
      mutateReport(reports, 'q1', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string }[]).filter(
          (entry) => entry.name !== 'integrity:cog-tiler-wasm',
        ),
      })),
  },
  {
    label: 'artifacts: correspondence record removed',
    target: 'Q-ART-1',
    assertion: 'non-corresponding-artifacts-recorded',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q1', (report) => ({ ...report, sourceCorrespondence: [] })),
  },
  {
    label: 'artifacts: correspondence revision substituted',
    target: 'Q-ART-1',
    assertion: 'qualified-roles-name-artifact-version',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q1', (report) => ({
        ...report,
        sourceCorrespondence: [
          ...(report['sourceCorrespondence'] as Record<string, unknown>[]).slice(0, 1),
          {
            artifact: 'cog-tiler-wasm',
            version: '0.3.6',
            pinnedRevision: 'a71c321d357b0fde063238ab38bcf7ddb914eacd',
            artifactRevision: 'unrelated-revision',
            matches: true,
          },
        ],
      })),
  },
  {
    label: 'artifacts: verified version substituted',
    target: 'Q-ART-1',
    assertion: 'qualified-roles-name-artifact-version',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q1', (report) => ({
        ...report,
        verifiedArtifacts: (report['verifiedArtifacts'] as Record<string, unknown>[]).map((entry) =>
          entry['name'] === 'whitebox-wasm' ? { ...entry, version: '9.9.9' } : entry,
        ),
      })),
  },
  // ---- preparation -------------------------------------------------------
  {
    label: 'preparation: original bytes marked changed',
    target: 'Q-PREP-1',
    assertion: 'original-bytes-unchanged',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q3prepare', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
          entry.name === 'original-unchanged' ? { ...entry, ok: false } : entry,
        ),
      })),
  },
  {
    label: 'preparation: instrument record removed',
    target: 'Q-PREP-1',
    assertion: 'derivative-cell-exact',
    expect: 'inconclusive',
    requirementVerdict: 'inconclusive',
    apply: (reports) =>
      mutateReport(reports, 'q3prepare', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string }[]).filter(
          (entry) => entry.name !== 'cell-exact',
        ),
      })),
  },
  // ---- CRS ---------------------------------------------------------------
  {
    label: 'crs: resolver record removed',
    target: 'Q-CRS-1',
    assertion: 'crs-resolver-identified',
    expect: 'inconclusive',
    requirementVerdict: 'inconclusive',
    apply: (reports) =>
      mutateReport(reports, 'q4crs', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string }[]).filter(
          (entry) => entry.name !== 'crs-resolver-identified',
        ),
      })),
  },
  {
    label: 'crs: projection record marked failed',
    target: 'Q-CRS-1',
    assertion: 'candidate-projection-within-tolerance',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'q4crs', (report) => ({
        ...report,
        assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
          entry.name === 'candidate-projection-matches-reference'
            ? { ...entry, ok: false }
            : entry,
        ),
      })),
  },
  // ---- display -----------------------------------------------------------
  {
    label: 'display: a warm run removed',
    target: 'Q-DISPLAY-1',
    assertion: 'one-cold-and-three-warm-runs',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'trace', (report) => ({
        ...report,
        runs: (report['runs'] as Record<string, unknown>[]).slice(0, 3),
      })),
  },
  {
    label: 'display: a run marked unsuccessful',
    target: 'Q-DISPLAY-1',
    assertion: 'runs-report-successful-rendering',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'trace', (report) => ({
        ...report,
        runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
          index === 0 ? { ...run, ok: false, failedTiles: 127, tilesRendered: 1 } : run,
        ),
      })),
  },
  {
    label: 'display: a latency sample removed',
    target: 'Q-DISPLAY-1',
    assertion: 'hundred-valid-latencies-per-run',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'trace', (report) => ({
        ...report,
        runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
          index === 0 ? { ...run, individualLatenciesMs: [1, 2, 3] } : run,
        ),
      })),
  },
  {
    label: 'display: recorded p95 substituted; the recomputed p95 fails',
    target: 'Q-DISPLAY-1',
    assertion: 'p95-from-individual-latencies',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'trace', (report) => ({
        ...report,
        runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
          index === 0 ? { ...run, p95Ms: 9999 } : run,
        ),
      })),
  },
  {
    label: 'display: a 900 ms stall recorded',
    target: 'Q-DISPLAY-1',
    assertion: 'no-ui-thread-task-above-bound',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'trace', (report) => ({
        ...report,
        runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
          index === 0 ? { ...run, longTaskMaxMs: 900 } : run,
        ),
      })),
  },
  {
    label: 'display: recorded median substituted and recomputation fails',
    target: 'Q-DISPLAY-1',
    assertion: 'statistics-agree-with-samples',
    expect: 'fail',
    requirementVerdict: 'fail',
    apply: (reports) =>
      mutateReport(reports, 'trace', (report) => ({
        ...report,
        runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
          index === 0 ? { ...run, medianMs: 9999 } : run,
        ),
      })),
  },
];

test('sweep control: the unmutated fixture satisfies every target assertion', () => {
  const root = new TempRoot();
  try {
    const decision = decide(root, roleReports());
    for (const [requirementId, assertion] of CONTROL_REQUIREMENTS) {
      const state = decision.requirement(requirementId);
      assert.equal(
        state.assertions[assertion],
        'pass',
        `control: ${requirementId}.${assertion} = ${state.assertions[assertion]}: ${state.reasons}`,
      );
    }
  } finally {
    root.cleanup();
  }
});

test('sweep: every mutation produces the expected finding on its target', () => {
  const observed: string[] = [];
  for (const mutation of MUTATIONS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      mutation.apply(reports);
      const decision = decide(root, reports);
      const state = decision.requirement(mutation.target);
      // The mapping's own verdict for the target assertion, promoted or held as a
      // partial measurement when the source was not admitted.
      const actual = state.assertions[mutation.assertion] ?? state.observed[mutation.assertion];
      observed.push(`${mutation.label} -> ${mutation.target}.${mutation.assertion}=${actual}`);
      assert.equal(
        actual,
        mutation.expect,
        `${mutation.label}: expected ${mutation.expect}, got ${actual} (${state.reasons})`,
      );
      if (mutation.requirementVerdict !== undefined) {
        assert.equal(
          state.verdict,
          mutation.requirementVerdict,
          `${mutation.label}: requirement was ${state.verdict} (${state.reasons})`,
        );
      }
    } finally {
      root.cleanup();
    }
  }
  assert.equal(observed.length, MUTATIONS.length);
});

test('sweep: no mutation moves an unaffected requirement', () => {
  const root = new TempRoot();
  let baseline: Record<string, string> = {};
  try {
    const decision = decide(root, roleReports());
    baseline = Object.fromEntries(
      CONTROL_REQUIREMENTS.map(([id]) => [id, decision.requirement(id).verdict ?? '(none)']),
    );
  } finally {
    root.cleanup();
  }
  for (const mutation of MUTATIONS) {
    const root2 = new TempRoot();
    try {
      const reports = roleReports();
      mutation.apply(reports);
      const decision = decide(root2, reports);
      for (const [requirementId] of CONTROL_REQUIREMENTS) {
        if (requirementId === mutation.target) continue;
        assert.equal(
          decision.requirement(requirementId).verdict,
          baseline[requirementId],
          `${mutation.label} moved ${requirementId}`,
        );
      }
    } finally {
      root2.cleanup();
    }
  }
});

test('sweep: every invalid numeric leaf fails rather than passing or gapping', () => {
  // The leaf values that are present but cannot be the number the field declares.
  // A first candidate run's decoded cache and the display stall are both consumed.
  for (const [label, value] of INVALID_NUMBERS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      reports['q6resources'] = {
        ...q6,
        measurements: (q6['measurements'] as Record<string, unknown>[]).map((entry, index) =>
          index === 0 ? { ...entry, decodedCacheBytes: value } : entry,
        ),
      };
      const state = decide(root, reports).requirement('Q-RES-1');
      assert.equal(
        state.assertions['disk-cache-reads-queue-and-children-recorded'],
        'fail',
        `decodedCacheBytes=${label}: ${state.reasons}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

/** Values that cannot be a duration in milliseconds. */
const INVALID_DURATIONS: readonly [string, unknown][] = [
  ['string', 'nope'],
  ['boolean', true],
  ['null', null],
  ['negative', -1],
  ['list', [1]],
  ['object', { v: 1 }],
];

test('sweep: every invalid display stall value fails rather than passing', () => {
  for (const [label, value] of INVALID_DURATIONS) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const trace = reports['trace']!;
      reports['trace'] = {
        ...trace,
        runs: (trace['runs'] as Record<string, unknown>[]).map((run, index) =>
          index === 0 ? { ...run, longTaskMaxMs: value } : run,
        ),
      };
      const state = decide(root, reports).requirement('Q-DISPLAY-1');
      assert.notEqual(
        state.assertions['no-ui-thread-task-above-bound'],
        'pass',
        `longTaskMaxMs=${label} passed`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('sweep: a known failure survives an independent gap at every layer', () => {
  const combinations: readonly [string, string, (reports: Reports) => void, (reports: Reports) => void][] = [
    [
      'Q-LOCAL-1',
      'window over limit + runId gap',
      (reports) =>
        mutateReport(reports, 'q2', (report) => ({
          ...report,
          windows: [{ classification: 'measured', window: { w: 4096, h: 4096 } }],
        })),
      (reports) => {
        const identity = { ...(reports['q2']!['identity'] as Report) };
        delete identity['runId'];
        reports['q2'] = { ...reports['q2']!, identity };
      },
    ],
    [
      'Q-LOCAL-1',
      'window over limit + identity removed',
      (reports) =>
        mutateReport(reports, 'q2', (report) => ({
          ...report,
          windows: [{ classification: 'measured', window: { w: 4096, h: 4096 } }],
        })),
      (reports) => {
        reports['q2'] = { ...reports['q2']!, identity: null };
      },
    ],
    [
      'Q-ART-1',
      'integrity failure + correspondence removed',
      (reports) =>
        mutateReport(reports, 'q1', (report) => ({
          ...report,
          assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
            entry.name === 'integrity:whitebox-wasm' ? { ...entry, ok: false } : entry,
          ),
        })),
      (reports) => mutateReport(reports, 'q1', (report) => ({ ...report, sourceCorrespondence: [] })),
    ],
    [
      'Q-PREP-1',
      'original changed + cell record removed',
      (reports) =>
        mutateReport(reports, 'q3prepare', (report) => ({
          ...report,
          assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
            entry.name === 'original-unchanged' ? { ...entry, ok: false } : entry,
          ),
        })),
      (reports) =>
        mutateReport(reports, 'q3prepare', (report) => ({
          ...report,
          assertions: (report['assertions'] as { name: string }[]).filter(
            (entry) => entry.name !== 'cell-exact',
          ),
        })),
    ],
    [
      'Q-DISPLAY-1',
      'stall + unknown optional field',
      (reports) =>
        mutateReport(reports, 'trace', (report) => ({
          ...report,
          runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
            index === 0 ? { ...run, longTaskMaxMs: 900 } : run,
          ),
        })),
      (reports) =>
        mutateReport(reports, 'trace', (report) => ({
          ...report,
          runs: (report['runs'] as Record<string, unknown>[]).map((run, index) =>
            index === 0 ? { ...run, someOptionalField: 1 } : run,
          ),
        })),
    ],
  ];
  for (const [requirementId, label, fault, gap] of combinations) {
    for (const order of ['fault-first', 'gap-first'] as const) {
      const root = new TempRoot();
      try {
        const reports = roleReports();
        if (order === 'fault-first') {
          fault(reports);
          gap(reports);
        } else {
          gap(reports);
          fault(reports);
        }
        const state = decide(root, reports).requirement(requirementId);
        assert.equal(
          state.verdict,
          'fail',
          `${label} (${order}) became ${state.verdict}: ${state.reasons}`,
        );
      } finally {
        root.cleanup();
      }
    }
  }
});

test('sweep: a legitimate negative control is preserved', () => {
  // A declared expected rejection is a successful control execution, not a positive
  // failure: the mutation below is legitimate and must not be swept as a defect.
  const root = new TempRoot();
  try {
    const reports = roleRoles(roleReports());
    const lifecycle = reports['q5lifecycle']!;
    reports['q5lifecycle'] = {
      ...lifecycle,
      negativeControlScopes: ['expected-rejection:'],
      failures: ['expected-rejection: the control refused the malformed input'],
    };
    const state = decide(root, reports).requirement('Q-FAILINJ-1');
    assert.equal(state.assertions['truncated-header-rejected'], 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

function roleRoles(value: Reports): Reports {
  return value;
}

void FIXTURE_HASH;
