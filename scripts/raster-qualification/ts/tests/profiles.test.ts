/**
 * Declaration profiles — explicit launcher input, never report identity.
 *
 * The cases use the real CLI and the coherent control. The `desktop-local` profile
 * adds the `host` role and its report file, so these tests also cover the publication
 * read-set for the new file and the refusal paths for an unknown or conflicting
 * profile.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, runCliArgs, TempRoot } from './helpers.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';
import { DEFAULT_PROFILE, profileDeclaration, QUALIFICATION_PROFILES } from '../src/declared/profiles.js';
import { declaredReportPaths, reportFiles } from '../src/request.js';
import { expectationsForRole } from '../src/declared/route.js';

type Rec = globalThis.Record<string, unknown>;
type Reports = globalThis.Record<string, Rec>;

const CONTRACT = JSON.parse(readFileSync(realContractPath(), 'utf8')) as unknown;

/** A host report for the Desktop profile, with the identity admission requires. */
function hostReport(host: string, options: { readonly assertions?: readonly [string, boolean][] } = {}): Rec {
  return {
    experiment: 'q-host',
    result: 'pass',
    failures: [],
    assertions: (options.assertions ?? [
      ['bundled-worker-and-asset-path-exercised', true],
      ['no-network-origin-required', true],
    ]).map(([name, ok]) => ({ name, ok })),
    fixturesTested: 0,
    identity: {
      id: 'q-host',
      experiment: 'q-host',
      runId: 'run-q-host-0001',
      recordedAt: 1_760_000_000,
      command: 'desktop-host --pilot',
      routeId: 'candidate-raster-route-v1',
      environment: 'qualification-host-desktop-local-v1',
      host,
      fixturePolicy: 'artifact-only',
      sidecarPolicy: 'not_applicable',
      transport: 'local-bridge',
      fixtures: [],
      artifact: { name: 'desktop-webview', version: 'bundled' },
    },
  };
}

function requirementState(result: ReturnType<typeof runCli>, id: string): {
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

function reportsFor(host?: Rec): Reports {
  const reports = roleReports();
  if (host !== undefined) reports['host'] = host;
  return reports;
}

function writeRequest(root: TempRoot, reports: Reports, options: { readonly profile?: unknown } = {}): string {
  const sources: { role: string; path: string }[] = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  if (reports['host'] !== undefined) {
    sources.push({ role: 'host', path: root.write('reports/host.json', reports['host']!) });
  }
  return root.write('request.json', {
    contract: CONTRACT,
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: NOW,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    sources,
  });
}

function writeDirectory(root: TempRoot, reports: Reports): string {
  const files = reportFiles('desktop-local');
  const directory = join(root.path, 'reports');
  for (const [role, file] of files) {
    const report = reports[role];
    if (report === undefined) continue;
    root.write(join('reports', file), report);
  }
  return directory;
}

test('profiles: the default profile keeps current calls compatible', () => {
  assert.equal(DEFAULT_PROFILE, 'chromium');
  assert.deepEqual([...QUALIFICATION_PROFILES], ['chromium', 'desktop-local']);
  const root = new TempRoot();
  try {
    const result = runCli(writeRequest(root, roleReports()), join(root.path, 'decision.json'));
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.decision?.['profile'], 'chromium');
    // The host role does not exist in the default profile.
    assert.equal(expectationsForRole('host'), undefined);
    assert.equal(reportFiles('chromium').has('host'), false);
  } finally {
    root.cleanup();
  }
});

test('profiles: desktop-local declares the Desktop host, environment and host role', () => {
  const declaration = profileDeclaration('desktop-local');
  assert.equal(declaration.host, 'desktop-webview');
  assert.equal(declaration.environment, 'qualification-host-desktop-local-v1');
  assert.deepEqual(declaration.acceptedHosts, ['desktop-webview']);
  const host = expectationsForRole('host', 'desktop-local');
  assert.ok(host !== undefined);
  assert.equal(host.experiment, 'q-host');
  assert.equal(host.host, 'desktop-webview');
  assert.equal(host.unpinnedEngine, true);
  assert.deepEqual(host.expectedArtifact, { name: 'desktop-webview', version: 'bundled' });
  // The candidate engine pins are untouched by the profile.
  const q2 = expectationsForRole('q2', 'desktop-local');
  assert.equal(q2?.transport, 'local-bridge');
  assert.equal(q2?.host, 'desktop-webview');
  // The candidate engine pin is untouched by the profile.
  assert.deepEqual(q2?.expectedArtifact, { name: 'whitebox-wasm', version: '0.5.1' });
  assert.deepEqual(reportFiles('desktop-local').get('host'), 'host.json');
});

test('profiles: the host file joins the publication read-set before validation', () => {
  const paths = declaredReportPaths('/reports', 'desktop-local');
  assert.ok(paths.includes('/reports/host.json'), paths.join(', '));
  assert.equal(declaredReportPaths('/reports', 'chromium').includes('/reports/host.json'), false);
});

test('profiles: a Desktop WebView host report satisfies Q-HOST-1 under the profile', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root, reportsFor(hostReport('desktop-webview')), {
      profile: 'desktop-local',
    });
    const result = runCli(request, join(root.path, 'decision.json'));
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.decision?.['profile'], 'desktop-local');
    const state = requirementState(result, 'Q-HOST-1');
    assert.equal(state.verdict, 'pass', state.reasons);
    for (const verdict of Object.values(state.assertions)) assert.equal(verdict, 'pass');
  } finally {
    root.cleanup();
  }
});

test('profiles: a Chromium host report cannot satisfy the Desktop profile', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root, reportsFor(hostReport('chromium')), {
      profile: 'desktop-local',
    });
    const result = runCli(request, join(root.path, 'decision.json'));
    assert.equal(result.status, 1, result.stderr);
    const state = requirementState(result, 'Q-HOST-1');
    assert.notEqual(state.verdict, 'pass');
    assert.match(state.reasons, /host|desktop-webview/);
  } finally {
    root.cleanup();
  }
});

test('profiles: a missing host report stays a gap under the Desktop profile', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root, roleReports(), { profile: 'desktop-local' });
    const result = runCli(request, join(root.path, 'decision.json'));
    assert.equal(result.status, 1, result.stderr);
    const state = requirementState(result, 'Q-HOST-1');
    assert.equal(state.verdict, 'inconclusive', state.reasons);
  } finally {
    root.cleanup();
  }
});

test('profiles: an unknown profile is rejected in both entry modes', () => {
  const root = new TempRoot();
  try {
    const viaFlag = runCliArgs(
      ['--reports', writeDirectory(root, reportsFor(hostReport('desktop-webview'))), '--contract', realContractPath(), '--profile', 'staging', '--out', join(root.path, 'a.json')],
      join(root.path, 'a.json'),
    );
    assert.equal(viaFlag.status, 2, viaFlag.stderr);
    assert.match(viaFlag.stderr, /unknown qualification profile "staging"/);
    // Nothing was published at the requested decision path.
    assert.equal(root.has('a.json'), false);

    const viaBody = runCli(
      writeRequest(root, roleReports(), { profile: 'desktop' }),
      join(root.path, 'b.json'),
    );
    assert.equal(viaBody.status, 2, viaBody.stderr);
    assert.match(viaBody.stderr, /unknown qualification profile "desktop"/);
  } finally {
    root.cleanup();
  }
});

test('profiles: a conflicting selection is refused rather than ordered', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root, roleReports(), { profile: 'chromium' });
    const result = runCliArgs(
      ['--request', request, '--profile', 'desktop-local', '--out', join(root.path, 'd.json')],
      join(root.path, 'd.json'),
    );
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /conflicts with the request's profile/);
    // A refused input still publishes its labelled diagnostic; it never publishes a
    // decision, so the conflict cannot be read as a verdict.
    const published = JSON.parse(readFileSync(join(root.path, 'd.json'), 'utf8')) as Rec;
    assert.equal(published['kind'], 'rejected-input');
    assert.deepEqual(published['requirements'], []);
  } finally {
    root.cleanup();
  }
});

test('profiles: directory mode selects the profile and protects host.json', () => {
  const root = new TempRoot();
  try {
    const directory = writeDirectory(root, reportsFor(hostReport('desktop-webview')));
    const out = join(directory, 'host.json');
    const before = readFileSync(out, 'utf8');
    const refused = runCliArgs(
      ['--reports', directory, '--contract', realContractPath(), '--profile', 'desktop-local', '--out', out],
      out,
    );
    assert.equal(refused.status, 2, refused.stderr);
    assert.equal(readFileSync(out, 'utf8'), before);
    assert.match(refused.stderr, /host\.json/);

    const fresh = join(root.path, 'decision.json');
    const published = runCliArgs(
      ['--reports', directory, '--contract', realContractPath(), '--profile', 'desktop-local', '--out', fresh],
      fresh,
    );
    assert.equal(published.status, 1, published.stderr);
    assert.equal((published.decision as Rec)['profile'], 'desktop-local');
    // The host requirement received the host source in this mode too.
    const state = requirementState(published, 'Q-HOST-1');
    assert.equal(state.assertions['observed-in-desktop-webview'], 'pass', state.reasons);
  } finally {
    root.cleanup();
  }
});
