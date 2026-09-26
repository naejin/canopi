import { afterEach, describe, expect, it, vi } from 'vitest'
import { googleMapsApiKey } from '../app/settings/state'
import { MAPLIBRE_SATELLITE_SOURCE_ID } from '../maplibre/config'
import { mountMapBackground, type MapBackgroundPresentation } from '../maplibre/map-background'
import type { VectorStyleDocument } from '../maplibre/openfreemap-basemap'
import { bindSatelliteImagery, mapStyleReadiness } from '../maplibre/satellite-bind'
import { SatelliteImageryProvider, type SatelliteHttp } from '../maplibre/satellite-provider-session'
import type { SatelliteReconcileTarget } from '../maplibre/satellite-contribution'

const STYLE: VectorStyleDocument = {
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://tiles.openfreemap.org/sprites/ofm',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [{ id: 'water', type: 'fill', source: 'openmaptiles', paint: {} }],
}

const READY_EVENTS = ['load', 'style.load'] as const

/** A map lifetime that records its listeners so accumulation is observable. */
function fakeLifetime() {
  const listeners = new Map<string, Set<(event?: unknown) => void>>()
  return {
    on(type: string, listener: (event?: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    off(type: string, listener: (event?: unknown) => void) {
      listeners.get(type)?.delete(listener)
    },
    emit(type: string) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener()
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0
    },
    readyCount() {
      return READY_EVENTS.reduce((total, type) => total + (listeners.get(type)?.size ?? 0), 0)
    },
  }
}

class FakeControl {
  constructor(readonly options: { compact?: boolean; customAttribution?: string }) {}
}

function createMap() {
  const sources = new Map<string, Record<string, unknown>>()
  const layers: Record<string, unknown>[] = [{ id: 'basemap-background' }, { id: 'canopi-scene' }]
  const added: string[] = []
  const state = { ready: false }
  const map = {
    state,
    sources,
    layers,
    added,
    isStyleLoaded: () => state.ready,
    getLayersOrder: () => layers.map((layer) => String(layer.id)),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: Record<string, unknown>) => {
      added.push(id)
      sources.set(id, source)
    },
    removeSource: (id: string) => { sources.delete(id) },
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: (layer: Record<string, unknown>, beforeId?: string) => {
      const index = beforeId ? layers.findIndex((entry) => entry.id === beforeId) : layers.length
      layers.splice(index < 0 ? layers.length : index, 0, { ...layer })
    },
    removeLayer: (id: string) => {
      const index = layers.findIndex((layer) => layer.id === id)
      if (index >= 0) layers.splice(index, 1)
    },
    setPaintProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.find((entry) => entry.id === id) as { paint?: Record<string, unknown> }
      layer.paint = { ...layer.paint, [name]: value }
    },
    setLayoutProperty: (id: string, name: string, value: unknown) => {
      const layer = layers.find((entry) => entry.id === id) as { layout?: Record<string, unknown> }
      layer.layout = { ...layer.layout, [name]: value }
    },
    setGlyphs: vi.fn(),
    setSprite: vi.fn(),
    getZoom: () => 16,
    addControl: vi.fn(),
    removeControl: vi.fn(),
  }
  return map
}

function presentation(satelliteVisible: boolean): MapBackgroundPresentation {
  return {
    basemap: { style: 'liberty', visible: true, opacity: 1 },
    satellite: { visible: satelliteVisible, opacity: 0.7 },
    locale: 'en',
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function mount() {
  const map = createMap()
  const lifetime = fakeLifetime()
  const background = mountMapBackground({
    map: map as never,
    maplibre: { AttributionControl: FakeControl },
    tileAuth: null,
    lifetime,
    loadStyle: async () => STYLE,
  })
  return { map, lifetime, background }
}

const satelliteAdds = (map: ReturnType<typeof createMap>) =>
  map.added.filter((id) => id === MAPLIBRE_SATELLITE_SOURCE_ID).length

afterEach(() => {
  googleMapsApiKey.value = null
})

describe('map style readiness', () => {
  it('fires a style-ready wait at most once and removes both listeners when it fires', () => {
    const lifetime = fakeLifetime()
    const readiness = mapStyleReadiness({ isStyleLoaded: () => false }, lifetime)
    const listener = vi.fn()
    readiness.whenReady(listener)
    expect(lifetime.readyCount()).toBe(2)

    lifetime.emit('load')
    lifetime.emit('style.load')
    lifetime.emit('style.load')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(lifetime.readyCount()).toBe(0)
  })

  it('removes a pending wait on dispose and never calls it', () => {
    const lifetime = fakeLifetime()
    const readiness = mapStyleReadiness({ isStyleLoaded: () => false }, lifetime)
    const listener = vi.fn()
    const dispose = readiness.whenReady(listener)
    dispose()
    dispose()
    expect(lifetime.readyCount()).toBe(0)
    lifetime.emit('style.load')
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('map background waits for style readiness without accumulating', () => {
  it('keeps one pending wait across repeated Satellite toggles and applies once on style load', async () => {
    const { map, lifetime, background } = mount()
    for (let i = 0; i < 5; i += 1) {
      background.update(presentation(true))
      background.update(presentation(false))
    }
    background.update(presentation(true))
    expect(lifetime.readyCount()).toBeLessThanOrEqual(2)
    expect(map.added).toEqual([])

    map.state.ready = true
    lifetime.emit('load')
    lifetime.emit('style.load')
    await settle()
    expect(satelliteAdds(map)).toBe(1)
    expect(lifetime.readyCount()).toBe(0)

    // A later style load is not an apply trigger for a wait that already fired.
    lifetime.emit('style.load')
    await settle()
    expect(satelliteAdds(map)).toBe(1)
    background.dispose()
  })

  it('removes its pending wait on dispose and applies nothing when the style later loads', async () => {
    const { map, lifetime, background } = mount()
    background.update(presentation(true))
    background.update(presentation(false))
    background.update(presentation(true))
    background.dispose()
    expect(lifetime.readyCount()).toBe(0)

    map.state.ready = true
    lifetime.emit('load')
    lifetime.emit('style.load')
    await settle()
    expect(map.added).toEqual([])
  })
})

const inertHttp: SatelliteHttp = {
  async request() {
    return { ok: false, status: 500, json: null, retryAfterSeconds: null }
  },
}

describe('satellite binding style-ready wait', () => {
  it('does not accumulate waits across repeated bindings and disposes them before ready', () => {
    const map = createMap()
    const lifetime = fakeLifetime()
    const readiness = mapStyleReadiness(map, lifetime)
    const provider = new SatelliteImageryProvider(inertHttp, () => ({ googleMapsApiKey: null, locale: 'en' }))
    // Toggling Satellite off and on before the style is ready rebinds each time.
    for (let i = 0; i < 5; i += 1) {
      const unbind = bindSatelliteImagery({ provider, map: map as unknown as SatelliteReconcileTarget, styleReady: readiness })
      unbind()
    }
    expect(lifetime.readyCount()).toBe(0)

    const unbind = bindSatelliteImagery({ provider, map: map as unknown as SatelliteReconcileTarget, styleReady: readiness })
    provider.update({ west: -1, south: 48, east: 1, north: 49, zoom: 14 })
    expect(lifetime.readyCount()).toBe(2)
    map.state.ready = true
    lifetime.emit('load')
    lifetime.emit('style.load')
    expect(satelliteAdds(map)).toBe(1)
    expect(lifetime.readyCount()).toBe(0)
    lifetime.emit('style.load')
    expect(satelliteAdds(map)).toBe(1)
    unbind()
    provider.dispose()
  })
})
