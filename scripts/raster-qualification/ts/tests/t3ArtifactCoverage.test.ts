/**
 * T3 — required artifact coverage.
 *
 * Required sets come from the declarations, never from whichever assertion names a
 * report happens to supply. A prefix match over the supplied list proves only that
 * some record exists under some name; it says nothing about whether the artifacts
 * the route needs were covered, or whether the engine recorded as the one exercised
 * is the engine the route declares.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

type Report = Record<string, unknown>;
type Reports = Record<string, Report>;

function requestWith(root: TempRoot, reports: Reports): string {
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
  });
}

function decide(root: TempRoot, reports: Reports) {
  return runCli(requestWith(root, reports), join(root.path, 'd.json'));
}

function requirement(result: ReturnType<typeof runCli>, id: string): {
  verdict: string | undefined;
  assertions: Record<string, string>;
  reasons: string;
} {
  const found = (result.decision?.['requirements'] as
    | { id: string; verdict: string; assertions: Record<string, string>; reasons: string[] }[]
    | undefined)?.find((entry) => entry.id === id);
  return {
    verdict: found?.verdict,
    assertions: found?.assertions ?? {},
    reasons: found?.reasons.join(' ') ?? '',
  };
}

/** Rewrite one report in a fresh copy of the control. */
function withReport(role: string, mutate: (report: Report) => Report): Reports {
  const reports = roleReports();
  reports[role] = mutate(reports[role]!);
  return reports;
}

function setAssertions(report: Report, assertions: { name: string; ok: boolean }[]): Report {
  return { ...report, assertions };
}

/** The candidate artifacts the route declares and Q-ART-1 must cover. */
const REQUIRED_ARTIFACTS = ['whitebox-wasm', 'cog-tiler-wasm'] as const;

test('T3 control: the complete artifact report satisfies Q-ART-1', () => {
  const root = new TempRoot();
  try {
    const state = requirement(decide(root, roleReports()), 'Q-ART-1');
    assert.equal(state.verdict, 'pass', state.reasons);
    assert.equal(state.assertions['artifacts-match-integrity-digest'], 'pass');
    assert.equal(state.assertions['artifacts-present-at-declared-version'], 'pass');
    assert.equal(state.assertions['artifacts-record-license'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('T3: every required artifact needs its own integrity record', () => {
  for (const artifact of REQUIRED_ARTIFACTS) {
    const root = new TempRoot();
    try {
      const reports = withReport('q1', (report) =>
        setAssertions(
          report,
          (report['assertions'] as { name: string; ok: boolean }[]).filter(
            (entry) => entry.name !== `integrity:${artifact}`,
          ),
        ),
      );
      const state = requirement(decide(root, reports), 'Q-ART-1');
      assert.equal(
        state.assertions['artifacts-match-integrity-digest'],
        'inconclusive',
        `removing integrity:${artifact} did not leave a gap`,
      );
      assert.notEqual(state.verdict, 'pass', `removing integrity:${artifact} still passed`);
    } finally {
      root.cleanup();
    }
  }
});

test('T3: every required artifact needs its own version record', () => {
  for (const artifact of REQUIRED_ARTIFACTS) {
    const root = new TempRoot();
    try {
      const reports = withReport('q1', (report) =>
        setAssertions(
          report,
          (report['assertions'] as { name: string; ok: boolean }[]).filter(
            (entry) => !entry.name.startsWith(`version:${artifact}`),
          ),
        ),
      );
      const state = requirement(decide(root, reports), 'Q-ART-1');
      assert.notEqual(state.verdict, 'pass', `removing version:${artifact} still passed`);
    } finally {
      root.cleanup();
    }
  }
});

test('T3: every required artifact needs its own license record', () => {
  for (const artifact of REQUIRED_ARTIFACTS) {
    const root = new TempRoot();
    try {
      const reports = withReport('q1', (report) =>
        setAssertions(
          report,
          (report['assertions'] as { name: string; ok: boolean }[]).filter(
            (entry) => entry.name !== `license-recorded:${artifact}`,
          ),
        ),
      );
      const state = requirement(decide(root, reports), 'Q-ART-1');
      assert.notEqual(state.verdict, 'pass', `removing license-recorded:${artifact} still passed`);
    } finally {
      root.cleanup();
    }
  }
});

test('T3: an unrelated assertion name cannot substitute for a required artifact', () => {
  for (const artifact of REQUIRED_ARTIFACTS) {
    const root = new TempRoot();
    try {
      const reports = withReport('q1', (report) =>
        setAssertions(report, [
          ...(report['assertions'] as { name: string; ok: boolean }[]).filter(
            (entry) => !entry.name.startsWith(`integrity:${artifact}`),
          ),
          { name: 'integrity:unrelated', ok: true },
        ]),
      );
      const state = requirement(decide(root, reports), 'Q-ART-1');
      assert.notEqual(
        state.verdict,
        'pass',
        `integrity:unrelated substituted for integrity:${artifact}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T3: a conflicting required artifact record fails rather than passing on one', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q1', (report) =>
      setAssertions(
        report,
        (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
          entry.name === 'integrity:whitebox-wasm' ? { ...entry, ok: false } : entry,
        ),
      ),
    );
    const state = requirement(decide(root, reports), 'Q-ART-1');
    assert.equal(
      state.assertions['artifacts-match-integrity-digest'],
      'fail',
      state.reasons,
    );
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T3: the engine recorded for preparation must be the declared one', () => {
  // Preparation uses native GDAL, which the plan retains rather than pins: the name
  // must be GDAL, while the version is whatever the run discovered.
  for (const replacement of [
    { name: 'unrelated-engine', version: '999' },
    { name: 'unrelated-engine', version: '3.8.4' },
    { name: 'whitebox-wasm', version: '0.5.1' },
    { name: '', version: '3.8.4' },
  ]) {
    const root = new TempRoot();
    try {
      const reports = withReport('q3prepare', (report) => ({
        ...report,
        identity: { ...(report['identity'] as Report), artifact: replacement },
      }));
      const state = requirement(decide(root, reports), 'Q-PREP-1');
      assert.notEqual(
        state.verdict,
        'pass',
        `preparation claimed ${JSON.stringify(replacement)} and passed`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T3: a retained engine may record any discovered version', () => {
  // The plan retains native GDAL, so a version newer than the reference install is
  // recorded for review rather than rejected as a mismatch.
  for (const version of ['3.8.4', '3.9.0', 'unknown']) {
    const root = new TempRoot();
    try {
      const reports = withReport('q3prepare', (report) => ({
        ...report,
        identity: {
          ...(report['identity'] as Report),
          artifact: { name: 'gdal', version },
        },
      }));
      const state = requirement(decide(root, reports), 'Q-PREP-1');
      assert.equal(state.verdict, 'pass', `gdal@${version}: ${state.reasons}`);
    } finally {
      root.cleanup();
    }
  }
});

test('T3: a retained engine with no recorded version is a gap', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q3prepare', (report) => ({
      ...report,
      identity: { ...(report['identity'] as Report), artifact: { name: 'gdal' } },
    }));
    const state = requirement(decide(root, reports), 'Q-PREP-1');
    assert.notEqual(state.verdict, 'pass', state.reasons);
    assert.match(state.reasons, /version/, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T3: the engine recorded for CRS resolution must be the declared one', () => {
  const root = new TempRoot();
  try {
    const reports = withReport('q4crs', (report) => ({
      ...report,
      identity: {
        ...(report['identity'] as Report),
        artifact: { name: 'unrelated-engine', version: '999' },
      },
    }));
    const state = requirement(decide(root, reports), 'Q-CRS-1');
    assert.notEqual(state.verdict, 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T3: an unpinned role still has to name an applicable declared engine', () => {
  // Native GDAL is retained rather than pinned, but "unpinned" is not "any engine".
  const root = new TempRoot();
  try {
    const reports = withReport('q4slope', (report) => ({
      ...report,
      identity: {
        ...(report['identity'] as Report),
        artifact: { name: 'unrelated-engine', version: '999' },
      },
    }));
    const state = requirement(decide(root, reports), 'Q-VALUE-1');
    assert.notEqual(state.verdict, 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});
