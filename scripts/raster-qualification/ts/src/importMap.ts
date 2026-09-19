#!/usr/bin/env node
/**
 * Generate the browser import map for the qualification runner.
 *
 * The candidate display artifact and its peers declare bare specifiers for their codec
 * and projection dependencies. Rather than hand-maintaining a list, this resolves
 * every installed package's browser-facing entry point from its own `package.json` and
 * emits an import map covering all of them.
 *
 * This keeps the probe honest: the browser loads the exact installed package entry
 * points with no bundler rewriting, and no specifier is invented by the harness.
 *
 * This is the TypeScript replacement for `import_map.py`; the `--bench`, `--out`,
 * `--print` and `--extra-map` interface and the export-condition semantics are
 * preserved so the existing probe callers keep working unchanged.
 *
 * Usage:
 *
 *     node ts/dist/src/importMap.js --bench <scratch>/bench \
 *         --out <scratch>/import-map.json [--print]
 */

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Preferred conditions, in order, for the entry point.
 *
 * `import` is preferred over `browser` deliberately. Some browser bundles drop APIs
 * that are only meaningful for local files (geotiff's `browser` build omits
 * `fromBlob`, which is exactly how a local COG is opened), so resolving to the browser
 * bundle would silently make the local-transport probe impossible rather than
 * reporting the real capability.
 */
export const CONDITIONS = ['import', 'module', 'browser', 'bun', 'default'] as const;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Choose a usable file from an exports target (string or conditions). */
function pick(target: unknown, packageDir: string): string | undefined {
  if (typeof target === 'string') {
    return isFile(join(packageDir, target)) ? target : undefined;
  }
  if (typeof target === 'object' && target !== null && !Array.isArray(target)) {
    const record = target as Record<string, unknown>;
    for (const condition of CONDITIONS) {
      const chosen = pick(record[condition], packageDir);
      if (chosen !== undefined) return chosen;
    }
  }
  return undefined;
}

/** Map every exported subpath of a package to its browser-facing file. */
export function resolveEntries(packageDir: string): Record<string, string> {
  const manifestPath = join(packageDir, 'package.json');
  if (!isFile(manifestPath)) return {};
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    manifest = parsed as Record<string, unknown>;
  } catch {
    return {};
  }

  const entries: Record<string, string> = {};
  const exports = manifest['exports'];
  if (typeof exports === 'string') {
    entries['.'] = exports;
  } else if (typeof exports === 'object' && exports !== null && !Array.isArray(exports)) {
    const record = exports as Record<string, unknown>;
    const subpaths = Object.entries(record).filter(([key]) => key.startsWith('.'));
    // An exports object with no "." or "./sub" keys is a condition map for the package
    // root, not a set of subpaths.
    if (subpaths.length > 0) {
      for (const [subpath, target] of subpaths) {
        const chosen = pick(target, packageDir);
        if (chosen !== undefined) entries[subpath] = chosen;
      }
    } else {
      const chosen = pick(record, packageDir);
      if (chosen !== undefined) entries['.'] = chosen;
    }
  }
  if (entries['.'] === undefined) {
    let resolved = false;
    for (const field of ['module', 'main'] as const) {
      const value = manifest[field];
      if (typeof value === 'string' && isFile(join(packageDir, value))) {
        entries['.'] = value;
        resolved = true;
        break;
      }
    }
    if (!resolved && isFile(join(packageDir, 'index.js'))) entries['.'] = 'index.js';
  }
  // A subpath-less package still needs its root file to exist.
  return Object.fromEntries(
    Object.entries(entries).filter(([, value]) => isFile(join(packageDir, value))),
  );
}

/** Every installed package's exported entry points, as specifier -> served URL. */
export function discover(bench: string): Record<string, string> {
  const modules = join(bench, 'node_modules');
  if (!isDirectory(modules)) {
    throw new Error(`ERROR: ${modules} is not a directory`);
  }
  const imports: Record<string, string> = {};
  const packages: [string, string][] = [];
  for (const name of readdirSync(modules).sort()) {
    if (name.startsWith('.')) continue;
    const directory = join(modules, name);
    if (name.startsWith('@')) {
      if (!isDirectory(directory)) continue;
      for (const scoped of readdirSync(directory).sort()) {
        packages.push([`${name}/${scoped}`, join(directory, scoped)]);
      }
      continue;
    }
    if (isDirectory(directory)) packages.push([name, directory]);
  }
  for (const [name, directory] of packages) {
    for (const [subpath, target] of Object.entries(resolveEntries(directory))) {
      const specifier = subpath === '.' ? name : `${name}/${subpath.slice(2)}`;
      imports[specifier] = `/nm/${name}/${target}`;
    }
  }
  return imports;
}

/** The map payload the probe servers consume. */
export function buildImportMap(options: {
  readonly bench: string;
  readonly extraMap?: string;
}): Record<string, unknown> {
  const imports = discover(options.bench);
  if (options.extraMap !== undefined) {
    const parsed = JSON.parse(readFileSync(options.extraMap, 'utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const extra = (parsed as Record<string, unknown>)['imports'];
      if (typeof extra === 'object' && extra !== null && !Array.isArray(extra)) {
        Object.assign(imports, extra as Record<string, string>);
      }
    }
  }
  // Python's json.dumps(sort_keys=True) is reproduced, including for injected keys, so
  // existing callers and stored maps compare byte for byte.
  const sorted = Object.fromEntries(
    Object.entries(imports).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return { imports: sorted };
}

const USAGE =
  'usage: importMap.js --bench <bench> [--out <import-map.json>] [--extra-map <map.json>] [--print]';

interface Args {
  readonly bench: string;
  readonly out?: string;
  readonly extraMap?: string;
  readonly print: boolean;
}

export function parseArgs(argv: readonly string[]): Args | undefined {
  let bench: string | undefined;
  let out: string | undefined;
  let extraMap: string | undefined;
  let print = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bench') bench = argv[++index];
    else if (arg === '--out') out = argv[++index];
    else if (arg === '--extra-map') extraMap = argv[++index];
    else if (arg === '--print') print = true;
    else return undefined;
  }
  if (bench === undefined || bench.length === 0) return undefined;
  return {
    bench,
    ...(out === undefined || out.length === 0 ? {} : { out }),
    ...(extraMap === undefined || extraMap.length === 0 ? {} : { extraMap }),
    print,
  };
}

export function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let payload: Record<string, unknown>;
  try {
    payload = buildImportMap({
      bench: resolve(args.bench),
      ...(args.extraMap === undefined ? {} : { extraMap: args.extraMap }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${detail}\n`);
    return 1;
  }
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (args.out !== undefined) {
    const target = isAbsolute(args.out) ? args.out : resolve(args.out);
    try {
      writeText(target, serialized);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`ERROR: cannot write ${target}: ${detail}\n`);
      return 1;
    }
  }
  if (args.print || args.out === undefined) process.stdout.write(serialized);
  const imports = payload['imports'] as Record<string, unknown>;
  process.stderr.write(`resolved ${Object.keys(imports).length} package entry points\n`);
  return 0;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

// Run only when this module is the entry point, so tests can import the resolvers.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
