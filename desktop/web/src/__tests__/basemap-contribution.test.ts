import { describe, expect, it, vi } from 'vitest'
import {
  reconcileBasemapContribution,
  setBasemapContributionVisibility,
  type BasemapRasterLayer,
  type BasemapRasterSource,
  type BasemapReconcileTarget,
} from '../maplibre/basemap-contribution'
/** Read a recorded layer as the shape the reconciler builds. */
function readLayer(
  layers: Map<string, Record<string, unknown>>,
  id: string,
): BasemapRasterLayer | undefined {
  return layers.get(id) as BasemapRasterLayer | undefined
}

/** Read a recorded source as the shape the reconciler builds. */
function readSource(
  sources: Map<string, Record<string, unknown>>,
  id: string,
): BasemapRasterSource | undefined {
  return sources.get(id) as BasemapRasterSource | undefined
}

import {
  MAPLIBRE_BASEMAP_RASTER_LAYER_ID,
  MAPLIBRE_BASEMAP_SOURCE_ID,
} from '../maplibre/config'
import type { BasemapDescriptor } from '../maplibre/basemap-provider'
import type { BasemapProviderState } from '../maplibre/basemap-provider-session'

function descriptor(overrides: Partial<BasemapDescriptor> = {}): BasemapDescriptor {
  return {
    style: 'street',
    provider: 'openstreetmap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    official: false,
    notice: null,
    ...overrides,
  }
}

/** A target that records the mutation order and tracks live membership. */
function recordingTarget() {
  // Stored in the map's own parameter shape, because that is what the
  // reconciler hands over; assertions narrow to the contribution's shapes.
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, Record<string, unknown>>()
  const order: string[] = []
  const target: BasemapReconcileTarget = {
    getSource: (id) => sources.get(id) ?? null,
    getLayer: (id) => layers.get(id) ?? null,
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
      const id = String(layer.id)
      order.push(`addLayer:${id}`)
      layers.set(id, layer)
    },
    setLayoutProperty: vi.fn((id, name, value) => {
      order.push(`setLayout:${id}:${name}=${String(value)}`)
      const layer = layers.get(id)
      if (layer && name === 'visibility') {
        layers.set(id, { ...layer, layout: { visibility: value as 'visible' | 'none' } })
      }
    }),
  }
  return { target, sources, layers, order }
}

describe('basemap contribution reconciliation', () => {
  it('adds a source and layer for a ready provider', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileBasemapContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    expect(readSource(sources, MAPLIBRE_BASEMAP_SOURCE_ID)?.tiles).toEqual([
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    ])
    expect(readLayer(layers, MAPLIBRE_BASEMAP_RASTER_LAYER_ID)?.layout.visibility).toBe('visible')
  })

  it('applies the provider tile size and zoom ceiling rather than a fixed 256/19', () => {
    const { target, sources } = recordingTarget()
    reconcileBasemapContribution(target, {
      state: 'ready',
      descriptor: descriptor({
        provider: 'google',
        tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
        tileSize: 512,
        maxzoom: 22,
        attribution: '&copy; Google',
      }),
      copyright: null,
    })
    const source = readSource(sources, MAPLIBRE_BASEMAP_SOURCE_ID)
    expect(source?.tileSize).toBe(512)
    expect(source?.maxzoom).toBe(22)
    expect(source?.attribution).toBe('&copy; Google')
  })

  it('replaces one contribution instead of accumulating them on a provider switch', () => {
    const { target, sources, order } = recordingTarget()
    reconcileBasemapContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    reconcileBasemapContribution(target, {
      state: 'ready',
      descriptor: descriptor({ provider: 'google', tiles: ['https://mt1.google.com/vt/lyrs=s'] }),
      copyright: null,
    })
    expect(sources.size).toBe(1)
    // The layer goes before its source, because MapLibre refuses to remove a
    // source a layer still references.
    expect(order.slice(2)).toEqual([
      `removeLayer:${MAPLIBRE_BASEMAP_RASTER_LAYER_ID}`,
      `removeSource:${MAPLIBRE_BASEMAP_SOURCE_ID}`,
      `addSource:${MAPLIBRE_BASEMAP_SOURCE_ID}`,
      `addLayer:${MAPLIBRE_BASEMAP_RASTER_LAYER_ID}`,
    ])
  })

  it('withdraws the contribution for idle and unavailable providers', () => {
    const states: BasemapProviderState[] = [
      { state: 'idle' },
      { state: 'unavailable', style: 'satellite', reason: 'no MapTiler key' },
    ]
    for (const state of states) {
      const { target, sources, layers } = recordingTarget()
      reconcileBasemapContribution(target, {
        state: 'ready',
        descriptor: descriptor(),
        copyright: null,
      })
      reconcileBasemapContribution(target, state)
      // Leaving the previous provider's tiles up would present one provider's
      // imagery under another provider's name.
      expect(sources.size).toBe(0)
      expect(layers.size).toBe(0)
    }
  })

  it('keeps an unchanged tile source hidden while official metadata is pending', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileBasemapContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: 'first',
    })
    expect(sources.size).toBe(1)
    // Loading with an already-installed source keeps the object and hides it,
    // so a pending metadata request cannot present falsely attributed imagery.
    reconcileBasemapContribution(target, { state: 'loading', style: 'google_satellite' })
    expect(sources.size).toBe(1)
    expect(layers.size).toBe(1)
  })

  it('removes an idempotent contribution without error', () => {
    const { target, sources } = recordingTarget()
    reconcileBasemapContribution(target, { state: 'idle' })
    reconcileBasemapContribution(target, { state: 'idle' })
    expect(sources.size).toBe(0)
  })

  it('toggles visibility without touching the source', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileBasemapContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    const before = readSource(sources, MAPLIBRE_BASEMAP_SOURCE_ID)
    setBasemapContributionVisibility(target, false)
    expect(readLayer(layers, MAPLIBRE_BASEMAP_RASTER_LAYER_ID)?.layout.visibility).toBe('none')
    expect(readSource(sources, MAPLIBRE_BASEMAP_SOURCE_ID)).toBe(before)
    setBasemapContributionVisibility(target, true)
    expect(readLayer(layers, MAPLIBRE_BASEMAP_RASTER_LAYER_ID)?.layout.visibility).toBe('visible')
  })

  it('ignores a visibility change when there is no contribution', () => {
    const { target } = recordingTarget()
    expect(() => setBasemapContributionVisibility(target, false)).not.toThrow()
  })
})
