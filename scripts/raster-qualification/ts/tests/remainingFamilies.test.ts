/**
 * S4 acceptance — the remaining mapped requirements.
 *
 * These cases assert that an independently recorded contradiction survives an
 * unrelated missing operand in the families migrated after display, artifacts and
 * resources, and that unsupported obligations stay explicit gaps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, TempRoot } from './helpers.js';
import { runChecks } from '../src/evidence/checks.js';
import { HOST_CHECKS } from '../src/evidence/host.js';
import type { SourceView } from '../src/decide.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

type Rec = globalThis.Record<string, unknown>;

/** The accepted-host check, taken from the declared inventory rather than rebuilt. */
const acceptedWebview = HOST_CHECKS.checks.find((check) => check.id === 'host.accepted-webview')!;
type Reports = globalThis.Record<string, Rec>;

function decide(root: TempRoot, reports: Reports, name = 'decision.json') {
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  const request = root.write('request.json', {
    contract: JSON.parse(readFileSync(realContractPath(), 'utf8')),
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    sources,
  });
  return runCli(request, join(root.path, name));
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

function withIdentity(reports: Reports, role: string, key: string, value: unknown): Reports {
  const report = reports[role]!;
  const identity = { ...(report['identity'] as Rec) };
  reports[role] = { ...report, identity: { ...identity, [key]: value } };
  return reports;
}

test('S4 local: a wrong transport fails and the value comparison still runs', () => {
  const root = new TempRoot();
  try {
    const reports = withIdentity(roleReports(), 'q2', 'transport', 'http-range');
    const result = decide(root, reports);
    const current = state(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['reads-over-proposed-local-transport'], 'fail');
    // The comparisons that do not depend on the transport are still decided.
    assert.equal(current.assertions['values-match-independent-reference'], 'pass');
    assert.match(current.reasons, /does not qualify bounded local access/);
  } finally {
    root.cleanup();
  }
});

test('S4 local: an over-limit window fails while another record is unusable', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    reports['q2'] = {
      ...q2,
      windows: [
        { classification: 'measured', window: { w: 4096, h: 4096 } },
        { classification: 'measured', window: { w: 8 } },
      ],
    };
    const result = decide(root, reports);
    const current = state(result, 'Q-LOCAL-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.match(current.reasons, /exceeds the/);
    // The unusable record now names the dimension it is missing rather than
    // reporting a single collapsed "usable size" gap.
    assert.match(current.reasons, /does not record h/);
  } finally {
    root.cleanup();
  }
});

test('S4 local: a missing transport identity is a gap, not a pass', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    const identity = { ...(q2['identity'] as Rec) };
    delete identity['transport'];
    reports['q2'] = { ...q2, identity };
    const result = decide(root, reports);
    const current = state(result, 'Q-LOCAL-1');
    assert.equal(current.assertions['reads-over-proposed-local-transport'], 'inconclusive');
    assert.match(current.reasons, /does not record which transport/);
  } finally {
    root.cleanup();
  }
});

test('S4 values: an analytic failure survives a missing validity record', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q2 = reports['q2']!;
    const assertions = (q2['assertions'] as Rec[]).map((entry) =>
      String(entry['name']).startsWith('analytic:') ? { ...entry, ok: false } : entry,
    );
    reports['q2'] = { ...q2, assertions };
    const result = decide(root, reports);
    const current = state(result, 'Q-VALUE-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['values-match-analytic-expectation'], 'fail');
  } finally {
    root.cleanup();
  }
});

test('S4 preparation: both tiling and block bounding are required', () => {
  const root = new TempRoot();
  try {
    const reports = roleReports();
    const q3 = reports['q3prepare']!;
    const assertions = (q3['assertions'] as Rec[]).map((entry) =>
      entry['name'] === 'derived-block-bounded' ? { ...entry, ok: false } : entry,
    );
    reports['q3prepare'] = { ...q3, assertions };
    const result = decide(root, reports);
    const current = state(result, 'Q-PREP-1');
    assert.equal(current.verdict, 'fail', current.reasons);
    assert.equal(current.assertions['derivative-is-tiled-and-bounded'], 'fail');
  } finally {
    root.cleanup();
  }
});

test('S4 lifecycle: a negative control cannot carry a positive capability', () => {
  const root = new TempRoot();
  try {
    // The control's rejected-cancellation record remains, but the positive scheduling
    // assertion is removed: the capability is unestablished, never inherited.
    const reports = roleReports();
    const q5 = reports['q5lifecycle']!;
    const assertions = (q5['assertions'] as Rec[]).filter(
      (entry) => entry['name'] !== 'cancellation-stops-scheduling',
    );
    reports['q5lifecycle'] = { ...q5, assertions };
    const result = decide(root, reports);
    const current = state(result, 'Q-CANCEL-1');
    assert.equal(current.verdict, 'inconclusive', current.reasons);
    assert.equal(current.assertions['unstarted-work-never-scheduled'], 'inconclusive');
    assert.equal(current.assertions['uncancelled-control-completes'], 'pass');
    assert.match(current.reasons, /no assertion cancellation-stops-scheduling/);
  } finally {
    root.cleanup();
  }
});

test('S4 lifecycle: unsupported assertions stay explicit gaps with their reasons', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, roleReports());
    const cancel = state(result, 'Q-CANCEL-1');
    assert.equal(cancel.assertions['cancellation-issued-while-work-in-flight'], 'inconclusive');
    assert.match(cancel.reasons, /slices a resident buffer/);
    const teardown = state(result, 'Q-TEARDOWN-1');
    assert.equal(teardown.assertions['teardown-observably-releases-resource'], 'inconclusive');
    assert.match(teardown.reasons, /asserted from a flag/);
    const failinj = state(result, 'Q-FAILINJ-1');
    assert.equal(failinj.assertions['disk-write-failure-exercised'], 'inconclusive');
    assert.match(failinj.reasons, /no probe injects a disk-write failure/);
    const values = state(result, 'Q-VALUE-1');
    assert.equal(values.assertions['required-fixture-classes-covered'], 'inconclusive');
    assert.match(values.reasons, /per-fixture-class coverage/);
    const members = state(result, 'Q-MEMBER-1');
    assert.equal(members.assertions['overviews-do-not-resurrect-replaced-pixels'], 'inconclusive');
    assert.match(members.reasons, /overview precedence/);
  } finally {
    root.cleanup();
  }
});

test('S4 host: the accepted-host rule is exercised at the driver level', () => {
  // The CLI cannot admit a `host` source: no role `host` has declared expectations,
  // and no producer in this checkout emits a Desktop WebView host report. The rule is
  // therefore exercised through the narrow interface, and the CLI path stays a gap.
  const hostView = (host: unknown): SourceView =>
    ({
      role: 'host',
      label: 'reports/host.json',
      status: 'present',
      digest: `sha256:${'a'.repeat(64)}`,
      shape: {
        value: { identity: host === undefined ? {} : { host } },
        problems: [],
        gaps: [],
      },
      facts: { identity: host === undefined ? {} : { host }, assertions: new Map(), failures: [], preconditions: [] },
      admission: {
        label: 'host',
        verdict: 'pass',
        sourceAdmitted: true,
        reasons: [],
        identity: {},
        positiveFailures: [],
        negativeControlFailures: [],
      },
      expectations: {} as SourceView['expectations'],
    }) as unknown as SourceView;
  const run = (host: unknown) =>
    runChecks(
      {
        requirementId: 'Q-HOST-1',
        assertions: ['observed-in-desktop-webview'],
        required: ['host.accepted-webview'],
        unsupported: new Map<string, string>(),
        checks: [acceptedWebview],
      },
      { requirementId: 'Q-HOST-1', byRole: new Map([['host', hostView(host)]]) },
    );

  assert.equal(run('desktop-webview').assertions.get('observed-in-desktop-webview'), 'pass');
  const other = run('chromium');
  assert.equal(other.assertions.get('observed-in-desktop-webview'), 'inconclusive');
  assert.match(other.gaps.join(' '), /accepted hosts: desktop-webview/);
  const absent = run(undefined);
  assert.equal(absent.assertions.get('observed-in-desktop-webview'), 'inconclusive');
  assert.match(absent.gaps.join(' '), /does not record which host/);
});

test('S4 host: without an admissible host source the requirement stays a gap', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, roleReports());
    const current = state(result, 'Q-HOST-1');
    assert.notEqual(current.verdict, 'pass');
    assert.match(current.reasons, /no host report was available|no Desktop host report was available/);
  } finally {
    root.cleanup();
  }
});

test('S4 crs and members: every assertion is decided explicitly', () => {
  const root = new TempRoot();
  try {
    const result = decide(root, roleReports());
    const crs = state(result, 'Q-CRS-1');
    assert.equal(crs.verdict, 'pass', crs.reasons);
    for (const verdict of Object.values(crs.assertions)) assert.equal(verdict, 'pass');
    const members = state(result, 'Q-MEMBER-1');
    assert.equal(members.assertions['window-spanning-members-resolves'], 'pass');
    assert.equal(members.assertions['overviews-do-not-resurrect-replaced-pixels'], 'inconclusive');
  } finally {
    root.cleanup();
  }
});
