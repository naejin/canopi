/**
 * S3 acceptance — artifact correspondence and route resources.
 *
 * Every case starts from the coherent control, perturbs one relationship, and
 * asserts the target assertion, the requirement verdict and an identifying reason.
 * The expectations are derived from the contract and the retained Python rules, not
 * from the TypeScript check list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest, PIN_WHITEBOX } from './fixtures.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

function request(root: TempRoot, reports: Reports): string {
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
  return runCli(request(root, reports), join(root.path, 'decision.json'));
}

function state(result: ReturnType<typeof runCli>, id: string): {
  readonly verdict: string | undefined;
  readonly assertions: globalThis.Record<string, string>;
  readonly reasons: string;
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

function withQ1(mutate: (q1: Rec) => Rec, base?: Reports): Reports {
  const reports = base ?? roleReports();
  reports['q1'] = mutate(reports['q1']!);
  return reports;
}

// --------------------------------------------------------------------------
// Artifact correspondence
// --------------------------------------------------------------------------

test('S3 artifact: a wrong version is compared even when another artifact is missing', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((q1) => ({
      ...q1,
      verifiedArtifacts: [
        { ...(q1['verifiedArtifacts'] as Rec[])[0]!, version: '999' },
      ],
    }));
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['qualified-roles-name-artifact-version'], 'fail');
    assert.match(current.reasons, /was verified at version "999"/);
    assert.match(current.reasons, /no bench-verified version is recorded for cog-tiler-wasm/);
  } finally {
    root.cleanup();
  }
});

test('S3 artifact: a present wrong pin fails even when the built revision is missing', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((q1) => ({
      ...q1,
      sourceCorrespondence: (q1['sourceCorrespondence'] as Rec[]).map((entry, index) => {
        if (index !== 0) return entry;
        const copy: Rec = { ...entry, pinnedRevision: '0'.repeat(40) };
        delete copy['artifactRevision'];
        return copy;
      }),
    }));
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /correspondence was recorded against pin/);
  } finally {
    root.cleanup();
  }
});

test('S3 artifact: a missing claimed pin is a gap about that comparison only', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((q1) => ({
      ...q1,
      sourceCorrespondence: (q1['sourceCorrespondence'] as Rec[]).map((entry, index) => {
        if (index !== 0) return entry;
        const copy: Rec = { ...entry };
        delete copy['pinnedRevision'];
        return copy;
      }),
    }));
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.equal(current.assertions['qualified-roles-name-artifact-version'], 'inconclusive');
    assert.match(current.reasons, /does not record the pin it was checked against/);
    assert.doesNotMatch(current.reasons, /correspondence was recorded against pin/);
  } finally {
    root.cleanup();
  }
});

/** A complete reproducible-build replacement for one artifact. */
function buildReplacement(q1: Rec, digest: string, revision: string): Rec {
  const verified = (q1['verifiedArtifacts'] as Rec[]).map((entry, index) =>
    index === 0 ? { ...entry, sha256: digest } : entry,
  );
  const correspondence = (q1['sourceCorrespondence'] as Rec[]).map((entry, index) =>
    index === 0
      ? {
          ...entry,
          artifactRevision: revision,
          sourceRevision: PIN_WHITEBOX,
          buildReproduced: true,
          builtArtifact: { name: 'whitebox-wasm', version: '0.5.1', sha256: digest },
          buildEvidence: { command: 'cargo build --target wasm32-unknown-unknown', sha256: digest },
        }
      : entry,
  );
  return { ...q1, verifiedArtifacts: verified, sourceCorrespondence: correspondence };
}

const BUILD_DIGEST = 'c'.repeat(64);

test('S3 artifact: a fully evidenced pinned replacement explains a published mismatch', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q1'] = buildReplacement(reports['q1']!, BUILD_DIGEST, 'd'.repeat(40));
    for (const role of ['q2', 'q5lifecycle', 'q6resources']) {
      const report = reports[role]!;
      const identity = { ...(report['identity'] as Rec) };
      reports[role] = {
        ...report,
        identity: { ...identity, artifact: { name: 'whitebox-wasm', version: '0.5.1', sha256: BUILD_DIGEST } },
      };
    }
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.equal(current.assertions['qualified-roles-name-artifact-version'], 'pass', current.reasons);
    assert.equal(current.verdict, 'pass', current.reasons);
  } finally {
    root.cleanup();
  }
});

test('S3 artifact: a replacement whose consuming digest disagrees fails the chain', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    reports['q1'] = buildReplacement(reports['q1']!, BUILD_DIGEST, 'd'.repeat(40));
    for (const role of ['q2', 'q5lifecycle', 'q6resources']) {
      const report = reports[role]!;
      const identity = { ...(report['identity'] as Rec) };
      const sha256 = role === 'q6resources' ? 'e'.repeat(64) : BUILD_DIGEST;
      reports[role] = {
        ...report,
        identity: { ...identity, artifact: { name: 'whitebox-wasm', version: '0.5.1', sha256 } },
      };
    }
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /digest/);
  } finally {
    root.cleanup();
  }
});

test('S3 artifact: a boolean-only reproduction claim cannot excuse a mismatch', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((q1) => ({
      ...q1,
      sourceCorrespondence: (q1['sourceCorrespondence'] as Rec[]).map((entry, index) =>
        index === 0
          ? { ...entry, artifactRevision: 'd'.repeat(40), buildReproduced: true }
          : entry,
      ),
    }));
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /build/);
  } finally {
    root.cleanup();
  }
});

test('S3 artifact: a missing correspondence record is a gap, never a pass', () => {
  const root = new TempRoot();
  try {
    const reports = withQ1((q1) => ({
      ...q1,
      sourceCorrespondence: (q1['sourceCorrespondence'] as Rec[]).slice(1),
    }));
    const result = decide(root, reports);
    const current = state(result, 'Q-ART-1');
    assert.notEqual(current.verdict, 'pass');
    assert.notEqual(current.assertions['non-corresponding-artifacts-recorded'], 'pass');
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// Route resources
// --------------------------------------------------------------------------

function withResources(mutate: (measurements: Rec[]) => Rec[], base?: Reports): Reports {
  const reports = base ?? roleReports();
  const resources = reports['q6resources']!;
  reports['q6resources'] = {
    ...resources,
    measurements: mutate(resources['measurements'] as Rec[]),
  };
  return reports;
}

test('S3 resources: removing a role label cannot create a separated-reference pass', () => {
  const root = new TempRoot();
  try {
    const labelled = withResources((rows) => rows.filter((row) => row['routeRole'] === 'candidate'));
    const first = decide(root, labelled);
    assert.equal(
      state(first, 'Q-RES-1').assertions['reference-measurements-labelled-separately'],
      'inconclusive',
      state(first, 'Q-RES-1').reasons,
    );
  } finally {
    root.cleanup();
  }

  const root2 = new TempRoot();
  try {
    const unlabelled = withResources((rows) =>
      rows
        .filter((row) => row['routeRole'] === 'candidate')
        .map((row) => {
          const copy: Rec = { ...row };
          delete copy['routeRole'];
          return copy;
        }),
    );
    const result = decide(root2, unlabelled);
    const current = state(result, 'Q-RES-1');
    assert.equal(current.assertions['reference-measurements-labelled-separately'], 'inconclusive');
    assert.match(current.reasons, /no route role|role/);
  } finally {
    root2.cleanup();
  }
});

test('S3 resources: an invalid role label fails rather than becoming a reference', () => {
  const root = new TempRoot();
  try {
    const reports = withResources((rows) =>
      rows.map((row, index) => (index === 0 ? { ...row, routeRole: 'other' } : row)),
    );
    const result = decide(root, reports);
    const current = state(result, 'Q-RES-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /role/);
  } finally {
    root.cleanup();
  }
});

test('S3 resources: a candidate record that describes the reference route fails', () => {
  const root = new TempRoot();
  try {
    const reports = withResources((rows) =>
      rows.map((row, index) =>
        index === 0
          ? { ...row, route: 'reference reader (native byte-range, NOT the candidate route)' }
          : row,
      ),
    );
    const result = decide(root, reports);
    const current = state(result, 'Q-RES-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /reference route/);
  } finally {
    root.cleanup();
  }
});

test('S3 resources: reference memory never substitutes for a missing candidate reading', () => {
  const root = new TempRoot();
  try {
    const reports = withResources((rows) =>
      rows.map((row, index) => {
        if (index !== 0) return row;
        const copy: Rec = { ...row };
        delete copy['incrementalPeakRssMiB'];
        return copy;
      }),
    );
    const result = decide(root, reports);
    const current = state(result, 'Q-RES-1');
    assert.equal(current.assertions['candidate-memory-within-budget'], 'inconclusive');
    assert.match(current.reasons, /incremental memory|memory/i);
  } finally {
    root.cleanup();
  }
});

test('S3 resources: an over-budget counter survives a malformed sibling record', () => {
  const root = new TempRoot();
  try {
    const reports = withResources((rows) => [
      { ...rows[0]!, decodedCacheBytes: 512 * 1024 * 1024 },
      { ...rows[1]!, sampleIntervalMs: 100, sampleCount: 'many' },
    ]);
    const result = decide(root, reports);
    const current = state(result, 'Q-RES-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /decoded cache/);
  } finally {
    root.cleanup();
  }
});

test('S3 resources: the plan bound with no producer observation stays a stated gap', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, roleReports());
    const current = state(result, 'Q-RES-1');
    assert.notEqual(current.verdict, 'pass');
    assert.match(current.reasons, /512 MiB/);
    assert.match(current.reasons, /staging and free-space policy/);
  } finally {
    root.cleanup();
  }
});
