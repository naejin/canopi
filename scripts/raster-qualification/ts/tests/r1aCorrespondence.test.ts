/**
 * R1-A — declaration correspondence.
 *
 * A correspondence record is only evidence if it is compared against a declaration
 * the report does not own. Comparing the record's two revision strings with each
 * other accepts any self-consistent pair, and ignoring the version lets a record for
 * an unrelated version stand in for the required artifact.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, PIN_COG_TILER, PIN_WHITEBOX } from './fixtures.js';

type Record_ = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Record_>;

function request(
  root: TempRoot,
  reports: Reports,
  options: { pins?: unknown; omitPins?: boolean; manifest?: unknown } = {},
): string {
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const body: globalThis.Record<string, unknown> = {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: options.manifest ?? fixtureManifest(),
    now: NOW,
    sources,
  };
  if (options.omitPins !== true) body['pins'] = options.pins ?? candidatePins();
  return root.write('request.json', body);
}

function decide(
  root: TempRoot,
  reports: Reports,
  options: { pins?: unknown; omitPins?: boolean; manifest?: unknown } = {},
) {
  return runCli(request(root, reports, options), join(root.path, 'd.json'));
}

function art(result: ReturnType<typeof runCli>): {
  verdict: string | undefined;
  assertions: globalThis.Record<string, string>;
  reasons: string;
} {
  const found = (result.decision?.['requirements'] as
    | { id: string; verdict: string; assertions: globalThis.Record<string, string>; reasons: string[] }[]
    | undefined)?.find((entry) => entry.id === 'Q-ART-1');
  return {
    verdict: found?.verdict,
    assertions: found?.assertions ?? {},
    reasons: found?.reasons.join(' ') ?? '',
  };
}

function withQ1(mutate: (report: Record_) => Record_): Reports {
  const reports = roleReports();
  reports['q1'] = mutate(reports['q1']!);
  return reports;
}

function correspondenceOf(report: Record_): Record_[] {
  return (report['sourceCorrespondence'] as Record_[]).map((entry) => ({ ...entry }));
}

test('R1-A control: declared pins verify a matching correspondence', () => {
  const root = new TempRoot();
  try {
    const state = art(decide(root, roleReports()));
    assert.equal(state.verdict, 'pass', state.reasons);
    assert.equal(state.assertions['qualified-roles-name-artifact-version'], 'pass');
  } finally {
    root.cleanup();
  }
});

test('R1-A: omitting the pin declaration blocks correspondence rather than passing', () => {
  const root = new TempRoot();
  try {
    const state = art(decide(root, roleReports(), { omitPins: true }));
    assert.notEqual(state.verdict, 'pass', 'correspondence passed with no declared pins');
    assert.match(state.reasons, /pin/i, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a self-consistent but undeclared revision pair fails', () => {
  // The record's two own strings agree with each other; neither is the declaration.
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      sourceCorrespondence: correspondenceOf(report).map((entry) => ({
        ...entry,
        pinnedRevision: '0'.repeat(40),
        artifactRevision: '0'.repeat(40),
        matches: true,
      })),
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, new RegExp(PIN_WHITEBOX.slice(0, 8)), state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a correspondence version that is not the required one fails', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      sourceCorrespondence: correspondenceOf(report).map((entry, index) =>
        index === 0 ? { ...entry, version: '999' } : entry,
      ),
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /999/, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a record for an artifact the route does not require fails', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      sourceCorrespondence: [
        ...correspondenceOf(report),
        {
          artifact: 'unrelated-engine',
          version: '1.0.0',
          pinnedRevision: PIN_WHITEBOX,
          artifactRevision: PIN_WHITEBOX,
          matches: true,
        },
      ],
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /unrelated-engine/, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a missing correspondence record for a required artifact is a gap', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      sourceCorrespondence: correspondenceOf(report).filter(
        (entry) => entry['artifact'] !== 'cog-tiler-wasm',
      ),
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'inconclusive', state.reasons);
    assert.match(state.reasons, /cog-tiler-wasm/, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a wrong-version duplicate in verifiedArtifacts fails rather than being ignored', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      verifiedArtifacts: [
        { name: 'whitebox-wasm', version: '0.0.1' },
        ...(report['verifiedArtifacts'] as Record_[]),
      ],
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /more than once|ambiguous/i, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: both revisions agreeing with each other is not pin verification', () => {
  // Each artifact's two own revision strings agree, so the revision comparison is
  // satisfied — but they name the *other* artifact's declared pin. Only a comparison
  // against the declaration itself can detect that, which is why this case isolates
  // the pin check rather than the self-consistency check.
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      sourceCorrespondence: correspondenceOf(report).map((entry) => {
        const wrong = entry['artifact'] === 'whitebox-wasm' ? PIN_COG_TILER : 'f'.repeat(40);
        return { ...entry, pinnedRevision: wrong, artifactRevision: wrong, matches: true };
      }),
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /declaration pins/i, state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a boolean claim cannot excuse revisions that disagree with the pin', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((report) => ({
      ...report,
      sourceCorrespondence: correspondenceOf(report).map((entry, index) =>
        index === 0
          ? { ...entry, artifactRevision: 'deadbeef', matches: true }
          : entry,
      ),
    }));
    const state = art(decide(root, reports));
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('R1-A: a malformed correspondence entry fails rather than being skipped', () => {
  for (const entry of ['x', 7, true, [1]]) {
    const root = new TempRoot();
    try {
      const reports = withQ1((report) => ({
        ...report,
        sourceCorrespondence: [entry, ...correspondenceOf(report)],
      }));
      const state = art(decide(root, reports));
      assert.notEqual(
        state.verdict,
        'pass',
        `correspondence entry ${JSON.stringify(entry)} was accepted`,
      );
    } finally {
      root.cleanup();
    }
  }
});
