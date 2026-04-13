import { describe, expect, it } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import { projectPanelTargetsToMapFeatures } from '../panel-target-map-projection'
import { speciesTarget } from '../panel-targets'
import {
  buildPanelTargetProjectionScene,
  createPanelTargetMapOverlayContract,
} from '../maplibre/panel-target-overlays'

const LOCATION = { lat: 48.8566, lon: 2.3522 }

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
  scene.zones = [
    {
      kind: 'zone',
      name: 'orchard',
      zoneType: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      fillColor: null,
      notes: null,
    },
  ]
  return scene
}

describe('panel-target map overlays', () => {
  it('builds a stable MapLibre contract for mixed projected features', () => {
    const projection = projectPanelTargetsToMapFeatures(
      [speciesTarget('Malus domestica'), { kind: 'zone', zone_name: 'orchard' }],
      buildPanelTargetProjectionScene(createScene()),
      LOCATION,
    )

    const overlay = createPanelTargetMapOverlayContract('selection', projection)

    expect(overlay.source.id).toBe('panel-target-selection-source')
    expect(overlay.layers.map((layer) => layer.id)).toEqual([
      'panel-target-selection-zones-fill',
      'panel-target-selection-zones-line',
      'panel-target-selection-plants',
    ])
    expect(overlay.layers.map((layer) => layer.type)).toEqual(['fill', 'line', 'circle'])
    expect(overlay.source.data.features).toHaveLength(2)
    expect(overlay.hasRenderableFeatures).toBe(true)
  })

  it('preserves empty overlays without inventing renderable features', () => {
    const projection = projectPanelTargetsToMapFeatures(
      [],
      buildPanelTargetProjectionScene(createScene()),
      LOCATION,
    )

    const overlay = createPanelTargetMapOverlayContract('hover', projection)

    expect(overlay.source.data.features).toEqual([])
    expect(overlay.hasRenderableFeatures).toBe(false)
    expect(overlay.unresolvedTargets).toEqual([])
    expect(overlay.skippedSceneIds).toEqual([])
    expect(overlay.skippedReason).toBeNull()
  })

  it('carries missing-location skips through the overlay contract', () => {
    const projection = projectPanelTargetsToMapFeatures(
      [speciesTarget('Malus domestica')],
      buildPanelTargetProjectionScene(createScene()),
      null,
    )

    const overlay = createPanelTargetMapOverlayContract('hover', projection)

    expect(overlay.hasRenderableFeatures).toBe(false)
    expect(overlay.skippedReason).toBe('missing_location')
    expect(overlay.skippedSceneIds).toEqual(['plant-1'])
  })

  it('retains unresolved targets in the pure overlay contract', () => {
    const missingTarget = speciesTarget('Pyrus communis')
    const projection = projectPanelTargetsToMapFeatures(
      [missingTarget],
      buildPanelTargetProjectionScene(createScene()),
      LOCATION,
    )

    const overlay = createPanelTargetMapOverlayContract('selection', projection)

    expect(overlay.hasRenderableFeatures).toBe(false)
    expect(overlay.unresolvedTargets).toEqual([missingTarget])
  })
})
