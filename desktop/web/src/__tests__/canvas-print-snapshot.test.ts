import { describe, expect, it } from 'vitest'
import { buildCanvasPrintSnapshot } from '../canvas/runtime/print-snapshot'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'

describe('Canvas print capture', () => {
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
