import { describe, expect, it } from 'vitest'

import { queryRectTopLevel } from '../canvas/runtime/interaction/hit-testing'
import type { PlantPresentationContext } from '../canvas/runtime/plant-presentation'
import type { ScenePersistedState } from '../canvas/runtime/scene'

function createScene(): ScenePersistedState {
  return {
    plantSpeciesColors: {},
    layers: [{ kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 1 }],
    plants: [{
      kind: 'plant',
      locked: false,
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: 10, y: 20 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    }],
    zones: [],
    annotations: [],
    groups: [],
    guides: [],
  }
}

function getPlantContext(viewportScale: number): PlantPresentationContext {
  return {
    viewport: { x: 0, y: 0, scale: viewportScale },
    sizeMode: 'default',
    colorByAttr: null,
    speciesCache: new Map(),
  }
}

describe('scene hit testing', () => {
  it('uses the symbolic Placed Plant Visual Footprint for band selection bounds', () => {
    const scene = createScene()
    const targets = queryRectTopLevel(
      scene,
      { x: 10.34, y: 20, width: 0.01, height: 0.01 },
      10,
      new Map(),
      getPlantContext,
    )

    expect(targets).toEqual([{ kind: 'plant', id: 'plant-1' }])
  })
})
