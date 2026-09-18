#!/usr/bin/env node
/**
 * The qualification CLI.
 *
 * It computes one authoritative decision from declared expectations and raw source
 * snapshots, writes a versioned diagnostic decision when the output is writable,
 * and exits zero only on full eligibility.
 *
 * Failures are structured diagnostics, never tracebacks: any unexpected throw is
 * caught and reported with a clear message and a nonzero status.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseJson } from './json.js';
import { validateContract, validateFixtureManifest, validatePinDeclaration } from './declaration.js';
import { DECISION_VERSION, runQualification, type QualificationRequest } from './qualification.js';
import { expectationsForRole } from './declared/route.js';
import { buildDirectoryRequest } from './request.js';

const EXIT_ELIGIBLE = 0;
const EXIT_INELIGIBLE = 1;
const EXIT_INPUT_ERROR = 2;

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args === undefined) {
    process.stderr.write(
      'usage: cli.js --request <request.json> --out <decision.json>\n' +
        '   or: cli.js --reports <dir> --contract <contract.json> [--fixture-manifest <f>] ' +
        '[--pins <candidates.json>] [--now <epoch-seconds>] --out <decision.json>\n',
    );
    return EXIT_INPUT_ERROR;
  }

  /** Files this invocation reads as evidence; none of them may be overwritten. */
  const inputPaths = new Set<string>([
    ...(args.request === undefined ? [] : [args.request]),
    ...(args.contract === undefined ? [] : [args.contract]),
    ...(args.fixtureManifest === undefined ? [] : [args.fixtureManifest]),
    ...(args.pins === undefined ? [] : [args.pins]),
  ]);

  const requestRead = args.request !== undefined
    ? readRequest(args.request)
    : readDirectoryRequest(args);
  if (typeof requestRead === 'string') {
    // A readable but malformed request is a structured input failure. When the
    // destination is writable, the diagnosis is also emitted as a non-qualifying
    // diagnostic document so a reader is not left with stderr alone.
    return reportRejection(requestRead, args, inputPaths);
  }
  const request = requestRead;
  for (const source of request.sources) inputPaths.add(source.path);

  const outcome = runQualification(request);
  if (!outcome.ok) {
    // An evaluator-input failure is reported and never published as a decision:
    // a diagnostic that says "pass" was never computed would be worse than none.
    return reportRejection(outcome.problems.join('\n'), args, inputPaths, outcome.exitCode);
  }

  const serialized = `${JSON.stringify(outcome.decision, replacer, 2)}\n`;
  const collision = outputCollision(args.out, inputPaths);
  if (collision !== undefined) {
    // Writing the decision over one of its own inputs would destroy the evidence it
    // was computed from, so the invocation is refused before anything is written.
    process.stderr.write(`error: ${collision}\n`);
    return EXIT_INPUT_ERROR;
  }
  try {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, serialized, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`error: cannot write decision to ${args.out}: ${detail}\n`);
    return EXIT_INPUT_ERROR;
  }

  const summary = {
    out: args.out,
    verdict: outcome.decision.verdict,
    requirements: outcome.decision.requirements.map((entry) => ({
      id: entry.id,
      verdict: entry.verdict,
    })),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return outcome.decision.verdict === 'pass' ? EXIT_ELIGIBLE : EXIT_INELIGIBLE;
}

/**
 * Whether the destination is one of the files this run read.
 *
 * Compared after resolving both paths, so a relative destination that names an input
 * is caught as well as an absolute one.
 */
function outputCollision(
  out: string,
  inputPaths: ReadonlySet<string>,
): string | undefined {
  const resolved = resolve(out);
  for (const input of inputPaths) {
    if (resolve(input) === resolved) {
      return `the output path ${out} is also an input this run reads, so writing it would overwrite the evidence it was computed from`;
    }
  }
  return undefined;
}

/**
 * Report a rejected input, and record it as a diagnostic when the destination is
 * writable.
 *
 * The document is explicitly a refusal, not a decision: it carries no requirement
 * verdicts and cannot be mistaken for a qualification result.
 */
function reportRejection(
  message: string,
  args: { readonly out: string },
  inputPaths: ReadonlySet<string>,
  exitCode: number = EXIT_INPUT_ERROR,
): number {
  for (const line of message.split('\n')) {
    if (line !== '') process.stderr.write(`${line}\n`);
  }
  const collision = outputCollision(args.out, inputPaths);
  if (collision !== undefined) {
    process.stderr.write(`note: no diagnostic was written because ${collision}\n`);
    return exitCode;
  }
  try {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(
      args.out,
      `${JSON.stringify(
        {
          version: DECISION_VERSION,
          kind: 'rejected-input',
          verdict: 'inconclusive',
          problems: message.split('\n').filter((line) => line !== ''),
          requirements: [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  } catch {
    // The destination is not writable. stderr already carries the diagnosis, and the
    // exit status is already nonzero, so there is nothing further to report.
  }
  return exitCode;
}

/**
 * Make a decision document JSON-safe.
 *
 * Maps become plain objects so the assertion verdicts are visible to a reader
 * rather than serializing to `{}`, and a non-finite number becomes null so the
 * document is valid JSON. Neither transformation changes a verdict.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

interface CliArgs {
  readonly request?: string;
  readonly reports?: string;
  readonly contract?: string;
  readonly fixtureManifest?: string;
  readonly pins?: string;
  readonly now?: string;
  readonly out: string;
}

function parseArgs(argv: readonly string[]): CliArgs | undefined {
  let request: string | undefined;
  let reports: string | undefined;
  let contract: string | undefined;
  let fixtureManifest: string | undefined;
  let pins: string | undefined;
  let now: string | undefined;
  let out: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--request') request = argv[++index];
    else if (arg === '--reports') reports = argv[++index];
    else if (arg === '--contract') contract = argv[++index];
    else if (arg === '--fixture-manifest') fixtureManifest = argv[++index];
    else if (arg === '--pins') pins = argv[++index];
    else if (arg === '--now') now = argv[++index];
    else if (arg === '--out') out = argv[++index];
  }
  if (out === undefined) return undefined;
  if (request === undefined && (reports === undefined || contract === undefined)) return undefined;
  return {
    ...(request === undefined ? {} : { request }),
    ...(reports === undefined ? {} : { reports }),
    ...(contract === undefined ? {} : { contract }),
    ...(fixtureManifest === undefined ? {} : { fixtureManifest }),
    ...(pins === undefined ? {} : { pins }),
    ...(now === undefined ? {} : { now }),
    out,
  };
}

/**
 * Build a request over a report directory.
 *
 * The evaluation time is taken from the caller when supplied, so a decision is
 * reproducible; otherwise the current time is used and recorded in the decision.
 */
function readDirectoryRequest(args: CliArgs): RequestRead {
  const now = args.now === undefined ? Date.now() / 1000 : Number.parseFloat(args.now);
  if (!Number.isFinite(now)) return `error: --now ${String(args.now)} is not a finite time`;
  const built = buildDirectoryRequest({
    reportsDirectory: args.reports!,
    contractPath: args.contract!,
    ...(args.fixtureManifest === undefined ? {} : { fixtureManifestPath: args.fixtureManifest }),
    ...(args.pins === undefined ? {} : { pinsPath: args.pins }),
    now,
  });
  if (!built.ok) return built.problems.join('\n');
  return built.request;
}

type RequestRead = QualificationRequest | string;

function readRequest(path: string): RequestRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `error: cannot read request ${path}: ${detail}`;
  }
  const parsed = parseJson(text, `request ${path}`);
  if (!parsed.ok) return `error: ${parsed.problem}`;
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return `error: request ${path} is not a JSON object`;
  }
  const request = parsed.value as Record<string, unknown>;

  const contractRead = validateContract(request['contract'], 'request contract');
  if (contractRead.verdict !== 'pass' || contractRead.value === undefined) {
    return contractRead.problems.map((problem) => `error: ${problem}`).join('\n');
  }
  const manifestRead = validateFixtureManifest(request['fixtureManifest'], 'fixture manifest');
  const pinsRead = validatePinDeclaration(request['pins'], 'candidate pins');

  const sourcesValue = request['sources'];
  if (!Array.isArray(sourcesValue)) {
    return 'error: request declares no sources list';
  }
  const sources: QualificationRequest['sources'][number][] = [];
  for (const [index, entry] of sourcesValue.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return `error: source ${index} is not an object`;
    }
    const source = entry as Record<string, unknown>;
    const role = source['role'];
    const path_ = source['path'];
    if (typeof role !== 'string' || role.length === 0) {
      return `error: source ${index} has no role`;
    }
    if (typeof path_ !== 'string' || path_.length === 0) {
      return `error: source ${role} has no path`;
    }
    // The role must be one the declared route knows, or nothing could be checked.
    if (expectationsForRole(role) === undefined) {
      return `error: source ${role} has no declared expectations for this role`;
    }
    sources.push({ role, path: path_ });
  }

  const now = request['now'];
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return 'error: request records no finite evaluation time';
  }
  return {
    contract: contractRead.value,
    sources,
    now,
    synthetic: request['synthetic'] === true,
    fixtureManifest: manifestRead,
    pins: pinsRead,
  };
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: qualification failed: ${detail}\n`);
  process.exitCode = EXIT_INPUT_ERROR;
}
