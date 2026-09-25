import { describe, expect, it, vi } from 'vitest'
import {
  reconcileSatelliteContribution,
  setSatelliteContributionVisibility,
  type SatelliteRasterLayer,
  type SatelliteRasterSource,
  type SatelliteReconcileTarget,
} from '../maplibre/satellite-contribution'
/** Read a recorded layer as the shape the reconciler builds. */
function readLayer(
  layers: Map<string, Record<string, unknown>>,
  id: string,
): SatelliteRasterLayer | undefined {
  return layers.get(id) as SatelliteRasterLayer | undefined
}

/** Read a recorded source as the shape the reconciler builds. */
function readSource(
  sources: Map<string, Record<string, unknown>>,
  id: string,
): SatelliteRasterSource | undefined {
  return sources.get(id) as SatelliteRasterSource | undefined
}

import {
  MAPLIBRE_SATELLITE_LAYER_ID,
  MAPLIBRE_SATELLITE_SOURCE_ID,
} from '../maplibre/config'
import {
  EOX_SATELLITE_ATTRIBUTION,
  EOX_SATELLITE_TILES,
  GOOGLE_KEY_REQUIRED_REASON,
  GOOGLE_SESSION_TILES,
  type SatelliteDescriptor,
} from '../maplibre/satellite-provider'
import type { SatelliteProviderState } from '../maplibre/satellite-provider-session'

function descriptor(overrides: Partial<SatelliteDescriptor> = {}): SatelliteDescriptor {
  return {
    provider: 'eox',
    tiles: [EOX_SATELLITE_TILES],
    tileSize: 256,
    maxzoom: 17,
    attribution: EOX_SATELLITE_ATTRIBUTION,
    official: false,
    ...overrides,
  }
}

function googleDescriptor(overrides: Partial<SatelliteDescriptor> = {}): SatelliteDescriptor {
  return descriptor({
    provider: 'google',
    tiles: [GOOGLE_SESSION_TILES],
    maxzoom: 22,
    attribution: '&copy; Google',
    official: true,
    ...overrides,
  })
}

/** A target that records the mutation order and tracks live membership. */
function recordingTarget() {
  // Stored in the map's own parameter shape, because that is what the
  // reconciler hands over; assertions narrow to the contribution's shapes.
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, Record<string, unknown>>()
  const order: string[] = []
  let attribution: string | null = null
  const target: SatelliteReconcileTarget = {
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
    replaceSatelliteAttribution: (next) => {
      order.push(`attribution:${next}`)
      attribution = next
    },
  }
  return {
    target,
    sources,
    layers,
    order,
    readAttribution: () => attribution,
  }
}

describe('satellite contribution reconciliation', () => {
  it('adds a source and layer for a ready provider', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileSatelliteContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    expect(readSource(sources, MAPLIBRE_SATELLITE_SOURCE_ID)?.tiles).toEqual([EOX_SATELLITE_TILES])
    expect(readLayer(layers, MAPLIBRE_SATELLITE_LAYER_ID)?.layout.visibility).toBe('visible')
  })

  it('applies the provider tile size and zoom ceiling rather than a fixed 256/19', () => {
    const { target, sources, readAttribution } = recordingTarget()
    reconcileSatelliteContribution(
      target,
      {
        state: 'ready',
        descriptor: googleDescriptor({ tileSize: 512 }),
        copyright: null,
      },
      { officialTilesResolvable: true },
    )
    const source = readSource(sources, MAPLIBRE_SATELLITE_SOURCE_ID)
    expect(source?.tileSize).toBe(512)
    expect(source?.maxzoom).toBe(22)
    // Basemap credit lives on the map-owned attribution control so a
    // copyright-only change never rebuilds the tile source.
    expect(readAttribution()).toBe('&copy; Google')
  })

  it('replaces one contribution instead of accumulating them on a provider switch', () => {
    const { target, sources, order } = recordingTarget()
    reconcileSatelliteContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    reconcileSatelliteContribution(
      target,
      {
        state: 'ready',
        descriptor: googleDescriptor(),
        copyright: null,
      },
      { officialTilesResolvable: true },
    )
    expect(sources.size).toBe(1)
    expect(readSource(sources, MAPLIBRE_SATELLITE_SOURCE_ID)?.tiles).toEqual([GOOGLE_SESSION_TILES])
    // The layer goes before its source, because MapLibre refuses to remove a
    // source a layer still references.
    expect(order.slice(-6)).toEqual([
      `removeLayer:${MAPLIBRE_SATELLITE_LAYER_ID}`,
      `removeSource:${MAPLIBRE_SATELLITE_SOURCE_ID}`,
      'attribution:',
      `addSource:${MAPLIBRE_SATELLITE_SOURCE_ID}`,
      expect.stringContaining('attribution:'),
      `addLayer:${MAPLIBRE_SATELLITE_LAYER_ID}`,
    ])
  })

  it('withdraws the contribution for idle and unavailable providers', () => {
    const states: SatelliteProviderState[] = [
      { state: 'idle' },
      { state: 'unavailable', provider: 'google', reason: GOOGLE_KEY_REQUIRED_REASON },
    ]
    for (const state of states) {
      const { target, sources, layers } = recordingTarget()
      reconcileSatelliteContribution(target, {
        state: 'ready',
        descriptor: descriptor(),
        copyright: null,
      })
      reconcileSatelliteContribution(target, state)
      // Leaving the previous provider's tiles up would present one provider's
      // imagery under another provider's name.
      expect(sources.size).toBe(0)
      expect(layers.size).toBe(0)
    }
  })

  it('keeps an unchanged tile source hidden while official metadata is pending', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileSatelliteContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: 'first',
    })
    expect(sources.size).toBe(1)
    // Loading with an already-installed source keeps the object and hides it,
    // so a pending metadata request cannot present falsely attributed imagery.
    reconcileSatelliteContribution(target, { state: 'loading', provider: 'google' })
    expect(sources.size).toBe(1)
    expect(layers.size).toBe(1)
  })

  it('withholds an official session template from a map without a tile transport', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileSatelliteContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    // Without a transport to resolve `{session}` every tile would fail, so the
    // honest outcome is no contribution rather than a broken Google source or
    // the previous provider's imagery under Google's name.
    reconcileSatelliteContribution(target, {
      state: 'ready',
      descriptor: googleDescriptor(),
      copyright: null,
    })
    expect(sources.size).toBe(0)
    expect(layers.size).toBe(0)
  })

  it('removes an idempotent contribution without error', () => {
    const { target, sources } = recordingTarget()
    reconcileSatelliteContribution(target, { state: 'idle' })
    reconcileSatelliteContribution(target, { state: 'idle' })
    expect(sources.size).toBe(0)
  })

  it('toggles visibility without touching the source', () => {
    const { target, sources, layers } = recordingTarget()
    reconcileSatelliteContribution(target, {
      state: 'ready',
      descriptor: descriptor(),
      copyright: null,
    })
    const before = readSource(sources, MAPLIBRE_SATELLITE_SOURCE_ID)
    setSatelliteContributionVisibility(target, false)
    expect(readLayer(layers, MAPLIBRE_SATELLITE_LAYER_ID)?.layout.visibility).toBe('none')
    expect(readSource(sources, MAPLIBRE_SATELLITE_SOURCE_ID)).toBe(before)
    setSatelliteContributionVisibility(target, true)
    expect(readLayer(layers, MAPLIBRE_SATELLITE_LAYER_ID)?.layout.visibility).toBe('visible')
  })

  it('ignores a visibility change when there is no contribution', () => {
    const { target } = recordingTarget()
    expect(() => setSatelliteContributionVisibility(target, false)).not.toThrow()
  })
})
