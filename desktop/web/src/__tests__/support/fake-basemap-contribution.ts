/**
 * The basemap contribution surface a live map must offer.
 *
 * The app reconciles the basemap provider into whichever map surface is live, so
 * a test fake that cannot be reconciled is not a map the app can run against.
 * Testing that binding therefore needs the source and layer operations on every
 * fake, and this keeps one definition instead of one per test file.
 */
export interface FakeBasemapContribution {
  readonly sources: Map<string, Record<string, unknown>>
  readonly layers: Map<string, Record<string, unknown>>
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): Record<string, unknown> | undefined
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>): void
  getLayer(id: string): Record<string, unknown> | undefined
  removeLayer(id: string): void
  setLayoutProperty(id: string, name: string, value: unknown): void
}

/** Create the contribution state a fake map mixes in. */
export function createFakeBasemapContribution(): FakeBasemapContribution {
  const sources = new Map<string, Record<string, unknown>>()
  const layers = new Map<string, Record<string, unknown>>()
  return {
    sources,
    layers,
    addSource(id, source) {
      sources.set(id, source)
    },
    getSource(id) {
      return sources.get(id)
    },
    removeSource(id) {
      sources.delete(id)
    },
    addLayer(layer) {
      layers.set(String(layer.id), layer)
    },
    getLayer(id) {
      return layers.get(id)
    },
    removeLayer(id) {
      layers.delete(id)
    },
    setLayoutProperty(id, name, value) {
      const layer = layers.get(id)
      if (layer && name === 'visibility') {
        // MapLibre mutates the layer's layout in place, so the fake records it
        // the same way and a visibility assertion reads the same shape.
        layer.layout = { ...(layer.layout as Record<string, unknown>), visibility: value }
      }
    },
  }
}
