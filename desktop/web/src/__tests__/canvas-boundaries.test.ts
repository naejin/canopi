// @vitest-environment node

// Canvas v2 regex policies (docs/plans/canvas-v2-plan.md section 5): couplings the declarative harness cannot see,
// such as which element a listener is added to or which event type it names. Each policy walks every non-test
// .ts/.tsx file under src/, blanks comments, applies its regex to the files of its scope and compares the matches per
// file with its named allowlist, so a coupling reintroduced in a new file, or a new match in a listed one, fails. Each
// `it` title of a real-tree check is the policy's exact name.

import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { matchesPathPattern } from './support/architecture/policy-harness'

interface RegexPolicy {
  readonly name: string
  readonly pattern: RegExp
  /** Globs relative to desktop/web, as the declarative policies write them. */
  readonly scope: readonly string[]
  /** Globs inside the scope that the policy exempts. */
  readonly except?: readonly string[]
  /** Each file allowed to match, with its exact number of matches. */
  readonly allowlist: Readonly<Record<string, number>>
}

interface Source {
  readonly path: string
  readonly text: string
}

const SRC = new URL('../', import.meta.url)
const TEST_SOURCE = /(^src\/__tests__\/|\.test\.tsx?$)/

/** The two chrome files that listen on their own elements (plan §5 P6). */
const CHROME_ELEMENT_LISTENERS = [
  'src/canvas/runtime/chrome/text-entry-host.ts',
  'src/canvas/runtime/chrome/handle-layer.ts',
] as const

/** The one owner of window key listeners (spec §1.6): its capture and bubble keydown and capture keyup; it also holds
 *  the document press record (P6). */
const KEY_ROUTER = 'src/app/keyboard/key-router.ts'

const RAW_POINTER_LISTENER = /addEventListener\(\s*['"](pointer\w*|mouse\w*|wheel|contextmenu|gesture\w*|touch\w*)['"]/g

/**
 * P6's components allowlist (inventory at the end of 0B, recorded in the 0B bead). Every entry is permanent: each
 * listens on its own element, or on the document for the rest of a press that began on its own element, never on the
 * map host.
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
    name: 'P6 app modules add no raw pointer, mouse, wheel, contextmenu, gesture or touch listener but the key router\'s press record',
    pattern: RAW_POINTER_LISTENER,
    scope: ['src/app/**'],
    // The document's pointerdown at capture records whether the last press landed in the map host, so a key with
    // nothing focused acts on the map only after a press on it; it reads the press and never takes it.
    allowlist: { [KEY_ROUTER]: 1 },
  },
] as const satisfies readonly RegexPolicy[]

/**
 * P3b's regexes (plan §5): the scale-and-offset projection in the old spelling (`.scale`, `viewport.x`) and the new
 * (`pixelsPerMetre`, `metresPerPixelAt`, the operator on either side), a scale copied into a local and a destructured
 * scale. One alternation, so a line is counted once per match.
 */
const HAND_ROLLED_PROJECTION = new RegExp([
  /\.scale\s*[*+/]/,
  /viewport\.(x|y)\b/,
  /\bpixelsPerMetre\s*[*/]/,
  /[*/]\s*[\w.]*\bpixelsPerMetre\b/,
  /metresPerPixelAt\([^)]*\)\s*[*/]/,
  /[*/]\s*[\w.]*\bmetresPerPixelAt\(/,
  /=\s*[\w.]*\.pixelsPerMetre\s*[;,\n]/,
  /=\s*[\w.]*\.metresPerPixelAt\([^)]*\)\s*[;,\n]/,
  /const\s*\{[^}]*\bscale\b[^}]*\}\s*=/,
].map(({ source }) => `(?:${source})`).join('|'), 'g')

/**
 * P3b's permanent allowlist: sizes, never positions (counted at the end of 0E, recorded in canopi-f47t.5; re-counted
 * at the Renderer merge of phase 1, when the phase-1 allowlist emptied and the scene chrome went).
 */
const P3B_SIZE_ONLY: Readonly<Record<string, number>> = {
  // The lens's stroke widths and its plants' presentation scale.
  'src/canvas/runtime/inspection-lens-drawing.ts': 3,
  // A plant's hit radius in pixels.
  'src/canvas/runtime/plant-presentation.ts': 1,
  // The plants' and text annotations' presentation scale.
  'src/canvas/runtime/renderers/billboard-layer.ts': 2,
  // The drafts' stroke scale.
  'src/canvas/runtime/renderers/draft-layer.ts': 1,
  // A selection label's radius in pixels.
  'src/canvas/runtime/selection-labels.ts': 1,
  // A tolerance: whether a frame keeps the last frame's scale.
  'src/canvas/runtime/scene-runtime/reorigin.ts': 1,
}

const P3B_POLICY = {
  name: 'P3b no hand-rolled projection outside the view module, apart from the named allowlists',
  pattern: HAND_ROLLED_PROJECTION,
  scope: ['src/**'],
  // The PDF's paper projection maps a page to the ground, not the view (ADR 0008).
  except: ['src/canvas/runtime/view/**', 'src/app/canvas-pdf/**'],
  allowlist: P3B_SIZE_ONLY,
} as const satisfies RegexPolicy


/**
 * P8's regexes (plan §5): a key listener added directly, and a key type passed to a listener helper
 * (`listen(window, 'keydown', …)`, as the DOM input source did until F). JSX `onKeyDown` is no match.
 */
const KEY_LISTENER = new RegExp([
  /addEventListener\(\s*['"]key(down|up)['"]/,
  /\b\w+\(\s*[^,()]+,\s*['"]key(down|up)['"]/,
].map(({ source }) => `(?:${source})`).join('|'), 'g')

const P8_POLICY = {
  name: 'P8 only the key router adds window key listeners; the chrome files listen on their own elements',
  pattern: KEY_LISTENER,
  scope: ['src/**'],
  // The owner; its keyState(event, 'keydown', …) calls also match the helper form.
  except: [KEY_ROUTER],
  // The handles, the note editor and the unlock button take keys on their own elements.
  allowlist: Object.fromEntries(CHROME_ELEMENT_LISTENERS.map((path) => [path, 1])),
} as const satisfies RegexPolicy

const REGEX_POLICIES = [...P6_REGEX_POLICIES, P3B_POLICY, P8_POLICY] as const satisfies readonly RegexPolicy[]

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
  // UTF-16 code units, as the comment positions count them; spreading the string would split by code point.
  const chars = text.split('')
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
    if (policy.except?.some((pattern) => matchesPathPattern(path, pattern))) continue
    if (!new RegExp(policy.pattern.source).test(text)) continue
    const count = blankComments(path, text).match(new RegExp(policy.pattern.source, 'g'))?.length ?? 0
    if (count > 0) hits[path] = count
  }
  return hits
}

function policyNamed(name: string): RegexPolicy {
  const policy = (REGEX_POLICIES as readonly RegexPolicy[]).find((candidate) => candidate.name === name)
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
    for (const path of Object.keys(P3B_POLICY.allowlist)) expect(paths).toContain(path)
    expect(paths).toContain(KEY_ROUTER)
  })

  for (const policy of REGEX_POLICIES) {
    it(policy.name, () => {
      expect(regexHits(policy, productionSources())).toEqual(policy.allowlist)
    }, 20_000)
  }

  it('P6 rejects a planted host or container listener in a chrome file, not one on its own element', () => {
    const policy = policyNamed('P6 the chrome element owners add no listener to the map host or its container')
    expect(regexHits(policy, [
      { path: 'src/canvas/runtime/chrome/handle-layer.ts', text: "host.addEventListener('pointerdown', press)" },
      { path: 'src/canvas/runtime/chrome/text-entry-host.ts', text: "this.container.addEventListener('keydown', keys)" },
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

  it('P6 blanks the right comment range after astral characters', () => {
    const policy = policyNamed('P6 app modules add no raw pointer, mouse, wheel, contextmenu, gesture or touch listener but the key router\'s press record')
    // Comment positions are UTF-16 offsets, so each emoji ahead of a comment takes two places, not one. Read by code
    // point, sixty emoji would shift the blanking past the commented listener and onto the padding line.
    const text = [
      `const label = '${'\u{1F333}'.repeat(60)}'`,
      "// host.addEventListener('pointerdown', press)",
      `const padding = '${'x'.repeat(70)}'`,
      "host.addEventListener('wheel', zoom)",
    ].join('\n')
    expect(regexHits(policy, [{ path: 'src/app/planted/emoji.ts', text }])).toEqual({ 'src/app/planted/emoji.ts': 1 })
  })

  it('P6 rejects a planted raw listener in an app module', () => {
    const policy = policyNamed('P6 app modules add no raw pointer, mouse, wheel, contextmenu, gesture or touch listener but the key router\'s press record')
    expect(regexHits(policy, [
      { path: 'src/app/canvas-map-surface/planted.ts', text: "container.addEventListener('pointerdown', press, { capture: true })" },
      { path: 'src/app/keyboard/planted.ts', text: "window.addEventListener('keydown', keys)" },
    ])).toEqual({ 'src/app/canvas-map-surface/planted.ts': 1 })
  })

  it('P8 rejects a planted window, document or helper key listener and a second one in a chrome file', () => {
    const policy = policyNamed('P8 only the key router adds window key listeners; the chrome files listen on their own elements')
    expect(regexHits(policy, [
      { path: 'src/components/canvas/PlantedMenu.tsx', text: "document.addEventListener('keydown', close)" },
      { path: 'src/app/shell/planted.ts', text: 'window.addEventListener(\n  "keyup", release, true)' },
      { path: 'src/canvas/runtime/input/planted.ts', text: "listen(window, 'keydown', keys); on(this.host, \"keyup\", up)" },
      { path: 'src/canvas/runtime/chrome/handle-layer.ts', text: "element.addEventListener('keydown', a)\nelement.addEventListener('keyup', b)" },
      { path: 'src/components/canvas/Planted.tsx', text: "const x = <div onKeyDown={keys} />\n// window.addEventListener('keydown', keys)" },
      { path: 'src/web/planted.ts', text: "window.addEventListener('keypress', keys); window.addEventListener('pointerdown', press)" },
      { path: KEY_ROUTER, text: "deps.target.addEventListener('keydown', capture, true)" },
    ])).toEqual({
      'src/components/canvas/PlantedMenu.tsx': 1,
      'src/app/shell/planted.ts': 1,
      'src/canvas/runtime/input/planted.ts': 2,
      'src/canvas/runtime/chrome/handle-layer.ts': 2,
    })
  })

  it('P3b rejects each planted hand-rolled projection, not a comment, the view module or the PDF', () => {
    const policy = policyNamed('P3b no hand-rolled projection outside the view module, apart from the named allowlists')
    const planted = [
      'const x = p.x * viewport.scale + 4',
      'const y = viewport.y',
      'const sx = (p.x - c.x) * view.pixelsPerMetre + w / 2',
      'const sy = h / 2 - dy * view.pixelsPerMetre',
      'const metres = view.metresPerPixelAt(p) * dx',
      'const dm = dx / view.metresPerPixelAt()',
      'const ppm = view.pixelsPerMetre;',
      'const mpp = view.metresPerPixelAt(p)\n',
      'const { x, scale } = camera',
    ]
    const sources = planted.map((text, index) => ({ path: `src/app/planted/projection-${index + 1}.ts`, text }))
    expect(regexHits(policy, [
      ...sources,
      { path: 'src/canvas/runtime/chrome/planted-comment.ts', text: '// p.x * view.pixelsPerMetre\n/* viewport.x */' },
      { path: 'src/canvas/runtime/view/planted.ts', text: 'const sx = (p.x - c.x) * view.pixelsPerMetre + w / 2' },
      { path: 'src/app/canvas-pdf/planted.ts', text: 'const sx = frame.x + (p.x - ground.x) * scale.pixelsPerMetre' },
    ])).toEqual(Object.fromEntries(sources.map(({ path }) => [path, 1])))
  })
})
