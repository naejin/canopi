// @vitest-environment node

// The unused-code check (docs/plans/canvas-v2-plan.md, "Unused-code check").
// It lists production files no production import chain reaches from an entry
// point or a consumer, value and type exports no other module imports, and
// value and type exports only tests import. The names it reports today are
// committed in unused-code-snapshot.json: a new name fails even when another
// disappears in the same change, and a name that disappears must leave the
// snapshot so it cannot come back. Each phase close runs it and deletes what it
// finds; an entry kept on purpose (a roadmap seam, a test seam) goes in KEPT
// with the bead id or plan section that needs it. A type export that only
// names a public signature's parameter or result is harmless; the snapshot
// keeps the list from growing.
//
//   npx vitest run src/__tests__/unused-code.test.ts    prints the lists when they change

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  createTypeScriptSourceGraph,
  readTypeScriptSources,
} from './support/architecture/source-facts'
import {
  findUnusedCode,
  type UnusedCodeOptions,
  type UnusedCodeReport,
} from './support/architecture/unused-code'

const SNAPSHOT_URL = new URL('./unused-code-snapshot.json', import.meta.url)

const OPTIONS: UnusedCodeOptions = {
  checked: ['src/**'],
  // The UI gallery is a maintained surface (`npm run check:ui`), and vite.config.ts
  // loads the Web edition's dev entry; what they import is in use.
  consumers: ['ui-gallery/**', 'vite.config.ts'],
  ignored: [
    'src/__tests__/**',
    'src/**/__fixtures__/**',
    'src/**/*.test.ts',
    'src/**/*.test.tsx',
    'src/**/*.d.ts',
    'src/**/*.d.mts',
    // Written by `npm run gen:types` from common-types; the Rust contract owns its exports.
    'src/generated/**',
  ],
  tests: ['src/__tests__/**', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/__fixtures__/**'],
  entryPoints: {
    'src/main.tsx': 'index.html loads the desktop edition',
    'src/main.web.tsx': 'web.html loads the Web edition',
    'src/maplibre/raster-display/worker.ts': "pool.ts starts it with new Worker(new URL('./worker.ts', import.meta.url))",
  },
  // vite.config.ts `resolve.alias`: each alias resolves to its desktop or its browser file.
  aliases: {
    '#platform': ['src/platform/desktop.ts', 'src/platform/browser.ts'],
    '#canvas-pdf-platform': ['src/app/canvas-pdf/platform.desktop.ts', 'src/app/canvas-pdf/platform.browser.ts'],
    '#budget-export-platform': ['src/app/budget/platform.desktop.ts', 'src/app/budget/platform.browser.ts'],
    '#geocoding-transport': ['src/app/geocoding/transport.desktop.ts', 'src/app/geocoding/transport.browser.ts'],
    '#species-catalog-live': ['src/app/plant-browser/live.desktop.ts', 'src/app/plant-browser/live.browser.ts'],
  },
}

/**
 * Entries the check reports that stay on purpose. Each reason names the bead id
 * (`canopi-…`) or the plan section (`canvas-v2-plan.md section N`) that needs it.
 */
const KEPT: Readonly<Record<string, string>> = {
  'src/canvas/runtime/view/navigation-policy.ts#ROTATE_DEG_PER_PX':
    'canopi-f47t.7 (phase 1 rotation): the pointer rotate rate (canvas-v2-spec.md §2.2 "Rotation sign")',
  'src/canvas/runtime/view/navigation-policy.ts#SNAP_TO_NORTH_DEG':
    'canopi-f47t.7 (phase 1 rotation): free gestures and the compass snap to north within 7° (canvas-v2-spec.md §4)',
  'src/canvas/runtime/view/camera-math.ts#cameraKeepingPoint':
    'canopi-f47t.7 (phase 1 rotation): camera-math API of canvas-v2-spec.md §1.1; camera-contract.test.ts holds it to MapLibre',
  'src/canvas/runtime/view/camera-math.ts#geoToScreen':
    'canopi-f47t.7 (phase 1 rotation): camera-math API of canvas-v2-spec.md §1.1; the bearing tween and activation tests project through it',
  'src/app/keyboard/escape-chain.ts#describeEscape':
    'canopi-f47t.6 (phase F): the Esc chain\'s hint seam (canvas-v2-spec.md §1.6, §3.7); no F row wires the tool card to it, and escape-chain.test.ts holds it to the next Esc',
}
const KEPT_REASON = /\bcanopi-[a-z0-9]+(?:\.\d+)*\b|\bcanvas-v2-plan\.md section \d+(?:\.\d+)*/


/** Parsing the tree takes seconds; both repository tests read one graph. */
const GRAPH_TIMEOUT_MS = 60_000
let graphCache: ReturnType<typeof createTypeScriptSourceGraph> | null = null

function repositoryGraph() {
  return graphCache ??= createTypeScriptSourceGraph([
    ...readTypeScriptSources(new URL('../', import.meta.url), 'src'),
    ...readTypeScriptSources(new URL('../../ui-gallery/', import.meta.url), 'ui-gallery'),
    { path: 'vite.config.ts', source: readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8') },
  ])
}

describe('Unused code', () => {
  it('lists files nothing imports and exports no other module imports', () => {
    const graph = createTypeScriptSourceGraph([
      { path: 'src/main.ts', source: "import { used } from './barrel'\nimport * as all from './namespace'\nimport './self'\nimport './loader'\nvoid used; void all" },
      { path: 'src/barrel.ts', source: "export * from './star'\nexport { kept as used, unread } from './named'" },
      { path: 'src/star.ts', source: 'export const starUnused = 1' },
      { path: 'src/named.ts', source: 'export const kept = 1\nexport const unread = 2\nexport const orphan = 3\nexport interface Shape { readonly x: number }' },
      { path: 'src/namespace.ts', source: 'export const a = 1\nexport type B = number' },
      { path: 'src/self.ts', source: "export const local = 1\nexport const alsoLocal = local" },
      { path: 'src/tested-only.ts', source: 'export const seam = 1' },
      { path: 'src/tested-only.test.ts', source: "import { seam } from './tested-only'\nimport { testSeam } from './loader'\nvoid seam; void testSeam" },
      { path: 'src/platform/desktop.ts', source: 'export const platform = 1' },
      { path: 'src/aliased.ts', source: "import { platform } from '#platform'\nexport default platform" },
      { path: 'gallery/main.ts', source: "import aliased from '../src/aliased'\nvoid aliased" },
      // A namespace or dynamic import credits only the members read.
      {
        path: 'src/loader.ts',
        source: [
          "import * as reads from './members'",
          "type Typed = typeof import('./typed').Typed",
          "type Indexed = import('./typed')['Indexed']",
          'void reads.readMember',
          'export const testSeam = 1',
          "export const load = async (): Promise<Typed | Indexed> => (await import('./lazy')).viaAwait",
          "void import('./lazy').then((module) => module.viaThen)",
          "void import('./lazy').then(({ viaThenBinding }) => viaThenBinding)",
          "async function pick() { const { viaDestructure } = await import('./lazy'); const module = await import('./lazy'); return [viaDestructure, module.viaName] }",
          'void pick',
          "void import('./escapes')",
        ].join('\n'),
      },
      { path: 'src/members.ts', source: 'export const readMember = 1\nexport const unreadMember = 2' },
      { path: 'src/typed.ts', source: 'export const Typed = 1\nexport type Indexed = 1\nexport type UnreadType = 2' },
      {
        path: 'src/lazy.ts',
        source: ['viaAwait', 'viaThen', 'viaThenBinding', 'viaDestructure', 'viaName', 'notRead']
          .map((name) => `export const ${name} = 1`).join('\n'),
      },
      { path: 'src/escapes.ts', source: 'export const escapedA = 1' },
    ])

    const report = findUnusedCode(graph, {
      checked: ['src/**'],
      consumers: ['gallery/**'],
      ignored: ['src/**/*.test.ts'],
      tests: ['src/**/*.test.ts'],
      entryPoints: { 'src/main.ts': 'the entry' },
      aliases: { '#platform': ['src/platform/desktop.ts'] },
    })

    expect(report.files).toEqual(['src/tested-only.ts'])
    expect(report.exports).toEqual([
      'src/barrel.ts#unread',
      'src/lazy.ts#notRead',
      'src/loader.ts#load',
      'src/members.ts#unreadMember',
      'src/named.ts#orphan',
      'src/named.ts#unread',
      'src/self.ts#alsoLocal',
      'src/self.ts#local',
      'src/star.ts#starUnused',
    ])
    expect(report.typeExports).toEqual(['src/named.ts#Shape', 'src/typed.ts#UnreadType'])
    expect(report.testOnlyExports).toEqual(['src/loader.ts#testSeam', 'src/tested-only.ts#seam'])
    expect(report.testOnlyTypeExports).toEqual([])
  })

  it('names entry points and aliases that exist', () => {
    const paths = new Set(repositoryGraph().map(({ path }) => path))
    const viteConfig = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
    const missing = [
      ...Object.keys(OPTIONS.entryPoints),
      ...Object.values(OPTIONS.aliases).flat(),
    ].filter((path) => !paths.has(path))
    expect(missing, 'Update OPTIONS when an entry point or alias target moves').toEqual([])
    const unmirrored = Object.entries(OPTIONS.aliases).flatMap(([alias, targets]) => [
      ...(viteConfig.includes(`'${alias}'`) ? [] : [alias]),
      ...targets.filter((target) => !viteConfig.includes(target.replace(/^src\//, './src/'))),
    ])
    expect(unmirrored, 'OPTIONS.aliases mirrors vite.config.ts resolve.alias').toEqual([])
  }, GRAPH_TIMEOUT_MS)

  it('names a bead or plan section for every KEPT entry', () => {
    const vague = Object.entries(KEPT).filter(([, reason]) => !KEPT_REASON.test(reason)).map(([entry]) => entry)
    expect(vague, 'A KEPT reason names the bead id (canopi-…) or "canvas-v2-plan.md section N"').toEqual([])
  })

  it('reports only the names in the snapshot', () => {
    const report = findUnusedCode(repositoryGraph(), OPTIONS)
    const keys = Object.keys(report) as (keyof UnusedCodeReport)[]
    const reported = new Set(keys.flatMap((key) => report[key]))
    const staleKept = Object.keys(KEPT).filter((entry) => !reported.has(entry))
    expect(staleKept, 'These KEPT entries are in use now; remove them from KEPT').toEqual([])

    const lists = Object.fromEntries(
      keys.map((key) => [key, report[key].filter((entry) => !(entry in KEPT))]),
    ) as unknown as UnusedCodeReport
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_URL, 'utf8')) as UnusedCodeReport
    const expected = `${JSON.stringify(lists, null, 2)}\n`

    const added = keys.flatMap((key) => lists[key].filter((entry) => !(snapshot[key] ?? []).includes(entry))
      .map((entry) => `${key}: ${entry}`))
    expect(added, 'New unused code. Delete the file or export, drop `export` from a name only its own file '
      + 'reads, or name a roadmap or test seam in KEPT with its bead id or plan section.').toEqual([])

    const gone = keys.flatMap((key) => (snapshot[key] ?? []).filter((entry) => !lists[key].includes(entry))
      .map((entry) => `${key}: ${entry}`))
    expect(gone, 'These names are in use or deleted now: remove them from '
      + `src/__tests__/unused-code-snapshot.json so they cannot come back. The snapshot is:\n${expected}`).toEqual([])
  }, GRAPH_TIMEOUT_MS)
})
