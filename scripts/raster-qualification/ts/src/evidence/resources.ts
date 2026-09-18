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
import { readRunRecords, reduceResources } from '../reduce.js';
import { DECLARATIONS } from '../declared/route.js';
import { type Verdict } from '../verdict.js';

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
  const raws = measurements.filter(isRecord);
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
  const memory = candidateMemory(raws, candidateRecords, observations);
  assertions.set('candidate-memory-within-budget', memory.verdict);
  for (const reason of memory.reasons) {
    if (memory.verdict === 'fail') failures.push(reason);
    else gaps.push(reason);
  }

  // Sampling and the counter budgets come from the per-run reduction.
  const samplingVerdict = sampling(runRecords, candidateRecords);
  assertions.set('sampling-meets-requirement', samplingVerdict);
  if (samplingVerdict === 'inconclusive') {
    gaps.push('candidate memory sampling interval or count not recorded');
  } else if (samplingVerdict === 'fail') {
    failures.push('candidate sampling is coarser than the plan requires');
  }

  assertions.set('disk-cache-reads-queue-and-children-recorded', reduction.verdict);
  observations['reductionReasons'] = reductionReasons;

  return { assertions, observations, failures, gaps, ...base };
}

/**
 * Candidate route memory against the plan's combined budget.
 *
 * Only a record that declares the candidate role may supply this reading. A
 * reference-reader measurement is a different quantity: substituting it would
 * report a route's memory using an engine that is not the candidate.
 */
function candidateMemory(
  raws: readonly Record<string, unknown>[],
  candidate: readonly { index: number }[],
  observations: Record<string, unknown>,
): { verdict: Verdict; reasons: string[] } {
  const candidateIndexes = new Set(candidate.map((record) => record.index));
  const readings: number[] = [];
  let malformed: string | undefined;
  raws.forEach((record, index) => {
    if (!candidateIndexes.has(index)) return;
    const raw = record['incrementalPeakRssMiB'];
    if (raw === undefined || raw === null) return;
    const value = finiteNumber(raw);
    if (value === undefined) {
      malformed ??= `candidate run ${index} records incrementalPeakRssMiB=${describe(raw)}, which is not a finite measurement`;
      return;
    }
    readings.push(value);
  });
  observations['candidateMemoryMiB'] = readings;
  observations['memoryBudgetMiB'] = DECLARATIONS.combinedMemoryMiB;
  if (malformed !== undefined) return { verdict: 'fail', reasons: [malformed] };
  if (readings.length === 0) {
    return {
      verdict: 'inconclusive',
      reasons: [
        'no candidate-route memory measurement was recorded; a reference-reader reading cannot substitute',
      ],
    };
  }
  const over = readings.filter((value) => value > DECLARATIONS.combinedMemoryMiB);
  if (over.length > 0) {
    return {
      verdict: 'fail',
      reasons: [
        `candidate route incremental memory ${Math.max(...over)} MiB exceeds the plan's ${DECLARATIONS.combinedMemoryMiB} MiB budget`,
      ],
    };
  }
  return { verdict: 'pass', reasons: [] };
}

function sampling(
  all: readonly { index: number; sampleIntervalMs: number | undefined; sampleCount: number | undefined }[],
  candidate: readonly { index: number; sampleIntervalMs: number | undefined; sampleCount: number | undefined }[],
): Verdict {
  if (candidate.length === 0) return 'inconclusive';
  let verdict: Verdict = 'pass';
  for (const record of candidate) {
    const interval = record.sampleIntervalMs;
    const count = record.sampleCount;
    if (interval === undefined || count === undefined || count === 0) return 'inconclusive';
    if (interval > DECLARATIONS.sampleIntervalMs) verdict = 'fail';
  }
  void all;
  return verdict;
}
