import { describe, expect, it } from 'vitest'
import {
  IDLE_MAPLIBRE_CANVAS_SURFACE_STATE,
  LOCAL_PROJECTION_WARNING_THRESHOLD_METERS,
  computeSceneExtentMeters,
  mapLibreCanvasSurfaceStateEquals,
  mergeMapLibreCanvasSurfaceState,
} from '../maplibre/canvas-surface-state'
import { createDefaultScenePersistedState } from '../canvas/runtime/scene'

describe('maplibre surface state adapter', () => {
  it('returns idle defaults from the shared state constant', () => {
    expect(IDLE_MAPLIBRE_CANVAS_SURFACE_STATE).toEqual({
      status: 'idle',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
      precisionWarning: false,
      designExtentMeters: null,
    })
  })

  it('merges precision warning data from the current scene extent', () => {
    const scene = createDefaultScenePersistedState()
    scene.plants.push({
      kind: 'plant',
      id: 'plant-1',
      canonicalName: 'Malus domestica',
      commonName: null,
      color: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: LOCAL_PROJECTION_WARNING_THRESHOLD_METERS + 5, y: 0 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: 1,
    })

    const merged = mergeMapLibreCanvasSurfaceState({
      status: 'ready',
      errorMessage: null,
      terrainStatus: 'idle',
      terrainErrorMessage: null,
    }, scene)

    expect(merged.precisionWarning).toBe(true)
    expect(merged.designExtentMeters).toBeGreaterThan(LOCAL_PROJECTION_WARNING_THRESHOLD_METERS)
  })

  it('detects state equality including terrain and precision fields', () => {
    const left = {
      status: 'ready' as const,
      errorMessage: null,
      terrainStatus: 'error' as const,
      terrainErrorMessage: 'dem failed',
      precisionWarning: true,
      designExtentMeters: 1234,
    }
    const right = { ...left }
    const different = { ...left, terrainErrorMessage: null }

    expect(mapLibreCanvasSurfaceStateEquals(left, right)).toBe(true)
    expect(mapLibreCanvasSurfaceStateEquals(left, different)).toBe(false)
  })

  it('computes scene extent from all geometry-bearing entities', () => {
    const scene = createDefaultScenePersistedState()
    scene.groups.push({
      kind: 'group',
      id: 'group-1',
      name: 'orchard',
      layer: 'zones',
      position: { x: 30, y: 40 },
      rotationDeg: null,
      memberIds: [],
    })

    expect(computeSceneExtentMeters(scene)).toBeCloseTo(50, 8)
  })
})
