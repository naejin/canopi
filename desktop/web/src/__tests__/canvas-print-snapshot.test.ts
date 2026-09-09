import { describe, expect, it } from 'vitest'
import { buildCanvasPrintSnapshot } from '../canvas/runtime/print-snapshot'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'

describe('Canvas print capture', () => {
  it('captures rotated rectangular and elliptical Zones and open lines with their true ground bounds', () => {
    const scene = createDefaultScenePersistedState()
    const common = { kind: 'zone' as const, locked: false, fillColor: null, notes: null }
    scene.zones.push(
      { ...common, name: 'Bed', zoneType: 'rect', rotationDeg: 90, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 4 }, { x: 0, y: 4 }] },
      { ...common, name: 'Pond', zoneType: 'ellipse', rotationDeg: 90, points: [{ x: 10, y: 20 }, { x: 4, y: 2 }] },
      { ...common, name: 'Path', zoneType: 'line', rotationDeg: 0, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    )
    const result = buildCanvasPrintSnapshot(scene, { viewport: { x: 0, y: 0, scale: 1 }, speciesCache: new Map() })
    expect(result.zones[0]!.bounds).toEqual({ x: -1, y: expect.closeTo(1, 12), width: 4, height: 2 })
    expect(result.zones[0]!.path.match(/L/g)).toHaveLength(3)
    expect(result.zones[1]!.bounds).toEqual({ x: 8, y: 16, width: 4, height: 8 })
    expect(result.zones[1]!.path.match(/C/g)).toHaveLength(4)
    expect(result.zones[2]!.path).toBe('M0 0 L5 5')
  })
  it('preserves authored appearance and pinning independently of screen zoom and selection', () => {
    const scene = createDefaultScenePersistedState()
    scene.plantSpeciesSymbols['Malus domestica'] = 'tree'
    scene.plants.push({ kind: 'plant', id: 'apple', canonicalName: 'Malus domestica', commonName: 'Apple',
      color: '#123456', pinnedName: true, locked: true, stratum: null, canopySpreadM: null,
      position: { x: 12, y: -4 }, rotationDeg: 90, scale: null, notes: null, plantedDate: null, quantity: 1 })
    const before = structuredClone(scene)
    const result = buildCanvasPrintSnapshot(scene, { viewport: { x: 500, y: 700, scale: 0.001 }, speciesCache: new Map() })
    expect(result.plants).toEqual([expect.objectContaining({ id: 'apple', canonicalName: 'Malus domestica',
      position: { x: 12, y: -4 }, color: '#123456', symbol: 'tree', pinnedName: true })])
    expect(result.plants[0]!.mark.length).toBeGreaterThan(0)
    expect(scene).toEqual(before)
    expect(result.plants[0]!.position).not.toBe(scene.plants[0]!.position)
  })
})
