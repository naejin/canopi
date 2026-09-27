import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPanelTargetMapOverlayContract } from '../maplibre/panel-target-overlays'
import { syncPanelTargetMapOverlay } from '../maplibre/panel-target-overlay-sync'
import { canvasPaintRevision, getCanvasColor, refreshCanvasColorCache } from '../canvas/theme-refresh'
import { setCanvasMapBackdrop } from '../canvas/runtime/scene-visuals'

// MapLibre validates source specifications strictly: an unknown key such as
// `id` is a style error, which the workspace reports as "Map unavailable".
const SOURCE_SPEC_KEYS = new Set(['type', 'data', 'maxzoom', 'attribution', 'buffer', 'tolerance', 'cluster', 'generateId', 'promoteId', 'lineMetrics'])

function fakeMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const layers = new Map<string, Record<string, unknown>>()
  return {
    layers,
    addSource: vi.fn((id: string, spec: Record<string, unknown>) => {
      const unknown = Object.keys(spec).filter((key) => !SOURCE_SPEC_KEYS.has(key))
      if (unknown.length > 0) throw new Error(`sources.${id}: unknown property "${unknown[0]}"`)
      sources.set(id, { setData: vi.fn() })
    }),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => { sources.delete(id) },
    addLayer: vi.fn((layer: { id: string; paint: Record<string, unknown> }) => { layers.set(layer.id, { ...layer.paint }) }),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    setPaintProperty: vi.fn((id: string, name: string, value: unknown) => { layers.get(id)![name] = value }),
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

  describe('when the canvas colours change', () => {
    const LIGHT = { '--canvas-selection-stroke': '#9C5A16', '--canvas-interaction-casing': '#FFF8EC' }
    function applyColors(colors: Record<string, string>): void {
      const container = document.createElement('div')
      for (const [name, value] of Object.entries(colors)) container.style.setProperty(name, value)
      refreshCanvasColorCache(container)
    }
    afterEach(() => {
      applyColors(LIGHT)
      setCanvasMapBackdrop('basemap')
    })

    it('repaints an overlay already on the map through the canvas colours, without re-adding it', () => {
      const map = fakeMap()
      const contract = () => createPanelTargetMapOverlayContract('selection', {
        features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1.5, 43.6] }, properties: { kind: 'plant' } }],
        unresolvedTargets: [],
        skippedSceneIds: [],
        skippedReason: null,
      } as never)
      syncPanelTargetMapOverlay(map as never, contract())
      expect(map.layers.get('panel-target-selection-plants')?.['circle-stroke-color']).toBe('#9C5A16')
      const added = map.addLayer.mock.calls.length

      const revision = canvasPaintRevision.value
      applyColors({ '--canvas-selection-stroke': '#E0A458', '--canvas-interaction-casing': '#1E1A14' })
      expect(getCanvasColor('selection-stroke')).toBe('#E0A458')
      // The workspace re-syncs its overlays when this revision moves.
      expect(canvasPaintRevision.value).toBeGreaterThan(revision)
      syncPanelTargetMapOverlay(map as never, contract())

      expect(map.addLayer.mock.calls.length).toBe(added)
      expect(map.layers.get('panel-target-selection-plants')?.['circle-stroke-color']).toBe('#E0A458')
      expect(map.layers.get('panel-target-selection-plants-halo')?.['circle-stroke-color']).toBe('#1E1A14')
      expect(map.layers.get('panel-target-selection-zones-line')?.['line-color']).toBe('#E0A458')
    })

    it('moves the paint revision on a backdrop change, and only on a change', () => {
      const revision = canvasPaintRevision.value
      setCanvasMapBackdrop('basemap')
      expect(canvasPaintRevision.value).toBe(revision)
      setCanvasMapBackdrop('satellite')
      expect(canvasPaintRevision.value).toBeGreaterThan(revision)
      const settled = canvasPaintRevision.value
      applyColors({ '--canvas-selection-stroke': getCanvasColor('selection-stroke') })
      expect(canvasPaintRevision.value).toBe(settled)
    })
  })
})
