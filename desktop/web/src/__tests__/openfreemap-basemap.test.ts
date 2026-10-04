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

  it('reports a rejected style as failed until a later load installs it, and idle once hidden', async () => {
    const map = new FakeMap()
    const statuses: string[] = []
    let reject = true
    const basemap = new VectorBasemap(map, {
      loadStyle: async (url) => {
        if (reject) throw new Error('Basemap style request failed (503).')
        return styleDocument(url.split('/').pop()!)
      },
      onStatus: (status) => statuses.push(status),
    })
    const shown = { style: 'liberty', visible: true, opacity: 1, locale: 'en' } as const
    basemap.update(shown)
    await settle()
    expect(statuses).toEqual(['loading', 'failed'])

    reject = false
    basemap.update(shown)
    expect(statuses).toEqual(['loading', 'failed', 'loading'])
    await settle()
    expect(statuses).toEqual(['loading', 'failed', 'loading', 'ok'])
    expect(map.sprite).toContain('liberty')

    basemap.update({ ...shown, visible: false })
    expect(statuses).toEqual(['loading', 'failed', 'loading', 'ok', 'idle'])
  })

  it('clears a failed style once the user returns to the style still on screen', async () => {
    const map = new FakeMap()
    const statuses: string[] = []
    let reject = false
    const basemap = new VectorBasemap(map, {
      loadStyle: async (url) => {
        if (reject) throw new Error('Basemap style request failed (503).')
        return styleDocument(url.split('/').pop()!)
      },
      onStatus: (status) => statuses.push(status),
    })
    const liberty = { style: 'liberty', visible: true, opacity: 1, locale: 'en' } as const
    basemap.update(liberty)
    await settle()
    reject = true
    basemap.update({ ...liberty, style: 'dark' })
    await settle()
    expect(statuses).toEqual(['loading', 'ok', 'loading', 'failed'])

    basemap.update(liberty)
    await settle()
    expect(basemap.installedStyle).toBe('liberty')
    expect(statuses).toEqual(['loading', 'ok', 'loading', 'failed', 'ok'])
  })

  it('ignores a style that fails after the user returned to the style on screen', async () => {
    const map = new FakeMap()
    const statuses: string[] = []
    let rejectDark!: () => void
    const basemap = new VectorBasemap(map, {
      loadStyle: (url) => url.endsWith('dark')
        ? new Promise((_, reject) => { rejectDark = () => reject(new Error('Basemap style request failed (503).')) })
        : Promise.resolve(styleDocument('liberty')),
      onStatus: (status) => statuses.push(status),
    })
    const liberty = { style: 'liberty', visible: true, opacity: 1, locale: 'en' } as const
    basemap.update(liberty)
    await settle()
    basemap.update({ ...liberty, style: 'dark' })
    basemap.update(liberty)
    rejectDark()
    await settle()
    expect(basemap.installedStyle).toBe('liberty')
    expect(statuses).toEqual(['loading', 'ok', 'loading', 'ok'])
  })

  it('reports loading while a style downloads, and a repeated request keeps the download already running', async () => {
    const map = new FakeMap()
    const statuses: string[] = []
    const loads: string[] = []
    let release!: () => void
    const basemap = new VectorBasemap(map, {
      loadStyle: (url) => {
        loads.push(url)
        return new Promise((resolve) => { release = () => resolve(styleDocument('liberty')) })
      },
      onStatus: (status) => statuses.push(status),
    })
    const liberty = { style: 'liberty', visible: true, opacity: 1, locale: 'en' } as const
    basemap.update(liberty)
    basemap.update(liberty)
    basemap.update({ ...liberty, opacity: 0.5 })
    expect(statuses).toEqual(['loading'])
    expect(loads).toEqual([OPENFREEMAP_BASEMAPS.liberty.styleUrl])

    release()
    await settle()
    expect(basemap.installedStyle).toBe('liberty')
    expect(statuses).toEqual(['loading', 'ok'])
    expect((map.getLayer('ofm:water') as { paint: Record<string, unknown> }).paint['fill-opacity']).toBe(0.4)
  })

  describe('a sprite that fails after its response arrived (no URL on the error)', () => {
    // MapLibre names the URL only when fetch() rejects or the status is not ok; a captive portal's HTML (SyntaxError),
    // a body cut off mid-download (TypeError) or an undecodable sprite image reach the map with no URL and no source.
    const urlLess = [
      ['captive portal HTML', { type: 'error', error: new SyntaxError('JSON Parse error: Unrecognized token \'<\'') }],
      ['body cut off', { type: 'error', error: new TypeError('Load failed') }],
      ['empty sprite image', { type: 'error', error: new Error('Could not load sprite image, the image is empty') }],
    ] as const

    async function installedLiberty() {
      const map = new FakeMap()
      const statuses: string[] = []
      const basemap = new VectorBasemap(map, {
        loadStyle: async () => styleDocument('liberty'),
        onStatus: (status) => statuses.push(status),
      })
      basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
      await settle()
      return { map, basemap, statuses }
    }

    it.each(urlLess)('claims a %s error while its sprite is downloading and reports the style failed', async (_case, event) => {
      const { basemap, statuses } = await installedLiberty()
      expect(basemap.claimResourceError(event)).toBe(true)
      expect(statuses.at(-1)).toBe('failed')
    })

    it.each(urlLess)('leaves a %s error unclaimed once the map has settled since the sprite request', async (_case, event) => {
      const { basemap, statuses } = await installedLiberty()
      basemap.noteMapIdle()
      expect(basemap.claimResourceError(event)).toBe(false)
      expect(statuses.at(-1)).toBe('ok')
    })

    it.each([
      ['a shader that fails to compile', new Error('Could not compile fragment shader')],
      ['a programming error', new TypeError("Cannot read properties of undefined (reading 'x')")],
      ['a lost context', new Error('WebGL context lost')],
    ])('leaves %s unclaimed while the sprite is downloading, so it stays a map failure', async (_case, error) => {
      const { basemap, statuses } = await installedLiberty()
      expect(basemap.claimResourceError({ type: 'error', error })).toBe(false)
      expect(statuses.at(-1)).toBe('ok')
      // The sprite's own failure is still claimed afterwards.
      expect(basemap.claimResourceError(urlLess[0][1])).toBe(true)
    })

    it('claims an undecodable sprite image, which the browser rejects as a DOMException', async () => {
      const { basemap } = await installedLiberty()
      const decode = new DOMException('The source image could not be decoded.', 'InvalidStateError')
      expect(basemap.claimResourceError({ type: 'error', error: decode })).toBe(true)
    })

    it('leaves a URL-less error that names a source or layer unclaimed', async () => {
      const { basemap } = await installedLiberty()
      expect(basemap.claimResourceError({ type: 'error', sourceId: 'canopi-scene', error: new TypeError('Load failed') })).toBe(false)
      expect(basemap.claimResourceError({ type: 'error', layer: { id: 'canopi-scene' }, error: new TypeError('Load failed') })).toBe(false)
    })

    it('downloads the sprite again on Retry and claims its next URL-less failure too', async () => {
      const { map, basemap, statuses } = await installedLiberty()
      expect(basemap.claimResourceError(urlLess[0][1])).toBe(true)
      basemap.discardFailedResources()
      map.sprite = null
      basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
      await settle()
      expect(map.sprite).toContain('sprites/liberty')
      expect(statuses.at(-1)).toBe('ok')
      expect(basemap.claimResourceError(urlLess[1][1])).toBe(true)
      expect(statuses.at(-1)).toBe('failed')
    })

    it('leaves a URL-less error unclaimed when the basemap is hidden', async () => {
      const { basemap } = await installedLiberty()
      basemap.update({ style: 'liberty', visible: false, opacity: 1, locale: 'en' })
      expect(basemap.claimResourceError(urlLess[1][1])).toBe(false)
    })
  })

  it('scales legacy stop functions and wraps other expressions', () => {
    expect(scaleOpacity({ stops: [[4, 0.4], [10, 1]] }, 0.5)).toEqual({ stops: [[4, 0.2], [10, 0.5]] })
    expect(scaleOpacity(['get', 'o'], 0.5)).toEqual(['*', ['get', 'o'], 0.5])
    expect(scaleOpacity(undefined, 0.3)).toBe(0.3)
  })
})
