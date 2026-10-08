import { describe, expect, it, vi } from 'vitest'
import { createPanelTargetMapOverlayContract } from './panel-target-overlays'
import { clearPanelTargetMapOverlay, syncMapOverlay } from './panel-target-overlay-sync'

function fakeMap() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>()
  const layers = new Set<string>()
  return {
    sources,
    addSource: vi.fn((id: string) => { sources.set(id, { setData: vi.fn() }) }),
    getSource: (id: string) => sources.get(id),
    removeSource: (id: string) => { sources.delete(id) },
    addLayer: vi.fn((layer: { id: string }) => { layers.add(layer.id) }),
    getLayer: (id: string) => (layers.has(id) ? {} : undefined),
    setPaintProperty: vi.fn(),
    removeLayer: (id: string) => { layers.delete(id) },
  }
}

function selectionAt(lon: number, lat: number) {
  return createPanelTargetMapOverlayContract('selection', [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { kind: 'plant' } },
  ] as never)
}

describe('panel target overlay data', () => {
  it('sets an overlay source\'s data only when the projected data changed', () => {
    const map = fakeMap()
    syncMapOverlay(map as never, selectionAt(1.5, 43.6))
    const source = map.sources.get('panel-target-selection-source')!

    // A re-sync with the same ground (a settled camera, a repaint) leaves the source alone.
    syncMapOverlay(map as never, selectionAt(1.5, 43.6))
    syncMapOverlay(map as never, selectionAt(1.5, 43.6))
    expect(source.setData).not.toHaveBeenCalled()

    // Moved Targets or a new plane change the data: it is set once.
    const moved = selectionAt(1.51, 43.6)
    syncMapOverlay(map as never, moved)
    syncMapOverlay(map as never, selectionAt(1.51, 43.6))
    expect(source.setData).toHaveBeenCalledOnce()
    expect(source.setData).toHaveBeenCalledWith(moved.source.data)

    // A cleared overlay starts again from its added source.
    clearPanelTargetMapOverlay(map as never, 'selection')
    syncMapOverlay(map as never, selectionAt(1.51, 43.6))
    expect(map.addSource).toHaveBeenCalledTimes(2)
    expect(map.sources.get('panel-target-selection-source')!.setData).not.toHaveBeenCalled()
  })
})
