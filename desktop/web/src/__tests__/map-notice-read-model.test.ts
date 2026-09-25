import { describe, expect, it } from 'vitest'
import { getMapNoticeReadModel } from '../app/canvas-map-surface/map-notice'
import type { MapLibreCanvasSurfaceState } from '../maplibre/canvas-surface-state'

const READY_MAP_STATE: MapLibreCanvasSurfaceState = {
  status: 'ready',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
}

function translate(key: string): string {
  return {
    'canvas.layers.basemapError': 'Basemap unavailable',
    'canvas.layers.basemapLoading': 'Loading',
    'canvas.layers.mapSection': 'Map Layers',
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
    })
  })

  it('reports basemap errors with the error message', () => {
    expect(getMapNoticeReadModel({
      hasDesign: true,
      mapVisible: true,
      mapSurface: { ...READY_MAP_STATE, status: 'error', errorMessage: 'style fetch failed' },
      t: translate,
    })).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'error',
      statusText: 'Basemap unavailable: style fetch failed',
    })
  })

  it('builds ready notice text from terrain errors', () => {
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
      statusText: 'Map Layers: dem fetch failed',
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
