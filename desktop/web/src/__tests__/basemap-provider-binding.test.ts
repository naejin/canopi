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
import { BasemapTileAuth } from '../maplibre/basemap-tile-auth'
import type { BasemapReconcileTarget } from '../maplibre/basemap-contribution'

const API_KEY = 'fake-google-key-0123456789'
const SESSION_TOKEN = 'fake-session-token'
const COPYRIGHT = 'Imagery ©2026 Google'
const OFFICIAL_TILE = 'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}'
const VIEWPORT = { west: -1, south: 48, east: 1, north: 49, zoom: 14 }

/** A recording map, narrowed to what the binding is allowed to touch. */
function recordingMap() {
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, Record<string, unknown>>()
  const layout = new Map<string, Record<string, unknown>>()
  const target: BasemapReconcileTarget = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => void layers.delete(id),
    removeSource: (id) => void sources.delete(id),
    addSource: (id, source) => void sources.set(id, source),
    addLayer: (layer) => void layers.set(String(layer.id), layer),
    setLayoutProperty: (id, name, value) => {
      layout.set(id, { ...(layout.get(id) ?? {}), [name]: value })
    },
  }
  return { target, sources, layers, layout }
}

/** A scripted Google tier: one session answer, then one viewport answer. */
function googleHttp(options: { sessionOk?: boolean; viewportOk?: boolean } = {}) {
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
            // The documented response carries expiry as an epoch-seconds string.
            expiry: '4000000000',
            tileWidth: 512,
            tileHeight: 512,
          },
        } as BasemapProviderResponse
      }
      if (options.viewportOk === false) {
        // A rejected credential is not retried, so the failure is observable
        // without waiting out the transient retry budget.
        return { ok: false, status: 403, json: null, retryAfterSeconds: null }
      }
      return {
        ok: true,
        status: 200,
        json: {
          copyright: COPYRIGHT,
          maxZoomRects: [{ north: 49, south: 48, east: 1, west: -1, maxZoom: 21 }],
        },
      } as BasemapProviderResponse
    },
  }
  return { http, calls }
}

function officialProvider(http: BasemapProviderHttp, tileAuth: BasemapTileAuth) {
  return new BasemapProvider(
    http,
    { googleMapsApiKey: API_KEY },
    () => Date.now(),
    (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    tileAuth,
  )
}

describe('Google official provider drives the live map', () => {
  it('serves an authenticated tile request through the map transport', async () => {
    const { http, calls } = googleHttp()
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target, tileAuth })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))

    // The session request is authenticated with the key.
    expect(calls[0]?.url).toContain('createSession')
    expect(calls[0]?.url).toContain(API_KEY)

    const source = map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)
    expect(source, 'the binding must reconcile a source for a ready provider').toBeDefined()
    expect(source?.type).toBe('raster')
    const tiles = source?.tiles as string[]
    // The published descriptor is credential-free: the template names the
    // official endpoint and leaves the session to the transport.
    expect(tiles[0]).toBe(OFFICIAL_TILE)
    expect(tiles[0]).not.toContain(SESSION_TOKEN)
    expect(tiles[0]).not.toContain(API_KEY)

    // The request the map would actually make carries the live session and the
    // key. A token that never reaches a tile request is a broken URL, not a
    // privacy success.
    const outgoing = tileAuth.authorize(
      (tiles[0] ?? '').split('{z}').join('14').split('{x}').join('8192').split('{y}').join('5461'),
    )
    expect(outgoing).toContain(`session=${SESSION_TOKEN}`)
    expect(outgoing).toContain(`key=${API_KEY}`)
    expect(outgoing).not.toContain('{session}')

    expect(provider.snapshot()).toMatchObject({
      state: 'ready',
      descriptor: { provider: 'google', official: true, tileSize: 512 },
    })
    expect(map.layers.has(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)).toBe(true)
    dispose()
  })

  it('never puts the session token in the published state or the map source', async () => {
    const { http } = googleHttp()
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target, tileAuth })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))

    expect(JSON.stringify(provider.snapshot())).not.toContain(SESSION_TOKEN)
    expect(JSON.stringify(provider.snapshot())).not.toContain(API_KEY)
    expect(JSON.stringify([...map.sources.entries()])).not.toContain(SESSION_TOKEN)
    expect(JSON.stringify([...map.sources.entries()])).not.toContain(API_KEY)

    // Disposal stops the transport authenticating: the credential belongs to
    // the map that installed it.
    dispose()
    expect(tileAuth.installed).toBe(false)
    expect(tileAuth.authorize(OFFICIAL_TILE)).toContain('{session}')
  })

  it('withdraws an official contribution when the map has no tile transport', async () => {
    const { http } = googleHttp()
    const provider = new BasemapProvider(http, { googleMapsApiKey: API_KEY })
    const map = recordingMap()
    // No tileAuth: a map created without the request seam cannot resolve the
    // session template, so the binding must not install a source that would
    // request a literal `{session}`.
    const dispose = bindBasemapProvider({ provider, map: map.target })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    expect(map.sources.has(MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(false)
    dispose()
  })

  it('authenticates viewport requests and installs their attribution and zoom', async () => {
    const { http, calls } = googleHttp()
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    const unbind = bindBasemapProvider({ provider, map: map.target, tileAuth })
    provider.update({ style: 'google_satellite' }, VIEWPORT)

    await vi.waitFor(() =>
      expect(map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)?.attribution).toBe(COPYRIGHT),
    )
    const viewportCall = calls.find((call) => call.url.includes('/viewport'))
    expect(viewportCall, 'the viewport request is part of becoming usable').toBeDefined()
    expect(viewportCall?.url).toContain(`key=${API_KEY}`)
    expect(viewportCall?.url).toContain(`session=${SESSION_TOKEN}`)

    const source = map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)
    expect(source?.attribution).toBe(COPYRIGHT)
    // Availability comes from the provider's own viewport metadata, not from a
    // universal zoom ceiling.
    expect(source?.maxzoom).toBe(21)
    unbind()
    provider.dispose()
  })

  it('reports viewport metadata failure as an actionable unavailable state', async () => {
    const { http } = googleHttp({ viewportOk: false })
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    const unbind = bindBasemapProvider({ provider, map: map.target, tileAuth })
    provider.update({ style: 'google_satellite' }, VIEWPORT)

    await vi.waitFor(() => expect(provider.snapshot().state).toBe('unavailable'))
    // Imagery is not shown with attribution that cannot be established.
    expect(map.sources.has(MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(false)
    const snapshot = provider.snapshot()
    if (snapshot.state !== 'unavailable') throw new Error('expected unavailable')
    expect(snapshot.reason).not.toContain(API_KEY)
    unbind()
    provider.dispose()
  })

  it('withdraws the contribution and sanitizes the reason when the key is rejected', async () => {
    const { http } = googleHttp({ sessionOk: false })
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target, tileAuth })

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
    const key = { value: API_KEY }
    const tileAuth = new BasemapTileAuth()
    const provider = new BasemapProvider(
      http,
      () => ({ googleMapsApiKey: key.value }),
      () => Date.now(),
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      tileAuth,
    )
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target, tileAuth })

    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    const firstSource = map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)
    expect(firstSource).toBeDefined()

    // A real key change, then a re-issued generation, as a settings edit
    // produces. The provider reads the configuration per call, so the new key
    // reaches the transport without recreating the map.
    key.value = 'fake-google-key-9876543210'
    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))

    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(1)
    expect(tileAuth.authorize(OFFICIAL_TILE)).toContain('key=fake-google-key-9876543210')
    dispose()
  })

  it('waits for a mounted map style before mutating it, then applies the latest state', async () => {
    const { http } = googleHttp()
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    let ready = false
    const readyListeners: Array<() => void> = []
    const added: string[] = []
    const target: BasemapReconcileTarget = {
      ...map.target,
      addSource: (id, source) => {
        added.push(id)
        map.sources.set(id, source)
      },
    }
    const dispose = bindBasemapProvider({
      provider,
      map: target,
      tileAuth,
      styleReady: {
        isReady: () => ready,
        whenReady: (listener) => readyListeners.push(listener),
      },
    })

    provider.update({ style: 'street' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    // MapLibre loads even an inline style asynchronously, so `addSource` before
    // readiness throws; the binding must not have touched the map yet.
    expect(added).toEqual([])

    // A provider switch while the style is still loading: the state applied at
    // readiness is the latest one, not whichever arrived first.
    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    expect(added).toEqual([])

    ready = true
    for (const listener of readyListeners) listener()
    expect(added).toEqual([MAPLIBRE_BASEMAP_SOURCE_ID])
    expect(map.sources.get(MAPLIBRE_BASEMAP_SOURCE_ID)?.tiles).toEqual([OFFICIAL_TILE])
    dispose()
  })

  it('clears the transport credential when the provider is disposed', async () => {
    const { http } = googleHttp()
    const tileAuth = new BasemapTileAuth()
    const provider = officialProvider(http, tileAuth)
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target, tileAuth })
    provider.update({ style: 'google_satellite' }, VIEWPORT)
    await vi.waitFor(() => expect(provider.snapshot().state).toBe('ready'))
    expect(tileAuth.installed).toBe(true)

    provider.dispose()
    expect(tileAuth.installed).toBe(false)
    dispose()
  })
})
