import { describe, expect, it, vi } from 'vitest'
import { SatelliteImageryProvider, type SatelliteHttp } from '../maplibre/satellite-provider-session'
import {
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from '../maplibre/config'
import { mountSatelliteLifecycle, type SatelliteMountOptions } from '../maplibre/satellite-bind'
import { BasemapTileAuth } from '../maplibre/basemap-tile-auth'
import { GOOGLE_KEYLESS_TILES, GOOGLE_SESSION_TILES } from '../maplibre/satellite-provider'

const VIEWPORT = { west: -1, south: 48, east: 1, north: 49, zoom: 14 }

/** A recording stand-in for a live map, narrowed to what the Satellite mount may touch. */
function recordingMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, unknown>()
  const layout = new Map<string, unknown>()
  const calls: string[] = []
  const target: SatelliteMountOptions['map'] = {
    getSource: (id) => {
      calls.push(`getSource:${id}`)
      return sources.get(id)
    },
    getLayer: (id) => {
      calls.push(`getLayer:${id}`)
      return layers.get(id)
    },
    removeLayer: (id) => {
      calls.push(`removeLayer:${id}`)
      layers.delete(id)
    },
    removeSource: (id) => {
      calls.push(`removeSource:${id}`)
      sources.delete(id)
    },
    addSource: (id, source) => {
      calls.push(`addSource:${id}`)
      sources.set(id, source)
    },
    addLayer: (layer) => {
      const id = String(layer.id)
      calls.push(`addLayer:${id}`)
      layers.set(id, layer)
    },
    setLayoutProperty: (id, name, value) => {
      calls.push(`setLayoutProperty:${id}:${name}:${String(value)}`)
      layout.set(`${id}:${name}`, value)
    },
  }
  return { target, sources, layers, layout, calls }
}

/** Mounts `provider` on a map whose style is ready, at VIEWPORT. */
function mountOn(provider: SatelliteImageryProvider, map: SatelliteMountOptions['map']) {
  const options: SatelliteMountOptions = {
    provider,
    map,
    readViewport: () => VIEWPORT,
    styleReady: { isReady: () => true, whenReady: () => () => {} },
    beforeLayerId: () => null,
    afterApply: () => {},
    events: { on: () => {}, off: () => {} },
    replaceSatelliteAttribution: () => {},
  }
  return mountSatelliteLifecycle(options)
}

const inertHttp: SatelliteHttp = {
  async request() {
    return { ok: false, status: 500, json: null, retryAfterSeconds: null }
  },
}

/** A Google tier that grants a session and confirms every viewport. */
const googleHttp: SatelliteHttp = {
  async request(input) {
    if (input.url.includes('createSession')) {
      return {
        ok: true,
        status: 200,
        json: { session: 'fake-session', expiry: '4000000000', tileWidth: 256, tileHeight: 256 },
      }
    }
    return {
      ok: true,
      status: 200,
      json: {
        copyright: 'Imagery ©2026 Google',
        maxZoomRects: [{ north: 49, south: 48, east: 1, west: -1, maxZoom: 21 }],
      },
    }
  },
}

describe('satellite mount', () => {
  it('shows the provider\'s imagery from the current configuration', () => {
    const provider = new SatelliteImageryProvider(inertHttp, () => ({}))
    const map = recordingMap()

    const mount = mountOn(provider, map.target)

    // No movement, settings or style-ready event is needed for the first imagery.
    expect(map.layers.has(MAPLIBRE_SATELLITE_LAYER_ID)).toBe(true)
    expect(map.sources.has(MAPLIBRE_SATELLITE_SOURCE_ID)).toBe(true)
    mount.dispose()
  })

  it('reconciles on every published change and never accumulates sources', async () => {
    const tileAuth = new BasemapTileAuth()
    const config: { googleMapsApiKey: string | null } = { googleMapsApiKey: null }
    const provider = new SatelliteImageryProvider(
      googleHttp,
      () => config,
      () => Date.now(),
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      tileAuth,
    )
    const map = recordingMap()
    const mount = mountOn(provider, map.target)
    expect((map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID) as { tiles: string[] }).tiles)
      .toEqual([GOOGLE_KEYLESS_TILES])

    config.googleMapsApiKey = 'fake-key'
    provider.update(VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    expect((map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID) as { tiles: string[] }).tiles)
      .toEqual([GOOGLE_SESSION_TILES])

    // One contribution, not two: the previous source is removed before the new
    // one is added so adding a key cannot leave both on the map.
    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(1)
    const added = map.calls.filter((call) => call.startsWith('addSource:'))
    expect(added.length).toBe(2)
    expect(map.calls.filter((call) => call.startsWith('removeSource:')).length).toBe(1)
    mount.dispose()
  })

  it('replaces official session tiles with keyless tiles when the key is cleared', async () => {
    const tileAuth = new BasemapTileAuth()
    const config: { googleMapsApiKey: string | null } = { googleMapsApiKey: 'fake-key' }
    const provider = new SatelliteImageryProvider(
      googleHttp,
      () => config,
      () => Date.now(),
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      tileAuth,
    )
    const map = recordingMap()
    const mount = mountOn(provider, map.target)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    expect(tileAuth.installed).toBe(true)

    config.googleMapsApiKey = null
    provider.update(VIEWPORT)

    // The cleared key drops the session credential with it.
    expect(tileAuth.installed).toBe(false)
    expect(provider.snapshot().state).toBe('ready')
    expect((map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID) as { tiles: string[] }).tiles).toEqual([GOOGLE_KEYLESS_TILES])
    expect(map.layers.has(MAPLIBRE_SATELLITE_LAYER_ID)).toBe(true)
    mount.dispose()
  })

  it('withdraws its contribution when disposed and then stops mutating the map', () => {
    const provider = new SatelliteImageryProvider(inertHttp, () => ({}))
    const map = recordingMap()
    const mount = mountOn(provider, map.target)
    expect(map.layout.get(`${MAPLIBRE_SATELLITE_LAYER_ID}:visibility`)).toBe('visible')

    mount.dispose()
    expect(map.sources.size).toBe(0)
    expect(map.layers.size).toBe(0)
    const afterDispose = map.calls.length
    provider.update(VIEWPORT)
    // A disposed mount must stop mutating the map, which is what keeps a
    // torn-down surface from being written to after its map is gone.
    expect(map.calls.length).toBe(afterDispose)
  })

  it('drives the map from the provider rather than from the caller', () => {
    const provider = new SatelliteImageryProvider(inertHttp, () => ({}))
    const map = recordingMap()
    const listener = vi.fn()
    provider.subscribe(listener)

    const mount = mountOn(provider, map.target)
    map.layers.clear()
    map.sources.clear()
    provider.update(VIEWPORT)

    // The mount is a provider subscriber, so a caller that only updates the
    // provider still gets a reconciled map without any extra plumbing.
    expect(listener).toHaveBeenCalled()
    expect(map.layers.has(MAPLIBRE_SATELLITE_LAYER_ID)).toBe(true)
    mount.dispose()
  })
})
