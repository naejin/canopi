/**
 * Publication that never overwrites.
 *
 * This module owns every write the decision path performs. Two documents are
 * published: the decision computed from admitted sources, and the non-qualifying
 * diagnostic emitted when an invocation cannot produce one. Neither may replace a
 * path that already exists, and neither may be written over a path this invocation
 * read as evidence.
 *
 * The rules, in the order they are applied:
 *
 * 1. an existing destination is never replaced, whatever its contents look like;
 * 2. a destination that is (or resolves to) a known input is refused even when that
 *    input is absent, because a later run would read the document as evidence;
 * 3. a read-set the invocation could not recover completely cannot make any
 *    destination safe, so the requested path is not used at all;
 * 4. when the requested destination is unusable, a fresh exclusive directory is
 *    created beneath the destination's parent and the diagnostic is published
 *    there, with its real path reported to the caller. A fixed sibling name is
 *    never chosen: it could itself be an input or an existing file;
 * 5. if even that fails, the caller is told explicitly that no diagnostic was
 *    saved. A path is never claimed before publication succeeds.
 *
 * The document is serialized exactly once, before any filesystem object is
 * created, and is published by hard-linking a complete staging file into place,
 * which fails rather than truncating when something else created the destination
 * first. There is deliberately no overwriting fallback: a filesystem that cannot
 * support no-replace publication is reported, not worked around.
 */

import {
  closeSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** A document this invocation publishes. Diagnostics are never qualification. */
export type PublicationKind = 'decision' | 'diagnostic';

export interface PublicationBase {
  /** The path the caller asked for. */
  readonly requestedOut: string;
  /** Every path this invocation reads, as supplied, including absent ones. */
  readonly inputs: readonly string[];
  /** False when the invocation could not recover the complete input set. */
  readonly readSetComplete: boolean;
  /** Problems the invocation already established, recorded in diagnostics. */
  readonly problems: readonly string[];
  /** The decision-document version this build writes. */
  readonly version: number;
  /** Evaluation time recorded in a fallback diagnostic. */
  readonly generatedAt: number;
}

export type PublicationRequest =
  | (PublicationBase & { readonly kind: 'decision'; readonly document: unknown })
  | (PublicationBase & { readonly kind: 'diagnostic' });

/**
 * A seam for fault injection in tests.
 *
 * The no-replace guarantee has two layers: an early refusal when the destination is
 * already known to exist, and the atomic no-replace link that also covers a
 * destination created meanwhile. The second layer is only reachable during a genuine
 * race, which a test cannot stage through the CLI, so this single hook exists. It is
 * inert unless a test sets it: production code never does.
 */
export const publicationFaultInjection: {
  beforeLink?: (destination: string) => void;
} = {};

export interface PublicationResult {
  /** Where a document was actually published; absent when nothing was written. */
  readonly publishedPath?: string;
  /** True when the document was published at the caller's requested path. */
  readonly requestedPathUsed: boolean;
  /** What was published, absent when nothing was. */
  readonly publishedKind?: PublicationKind;
  /** Lines the caller reports on stderr, in order. */
  readonly messages: readonly string[];
  /** Reasons the requested destination could not be used, or publication failed. */
  readonly problems: readonly string[];
}

const STAGE_PREFIX = '.q-stage-';
const STAGED_NAME = 'document.json';
const DIAGNOSTIC_PREFIX = 'q-diagnostic-';
const DIAGNOSTIC_NAME = 'rejected-input.json';

/** Make a decision document JSON-safe without changing a verdict. */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serialize once, before anything is created on disk. */
function serialize(document: unknown): string {
  return `${JSON.stringify(document, replacer, 2)}\n`;
}

type Canonical = { readonly ok: true; readonly path: string } | { readonly ok: false; readonly problem: string };

/**
 * The canonical form of an input path.
 *
 * A path that exists is resolved through the filesystem, so a symlink or a
 * symlinked parent directory is compared as the file it names.
 *
 * A path that does not exist is still resolved through its nearest existing
 * ancestor, with the unresolved suffix appended. Resolving an absent path
 * lexically would miss an alias: an input declared as `alias/not-yet.json` and an
 * output written as `actual/not-yet.json` are the same future file when `alias` is
 * a symlink to `actual`, and publishing would create the input. Only genuine
 * absence takes this route; an ancestor that exists but cannot be resolved means
 * safety cannot be established, so it is reported rather than guessed. Nothing is
 * created here.
 */
function canonicalInput(path: string): Canonical {
  const absolute = resolve(path);
  let exists = false;
  try {
    lstatSync(absolute);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    try {
      return { ok: true, path: realpathSync(absolute) };
    } catch (error) {
      return { ok: false, problem: `cannot resolve the input path ${path}: ${detail(error)}` };
    }
  }

  const suffix: string[] = [];
  let current = absolute;
  for (;;) {
    const parent = dirname(current);
    suffix.unshift(basename(current));
    let parentExists = false;
    try {
      lstatSync(parent);
      parentExists = true;
    } catch {
      parentExists = false;
    }
    if (parentExists) {
      try {
        return { ok: true, path: join(realpathSync(parent), ...suffix) };
      } catch (error) {
        return {
          ok: false,
          problem: `cannot resolve the existing ancestor ${parent} of the absent input path ${path}: ${detail(error)}`,
        };
      }
    }
    if (parent === current) {
      // Nothing on the path exists, so its resolved form is already canonical.
      return { ok: true, path: absolute };
    }
    current = parent;
  }
}

type Destination =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly problem: string };

/**
 * Decide whether the requested destination may be published to.
 *
 * An existing object of any kind is refused, which also covers hard-linked inputs
 * and dangling symlinks without needing to enumerate their targets. A destination
 * that does not exist is compared by its canonical parent, so a path that reaches
 * an input through a symlinked directory is still recognised as that input.
 */
function destinationState(
  requestedOut: string,
  inputs: readonly string[],
  readSetComplete: boolean,
): Destination {
  const absolute = resolve(requestedOut);

  let exists = false;
  try {
    lstatSync(absolute);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    return {
      ok: false,
      problem: `${requestedOut} already exists; this tool never replaces an existing path`,
    };
  }

  let parent: string;
  try {
    parent = realpathSync(dirname(absolute));
  } catch (error) {
    return {
      ok: false,
      problem: `the parent directory of ${requestedOut} does not exist or cannot be resolved: ${detail(error)}`,
    };
  }
  const canonicalDestination = join(parent, basename(absolute));

  const knownInputs: string[] = [];
  for (const input of inputs) {
    const canonical = canonicalInput(input);
    if (!canonical.ok) return { ok: false, problem: canonical.problem };
    knownInputs.push(canonical.path);
  }
  if (knownInputs.includes(canonicalDestination)) {
    return {
      ok: false,
      problem: `${requestedOut} is also an input this run reads, so writing it would replace the evidence it was computed from`,
    };
  }
  if (!readSetComplete) {
    return {
      ok: false,
      problem: `the invocation could not recover the complete set of input paths, so ${requestedOut} cannot be shown not to be an input`,
    };
  }
  return { ok: true, path: absolute };
}

/**
 * Publish complete bytes at a destination that must not already exist.
 *
 * The staging directory is created exclusively beneath the destination's parent,
 * so the hard link that publishes the document is always within one filesystem and
 * always fails rather than replaces when the destination appeared meanwhile.
 */
function publishAt(destination: string, bytes: string): { readonly ok: true } | { readonly ok: false; readonly problem: string } {
  const parent = dirname(destination);
  let staging: string;
  try {
    staging = mkdtempSync(join(parent, STAGE_PREFIX));
  } catch (error) {
    return {
      ok: false,
      problem: `cannot create a staging directory beneath ${parent}: ${detail(error)}`,
    };
  }

  const staged = join(staging, STAGED_NAME);
  try {
    const descriptor = openSync(staged, 'wx', 0o600);
    try {
      writeSync(descriptor, bytes);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, problem: `cannot write the staged document: ${detail(error)}` };
  }

  publicationFaultInjection.beforeLink?.(destination);
  try {
    linkSync(staged, destination);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    rmSync(staging, { recursive: true, force: true });
    if (code === 'EEXIST') {
      return {
        ok: false,
        problem: `${destination} already exists; publication never replaces an existing path`,
      };
    }
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EXDEV') {
      return {
        ok: false,
        problem: `${destination} cannot be published without replacement on this filesystem (${code}); no overwriting fallback is used`,
      };
    }
    return { ok: false, problem: `cannot publish ${destination}: ${detail(error)}` };
  }
  rmSync(staging, { recursive: true, force: true });
  return { ok: true };
}

/** The diagnostic document a refused or rejected invocation publishes instead. */
function diagnosticDocument(
  version: number,
  problems: readonly string[],
  generatedAt: number,
): Record<string, unknown> {
  return {
    version,
    kind: 'rejected-input',
    verdict: 'inconclusive',
    generatedAt,
    problems: [...problems],
    requirements: [],
  };
}

/** Publish the diagnostic into a fresh directory owned by this invocation. */
function publishFallback(
  request: PublicationRequest,
  reasons: readonly string[],
): { readonly path?: string; readonly messages: readonly string[]; readonly problems: readonly string[] } {
  const parent = dirname(resolve(request.requestedOut));
  let directory: string;
  try {
    directory = mkdtempSync(join(parent, DIAGNOSTIC_PREFIX));
  } catch (error) {
    return {
      messages: [
        `error: cannot create a diagnostic directory beneath ${parent}: ${detail(error)}`,
        'no diagnostic was saved',
      ],
      problems: [...reasons, `the diagnostic could not be created beneath ${parent}`],
    };
  }
  const destination = join(directory, DIAGNOSTIC_NAME);
  const bytes = serialize(diagnosticDocument(request.version, [...request.problems, ...reasons], request.generatedAt));
  const published = publishAt(destination, bytes);
  if (!published.ok) {
    rmSync(directory, { recursive: true, force: true });
    return {
      messages: [
        `error: ${published.problem}`,
        'no diagnostic was saved',
      ],
      problems: [...reasons, published.problem],
    };
  }
  return {
    path: destination,
    messages: [`note: a non-qualifying diagnostic was written to ${destination}`],
    problems: reasons,
  };
}

/** Report a refused publication, publishing the owned fallback diagnostic. */
function refused(request: PublicationRequest, reasons: readonly string[]): PublicationResult {
  const fallback = publishFallback(request, reasons);
  return {
    ...(fallback.path === undefined ? {} : { publishedPath: fallback.path, publishedKind: 'diagnostic' as const }),
    requestedPathUsed: false,
    messages: [...reasons.map((reason) => `error: ${reason}`), ...fallback.messages],
    problems: fallback.problems,
  };
}

/**
 * Publish one document, or a diagnostic explaining why it was not published.
 *
 * Never throws for a filesystem or safety problem: every failure is a structured
 * result the caller reports and turns into a nonzero exit.
 */
export function publish(request: PublicationRequest): PublicationResult {
  let text: string;
  try {
    text = request.kind === 'diagnostic'
      ? serialize(diagnosticDocument(request.version, request.problems, request.generatedAt))
      : serialize(request.document);
  } catch (error) {
    return refused(request, [`cannot serialize the document: ${detail(error)}`]);
  }

  const destination = destinationState(request.requestedOut, request.inputs, request.readSetComplete);
  if (!destination.ok) return refused(request, [destination.problem]);

  const published = publishAt(destination.path, text);
  if (!published.ok) return refused(request, [published.problem]);

  return {
    publishedPath: destination.path,
    requestedPathUsed: true,
    publishedKind: request.kind,
    messages: [],
    problems: [],
  };
}
