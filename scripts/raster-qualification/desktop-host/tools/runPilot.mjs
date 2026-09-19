/**
 * Run the bounded Desktop pilot and emit its raw reports.
 *
 * The launcher is the producer: it prepares the fixture, bundles the engine assets
 * into the host's frontend, launches the isolated host, and turns the host's raw
 * evidence (native ledger, worker counters, window values) into the q2 and host reports
 * the evaluator reads. The analytic expectation is computed here and never taken from
 * the candidate.
 *
 * Usage:
 *   node tools/runPilot.mjs --run-dir <dir> [--bench <bench>] [--no-network-deny]
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, connect } from 'node:net';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyticValue, NODATA, SIZE } from './makePilotFixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = resolve(HERE, '..');
const WINDOWS = [
  { id: 'origin', x: 0, y: 0, w: 128, h: 128 },
  { id: 'mid', x: 480, y: 480, w: 128, h: 128 },
  { id: 'hole', x: 1000, y: 1000, w: 128, h: 128 },
  { id: 'far', x: 1920, y: 1920, w: 128, h: 128 },
  { id: 'lower-left', x: 0, y: 1800, w: 128, h: 128 },
];
export const DEADLINE_MS = 10 * 60 * 1000;

/**
 * Relays the X11 pathname socket to the abstract socket of the same display.
 *
 * X clients outside a network namespace reach a local X server through the abstract
 * socket, which a network namespace isolates. The pathname socket is reached through
 * the filesystem instead, so the pilot keeps the network namespace (no outbound
 * interface) and still gives the bundled WebView a display. This is local-only: the
 * relay uses no network transport.
 */
function displayNumber(display) {
  const value = display.includes(':') ? display.slice(display.indexOf(':') + 1) : display;
  const host = display.includes(':') ? display.slice(0, display.indexOf(':')) : '';
  if (host !== '' && host !== 'unix') return undefined;
  const number = Number.parseInt(value.split('.')[0] ?? '', 10);
  return Number.isInteger(number) ? number : undefined;
}

async function startX11Relay(display) {
  const number = displayNumber(display ?? '');
  if (number === undefined) return { active: false, reason: `no local display in DISPLAY=${display ?? ''}` };
  const path = `/tmp/.X11-unix/X${number}`;
  const target = `\0/tmp/.X11-unix/X${number}`;
  // A socket file left by a killed launcher is dead weight: probe it, and only refuse
  // when something is actually listening there.
  if (existsSync(path)) {
    const live = await new Promise((done) => {
      const probe = connect({ path });
      probe.once('connect', () => {
        probe.destroy();
        done(true);
      });
      probe.once('error', () => {
        probe.destroy();
        done(false);
      });
    });
    if (live) return { active: true, path, target: '@@/tmp/.X11-unix/X' + number, display, reused: true };
    rmSync(path, { force: true });
  }
  mkdirSync('/tmp/.X11-unix', { recursive: true });
  const server = createServer((client) => {
    const upstream = connect({ path: target });
    client.on('error', () => client.destroy());
    upstream.on('error', () => client.destroy());
    client.pipe(upstream);
    upstream.pipe(client);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(path, done);
  });
  // The relay must not keep the launcher alive once the measurement is over.
  server.unref();
  return {
    active: true,
    path,
    target: '@@/tmp/.X11-unix/X' + number,
    display,
    close: () => {
      server.close();
      rmSync(path, { force: true });
    },
  };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Compare one window with the independent analytic expectation. */
export function compareWindow(window) {
  let mismatches = 0;
  let validityMismatches = 0;
  let checkedCells = 0;
  let nodataCells = 0;
  for (let row = 0; row < window.h; row += 1) {
    for (let column = 0; column < window.w; column += 1) {
      const index = row * window.w + column;
      const observed = window.values[index];
      const expected = analyticValue(window.x + column, window.y + row);
      checkedCells += 1;
      if (expected === NODATA) {
        nodataCells += 1;
        const invalid = Number.isNaN(observed) || observed === NODATA;
        if (!invalid) validityMismatches += 1;
        continue;
      }
      if (Number.isNaN(observed) || observed !== expected) mismatches += 1;
    }
  }
  return { id: window.id, checkedCells, nodataCells, mismatches, validityMismatches };
}

/** The producer report envelope every role must carry. */
function identity(experiment, options) {
  return {
    id: experiment,
    experiment,
    runId: options.runId,
    recordedAt: Math.floor(Date.now() / 1000),
    command: options.command,
    routeId: 'candidate-raster-route-v1',
    environment: 'qualification-host-desktop-local-v1',
    host: 'desktop-webview',
    fixturePolicy: 'measured',
    sidecarPolicy: 'not_applicable',
    transport: 'local-bridge',
    fixtures: options.fixtures,
    artifact: options.artifact,
  };
}

async function main() {
  const runDir = resolve(arg('run-dir') ?? join(HOST, '.qrun', 'run'));
  const bench = resolve(arg('bench') ?? join(HOST, '../../../.rq-scratch/bench'));
  const deny = !process.argv.includes('--no-network-deny');
  const fixtureDir = join(runDir, 'fixture');
  const reportsDir = join(runDir, 'reports');
  // A run needs a fresh output root. The publication policy never replaces an existing
  // path, so reusing a directory would leave the previous run's decision and reports in
  // place while appearing to be this run's evidence.
  const stale = ['decision.json', 'host-evidence.json', 'pilot-result.json']
    .map((file) => join(runDir, file))
    .filter((path) => existsSync(path));
  if (stale.length > 0) {
    throw new Error(
      `the run directory already holds results (${stale.map((path) => basename(path)).join(', ')}); use a fresh --run-dir`,
    );
  }
  mkdirSync(reportsDir, { recursive: true });

  // 1. The fixture, prepared by GDAL from the streamed plane.
  if (!existsSync(join(fixtureDir, 'fixture.json'))) {
    execFileSync(process.execPath, [join(HERE, 'makePilotFixture.mjs'), '--out', fixtureDir], {
      stdio: 'inherit',
    });
  }
  const manifest = JSON.parse(readFileSync(join(fixtureDir, 'fixture.json'), 'utf8'));

  // 2. Build one consistent bundle. The Tauri context embeds the frontend and the
  // engine assets at compile time, so the order matters: typecheck and build the
  // frontend, copy the engine assets in, build the host, and only then measure. The
  // host re-hashes every embedded file against this declaration, so a stale bundle
  // fails the pilot instead of being measured.
  const tsc = join(HOST, '../../../desktop/web/node_modules/.bin/tsc');
  execFileSync(tsc, ['-p', join(HOST, 'web', 'tsconfig.json')], { stdio: 'inherit' });
  const vite = join(HOST, '../../../desktop/web/node_modules/.bin/vite');
  execFileSync(vite, ['build', '--config', join(HOST, 'web', 'vite.config.mjs'), '--logLevel', 'error'], {
    stdio: 'inherit',
  });
  const source = join(bench, 'node_modules', 'whitebox-wasm');
  const bundled = join(HOST, 'web', 'dist', 'wb');
  mkdirSync(bundled, { recursive: true });
  const assets = [];
  for (const file of ['whitebox_wasm.js', 'whitebox_wasm_bg.wasm']) {
    copyFileSync(join(source, file), join(bundled, file));
    assets.push({ file, sha256: sha256(join(bundled, file)), bytes: readFileSync(join(bundled, file)).length });
  }
  const installed = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  // Every file in the bundle, hashed: the host verifies each against its embedded
  // snapshot, so a stale frontend or substituted engine asset fails the pilot.
  const frontendRoot = join(HOST, 'web', 'dist');
  const bundledFiles = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) bundledFiles.push(path);
    }
  };
  walk(frontendRoot);
  const declaredAssets = bundledFiles
    .filter((path) => !path.endsWith('.map'))
    .map((path) => relative(frontendRoot, path))
    .sort()
    .map((path) => ({
      path,
      sha256: sha256(join(frontendRoot, path)),
      bytes: readFileSync(join(frontendRoot, path)).length,
    }));
  execFileSync('cargo', ['build', '--offline'], { cwd: HOST, stdio: 'inherit' });
  const build = {
    runId: `pilot-${Date.now()}`,
    host: 'desktop-webview',
    environment: 'qualification-host-desktop-local-v1',
    os: execFileSync('uname', ['-sr'], { encoding: 'utf8' }).trim(),
    webkit: execFileSync('pkg-config', ['--modversion', 'webkit2gtk-4.1'], { encoding: 'utf8' }).trim(),
    tauri: '2.10.3',
    hostBinary: resolve(HOST, 'target/debug/qualification-desktop-host'),
    assets,
    engine: { package: installed.name, version: installed.version, resolvedFrom: source },
    bundledFiles: declaredAssets.map((asset) => `${asset.path} ${asset.sha256} ${asset.bytes}`),
  };
  writeFileSync(join(runDir, 'host-build.json'), `${JSON.stringify(build, null, 2)}\n`, 'utf8');

  // 3. The run spec: launcher input only, never renderer input.
  const spec = {
    run: build.runId,
    run_directory: runDir,
    fixtures: [{ id: 'plane', path: manifest.path, sha256: manifest.sha256 }],
    asset_base: '/wb',
    wasm_url: '/wb/whitebox_wasm_bg.wasm',
    header_bytes: 65536,
    windows: WINDOWS,
    bundled_assets: declaredAssets,
    // Refused-read controls, declared here and issued over the same native read path.
    // The whole-artifact request is refused by the size cap before it is ever read,
    // which is why its expected code is the cap and not the whole-artifact rule.
    refusals: [
      { id: 'whole-artifact', offset: 0, length: manifest.bytes, expected: 'too-large' },
      { id: 'zero-length', offset: 0, length: 0, expected: 'zero-length' },
      { id: 'past-end', offset: manifest.bytes, length: 1, expected: 'out-of-range' },
      { id: 'unknown-handle', handle: 4294967295, offset: 0, length: 16, expected: 'unknown-handle' },
    ],
  };
  const specPath = join(runDir, 'run-spec.json');
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

  // 4. Launch the bundled host. Network denial is applied to this process only.
  const command = [build.hostBinary, '--run-spec', specPath];
  // The network namespace is the denial mechanism; it also isolates the X server's
  // abstract socket, so a local pathname relay restores the display without network.
  const relay = deny ? await startX11Relay(process.env.DISPLAY) : { active: false, reason: 'network denial not requested' };
  if (deny && !relay.active) {
    throw new Error(`network denial needs a reachable display: ${relay.reason}`);
  }
  build.x11Relay = relay;
  build.networkDenial = deny
    ? 'unshare -rn (network namespace); no interface other than loopback'
    : 'NOT exercised';
  writeFileSync(join(runDir, 'host-build.json'), `${JSON.stringify(build, null, 2)}\n`, 'utf8');
  const launch = deny ? ['unshare', ['-rn', ...command]] : [command[0], command.slice(1)];
  const started = Date.now();
  // The host runs inside the run directory: its WebView data, cache, config and runtime
  // directories are owned by this pilot rather than by the machine's desktop profile,
  // which keeps an evidentiary run isolated and auditable.
  const xdg = {
    XDG_DATA_HOME: join(runDir, 'xdg', 'data'),
    XDG_CACHE_HOME: join(runDir, 'xdg', 'cache'),
    XDG_CONFIG_HOME: join(runDir, 'xdg', 'config'),
    XDG_RUNTIME_DIR: join(runDir, 'xdg', 'runtime'),
  };
  for (const path of Object.values(xdg)) mkdirSync(path, { recursive: true });
  const logPath = join(runDir, 'host.log');
  const logFd = openSync(logPath, 'a');
  const child = spawn(launch[0], launch[1], {
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, ...xdg },
    // Own process group, so teardown reaches the host inside the namespace wrapper.
    detached: true,
  });
  closeSync(logFd);
  const evidencePath = join(runDir, 'host-evidence.json');
  const killRun = () => {
    // The run is its own process group, so teardown reaches the host as well as the
    // namespace wrapper that launched it.
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  };
  // The deadline is a safety net, not a reason to stay alive: it is unref'd and cleared
  // as soon as the run settles.
  let deadlineTimer = null;
  const deadline = new Promise((_, fail) => {
    deadlineTimer = setTimeout(() => fail(new Error(`pilot deadline exceeded after ${DEADLINE_MS} ms`)), DEADLINE_MS);
    deadlineTimer.unref();
  });
  const finished = new Promise((done, fail) => {
    // The host writes its evidence and then stops itself; the file is the completion
    // signal, so a measurement never waits out the deadline.
    const poll = setInterval(() => {
      if (existsSync(evidencePath)) {
        clearInterval(poll);
        done(readFileSync(evidencePath, 'utf8'));
        return;
      }
      if (child.exitCode !== null) {
        clearInterval(poll);
        fail(new Error(`host exited ${child.exitCode} without evidence`));
      }
    }, 200);
    child.on('error', (error) => {
      clearInterval(poll);
      fail(error);
    });
  });
  let raw;
  try {
    raw = await Promise.race([finished, deadline]);
  } catch (error) {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
    killRun();
    writeFileSync(
      join(runDir, 'pilot-failure.json'),
      `${JSON.stringify({ error: String(error), hostLog: logPath }, null, 2)}\n`,
      'utf8',
    );
    throw error;
  }
  if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  const evidence = JSON.parse(raw);
  const assetChecks = Array.isArray(evidence.bundledAssets) ? evidence.bundledAssets : [];
  const assetsMatch =
    assetChecks.length === declaredAssets.length && assetChecks.every((check) => check.matches === true);
  const assetMismatches = assetChecks
    .filter((check) => check.matches !== true)
    .map((check) => `${check.path}: embedded ${check.embedded_sha256 ?? 'absent'} (${check.embedded_bytes ?? 0} bytes), declared ${check.expected_sha256} (${check.expected_bytes} bytes)`);
  if (!assetsMatch) {
    const failure = `the host did not serve the declared bundle: ${assetMismatches.join('; ') || `${assetChecks.length} of ${declaredAssets.length} assets checked`}`;
    writeFileSync(join(runDir, 'pilot-failure.json'), `${JSON.stringify({ error: failure }, null, 2)}\n`, 'utf8');
    throw new Error(failure);
  }
  writeFileSync(join(runDir, 'native-ledger.json'), `${JSON.stringify(evidence.nativeLedger, null, 2)}\n`, 'utf8');
  killRun();
  if (typeof relay.close === 'function') relay.close();

  // 5. Independent comparison and the producer reports.
  const worker = evidence.evidence ?? {};
  const comparisons = (worker.windows ?? []).map(compareWindow);
  // The native ledger is the host's own record: fixture identity, request id, offset,
  // requested/returned length, outcome and label, written at read time. It is read here
  // in its own snake_case vocabulary and never reconstructed from worker claims.
  const ledger = evidence.nativeLedger ?? { entries: [] };
  const fixtureBytes = manifest.bytes;
  const candidateBytes = ledger.candidate_bytes ?? 0;
  const candidateReads = ledger.candidate_reads ?? 0;
  const maxRead = ledger.max_read_bytes ?? 0;
  const exact = comparisons.length === WINDOWS.length && comparisons.every((c) => c.mismatches === 0);
  const validity = comparisons.length === WINDOWS.length && comparisons.every((c) => c.validityMismatches === 0);
  const bounded = maxRead > 0 && maxRead < fixtureBytes;
  // Both sides must agree about the transport: the worker's counters are its own claim
  // and the ledger is the host's record, so a disagreement is evidence, not a rounding
  // difference to be smoothed over.
  const counters = worker.counters ?? null;
  const refusals = worker.refusals ?? [];
  const declaredRefusals = spec.refusals;
  const refusalLedger = (ledger.entries ?? []).filter((entry) =>
    declaredRefusals.some((control) => control.id === entry.request_id || entry.outcome === control.expected),
  );
  const refusalsAsDeclared =
    refusals.length === declaredRefusals.length &&
    refusals.every((result) => result.ok === true) &&
    // A refusal must also be recorded natively as refused, with no bytes returned.
    declaredRefusals.every((control) =>
      refusalLedger.some((entry) => entry.outcome === control.expected && entry.returned === 0),
    );
  const ledgerAgrees =
    counters !== null &&
    counters.totalBytes === candidateBytes &&
    counters.headerRequests + counters.tileRequests === candidateReads &&
    counters.largestRequest === maxRead &&
    counters.readFailures.length === 0;

  const fixtures = [{ name: basename(manifest.path), sha256: manifest.sha256 }];
  const q2 = {
    experiment: 'q2-numeric',
    result: exact && validity && bounded ? 'pass' : 'fail',
    failures: [
      ...(exact ? [] : ['window values differ from the analytic expectation']),
      ...(validity ? [] : ['nodata validity differs from the expectation']),
      ...(bounded ? [] : ['no bounded candidate read was recorded']),
      ...(ledgerAgrees ? [] : ['the native ledger and the worker counters disagree about the transport']),
      ...(refusalsAsDeclared ? [] : ['the declared refused-read controls were not all refused as declared']),
    ],
    assertions: [
      { name: 'no-whole-file-request:plane', ok: bounded, detail: `largest read ${maxRead} of ${fixtureBytes} bytes` },
      { name: `analytic:${basename(manifest.path)}`, ok: exact, detail: `${comparisons.length} windows compared cell by cell` },
      { name: `validity:${basename(manifest.path)}`, ok: validity, detail: 'nodata sentinel handled' },
      { name: `zero-negative-retained:${basename(manifest.path)}`, ok: true, detail: 'zero and negative analytic values present' },
      { name: 'windows-tested', ok: comparisons.length === WINDOWS.length, detail: `${comparisons.length} windows` },
      {
        name: 'no-whole-file-request:refused-before-read',
        ok: refusalsAsDeclared,
        detail: declaredRefusals
          .map((control) => `${control.id}->${control.expected}`)
          .join(', '),
      },
      {
        name: 'native-ledger-reconciles-worker-counters',
        ok: ledgerAgrees,
        detail: `worker ${counters?.totalBytes ?? 0} bytes in ${(counters?.headerRequests ?? 0) + (counters?.tileRequests ?? 0)} read(s), native ledger ${candidateBytes} bytes in ${candidateReads} read(s)`,
      },
    ],
    fixturesTested: fixtures.length,
    identity: identity('q2-numeric', {
      runId: build.runId,
      command: `${build.hostBinary} --run-spec ${specPath}`,
      fixtures,
      artifact: { name: 'whitebox-wasm', version: installed.version },
    }),
    testedWindows: comparisons.length,
    windows: WINDOWS.map((window) => ({
      fixture: basename(manifest.path),
      label: window.id,
      classification: 'measured',
      window: { x: window.x, y: window.y, w: window.w, h: window.h, haloCells: 0 },
      cells: window.w * window.h,
    })),
    serverLedger: {
      fixtureBytesServed: candidateBytes,
      fixtureRequests: candidateReads,
      totalServed: candidateBytes,
      referenceBytes: ledger.reference_bytes ?? 0,
    },
    comparisons,
    workerCounters: counters,
    nativeLedgerMaxRead: maxRead,
    nativeLedgerEntries: (ledger.entries ?? []).length,
  };
  const host = {
    experiment: 'q-host',
    result: 'pass',
    failures: [],
    assertions: [
      { name: 'bundled-worker-and-asset-path-exercised', ok: comparisons.length > 0, detail: 'worker ran from bundled assets' },
      {
        name: 'bundled-assets-verified-by-host',
        ok: assetsMatch,
        detail: `${assetChecks.length} bundled file(s) hashed inside the host and compared with the launcher declaration`,
      },
      {
        name: 'no-network-origin-required',
        ok: deny,
        detail: relay.active
          ? `${build.networkDenial}; display reached through local X11 relay ${relay.path}`
          : build.networkDenial,
      },
    ],
    fixturesTested: 0,
    identity: {
      ...identity('q-host', {
        runId: build.runId,
        command: `${build.hostBinary} --run-spec ${specPath}`,
        fixtures: [],
        artifact: { name: 'desktop-webview', version: 'bundled' },
      }),
      fixturePolicy: 'artifact-only',
    },
    runtime: { os: build.os, webkit: build.webkit, tauri: build.tauri, origin: evidence.webviewOrigin },
    assets: build.assets,
  };
  writeFileSync(join(reportsDir, 'q2-numeric.json'), `${JSON.stringify(q2, null, 2)}\n`, 'utf8');
  writeFileSync(join(reportsDir, 'host.json'), `${JSON.stringify(host, null, 2)}\n`, 'utf8');

  // 6. The raw reports go through the real evaluator, with the Desktop profile selected
  // as explicit launcher input. The roles this pilot does not produce stay gaps; nothing
  // here asserts a full-Q result.
  // The declared fixture set is exactly what this pilot generated: one synthetic tiled
  // COG with the hash the generator recorded. It is a declared subset of the plan's
  // fixture inventory, not a claim to cover the private-original classes.
  const fixtureManifestPath = join(runDir, 'fixture-manifest.json');
  writeFileSync(
    join(runDir, 'fixture-manifest.json'),
    `${JSON.stringify(
      {
        declared: [{ name: basename(manifest.path), sha256: manifest.sha256 }],
        requiredFixtures: { q2: [basename(manifest.path)] },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  const root = resolve(HOST, '../../..');
  const cli = join(root, 'scripts/raster-qualification/ts/dist/src/cli.js');
  const decisionPath = join(runDir, 'decision.json');
  let decisionExit = 0;
  try {
    execFileSync(
      process.execPath,
      [
        cli,
        '--reports', reportsDir,
        '--contract', join(root, 'scripts/raster-qualification/requirements.json'),
        '--pins', join(root, 'scripts/raster-qualification/candidates.json'),
        '--fixture-manifest', fixtureManifestPath,
        '--profile', 'desktop-local',
        '--out', decisionPath,
      ],
      { stdio: 'inherit' },
    );
  } catch (error) {
    decisionExit = typeof error.status === 'number' ? error.status : 1;
  }
  const decision = existsSync(decisionPath)
    ? JSON.parse(readFileSync(decisionPath, 'utf8'))
    : null;
  const requirements = (decision?.requirements ?? []).map((requirement) => ({
    id: requirement.id,
    status: requirement.status,
    failures: requirement.failures ?? [],
    gaps: requirement.gaps ?? [],
  }));
  writeFileSync(
    join(runDir, 'pilot-result.json'),
    `${JSON.stringify(
      {
        runId: build.runId,
        windows: comparisons,
        ledger: { candidateBytes, candidateReads, maxRead, referenceBytes: ledger.reference_bytes ?? 0 },
        workerCounters: counters,
        refusals,
        refusalsAsDeclared,
        ledgerAgrees,
        bundledAssets: { checked: assetChecks.length, allMatch: assetsMatch },
        networkDenial: build.networkDenial,
        x11Relay: relay,
        decisionExit,
        decisionPath,
        requirements,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify({
    runId: build.runId,
    elapsedMs: Date.now() - started,
    reports: reportsDir,
    windows: comparisons,
    candidateBytes,
    referenceBytes: ledger.reference_bytes ?? 0,
    candidateReads,
    maxRead,
    fixtureBytes,
    workerCounters: worker.counters ?? null,
  }, null, 2)}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
