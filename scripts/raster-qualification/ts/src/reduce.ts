/**
 * Reducing measurements per run and then across runs.
 *
 * Two rules matter more than the arithmetic:
 *
 * 1. a counter is reduced only from records that carry the plan's own sampling and
 *    the counters the assertion needs. Unioning counters from records that are each
 *    missing something produces a "complete" run that no probe ever measured;
 * 2. a measured violation survives even when the reduction is incomplete. Only the
 *    absence of a measurement is a gap.
 *
 * `temporaryDiskHighWater` is reported rather than gated against a number: the plan
 * states a staging and free-space policy, not a universal byte budget, and inventing
 * a cap would be inventing a requirement.
 */

import { finiteNonNegative, isRecord, nonNegativeInteger } from './fields.js';
import { Findings, type Verdict } from './verdict.js';
import { DECLARATIONS } from './declared/route.js';

export interface RunRecord {
  readonly index: number;
  readonly routeRole: string;
  readonly route: string;
  /** The plan's sampling cadence, or `undefined` when unrecorded or unusable. */
  readonly sampleIntervalMs: number | undefined;
  /** The number of samples the run took, or `undefined` when unrecorded. */
  readonly sampleCount: number | undefined;
  /** Whether the record can evidence a peak at all. */
  readonly sampled: boolean;
  readonly counters: ReadonlyMap<string, number>;
  /** Counters the record did not supply at all. */
  readonly missing: readonly string[];
  /** Counters the record supplied with an unusable value. */
  readonly malformed: readonly string[];
}

/**
 * Observations a complete candidate resource record must carry.
 *
 * Memory is a per-run peak, so a run that does not record it cannot evidence the
 * combined bound; that is the same class of gap as a missing counter, and it must
 * not be filled in from a different run.
 */
export const REQUIRED_RESOURCE_COUNTERS = [
  'incrementalPeakRssMiB',
  'temporaryDiskHighWaterBytes',
  'decodedCacheBytes',
  'activeReads',
  'queueDepth',
  'maxConcurrentChildren',
] as const;

/** The subset of those counters that also carries a plan budget. */
export const BUDGETED_COUNTERS = ['decodedCacheBytes', 'activeReads', 'queueDepth'] as const;

/** The plan's ceilings, each on the candidate route's own accounting. */
export const RESOURCE_BUDGETS: ReadonlyMap<string, { limit: number; label: string }> = new Map([
  ['decodedCacheBytes', { limit: DECLARATIONS.decodedCacheBytes, label: 'decoded cache' }],
  ['activeReads', { limit: DECLARATIONS.activeReads, label: 'active reads' }],
  ['queueDepth', { limit: DECLARATIONS.queueDepth, label: 'pending display requests' }],
]);

/** Split the measurements list into per-run records, keeping their defects. */
export function readRunRecords(measurements: unknown): RunRecord[] {
  if (!Array.isArray(measurements)) return [];
  return measurements.map((entry, index) => {
    const record = isRecord(entry) ? entry : {};
    const routeRole = typeof record['routeRole'] === 'string' ? record['routeRole'] : '';
    const route = typeof record['route'] === 'string' ? record['route'] : '';
    const counters = new Map<string, number>();
    const missing: string[] = [];
    const malformed: string[] = [];

    /**
     * Classify one observable leaf.
     *
     * Three outcomes are kept apart, because they call for different verdicts: a
     * usable value, a value that is present but unusable (invalid input), and a
     * value that was never written (missing evidence).
     */
    const observe = (
      name: string,
      read: (raw: unknown) => number | undefined,
    ): number | undefined => {
      if (!Object.prototype.hasOwnProperty.call(record, name)) {
        missing.push(name);
        return undefined;
      }
      const raw = record[name];
      if (raw === null) {
        // Present but explicitly null. The schema for these leaves is a number, so a
        // null that is present is malformed input rather than absent evidence.
        malformed.push(name);
        return undefined;
      }
      if (raw === undefined) {
        missing.push(name);
        return undefined;
      }
      const value = read(raw);
      if (value === undefined) {
        malformed.push(name);
        return undefined;
      }
      counters.set(name, value);
      return value;
    };

    const interval = observe('sampleIntervalMs', nonNegativeInteger);
    const count = observe('sampleCount', nonNegativeInteger);
    for (const name of REQUIRED_RESOURCE_COUNTERS) {
      // Memory is a real-valued peak in MiB; the counters are non-negative integers.
      observe(name, name === 'incrementalPeakRssMiB' ? finiteNonNegative : nonNegativeInteger);
    }
    // Every observation is classified whether or not the record can ultimately be
    // reduced. The completeness check below reads `missing` only from records that
    // sampled, so a record with no usable cadence reports the sampling gap as its
    // finding rather than reporting every counter twice.
    const sampled = interval !== undefined && count !== undefined && count > 0;
    return { index, routeRole, route, sampleIntervalMs: interval, sampleCount: count, sampled, counters, missing, malformed };
  });
}

export interface ResourceReduction {
  readonly verdict: Verdict;
  readonly findings: Findings;
  readonly observations: Record<string, unknown>;
}

/**
 * Reduce the candidate route's resource counters and enforce every applicable
 * budget.
 *
 * Each budget is checked on every sampled record, so an over-limit counter is
 * reported even when another counter is absent, and a record sampled at the wrong
 * cadence is a failure rather than an alternative reading.
 */
export function reduceResources(runRecords: readonly RunRecord[]): ResourceReduction {
  const findings = new Findings();
  const observations: Record<string, unknown> = {};
  const candidate = runRecords.filter((record) => record.routeRole === 'candidate');
  const reference = runRecords.filter((record) => record.routeRole !== 'candidate');
  observations['candidateRunCount'] = candidate.length;
  observations['referenceRunCount'] = reference.length;

  if (candidate.length === 0) {
    findings.gap('no candidate-route resource record was supplied');
    return { verdict: findings.verdict(), findings, observations };
  }

  // Sampling is a contract bound, not a preference: a run sampled more coarsely
  // than the plan requires cannot evidence a peak it may have stepped over.
  const intervals: number[] = [];
  const counts: number[] = [];
  for (const record of candidate) {
    const interval = record.sampleIntervalMs;
    const count = record.sampleCount;
    if (interval === undefined || count === undefined || count === 0) {
      const absent = record.missing.filter(
        (name) => name === 'sampleIntervalMs' || name === 'sampleCount',
      );
      const unusable = record.malformed.filter(
        (name) => name === 'sampleIntervalMs' || name === 'sampleCount',
      );
      const detail = [
        absent.length > 0 ? `missing ${absent.join(', ')}` : '',
        unusable.length > 0 ? `unusable ${unusable.join(', ')}` : '',
      ]
        .filter((part) => part !== '')
        .join('; ');
      findings.gap(
        `candidate run ${record.index} does not record a usable sampling cadence (${detail || 'no usable sampling interval or sample count'})`,
      );
      continue;
    }
    intervals.push(interval);
    counts.push(count);
    if (interval > DECLARATIONS.sampleIntervalMs) {
      findings.fail(
        `candidate run ${record.index} sampled every ${interval} ms, exceeding the plan's ${DECLARATIONS.sampleIntervalMs} ms cadence`,
      );
    }
  }
  observations['samplingIntervalsMs'] = intervals;
  observations['sampleCounts'] = counts;

  // Each budget is enforced on every record that recorded the counter, whether or
  // not the record sampled correctly and whether or not another field is missing.
  // An over-limit measurement is a fact about the engine; discarding it because the
  // same record has a gap would lose a known failure.
  let violations = 0;
  for (const record of candidate) {
    for (const [name, budget] of RESOURCE_BUDGETS) {
      const value = record.counters.get(name);
      if (value === undefined) continue;
      if (value > budget.limit) {
        findings.fail(
          `candidate run ${record.index} ${budget.label} ${value} exceeds the plan's ${budget.limit} budget`,
        );
        violations += 1;
      }
    }
  }
  observations['budgetViolations'] = violations;

  // A value that is present but unusable is invalid input, not a gap. It is
  // reported once per field so the reader knows which observation was refused.
  for (const record of candidate) {
    for (const name of record.malformed) {
      findings.fail(
        `candidate run ${record.index} records ${name} with an unusable value, so it is not a measurement`,
      );
    }
  }

  // Per-run peaks are reported for review. A high-water mark is compared with the
  // plan's staging and free-space policy rather than an invented universal cap, so
  // it is carried as an observation and not gated here.
  const sampledRecords = candidate.filter((record) => record.sampled);
  observations['sampledRunCount'] = sampledRecords.length;
  observations['incrementalPeakRssMiB'] = candidate.map(
    (record) => record.counters.get('incrementalPeakRssMiB') ?? null,
  );
  observations['temporaryDiskHighWaterBytes'] = candidate.map(
    (record) => record.counters.get('temporaryDiskHighWaterBytes') ?? null,
  );
  observations['activeReads'] = candidate.map((record) => record.counters.get('activeReads') ?? null);
  observations['queueDepth'] = candidate.map((record) => record.counters.get('queueDepth') ?? null);

  if (sampledRecords.length === 0) {
    findings.gap(
      "no candidate-route record carries the plan's sampling cadence, so its counters were not reduced",
    );
    return { verdict: findings.verdict(), findings, observations };
  }

  // Completeness is judged per record across every mandatory observation, so an
  // incomplete run is never combined with another into a fictional complete one.
  const incomplete = sampledRecords.filter((record) => record.missing.length > 0);
  if (incomplete.length > 0) {
    const detail = incomplete
      .map((record) => `run ${record.index} is missing ${record.missing.join(', ')}`)
      .join('; ');
    findings.gap(
      `candidate route resource records are incomplete, so no complete run was measured: ${detail}`,
    );
  }

  return { verdict: findings.verdict(), findings, observations };
}
