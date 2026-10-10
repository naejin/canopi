import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { parseCssDeclarations } from './support/architecture/css-facts'

// Under reduced motion, global.css sets transition timing on every element. Every element's
// `transition-property` is `all` by default, so any non-zero duration or delay there turns every
// style change on the page into a transition, including the inline size MapLibre gives its canvas
// on a resize. For that frame the canvas still lays out at its old size over its new backing store,
// and the shared scene layer refuses to draw ("MapLibre canvas backing size changed outside the
// shared renderer contract"), which loses the map. Reduced motion means instant: zero, not short.
const GLOBAL_CSS = 'src/styles/global.css'

function isZeroTime(value: string): boolean {
  return value
    .replace(/!important/i, '')
    .split(',')
    .every((time) => /^-?0+(\.0+)?(s|ms)?$/i.test(time.trim()))
}

describe('reduced-motion transitions', () => {
  it('gives every element no transition time, so a resized map canvas takes its new size in the same frame', () => {
    const declarations = parseCssDeclarations(GLOBAL_CSS, readFileSync(GLOBAL_CSS, 'utf8'))
      .filter(({ atRules }) => atRules.some((atRule) => atRule.includes('prefers-reduced-motion: reduce')))
    const timings = declarations.filter(({ property }) => property === 'transition-duration' || property === 'transition-delay')

    expect(timings.map(({ property }) => property).sort(), 'the reduced-motion rule sets both transition times')
      .toEqual(['transition-delay', 'transition-duration'])
    expect(timings.filter(({ value }) => !isZeroTime(value)).map(({ property, value, line }) => `${property}: ${value} (line ${line})`))
      .toEqual([])
  })
})
