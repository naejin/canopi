import { describe, expect, it, vi } from 'vitest'
import { createPanelTargetMapOverlayContract } from '../maplibre/panel-target-overlays'
import { syncPanelTargetMapOverlay } from '../maplibre/panel-target-overlay-sync'

// MapLibre validates source specifications strictly: an unknown key such as
// `id` is a style error, which the workspace reports as "Map unavailable".
const SOURCE_SPEC_KEYS = new Set(['type', 'data', 'maxzoom', 'attribution', 'buffer', 'tolerance', 'cluster', 'generateId', 'promoteId', 'lineMetrics'])

function fakeMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const layers = new Set<string>()
  return {
    addSource: vi.fn((id: string, spec: Record<string, unknown>) => {
      const unknown = Object.keys(spec).filter((key) => !SOURCE_SPEC_KEYS.has(key))
      if (unknown.length > 0) throw new Error(`sources.${id}: unknown property "${unknown[0]}"`)
      sources.set(id, { setData: vi.fn() })
    }),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => { sources.delete(id) },
    addLayer: vi.fn((layer: { id: string }) => { layers.add(layer.id) }),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    removeLayer: (id: string) => { layers.delete(id) },
  }
}

describe('panel target overlay sync', () => {
  it('adds the overlay source with a valid MapLibre source specification', () => {
    const map = fakeMap()
    const overlay = createPanelTargetMapOverlayContract('selection', {
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1.5, 43.6] }, properties: { kind: 'plant' } }],
      unresolvedTargets: [],
      skippedSceneIds: [],
      skippedReason: null,
    } as never)

    expect(() => syncPanelTargetMapOverlay(map as never, overlay)).not.toThrow()
    expect(map.addSource).toHaveBeenCalledWith('panel-target-selection-source', {
      type: 'geojson',
      data: overlay.source.data,
    })
  })
})
