import { describe, expect, it } from 'vitest'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  mapLibreCanvasSurfaceStateEquals,
} from '../maplibre/canvas-surface-state'

describe('maplibre surface state adapter', () => {
  it('returns idle defaults from the shared state constant', () => {
    expect(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE).toEqual({
      status: 'idle',
      terrainStatus: 'idle',
      layerSkipped: false,
      basemapStatus: 'idle',
      retryable: false,
    })
  })

  it('detects state equality including terrain fields', () => {
    const left = {
      status: 'ready' as const,
      terrainStatus: 'error' as const,
      layerSkipped: false,
      basemapStatus: 'idle' as const,
      retryable: false,
    }
    const right = { ...left }
    const different = { ...left, terrainStatus: 'ready' as const }

    expect(mapLibreCanvasSurfaceStateEquals(left, right)).toBe(true)
    expect(mapLibreCanvasSurfaceStateEquals(left, different)).toBe(false)
    expect(mapLibreCanvasSurfaceStateEquals(left, { ...left, layerSkipped: true })).toBe(false)
    expect(mapLibreCanvasSurfaceStateEquals(left, { ...left, basemapStatus: 'failed' })).toBe(false)
    expect(mapLibreCanvasSurfaceStateEquals(left, { ...left, retryable: true })).toBe(false)
  })
})
