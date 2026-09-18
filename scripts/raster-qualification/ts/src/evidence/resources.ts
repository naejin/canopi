/**
 * Q-RES-1 - route-level resource measurement.
 *
 * The candidate route's own accounting decides this requirement. Reference-reader
 * readings are carried for review and never substitute: a reference measurement
 * relabelled as the candidate is a failure, because calling a different route the
 * candidate is a claim the evidence does not support.
 *
 * Per-run reduction lives in `reduce.ts`: counters are never unioned across
 * incomplete records, and a measured violation survives an incomplete reduction.
 */

import { asArray, describe, finiteNumber, isRecord } from '../fields.js';
import type { SourceView } from '../decide.js';
import type { MappingResult } from './mapping.js';
import { unresolved } from './mapping.js';
import { readRunRecords, reduceResources, type RunRecord } from '../reduce.js';
import { DECLARATIONS } from '../declared/route.js';
import { worse, type Verdict } from '../verdict.js';

const ASSERTIONS = [
  'candidate-memory-within-budget',
  'measurement-is-of-candidate-route',
  'reference-measurements-labelled-separately',
  'sampling-meets-requirement',
  'disk-cache-reads-queue-and-children-recorded',
];

/** Text that identifies a record as describing the reference reader. */
const REFERENCE_MARKERS = ['reference', 'NOT the candidate route'];

export function mapResources(source: SourceView | undefined): MappingResult {
  const assertions = unresolved(ASSERTIONS);
  const observations: Record<string, unknown> = {};
  const failures: string[] = [];
  const gaps: string[] = [];
  const base = {
    sourceRoles: ['q6resources'] as const,
    source: 'reports/q6-resources.json',
    legacyProducerCommand: 'measure.py q6-resources --browser-report <probe> --trace-report <trace> --out reports/q6-resources.json',
    route: 'measured route\'s own resource use',
    artifact: { name: 'whitebox-wasm', version: '0.5.1' },
    fixtures: [] as { name: string; sha256?: string }[],
  };

  if (source === undefined || source.facts === undefined || source.shape === undefined) {
    return { assertions, observations, failures, gaps: ['no resource report was available'], ...base };
  }

  const value = source.shape.value;
  const measurements = asArray(value['measurements']);
  if (measurements === undefined) {
    gaps.push('the resource report records no measurements list');
    return { assertions, observations, failures, gaps, ...base };
  }

  const runRecords = readRunRecords(measurements);
  const rawByIndex = measurements.map((entry) => (isRecord(entry) ? entry : {}));
  const reduction = reduceResources(runRecords);
  Object.assign(observations, reduction.observations);
  // The reduction keeps its own failure/gap split; flattening it into one list here
  // would report an incomplete run as a measured violation.
  const reductionSummary = reduction.findings.summary();
  failures.push(...reductionSummary.failures);
  gaps.push(...reductionSummary.gaps);
  const reductionReasons = reduction.findings.reasons();

  // Route attribution: a record that says "reference" while claiming the candidate
  // role is a contradiction, and a reference reading can never be the candidate's.
  let routeConflict = false;
  for (const record of runRecords) {
    if (record.routeRole !== 'candidate') continue;
    if (REFERENCE_MARKERS.some((marker) => record.route.includes(marker))) {
      failures.push(
        `measurement ${record.index} declares the candidate route role but describes a reference route`,
      );
      routeConflict = true;
    }
  }
  const candidateRecords = runRecords.filter(
    (record) => record.routeRole === 'candidate' && !REFERENCE_MARKERS.some((m) => record.route.includes(m)),
  );
  const referenceRecords = runRecords.filter((record) => record.routeRole !== 'candidate');

  if (runRecords.length === 0) {
    assertions.set('measurement-is-of-candidate-route', 'inconclusive');
  } else if (routeConflict) {
    assertions.set('measurement-is-of-candidate-route', 'fail');
  } else if (candidateRecords.length === 0) {
    gaps.push('no measurement declares the candidate route role');
    assertions.set('measurement-is-of-candidate-route', 'inconclusive');
  } else {
    assertions.set('measurement-is-of-candidate-route', 'pass');
  }

  assertions.set(
    'reference-measurements-labelled-separately',
    referenceRecords.length > 0 ? 'pass' : 'inconclusive',
  );
  if (referenceRecords.length === 0) {
    gaps.push('no reference measurement is recorded to separate');
  }

  // Candidate memory is the plan's combined figure, and only a candidate record may
  // supply it. The reference reader's reading never substitutes, however convenient.
  const candidateWithRaw = candidateRecords.map((record) => ({
    ...record,
    raw: rawByIndex[record.index] ?? {},
  }));
  const memory = candidateMemory(candidateWithRaw, observations);
  assertions.set('candidate-memory-within-budget', memory.verdict);
  failures.push(...memory.failures);
  gaps.push(...memory.gaps);

  // Sampling and the counter budgets come from the per-run reduction.
  const samplingResult = sampling(candidateRecords);
  assertions.set('sampling-meets-requirement', samplingResult.verdict);
  failures.push(...samplingResult.failures);
  gaps.push(...samplingResult.gaps);

  assertions.set('disk-cache-reads-queue-and-children-recorded', reductionSummary.verdict);
  observations['reductionReasons'] = reductionReasons;

  // The plan names a 512 MiB display disk-cache bound, but no producer emits an
  // observation of it. The gap is stated unconditionally rather than inferred from
  // the absence of a field name: a field name is this consumer's guess, so accepting
  // one would let a caller establish the plan's bound by inventing a key. This
  // mirrors the other unsupported obligations, which stay gaps until a producer
  // emits the observation the plan actually names.
  gaps.push(
    "the plan's display disk-cache bound (512 MiB) is not established: no producer emits a display disk-cache observation, so its compliance is unmeasured",
  );
  // The staging/free-space policy is a distinct obligation, and it is named
  // separately so a reader can tell which plan bound is unmeasured rather than seeing
  // one reason stand in for both.
  gaps.push(
    "the plan's staging and free-space policy for temporary disk is not established: temporaryDiskHighWaterBytes is recorded and reported, but no producer declares the staging policy it would be compared against",
  );

  return { assertions, observations, failures, gaps, ...base };
}

/**
 * Candidate route memory against the plan's combined budget.
 *
 * Only a record that declares the candidate role may supply this reading. A
 * reference-reader measurement is a different quantity: substituting it would
 * report a route's memory using an engine that is not the candidate.
 */
/**
 * Candidate route memory against the plan's combined budget.
 *
 * Reads the record itself rather than aligning two independently filtered lists: a
 * leading non-record shifts the measurement indexes, so pairing `raws` with reduced
 * records by position would read the wrong run's memory.
 */
function candidateMemory(
  candidates: readonly (RunRecord & { readonly raw: Record<string, unknown> })[],
  observations: Record<string, unknown>,
): { verdict: Verdict; failures: string[]; gaps: string[] } {
  const readings: number[] = [];
  const failures: string[] = [];
  const gaps: string[] = [];
  for (const record of candidates) {
    const raw = record.raw['incrementalPeakRssMiB'];
    if (raw === undefined) {
      gaps.push(`candidate run ${record.index} does not record its incremental memory peak`);
      continue;
    }
    if (raw === null) {
      failures.push(
        `candidate run ${record.index} records incrementalPeakRssMiB as null, which is not a measurement`,
      );
      continue;
    }
    const value = finiteNumber(raw);
    if (value === undefined) {
      failures.push(
        `candidate run ${record.index} records incrementalPeakRssMiB=${describe(raw)}, which is not a finite measurement`,
      );
      continue;
    }
    readings.push(value);
  }
  observations['candidateMemoryMiB'] = readings;
  observations['memoryBudgetMiB'] = DECLARATIONS.combinedMemoryMiB;

  const over = readings.filter((value) => value > DECLARATIONS.combinedMemoryMiB);
  if (over.length > 0) {
    // A recorded over-budget peak is a measured violation, and it survives any
    // missing observation in another run.
    failures.push(
      `candidate route incremental memory ${Math.max(...over)} MiB exceeds the plan's ${DECLARATIONS.combinedMemoryMiB} MiB budget`,
    );
  }
  if (failures.length > 0) return { verdict: 'fail', failures, gaps };
  if (readings.length === 0) {
    gaps.push(
      'no candidate-route memory measurement was recorded; a reference-reader reading cannot substitute',
    );
    return { verdict: 'inconclusive', failures, gaps };
  }
  return { verdict: gaps.length > 0 ? 'inconclusive' : 'pass', failures, gaps };
}

/**
 * The plan's sampling cadence, reduced across candidate runs.
 *
 * A cadence violation is a measured fact and is reported even when the same run also
 * omits a sampling field. Returning at the first missing field would let a gap hide a
 * known violation, so every run contributes both kinds of finding and the verdict is
 * the more severe of them.
 */
function sampling(candidate: readonly {
  index: number;
  sampleIntervalMs: number | undefined;
  sampleCount: number | undefined;
}[]): { verdict: Verdict; failures: string[]; gaps: string[] } {
  if (candidate.length === 0) {
    return {
      verdict: 'inconclusive',
      failures: [],
      gaps: ['no candidate-route run was available to sample'],
    };
  }
  const failures: string[] = [];
  const gaps: string[] = [];
  let verdict: Verdict = 'pass';
  for (const record of candidate) {
    const interval = record.sampleIntervalMs;
    const count = record.sampleCount;
    if (interval === undefined) {
      gaps.push(`candidate run ${record.index} does not record its sampling interval`);
      verdict = worse(verdict, 'inconclusive');
    } else if (interval > DECLARATIONS.sampleIntervalMs) {
      failures.push(
        `candidate run ${record.index} sampled every ${interval} ms, exceeding the plan's ${DECLARATIONS.sampleIntervalMs} ms cadence`,
      );
      verdict = 'fail';
    }
    if (count === undefined || count === 0) {
      gaps.push(`candidate run ${record.index} does not record a positive sample count`);
      if (verdict !== 'fail') verdict = worse(verdict, 'inconclusive');
    }
  }
  return { verdict, failures, gaps };
}
