import { afterEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals'
import { googleMapsApiKey } from '../app/settings/state'
import { MAPLIBRE_SATELLITE_LAYER_ID, MAPLIBRE_SATELLITE_SOURCE_ID } from '../maplibre/config'
import { mountMapBackground, type MapBackgroundPresentation } from '../maplibre/map-background'
import type { VectorStyleDocument } from '../maplibre/openfreemap-basemap'
import { GOOGLE_KEYLESS_TILES } from '../maplibre/satellite-provider'

const STYLE: VectorStyleDocument = {
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sprite: 'https://tiles.openfreemap.org/sprites/ofm',
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [{ id: 'water', type: 'fill', source: 'openmaptiles', paint: {} }],
}

class FakeControl {
  constructor(readonly options: { compact?: boolean; customAttribution?: string }) {}
}

function createMap() {
  const sources = new Map<string, Record<string, unknown>>()
  const layers: Record<string, unknown>[] = [{ id: 'basemap-background' }, { id: 'canopi-scene' }]
  const controls: FakeControl[] = []
  const map = {
    sources,
    layers,
    controls,
    setStyle: vi.fn(),
    isStyleLoaded: () => true,
    getLayersOrder: () => layers.map((layer) => String(layer.id)),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: Record<string, unknown>) => { sources.set(id, source) },
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
    addControl: (control: FakeControl) => { controls.push(control) },
    removeControl: (control: FakeControl) => {
      const index = controls.indexOf(control)
      if (index >= 0) controls.splice(index, 1)
    },
  }
  return map
}

function presentation(overrides: Partial<{
  basemapVisible: boolean
  satelliteVisible: boolean
}> = {}): MapBackgroundPresentation {
  return {
    basemap: { style: 'liberty', visible: overrides.basemapVisible ?? true, opacity: 1 },
    satellite: { visible: overrides.satelliteVisible ?? false, opacity: 0.7 },
    locale: 'en',
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

function mount(map = createMap()) {
  const background = mountMapBackground({
    map: map as never,
    maplibre: { AttributionControl: FakeControl },
    tileAuth: null,
    lifetime: { on: () => {}, off: () => {} },
    loadStyle: async () => STYLE,
  })
  return { map, background }
}

const ids = (map: ReturnType<typeof createMap>) => map.layers.map((layer) => String(layer.id))

afterEach(() => {
  googleMapsApiKey.value = null
  vi.unstubAllGlobals()
})

describe('map background band', () => {
  it('installs the OpenFreeMap basemap beneath Canopi layers without setStyle and with one attribution control', async () => {
    const { map, background } = mount()
    background.update(presentation())
    await settle()
    expect(ids(map)).toEqual(['basemap-background', 'ofm:water', 'canopi-scene'])
    expect(map.setStyle).not.toHaveBeenCalled()
    expect(map.controls).toHaveLength(1)
    background.dispose()
    expect(map.controls).toHaveLength(0)
    expect(ids(map)).toEqual(['basemap-background', 'canopi-scene'])
  })

  it('hides the Basemap while Satellite is on and restores it when Satellite is off', async () => {
    const { map, background } = mount()
    background.update(presentation())
    await settle()
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(ids(map)).toEqual(['basemap-background', MAPLIBRE_SATELLITE_LAYER_ID, 'canopi-scene'])
    expect(map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID)?.tiles).toEqual([GOOGLE_KEYLESS_TILES])
    expect((map.getLayer(MAPLIBRE_SATELLITE_LAYER_ID) as { paint: Record<string, unknown> }).paint['raster-opacity']).toBe(0.7)
    background.update(presentation())
    await settle()
    expect(ids(map)).toEqual(['basemap-background', 'ofm:water', 'canopi-scene'])
    expect(map.sources.has(MAPLIBRE_SATELLITE_SOURCE_ID)).toBe(false)
  })

  it('serves Google keyless tiles with Google credit when no device key is set', async () => {
    const { map, background } = mount()
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID)?.tiles).toEqual([GOOGLE_KEYLESS_TILES])
    expect(ids(map)).toEqual(['basemap-background', MAPLIBRE_SATELLITE_LAYER_ID, 'canopi-scene'])
    expect(String(map.controls[0]!.options.customAttribution ?? '')).toContain('Google')
  })

  it('withdraws keyless tiles when a device key is saved while Satellite is on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    const { map, background } = mount()
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID)?.tiles).toEqual([GOOGLE_KEYLESS_TILES])

    // The key reaches the live mount through its settings observer, with no
    // presentation change and no map recreation.
    googleMapsApiKey.value = 'SECRET-KEY'
    await settle()
    expect(map.sources.has(MAPLIBRE_SATELLITE_SOURCE_ID)).toBe(false)
    expect(map.setStyle).not.toHaveBeenCalled()
    background.dispose()
  })

  it('adds no remote source when every background row is hidden', async () => {
    const { map, background } = mount()
    background.update(presentation({ basemapVisible: false }))
    await settle()
    expect(map.sources.size).toBe(0)
  })

  it('credits Google through the single attribution control', async () => {
    const { map, background } = mount()
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(map.controls).toHaveLength(1)
    expect(map.controls[0]!.options.customAttribution).toBe('&copy; Google')
    background.update(presentation())
    await settle()
    expect(map.controls).toHaveLength(1)
    expect(map.controls[0]!.options.customAttribution).toBeUndefined()
  })

  it('never puts the Google key into map state', async () => {
    googleMapsApiKey.value = 'SECRET-KEY'
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ session: 'S', expiry: '9999999999' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchStub)
    const { map, background } = mount()
    const seen = signal('')
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    seen.value = JSON.stringify([...map.sources.entries(), map.layers, map.controls.map((control) => control.options)])
    expect(seen.value).not.toContain('SECRET-KEY')
    background.dispose()
  })
})
