import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfSetup } from '../app/canvas-pdf/types'
const labels = { overview: 'Overview', plants: 'Plants', actualSize: 'Print at actual size', page: 'Page' }
const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
const empty: PdfInput = { name: 'Empty design', locale: 'en', commonNames: {}, canvas: { layers: [], plants: [], zones: [], annotations: [], measurements: [] } }
const setup: PdfSetup = { paper: 'A4', orientation: 'auto', layers: [] }
describe('Temporary Print Areas', () => {
  it('provides an unexportable blank overview for drawing and exports explicitly selected blank coverage', () => {
    const blank = buildPdfPlan(empty, setup, text(), labels)
    expect(blank.blocked).toBe('empty')
    expect(blank.pages).toHaveLength(1)
    const before = structuredClone(empty)
    const plan = buildPdfPlan(empty, { ...setup, areas: [{ kind: 'rectangle', id: 'one', name: 'Print area 1', bounds: { x: 1, y: 2, width: 5, height: 5 }, scale: 50 }] }, text(), labels)
    expect(plan.blocked).toBeNull()
    expect(plan.pages).toHaveLength(2)
    expect(plan.pages[1]!.pointsPerMeter).toBeCloseTo(56.6929133858, 8)
    expect(plan.pages[1]!.ground.x).toBeLessThanOrEqual(1)
    expect(plan.pages[1]!.ground.x + plan.pages[1]!.ground.width).toBeGreaterThanOrEqual(6)
    expect(empty).toEqual(before)
  })
  it('preserves independent scale overrides across mixed Zones and Print Areas', () => {
    const input = { ...empty, canvas: { ...empty.canvas, zones: [{ name: 'Bed', bounds: { x: 0, y: 0, width: 2, height: 2 }, path: 'M0 0 H2 V2 H0 Z', fill: null }] } }
    const options: PdfSetup = { ...setup, detailScale: 100, areas: [
      { kind: 'zone', name: 'Bed', scale: 20 },
      { kind: 'rectangle', id: 'field', name: 'Field', bounds: { x: 5, y: 5, width: 10, height: 10 } },
    ] }
    const first = buildPdfPlan(input, options, text(), labels)
    const changed = buildPdfPlan(input, { ...options, detailScale: 500 }, text(), labels)
    expect(first.pages.filter((page) => page.areaName === 'Bed').map((page) => page.pointsPerMeter))
      .toEqual(changed.pages.filter((page) => page.areaName === 'Bed').map((page) => page.pointsPerMeter))
    expect(changed.pages.filter((page) => page.areaName === 'Field').every((page) => Math.abs(page.pointsPerMeter - 5.6692913386) < 1e-8)).toBe(true)
    expect(changed.pages.filter((page) => page.areaName === 'Field').length).toBeGreaterThan(0)
  })
})
