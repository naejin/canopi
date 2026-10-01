// @vitest-environment node

// Canvas v2 regex policies (docs/plans/canvas-v2-plan.md section 5): couplings the declarative harness cannot see,
// such as which element a listener is added to or which event type it names. Each policy walks every non-test
// .ts/.tsx file under src/, blanks comments, applies its regex to the files of its scope and compares the matches per
// file with its named allowlist, so a coupling reintroduced in a new file, or a new match in a listed one, fails. Each
// `it` title of a real-tree check is the policy's exact name, which the counting guard's map refers to.

import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { matchesPathPattern } from './support/architecture/policy-harness'

interface RegexPolicy {
  readonly name: string
  readonly pattern: RegExp
  /** Globs relative to desktop/web, as the declarative policies write them. */
  readonly scope: readonly string[]
  /** Each file allowed to match, with its exact number of matches. */
  readonly allowlist: Readonly<Record<string, number>>
}

interface Source {
  readonly path: string
  readonly text: string
}

const SRC = new URL('../', import.meta.url)
const TEST_SOURCE = /(^src\/__tests__\/|\.test\.tsx?$)/

/** The three chrome files that listen on their own elements (plan §5 P6). */
const CHROME_ELEMENT_LISTENERS = [
  'src/canvas/runtime/chrome/text-entry-host.ts',
  'src/canvas/runtime/chrome/handle-layer.ts',
  'src/canvas/runtime/chrome/locked-affordance.ts',
] as const

const RAW_POINTER_LISTENER = /addEventListener\(\s*['"](pointer\w*|mouse\w*|wheel|contextmenu|gesture\w*|touch\w*)['"]/g

/**
 * P6's components allowlist (inventory at the end of 0B, recorded in the 0B bead). Every entry is permanent: each
 * listens on its own element, or on the document for the rest of a press that began on its own element, never on the
 * map host (INV-ENT-23).
 */
const P6_COMPONENT_POINTER_LISTENERS: Readonly<Record<string, number>> = {
  // The lens drags its own frame: the press on the frame, then the document's move, up and cancel.
  'src/components/canvas/InspectionLens.tsx': 4,
  // The swatch drag's document move, up and cancel, and the menu's outside-press dismissal.
  'src/components/canvas/PlantColorMenu.tsx': 4,
  // Outside-press dismissal of menus and popovers (document pointerup).
  'src/components/canvas/PlantSymbolMenu.tsx': 1,
  'src/components/canvas/ZoomControls.tsx': 1,
  'src/components/plant-db/MoreFiltersPanel.tsx': 1,
  'src/components/shared/ActionMenu.tsx': 2,
  'src/components/shared/DatePicker.tsx': 1,
  'src/components/shared/Dropdown.tsx': 1,
  'src/components/shared/MenuBar.tsx': 1,
  'src/components/shared/SaveStatusLabel.tsx': 1,
  // The panel lists' drag to reorder and the dock splitters: the document's move, up and cancel after their own press.
  'src/components/shared/usePointerReorder.ts': 3,
  'src/components/shared/usePointerResize.ts': 3,
}

const P6_REGEX_POLICIES = [
  {
    name: 'P6 the chrome element owners add no listener to the map host or its container',
    pattern: /(host|container)\.addEventListener/g,
    scope: CHROME_ELEMENT_LISTENERS,
    allowlist: {},
  },
  {
    name: 'P6 components add raw pointer, mouse, wheel, contextmenu, gesture or touch listeners only on the named allowlist',
    pattern: RAW_POINTER_LISTENER,
    scope: ['src/components/**'],
    allowlist: P6_COMPONENT_POINTER_LISTENERS,
  },
  {
    name: 'P6 app modules add no raw pointer, mouse, wheel, contextmenu, gesture or touch listener',
    pattern: RAW_POINTER_LISTENER,
    scope: ['src/app/**'],
    allowlist: {},
  },
] as const satisfies readonly RegexPolicy[]

let sourcesCache: readonly Source[] | null = null

/** Every non-test .ts/.tsx file under src/, read once per run. */
function productionSources(): readonly Source[] {
  sourcesCache ??= (readdirSync(SRC, { recursive: true }) as string[])
    .map((name) => `src/${name.split('\\').join('/')}`)
    .filter((path) => /\.tsx?$/.test(path) && !TEST_SOURCE.test(path))
    .sort()
    .map((path) => ({ path, text: readFileSync(new URL(path.slice('src/'.length), SRC), 'utf8') }))
  return sourcesCache
}

/** The text with every comment replaced by spaces, newlines kept, so a commented-out listener is no match. */
function blankComments(path: string, text: string): string {
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const chars = [...text]
  const blank = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const { pos, end } of ranges ?? []) {
      for (let index = pos; index < end; index += 1) if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' '
    }
  }
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.JsxText) return
    blank(ts.getLeadingCommentRanges(text, node.getFullStart()))
    blank(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(file)) visit(child)
  }
  visit(file)
  return chars.join('')
}

/** The number of matches per file of the policy's scope. */
function regexHits(policy: RegexPolicy, sources: readonly Source[]): Record<string, number> {
  const hits: Record<string, number> = {}
  for (const { path, text } of sources) {
    if (!policy.scope.some((pattern) => matchesPathPattern(path, pattern))) continue
    if (!new RegExp(policy.pattern.source).test(text)) continue
    const count = blankComments(path, text).match(new RegExp(policy.pattern.source, 'g'))?.length ?? 0
    if (count > 0) hits[path] = count
  }
  return hits
}

function policyNamed(name: string): RegexPolicy {
  const policy = P6_REGEX_POLICIES.find((candidate) => candidate.name === name)
  if (!policy) throw new Error(`no regex policy named ${name}`)
  return policy
}

describe('canvas v2 regex policies', () => {
  it('reads the source tree and every scoped file', () => {
    const paths = productionSources().map(({ path }) => path)
    expect(paths.length).toBeGreaterThan(400)
    expect(paths).toEqual(expect.arrayContaining([...CHROME_ELEMENT_LISTENERS]))
    expect(paths.some((path) => TEST_SOURCE.test(path))).toBe(false)
    for (const path of Object.keys(P6_COMPONENT_POINTER_LISTENERS)) expect(paths).toContain(path)
  })

  for (const policy of P6_REGEX_POLICIES) {
    it(policy.name, () => {
      expect(regexHits(policy, productionSources())).toEqual(policy.allowlist)
    }, 20_000)
  }

  it('P6 rejects a planted host or container listener in a chrome file, not one on its own element', () => {
    const policy = policyNamed('P6 the chrome element owners add no listener to the map host or its container')
    expect(regexHits(policy, [
      { path: 'src/canvas/runtime/chrome/handle-layer.ts', text: "host.addEventListener('pointerdown', press)" },
      { path: 'src/canvas/runtime/chrome/text-entry-host.ts', text: "this.container.addEventListener('keydown', keys)" },
      { path: 'src/canvas/runtime/chrome/locked-affordance.ts', text: "button.addEventListener('click', unlock)\n// host.addEventListener('x', y)" },
      { path: 'src/canvas/runtime/chrome/rulers.ts', text: "host.addEventListener('pointerdown', press)" },
    ])).toEqual({
      'src/canvas/runtime/chrome/handle-layer.ts': 1,
      'src/canvas/runtime/chrome/text-entry-host.ts': 1,
    })
  })

  it('P6 rejects a planted raw listener in a new component and an extra one in a listed component', () => {
    const policy = policyNamed(
      'P6 components add raw pointer, mouse, wheel, contextmenu, gesture or touch listeners only on the named allowlist',
    )
    const planted = [
      "host.addEventListener('wheel', zoom)",
      'host.addEventListener(\n  "contextmenu", menu)',
      "host.addEventListener('mousedown', press); host.addEventListener('touchstart', touch)",
      "host.addEventListener('gesturechange', pinch)",
      "host.addEventListener('keydown', keys)",
      "// host.addEventListener('pointerdown', press)",
      "/* host.addEventListener('pointermove', move) */ const x = <p>host.addEventListener('pointerup')</p>",
    ].join('\n')
    expect(regexHits(policy, [
      { path: 'src/components/canvas/PlantedSurface.tsx', text: planted },
      { path: 'src/components/shared/MenuBar.tsx', text: "document.addEventListener('pointerup', a)\ndocument.addEventListener('pointerdown', b)" },
      { path: 'src/app/planted/host.ts', text: "host.addEventListener('pointerdown', press)" },
    ])).toEqual({
      // The JSX text is not a comment, so its match counts.
      'src/components/canvas/PlantedSurface.tsx': 6,
      'src/components/shared/MenuBar.tsx': 2,
    })
  })

  it('P6 rejects a planted raw listener in an app module', () => {
    const policy = policyNamed('P6 app modules add no raw pointer, mouse, wheel, contextmenu, gesture or touch listener')
    expect(regexHits(policy, [
      { path: 'src/app/canvas-map-surface/planted.ts', text: "container.addEventListener('pointerdown', press, { capture: true })" },
      { path: 'src/app/keyboard/planted.ts', text: "window.addEventListener('keydown', keys)" },
    ])).toEqual({ 'src/app/canvas-map-surface/planted.ts': 1 })
  })
})
