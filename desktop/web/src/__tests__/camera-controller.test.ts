import { describe, expect, it } from 'vitest'
import { CameraController, computeSceneBounds } from '../canvas/runtime/camera'
import type { ScenePersistedState } from '../canvas/runtime/scene'

function createScene(): ScenePersistedState {
  return {
    plantSpeciesColors: {},
    plantSpeciesSymbols: {},
    layers: [],
    plants: [
      {
        kind: 'plant',
        locked: false,
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
        locked: false,
        name: 'z1',
        zoneType: 'rect',
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 40 },
          { x: 0, y: 40 },
        ],
        rotationDeg: 0,
        fillColor: null,
        notes: null,
      },
    ],
    annotations: [],
    groups: [],
    guides: [],
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

  it('converges in a single call despite scale-dependent bounds', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })
    const scene = createScene()
    scene.annotations = [{
      kind: 'annotation',
      locked: false,
      id: 'a1',
      annotationType: 'text',
      position: { x: 50, y: 60 },
      text: 'A long annotation that affects bounds',
      fontSize: 20,
      rotationDeg: null,
    }]

    // First call should converge fully
    const first = camera.zoomToFit(scene)
    // Second call should produce the same scale (no further convergence needed)
    const second = camera.zoomToFit(scene)

    expect(first.scale).toBeCloseTo(second.scale, 2)
    expect(first.x).toBeCloseTo(second.x, 1)
    expect(first.y).toBeCloseTo(second.y, 1)
  })
})

describe('computeSceneBounds', () => {
  it('uses the symbolic Placed Plant Visual Footprint for plant-only bounds', () => {
    const scene = createScene()
    scene.zones = []

    const bounds = computeSceneBounds(scene, 10)

    expect(bounds?.minX).toBeCloseTo(9.65, 2)
    expect(bounds?.minY).toBeCloseTo(19.65, 2)
    expect(bounds?.maxX).toBeCloseTo(10.35, 2)
    expect(bounds?.maxY).toBeCloseTo(20.35, 2)
  })

  it('includes both plant and zone geometry', () => {
    const bounds = computeSceneBounds(createScene())

    expect(bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 30,
      maxY: 40,
    })
  })

  it('includes elliptical zone center and radii geometry', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      locked: false,
      name: 'ellipse-1',
      zoneType: 'ellipse',
      points: [
        { x: 50, y: 60 },
        { x: 30, y: 20 },
      ],
      rotationDeg: 0,
      fillColor: null,
      notes: null,
    }]

    expect(computeSceneBounds(scene)).toEqual({
      minX: 20,
      minY: 40,
      maxX: 80,
      maxY: 80,
    })
  })

  it('includes oriented Elliptical Zone bounds', () => {
    const scene = createScene()
    scene.plants = []
    scene.zones = [{
      kind: 'zone',
      locked: false,
      name: 'ellipse-1',
      zoneType: 'ellipse',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 1 },
      ],
      rotationDeg: 90,
      fillColor: null,
      notes: null,
    }]

    expect(computeSceneBounds(scene)).toEqual({
      minX: -1,
      minY: -4,
      maxX: 1,
      maxY: 4,
    })
  })

  it('includes annotation extents instead of only the annotation anchor point', () => {
    const scene = createScene()
    scene.annotations = [{
      kind: 'annotation',
      locked: false,
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
