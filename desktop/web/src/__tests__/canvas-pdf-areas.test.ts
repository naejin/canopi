import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfSetup } from '../app/canvas-pdf/types'
const labels = { overview: 'Overview', plants: 'Plants', actualSize: 'Print at actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' }
const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
const empty: PdfInput = { name: 'Empty design', locale: 'en', commonNames: {}, canvas: { layers: [], plants: [], zones: [], annotations: [], measurements: [] } }
const setup: PdfSetup = { paper: 'A4', layers: [] }
describe('Temporary Print Areas', () => {
  it('provides a fitted area picker including hidden Zones without changing the printed overview', () => {
    const input: PdfInput = { ...empty, canvas: { ...empty.canvas, zones: [{ name: 'Far bed', bounds: { x: 100, y: 200, width: 30, height: 10 }, path: 'M100 200 H130 V210 H100 Z', fill: null }] } }
    const plan = buildPdfPlan(input, { ...setup, views: { overview: { zoom: 200, offset: { x: -100, y: 0 } } } }, text(), labels)
    expect(plan.pickerPage!.ground.x).toBeLessThanOrEqual(100)
    expect(plan.pickerPage!.ground.x + plan.pickerPage!.ground.width).toBeGreaterThanOrEqual(130)
    expect(plan.pickerPage!.ground.y).toBeLessThanOrEqual(200)
    expect(plan.pickerPage!.ground.y + plan.pickerPage!.ground.height).toBeGreaterThanOrEqual(210)
    expect(plan.pages).toHaveLength(1)
    expect(plan.pages[0]!.ground.x).toBeLessThan(-100)
    expect(plan.blocked).toBe('empty')
  })
  it('moves only the printed coverage and identifies plants in the moved view', () => {
    const input: PdfInput = { ...empty, canvas: { ...empty.canvas, plants: [
      { id: 'a', canonicalName: 'Apple', position: { x: 5, y: 5 }, color: '#000000', symbol: 'round', mark: [], pinnedName: false },
      { id: 'b', canonicalName: 'Pear', position: { x: 25, y: 5 }, color: '#000000', symbol: 'round', mark: [], pinnedName: false },
    ] } }
    const options: PdfSetup = { ...setup, layers: ['plants'], areas: [{ kind: 'rectangle', id: 'one', name: 'Area', bounds: { x: 0, y: 0, width: 10, height: 10 } }] }
    const before = structuredClone(input)
    const fitted = buildPdfPlan(input, options, text(), labels).pages[1]!
    const moved = buildPdfPlan(input, { ...options, views: { 'area:one': { offset: { x: 20, y: 0 } } } }, text(), labels).pages[1]!
    expect(moved.ground.x).toBeCloseTo(fitted.ground.x + 20)
    expect(moved.pointsPerMeter).toBe(fitted.pointsPerMeter)
    expect(fitted.legend.map((entry) => entry.name)).toEqual(['Apple'])
    expect(moved.legend.map((entry) => entry.name)).toEqual(['Pear'])
    expect(input).toEqual(before)
  })
  it('fits an exact square in portrait without cropping or splitting it', () => {
    const plan = buildPdfPlan(empty, { ...setup, areas: [{ kind: 'rectangle', id: 'square', name: 'Square', bounds: { x: 10, y: 20, width: 100, height: 100 } }] }, text(), labels)
    const pages = plan.pages.filter((page) => page.kind === 'detail')
    expect(pages).toHaveLength(1)
    expect(pages[0]!.width).toBeLessThan(pages[0]!.height)
    expect(pages[0]!.ground.x).toBeCloseTo(10, 8)
    expect(pages[0]!.ground.width).toBeCloseTo(100, 8)
    expect(pages[0]!.ground.y).toBeLessThanOrEqual(20)
    expect(pages[0]!.ground.y + pages[0]!.ground.height).toBeGreaterThanOrEqual(120)
  })
  it('provides an unexportable blank overview for drawing and exports explicitly selected blank coverage', () => {
    const blank = buildPdfPlan(empty, setup, text(), labels)
    expect(blank.blocked).toBe('empty')
    expect(blank.pages).toHaveLength(1)
    const before = structuredClone(empty)
    const plan = buildPdfPlan(empty, { ...setup, areas: [{ kind: 'rectangle', id: 'one', name: 'Print area 1', bounds: { x: 1, y: 2, width: 5, height: 5 } }] }, text(), labels)
    expect(plan.blocked).toBeNull()
    expect(plan.pages).toHaveLength(2)
    expect(plan.pages[1]!.ground.width).toBeCloseTo(5, 8)
    expect(plan.pages[1]!.ground.x).toBeLessThanOrEqual(1)
    expect(plan.pages[1]!.ground.x + plan.pages[1]!.ground.width).toBeGreaterThanOrEqual(6)
    expect(empty).toEqual(before)
  })
  it('keeps custom zoom and orientation independent across Zones and Print Areas', () => {
    const input = { ...empty, canvas: { ...empty.canvas, zones: [{ name: 'Bed', bounds: { x: 0, y: 0, width: 2, height: 2 }, path: 'M0 0 H2 V2 H0 Z', fill: null }] } }
    const options: PdfSetup = { ...setup, views: { 'zone:Bed': { zoom: 80, orientation: 'landscape' } }, areas: [
      { kind: 'zone', name: 'Bed' },
      { kind: 'rectangle', id: 'field', name: 'Field', bounds: { x: 5, y: 5, width: 10, height: 10 } },
    ] }
    const before = structuredClone(input)
    const first = buildPdfPlan(input, options, text(), labels)
    const changed = buildPdfPlan(input, { ...options, views: { ...options.views, 'area:field': { zoom: 137.5, orientation: 'portrait' } } }, text(), labels)
    expect(first.pages.find((page) => page.areaName === 'Bed')).toMatchObject({ width: 841.8897637795277 })
    expect(first.pages.find((page) => page.areaName === 'Bed')!.ground).toEqual(changed.pages.find((page) => page.areaName === 'Bed')!.ground)
    const field = changed.pages.find((page) => page.areaName === 'Field')!
    expect(field.ground.width).toBeCloseTo(7.2727272727, 8)
    expect(field.ground.x + field.ground.width / 2).toBeCloseTo(10, 8)
    expect(changed.pages).toHaveLength(3)
    expect(input).toEqual(before)
  })
  it.each(['A4', 'Letter'] as const)('fits wide, tall, and tiny areas on %s with the closest automatic orientation', (paper) => {
    for (const [width, height, landscape] of [[100, 20, true], [10, 50, false], [.002, .0004, true]] as const) {
      const area = { kind: 'rectangle' as const, id: 'one', name: 'Area', bounds: { x: -40, y: 20, width, height } }
      const plan = buildPdfPlan(empty, { ...setup, paper, areas: [area] }, text(), labels)
      const page = plan.pages[1]!
      expect(plan.pages).toHaveLength(2)
      expect(page.width > page.height).toBe(landscape)
      expect(page.ground.x).toBeLessThanOrEqual(-40)
      expect(page.ground.y).toBeLessThanOrEqual(20)
      expect(page.ground.x + page.ground.width).toBeGreaterThanOrEqual(-40 + width)
      expect(page.ground.y + page.ground.height).toBeGreaterThanOrEqual(20 + height)
    }
  })
  it.each([0, -1, NaN, Infinity, 1001])('rejects invalid page zoom %s before drawing', (zoom) => {
    expect(() => buildPdfPlan(empty, { ...setup, views: { 'area:one': { zoom } }, areas: [{ kind: 'rectangle', id: 'one', name: 'Area', bounds: { x: 0, y: 0, width: 1, height: 1 } }] }, text(), labels)).toThrow('invalid-page-view')
  })
})
