/**
 * The five counterexamples the review at `3a7ec9eb` recorded.
 *
 * These are additions to the regression coverage, not replacement acceptance
 * criteria. Each starts from a control that establishes the contract and then
 * perturbs one input, so a result cannot be explained by an unrelated gap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import {
  NOW,
  roleReports,
  realContractPath,
  SOURCE_ROLES,
  SUPPORTED_REQUIREMENTS,
  UNSUPPORTED_ASSERTIONS,
} from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

/** Build a request over the whole contract, with one role optionally replaced. */
function wholeContractRequest(
  root: TempRoot,
  overrides: { reports?: Record<string, Record<string, unknown>>; omit?: readonly string[] } = {},
): string {
  const reports = overrides.reports ?? roleReports();
  const omitted = new Set(overrides.omit ?? []);
  const sources = SOURCE_ROLES.filter((role) => !omitted.has(role)).map((role) => {
    const reportPath = root.write(`reports/${role}.json`, reports[role]!);
    const hostRole = role;
    return { role: hostRole, path: reportPath };
  });
  return root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
}

/**
 * Every requirement whose evidence a probe actually produces must be reachable.
 *
 * The control is per requirement rather than whole-contract, because six
 * requirements have no producer at all and must stay gaps. Asserting a whole-
 * contract pass would either be false or would require fabricating observations.
 */
test('control: every supported requirement passes on coherent evidence', () => {
  const root = new TempRoot();
  try {
    const requestPath = wholeContractRequest(root);
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    const requirements = result.decision?.['requirements'] as
      | { id: string; verdict: string; reasons: string[] }[]
      | undefined;
    assert.ok(requirements !== undefined);
    for (const id of SUPPORTED_REQUIREMENTS) {
      const found: { id: string; verdict: string; reasons: string[] } | undefined =
        requirements.find((candidate) => candidate.id === id);
      assert.equal(found?.verdict, 'pass', `${id}: ${found?.reasons.join('; ')}`);
    }
  } finally {
    root.cleanup();
  }
});

test('unsupported obligations are gaps, never promoted by adjacent evidence', () => {
  const root = new TempRoot();
  try {
    const requestPath = wholeContractRequest(root);
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    const requirements = result.decision?.['requirements'] as
      | { id: string; verdict: string; assertions: Record<string, string> }[]
      | undefined;
    assert.ok(requirements !== undefined);
    for (const [assertion, requirementId] of UNSUPPORTED_ASSERTIONS) {
      const found: { id: string; assertions: Record<string, string> } | undefined =
        requirements.find((candidate) => candidate.id === requirementId);
      assert.equal(
        found?.assertions[assertion],
        'inconclusive',
        `${assertion} was promoted without a producer`,
      );
    }
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('counterexample 1: admission labels alone cannot qualify', () => {
  // The old control supplied a bundle of requirement ids, provenance-looking
  // labels and an assertions map, with no reports behind it. There is no bundle
  // input here at all, so the equivalent attack is a request that names sources
  // which do not exist while claiming everything else is present.
  const root = new TempRoot();
  try {
    const requestPath = root.write('request.json', {
      contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources: SOURCE_ROLES.map((role) => ({
        role,
        path: join(root.path, 'never-written', `${role}.json`),
      })),
    });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.notEqual(result.status, 0);
    assert.notEqual(result.decision?.['verdict'], 'pass');
    assert.equal(result.decision?.['verdict'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});

test('counterexample 2: an admission failure is recomputed, never read back', () => {
  // A serialized bundle could previously claim `sourceAdmitted: true` beside a
  // failing admission and all-passing labels. There is no way to assert that here:
  // the decision is recomputed from source bytes, and a report that actually
  // failed its own run fails its requirement.
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q2'] = {
      ...reports['q2']!,
      result: 'fail',
      failures: ['the transport aborted'],
    };
    const requestPath = wholeContractRequest(root, { reports });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 1);
    assert.equal(result.decision?.['verdict'], 'fail');
  } finally {
    root.cleanup();
  }
});

test('counterexample 3a: a non-finite bundle timestamp is an input diagnostic', () => {
  const root = new TempRoot();
  try {
    const requestPath = root.writeRaw('request.json', '{"now": NaN, "sources": []}');
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /Traceback|at Object\./);
    assert.match(result.stderr, /finite JSON number|evaluation time/);
    // The refusal is recorded at the writable destination, explicitly labelled so it
    // cannot be mistaken for a decision.
    assert.equal(result.decision?.['kind'], 'rejected-input');
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('counterexample 3b: a list-valued observed field is a diagnostic, not a crash', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q2'] = { ...reports['q2']!, observed: ['bad'] };
    const requestPath = wholeContractRequest(root, { reports });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    assert.doesNotMatch(result.stderr, /TypeError|AttributeError/);
    assert.notEqual(result.decision?.['verdict'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('counterexample 4: two incomplete runs do not combine into a complete one', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q6 = reports['q6resources']!;
    const measurements = (q6['measurements'] as Record<string, unknown>[]);
    const candidate = measurements[0]!;
    const reference = measurements[1]!;
    const first: Record<string, unknown> = { ...candidate };
    const second: Record<string, unknown> = { ...candidate };
    delete first['queueDepth'];
    delete second['activeReads'];
    reports['q6resources'] = { ...q6, measurements: [first, second, reference] };
    const requestPath = wholeContractRequest(root, { reports });
    const result = runCli(requestPath, join(root.path, 'decision.json'));
    const requirements = result.decision?.['requirements'] as
      | { id: string; verdict: string; reasons: string[] }[]
      | undefined;
    const resources = requirements?.find((entry) => entry.id === 'Q-RES-1');
    assert.equal(resources?.verdict, 'inconclusive', resources?.reasons.join(' '));
    assert.match(resources?.reasons.join(' ') ?? '', /incomplete/);
  } finally {
    root.cleanup();
  }
});

test('counterexample 5: a coarse run fails sampling regardless of ordering', () => {
  for (const [label, first, second] of [
    ['100 ms then 900 ms', 100, 900],
    ['900 ms then 100 ms', 900, 100],
  ] as const) {
    const root = new TempRoot();
    try {
      const reports = roleReports();
      const q6 = reports['q6resources']!;
      const measurements = (q6['measurements'] as Record<string, unknown>[]);
      const candidate = measurements[0]!;
      const reference = measurements[1]!;
      reports['q6resources'] = {
        ...q6,
        measurements: [
          { ...candidate, sampleIntervalMs: first },
          { ...candidate, sampleIntervalMs: second },
          reference,
        ],
      };
      const requestPath = wholeContractRequest(root, { reports });
      const result = runCli(requestPath, join(root.path, 'decision.json'));
      const requirements = result.decision?.['requirements'] as
        | { id: string; verdict: string; reasons: string[] }[]
        | undefined;
      const resources = requirements?.find((entry) => entry.id === 'Q-RES-1');
      assert.equal(resources?.verdict, 'fail', `${label}: ${resources?.reasons.join(' ')}`);
      assert.match(resources?.reasons.join(' ') ?? '', /900 ms/, label);
    } finally {
      root.cleanup();
    }
  }
});
