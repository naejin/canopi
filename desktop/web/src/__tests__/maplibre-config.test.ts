import { describe, expect, it } from 'vitest'
import {
  createDefaultMapLibreBasemapStyle,
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
  MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM,
} from '../maplibre/config'

describe('maplibre config', () => {
  it('keeps the basemap raster layer available beyond the source max zoom', () => {
    const style = createDefaultMapLibreBasemapStyle('https://tile.openstreetmap.org/{z}/{x}/{y}.png')
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
})
