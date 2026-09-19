/**
 * The adversarial review pass.
 *
 * These tests try to make the emitted CLI produce a false pass, hide a failure or
 * crash. They are deliberately repetitive rather than elegant: each one is an
 * attack that a reader can check against the contract, and several encode inputs
 * that a hostile or merely broken producer could emit.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, runCliArgs, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, PLAN } from './fixtures.js';

function requestWith(
  root: TempRoot,
  reports: Record<string, Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): string {
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

/** Assert the run never claims eligibility and never crashes. */
function assertNoFalsePass(
  result: ReturnType<typeof runCli>,
  label: string,
  expectedStatus?: number,
): void {
  assert.doesNotMatch(
    result.stderr,
    /TypeError|AttributeError|ReferenceError|at Object\.|node:internal/,
    `${label}: crashed with a traceback`,
  );
  assert.notEqual(result.decision?.['verdict'], 'pass', `${label}: false pass`);
  if (expectedStatus !== undefined) {
    assert.equal(result.status, expectedStatus, `${label}: unexpected status`);
  } else {
    assert.notEqual(result.status, 0, `${label}: exit zero without eligibility`);
  }
}

test('adversarial: a report that claims pass while recording a failure cannot qualify', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q2'] = {
      ...reports['q2']!,
      result: 'pass',
      failures: ['the transport aborted mid-window'],
    };
    const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
    assertNoFalsePass(result, 'pass+failure');
    // The recorded failure must reach the reader, not merely change a verdict.
    const requirements = result.decision?.['requirements'] as
      | { id: string; reasons: string[] }[]
      | undefined;
    const reasons = requirements?.find((entry) => entry.id === 'Q-LOCAL-1')?.reasons.join(' ') ?? '';
    assert.match(reasons, /the transport aborted mid-window/, 'the recorded failure was lost');
  } finally {
    root.cleanup();
  }
});

test('adversarial: an absent result with recorded failures names the failure and fails', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = { ...reports['q2']! };
    delete q2['result'];
    reports['q2'] = { ...q2, failures: ['measurement aborted'] };
    const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
    assertNoFalsePass(result, 'absent result + failure', 1);
    const requirements = result.decision?.['requirements'] as
      | { id: string; reasons: string[] }[]
      | undefined;
    const reasons = requirements?.find((entry) => entry.id === 'Q-LOCAL-1')?.reasons.join(' ') ?? '';
    assert.match(reasons, /measurement aborted/, 'the recorded failure was lost');
  } finally {
    root.cleanup();
  }
});

test('adversarial: a failed assertion is named in the reasons, not only counted', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    reports['q2'] = {
      ...q2,
      assertions: (q2['assertions'] as Record<string, unknown>[]).map((entry, index) =>
        index === 0 ? { ...entry, ok: false } : entry),
    };
    const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
    assertNoFalsePass(result, 'failed assertion', 1);
    const requirements = result.decision?.['requirements'] as
      | { id: string; reasons: string[] }[]
      | undefined;
    const reasons = requirements?.find((entry) => entry.id === 'Q-LOCAL-1')?.reasons.join(' ') ?? '';
    assert.match(reasons, /failed assertion/, 'the failed assertion was not named');
  } finally {
    root.cleanup();
  }
});

test('adversarial: an empty assertions list with a pass result cannot qualify', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q2'] = { ...reports['q2']!, assertions: [] };
    const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('adversarial: a negative-control prefix cannot excuse a mandatory assertion', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    // Declaring every failure in scope must not turn a mandatory positive
    // assertion's failure into a successful control execution.
    reports['q2'] = {
      ...q2,
      negativeControlScopes: ['analytic:'],
      assertions: (q2['assertions'] as Record<string, unknown>[]).map((entry) =>
        String(entry['name']).startsWith('analytic:') ? { ...entry, ok: false } : entry),
    };
    const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
    assertNoFalsePass(result, 'scoped failure');
  } finally {
    root.cleanup();
  }
});

test('adversarial: an absurd counter cannot be read as within budget', () => {
  const root = new TempRoot();
  try {
    let attempt = 0;
    for (const value of [Number.MAX_SAFE_INTEGER, 1e308, -1, 2.5, '1024', null]) {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const measurements = (q6['measurements'] as Record<string, unknown>[]).map((entry, index) =>
        index === 0 ? { ...entry, decodedCacheBytes: value } : entry);
      reports['q6resources'] = { ...q6, measurements };
      // Publication never replaces an existing output, so each case needs its own
      // destination; reusing one would make the second case an output refusal.
      const result = runCli(requestWith(root, reports), join(root.path, `d-${attempt}.json`));
      attempt += 1;
      assert.notEqual(
        result.decision?.['verdict'],
        'pass',
        `decodedCacheBytes=${String(value)} was accepted`,
      );
    }
  } finally {
    root.cleanup();
  }
});

test('adversarial: an infinite or NaN measurement cannot pass a budget', () => {
  const root = new TempRoot();
  try {
    let attempt = 0;
    for (const token of ['1e999', 'NaN', '-Infinity']) {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const body = JSON.stringify(q6).replace('"decodedCacheBytes":1024', `"decodedCacheBytes":${token}`);
      const requestPath = requestWith(root, reports);
      writeFileSync(join(root.path, 'reports/q6resources.json'), body);
      // Each token needs its own destination: publication never replaces an
      // existing output, so a shared path would make the second case a refusal.
      const result = runCli(requestPath, join(root.path, `d-nonfinite-${attempt}.json`));
      attempt += 1;
      assertNoFalsePass(result, `decodedCacheBytes=${token}`, 1);
    }
  } finally {
    root.cleanup();
  }
});

test('adversarial: a bundle supplied alongside sources is ignored, not trusted', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    // Every source is removed so only the offered bundle could carry a verdict.
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: join(root.path, 'absent', `${role}.json`),
    }));
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
      bundle: {
        generatedAt: NOW,
        environment: { host: 'desktop-webview' },
        route: { numeric: 'anything' },
        declarations: { fixtureManifest: { verdict: 'pass' } },
        requirements: Object.fromEntries(
          SOURCE_ROLES.map((role) => [
            role,
            {
              assertions: { 'window-size-within-contract-limit': 'pass' },
              admission: { verdict: 'pass', sourceAdmitted: true, reasons: [] },
            },
          ]),
        ),
      },
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assertNoFalsePass(result, 'offered bundle');
  } finally {
    root.cleanup();
  }
});

test('adversarial: a path traversal in a source path reaches nothing it should not', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: SOURCE_ROLES.map((role) => ({
        role,
        // A path the caller declares is read as declared; nothing embedded in a
        // document is ever followed.
        path: role === 'q2' ? join(root.path, '..', 'does-not-exist', 'x.json') : root.write(
          `reports/${role}.json`,
          reports[role]!,
        ),
      })),
    });
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assertNoFalsePass(result, 'traversal');
  } finally {
    root.cleanup();
  }
});

test('adversarial: an unusable output parent exits nonzero without a saved claim', () => {
  // Publication creates only its own staging and diagnostic directories beneath an
  // existing parent. A missing parent is the caller's to prepare: the invocation is
  // refused, nothing is created, and the caller is told no diagnostic was saved.
  const root = new TempRoot();
  try {
    const requestPath = requestWith(root, roleReports());
    const result = runCli(requestPath, join(root.path, 'no-such-dir', 'deeper', 'd.json'));
    assert.equal(result.status, 2, 'a missing parent must be refused, not created');
    assert.match(result.stderr, /no diagnostic was saved/);
    assert.equal(root.has(join('no-such-dir')), false, 'the parent was created anyway');
    assert.doesNotMatch(result.stdout, /"out"/);
  } finally {
    root.cleanup();
  }
  const root2 = new TempRoot();
  try {
    const requestPath = requestWith(root2, roleReports());
    const blocker = root2.write('blocker', 'x');
    const before = readFileSync(blocker, 'utf8');
    const result = runCli(requestPath, join(blocker, 'd.json'));
    assert.equal(result.status, 2);
    assert.match(result.stderr, /no diagnostic was saved/);
    assert.equal(readFileSync(blocker, 'utf8'), before);
    assert.doesNotMatch(result.stdout, /"out"/);
  } finally {
    root2.cleanup();
  }
});

test('adversarial: a deeply nested or oversized document is handled without hanging', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const requestPath = requestWith(root, reports);
    // A pathological but small payload: deeply nested arrays in a field the
    // mappings read as a list.
    const nested = '['.repeat(200) + ']'.repeat(200);
    writeFileSync(join(root.path, 'reports/q2.json'), `{"experiment":"q2-numeric","windows":${nested}}`);
    const result = runCli(requestPath, join(root.path, 'd.json'));
    assertNoFalsePass(result, 'deeply nested');
  } finally {
    root.cleanup();
  }
});

test('adversarial: an unreadable source file is corruption, not absence', () => {
  const root = new TempRoot();
  try {
    const requestPath = requestWith(root, roleReports());
    const target = join(root.path, 'reports/q2.json');
    chmodSync(target, 0o000);
    const result = runCli(requestPath, join(root.path, 'd.json'));
    chmodSync(target, 0o644);
    // Running as root can read anything, so both outcomes are acceptable here; what
    // is not acceptable is a crash or a pass.
    assertNoFalsePass(result, 'unreadable', result.status);
  } finally {
    root.cleanup();
  }
});

test('adversarial: every requirement id in the contract is mapped or an explicit gap', () => {
  const root = new TempRoot();
  try {
    const contract = JSON.parse(readFileSync(realContractPath(), 'utf8')) as {
      requirements: { id: string }[];
    };
    const result = runCli(requestWith(root, roleReports()), join(root.path, 'd.json'));
    const requirements = result.decision?.['requirements'] as { id: string }[] | undefined;
    assert.ok(requirements !== undefined);
    for (const spec of contract.requirements) {
      const found = requirements.find((entry) => entry.id === spec.id);
      assert.ok(found !== undefined, `${spec.id} is missing from the decision`);
    }
    assert.equal(requirements.length, contract.requirements.length);
  } finally {
    root.cleanup();
  }
});

test('adversarial: a runner-style decision over a directory of real reports is reproducible', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const files = new Map([
      ['q1', 'q1-artifacts.json'],
      ['q2', 'q2-numeric.json'],
      ['q3prepare', 'q3-prepare.json'],
      ['q3members', 'q3-members.json'],
      ['q4slope', 'q4-slope.json'],
      ['q4crs', 'q4-crs.json'],
      ['q5lifecycle', 'q5-lifecycle.json'],
      ['q6resources', 'q6-resources.json'],
      ['trace', 'q6-trace.json'],
    ]);
    for (const [role, file] of files) {
      writeFileSync(join(root.path, file), JSON.stringify(reports[role], null, 2));
    }
    writeFileSync(join(root.path, 'pins.json'), JSON.stringify({ pinnedSourceCommits: candidatePins() }));
    const common = [
      '--reports', root.path,
      '--contract', realContractPath(),
      '--pins', join(root.path, 'pins.json'),
      '--now', String(NOW),
    ];
    const first = runCliArgs([...common, '--out', join(root.path, 'd1.json')], join(root.path, 'd1.json'));
    const second = runCliArgs([...common, '--out', join(root.path, 'd2.json')], join(root.path, 'd2.json'));
    assert.equal(first.status, second.status);
    assert.deepEqual(first.decision, second.decision, 'a rerun must decide identically');
  } finally {
    root.cleanup();
  }
});

void PLAN;
void rmSync;
