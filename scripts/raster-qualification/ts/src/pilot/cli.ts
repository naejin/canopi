#!/usr/bin/env node
/**
 * The pilot CLI.
 *
 * It compiles nothing and decides nothing: the bootstrap has already compiled this
 * file and passed the exact evaluator CLI path in, so a stale `ts/dist` can never be
 * what a pilot run measures. The CLI parses the launcher arguments, installs the
 * cancellation handlers, runs one pilot and exits with the launcher's own code.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createEnvironment } from './processes.js';
import { EXIT_INSTRUMENT, runPilot, type PilotRequest } from './launcher.js';

interface Args {
  readonly runDir: string;
  readonly bench: string;
  readonly repoRoot: string;
  readonly evaluatorCli: string;
  readonly networkDeny: boolean;
  readonly hostVisible: boolean;
}

function parseArgs(argv: readonly string[]): Args | undefined {
  const values = new Map<string, string>();
  let runDir: string | undefined;
  let bench: string | undefined;
  let repoRoot: string | undefined;
  let evaluatorCli: string | undefined;
  void values;
  let networkDeny = true;
  let hostVisible = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--run-dir') runDir = argv[++index];
    else if (arg === '--bench') bench = argv[++index];
    else if (arg === '--repo-root') repoRoot = argv[++index];
    else if (arg === '--evaluator-cli') evaluatorCli = argv[++index];
    else if (arg === '--no-network-deny') networkDeny = false;
    else if (arg === '--host-visible') hostVisible = true;
    else if (arg === '--help') return undefined;
  }
  if (runDir === undefined || bench === undefined || repoRoot === undefined || evaluatorCli === undefined) {
    return undefined;
  }
  return { runDir, bench, repoRoot, evaluatorCli, networkDeny, hostVisible };
}

const USAGE = `usage: cli.js --repo-root <dir> --run-dir <absent dir> --bench <dir> --evaluator-cli <freshly built cli.js> [--no-network-deny] [--host-visible]

The run directory must not exist: a pilot owns exactly one directory it created, and
never reuses, cleans or overwrites a previous run. Exits 0 when this bounded pilot
completed with Q-LOCAL-1 and Q-HOST-1 passing and no requirement failing, 1 when a
pilot measurement failed or required evidence is incomplete, and 2 on any instrument
failure.`;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT_INSTRUMENT;
  }
  const repoRoot = resolve(args.repoRoot);
  const runDir = resolve(args.runDir);
  const evaluatorCli = resolve(args.evaluatorCli);
  if (!existsSync(evaluatorCli)) {
    process.stderr.write(
      `error: the freshly compiled evaluator CLI is missing at ${evaluatorCli}; the bootstrap must compile it before the pilot starts\n`,
    );
    return EXIT_INSTRUMENT;
  }

  const environment = createEnvironment({
    repoRoot,
    bench: resolve(args.bench),
    hostVisible: args.hostVisible,
  });

  const cancel = (signal: NodeJS.Signals): void => {
    process.stderr.write(`error: the pilot was cancelled by ${signal}; stopping run-owned work\n`);
    environment.abort();
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);

  const request: PilotRequest = {
    repoRoot,
    runDir,
    bench: resolve(args.bench),
    buildRoot: runDir,
    networkDeny: args.networkDeny,
    command: `${evaluatorCli} (bundled host under scripts/raster-qualification/desktop-host)`,
    contractPath: resolve(repoRoot, 'scripts/raster-qualification/requirements.json'),
    pinsPath: resolve(repoRoot, 'scripts/raster-qualification/candidates.json'),
    evaluatorCli,
    now: () => Date.now(),
  };

  const result = await runPilot(request, environment);
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
  return result.exitCode;
}

process.exitCode = await main(process.argv.slice(2));
