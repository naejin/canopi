/**
 * The report envelope every producer shares.
 *
 * A report is `unknown` data until it is read here. This module owns the shape
 * checks that apply to every role, so no requirement mapping has to re-derive
 * them, and so a malformed field is a diagnostic rather than a crash deep inside
 * one role's arithmetic.
 *
 * Absence and malformation stay apart throughout: a field the producer did not
 * write is a gap, while a field it wrote with the wrong kind of value is a
 * failure.
 */

import {
  asArray,
  describe,
  finiteNumber,
  indexByName,
  isNonEmptyString,
  isRecord,
  nonNegativeInteger,
  timestampSeconds,
} from './fields.js';

/** Report fields read as objects somewhere in the mappings. */
const MAPPING_FIELDS = ['identity', 'serverLedger', 'sidecar', 'environment'] as const;
/** Report fields walked as lists somewhere in the mappings. */
const LIST_FIELDS = [
  'assertions',
  'failures',
  'preconditions',
  'runs',
  'measurements',
  'windows',
  'verifiedArtifacts',
  'sourceCorrespondence',
  'notes',
  'negativeControls',
] as const;
/** Identity fields read as text. */
const IDENTITY_TEXT_FIELDS = [
  'id',
  'experiment',
  'runId',
  'recordedAt',
  'command',
  'routeId',
  'environment',
  'host',
  'fixturePolicy',
  'sidecarPolicy',
  'transport',
  'digest',
] as const;

export interface Assertion {
  readonly name: string;
  readonly ok?: boolean;
}

export interface AdmissionFacts {
  /** The report's own verdict claim, when it made one. */
  readonly result?: string;
  readonly resultDeclared: boolean;
  readonly assertions: ReadonlyMap<string, Assertion>;
  readonly failures: readonly string[];
  readonly preconditions: readonly { readonly name: string; readonly met?: boolean }[];
  readonly identity?: Record<string, unknown>;
}

export interface ReportShape {
  readonly value: Record<string, unknown>;
  /** Field-level defects that make the report malformed rather than absent. */
  readonly problems: readonly string[];
  /** Fields the report did not supply at all. */
  readonly gaps: readonly string[];
}

/**
 * Check the container kinds of every field the mappings read.
 *
 * A boolean or a number is never acceptable where an object or a list is read,
 * and a TypeScript annotation does not make it one at runtime.
 */
export function checkReportShape(value: unknown, label: string): ReportShape {
  if (!isRecord(value)) {
    return {
      value: {},
      problems: [`${label} is ${describe(value)}, not a JSON object`],
      gaps: [],
    };
  }
  const problems: string[] = [];
  const gaps: string[] = [];
  for (const name of MAPPING_FIELDS) {
    const field = value[name];
    if (field !== undefined && field !== null && !isRecord(field)) {
      problems.push(`${label} ${name} is ${describe(field)}, but it is read as an object`);
    }
  }
  for (const name of LIST_FIELDS) {
    const field = value[name];
    if (field !== undefined && field !== null && asArray(field) === undefined) {
      problems.push(`${label} ${name} container is not a list (${describe(field)})`);
    }
  }
  const identity = value['identity'];
  if (isRecord(identity)) {
    for (const name of IDENTITY_TEXT_FIELDS) {
      const field = identity[name];
      if (field === undefined || field === null) continue;
      if (name === 'recordedAt') {
        if (timestampSeconds(field) === undefined) {
          problems.push(`${label} identity.recordedAt is not a finite time (${describe(field)})`);
        }
        continue;
      }
      if (!isNonEmptyString(field)) {
        problems.push(`${label} identity.${name} is not text (${describe(field)})`);
      }
    }
    const fixtures = identity['fixtures'];
    if (fixtures !== undefined && fixtures !== null) {
      const list = asArray(fixtures);
      if (list === undefined) {
        problems.push(`${label} identity.fixtures container is not a list (${describe(fixtures)})`);
      } else {
        list.forEach((entry, index) => {
          if (!isRecord(entry)) {
            problems.push(`${label} identity.fixtures[${index}] is not an object (${describe(entry)})`);
          }
        });
      }
    }
    const artifact = identity['artifact'];
    if (artifact !== undefined && artifact !== null && !isRecord(artifact)) {
      problems.push(`${label} identity.artifact is not an object (${describe(artifact)})`);
    }
    // The identity fields a source must record to be traceable at all. Reported as
    // gaps, because a field the producer did not write is missing evidence rather
    // than a contradiction of it.
    for (const name of ['id', 'experiment', 'command', 'environment']) {
      const field = identity[name];
      if (field === undefined || field === null) {
        gaps.push(`${label} identity does not record ${name}`);
      } else if (!isNonEmptyString(field)) {
        problems.push(`${label} identity.${name} is not text (${describe(field)})`);
      }
    }
    const runId = identity['runId'];
    if (runId === undefined || runId === null) {
      gaps.push(`${label} identity does not record a nonempty runId`);
    } else if (!isNonEmptyString(runId)) {
      problems.push(`${label} identity.runId is not text (${describe(runId)})`);
    }
  }
  return { value, problems, gaps };
}

/** Read the boolean outcome of an assertion or precondition leaf. */
function readBooleanLeaf(
  record: Record<string, unknown>,
  key: string,
  name: string,
  label: string,
  problems: string[],
): boolean | undefined {
  const held = Object.prototype.hasOwnProperty.call(record, key);
  if (!held) return undefined;
  const value = record[key];
  if (value === null) {
    problems.push(`${label} ${name} records a null ${key}, which is not a boolean`);
    return undefined;
  }
  if (typeof value !== 'boolean') {
    problems.push(
      `${label} ${name} records ${key}=${describe(value)}, which is not a boolean`,
    );
    return undefined;
  }
  return value;
}

/**
 * Read the facts admission needs, reporting every shape defect it finds.
 *
 * Every field is inspected before the result is used, so one malformed container
 * cannot stop another field's finding from being collected.
 */
export function readAdmissionFacts(shape: ReportShape, label: string): {
  facts: AdmissionFacts;
  problems: string[];
} {
  const value = shape.value;
  const problems: string[] = [];

  const resultDeclared = Object.prototype.hasOwnProperty.call(value, 'result');
  const rawResult = value['result'];
  let result: string | undefined;
  if (resultDeclared) {
    if (rawResult === null) {
      problems.push(`${label} declares a null result, which is not a usable verdict`);
    } else if (!isNonEmptyString(rawResult)) {
      problems.push(`${label} declares an unusable result ${describe(rawResult)}`);
    } else {
      result = rawResult;
    }
  }

  const assertions = indexByName(value['assertions'], `${label} assertions`);
  problems.push(...assertions.problems);
  const assertionMap = new Map<string, Assertion>();
  for (const [name, entry] of assertions.entries) {
    const ok = readBooleanLeaf(entry, 'ok', JSON.stringify(name), label, problems);
    assertionMap.set(name, ok === undefined ? { name } : { name, ok });
  }
  // A repeated assertion name is ambiguous evidence whether or not the duplicates
  // agree, so it is reported even though the index kept the first.
  for (const problem of assertions.problems) {
    if (/repeats name/.test(problem)) problems.push(problem);
  }

  const failureList = asArray(value['failures']);
  const failures: string[] = [];
  if (value['failures'] === null) {
    problems.push(`${label} failures container is null, which is not a list`);
  } else if (value['failures'] !== undefined && failureList === undefined) {
    problems.push(`${label} failures container is not a list (${describe(value['failures'])})`);
  } else if (failureList !== undefined) {
    failureList.forEach((entry, index) => {
      if (isNonEmptyString(entry)) failures.push(entry);
      else problems.push(`${label} failure ${index} is not a named failure (${describe(entry)})`);
    });
  }

  const preconditionList = asArray(value['preconditions']);
  const preconditions: { name: string; met?: boolean }[] = [];
  if (value['preconditions'] === null) {
    // Present but explicitly null. The container is documented as a list, so a null
    // that is present is malformed rather than an absent container.
    problems.push(`${label} preconditions container is null, which is not a list`);
  } else if (value['preconditions'] !== undefined && preconditionList === undefined) {
    problems.push(
      `${label} preconditions container is not a list (${describe(value['preconditions'])})`,
    );
  } else if (preconditionList !== undefined) {
    const seen = new Set<string>();
    preconditionList.forEach((entry, index) => {
      if (!isRecord(entry)) {
        problems.push(`${label} precondition ${index} is not an object (${describe(entry)})`);
        return;
      }
      const name = entry['name'];
      if (!isNonEmptyString(name)) {
        problems.push(`${label} precondition ${index} has no usable name`);
        return;
      }
      if (seen.has(name)) {
        problems.push(`${label} has duplicate precondition name(s): ${name}`);
        return;
      }
      seen.add(name);
      // A precondition that does not record whether it held has not established
      // anything, so it is reported as a gap rather than accepted silently. A
      // present but non-boolean `met` was already reported as a failure.
      const held = Object.prototype.hasOwnProperty.call(entry, 'met');
      const met = readBooleanLeaf(entry, 'met', JSON.stringify(name), label, problems);
      if (!held) {
        problems.push(`${label} precondition ${JSON.stringify(name)} does not record whether it held`);
      }
      preconditions.push(met === undefined ? { name } : { name, met });
    });
  }

  const identity = isRecord(value['identity']) ? value['identity'] : undefined;

  // The envelope's own experiment label and the identity block must agree: two
  // different names for the same run is a contradiction in the record.
  const envelopeExperiment = value['experiment'];
  if (
    isNonEmptyString(envelopeExperiment) &&
    identity !== undefined &&
    isNonEmptyString(identity['experiment']) &&
    envelopeExperiment !== identity['experiment']
  ) {
    problems.push(
      `${label} envelope names experiment ${JSON.stringify(envelopeExperiment)} but its identity names ${JSON.stringify(identity['experiment'])}`,
    );
  }

  return {
    facts: {
      ...(result === undefined ? {} : { result }),
      resultDeclared,
      assertions: assertionMap,
      failures,
      preconditions,
      ...(identity === undefined ? {} : { identity }),
    },
    problems,
  };
}

/** Whether a value is a usable, non-finite-free measurement for a named counter. */
export function nonNegativeCount(value: unknown): number | undefined {
  return nonNegativeInteger(value);
}

/** Whether a value is a usable finite measurement. */
export function measurement(value: unknown): number | undefined {
  return finiteNumber(value);
}
