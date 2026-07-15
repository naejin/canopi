import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  discoverCssModuleFacts,
  parseCssDeclarations,
  type CssDeclarationFact,
} from './support/architecture/css-facts'
import {
  collectCssPolicyViolations,
  type CssDeclarationPolicy,
} from './support/architecture/policy-harness'

const CSS_WIDE_VALUES = new Set(['inherit', 'initial', 'revert', 'revert-layer', 'unset'])
const CSS_NUMBER_SOURCE = String.raw`[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:e[+-]?\d+)?`
const CSS_LENGTH_UNITS = [
  'px', 'cm', 'mm', 'q', 'in', 'pc', 'pt',
  'em', 'rem', 'ex', 'rex', 'cap', 'rcap', 'ch', 'rch', 'ic', 'ric', 'lh', 'rlh',
  'vw', 'vh', 'vi', 'vb', 'vmin', 'vmax',
  'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax',
  'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax',
  'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax',
  'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax',
].join('|')
const RAW_CSS_LENGTH_OR_PERCENTAGE = new RegExp(
  String.raw`(?:^|[^\w.-])${CSS_NUMBER_SOURCE}(?:${CSS_LENGTH_UNITS}|%)(?![\w-])`,
  'i',
)
const RAW_CSS_TIME = new RegExp(
  String.raw`(?:^|[^\w.-])${CSS_NUMBER_SOURCE}(?:ms|s)(?![\w-])`,
  'i',
)
const GLOBAL_DESIGN_TOKEN_NAMES = collectGlobalDesignTokenNames(
  readFileSync('src/styles/global.css', 'utf8'),
)

const STRUCTURAL_SPACING_EXCEPTIONS = [
  {
    file: 'src/components/canvas/LayerPanel.module.css',
    rule: '.layerDetail',
    atRules: [],
    property: 'padding-left',
    value: 'calc(var(--control-size-sm) + var(--space-2) + var(--space-1))',
    reason: 'Aligns nested layer detail with the preceding control-width column plus visual spacing.',
  },
  {
    file: 'src/components/canvas/LayerPanel.module.css',
    rule: '.mapSlider::-webkit-slider-thumb',
    atRules: [],
    property: 'margin-top',
    value: 'calc((var(--slider-thumb-size) - var(--slider-track-size)) / -2)',
    reason: 'WebKit requires the thumb to be offset by half the difference between thumb and track geometry.',
  },
  {
    file: 'src/components/canvas/LocationTab.module.css',
    rule: '.centerCrosshair::before',
    atRules: [],
    property: 'margin-left',
    value: 'calc(-1px)',
    reason: 'Centers the two-pixel vertical crosshair on its exact screen pixel.',
  },
  {
    file: 'src/components/canvas/LocationTab.module.css',
    rule: '.centerCrosshair::after',
    atRules: [],
    property: 'margin-top',
    value: 'calc(-1px)',
    reason: 'Centers the two-pixel horizontal crosshair on its exact screen pixel.',
  },
  {
    file: 'src/components/canvas/LocationTab.module.css',
    rule: '.savedPin::before',
    atRules: [],
    property: 'margin-left',
    value: 'calc((var(--space-4) + var(--space-0-5)) / -2)',
    reason: 'Centers the structural pin silhouette around its left percentage coordinate.',
  },
  {
    file: 'src/components/canvas/LocationTab.module.css',
    rule: '.savedPin::after',
    atRules: [],
    property: 'margin-left',
    value: 'calc(var(--space-1-5) / -2)',
    reason: 'Centers the structural pin center around its left percentage coordinate.',
  },
  {
    file: 'src/components/panels/FavoritesPanel.module.css',
    rule: '.savedStampGripDots',
    atRules: [],
    property: 'gap',
    value: 'var(--saved-stamp-grip-dot-size)',
    reason: 'The structural grid gap must equal the locally defined grip-dot diameter.',
  },
  {
    file: 'src/components/plant-db/PlantDb.module.css',
    rule: '.searchInput',
    atRules: [],
    property: 'padding-right',
    value: 'var(--control-size-md)',
    reason: 'Reserves the exact width of the overlaid search control rather than visual spacing.',
  },
  {
    file: 'src/components/plant-db/RangeSlider.module.css',
    rule: '.input::-webkit-slider-thumb',
    atRules: [],
    property: 'margin-top',
    value: 'calc(var(--slider-thumb-size) / -2)',
    reason: 'WebKit range thumbs are centered against the intentionally zero-height structural track.',
  },
  {
    file: 'src/components/plant-db/ThresholdSlider.module.css',
    rule: '.tick',
    atRules: [],
    property: 'margin-left',
    value: 'calc(-1px / 2)',
    reason: 'Centers a one-pixel tick on its exact percentage coordinate.',
  },
  {
    file: 'src/components/plant-db/ThresholdSlider.module.css',
    rule: '.input::-webkit-slider-thumb',
    atRules: [],
    property: 'margin-top',
    value: 'calc(var(--slider-thumb-size) / -2)',
    reason: 'WebKit range thumbs are centered against the intentionally zero-height structural track.',
  },
  {
    file: 'src/components/shared/CommandPalette.module.css',
    rule: '.overlay',
    atRules: [],
    property: 'padding-top',
    value: '20vh',
    reason: 'Positions the palette relative to viewport height rather than the visual spacing scale.',
  },
] as const

const STRUCTURAL_FONT_EXCEPTIONS = [
  {
    file: 'src/components/plant-detail/PhotoCarousel.module.css',
    rule: '.navBtn',
    atRules: [],
    property: 'font-size',
    value: '22px',
    reason: 'The character is a chevron icon whose font size controls glyph geometry, not text hierarchy.',
  },
] as const

const REVIEWED_TRANSITION_EXCEPTIONS = [
  {
    file: 'src/components/plant-detail/PhotoCarousel.module.css',
    rule: '.image',
    atRules: [],
    property: 'transition',
    value: 'opacity 350ms ease',
    reason: 'Image decoding uses a deliberately slower opacity reveal than interactive controls.',
  },
  {
    file: 'src/components/plant-detail/PhotoCarousel.module.css',
    rule: '.navBtn',
    atRules: [],
    property: 'transition',
    value: 'opacity 200ms ease',
    reason: 'Carousel controls need a local fade between the normal and image-load transition speeds.',
  },
] as const

const CSS_MODULE_POLICIES: readonly CssDeclarationPolicy[] = [
  {
    name: 'Design-scale tokens are declared globally',
    properties: ['--space-*', '--text-*', '--font-*', '--radius-*', '--transition-*'],
    rawValue: /[\s\S]*/,
    requiredValue: /$^/,
    accepts: () => false,
    exceptions: [],
  },
  {
    name: 'CSS font sizes use typography tokens',
    properties: ['font-size', 'font'],
    rawValue: /[\s\S]+/,
    requiredValue: /$^/,
    accepts: acceptsFontDeclaration,
    exceptions: STRUCTURAL_FONT_EXCEPTIONS,
  },
  {
    name: 'CSS spacing uses spacing tokens',
    properties: ['padding*', 'margin*', 'gap', 'row-gap', 'column-gap'],
    rawValue: /[\s\S]+/,
    requiredValue: /$^/,
    accepts: ({ value }) => splitTopLevelComponents(value).every(acceptsSpacingComponent),
    exceptions: STRUCTURAL_SPACING_EXCEPTIONS,
  },
  {
    name: 'CSS radii use radius tokens',
    properties: ['border-radius', 'border-*-radius'],
    rawValue: /[\s\S]+/,
    requiredValue: /$^/,
    accepts: ({ value }) => splitTopLevelComponents(value, true).every(acceptsRadiusComponent),
    exceptions: [],
  },
  {
    name: 'CSS transitions use transition tokens',
    properties: ['transition', 'transition-*', '--transition-*'],
    rawValue: /[\s\S]+/,
    requiredValue: /$^/,
    accepts: acceptsTransitionDeclaration,
    exceptions: REVIEWED_TRANSITION_EXCEPTIONS,
  },
]

describe('CSS module policy facts', () => {
  it('parses lexical edge cases without treating comments or selector colons as declarations', () => {
    const declarations = parseCssDeclarations('src/fixture.module.css', `
      /* .ignored { gap: 99px; } */
      .item:hover {
        padding:
          var(--space-2)
          calc(var(--space-1) + 1px);
        background-image: url("data:image/svg+xml;utf8,<svg>{}</svg>");
      }

      @media (prefers-reduced-motion: reduce) {
        .item { transition: none }
      }
    `)

    expect(declarations.map(({ rule, property, value, line }) => ({
      rule,
      property,
      value,
      line,
    }))).toEqual([
      {
        rule: '.item:hover',
        property: 'padding',
        value: 'var(--space-2)\n          calc(var(--space-1) + 1px)',
        line: 4,
      },
      {
        rule: '.item:hover',
        property: 'background-image',
        value: 'url("data:image/svg+xml;utf8,<svg>{}</svg>")',
        line: 7,
      },
      {
        rule: '.item',
        property: 'transition',
        value: 'none',
        line: 11,
      },
    ])
  })

  it('discovers every CSS Module recursively in stable path order', () => {
    const files = discoverCssModuleFacts('src')
    const paths = files.map(({ path }) => path)

    expect(paths).toEqual([...paths].sort())
    expect(paths).toContain('src/App.module.css')
    expect(paths).toContain('src/components/plant-detail/PlantDetail.module.css')
    expect(paths).toContain('src/web/WebSpeciesCatalogPanel.module.css')
    expect(paths.length).toBeGreaterThan(21)
    expect(files.every(({ path, declarations }) =>
      declarations.every((declaration) => declaration.path === path),
    )).toBe(true)
  })

  it('does not treat token-plus-magic-length arithmetic as tokenization', () => {
    expect(acceptsSpacingComponent('calc(var(--space-1) - 1px)')).toBe(false)
    expect(acceptsRadiusComponent('calc(var(--radius-sm) - 2px)')).toBe(false)
    expect(acceptsFontDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'font-size',
      value: 'calc(var(--text-xs) - 1px)',
      line: 1,
      column: 1,
    })).toBe(false)
    expect(acceptsTransitionDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: '--transition-local',
      value: '200ms ease',
      line: 1,
      column: 1,
    })).toBe(false)

    const scopedOverride = [{
      path: 'src/fixture.module.css',
      declarations: parseCssDeclarations(
        'src/fixture.module.css',
        `.item {
          --space-1: 99px;
          --radius-sm: ;
          --transition-fast: /* intentionally empty */;
          padding: var(--space-1);
        }`,
      ),
    }]
    expect(collectCssPolicyViolations(scopedOverride, [CSS_MODULE_POLICIES[0]!])).toEqual([
      '[Design-scale tokens are declared globally] src/fixture.module.css:2 --space-1: 99px',
      '[Design-scale tokens are declared globally] src/fixture.module.css:3 --radius-sm: ',
      '[Design-scale tokens are declared globally] src/fixture.module.css:4 --transition-fast: ',
    ])
    expect(acceptsTransitionDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'transition',
      value: 'opacity ease',
      line: 1,
      column: 1,
    })).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) + 1%)')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) + 1dvh)')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) + 1e2px)')).toBe(false)
    expect(acceptsSpacingComponent('var(--space-local)')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) * 999)')).toBe(false)
    expect(acceptsSpacingComponent('calc((999) * var(--space-1))')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) * calc(999))')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) * calc(-1 + -1))')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) * pi)')).toBe(false)
    expect(acceptsSpacingComponent('calc(var(--space-1) * -1)')).toBe(true)
    expect(acceptsFontDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'font-size',
      value: 'calc(var(--text-xs) * 999)',
      line: 1,
      column: 1,
    })).toBe(false)
    expect(acceptsFontDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'font',
      value: '600 var(--text-sm)/var(--line-height) var(--font-sans)',
      line: 1,
      column: 1,
    })).toBe(true)
    expect(acceptsRadiusComponent('calc(var(--radius-sm) * 999)')).toBe(false)
    expect(acceptsTransitionDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'transition-delay',
      value: 'calc(var(--transition-fast) + -150ms)',
      line: 1,
      column: 1,
    })).toBe(false)
    expect(acceptsTransitionDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'transition-duration',
      value: 'calc(var(--transition-fast) * 999)',
      line: 1,
      column: 1,
    })).toBe(false)
    expect(acceptsTransitionDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'transition-behavior',
      value: 'allow-discrete',
      line: 1,
      column: 1,
    })).toBe(true)
    expect(collectGlobalDesignTokenNames(`
      :root { --space-root: 1px; --Space-Case: 2px; }
      [data-theme='dark'] { --space-dark-only: 3px; }
      @media (min-width: 1px) { :root { --space-media-only: 4px; } }
    `)).toEqual(new Set(['--space-root', '--Space-Case']))
    expect(parseCssDeclarations(
      'src/fixture.module.css',
      '.item { --Space-Case: 2px; }',
    )[0]?.property).toBe('--Space-Case')
    expect(acceptsTransitionDeclaration({
      path: 'src/fixture.module.css',
      rule: '.item',
      atRules: [],
      property: 'transition-duration',
      value: 'calc(var(--transition-fast) + 150MS)',
      line: 1,
      column: 1,
    })).toBe(false)
  })

  it('keeps every CSS Module on the shared design-token policies', () => {
    const files = discoverCssModuleFacts('src')

    expect(collectCssPolicyViolations(files, CSS_MODULE_POLICIES)).toEqual([])
  })
})

function acceptsFontDeclaration({ property, value }: CssDeclarationFact): boolean {
  const normalized = value.trim()
  if (CSS_WIDE_VALUES.has(normalized)) return true
  return usesOnlyTokenFamily(
    normalized,
    '--text-',
    property === 'font' ? ['--font-', '--line-height'] : [],
  )
}

function acceptsSpacingComponent(component: string): boolean {
  const normalized = component.trim()
  return normalized === '0'
    || normalized === 'auto'
    || normalized === 'normal'
    || CSS_WIDE_VALUES.has(normalized)
    || usesOnlyTokenFamily(normalized, '--space-')
}

function acceptsRadiusComponent(component: string): boolean {
  const normalized = component.trim()
  return normalized === '0'
    || /^\d+(?:\.\d+)?%$/.test(normalized)
    || CSS_WIDE_VALUES.has(normalized)
    || usesOnlyTokenFamily(normalized, '--radius-')
}

function acceptsTransitionDeclaration({ property, value }: CssDeclarationFact): boolean {
  const normalized = value.trim()
  if (CSS_WIDE_VALUES.has(normalized) || normalized === 'none') return true
  if (
    property === 'transition-property'
    || property === 'transition-timing-function'
    || property === 'transition-behavior'
  ) return true
  if (containsRawCssTime(normalized)) return false
  if (containsForbiddenUnitlessScaleArithmetic(normalized)) return false
  const variables = cssVariableNames(normalized)
  return variables.length > 0 && variables.every((name) =>
    name.startsWith('--transition-') && GLOBAL_DESIGN_TOKEN_NAMES.has(name),
  )
}

function usesOnlyTokenFamily(
  value: string,
  requiredPrefix: string,
  additionalPrefixes: readonly string[] = [],
): boolean {
  const variables = cssVariableNames(value)
  return !containsRawCssLength(value)
    && !containsForbiddenUnitlessScaleArithmetic(value)
    && variables.some((name) => name.startsWith(requiredPrefix))
    && variables.every((name) =>
      GLOBAL_DESIGN_TOKEN_NAMES.has(name)
      && (name.startsWith(requiredPrefix)
        || additionalPrefixes.some((prefix) => name.startsWith(prefix))),
    )
}

function containsRawCssLength(value: string): boolean {
  RAW_CSS_LENGTH_OR_PERCENTAGE.lastIndex = 0
  return RAW_CSS_LENGTH_OR_PERCENTAGE.test(value)
}

function containsRawCssTime(value: string): boolean {
  RAW_CSS_TIME.lastIndex = 0
  return RAW_CSS_TIME.test(value)
}

function containsForbiddenUnitlessScaleArithmetic(value: string): boolean {
  for (const expression of cssMathFunctionBodies(value)) {
    const operators = expression.match(/[*/]/g) ?? []
    if (operators.length === 0) continue
    if (operators.length !== 1 || operators[0] !== '*') return true

    const unitlessNumber = new RegExp(
      String.raw`(?:^|[^\w.-])(${CSS_NUMBER_SOURCE})(?![\w.%])`,
      'gi',
    )
    const numbers = [...expression.matchAll(unitlessNumber)].map((match) => Number(match[1]))
    if (numbers.length !== 1 || numbers[0] !== -1) return true
    if (!/\*\s*-1(?![\d.])|(?:^|[^\w.])-1\s*\*/.test(expression)) return true
  }
  return false
}

function cssMathFunctionBodies(value: string): string[] {
  const starts = value.matchAll(
    /\b(?:abs|acos|asin|atan|atan2|calc|clamp|cos|exp|hypot|log|max|min|mod|pow|rem|round|sign|sin|sqrt|tan)\(/gi,
  )
  const bodies: string[] = []
  for (const match of starts) {
    const open = (match.index ?? 0) + match[0].length - 1
    const close = matchingParenthesis(value, open)
    if (close >= 0) bodies.push(value.slice(open + 1, close))
  }
  return bodies
}

function matchingParenthesis(value: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let index = open; index < value.length; index += 1) {
    const char = value[index]!
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return index
  }
  return -1
}

function collectGlobalDesignTokenNames(source: string): Set<string> {
  return new Set(
    parseCssDeclarations('src/styles/global.css', source)
      .filter(({ property, rule, atRules }) =>
        property.startsWith('--') && rule === ':root' && atRules.length === 0,
      )
      .map(({ property }) => property),
  )
}

function cssVariableNames(value: string): string[] {
  return Array.from(value.matchAll(/var\(\s*(--[\w-]+)/g), (match) => match[1]!)
}

function splitTopLevelComponents(value: string, splitSlash = false): string[] {
  const components: string[] = []
  let start = 0
  let depth = 0
  let quote: string | null = null
  let index = 0

  const push = (end: number) => {
    const component = value.slice(start, end).trim()
    if (component) components.push(component)
  }

  while (index < value.length) {
    const char = value[index]!
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === '(') {
      depth += 1
    } else if (char === ')' && depth > 0) {
      depth -= 1
    } else if (depth === 0 && (/\s/.test(char) || (splitSlash && char === '/'))) {
      push(index)
      start = index + 1
    }
    index += 1
  }
  push(value.length)
  return components
}
