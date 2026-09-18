/**
 * Q-LOCAL-1 - scoped local numeric transport.
 *
 * Every assertion here needs a positive observation. The window bound in
 * particular is decided from the sizes the producer actually recorded: a pass
 * requires a measured window within the plan's limit, an over-limit window is a
 * measured violation, and no recorded window is a gap. Absence of a failure string
 * is not evidence of anything.
 */

import { asArray, finiteNumber, isNonEmptyString, isRecord, nonNegativeInteger } from '../fields.js';
import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { combine, worse, type Verdict } from '../verdict.js';

/** The plan's numeric window bound: at most 1024x1024 cells per window. */
export const WINDOW_EDGE = 1024;
export const WINDOW_CELLS = WINDOW_EDGE * WINDOW_EDGE;

export function mapNumericTransport(
  source: SourceView | undefined,
  assertions: readonly string[],
): MappingResult {
  const verdicts = unresolved(assertions);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];

  if (source === undefined || source.facts === undefined || source.shape === undefined) {
    return {
      assertions: verdicts,
      observations,
      failures,
      gaps: ['no numeric report was available'],
      sourceRoles: ['q2'],
      source: 'reports/q2-numeric.json',
      legacyProducerCommand: 'measure.py q2-numeric --browser-report <probe> --out reports/q2-numeric.json',
      route: 'bounded numeric window decoding over the proposed local transport',
      artifact: {},
      fixtures: [],
    };
  }

  const value = source.shape.value;
  const named = source.facts.assertions;

  // The transport the source actually used must be the one the plan requires. An
  // HTTP-only measurement is a real capability, but the plan qualifies the local
  // bridge and rules out a remote HTTP demo, so it cannot carry this assertion.
  const observedTransport = source.facts.identity?.['transport'];
  const requiredTransport = 'local-bridge';
  observations['transport'] = observedTransport ?? null;

  // Window count: a positive observation, not the absence of a failure.
  const tested = nonNegativeInteger(value['testedWindows']);
  observations['testedWindows'] = tested ?? null;

  if (isNonEmptyString(observedTransport) && observedTransport !== requiredTransport) {
    verdicts.set('reads-over-proposed-local-transport', 'fail');
    failures.push(
      `the numeric source measured transport ${JSON.stringify(observedTransport)} but the plan requires the ${JSON.stringify(requiredTransport)}; a remote HTTP capability does not qualify bounded local access`,
    );
  } else {
    verdicts.set(
      'reads-over-proposed-local-transport',
      tested === undefined ? 'inconclusive' : tested > 0 ? 'pass' : 'fail',
    );
  }

  // The transport's own byte accounting must corroborate what was served.
  const ledger = isRecord(value['serverLedger']) ? value['serverLedger'] : undefined;
  if (ledger === undefined) {
    gaps.push('the numeric report records no transport ledger to corroborate its bytes');
    verdicts.set('transport-ledger-corroborates-bytes', 'inconclusive');
  } else {
    const served = finiteNumber(ledger['fixtureBytesServed']);
    const requests = nonNegativeInteger(ledger['fixtureRequests']);
    observations['serverLedger'] = { served: served ?? null, requests: requests ?? null };
    if (served === undefined || requests === undefined) {
      gaps.push('the transport ledger does not record both bytes served and request count');
      verdicts.set('transport-ledger-corroborates-bytes', 'inconclusive');
    } else if (tested === undefined) {
      gaps.push(
        'the numeric report does not record how many windows it validated, so the ledger cannot corroborate them',
      );
      verdicts.set('transport-ledger-corroborates-bytes', 'inconclusive');
    } else if (tested > 0 && (served <= 0 || requests <= 0)) {
      // The probe reports validated windows, so a ledger that accounts for no bytes
      // and no requests contradicts it rather than merely being incomplete.
      verdicts.set('transport-ledger-corroborates-bytes', 'fail');
      failures.push(
        `the numeric report validates ${tested} window(s) but its transport ledger records ${served} byte(s) over ${requests} request(s), so the ledger does not corroborate the reads`,
      );
    } else if (tested === 0 && (served > 0 || requests > 0)) {
      verdicts.set('transport-ledger-corroborates-bytes', 'fail');
      failures.push(
        `the transport ledger records ${served} byte(s) over ${requests} request(s) although no window was validated`,
      );
    } else {
      verdicts.set('transport-ledger-corroborates-bytes', 'pass');
    }
  }

  // Bounded access: every recorded whole-file request assertion must hold.
  verdicts.set(
    'no-single-request-returns-whole-artifact',
    allNamed(named, 'no-whole-file-request'),
  );

  // Values and validity against the independent reference.
  verdicts.set('values-match-independent-reference', allNamed(named, 'analytic:'));
  verdicts.set('validity-matches-reference-exactly', allNamed(named, 'validity:'));

  // The window bound, decided from recorded sizes.
  const windowVerdict = windowBounds(value['windows'], failures, gaps, observations);
  verdicts.set('window-size-within-contract-limit', windowVerdict);

  return {
    assertions: verdicts,
    observations,
    failures,
    gaps,
    sourceRoles: ['q2'],
    source: 'reports/q2-numeric.json',
    legacyProducerCommand: 'measure.py q2-numeric --browser-report <probe> --out reports/q2-numeric.json',
    route: 'bounded numeric window decoding over the proposed local transport',
    artifact: {},
    fixtures: [],
  };
}

/** Every assertion whose name starts with `prefix`, or a gap when none exists. */
export function allNamed(
  named: ReadonlyMap<string, { ok?: boolean }>,
  prefix: string,
): Verdict {
  const matched = Array.from(named.entries()).filter(([name]) => name.startsWith(prefix));
  if (matched.length === 0) return 'inconclusive';
  let verdict: Verdict = 'pass';
  for (const [, assertion] of matched) {
    if (assertion.ok === false) return 'fail';
    if (assertion.ok === undefined) verdict = worse(verdict, 'inconclusive');
  }
  return verdict;
}

/** One named assertion, or a gap when the report does not record it. */
export function named(
  map: ReadonlyMap<string, { ok?: boolean }>,
  name: string,
): Verdict {
  const entry = map.get(name);
  if (entry === undefined) return 'inconclusive';
  if (entry.ok === undefined) return 'inconclusive';
  return entry.ok ? 'pass' : 'fail';
}

function windowBounds(
  windows: unknown,
  failures: string[],
  gaps: string[],
  observations: Record<string, unknown>,
): Verdict {
  const list = asArray(windows);
  if (list === undefined || list.length === 0) {
    gaps.push(
      "no numeric window size was recorded, so the contract's window bound was never observed",
    );
    observations['windows'] = [];
    return 'inconclusive';
  }
  let measured = 0;
  let verdict: Verdict = 'pass';
  const summary: Record<string, unknown>[] = [];
  list.forEach((entry, index) => {
    if (!isRecord(entry)) {
      gaps.push(`window record ${index} is not an object`);
      verdict = worse(verdict, 'inconclusive');
      return;
    }
    const classification = entry['classification'];
    if (classification !== undefined && classification !== 'measured') return;
    const spec = isRecord(entry['window']) ? entry['window'] : undefined;
    if (spec === undefined) {
      gaps.push(`window record ${index} does not record its bounds`);
      verdict = worse(verdict, 'inconclusive');
      return;
    }
    const width = finiteNumber(spec['w']);
    const height = finiteNumber(spec['h']);
    if (width === undefined || height === undefined) {
      gaps.push(`window record ${index} does not record a usable size`);
      verdict = worse(verdict, 'inconclusive');
      return;
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      // A window is a whole number of cells. A fractional or non-positive dimension
      // is not a measurable window, so it cannot be compared as though it were one
      // and it cannot silently satisfy the bound.
      failures.push(
        `window record ${index} records a size of ${width}x${height} cells, which is not a whole positive number of cells`,
      );
      verdict = 'fail';
      return;
    }
    measured += 1;
    summary.push({
      fixture: entry['fixture'] ?? null,
      label: entry['label'] ?? null,
      width,
      height,
      haloCells: finiteNumber(spec['haloCells']) ?? null,
    });
    if (width * height > WINDOW_CELLS) {
      failures.push(
        `a measured window of ${width}x${height} cells exceeds the ${WINDOW_CELLS}-cell contract limit`,
      );
      verdict = 'fail';
    } else if (width > WINDOW_EDGE || height > WINDOW_EDGE) {
      failures.push(
        `a measured window of ${width}x${height} exceeds the ${WINDOW_EDGE}x${WINDOW_EDGE} window contract`,
      );
      verdict = 'fail';
    }
  });
  observations['windows'] = summary;
  if (measured === 0 && verdict === 'pass') {
    gaps.push(
      "no usable numeric window size was recorded, so the contract's window bound was never observed",
    );
    return 'inconclusive';
  }
  return verdict;
}

void combine;
void isNonEmptyString;
