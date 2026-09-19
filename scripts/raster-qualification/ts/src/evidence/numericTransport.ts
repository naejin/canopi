/**
 * Q-LOCAL-1 - scoped local numeric transport, as explicit checks.
 *
 * Every assertion needs a positive observation. The transport must be named and must
 * be the plan's scoped local bridge; the window bounds and the ledger are decided from
 * the values the producer actually recorded.
 *
 * Two rules shape the reductions here:
 *
 * - each recorded leaf is parsed and judged on its own before any comparison that
 *   needs a second operand, so a missing sibling never erases a recorded violation:
 *   a width above the edge limit fails even when the height is absent, and a negative
 *   byte count fails even when the request count is absent;
 * - a leaf that is absent is missing evidence and gaps, while a leaf that is present
 *   but unusable fails. Nothing is coerced, and a comparison that lacks an operand
 *   gaps without discarding the failures already found.
 */

import { asArray, describe, finiteNumber, isNonEmptyString, isRecord, nonNegativeInteger } from '../fields.js';
import {
  contradicted,
  satisfied,
  sourceEvidence,
  unsatisfied,
  type Check,
  type CheckContext,
  type EvidenceRef,
  type RequirementChecks,
} from './checks.js';
import { prefixCheck } from './records.js';

/** The plan's numeric window bound: at most 1024x1024 cells per window. */
export const WINDOW_EDGE = 1024;
export const WINDOW_CELLS = WINDOW_EDGE * WINDOW_EDGE;

/** The transport the plan qualifies for bounded local numeric access. */
const REQUIRED_TRANSPORT = 'local-bridge';

const ASSERTIONS = [
  'reads-over-proposed-local-transport',
  'transport-ledger-corroborates-bytes',
  'no-single-request-returns-whole-artifact',
  'values-match-independent-reference',
  'validity-matches-reference-exactly',
  'window-size-within-contract-limit',
];

/** A leaf a check needed but could not use. */
interface LeafProblem {
  readonly kind: 'missing' | 'malformed';
  readonly reason: string;
}

function numeric(context: CheckContext): {
  readonly view: ReturnType<CheckContext['byRole']['get']>;
  readonly reference: EvidenceRef | undefined;
} {
  const view = context.byRole.get('q2');
  return { view, reference: sourceEvidence(view, 'windows') };
}

function absent(record: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined;
}

/**
 * Read one counter.
 *
 * These counters count discrete things, so a supplied value must be a finite
 * non-negative integer: a fraction, a negative value, `null`, a string, a boolean or
 * a container is unusable input. Absence is missing evidence and gaps. Nothing is
 * coerced or rounded, and zero is a valid count.
 *
 * A negative integer keeps its specific wording, because "records -1 byte(s) served"
 * names a recorded impossibility rather than a wrong type.
 */
function readCounter(
  record: Record<string, unknown>,
  key: string,
  label: string,
  unit: string,
  negativeKind: string,
): { readonly value?: number; readonly problem?: LeafProblem } {
  if (absent(record, key)) {
    return { problem: { kind: 'missing', reason: `does not record its ${label}` } };
  }
  const raw = record[key];
  const value = nonNegativeInteger(raw);
  if (value === undefined) {
    const negativeInteger = typeof raw === 'number' && Number.isInteger(raw) && raw < 0;
    return {
      problem: {
        kind: 'malformed',
        reason: negativeInteger
          ? `records ${raw} ${unit}, which is not a possible ${negativeKind}`
          : `records ${key}=${typeof raw === 'number' ? String(raw) : describe(raw)}, which is not a whole non-negative ${label}`,
      },
    };
  }
  return { value };
}

/** Read one window dimension and apply its own shape and sign rules. */
function readDimension(
  spec: Record<string, unknown>,
  key: 'w' | 'h',
  index: number,
): { readonly value?: number; readonly problem?: LeafProblem } {
  if (absent(spec, key)) {
    return {
      problem: { kind: 'missing', reason: `window record ${index} does not record ${key}` },
    };
  }
  const raw = spec[key];
  const value = finiteNumber(raw);
  if (value === undefined) {
    return {
      problem: {
        kind: 'malformed',
        reason: `window record ${index} records ${key}=${describe(raw)}, which is not a usable window dimension`,
      },
    };
  }
  if (!Number.isInteger(value) || value <= 0) {
    // A window is a whole number of cells. A fractional or non-positive dimension is
    // present but unusable, so it cannot be compared as though it were measurable and
    // it cannot silently satisfy the bound.
    return {
      problem: {
        kind: 'malformed',
        reason: `window record ${index} records ${key}=${value}, which is not a whole positive number of cells`,
      },
    };
  }
  return { value };
}

const transport: Check = {
  id: 'local.transport',
  assertion: 'reads-over-proposed-local-transport',
  run: (context) => {
    const { view, reference } = numeric(context);
    if (view === undefined || view.facts === undefined || view.shape === undefined || reference === undefined) {
      return unsatisfied(['no numeric report was available']);
    }
    const observed = view.facts.identity?.['transport'];
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [reference];
    if (!isNonEmptyString(observed)) {
      gaps.push('the numeric source does not record which transport it measured');
    } else if (observed !== REQUIRED_TRANSPORT) {
      failures.push(
        `the numeric source measured transport ${JSON.stringify(observed)} but the plan requires the ${JSON.stringify(REQUIRED_TRANSPORT)}; a remote HTTP capability does not qualify bounded local access`,
      );
    }
    const tested = readCounter(
      view.shape.value,
      'testedWindows',
      'validated-window count',
      'validated window(s)',
      'count',
    );
    if (tested.problem !== undefined) {
      // A present unusable count is invalid input; an absent one is missing evidence.
      (tested.problem.kind === 'missing' ? gaps : failures).push(
        `the numeric report ${tested.problem.reason}`,
      );
    } else if (tested.value === 0) {
      failures.push('the numeric report validated no window, so it demonstrates no bounded read');
    } else if (observed === REQUIRED_TRANSPORT) {
      const ref = sourceEvidence(view, 'testedWindows', `transport ${observed}`);
      if (ref !== undefined) evidence.push(ref);
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const ledger: Check = {
  id: 'local.ledger',
  assertion: 'transport-ledger-corroborates-bytes',
  run: (context) => {
    const { view, reference } = numeric(context);
    if (view === undefined || view.shape === undefined || reference === undefined) {
      return unsatisfied(['no numeric report was available']);
    }
    const value = view.shape.value;
    const ledgerValue = isRecord(value['serverLedger']) ? value['serverLedger'] : undefined;
    if (ledgerValue === undefined) {
      return unsatisfied(
        ['the numeric report records no transport ledger to corroborate its bytes'],
        [reference],
      );
    }

    // Every counter is read and judged on its own first, so an unusable or absent
    // sibling can neither hide a recorded impossibility nor enter any arithmetic.
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [sourceEvidence(view, 'serverLedger') ?? reference];
    const served = readCounter(ledgerValue, 'fixtureBytesServed', 'byte count', 'byte(s) served', 'byte count');
    const requests = readCounter(ledgerValue, 'fixtureRequests', 'request count', 'request(s)', 'request count');
    const tested = readCounter(
      value,
      'testedWindows',
      'validated-window count',
      'validated window(s)',
      'count',
    );
    for (const read of [served, requests, tested]) {
      if (read.problem === undefined) continue;
      (read.problem.kind === 'missing' ? gaps : failures).push(
        `the numeric report ${read.problem.reason}`,
      );
    }
    if (served.problem?.kind === 'missing' || requests.problem?.kind === 'missing') {
      gaps.push('the transport ledger does not record both bytes served and request count');
    }
    if (tested.problem?.kind === 'missing') {
      gaps.push(
        'the numeric report does not record how many windows it validated, so the ledger cannot corroborate them',
      );
    }

    // Each relationship is decided from its own two operands only: with nine
    // validated windows and no recorded request count, zero bytes still contradicts
    // the reads, and the missing count is recorded as its own gap.
    let decided = 0;
    const corroborate = (
      quantity: { readonly value?: number },
      unit: string,
      field: string,
    ): void => {
      if (tested.value === undefined || quantity.value === undefined) return;
      decided += 1;
      if (tested.value > 0 && quantity.value === 0) {
        failures.push(
          `the numeric report validates ${tested.value} window(s) but its transport ledger records 0 ${unit}, so the ledger does not corroborate the reads`,
        );
        return;
      }
      if (tested.value === 0 && quantity.value > 0) {
        failures.push(
          `the transport ledger records ${quantity.value} ${unit} although no window was validated`,
        );
        return;
      }
      const ref = sourceEvidence(view, `serverLedger.${field}`, `${quantity.value} ${unit}`);
      if (ref !== undefined) evidence.push(ref);
    };
    corroborate(served, 'byte(s)', 'fixtureBytesServed');
    corroborate(requests, 'request(s)', 'fixtureRequests');

    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    if (decided < 2) {
      // Both relationships were readable but neither could be stated, which is not
      // support: it is a gap, never a pass.
      return unsatisfied(
        ['the transport ledger could not be corroborated against the validated windows'],
        evidence,
      );
    }
    return satisfied(evidence);
  },
};

const windowBounds: Check = {
  id: 'local.window-bounds',
  assertion: 'window-size-within-contract-limit',
  run: (context) => {
    const { view, reference } = numeric(context);
    if (view === undefined || view.shape === undefined || reference === undefined) {
      return unsatisfied(['no numeric report was available']);
    }
    const list = asArray(view.shape.value['windows']);
    if (list === undefined || list.length === 0) {
      return unsatisfied(
        ["no numeric window size was recorded, so the contract's window bound was never observed"],
        [reference],
      );
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [reference];
    let usable = 0;
    list.forEach((entry, index) => {
      if (!isRecord(entry)) {
        gaps.push(`window record ${index} is not an object`);
        return;
      }
      const classification = entry['classification'];
      if (classification !== undefined && classification !== 'measured') {
        // A record that declares itself unmeasured is reported rather than dropped
        // silently, so a skipped window is visible to a reader.
        gaps.push(
          `window record ${index} declares classification ${describe(classification)}, so it is not a measured window`,
        );
        return;
      }
      const spec = isRecord(entry['window']) ? entry['window'] : undefined;
      if (spec === undefined) {
        gaps.push(`window record ${index} does not record its bounds`);
        return;
      }
      const width = readDimension(spec, 'w', index);
      const height = readDimension(spec, 'h', index);
      for (const read of [width, height]) {
        if (read.problem === undefined) continue;
        (read.problem.kind === 'missing' ? gaps : failures).push(read.problem.reason);
      }
      // Each recorded dimension is compared with the edge bound on its own, so a
      // missing sibling cannot hide a recorded violation.
      for (const [label, read] of [
        ['width', width],
        ['height', height],
      ] as const) {
        if (read.value === undefined) continue;
        usable += 1;
        if (read.value > WINDOW_EDGE) {
          failures.push(
            `a measured window ${label} of ${read.value} exceeds the ${WINDOW_EDGE}x${WINDOW_EDGE} window contract`,
          );
        }
      }
      if (width.value === undefined || height.value === undefined) {
        gaps.push(
          `window record ${index} does not record both dimensions, so its area cannot be compared with the ${WINDOW_CELLS}-cell contract limit`,
        );
        return;
      }
      if (width.value * height.value > WINDOW_CELLS) {
        failures.push(
          `a measured window of ${width.value}x${height.value} cells exceeds the ${WINDOW_CELLS}-cell contract limit`,
        );
        return;
      }
      const ref = sourceEvidence(view, `windows[${index}].window`, `${width.value}x${height.value}`);
      if (ref !== undefined) evidence.push(ref);
    });
    if (usable === 0 && failures.length === 0) {
      gaps.push(
        "no usable numeric window size was recorded, so the contract's window bound was never observed",
      );
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

export const NUMERIC_CHECKS: RequirementChecks = {
  requirementId: 'Q-LOCAL-1',
  assertions: ASSERTIONS,
  required: [
    'local.transport',
    'local.ledger',
    'local.whole-file-requests',
    'local.analytic-values',
    'local.validity',
    'local.window-bounds',
  ],
  unsupported: new Map<string, string>(),
  checks: [
    transport,
    ledger,
    prefixCheck(
      'local.whole-file-requests',
      'no-single-request-returns-whole-artifact',
      'q2',
      'no-whole-file-request',
      'whole-file request assertion(s)',
    ),
    prefixCheck(
      'local.analytic-values',
      'values-match-independent-reference',
      'q2',
      'analytic:',
      'analytic comparison(s)',
    ),
    prefixCheck(
      'local.validity',
      'validity-matches-reference-exactly',
      'q2',
      'validity:',
      'validity comparison(s)',
    ),
    windowBounds,
  ],
};

export const NUMERIC_PROVENANCE = {
  sourceRoles: ['q2'] as const,
  source: 'reports/q2-numeric.json',
  legacyProducerCommand: 'measure.py q2-numeric --browser-report <probe> --out reports/q2-numeric.json',
  route: 'bounded numeric window decoding over the proposed local transport',
  artifact: {},
  fixtures: [] as { name: string; sha256?: string }[],
};
