import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMapLibreBasemapContribution,
  createMapLibreBasemapStyle,
  createMapLibreEmptyStyle,
  isBasemapStyleSupported,
  normalizeBasemapStyle,
  MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID,
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
  MAPLIBRE_BASEMAP_SOURCE_MAX_ZOOM,
} from '../maplibre/config'
import { GOOGLE_KEY_PROMPT } from '../maplibre/basemap-provider'

describe('maplibre config', () => {
  let originalMapTilerKey: string | undefined

  beforeEach(() => {
    originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
    delete (import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY
  })

  afterEach(() => {
    if (originalMapTilerKey === undefined) {
      delete (import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY
    } else {
      ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
    }
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

  it('provides a source-free local style for map resource admission', () => {
    const style = createMapLibreEmptyStyle()
    expect(style.sources).toEqual({})
    expect(style.layers).toEqual([
      expect.objectContaining({ id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID, type: 'background' }),
    ])
    expect(JSON.stringify(style)).not.toContain('tile.openstreetmap.org')
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

  it('keeps a saved satellite identity instead of normalizing it to street', () => {
    // The build has no MapTiler key in this test, and the saved choice must
    // still be reported as satellite so its unavailability can be shown. The
    // previous behaviour returned street here, which silently relabelled the
    // user's saved provider.
    expect(normalizeBasemapStyle('satellite')).toBe('satellite')
    expect(isBasemapStyleSupported('satellite')).toBe(false)
  })

  it('contributes no tiles for an unavailable style rather than another provider\'s tiles', () => {
    const contribution = createMapLibreBasemapContribution('satellite')
    expect(contribution.available).toBe(false)
    expect(contribution.unavailableReason).toMatch(/MapTiler/)
    expect(contribution.source.tiles).toEqual([])
    expect(contribution.source.attribution).toBe('')
  })

  it('renders no raster source or layer for an unavailable style', () => {
    const style = createMapLibreBasemapStyle('satellite')
    if (typeof style !== 'object' || style === null || !('sources' in style)) {
      throw new Error('Expected inline style specification')
    }
    expect(style.sources).toEqual({})
    expect(JSON.stringify(style)).not.toContain('tile.openstreetmap.org')
    expect(JSON.stringify(style)).not.toContain('maptiler')
    expect(style.layers).toEqual([
      expect.objectContaining({ id: MAPLIBRE_BASEMAP_BACKGROUND_LAYER_ID }),
    ])
  })

  it('serves the keyless Google path with its prompt and deeper zoom ceiling', () => {
    const contribution = createMapLibreBasemapContribution('google_satellite', null)
    expect(contribution.available).toBe(true)
    expect(contribution.notice).toBe(GOOGLE_KEY_PROMPT)
    expect(contribution.source.tiles).toEqual([
      'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
    ])
    expect(contribution.source.maxzoom).toBe(22)
    expect(contribution.source.attribution).toContain('Google')
  })

  it('serves the official Google session path when a key is configured', () => {
    const contribution = createMapLibreBasemapContribution('google_satellite', 'fake-key')
    expect(contribution.available).toBe(true)
    expect(contribution.notice).toBeNull()
    expect(contribution.source.tiles[0]).toContain('tile.googleapis.com/v1/2dtiles')
    // The key is not part of a published source descriptor; the map's tile
    // transport adds it, and the session, to the fixed official endpoint.
    expect(JSON.stringify(contribution)).not.toContain('fake-key')
  })
})
