import { describe, expect, it } from 'vitest'
import {
  createMapLibreEmptyStyle,
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from '../maplibre/config'

describe('maplibre config', () => {
  it('provides a source-free local style for map resource admission', () => {
    const style = createMapLibreEmptyStyle()
    expect(style.version).toBe(8)
    expect(style.sources).toEqual({})
    expect(style.layers).toEqual([
      expect.objectContaining({ id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID, type: 'background' }),
    ])
    // Basemap and Satellite are installed at runtime, never baked into the
    // style, so the local style names no remote provider.
    const serialized = JSON.stringify(style)
    expect(serialized).not.toContain('http')
    expect(serialized).not.toContain(MAPLIBRE_SATELLITE_SOURCE_ID)
    expect(serialized).not.toContain(MAPLIBRE_SATELLITE_LAYER_ID)
  })

  it('returns a fresh style each time so a map cannot mutate another map\'s style', () => {
    const first = createMapLibreEmptyStyle()
    const second = createMapLibreEmptyStyle()
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.layers).not.toBe(second.layers)
  })

  it('keeps the satellite source and layer ids distinct from the background layer', () => {
    expect(MAPLIBRE_SATELLITE_SOURCE_ID).toBe('canopi-satellite')
    expect(MAPLIBRE_SATELLITE_LAYER_ID).toBe('satellite-raster')
    expect(MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID).not.toBe(MAPLIBRE_SATELLITE_LAYER_ID)
  })
})
