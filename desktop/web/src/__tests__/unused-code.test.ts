// @vitest-environment node

// The unused-code check (docs/plans/canvas-v2-plan.md, "Unused-code check").
// It lists production files no production import chain reaches from an entry
// point or a consumer, value exports no other module (tests included) imports,
// and type exports likewise, and holds the three counts to
// unused-code-ratchet.json: a count may only go down. Each phase close runs it,
// deletes what it finds and lowers the numbers; an entry kept on purpose (a
// roadmap seam) is named in the bead. A type export that only names a public
// signature's parameter or result is harmless; the ratchet keeps the number
// from growing.
//
//   npx vitest run src/__tests__/unused-code.test.ts    prints the lists when a count changes

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  createTypeScriptSourceGraph,
  readTypeScriptSources,
} from './support/architecture/source-facts'
import { findUnusedCode, type UnusedCodeOptions } from './support/architecture/unused-code'

const RATCHET_URL = new URL('./unused-code-ratchet.json', import.meta.url)

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

/** Entries the check reports that stay on purpose, each with the roadmap item or test that needs it. */
const KEPT: Readonly<Record<string, string>> = {
  'src/canvas/runtime/view/navigation-policy.ts#ROTATE_DEG_PER_PX':
    'phase 1 rotation: the pointer rotate rate (canvas-v2-spec.md §2.2 "Rotation sign")',
  'src/canvas/runtime/view/navigation-policy.ts#SNAP_TO_NORTH_DEG':
    'phase 1 rotation: free gestures and the compass snap to north within 7° (canvas-v2-spec.md §4)',
}

interface Ratchet {
  readonly files: number
  readonly exports: number
  readonly typeExports: number
}

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
      { path: 'src/main.ts', source: "import { used } from './barrel'\nimport * as all from './namespace'\nvoid used; void all" },
      { path: 'src/barrel.ts', source: "export * from './star'\nexport { kept as used, unread } from './named'" },
      { path: 'src/star.ts', source: 'export const starUnused = 1' },
      { path: 'src/named.ts', source: 'export const kept = 1\nexport const unread = 2\nexport const orphan = 3\nexport interface Shape { readonly x: number }' },
      { path: 'src/namespace.ts', source: 'export const a = 1\nexport type B = number' },
      { path: 'src/lazy.ts', source: 'export const viaDynamic = 1' },
      { path: 'src/loader.ts', source: "export const load = () => import('./lazy')" },
      { path: 'src/tested-only.ts', source: 'export const seam = 1' },
      { path: 'src/tested-only.test.ts', source: "import { seam } from './tested-only'\nvoid seam" },
      { path: 'src/self.ts', source: "export const local = 1\nexport const alsoLocal = local" },
      { path: 'src/platform/desktop.ts', source: 'export const platform = 1' },
      { path: 'src/aliased.ts', source: "import { platform } from '#platform'\nimport './self'\nexport default platform" },
      { path: 'gallery/main.ts', source: "import aliased from '../src/aliased'\nvoid aliased" },
    ])

    const report = findUnusedCode(graph, {
      checked: ['src/**'],
      consumers: ['gallery/**'],
      ignored: ['src/**/*.test.ts'],
      entryPoints: { 'src/main.ts': 'the entry' },
      aliases: { '#platform': ['src/platform/desktop.ts'] },
    })

    expect(report.files).toEqual(['src/lazy.ts', 'src/loader.ts', 'src/tested-only.ts'])
    expect(report.exports).toEqual([
      'src/barrel.ts#unread',
      'src/loader.ts#load',
      'src/named.ts#orphan',
      'src/named.ts#unread',
      'src/self.ts#alsoLocal',
      'src/self.ts#local',
      'src/star.ts#starUnused',
    ])
    expect(report.typeExports).toEqual(['src/named.ts#Shape'])
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

  it('holds the counts to the ratchet', () => {
    const report = findUnusedCode(repositoryGraph(), OPTIONS)
    const reported = new Set([...report.files, ...report.exports, ...report.typeExports])
    const staleKept = Object.keys(KEPT).filter((entry) => !reported.has(entry))
    expect(staleKept, 'These KEPT entries are in use now; remove them from KEPT').toEqual([])

    const unexplained = (entries: readonly string[]) => entries.filter((entry) => !(entry in KEPT))
    const lists = {
      files: unexplained(report.files),
      exports: unexplained(report.exports),
      typeExports: unexplained(report.typeExports),
    }
    const ratchet = JSON.parse(readFileSync(RATCHET_URL, 'utf8')) as Ratchet
    const keys = Object.keys(lists) as (keyof Ratchet)[]
    const counts = Object.fromEntries(keys.map((key) => [key, lists[key].length])) as unknown as Ratchet
    const listing = keys.flatMap((key) => [`Unused ${key} (${counts[key]}):`, ...lists[key].map((entry) => `  ${entry}`)])
      .join('\n')

    const grew = keys.filter((key) => counts[key] > ratchet[key])
    expect(grew, `The unused-code count went up (${grew.map((key) => `${key}: ${ratchet[key]} -> ${counts[key]}`).join(', ')}). `
      + 'Delete the new unused file or export, drop `export` from a name only its own file reads, '
      + 'or name a roadmap seam in KEPT.\n'
      + listing).toEqual([])

    const shrank = keys.filter((key) => counts[key] < ratchet[key])
    expect(shrank, 'The unused-code count went down: lower src/__tests__/unused-code-ratchet.json to '
      + `${JSON.stringify(counts)} so it cannot come back.\n${listing}`).toEqual([])
  }, GRAPH_TIMEOUT_MS)
})
