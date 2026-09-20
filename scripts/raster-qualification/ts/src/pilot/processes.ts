/**
 * The real process, filesystem and build boundaries of a pilot run.
 *
 * `launcher.ts` decides what a run means; this module performs the work it cannot:
 * preparing the fixture, building the frontend and the bundled host, launching the
 * host under a network namespace and running the freshly compiled evaluator. Every
 * failure is returned as structured problems — the launcher classifies them and owns
 * the exit code.
 */

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  type BuildOutcome,
  type BuildRequest,
  type DisplayOutcome,
  type EvaluateRequest,
  type EvaluationOutcome,
  type HostOutcome,
  type HostRequest,
  type PilotEnvironment,
} from './launcher.js';
import { prepareX11Relay } from './x11.js';

export interface EnvironmentOptions {
  readonly repoRoot: string;
  readonly bench: string;
  /** Show the host window; the measurement does not depend on it being visible. */
  readonly hostVisible?: boolean;
  /** Socket directory for the display relay; tests point this at a temporary root. */
  readonly socketRoot?: string;
  /** Replace the process launcher in tests. */
  readonly spawnProcess?: typeof spawn;
}

function detail(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: number }).status;
    const stderr = (error as { stderr?: string }).stderr;
    return [error.message, status === undefined ? undefined : `exit ${status}`, stderr?.trim()]
      .filter((part): part is string => part !== undefined && part.length > 0)
      .join(': ');
  }
  return String(error);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Every file in a directory, deepest first, with its relative path. */
function walk(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

/** The total size of a directory tree. */
function treeBytes(root: string): number {
  let total = 0;
  for (const path of walk(root)) total += statSync(path).size;
  return total;
}

export function createEnvironment(options: EnvironmentOptions): PilotEnvironment {
  const launch = options.spawnProcess ?? spawn;
  const hostRoot = join(options.repoRoot, 'scripts/raster-qualification/desktop-host');
  const webRoot = join(hostRoot, 'web');
  const distRoot = join(webRoot, 'dist');
  let child: ChildProcess | undefined;
  let aborted = false;

  function run(command: string, args: readonly string[], cwd: string): string {
    return execFileSync(command, [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }

  return {
    async build(request: BuildRequest): Promise<BuildOutcome> {
      const problems: string[] = [];
      const tsc = join(options.repoRoot, 'desktop/web/node_modules/.bin/tsc');
      const vite = join(options.repoRoot, 'desktop/web/node_modules/.bin/vite');
      const source = join(options.bench, 'node_modules/whitebox-wasm');

      for (const [label, path] of [
        ['the TypeScript compiler', tsc],
        ['the frontend bundler', vite],
        ['the bench engine', source],
      ] as const) {
        if (!existsSync(path)) {
          problems.push(`${label} is unavailable at ${path}`);
        }
      }
      if (problems.length > 0) {
        return { ok: false, problems };
      }

      try {
        run(tsc, ['-p', join(webRoot, 'tsconfig.json')], options.repoRoot);
      } catch (error) {
        return { ok: false, problems: [`the frontend typecheck failed: ${detail(error)}`] };
      }
      try {
        run(vite, ['build', '--config', join(webRoot, 'vite.config.mjs'), '--logLevel', 'error'], options.repoRoot);
      } catch (error) {
        return { ok: false, problems: [`the frontend bundle failed: ${detail(error)}`] };
      }

      // The engine assets are part of the bundle, so they are copied in before the host
      // is built: the Tauri context embeds this directory at compile time.
      const bundled = join(distRoot, 'wb');
      mkdirSync(bundled, { recursive: true });
      for (const file of ['whitebox_wasm.js', 'whitebox_wasm_bg.wasm']) {
        copyFileSync(join(source, file), join(bundled, file));
      }

      let fixture: BuildOutcome['fixture'];
      try {
        const fixtureDir = join(request.runRoot.path, 'fixture');
        if (!existsSync(join(fixtureDir, 'fixture.json'))) {
          run(process.execPath, [join(hostRoot, 'tools/makePilotFixture.mjs'), '--out', fixtureDir], options.repoRoot);
        }
        const manifest = JSON.parse(readFileSync(join(fixtureDir, 'fixture.json'), 'utf8')) as {
          fixture: string;
          path: string;
          sha256: string;
          bytes: number;
        };
        fixture = {
          name: manifest.fixture,
          sha256: manifest.sha256,
          bytes: manifest.bytes,
          path: manifest.path,
        };
      } catch (error) {
        return { ok: false, problems: [`the pilot fixture could not be prepared: ${detail(error)}`] };
      }

      try {
        run('cargo', ['build', '--offline'], hostRoot);
      } catch (error) {
        return { ok: false, problems: [`the bundled host build failed: ${detail(error)}`] };
      }

      const frontendDigests = walk(distRoot)
        .filter((path) => !path.endsWith('.map'))
        .map((path) => ({
          path: relative(distRoot, path),
          sha256: sha256(path),
          bytes: statSync(path).size,
        }));

      let runtime = { os: 'unknown', webkit: 'unknown', tauri: 'unknown' };
      try {
        const lock = readFileSync(join(hostRoot, 'Cargo.lock'), 'utf8');
        const tauriVersion = /name = "tauri"\nversion = "([^"]+)"/.exec(lock)?.[1] ?? 'unknown';
        runtime = {
          os: run('uname', ['-sr'], options.repoRoot).trim(),
          webkit: run('pkg-config', ['--modversion', 'webkit2gtk-4.1'], options.repoRoot).trim(),
          tauri: tauriVersion,
        };
      } catch (error) {
        problems.push(`the host runtime identity could not be recorded: ${detail(error)}`);
      }

      let engine: BuildOutcome['engine'];
      try {
        const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
          name: string;
          version: string;
        };
        engine = { name: installed.name, version: installed.version };
      } catch (error) {
        return { ok: false, problems: [`the bench engine identity could not be read: ${detail(error)}`] };
      }

      return {
        ok: problems.length === 0,
        problems,
        hostBinary: join(hostRoot, 'target/debug/qualification-desktop-host'),
        fixture,
        engine,
        frontendDigests,
        runtime,
      };
    },

    async display(networkDeny: boolean): Promise<DisplayOutcome> {
      if (!networkDeny) {
        return { ok: true, problems: [], detail: 'network denial not exercised; the display was used directly' };
      }
      const relay = await prepareX11Relay(process.env['DISPLAY'] ?? '', {
        ...(options.socketRoot === undefined ? {} : { socketRoot: options.socketRoot }),
      });
      if (!relay.ok) return { ok: false, problems: relay.problems };
      return {
        ok: true,
        problems: [],
        detail: relay.relay.detail,
        release: relay.relay.release,
      };
    },

    async runHost(request: HostRequest): Promise<HostOutcome> {
      const xdg = {
        XDG_DATA_HOME: join(request.runRoot.path, 'xdg/data'),
        XDG_CACHE_HOME: join(request.runRoot.path, 'xdg/cache'),
        XDG_CONFIG_HOME: join(request.runRoot.path, 'xdg/config'),
        XDG_RUNTIME_DIR: join(request.runRoot.path, 'xdg/runtime'),
      };
      for (const path of Object.values(xdg)) mkdirSync(path, { recursive: true });

      const command = [request.binary, '--run-spec', request.specPath];
      const [file, args] = request.networkDeny ? ['unshare', ['-rn', ...command]] : [command[0] as string, command.slice(1)];
      request.log.write(`host: launching ${file} ${args.join(' ')}\n`);

      const started = Date.now();
      child = launch(file, args, {
        cwd: request.runRoot.path,
        env: { ...process.env, ...xdg, ...(options.hostVisible === true ? { QUAL_HOST_VISIBLE: '1' } : {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so teardown reaches the host inside the namespace
        // wrapper rather than leaving it behind.
        detached: true,
      });
      const running = child;
      running.stdout?.on('data', (chunk: Buffer) => request.log.write(chunk.toString()));
      running.stderr?.on('data', (chunk: Buffer) => request.log.write(chunk.toString()));

      const exited = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; timedOut: boolean }>(
        (resolveExit) => {
          const timer = setTimeout(() => {
            const group = running.pid;
            if (group !== undefined) {
              try {
                process.kill(-group, 'SIGKILL');
              } catch {
                running.kill('SIGKILL');
              }
            }
            resolveExit({ code: null, signal: 'SIGKILL', timedOut: true });
          }, request.deadlineMs);
          timer.unref();
          running.once('exit', (code, signal) => {
            clearTimeout(timer);
            resolveExit({ code, signal, timedOut: false });
          });
          running.once('error', (error) => {
            clearTimeout(timer);
            request.log.write(`host: launch failed: ${detail(error)}\n`);
            resolveExit({ code: null, signal: null, timedOut: false });
          });
        },
      );
      child = undefined;

      if (exited.timedOut) {
        return {
          ok: false,
          problems: [`the host exceeded the ${request.deadlineMs} ms pilot deadline and was stopped`],
        };
      }
      if (aborted) {
        return { ok: false, problems: ['the pilot was cancelled; no measurement is claimed'] };
      }

      const evidencePath = join(request.runRoot.path, 'host-evidence.json');
      if (!existsSync(evidencePath)) {
        return {
          ok: false,
          problems: [
            `the host exited ${exited.code ?? exited.signal ?? 'without a status'} after ${Date.now() - started} ms without publishing evidence`,
          ],
        };
      }
      const text = readFileSync(evidencePath, 'utf8');
      let evidence: unknown;
      try {
        evidence = JSON.parse(text) as unknown;
      } catch (error) {
        return { ok: false, problems: [`the host evidence is not valid JSON: ${detail(error)}`] };
      }
      const outputs = treeBytes(request.runRoot.path);
      request.log.write(`host: evidence ${text.length} bytes; run outputs ${outputs} bytes\n`);
      return {
        ok: true,
        problems: [],
        evidence,
        evidenceDigest: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
      };
    },

    async evaluate(request: EvaluateRequest): Promise<EvaluationOutcome> {
      const args = [
        request.cli,
        '--reports', request.reportsPath,
        '--contract', request.contractPath,
        '--pins', request.pinsPath,
        '--fixture-manifest', request.fixtureManifestPath,
        '--profile', request.profile,
        '--now', String(request.nowSeconds),
        '--out', request.out,
      ];
      let exitCode = 0;
      let stdout = '';
      let stderr = '';
      try {
        stdout = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        exitCode = failure.status ?? 1;
        stdout = failure.stdout ?? '';
        stderr = failure.stderr ?? '';
      }
      const decision = existsSync(request.out)
        ? (JSON.parse(readFileSync(request.out, 'utf8')) as unknown)
        : undefined;
      return {
        ok: true,
        problems: [],
        exitCode,
        ...(decision === undefined ? {} : { decision }),
        ...(decision === undefined ? { detail: `${stdout}${stderr}`.trim() } : {}),
        decisionPath: request.out,
      };
    },

    abort(): void {
      aborted = true;
      const running = child;
      if (running?.pid === undefined) return;
      try {
        process.kill(-running.pid, 'SIGKILL');
      } catch {
        running.kill('SIGKILL');
      }
    },
  };
}

/** A fresh, exclusively created build directory for one invocation's compiled tooling. */
export function createBuildDirectory(repoRoot: string, label: string): string {
  const parent = join(repoRoot, '.rq-scratch/pilot-build');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, `${label}-`));
}
