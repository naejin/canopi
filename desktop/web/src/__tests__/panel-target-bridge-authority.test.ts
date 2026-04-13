import { describe, expect, it } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { hoveredPanelTargets, selectedPanelTargets } from '../app/panel-targets/state'
import { selectedObjectIds } from '../state/canvas'
import { resolvePanelTargets } from '../panel-target-resolution'
import { projectPanelTargetsToMapFeatures } from '../panel-target-map-projection'
import { createPanelTargetMapOverlayContract, buildPanelTargetProjectionScene } from '../maplibre/panel-target-overlays'
import { speciesTarget } from '../panel-targets'

function createScene() {
  const scene = createDefaultScenePersistedState()
  scene.plants = [
    {
      kind: 'plant',
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: 0, y: 0 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    },
  ]
  return scene
}

describe('panel target bridge authority', () => {
  it('keeps resolver and map projection seams pure', () => {
    const selectionBefore = new Set(['canvas-selection'])
    selectedObjectIds.value = selectionBefore
    hoveredPanelTargets.value = [speciesTarget('Malus domestica')]
    selectedPanelTargets.value = [speciesTarget('Malus domestica')]

    const scene = createScene()
    const targets = [speciesTarget('Malus domestica')]

    const resolved = resolvePanelTargets(targets, scene)
    const projection = projectPanelTargetsToMapFeatures(
      targets,
      buildPanelTargetProjectionScene(scene),
      { lat: 48.8566, lon: 2.3522 },
    )
    const overlay = createPanelTargetMapOverlayContract('selection', projection)

    expect(resolved.plantIds).toEqual(['plant-1'])
    expect(overlay.hasRenderableFeatures).toBe(true)

    expect(selectedObjectIds.value).toEqual(selectionBefore)
    expect(hoveredPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
    expect(selectedPanelTargets.value).toEqual([speciesTarget('Malus domestica')])
  })
})
