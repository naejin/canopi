import { describe, expect, it } from 'vitest'
import {
  GOOGLE_KEYLESS_TILES,
  GOOGLE_SESSION_TILES,
  resolveSatelliteDescriptor,
} from '../maplibre/satellite-provider'

describe('shared satellite descriptor resolution', () => {
  it('serves Google keylessly from its public tile endpoint until a key is configured', () => {
    for (const config of [
      undefined,
      {},
      { googleMapsApiKey: undefined },
      { googleMapsApiKey: null },
      { googleMapsApiKey: '   ' },
    ]) {
      const descriptor = resolveSatelliteDescriptor(config)
      expect(descriptor.official).toBe(false)
      expect(descriptor.tiles).toEqual([GOOGLE_KEYLESS_TILES])
      expect(GOOGLE_KEYLESS_TILES).toBe('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}')
      expect(descriptor.attribution).toBe('&copy; Google')
      expect(descriptor.maxzoom).toBe(20)
      expect(descriptor.tileSize).toBe(256)
    }
  })

  it('keeps a configured Google key on the credential-free official session template', () => {
    const descriptor = resolveSatelliteDescriptor({
      googleMapsApiKey: '  fake-recognizable-key  ',
    })
    expect(descriptor.official).toBe(true)
    // The published template is credential-free. Both the live session token
    // and the key are supplied per request by the map's tile transport, because
    // a descriptor carrying either could be persisted, exported or logged.
    expect(descriptor.tiles).toEqual([GOOGLE_SESSION_TILES])
    expect(GOOGLE_SESSION_TILES).toBe(
      'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}',
    )
    expect(JSON.stringify(descriptor)).not.toContain('fake-recognizable-key')
    expect(descriptor.attribution).toContain('Google')
    expect(descriptor.tileSize).toBe(256)
    expect(descriptor.maxzoom).toBe(22)
  })

  it('names no imagery provider on the descriptor', () => {
    expect(resolveSatelliteDescriptor()).not.toHaveProperty('provider')
    expect(resolveSatelliteDescriptor({ googleMapsApiKey: 'key' })).not.toHaveProperty('provider')
  })
})
