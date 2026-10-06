import { afterEach, describe, expect, it, vi } from 'vitest'
import { signal } from '@preact/signals'
import { googleMapsApiKey, satelliteSource } from '../app/settings/state'
import { MAPLIBRE_SATELLITE_LAYER_ID, MAPLIBRE_SATELLITE_SOURCE_ID } from '../maplibre/config'
import { BasemapTileAuth } from '../maplibre/basemap-tile-auth'
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
  // MapLibre's attribution markup, as a compact control first renders it (shown).
  const container = document.createElement('div')
  const credits = document.createElement('details')
  credits.className = 'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-compact maplibregl-compact-show'
  credits.setAttribute('open', '')
  container.append(credits)
  const map = {
    credits,
    getContainer: () => container,
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
    setGlobalStateProperty: vi.fn(),
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
    tileAuth: new BasemapTileAuth(),
    lifetime: { on: () => {}, off: () => {} },
    loadStyle: async () => STYLE,
  })
  return { map, background }
}

const ids = (map: ReturnType<typeof createMap>) => map.layers.map((layer) => String(layer.id))

afterEach(() => {
  googleMapsApiKey.value = null
  satelliteSource.value = 'free'
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
    satelliteSource.value = 'google_key'
    googleMapsApiKey.value = 'SECRET-KEY'
    await settle()
    expect(map.sources.has(MAPLIBRE_SATELLITE_SOURCE_ID)).toBe(false)
    expect(map.setStyle).not.toHaveBeenCalled()
    background.dispose()
  })

  it('keeps the free imagery while a saved key is not the chosen source, and switches on choosing it', async () => {
    const fetchStub = vi.fn(async () => new Response('{}', { status: 403 }))
    vi.stubGlobal('fetch', fetchStub)
    satelliteSource.value = 'free'
    googleMapsApiKey.value = 'SECRET-KEY'
    const { map, background } = mount()
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(map.sources.get(MAPLIBRE_SATELLITE_SOURCE_ID)?.tiles).toEqual([GOOGLE_KEYLESS_TILES])
    expect(fetchStub).not.toHaveBeenCalled()

    satelliteSource.value = 'google_key'
    await settle()
    expect(map.sources.has(MAPLIBRE_SATELLITE_SOURCE_ID)).toBe(false)
    expect(fetchStub).toHaveBeenCalled()
    background.dispose()
  })

  it('reports whether the latest presentation is on the map', async () => {
    const { map, background } = mount()
    expect(background.isApplied()).toBe(false)
    background.update(presentation())
    expect(background.isApplied()).toBe(false)
    await settle()
    expect(background.isApplied()).toBe(true)
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(background.isApplied()).toBe(true)
    map.removeLayer(MAPLIBRE_SATELLITE_LAYER_ID)
    expect(background.isApplied()).toBe(false)
    background.update(presentation({ basemapVisible: false }))
    await settle()
    expect(background.isApplied()).toBe(true)
    background.dispose()
    expect(background.isApplied()).toBe(false)
  })

  it('keeps the credits expanded: the attribution control collapses only on a narrow map', async () => {
    const { map, background } = mount()
    background.update(presentation())
    await settle()
    // compact: true would fold the credits into an (i) after the first drag;
    // left unset, MapLibre folds them only when the map is 640 px or narrower.
    expect(map.controls[0]!.options.compact).toBeUndefined()
    background.dispose()
  })

  it('folds the credits into the (i) button when the workspace asks, and unfolds them again', async () => {
    const { map, background } = mount()
    background.update(presentation())
    await settle()
    background.setAttributionCompact(true)
    expect(map.controls).toHaveLength(1)
    expect(map.controls[0]!.options.compact).toBe(true)
    // Folded, not merely compact: the credits wait behind the button.
    expect(map.credits.classList.contains('maplibregl-compact-show')).toBe(false)

    background.setAttributionCompact(true)
    expect(map.controls).toHaveLength(1)
    background.setAttributionCompact(false)
    expect(map.controls).toHaveLength(1)
    expect(map.controls[0]!.options.compact).toBe(false)

    // A Google credit remounts the control; it keeps the fold.
    background.setAttributionCompact(true)
    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(map.controls[0]!.options).toMatchObject({ compact: true, customAttribution: '&copy; Google' })
    background.dispose()
  })

  it('folds the credits once MapLibre makes them compact, when the first credits arrive after mounting', async () => {
    const map = createMap()
    map.credits.className = 'maplibregl-ctrl maplibregl-ctrl-attrib maplibregl-attrib-empty'
    const { background } = mount(map)
    background.setAttributionCompact(true)
    map.credits.classList.add('maplibregl-compact', 'maplibregl-compact-show')
    await settle()
    expect(map.credits.classList.contains('maplibregl-compact')).toBe(true)
    expect(map.credits.classList.contains('maplibregl-compact-show')).toBe(false)
    // After that the (i) button is the user's: showing the credits sticks.
    map.credits.classList.add('maplibregl-compact-show')
    await settle()
    expect(map.credits.classList.contains('maplibregl-compact-show')).toBe(true)
    background.dispose()
  })

  it('reports a Basemap that failed to load until Satellite hides it', async () => {
    const statuses: string[] = []
    const background = mountMapBackground({
      map: createMap() as never,
      maplibre: { AttributionControl: FakeControl },
      tileAuth: new BasemapTileAuth(),
      lifetime: { on: () => {}, off: () => {} },
      loadStyle: async () => { throw new Error('Basemap style request failed (503).') },
      onBasemapStatus: (status) => statuses.push(status),
    })
    background.update(presentation())
    await settle()
    expect(statuses).toEqual(['loading', 'failed'])

    background.update(presentation({ satelliteVisible: true }))
    await settle()
    expect(statuses).toEqual(['loading', 'failed', 'idle'])
    background.dispose()
  })

  // The workspace sends its presentation again whenever the view or the visible map area changes; offline, each resend
  // downloaded the style again and flickered the notice between loading and failed (ADR 0004: only Retry downloads).
  it('downloads nothing again for the same presentation after a failed Basemap; Retry downloads it again', async () => {
    const statuses: string[] = []
    const loadStyle = vi.fn(async () => { throw new Error('Basemap style request failed (503).') })
    const background = mountMapBackground({
      map: createMap() as never,
      maplibre: { AttributionControl: FakeControl },
      tileAuth: new BasemapTileAuth(),
      lifetime: { on: () => {}, off: () => {} },
      loadStyle,
      onBasemapStatus: (status) => statuses.push(status),
    })
    background.update(presentation())
    await settle()
    background.update(presentation())
    background.update(presentation())
    await settle()
    expect(loadStyle).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(['loading', 'failed'])

    background.retry(presentation())
    await settle()
    expect(loadStyle).toHaveBeenCalledTimes(2)
    expect(statuses).toEqual(['loading', 'failed', 'loading', 'failed'])
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
    satelliteSource.value = 'google_key'
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
