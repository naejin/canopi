import { describe, expect, it, vi } from 'vitest'
import {
  BasemapProvider,
  type BasemapProviderHttp,
  type BasemapProviderResponse,
} from '../maplibre/basemap-provider-session'
import {
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from '../maplibre/config'
import { bindBasemapProvider } from '../maplibre/basemap-bind'
import type { BasemapReconcileTarget } from '../maplibre/basemap-contribution'

const API_KEY = 'fake-google-key-0123456789'
const SESSION_TOKEN = 'fake-session-token'
const VIEWPORT = { west: -1, south: 48, east: 1, north: 49, zoom: 14 }

/** A recording map, narrowed to what the binding is allowed to touch. */
function recordingMap() {
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, Record<string, unknown>>()
  const target: BasemapReconcileTarget = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => void layers.delete(id),
    removeSource: (id) => void sources.delete(id),
    addSource: (id, source) => void sources.set(id, source),
    addLayer: (layer) => void layers.set(String(layer.id), layer),
    setLayoutProperty: () => {},
  }
  return { target, sources, layers }
}

/** A scripted Google tier: one session answer, then one viewport answer. */
function googleHttp(options: { sessionOk?: boolean } = {}) {
  const calls: Array<{ url: string; method?: string }> = []
  const http: BasemapProviderHttp = {
    async request(input) {
      calls.push({ url: input.url, method: input.method })
      if (input.url.includes('createSession')) {
        if (options.sessionOk === false) {
          return { ok: false, status: 403, json: null, retryAfterSeconds: null }
        }
        return {
          ok: true,
          status: 200,
          json: {
            session: SESSION_TOKEN,
            expiry: 4_000_000_000,
            tileWidth: 512,
            tileHeight: 512,
          },
        } as BasemapProviderResponse
      }
      return {
        ok: true,
        status: 200,
        json: { copyright: 'Imagery ©2026 Google' },
      } as BasemapProviderResponse
    },
  }
  return { http, calls }
}

describe('Google official provider drives the live map', () => {
  it('publishes the session tile descriptor into the map without leaking the key into state', async () => {
    const { http, calls } = googleHttp()
    const provider = new BasemapProvider(http, { googleMapsApiKey: API_KEY })
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))

    // The session request is the one place the key belongs.
    expect(calls[0]?.url).toContain('createSession')
    expect(calls[0]?.url).toContain(API_KEY)

    // The map received a raster source for the official endpoint.
    const source = map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)
    expect(source, 'the binding must reconcile a source for a ready provider').toBeDefined()
    expect(source?.type).toBe('raster')
    const tiles = source?.tiles as string[]
    expect(tiles.length).toBeGreaterThan(0)
    expect(tiles[0]).toContain('tile.googleapis.com')
    // The session path is the official one, not the keyless fallback.
    expect(provider.snapshot()).toMatchObject({
      state: 'ready',
      descriptor: { provider: 'google', official: true },
    })
    expect(map.layers.has(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)).toBe(true)
    dispose()
  })

  it('never puts the session token in the published state or the map source', async () => {
    const { http } = googleHttp()
    const provider = new BasemapProvider(http, { googleMapsApiKey: API_KEY })
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    // A viewport request has to happen for the session to be exercised at all.
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))

    // The token travels in a request header or URL the provider owns, never in
    // what a caller can persist: not in the published state, not in the map's
    // source definition. This is the boundary ADR 0028 names for the key, applied
    // to the session credential too.
    expect(JSON.stringify(provider.snapshot())).not.toContain(SESSION_TOKEN)
    expect(JSON.stringify([...map.sources.entries()])).not.toContain(SESSION_TOKEN)
    dispose()
  })

  it('withdraws the contribution and sanitizes the reason when the key is rejected', async () => {
    const { http } = googleHttp({ sessionOk: false })
    const provider = new BasemapProvider(http, { googleMapsApiKey: API_KEY })
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target })

    // A street basemap first, so withdrawal is observable rather than vacuous.
    provider.update({ style: 'street' }, VIEWPORT)
    expect(map.sources.has(MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(true)

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('unavailable'))

    const snapshot = provider.snapshot()
    if (snapshot.state !== 'unavailable') throw new Error('expected unavailable')
    // A rejected key must not silently downgrade to another provider's imagery.
    expect(snapshot.reason).not.toContain(API_KEY)
    expect(map.sources.has(MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(false)
    dispose()
  })

  it('keeps the map contribution stable across a key change without recreating it', async () => {
    const { http } = googleHttp()
    const provider = new BasemapProvider(http, { googleMapsApiKey: API_KEY })
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    const firstSource = map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)
    expect(firstSource).toBeDefined()

    // A re-issued generation, as a settings change produces.
    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))

    // Still exactly one contribution. The binding reconciles; it never
    // accumulates sources, which is what a map recreation would have avoided at
    // the cost of the camera and the scene.
    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(1)
    dispose()
  })
})
