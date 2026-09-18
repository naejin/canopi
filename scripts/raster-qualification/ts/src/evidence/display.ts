/**
 * Q-DISPLAY-1 - route-level display measurement.
 *
 * The trace's runs are reduced individually and then across runs. Two rules from
 * the acceptance contract shape this mapping:
 *
 * - a measured stall outranks a producer-agreement gap. An unrecognised optional
 *   field is a finding about the producer's schema, and it cannot erase a 900 ms
 *   stall that was actually recorded;
 * - every run must carry the samples and counters the assertions need. Coverage is
 *   never unioned across runs, and a run that cannot be read does not become a gap
 *   for the others.
 */

import { asArray, describe, finiteNumber, isBoolean, isNonEmptyString, isRecord, nonNegativeInteger } from '../fields.js';
import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { DECLARATIONS } from '../declared/route.js';
import { worse, type Verdict } from '../verdict.js';

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

export function mapDisplay(source: SourceView | undefined): MappingResult {
  const assertions = unresolved(ASSERTIONS);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['trace'] as const,
    source: 'reports/q6-trace.json',
    legacyProducerCommand: 'run_display_trace.mjs --fixture <tif> --out reports/q6-trace.json',
    route: 'cog-tiler-wasm renderTilePNG over a disk-backed File',
    artifact: { name: 'cog-tiler-wasm', version: '0.3.6' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  if (source === undefined || source.shape === undefined) {
    gaps.push('no display trace report was available');
    return { assertions, observations, failures, gaps, ...base };
  }

  const runsValue = source.shape.value['runs'];
  const runs = asArray(runsValue);
  if (runs === undefined) {
    failures.push(`the display trace runs are ${describe(runsValue)}, not a list`);
    return { assertions, observations, failures, gaps, ...base };
  }
  if (runs.length === 0) {
    gaps.push('the display trace recorded no runs');
    return { assertions, observations, failures, gaps, ...base };
  }

  const cold = runs.filter((run) => isRecord(run) && run['name'] === 'cold');
  const warm = runs.filter((run) => isRecord(run) && run['name'] === 'warm');
  observations['runCounts'] = { cold: cold.length, warm: warm.length };

  const unrecognised = new Set<string>();
  for (const run of runs) {
    if (!isRecord(run)) continue;
    for (const key of Object.keys(run)) {
      if (!KNOWN_RUN_FIELDS.has(key)) unrecognised.add(key);
    }
  }
  observations['unrecognisedRunFields'] = Array.from(unrecognised).sort();
  if (unrecognised.size > 0) {
    gaps.push(
      `the display trace contains fields this consumer does not recognise: ${Array.from(unrecognised).sort().join(', ')}`,
    );
  }

  // Run counts against the plan's declared run set.
  const complete = cold.length >= DECLARATIONS.coldRuns && warm.length >= DECLARATIONS.warmRuns;
  assertions.set('one-cold-and-three-warm-runs', complete ? 'pass' : 'fail');
  if (!complete) {
    failures.push(
      `trace has ${cold.length} cold and ${warm.length} warm run(s); required ${DECLARATIONS.coldRuns} cold and ${DECLARATIONS.warmRuns} warm`,
    );
  }

  // Per-run reductions. Each run is judged on its own samples.
  let latencyVerdict: Verdict = 'pass';
  let renderingVerdict: Verdict = 'pass';
  let p95Verdict: Verdict = 'pass';
  let statisticsVerdict: Verdict = 'pass';
  let cacheVerdict: Verdict = 'pass';
  for (const run of runs) {
    if (!isRecord(run)) {
      gaps.push('a display run is not an object');
      latencyVerdict = worse(latencyVerdict, 'inconclusive');
      continue;
    }
    const name = isNonEmptyString(run['name']) ? run['name'] : `run ${runs.indexOf(run)}`;

    const samples = asArray(run['individualLatenciesMs']);
    if (samples === undefined) {
      gaps.push(`run ${name} records no individual latency samples`);
      latencyVerdict = worse(latencyVerdict, 'inconclusive');
      p95Verdict = worse(p95Verdict, 'inconclusive');
      statisticsVerdict = worse(statisticsVerdict, 'inconclusive');
    } else {
      const usable: number[] = [];
      let malformed = false;
      for (const sample of samples) {
        const value = finiteNumber(sample);
        if (value === undefined) malformed = true;
        else usable.push(value);
      }
      if (malformed) {
        failures.push(`run ${name} records a latency sample that is not a finite number`);
        latencyVerdict = 'fail';
      } else if (usable.length < DECLARATIONS.minLatenciesPerRun) {
        failures.push(
          `run ${name} records ${usable.length} valid latency sample(s); the plan requires at least ${DECLARATIONS.minLatenciesPerRun}`,
        );
        latencyVerdict = 'fail';
      }
      // p95 and the summary statistics are recomputed from the run's own samples,
      // so a recorded statistic that disagrees with them is a failure.
      const sorted = [...usable].sort((a, b) => a - b);
      p95Verdict = worse(p95Verdict, compare(sorted, run['p95Ms'], 'p95Ms', name, failures));
      statisticsVerdict = worse(
        statisticsVerdict,
        worse(
          compare(sorted, run['medianMs'], 'medianMs', name, failures),
          compare(sorted, run['maxMs'], 'maxMs', name, failures),
        ),
      );
    }

    // Rendering success.
    const ok = run['ok'];
    const rendered = nonNegativeInteger(run['tilesRendered']);
    const failed = nonNegativeInteger(run['failedTiles']);
    if (!isBoolean(ok)) {
      gaps.push(`run ${name} does not record whether it rendered successfully`);
      renderingVerdict = worse(renderingVerdict, 'inconclusive');
    } else if (ok !== true) {
      failures.push(`run ${name} did not report a successful run`);
      renderingVerdict = 'fail';
    } else if (rendered === undefined || failed === undefined) {
      gaps.push(`run ${name} does not record its rendered and failed tile counts`);
      renderingVerdict = worse(renderingVerdict, 'inconclusive');
    } else if (failed > 0 || rendered === 0) {
      failures.push(
        `run ${name} rendered ${rendered} tile(s) with ${failed} failure(s)`,
      );
      renderingVerdict = 'fail';
    }

    // Cache state.
    if (!isNonEmptyString(run['cachesCleared'])) {
      gaps.push(`run ${name} does not record its cache state`);
      cacheVerdict = worse(cacheVerdict, 'inconclusive');
    }
  }
  assertions.set('hundred-valid-latencies-per-run', latencyVerdict);
  assertions.set('runs-report-successful-rendering', renderingVerdict);
  assertions.set('p95-from-individual-latencies', p95Verdict);
  assertions.set('statistics-agree-with-samples', statisticsVerdict);
  assertions.set('cache-state-recorded', cacheVerdict);

  // The UI-thread bound. A recorded violation is read first, so no other finding
  // can demote it to a gap.
  const stall = uiThreadBound(runs, failures, observations);
  assertions.set('no-ui-thread-task-above-bound', stall);

  // Observer support is a separate question from whether a stall was measured.
  const unsupported = runs
    .filter((run) => isRecord(run) && run['longTaskObserverSupported'] !== true)
    .map((run) => (isRecord(run) && isNonEmptyString(run['name']) ? run['name'] : 'unnamed run'));
  if (unsupported.length > 0) {
    gaps.push(`long-task observation unsupported or unreported for runs: ${unsupported.join(', ')}`);
  }
  assertions.set(
    'unsupported-observation-is-inconclusive',
    unsupported.length > 0 || unrecognised.size > 0 ? 'inconclusive' : 'pass',
  );

  return { assertions, observations, failures, gaps, ...base };
}

/**
 * The plan's 50 ms UI-thread bound.
 *
 * The violation is read from every run before any producer-agreement gap is
 * applied: an unrecognised optional field elsewhere in the trace does not make a
 * recorded 900 ms stall unmeasured.
 */
function uiThreadBound(
  runs: readonly unknown[],
  failures: string[],
  observations: Record<string, unknown>,
): Verdict {
  let worst: number | undefined;
  let violation: string | undefined;
  const unmeasured: string[] = [];
  runs.forEach((run, index) => {
    if (!isRecord(run)) return;
    const name = isNonEmptyString(run['name']) ? run['name'] : `run ${index}`;
    const raw = run['longTaskMaxMs'];
    if (raw === undefined || raw === null) {
      unmeasured.push(name);
      return;
    }
    const value = finiteNumber(raw);
    if (value === undefined) {
      failures.push(`run ${name} records longTaskMaxMs=${describe(raw)}, which is not a finite measurement`);
      violation ??= `run ${name} records an unusable long-task measurement`;
      return;
    }
    if (worst === undefined || value > worst) worst = value;
    if (value > DECLARATIONS.uiThreadBoundMs) {
      violation = `run ${name}: ${value} ms exceeds the ${DECLARATIONS.uiThreadBoundMs} ms bound`;
    }
  });
  observations['maxLongTaskMs'] = worst ?? null;
  if (violation !== undefined) {
    failures.push(violation);
    return 'fail';
  }
  if (unmeasured.length > 0 || worst === undefined) {
    observations['unmeasuredRuns'] = unmeasured;
    return 'inconclusive';
  }
  return 'pass';
}

function compare(
  sorted: readonly number[],
  recorded: unknown,
  label: string,
  runName: string,
  failures: string[],
): Verdict {
  if (recorded === undefined || recorded === null) return 'inconclusive';
  const value = finiteNumber(recorded);
  if (value === undefined) {
    failures.push(`run ${runName} records ${label}=${describe(recorded)}, which is not a finite measurement`);
    return 'fail';
  }
  const expected = expectedStatistic(sorted, label);
  if (expected === undefined) return 'inconclusive';
  // Floating-point serialization is compared with a tolerance far below any
  // measurement resolution, so a genuine disagreement is never excused.
  if (Math.abs(expected - value) > 1e-6) {
    failures.push(
      `run ${runName} records ${label}=${value} but its own samples give ${expected}`,
    );
    return 'fail';
  }
  return 'pass';
}

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
