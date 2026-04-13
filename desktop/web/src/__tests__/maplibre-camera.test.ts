import { describe, expect, it } from 'vitest'
import {
  computeMapLibreCamera,
  createMapFrame,
  maplibreBearingFromNorthBearing,
} from '../canvas/maplibre-camera'
import { geoToMercator, stageScaleToMapZoom, worldToGeo } from '../canvas/projection'
import { CameraController } from '../canvas/runtime/camera'
import type { ScenePersistedState } from '../canvas/runtime/scene'

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

function normalizeBearingDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

function expectedMapLibreBearing(northBearingDeg: number | null | undefined): number {
  return normalizeBearingDegrees(-(northBearingDeg ?? 0))
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

function projectWorldToExpectedMapScreen(
  point: { x: number; y: number },
  frame: NonNullable<ReturnType<typeof createMapFrame>>,
  screenSize: { width: number; height: number },
  location: { lat: number; lon: number },
  northBearingDeg: number | null | undefined,
) {
  const geo = worldToGeo(point.x, point.y, location.lat, location.lon, northBearingDeg ?? 0)
  return projectGeoToMapScreen(geo.lng, geo.lat, frame, screenSize)
}

function createScene(): ScenePersistedState {
  return {
    plantSpeciesColors: {},
    layers: [],
    plants: [
      {
        kind: 'plant',
        id: 'plant-1',
        canonicalName: 'Malus domestica',
        commonName: null,
        color: null,
        stratum: null,
        canopySpreadM: null,
        position: { x: -40, y: 15 },
        rotationDeg: null,
        scale: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      },
      {
        kind: 'plant',
        id: 'plant-2',
        canonicalName: 'Prunus avium',
        commonName: null,
        color: null,
        stratum: null,
        canopySpreadM: null,
        position: { x: 30, y: -20 },
        rotationDeg: null,
        scale: null,
        notes: null,
        plantedDate: null,
        quantity: 1,
      },
    ],
    zones: [
      {
        kind: 'zone',
        name: 'zone-1',
        zoneType: 'rect',
        points: [
          { x: -60, y: -30 },
          { x: 60, y: -30 },
          { x: 60, y: 50 },
          { x: -60, y: 50 },
        ],
        fillColor: null,
        notes: null,
      },
    ],
    annotations: [],
    groups: [],
    guides: [],
  }
}

describe('computeMapLibreCamera', () => {
  it('returns null when location is missing', () => {
    const result = computeMapLibreCamera(
      { x: 0, y: 0, scale: 1 },
      { width: 1000, height: 800 },
      null,
      12,
    )

    expect(result).toBeNull()
  })

  it('returns null when screen size is invalid', () => {
    const result = computeMapLibreCamera(
      { x: 0, y: 0, scale: 1 },
      { width: 0, height: 800 },
      { lat: 45.52, lon: -122.68 },
      12,
    )

    expect(result).toBeNull()
  })

  it('projects viewport center into a MapLibre camera', () => {
    const northBearingDeg = 14
    const result = computeMapLibreCamera(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      { lat: 45.52, lon: -122.68 },
      northBearingDeg,
    )

    expect(result).not.toBeNull()
    const expectedCenter = worldToGeo(350, 250, 45.52, -122.68, northBearingDeg)
    expect(result!.center[0]).toBeCloseTo(expectedCenter.lng, 8)
    expect(result!.center[1]).toBeCloseTo(expectedCenter.lat, 8)
    expect(result!.zoom).toBeCloseTo(stageScaleToMapZoom(2, 45.52), 8)
    expect(result!.bearing).toBe(maplibreBearingFromNorthBearing(northBearingDeg))
  })

  it('keeps extreme zoom values aligned with the canvas camera until the map ceiling', () => {
    const result = computeMapLibreCamera(
      { x: 0, y: 0, scale: 5000 },
      { width: 1000, height: 800 },
      { lat: 0, lon: 0 },
      null,
    )

    expect(result).not.toBeNull()
    expect(result!.zoom).toBeCloseTo(stageScaleToMapZoom(5000, 0), 8)
    expect(result!.bearing).toBe(0)
  })

  it('uses an explicit MapLibre bearing adapter for document bearings', () => {
    expect(maplibreBearingFromNorthBearing(null)).toBe(0)
    expect(maplibreBearingFromNorthBearing(90)).toBe(270)
    expect(maplibreBearingFromNorthBearing(450)).toBe(270)
    expect(maplibreBearingFromNorthBearing(-90)).toBe(90)
  })

  it('changes the projected center when north bearing rotates the canvas axes', () => {
    const northUp = computeMapLibreCamera(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      { lat: 45.52, lon: -122.68 },
      0,
    )
    const rotated = computeMapLibreCamera(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      { lat: 45.52, lon: -122.68 },
      90,
    )

    expect(northUp).not.toBeNull()
    expect(rotated).not.toBeNull()
    expect(rotated!.center[0]).not.toBeCloseTo(northUp!.center[0], 8)
    expect(rotated!.center[1]).not.toBeCloseTo(northUp!.center[1], 8)
    expect(rotated!.bearing).toBe(expectedMapLibreBearing(90))
  })

  it('exposes viewport diagnostics through the canonical frame', () => {
    const frame = createMapFrame(
      { x: -200, y: -100, scale: 2 },
      { width: 1000, height: 800 },
      { lat: 45.52, lon: -122.68 },
      14,
    )

    expect(frame).not.toBeNull()
    expect(frame!.diagnostics.viewportCenterWorld.x).toBeCloseTo(350, 8)
    expect(frame!.diagnostics.viewportCenterWorld.y).toBeCloseTo(250, 8)
    expect(frame!.diagnostics.backendId).toBe('local-mercator')
    expect(frame!.diagnostics.warningThresholdMeters).toBe(10_000)
    expect(frame!.diagnostics.viewportCornerGeo).toHaveLength(4)
  })
})

describe('screen-lock validation', () => {
  const location = { lat: 48.8566, lon: 2.3522 }
  const screenSize = { width: 1200, height: 800 }
  const worldPoints = [
    { x: 0, y: 0 },
    { x: 12.5, y: -6.25 },
    { x: -50, y: 24 },
    { x: 500, y: -250 },
  ] as const

  it('keeps the same world point on the same screen pixel at zero bearing', () => {
    const viewport = { x: -175.25, y: 92.5, scale: 3.75 }
    const frame = createMapFrame(viewport, screenSize, location, 0)

    expect(frame).not.toBeNull()
    for (const point of worldPoints) {
      const canvas = projectWorldToCanvasScreen(viewport, point)
      const map = projectWorldToExpectedMapScreen(point, frame!, screenSize, location, 0)
      expect(map.x).toBeCloseTo(canvas.x, 6)
      expect(map.y).toBeCloseTo(canvas.y, 6)
    }
  })

  it('keeps the same world point on the same screen pixel for rotated designs', () => {
    const northBearingDeg = 37
    const viewport = { x: 221.75, y: -144.5, scale: 1.8 }
    const frame = createMapFrame(viewport, screenSize, location, northBearingDeg)

    expect(frame).not.toBeNull()
    for (const point of worldPoints) {
      const canvas = projectWorldToCanvasScreen(viewport, point)
      const map = projectWorldToExpectedMapScreen(
        point,
        frame!,
        screenSize,
        location,
        northBearingDeg,
      )
      expect(map.x).toBeCloseTo(canvas.x, 6)
      expect(map.y).toBeCloseTo(canvas.y, 6)
    }
  })

  it('preserves screen lock across tiny pan changes', () => {
    const northBearingDeg = 23
    const beforeViewport = { x: -200.125, y: 50.75, scale: 2.2 }
    const afterViewport = { x: -200.0625, y: 50.6875, scale: 2.2 }
    const world = { x: 42.5, y: -18.25 }
    const beforeFrame = createMapFrame(beforeViewport, screenSize, location, northBearingDeg)
    const afterFrame = createMapFrame(afterViewport, screenSize, location, northBearingDeg)

    expect(beforeFrame).not.toBeNull()
    expect(afterFrame).not.toBeNull()
    const beforeCanvas = projectWorldToCanvasScreen(beforeViewport, world)
    const afterCanvas = projectWorldToCanvasScreen(afterViewport, world)
    const beforeMap = projectWorldToExpectedMapScreen(world, beforeFrame!, screenSize, location, northBearingDeg)
    const afterMap = projectWorldToExpectedMapScreen(world, afterFrame!, screenSize, location, northBearingDeg)

    expect(afterMap.x - beforeMap.x).toBeCloseTo(afterCanvas.x - beforeCanvas.x, 6)
    expect(afterMap.y - beforeMap.y).toBeCloseTo(afterCanvas.y - beforeCanvas.y, 6)
  })

  it('preserves screen lock across tiny zoom changes', () => {
    const northBearingDeg = 12
    const beforeViewport = { x: -80, y: 32, scale: 0.95 }
    const afterViewport = { x: -80, y: 32, scale: 0.9505 }
    const world = { x: -120, y: 75 }
    const beforeFrame = createMapFrame(beforeViewport, screenSize, location, northBearingDeg)
    const afterFrame = createMapFrame(afterViewport, screenSize, location, northBearingDeg)

    expect(beforeFrame).not.toBeNull()
    expect(afterFrame).not.toBeNull()
    const beforeCanvas = projectWorldToCanvasScreen(beforeViewport, world)
    const afterCanvas = projectWorldToCanvasScreen(afterViewport, world)
    const beforeMap = projectWorldToExpectedMapScreen(world, beforeFrame!, screenSize, location, northBearingDeg)
    const afterMap = projectWorldToExpectedMapScreen(world, afterFrame!, screenSize, location, northBearingDeg)

    expect(afterMap.x - beforeMap.x).toBeCloseTo(afterCanvas.x - beforeCanvas.x, 6)
    expect(afterMap.y - beforeMap.y).toBeCloseTo(afterCanvas.y - beforeCanvas.y, 6)
  })

  it('keeps screen lock after viewport resize', () => {
    const northBearingDeg = 18
    const viewport = { x: -200, y: 80, scale: 2.1 }
    const resizedScreen = { width: 1600, height: 900 }
    const point = { x: 150, y: -45 }
    const frame = createMapFrame(viewport, resizedScreen, location, northBearingDeg)

    expect(frame).not.toBeNull()
    const canvas = projectWorldToCanvasScreen(viewport, point)
    const map = projectWorldToExpectedMapScreen(point, frame!, resizedScreen, location, northBearingDeg)

    expect(map.x).toBeCloseTo(canvas.x, 6)
    expect(map.y).toBeCloseTo(canvas.y, 6)
  })

  it('keeps screen lock for fit-to-content viewports', () => {
    const northBearingDeg = 27
    const scene = createScene()
    const camera = new CameraController()
    const screenSize = { width: 1280, height: 820 }
    camera.initialize(screenSize)
    const viewport = camera.zoomToFit(scene)
    const frame = createMapFrame(viewport, screenSize, location, northBearingDeg)
    const point = scene.plants[1]!.position

    expect(frame).not.toBeNull()
    const canvas = projectWorldToCanvasScreen(viewport, point)
    const map = projectWorldToExpectedMapScreen(point, frame!, screenSize, location, northBearingDeg)

    expect(map.x).toBeCloseTo(canvas.x, 6)
    expect(map.y).toBeCloseTo(canvas.y, 6)
  })

  it('keeps screen lock for document-open auto-fit viewports', () => {
    const northBearingDeg = 11
    const scene = createScene()
    scene.annotations.push({
      kind: 'annotation',
      id: 'annotation-1',
      annotationType: 'text',
      position: { x: 95, y: -55 },
      text: 'Open document',
      fontSize: 18,
      rotationDeg: null,
    })
    const camera = new CameraController()
    const screenSize = { width: 1100, height: 760 }
    camera.initialize(screenSize)
    const viewport = camera.zoomToFit(scene)
    const frame = createMapFrame(viewport, screenSize, location, northBearingDeg)
    const point = scene.annotations[0]!.position

    expect(frame).not.toBeNull()
    const canvas = projectWorldToCanvasScreen(viewport, point)
    const map = projectWorldToExpectedMapScreen(point, frame!, screenSize, location, northBearingDeg)

    expect(map.x).toBeCloseTo(canvas.x, 6)
    expect(map.y).toBeCloseTo(canvas.y, 6)
  })
})
