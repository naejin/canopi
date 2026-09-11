import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import { splitFieldBounds } from '../app/canvas-pdf/split-sheets'
import type { PdfInput, PdfLabels, PdfLayoutCacheEntry, PdfSetup } from '../app/canvas-pdf/types'
const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([
  ['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')], ['strong', readFileSync('public/pdf-fonts/NotoSans-SemiBold.ttf')],
]), 'en')
const labels: PdfLabels = { notes: 'Notes', observations: 'Observations', keyAndNotes: 'Key and notes', overview: 'Overview', plants: 'Plants', actualSize: 'Actual size' }
const source = (count: number): PdfInput => ({ name: 'Garden', locale: 'en', commonNames: {}, canvas: {
  layers: [{ name: 'plants', visible: true, opacity: 1 }, { name: 'annotations', visible: true, opacity: .6 }],
  plants: Array.from({ length: count }, (_, i) => ({ id: String(i), canonicalName: `Species ${i % 117}`, speciesCode: `S${i % 117}`,
    position: { x: (i % 50) * .1, y: Math.floor(i / 50) * .1 }, color: '#123456', symbol: 'round', mark: [], pinnedName: false })),
  zones: [], measurements: [], annotations: [{ id: 'note', text: 'Keep this note', position: { x: 1, y: 1 }, fontSize: 14, rotation: 35 }],
} })
const setup: PdfSetup = { paper: 'A4', layers: ['plants', 'annotations'] }
it('does not create detail or note pages for an unreadable note in an overview-only export', () => {
  const base = source(0)
  const input = { ...base, canvas: { ...base.canvas, annotations: [{ ...base.canvas.annotations[0]!, text: 'A long field instruction that cannot fit in two overview lines. '.repeat(8) }] } }
  const plan = buildPdfPlan(input, setup, text(), labels)
  expect(plan.pages.map(p => p.kind)).toEqual(['overview'])
  expect(plan.pages[0]!.annotationIds).toEqual([])
  expect(plan.pages[0]!.continuationIds).toEqual([])
})
it.each([1, 2201])('keeps an overview-only export to one page even with %i plants and annotations', count => {
  const plan = buildPdfPlan(source(count), setup, text(), labels)
  expect(plan.pages.filter(p => p.kind === 'overview')).toHaveLength(1)
  expect(plan.pages).toHaveLength(1)
  const page = plan.pages[0]!
  expect(page.legend).toEqual([]); expect(page.identifiedPlants).toEqual([])
  expect(page.operations.some(op => op.kind === 'text' && /^N\d+$/.test(op.line.runs.map(r => r.text).join('')))).toBe(false)
  if (page.annotationIds?.includes('note')) expect(page.operations.find(op => op.kind === 'text' && op.line.runs.some(r => r.text === 'Keep this note')))
    .toMatchObject({ kind: 'text', rotation: 35, opacity: .6 })
})
it('reuses unchanged sheets with fresh glyph outlines and invalidates changed coverage and names', () => {
  const input = source(8), bounds = { x: -1, y: -1, width: 5, height: 5 }
  const choices = { ...setup, areas: [{ id: 'a', name: 'A', bounds }, { id: 'b', name: 'B', bounds }] }
  const cache: Record<string, PdfLayoutCacheEntry> = {}, reused: Record<string, PdfLayoutCacheEntry> = {}
  const original = buildPdfPlan(input, choices, text(), labels, { retain: (id, entry) => { cache[id] = entry } })
  expect(buildPdfPlan(input, choices, text(), labels, { cache })).toEqual(original)
  const changed = buildPdfPlan(input, { ...choices, views: { 'area:b': { zoom: 150 } } }, text(), labels,
    { cache, retain: (id, entry) => { reused[id] = entry } })
  expect(reused['area:a']!.pages).toBe(cache['area:a']!.pages)
  expect(reused['area:b']!.pages).not.toBe(cache['area:b']!.pages)
  expect(changed.pages.find(p => p.id === 'area:a')).toEqual(original.pages.find(p => p.id === 'area:a'))
  for (const page of changed.pages) for (const op of page.operations) if (op.kind === 'text') {
    for (const run of op.line.runs) for (const glyph of run.glyphs) expect(changed.outlines[glyph.key]).toBeDefined()
  }
  buildPdfPlan({ ...input, commonNames: { 'Species 0': 'New name' } }, choices, text(), labels,
    { cache, retain: (id, entry) => { reused[id] = entry } })
  expect(reused['area:a']!.pages).not.toBe(cache['area:a']!.pages)
})
it('prioritizes a selected sheet while retaining document order and complete destinations', () => {
  const choices = { ...setup, areas: ['a', 'b'].map(id => ({ id, name: id, bounds: { x: -1, y: -1, width: 5, height: 5 } })) }
  const processed: string[] = []
  const plan = buildPdfPlan(source(8), choices, text(), labels, { priority: 'area:b', retain: id => processed.push(id) })
  expect(processed).toEqual(['area:b', 'area:a'])
  expect(plan.pages.filter(p => p.kind === 'detail').map(p => p.id)).toEqual(['area:a', 'area:b'])
  const destinations = new Set(plan.pages.flatMap(p => [`page:${p.id}`, ...p.destinations?.map(d => d.id) ?? []]))
  for (const page of plan.pages) for (const link of page.links ?? []) expect(destinations.has(link.target)).toBe(true)
})
it('retains complete local species identity and explicit locations for unresolved codes', () => {
  const input = source(400)
  const plan = buildPdfPlan(input, { ...setup, layers: ['plants'], areas: [{ id: 'all', name: 'All', bounds: { x: -100, y: -100, width: 200, height: 200 } }] }, text(), labels)
  const page = plan.pages.find(p => p.kind === 'detail')!
  expect(page.legend).toHaveLength(117)
  expect(page.legend.reduce((n, entry) => n + entry.count!, 0)).toBe(400)
  expect(page.identifiedPlants!.some(group => group.bounds.width === 0)).toBe(true)
  const words = plan.pages.filter(p => p.kind === 'legend').flatMap(p => p.operations.flatMap(op => op.kind === 'text' ? op.line.runs.map(r => r.text) : [])).join(' ')
  for (const plant of input.canvas.plants) expect(words).toContain(plant.canonicalName)
  for (const group of plan.pages.find(p => p.kind === 'detail')!.identifiedPlants!.filter(g => !g.bounds.width)) expect(words).toContain(group.reference)
  expect(words).toMatch(/x -?\d+(?:\.\d+)? m · y/)
})
it('partitions all ground with bounded frames and handles coincident locations', () => {
  const bounds = { x: 0, y: 0, width: 5, height: 5 }, input = source(2201)
  const frames = splitFieldBounds(bounds, input.canvas.plants)
  expect(frames.length).toBeGreaterThan(2); expect(frames.length).toBeLessThanOrEqual(32)
  expect(frames.reduce((sum, f) => sum + f.width * f.height, 0)).toBe(25)
  for (const p of input.canvas.plants) expect(frames.some(f => p.position.x >= f.x && p.position.x <= f.x + f.width && p.position.y >= f.y && p.position.y <= f.y + f.height)).toBe(true)
  expect(splitFieldBounds(bounds, input.canvas.plants.map(p => ({ ...p, position: { x: 1, y: 1 } })))).toHaveLength(2)
})
