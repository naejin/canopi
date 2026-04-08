import { describe, expect, it } from 'vitest'
import { MANUAL_TARGET, NONE_TARGET, speciesTarget } from '../panel-targets'
import {
  projectPanelTargetsToMapFeatures,
  type PanelTargetMapProjectionScene,
} from '../panel-target-map-projection'
import type { PanelTarget } from '../types/design'

const LOCATION = { lat: 48.8566, lon: 2.3522 }

function createScene(overrides: Partial<PanelTargetMapProjectionScene> = {}): PanelTargetMapProjectionScene {
  return {
    plants: [
      { id: 'plant-1', canonicalName: 'Malus domestica', position: { x: 0, y: 0 } },
      { id: 'plant-2', canonicalName: 'Prunus avium', position: { x: 12, y: -6 } },
      { id: 'plant-3', canonicalName: 'Malus domestica', position: { x: 10, y: 20 } },
    ],
    zones: [
      {
        name: 'orchard',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
      {
        name: 'too-small',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
    ...overrides,
  }
}

describe('projectPanelTargetsToMapFeatures', () => {
  it('projects a species target to all matching plant point features in scene order', () => {
    const result = projectPanelTargetsToMapFeatures(
      [speciesTarget('Malus domestica')],
      createScene(),
      LOCATION,
    )

    expect(result.unresolvedTargets).toEqual([])
    expect(result.skippedSceneIds).toEqual([])
    expect(result.skippedReason).toBeNull()
    expect(result.features.map((feature) => feature.properties)).toEqual([
      { kind: 'plant', sceneId: 'plant-1' },
      { kind: 'plant', sceneId: 'plant-3' },
    ])

    const first = result.features[0]
    const second = result.features[1]
    expect(first?.geometry.type).toBe('Point')
    expect(first?.geometry.coordinates).toEqual([LOCATION.lon, LOCATION.lat])
    expect(second?.geometry.type).toBe('Point')
    expect(second?.geometry.coordinates[0]).toBeGreaterThan(LOCATION.lon)
    expect(second?.geometry.coordinates[1]).toBeLessThan(LOCATION.lat)
  })

  it('projects a placed plant target without also projecting same-species plants', () => {
    const result = projectPanelTargetsToMapFeatures(
      [{ kind: 'placed_plant', plant_id: 'plant-2' }],
      createScene(),
      LOCATION,
    )

    expect(result.features).toHaveLength(1)
    expect(result.features[0]?.properties).toEqual({ kind: 'plant', sceneId: 'plant-2' })
  })

  it('projects a zone target to a closed polygon and keeps colliding IDs typed', () => {
    const result = projectPanelTargetsToMapFeatures(
      [
        { kind: 'zone', zone_name: 'plant-1' },
        { kind: 'placed_plant', plant_id: 'orchard' },
      ],
      createScene({
        plants: [
          { id: 'plant-1', canonicalName: 'Malus domestica', position: { x: 0, y: 0 } },
          { id: 'orchard', canonicalName: 'Prunus avium', position: { x: 8, y: 8 } },
        ],
        zones: [
          {
            name: 'plant-1',
            points: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 4 },
            ],
          },
          {
            name: 'orchard',
            points: [
              { x: 0, y: 0 },
              { x: 6, y: 0 },
              { x: 6, y: 6 },
            ],
          },
        ],
      }),
      LOCATION,
    )

    expect(result.features.map((feature) => feature.properties)).toEqual([
      { kind: 'zone', sceneId: 'plant-1' },
      { kind: 'plant', sceneId: 'orchard' },
    ])

    const zone = result.features.find((feature) => feature.properties.kind === 'zone')
    expect(zone?.geometry.type).toBe('Polygon')
    const ring = zone?.geometry.type === 'Polygon' ? zone.geometry.coordinates[0] : []
    expect(ring).toHaveLength(4)
    expect(ring?.[0]).toEqual(ring?.[ring.length - 1])
  })

  it('reports missing scene-backed targets and treats manual and none as intentionally empty', () => {
    const missingSpecies = speciesTarget('Pyrus communis')
    const missingPlant: PanelTarget = { kind: 'placed_plant', plant_id: 'missing-plant' }
    const missingZone: PanelTarget = { kind: 'zone', zone_name: 'missing-zone' }

    const result = projectPanelTargetsToMapFeatures(
      [MANUAL_TARGET, NONE_TARGET, missingSpecies, missingPlant, missingZone],
      createScene(),
      LOCATION,
    )

    expect(result.features).toEqual([])
    expect(result.unresolvedTargets).toEqual([missingSpecies, missingPlant, missingZone])
    expect(result.skippedSceneIds).toEqual([])
    expect(result.skippedReason).toBeNull()
  })

  it('returns no features when location is missing while preserving resolver output', () => {
    const missingPlant: PanelTarget = { kind: 'placed_plant', plant_id: 'missing-plant' }

    const result = projectPanelTargetsToMapFeatures(
      [speciesTarget('Malus domestica'), { kind: 'zone', zone_name: 'orchard' }, missingPlant],
      createScene(),
      null,
    )

    expect(result.features).toEqual([])
    expect(result.unresolvedTargets).toEqual([missingPlant])
    expect(result.skippedSceneIds).toEqual(['plant-1', 'plant-3', 'orchard'])
    expect(result.skippedReason).toBe('missing_location')
  })

  it('skips zones with fewer than three points instead of emitting invalid polygons', () => {
    const result = projectPanelTargetsToMapFeatures(
      [{ kind: 'zone', zone_name: 'too-small' }],
      createScene(),
      LOCATION,
    )

    expect(result.features).toEqual([])
    expect(result.unresolvedTargets).toEqual([])
    expect(result.skippedSceneIds).toEqual(['too-small'])
    expect(result.skippedReason).toBeNull()
  })
})
