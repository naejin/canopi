/**
 * Parsing external bytes.
 *
 * `JSON.parse` is not sufficient for a qualification boundary:
 *
 * - it keeps the last of two identical object keys, so a duplicated declaration or
 *   a duplicated requirement entry silently loses one of them;
 * - it accepts the non-standard `NaN`, `Infinity` and `-Infinity` tokens, which are
 *   not measurements and must not reach a verdict;
 * - it reports failure as a character offset, which is not an actionable diagnostic.
 *
 * This parser rejects all three and names the offending key or token.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ParseResult =
  | { ok: true; value: JsonValue }
  | { ok: false; problem: string };

const NON_FINITE_TOKENS = ['NaN', 'Infinity', '-Infinity'] as const;

export function parseJson(text: string, label: string): ParseResult {
  const nonFinite = scanForNonFinite(text);
  if (nonFinite !== undefined) {
    return {
      ok: false,
      problem: `${label} is malformed: it contains ${nonFinite}, which is not a finite JSON number`,
    };
  }
  const scan = scanForDuplicateKeys(text);
  if (!scan.ok) {
    return { ok: false, problem: `${label} is malformed JSON: ${scan.problem}` };
  }
  if (scan.duplicates.length > 0) {
    const unique = Array.from(new Set(scan.duplicates)).sort();
    return { ok: false, problem: `${label} repeats object key(s): ${unique.join(', ')}` };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, problem: `${label} is malformed JSON: ${detail}` };
  }
  return { ok: true, value: value as JsonValue };
}

/** Find a bare non-finite numeric token outside of any string literal. */
function scanForNonFinite(text: string): string | undefined {
  let index = 0;
  let inString = false;
  let escaped = false;
  while (index < text.length) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      inString = true;
      index += 1;
      continue;
    }
    for (const token of NON_FINITE_TOKENS) {
      if (text.startsWith(token, index) && isTokenBoundary(text, index + token.length)) {
        return token;
      }
    }
    index += 1;
  }
  return undefined;
}

function isTokenBoundary(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return !/[A-Za-z0-9_$]/.test(text[index]!);
}

type ScanResult =
  | { ok: true; duplicates: string[] }
  | { ok: false; problem: string };

/**
 * Walk the raw text and record every object key that appears twice in one object.
 *
 * A recursive-descent walk is used rather than a regular expression so nesting,
 * strings containing braces and escaped quotes are all handled correctly. This is
 * the only reason the text is walked at all; the value itself still comes from
 * `JSON.parse`, so number and string handling stays the engine's.
 */
function scanForDuplicateKeys(text: string): ScanResult {
  let index = 0;
  const duplicates: string[] = [];

  const skipWhitespace = (): void => {
    while (index < text.length && /\s/.test(text[index]!)) index += 1;
  };

  const parseString = (): string | undefined => {
    if (text[index] !== '"') return undefined;
    index += 1;
    let out = '';
    while (index < text.length) {
      const char = text[index]!;
      if (char === '"') {
        index += 1;
        return out;
      }
      if (char === '\\') {
        const next = text[index + 1];
        if (next === undefined) return undefined;
        out += unescapeJson(next, text, index);
        index += next === 'u' ? 6 : 2;
        continue;
      }
      out += char;
      index += 1;
    }
    return undefined;
  };

  /** Returns false when the text is not well-formed enough to continue. */
  const parseValue = (): boolean => {
    skipWhitespace();
    const char = text[index];
    if (char === '{') {
      index += 1;
      const keys = new Set<string>();
      skipWhitespace();
      if (text[index] === '}') {
        index += 1;
        return true;
      }
      for (;;) {
        skipWhitespace();
        const key = parseString();
        if (key === undefined) return false;
        if (keys.has(key)) duplicates.push(key);
        keys.add(key);
        skipWhitespace();
        if (text[index] !== ':') return false;
        index += 1;
        if (!parseValue()) return false;
        skipWhitespace();
        const separator = text[index];
        if (separator === ',') {
          index += 1;
          continue;
        }
        if (separator === '}') {
          index += 1;
          return true;
        }
        return false;
      }
    }
    if (char === '[') {
      index += 1;
      skipWhitespace();
      if (text[index] === ']') {
        index += 1;
        return true;
      }
      for (;;) {
        if (!parseValue()) return false;
        skipWhitespace();
        const separator = text[index];
        if (separator === ',') {
          index += 1;
          continue;
        }
        if (separator === ']') {
          index += 1;
          return true;
        }
        return false;
      }
    }
    if (char === '"') return parseString() !== undefined;
    const start = index;
    while (index < text.length && !/[,}\]:\s]/.test(text[index]!)) index += 1;
    return index > start;
  };

  skipWhitespace();
  if (index >= text.length) return { ok: false, problem: 'the document is empty' };
  if (!parseValue()) return { ok: false, problem: `unexpected content at offset ${index}` };
  skipWhitespace();
  if (index < text.length) {
    return { ok: false, problem: `unexpected trailing content at offset ${index}` };
  }
  return { ok: true, duplicates };
}

function unescapeJson(next: string, text: string, index: number): string {
  switch (next) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case 'b':
      return '\b';
    case 'f':
      return '\f';
    case 'u': {
      const code = Number.parseInt(text.slice(index + 2, index + 6), 16);
      return Number.isNaN(code) ? '' : String.fromCharCode(code);
    }
    default:
      return next;
  }
}
