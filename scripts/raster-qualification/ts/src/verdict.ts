/**
 * The verdict vocabulary and the one reduction.
 *
 * There is exactly one place in this codebase where a set of findings becomes a
 * verdict, and it is `reduce`. Every layer - a leaf check, a report's admission,
 * a requirement, the whole qualification - goes through it, so "a known failure
 * outranks an independent gap" is a property of the code rather than a rule each
 * caller is asked to remember.
 */

export const PASS = 'pass' as const;
export const FAIL = 'fail' as const;
export const INCONCLUSIVE = 'inconclusive' as const;
export const NOT_APPLICABLE = 'not_applicable' as const;

export type Verdict = typeof PASS | typeof FAIL | typeof INCONCLUSIVE;

/** Evaluated in this order: any fail wins, then any inconclusive, then pass. */
export const PRECEDENCE: readonly Verdict[] = [FAIL, INCONCLUSIVE, PASS];

export function isVerdict(value: unknown): value is Verdict {
  return value === PASS || value === FAIL || value === INCONCLUSIVE;
}

/**
 * Findings accumulated while evaluating one thing.
 *
 * `failures` and `gaps` are kept apart so that a caller can report both without
 * one overwriting the other, and so `reduce` can apply the precedence once.
 */
export class Findings {
  private readonly failures: string[] = [];
  private readonly gaps: string[] = [];

  fail(reason: string): void {
    this.failures.push(reason);
  }

  gap(reason: string): void {
    this.gaps.push(reason);
  }

  /** Adopt another set of findings, preserving both classes. */
  merge(other: Findings): void {
    this.failures.push(...other.failures);
    this.gaps.push(...other.gaps);
  }

  get hasFailure(): boolean {
    return this.failures.length > 0;
  }

  get hasGap(): boolean {
    return this.gaps.length > 0;
  }

  /** Every reason collected, failures first, each stated once. */
  reasons(): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const reason of [...this.failures, ...this.gaps]) {
      if (seen.has(reason)) continue;
      seen.add(reason);
      out.push(reason);
    }
    return out;
  }

  verdict(): Verdict {
    return reduce(this.failures, this.gaps);
  }

  /**
   * The verdict with each class of reason kept separate.
   *
   * Admission returns both, because a reader must be able to tell a measured
   * violation from a missing observation even when the reduced verdict is the same.
   */
  summary(): { verdict: Verdict; failures: string[]; gaps: string[] } {
    return {
      verdict: reduce(this.failures, this.gaps),
      failures: dedupe(this.failures),
      gaps: dedupe(this.gaps),
    };
  }
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * The single reduction.
 *
 * A failure outranks any number of gaps: a measured violation is a fact about the
 * engine, while a gap is a fact about the record, and losing the former to the
 * latter is how a known failure disappears.
 */
export function reduce(failures: readonly string[], gaps: readonly string[]): Verdict {
  if (failures.length > 0) return FAIL;
  if (gaps.length > 0) return INCONCLUSIVE;
  return PASS;
}

/** Combine assertion verdicts for one requirement. */
export function combine(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes(FAIL)) return FAIL;
  if (verdicts.includes(INCONCLUSIVE)) return INCONCLUSIVE;
  return PASS;
}

/** The more severe of two verdicts. */
export function worse(a: Verdict, b: Verdict): Verdict {
  return PRECEDENCE.indexOf(a) <= PRECEDENCE.indexOf(b) ? a : b;
}
