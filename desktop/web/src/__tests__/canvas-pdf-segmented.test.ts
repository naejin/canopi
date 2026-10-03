import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PDF_MAP_ORIENTATIONS, PDF_PLANT_COLORS } from '../app/canvas-pdf/types'

// jsdom does no layout, so the rule is read as text. Explicit grid tracks are never collapsed when
// empty: a two-option control under a three-column template stops short of the sheet's right edge.
describe('PDF segmented controls', () => {
  it('size their columns from their own option count, so every control spans the sheet', () => {
    expect(new Set([PDF_PLANT_COLORS.length, PDF_MAP_ORIENTATIONS.length]).size).toBeGreaterThan(1)
    const css = readFileSync('src/components/canvas-pdf/canvas-pdf.module.css', 'utf8')
    const group = /\.segmented \[role="radiogroup"\] \{(?<body>[^}]*)\}/.exec(css)?.groups?.body ?? ''
    expect(group).toContain('display: grid')
    expect(group).toContain('grid-auto-flow: column')
    expect(group).not.toContain('grid-template-columns')
  })
})
