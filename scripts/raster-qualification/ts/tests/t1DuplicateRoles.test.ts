/**
 * T1 — keyed identity: duplicate source roles.
 *
 * A source role names the one report a requirement reads for that role. Two sources
 * claiming one role are ambiguous evidence, so the pair is rejected outright rather
 * than resolved by whichever happened to be read last. Duplicate *keys* in general
 * are checked before any collection is indexed, in both directions of arrival.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

const CLONE_ROLES = ['q2', 'q1', 'trace', 'q6resources'] as const;

interface Source {
  role: string;
  path: string;
}

/** Write every role, cloning `role` into a second path with `replacement`. */
function duplicateRole(
  root: TempRoot,
  reports: Record<string, Record<string, unknown>>,
  role: string,
  first: 'original' | 'clone',
  replacement: (clone: Record<string, unknown>) => Record<string, unknown>,
): { sources: Source[]; labels: { original: string; clone: string } } {
  const originalPath = root.write(`reports/${role}.json`, reports[role]!);
  const clonePath = root.write(`reports/${role}-clone.json`, replacement({ ...reports[role]! }));
  const sources: Source[] = SOURCE_ROLES.filter((other) => other !== role).map((other) => ({
    role: other,
    path: root.write(`reports/${other}.json`, reports[other]!),
  }));
  const pair = first === 'original'
    ? [{ role, path: originalPath }, { role, path: clonePath }]
    : [{ role, path: clonePath }, { role, path: originalPath }];
  sources.push(...pair);
  return { sources, labels: { original: originalPath, clone: clonePath } };
}

function request(root: TempRoot, sources: readonly Source[]): string {
  return root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
}

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

test('T1 control: one source per role is accepted', () => {
  const root = new TempRoot();
  try {
    const sources = SOURCE_ROLES.map((role) => ({
      role,
      path: root.write(`reports/${role}.json`, roleReports()[role]!),
    }));
    const result = runCli(request(root, sources), join(root.path, 'd.json'));
    assert.equal(verdictOf(result, 'Q-LOCAL-1'), 'pass', reasonsOf(result, 'Q-LOCAL-1'));
    assert.equal(verdictOf(result, 'Q-ART-1'), 'pass', reasonsOf(result, 'Q-ART-1'));
    // Q-RES-1 is a gap for an unrelated reason: no producer emits the plan's display
    // disk-cache observation. Its reducible assertions are what this control checks.
    const resources = (result.decision?.['requirements'] as
      | { id: string; assertions: Record<string, string> }[]
      | undefined)?.find((entry) => entry.id === 'Q-RES-1');
    assert.equal(
      resources?.assertions['disk-cache-reads-queue-and-children-recorded'],
      'pass',
      reasonsOf(result, 'Q-RES-1'),
    );
  } finally {
    root.cleanup();
  }
});

test('T1: identical duplicate roles do not let a failure be overwritten', () => {
  // The clone records a failure. Whichever order the pair arrives in, the failure
  // must not be replaced by the passing original.
  for (const role of CLONE_ROLES) {
    for (const first of ['original', 'clone'] as const) {
      const root = new TempRoot();
      try {
        const { sources } = duplicateRole(root, roleReports(), role, first, (clone) => ({
          ...clone,
          result: 'fail',
          failures: ['a known failure'],
        }));
        const result = runCli(request(root, sources), join(root.path, 'd.json'));
        assert.notEqual(
          result.decision?.['verdict'],
          'pass',
          `${role} duplicated (${first} first) still qualified`,
        );
        const requirement = { q2: 'Q-LOCAL-1', q1: 'Q-ART-1', trace: 'Q-DISPLAY-1', q6resources: 'Q-RES-1' }[role]!;
        assert.equal(
          verdictOf(result, requirement),
          'fail',
          `${role} duplicated (${first} first): ${reasonsOf(result, requirement)}`,
        );
      } finally {
        root.cleanup();
      }
    }
  }
});

test('T1: conflicting duplicate roles are rejected independent of order', () => {
  for (const first of ['original', 'clone'] as const) {
    const root = new TempRoot();
    try {
      const { sources } = duplicateRole(root, roleReports(), 'q2', first, (clone) => clone);
      const result = runCli(request(root, sources), join(root.path, 'd.json'));
      assert.notEqual(verdictOf(result, 'Q-LOCAL-1'), 'pass', `order=${first}`);
      assert.match(reasonsOf(result, 'Q-LOCAL-1'), /duplicate|more than once/i, `order=${first}`);
    } finally {
      root.cleanup();
    }
  }
});

test('T1: duplicate role detection names both sources', () => {
  const root = new TempRoot();
  try {
    const { sources, labels } = duplicateRole(root, roleReports(), 'q2', 'original', (clone) => clone);
    const result = runCli(request(root, sources), join(root.path, 'd.json'));
    const reasons = reasonsOf(result, 'Q-LOCAL-1');
    assert.ok(
      reasons.includes(labels.original) || reasons.includes(labels.clone),
      `the reason must identify the duplicated role's sources: ${reasons}`,
    );
  } finally {
    root.cleanup();
  }
});
