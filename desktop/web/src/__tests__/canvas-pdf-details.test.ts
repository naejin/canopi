import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfLabels, PdfSetup } from '../app/canvas-pdf/types'
const labels: PdfLabels = { overview: 'Overview', plants: 'Plants', actualSize: 'Print at actual size', page: 'Page' }
const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
function garden(): PdfInput {
  return { name: 'Garden', locale: 'en', commonNames: {}, canvas: {
    layers: ['plants', 'zones'].map((name) => ({ name, visible: true, opacity: 1 })),
    zones: [{ name: 'Orchard', bounds: { x: 0, y: 0, width: 30, height: 20 }, path: 'M0 0 H30 V20 H0 Z', fill: null }],
    plants: [[8.5, 'Overlap'], [31, 'Nearby'], [200, 'Distant']].map(([x, name]) => ({ id: String(name), canonicalName: String(name), position: { x: Number(x), y: 12 },
      color: '#000000', symbol: 'square', mark: [{ d: 'M-1 -1 H1 V1 H-1 Z', fill: true, stroke: false, strokeWidth: 0 }], pinnedName: false })),
    annotations: [], measurements: [],
  } }
}
const setup: PdfSetup = { paper: 'A4', orientation: 'auto', layers: ['plants', 'zones'], areas: [{ kind: 'zone', name: 'Orchard' }], detailScale: 100 }
describe('Scaled Zone detail pages', () => {
  it('chooses three portrait sheets with overlap and complete nearby species legends', () => {
    const plan = buildPdfPlan(garden(), setup, text(), labels)
    expect(plan.blocked).toBeNull()
    expect(plan.pages).toHaveLength(4)
    const [overview, first, second, third] = plan.pages
    expect(overview!.legend).toEqual([])
    expect(first!.width).toBeCloseTo(595.27559, 4)
    expect(first!.ground.width).toBeCloseTo(14.3, 8)
    expect(first!.ground.height).toBeCloseTo(25.8, 8)
    expect(first!.ground.x + first!.ground.width - second!.ground.x).toBeCloseTo(1, 8)
    expect(first!.legend.map((entry) => entry.name)).toEqual(['Overlap'])
    expect(second!.legend.map((entry) => entry.name)).toEqual(['Overlap'])
    expect(third!.legend.map((entry) => entry.name)).toEqual(['Nearby'])
    expect(first!.neighbors).toEqual({ right: 3 })
    expect(second!.neighbors).toEqual({ left: 2, right: 4 })
    expect(third!.neighbors).toEqual({ left: 3 })
    for (const page of plan.pages.slice(1)) {
      expect(overview!.ground.x).toBeLessThan(page.ground.x)
      expect(overview!.ground.y).toBeLessThan(page.ground.y)
      expect(overview!.ground.x + overview!.ground.width).toBeGreaterThan(page.ground.x + page.ground.width)
      expect(overview!.ground.y + overview!.ground.height).toBeGreaterThan(page.ground.y + page.ground.height)
    }
  })
  it.each([[20, 141.7322834646], [50, 56.6929133858], [100, 28.3464566929], [200, 14.1732283465], [500, 5.6692913386], [1000, 2.8346456693]] as const)('preserves the physical 1:%s scale on Letter landscape', (detailScale, pointsPerMeter) => {
    const plan = buildPdfPlan(garden(), { ...setup, paper: 'Letter', orientation: 'landscape', detailScale }, text(), labels)
    for (const page of plan.pages.slice(1)) {
      expect(page.width).toBe(792); expect(page.height).toBe(612)
      expect(page.pointsPerMeter).toBeCloseTo(pointsPerMeter, 8)
      expect(page.ground.width * page.pointsPerMeter).toBeCloseTo(page.frame.width, 8)
      expect(page.ground.height * page.pointsPerMeter).toBeCloseTo(page.frame.height, 8)
    }
    expect(plan.pages.length).toBeGreaterThan(1)
  })
})
