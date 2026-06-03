import { describe, expect, it } from 'vitest'
import {
  getLocationNoticeReadModel,
  getSavedLocationPresentation,
} from '../app/location'
import type { MapLibreCanvasSurfaceState } from '../maplibre/canvas-surface-state'

const READY_MAP_STATE: MapLibreCanvasSurfaceState = {
  status: 'ready',
  errorMessage: null,
  terrainStatus: 'idle',
  terrainErrorMessage: null,
  precisionWarning: false,
  designExtentMeters: null,
}

function translate(key: string): string {
  return {
    'canvas.layers.basemapError': 'Basemap unavailable',
    'canvas.layers.basemapLoading': 'Loading',
    'canvas.layers.mapSection': 'Map Layers',
    'canvas.layers.precisionWarning': 'Precision warning',
  }[key] ?? key
}

describe('Location Notice read model', () => {
  it('builds ready notice text from saved Location and MapLibre readiness facts', () => {
    const saved = getSavedLocationPresentation(true, {
      lat: 48.8566,
      lon: 2.3522,
      altitude_m: 35,
    })

    const model = getLocationNoticeReadModel({
      saved,
      mapVisible: true,
      mapSurface: {
        ...READY_MAP_STATE,
        terrainStatus: 'error',
        terrainErrorMessage: 'dem fetch failed',
        precisionWarning: true,
      },
      t: translate,
    })

    expect(model).toEqual({
      visible: true,
      mapSurfaceVisible: true,
      tone: 'ready',
      statusText: '48.8566, 2.3522 (35 m) • Map Layers: dem fetch failed • Precision warning',
      locationKey: '48.8566:2.3522:35',
    })
  })

  it('hides when a saved Location cannot support an active map surface', () => {
    const saved = getSavedLocationPresentation(true, null)

    const model = getLocationNoticeReadModel({
      saved,
      mapVisible: true,
      mapSurface: READY_MAP_STATE,
      t: translate,
    })

    expect(model).toEqual({
      visible: false,
      mapSurfaceVisible: false,
      tone: 'ready',
      statusText: '',
      locationKey: null,
    })
  })
})
