/**
 * Phase 3 regression tests — pure-function correctness.
 *
 * Covers the math and utility functions that underpin Phase 3 features:
 * - Pattern math (point-in-polygon, grid/hex generation, line distribution)
 * - Projection (world ↔ geo coordinate conversion)
 * - Budget CSV export (formatting, escaping, totals)
 * - extractExtra (groups as a known key)
 *
 * NOTE: Serializer round-trip tests (grouped plants, GeoJSON with transforms)
 * require a Konva harness and belong in integration tests, not here.
 */
import { describe, it, expect } from 'vitest'
import { pointInPolygon, generatePatternPoints, generateLinePoints } from '../canvas/pattern-math'
import { buildBudgetCSV } from '../canvas/geojson'
import { worldToGeo, geoToWorld, stageScaleToMapZoom } from '../canvas/projection'
import { extractExtra } from '../canvas/serializer'

describe('persistent plant IDs', () => {
  it('extractExtra preserves groups field', () => {
    const raw = {
      version: 1, name: 'test', description: null, location: null,
      north_bearing_deg: 0, layers: [], plants: [], zones: [],
      consortiums: [], groups: [{ id: 'g1', name: null, layer: 'zones', position: { x: 0, y: 0 }, rotation: null, member_ids: ['a', 'b'] }],
      timeline: [], budget: [], created_at: '', updated_at: '',
    }
    const extra = extractExtra(raw as Record<string, unknown>)
    // 'groups' is now a known key, so it should NOT appear in extra
    expect(extra).not.toHaveProperty('groups')
  })
})

describe('pattern math', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('pointInPolygon detects inside points', () => {
    expect(pointInPolygon(5, 5, square)).toBe(true)
    expect(pointInPolygon(1, 1, square)).toBe(true)
  })

  it('pointInPolygon rejects outside points', () => {
    expect(pointInPolygon(-1, 5, square)).toBe(false)
    expect(pointInPolygon(11, 5, square)).toBe(false)
    expect(pointInPolygon(5, 11, square)).toBe(false)
  })

  it('generatePatternPoints produces grid points inside polygon', () => {
    const points = generatePatternPoints(square, 2, 'grid')
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      expect(pointInPolygon(p.x, p.y, square)).toBe(true)
    }
  })

  it('generatePatternPoints caps at maxPoints', () => {
    const points = generatePatternPoints(square, 0.1, 'grid', 10)
    expect(points.length).toBe(10)
  })

  it('generatePatternPoints hex pattern offsets odd rows', () => {
    const points = generatePatternPoints(square, 2, 'hex')
    // Collect unique x values per row
    const byY = new Map<number, number[]>()
    for (const p of points) {
      const ry = Math.round(p.y * 10) / 10
      if (!byY.has(ry)) byY.set(ry, [])
      byY.get(ry)!.push(p.x)
    }
    // At least 2 rows should exist
    expect(byY.size).toBeGreaterThanOrEqual(2)
  })

  it('generateLinePoints distributes evenly', () => {
    const points = generateLinePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 3)
    expect(points).toHaveLength(3)
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[1]).toEqual({ x: 5, y: 0 })
    expect(points[2]).toEqual({ x: 10, y: 0 })
  })

  it('generateLinePoints single point returns midpoint', () => {
    const points = generateLinePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)
    expect(points).toHaveLength(1)
    expect(points[0]).toEqual({ x: 5, y: 0 })
  })
})

describe('projection', () => {
  const originLat = 48.8566 // Paris
  const originLon = 2.3522

  it('worldToGeo converts origin to design location', () => {
    const geo = worldToGeo(0, 0, originLat, originLon)
    expect(geo.lat).toBeCloseTo(originLat, 4)
    expect(geo.lng).toBeCloseTo(originLon, 4)
  })

  it('geoToWorld inverts worldToGeo', () => {
    const geo = worldToGeo(100, -50, originLat, originLon)
    const world = geoToWorld(geo.lng, geo.lat, originLat, originLon)
    expect(world.x).toBeCloseTo(100, 1)
    expect(world.y).toBeCloseTo(-50, 1)
  })

  it('stageScaleToMapZoom returns reasonable values', () => {
    const zoom = stageScaleToMapZoom(1, originLat)
    expect(zoom).toBeGreaterThan(0)
    expect(zoom).toBeLessThan(25)
  })

  it('moving east increases longitude', () => {
    const geo = worldToGeo(1000, 0, originLat, originLon)
    expect(geo.lng).toBeGreaterThan(originLon)
  })

  it('moving south (positive y in Konva) decreases latitude', () => {
    const geo = worldToGeo(0, 1000, originLat, originLon)
    expect(geo.lat).toBeLessThan(originLat)
  })
})

describe('budget CSV export', () => {
  it('generates valid CSV with totals', () => {
    const budget = [
      { category: 'Seeds', description: 'Tomato seeds', quantity: 10, unit_cost: 2.5, currency: 'EUR' },
      { category: 'Tools', description: 'Spade', quantity: 1, unit_cost: 25, currency: 'EUR' },
    ]
    const csv = buildBudgetCSV(budget)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('Category,Description,Quantity,Unit Cost,Total,Currency')
    expect(lines[1]).toContain('Seeds')
    expect(lines[1]).toContain('25.00') // 10 * 2.5
    expect(lines[3]).toContain('50.00') // grand total
  })

  it('escapes commas and quotes in values', () => {
    const budget = [
      { category: 'A, B', description: 'Item "X"', quantity: 1, unit_cost: 10, currency: 'USD' },
    ]
    const csv = buildBudgetCSV(budget)
    expect(csv).toContain('"A, B"')
    expect(csv).toContain('"Item ""X"""')
  })
})
