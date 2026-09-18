/**
 * T4 — sidecar evidence.
 *
 * The sidecar assertion asks whether a sidecar that was present survived
 * preparation. Equality of two recorded hashes, on its own, is not an observation
 * that anything survived: a record must say when each hash was taken and that the
 * sidecar was still there afterwards. A digest that cannot be a digest is malformed
 * input, and a policy the consumer does not recognise is a gap rather than a pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, FIXTURE_HASH } from './fixtures.js';

type Report = Record<string, unknown>;

function requestWith(root: TempRoot, reports: Record<string, Report>): string {
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

function sidecarOf(root: TempRoot, options: {
  policy: string;
  sidecar?: unknown;
  sidecarSha256?: unknown;
}): { assertion: string | undefined; verdict: string | undefined; reasons: string } {
  const reports = roleReports();
  const prepare = reports['q3prepare']!;
  const identity: Report = { ...(prepare['identity'] as Report), sidecarPolicy: options.policy };
  if (options.sidecarSha256 !== undefined) identity['sidecarSha256'] = options.sidecarSha256;
  const mutated: Report = { ...prepare, identity };
  // The control fixture carries a sidecar record, so an omitted one must actually be
  // removed rather than left in place by a spread of an empty object.
  if (options.sidecar === undefined) delete mutated['sidecar'];
  else mutated['sidecar'] = options.sidecar;
  reports['q3prepare'] = mutated;
  const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
  const found = (result.decision?.['requirements'] as
    | { id: string; verdict: string; assertions: Record<string, string>; reasons: string[] }[]
    | undefined)?.find((entry) => entry.id === 'Q-PREP-1');
  return {
    assertion: found?.assertions['sidecar-unchanged'],
    verdict: found?.verdict,
    reasons: found?.reasons.join(' ') ?? '',
  };
}

test('T4 control: an explicitly not-applicable sidecar satisfies the assertion', () => {
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, { policy: 'not_applicable' });
    assert.equal(state.assertion, 'pass', state.reasons);
    assert.equal(state.verdict, 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: a complete measured sidecar record with survival evidence passes', () => {
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, {
      policy: 'measured',
      sidecar: {
        expectedSha256: FIXTURE_HASH,
        sha256: FIXTURE_HASH,
        before: 'present',
        after: 'present',
      },
    });
    assert.equal(state.assertion, 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: equal hashes without survival evidence are a gap, not a pass', () => {
  // The reviewer's example: two equal strings prove only that the same value was
  // written twice. Nothing observed whether the sidecar survived preparation.
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, {
      policy: 'measured',
      sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH },
    });
    assert.equal(state.assertion, 'inconclusive', state.reasons);
    assert.match(state.reasons, /surviv|after|before/i, state.reasons);
    assert.notEqual(state.verdict, 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: an arbitrary equal pair is not preservation evidence', () => {
  // Arbitrary equality is exactly what "both hashes are x" expresses.
  for (const pair of [
    { expectedSha256: 'x', sha256: 'x' },
    { expectedSha256: 'abc', sha256: 'abc' },
    { expectedSha256: '', sha256: '' },
  ]) {
    const root = new TempRoot();
    try {
      const state = sidecarOf(root, { policy: 'measured', sidecar: pair });
      assert.notEqual(
        state.assertion,
        'pass',
        `sidecar ${JSON.stringify(pair)} passed without survival evidence`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T4: a malformed digest is invalid input, not a gap', () => {
  for (const digest of ['x', 'abc', '', 'z'.repeat(64), 'a'.repeat(63), 0, true, [1], {}]) {
    const root = new TempRoot();
    try {
      const state = sidecarOf(root, {
        policy: 'measured',
        sidecar: { expectedSha256: digest, sha256: digest, before: 'present', after: 'present' },
      });
      assert.equal(
        state.assertion,
        'fail',
        `sidecar digest ${JSON.stringify(digest)} was ${state.assertion}: ${state.reasons}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T4: a sidecar that changed fails', () => {
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, {
      policy: 'measured',
      sidecar: {
        expectedSha256: 'a'.repeat(64),
        sha256: 'b'.repeat(64),
        before: 'present',
        after: 'present',
      },
    });
    assert.equal(state.assertion, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: a sidecar that did not survive fails rather than passing on equal hashes', () => {
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, {
      policy: 'measured',
      sidecar: {
        expectedSha256: FIXTURE_HASH,
        sha256: FIXTURE_HASH,
        before: 'present',
        after: 'absent',
      },
    });
    assert.equal(state.assertion, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: a conflicting declared expected hash fails', () => {
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, {
      policy: 'measured',
      sidecar: {
        expectedSha256: FIXTURE_HASH,
        sha256: FIXTURE_HASH,
        before: 'present',
        after: 'present',
      },
      sidecarSha256: { expected: 'c'.repeat(64) },
    });
    assert.equal(state.assertion, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: an unrecognised policy is a gap rather than a pass', () => {
  for (const policy of ['unmeasured', 'unknown', '', 'MEASURED']) {
    const root = new TempRoot();
    try {
      const state = sidecarOf(root, {
        policy,
        sidecar: {
          expectedSha256: FIXTURE_HASH,
          sha256: FIXTURE_HASH,
          before: 'present',
          after: 'present',
        },
      });
      assert.equal(
        state.assertion,
        'inconclusive',
        `policy ${JSON.stringify(policy)} was ${state.assertion}`,
      );
    } finally {
      root.cleanup();
    }
  }
});

test('T4: an absent policy is a gap rather than a pass', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const prepare = reports['q3prepare']!;
    const identity = { ...(prepare['identity'] as Report) };
    delete identity['sidecarPolicy'];
    reports['q3prepare'] = { ...prepare, identity };
    const result = runCli(requestWith(root, reports), join(root.path, 'd.json'));
    const found = (result.decision?.['requirements'] as
      | { id: string; assertions: Record<string, string> }[]
      | undefined)?.find((entry) => entry.id === 'Q-PREP-1');
    assert.equal(found?.assertions['sidecar-unchanged'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('T4: a measured policy with no sidecar record is a gap', () => {
  const root = new TempRoot();
  try {
    const state = sidecarOf(root, { policy: 'measured' });
    assert.equal(state.assertion, 'inconclusive', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('T4: a non-object sidecar record is invalid input', () => {
  for (const sidecar of ['x', 1, true, [1]]) {
    const root = new TempRoot();
    try {
      const state = sidecarOf(root, { policy: 'measured', sidecar });
      assert.equal(
        state.assertion,
        'fail',
        `sidecar ${JSON.stringify(sidecar)} was ${state.assertion}`,
      );
    } finally {
      root.cleanup();
    }
  }
});
