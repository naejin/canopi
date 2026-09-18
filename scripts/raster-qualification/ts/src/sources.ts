/**
 * Reading each source once.
 *
 * A qualification decision must be able to say which bytes it decided on. This
 * module reads a path exactly once, hashes those exact bytes, and keeps absence
 * distinct from corruption:
 *
 * - the path does not exist  -> `absent`, a gap the caller reports as missing;
 * - the path exists but cannot be read or parsed -> `corrupt`, a failure.
 *
 * The parsed value and the digest travel together so nothing downstream can
 * re-read the file and decide on different bytes.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { parseJson, type JsonValue } from './json.js';

function isRecordValue(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface SourceSnapshot {
  /** How the caller referred to this source, for diagnostics. */
  readonly label: string;
  /** Absolute path, retained for diagnostics only. Never written back out. */
  readonly path: string;
  readonly status: 'present' | 'absent' | 'corrupt';
  /** The parsed value, only when `status` is `present`. */
  readonly value?: JsonValue;
  /** Digest of the exact bytes read, only when they were read. */
  readonly digest?: string;
  /** Why the source is absent or corrupt. */
  readonly problem?: string;
  /** Bytes read, retained so field-level readers do not re-read the file. */
  readonly text?: string;
}

export function readSource(path: string, label: string): SourceSnapshot {
  let text: string;
  try {
    if (!statSync(path).isFile()) {
      return { label, path, status: 'absent', problem: `${label} is not a file` };
    }
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { label, path, status: 'absent', problem: `${label} is missing` };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { label, path, status: 'corrupt', problem: `${label} is unreadable: ${detail}` };
  }
  const digest = `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
  const parsed = parseJson(text, label);
  if (!parsed.ok) {
    return { label, path, status: 'corrupt', digest, text, problem: parsed.problem };
  }
  if (!isRecordValue(parsed.value)) {
    return {
      label,
      path,
      status: 'corrupt',
      digest,
      text,
      problem: `${label} is malformed: the document is not a JSON object`,
    };
  }
  return { label, path, status: 'present', value: parsed.value, digest, text };
}

/**
 * Read the raw text of a source, for checks that must see the bytes rather than
 * the decoded value (duplicate identity keys, for example).
 */
export function snapshotText(snapshot: SourceSnapshot): string | undefined {
  return snapshot.text;
}
