#!/usr/bin/env node
/**
 * The documented pilot command.
 *
 * It is a bootstrap and nothing else: it resolves the installed tooling, compiles the
 * current evaluator and producer TypeScript into a fresh build directory this
 * invocation owns, and runs that exact output. Compiling here — rather than importing
 * a build that may or may not exist — is what makes "the pilot ran the current
 * producer" a fact rather than an assumption, and it is why an absent `ts/dist` is not
 * a problem while a stale one can never be used.
 *
 *   node scripts/raster-qualification/desktop-host/tools/runPilot.mjs --run-dir <dir>
 *
 * Options: `--bench <dir>`, `--no-network-deny`, `--host-visible`.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../..');
const TS_ROOT = join(REPO_ROOT, 'scripts/raster-qualification/ts');
const TSC = join(REPO_ROOT, 'desktop/web/node_modules/.bin/tsc');

function usage(message) {
  process.stderr.write(`error: ${message}\n`);
  process.stderr.write(
    'usage: node tools/runPilot.mjs --run-dir <absent directory> [--bench <dir>] [--no-network-deny] [--host-visible]\n',
  );
}

/** Parse only the arguments this bootstrap needs; the rest belong to the pilot CLI. */
function parse(argv) {
  const options = { runDir: undefined, bench: join(REPO_ROOT, '.rq-scratch/bench'), passthrough: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run-dir') options.runDir = argv[++index];
    else if (arg === '--bench') options.bench = argv[++index];
    else options.passthrough.push(arg);
  }
  return options;
}

const options = parse(process.argv.slice(2));
if (options.runDir === undefined) {
  usage('--run-dir is required');
  process.exit(2);
}
for (const [label, path] of [['the TypeScript compiler', TSC], ['the bench engine', options.bench]]) {
  if (!existsSync(path)) {
    usage(`${label} is unavailable at ${path}; the pilot cannot start without it`);
    process.exit(2);
  }
}

// A fresh build directory per invocation: nothing from a previous build, and nothing
// from an ignored `ts/dist`, can be what this run executes.
const buildParent = join(REPO_ROOT, '.rq-scratch/pilot-build');
mkdirSync(buildParent, { recursive: true });
const buildRoot = mkdtempSync(join(buildParent, 'build-'));
const outDir = join(buildRoot, 'ts');
writeFileSync(join(buildRoot, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`, 'utf8');
const cleanup = () => rmSync(buildRoot, { recursive: true, force: true });

try {
  execFileSync(TSC, ['-p', join(TS_ROOT, 'tsconfig.json'), '--outDir', outDir], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
} catch (error) {
  process.stderr.write(`error: compiling the current pilot tooling failed: ${String(error)}\n`);
  cleanup();
  process.exit(2);
}

const cli = join(outDir, 'src/pilot/cli.js');
if (!existsSync(cli)) {
  process.stderr.write(`error: the fresh compile produced no pilot CLI at ${cli}\n`);
  cleanup();
  process.exit(2);
}

const child = spawnSync(
  process.execPath,
  [
    cli,
    '--repo-root', REPO_ROOT,
    '--run-dir', options.runDir,
    '--bench', options.bench,
    '--evaluator-cli', join(outDir, 'src/cli.js'),
    ...options.passthrough,
  ],
  { stdio: 'inherit' },
);
cleanup();
process.exit(child.status ?? 2);
