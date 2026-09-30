import { afterEach, describe, expect, it } from 'vitest'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
  publishMapDiagnostics,
} from '../maplibre/canvas-surface-state'
import type { ViewDiagnostics } from '../canvas/runtime/view/types'

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
      layerSkipped: false,
    })
  })

  it('detects state equality including terrain fields', () => {
    const left = {
      status: 'ready' as const,
      errorMessage: null,
      terrainStatus: 'error' as const,
      terrainErrorMessage: 'dem failed',
      layerSkipped: false,
    }
    const right = { ...left }
    const different = { ...left, terrainErrorMessage: null }

    expect(mapLibreCanvasSurfaceStateEquals(left, right)).toBe(true)
    expect(mapLibreCanvasSurfaceStateEquals(left, different)).toBe(false)
    expect(mapLibreCanvasSurfaceStateEquals(left, { ...left, layerSkipped: true })).toBe(false)
  })

  it('publishes the stable canonical projection diagnostics without backend selection', () => {
    const frame: ViewDiagnostics = {
      camera: { center: { lon: 2.3522, lat: 48.8566 }, zoom: 17, bearingDeg: 30, pitchDeg: 0 },
      centreWorld: { x: 20, y: -10 },
      groundQuadGeo: [
        { lon: 2.35, lat: 48.86 },
        { lon: 2.36, lat: 48.86 },
        { lon: 2.36, lat: 48.85 },
        { lon: 2.35, lat: 48.85 },
      ],
    }

    publishMapDiagnostics(frame)
    const published = (globalThis as { __CANOPI_MAP_DEBUG__?: unknown })
      .__CANOPI_MAP_DEBUG__ as Record<string, unknown>
    // The live camera, bearing included (INV-CAM-32), and the ground it shows.
    expect(published).toMatchObject({
      center: [2.3522, 48.8566],
      zoom: 17,
      bearing: 30,
      pitch: 0,
      centreWorld: { x: 20, y: -10 },
      groundQuadGeo: frame.groundQuadGeo,
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
