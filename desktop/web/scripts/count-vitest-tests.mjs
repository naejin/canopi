// Counting guard for the canvas v2 phase 0 refactor (docs/plans/canvas-v2-plan.md §3.4).
//
// Phase 0 moves, splits and replaces tests. This script proves that none was
// lost on the way: every test recorded in canvas-v2-test-baseline.json is still
// listed by `vitest list`, counted by full name in any file, or is mapped in
// canvas-v2-test-replacements.json to a replacement test or policy that exists.
//
//   cd desktop/web && node scripts/count-vitest-tests.mjs            check (default)
//   cd desktop/web && node scripts/count-vitest-tests.mjs --record   write the baseline (seams commit only;
//                                                                    refuses while a baseline exists)
//
// A full name is the describe titles and the test title joined by ' > ', as
// `vitest list` prints them, for example
//   "SceneInteractionSession > Settings › Canvas › Scroll wheel > scrolls the map".
// Replacement map: { "<baseline file> > <old full name>": <target> | [<target>, ...] },
// for example
//   { "src/__tests__/camera-controller.test.ts > CameraController > zooms in":
//       { "file": "src/canvas/runtime/view/navigation.test.ts", "name": "ViewNavigation > zooms in" } }
//   <target> = { "file": "<new file>", "name": "<new full name>" } | { "policy": "<exact policy name>" }
//     | { "retired": "<why no user sees it>" }
// The key names the file the baseline recorded, not where the test lives now: a
// test of the split files is keyed by src/__tests__/scene-interaction.test.ts.
// Each target replaces one baseline row with that key; when several rows share
// a key (an it.each whose title does not vary), give one target per replaced
// row in an array. Rows left over are still counted by name. Files are relative
// to desktop/web. A policy is present when src/__tests__/frontend-architecture-policies.test.ts
// or src/__tests__/canvas-boundaries.test.ts holds that exact string literal.
//
// Deleted, with both JSON files, in the commit that closes the phase-0 bead.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_FILE = new URL('canvas-v2-test-baseline.json', import.meta.url);
const REPLACEMENTS_FILE = new URL('canvas-v2-test-replacements.json', import.meta.url);
const POLICY_FILES = [
  'src/__tests__/frontend-architecture-policies.test.ts',
  'src/__tests__/canvas-boundaries.test.ts',
];
const MIN_NODE = [22, 18];

// Rule 1: the modules phase 0 moves, deletes or re-types (relative to src/).
// Reviewed by hand, never derived; a module in doubt goes in. A path that does
// not exist yet only warns: it has no importers to find.
const BASELINE_MODULES = [
  // spec §1.9, 0A
  'maplibre/scene-camera-transform.ts',
  'canvas/maplibre-camera.ts',
  'maplibre/workspace-camera.ts',
  'canvas/runtime/camera.ts',
  '__tests__/v2-shared-camera-transform.test.ts',
  // spec §1.9, end of 0D2
  'canvas/runtime/legacy-camera-facade.ts',
  'canvas/runtime/scene/types.ts',
  'canvas/runtime/annotation-layout.ts',
  'canvas/projection.ts',
  'canvas/runtime/renderers/scene-types.ts',
  'canvas/runtime/renderers/draft-layer.ts',
  // spec §1.9, 0B
  'canvas/runtime/scene-interaction.ts',
  ...[
    'tool-adapter', 'tool-modules', 'shared-gestures', 'pointer-utils', 'overlay-ui',
    'polygon-draft-overlay', 'plant-spacing-overlay', 'plant-placement-preview',
    'plant-drag-distance-overlay', 'zone-measurement-overlay', 'control-point-overlay',
    'selection-rotation-handle', 'annotation-inline-editor', 'text-annotation-tool',
    'zone-control-points', 'measurement-guide-control-points', 'drag-ops',
  ].map((name) => `canvas/runtime/interaction/${name}.ts`),
  '__tests__/scene-interaction-tool-boundary.test.ts',
  'canvas/rulers.ts',
  // spec §1.9, 0C
  'shortcuts/manager.ts',
  'web/canvas-shortcuts.ts',
  'app/shell/focus-regions.ts',
  // spec §1.9, 0D2
  'canvas/runtime/renderers/viewport-presentation.ts',
  // plan §4: the 0B stream tables move these into tools/ and chrome/
  ...[
    'zone-drawing-tool', 'measurement-guide-tool', 'plant-stamp-tool', 'plant-spacing-tool',
    'object-stamp-tool', 'saved-object-stamp-tool', 'stamp-rotation', 'tool-actions',
    'hit-testing', 'locked-object-affordance', 'hover-tooltip', 'interaction-host', 'layer-guards',
  ].map((name) => `canvas/runtime/interaction/${name}.ts`),
  // re-typed modules
  'canvas/inspection.ts',
  // modules whose exported types phase 0 edits
  'canvas/runtime/runtime.ts',
  'canvas/runtime/app-adapter.ts',
  'canvas/session-state.ts',
  // in doubt, so in: the renderers 0D2 splits, the camera policy beside 0A,
  // the surfaces that call the camera, and the session plane
  'canvas/runtime/renderers/pixi-scene.ts',
  'canvas/runtime/renderers/maplibre-scene.ts',
  'canvas/workspace-camera-policy.ts',
  'canvas/runtime/query-surface.ts',
  'canvas/runtime/command-surface.ts',
  'canvas/session-plane.ts',
  // In doubt, so in: every other existing module that a phase-0 stream owns in
  // plan §4 (0A, 0D1, 0B, 0C and 0D2 tables, directory globs expanded here).
  // Each stream edits these, and several lose or re-type exports that tests
  // call: 0C deletes matchesShortcut and isCharacterKeyShortcut and re-points
  // the canvas and shell command matching to the keymap; P9 moves the stamp
  // sources' setTool behind armCanvasTool; D1 moves move-drag history and the
  // grid and guide snapping; 0D2 re-types the snapshot build.
  // 0A View
  ...[
    'loader', 'workspace-map', 'canvas-surface-camera', 'canvas-surface-state', 'host', 'surface-adapter',
    'shared-scene-layer', 'view-snapshot-map', 'panel-target-overlay-sync', 'canvas-overlays',
  ].map((name) => `maplibre/${name}.ts`),
  'canvas/map-scale.ts',
  ...['document-surface', 'scene-chrome', 'inspection-lens', 'scene-runtime'].map((name) => `canvas/runtime/${name}.ts`),
  ...['reorigin', 'chrome-coordinator', 'construction', 'effects', 'mutations', 'transactions'].map(
    (name) => `canvas/runtime/scene-runtime/${name}.ts`,
  ),
  'app/saved-views/current-view.ts',
  'app/saved-views/snapshot.ts',
  'app/story-presentation/controller.ts',
  ...[
    'desktop-workspace-map-contribution-adapter', 'desktop-workspace-runtime', 'last-view', 'map-notice', 'overlays',
    'workspace-activation', 'workspace-activation-snapshot', 'workspace-document-surface',
    'workspace-generation-reconciler', 'workspace-map-contribution-adapter', 'workspace-map-contributions',
    'workspace-map-controls', 'workspace-runtime-composition',
  ].map((name) => `app/canvas-map-surface/${name}.ts`),
  'app/plant-finder/map-matches.ts',
  'app/lidar/camera-request.ts',
  'web/browser-workspace-map-contribution-adapter.ts',
  // 0D1 Renderer drafts
  'canvas/runtime/scene-visuals.ts',
  'canvas/theme-refresh.ts',
  // 0B Input and the tool streams D1, D3 and D4
  'app/stories/actions.ts',
  'canvas/grid.ts',
  'canvas/guides.ts',
  'canvas/operations.ts',
  'canvas/runtime/scene-commands.ts',
  'canvas/runtime/interaction/canvas-context-menu.ts',
  'canvas/runtime/interaction/contextual-selection-actions.ts',
  'canvas/plant-stamp-source.ts',
  'canvas/saved-object-stamp-source.ts',
  // 0C Keyboard and Components-0C
  'platform/desktop.ts',
  'platform/browser.ts',
  ...['registry', 'graph/catalog', 'graph/index', 'graph/projections', 'graph/shortcuts'].map(
    (name) => `commands/${name}.ts`,
  ),
  'web/browser-shell-commands.ts',
  'web/WebApp.tsx',
  'app/workspace-commands/capabilities.ts',
  'app/workspace-commands/canvas-actions.ts',
  'app/canvas-commands/index.ts',
  'app/shell-commands/shortcut-text.ts',
  'app/shell-commands/index.ts',
  'canvas/session.ts',
  'app/canvas-runtime/app-adapter.ts',
  'components/stories/StoryPresenter.tsx',
  'app/shell/bootstrap.ts',
  'main.web.tsx',
  'components/shared/useFocusRegion.ts',
  ...['ToolRail', 'ToolCard', 'SiteOnboarding', 'StampChooser', 'CanvasChrome'].map(
    (name) => `components/canvas/${name}.tsx`,
  ),
  'components/plant-db/place-species.ts',
  'components/panels/FavoritesPanel.tsx',
  // 0D2 Renderer and Components-0D2
  ...[
    'plant-presentation', 'automatic-detail', 'measurement-guides', 'selection-labels',
    'inspection-lens-drawing', 'inspection-layout',
  ].map((name) => `canvas/runtime/${name}.ts`),
  ...['selection', 'selection-rotation', 'presentation', 'render-scheduler'].map(
    (name) => `canvas/runtime/scene-runtime/${name}.ts`,
  ),
  'app/plant-display/coverage.ts',
  ...['ZoomControls', 'CanvasOverview', 'SelectionChip', 'PlantLabelsChip', 'InspectionLens'].map(
    (name) => `components/canvas/${name}.tsx`,
  ),
];

// Rule 4: test files that read a baseline module's source (readFileSync, a
// readSource helper or a path list) instead of importing it. Reviewed from the
// candidate list that --record prints.
const EXTRA_BASELINE_FILES = [
  'src/__tests__/scene-interaction-tool-boundary.test.ts',
  // builds the source graph and looks up web/canvas-shortcuts.ts, which 0C deletes
  'src/__tests__/canvas-command-boundary.test.ts',
  // expects renderers/pixi-scene.ts among the modules that import Pixi
  'src/__tests__/pixi-csp-guard.test.ts',
  // reads app/canvas-runtime/app-adapter.ts, app/workspace-commands/capabilities.ts
  // and canvas/runtime/scene-runtime.ts for their settings imports
  'src/__tests__/settings-projection.test.ts',
];

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SUPPORT_DIR = 'src/__tests__/support/';

class GuardFailure extends Error {}

function fail(message) {
  throw new GuardFailure(message);
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
    fail(`needs Node ${MIN_NODE.join('.')} or later (it imports TypeScript sources with type stripping); found v${process.versions.node}`);
  }
}

function checkPdfFonts() {
  const assets = JSON.parse(readFileSync(join(WEB, 'src/app/canvas-pdf/font-assets.json'), 'utf8'));
  const missing = assets.map((asset) => asset.file).filter((file) => !existsSync(join(WEB, 'public/pdf-fonts', file)));
  if (missing.length > 0) {
    fail(`PDF fonts missing from public/pdf-fonts (${missing.join(', ')}): run npm run prepare:pdf-fonts`);
  }
}

function webPath(absolute) {
  return relative(WEB, absolute).split(sep).join('/');
}

/** Every test vitest collects, as { file, name } with file relative to desktop/web. */
function listTests() {
  const dir = mkdtempSync(join(tmpdir(), 'canopi-count-vitest-'));
  const out = join(dir, 'list.json');
  try {
    console.log('Collecting tests with npx vitest list (about two minutes)...');
    const run = spawnSync('npx', ['vitest', 'list', `--json=${out}`], {
      cwd: WEB,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    if (run.error || run.status !== 0) {
      process.stderr.write(run.stdout ?? '');
      process.stderr.write(run.stderr ?? '');
      fail(`vitest list exited ${run.error?.message ?? run.status ?? run.signal}; a partial list is never counted`);
    }
    const entries = JSON.parse(readFileSync(out, 'utf8'));
    if (!Array.isArray(entries)) fail('vitest list --json did not write an array');
    return entries.map((entry) => {
      if (typeof entry?.name !== 'string' || typeof entry?.file !== 'string') {
        fail(`unexpected vitest list entry ${JSON.stringify(entry)}`);
      }
      return { file: webPath(entry.file), name: entry.name };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const testKey = (file, name) => `${file} > ${name}`;

function countBy(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function parse(path, source) {
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
}

function visitAll(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => visitAll(child, visit));
}

// ---------------------------------------------------------------- record mode

/** The string-literal specifiers of vi.mock(…) and vi.doMock(…), without a ?query. */
function mockSpecifiers(path, source) {
  const specifiers = [];
  visitAll(parse(path, source), (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    const callee = node.expression;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'vi') return;
    if (callee.name.text !== 'mock' && callee.name.text !== 'doMock') return;
    const first = node.arguments[0];
    if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
      specifiers.push(first.text.replace(/\?.*$/, ''));
    }
  });
  return specifiers;
}

/** Resolves a relative specifier from a src/ file as the source graph does. */
function resolveSpecifier(importer, specifier, paths) {
  if (!specifier.startsWith('.')) return specifier;
  const parts = [];
  for (const segment of `${importer.slice(0, importer.lastIndexOf('/'))}/${specifier}`.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  const target = parts.join('/');
  const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`];
  return candidates.find((candidate) => paths.has(candidate)) ?? target;
}

async function record() {
  if (existsSync(BASELINE_FILE)) {
    const { commit } = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    fail(
      `a baseline exists (recorded at ${commit}) and is the reference for all of phase 0; --record never ` +
        'overwrites it. A lost test is fixed by restoring it or by a replacement map entry. To record again ' +
        '(the seams commit only), delete scripts/canvas-v2-test-baseline.json deliberately and say why in the commit.',
    );
  }
  const { discoverTypeScriptSourceGraph } = await import(
    new URL('../src/__tests__/support/architecture/source-facts.ts', import.meta.url).href
  );
  const graph = discoverTypeScriptSourceGraph(new URL('../src/', import.meta.url), 'src');
  const paths = new Set(graph.map((fact) => fact.path));

  const modules = new Set(BASELINE_MODULES.map((path) => `src/${path}`));
  for (const path of modules) {
    if (!paths.has(path)) console.warn(`warning: baseline module ${path} does not exist yet (kept; it has no importers)`);
  }
  for (const path of EXTRA_BASELINE_FILES) {
    if (!paths.has(path)) fail(`EXTRA_BASELINE_FILES names ${path}, which does not exist`);
  }

  // A file's own imports: the graph's edges (every kind) plus its vi.mock specifiers.
  const importsOf = (fact) => [
    ...fact.imports.map((edge) => edge.target),
    ...mockSpecifiers(fact.path, fact.source).map((specifier) => resolveSpecifier(fact.path, specifier, paths)),
  ];

  // Rule 2: a barrel index.ts with any reexport edge to a baseline module.
  const barrels = new Set(
    graph
      .filter((fact) => /\/index\.tsx?$/.test(fact.path))
      .filter((fact) => fact.imports.some((edge) => edge.kind === 'reexport' && modules.has(edge.target)))
      .map((fact) => fact.path),
  );
  const hitsRules12 = (target) => modules.has(target) || barrels.has(target);

  // Rule 3: one hop through a __tests__/support/ file that matches rule 1 or 2.
  const supports = new Set(
    graph
      .filter((fact) => fact.path.startsWith(SUPPORT_DIR) && !TEST_FILE.test(fact.path))
      .filter((fact) => importsOf(fact).some(hitsRules12))
      .map((fact) => fact.path),
  );

  const testFacts = graph.filter((fact) => TEST_FILE.test(fact.path));
  const selected = new Set(
    testFacts
      .filter((fact) => importsOf(fact).some((target) => hitsRules12(target) || supports.has(target)))
      .map((fact) => fact.path),
  );
  const byRules13 = new Set(selected);
  for (const path of EXTRA_BASELINE_FILES) selected.add(path);

  console.log(`Rule 2 barrels: ${[...barrels].join(', ') || 'none'}`);
  console.log(`Rule 3 support files: ${[...supports].join(', ') || 'none'}`);
  console.log(`Rules 1-3 select ${byRules13.size} of ${testFacts.length} test files; rule 4 adds ${EXTRA_BASELINE_FILES.filter((path) => !byRules13.has(path)).length}.`);

  // Rule 4 candidates: test files rules 1-3 left out whose text names a baseline module.
  const needles = [...modules].map((path) => path.slice('src/'.length).replace(/\.tsx?$/, ''));
  console.log('Rule 4 candidates (review; add true source readers to EXTRA_BASELINE_FILES):');
  for (const fact of testFacts) {
    if (byRules13.has(fact.path)) continue;
    const hits = needles.filter((needle) => fact.source.includes(needle));
    if (hits.length === 0) continue;
    const status = EXTRA_BASELINE_FILES.includes(fact.path)
      ? 'in EXTRA_BASELINE_FILES'
      : POLICY_FILES.includes(fact.path)
        ? 'policy file, stays out'
        : 'left out';
    console.log(`  ${fact.path} [${status}]: ${hits.join(', ')}`);
  }

  const listed = listTests();
  const baselineFiles = new Set([...selected].map((path) => webPath(join(WEB, path))));
  const tests = listed.filter((test) => baselineFiles.has(test.file));
  const perFile = countBy(tests, (test) => test.file);
  const empty = [...baselineFiles].filter((file) => !perFile.has(file));
  if (empty.length > 0) fail(`baseline files with no test in vitest list: ${empty.join(', ')}`);

  const files = Object.fromEntries([...perFile].sort(([left], [right]) => left.localeCompare(right)));
  const fileOrder = Object.keys(files);
  tests.sort((left, right) => fileOrder.indexOf(left.file) - fileOrder.indexOf(right.file));
  const unguardedFiles = [...new Set(listed.map((test) => test.file))]
    .filter((file) => !baselineFiles.has(file))
    .sort();
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WEB, encoding: 'utf8' }).stdout.trim();

  writeFileSync(BASELINE_FILE, `${JSON.stringify({ commit, files, unguardedFiles, tests }, null, 2)}\n`);
  if (!existsSync(REPLACEMENTS_FILE)) writeFileSync(REPLACEMENTS_FILE, '{}\n');

  console.log(`Baseline written: ${fileOrder.length} files, ${tests.length} tests (recorded at ${commit}).`);
  const split = 'src/__tests__/scene-interaction.test.ts';
  if (perFile.has(split)) {
    console.log(`  ${split}: ${perFile.get(split)}; the other ${fileOrder.length - 1} files: N = ${tests.length - perFile.get(split)}`);
  }
  for (const [file, count] of Object.entries(files)) console.log(`  ${String(count).padStart(4)}  ${file}`);
}

// ----------------------------------------------------------------- check mode

/** Every string literal of the policy files that exist; a missing file holds no policies. */
function policyNames() {
  const names = new Set();
  for (const path of POLICY_FILES) {
    const absolute = join(WEB, path);
    if (!existsSync(absolute)) continue;
    visitAll(parse(path, readFileSync(absolute, 'utf8')), (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) names.add(node.text);
    });
  }
  return names;
}

function check() {
  if (!existsSync(BASELINE_FILE)) fail('no baseline: run --record once (seams commit)');
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const replacements = existsSync(REPLACEMENTS_FILE) ? JSON.parse(readFileSync(REPLACEMENTS_FILE, 'utf8')) : {};
  const listed = listTests();
  const failures = [];

  const baselineRows = countBy(baseline.tests, (test) => testKey(test.file, test.name));
  const baselineFilesByName = new Map();
  for (const test of baseline.tests) {
    baselineFilesByName.set(test.name, new Set([...(baselineFilesByName.get(test.name) ?? []), test.file]));
  }
  const listedKeys = new Set(listed.map((test) => testKey(test.file, test.name)));
  const policies = policyNames();

  // Map entries: the old test must be in the baseline and each target must
  // exist. One present target replaces one baseline row with that key.
  const replacedRows = new Map(); // key -> rows replaced
  for (const [oldKey, value] of Object.entries(replacements)) {
    const rows = baselineRows.get(oldKey) ?? 0;
    if (rows === 0) {
      const name = oldKey.slice(oldKey.indexOf(' > ') + ' > '.length);
      const holders = oldKey.includes(' > ') ? [...(baselineFilesByName.get(name) ?? [])] : [];
      const hint = holders.length === 0
        ? ''
        : `\n    the baseline has this name under ${holders.join(', ')}: key the entry by ${holders.length === 1 ? 'that file' : 'one of them'}`;
      failures.push(`MAP KEY NOT IN BASELINE\n    ${oldKey}${hint}`);
      continue;
    }
    const targets = Array.isArray(value) ? value : [value];
    if (targets.length === 0 || targets.length > rows) {
      failures.push(
        `MAP ENTRY HAS ${targets.length} TARGET(S) FOR ${rows} BASELINE ROW(S) (one target per replaced row)\n    ${oldKey}`,
      );
      continue;
    }
    for (const target of targets) {
      let present = false;
      if (typeof target?.file === 'string' && typeof target?.name === 'string') {
        const targetKey = testKey(target.file, target.name);
        present = listedKeys.has(targetKey);
        if (!present) failures.push(`REPLACEMENT MISSING\n    baseline:    ${oldKey}\n    replacement: ${targetKey}`);
      } else if (typeof target?.policy === 'string') {
        present = policies.has(target.policy);
        if (!present) failures.push(`REPLACEMENT POLICY MISSING\n    baseline: ${oldKey}\n    policy:   "${target.policy}"`);
      } else if (typeof target?.retired === 'string' && target.retired.length > 0) {
        present = true;
      } else {
        failures.push(`MALFORMED MAP ENTRY (want { file, name }, { policy } or { retired }, or an array of them)\n    ${oldKey}: ${JSON.stringify(target)}`);
      }
      if (present) replacedRows.set(oldKey, (replacedRows.get(oldKey) ?? 0) + 1);
    }
  }

  // Names are counted, not matched: each unreplaced baseline test takes one
  // listed test of its full name, from any file.
  const available = countBy(listed, (test) => test.name);
  const unspent = new Map(replacedRows);
  const tally = new Map(); // baseline file -> { total, present, replaced, lost }
  const lost = new Map(); // name -> baseline files that lost it
  let present = 0;
  let replaced = 0;
  for (const test of baseline.tests) {
    const counts = tally.get(test.file) ?? { total: 0, present: 0, replaced: 0, lost: 0 };
    tally.set(test.file, counts);
    counts.total += 1;
    const key = testKey(test.file, test.name);
    if ((unspent.get(key) ?? 0) > 0) {
      unspent.set(key, unspent.get(key) - 1);
      counts.replaced += 1;
      replaced += 1;
    } else if ((available.get(test.name) ?? 0) > 0) {
      available.set(test.name, available.get(test.name) - 1);
      counts.present += 1;
      present += 1;
    } else {
      counts.lost += 1;
      lost.set(test.name, [...(lost.get(test.name) ?? []), test.file]);
    }
  }
  for (const [name, files] of lost) {
    const now = listed.filter((test) => test.name === name).map((test) => test.file);
    failures.push(
      `LOST ${files.length}\n    baseline: ${files.map((file) => testKey(file, name)).join('\n              ')}` +
        `\n    listed now: ${now.length === 0 ? 'nowhere' : [...new Set(now)].join(', ')}`,
    );
  }

  // New: listed tests whose name is not in the baseline, outside the test files
  // the baseline left out at record time.
  const baselineNames = new Set(baseline.tests.map((test) => test.name));
  const unguarded = new Set(baseline.unguardedFiles ?? []);
  const added = listed.filter((test) => !baselineNames.has(test.name) && !unguarded.has(test.file)).length;

  const listedFiles = new Set(listed.map((test) => test.file));
  for (const [file, counts] of tally) {
    if (listedFiles.has(file) && counts.replaced === 0 && counts.lost === 0) continue;
    const state = listedFiles.has(file) ? '' : ' (file gone)';
    console.log(`  ${file}${state}: ${counts.total} in baseline, ${counts.present} present, ${counts.replaced} replaced, ${counts.lost} lost`);
  }
  console.log(
    `Counting guard: baseline ${baseline.tests.length} (${Object.keys(baseline.files).length} files), ` +
      `still present ${present}, replaced ${replaced}, new ${added}.`,
  );
  if (failures.length > 0) fail(`${failures.length} failure(s):\n${failures.join('\n')}`);
  console.log('Every baseline test is present or replaced.');
}

// ------------------------------------------------------------------------ main

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--record')) {
  console.error('usage: node scripts/count-vitest-tests.mjs [--record]');
  process.exit(2);
}
try {
  checkNodeVersion();
  checkPdfFonts();
  if (args[0] === '--record') await record();
  else check();
} catch (error) {
  if (!(error instanceof GuardFailure)) throw error;
  console.error(`count-vitest-tests: ${error.message}`);
  process.exit(1);
}
