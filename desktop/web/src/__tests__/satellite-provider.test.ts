import { describe, expect, it } from 'vitest'
import {
  EOX_SATELLITE_ATTRIBUTION,
  EOX_SATELLITE_TILES,
  GOOGLE_KEY_REQUIRED_REASON,
  GOOGLE_SESSION_TILES,
  resolveSatelliteAvailability,
} from '../maplibre/satellite-provider'

describe('shared satellite provider resolution', () => {
  it('serves EOX Sentinel-2 cloudless keylessly with its attribution and zoom ceiling', () => {
    for (const config of [{}, { googleMapsApiKey: null }, { googleMapsApiKey: 'fake-key' }]) {
      const resolved = resolveSatelliteAvailability('eox', config)
      if (resolved.state !== 'ready') throw new Error('eox must be ready without a key')
      expect(resolved.descriptor.provider).toBe('eox')
      expect(resolved.descriptor.tiles).toEqual([EOX_SATELLITE_TILES])
      expect(resolved.descriptor.attribution).toBe(EOX_SATELLITE_ATTRIBUTION)
      expect(resolved.descriptor.attribution).toContain('EOX')
      expect(resolved.descriptor.maxzoom).toBe(17)
      expect(resolved.descriptor.tileSize).toBe(256)
      expect(resolved.descriptor.official).toBe(false)
      // EOX never carries a Google key, even when one is configured.
      expect(JSON.stringify(resolved.descriptor)).not.toContain('fake-key')
    }
  })

  it('marks Google without a key unavailable instead of substituting another provider', () => {
    for (const config of [
      {},
      { googleMapsApiKey: undefined },
      { googleMapsApiKey: null },
      { googleMapsApiKey: '   ' },
    ]) {
      const resolved = resolveSatelliteAvailability('google', config)
      expect(resolved).toEqual({
        state: 'unavailable',
        provider: 'google',
        reason: GOOGLE_KEY_REQUIRED_REASON,
      })
    }
  })

  it('keeps a configured Google key on the credential-free official session template', () => {
    const resolved = resolveSatelliteAvailability('google', {
      googleMapsApiKey: '  fake-recognizable-key  ',
    })
    if (resolved.state !== 'ready') throw new Error('google with a key must be ready')
    expect(resolved.descriptor.provider).toBe('google')
    expect(resolved.descriptor.official).toBe(true)
    // The published template is credential-free. Both the live session token
    // and the key are supplied per request by the map's tile transport, because
    // a descriptor carrying either could be persisted, exported or logged.
    expect(resolved.descriptor.tiles).toEqual([GOOGLE_SESSION_TILES])
    expect(GOOGLE_SESSION_TILES).toBe(
      'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}',
    )
    expect(JSON.stringify(resolved.descriptor)).not.toContain('fake-recognizable-key')
    expect(resolved.descriptor.tileSize).toBe(256)
    expect(resolved.descriptor.maxzoom).toBe(22)
  })
})
