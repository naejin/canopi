import { describe, expect, it } from 'vitest'
import { MANUAL_TARGET, NONE_TARGET, speciesTarget } from '../panel-targets'
import { createMapFrame } from '../canvas/maplibre-camera'
import { geoToMercator } from '../canvas/projection'
import {
  projectPanelTargetsToMapFeatures,
  type PanelTargetMapProjectionScene,
} from '../panel-target-map-projection'
import type { PanelTarget } from '../types/design'

const LOCATION = { lat: 48.8566, lon: 2.3522 }
const MAPLIBRE_WORLD_TILE_SIZE = 512
const DEGREES_TO_RADIANS = Math.PI / 180

function projectWorldToCanvasScreen(
  viewport: { x: number; y: number; scale: number },
  world: { x: number; y: number },
) {
  return {
    x: viewport.x + world.x * viewport.scale,
    y: viewport.y + world.y * viewport.scale,
  }
}

function projectGeoToMapScreen(
  lng: number,
  lat: number,
  frame: NonNullable<ReturnType<typeof createMapFrame>>,
  screenSize: { width: number; height: number },
) {
  const point = geoToMercator(lng, lat)
  const center = geoToMercator(frame.center[0], frame.center[1])
  const worldSizePx = MAPLIBRE_WORLD_TILE_SIZE * (2 ** frame.zoom)
  const deltaX = (point.x - center.x) * worldSizePx
  const deltaY = (point.y - center.y) * worldSizePx
  const bearingRad = frame.bearing * DEGREES_TO_RADIANS
  const cos = Math.cos(bearingRad)
  const sin = Math.sin(bearingRad)

  return {
    x: screenSize.width / 2 + deltaX * cos + deltaY * sin,
    y: screenSize.height / 2 - deltaX * sin + deltaY * cos,
  }
}

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
    expect(first?.geometry.coordinates[0]).toBeCloseTo(LOCATION.lon, 10)
    expect(first?.geometry.coordinates[1]).toBeCloseTo(LOCATION.lat, 10)
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

  it('projects features through the same north-bearing transform as the map camera', () => {
    const result = projectPanelTargetsToMapFeatures(
      [{ kind: 'placed_plant', plant_id: 'plant-2' }],
      createScene(),
      { ...LOCATION, northBearingDeg: 90 },
    )
    const northUp = projectPanelTargetsToMapFeatures(
      [{ kind: 'placed_plant', plant_id: 'plant-2' }],
      createScene(),
      LOCATION,
    )

    expect(result.features).toHaveLength(1)
    expect(northUp.features).toHaveLength(1)
    const rotatedPoint = result.features[0]
    const northUpPoint = northUp.features[0]
    expect(rotatedPoint?.geometry.type).toBe('Point')
    expect(northUpPoint?.geometry.type).toBe('Point')
    const rotatedCoords = rotatedPoint?.geometry.type === 'Point' ? rotatedPoint.geometry.coordinates : null
    const northUpCoords = northUpPoint?.geometry.type === 'Point' ? northUpPoint.geometry.coordinates : null
    expect(rotatedCoords?.[0]).not.toBeCloseTo(
      northUpCoords![0],
      8,
    )
    expect(rotatedCoords?.[1]).not.toBeCloseTo(
      northUpCoords![1],
      8,
    )
    expect(rotatedCoords?.[0]).toBeLessThan(northUpCoords![0])
  })

  it('keeps projected plant overlays screen-locked to the same canonical map frame', () => {
    const scene = createScene()
    const viewport = { x: -180, y: 64, scale: 2.4 }
    const screenSize = { width: 1200, height: 800 }
    const northBearingDeg = 32
    const frame = createMapFrame(viewport, screenSize, LOCATION, northBearingDeg)
    const result = projectPanelTargetsToMapFeatures(
      [{ kind: 'placed_plant', plant_id: 'plant-2' }],
      scene,
      { ...LOCATION, northBearingDeg },
    )

    expect(frame).not.toBeNull()
    expect(result.features).toHaveLength(1)
    const plant = scene.plants.find((entry) => entry.id === 'plant-2')
    const feature = result.features[0]
    expect(plant).toBeDefined()
    expect(feature?.geometry.type).toBe('Point')
    const coordinates = feature?.geometry.type === 'Point' ? feature.geometry.coordinates : null
    const mapScreen = coordinates
      ? projectGeoToMapScreen(coordinates[0], coordinates[1], frame!, screenSize)
      : null
    const canvasScreen = projectWorldToCanvasScreen(viewport, plant!.position)

    expect(mapScreen).not.toBeNull()
    expect(mapScreen!.x).toBeCloseTo(canvasScreen.x, 6)
    expect(mapScreen!.y).toBeCloseTo(canvasScreen.y, 6)
  })
})
