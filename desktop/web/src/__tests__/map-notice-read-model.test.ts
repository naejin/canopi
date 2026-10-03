import { describe, expect, it } from 'vitest'
import { getMapNoticeReadModel } from '../app/canvas-map-surface/map-notice'
import type { MapLibreCanvasSurfaceState } from '../maplibre/canvas-surface-state'

const READY_MAP_STATE: MapLibreCanvasSurfaceState = {
  status: 'ready',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  layerSkipped: false,
  basemapStatus: 'idle',
}

function translate(key: string): string {
  return {
    'canvas.layers.mapUnavailable': 'Map unavailable',
    'canvas.layers.basemapLoading': 'Loading',
    'canvas.layers.layerSkipped': 'A map layer couldn’t be shown',
    'canvas.layers.basemapFailed': 'Basemap couldn’t load. Check your connection.',
  }[key] ?? key
}

describe('Map Notice read model', () => {
  it('reports loading while the basemap is not ready', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: { ...READY_MAP_STATE, status: 'loading' },
      t: translate,
    })).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'loading',
      statusText: 'Loading',
      retry: false,
    })
  })

  it('reports a map failure with a fixed message, never the engine text', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: { ...READY_MAP_STATE, status: 'error', errorMessage: 'style fetch failed' },
      t: translate,
    })).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'error',
      statusText: 'Map unavailable',
      retry: false,
    })
  })

  it('reports a failed basemap with Retry, below a map failure and above a skipped layer', () => {
    const failed = { ...READY_MAP_STATE, basemapStatus: 'failed' as const }
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: { ...failed, layerSkipped: true, terrainStatus: 'error', terrainErrorMessage: 'dem fetch failed' },
      t: translate,
    })).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'error',
      statusText: 'Basemap couldn’t load. Check your connection.',
      retry: true,
    })
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: { ...failed, status: 'error', errorMessage: 'context lost' },
      t: translate,
    })).toMatchObject({ statusText: 'Map unavailable', retry: false })
  })

  it('reports a terrain failure as a skipped layer, never the engine text', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: {
        ...READY_MAP_STATE,
        terrainStatus: 'error',
        terrainErrorMessage: 'dem fetch failed',
      },
      t: translate,
    })).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'ready',
      statusText: 'A map layer couldn’t be shown',
      retry: false,
    })
  })

  it('reports a skipped optional layer as a quiet ready notice', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: { ...READY_MAP_STATE, layerSkipped: true },
      t: translate,
    })).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'ready',
      statusText: 'A map layer couldn’t be shown',
      retry: false,
    })
  })

  it('hides for a ready map with no actionable map status', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: READY_MAP_STATE,
      t: translate,
    })).toEqual({
      visible: false,
      mapSurfaceVisible: true,
      tone: 'ready',
      statusText: '',
      retry: false,
    })
  })

  it('hides without an open Design', () => {
    expect(getMapNoticeReadModel({
      hasDesign: false,
      mapVisible: true,
      mapSurface: { ...READY_MAP_STATE, status: 'error', errorMessage: 'boom' },
      t: translate,
    })).toMatchObject({ visible: false, mapSurfaceVisible: false, statusText: '' })
  })

  it('hides without a visible map layer', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: false,
      mapSurface: { ...READY_MAP_STATE, status: 'loading' },
      t: translate,
    })).toMatchObject({ visible: false, mapSurfaceVisible: false, statusText: '' })
  })
})
