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
    scene.measurementGuides.push({
      kind: 'measurement-guide',
      locked: false,
      id: 'guide-1',
      start: { x: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS, y: 0 },
      end: { x: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS + 5, y: 0 },
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
