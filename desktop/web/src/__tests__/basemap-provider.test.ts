import { describe, expect, it } from 'vitest'
import {
  GOOGLE_KEY_PROMPT,
  coerceBasemapStyle,
  isBasemapStyleRenderable,
  resolveBasemapAvailability,
} from '../maplibre/basemap-provider'

describe('shared basemap provider resolution', () => {
  it('keeps street on OpenStreetMap and needs no provider key', () => {
    const resolved = resolveBasemapAvailability('street')
    expect(resolved.state).toBe('ready')
    if (resolved.state !== 'ready') throw new Error('street must be ready')
    expect(resolved.descriptor.provider).toBe('openstreetmap')
    expect(resolved.descriptor.tiles).toEqual([
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ])
    expect(resolved.descriptor.notice).toBeNull()
    expect(resolved.descriptor.official).toBe(false)
  })

  it('marks a saved MapTiler satellite unavailable instead of substituting another provider', () => {
    const resolved = resolveBasemapAvailability('satellite', { mapTilerKey: undefined })
    expect(resolved.state).toBe('unavailable')
    if (resolved.state !== 'unavailable') throw new Error('satellite must be unavailable')
    expect(resolved.style).toBe('satellite')
    // The failure names the real cause and never offers street or Google as the
    // substitute, because either would relabel satellite imagery.
    expect(resolved.reason).toMatch(/MapTiler/)
    expect(isBasemapStyleRenderable('satellite', { mapTilerKey: undefined })).toBe(false)
  })

  it('uses MapTiler satellite when the build key exists', () => {
    const resolved = resolveBasemapAvailability('satellite', { mapTilerKey: 'test-maptiler-key' })
    if (resolved.state !== 'ready') throw new Error('satellite must be ready with a key')
    expect(resolved.descriptor.provider).toBe('maptiler')
    expect(resolved.descriptor.tiles).toEqual([
      'https://api.maptiler.com/tiles/satellite-v4/{z}/{x}/{y}?key=test-maptiler-key',
    ])
    expect(resolved.descriptor.attribution).toContain('MapTiler')
    expect(resolved.descriptor.official).toBe(false)
    expect(resolved.descriptor.notice).toBeNull()
  })

  it('keeps a configured Google key on the official session path', () => {
    const resolved = resolveBasemapAvailability('google_satellite', {
      googleMapsApiKey: '  fake-recognizable-key  ',
    })
    if (resolved.state !== 'ready') throw new Error('google_satellite must be selectable')
    expect(resolved.descriptor.provider).toBe('google')
    expect(resolved.descriptor.official).toBe(true)
    // The key is trimmed, and the session token placeholder stays unresolved:
    // the session owner substitutes a live token that expires.
    expect(resolved.descriptor.tiles).toEqual([
      'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}&key=fake-recognizable-key',
    ])
    expect(resolved.descriptor.notice).toBeNull()
  })

  it('offers the keyless Google path with the exact required prompt and no official claim', () => {
    for (const config of [
      { googleMapsApiKey: undefined },
      { googleMapsApiKey: null },
      { googleMapsApiKey: '   ' },
    ]) {
      const resolved = resolveBasemapAvailability('google_satellite', config)
      if (resolved.state !== 'ready') {
        throw new Error('the keyless Google path must stay selectable')
      }
      expect(resolved.descriptor.provider).toBe('google')
      expect(resolved.descriptor.official).toBe(false)
      expect(resolved.descriptor.tiles).toEqual([
        'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
      ])
      expect(resolved.descriptor.notice).toBe(GOOGLE_KEY_PROMPT)
      expect(resolved.descriptor.notice).toBe(
        'Enter a Google Maps API key to load the official Google tiles.',
      )
    }
  })

  it('never downgrades a configured official key when the provider fails', () => {
    // Resolution is configuration-only: an official descriptor stays official so
    // a later session failure is reported as a provider error rather than
    // silently replaced by keyless tiles.
    const resolved = resolveBasemapAvailability('google_satellite', {
      googleMapsApiKey: 'fake-key',
    })
    if (resolved.state !== 'ready') throw new Error('must resolve')
    expect(resolved.descriptor.official).toBe(true)
    expect(resolved.descriptor.tiles[0]).toContain('tile.googleapis.com')
  })

  it('coerces unknown or corrupt stored values to street', () => {
    expect(coerceBasemapStyle('unknown')).toBe('street')
    expect(coerceBasemapStyle(null)).toBe('street')
    expect(coerceBasemapStyle(undefined)).toBe('street')
    expect(coerceBasemapStyle('')).toBe('street')
    // The two satellite identities survive, because they are real choices.
    expect(coerceBasemapStyle('satellite')).toBe('satellite')
    expect(coerceBasemapStyle('google_satellite')).toBe('google_satellite')
    expect(isBasemapStyleRenderable('unknown')).toBe(true)
  })

  it('gives each provider the tile size and zoom ceiling it actually serves', () => {
    const street = resolveBasemapAvailability('street')
    const google = resolveBasemapAvailability('google_satellite')
    if (street.state !== 'ready' || google.state !== 'ready') throw new Error('must resolve')
    expect(street.descriptor.tileSize).toBe(256)
    expect(street.descriptor.maxzoom).toBe(19)
    expect(google.descriptor.tileSize).toBe(256)
    expect(google.descriptor.maxzoom).toBe(22)
  })
})
