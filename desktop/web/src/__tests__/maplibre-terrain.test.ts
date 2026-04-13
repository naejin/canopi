import { describe, expect, it, vi } from 'vitest'
import {
  TERRAIN_CONTOUR_LAYER_IDS,
  TERRAIN_CONTOUR_SOURCE_ID,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  buildContourPaints,
  buildHillshadePaint,
  createTerrainLayers,
  createTerrainSources,
} from '../maplibre/terrain'
import {
  applyTerrainPaintUpdates,
  classifyTerrainSync,
} from '../maplibre/terrain-sync'

const PROTOCOLS = {
  sharedDemProtocolUrl: 'canopi-terrain-shared://{z}/{x}/{y}',
  contourProtocolUrl: () => 'canopi-terrain-contours://{z}/{x}/{y}?thresholds=auto',
}

describe('maplibre terrain contract', () => {
  it('creates stable terrain source ids without widening the design layer schema', () => {
    const sources = createTerrainSources(PROTOCOLS, {
      contourIntervalMeters: 0,
      contoursVisible: true,
      contoursOpacity: 0.5,
      hillshadeVisible: true,
      hillshadeOpacity: 0.6,
      isDark: false,
    })

    expect(sources).toEqual([
      expect.objectContaining({
        id: TERRAIN_DEM_SOURCE_ID,
        source: expect.objectContaining({ type: 'raster-dem' }),
      }),
      expect.objectContaining({
        id: TERRAIN_CONTOUR_SOURCE_ID,
        source: expect.objectContaining({
          type: 'vector',
          tiles: ['canopi-terrain-contours://{z}/{x}/{y}?thresholds=auto'],
        }),
      }),
    ])
  })

  it('scales contour and hillshade styling from the terrain view controls', () => {
    const layers = createTerrainLayers({
      contourIntervalMeters: 10,
      contoursVisible: true,
      contoursOpacity: 0.4,
      hillshadeVisible: true,
      hillshadeOpacity: 0.25,
      isDark: true,
    })

    expect(layers.map((layer) => layer.id)).toEqual([
      TERRAIN_HILLSHADE_LAYER_ID,
      ...TERRAIN_CONTOUR_LAYER_IDS,
    ])
    expect(layers[0]).toEqual(expect.objectContaining({
      paint: expect.objectContaining({
        'hillshade-shadow-color': 'rgba(90, 74, 58, 0.25)',
      }),
    }))
    expect(layers[1]).toEqual(expect.objectContaining({
      source: TERRAIN_CONTOUR_SOURCE_ID,
      paint: expect.objectContaining({
        'line-opacity': 0.24,
      }),
    }))
    expect(layers[2]).toEqual(expect.objectContaining({
      paint: expect.objectContaining({
        'line-opacity': 0.32000000000000006,
      }),
    }))
  })

  it('classifies paint-only terrain changes separately from rebuild changes', () => {
    const previous = {
      contourIntervalMeters: 10,
      contoursVisible: true,
      contoursOpacity: 0.4,
      hillshadeVisible: true,
      hillshadeOpacity: 0.25,
      isDark: false,
    }

    expect(classifyTerrainSync(previous, {
      ...previous,
      contoursOpacity: 0.6,
    })).toBe('paint')
    expect(classifyTerrainSync(previous, {
      ...previous,
      isDark: true,
    })).toBe('paint')
    expect(classifyTerrainSync(previous, {
      ...previous,
      contourIntervalMeters: 25,
    })).toBe('rebuild')
    expect(classifyTerrainSync(previous, {
      ...previous,
      contoursVisible: false,
    })).toBe('rebuild')
    expect(classifyTerrainSync({
      ...previous,
      contoursVisible: false,
    }, {
      ...previous,
      contoursVisible: false,
      contourIntervalMeters: 25,
    })).toBe('noop')
  })

  it('applies paint-only terrain updates without recreating sources or layers', () => {
    const setPaintProperty = vi.fn()
    const map = {
      addSource: vi.fn(),
      getSource: vi.fn(),
      removeSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: (id: string) => ({ id }),
      removeLayer: vi.fn(),
      setPaintProperty,
    }
    const state = {
      contourIntervalMeters: 10,
      contoursVisible: true,
      contoursOpacity: 0.4,
      hillshadeVisible: true,
      hillshadeOpacity: 0.25,
      isDark: true,
    }

    applyTerrainPaintUpdates(map, state)

    const contourPaints = buildContourPaints(state)
    const hillshadePaint = buildHillshadePaint(state)
    expect(setPaintProperty).toHaveBeenCalledWith(
      TERRAIN_HILLSHADE_LAYER_ID,
      'hillshade-shadow-color',
      hillshadePaint['hillshade-shadow-color'],
    )
    expect(setPaintProperty).toHaveBeenCalledWith(
      TERRAIN_CONTOUR_LAYER_IDS[0],
      'line-opacity',
      contourPaints.minor['line-opacity'],
    )
    expect(map.addSource).not.toHaveBeenCalled()
    expect(map.addLayer).not.toHaveBeenCalled()
  })
})
