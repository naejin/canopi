/**
 * Producer assertion records as checks.
 *
 * A producer report records its own named checks with a boolean outcome. These
 * helpers turn one such record — or a family sharing a prefix — into an explicit
 * outcome, keeping three cases apart that a verdict-only helper used to collapse:
 *
 * - the record is absent: the fact is unestablished, so the check gaps;
 * - the record is present without a usable outcome: unestablished, and named;
 * - the record failed: a measured contradiction, so the check fails, and any
 *   independent gap in the same family stays recorded beside it.
 *
 * A whole-report absence gaps too, because no producer observation exists to read.
 */

import {
  contradicted,
  satisfied,
  sourceEvidence,
  unsatisfied,
  violated,
  type Check,
  type EvidenceRef,
} from './checks.js';
import type { SourceView } from '../decide.js';

interface RecordEntry {
  readonly name: string;
  readonly ok?: boolean;
}

function describeRecord(entry: RecordEntry): string {
  return entry.ok === undefined
    ? `assertion ${entry.name} records no outcome`
    : `assertion ${entry.name} failed`;
}

/** The producer's assertion records, by name. */
export function assertionRecords(view: SourceView | undefined): Map<string, RecordEntry> {
  const records = new Map<string, RecordEntry>();
  if (view?.facts === undefined) return records;
  for (const [name, assertion] of view.facts.assertions) {
    records.set(name, {
      name,
      ...(assertion.ok === undefined ? {} : { ok: assertion.ok }),
    });
  }
  return records;
}

/** One producer assertion record as a check. */
export function namedCheck(id: string, assertion: string, role: string, name: string): Check {
  return {
    id,
    assertion,
    run: (context) => {
      const view = context.byRole.get(role);
      const reference = sourceEvidence(view, `assertions[${name}]`);
      if (view === undefined || view.facts === undefined || reference === undefined) {
        return unsatisfied([`no ${role} report was available`]);
      }
      const record = assertionRecords(view).get(name);
      if (record === undefined) {
        return unsatisfied([`the ${role} report records no assertion ${name}`]);
      }
      if (record.ok === false) return violated([describeRecord(record)], [reference]);
      if (record.ok === undefined) return unsatisfied([describeRecord(record)], [reference]);
      return satisfied([reference]);
    },
  };
}

/** Every producer assertion record sharing a prefix, as one check. */
export function prefixCheck(
  id: string,
  assertion: string,
  role: string,
  prefix: string,
  label?: string,
): Check {
  const described = label ?? `assertion(s) starting with ${JSON.stringify(prefix)}`;
  return {
    id,
    assertion,
    run: (context) => {
      const view = context.byRole.get(role);
      const reference = sourceEvidence(view, 'assertions');
      if (view === undefined || view.facts === undefined || reference === undefined) {
        return unsatisfied([`no ${role} report was available`]);
      }
      const matched = Array.from(assertionRecords(view).values()).filter((entry) =>
        entry.name.startsWith(prefix),
      );
      if (matched.length === 0) {
        return unsatisfied([`the ${role} report records no ${described}`], [reference]);
      }
      const failures = matched.filter((entry) => entry.ok === false).map(describeRecord);
      const gaps = matched.filter((entry) => entry.ok === undefined).map(describeRecord);
      const evidence: EvidenceRef[] = [reference];
      for (const entry of matched) {
        const ref = sourceEvidence(view, `assertions[${entry.name}]`);
        if (ref !== undefined) evidence.push(ref);
      }
      if (failures.length > 0) return contradicted(failures, gaps, evidence);
      if (gaps.length > 0) return unsatisfied(gaps, evidence);
      return satisfied(evidence);
    },
  };
}

/** Several required producer assertions under one contract assertion. */
export function combinedCheck(
  id: string,
  assertion: string,
  role: string,
  names: readonly string[],
): Check {
  return {
    id,
    assertion,
    run: (context) => {
      const view = context.byRole.get(role);
      const reference = sourceEvidence(view, 'assertions');
      if (view === undefined || view.facts === undefined || reference === undefined) {
        return unsatisfied([`no ${role} report was available`]);
      }
      const records = assertionRecords(view);
      const failures: string[] = [];
      const gaps: string[] = [];
      const evidence: EvidenceRef[] = [reference];
      for (const name of names) {
        const record = records.get(name);
        if (record === undefined) {
          gaps.push(`the ${role} report records no assertion ${name}`);
          continue;
        }
        if (record.ok === false) failures.push(describeRecord(record));
        else if (record.ok === undefined) gaps.push(describeRecord(record));
        const ref = sourceEvidence(view, `assertions[${name}]`);
        if (ref !== undefined) evidence.push(ref);
      }
      if (failures.length > 0) return contradicted(failures, gaps, evidence);
      if (gaps.length > 0) return unsatisfied(gaps, evidence);
      return satisfied(evidence);
    },
  };
}
