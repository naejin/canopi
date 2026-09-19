/**
 * Adversarial self-review for round 1, beyond the T1-T4 families.
 *
 * Sibling paths to the reviewed defects: other keyed collections, other per-run
 * fields, other requirement mappings and the direct programmatic entry point. Each
 * case drives the real emitted CLI with fresh raw inputs; nothing is mocked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';
import { prepare, decideRequirement } from '../src/decide.js';
import { validateContract } from '../src/declaration.js';
import { MAPPINGS } from '../src/evidence/registry.js';
import { expectationsForRole } from '../src/declared/route.js';

type Report = Record<string, unknown>;
type Reports = Record<string, Report>;

function requestWith(root: TempRoot, reports: Reports, extra: Record<string, unknown> = {}): string {
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
    ...extra,
  });
}

function decide(root: TempRoot, reports: Reports) {
  return runCli(requestWith(root, reports), join(root.path, 'd.json'));
}

function verdictOf(result: ReturnType<typeof runCli>, id: string): string | undefined {
  const found = (result.decision?.['requirements'] as { id: string; verdict: string }[] | undefined)
    ?.find((entry) => entry.id === id);
  return found?.verdict;
}

function assertNoFalsePass(
  result: ReturnType<typeof runCli>,
  requirementId: string,
  label: string = requirementId,
): void {
  assert.doesNotMatch(
    result.stderr,
    /TypeError|AttributeError|ReferenceError|at Object\.|node:internal/,
    `${label}: crashed`,
  );
  assert.notEqual(verdictOf(result, requirementId), 'pass', `${label}: false pass`);
}

test('sibling: one file cannot satisfy two roles with conflicting expectations', () => {
  // A q1-shaped report answers the q1 role, so it is legitimately accepted there.
  // Reading it for q2 as well must fail q2, because q2's declared experiment and
  // fixture policy are different.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const shared = root.write('shared.json', reports['q1']!);
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: role === 'q1' || role === 'q2'
        ? shared
        : root.write(`reports/${role}.json`, reports[role]!),
    }));
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assertNoFalsePass(result, 'Q-LOCAL-1', 'q1 report read for the q2 role');
    // The report is genuinely q1's, so the q1 role may still be satisfied.
    assert.equal(verdictOf(result, 'Q-ART-1'), 'pass');
  } finally {
    root.cleanup();
  }
});

test('sibling: a requirement reading two roles loses when either is duplicated', () => {
  // Q-VALUE-1 reads q2 and q4slope. Duplicating either must reach it.
  for (const duplicated of ['q2', 'q4slope'] as const) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const sources = SOURCE_ROLES.filter((role) => role !== duplicated).map((role) => ({
        role,
        path: root.write(`reports/${role}.json`, reports[role]!),
      }));
      const extra = { ...reports[duplicated]!, result: 'fail', failures: ['boom'] };
      sources.push({ role: duplicated, path: root.write('dup-a.json', reports[duplicated]!) });
      sources.push({ role: duplicated, path: root.write('dup-b.json', extra) });
      const requestPath = root.write('request.json', {
        contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
        fixtureManifest: fixtureManifest(),
        pins: candidatePins(),
        now: NOW,
        sources,
      });
      const result = runCli(requestPath, join(root.path, 'd.json'));
      assert.equal(
        verdictOf(result, 'Q-VALUE-1'),
        'fail',
        `duplicating ${duplicated} did not fail Q-VALUE-1`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('sibling: every per-run mandatory field is enforced on every candidate run', () => {
  const fields = [
    'incrementalPeakRssMiB',
    'temporaryDiskHighWaterBytes',
    'decodedCacheBytes',
    'activeReads',
    'queueDepth',
    'maxConcurrentChildren',
    'sampleIntervalMs',
    'sampleCount',
  ];
  for (const field of fields) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      reports['q6resources'] = {
        ...q6,
        measurements: (q6['measurements'] as Record<string, unknown>[]).map((entry, index) => {
          if (index !== 0) return entry;
          const copy: Record<string, unknown> = { ...entry };
          delete copy[field];
          return copy;
        }),
      };
      const result = decide(root, reports);
      assert.notEqual(
        verdictOf(result, 'Q-RES-1'),
        'pass',
        `${field} removed from a candidate run still passed`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('sibling: a reference record cannot supply a candidate counter', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q6 = reports['q6resources']!;
    const measurements = q6['measurements'] as Record<string, unknown>[];
    // The candidate run loses its counters; the reference record carries plausible
    // values under the same names. They must not be borrowed.
    const candidate: Record<string, unknown> = { ...measurements[0]! };
    delete candidate['decodedCacheBytes'];
    delete candidate['activeReads'];
    delete candidate['queueDepth'];
    reports['q6resources'] = {
      ...q6,
      measurements: [
        candidate,
        { ...measurements[1]!, decodedCacheBytes: 1, activeReads: 1, queueDepth: 1 },
      ],
    };
    const result = decide(root, reports);
    const resources = (result.decision?.['requirements'] as
      | { id: string; verdict: string; assertions: Record<string, string>; reasons: string[] }[]
      | undefined)?.find((entry) => entry.id === 'Q-RES-1');
    assert.notEqual(resources?.verdict, 'pass', 'reference counters were borrowed');
    assert.equal(
      resources?.assertions['disk-cache-reads-queue-and-children-recorded'],
      'inconclusive',
      resources?.reasons.join(' '),
    );
  } finally {
    root.cleanup();
  }
});

test('sibling: an unknown extra field cannot establish an unmeasured obligation', () => {
  // A caller inventing a plausible key must not make a plan budget measurable.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q6 = reports['q6resources']!;
    reports['q6resources'] = {
      ...q6,
      measurements: (q6['measurements'] as Record<string, unknown>[]).map((entry, index) =>
        index === 0
          ? {
              ...entry,
              displayDiskCacheBytes: 1,
              stagingFreeSpaceBytes: 10 ** 12,
              wasmMemoryMiB: 1,
              processCount: 1,
            }
          : entry,
      ),
    };
    const result = decide(root, reports);
    assert.notEqual(
      verdictOf(result, 'Q-RES-1'),
      'pass',
      'invented fields established an unmeasured budget',
    );
  } finally {
    root.cleanup();
  }
});

test('sibling: an unadmitted source keeps its measured failures visible', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    // A window over the limit AND a missing identity: the failure must survive.
    reports['q2'] = {
      ...q2,
      identity: null,
      windows: [{ classification: 'measured', window: { w: 4096, h: 4096 } }],
    };
    const result = decide(root, reports);
    const local = (result.decision?.['requirements'] as
      | { id: string; verdict: string; reasons: string[] }[]
      | undefined)?.find((entry) => entry.id === 'Q-LOCAL-1');
    assert.equal(local?.verdict, 'fail', local?.reasons.join(' '));
    assert.match(local?.reasons.join(' ') ?? '', /4096x4096/);
  } finally {
    root.cleanup();
  }
});

test('parity: the programmatic entry point decides the same as the CLI', () => {
  // The contract requires the programmatic and CLI paths to agree. Both are driven
  // here from the same bytes.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const requestJson = JSON.parse(readFileSync(requestWith(root, reports), 'utf8')) as {
      contract: unknown;
      fixtureManifest: unknown;
      pins: unknown;
      now: number;
      sources: { role: string; path: string }[];
    };
    const contract = validateContract(requestJson.contract, 'contract');
    assert.equal(contract.verdict, 'pass');
    const byRole = new Map<string, ReturnType<typeof prepare>['admitted'][number]>();
    const prepared = prepare({
      contract: contract.value!,
      now: requestJson.now,
      sources: requestJson.sources.map((source) => {
        const expectations = expectationsForRole(source.role);
        assert.ok(expectations !== undefined, `role ${source.role}`);
        return {
          role: source.role,
          label: source.path,
          path: source.path,
          expectations: { ...expectations, now: requestJson.now },
        };
      }),
    });
    for (const entry of prepared.admitted) byRole.set(entry.role, entry);
    // The CLI and this programmatic path must agree on a straightforward mapping.
    const programmatic = decideRequirement(
      contract.value!,
      prepared,
      MAPPINGS.get('Q-LOCAL-1')!.mapping,
      'Q-LOCAL-1',
    );
    const cli = decide(root, reports);
    assert.equal(programmatic.verdict, verdictOf(cli, 'Q-LOCAL-1'));
    assert.equal(programmatic.verdict, 'pass', programmatic.reasons.join(' '));
  } finally {
    root.cleanup();
  }
});

test('sibling: an empty source list is a gap, never a pass', () => {
  const root = new TempRoot();
  try {
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: [],
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.notEqual(result.decision?.['verdict'], 'pass');
    assert.equal(result.decision?.['verdict'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('sibling: a source whose path is a directory is corruption, not absence', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: role === 'q2' ? root.path : root.write(`reports/${role}.json`, reports[role]!),
    }));
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assert.doesNotMatch(result.stderr, /TypeError|AttributeError|at Object\./);
    assert.notEqual(verdictOf(result, 'Q-LOCAL-1'), 'pass');
  } finally {
    root.cleanup();
  }
});
