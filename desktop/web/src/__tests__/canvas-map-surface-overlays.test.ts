import { describe, expect, it, vi } from 'vitest'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'
import {
  clearCanvasMapSurfaceOverlays,
  syncCanvasMapSurfaceOverlays,
  type CanvasMapSurfaceOverlaySnapshot,
} from '../app/canvas-map-surface/overlays'
import type { MapLibreOverlayMap } from '../maplibre/panel-target-overlay-sync'

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
      stratum: null,
      canopySpreadM: null,
      position: { x: 0, y: 0 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    },
  ]
  scene.zones = [
    {
      kind: 'zone',
      locked: false,
      name: 'orchard',
      zoneType: 'polygon',
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
    northBearingDeg: 12,
    hoveredTargets: [{ kind: 'zone', zone_name: 'orchard' }],
    selectedTargets: [{ kind: 'placed_plant', plant_id: 'plant-1' }],
    ...overrides,
  }
}

describe('canvas map surface overlay sync', () => {
  it('projects panel targets from the lifecycle snapshot into MapLibre overlay contracts', () => {
    const map = new FakeOverlayMap()

    syncCanvasMapSurfaceOverlays(map, createSnapshot(), true)

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

  it('clears hover and selection overlays when the lifecycle disables overlays', () => {
    const map = new FakeOverlayMap()
    syncCanvasMapSurfaceOverlays(map, createSnapshot(), true)
    map.removeLayer.mockClear()
    map.removeSource.mockClear()

    syncCanvasMapSurfaceOverlays(map, createSnapshot(), false)

    expect(map.removeLayer).toHaveBeenCalledWith('panel-target-hover-zones-fill')
    expect(map.removeLayer).toHaveBeenCalledWith('panel-target-selection-plants')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')
  })

  it('clears overlays when a snapshot lacks map authority inputs', () => {
    const map = new FakeOverlayMap()
    syncCanvasMapSurfaceOverlays(map, createSnapshot(), true)
    map.removeSource.mockClear()

    syncCanvasMapSurfaceOverlays(map, createSnapshot({ runtime: null }), true)
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')

    syncCanvasMapSurfaceOverlays(map, createSnapshot(), true)
    map.removeSource.mockClear()
    syncCanvasMapSurfaceOverlays(map, createSnapshot({ location: null }), true)
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')
  })

  it('exposes explicit clearing for lifecycle teardown and pre-ready errors', () => {
    const map = new FakeOverlayMap()
    syncCanvasMapSurfaceOverlays(map, createSnapshot(), true)
    map.removeSource.mockClear()

    clearCanvasMapSurfaceOverlays(map)

    expect(map.removeSource).toHaveBeenCalledWith('panel-target-hover-source')
    expect(map.removeSource).toHaveBeenCalledWith('panel-target-selection-source')
  })
})
