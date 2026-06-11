import { describe, expect, it } from 'vitest'

import { hitTestTopLevel, hitTestVisibleTopLevel, queryRectTopLevel } from '../canvas/runtime/interaction/hit-testing'
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

  it('detects visible locked-Layer targets for hover without making them editable', () => {
    const scene = createScene()
    scene.layers = [{ kind: 'layer', name: 'plants', visible: true, locked: true, opacity: 1 }]

    expect(hitTestTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toBeNull()
    expect(hitTestVisibleTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toEqual({ kind: 'plant', id: 'plant-1' })
  })

  it('hides hidden-Layer targets from editable and hover hit testing', () => {
    const scene = createScene()
    scene.layers = [{ kind: 'layer', name: 'plants', visible: false, locked: false, opacity: 1 }]

    expect(hitTestTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toBeNull()
    expect(hitTestVisibleTopLevel(scene, { x: 10, y: 20 }, 10, new Map(), getPlantContext))
      .toBeNull()
  })
})
