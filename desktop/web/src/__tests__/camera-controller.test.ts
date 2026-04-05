import { describe, expect, it } from 'vitest'
import { CameraController, computeSceneBounds } from '../canvas/runtime/camera'
import type { ScenePersistedState } from '../canvas/runtime/scene'

function createScene(): ScenePersistedState {
  return {
    version: 1,
    name: 'Test',
    description: null,
    location: null,
    northBearingDeg: 0,
    plantSpeciesColors: {},
    layers: [],
    plants: [
      {
        kind: 'plant',
        id: 'p1',
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
      },
    ],
    zones: [
      {
        kind: 'zone',
        name: 'z1',
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
        fillColor: null,
        notes: null,
      },
    ],
    annotations: [],
    consortiums: [],
    groups: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    extra: {},
  }
}

describe('CameraController', () => {
  it('zooms around the provided screen point', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })

    const pointer = { x: 250, y: 200 }
    const before = camera.screenToWorld(pointer)
    camera.zoomAroundScreenPoint(pointer, 2)
    const after = camera.screenToWorld(pointer)

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('fits to the scene bounds', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })
    const scene = createScene()

    const viewport = camera.zoomToFit(scene)

    expect(viewport.scale).toBeGreaterThan(0)
    const topLeft = camera.worldToScreen({ x: 0, y: 0 })
    const bottomRight = camera.worldToScreen({ x: 30, y: 40 })
    expect(topLeft.x).toBeGreaterThanOrEqual(0)
    expect(topLeft.y).toBeGreaterThanOrEqual(0)
    expect(bottomRight.x).toBeLessThanOrEqual(1000)
    expect(bottomRight.y).toBeLessThanOrEqual(800)
  })
})

describe('computeSceneBounds', () => {
  it('includes both plant and zone geometry', () => {
    const bounds = computeSceneBounds(createScene())

    expect(bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 30,
      maxY: 40,
    })
  })

  it('includes annotation extents instead of only the annotation anchor point', () => {
    const scene = createScene()
    scene.annotations = [{
      kind: 'annotation',
      id: 'annotation-1',
      annotationType: 'text',
      position: { x: 50, y: 60 },
      text: 'Long note',
      fontSize: 20,
      rotationDeg: null,
    }]

    const bounds = computeSceneBounds(scene, 1)

    expect(bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 158,
      maxY: 85,
    })
  })
})
