import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfLabels } from '../app/canvas-pdf/types'
const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
const labels: PdfLabels = { overview: 'Overview', plants: 'Plants on this page', actualSize: 'Print at actual size', page: 'Page' }
const mark = [{ d: 'M-1 -1 h2 v2 h-2 Z', fill: true, stroke: true, strokeWidth: .14 }]
function input(): PdfInput {
  return { name: 'Field garden', locale: 'en', commonNames: { 'Malus domestica': 'Apple' }, canvas: {
    layers: [{ name: 'plants', visible: true, opacity: 1 }], zones: [], annotations: [], measurements: [],
    plants: [
      { id: 'a', canonicalName: 'Malus domestica', position: { x: 0, y: 0 }, color: '#123456', symbol: 'square', mark, pinnedName: true },
      { id: 'b', canonicalName: 'Malus domestica', position: { x: 30, y: 12 }, color: '#654321', symbol: 'square', mark, pinnedName: false },
      { id: 'c', canonicalName: 'Rosmarinus officinalis var. angustifolius', position: { x: 12, y: 6 }, color: '#123456', symbol: 'square', mark, pinnedName: false },
    ],
  } }
}
describe('Canvas PDF page plan', () => {
  it('fits authored content on A4 with complete species identity, common-name fallback and every appearance', () => {
    const plan = buildPdfPlan(input(), { paper: 'A4', orientation: 'portrait', layers: ['plants'] }, text(), labels)
    expect(plan.blocked).toBeNull()
    expect(plan.pages).toHaveLength(1)
    const page = plan.pages[0]!
    expect(page.width).toBeCloseTo(595.27559, 4)
    expect(page.height).toBeCloseTo(841.88976, 4)
    expect(page.legend.map((entry) => entry.name)).toEqual(['Apple', 'Rosmarinus officinalis var. angustifolius'])
    expect(page.legend[0]!.appearances).toHaveLength(2)
    expect(page.ambiguousSpecies).toEqual(['Malus domestica', 'Rosmarinus officinalis var. angustifolius'])
    expect(page.ground.x).toBeLessThan(0)
    expect(page.ground.x + page.ground.width).toBeGreaterThan(30)
    expect(page.operations.filter((op) => op.kind === 'text').flatMap((op) => op.line.runs.map((run) => run.text))).toContain('Apple')
  })
})
