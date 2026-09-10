import { describe, expect, it, vi } from 'vitest'
import { nearestPlantSpacing } from '../canvas/plant-spacing'
import { SceneStore } from '../canvas/runtime/scene/store'

function createStore() {
  const store = new SceneStore()
  store.updatePersisted((draft) => {
    draft.plants = [0, 3, 11].map((x, index) => ({
      kind: 'plant', id: String(index), locked: false,
      canonicalName: 'Malus domestica', commonName: null, color: null,
      stratum: null, canopySpreadM: null, position: { x, y: 7 },
      rotationDeg: null, scale: null, notes: null, plantedDate: null, quantity: null,
    }))
  })
  return store
}

describe('plant spacing across scene reads', () => {
  it('tracks position, addition, removal, and document replacement independently of metadata', () => {
    const store = createStore()
    const spacing = () => nearestPlantSpacing(store.persisted.plants, { x: 0, y: 7 })
    expect(spacing()).toBe(3)
    store.updatePersisted((draft) => { draft.plants[1]!.position.x = 5 })
    expect(spacing()).toBe(5)
    store.updatePersisted((draft) => {
      draft.plants.push({ ...draft.plants[0]!, id: 'new', position: { x: 1, y: 7 } })
    })
    expect(spacing()).toBe(1)
    store.updatePersisted((draft) => { draft.plants.pop() })
    expect(spacing()).toBe(5)
    store.updatePersisted((draft) => { draft.plants[0]!.color = '#ffffff' })
    expect(spacing()).toBe(5)
    store.hydrate(createStore().toCanopiFile())
    expect(spacing()).toBe(3)
  })

  it('owns cached coordinates and preserves defensive scene ownership', () => {
    const store = createStore()
    const snapshot = store.persisted
    expect(nearestPlantSpacing(snapshot.plants, { x: 1, y: 7 })).toBe(1)
    for (const plant of snapshot.plants) plant.position.x += 100
    snapshot.plants.pop()
    const fresh = store.persisted.plants
    expect(fresh.map((plant) => plant.position.x)).toEqual([0, 3, 11])
    expect(nearestPlantSpacing(fresh, { x: 1, y: 7 })).toBe(1)
  })

  it('preserves coincident centres, empty scenes, and placement previews', () => {
    expect(nearestPlantSpacing([], { x: 0, y: 0 })).toBe(Infinity)
    const plants = [0, 0, 4].map((x) => ({ position: { x, y: 0 } }))
    expect(nearestPlantSpacing(plants, { x: 0, y: 0 })).toBe(4)
    expect(nearestPlantSpacing(plants, { x: 1, y: 0 })).toBe(1)
    expect(nearestPlantSpacing([{ position: { x: 0, y: 0 } }], { x: 0, y: 0 })).toBe(Infinity)
  })

  it('does not rebuild the spatial tree for fresh read-only snapshots', () => {
    const store = createStore()
    const first = store.persisted.plants
    expect(nearestPlantSpacing(first, first[0]!.position)).toBe(3)
    // Sorting is the expensive spatial-tree construction, not snapshot cloning.
    const sort = vi.spyOn(Array.prototype, 'sort')
    try {
      store.setSelection([{ kind: 'plant', id: '0' }])
      store.setHoveredTarget({ kind: 'plant', id: '1' })
      for (let read = 0; read < 20; read++) {
        const plants = store.persisted.plants
        expect(plants).not.toBe(first)
        sort.mockClear()
        expect(nearestPlantSpacing(plants, plants[0]!.position)).toBe(3)
        expect(sort).not.toHaveBeenCalled()
      }
    } finally {
      sort.mockRestore()
    }
  })
})
