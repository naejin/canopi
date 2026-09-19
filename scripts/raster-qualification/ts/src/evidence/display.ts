/**
 * Q-DISPLAY-1 - route-level display measurement, as explicit checks.
 *
 * Every independently decidable fact about the trace is its own check, and each
 * check evaluates *every* run: one run's missing field cannot stop another run's
 * recorded failure from being read, and a recorded failure cannot be demoted to a
 * gap by an unusable sibling operand.
 *
 * The plan's run relationships are enforced together with the counters: a run is a
 * route measurement only when it requested at least 100 tiles, recorded at least 100
 * usable individual latencies, rendered exactly as many tiles as it recorded
 * latencies, and reconciled rendered + failed against requested.
 */

import {
  asArray,
  describe,
  finiteNumber,
  isNonEmptyString,
  isRecord,
  nonNegativeInteger,
} from '../fields.js';
import { DECLARATIONS } from '../declared/route.js';
import {
  satisfied,
  sourceEvidence,
  unsatisfied,
  violated,
  type Check,
  type CheckContext,
  type CheckOutcome,
  type EvidenceRef,
  type RequirementChecks,
} from './checks.js';

const ASSERTIONS = [
  'one-cold-and-three-warm-runs',
  'hundred-valid-latencies-per-run',
  'runs-report-successful-rendering',
  'p95-from-individual-latencies',
  'statistics-agree-with-samples',
  'cache-state-recorded',
  'no-ui-thread-task-above-bound',
  'unsupported-observation-is-inconclusive',
];

/** Per-run fields this consumer understands. Anything else is reported. */
const KNOWN_RUN_FIELDS = new Set([
  'name', 'ok', 'error', 'pageErrors', 'wallSeconds', 'tileRequests', 'tilesRendered',
  'failedTiles', 'medianMs', 'p95Ms', 'maxMs', 'individualLatenciesMs', 'cachesCleared',
  'longTaskMaxMs', 'longTaskCount', 'longTaskObserverSupported',
]);

/** A leaf a check needed but could not use. */
interface LeafProblem {
  readonly kind: 'missing' | 'malformed';
  readonly reason: string;
}

interface RunFacts {
  readonly index: number;
  readonly label: string;
  /** Set when the entry is not an object at all. */
  readonly shapeProblem?: string;
  readonly name?: string;
  readonly ok?: boolean;
  readonly okProblem?: LeafProblem;
  readonly counters: ReadonlyMap<string, number>;
  readonly counterProblems: readonly LeafProblem[];
  readonly statistics: ReadonlyMap<string, unknown>;
  readonly pageErrors?: readonly string[];
  readonly pageErrorsProblem?: LeafProblem;
  readonly samples?: readonly number[];
  readonly sampleProblem?: LeafProblem;
  readonly malformedSamples: number;
  readonly negativeSamples: number;
  readonly cachesCleared?: string;
  readonly longTaskMaxMs?: number;
  readonly longTaskProblem?: LeafProblem;
  readonly observerSupported: boolean;
}

function absent(run: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(run, key) || run[key] === undefined;
}

/**
 * Read one whole-count leaf.
 *
 * An absent leaf is missing evidence; a leaf that is present but unusable — null
 * included, because the schema for these leaves is a number — is malformed input.
 */
function readCount(run: Record<string, unknown>, key: string): { value?: number; problem?: LeafProblem } {
  if (absent(run, key)) return { problem: { kind: 'missing', reason: `does not record ${key}` } };
  const value = nonNegativeInteger(run[key]);
  if (value === undefined) {
    return {
      problem: {
        kind: 'malformed',
        reason: `records ${key}=${describe(run[key])}, which is not a whole non-negative count`,
      },
    };
  }
  return { value };
}

function readOptionalNumber(
  run: Record<string, unknown>,
  key: string,
): { value?: number; problem?: LeafProblem } {
  if (absent(run, key)) return { problem: { kind: 'missing', reason: `does not record ${key}` } };
  const value = finiteNumber(run[key]);
  if (value === undefined) {
    return {
      problem: { kind: 'malformed', reason: `records ${key}=${describe(run[key])}, which is not a finite number` },
    };
  }
  return { value };
}

/** Every run's readable facts, with per-run problems preserved. */
function readRunFacts(list: readonly unknown[]): RunFacts[] {
  return list.map((entry, index) => {
    if (!isRecord(entry)) {
      return {
        index,
        label: `run ${index}`,
        shapeProblem: `run ${index} is ${describe(entry)}, not an object`,
        counters: new Map<string, number>(),
        counterProblems: [],
        statistics: new Map<string, unknown>(),
        malformedSamples: 0,
        negativeSamples: 0,
        observerSupported: false,
      };
    }
    const name = isNonEmptyString(entry['name']) ? entry['name'] : undefined;
    const counters = new Map<string, number>();
    const counterProblems: LeafProblem[] = [];
    for (const key of ['tileRequests', 'tilesRendered', 'failedTiles'] as const) {
      const read = readCount(entry, key);
      if (read.value === undefined) {
        if (read.problem !== undefined) counterProblems.push(read.problem);
      } else {
        counters.set(key, read.value);
      }
    }

    const okValue = entry['ok'];
    const ok = typeof okValue === 'boolean' ? okValue : undefined;
    const okProblem: LeafProblem | undefined =
      ok !== undefined
        ? undefined
        : absent(entry, 'ok')
          ? { kind: 'missing', reason: 'does not record whether it rendered successfully' }
          : { kind: 'malformed', reason: `records ok=${describe(okValue)}, which is not a boolean` };

    const pageErrorsValue = entry['pageErrors'];
    const pageErrorsList = asArray(pageErrorsValue);
    const pageErrors = pageErrorsList?.map((entry) => describe(entry));
    const pageErrorsProblem: LeafProblem | undefined =
      pageErrorsList !== undefined
        ? undefined
        : absent(entry, 'pageErrors')
          ? { kind: 'missing', reason: 'does not record page errors' }
          : { kind: 'malformed', reason: `records pageErrors as ${describe(pageErrorsValue)}, not a list` };

    const samplesValue = entry['individualLatenciesMs'];
    const samplesList = asArray(samplesValue);
    let samples: number[] | undefined;
    let sampleProblem: LeafProblem | undefined;
    let malformedSamples = 0;
    let negativeSamples = 0;
    if (samplesList === undefined) {
      sampleProblem = absent(entry, 'individualLatenciesMs')
        ? { kind: 'missing', reason: 'records no individual latency samples' }
        : {
            kind: 'malformed',
            reason: `records individualLatenciesMs as ${describe(samplesValue)}, not a list`,
          };
    } else {
      samples = [];
      for (const sample of samplesList) {
        const value = finiteNumber(sample);
        if (value === undefined) malformedSamples += 1;
        else if (value < 0) negativeSamples += 1;
        else samples.push(value);
      }
    }

    const longTask = readOptionalNumber(entry, 'longTaskMaxMs');
    return {
      index,
      label: name === undefined ? `run ${index}` : `run ${index} (${name})`,
      ...(name === undefined ? {} : { name }),
      ...(ok === undefined ? {} : { ok }),
      ...(okProblem === undefined ? {} : { okProblem }),
      counters,
      counterProblems,
      statistics: new Map<string, unknown>([
        ['medianMs', entry['medianMs']],
        ['p95Ms', entry['p95Ms']],
        ['maxMs', entry['maxMs']],
      ]),
      ...(pageErrors === undefined ? {} : { pageErrors }),
      ...(pageErrorsProblem === undefined ? {} : { pageErrorsProblem }),
      ...(samples === undefined ? {} : { samples }),
      ...(sampleProblem === undefined ? {} : { sampleProblem }),
      malformedSamples,
      negativeSamples,
      ...(isNonEmptyString(entry['cachesCleared']) ? { cachesCleared: entry['cachesCleared'] } : {}),
      ...(longTask.value === undefined ? {} : { longTaskMaxMs: longTask.value }),
      ...(longTask.problem === undefined ? {} : { longTaskProblem: longTask.problem }),
      observerSupported: entry['longTaskObserverSupported'] === true,
    };
  });
}

/** Split recorded problems into the two reason classes, attributed to their run. */
function collect(
  runs: readonly RunFacts[],
  read: (run: RunFacts) => readonly (LeafProblem | undefined)[],
): { failures: string[]; gaps: string[] } {
  const failures: string[] = [];
  const gaps: string[] = [];
  for (const run of runs) {
    for (const problem of read(run)) {
      if (problem === undefined) continue;
      const reason = `${run.label} ${problem.reason}`;
      if (problem.kind === 'missing') gaps.push(reason);
      else failures.push(reason);
    }
  }
  return { failures, gaps };
}

/**
 * Run a per-run check over the trace.
 *
 * A missing report, a runs container that is not a list, an empty run list and a
 * malformed entry are handled once so every check reports them consistently and no
 * check can pass on an empty observation set.
 */
function withRuns(
  context: CheckContext,
  build: (runs: readonly RunFacts[], reference: EvidenceRef) => CheckOutcome,
): CheckOutcome {
  const view = context.byRole.get('trace');
  const reference = sourceEvidence(view, 'runs');
  if (view === undefined || view.shape === undefined || reference === undefined) {
    return unsatisfied(['no display trace report was available']);
  }
  const list = asArray(view.shape.value['runs']);
  if (list === undefined) {
    return violated(
      [`the display trace runs are ${describe(view.shape.value['runs'])}, not a list`],
      [reference],
    );
  }
  if (list.length === 0) {
    return unsatisfied(['the display trace recorded no runs'], [reference]);
  }
  return build(readRunFacts(list), reference);
}

/** Derive a whole-trace outcome from per-run findings. */
function conclude(
  reference: EvidenceRef,
  findings: { readonly failures: readonly string[]; readonly gaps: readonly string[] },
  evidence: readonly EvidenceRef[] = [],
): CheckOutcome {
  if (findings.failures.length > 0) return violated(findings.failures, [reference, ...evidence]);
  if (findings.gaps.length > 0) return unsatisfied(findings.gaps, [reference, ...evidence]);
  return satisfied([reference, ...evidence]);
}

function perRunEvidence(
  context: CheckContext,
  runs: readonly RunFacts[],
  field: (run: RunFacts) => string,
): EvidenceRef[] {
  const view = context.byRole.get('trace');
  const refs: EvidenceRef[] = [];
  for (const run of runs) {
    const ref = sourceEvidence(view, field(run));
    if (ref !== undefined) refs.push(ref);
  }
  return refs;
}

// --------------------------------------------------------------------------
// The declared run set
// --------------------------------------------------------------------------

const runSet: Check = {
  id: 'display.run-set',
  assertion: 'one-cold-and-three-warm-runs',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      // Runs are categorised, not keyed: the plan itself requires three warm runs,
      // so a repeated name is the expected shape. Every diagnostic keeps the index.
      const cold = runs.filter((run) => run.name === 'cold');
      const warm = runs.filter((run) => run.name === 'warm');
      const complete = cold.length >= DECLARATIONS.coldRuns && warm.length >= DECLARATIONS.warmRuns;
      if (!complete) {
        return violated(
          [
            `trace has ${cold.length} cold and ${warm.length} warm run(s); required ${DECLARATIONS.coldRuns} cold and ${DECLARATIONS.warmRuns} warm`,
          ],
          [reference],
        );
      }
      return satisfied([reference]);
    }),
};

// --------------------------------------------------------------------------
// Sufficiency: latencies, requests and their relationship to the counters
// --------------------------------------------------------------------------

const latencySamples: Check = {
  id: 'display.latency-samples',
  assertion: 'hundred-valid-latencies-per-run',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const findings = collect(runs, (run) => [
        run.sampleProblem,
        run.malformedSamples > 0
          ? {
              kind: 'malformed' as const,
              reason: `records ${run.malformedSamples} latency sample(s) that are not finite numbers`,
            }
          : undefined,
        run.negativeSamples > 0
          ? {
              kind: 'malformed' as const,
              reason: `records ${run.negativeSamples} negative latency sample(s), which are not durations`,
            }
          : undefined,
        run.samples !== undefined && run.samples.length < DECLARATIONS.minLatenciesPerRun
          ? {
              kind: 'malformed' as const,
              reason: `records ${run.samples.length} valid latency sample(s); the plan requires at least ${DECLARATIONS.minLatenciesPerRun}`,
            }
          : undefined,
      ]);
      return conclude(
        reference,
        findings,
        perRunEvidence(context, runs, (run) => `runs[${run.index}].individualLatenciesMs`),
      );
    }),
};

const sampleCountMatchesRendered: Check = {
  id: 'display.sample-count-matches-rendered',
  assertion: 'hundred-valid-latencies-per-run',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const failures: string[] = [];
      const gaps: string[] = [];
      for (const run of runs) {
        const rendered = run.counters.get('tilesRendered');
        if (run.samples === undefined) {
          gaps.push(`${run.label} records no usable latency samples to relate to its tile count`);
          continue;
        }
        if (rendered === undefined) {
          gaps.push(`${run.label} records no usable rendered-tile count to relate to its samples`);
          continue;
        }
        if (run.samples.length !== rendered) {
          failures.push(
            `${run.label} rendered ${rendered} tile(s) but records ${run.samples.length} individual latency sample(s)`,
          );
        }
      }
      return conclude(reference, { failures, gaps });
    }),
};

const requestMinimum: Check = {
  id: 'display.request-minimum',
  assertion: 'runs-report-successful-rendering',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const findings = collect(runs, (run) =>
        run.counterProblems.filter((problem) => problem.reason.includes('tileRequests')),
      );
      for (const run of runs) {
        const requested = run.counters.get('tileRequests');
        if (requested === undefined) continue;
        if (requested < DECLARATIONS.minTileRequestsPerRun) {
          findings.failures.push(
            `${run.label} requested ${requested} tile(s); the plan requires at least ${DECLARATIONS.minTileRequestsPerRun} in each cold/warm run`,
          );
        }
      }
      return conclude(reference, findings);
    }),
};

// --------------------------------------------------------------------------
// Rendering: outcome, failures, reconciliation and page errors
// --------------------------------------------------------------------------

const runOutcome: Check = {
  id: 'display.run-outcome',
  assertion: 'runs-report-successful-rendering',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const findings = collect(runs, (run) => [run.okProblem]);
      for (const run of runs) {
        if (run.ok === false) findings.failures.push(`${run.label} did not report a successful run`);
      }
      return conclude(reference, findings);
    }),
};

const failedTiles: Check = {
  id: 'display.failed-tiles',
  assertion: 'runs-report-successful-rendering',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const findings = collect(runs, (run) =>
        run.counterProblems.filter((problem) => problem.reason.includes('failedTiles')),
      );
      for (const run of runs) {
        const failed = run.counters.get('failedTiles');
        if (failed === undefined || failed === 0) continue;
        const rendered = run.counters.get('tilesRendered');
        findings.failures.push(
          rendered === undefined
            ? `${run.label} recorded ${failed} failed tile(s)`
            : `${run.label} rendered ${rendered} tile(s) with ${failed} failure(s)`,
        );
      }
      return conclude(reference, findings);
    }),
};

const counterReconciliation: Check = {
  id: 'display.counter-reconciliation',
  assertion: 'runs-report-successful-rendering',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const findings = collect(runs, (run) => run.counterProblems);
      for (const run of runs) {
        const rendered = run.counters.get('tilesRendered');
        const failed = run.counters.get('failedTiles');
        const requested = run.counters.get('tileRequests');
        if (rendered === undefined || failed === undefined || requested === undefined) continue;
        if (rendered === 0) findings.failures.push(`${run.label} rendered no tiles`);
        if (rendered + failed !== requested) {
          findings.failures.push(
            `${run.label} rendered ${rendered} and failed ${failed} of ${requested} requested tile(s), which does not reconcile`,
          );
        }
      }
      return conclude(reference, findings);
    }),
};

const pageErrors: Check = {
  id: 'display.page-errors',
  assertion: 'runs-report-successful-rendering',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const findings = collect(runs, (run) => [run.pageErrorsProblem]);
      for (const run of runs) {
        if (run.pageErrors !== undefined && run.pageErrors.length > 0) {
          findings.failures.push(`${run.label} recorded ${run.pageErrors.length} page error(s)`);
        }
      }
      return conclude(reference, findings);
    }),
};

// --------------------------------------------------------------------------
// Statistics recomputed from the run's own samples
// --------------------------------------------------------------------------

function expectedStatistic(sorted: readonly number[], label: string): number | undefined {
  if (sorted.length === 0) return undefined;
  if (label === 'maxMs') return sorted[sorted.length - 1];
  if (label === 'medianMs') {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  if (label === 'p95Ms') {
    // Nearest-rank, matching the harness's recorded definition.
    const rank = Math.ceil(0.95 * sorted.length);
    return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
  }
  return undefined;
}

function statisticCheck(id: string, assertion: string, labels: readonly string[]): Check {
  return {
    id,
    assertion,
    run: (context) =>
      withRuns(context, (runs, reference) => {
        const failures: string[] = [];
        const gaps: string[] = [];
        const evidence: EvidenceRef[] = [];
        const view = context.byRole.get('trace');
        for (const run of runs) {
          if (run.samples === undefined) {
            gaps.push(`${run.label} records no usable latency samples to recompute its statistics`);
            continue;
          }
          const sorted = [...run.samples].sort((a, b) => a - b);
          for (const label of labels) {
            const read = readStatistic(run, label);
            if (read.problem !== undefined) {
              (read.problem.kind === 'missing' ? gaps : failures).push(
                `${run.label} ${read.problem.reason}`,
              );
              continue;
            }
            const expected = expectedStatistic(sorted, label);
            if (expected === undefined) {
              gaps.push(`${run.label} records no usable samples to recompute ${label}`);
              continue;
            }
            // Floating-point serialization is compared with a tolerance far below any
            // measurement resolution, so a genuine disagreement is never excused.
            if (Math.abs(expected - read.value!) > 1e-6) {
              failures.push(
                `${run.label} records ${label}=${read.value} but its own samples give ${expected}`,
              );
              continue;
            }
            const ref = sourceEvidence(view, `runs[${run.index}].${label}`);
            if (ref !== undefined) evidence.push(ref);
          }
        }
        return conclude(reference, { failures, gaps }, evidence);
      }),
  };
}

/** Read one recorded statistic from the run's own leaves. */
function readStatistic(run: RunFacts, label: string): { value?: number; problem?: LeafProblem } {
  const raw = run.statistics.get(label);
  if (raw === undefined) {
    return { problem: { kind: 'missing', reason: `does not record ${label}` } };
  }
  const value = finiteNumber(raw);
  if (value === undefined) {
    return {
      problem: {
        kind: 'malformed',
        reason: `records ${label}=${describe(raw)}, which is not a finite measurement`,
      },
    };
  }
  return { value };
}

// --------------------------------------------------------------------------
// Cache state, UI-thread bound and producer-schema support
// --------------------------------------------------------------------------

const cacheState: Check = {
  id: 'display.cache-state',
  assertion: 'cache-state-recorded',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const gaps = runs
        .filter((run) => run.cachesCleared === undefined)
        .map((run) => `${run.label} does not record its cache state`);
      return conclude(reference, { failures: [], gaps });
    }),
};

const uiThreadBound: Check = {
  id: 'display.ui-thread-bound',
  assertion: 'no-ui-thread-task-above-bound',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const failures: string[] = [];
      const gaps: string[] = [];
      for (const run of runs) {
        if (run.longTaskProblem !== undefined) {
          (run.longTaskProblem.kind === 'missing' ? gaps : failures).push(
            `${run.label} ${run.longTaskProblem.reason}`,
          );
          continue;
        }
        const value = run.longTaskMaxMs;
        if (value === undefined) continue;
        if (value < 0) {
          failures.push(`${run.label} records longTaskMaxMs=${value}, which is not a usable duration`);
          continue;
        }
        if (value > DECLARATIONS.uiThreadBoundMs) {
          failures.push(`${run.label}: ${value} ms exceeds the ${DECLARATIONS.uiThreadBoundMs} ms bound`);
        }
      }
      return conclude(reference, { failures, gaps });
    }),
};

const unrecognisedFields: Check = {
  id: 'display.unrecognised-fields',
  assertion: 'unsupported-observation-is-inconclusive',
  run: (context) =>
    withRuns(context, (_runs, reference) => {
      const view = context.byRole.get('trace');
      const list = view?.shape === undefined ? undefined : asArray(view.shape.value['runs']);
      const unrecognised = new Set<string>();
      const unknownNames: string[] = [];
      if (list !== undefined) {
        list.forEach((entry, index) => {
          if (!isRecord(entry)) return;
          for (const key of Object.keys(entry)) {
            if (!KNOWN_RUN_FIELDS.has(key)) unrecognised.add(key);
          }
          const name = entry['name'];
          if (isNonEmptyString(name) && name !== 'cold' && name !== 'warm') {
            unknownNames.push(`run ${index} records run name ${JSON.stringify(name)}`);
          }
        });
      }
      const gaps: string[] = [];
      if (unrecognised.size > 0) {
        gaps.push(
          `the display trace contains fields this consumer does not recognise: ${Array.from(unrecognised).sort().join(', ')}`,
        );
      }
      gaps.push(...unknownNames.map((entry) => `${entry}, which is neither a cold nor a warm run`));
      if (gaps.length > 0) return unsatisfied(gaps, [reference]);
      return satisfied([reference]);
    }),
};

const observerSupport: Check = {
  id: 'display.observer-support',
  assertion: 'unsupported-observation-is-inconclusive',
  run: (context) =>
    withRuns(context, (runs, reference) => {
      const unsupported = runs.filter((run) => !run.observerSupported).map((run) => run.label);
      if (unsupported.length > 0) {
        return unsatisfied(
          [`long-task observation unsupported or unreported for runs: ${unsupported.join(', ')}`],
          [reference],
        );
      }
      return satisfied([reference]);
    }),
};

export const DISPLAY_CHECKS: RequirementChecks = {
  requirementId: 'Q-DISPLAY-1',
  assertions: ASSERTIONS,
  required: [
    'display.run-set',
    'display.latency-samples',
    'display.sample-count-matches-rendered',
    'display.request-minimum',
    'display.run-outcome',
    'display.failed-tiles',
    'display.counter-reconciliation',
    'display.page-errors',
    'display.p95',
    'display.median-max',
    'display.cache-state',
    'display.ui-thread-bound',
    'display.unrecognised-fields',
    'display.observer-support',
  ],
  unsupported: new Map<string, string>(),
  checks: [
    runSet,
    latencySamples,
    sampleCountMatchesRendered,
    requestMinimum,
    runOutcome,
    failedTiles,
    counterReconciliation,
    pageErrors,
    statisticCheck('display.p95', 'p95-from-individual-latencies', ['p95Ms']),
    statisticCheck('display.median-max', 'statistics-agree-with-samples', ['medianMs', 'maxMs']),
    cacheState,
    uiThreadBound,
    unrecognisedFields,
    observerSupport,
  ],
};

export const DISPLAY_PROVENANCE = {
  sourceRoles: ['trace'] as const,
  source: 'reports/q6-trace.json',
  legacyProducerCommand: 'run_display_trace.mjs --fixture <tif> --out reports/q6-trace.json',
  route: 'cog-tiler-wasm renderTilePNG over a disk-backed File',
  artifact: { name: 'cog-tiler-wasm', version: '0.3.6' },
  fixtures: [] as { name: string; sha256?: string }[],
};
