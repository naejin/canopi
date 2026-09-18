/**
 * Building the declared qualification request for a report directory.
 *
 * The runner and the CLI share this so the roles, paths, contract, declarations and
 * evaluation time are declared in one place. A caller supplies a report directory
 * and the declaration files; everything the sources are checked against still comes
 * from the declared route, never from the reports.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJson } from './json.js';
import { validateContract, validateFixtureManifest, validatePinDeclaration } from './declaration.js';
import type { QualificationRequest } from './qualification.js';

/** The report file each role is read from, matching the producer's own naming. */
export const REPORT_FILES: ReadonlyMap<string, string> = new Map([
  ['q1', 'q1-artifacts.json'],
  ['q2', 'q2-numeric.json'],
  ['q3prepare', 'q3-prepare.json'],
  ['q3members', 'q3-members.json'],
  ['q4slope', 'q4-slope.json'],
  ['q4crs', 'q4-crs.json'],
  ['q5lifecycle', 'q5-lifecycle.json'],
  ['q6resources', 'q6-resources.json'],
  ['trace', 'q6-trace.json'],
]);

export interface DirectoryRequestOptions {
  readonly reportsDirectory: string;
  readonly contractPath: string;
  readonly fixtureManifestPath?: string;
  readonly pinsPath?: string;
  readonly now: number;
}

export type RequestBuild =
  | { ok: true; request: QualificationRequest }
  | { ok: false; problems: readonly string[] };

/**
 * Assemble a request over every declared report role in a directory.
 *
 * The contract is validated here rather than trusted, and a declaration input that
 * is malformed stops the run. A missing declaration file is passed through as a
 * gap, because absence and malformation are different findings.
 */
export function buildDirectoryRequest(options: DirectoryRequestOptions): RequestBuild {
  const problems: string[] = [];

  const contractRead = readJson(options.contractPath);
  if (!contractRead.ok) return { ok: false, problems: [contractRead.problem] };
  const contract = validateContract(contractRead.value, options.contractPath);
  if (contract.verdict !== 'pass' || contract.value === undefined) {
    return { ok: false, problems: contract.problems.map((p) => `invalid declaration: ${p}`) };
  }

  let manifest: unknown;
  if (options.fixtureManifestPath !== undefined) {
    const read = readJson(options.fixtureManifestPath);
    if (!read.ok) return { ok: false, problems: [read.problem] };
    manifest = read.value;
  }
  const manifestRead = validateFixtureManifest(manifest, 'fixture manifest');

  let pins: unknown;
  if (options.pinsPath !== undefined) {
    const read = readJson(options.pinsPath);
    if (!read.ok) return { ok: false, problems: [read.problem] };
    const payload = read.value;
    // The candidates file carries the pins under a named key, so the declaration is
    // read from where the file actually records it.
    pins =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)['pinnedSourceCommits']
        : payload;
  }
  const pinsRead = validatePinDeclaration(pins, 'candidate pins');

  if (manifestRead.verdict === 'fail') {
    problems.push(...manifestRead.problems.map((p) => `invalid declaration: ${p}`));
  }
  if (pinsRead.verdict === 'fail') {
    problems.push(...pinsRead.problems.map((p) => `invalid declaration: ${p}`));
  }
  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    request: {
      contract: contract.value,
      fixtureManifest: manifestRead,
      pins: pinsRead,
      now: options.now,
      sources: Array.from(REPORT_FILES, ([role, file]) => ({
        role,
        path: join(options.reportsDirectory, file),
      })),
    },
  };
}

type JsonRead = { ok: true; value: unknown } | { ok: false; problem: string };

function readJson(path: string): JsonRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, problem: `error: cannot read ${path}: ${detail}` };
  }
  const parsed = parseJson(text, path);
  if (!parsed.ok) return { ok: false, problem: `error: ${parsed.problem}` };
  return { ok: true, value: parsed.value };
}
