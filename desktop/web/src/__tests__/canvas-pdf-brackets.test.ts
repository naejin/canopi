import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import type { PrintPlant } from '../canvas/print'
import { fieldBrackets } from '../app/canvas-pdf/field-brackets'
import { FieldSpace, separatedConnectors } from '../app/canvas-pdf/field-placement'
import { orthogonalRoute } from '../app/canvas-pdf/field-routing'
import { contains, distance, hits, overlaps } from '../app/canvas-pdf/field-geometry'
import { createPdfTextEngine, type PdfFontId } from '../app/canvas-pdf/text'

const fonts = new Map<PdfFontId, Uint8Array>([
  ['latin', readFileSync('public/pdf-fonts/NotoSans-Regular.ttf')], ['strong', readFileSync('public/pdf-fonts/NotoSans-SemiBold.ttf')],
])
const text = () => createPdfTextEngine(fonts, 'en')
function fixture(vertical = false) {
  const point = (x: number, y: number) => vertical ? { x: y, y: x } : { x, y }
  const space = new FieldSpace({ x: 8, y: 8, width: 280, height: 280 }, text())
  const plants = Array.from({ length: 36 }, (_, i) => {
    const position = point(44 + (i % 12) * 15, 127 + Math.floor(i / 12) * 3)
    const plant: PrintPlant = { id: String(i), canonicalName: `Plant ${i % 3}`, position, symbol: 'round', color: ['#427055', '#70812f', '#79409a'][i % 3]!, pinnedName: false, mark: [] }
    space.mark(plant.id, { x: position.x - .5, y: position.y - .5, width: 1, height: 1 })
    return { plant, point: position }
  })
  return { plants, space, frame: { ...point(36, 123), width: vertical ? 14 : 200, height: vertical ? 200 : 14 }, references: new Map([['Plant 0', '01'], ['Plant 1', '02'], ['Plant 2', '03']]) }
}

it.each([false, true])('identifies interleaved plants with complete, orthogonal brackets (vertical: %s)', vertical => {
  const { plants, space, frame, references } = fixture(vertical)
  const groups = fieldBrackets(plants, frame, space, references, 'field')
  expect(groups.length).toBeGreaterThan(0)
  expect(groups.flatMap(g => g.ids).sort()).toEqual(plants.map(p => p.plant.id).sort())
  for (const group of groups) {
    expect(group.labels).toHaveLength(2)
    expect(group.junctions).toHaveLength(group.ids.length)
    expect(new Set(group.ids.map(id => plants.find(p => p.plant.id === id)!.plant.canonicalName)).size).toBe(1)
    for (const connector of group.connectors) for (const s of connector.route) {
      expect(Math.abs(s.a.x - s.b.x) < 1e-8 || Math.abs(s.a.y - s.b.y) < 1e-8).toBe(true)
      expect(distance(s.a, s.b)).toBeGreaterThan(0)
      expect(contains(space.frame, s.a) && contains(space.frame, s.b)).toBe(true)
      expect(space.labels.some(label => hits(s, label.bounds))).toBe(false)
    }
  }
  for (const [i, label] of space.labels.entries()) expect(space.labels.slice(i + 1).some(other => overlaps(label.bounds, other.bounds))).toBe(false)
})

it('keeps authored appearances, pinned names and coincident placements out of incompatible groups', () => {
  const { plants, space, frame, references } = fixture()
  plants[0]!.plant = { ...plants[0]!.plant, pinnedName: true }
  plants[1]!.point = plants[2]!.point
  plants[3]!.plant = { ...plants[3]!.plant, color: '#ffffff' }
  const groups = fieldBrackets(plants, frame, space, references, 'field')
  expect(groups.length).toBeGreaterThan(0)
  for (const id of ['0', '1', '2', '3']) expect(groups.some(g => g.ids.includes(id))).toBe(false)
  for (const group of groups) expect(new Set(group.ids.map(id => plants.find(p => p.plant.id === id)!.plant.color)).size).toBe(1)
})

it('leaves no partial brackets or reserved labels when the paper cannot accommodate them', () => {
  const { plants, space, frame, references } = fixture()
  space.reserve({ x: 8, y: 8, width: 280, height: 112 })
  space.reserve({ x: 8, y: 140, width: 280, height: 148 })
  const before = [...space.segments]
  expect(fieldBrackets(plants, frame, space, references, 'field')).toEqual([])
  expect(space.labels).toEqual([])
  expect(space.segments).toEqual(before)
})

it('routes around printed ink and terminates when an anchor is enclosed', () => {
  const space = new FieldSpace({ x: 0, y: 0, width: 100, height: 100 }, text())
  const blocker = { x: 20, y: 10, width: 5, height: 10 }
  space.reserve(blocker)
  const route = orthogonalRoute(space, { x: 10, y: 15 }, { x: 40, y: 15 }, [])!
  expect(route.length).toBeGreaterThan(1)
  expect(route.some(s => hits(s, blocker))).toBe(false)
  space.reserve({ x: 8, y: 8, width: 4, height: 4 })
  expect(orthogonalRoute(space, { x: 10, y: 10 }, { x: 40, y: 40 }, [], { remaining: 20 })).toBeNull()
})

it('breaks a crossing rail stroke without erasing a membership junction', () => {
  const rail = { route: [{ a: { x: 0, y: 10 }, b: { x: 30, y: 10 } }], rail: true, group: 'A' }
  const member = { route: [{ a: { x: 10, y: 0 }, b: { x: 10, y: 10 } }], group: 'A' }
  const crossing = { route: [{ a: { x: 20, y: 0 }, b: { x: 20, y: 20 } }], group: 'B' }
  const strokes = separatedConnectors([rail, member, crossing])
  const railStrokes = strokes.filter(s => s.label === rail)
  expect(railStrokes).toHaveLength(2)
  expect(railStrokes[0]!.segment.b.x).toBeCloseTo(19.55)
  expect(railStrokes[1]!.segment.a.x).toBeCloseTo(20.45)
  expect(strokes.filter(s => s.label === member)).toHaveLength(1)
})

it('keeps pale species connectors visible without changing authored marks', () => {
  const { plants, space, frame, references } = fixture()
  for (const p of plants) p.plant = { ...p.plant, color: '#ffffff' }
  const before = structuredClone(plants)
  const groups = fieldBrackets(plants, frame, space, references, 'field')
  expect(groups.length).toBeGreaterThan(0)
  expect(groups.every(g => g.color !== '#ffffff' && g.connectors.every(c => c.color === g.color))).toBe(true)
  expect(plants).toEqual(before)
})
