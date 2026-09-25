import { afterEach, describe, expect, it } from 'vitest'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
  publishMapDiagnostics,
} from '../maplibre/canvas-surface-state'
import { LOCAL_MERCATOR_PROJECTION_ID } from '../canvas/projection'

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
    })
  })

  it('detects state equality including terrain fields', () => {
    const left = {
      status: 'ready' as const,
      errorMessage: null,
      terrainStatus: 'error' as const,
      terrainErrorMessage: 'dem failed',
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
      bearing: 0,
      diagnostics: {
        projectionId: LOCAL_MERCATOR_PROJECTION_ID,
        viewportCenterWorld: { x: 20, y: -10 },
        viewportCornerGeo: [
          { lng: 2.35, lat: 48.86 },
          { lng: 2.36, lat: 48.86 },
          { lng: 2.36, lat: 48.85 },
          { lng: 2.35, lat: 48.85 },
        ],
      },
    } as const

    publishMapDiagnostics(frame)
    const published = (globalThis as { __CANOPI_MAP_DEBUG__?: unknown })
      .__CANOPI_MAP_DEBUG__ as Record<string, unknown>
    expect(published).toMatchObject({
      projectionId: 'local-mercator',
      center: [2.3522, 48.8566],
      zoom: 17,
      bearing: 0,
      viewportCenterWorld: { x: 20, y: -10 },
    })
    expect(published).not.toHaveProperty('projectionBackendId')
    expect(published).not.toHaveProperty('precisionWarning')
    expect(published).not.toHaveProperty('designExtentMeters')
  })

  it('clears the published diagnostics when no frame is available', () => {
    publishMapDiagnostics(null)
    expect((globalThis as { __CANOPI_MAP_DEBUG__?: unknown }).__CANOPI_MAP_DEBUG__).toBeNull()
  })
})
