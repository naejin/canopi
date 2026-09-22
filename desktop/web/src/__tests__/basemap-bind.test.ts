import { describe, expect, it, vi } from 'vitest'
import { BasemapProvider, type BasemapProviderHttp } from '../maplibre/basemap-provider-session'
import {
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from '../maplibre/config'
import { applyBasemapVisibility, bindBasemapProvider } from '../maplibre/basemap-bind'
import type { BasemapReconcileTarget } from '../maplibre/basemap-contribution'

const VIEWPORT = { west: -1, south: 48, east: 1, north: 49, zoom: 14 }

/** A recording stand-in for a live map, narrowed to what the binding may touch. */
function recordingMap() {
  const sources = new Map<string, unknown>()
  const layers = new Map<string, unknown>()
  const layout = new Map<string, unknown>()
  const calls: string[] = []
  const target: BasemapReconcileTarget = {
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

const inertHttp: BasemapProviderHttp = {
  async request() {
    return { ok: false, status: 500, json: null, retryAfterSeconds: null }
  },
}

describe('basemap provider binding', () => {
  it('adopts the provider it is bound to without touching the map style', () => {
    const provider = new BasemapProvider(inertHttp, {})
    provider.update({ style: 'street' }, VIEWPORT)
    const map = recordingMap()

    const dispose = bindBasemapProvider({ provider, map: map.target })

    // A map created after the provider resolved must still show imagery, which
    // is why the binding adopts the snapshot rather than waiting for a change.
    expect(map.layers.has(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)).toBe(true)
    expect(map.sources.has(MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(true)

    // The whole point of the binding: nothing here recreates the map or resets
    // its style, so a provider change cannot disturb the camera or the scene.
    expect(map.calls.some((call) => call.includes('setStyle'))).toBe(false)
    dispose()
  })

  it('reconciles on every published provider change and never accumulates sources', () => {
    const provider = new BasemapProvider(inertHttp, { mapTilerKey: 'fake-key' })
    provider.update({ style: 'street' }, VIEWPORT)
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target })

    provider.update({ style: 'satellite' }, VIEWPORT)

    // One contribution, not two: the previous source is removed before the new
    // one is added so a provider switch cannot leave both on the map.
    expect(map.sources.size).toBe(1)
    expect(map.layers.size).toBe(1)
    const added = map.calls.filter((call) => call.startsWith('addSource:'))
    expect(added.length).toBe(2)
    expect(map.calls.filter((call) => call.startsWith('removeSource:')).length).toBe(1)
    dispose()
  })

  it('withdraws the contribution when the provider cannot serve', () => {
    const provider = new BasemapProvider(inertHttp, {})
    provider.update({ style: 'street' }, VIEWPORT)
    const map = recordingMap()
    const dispose = bindBasemapProvider({ provider, map: map.target })

    // Satellite with no build key is a real unavailable state, not a reason to
    // render another provider's imagery under its name.
    provider.update({ style: 'satellite' }, VIEWPORT)

    expect(provider.snapshot().state).toBe('unavailable')
    expect(map.sources.has(MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(false)
    expect(map.layers.has(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)).toBe(false)
    dispose()
  })

  it('applies visibility to the live contribution and stops when disposed', () => {
    const provider = new BasemapProvider(inertHttp, {})
    provider.update({ style: 'street' }, VIEWPORT)
    const map = recordingMap()
    const dispose = bindBasemapProvider({
      provider,
      map: map.target,
      visible: () => false,
    })

    expect(map.layout.get(`${MAPLIBRE_BASEMAP_RASTER_LAYER_ID}:visibility`)).toBe('none')

    // Hiding is a layout change only: it must not re-request tiles or drop the
    // source, so the provider session survives a hidden basemap.
    applyBasemapVisibility(map.target, true)
    expect(map.layout.get(`${MAPLIBRE_BASEMAP_RASTER_LAYER_ID}:visibility`)).toBe('visible')

    const afterDispose = map.calls.length
    dispose()
    provider.update({ style: 'satellite' }, VIEWPORT)
    // A disposed binding must stop mutating the map, which is what keeps a
    // torn-down surface from being written to after its map is gone.
    expect(map.calls.length).toBe(afterDispose)
  })

  it('drives the map from the provider rather than from the caller', () => {
    const provider = new BasemapProvider(inertHttp, {})
    const map = recordingMap()
    const listener = vi.fn()
    provider.subscribe(listener)

    const dispose = bindBasemapProvider({ provider, map: map.target })
    provider.update({ style: 'street' }, VIEWPORT)

    // The binding is a provider subscriber, so a caller that only updates the
    // provider still gets a reconciled map without any extra plumbing.
    expect(listener).toHaveBeenCalled()
    expect(map.layers.has(MAPLIBRE_BASEMAP_RASTER_LAYER_ID)).toBe(true)
    dispose()
  })
})
