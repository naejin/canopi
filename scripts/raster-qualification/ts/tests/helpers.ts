/**
 * Test helpers.
 *
 * Every helper writes into a fresh temporary root and drives the real emitted CLI
 * as a child process. Nothing here mocks the admission or verdict logic: the tests
 * are about what the tool actually decides.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The emitted CLI, resolved from the compiled test location. */
export const CLI = resolve(HERE, '../src/cli.js');
/** The repository root, so tests do not depend on the caller's working directory. */
export const REPO_ROOT = resolve(HERE, '../../../../..');

export interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Present only when a decision document was actually written. */
  readonly decision: Record<string, unknown> | undefined;
}

export class TempRoot {
  readonly path: string;
  constructor() {
    this.path = mkdtempSync(join(tmpdir(), 'qual-ts-'));
  }

  write(relative: string, contents: unknown): string {
    const target = join(this.path, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`,
      'utf8',
    );
    return target;
  }

  writeRaw(relative: string, contents: string): string {
    const target = join(this.path, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, 'utf8');
    return target;
  }

  read(relative: string): string {
    return readFileSync(join(this.path, relative), 'utf8');
  }

  has(relative: string): boolean {
    return existsSync(join(this.path, relative));
  }

  cleanup(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

/** Run the real CLI with explicit arguments. Never throws. */
export function runCliArgs(argv: readonly string[], outPath: string): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...argv], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '', decision: readDecision(outPath) };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      decision: readDecision(outPath),
    };
  }
}

/** Run the real CLI in request mode. */
export function runCli(requestPath: string, outPath: string): CliResult {
  return runCliArgs(['--request', requestPath, '--out', outPath], outPath);
}

function readDecision(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
