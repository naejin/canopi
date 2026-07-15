import { afterEach, describe, expect, it } from 'vitest'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
  mergeMapLibreCanvasSurfaceState,
  publishMapDiagnostics,
} from '../maplibre/canvas-surface-state'
import {
  LOCAL_MERCATOR_PROJECTION_ID,
  LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
  computeSceneExtentMeters,
} from '../canvas/projection'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'

describe('maplibre surface state adapter', () => {
  afterEach(() => {
    delete (globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__
  })

  it('returns idle defaults from the shared state constant', () => {
    expect(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE).toEqual({
      status: 'idle',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    })
  })

  it('merges precision warning data from the current scene extent', () => {
    const scene = createDefaultScenePersistedState()
    scene.plants.push({
      kind: 'plant',
      locked: false,
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: null,
      color: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS + 5, y: 0 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: 1,
    })

    const merged = mergeMapLibreCanvasSurfaceState({
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }, scene)

    expect(merged.precisionWarning).toBe(true)
    expect(merged.designExtentMeters).toBeGreaterThan(LOCAL_PROJECTION_WARNING_THRESHOLD_METERS)
  })

  it('detects state equality including terrain and precision fields', () => {
    const left = {
      status: 'ready' as const,
      errorMessage: null,
      terrainStatus: 'error' as const,
      terrainErrorMessage: 'dem failed',
      precisionWarning: true,
      designExtentMeters: 1234,
    }
    const right = { ...left }
    const different = { ...left, terrainErrorMessage: null }

    expect(mapLibreCanvasSurfaceStateEquals(left, right)).toBe(true)
    expect(mapLibreCanvasSurfaceStateEquals(left, different)).toBe(false)
  })

  it('computes scene extent from plants, zone points, and annotations', () => {
    const scene = createDefaultScenePersistedState()
    expect(computeSceneExtentMeters(scene)).toBeNull()

    scene.plants.push({
      kind: 'plant',
      id: 'plant-1',
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: null,
      color: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: 30, y: 40 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    })
    expect(computeSceneExtentMeters(scene)).toBeCloseTo(50, 8)

    scene.zones.push({
      kind: 'zone',
      locked: false,
      name: 'zone-1',
      zoneType: 'polygon',
      points: [{ x: 60, y: 80 }],
      rotationDeg: 0,
      fillColor: null,
      notes: null,
    })
    expect(computeSceneExtentMeters(scene)).toBeCloseTo(100, 8)

    scene.annotations.push({
      kind: 'annotation',
      locked: false,
      id: 'annotation-1',
      annotationType: 'text',
      position: { x: -120, y: 160 },
      text: 'Extent',
      fontSize: 16,
      rotationDeg: null,
    })
    expect(computeSceneExtentMeters(scene)).toBeCloseTo(200, 8)
  })

  it('publishes the stable canonical projection diagnostics without backend selection', () => {
    const frame = {
      center: [2.3522, 48.8566],
      zoom: 17,
      bearing: 12,
      diagnostics: {
        projectionId: LOCAL_MERCATOR_PROJECTION_ID,
        warningThresholdMeters: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
        viewportCenterWorld: { x: 20, y: -10 },
        viewportCornerGeo: [
          { lng: 2.35, lat: 48.86 },
          { lng: 2.36, lat: 48.86 },
          { lng: 2.36, lat: 48.85 },
          { lng: 2.35, lat: 48.85 },
        ],
      },
    } as const

    publishMapDiagnostics(frame, LOCAL_PROJECTION_WARNING_THRESHOLD_METERS)
    const atThreshold = (globalThis as { __CANOPI_MAP_DEBUG__?: unknown })
      .__CANOPI_MAP_DEBUG__ as Record<string, unknown>
    expect(atThreshold).toMatchObject({
      designExtentMeters: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
      precisionWarning: false,
    })

    publishMapDiagnostics(frame, LOCAL_PROJECTION_WARNING_THRESHOLD_METERS + 1)
    const beyondThreshold = (globalThis as { __CANOPI_MAP_DEBUG__?: unknown })
      .__CANOPI_MAP_DEBUG__ as Record<string, unknown>
    expect(beyondThreshold).toMatchObject({
      projectionId: 'local-mercator',
      precisionWarningThresholdMeters: 10_000,
      designExtentMeters: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS + 1,
      precisionWarning: true,
    })
    expect(beyondThreshold).not.toHaveProperty('projectionBackendId')
  })
})
