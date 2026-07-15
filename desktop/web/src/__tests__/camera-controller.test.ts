import { effect } from '@preact/signals'
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
    measurementGuides: [],
    groups: [],
    guides: [],
  }
}

describe('CameraController', () => {
  it('starts with one coherent unpublished viewport snapshot', () => {
    const camera = new CameraController()

    expect(camera.snapshot.value).toEqual({
      viewport: { x: 0, y: 0, scale: 1 },
      screenSize: { width: 0, height: 0 },
      referenceScale: 1,
      revision: 0,
    })
  })

  it('publishes initialization state and revision atomically once', () => {
    const camera = new CameraController()
    const observed: unknown[] = []
    const dispose = effect(() => {
      observed.push(structuredClone(camera.snapshot.value))
    })
    observed.length = 0

    camera.initialize({ width: 1000, height: 800 })
    dispose()

    expect(observed).toEqual([
      {
        viewport: { x: 100, y: 0, scale: 8 },
        screenSize: { width: 1000, height: 800 },
        referenceScale: 8,
        revision: 1,
      },
    ])
  })

  it('increments once for each effective pan, zoom, resize, and reference update', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })

    camera.panBy({ x: 10, y: -5 })
    expect(camera.snapshot.value.revision).toBe(2)
    expect(camera.snapshot.value.viewport).toEqual({ x: 110, y: -5, scale: 8 })

    camera.zoomIn()
    expect(camera.snapshot.value.revision).toBe(3)

    camera.resize({ width: 1200, height: 900 })
    expect(camera.snapshot.value.revision).toBe(4)
    expect(camera.snapshot.value.screenSize).toEqual({ width: 1200, height: 900 })
    expect(camera.snapshot.value.referenceScale).toBe(8)

    camera.initialize({ width: 1200, height: 900 })
    expect(camera.snapshot.value.revision).toBe(5)
    expect(camera.snapshot.value.referenceScale).toBe(9)
  })

  it('does not publish no-op viewport mutations', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })
    const initialRevision = camera.snapshot.value.revision

    camera.setViewport(camera.viewport)
    camera.panBy({ x: 0, y: 0 })
    camera.resize({ width: 1000, height: 800 })
    expect(camera.snapshot.value.revision).toBe(initialRevision)

    camera.setViewport({ ...camera.viewport, scale: 1000 })
    const maximumRevision = camera.snapshot.value.revision
    camera.zoomIn()
    expect(camera.snapshot.value.revision).toBe(maximumRevision)
  })

  it('owns immutable nested snapshot values', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })
    const snapshot = camera.snapshot.value

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.viewport)).toBe(true)
    expect(Object.isFrozen(snapshot.screenSize)).toBe(true)
    expect(() => {
      ;(snapshot.viewport as { x: number }).x = 999
    }).toThrow()
    expect(camera.viewport.x).toBe(100)
  })

  it('keeps imperative camera reads out of the caller reactive graph', () => {
    const camera = new CameraController()
    let effectRuns = 0
    const dispose = effect(() => {
      effectRuns += 1
      void camera.viewport
      void camera.screenSize
    })

    camera.initialize({ width: 1000, height: 800 })
    dispose()

    expect(effectRuns).toBe(1)
  })

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

  it('clamps viewport scale between the unchanged minimum and precision maximum', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })

    expect(camera.setViewport({ x: 0, y: 0, scale: 5000 }).scale).toBe(1000)
    expect(camera.setViewport({ x: 0, y: 0, scale: 0.001 }).scale).toBe(0.1)
  })

  it('lets zoom-in reach the precision maximum without exceeding it', () => {
    const camera = new CameraController()
    camera.initialize({ width: 1000, height: 800 })
    camera.setViewport({ x: 0, y: 0, scale: 990 })

    expect(camera.zoomIn().scale).toBe(1000)
    expect(camera.zoomIn().scale).toBe(1000)
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
