/**
 * Round 2 adversarial self-review — sibling paths beyond the six families.
 *
 * Each case asks whether the same class of defect the Round 1 review found exists on
 * a path the review did not name: other declarations, other keyed collections, other
 * mappings and the other entry point.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

function decide(root: TempRoot, reports: Reports, options: { pins?: unknown; manifest?: unknown } = {}) {
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const requestPath = root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: options.manifest ?? fixtureManifest(),
    pins: options.pins ?? candidatePins(),
    now: NOW,
    sources,
  });
  return runCli(requestPath, join(root.path, 'd.json'));
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

function mutate(role: string, change: (report: Rec) => Rec): Reports {
  const reports = roleRoles();
  reports[role] = change(reports[role]!);
  return reports;
}

function roleRoles(): Reports {
  return roleReports();
}

test('sibling: a pin that names an artifact the route does not require is ignored, not credited', () => {
  const root = new TempRoot();
  try {
    const pins = { ...candidatePins(), 'unrelated-engine': 'f'.repeat(40) };
    const state = requirement(decide(root, roleRoles(), { pins }), 'Q-ART-1');
    // An extra pin is not an error on its own, but it must not let the required
    // artifacts go uncovered either.
    assert.equal(state.verdict, 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: a pin declaration with an empty revision is a gap, not a pass', () => {
  const root = new TempRoot();
  try {
    const pins = { ...candidatePins(), 'whitebox-wasm': '' };
    const state = requirement(decide(root, roleRoles(), { pins }), 'Q-ART-1');
    assert.notEqual(state.verdict, 'pass', 'an empty pin was accepted');
  } finally {
    root.cleanup();
  }
});

test('sibling: a conflicting licence record for one artifact fails its assertion', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q1', (report) => ({
      ...report,
      assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
        entry.name === 'license-recorded:cog-tiler-wasm' ? { ...entry, ok: false } : entry,
      ),
    }));
    const state = requirement(decide(root, reports), 'Q-ART-1');
    assert.equal(state.assertions['artifacts-record-license'], 'fail', state.reasons);
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: an undeclared fixture is a failure even when every required one is covered', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q2', (report) => ({
      ...report,
      identity: {
        ...(report['identity'] as Rec),
        fixtures: [{ name: 'derived_cog', sha256: 'a'.repeat(64) }, { name: 'extra', sha256: 'c'.repeat(64) }],
      },
      fixturesTested: 2,
    }));
    const state = requirement(decide(root, reports), 'Q-LOCAL-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /undeclared fixture/);
  } finally {
    root.cleanup();
  }
});

test('sibling: a measured fixture whose count disagrees fails rather than passing', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q2', (report) => ({ ...report, fixturesTested: 7 }));
    const state = requirement(decide(root, reports), 'Q-LOCAL-1');
    assert.equal(state.verdict, 'fail', state.reasons);
    assert.match(state.reasons, /fixturesTested/);
  } finally {
    root.cleanup();
  }
});

test('sibling: an over-limit active-reads value fails on any sampled run, not only the first', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q6resources', (report) => {
      const measurements = report['measurements'] as Rec[];
      return {
        ...report,
        measurements: [measurements[0]!, { ...measurements[0]!, activeReads: 9 }, measurements[1]!],
      };
    });
    const state = requirement(decide(root, reports), 'Q-RES-1');
    assert.equal(
      state.assertions['disk-cache-reads-queue-and-children-recorded'],
      'fail',
      state.reasons,
    );
  } finally {
    root.cleanup();
  }
});

test('sibling: a fractional counter fails rather than being truncated', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q6resources', (report) => {
      const measurements = report['measurements'] as Rec[];
      return {
        ...report,
        measurements: [{ ...measurements[0]!, activeReads: 1.5 }, measurements[1]!],
      };
    });
    const state = requirement(decide(root, reports), 'Q-RES-1');
    assert.equal(
      state.assertions['disk-cache-reads-queue-and-children-recorded'],
      'fail',
      state.reasons,
    );
  } finally {
    root.cleanup();
  }
});

test('sibling: a display run with a page error fails rendering', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('trace', (report) => ({
      ...report,
      runs: (report['runs'] as Rec[]).map((run, index) =>
        index === 0 ? { ...run, pageErrors: ['TypeError: undefined is not a function'] } : run,
      ),
    }));
    const state = requirement(decide(root, reports), 'Q-DISPLAY-1');
    assert.equal(state.assertions['runs-report-successful-rendering'], 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: a display run that records fewer renders than requests fails', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('trace', (report) => ({
      ...report,
      runs: (report['runs'] as Rec[]).map((run, index) =>
        index === 0 ? { ...run, tilesRendered: 100, tileRequests: 128, failedTiles: 0 } : run,
      ),
    }));
    const state = requirement(decide(root, reports), 'Q-DISPLAY-1');
    assert.equal(state.assertions['runs-report-successful-rendering'], 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: a CRS assertion that fails fails the requirement', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q4crs', (report) => ({
      ...report,
      assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
        entry.name === 'candidate-projection-matches-reference' ? { ...entry, ok: false } : entry,
      ),
    }));
    const state = requirement(decide(root, reports), 'Q-CRS-1');
    assert.equal(state.verdict, 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: a preparation metadata failure fails its assertion', () => {
  const root = new TempRoot();
  try {
    const reports = mutate('q3prepare', (report) => ({
      ...report,
      assertions: (report['assertions'] as { name: string; ok: boolean }[]).map((entry) =>
        entry.name === 'geotransform-preserved' ? { ...entry, ok: false } : entry,
      ),
    }));
    const state = requirement(decide(root, reports), 'Q-PREP-1');
    assert.equal(state.assertions['derivative-preserves-metadata'], 'fail', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: an unsupported assertion stays a gap even when its requirement otherwise passes', () => {
  const root = new TempRoot();
  try {
    const state = requirement(decide(root, roleRoles()), 'Q-MEMBER-1');
    assert.equal(
      state.assertions['overviews-do-not-resurrect-replaced-pixels'],
      'inconclusive',
    );
    assert.equal(state.verdict, 'inconclusive', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('sibling: a negative pin declaration is refused rather than ignored', () => {
  for (const pins of [null, [], 'x', 7]) {
    const root = new TempRoot();
    try {
      const result = decide(root, roleRoles(), { pins });
      assert.notEqual(
        result.decision?.['verdict'],
        'pass',
        `pins ${JSON.stringify(pins)} were accepted`,
      );
    } finally {
      root.cleanup();
    }
  }
});
