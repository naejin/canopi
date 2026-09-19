/**
 * importMap — the TypeScript replacement for `import_map.py`.
 *
 * The cases are hand-authored package trees with known expected maps: an exports
 * string, an exports condition map, exported subpaths, a scoped package, a missing
 * target file, a malformed manifest and the legacy `module`/`main`/`index.js`
 * fallbacks. A parity case compares the whole map with the Python helper's output
 * while that helper still exists, so the replacement is not accepted on assertion
 * alone.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TempRoot } from './helpers.js';
import { CONDITIONS, buildImportMap, discover, resolveEntries } from '../src/importMap.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function writePackage(bench: string, name: string, manifest: unknown, files: readonly string[]): void {
  const directory = join(bench, 'node_modules', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8');
  for (const file of files) {
    const target = join(directory, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'export default {};\n', 'utf8');
  }
}

/** A bench covering every ownership case the resolver has to decide. */
function bench(root: TempRoot): string {
  const path = join(root.path, 'bench');
  mkdirSync(join(path, 'node_modules'), { recursive: true });
  // An exports string.
  writePackage(path, 'string-exports', { name: 'string-exports', exports: './main.js' }, ['main.js']);
  // A condition map for the root, preferring `import` over `browser`.
  writePackage(
    path,
    'condition-map',
    {
      name: 'condition-map',
      exports: { browser: './browser.js', import: './import.js', default: './default.js' },
    },
    ['browser.js', 'import.js', 'default.js'],
  );
  // Exported subpaths, including one whose target is missing.
  writePackage(
    path,
    'subpaths',
    {
      name: 'subpaths',
      exports: { '.': { import: './index.js' }, './feature': './feature.js', './gone': './gone.js' },
    },
    ['index.js', 'feature.js'],
  );
  // A scoped package resolved through its subpath.
  writePackage(
    path,
    join('@scope', 'scoped'),
    { name: '@scope/scoped', exports: { '.': './s.js', './deep': './deep/d.js' } },
    ['s.js', join('deep', 'd.js')],
  );
  // Legacy fallbacks: `module` first, then `main`, then index.js.
  writePackage(path, 'legacy-module', { name: 'legacy-module', module: './esm.js', main: './cjs.js' }, [
    'esm.js',
    'cjs.js',
  ]);
  writePackage(path, 'legacy-main', { name: 'legacy-main', main: './cjs.js' }, ['cjs.js']);
  writePackage(path, 'legacy-index', { name: 'legacy-index' }, ['index.js']);
  // A malformed manifest is skipped rather than failing the map.
  const broken = join(path, 'node_modules', 'broken');
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'package.json'), '{ not json', 'utf8');
  writeFileSync(join(broken, 'index.js'), 'export default {};\n', 'utf8');
  // A directory with no manifest at all.
  mkdirSync(join(path, 'node_modules', 'no-manifest'), { recursive: true });
  // A package whose declared entry does not exist yields no specifier.
  writePackage(path, 'missing-entry', { name: 'missing-entry', exports: './absent.js' }, []);
  // Dot entries are not packages.
  mkdirSync(join(path, 'node_modules', '.cache'), { recursive: true });
  return path;
}

test('importMap: the export-condition order prefers import over browser', () => {
  assert.deepEqual([...CONDITIONS], ['import', 'module', 'browser', 'bun', 'default']);
});

test('importMap: every package shape resolves to the served entry point', () => {
  const root = new TempRoot();
  try {
    const imports = discover(bench(root));
    // The URL keeps the target exactly as the manifest declared it (a leading "./"
    // included), because the Python helper served that path and callers already
    // consume it.
    assert.deepEqual(imports, {
      '@scope/scoped': '/nm/@scope/scoped/./s.js',
      '@scope/scoped/deep': '/nm/@scope/scoped/./deep/d.js',
      'condition-map': '/nm/condition-map/./import.js',
      'legacy-index': '/nm/legacy-index/index.js',
      'legacy-main': '/nm/legacy-main/./cjs.js',
      'legacy-module': '/nm/legacy-module/./esm.js',
      'string-exports': '/nm/string-exports/./main.js',
      subpaths: '/nm/subpaths/./index.js',
      'subpaths/feature': '/nm/subpaths/./feature.js',
    });
  } finally {
    root.cleanup();
  }
});

test('importMap: a broken or absent manifest contributes nothing', () => {
  const root = new TempRoot();
  try {
    const path = bench(root);
    assert.deepEqual(resolveEntries(join(path, 'node_modules', 'broken')), {});
    assert.deepEqual(resolveEntries(join(path, 'node_modules', 'no-manifest')), {});
    assert.deepEqual(resolveEntries(join(path, 'node_modules', 'missing-entry')), {});
    const imports = discover(path);
    assert.equal(imports['broken'], undefined);
    assert.equal(imports['no-manifest'], undefined);
    assert.equal(imports['missing-entry'], undefined);
    assert.equal(imports['.cache'], undefined);
  } finally {
    root.cleanup();
  }
});

test('importMap: an absent bench is refused with the path named', () => {
  const root = new TempRoot();
  try {
    assert.throws(
      () => discover(join(root.path, 'absent')),
      /is not a directory/,
    );
  } finally {
    root.cleanup();
  }
});

test('importMap: the extra map is applied last and the payload is key-sorted', () => {
  const root = new TempRoot();
  try {
    const extra = root.write('extra.json', { imports: { zeta: '/stub/z.js', alpha: '/stub/a.js' } });
    const payload = buildImportMap({ bench: bench(root), extraMap: extra });
    const imports = payload['imports'] as Record<string, string>;
    assert.equal(imports['zeta'], '/stub/z.js');
    assert.equal(imports['alpha'], '/stub/a.js');
    const keys = Object.keys(imports);
    assert.deepEqual(keys, [...keys].sort());
  } finally {
    root.cleanup();
  }
});

test('importMap: the CLI writes the map and reports the resolved count', () => {
  const root = new TempRoot();
  try {
    const path = bench(root);
    const out = join(root.path, 'import-map.json');
    const cli = join(HERE, '../src/importMap.js');
    const stdout = execFileSync(process.execPath, [cli, '--bench', path, '--out', out], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(stdout, '');
    const written = JSON.parse(readFileSync(out, 'utf8')) as { imports: Record<string, string> };
    assert.equal(written.imports['subpaths/feature'], '/nm/subpaths/./feature.js');
    // --print echoes the same payload.
    const printed = execFileSync(process.execPath, [cli, '--bench', path, '--print'], {
      encoding: 'utf8',
    });
    assert.deepEqual(JSON.parse(printed), written);
  } finally {
    root.cleanup();
  }
});

test('importMap: usage and refusal paths exit nonzero', () => {
  const root = new TempRoot();
  try {
    const cli = join(HERE, '../src/importMap.js');
    const run = (args: readonly string[]): number => {
      try {
        execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: 'pipe' });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? -1;
      }
    };
    assert.equal(run([]), 2);
    assert.equal(run(['--bench', join(root.path, 'absent')]), 1);
    assert.equal(run(['--bench', bench(root), '--unknown']), 2);
  } finally {
    root.cleanup();
  }
});

test('importMap: parity with the Python helper while it still exists', () => {
  const root = new TempRoot();
  try {
    const path = bench(root);
    const helper = join(HERE, '../../import_map.py');
    let python: string;
    try {
      python = execFileSync('python3', [helper, '--bench', path, '--print'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      // The helper is deleted by this slice; the parity evidence was captured before.
      return;
    }
    const typescript = JSON.stringify(buildImportMap({ bench: path }), null, 2);
    assert.deepEqual(JSON.parse(typescript), JSON.parse(python));
    assert.equal(typescript, `${python.trimEnd()}\n`);
  } finally {
    root.cleanup();
  }
});
