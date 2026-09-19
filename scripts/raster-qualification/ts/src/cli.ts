#!/usr/bin/env node
/**
 * The qualification CLI.
 *
 * It computes one authoritative decision from declared expectations and raw source
 * snapshots and publishes it immutably, or publishes a non-qualifying diagnostic
 * explaining why no decision could be produced. It exits zero only on full
 * eligibility.
 *
 * Publication never replaces an existing path and never writes over a path this
 * invocation read, including on the rejection paths. The complete input set is
 * recovered from the arguments and the request body *before* any validation, so a
 * later validation failure cannot leave the destination unprotected. When the
 * read-set cannot be recovered at all, the requested destination is not used and
 * the diagnostic is published into a fresh directory owned by this invocation.
 *
 * Failures are structured diagnostics, never tracebacks: any unexpected throw is
 * caught and reported with a clear message and a nonzero status.
 */

import { readFileSync } from 'node:fs';
import { parseJson } from './json.js';
import { validateContract, validateFixtureManifest, validatePinDeclaration } from './declaration.js';
import { DECISION_VERSION, runQualification, type QualificationRequest } from './qualification.js';
import { expectationsForRole } from './declared/route.js';
import { buildDirectoryRequest, declaredReportPaths } from './request.js';
import { publish, type PublicationResult } from './publication.js';

const EXIT_ELIGIBLE = 0;
const EXIT_INELIGIBLE = 1;
const EXIT_INPUT_ERROR = 2;

/** What one invocation learned about its inputs before deciding anything. */
interface RequestRead {
  readonly ok: boolean;
  readonly request?: QualificationRequest;
  readonly problems: readonly string[];
  /** Every path this invocation reads: declared paths plus recovered sources. */
  readonly inputs: readonly string[];
  /** False when the source list could not be recovered completely. */
  readonly readSetComplete: boolean;
  /** The evaluation time, when the invocation recorded one. */
  readonly now?: number;
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args === undefined) {
    process.stderr.write(
      'usage: cli.js --request <request.json> --out <decision.json>\n' +
        '   or: cli.js --reports <dir> --contract <contract.json> [--fixture-manifest <f>] ' +
        '[--pins <candidates.json>] [--now <epoch-seconds>] --out <decision.json>\n' +
        '\n' +
        'The destination must not already exist: publication never replaces an existing\n' +
        'path or a path this invocation reads. Use a fresh output path for each run.\n',
    );
    return EXIT_INPUT_ERROR;
  }

  const argumentInputs = [args.request, args.contract, args.fixtureManifest, args.pins].filter(
    (path): path is string => typeof path === 'string',
  );
  const read = args.request !== undefined
    ? readRequest(args.request, argumentInputs)
    : readDirectoryRequest(args, argumentInputs);

  let problems: readonly string[] = read.problems;
  let document: unknown;
  let decisionProduced = false;
  let defects: readonly string[] = [];
  let decisionExit = EXIT_INPUT_ERROR;

  const outcome = read.ok && read.request !== undefined ? runQualification(read.request) : undefined;
  if (outcome !== undefined) {
    if (outcome.ok) {
      document = outcome.decision;
      decisionProduced = true;
      defects = outcome.decision.internalDefects;
      decisionExit = outcome.exitCode;
    } else {
      problems = [...problems, ...outcome.problems];
    }
  }
  for (const problem of problems) {
    for (const line of problem.split('\n')) {
      if (line !== '') process.stderr.write(`${line}\n`);
    }
  }

  const generatedAt = read.now ?? Date.now() / 1000;
  const base = {
    requestedOut: args.out,
    inputs: read.inputs,
    readSetComplete: read.readSetComplete,
    problems,
    version: DECISION_VERSION,
    generatedAt,
  };
  const publication: PublicationResult = decisionProduced
    ? publish({ ...base, kind: 'decision', document })
    : publish({ ...base, kind: 'diagnostic' });
  for (const message of publication.messages) process.stderr.write(`${message}\n`);

  if (publication.problems.length > 0) return EXIT_INPUT_ERROR;
  if (!decisionProduced || publication.publishedKind !== 'decision') return EXIT_INPUT_ERROR;

  const summary = {
    out: publication.publishedPath,
    verdict: (document as { verdict: string }).verdict,
    requirements: (
      (document as { requirements: readonly { id: string; verdict: string }[] }).requirements
    ).map((entry) => ({ id: entry.id, verdict: entry.verdict })),
    ...(defects.length === 0 ? {} : { internalDefects: defects }),
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  // An internal-check defect is not a measured engine failure, so it cannot be
  // reported as one: it is a defect in this tool, and it exits as an input-class
  // failure whatever the reduced verdict happens to be.
  if (defects.length > 0) return EXIT_INPUT_ERROR;
  return decisionExit;
}

/**
 * Build a request over a report directory.
 *
 * The declared report paths are part of the read-set before anything is validated,
 * so a declaration failure cannot leave the destination unprotected.
 */
function readDirectoryRequest(args: CliArgs, argumentInputs: readonly string[]): RequestRead {
  if (args.reports === undefined || args.contract === undefined) {
    return {
      ok: false,
      problems: ['error: directory mode needs both --reports and --contract'],
      inputs: argumentInputs,
      readSetComplete: false,
    };
  }
  const inputs = [...argumentInputs, ...declaredReportPaths(args.reports)];
  const now = args.now === undefined ? Date.now() / 1000 : Number.parseFloat(args.now);
  if (!Number.isFinite(now)) {
    return {
      ok: false,
      problems: [`error: --now ${String(args.now)} is not a finite time`],
      inputs,
      readSetComplete: true,
      now: Date.now() / 1000,
    };
  }
  const built = buildDirectoryRequest({
    reportsDirectory: args.reports,
    contractPath: args.contract,
    ...(args.fixtureManifest === undefined ? {} : { fixtureManifestPath: args.fixtureManifest }),
    ...(args.pins === undefined ? {} : { pinsPath: args.pins }),
    now,
  });
  if (!built.ok) {
    return { ok: false, problems: built.problems, inputs, readSetComplete: true, now };
  }
  return { ok: true, request: built.request, problems: [], inputs, readSetComplete: true, now };
}

/**
 * Every source path the request body declares, read before semantic validation.
 *
 * A structurally readable `sources` list yields every path it records, even when a
 * later entry is unusable or a later validation step fails. An unreadable body
 * leaves the read-set incomplete, which the publisher treats as unsafe rather than
 * as permission.
 */
function recoverSourcePaths(
  request: Record<string, unknown>,
  argumentInputs: readonly string[],
): { readonly paths: readonly string[]; readonly complete: boolean } {
  const paths: string[] = [...argumentInputs];
  const sourcesValue = request['sources'];
  if (!Array.isArray(sourcesValue)) return { paths, complete: false };
  let complete = true;
  for (const entry of sourcesValue) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      complete = false;
      continue;
    }
    const path = (entry as Record<string, unknown>)['path'];
    if (typeof path !== 'string' || path.length === 0) {
      complete = false;
      continue;
    }
    paths.push(path);
  }
  return { paths, complete };
}

function readRequest(path: string, argumentInputs: readonly string[]): RequestRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      problems: [`error: cannot read request ${path}: ${message}`],
      inputs: argumentInputs,
      readSetComplete: false,
    };
  }
  // The read-set is recovered from the same parse the validation uses: the bytes
  // are never read twice, so the safety decision cannot disagree with the parse.
  const parsed = parseJson(text, `request ${path}`);
  if (!parsed.ok) {
    return {
      ok: false,
      problems: [`error: ${parsed.problem}`],
      inputs: argumentInputs,
      readSetComplete: false,
    };
  }
  if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
    return {
      ok: false,
      problems: [`error: request ${path} is not a JSON object`],
      inputs: argumentInputs,
      readSetComplete: false,
    };
  }
  const request = parsed.value as Record<string, unknown>;
  const recovered = recoverSourcePaths(request, argumentInputs);
  const inputs = [path, ...recovered.paths];
  const readSetComplete = recovered.complete;

  const contractRead = validateContract(request['contract'], 'request contract');
  if (contractRead.verdict !== 'pass' || contractRead.value === undefined) {
    return {
      ok: false,
      problems: contractRead.problems.map((problem) => `error: ${problem}`),
      inputs,
      readSetComplete,
    };
  }
  const manifestRead = validateFixtureManifest(request['fixtureManifest'], 'fixture manifest');
  const pinsRead = validatePinDeclaration(request['pins'], 'candidate pins');

  const sourcesValue = request['sources'];
  if (!Array.isArray(sourcesValue)) {
    return { ok: false, problems: ['error: request declares no sources list'], inputs, readSetComplete };
  }
  const sources: QualificationRequest['sources'][number][] = [];
  for (const [index, entry] of sourcesValue.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return {
        ok: false,
        problems: [`error: source ${index} is not an object`],
        inputs,
        readSetComplete,
      };
    }
    const source = entry as Record<string, unknown>;
    const role = source['role'];
    const sourcePath = source['path'];
    if (typeof role !== 'string' || role.length === 0) {
      return { ok: false, problems: [`error: source ${index} has no role`], inputs, readSetComplete };
    }
    if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
      return { ok: false, problems: [`error: source ${role} has no path`], inputs, readSetComplete };
    }
    // The role must be one the declared route knows, or nothing could be checked.
    if (expectationsForRole(role) === undefined) {
      return {
        ok: false,
        problems: [`error: source ${role} has no declared expectations for this role`],
        inputs,
        readSetComplete,
      };
    }
    sources.push({ role, path: sourcePath });
  }

  const now = request['now'];
  if (typeof now !== 'number' || !Number.isFinite(now)) {
    return {
      ok: false,
      problems: ['error: request records no finite evaluation time'],
      inputs,
      readSetComplete,
    };
  }
  return {
    ok: true,
    request: {
      contract: contractRead.value,
      sources,
      now,
      synthetic: request['synthetic'] === true,
      fixtureManifest: manifestRead,
      pins: pinsRead,
    },
    problems: [],
    inputs,
    readSetComplete,
    now,
  };
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

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: qualification failed: ${detail}\n`);
  process.exitCode = EXIT_INPUT_ERROR;
}
