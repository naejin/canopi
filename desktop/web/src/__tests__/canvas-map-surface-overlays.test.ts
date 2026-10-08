import { describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import {
  clearCanvasMapSurfaceOverlays,
  syncCanvasMapSurfaceOverlays,
  syncCanvasMapSurfaceSiteHover,
  syncCanvasMapSurfaceSiteOverlay,
  type CanvasMapSurfaceOverlaySnapshot,
} from '../app/canvas-map-surface/overlays'
import type { MapLibreOverlayMap } from '../maplibre/panel-target-overlay-sync'
import { siteMapOverlayIds } from '../maplibre/site-overlay'

class FakeOverlayMap implements MapLibreOverlayMap {
  readonly addSource = vi.fn((id: string, source: Record<string, unknown>) => {
    this.sources.set(id, { source, setData: vi.fn() })
  })
  readonly getSource = vi.fn((id: string) => this.sources.get(id))
  readonly removeSource = vi.fn((id: string) => {
    this.sources.delete(id)
  })
  readonly addLayer = vi.fn((layer: Record<string, unknown>) => {
    if (typeof layer.id === 'string') this.layers.add(layer.id)
  })
  readonly getLayer = vi.fn((id: string) => (this.layers.has(id) ? { id } : undefined))
  readonly removeLayer = vi.fn((id: string) => {
    this.layers.delete(id)
  })
  readonly setPaintProperty = vi.fn()

  readonly sources = new Map<string, { source: Record<string, unknown>; setData(data: unknown): void }>()
  readonly layers = new Set<string>()
}

function createOverlayScene() {
  const scene = createDefaultScenePersistedState()
  scene.plants = [
    {
      kind: 'plant',
      locked: false,
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: 'Apple',
      color: null,
      canopySpreadM: null,
      position: { x: 0, y: 0 },
      rotationDeg: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    },
  ]
  scene.zones = [
    {
      kind: 'zone',
      locked: false,
      id: 'orchard', name: 'orchard',
      zoneType: 'polygon',
      rotationDeg: 0,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      fillColor: null,
      notes: null,
    },
  ]
  return scene
}

function createSnapshot(
  overrides: Partial<CanvasMapSurfaceOverlaySnapshot> = {},
): CanvasMapSurfaceOverlaySnapshot {
  const scene = createOverlayScene()
  return {
    runtime: {
      getSceneSnapshot: () => scene,
    },
    location: { lat: 48.8566, lon: 2.3522 },
    hoveredTargets: [{ kind: 'zone', zone_id: 'orchard' }],
    selectedTargets: [{ kind: 'placed_plant', plant_id: 'plant-1' }],
    ...overrides,
  }
}

describe('canvas map surface overlay sync', () => {
  it('clears empty overlays without reading Scene geometry', () => {
    const map = new FakeOverlayMap()
    syncCanvasMapSurfaceOverlays(map, createSnapshot())
    const read = vi.fn(() => createOverlayScene())
    syncCanvasMapSurfaceOverlays(map, createSnapshot({
      runtime: { getSceneSnapshot: read }, hoveredTargets: [], selectedTargets: [],
    }))
    expect(read).not.toHaveBeenCalled()
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
  })

  it('projects panel targets from the lifecycle snapshot into MapLibre overlay contracts', () => {
    const map = new FakeOverlayMap()

    syncCanvasMapSurfaceOverlays(map, createSnapshot())

    expect(map.addSource).toHaveBeenCalledWith(
      'panel-target-selection-source',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(map.addSource).toHaveBeenCalledWith(
      'panel-target-hover-source',
      expect.objectContaining({ type: 'geojson' }),
    )
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'panel-target-selection-plants' }))
    expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'panel-target-hover-zones-fill' }))
  })

  it('exposes explicit clearing for lifecycle teardown and pre-ready errors', () => {
    const map = new FakeOverlayMap()
    syncCanvasMapSurfaceOverlays(map, createSnapshot())
    map.removeSource.mockClear()

    clearCanvasMapSurfaceOverlays(map)

    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')
  })

  it('paints the Site data pin and line through their contract, again on the map a Retry rebuilds, and clears with neither', () => {
    const ids = siteMapOverlayIds()
    const site = { pin: [2.35, 48.85] as const, profileLine: [[2.35, 48.85], [2.36, 48.86]] as const }
    const map = new FakeOverlayMap()
    syncCanvasMapSurfaceSiteOverlay(map, site)
    syncCanvasMapSurfaceSiteHover(map, [2.355, 48.855])

    expect([...map.layers]).toEqual([...ids.layerIds, ...ids.hover.layerIds])
    expect(map.sources.get(ids.sourceId)?.source).toMatchObject({ type: 'geojson' })
    // The same pin again changes nothing on the map.
    map.addLayer.mockClear()
    syncCanvasMapSurfaceSiteOverlay(map, site)
    expect(map.addLayer).not.toHaveBeenCalled()
    expect(map.sources.get(ids.sourceId)?.setData).not.toHaveBeenCalled()

    // Retry builds a new map: the next drain paints the same pin there.
    const rebuilt = new FakeOverlayMap()
    syncCanvasMapSurfaceSiteOverlay(rebuilt, site)
    expect([...rebuilt.layers]).toEqual([...ids.layerIds])

    syncCanvasMapSurfaceSiteOverlay(map, { pin: null, profileLine: null })
    expect(map.layers.size).toBe(0)
    expect(map.sources.size).toBe(0)
  })
})
