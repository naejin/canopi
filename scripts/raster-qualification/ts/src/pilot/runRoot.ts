/**
 * The pilot's owned run root and its bounded log.
 *
 * A run owns exactly one directory, and it must be a directory this invocation
 * created. An existing path of any kind — complete, partial, failed or empty — is
 * refused rather than reused or cleaned, because a run that adopts a previous run's
 * directory can present that run's evidence as its own. Creation is exclusive, so a
 * destination that appears between the check and the create is refused too.
 *
 * Nothing outside the created root is written: inputs, the bench and any previous
 * run's reports are read-only to this process.
 */

import { closeSync, mkdirSync, openSync, realpathSync, lstatSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export interface RunRoot {
  /** The absolute path of the directory this invocation created. */
  readonly path: string;
  readonly reportsPath: string;
  readonly logPath: string;
  /** Files this run publishes, resolved inside the owned root. */
  readonly artifactPath: (name: string) => string;
  /** Producer reports, resolved inside the owned reports directory. */
  readonly reportPath: (name: string) => string;
}

/** One plain file name, never a path that could escape the directory it belongs to. */
function plainName(name: string): string {
  if (name.includes('/') || name.includes('\\') || name === '' || name.startsWith('.')) {
    throw new Error(`refusing to publish ${JSON.stringify(name)}: an artifact name is one plain file inside the run root`);
  }
  return name;
}

export type RunRootResult =
  | { readonly ok: true; readonly root: RunRoot }
  | { readonly ok: false; readonly problems: readonly string[] };

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create the run root exclusively.
 *
 * The returned artifact path helper cannot escape the root: a name containing a path
 * separator is refused rather than joined, so a caller cannot publish outside the
 * directory this run owns.
 */
export interface RunRootHooks {
  /**
   * Test-only seam for the creation race: called after the destination has been
   * established as absent and before it is created. Production never sets it.
   */
  readonly beforeCreate?: () => void;
}

export function createRunRoot(requested: string, hooks: RunRootHooks = {}): RunRootResult {
  const absolute = resolve(requested);
  const parent = dirname(absolute);

  let parentExists = false;
  try {
    parentExists = lstatSync(parent).isDirectory();
  } catch {
    parentExists = false;
  }
  if (!parentExists) {
    return {
      ok: false,
      problems: [`the parent directory ${parent} of the run directory does not exist or is not a directory`],
    };
  }
  let resolvedParent: string;
  try {
    resolvedParent = realpathSync(parent);
  } catch (error) {
    return { ok: false, problems: [`the parent directory ${parent} cannot be resolved: ${detail(error)}`] };
  }

  // An existing object of any kind is refused. This also covers a symlink, a dangling
  // symlink and a file where a directory is expected, without following any of them.
  try {
    lstatSync(absolute);
    return {
      ok: false,
      problems: [
        `${absolute} already exists; a pilot run requires a directory that does not exist yet, and never reuses or cleans an existing one`,
      ],
    };
  } catch {
    // Absent, which is the only acceptable state.
  }

  const target = join(resolvedParent, basename(absolute));
  hooks.beforeCreate?.();
  try {
    // Non-recursive on purpose: the parent must already exist, and a directory that
    // appeared meanwhile is refused instead of adopted.
    mkdirSync(target, { recursive: false, mode: 0o700 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return {
        ok: false,
        problems: [`${target} was created by something else while this run was starting; nothing was modified`],
      };
    }
    return { ok: false, problems: [`cannot create the run directory ${target}: ${detail(error)}`] };
  }

  const reportsPath = join(target, 'reports');
  try {
    mkdirSync(reportsPath, { recursive: false, mode: 0o700 });
  } catch (error) {
    return { ok: false, problems: [`cannot create ${reportsPath}: ${detail(error)}`] };
  }

  return {
    ok: true,
    root: {
      path: target,
      reportsPath,
      logPath: join(target, 'host.log'),
      artifactPath: (name: string) => join(target, plainName(name)),
      reportPath: (name: string) => join(reportsPath, plainName(name)),
    },
  };
}

/**
 * An exclusively created, bounded log.
 *
 * The log is diagnostic output, never evidence: it is not a completion marker, and a
 * run that finished without writing a complete evidence document is still a failed
 * run. The byte bound is enforced as bytes arrive, so a chatty child cannot fill the
 * disk before a final size check happens.
 */
export interface RunLog {
  readonly path: string;
  write(chunk: string): void;
  close(): void;
  readonly truncated: boolean;
  readonly bytesWritten: number;
}

export function createRunLog(path: string, limitBytes: number): RunLog {
  const descriptor = openSync(path, 'wx', 0o600);
  let closed = false;
  let bytes = 0;
  let truncated = false;
  const marker = `\n[log truncated at ${limitBytes} bytes]\n`;
  return {
    path,
    write(chunk: string): void {
      if (closed || chunk.length === 0) return;
      const remaining = limitBytes - bytes;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const slice = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
      try {
        writeSync(descriptor, slice);
        bytes += slice.length;
      } catch {
        // A log write failure must never fail the measurement; the evidence document
        // is the authority and the instrument reports the failure through its result.
        truncated = true;
      }
      if (slice.length < chunk.length) {
        truncated = true;
        try {
          writeSync(descriptor, marker);
        } catch {
          // Already reported as truncated.
        }
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        closeSync(descriptor);
      } catch {
        // Nothing further can be done with a descriptor that will not close.
      }
    },
    get truncated(): boolean {
      return truncated;
    },
    get bytesWritten(): number {
      return bytes;
    },
  };
}
