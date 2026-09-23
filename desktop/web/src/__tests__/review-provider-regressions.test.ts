import { describe, expect, it, vi } from 'vitest'
import {
  BasemapProvider,
  readViewportMetadata,
  type BasemapProviderHttp,
  type BasemapProviderResponse,
  type BasemapProviderState,
  type BasemapViewport,
} from '../maplibre/basemap-provider-session'
import {
  reconcileBasemapContribution,
  type BasemapReconcileTarget,
} from '../maplibre/basemap-contribution'

const VIEWPORT_A: BasemapViewport = { west: -1, south: 48, east: 1, north: 49, zoom: 14 }
const VIEWPORT_B: BasemapViewport = { west: 10, south: 40, east: 12, north: 42, zoom: 12 }

function sessionBody(token = 'token-a'): unknown {
  return {
    session: token,
    expiry: '4000000000',
    tileWidth: 256,
    tileHeight: 256,
  }
}

function viewportBody(maxZoom = 18, copyright = 'Imagery &copy; Google'): unknown {
  return {
    copyright,
    maxZoomRects: [{ north: 90, south: -90, east: 180, west: -180, maxZoom }],
  }
}

function ok(json: unknown): BasemapProviderResponse {
  return { ok: true, status: 200, json }
}

function failure(status: number): BasemapProviderResponse {
  return { ok: false, status, json: null, retryAfterSeconds: null }
}

function scriptedHttp(
  answers: Array<BasemapProviderResponse | (() => Promise<BasemapProviderResponse>)>,
): { http: BasemapProviderHttp; calls: Array<{ url: string; method?: string }> } {
  const calls: Array<{ url: string; method?: string }> = []
  let index = 0
  return {
    calls,
    http: {
      async request(input) {
        calls.push({ url: input.url, method: input.method })
        const answer = answers[Math.min(index, answers.length - 1)]!
        index += 1
        return typeof answer === 'function' ? await answer() : answer
      },
    },
  }
}

function recorder(provider: BasemapProvider): BasemapProviderState[] {
  const seen: BasemapProviderState[] = []
  provider.subscribe((state) => seen.push(state))
  return seen
}

function recordingTarget() {
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, Record<string, unknown>>()
  const order: string[] = []
  let attribution: string | null = null
  const target: BasemapReconcileTarget = {
    getSource: (id) => sources.get(id),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => {
      order.push(`removeLayer:${id}`)
      layers.delete(id)
    },
    removeSource: (id) => {
      order.push(`removeSource:${id}`)
      sources.delete(id)
    },
    addSource: (id, source) => {
      order.push(`addSource:${id}`)
      sources.set(id, source)
    },
    addLayer: (layer) => {
      order.push(`addLayer:${layer.id}`)
      layers.set(layer.id as string, layer)
    },
    setLayoutProperty: (id, name, value) => {
      order.push(`layout:${id}:${name}:${String(value)}`)
      const layer = layers.get(id)
      if (layer && name === 'visibility') {
        layer.layout = { visibility: value }
      }
    },
    replaceBasemapAttribution: (next) => {
      order.push(`attribution:${next}`)
      attribution = next
    },
  }
  return { target, sources, layers, order, readAttribution: () => attribution }
}

function descriptor(overrides: Record<string, unknown> = {}) {
  return {
    style: 'google_satellite' as const,
    provider: 'google' as const,
    tiles: ['https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session={session}'],
    tileSize: 256,
    maxzoom: 22,
    attribution: 'Imagery &copy; Google',
    official: true,
    notice: null,
    ...overrides,
  }
}

describe('provider lifecycle regressions after 26eca68a', () => {
  it('R36: a key change replaces the session instead of pairing the old token with the new key', async () => {
    let key = 'key-a'
    const { http, calls } = scriptedHttp([
      ok(sessionBody('token-a')),
      ok(viewportBody()),
      ok(sessionBody('token-b')),
      ok(viewportBody()),
    ])
    const provider = new BasemapProvider(http, () => ({ googleMapsApiKey: key }))
    await new Promise<void>((resolve) => {
      provider.subscribe((state) => {
        if (state.state === 'ready') resolve()
      })
      provider.update({ style: 'google_satellite' }, VIEWPORT_A)
    })

    key = 'key-b'
    await new Promise<void>((resolve) => {
      provider.subscribe((state) => {
        if (state.state === 'ready') resolve()
      })
      provider.update({ style: 'google_satellite' }, VIEWPORT_A)
    })

    const sessionCalls = calls.filter((call) => call.url.includes('createSession'))
    expect(sessionCalls).toHaveLength(2)
    expect(sessionCalls[0]?.url).toContain('key=key-a')
    expect(sessionCalls[1]?.url).toContain('key=key-b')
    provider.dispose()
  })

  it('R37: a newer viewport supersedes an older in-flight metadata request', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    const { http, calls } = scriptedHttp([
      ok(sessionBody()),
      () =>
        new Promise<BasemapProviderResponse>((resolve) => {
          gate.release = () => resolve(ok(viewportBody(15, 'old')))
        }),
      ok(viewportBody(20, 'new')),
    ])
    const provider = new BasemapProvider(http, { googleMapsApiKey: 'key' })
    provider.update({ style: 'google_satellite' }, VIEWPORT_A)
    await vi.waitFor(() => {
      if (calls.length < 2) throw new Error('session not settled')
    })

    // Move while A's metadata is still in flight.
    provider.updateViewport(VIEWPORT_B)
    gate.release?.()
    await vi.waitFor(() => {
      const last = provider.snapshot()
      if (last.state !== 'ready') throw new Error('not ready')
      if (last.copyright !== 'new') throw new Error('stale viewport published')
    })
    const viewportCalls = calls.filter((call) => call.url.includes('viewport'))
    expect(viewportCalls.length).toBeGreaterThanOrEqual(2)
    provider.dispose()
  })

  it('R38: imagery is not Ready until validated viewport metadata arrives', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    const { http, calls } = scriptedHttp([
      ok(sessionBody()),
      () =>
        new Promise<BasemapProviderResponse>((resolve) => {
          gate.release = () => resolve(ok(viewportBody()))
        }),
    ])
    const provider = new BasemapProvider(http, { googleMapsApiKey: 'key' })
    const seen = recorder(provider)
    provider.update({ style: 'google_satellite' }, VIEWPORT_A)
    await vi.waitFor(() => {
      if (!gate.release) throw new Error('viewport request not started')
    })
    // Session alone is not Ready: official imagery needs metadata too.
    expect(seen.map((s) => s.state)).not.toContain('ready')
    expect(provider.snapshot().state).toBe('loading')
    const release = gate.release
    expect(release).not.toBeNull()
    release?.()
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'ready') throw new Error('not ready')
    })
    expect(calls.filter((c) => c.url.includes('viewport'))).toHaveLength(1)
    provider.dispose()
  })

  it('R38: empty metadata is not established', () => {
    expect(readViewportMetadata({}, VIEWPORT_A)).toBeNull()
    expect(readViewportMetadata({ copyright: 'x' }, VIEWPORT_A)).toBeNull()
    expect(readViewportMetadata({ maxZoomRects: [] }, VIEWPORT_A)).toBeNull()
  })

  it('R39: a later valid viewport restores credentials and Ready after metadata failure', async () => {
    const { http, calls } = scriptedHttp([
      ok(sessionBody()),
      failure(500),
      failure(500),
      failure(500),
      ok(viewportBody(18, 'recovered')),
    ])
    const provider = new BasemapProvider(
      http,
      { googleMapsApiKey: 'key' },
      () => 0,
      async () => {},
    )
    provider.update({ style: 'google_satellite' }, VIEWPORT_A)
    await vi.waitFor(() => {
      if (provider.snapshot().state !== 'unavailable') throw new Error('not failed')
    })

    // A distinct settled viewport may recover through the same bounded policy.
    provider.updateViewport(VIEWPORT_B)
    await vi.waitFor(() => {
      const last = provider.snapshot()
      if (last.state !== 'ready') throw new Error('not recovered')
      if (last.copyright !== 'recovered') throw new Error('wrong copyright')
    })
    expect(calls.filter((c) => c.url.includes('viewport')).length).toBeGreaterThanOrEqual(2)
    provider.dispose()
  })

  it('R40: viewport zoom availability can increase and decrease against the base descriptor', async () => {
    const { http } = scriptedHttp([
      ok(sessionBody()),
      ok(viewportBody(15)),
      ok(viewportBody(20)),
      ok(viewportBody(12)),
    ])
    const provider = new BasemapProvider(http, { googleMapsApiKey: 'key' })
    provider.update({ style: 'google_satellite' }, VIEWPORT_A)
    await vi.waitFor(() => {
      const last = provider.snapshot()
      if (last.state !== 'ready' || last.descriptor.maxzoom !== 15) throw new Error('want 15')
    })
    provider.updateViewport(VIEWPORT_B)
    await vi.waitFor(() => {
      const last = provider.snapshot()
      // Availability must be recomputed from the base descriptor, not clamped
      // against the prior clamped zoom.
      if (last.state !== 'ready' || last.descriptor.maxzoom !== 20) throw new Error('want 20')
    })
    provider.updateViewport(VIEWPORT_A)
    await vi.waitFor(() => {
      const last = provider.snapshot()
      if (last.state !== 'ready' || last.descriptor.maxzoom !== 12) throw new Error('want 12')
    })
    provider.dispose()
  })

  it('R40: overlapping rectangles take the greatest zoom at a point and the least across the viewport', () => {
    // Broad low-zoom rectangle plus a finer one covering the whole viewport:
    // the greater per-point zoom wins, so the broad rectangle cannot suppress it.
    const overlapping = readViewportMetadata(
      {
        copyright: 'c',
        maxZoomRects: [
          { north: 90, south: -90, east: 180, west: -180, maxZoom: 10 },
          { north: 49, south: 48, east: 1, west: -1, maxZoom: 18 },
        ],
      },
      VIEWPORT_A,
    )
    expect(overlapping?.maxZoom).toBe(18)

    // Uncovered viewport corners are unavailable, not an invented zoom.
    const partial = readViewportMetadata(
      {
        copyright: 'c',
        maxZoomRects: [{ north: 48.5, south: 48, east: 1, west: -1, maxZoom: 18 }],
      },
      VIEWPORT_A,
    )
    expect(partial).toBeNull()
  })

  it('R41: identical publications are no-ops and copyright-only updates attribution in place', () => {
    const { target, sources, order, readAttribution } = recordingTarget()
    const first = {
      state: 'ready' as const,
      descriptor: descriptor({ attribution: 'first' }),
      copyright: 'first',
    }
    reconcileBasemapContribution(target, first, { officialTilesResolvable: true })
    expect(sources.size).toBe(1)
    const addCount = order.filter((entry) => entry.startsWith('addSource')).length

    // Identical publication retains source identity and loaded state.
    reconcileBasemapContribution(target, first, { officialTilesResolvable: true })
    expect(sources.size).toBe(1)
    expect(order.filter((entry) => entry.startsWith('removeSource')).length).toBe(0)
    expect(order.filter((entry) => entry.startsWith('addSource')).length).toBe(addCount)

    // Copyright-only change updates attribution without removing the source.
    reconcileBasemapContribution(
      target,
      {
        state: 'ready',
        descriptor: descriptor({ attribution: 'second' }),
        copyright: 'second',
      },
      { officialTilesResolvable: true },
    )
    expect(sources.size).toBe(1)
    expect(order.filter((entry) => entry.startsWith('removeSource')).length).toBe(0)
    expect(readAttribution()).toBe('second')
  })

  it('R41: a real tile-configuration change rebuilds the source', () => {
    const { target, sources, order } = recordingTarget()
    reconcileBasemapContribution(
      target,
      { state: 'ready', descriptor: descriptor({ maxzoom: 18 }), copyright: 'a' },
      { officialTilesResolvable: true },
    )
    reconcileBasemapContribution(
      target,
      { state: 'ready', descriptor: descriptor({ maxzoom: 20 }), copyright: 'a' },
      { officialTilesResolvable: true },
    )
    expect(order.filter((entry) => entry.startsWith('removeSource')).length).toBe(1)
    expect(order.filter((entry) => entry.startsWith('addSource')).length).toBe(2)
    expect(sources.size).toBe(1)
  })

  it('R45: copyright-only change updates attribution without removing the source', () => {
    const { target, sources, order, readAttribution } = recordingTarget()
    const first = {
      state: 'ready' as const,
      descriptor: descriptor({ attribution: 'A' }),
      copyright: 'A',
    }
    reconcileBasemapContribution(target, first, { officialTilesResolvable: true })
    const addCount = order.filter((entry) => entry.startsWith('addSource')).length
    reconcileBasemapContribution(
      target,
      { state: 'ready', descriptor: descriptor({ attribution: 'B' }), copyright: 'B' },
      { officialTilesResolvable: true },
    )
    expect(sources.size).toBe(1)
    expect(order.filter((entry) => entry.startsWith('removeSource')).length).toBe(0)
    expect(order.filter((entry) => entry.startsWith('addSource')).length).toBe(addCount)
    expect(readAttribution()).toBe('B')
  })

  it('R46: Loading hides an unchanged source instead of exposing cached imagery', () => {
    const { target, layers } = recordingTarget()
    reconcileBasemapContribution(
      target,
      { state: 'ready', descriptor: descriptor(), copyright: 'A' },
      { officialTilesResolvable: true },
    )
    const layer = layers.get('basemap-raster') as { layout?: { visibility?: string } } | undefined
    expect(layer?.layout?.visibility).toBe('visible')
    reconcileBasemapContribution(target, { state: 'loading', style: 'google_satellite' })
    expect((layers.get('basemap-raster') as { layout?: { visibility?: string } })?.layout?.visibility)
      .toBe('none')
  })

  it('R47: uncovered strips in the viewport are unavailable', () => {
    // Longitude 0-1, 4-6 and 9-10 leave uncovered strips inside 0-10.
    const gappy = readViewportMetadata(
      {
        copyright: 'c',
        maxZoomRects: [
          { north: 10, south: 0, east: 1, west: 0, maxZoom: 18 },
          { north: 10, south: 0, east: 6, west: 4, maxZoom: 18 },
          { north: 10, south: 0, east: 10, west: 9, maxZoom: 18 },
        ],
      },
      { west: 0, south: 0, east: 10, north: 10, zoom: 12 },
    )
    expect(gappy).toBeNull()
  })

  it('R47: wrapped viewport coverage across the antimeridian is supported', () => {
    const wrapped = readViewportMetadata(
      {
        copyright: 'c',
        maxZoomRects: [
          { north: 10, south: 0, east: -170, west: 170, maxZoom: 18 },
        ],
      },
      { west: 175, south: 1, east: -175, north: 9, zoom: 12 },
    )
    expect(wrapped?.maxZoom).toBe(18)
  })

  it('R47: an interior lower ceiling becomes the source-wide ceiling', () => {
    // The high-zoom rectangle covers only the outer band; the interior is
    // supported solely at 12, so the source ceiling cannot exceed 12.
    const interior = readViewportMetadata(
      {
        copyright: 'c',
        maxZoomRects: [
          { north: 10, south: 8, east: 10, west: 0, maxZoom: 18 },
          { north: 2, south: 0, east: 10, west: 0, maxZoom: 18 },
          { north: 8, south: 2, east: 2, west: 0, maxZoom: 18 },
          { north: 8, south: 2, east: 10, west: 8, maxZoom: 18 },
          { north: 8, south: 2, east: 8, west: 2, maxZoom: 12 },
        ],
      },
      { west: 0, south: 0, east: 10, north: 10, zoom: 12 },
    )
    expect(interior?.maxZoom).toBe(12)
  })

  it('R47: a broad low-zoom rectangle cannot suppress a finer covering one', () => {
    const overlapping = readViewportMetadata(
      {
        copyright: 'c',
        maxZoomRects: [
          { north: 90, south: -90, east: 180, west: -180, maxZoom: 10 },
          { north: 10, south: 0, east: 10, west: 0, maxZoom: 18 },
        ],
      },
      { west: 0, south: 0, east: 10, north: 10, zoom: 12 },
    )
    expect(overlapping?.maxZoom).toBe(18)
  })
})
