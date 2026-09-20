/**
 * The pilot launcher's terminal behaviour.
 *
 * These cases drive the real launcher with a scripted environment: the build, host and
 * evaluator are external boundaries, so they are replaced here, while the launcher's
 * own decisions — the owned run root, what it publishes, how it classifies cleanups,
 * and which exit code it returns — are the real code.
 *
 * The evaluator boundary in these tests reproduces what the real CLI publishes,
 * including a decision whose evidence cites this run's reports, so the launcher's
 * correspondence check is exercised rather than bypassed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EXIT_COMPLETED,
  EXIT_INSTRUMENT,
  EXIT_MEASUREMENT,
  runPilot,
  type BuildOutcome,
  type HostOutcome,
  type PilotEnvironment,
  type PilotRequest,
} from '../src/pilot/launcher.js';
import { PILOT_WINDOWS } from '../src/pilot/plan.js';
import { TempRoot } from './helpers.js';

const NOW = 1_760_000_000;
const FIXTURE = { name: 'plane-cog.tif', sha256: 'f'.repeat(64), bytes: 16_778_048, path: '/owned/fixture/plane-cog.tif' };
/** The launcher's own declared plan: the fake host must answer exactly these. */
const WINDOWS = PILOT_WINDOWS;

function planeValue(column: number, row: number): number {
  return (column === 100 && row === 100) || (column === 1024 && row === 1024) ? -9999 : column - row;
}

function observedWindow(window: { id: string; x: number; y: number; w: number; h: number }): Record<string, unknown> {
  const values: number[] = [];
  for (let row = 0; row < window.h; row += 1) {
    for (let column = 0; column < window.w; column += 1) values.push(planeValue(window.x + column, window.y + row));
  }
  return { ...window, nodata: -9999, values };
}

function hostEvidence(windows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const entries: Record<string, unknown>[] = [
    { fixture: 'plane', label: 'reference', request_id: 'preflight-hash', offset: 0, requested: FIXTURE.bytes, returned: FIXTURE.bytes, outcome: 'ok' },
    { fixture: 'plane', label: 'candidate', request_id: 'w0', offset: 0, requested: 65_536, returned: 65_536, outcome: 'ok' },
  ];
  const refusals = ['r0', 'r1', 'r2', 'r3'].map((requestId, index) => {
    const expected = ['too-large', 'zero-length', 'out-of-range', 'unknown-handle'][index] ?? 'unknown';
    entries.push({ fixture: 'plane', label: 'candidate', request_id: requestId, offset: 0, requested: 1, returned: 0, outcome: expected });
    return { id: ['whole-artifact', 'zero-length', 'past-end', 'unknown-handle'][index], requestId, expected, observed: expected, ok: true };
  });
  return {
    run: '', // replaced by the fake environment with the launcher's own run id
    nativeLedger: {
      entries,
      candidate_bytes: 65_536,
      reference_bytes: FIXTURE.bytes,
      candidate_reads: 1,
      max_read_bytes: 65_536,
    },
    bundledAssets: [
      {
        path: 'main.js',
        found: true,
        expected_sha256: 'b'.repeat(64),
        expected_bytes: 2_077,
        embedded_sha256: 'b'.repeat(64),
        embedded_bytes: 2_077,
        matches: true,
      },
    ],
    handlesRevoked: 1,
    webviewOrigin: 'tauri://localhost',
    evidence: {
      windows,
      counters: { headerRequests: 1, tileRequests: 0, totalBytes: 65_536, largestRequest: 65_536, readFailures: [] },
      refusals,
    },
  };
}

/** A decision document whose evidence cites the exact reports this run published. */
function decisionFor(runDir: string, verdicts: Record<string, string>): Record<string, unknown> {
  const digest = (file: string): string => {
    const text = readFileSync(join(runDir, 'reports', file), 'utf8');
    return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  };
  const requirements = Object.entries(verdicts).map(([id, verdict]) => ({
    id,
    verdict,
    reasons: verdict === 'pass' ? [] : [`${id} is ${verdict} for this test`],
    checks: [
      {
        check: `${id}.check`,
        assertion: 'assertion',
        verdict,
        satisfied: verdict === 'pass',
        evidence: [
          { role: id === 'Q-HOST-1' ? 'host' : 'q2', field: 'assertions', digest: digest(id === 'Q-HOST-1' ? 'host.json' : 'q2-numeric.json') },
        ],
        failures: [],
        gaps: [],
      },
    ],
  }));
  return {
    version: 2,
    profile: 'desktop-local',
    verdict: Object.values(verdicts).includes('fail') ? 'fail' : 'inconclusive',
    synthetic: false,
    internalDefects: [],
    requirements,
  };
}

interface Script {
  readonly build?: Partial<BuildOutcome>;
  readonly evidence?: Record<string, unknown> | undefined;
  readonly hostProblems?: readonly string[];
  readonly evaluate?: (request: { readonly out: string; readonly reportsPath: string }) =>
    | {
        readonly verdicts?: Record<string, string>;
        /** A decision document to publish verbatim instead of a generated one. */
        readonly decision?: Record<string, unknown>;
        readonly problems?: readonly string[];
        readonly exitCode?: number;
      }
    | undefined;
  readonly displayProblems?: readonly string[];
  readonly cleanupProblems?: readonly string[];
}

function environment(script: Script, runDir: string, observed: { aborted: boolean; released: number }): PilotEnvironment {
  return {
    async build(): Promise<BuildOutcome> {
      return {
        ok: script.build?.ok ?? true,
        problems: script.build?.problems ?? [],
        hostBinary: script.build?.hostBinary ?? '/owned/host',
        fixture: script.build?.fixture ?? FIXTURE,
        engine: script.build?.engine ?? { name: 'whitebox-wasm', version: '0.5.1' },
        frontendDigests: script.build?.frontendDigests ?? [{ path: 'main.js', sha256: 'b'.repeat(64), bytes: 2_077 }],
        runtime: script.build?.runtime ?? { os: 'Linux test', webkit: '2.52.6', tauri: '2.10.3' },
      };
    },
    async display() {
      if (script.displayProblems !== undefined) return { ok: false, problems: script.displayProblems };
      return {
        ok: true,
        problems: [],
        detail: 'local X11 relay /tmp/test/X0',
        release: () => {
          observed.released += 1;
          return { ok: (script.cleanupProblems ?? []).length === 0, problems: script.cleanupProblems ?? [] };
        },
      };
    },
    async runHost(): Promise<HostOutcome> {
      const evidence = script.evidence;
      if (evidence === undefined) return { ok: false, problems: script.hostProblems ?? ['the host exited without evidence'] };
      if (typeof evidence['run'] === 'string' && evidence['run'] === '') {
        evidence['run'] = readRunId(join(runDir, 'run-spec.json'));
      }
      return { ok: true, problems: [], evidence, evidenceDigest: 'sha256:host-evidence' };
    },
    async evaluate(request) {
      const decided = script.evaluate?.(request);
      if (decided === undefined) return { ok: false, problems: ['no evaluator was scripted'] };
      if (decided.problems !== undefined) return { ok: false, problems: decided.problems };
      const decision = decided.decision ?? (decided.verdicts === undefined ? undefined : decisionFor(runDir, decided.verdicts));
      if (decision === undefined) return { ok: true, problems: [], exitCode: decided.exitCode ?? 2 };
      writeFileSync(request.out, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
      return { ok: true, problems: [], exitCode: decided.exitCode ?? 1, decision, decisionPath: request.out };
    },
    abort() {
      observed.aborted = true;
    },
  };
}

function readRunId(specPath: string): string {
  return (JSON.parse(readFileSync(specPath, 'utf8')) as { run: string }).run;
}

function requestFor(temp: TempRoot, runDir: string): PilotRequest {
  return {
    repoRoot: temp.path,
    runDir,
    bench: join(temp.path, 'bench'),
    buildRoot: join(temp.path, 'build'),
    networkDeny: true,
    command: 'qualification-desktop-host --run-spec <spec>',
    contractPath: join(temp.path, 'requirements.json'),
    pinsPath: join(temp.path, 'candidates.json'),
    evaluatorCli: join(temp.path, 'build/src/pilot/cli.js'),
    now: () => NOW * 1000,
  };
}

/** A complete, honest run script with the verdicts the case needs. */
function happyScript(verdicts: Record<string, string>): Script {
  return {
    evidence: hostEvidence(WINDOWS.map((window) => observedWindow(window))),
    evaluate: () => ({ verdicts }),
  };
}

test('a completed pilot exits 0 while the rest of the contract stays inconclusive', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const result = await runPilot(
      requestFor(temp, runDir),
      environment(happyScript({ 'Q-LOCAL-1': 'pass', 'Q-HOST-1': 'pass', 'Q-ART-1': 'inconclusive' }), runDir, observed),
    );
    assert.equal(
      result.exitCode,
      EXIT_COMPLETED,
      `problems=${result.problems.join('; ')} failures=${result.failures.join('; ')} gaps=${result.gaps.join('; ')}`,
    );
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.gaps, []);
    assert.equal(observed.released, 1, 'the display relay is released exactly once');
    // Every declared artifact is published, and the run summary preserves the real
    // verdicts and reasons rather than only the pilot requirements.
    for (const name of ['host-build.json', 'run-spec.json', 'fixture-manifest.json', 'native-ledger.json', 'pilot-result.json']) {
      assert.equal(existsSync(join(runDir, name)), true, `${name} must be published in the run root`);
    }
    for (const name of ['q2-numeric.json', 'host.json']) {
      assert.equal(existsSync(join(runDir, 'reports', name)), true, `${name} must be published where the evaluator reads it`);
    }
    const summary = result.summary['decision'] as Record<string, unknown>;
    assert.equal(summary['profile'], 'desktop-local');
    assert.equal(summary['verdict'], 'inconclusive');
    assert.deepEqual(
      (summary['requirements'] as readonly Record<string, unknown>[]).map((entry) => [entry['id'], entry['verdict']]),
      [['Q-LOCAL-1', 'pass'], ['Q-HOST-1', 'pass'], ['Q-ART-1', 'inconclusive']],
    );
  } finally {
    temp.cleanup();
  }
});

test('a stale evaluator decision is refused even when it reports both requirements passing', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = {
      evidence: hostEvidence(WINDOWS.map((window) => observedWindow(window))),
      evaluate: () => ({
        // A decision computed from older bytes: correct verdicts, wrong evidence.
        decision: {
          version: 2,
          profile: 'desktop-local',
          verdict: 'inconclusive',
          synthetic: false,
          internalDefects: [],
          requirements: [
            { id: 'Q-LOCAL-1', verdict: 'pass', reasons: [], checks: [{ evidence: [{ digest: 'sha256:stale' }] }] },
            { id: 'Q-HOST-1', verdict: 'pass', reasons: [], checks: [{ evidence: [{ digest: 'sha256:stale' }] }] },
          ],
        },
      }),
    };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /cites no evidence digest matching this run's q2-numeric.json/);
    assert.match(result.problems.join(' '), /cites no evidence digest matching this run's host.json/);
  } finally {
    temp.cleanup();
  }
});

test('the evaluator stopping without a decision is an instrument failure', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = {
      evidence: hostEvidence(WINDOWS.map((window) => observedWindow(window))),
      evaluate: () => ({ exitCode: 2 }),
    };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /the evaluator produced no usable decision \(exit 2\)/);
  } finally {
    temp.cleanup();
  }
});

test('a rejected-input diagnostic is not a decision', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = {
      evidence: hostEvidence(WINDOWS.map((window) => observedWindow(window))),
      evaluate: () => ({
        decision: { ...decisionFor(runDir, { 'Q-LOCAL-1': 'pass', 'Q-HOST-1': 'pass' }), kind: 'rejected-input', verdict: 'inconclusive' },
      }),
    };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /rejected-input diagnostic rather than a decision/);
  } finally {
    temp.cleanup();
  }
});

test('a measured requirement failure exits 1 and preserves the reason', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const result = await runPilot(
      requestFor(temp, runDir),
      environment(happyScript({ 'Q-LOCAL-1': 'fail', 'Q-HOST-1': 'pass' }), runDir, observed),
    );
    assert.equal(result.exitCode, EXIT_MEASUREMENT);
    assert.deepEqual(result.problems, []);
    assert.match(result.failures.join(' '), /the evaluator measured a failure in Q-LOCAL-1/);
    const summary = result.summary['decision'] as Record<string, unknown>;
    const local = (summary['requirements'] as readonly Record<string, unknown>[]).find((entry) => entry['id'] === 'Q-LOCAL-1');
    assert.deepEqual(local?.['reasons'], ['Q-LOCAL-1 is fail for this test']);
  } finally {
    temp.cleanup();
  }
});

test('a missing window is reported as an incomplete measurement, not a failure', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = {
      evidence: hostEvidence([observedWindow(WINDOWS[0] as (typeof WINDOWS)[number])]),
      evaluate: () => ({ verdicts: { 'Q-LOCAL-1': 'inconclusive', 'Q-HOST-1': 'pass' } }),
    };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_MEASUREMENT);
    assert.deepEqual(result.problems, []);
    assert.deepEqual(result.failures, []);
    assert.ok(result.gaps.some((gap) => /"mid" .* was requested but never observed/.test(gap)), result.gaps.join('; '));
    assert.equal(existsSync(join(runDir, 'decision.json')), false, 'an incomplete measurement is not evaluated');
  } finally {
    temp.cleanup();
  }
});

test('a missing build prerequisite fails before the pilot starts and claims nothing', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = {
      build: { ok: false, problems: ['cannot find the TypeScript compiler at /repo/desktop/web/node_modules/.bin/tsc'], hostBinary: '' },
      evidence: hostEvidence([]),
    };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /cannot find the TypeScript compiler/);
    assert.equal(existsSync(join(runDir, 'q2-numeric.json')), false);
    assert.equal(observed.released, 1, 'the relay is still released on the failure path');
  } finally {
    temp.cleanup();
  }
});

test('malformed host evidence is an instrument failure, and its raw document is not published as a report', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = { evidence: { run: 'pilot-from-another-run', evidence: {}, nativeLedger: { entries: [] } } };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /records run "pilot-from-another-run"/);
    assert.equal(existsSync(join(runDir, 'q2-numeric.json')), false);
    assert.equal(existsSync(join(runDir, 'pilot-result.json')), true, 'the instrument still records what happened');
  } finally {
    temp.cleanup();
  }
});

test('a cleanup failure is reported beside the original failure and never exits zero', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const script: Script = {
      ...happyScript({ 'Q-LOCAL-1': 'pass', 'Q-HOST-1': 'pass' }),
      cleanupProblems: ['the X11 relay /tmp/test/X0 was replaced by another socket, so it was left in place'],
    };
    const result = await runPilot(requestFor(temp, runDir), environment(script, runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /cleanup: the X11 relay .* was replaced/);
    assert.equal(observed.released, 1);
    const summary = result.summary as Record<string, unknown>;
    assert.equal(summary['exitCode'], EXIT_INSTRUMENT, 'the summary agrees with the returned exit code');
  } finally {
    temp.cleanup();
  }
});

test('an existing run directory is refused without modifying it', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    mkdirSync(runDir);
    writeFileSync(join(runDir, 'q2-numeric.json'), '{"result":"pass"}\n', 'utf8');
    const observed = { aborted: false, released: 0 };
    const result = await runPilot(requestFor(temp, runDir), environment(happyScript({}), runDir, observed));
    assert.equal(result.exitCode, EXIT_INSTRUMENT);
    assert.match(result.problems.join(' '), /already exists/);
    assert.deepEqual(readdirSync(runDir), ['q2-numeric.json']);
    assert.equal(readFileSync(join(runDir, 'q2-numeric.json'), 'utf8'), '{"result":"pass"}\n');
    assert.equal(observed.released, 0, 'nothing was acquired, so nothing is released');
  } finally {
    temp.cleanup();
  }
});

test('the decision summary preserves every requirement reason the evaluator recorded', async () => {
  const temp = new TempRoot();
  const runDir = join(temp.path, 'run');
  try {
    const observed = { aborted: false, released: 0 };
    const result = await runPilot(
      requestFor(temp, runDir),
      environment(happyScript({ 'Q-LOCAL-1': 'pass', 'Q-HOST-1': 'pass', 'Q-RES-1': 'inconclusive' }), runDir, observed),
    );
    assert.equal(result.exitCode, EXIT_COMPLETED);
    const summary = result.summary['decision'] as Record<string, unknown>;
    const resources = (summary['requirements'] as readonly Record<string, unknown>[]).find((entry) => entry['id'] === 'Q-RES-1');
    assert.deepEqual(resources?.['reasons'], ['Q-RES-1 is inconclusive for this test']);
  } finally {
    temp.cleanup();
  }
});

import { createHash } from 'node:crypto';
