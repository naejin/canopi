import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMapLibreBasemapStyle,
  normalizeBasemapStyle,
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
  MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM,
} from '../maplibre/config'

describe('maplibre config', () => {
  let originalMapTilerKey: string | undefined

  beforeEach(() => {
    originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
    ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = undefined
  })

  afterEach(() => {
    ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
  })

  it('keeps the basemap raster layer available beyond the source max zoom', () => {
    const style = createMapLibreBasemapStyle('street')
    expect(typeof style).toBe('object')
    if (typeof style !== 'object' || style === null || !('sources' in style) || !('layers' in style)) {
      throw new Error('Expected inline style specification')
    }

    const source = style.sources[MAPLIBRE_BASEMAP_SOURCE_ID] as { maxzoom?: number }
    expect(source.maxzoom).toBe(MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM)

    const backgroundLayer = style.layers.find((layer) => layer.id === MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID)
    const rasterLayer = style.layers.find((layer) => layer.id === MAPLIBRE_BASEMAP_RASTER_LAYER_ID)
    expect(backgroundLayer?.type).toBe('background')
    expect(rasterLayer?.type).toBe('raster')
    expect(rasterLayer).not.toHaveProperty('maxzoom')
  })

  it('normalizes unknown styles to street', () => {
    expect(normalizeBasemapStyle('unknown')).toBe('street')
  })

  it('builds a satellite tile source when the MapTiler key is available', () => {
    ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = 'test-maptiler-key'
    const style = createMapLibreBasemapStyle('satellite')
    if (typeof style !== 'object' || style === null || !('sources' in style)) {
      throw new Error('Expected inline style specification')
    }

    expect(style.sources[MAPLIBRE_BASEMAP_SOURCE_ID]).toMatchObject({
      tiles: [expect.stringContaining('api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}?key=test-maptiler-key')],
    })
  })
})
