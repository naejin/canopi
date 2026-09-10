import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { drawMark } from '../app/canvas-pdf/page-drawing'
import { buildPdfPlan } from '../app/canvas-pdf/layout'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'
import type { PdfInput, PdfLabels, PdfPage, PdfOperation } from '../app/canvas-pdf/types'

const text = () => createPdfTextEngine(new Map<PdfFontId, Uint8Array>([['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')]]), 'en')
const labels: PdfLabels = { overview: 'Overview', plants: 'Plants', actualSize: 'Actual size', page: 'Page', continued: 'Continued', legendFor: 'Legend for' }
const mark = [{ d: 'M-1 -1 h2 v2 h-2 Z', fill: true, stroke: true, strokeWidth: .14 }]
const words = (page: PdfPage) => page.operations.flatMap(op => op.kind === 'text' ? op.line.runs.map(run => run.text) : [])
function canvasWords(page: PdfPage): string[] {
  let clipped = false
  return page.operations.flatMap(op => {
    if (op.kind === 'clip') clipped = true
    if (op.kind === 'unclip') clipped = false
    return clipped && op.kind === 'text' ? op.line.runs.map(run => run.text) : []
  })
}
function input(): PdfInput {
  return { name: 'Garden', locale: 'en', commonNames: {}, canvas: {
    layers: ['plants', 'annotations', 'measurement-guides'].map(name => ({ name, visible: true, opacity: 1 })),
    plants: [0, .4, 40].map((x, i) => ({ id: String(i), canonicalName: 'Mentha spicata', position: { x, y: 0 },
      color: '#123456', symbol: 'rosette', mark, pinnedName: false })),
    annotations: [], zones: [], measurements: [],
  } }
}

it('separates nearby plant marks on paper while preserving their authored appearance', () => {
  const source = input(), before = structuredClone(source)
  const page = buildPdfPlan(source, { paper: 'A4', layers: ['plants'] }, text(), labels).pages[0]!
  const marks = page.operations.filter(op => op.kind === 'path' && op.d === mark[0]!.d)
  const first = marks[0]!, second = marks[1]!
  expect(first.kind).toBe('path'); expect(second.kind).toBe('path')
  if (first.kind !== 'path' || second.kind !== 'path') throw new Error('Missing plant marks')
  expect(first.matrix[0] + second.matrix[0]).toBeLessThan(second.matrix[4] - first.matrix[4])
  expect(first.fill).toBe('#123456')
  expect(first.stroke).toBe('#123456')
  expect(source).toEqual(before)
})

it('moves complete readable notes from the navigation overview to their detail page', () => {
  const source = input()
  const plan = buildPdfPlan({ ...source, canvas: { ...source.canvas, annotations: [
    { id: 'care', position: { x: 2, y: 2 }, text: 'Water weekly', fontSize: 14, rotation: 0 },
  ] } }, { paper: 'A4', layers: ['plants', 'annotations'], areas: [
    { id: 'care', name: 'Care area', bounds: { x: 0, y: 0, width: 6, height: 6 } },
  ] }, text(), labels)
  expect(words(plan.pages[0]!)).not.toContain('Water weekly')
  expect(words(plan.pages.find(page => page.kind === 'detail')!)).toContain('Water weekly')
  expect(plan.blocked).toBeNull()
})

it('requires explicit retention for crowded text without a readable detail home', () => {
  const source = input()
  const canvas = { ...source.canvas, annotations: ['First note', 'Second note'].map((value, i) => ({
    id: String(i), text: value, position: { x: 2, y: 2 }, fontSize: 14, rotation: 0,
  })) }
  const setup = { paper: 'A4' as const, layers: ['plants', 'annotations'] }
  const plan = buildPdfPlan({ ...source, canvas }, setup, text(), labels)
  expect(plan.blocked).toBe('text-needs-detail')
  expect(plan.textIssues).toHaveLength(2)
  expect(words(plan.pages[0]!)).toContain('First note')
  expect(words(plan.pages[0]!)).toContain('Second note')
  const retained = buildPdfPlan({ ...source, canvas }, { ...setup, retainedTextKeys: plan.textIssues!.map(item => item.key) }, text(), labels)
  expect(retained.blocked).toBeNull()
  expect(words(retained.pages[0]!)).toContain('First note')
  expect(words(retained.pages[0]!)).toContain('Second note')
})

it('prints every tiny symbol as a solid position and selects detail at readable sizes', () => {
  const plant = { ...input().canvas.plants[0]!, smallMark: [{ ...mark[0]!, d: 'compact' }] }
  for (const symbol of ['round', 'canopy', 'fern', 'rosette']) {
    const operations: PdfOperation[] = []
    drawMark({ ...plant, symbol }, 10, 20, 1, .6, operations)
    expect(operations).toEqual([{ kind: 'path', d: 'M1 0 A1 1 0 1 0 -1 0 A1 1 0 1 0 1 0 Z',
      matrix: [1, 0, 0, 1, 10, 20], fill: '#123456', stroke: null, width: 0, opacity: .6 }])
  }
  for (const [radius, expected] of [[3, 'compact'], [6, mark[0]!.d]] as const) {
    const operations: PdfOperation[] = []
    drawMark(plant, 10, 20, radius, 1, operations)
    expect(operations[0]).toMatchObject({ kind: 'path', d: expected, fill: '#123456' })
  }
})

it.each([
  { position: { x: 2.98, y: 2.5 }, rotation: 0 },
  { position: { x: 2.5, y: 1.65 }, rotation: -90 },
])('does not defer text clipped by a detail frame: $rotation degrees', note => {
  const source = input()
  const plan = buildPdfPlan({ ...source, canvas: { ...source.canvas, annotations: [
    { id: 'care', text: 'Keep this complete note', fontSize: 14, ...note },
  ] } }, { paper: 'A4', layers: ['plants', 'annotations'], areas: [
    { id: 'edge', name: 'Edge', bounds: { x: 2, y: 2, width: 1, height: 1 } },
  ] }, text(), labels)
  expect(words(plan.pages[0]!)).toContain('Keep this complete note')
  expect(plan.pages.find(page => page.kind === 'detail')!.readableTextKeys).toEqual([])
})

it('rechecks text after its readable detail page is removed or cropped', () => {
  const source = input()
  const canvas = { ...source.canvas, annotations: ['Water weekly', 'Protect seedlings'].map((value, i) => ({
    id: String(i), text: value, position: { x: 1.5 + i * 1.5, y: 2 }, fontSize: 14, rotation: 0,
  })) }
  const area = { id: 'care', name: 'Care', bounds: { x: 0, y: 0, width: 6, height: 6 } }
  const setup = { paper: 'A4' as const, layers: ['plants', 'annotations'], areas: [area] }
  const complete = buildPdfPlan({ ...source, canvas }, setup, text(), labels)
  expect(complete.blocked).toBeNull()
  expect(words(complete.pages[0]!)).not.toContain('Water weekly')
  for (const changed of [{ ...setup, areas: [] }, { ...setup, views: { 'area:care': { offset: { x: 20, y: 20 } } } }]) {
    const plan = buildPdfPlan({ ...source, canvas }, changed, text(), labels)
    expect(plan.blocked).toBe('text-needs-detail')
    expect(words(plan.pages[0]!)).toContain('Water weekly')
    expect(words(plan.pages[0]!)).toContain('Protect seedlings')
  }
})

it('does not carry retention consent over changed text or authored placement', () => {
  const source = input()
  const annotations = ['First note', 'Second note'].map((value, i) => ({ id: String(i), text: value, position: { x: 2, y: 2 }, fontSize: 14, rotation: 0 }))
  const canvas = { ...source.canvas, annotations }, setup = { paper: 'A4' as const, layers: ['plants', 'annotations'] }
  const original = buildPdfPlan({ ...source, canvas }, setup, text(), labels)
  const retainedTextKeys = original.textIssues!.map(item => item.key)
  for (const edit of [{ text: 'Changed note' }, { position: { x: 2.01, y: 2 } }]) {
    const next = buildPdfPlan({ ...source, canvas: { ...canvas, annotations: [annotations[0]!, { ...annotations[1]!, ...edit }] } },
      { ...setup, retainedTextKeys }, text(), labels)
    expect(next.blocked).toBe('text-needs-detail')
    expect(next.textIssues).toHaveLength(1)
  }
  expect(buildPdfPlan({ ...source, canvas }, { ...setup, layers: ['plants'] }, text(), labels).blocked).toBeNull()
})

it('preserves pinned names and distances on a readable detail sheet', () => {
  const source = input()
  const canvas = { ...source.canvas, plants: source.canvas.plants.map((plant, i) => i === 0
    ? { ...plant, pinnedName: true, position: { x: 2, y: 2 } } : plant),
    measurements: [{ id: 'spacing', start: { x: 1, y: 4 }, end: { x: 3, y: 4 } }] }
  const plan = buildPdfPlan({ ...source, canvas }, { paper: 'A4', layers: ['plants', 'measurement-guides'], areas: [
    { id: 'care', name: 'Care', bounds: { x: 0, y: 0, width: 6, height: 6 } },
  ] }, text(), labels)
  const detail = plan.pages.find(page => page.kind === 'detail')!
  expect(canvasWords(detail)).toContain('Mentha spicata')
  expect(canvasWords(detail)).toContain('2 m')
  expect(canvasWords(plan.pages[0]!)).not.toContain('Mentha spicata')
  expect(canvasWords(plan.pages[0]!)).not.toContain('2 m')
  expect(plan.blocked).toBeNull()
})
