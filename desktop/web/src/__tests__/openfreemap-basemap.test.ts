import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENFREEMAP_BASEMAPS,
  VectorBasemap,
  type VectorBasemapMap,
  type VectorStyleDocument,
} from '../maplibre/openfreemap-basemap'
// MapLibre's own sources (the test-only `maplibre-gl-source` alias, vite.config.ts): the prepared style through the
// validation `addLayer` runs and the layers' evaluation against the map's global state.
import { createStyleLayer } from 'maplibre-gl-source/style/create_style_layer.ts'
import { EvaluationParameters } from 'maplibre-gl-source/style/evaluation_parameters.ts'
import { validateStyle } from 'maplibre-gl-source/style/validate_style.ts'

/** The one sprite every OpenFreeMap style names (checked against the four live style documents, 2026-10-04). */
const OFM_SPRITE = 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm'

function styleDocument(name: string): VectorStyleDocument {
  return {
    glyphs: `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf#${name}`,
    sprite: OFM_SPRITE,
    sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#fff' } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-opacity': 0.8 } },
      {
        id: 'road',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        paint: { 'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 12, 1] },
      },
      {
        id: 'place',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        layout: { 'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']] },
        paint: { 'text-opacity': ['step', ['zoom'], 0, 6, 1] },
      },
      {
        id: 'shield',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
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
  globalState: Record<string, unknown> = {}
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
  setGlobalStateProperty(name: string, value: unknown) { this.globalState = { ...this.globalState, [name]: value } }
  /** A layer property as MapLibre evaluates it here: global state read from the map, products and concatenations folded. */
  resolved(id: string, kind: 'paint' | 'layout', name: string): unknown {
    const layer = this.getLayer(id) as Record<string, Record<string, unknown> | undefined>
    return resolveExpression(layer[kind]?.[name], this.globalState)
  }
}

function resolveExpression(value: unknown, state: Record<string, unknown>): unknown {
  if (!Array.isArray(value)) return value
  if (value[0] === 'global-state') {
    if (!(value[1] in state)) throw new Error(`global state ${String(value[1])} is not set`)
    return state[value[1]]
  }
  const [operator, ...args] = value.map((entry) => resolveExpression(entry, state))
  if (operator === '*' && args.every((arg) => typeof arg === 'number')) return (args as number[]).reduce((a, b) => a * b, 1)
  if (operator === 'concat' && args.every((arg) => typeof arg === 'string')) return args.join('')
  return [operator, ...args]
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

  it('adds the style as namespaced sources, layers, glyphs and sprite below Canopi layers', async () => {
    const map = new FakeMap()
    install(map).update({ style: 'liberty', visible: true, opacity: 1, locale: 'fr' })
    await settle()
    expect(map.sources.get('ofm-openmaptiles')).toEqual({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
    expect(map.layers.map((layer) => layer.id)).toEqual([
      'ofm:background', 'ofm:water', 'ofm:road', 'ofm:place', 'ofm:shield', 'canopi-scene',
    ])
    expect(map.layers[1]!.source).toBe('ofm-openmaptiles')
    expect(map.glyphs).toContain('fonts/{fontstack}')
    expect(map.sprite).toBe(OFM_SPRITE)
  })

  it('labels places in the app locale and keeps non-name labels', async () => {
    const map = new FakeMap()
    const basemap = install(map)
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'fr' })
    await settle()
    const place = () => map.resolved('ofm:place', 'layout', 'text-field')
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
    const opacity = (id: string, name: string) => map.resolved(id, 'paint', name)
    expect(opacity('ofm:background', 'background-opacity')).toBe(0.5)
    expect(opacity('ofm:water', 'fill-opacity')).toBe(0.4)
    expect(opacity('ofm:road', 'line-opacity')).toEqual(['interpolate', ['linear'], ['zoom'], 5, 0.1, 12, 0.5])
    expect(opacity('ofm:place', 'text-opacity')).toEqual(['step', ['zoom'], 0, 6, 0.5])
    expect(opacity('ofm:place', 'icon-opacity')).toBe(0.5)
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
    expect(opacity('ofm:water', 'fill-opacity')).toBe(0.8)
  })

  it('removes everything when hidden and switches styles by replacing its own layers', async () => {
    const map = new FakeMap()
    const loads: string[] = []
    const basemap = install(map, loads)
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
    await settle()
    basemap.update({ style: 'dark', visible: true, opacity: 1, locale: 'en' })
    await settle()
    expect(map.glyphs).toContain('#dark')
    expect(map.layers.filter((layer) => String(layer.id).startsWith('ofm:'))).toHaveLength(5)
    basemap.update({ style: 'dark', visible: false, opacity: 1, locale: 'en' })
    expect(map.layers.map((layer) => layer.id)).toEqual(['canopi-scene'])
    expect(map.sources.size).toBe(0)
    expect(loads).toEqual([OPENFREEMAP_BASEMAPS.liberty, OPENFREEMAP_BASEMAPS.dark])
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
    expect(map.glyphs).toContain('#positron')
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
    expect(map.glyphs).toContain('#liberty')

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

  // Liberty in Russian at 40%; Bright cannot be downloaded, so Liberty stays on screen. A language or opacity change
  // meanwhile reaches the style still shown, not only the one that would follow.
  it.each([
    ['hangs', () => new Promise<never>(() => {})],
    ['fails', () => Promise.reject(new Error('Basemap style request failed (503).'))],
  ] as const)('applies a new language and opacity to the style still on screen while the chosen style %s', async (_, loadBright) => {
    const map = new FakeMap()
    const basemap = new VectorBasemap(map, {
      loadStyle: (url) => url.endsWith('bright') ? loadBright() : Promise.resolve(styleDocument('liberty')),
    })
    const liberty = { style: 'liberty', visible: true, opacity: 0.4, locale: 'ru' } as const
    basemap.update(liberty)
    await settle()
    basemap.update({ ...liberty, style: 'bright' })
    await settle()

    basemap.update({ style: 'bright', visible: true, opacity: 0.2, locale: 'en' })
    await settle()
    expect(basemap.installedStyle).toBe('liberty')
    expect(map.globalState).toEqual({ 'canopi:basemap-opacity': 0.2, 'canopi:basemap-locale': 'en' })
  })

  it('reports loading while a style downloads, and a repeated request joins the download already running', async () => {
    // Through the real style download: Bright, which no other test downloads, so the shared cache starts empty for it.
    const requests: string[] = []
    let respond!: () => void
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      requests.push(url)
      return new Promise((resolve) => { respond = () => resolve({ ok: true, json: async () => styleDocument('bright') }) })
    }))
    try {
      const map = new FakeMap()
      const statuses: string[] = []
      const basemap = new VectorBasemap(map, { onStatus: (status) => statuses.push(status) })
      const bright = { style: 'bright', visible: true, opacity: 1, locale: 'en' } as const
      basemap.update(bright)
      basemap.update(bright)
      basemap.update({ ...bright, opacity: 0.5 })
      expect(statuses).toEqual(['loading'])
      expect(requests).toEqual([OPENFREEMAP_BASEMAPS.bright])

      respond()
      await settle()
      expect(basemap.installedStyle).toBe('bright')
      expect(statuses).toEqual(['loading', 'ok'])
      expect(requests).toHaveLength(1)
      expect(map.resolved('ofm:water', 'paint', 'fill-opacity')).toBe(0.4)
      basemap.dispose()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('claims a late failure of the shared sprite as the shown style\'s after a style switch, and silently once hidden', async () => {
    const map = new FakeMap()
    const statuses: string[] = []
    const basemap = new VectorBasemap(map, {
      loadStyle: async (url) => styleDocument(url.split('/').pop()!),
      onStatus: (status) => statuses.push(status),
    })
    basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
    await settle()
    basemap.update({ style: 'dark', visible: true, opacity: 1, locale: 'en' })
    await settle()
    expect(basemap.installedStyle).toBe('dark')
    const offline = (url: string) => ({
      type: 'error',
      error: Object.assign(new Error(`AJAXError: Failed to fetch (0): ${url}`), { name: 'AJAXError', status: 0, url }),
    })

    // Liberty's sprite request was still running when Dark set the same sprite: Dark's own request fails too.
    expect(basemap.claimResourceError(offline(`${OFM_SPRITE}@2x.json`))).toBe(true)
    expect(statuses.at(-1)).toBe('failed')

    basemap.update({ style: 'dark', visible: false, opacity: 1, locale: 'en' })
    expect(basemap.claimResourceError(offline(`${OFM_SPRITE}@2x.png?v=1`))).toBe(true)
    expect(statuses.at(-1)).toBe('idle')

    expect(basemap.claimResourceError(offline('https://example.com/sprites/other@2x.json'))).toBe(false)
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

    it('still claims the sprite\'s captive-portal error when the TileJSON\'s arrives first', async () => {
      const { basemap, statuses } = await installedLiberty()
      const portal = () => new SyntaxError('JSON Parse error: Unrecognized token \'<\'')
      expect(basemap.claimResourceError({ type: 'error', sourceId: 'ofm-openmaptiles', error: portal() })).toBe(true)
      expect(basemap.claimResourceError({ type: 'error', error: portal() })).toBe(true)
      expect(statuses.at(-1)).toBe('failed')
    })

    it('downloads the sprite again on Retry and claims its next URL-less failure too', async () => {
      const { map, basemap, statuses } = await installedLiberty()
      expect(basemap.claimResourceError(urlLess[0][1])).toBe(true)
      basemap.discardFailedResources()
      map.sprite = null
      basemap.update({ style: 'liberty', visible: true, opacity: 1, locale: 'en' })
      await settle()
      expect(map.sprite).toBe(OFM_SPRITE)
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

  describe('a style download that hangs (a captive portal or weak hotspot holding the request open)', () => {
    /** `BASEMAP_STYLE_TIMEOUT_MS` in openfreemap-basemap.ts. */
    const BASEMAP_STYLE_TIMEOUT_MS = 20_000

    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    })

    it('fails after the timeout, so the notice offers Retry, and the next request downloads again', async () => {
      vi.useFakeTimers()
      const requests: string[] = []
      vi.stubGlobal('fetch', vi.fn((url: string, init?: { signal?: AbortSignal }) => {
        requests.push(url)
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
        })
      }))
      const statuses: string[] = []
      const errors: unknown[] = []
      const first = new VectorBasemap(new FakeMap(), {
        onStatus: (status) => statuses.push(`first:${status}`),
        onError: (error) => errors.push(error),
      })
      const positron = { style: 'positron', visible: true, opacity: 1, locale: 'en' } as const
      first.update(positron)
      await vi.advanceTimersByTimeAsync(BASEMAP_STYLE_TIMEOUT_MS - 1)
      expect(statuses).toEqual(['first:loading'])

      await vi.advanceTimersByTimeAsync(1)
      expect(statuses).toEqual(['first:loading', 'first:failed'])
      expect(errors).toHaveLength(1)

      // Retry on the same instance downloads again, rather than returning early on the failed load.
      first.update(positron)
      expect(requests).toEqual([
        OPENFREEMAP_BASEMAPS.positron,
        OPENFREEMAP_BASEMAPS.positron,
      ])
      expect(statuses).toEqual(['first:loading', 'first:failed', 'first:loading'])

      // A rebuilt map (a new instance) joins that fresh download instead of the timed-out one.
      const second = new VectorBasemap(new FakeMap(), { onStatus: (status) => statuses.push(`second:${status}`) })
      second.update(positron)
      expect(requests).toEqual([
        OPENFREEMAP_BASEMAPS.positron,
        OPENFREEMAP_BASEMAPS.positron,
      ])
      first.dispose()
      second.dispose()
    })
  })

  it('installs a style MapLibre accepts, whose opacity and labels follow the map\'s global state', async () => {
    const map = new FakeMap()
    const basemap = install(map)
    basemap.update({ style: 'liberty', visible: true, opacity: 0.5, locale: 'fr' })
    await settle()
    const layers = map.layers.filter((layer) => String(layer.id).startsWith('ofm:'))
    const style = { version: 8, glyphs: map.glyphs, sprite: map.sprite, sources: Object.fromEntries(map.sources), layers }
    expect(validateStyle(style)).toEqual([])

    // MapLibre's layers read the global state object the map writes into.
    const state: Record<string, unknown> = { ...map.globalState }
    const styleLayer = (id: string) => {
      const layer = createStyleLayer(layers.find((entry) => entry.id === id) as never, state)
      layer.recalculate(new EvaluationParameters(12), [])
      return layer as unknown as {
        paint: { get(name: string): { constantOr(fallback: unknown): unknown } }
        layout: { get(name: string): { evaluate(feature: unknown, featureState: unknown): unknown } }
      }
    }
    const opacity = (id: string, name: string) => styleLayer(id).paint.get(name).constantOr(null)
    expect(opacity('ofm:water', 'fill-opacity')).toBeCloseTo(0.4)
    expect(opacity('ofm:road', 'line-opacity')).toBeCloseTo(0.5)
    const label = () => String(styleLayer('ofm:place').layout.get('text-field').evaluate(
      { type: 1, properties: { name: 'Paris', 'name:fr': 'Paris (fr)', 'name:de': 'Paris (de)' }, geometry: [] }, {},
    ))
    expect(label()).toBe('Paris (fr)')

    basemap.update({ style: 'liberty', visible: true, opacity: 0.25, locale: 'de' })
    Object.assign(state, map.globalState)
    expect(opacity('ofm:water', 'fill-opacity')).toBeCloseTo(0.2)
    expect(opacity('ofm:road', 'line-opacity')).toBeCloseTo(0.25)
    expect(label()).toBe('Paris (de)')
  })

  it('scales data-driven opacities and leaves legacy stop functions, which cannot hold an expression', async () => {
    // A downloaded style is untrusted input: a legacy function must reach the map unchanged, never wrapped.
    const map = new FakeMap()
    const document = styleDocument('liberty')
    const basemap = new VectorBasemap(map, {
      loadStyle: async () => ({
        ...document,
        layers: [
          ...document.layers,
          { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-opacity': ['get', 'o'] } },
          {
            id: 'landuse',
            type: 'fill',
            source: 'openmaptiles',
            'source-layer': 'landuse',
            paint: { 'fill-opacity': { stops: [[4, 0.4], [10, 1]] } },
          },
        ],
      }),
      beforeLayerId: () => 'canopi-scene',
    })
    basemap.update({ style: 'liberty', visible: true, opacity: 0.5, locale: 'en' })
    await settle()

    expect(map.resolved('ofm:park', 'paint', 'fill-opacity')).toEqual(['*', ['get', 'o'], 0.5])
    expect(map.resolved('ofm:landuse', 'paint', 'fill-opacity')).toEqual({ stops: [[4, 0.4], [10, 1]] })
  })
})
