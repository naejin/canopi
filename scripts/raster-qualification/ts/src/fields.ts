/**
 * Strict leaf readers.
 *
 * Every value here arrives as `unknown` from parsed external bytes. A TypeScript
 * annotation is not runtime validation, so each reader checks the runtime type
 * and returns `undefined` for anything it cannot use. Callers decide whether that
 * means a gap or a failure; these functions never guess and never coerce.
 *
 * Three rules apply throughout:
 *
 * - a boolean is not a number and a number is not a boolean, even though both are
 *   usable in arithmetic and truthiness tests;
 * - NaN and the infinities are rejected, because they are not measurements;
 * - a value that is present but unusable is different from a value that is absent,
 *   and that difference is preserved rather than flattened here.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** A nonempty string with no surrounding whitespace left after trimming. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** A finite number. Rejects NaN, +/-Infinity and booleans. */
export function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

/** A finite number that is not negative. */
export function finiteNonNegative(value: unknown): number | undefined {
  const n = finiteNumber(value);
  if (n === undefined || n < 0) return undefined;
  return n;
}

/**
 * A finite non-negative integer.
 *
 * A fractional counter is rejected rather than truncated: a count of 2.5 samples
 * means the producer and this consumer disagree about what was measured.
 */
export function nonNegativeInteger(value: unknown): number | undefined {
  const n = finiteNonNegative(value);
  if (n === undefined || !Number.isInteger(n)) return undefined;
  return n;
}

/** A finite non-negative integer that must be positive. */
export function positiveInteger(value: unknown): number | undefined {
  const n = nonNegativeInteger(value);
  if (n === undefined || n === 0) return undefined;
  return n;
}

/** A finite epoch-seconds timestamp. */
export function timestampSeconds(value: unknown): number | undefined {
  return finiteNumber(value);
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/**
 * A list of records indexed by a unique nonempty string `name`.
 *
 * A repeated name is reported rather than silently resolved to one of the
 * occurrences: two records under one key are ambiguous evidence, and a Map would
 * keep whichever came last.
 */
export function indexByName(
  value: unknown,
  label: string,
): { entries: Map<string, Record<string, unknown>>; problems: string[] } {
  const entries = new Map<string, Record<string, unknown>>();
  const problems: string[] = [];
  if (value === undefined || value === null) return { entries, problems };
  const list = asArray(value);
  if (list === undefined) {
    problems.push(`${label} is ${describe(value)}, not a list`);
    return { entries, problems };
  }
  list.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`${label} entry ${index} is ${describe(entry)}, not an object`);
      return;
    }
    const name = entry['name'];
    if (!isNonEmptyString(name)) {
      problems.push(`${label} entry ${index} has no usable name`);
      return;
    }
    if (entries.has(name)) {
      problems.push(`${label} repeats name ${JSON.stringify(name)}`);
      return;
    }
    entries.set(name, entry);
  });
  return { entries, problems };
}

/** A short, safe description of a value for a diagnostic message. */
export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'boolean') return `the boolean ${String(value)}`;
  if (typeof value === 'number') return `the number ${String(value)}`;
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (isRecord(value)) return 'an object';
  return typeof value;
}

/**
 * Read one field of a record, keeping absence and present-but-unusable distinct.
 *
 * `absent` is true only when the key is genuinely missing; a key holding `null`
 * is present with an unusable value, which several callers must treat as
 * malformed rather than as a gap.
 */
export function field(
  record: Record<string, unknown>,
  key: string,
): { present: boolean; value: unknown } {
  return { present: Object.prototype.hasOwnProperty.call(record, key), value: record[key] };
}
