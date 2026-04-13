import { describe, expect, it } from 'vitest'
import {
  TERRAIN_CONTOUR_LAYER_IDS,
  TERRAIN_CONTOUR_SOURCE_ID,
  TERRAIN_DEM_SOURCE_ID,
  TERRAIN_HILLSHADE_LAYER_ID,
  createTerrainLayers,
  createTerrainSources,
} from '../maplibre/terrain'

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
})
