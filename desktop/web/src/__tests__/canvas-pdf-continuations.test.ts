import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfLabels, PdfSetup } from '../app/canvas-pdf/types'
const labels: PdfLabels = { overview: 'Overview', plants: 'Plants', actualSize: 'Print at actual size', page: 'Page', continued: 'Continued', legendFor: 'Plant list for page' }
const engine = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
const setup: PdfSetup = { paper: 'A4', orientation: 'portrait', layers: ['plants'] }
function garden(count = 90): PdfInput {
  return { name: 'Garden', locale: 'en', commonNames: {}, canvas: {
    layers: [{ name: 'plants', visible: true, opacity: .7 }], zones: [], annotations: [], measurements: [],
    plants: Array.from({ length: count }, (_, i) => ({ id: String(i), canonicalName: `Species ${String(i).padStart(3, '0')}`, position: { x: i % 10, y: Math.floor(i / 10) },
      color: '#234567', symbol: 'square', mark: [{ d: 'M-1 -1 H1 V1 H-1 Z', fill: true, stroke: false, strokeWidth: 0 }], pinnedName: false })),
  } }
}
it('requires explicit continuations and prints the entire source legend with linked pages', () => {
  const input = garden()
  const blocked = buildPdfPlan(input, setup, engine(), labels)
  expect(blocked.blocked).toBe('legend-overflow')
  expect(blocked.pages).toHaveLength(1)
  const plan = buildPdfPlan(input, { ...setup, continuations: true }, engine(), labels)
  expect(plan.blocked).toBeNull()
  expect(plan.pages.length).toBeGreaterThan(1)
  expect(plan.hasLegendOverflow).toBe(true)
  expect(plan.pages[0]!.legend).toHaveLength(90)
  expect(plan.pages[0]!.ambiguousSpecies).toHaveLength(90)
  const rendered = plan.pages.flatMap((page) => page.operations.filter((op) => op.kind === 'text').flatMap((op) => op.line.runs.map((run) => run.text)))
  for (const plant of input.canvas.plants) expect(rendered).toContain(plant.canonicalName)
  expect(rendered).toContain('Plant list for page 1')
  for (const page of plan.pages.slice(1)) {
    expect(page.kind).toBe('legend')
    expect(page.sourceId).toBe('overview')
  }
})

it('numbers adjoining sheets after inserting each source legend and counts continuations for automatic orientation', () => {
  const input = garden(60)
  const canvas = { ...input.canvas, zones: [{ name: 'Long bed', path: 'M0 0 H35 V5 H0 Z', fill: null, bounds: { x: 0, y: 0, width: 35, height: 5 } }],
    plants: input.canvas.plants.map((plant, i) => ({ ...plant, position: { x: i < 30 ? 1 : 34, y: 2 } })) }
  const detail: PdfSetup = { ...setup, continuations: true, areas: [{ kind: 'zone', name: 'Long bed' }], detailScale: 100 }
  const landscape = buildPdfPlan({ ...input, canvas }, { ...detail, orientation: 'landscape' }, engine(), labels)
  expect(landscape.pages.map((page) => page.kind)).toEqual(['overview', 'detail', 'legend', 'detail', 'legend'])
  expect(landscape.pages[1]!.neighbors).toEqual({ right: 4 })
  expect(landscape.pages[3]!.neighbors).toEqual({ left: 2 })
  expect(landscape.pages[2]!.operations.some((op) => op.kind === 'text' && op.line.runs.some((run) => run.text === 'Plant list for page 2'))).toBe(true)
  expect(landscape.pages[4]!.operations.some((op) => op.kind === 'text' && op.line.runs.some((run) => run.text === 'Plant list for page 4'))).toBe(true)
  const automatic = buildPdfPlan({ ...input, canvas }, { ...detail, orientation: 'auto' }, engine(), labels)
  expect(automatic.pages).toHaveLength(4)
  expect(automatic.pages.slice(1).every((page) => page.kind === 'detail' && page.width < page.height)).toBe(true)
})

it('preserves duplicate local names, mixed scripts and every appearance across even an oversized entry', () => {
  const base = garden(4)
  const longName = Array.from({ length: 450 }, () => '名 garden repeated').join(' ')
  const plants = [base.canvas.plants[0]!, { ...base.canvas.plants[1]!, canonicalName: base.canvas.plants[0]!.canonicalName, color: '#987654' }, ...base.canvas.plants.slice(2)]
  const input = { ...base, commonNames: { 'Species 000': longName, 'Species 002': 'Same name', 'Species 003': 'Same name' }, canvas: { ...base.canvas, plants } }
  const text = createPdfTextEngine(new Map<PdfFontId, Uint8Array>([
    ['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')], ['sc', readFileSync('public/pdf-fonts/NotoSansCJKsc-Regular.otf')],
  ]), 'en')
  const plan = buildPdfPlan(input, { ...setup, continuations: true }, text, labels)
  expect(plan.blocked).toBeNull()
  expect(plan.pages.length).toBeGreaterThan(2)
  const source = plan.pages[0]!
  expect(source.legend.filter((entry) => entry.name === 'Same name')).toHaveLength(2)
  expect(source.legend.find((entry) => entry.canonicalName === 'Species 000')!.appearances).toHaveLength(2)
  const operations = plan.pages.flatMap((page) => page.operations)
  const content = plan.pages.slice(1).flatMap((page) => page.operations.filter((op) => op.kind === 'text' && op.y >= page.frame.y && op.y <= page.frame.y + page.frame.height)
    .flatMap((op) => op.kind === 'text' ? op.line.runs.map((run) => run.text) : [])).filter((value) => value !== 'Continued').join(' ').replace(/\s/g, '')
  expect(content).toContain(longName.replace(/\s/g, ''))
  expect(operations.filter((op) => op.kind === 'text' && op.size === 10).length).toBeGreaterThan(100)
  const samples = plan.pages.slice(1).flatMap((page) => page.operations.filter((op) => op.kind === 'path'))
  expect(samples.some((op) => op.fill === '#987654' && op.opacity === .7)).toBe(true)
})
