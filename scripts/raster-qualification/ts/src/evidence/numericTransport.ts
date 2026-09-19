/**
 * Q-LOCAL-1 - scoped local numeric transport, as explicit checks.
 *
 * Every assertion needs a positive observation. The transport must be named and must
 * be the plan's scoped local bridge; the window bound is decided from the sizes the
 * producer actually recorded, with an over-limit window a measured violation and no
 * recorded window a gap. Whole-file request, value and validity assertions are each
 * read on their own, so a missing sibling cannot suppress a recorded contradiction.
 */

import { asArray, describe, finiteNumber, isNonEmptyString, isRecord, nonNegativeInteger } from '../fields.js';
import {
  contradicted,
  satisfied,
  sourceEvidence,
  unsatisfied,
  violated,
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

function numeric(context: CheckContext): {
  readonly view: ReturnType<CheckContext['byRole']['get']>;
  readonly reference: EvidenceRef | undefined;
} {
  const view = context.byRole.get('q2');
  return { view, reference: sourceEvidence(view, 'windows') };
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
    const tested = nonNegativeInteger(view.shape.value['testedWindows']);
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
    if (tested === undefined) {
      gaps.push('the numeric report does not record how many windows it validated');
    } else if (tested === 0) {
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
    const tested = nonNegativeInteger(value['testedWindows']);
    const ledgerValue = isRecord(value['serverLedger']) ? value['serverLedger'] : undefined;
    if (ledgerValue === undefined) {
      return unsatisfied(
        ['the numeric report records no transport ledger to corroborate its bytes'],
        [reference],
      );
    }
    const served = finiteNumber(ledgerValue['fixtureBytesServed']);
    const requests = nonNegativeInteger(ledgerValue['fixtureRequests']);
    if (served === undefined || requests === undefined) {
      return unsatisfied(
        ['the transport ledger does not record both bytes served and request count'],
        [reference],
      );
    }
    if (tested === undefined) {
      return unsatisfied(
        [
          'the numeric report does not record how many windows it validated, so the ledger cannot corroborate them',
        ],
        [reference],
      );
    }
    const evidence = sourceEvidence(view, 'serverLedger') ?? reference;
    if (tested > 0 && (served <= 0 || requests <= 0)) {
      // The probe reports validated windows, so a ledger that accounts for no bytes
      // and no requests contradicts it rather than merely being incomplete.
      return violated(
        [
          `the numeric report validates ${tested} window(s) but its transport ledger records ${served} byte(s) over ${requests} request(s), so the ledger does not corroborate the reads`,
        ],
        [evidence],
      );
    }
    if (tested === 0 && (served > 0 || requests > 0)) {
      return violated(
        [
          `the transport ledger records ${served} byte(s) over ${requests} request(s) although no window was validated`,
        ],
        [evidence],
      );
    }
    return satisfied([evidence]);
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
    let measured = 0;
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
      const width = finiteNumber(spec['w']);
      const height = finiteNumber(spec['h']);
      if (width === undefined || height === undefined) {
        gaps.push(`window record ${index} does not record a usable size`);
        return;
      }
      if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        // A window is a whole number of cells. A fractional or non-positive dimension
        // is not a measurable window, so it cannot be compared as though it were one
        // and it cannot silently satisfy the bound.
        failures.push(
          `window record ${index} records a size of ${width}x${height} cells, which is not a whole positive number of cells`,
        );
        return;
      }
      measured += 1;
      if (width * height > WINDOW_CELLS) {
        failures.push(
          `a measured window of ${width}x${height} cells exceeds the ${WINDOW_CELLS}-cell contract limit`,
        );
        return;
      }
      if (width > WINDOW_EDGE || height > WINDOW_EDGE) {
        failures.push(
          `a measured window of ${width}x${height} exceeds the ${WINDOW_EDGE}x${WINDOW_EDGE} window contract`,
        );
        return;
      }
      const ref = sourceEvidence(view, `windows[${index}].window`, `${width}x${height}`);
      if (ref !== undefined) evidence.push(ref);
    });
    if (measured === 0 && failures.length === 0) {
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
