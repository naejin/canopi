/**
 * Phase 3 regression tests — pure-function correctness.
 *
 * Covers the math and utility functions that underpin Phase 3 features:
 * - Projection (world ↔ geo coordinate conversion)
 * - extractExtra (groups as a known key)
 */
import { describe, it, expect } from 'vitest'
import { worldToGeo, geoToWorld, stageScaleToMapZoom } from '../canvas/projection'
import { extractDocumentExtra as extractExtra } from '../app/contracts/document'

describe('extractExtra groups key', () => {
  it('extractExtra preserves groups field', () => {
    const raw = {
      version: 1, name: 'test', description: null, location: null,
      north_bearing_deg: 0, plant_species_colors: {}, layers: [], plants: [], zones: [],
      annotations: [],
      groups: [{ id: 'g1', name: null, layer: 'zones', position: { x: 0, y: 0 }, rotation: null, member_ids: ['a', 'b'] }],
      consortiums: [], timeline: [], budget: [], created_at: '', updated_at: '', extra: {},
    }
    const extra = extractExtra(raw as Record<string, unknown>)
    // 'groups' is now a known key, so it should NOT appear in extra
    expect(extra).not.toHaveProperty('groups')
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

  it('moving south (positive y in canvas) decreases latitude', () => {
    const geo = worldToGeo(0, 1000, originLat, originLon)
    expect(geo.lat).toBeLessThan(originLat)
  })
})
