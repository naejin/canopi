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

import { finiteNumber, isRecord, nonNegativeInteger } from './fields.js';
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

/** Counters a complete candidate resource record must carry. */
export const REQUIRED_RESOURCE_COUNTERS = [
  'temporaryDiskHighWaterBytes',
  'decodedCacheBytes',
  'activeReads',
  'queueDepth',
  'maxConcurrentChildren',
] as const;

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
    const interval = nonNegativeInteger(record['sampleIntervalMs']);
    const count = nonNegativeInteger(record['sampleCount']);
    const sampled = interval !== undefined && count !== undefined && count > 0;
    const counters = new Map<string, number>();
    const missing: string[] = [];
    const malformed: string[] = [];
    for (const name of REQUIRED_RESOURCE_COUNTERS) {
      const raw = record[name];
      if (raw === undefined || raw === null) {
        if (sampled) missing.push(name);
        continue;
      }
      const value = nonNegativeInteger(raw);
      if (value === undefined) malformed.push(name);
      else counters.set(name, value);
    }
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
      findings.gap(
        `candidate run ${record.index} does not record a usable sampling interval or sample count`,
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

  // Each budget is enforced on every sampled record, independently of the others.
  let violations = 0;
  for (const record of candidate) {
    if (!record.sampled) continue;
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

  // The declaration's own resource records, reported for review. A high-water mark
  // is reported rather than compared with an invented cap.
  const sampledRecords = candidate.filter((record) => record.sampled);
  observations['sampledRunCount'] = sampledRecords.length;
  observations['temporaryDiskHighWaterBytes'] = sampledRecords
    .map((record) => record.counters.get('temporaryDiskHighWaterBytes') ?? null);
  observations['activeReads'] = sampledRecords.map((record) => record.counters.get('activeReads') ?? null);
  observations['queueDepth'] = sampledRecords.map((record) => record.counters.get('queueDepth') ?? null);

  if (sampledRecords.length === 0) {
    findings.gap(
      "no candidate-route record carries the plan's sampling cadence, so its counters were not reduced",
    );
    return { verdict: findings.verdict(), findings, observations };
  }

  // Completeness is judged per record, and a counter missing from any sampled
  // record leaves the reduction incomplete rather than being filled in from a
  // different record.
  const incomplete = sampledRecords.filter(
    (record) => record.missing.length > 0 || record.malformed.length > 0,
  );
  if (incomplete.length > 0) {
    const detail = incomplete
      .map((record) => {
        const parts: string[] = [];
        if (record.missing.length > 0) parts.push(`missing ${record.missing.join(', ')}`);
        if (record.malformed.length > 0) parts.push(`malformed ${record.malformed.join(', ')}`);
        return `run ${record.index} (${parts.join('; ')})`;
      })
      .join('; ');
    findings.gap(
      `candidate route resource records are incomplete, so no complete run was measured: ${detail}`,
    );
  }

  return { verdict: findings.verdict(), findings, observations };
}
