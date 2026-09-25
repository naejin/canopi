import { describe, expect, it } from 'vitest'
import {
  OPENFREEMAP_BASEMAPS,
  scaleOpacity,
  VectorBasemap,
  type VectorBasemapMap,
  type VectorStyleDocument,
} from '../maplibre/openfreemap-basemap'

function styleDocument(name: string): VectorStyleDocument {
  return {
    glyphs: `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf#${name}`,
    sprite: `https://tiles.openfreemap.org/sprites/${name}`,
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      { id: 'water', type: 'fill', source: 'openmaptiles', paint: { 'fill-opacity': 0.8 } },
      {
        id: 'road',
        type: 'line',
        source: 'openmaptiles',
        paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 12, 1] },
      },
      {
        id: 'place',
        type: 'symbol',
        source: 'openmaptiles',
        layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] },
        paint: { 'text-opacity': ['step', ['zoom'], 0, 6, 1] },
      },
      {
        id: 'shield',
        type: 'symbol',
        source: 'openmaptiles',
        layout: { 'text-field': ['to-string', ['get', 'ref']] },
      },
    ],
  }
}

class FakeMap implements VectorBasemapMap {
  readonly sources = new Map<string, Record<string, unknown>>()
  readonly layers: Record<string, unknown>[] = [{ id: 'canopi-scene' }]
  readonly calls: string[] = []
  glyphs: string | null = null
  sprite: string | null = null
  setStyle = () => { throw new Error('setStyle must not be called') }
  getSource(id: string) { return this.sources.get(id) }
  addSource(id: string, source: Record<string, unknown>) { this.sources.set(id, source) }
  removeSource(id: string) { this.sources.delete(id) }
  getLayer(id: string) { return this.layers.find((layer) => layer.id === id) }
  addLayer(layer: Record<string, unknown>, beforeId?: string) {
    const index = beforeId ? this.layers.findIndex((entry) => entry.id === beforeId) : this.layers.length
    this.layers.splice(index < 0 ? this.layers.length : index, 0, structuredClone(layer))
  }
  removeLayer(id: string) {
    const index = this.layers.findIndex((layer) => layer.id === id)
    if (index >= 0) this.layers.splice(index, 1)
  }
  setPaintProperty(id: string, name: string, value: unknown) {
    const layer = this.getLayer(id) as { paint: Record<string, unknown> }
    layer.paint = { ...layer.paint, [name]: value }
    this.calls.push(`paint:${id}:${name}`)
  }
  setLayoutProperty(id: string, name: string, value: unknown) {
    const layer = this.getLayer(id) as { layout: Record<string, unknown> }
    layer.layout = { ...layer.layout, [name]: value }
  }
  setGlyphs(url: string | null) { this.glyphs = url }
  setSprite(url: string | null) { this.sprite = url }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function install(map: FakeMap, loads: string[] = []) {
  return new VectorBasemap(map, {
    loadStyle: async (url) => {
      loads.push(url)
      return styleDocument(url.split('/').pop()!)
    },
    beforeLayerId: () => 'canopi-scene',
  })
}

describe('OpenFreeMap vector basemap', () => {
  it('offers the four OpenFreeMap styles with Liberty first', () => {
    expect(Object.keys(OPENFREEMAP_BASEMAPS)).toEqual(['liberty', 'positron', 'bright', 'dark'])
  })

  it('adds the style as namespaced sources, layers, glyphs and sprite without setStyle, below Canopi layers', async () => {
    const map = new FakeMap()
    install(map).update({ style: 'liberty', visible: true, opacity: 1, locale: 'fr' })
    await settle()
    expect(map.sources.get('ofm-openmaptiles')).toEqual({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'ofm:background', 'ofm:water', 'ofm:road', 'ofm:place', 'ofm:shield', 'canopi-scene',
    ])
    expect(map.layers[1]!.source).toBe('ofm-openmaptiles')
    expect(map.glyphs).toContain('fonts/{fontstack}')
    expect(map.sprite).toContain('sprites/liberty')
  })

  it('labels places in the app locale and keeps non-name labels', async () => {
    const map = new FakeMap()
    const basemap = install(map)
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'fr' })
    await settle()
    const place = () => (map.getLayer('ofm:place') as { layout: Record<string, unknown> }).layout['text-field']
    expect(place()).toEqual(['coalesce', ['get', 'name:fr'], ['get', 'name']])
    expect((map.getLayer('ofm:shield') as { layout: Record<string, unknown> }).layout['text-field'])
      .toEqual(['to-string', ['get', 'ref']])
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'ja' })
    expect(place()).toEqual(['coalesce', ['get', 'name:ja'], ['get', 'name']])
  })

  it('scales every style layer opacity with the row opacity', async () => {
    const map = new FakeMap()
    const basemap = install(map)
    basemap.update({ style: 'liberty', visible: true, opacity: 0.5, locale: 'en' })
    await settle()
    const paint = (id: string) => (map.getLayer(id) as { paint: Record<string, unknown> }).paint
    expect(paint('ofm:background')['background-opacity']).toBe(0.5)
    expect(paint('ofm:water')['fill-opacity']).toBe(0.4)
    expect(paint('ofm:road')['line-opacity']).toEqual(['interpolate', ['linear'], ['zoom'], 5, 0.1, 12, 0.5])
    expect(paint('ofm:place')['text-opacity']).toEqual(['step', ['zoom'], 0, 6, 0.5])
    expect(paint('ofm:place')['icon-opacity']).toBe(0.5)
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
    expect(paint('ofm:water')['fill-opacity']).toBe(0.8)
  })

  it('removes everything when hidden and switches styles by replacing its own layers', async () => {
    const map = new FakeMap()
    const loads: string[] = []
    const basemap = install(map, loads)
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
    await settle()
    basemap.update({ style: 'dark', visible: true, opacity: 1, locale: 'en' })
    await settle()
    expect(map.sprite).toContain('sprites/dark')
    expect(map.layers.filter((layer) => String(layer.id).startsWith('ofm:'))).toHaveLength(5)
    basemap.update({ style: 'dark', visible: false, opacity: 1, locale: 'en' })
    expect(map.layers.map((layer) => layer.id)).toEqual(['canopi-scene'])
    expect(map.sources.size).toBe(0)
    expect(loads).toEqual([OPENFREEMAP_BASEMAPS.liberty.styleUrl, OPENFREEMAP_BASEMAPS.dark.styleUrl])
  })

  it('ignores a style that arrives after a newer request', async () => {
    const map = new FakeMap()
    let releaseLiberty!: () => void
    const basemap = new VectorBasemap(map, {
      loadStyle: (url) => url.endsWith('liberty')
        ? new Promise((resolve) => { releaseLiberty = () => resolve(styleDocument('liberty')) })
        : Promise.resolve(styleDocument('positron')),
    })
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
    basemap.update({ style: 'positron', visible: true, opacity: 1, locale: 'en' })
    await settle()
    releaseLiberty()
    await settle()
    expect(map.sprite).toContain('positron')
  })

  it('scales legacy stop functions and wraps other expressions', () => {
    expect(scaleOpacity({ stops: [[4, 0.4], [10, 1]] }, 0.5)).toEqual({ stops: [[4, 0.2], [10, 0.5]] })
    expect(scaleOpacity(['get', 'o'], 0.5)).toEqual(['*', ['get', 'o'], 0.5])
    expect(scaleOpacity(undefined, 0.3)).toBe(0.3)
  })
})
