/**
 * The pilot launcher: one owned run, one terminal path, one honest exit code.
 *
 * The launcher owns the run root, the declared plan, the artifact set and the terminal
 * classification. Process and filesystem specifics live behind `PilotEnvironment`, so
 * the launcher's own behaviour — what it publishes, what it reports and which exit
 * code it returns — is decided here and exercised here by the same code path the real
 * run uses.
 *
 * Exit codes are the launcher's own, deliberately not the evaluator's whole-Q result:
 *
 * * `0` — this bounded pilot completed, its required comparisons and safety checks
 *   passed, a current-run decision was published, Q-LOCAL-1 and Q-HOST-1 pass, and no
 *   evaluated requirement fails. The other requirements may stay inconclusive: ten of
 *   the twelve have no producer in this pilot, which is expected and is not a failure.
 * * `1` — a pilot measurement or required check failed, or required positive evidence
 *   is incomplete. Failures and gaps are preserved separately.
 * * `2` — an instrument failure: build, input, host launch, timeout, cancellation,
 *   malformed evidence, publication or evaluator. Nothing about the engine is claimed.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DECISION_VERSION } from '../qualification.js';
import { producePilotReports, PILOT_PROFILE, type PilotOutcome, type RunDescriptor } from './producer.js';
import { publishRunArtifacts, type RunArtifact } from './artifacts.js';
import { createRunLog, createRunRoot, type RunLog, type RunRoot } from './runRoot.js';
import { fixtureManifestDocument, PILOT_WINDOWS, pilotRefusals, runSpecDocument } from './plan.js';

export const EXIT_COMPLETED = 0;
export const EXIT_MEASUREMENT = 1;
export const EXIT_INSTRUMENT = 2;

/** The pilot's safety deadline, excluding compilation. */
export const PILOT_DEADLINE_MS = 10 * 60 * 1000;
/** The host log's byte bound. The log is diagnostic output, never evidence. */
export const PILOT_LOG_LIMIT_BYTES = 4 * 1024 * 1024;
/** The generated-fixture and run-output cap. */
export const PILOT_OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;

export interface BuildRequest {
  readonly repoRoot: string;
  readonly bench: string;
  readonly runRoot: RunRoot;
  readonly buildRoot: string;
}

export interface BuildOutcome {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly hostBinary?: string;
  /** The prepared fixture, hashed by the launcher's own preparation step. */
  readonly fixture?: { readonly name: string; readonly sha256: string; readonly bytes: number; readonly path: string };
  readonly engine?: { readonly name: string; readonly version: string };
  readonly frontendDigests?: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly runtime?: { readonly os: string; readonly webkit: string; readonly tauri: string };
}

export interface DisplayOutcome {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** A description of the display path, for the host report. */
  readonly detail?: string;
  readonly release?: () => { readonly ok: boolean; readonly problems: readonly string[] };
}

export interface HostRequest {
  readonly binary: string;
  readonly specPath: string;
  readonly runRoot: RunRoot;
  readonly log: RunLog;
  readonly deadlineMs: number;
  readonly networkDeny: boolean;
}

export interface HostOutcome {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** The raw evidence document the host published, already parsed. */
  readonly evidence?: unknown;
  /** A text digest of the raw evidence file, for the result summary. */
  readonly evidenceDigest?: string;
}

export interface EvaluateRequest {
  readonly cli: string;
  readonly reportsPath: string;
  readonly contractPath: string;
  readonly pinsPath: string;
  readonly fixtureManifestPath: string;
  readonly profile: string;
  readonly nowSeconds: number;
  readonly out: string;
  readonly inputs: readonly string[];
}

export interface EvaluationOutcome {
  readonly ok: boolean;
  readonly problems: readonly string[];
  readonly exitCode?: number;
  readonly decision?: unknown;
  /** Where the evaluator published its document, when it published one. */
  readonly decisionPath?: string;
}

/** Everything the launcher cannot own itself: preparation, host and evaluator. */
export interface PilotEnvironment {
  build(request: BuildRequest): Promise<BuildOutcome>;
  display(networkDeny: boolean): Promise<DisplayOutcome>;
  runHost(request: HostRequest): Promise<HostOutcome>;
  evaluate(request: EvaluateRequest): Promise<EvaluationOutcome>;
  /** Release anything a signal handler must stop. Safe to call more than once. */
  abort(): void;
}

export interface PilotRequest {
  readonly repoRoot: string;
  readonly runDir: string;
  readonly bench: string;
  readonly buildRoot: string;
  readonly networkDeny: boolean;
  readonly deadlineMs?: number;
  readonly command: string;
  readonly contractPath: string;
  readonly pinsPath: string;
  /** The evaluator CLI this invocation compiled and will run, never a stale build. */
  readonly evaluatorCli: string;
  /** Injected so a test is deterministic; the real launcher passes the wall clock. */
  readonly now: () => number;
}

export interface PilotResult {
  readonly exitCode: number;
  readonly runId: string;
  readonly runRoot?: string;
  readonly problems: readonly string[];
  readonly failures: readonly string[];
  readonly gaps: readonly string[];
  readonly published: readonly string[];
  readonly summary: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The sha256 the evaluator records for a source file, over its text. */
export function sourceDigest(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/** Every evidence digest the decision records for one requirement. */
export function requirementDigests(decision: Record<string, unknown>, id: string): string[] {
  const requirements = Array.isArray(decision['requirements']) ? decision['requirements'] : [];
  const found = requirements.find(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry['id'] === id,
  );
  if (found === undefined) return [];
  const checks = Array.isArray(found['checks']) ? found['checks'] : [];
  const digests: string[] = [];
  for (const check of checks) {
    if (!isRecord(check)) continue;
    const evidence = check['evidence'];
    if (!Array.isArray(evidence)) continue;
    for (const reference of evidence) {
      if (!isRecord(reference)) continue;
      if (typeof reference['digest'] === 'string') digests.push(reference['digest']);
    }
  }
  return digests;
}

/** The requirement verdicts, as the decision records them. */
export function requirementVerdicts(decision: Record<string, unknown>): Map<string, string> {
  const verdicts = new Map<string, string>();
  const requirements = Array.isArray(decision['requirements']) ? decision['requirements'] : [];
  for (const entry of requirements) {
    if (!isRecord(entry)) continue;
    const id = entry['id'];
    const verdict = entry['verdict'];
    if (typeof id === 'string' && typeof verdict === 'string') verdicts.set(id, verdict);
  }
  return verdicts;
}

/** The decision summary the pilot preserves, verdicts and reasons included. */
export function summariseDecision(decision: Record<string, unknown>): Record<string, unknown> {
  const requirements = Array.isArray(decision['requirements']) ? decision['requirements'] : [];
  return {
    verdict: decision['verdict'],
    profile: decision['profile'],
    version: decision['version'],
    synthetic: decision['synthetic'],
    internalDefects: decision['internalDefects'] ?? [],
    requirements: requirements.map((entry) => {
      const record = isRecord(entry) ? entry : {};
      return { id: record['id'], verdict: record['verdict'], reasons: record['reasons'] ?? [] };
    }),
  };
}

/**
 * Run one bounded pilot.
 *
 * One terminal path, not a set of early returns: the result is assembled once, all
 * owned resources are released in `finally`, and a cleanup failure is reported beside
 * the failure that caused it rather than replacing it. The function never throws for
 * an expected failure.
 */
export async function runPilot(request: PilotRequest, environment: PilotEnvironment): Promise<PilotResult> {
  const deadlineMs = request.deadlineMs ?? PILOT_DEADLINE_MS;
  const startedAt = request.now();
  const runId = `pilot-${startedAt}-${process.pid}`;
  const problems: string[] = [];
  const failures: string[] = [];
  const gaps: string[] = [];
  const published: string[] = [];

  let runRoot: RunRoot | undefined;
  let log: RunLog | undefined;
  let releaseDisplay: (() => { readonly ok: boolean; readonly problems: readonly string[] }) | undefined;
  let outcome: PilotOutcome | undefined;
  let decision: Record<string, unknown> | undefined;
  let decisionSummary: Record<string, unknown> | undefined;
  let measurementSummary: Record<string, unknown> | undefined;
  let hostDetail: Record<string, unknown> | undefined;
  let exitCode = EXIT_INSTRUMENT;
  let runDirectory: string | undefined;

  try {
    const created = createRunRoot(request.runDir);
    if (!created.ok) {
      problems.push(...created.problems);
      return {
        exitCode: EXIT_INSTRUMENT,
        runId,
        problems,
        failures,
        gaps,
        published,
        summary: { runId, instrumentProblems: problems },
      };
    }
    runRoot = created.root;
    runDirectory = runRoot.path;
    log = createRunLog(runRoot.logPath, PILOT_LOG_LIMIT_BYTES);

    const display = await environment.display(request.networkDeny);
    if (!display.ok) {
      problems.push(...display.problems);
      return finish();
    }
    releaseDisplay = display.release;

    const build = await environment.build({
      repoRoot: request.repoRoot,
      bench: request.bench,
      runRoot,
      buildRoot: request.buildRoot,
    });
    if (!build.ok || build.hostBinary === undefined || build.fixture === undefined) {
      problems.push(...(build.problems.length > 0 ? build.problems : ['the build produced no host executable']));
      return finish();
    }
    const fixture = build.fixture;
    if (fixture.bytes > PILOT_OUTPUT_LIMIT_BYTES) {
      problems.push(
        `the generated fixture is ${fixture.bytes} byte(s), above this pilot's ${PILOT_OUTPUT_LIMIT_BYTES}-byte cap`,
      );
      return finish();
    }

    const bundledAssets = build.frontendDigests ?? [];
    const descriptor: RunDescriptor = {
      runId,
      command: request.command,
      recordedAt: Math.floor(startedAt / 1000),
      headerBytes: 65_536,
      fixture: { name: fixture.name, sha256: fixture.sha256, bytes: fixture.bytes },
      windows: PILOT_WINDOWS,
      refusals: pilotRefusals(fixture.bytes),
      engine: build.engine ?? { name: 'whitebox-wasm', version: 'unknown' },
      bundledAssets,
      networkDenial: request.networkDeny
        ? 'unshare -rn (network namespace); no interface other than loopback'
        : 'NOT exercised',
      x11Relay: display.detail ?? 'no display relay',
    };

    const buildDocument = {
      runId,
      host: 'desktop-webview',
      environment: 'qualification-host-desktop-local-v1',
      os: build.runtime?.os ?? 'unknown',
      webkit: build.runtime?.webkit ?? 'unknown',
      tauri: build.runtime?.tauri ?? 'unknown',
      hostBinary: build.hostBinary,
      engine: descriptor.engine,
      bundledFiles: bundledAssets.map((asset) => `${asset.path} ${asset.sha256} ${asset.bytes}`),
      networkDenial: descriptor.networkDenial,
      x11Relay: descriptor.x11Relay,
      fixture: { name: fixture.name, sha256: fixture.sha256, bytes: fixture.bytes },
    };
    const specDocument = runSpecDocument({
      runId,
      runDirectory: runRoot.path,
      fixture: { name: fixture.name, sha256: fixture.sha256 },
      fixturePath: fixture.path,
      assetBase: '/wb',
      wasmUrl: '/wb/whitebox_wasm_bg.wasm',
      headerBytes: descriptor.headerBytes,
      // Cooperative cancellation happens a minute before the hard deadline, so a
      // cancelled run can still publish why it stopped.
      deadlineMs: Math.max(1_000, deadlineMs - 60_000),
      bundledAssets,
      fixtureBytes: fixture.bytes,
    });
    const manifestDocument = fixtureManifestDocument({ name: fixture.name, sha256: fixture.sha256 });

    const specPath = runRoot.artifactPath('run-spec.json');
    const prepared = publishRunArtifacts(runRoot, [
      { name: 'host-build.json', document: buildDocument },
      { name: 'run-spec.json', document: specDocument },
      { name: 'fixture-manifest.json', document: manifestDocument },
    ]);
    published.push(...prepared.published);
    if (prepared.problems.length > 0) {
      problems.push(...prepared.problems);
      return finish();
    }

    const host = await environment.runHost({
      binary: build.hostBinary,
      specPath,
      runRoot,
      log,
      deadlineMs,
      networkDeny: request.networkDeny,
    });
    if (!host.ok || host.evidence === undefined) {
      problems.push(...(host.problems.length > 0 ? host.problems : ['the host produced no evidence document']));
      return finish();
    }

    outcome = producePilotReports({ descriptor, hostEvidence: host.evidence });
    hostDetail = isRecord(host.evidence) ? host.evidence : undefined;
    if (outcome.instrumentProblems.length > 0) {
      problems.push(...outcome.instrumentProblems);
      return finish();
    }
    failures.push(...outcome.failures);
    gaps.push(...outcome.gaps);

    const reports = outcome.reports;
    if (reports === undefined) {
      problems.push('the producer decided there was nothing to publish');
      return finish();
    }
    const ledger = isRecord(hostDetail?.['nativeLedger']) ? hostDetail['nativeLedger'] : undefined;
    const artifacts: RunArtifact[] = [
      { name: 'q2-numeric.json', document: reports.q2, area: 'reports' },
      { name: 'host.json', document: reports.host, area: 'reports' },
      // `host-evidence.json` is published by the host itself, atomically and without
      // replacement, inside this run's own directory. Republishing it here would either
      // replace the host's own document or fail, so the launcher only derives the
      // ledger view from it.
      ...(ledger === undefined ? [] : [{ name: 'native-ledger.json', document: ledger }]),
    ];
    const reportPublication = publishRunArtifacts(runRoot, artifacts);
    published.push(...reportPublication.published);
    if (reportPublication.problems.length > 0) {
      problems.push(...reportPublication.problems);
      return finish();
    }

    measurementSummary = measurementReport(outcome, host.evidenceDigest);
    if (failures.length > 0 || gaps.length > 0) {
      exitCode = EXIT_MEASUREMENT;
      return finish();
    }

    // The reports are this run's, so the evaluator decides them. Its own exit code is
    // not this launcher's exit code: a coherent incomplete-Q decision exits 1 there and
    // is entirely expected here.
    const decisionPath = runRoot.artifactPath('decision.json');
    const evaluation = await environment.evaluate({
      cli: request.evaluatorCli,
      reportsPath: runRoot.reportsPath,
      contractPath: request.contractPath,
      pinsPath: request.pinsPath,
      fixtureManifestPath: runRoot.artifactPath('fixture-manifest.json'),
      profile: PILOT_PROFILE,
      nowSeconds: descriptor.recordedAt,
      out: decisionPath,
      inputs: [request.contractPath, request.pinsPath, runRoot.artifactPath('fixture-manifest.json')],
    });
    if (evaluation.problems.length > 0) {
      problems.push(...evaluation.problems);
      return finish();
    }
    if (!isRecord(evaluation.decision)) {
      problems.push(
        `the evaluator produced no usable decision (exit ${String(evaluation.exitCode ?? 'unknown')}); a pilot run is only summarised from a published decision`,
      );
      return finish();
    }
    decision = evaluation.decision;

    // Correspondence: the decision must have been computed from the reports this run
    // wrote. A decision over an older report set would otherwise be summarised as this
    // run's result.
    const correspondence = decisionCorrespondence(runRoot, decision, [
      ['Q-LOCAL-1', 'q2-numeric.json'],
      ['Q-HOST-1', 'host.json'],
    ]);
    if (correspondence.length > 0) {
      problems.push(...correspondence);
      return finish();
    }
    if (decision['kind'] === 'rejected-input') {
      problems.push('the evaluator published a rejected-input diagnostic rather than a decision');
      return finish();
    }
    if (decision['version'] !== DECISION_VERSION) {
      problems.push(
        `the decision records version ${String(decision['version'])}, but this launcher summarises version ${DECISION_VERSION}`,
      );
      return finish();
    }
    if (decision['profile'] !== PILOT_PROFILE) {
      problems.push(
        `the decision records profile ${JSON.stringify(decision['profile'])}, but this pilot declares ${PILOT_PROFILE}`,
      );
      return finish();
    }

    decisionSummary = summariseDecision(decision);
    const verdicts = requirementVerdicts(decision);
    const failing = [...verdicts].filter(([, verdict]) => verdict === 'fail');
    if (failing.length > 0) {
      failures.push(
        `the evaluator measured a failure in ${failing.map(([id]) => id).join(', ')}`,
      );
      exitCode = EXIT_MEASUREMENT;
      return finish();
    }
    const missing = ['Q-LOCAL-1', 'Q-HOST-1'].filter((id) => verdicts.get(id) !== 'pass');
    if (missing.length > 0) {
      gaps.push(
        `required positive pilot evidence is incomplete: ${missing
          .map((id) => `${id} is ${verdicts.get(id) ?? 'absent'}`)
          .join(', ')}`,
      );
      exitCode = EXIT_MEASUREMENT;
      return finish();
    }
    exitCode = EXIT_COMPLETED;
    return finish();
  } catch (error) {
    problems.push(`the pilot failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
    return finish();
  } finally {
    log?.close();
    releaseOwnedResources();
  }

  /** Release the display relay exactly once, folding a cleanup failure into the result. */
  function releaseOwnedResources(): void {
    if (releaseDisplay === undefined) return;
    const release = releaseDisplay;
    releaseDisplay = undefined;
    const released = release();
    for (const problem of released.problems) problems.push(`cleanup: ${problem}`);
  }

  /** The single terminal path: publish what is known, then classify. */
  function finish(): PilotResult {
    // Cleanup happens before classification, so a cleanup failure cannot be lost
    // behind a success that was decided a moment earlier.
    releaseOwnedResources();
    const resultDocument = {
      runId,
      exitCode,
      instrumentProblems: problems,
      failures,
      gaps,
      measurement: measurementSummary ?? null,
      decision: decisionSummary ?? null,
      host: hostDetail === null || hostDetail === undefined
        ? null
        : {
            origin: hostDetail['webviewOrigin'],
            handlesRevoked: hostDetail['handlesRevoked'],
            bundledAssets: Array.isArray(hostDetail['bundledAssets']) ? hostDetail['bundledAssets'].length : 0,
          },
      log: log === undefined ? null : { bytes: log.bytesWritten, truncated: log.truncated },
    };
    if (runRoot !== undefined) {
      const publication = publishRunArtifacts(runRoot, [{ name: 'pilot-result.json', document: resultDocument }]);
      published.push(...publication.published);
      if (publication.problems.length > 0) {
        // A publication failure is an instrument failure whatever else happened, and
        // it is reported beside the original problems rather than instead of them.
        exitCode = EXIT_INSTRUMENT;
        problems.push(...publication.problems);
      }
    }
    const summary: Record<string, unknown> = {
      runId,
      exitCode,
      runDirectory: runDirectory ?? null,
      instrumentProblems: problems,
      failures,
      gaps,
      published: [...published],
      measurement: measurementSummary ?? null,
      decision: decisionSummary ?? null,
      log: log === undefined ? null : { bytes: log.bytesWritten, truncated: log.truncated },
    };
    const finalExit = problems.length > 0 ? EXIT_INSTRUMENT : exitCode;
    summary['exitCode'] = finalExit;
    return {
      exitCode: finalExit,
      runId,
      ...(runDirectory === undefined ? {} : { runRoot: runDirectory }),
      problems,
      failures,
      gaps,
      published,
      summary,
    };
  }
}

/** The measurement summary the run result records. */
function measurementReport(outcome: PilotOutcome, evidenceDigest: string | undefined): Record<string, unknown> {
  return {
    windows: outcome.measurement.windows,
    declaredWindows: outcome.measurement.declaredWindows,
    measuredWindows: outcome.measurement.measuredWindows,
    cells: outcome.measurement.cells,
    expectedCells: outcome.measurement.expectedCells,
    nodataCells: outcome.measurement.nodataCells,
    expectedNodataCells: outcome.measurement.expectedNodataCells,
    ledger: outcome.measurement.ledger,
    refusals: outcome.measurement.refusals,
    bundledAssets: outcome.measurement.bundledAssets,
    ...(outcome.measurement.workerError === undefined ? {} : { workerError: outcome.measurement.workerError }),
    ...(evidenceDigest === undefined ? {} : { hostEvidenceDigest: evidenceDigest }),
  };
}

/**
 * Check that the decision was computed from this run's reports.
 *
 * The evaluator records the digest of every source it read, so a decision that does
 * not cite the bytes this run published is not this run's decision, whatever its
 * verdict says.
 */
function decisionCorrespondence(
  runRoot: RunRoot,
  decision: Record<string, unknown>,
  roles: readonly (readonly [string, string])[],
): string[] {
  const problems: string[] = [];
  for (const [requirement, file] of roles) {
    let text: string;
    try {
      text = readFileSync(runRoot.reportPath(file), 'utf8');
    } catch (error) {
      problems.push(`cannot read the published ${file} for correspondence: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const digests = requirementDigests(decision, requirement);
    if (!digests.includes(sourceDigest(text))) {
      problems.push(
        `the decision for ${requirement} cites no evidence digest matching this run's ${file}, so it was not computed from these reports`,
      );
    }
  }
  return problems;
}
