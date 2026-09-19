/**
 * D3 — publication that never overwrites.
 *
 * Every case starts from the coherent control in `contractFixture` and perturbs one
 * thing: the destination, the request body, or the read-set. The observable
 * requirements are that existing bytes are never replaced, that only complete
 * newly-owned documents appear, and that no defect can end with exit zero.
 *
 * Domain cases go through the real emitted CLI. Publication itself is also driven
 * directly for the cases a single process cannot stage, such as a genuine creation
 * race.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runCli, runCliArgs, TempRoot } from './helpers.js';
import { publish, publicationFaultInjection } from '../src/publication.js';
import { NOW, roleReports, realContractPath, SOURCE_ROLES } from './contractFixture.js';
import { candidatePins, fixtureManifest } from './fixtures.js';

const runAsync = promisify(execFile);

/** The report file each role is written as, in the runner's own naming. */
const REPORT_FILES: readonly (readonly [string, string])[] = [
  ['q1', 'q1-artifacts.json'],
  ['q2', 'q2-numeric.json'],
  ['q3prepare', 'q3-prepare.json'],
  ['q3members', 'q3-members.json'],
  ['q4slope', 'q4-slope.json'],
  ['q4crs', 'q4-crs.json'],
  ['q5lifecycle', 'q5-lifecycle.json'],
  ['q6resources', 'q6-resources.json'],
  ['trace', 'q6-trace.json'],
];

const CONTRACT = JSON.parse(readFileSync(realContractPath(), 'utf8')) as unknown;

/** Lay down a report directory, optionally omitting one declared report file. */
function writeReports(root: TempRoot, omit?: string): string {
  const reports = roleReports();
  const directory = join(root.path, 'reports');
  mkdirSync(directory, { recursive: true });
  for (const [role, file] of REPORT_FILES) {
    if (file === omit) continue;
    root.write(join('reports', file), reports[role]!);
  }
  return directory;
}

/** The coherent control as a request file, with the evaluation time optionally broken. */
function writeRequest(root: TempRoot, options: { readonly now?: unknown } = {}): string {
  const reports = roleReports();
  const sources = SOURCE_ROLES.map((role) => ({
    role,
    path: root.write(`reports/${role}.json`, reports[role]!),
  }));
  return root.write('request.json', {
    contract: CONTRACT,
    fixtureManifest: fixtureManifest(),
    pins: candidatePins(),
    now: options.now ?? NOW,
    sources,
  });
}

/** The path the CLI reported for a fallback diagnostic, when it wrote one. */
function diagnosticPath(stderr: string): string | undefined {
  const match = /non-qualifying diagnostic was written to (.+)/.exec(stderr);
  return match === null ? undefined : match[1]!.trim();
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function stagingLeftovers(directory: string): string[] {
  return readdirSync(directory).filter((entry) => entry.startsWith('.q-stage-'));
}

// --------------------------------------------------------------------------
// The control
// --------------------------------------------------------------------------

test('publication: a fresh destination receives the version-2 decision and nothing else', () => {
  const root = new TempRoot();
  try {
    const out = join(root.path, 'decision.json');
    const result = runCli(writeRequest(root), out);
    assert.equal(result.status, 1, result.stderr);
    const decision = readJson(out);
    assert.equal(decision['version'], 2);
    assert.deepEqual(decision['internalDefects'], []);
    assert.equal(decision['kind'], undefined);
    assert.equal(diagnosticPath(result.stderr), undefined);
    assert.deepEqual(stagingLeftovers(root.path), []);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// Existing paths are never replaced
// --------------------------------------------------------------------------

test('publication: an existing output is refused and left byte-identical', () => {
  const root = new TempRoot();
  try {
    const out = root.write('out.json', { keep: 'these bytes' });
    const before = readFileSync(out, 'utf8');
    const result = runCli(writeRequest(root), out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(readFileSync(out, 'utf8'), before);
    assert.match(result.stderr, /already exists/);
    const diagnostic = diagnosticPath(result.stderr);
    assert.ok(diagnostic !== undefined, result.stderr);
    const document = readJson(diagnostic);
    assert.equal(document['kind'], 'rejected-input');
    assert.equal(document['version'], 2);
    assert.deepEqual(document['requirements'], []);
    assert.deepEqual(stagingLeftovers(root.path), []);
  } finally {
    root.cleanup();
  }
});

test('publication: the decision cannot be written over one of its own sources', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root);
    const source = join(root.path, 'reports', 'q2.json');
    const before = readFileSync(source, 'utf8');
    const result = runCli(request, source);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(readFileSync(source, 'utf8'), before);
    assert.match(result.stderr, /already exists|is also an input this run reads/);
    assert.ok(diagnosticPath(result.stderr) !== undefined);
  } finally {
    root.cleanup();
  }
});

test('publication: an absent destination that is still an input is refused', () => {
  const root = new TempRoot();
  try {
    const directory = writeReports(root, 'q6-trace.json');
    const absent = join(directory, 'q6-trace.json');
    const result = runCliArgs(
      ['--reports', directory, '--contract', realContractPath(), '--out', absent],
      absent,
    );
    assert.equal(result.status, 2, result.stderr);
    assert.equal(root.has(join('reports', 'q6-trace.json')), false);
    assert.match(result.stderr, /is also an input this run reads/);
  } finally {
    root.cleanup();
  }
});

test('publication: the request file is an input and cannot be the destination', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root);
    const before = readFileSync(request, 'utf8');
    const result = runCli(request, request);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(readFileSync(request, 'utf8'), before);
    assert.match(result.stderr, /already exists|is also an input this run reads/);
  } finally {
    root.cleanup();
  }
});

test('publication: a rejected request cannot be written over a source', () => {
  const root = new TempRoot();
  try {
    const request = writeRequest(root, { now: 'invalid' });
    const source = join(root.path, 'reports', 'q3prepare.json');
    const before = readFileSync(source, 'utf8');
    const result = runCli(request, source);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(readFileSync(source, 'utf8'), before);
    assert.match(result.stderr, /already exists|is also an input this run reads/);
  } finally {
    root.cleanup();
  }
});

test('publication: a rejected request with a fresh destination writes the diagnostic there', () => {
  const root = new TempRoot();
  try {
    const out = join(root.path, 'rejected.json');
    const result = runCli(writeRequest(root, { now: 'invalid' }), out);
    assert.equal(result.status, 2, result.stderr);
    const document = readJson(out);
    assert.equal(document['kind'], 'rejected-input');
    assert.equal(document['version'], 2);
    assert.deepEqual(document['requirements'], []);
    assert.equal(diagnosticPath(result.stderr), undefined);
  } finally {
    root.cleanup();
  }
});

test('publication: directory mode protects declared report files on a declaration failure', () => {
  const root = new TempRoot();
  try {
    const directory = writeReports(root);
    const target = join(directory, 'q1-artifacts.json');
    const before = readFileSync(target, 'utf8');
    const missingContract = join(root.path, 'absent-contract.json');
    const result = runCliArgs(
      ['--reports', directory, '--contract', missingContract, '--out', target],
      target,
    );
    assert.equal(result.status, 2, result.stderr);
    assert.equal(readFileSync(target, 'utf8'), before);
    assert.match(result.stderr, /already exists|is also an input this run reads/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// Read-set recovery
// --------------------------------------------------------------------------

test('publication: an unreadable request leaves the destination unused', () => {
  const root = new TempRoot();
  try {
    const request = root.writeRaw('request.json', '{"contract": ');
    const out = join(root.path, 'decision.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(root.has('decision.json'), false);
    assert.match(result.stderr, /complete set of input paths/);
    assert.ok(diagnosticPath(result.stderr) !== undefined);
  } finally {
    root.cleanup();
  }
});

test('publication: a partial source list refuses even a fresh destination', () => {
  const root = new TempRoot();
  try {
    // The first source entry loses its path, so the read-set is structurally
    // partial and no destination can be shown to be safe.
    const reports = roleReports();
    const sources = SOURCE_ROLES.map((role, index) => {
      const path = root.write(`reports/${role}.json`, reports[role]!);
      return index === 0 ? { role } : { role, path };
    });
    const request = root.write('request.json', {
      contract: CONTRACT,
      fixtureManifest: fixtureManifest(),
      pins: candidatePins(),
      now: NOW,
      sources,
    });
    const out = join(root.path, 'decision.json');
    const result = runCli(request, out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(root.has('decision.json'), false);
    assert.match(result.stderr, /complete set of input paths/);
    assert.ok(diagnosticPath(result.stderr) !== undefined);
  } finally {
    root.cleanup();
  }
});

test('publication: aliases of an input are recognised', () => {
  const root = new TempRoot();
  try {
    // The trace report is declared but never produced, so the destination does not
    // exist: only the canonical-path comparison can recognise it as an input.
    const directory = writeReports(root, 'q6-trace.json');

    const dotDot = runCliArgs(
      ['--reports', directory, '--contract', realContractPath(), '--out', `${directory}/../reports/q6-trace.json`],
      `${directory}/../reports/q6-trace.json`,
    );
    assert.equal(dotDot.status, 2, dotDot.stderr);
    assert.match(dotDot.stderr, /is also an input this run reads/);

    const link = join(root.path, 'linked');
    symlinkSync(directory, link);
    const viaLink = runCliArgs(
      ['--reports', directory, '--contract', realContractPath(), '--out', join(link, 'q6-trace.json')],
      join(link, 'q6-trace.json'),
    );
    assert.equal(viaLink.status, 2, viaLink.stderr);
    assert.match(viaLink.stderr, /is also an input this run reads/);

    assert.equal(root.has(join('reports', 'q6-trace.json')), false);
  } finally {
    root.cleanup();
  }
});

test('publication: a dangling symlink destination is refused and left untouched', () => {
  const root = new TempRoot();
  try {
    const target = join(root.path, 'not-produced.json');
    const out = join(root.path, 'decision.json');
    symlinkSync(target, out);
    const result = runCli(writeRequest(root), out);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /already exists/);
    assert.equal(root.has('not-produced.json'), false);
    assert.ok(diagnosticPath(result.stderr) !== undefined);
  } finally {
    root.cleanup();
  }
});

test('publication: no fixed sibling diagnostic name is ever used', () => {
  const root = new TempRoot();
  try {
    const out = join(root.path, 'decision.json');
    root.write('decision.json', { keep: true });
    const result = runCli(writeRequest(root), out);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(root.has('decision.json.rejected.json'), false);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// Failure paths
// --------------------------------------------------------------------------

test('publication: an unusable destination parent reports that no diagnostic was saved', () => {
  const root = new TempRoot();
  try {
    const asFile = root.write('plain.txt', 'not a directory');
    const out = join(asFile, 'decision.json');
    const result = runCli(writeRequest(root), out);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /no diagnostic was saved/);
  } finally {
    root.cleanup();
  }
});

// --------------------------------------------------------------------------
// Race and cleanup invariants
// --------------------------------------------------------------------------

test('publication: a destination created during publication is refused, never replaced', () => {
  const root = new TempRoot();
  try {
    const out = join(root.path, 'decision.json');
    // The race window between the early refusal and the atomic link cannot be staged
    // through the CLI, so the narrow interface is used with a genuine competing
    // creator: the document must not be published, and the competing bytes survive.
    publicationFaultInjection.beforeLink = (destination) => {
      // One competing creator: the hook clears itself so the diagnostic that the
      // refusal publishes is not blocked by the same injected competitor.
      delete publicationFaultInjection.beforeLink;
      writeFileSync(destination, '{"competing":true}\n');
    };
    try {
      const result = publish({
        kind: 'decision',
        requestedOut: out,
        inputs: [],
        readSetComplete: true,
        document: { requirements: [], marker: 'ours' },
        problems: [],
        version: 2,
        generatedAt: 0,
      });
      assert.equal(result.requestedPathUsed, false);
      assert.equal(result.publishedKind, 'diagnostic');
      assert.match(result.problems.join(' '), /already exists/);
    } finally {
      delete publicationFaultInjection.beforeLink;
    }
    assert.equal(readFileSync(out, 'utf8'), '{"competing":true}\n');
    assert.deepEqual(stagingLeftovers(root.path), []);
  } finally {
    root.cleanup();
  }
});

test('publication: an existing destination in a read-only directory is refused by name', () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    // Root ignores directory permissions, so the staging attempt would succeed and
    // this case could not distinguish the early refusal from the atomic one.
    return;
  }
  const root = new TempRoot();
  try {
    const directory = join(root.path, 'readonly');
    mkdirSync(directory, { recursive: true });
    const out = join(directory, 'decision.json');
    writeFileSync(out, '{"keep":"these bytes"}\n');
    chmodSync(directory, 0o500);
    try {
      const result = runCli(writeRequest(root), out);
      assert.equal(result.status, 2, result.stderr);
      // The early refusal names the real reason; without it the failure would be the
      // staging directory, which is a different problem for a caller to act on.
      assert.match(result.stderr, /already exists/);
      assert.doesNotMatch(result.stderr, /staging directory/);
    } finally {
      chmodSync(directory, 0o700);
    }
    assert.equal(readFileSync(out, 'utf8'), '{"keep":"these bytes"}\n');
  } finally {
    root.cleanup();
  }
});

test('publication: concurrent creators produce exactly one complete document', async () => {
  const root = new TempRoot();
  try {
    const modulePath = new URL('../src/publication.js', import.meta.url).pathname;
    const out = join(root.path, 'decision.json');
    const publisher = root.writeRaw(
      'publisher.mjs',
      [
        "const { publish } = await import(process.argv[2]);",
        'const result = publish({',
        "  kind: 'decision',",
        '  requestedOut: process.argv[3],',
        '  inputs: [],',
        '  readSetComplete: true,',
        '  document: { marker: process.argv[4], requirements: [] },',
        '  problems: [],',
        '  version: 2,',
        '  generatedAt: 0,',
        '});',
        'process.stdout.write(JSON.stringify({ used: result.requestedPathUsed, problems: result.problems.length }));',
      ].join('\n'),
    );
    const attempts = await Promise.all(
      ['a', 'b', 'c', 'd'].map((marker) =>
        runAsync(process.execPath, [publisher, modulePath, out, marker], { encoding: 'utf8' }),
      ),
    );
    const winners = attempts.filter((attempt) => (JSON.parse(attempt.stdout) as { used: boolean }).used);
    assert.equal(winners.length, 1, 'exactly one creator may publish');
    for (const attempt of attempts) {
      const parsed = JSON.parse(attempt.stdout) as { used: boolean; problems: number };
      if (!parsed.used) assert.ok(parsed.problems > 0, 'a losing creator reports a problem');
    }
    const document = readJson(out);
    assert.equal(typeof document['marker'], 'string');
    assert.deepEqual(document['requirements'], []);
    assert.deepEqual(stagingLeftovers(root.path), []);
  } finally {
    root.cleanup();
  }
});
