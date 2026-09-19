/**
 * Q-RES-1 - route-level resource measurement, as explicit checks.
 *
 * The candidate route's own accounting decides this requirement, and a reference
 * reading never substitutes for it. Role attribution is declared, never inferred:
 * only an explicit `candidate` or `reference` label assigns a measurement to the
 * route, an absent label is a gap, and a label that disagrees with its own route
 * text fails.
 *
 * Every budget is enforced on every record that recorded the counter, so a measured
 * violation survives a malformed sibling, an unsampled record or another record's
 * missing field. Per-run completeness is required only of records that carry the
 * plan's sampling cadence, because a record that sampled nothing describes no run.
 */

import { asArray, describe, finiteNonNegative, isNonEmptyString, isRecord, nonNegativeInteger } from '../fields.js';
import { DECLARATIONS } from '../declared/route.js';
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

const ASSERTIONS = [
  'candidate-memory-within-budget',
  'measurement-is-of-candidate-route',
  'reference-measurements-labelled-separately',
  'sampling-meets-requirement',
  'disk-cache-reads-queue-and-children-recorded',
];

/** Counters a complete candidate resource record must carry. */
const REQUIRED_COUNTERS = [
  'incrementalPeakRssMiB',
  'temporaryDiskHighWaterBytes',
  'decodedCacheBytes',
  'activeReads',
  'queueDepth',
  'maxConcurrentChildren',
] as const;

/** Counters with a plan budget, enforced wherever they appear. */
const BUDGETS: ReadonlyMap<string, { readonly limit: number; readonly label: string }> = new Map([
  ['decodedCacheBytes', { limit: DECLARATIONS.decodedCacheBytes, label: 'decoded cache' }],
  ['activeReads', { limit: DECLARATIONS.activeReads, label: 'active reads' }],
  ['queueDepth', { limit: DECLARATIONS.queueDepth, label: 'pending display requests' }],
]);

/** Text that identifies a record as describing the reference reader. */
const REFERENCE_MARKERS = ['reference', 'NOT the candidate route'];
const CANDIDATE_MARKERS = ['candidate'];

interface LeafProblem {
  readonly kind: 'missing' | 'malformed';
  readonly reason: string;
}

interface ResourceRecord {
  readonly index: number;
  readonly label: string;
  readonly shapeProblem?: string;
  /** The declared role, when it is usable. */
  readonly role?: string;
  readonly roleProblem?: LeafProblem;
  readonly route: string;
  readonly memory?: number;
  readonly memoryProblem?: LeafProblem;
  readonly interval?: number;
  readonly count?: number;
  readonly samplingProblems: readonly LeafProblem[];
  readonly counters: ReadonlyMap<string, number>;
  readonly counterProblems: readonly LeafProblem[];
  /** A record that cannot describe any measurement of the route. */
  readonly sampled: boolean;
}

function absent(record: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined;
}

function readNumeric(
  record: Record<string, unknown>,
  key: string,
  read: (value: unknown) => number | undefined,
  label: string,
): { value?: number; problem?: LeafProblem } {
  if (absent(record, key)) return { problem: { kind: 'missing', reason: `does not record ${key}` } };
  const value = read(record[key]);
  if (value === undefined) {
    return {
      problem: { kind: 'malformed', reason: `records ${key}=${describe(record[key])}, which is not ${label}` },
    };
  }
  return { value };
}

function readRecords(context: CheckContext): { readonly records?: readonly ResourceRecord[]; readonly reference?: EvidenceRef } {
  const view = context.byRole.get('q6resources');
  const reference = sourceEvidence(view, 'measurements');
  if (view === undefined || view.shape === undefined || reference === undefined) return {};
  const value = view.shape.value;
  const list = asArray(value['measurements']);
  if (list === undefined) return { reference };
  return {
    reference,
    records: list.map((entry, index) => {
      if (!isRecord(entry)) {
        return {
          index,
          label: `measurement ${index}`,
          shapeProblem: `measurement ${index} is ${describe(entry)}, not an object`,
          route: '',
          samplingProblems: [],
          counters: new Map<string, number>(),
          counterProblems: [],
          sampled: false,
        };
      }
      const roleValue = entry['routeRole'];
      const role = isNonEmptyString(roleValue) ? roleValue : undefined;
      const roleProblem: LeafProblem | undefined =
        role !== undefined
          ? undefined
          : absent(entry, 'routeRole')
            ? { kind: 'missing', reason: 'records no route role' }
            : {
                kind: 'malformed',
                reason: `records routeRole=${describe(roleValue)}, which is not a usable role label`,
              };
      const memory = readNumeric(entry, 'incrementalPeakRssMiB', finiteNonNegative, 'a non-negative measurement');
      const interval = readNumeric(entry, 'sampleIntervalMs', nonNegativeInteger, 'a whole non-negative count');
      const count = readNumeric(entry, 'sampleCount', nonNegativeInteger, 'a whole non-negative count');
      const samplingProblems: LeafProblem[] = [];
      if (interval.problem !== undefined) samplingProblems.push(interval.problem);
      if (count.problem !== undefined) samplingProblems.push(count.problem);
      const counters = new Map<string, number>();
      const counterProblems: LeafProblem[] = [];
      for (const key of REQUIRED_COUNTERS) {
        const isMemory = key === 'incrementalPeakRssMiB';
        const read = readNumeric(
          entry,
          key,
          isMemory ? finiteNonNegative : nonNegativeInteger,
          isMemory ? 'a non-negative measurement' : 'a whole non-negative count',
        );
        if (read.value === undefined) {
          if (read.problem !== undefined) counterProblems.push(read.problem);
        } else {
          counters.set(key, read.value);
        }
      }
      const sampled = interval.value !== undefined && count.value !== undefined && count.value > 0;
      return {
        index,
        label: `measurement ${index}`,
        ...(role === undefined ? {} : { role }),
        ...(roleProblem === undefined ? {} : { roleProblem }),
        route: isNonEmptyString(entry['route']) ? entry['route'] : '',
        ...(memory.value === undefined ? {} : { memory: memory.value }),
        ...(memory.problem === undefined ? {} : { memoryProblem: memory.problem }),
        ...(interval.value === undefined ? {} : { interval: interval.value }),
        ...(count.value === undefined ? {} : { count: count.value }),
        samplingProblems,
        counters,
        counterProblems,
        sampled,
      };
    }),
  };
}

function routeNamesReference(route: string): boolean {
  const lowered = route.toLowerCase();
  return REFERENCE_MARKERS.some((marker) => lowered.includes(marker.toLowerCase()));
}

function routeNamesCandidate(route: string): boolean {
  const lowered = route.toLowerCase();
  return CANDIDATE_MARKERS.some((marker) => lowered.includes(marker));
}

/** Records whose role cannot be established, reported once by each role check. */
function undeclaredReason(record: ResourceRecord): string | undefined {
  if (record.shapeProblem !== undefined) return record.shapeProblem;
  if (record.roleProblem === undefined) return undefined;
  return `${record.label} ${record.roleProblem.reason}, so its role in the qualified route cannot be established`;
}

const roleLabels: Check = {
  id: 'resources.role-labels',
  assertion: 'measurement-is-of-candidate-route',
  run: (context) => {
    const read = readRecords(context);
    if (read.reference === undefined) return unsatisfied(['no resource report was available']);
    if (read.records === undefined) {
      return violated(['the resource report records no measurements list'], [read.reference]);
    }
    if (read.records.length === 0) {
      return unsatisfied(['no resource measurement was recorded'], [read.reference]);
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [read.reference];
    const candidates: ResourceRecord[] = [];
    for (const record of read.records) {
      if (record.shapeProblem !== undefined) {
        failures.push(record.shapeProblem);
        continue;
      }
      if (record.role === undefined) {
        // A present-but-unusable label is invalid input; only genuine absence gaps.
        const reason = undeclaredReason(record)!;
        const problem = record.roleProblem;
        (problem !== undefined && problem.kind === 'malformed' ? failures : gaps).push(reason);
        continue;
      }
      if (record.role === 'candidate') {
        candidates.push(record);
        if (routeNamesReference(record.route)) {
          failures.push(
            `${record.label} declares the candidate route role but describes a reference route`,
          );
          continue;
        }
        const ref = sourceEvidence(
          context.byRole.get('q6resources'),
          `measurements[${record.index}].routeRole`,
          record.route,
        );
        if (ref !== undefined) evidence.push(ref);
        continue;
      }
      if (record.role === 'reference') {
        if (routeNamesCandidate(record.route) && !routeNamesReference(record.route)) {
          failures.push(
            `${record.label} declares the reference route role but describes a candidate route`,
          );
        }
        continue;
      }
      failures.push(
        `${record.label} declares route role ${JSON.stringify(record.role)}, which is neither candidate nor reference`,
      );
    }
    if (candidates.length === 0) gaps.push('no measurement declares the candidate route role');
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const referenceLabels: Check = {
  id: 'resources.reference-labels',
  assertion: 'reference-measurements-labelled-separately',
  run: (context) => {
    const read = readRecords(context);
    if (read.reference === undefined) return unsatisfied(['no resource report was available']);
    if (read.records === undefined) {
      return violated(['the resource report records no measurements list'], [read.reference]);
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [read.reference];
    const references: ResourceRecord[] = [];
    for (const record of read.records) {
      if (record.role === 'reference') {
        references.push(record);
        const ref = sourceEvidence(
          context.byRole.get('q6resources'),
          `measurements[${record.index}].routeRole`,
          record.route,
        );
        if (ref !== undefined) evidence.push(ref);
        continue;
      }
      if (record.role === undefined || record.role === 'candidate') {
        const reason = undeclaredReason(record);
        const problem = record.roleProblem;
        if (reason !== undefined) {
          if (problem !== undefined && problem.kind === 'malformed') failures.push(reason);
          else gaps.push(reason);
        }
        continue;
      }
      // A present label that is neither candidate nor reference is unusable input.
      failures.push(
        `${record.label} declares route role ${JSON.stringify(record.role)}, which is neither candidate nor reference, so it cannot be counted as a labelled reference measurement`,
      );
    }
    if (references.length === 0) {
      gaps.push('no reference measurement is recorded to separate');
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const candidateMemory: Check = {
  id: 'resources.candidate-memory',
  assertion: 'candidate-memory-within-budget',
  run: (context) => {
    const read = readRecords(context);
    if (read.reference === undefined) return unsatisfied(['no resource report was available']);
    if (read.records === undefined) {
      return violated(['the resource report records no measurements list'], [read.reference]);
    }
    const candidates = read.records.filter((record) => record.role === 'candidate');
    if (candidates.length === 0) {
      return unsatisfied(
        ['no candidate-route measurement was recorded; a reference-reader reading cannot substitute'],
        [read.reference],
      );
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [read.reference];
    for (const record of candidates) {
      if (record.shapeProblem !== undefined) {
        failures.push(record.shapeProblem);
        continue;
      }
      if (record.memoryProblem !== undefined) {
        const reason = `${record.label} ${record.memoryProblem.reason}`;
        (record.memoryProblem.kind === 'missing' ? gaps : failures).push(reason);
        continue;
      }
      const memory = record.memory;
      if (memory === undefined) continue;
      if (memory > DECLARATIONS.combinedMemoryMiB) {
        failures.push(
          `${record.label} incremental memory ${memory} MiB exceeds the plan's ${DECLARATIONS.combinedMemoryMiB} MiB budget`,
        );
        continue;
      }
      const ref = sourceEvidence(
        context.byRole.get('q6resources'),
        `measurements[${record.index}].incrementalPeakRssMiB`,
        `${memory} MiB`,
      );
      if (ref !== undefined) evidence.push(ref);
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const sampling: Check = {
  id: 'resources.sampling',
  assertion: 'sampling-meets-requirement',
  run: (context) => {
    const read = readRecords(context);
    if (read.reference === undefined) return unsatisfied(['no resource report was available']);
    if (read.records === undefined) {
      return violated(['the resource report records no measurements list'], [read.reference]);
    }
    const candidates = read.records.filter((record) => record.role === 'candidate');
    if (candidates.length === 0) {
      return unsatisfied(
        ['no candidate-route record was available to sample; a reference reading cannot substitute'],
        [read.reference],
      );
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [read.reference];
    for (const record of candidates) {
      if (record.shapeProblem !== undefined) {
        failures.push(record.shapeProblem);
        continue;
      }
      for (const problem of record.samplingProblems) {
        const reason = `${record.label} ${problem.reason}`;
        (problem.kind === 'missing' ? gaps : failures).push(reason);
      }
      if (record.interval !== undefined && record.interval > DECLARATIONS.sampleIntervalMs) {
        failures.push(
          `${record.label} sampled every ${record.interval} ms, exceeding the plan's ${DECLARATIONS.sampleIntervalMs} ms cadence`,
        );
      }
      if (record.count === 0) {
        gaps.push(`${record.label} does not record a positive sample count`);
      }
      if (
        record.interval !== undefined &&
        record.count !== undefined &&
        record.count > 0 &&
        record.interval <= DECLARATIONS.sampleIntervalMs
      ) {
        const ref = sourceEvidence(
          context.byRole.get('q6resources'),
          `measurements[${record.index}].sampleIntervalMs`,
          `${record.interval} ms`,
        );
        if (ref !== undefined) evidence.push(ref);
      }
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const countersAndBudgets: Check = {
  id: 'resources.counters-and-budgets',
  assertion: 'disk-cache-reads-queue-and-children-recorded',
  run: (context) => {
    const read = readRecords(context);
    if (read.reference === undefined) return unsatisfied(['no resource report was available']);
    if (read.records === undefined) {
      return violated(['the resource report records no measurements list'], [read.reference]);
    }
    const candidates = read.records.filter((record) => record.role === 'candidate');
    if (candidates.length === 0) {
      return unsatisfied(
        ['no candidate-route resource record was supplied; a reference reading cannot substitute'],
        [read.reference],
      );
    }
    const failures: string[] = [];
    const gaps: string[] = [];
    const evidence: EvidenceRef[] = [read.reference];
    // Every recorded budget is enforced on every record, sampled or not.
    for (const record of candidates) {
      for (const [key, budget] of BUDGETS) {
        const value = record.counters.get(key);
        if (value === undefined) continue;
        if (value > budget.limit) {
          failures.push(
            `${record.label} ${budget.label} ${value} exceeds the plan's ${budget.limit} budget`,
          );
        } else {
          const ref = sourceEvidence(
            context.byRole.get('q6resources'),
            `measurements[${record.index}].${key}`,
            `${value}`,
          );
          if (ref !== undefined) evidence.push(ref);
        }
      }
      for (const problem of record.counterProblems) {
        if (problem.kind === 'malformed') {
          failures.push(`${record.label} ${problem.reason}, so it is not a measurement`);
        }
      }
    }
    // Completeness is required of records that carry the plan's sampling cadence:
    // a record that sampled nothing describes no run, so its missing counters cannot
    // be reduced into a fictional complete one.
    const sampled = candidates.filter((record) => record.sampled);
    if (sampled.length === 0) {
      gaps.push(
        "no candidate-route record carries the plan's sampling cadence, so its counters were not reduced",
      );
    }
    // Incompleteness is reported as the reduction-level fact it is: a run that is
    // missing a counter cannot be completed from another run, so the requirement is
    // inconclusive and the missing leaves are named per record.
    const incomplete = sampled
      .map((record) => {
        const missing = record.counterProblems
          .filter((problem) => problem.kind === 'missing')
          .map((problem) => problem.reason.replace('does not record ', ''));
        return missing.length === 0 ? undefined : `${record.label} is missing ${missing.join(', ')}`;
      })
      .filter((entry): entry is string => entry !== undefined);
    if (incomplete.length > 0) {
      gaps.push(
        `candidate route resource records are incomplete, so no complete run was measured: ${incomplete.join('; ')}`,
      );
    }
    if (failures.length > 0) return contradicted(failures, gaps, evidence);
    if (gaps.length > 0) return unsatisfied(gaps, evidence);
    return satisfied(evidence);
  },
};

const DECLARED_GAPS = [
  "the plan's display disk-cache bound (512 MiB) is not established: no producer emits a display disk-cache observation, so its compliance is unmeasured",
  "the plan's staging and free-space policy for temporary disk is not established: temporaryDiskHighWaterBytes is recorded and reported, but no producer declares the staging policy it would be compared against",
];

export const RESOURCE_CHECKS: RequirementChecks = {
  requirementId: 'Q-RES-1',
  assertions: ASSERTIONS,
  required: [
    'resources.role-labels',
    'resources.reference-labels',
    'resources.candidate-memory',
    'resources.sampling',
    'resources.counters-and-budgets',
  ],
  unsupported: new Map<string, string>(),
  declaredGaps: DECLARED_GAPS,
  checks: [roleLabels, referenceLabels, candidateMemory, sampling, countersAndBudgets],
};

export const RESOURCE_PROVENANCE = {
  sourceRoles: ['q6resources'] as const,
  source: 'reports/q6-resources.json',
  legacyProducerCommand:
    'measure.py q6-resources --browser-report <probe> --trace-report <trace> --out reports/q6-resources.json',
  route: "measured route's own resource use",
  artifact: { name: 'whitebox-wasm', version: '0.5.1' },
  fixtures: [] as { name: string; sha256?: string }[],
};
