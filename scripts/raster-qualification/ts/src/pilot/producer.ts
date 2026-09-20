/**
 * The Desktop pilot producer.
 *
 * This module turns one declared run specification plus the host's raw evidence into
 * the two reports the evaluator reads, and nothing else. It performs no I/O and
 * starts no process, so the caller cannot influence what the evidence means: the
 * declared requests and the raw observations are both inputs, and either can fail.
 *
 * The rule that shapes the whole module: **an observation is never filled in from
 * the request**. A window is measured only when the host returned a record for it
 * that matches the declared identity and dimensions exactly and carries exactly the
 * declared number of values. Everything else is a named failure or a named gap, and
 * the counts in the report are counts of what was actually validated.
 *
 * Failures and gaps are deliberately different. A failure is a decided violation and
 * becomes an assertion with `ok: false`; a gap is missing or undecided evidence and
 * becomes an assertion with no `ok` at all, which the evaluator already reads as
 * inconclusive. Neither is ever silently converted into the other.
 */

import { LOCAL_BRIDGE_TRANSPORT, QUALIFICATION_ROUTE_ID } from '../declared/route.js';
import { profileDeclaration, profileRole, type QualificationProfile } from '../declared/profiles.js';

/** The profile this producer's reports are written for. */
export const PILOT_PROFILE: QualificationProfile = 'desktop-local';

/** One window the launcher declared. It is the only request the producer accepts. */
export interface DeclaredWindow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** One refused-read control the launcher declared. */
export interface DeclaredRefusal {
  readonly id: string;
  /** The request identity the worker must use for this control. */
  readonly requestId: string;
  readonly offset: number;
  readonly length: number;
  readonly expected: string;
  readonly handle?: number;
}

/** One asset the launcher bundled and the host re-hashed inside its own binary. */
export interface DeclaredAsset {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Everything the launcher declares before the host runs. */
export interface RunDescriptor {
  readonly runId: string;
  readonly command: string;
  readonly recordedAt: number;
  readonly headerBytes: number;
  readonly fixture: { readonly name: string; readonly sha256: string; readonly bytes: number };
  readonly windows: readonly DeclaredWindow[];
  readonly refusals: readonly DeclaredRefusal[];
  readonly engine: { readonly name: string; readonly version: string };
  readonly bundledAssets: readonly DeclaredAsset[];
  readonly networkDenial: string;
  readonly x11Relay: string;
}

/** One validated observed window, and what comparing it to the oracle found. */
export interface MeasuredWindow {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cells: number;
  readonly nodataCells: number;
  readonly mismatches: number;
  readonly validityMismatches: number;
  readonly zeroValues: number;
  readonly negativeValues: number;
}

export interface PilotMeasurement {
  readonly windows: readonly MeasuredWindow[];
  readonly declaredWindows: number;
  readonly measuredWindows: number;
  readonly cells: number;
  readonly expectedCells: number;
  readonly nodataCells: number;
  readonly expectedNodataCells: number;
  readonly ledger: {
    readonly candidateBytes: number;
    readonly candidateReads: number;
    readonly maxRead: number;
    readonly referenceBytes: number;
    readonly fixtureBytes: number;
    readonly reconciles: boolean;
    readonly detail: string;
  };
  readonly refusals: {
    readonly declared: number;
    readonly matched: number;
    readonly results: readonly {
      readonly id: string;
      readonly requestId: string;
      readonly expected: string;
      readonly observed: string;
    }[];
  };
  readonly bundledAssets: {
    readonly declared: number;
    readonly verified: number;
    readonly detail: string;
  };
  readonly workerError?: string;
}

export interface PilotOutcome {
  /**
   * The launcher could not read its own host evidence as the declared run. Nothing is
   * published and the caller exits as an instrument failure, because no statement
   * about the measurement can be made from a document that is not this run's.
   */
  readonly instrumentProblems: readonly string[];
  /** Decided violations of the declared contract. */
  readonly failures: readonly string[];
  /** Required positive evidence that is absent or undecided. */
  readonly gaps: readonly string[];
  /** Present only when the raw evidence was readable as this run's own. */
  readonly reports?: { readonly q2: unknown; readonly host: unknown };
  readonly measurement: PilotMeasurement;
}

/* -------------------------------------------------------------------------- *
 * The plane the pilot generates, expressed independently of the generator.
 *
 * The generator writes these bytes and this oracle reads them. They are separate
 * implementations of the same specification on purpose: an oracle that shares its
 * code with the thing under test cannot disagree with it.
 * -------------------------------------------------------------------------- */

/** The nodata sentinel the plane is written with. */
export const PILOT_NODATA = -9999;
/** The two cells the plane writes as nodata, as `[column, row]`. */
export const PILOT_HOLES: readonly (readonly [number, number])[] = [
  [100, 100],
  [1024, 1024],
];
/** The plane's value at a cell, as specified. */
export function pilotValue(column: number, row: number): number {
  return column - row;
}
/** The declared value at a cell, nodata included. */
export function pilotExpectation(column: number, row: number): number {
  return PILOT_HOLES.some(([x, y]) => x === column && y === row) ? PILOT_NODATA : pilotValue(column, row);
}

/* -------------------------------------------------------------------------- *
 * Validation helpers. Everything crossing into this module is unknown input.
 * -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}

/** A whole, safe, non-negative number, or undefined. */
function wholeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * One observed window as the host returned it.
 *
 * `values` keeps a `null` entry as `NaN`: JSON cannot carry a non-finite number, and
 * the worker writes `NaN` for a cell it could not fill. The distinction between
 * "NaN because the host said so" and "NaN because the record was malformed" is made
 * during parsing, not afterwards.
 */
interface ObservedWindow {
  readonly id: string;
  readonly record: Record<string, unknown>;
  readonly values: readonly number[];
}

/* -------------------------------------------------------------------------- *
 * Window coverage.
 * -------------------------------------------------------------------------- */

interface CoverageOutcome {
  readonly measured: readonly MeasuredWindow[];
  readonly failures: readonly string[];
  readonly gaps: readonly string[];
  readonly cells: number;
  readonly expectedCells: number;
  readonly nodataCells: number;
  readonly expectedNodataCells: number;
  readonly zeroValues: number;
  readonly negativeValues: number;
}

/** Read the observed window list, rejecting records that cannot identify a window. */
function parseObservedWindows(raw: unknown, failures: string[]): ObservedWindow[] {
  if (!Array.isArray(raw)) {
    failures.push(`the host result records windows as ${describe(raw)}, not a list`);
    return [];
  }
  const observed: ObservedWindow[] = [];
  const seen = new Map<string, number>();
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      failures.push(`window record ${index} is ${describe(entry)}, not an object`);
      return;
    }
    const id = nonEmptyString(entry['id']);
    if (id === undefined) {
      failures.push(`window record ${index} has no usable id`);
      return;
    }
    const previous = seen.get(id);
    if (previous !== undefined) {
      failures.push(
        `window ${JSON.stringify(id)} was returned by records ${previous} and ${index}; a window identity must be observed exactly once`,
      );
      return;
    }
    seen.set(id, index);
    const rawValues = entry['values'];
    if (!Array.isArray(rawValues)) {
      failures.push(`window ${JSON.stringify(id)} records its values as ${describe(rawValues)}, not a list`);
      return;
    }
    const values: number[] = [];
    let malformed = false;
    rawValues.forEach((value, cell) => {
      if (value === null) {
        // JSON's only representation of the non-finite value the worker writes.
        values.push(Number.NaN);
        return;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        if (!malformed) {
          failures.push(
            `window ${JSON.stringify(id)} value ${cell} is ${describe(value)}, which is not a usable sample`,
          );
          malformed = true;
        }
        values.push(Number.NaN);
        return;
      }
      values.push(value);
    });
    observed.push({ id, record: entry, values });
  });
  return observed;
}

/**
 * Compare the declared windows with the observed ones.
 *
 * A declared window with no matching observation is a gap: the run is incomplete, not
 * wrong. A record that disagrees about identity or dimensions, or that carries the
 * wrong number of values, is a failure, and coverage never falls back to the request.
 */
function coverWindows(
  declared: readonly DeclaredWindow[],
  observed: readonly ObservedWindow[],
  failures: string[],
  gaps: string[],
): CoverageOutcome {
  const declaredIds = new Set(declared.map((window) => window.id));
  const byId = new Map(observed.map((window) => [window.id, window]));
  for (const window of observed) {
    if (!declaredIds.has(window.id)) {
      failures.push(
        `the host returned window ${JSON.stringify(window.id)}, which this run never requested`,
      );
    }
  }

  const measured: MeasuredWindow[] = [];
  let cells = 0;
  let nodataCells = 0;
  let zeroValues = 0;
  let negativeValues = 0;
  let expectedCells = 0;
  let expectedNodataCells = 0;

  for (const request of declared) {
    expectedCells += request.w * request.h;
    for (let row = request.y; row < request.y + request.h; row += 1) {
      for (let column = request.x; column < request.x + request.w; column += 1) {
        if (pilotExpectation(column, row) === PILOT_NODATA) expectedNodataCells += 1;
      }
    }

    const observedWindow = byId.get(request.id);
    if (observedWindow === undefined) {
      gaps.push(
        `window ${JSON.stringify(request.id)} (${request.x},${request.y},${request.w},${request.h}) was requested but never observed`,
      );
      continue;
    }

    const record = observedWindow.record;
    let dimensionMismatch = false;
    for (const field of ['x', 'y', 'w', 'h'] as const) {
      const value = wholeNumber(record[field]);
      if (value === undefined) {
        failures.push(
          `window ${JSON.stringify(request.id)} records ${field} as ${describe(record[field])}, which is not a whole non-negative number`,
        );
        dimensionMismatch = true;
        continue;
      }
      if (value !== request[field]) {
        failures.push(
          `window ${JSON.stringify(request.id)} was requested at ${field}=${request[field]} but observed at ${field}=${value}`,
        );
        dimensionMismatch = true;
      }
    }
    const expectedValues = request.w * request.h;
    if (observedWindow.values.length !== expectedValues) {
      failures.push(
        `window ${JSON.stringify(request.id)} records ${observedWindow.values.length} value(s), but ${request.w}x${request.h} requires exactly ${expectedValues}`,
      );
      dimensionMismatch = true;
    }
    if (dimensionMismatch) continue;

    let mismatches = 0;
    let validityMismatches = 0;
    let windowNodata = 0;
    let windowZero = 0;
    let windowNegative = 0;
    for (let row = 0; row < request.h; row += 1) {
      for (let column = 0; column < request.w; column += 1) {
        const index = row * request.w + column;
        const observedValue = observedWindow.values[index] ?? Number.NaN;
        const expected = pilotExpectation(request.x + column, request.y + row);
        if (expected === PILOT_NODATA) {
          windowNodata += 1;
          // A nodata cell is valid when it is reported as the sentinel or as NaN;
          // any other value is a validity contradiction, not a value mismatch.
          if (!(Number.isNaN(observedValue) || observedValue === PILOT_NODATA)) validityMismatches += 1;
          continue;
        }
        if (Number.isNaN(observedValue) || observedValue !== expected) {
          mismatches += 1;
          continue;
        }
        // Retention is counted from samples that were actually observed valid.
        if (observedValue === 0) windowZero += 1;
        else if (observedValue < 0) windowNegative += 1;
      }
    }
    measured.push({
      id: request.id,
      x: request.x,
      y: request.y,
      w: request.w,
      h: request.h,
      cells: expectedValues,
      nodataCells: windowNodata,
      mismatches,
      validityMismatches,
      zeroValues: windowZero,
      negativeValues: windowNegative,
    });
    cells += expectedValues;
    nodataCells += windowNodata;
    zeroValues += windowZero;
    negativeValues += windowNegative;
  }

  return {
    measured,
    failures,
    gaps,
    cells,
    expectedCells,
    nodataCells,
    expectedNodataCells,
    zeroValues,
    negativeValues,
  };
}

/* -------------------------------------------------------------------------- *
 * Ledger, refusals and bundled assets.
 * -------------------------------------------------------------------------- */

interface LedgerReading {
  readonly candidateBytes: number;
  readonly candidateReads: number;
  readonly maxRead: number;
  readonly referenceBytes: number;
  readonly entries: readonly Record<string, unknown>[];
}

function readLedger(raw: Record<string, unknown>, instrumentProblems: string[]): LedgerReading | undefined {
  const entries = raw['entries'];
  if (!Array.isArray(entries)) {
    instrumentProblems.push(`the native ledger records its entries as ${describe(entries)}, not a list`);
    return undefined;
  }
  const reading: LedgerReading = {
    candidateBytes: wholeNumber(raw['candidate_bytes']) ?? 0,
    candidateReads: wholeNumber(raw['candidate_reads']) ?? 0,
    maxRead: wholeNumber(raw['max_read_bytes']) ?? 0,
    referenceBytes: wholeNumber(raw['reference_bytes']) ?? 0,
    entries: entries.filter(isRecord),
  };
  return reading;
}

/** The native ledger's own record of the four refused-read controls. */
function checkRefusals(
  declared: readonly DeclaredRefusal[],
  workerRefusals: unknown,
  ledger: LedgerReading,
  failures: string[],
): PilotMeasurement['refusals'] {
  const results: { id: string; requestId: string; expected: string; observed: string }[] = [];
  let matched = 0;
  if (!Array.isArray(workerRefusals)) {
    failures.push(`the host result records refused-read controls as ${describe(workerRefusals)}, not a list`);
    return { declared: declared.length, matched: 0, results };
  }
  const observedById = new Map<string, Record<string, unknown>>();
  for (const entry of workerRefusals) {
    if (!isRecord(entry)) continue;
    const id = nonEmptyString(entry['id']);
    if (id !== undefined && !observedById.has(id)) observedById.set(id, entry);
  }
  for (const control of declared) {
    const observedEntry = observedById.get(control.id);
    if (observedEntry === undefined) {
      failures.push(`refused-read control ${JSON.stringify(control.id)} was declared but never observed`);
      continue;
    }
    const observed = nonEmptyString(observedEntry['observed']) ?? describe(observedEntry['observed']);
    const requestId = nonEmptyString(observedEntry['requestId']);
    if (requestId === undefined) {
      failures.push(`refused-read control ${JSON.stringify(control.id)} records no request identity`);
      continue;
    }
    if (requestId !== control.requestId) {
      // Identity is part of the declaration: a refusal of some other request is not
      // evidence for this control, however similar its outcome looks.
      failures.push(
        `refused-read control ${JSON.stringify(control.id)} was declared with request identity ${JSON.stringify(control.requestId)} but observed as ${JSON.stringify(requestId)}`,
      );
      continue;
    }
    let verified = observed === control.expected;
    if (!verified) {
      failures.push(
        `refused-read control ${JSON.stringify(control.id)} (request ${requestId}) was refused as ${JSON.stringify(observed)}, but was declared to be refused as ${JSON.stringify(control.expected)}`,
      );
    }
    // The refusal is only this control's if the native ledger recorded that same
    // request identity as refused with nothing returned. An unrelated refusal that
    // happens to share the outcome code is not evidence for this control.
    const recorded = ledger.entries.find((entry) => entry['request_id'] === requestId);
    if (recorded === undefined) {
      failures.push(
        `refused-read control ${JSON.stringify(control.id)} (request ${requestId}) is not recorded in the native ledger`,
      );
      verified = false;
    } else {
      const outcome = nonEmptyString(recorded['outcome']) ?? describe(recorded['outcome']);
      const returned = wholeNumber(recorded['returned']);
      if (outcome !== control.expected) {
        failures.push(
          `refused-read control ${JSON.stringify(control.id)} (request ${requestId}) is recorded natively as ${JSON.stringify(outcome)}, not ${JSON.stringify(control.expected)}`,
        );
        verified = false;
      }
      if (returned !== 0) {
        failures.push(
          `refused-read control ${JSON.stringify(control.id)} (request ${requestId}) returned ${String(recorded['returned'])} byte(s); a refused read must return none`,
        );
        verified = false;
      }
    }
    results.push({ id: control.id, requestId, expected: control.expected, observed });
    if (verified) matched += 1;
  }
  return { declared: declared.length, matched, results };
}

/**
 * The label of every native read is host-owned.
 *
 * Reference I/O is the host's own preflight hashing, which the launcher never issues
 * through the renderer path. A ledger entry that a renderer request produced can
 * therefore never be labelled reference, whatever the renderer asked for: a run that
 * relabelled candidate reads as preflight would be able to claim a bounded transport
 * it never used.
 */
function checkReadLabels(descriptor: RunDescriptor, ledger: LedgerReading, failures: string[]): void {
  for (const entry of ledger.entries) {
    const label = nonEmptyString(entry['label']) ?? describe(entry['label']);
    const requestId = nonEmptyString(entry['request_id']) ?? describe(entry['request_id']);
    if (label === 'reference' && requestId !== 'preflight-hash') {
      failures.push(
        `the native ledger labels request ${JSON.stringify(requestId)} as reference I/O; only the host's own fixture preflight may carry that label`,
      );
    }
    if (label !== 'candidate' && label !== 'reference') {
      failures.push(
        `the native ledger records an unusable read label ${JSON.stringify(label)} for request ${JSON.stringify(requestId)}`,
      );
    }
  }
  const preflight = ledger.entries.filter((entry) => entry['request_id'] === 'preflight-hash');
  if (preflight.length !== 1) {
    failures.push(
      `the native ledger records ${preflight.length} fixture preflight read(s); admission hashes the fixture exactly once`,
    );
  }
  for (const entry of preflight) {
    if (wholeNumber(entry['returned']) !== descriptor.fixture.bytes) {
      failures.push(
        `the fixture preflight read returned ${String(entry['returned'])} byte(s) of ${descriptor.fixture.bytes}`,
      );
    }
  }
}

/** The host's own re-hash of the bundle it embedded. */
function checkBundledAssets(
  declared: readonly DeclaredAsset[],
  raw: unknown,
  failures: string[],
): PilotMeasurement['bundledAssets'] {
  if (!Array.isArray(raw)) {
    failures.push(`the host records bundled assets as ${describe(raw)}, not a list`);
    return { declared: declared.length, verified: 0, detail: 'no bundled-asset check was recorded' };
  }
  const checks = raw.filter(isRecord);
  const byPath = new Map<string, Record<string, unknown>>();
  for (const check of checks) {
    const path = nonEmptyString(check['path']);
    if (path !== undefined && !byPath.has(path)) byPath.set(path, check);
  }
  let verified = 0;
  for (const asset of declared) {
    const check = byPath.get(asset.path);
    if (check === undefined) {
      failures.push(`bundled asset ${JSON.stringify(asset.path)} was declared but not checked inside the host`);
      continue;
    }
    const matches = check['matches'];
    if (matches !== true) {
      failures.push(
        `bundled asset ${JSON.stringify(asset.path)} does not match the declaration: the host embedded ${String(check['embedded_bytes'])} byte(s) hashing ${String(check['embedded_sha256'])}, declared ${asset.bytes} byte(s) hashing ${asset.sha256}`,
      );
      continue;
    }
    verified += 1;
  }
  if (checks.length !== declared.length) {
    failures.push(
      `the host checked ${checks.length} bundled asset(s), but ${declared.length} were declared`,
    );
  }
  return {
    declared: declared.length,
    verified,
    detail: `${verified} of ${declared.length} bundled file(s) re-hashed inside the host matched the declaration`,
  };
}

/* -------------------------------------------------------------------------- *
 * The producer.
 * -------------------------------------------------------------------------- */

function identityReport(descriptor: RunDescriptor, experiment: string): Record<string, unknown> {
  const declaration = profileDeclaration(PILOT_PROFILE);
  return {
    id: experiment,
    experiment,
    runId: descriptor.runId,
    recordedAt: descriptor.recordedAt,
    command: descriptor.command,
    routeId: QUALIFICATION_ROUTE_ID,
    environment: declaration.environment,
    host: declaration.host,
    fixturePolicy: 'measured',
    sidecarPolicy: 'not_applicable',
    transport: LOCAL_BRIDGE_TRANSPORT,
    fixtures: [{ name: descriptor.fixture.name, sha256: descriptor.fixture.sha256 }],
    artifact: { name: descriptor.engine.name, version: descriptor.engine.version },
  };
}

function emptyMeasurement(descriptor: RunDescriptor): PilotMeasurement {
  return {
    windows: [],
    declaredWindows: descriptor.windows.length,
    measuredWindows: 0,
    cells: 0,
    expectedCells: descriptor.windows.reduce((total, window) => total + window.w * window.h, 0),
    nodataCells: 0,
    expectedNodataCells: 0,
    ledger: {
      candidateBytes: 0,
      candidateReads: 0,
      maxRead: 0,
      referenceBytes: 0,
      fixtureBytes: descriptor.fixture.bytes,
      reconciles: false,
      detail: 'no host evidence was read',
    },
    refusals: { declared: descriptor.refusals.length, matched: 0, results: [] },
    bundledAssets: {
      declared: descriptor.bundledAssets.length,
      verified: 0,
      detail: 'no host evidence was read',
    },
  };
}

/**
 * Produce the reports for one run.
 *
 * The outcome always carries the measurement summary, so a failed run still reports
 * what it actually observed. Reports are produced only when the raw evidence was
 * readable as this run's own; otherwise the caller has an instrument failure and
 * nothing admissible to publish.
 */
export function producePilotReports(input: {
  readonly descriptor: RunDescriptor;
  readonly hostEvidence: unknown;
}): PilotOutcome {
  const descriptor = input.descriptor;
  const instrumentProblems: string[] = [];
  const failures: string[] = [];
  const gaps: string[] = [];

  if (!isRecord(input.hostEvidence)) {
    instrumentProblems.push(`the host evidence is ${describe(input.hostEvidence)}, not an object`);
    return { instrumentProblems, failures, gaps, measurement: emptyMeasurement(descriptor) };
  }
  const evidence = input.hostEvidence;
  const recordedRun = nonEmptyString(evidence['run']);
  if (recordedRun !== descriptor.runId) {
    instrumentProblems.push(
      `the host evidence records run ${JSON.stringify(recordedRun ?? null)}, but this run is ${JSON.stringify(descriptor.runId)}`,
    );
  }
  const ledgerRaw = evidence['nativeLedger'];
  if (!isRecord(ledgerRaw)) {
    instrumentProblems.push(`the host evidence records a native ledger as ${describe(ledgerRaw)}, not an object`);
  }
  const result = evidence['evidence'];
  if (!isRecord(result)) {
    instrumentProblems.push(`the host evidence records the worker result as ${describe(result)}, not an object`);
  }
  if (instrumentProblems.length > 0) {
    return { instrumentProblems, failures, gaps, measurement: emptyMeasurement(descriptor) };
  }
  const ledger = readLedger(ledgerRaw as Record<string, unknown>, instrumentProblems);
  if (ledger === undefined) {
    return { instrumentProblems, failures, gaps, measurement: emptyMeasurement(descriptor) };
  }

  const worker = result as Record<string, unknown>;
  const workerError = nonEmptyString(worker['error']) ?? (worker['error'] === undefined ? undefined : describe(worker['error']));
  if (workerError !== undefined) {
    failures.push(`the bundled worker failed: ${workerError}`);
  }

  const coverageGaps: string[] = [];
  const coverage = coverWindows(
    descriptor.windows,
    parseObservedWindows(worker['windows'], failures),
    failures,
    coverageGaps,
  );
  gaps.push(...coverageGaps);
  checkReadLabels(descriptor, ledger, failures);
  const refusals = checkRefusals(descriptor.refusals, worker['refusals'], ledger, failures);
  const bundledAssets = checkBundledAssets(descriptor.bundledAssets, evidence['bundledAssets'], failures);

  // Byte reconciliation: the host's ledger and the worker's counters are two
  // independent records of the same transport, so a disagreement is evidence.
  const counters = isRecord(worker['counters']) ? worker['counters'] : undefined;
  const workerBytes = counters === undefined ? undefined : wholeNumber(counters['totalBytes']);
  const workerReads = counters === undefined ? undefined : wholeNumber(counters['headerRequests']);
  const workerTileReads = counters === undefined ? undefined : wholeNumber(counters['tileRequests']);
  const workerLargest = counters === undefined ? undefined : wholeNumber(counters['largestRequest']);
  const readFailures = counters !== undefined && Array.isArray(counters['readFailures']) ? counters['readFailures'] : undefined;
  let reconciles = false;
  let reconciliationDetail = 'the worker reported no counters to reconcile';
  if (
    workerBytes !== undefined &&
    workerReads !== undefined &&
    workerTileReads !== undefined &&
    workerLargest !== undefined &&
    readFailures !== undefined
  ) {
    const totalReads = workerReads + workerTileReads;
    const disagreements: string[] = [];
    if (workerBytes !== ledger.candidateBytes) {
      disagreements.push(`the worker counted ${workerBytes} byte(s), the native ledger ${ledger.candidateBytes}`);
    }
    if (totalReads !== ledger.candidateReads) {
      disagreements.push(`the worker counted ${totalReads} read(s), the native ledger ${ledger.candidateReads}`);
    }
    if (workerLargest !== ledger.maxRead) {
      disagreements.push(`the worker's largest read was ${workerLargest}, the native ledger's ${ledger.maxRead}`);
    }
    for (const failure of readFailures) {
      disagreements.push(`the worker recorded an unexpected read failure: ${JSON.stringify(failure)}`);
    }
    reconciles = disagreements.length === 0;
    reconciliationDetail =
      disagreements.length === 0
        ? `${workerBytes} byte(s) in ${totalReads} read(s) agree with the native ledger`
        : disagreements.join('; ');
    if (!reconciles) failures.push(`the native ledger and the worker counters disagree: ${reconciliationDetail}`);
  } else {
    gaps.push('the worker did not report counters that can be reconciled with the native ledger');
  }

  const measured = coverage.measured;
  const coverageComplete =
    measured.length === descriptor.windows.length && coverageGaps.length === 0;
  const cellsExact = measured.every((window) => window.mismatches === 0);
  const validityExact = measured.every((window) => window.validityMismatches === 0);
  const retainedZeroAndNegative = coverage.zeroValues > 0 && coverage.negativeValues > 0;
  const bounded = ledger.maxRead > 0 && ledger.maxRead < descriptor.fixture.bytes;
  if (!bounded) {
    failures.push(
      `no bounded candidate read was recorded: the largest candidate read was ${ledger.maxRead} of ${descriptor.fixture.bytes} fixture byte(s)`,
    );
  }
  if (measured.length > 0 && !cellsExact) {
    failures.push('window values differ from the analytic expectation');
  }
  if (measured.length > 0 && !validityExact) {
    failures.push('nodata validity differs from the expectation');
  }
  if (!retainedZeroAndNegative) {
    gaps.push(
      `retention of zero and negative values was not observed in the returned samples (${coverage.zeroValues} zero, ${coverage.negativeValues} negative)`,
    );
  }
  if (!coverageComplete) {
    gaps.push(
      `measured coverage is ${measured.length} of ${descriptor.windows.length} requested window(s); ${cellsExact ? 'the observed cells agree with the expectation' : 'observed cells disagree with the expectation'}`,
    );
  }

  const measurement: PilotMeasurement = {
    windows: measured,
    declaredWindows: descriptor.windows.length,
    measuredWindows: measured.length,
    cells: coverage.cells,
    expectedCells: coverage.expectedCells,
    nodataCells: coverage.nodataCells,
    expectedNodataCells: coverage.expectedNodataCells,
    ledger: {
      candidateBytes: ledger.candidateBytes,
      candidateReads: ledger.candidateReads,
      maxRead: ledger.maxRead,
      referenceBytes: ledger.referenceBytes,
      fixtureBytes: descriptor.fixture.bytes,
      reconciles,
      detail: reconciliationDetail,
    },
    refusals,
    bundledAssets,
    ...(workerError === undefined ? {} : { workerError }),
  };

  // An assertion without `ok` is the evaluator's existing inconclusive shape: it is
  // how a gap stays a gap instead of becoming a measured failure.
  const decided = (name: string, ok: boolean, detail: string): Record<string, unknown> =>
    ok ? { name, ok: true, detail } : { name, ok: false, detail };
  const gapAssertion = (name: string, detail: string): Record<string, unknown> => ({ name, detail });

  const q2Assertions: Record<string, unknown>[] = [];
  if (coverageComplete) {
    q2Assertions.push(decided('windows-tested', true, `${measured.length} window(s) compared cell by cell`));
  } else {
    q2Assertions.push(
      gapAssertion('windows-tested', `${measured.length} of ${descriptor.windows.length} window(s) were observed`),
    );
  }
  const wholeFileDetail = `largest candidate read ${ledger.maxRead} of ${descriptor.fixture.bytes} byte(s)`;
  q2Assertions.push(
    measured.length > 0 && bounded
      ? decided('no-whole-file-request:plane', true, wholeFileDetail)
      : gapAssertion('no-whole-file-request:plane', wholeFileDetail),
  );
  const refusalsAllMatched = refusals.matched === refusals.declared && refusals.declared > 0;
  q2Assertions.push(
    refusalsAllMatched
      ? decided(
          'no-whole-file-request:refused-before-read',
          true,
          refusals.results.map((result) => `${result.id}->${result.observed}`).join(', '),
        )
      : gapAssertion(
          'no-whole-file-request:refused-before-read',
          `${refusals.matched} of ${refusals.declared} refused-read control(s) matched their declared code`,
        ),
  );
  if (measured.length === 0) {
    q2Assertions.push(gapAssertion(`analytic:${descriptor.fixture.name}`, 'no window observation was available'));
    q2Assertions.push(gapAssertion(`validity:${descriptor.fixture.name}`, 'no window observation was available'));
  } else {
    q2Assertions.push(
      decided(
        `analytic:${descriptor.fixture.name}`,
        cellsExact,
        `${coverage.cells} cell(s) compared, ${measured.reduce((total, window) => total + window.mismatches, 0)} mismatch(es)`,
      ),
    );
    q2Assertions.push(
      decided(
        `validity:${descriptor.fixture.name}`,
        validityExact,
        `${coverage.nodataCells} nodata cell(s) observed as invalid, ${measured.reduce((total, window) => total + window.validityMismatches, 0)} validity mismatch(es)`,
      ),
    );
  }
  if (retainedZeroAndNegative) {
    q2Assertions.push(
      decided(
        `zero-negative-retained:${descriptor.fixture.name}`,
        true,
        `${coverage.zeroValues} zero and ${coverage.negativeValues} negative valid sample(s) observed`,
      ),
    );
  } else {
    q2Assertions.push(
      gapAssertion(
        `zero-negative-retained:${descriptor.fixture.name}`,
        `observed samples retained ${coverage.zeroValues} zero and ${coverage.negativeValues} negative value(s)`,
      ),
    );
  }
  q2Assertions.push(
    reconciles
      ? decided('native-ledger-reconciles-worker-counters', true, reconciliationDetail)
      : gapAssertion('native-ledger-reconciles-worker-counters', reconciliationDetail),
  );

  const q2 = {
    experiment: 'q2-numeric',
    identity: identityReport(descriptor, 'q2-numeric'),
    result: failures.length > 0 ? 'fail' : gaps.length > 0 ? 'inconclusive' : 'pass',
    failures: [...failures],
    assertions: q2Assertions,
    fixturesTested: 1,
    testedWindows: measured.length,
    windows: measured.map((window) => ({
      fixture: descriptor.fixture.name,
      label: window.id,
      classification: 'measured',
      window: { x: window.x, y: window.y, w: window.w, h: window.h, haloCells: 0 },
      cells: window.cells,
      nodataCells: window.nodataCells,
      mismatches: window.mismatches,
      validityMismatches: window.validityMismatches,
    })),
    serverLedger: {
      fixtureBytesServed: ledger.candidateBytes,
      fixtureRequests: ledger.candidateReads,
      totalServed: ledger.candidateBytes,
      referenceBytes: ledger.referenceBytes,
    },
    workerCounters: counters ?? null,
    nativeLedgerMaxRead: ledger.maxRead,
  };

  const hostRole = profileRole(PILOT_PROFILE, 'host');
  const acceptedOrigin = nonEmptyString(evidence['webviewOrigin']) ?? '';
  const workerExercised = measured.length > 0;
  const bundledOk = bundledAssets.declared > 0 && bundledAssets.verified === bundledAssets.declared;
  const denialExercised = descriptor.networkDenial.includes('unshare');
  const hostAssertions: Record<string, unknown>[] = [
    !workerExercised
      ? gapAssertion('bundled-worker-and-asset-path-exercised', 'the bundled worker returned no validated window')
      : decided(
          'bundled-worker-and-asset-path-exercised',
          bundledOk,
          `${measured.length} window(s) decoded from bundled assets; ${bundledAssets.detail}`,
        ),
    !denialExercised
      ? gapAssertion('no-network-origin-required', `network denial was not exercised: ${descriptor.networkDenial}`)
      : decided(
          'no-network-origin-required',
          acceptedOrigin.startsWith('tauri://'),
          `${descriptor.networkDenial}; WebView origin ${JSON.stringify(acceptedOrigin)}; ${descriptor.x11Relay}`,
        ),
    acceptedOrigin.startsWith('tauri://')
      ? decided('observed-in-desktop-webview', true, `WebView origin ${JSON.stringify(acceptedOrigin)}`)
      : decided(
          'observed-in-desktop-webview',
          false,
          `the WebView reported origin ${JSON.stringify(acceptedOrigin)}, which is not a bundled Desktop origin`,
        ),
  ];
  const hostFailures = hostAssertions
    .filter((entry) => entry['ok'] === false)
    .map((entry) => String(entry['detail']));
  const host = {
    experiment: 'q-host',
    identity: {
      ...identityReport(descriptor, 'q-host'),
      fixturePolicy: 'artifact-only',
      fixtures: [],
      artifact: hostRole?.artifact ?? { name: 'desktop-webview', version: 'bundled' },
    },
    result: hostFailures.length > 0 ? 'fail' : hostAssertions.some((entry) => entry['ok'] === undefined) ? 'inconclusive' : 'pass',
    failures: [...hostFailures],
    assertions: hostAssertions,
    fixturesTested: 0,
    runtime: {
      origin: acceptedOrigin,
      engine: descriptor.engine,
    },
  };

  return { instrumentProblems, failures, gaps, reports: { q2, host }, measurement };
}
