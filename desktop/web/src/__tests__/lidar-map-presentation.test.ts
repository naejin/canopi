import { describe, expect, it } from 'vitest'
import {
  classifyLidarSync,
  lidarMapLayers,
  type LidarMapLayer,
} from '../app/canvas-map-surface/lidar'
import { lidarTileUrlTemplate } from '../app/lidar/tile-urls'
import { readLidarPresentation } from '../app/lidar/library-store'
import type { LidarTileset } from '../ipc/lidar'
import type {
  LidarAnalysisSummary,
  LidarLayerSummary,
  LidarLibrarySnapshot,
} from '../ipc/lidar'

function tileset(style: string): LidarTileset {
  return {
    style,
    path_template: '/data/lidar/display/source/lyr-1/gen-1/elevation/{z}_{x}_{y}.png',
    min_zoom: 13,
    max_zoom: 17,
    tile_size: 256,
    bounds: [-0.43, 48.3, -0.41, 48.31],
  }
}

function layerSummary(overrides: Partial<LidarLayerSummary> = {}): LidarLayerSummary {
  return {
    id: 'lyr-1',
    name: 'IGN ground',
    measurement_kind: 'GroundElevation',
    units: 'm',
    state: 'Ready',
    resolution_m: 0.5,
    coverage_cells: '4000000',
    bounds: [-0.43, 48.3, -0.41, 48.31],
    value_range: [12, 88],
    tilesets: [tileset('elevation')],
    analysis_count: 0,
    ...overrides,
  }
}

function analysisSummary(overrides: Partial<LidarAnalysisSummary> = {}): LidarAnalysisSummary {
  return {
    id: 'adef-1',
    source_layer_id: 'lyr-1',
    kind: 'Slope',
    state: 'Ready',
    detail: null,
    bounds: [-0.43, 48.3, -0.41, 48.31],
    value_range: [0, 71.4],
    tilesets: [tileset('slope')],
    ...overrides,
  }
}

function snapshot(overrides: Partial<LidarLibrarySnapshot> = {}): LidarLibrarySnapshot {
  return {
    layers: [layerSummary()],
    analyses: [],
    engine: { available: true, version: 'GDAL 3.8.4', detail: null },
    ...overrides,
  }
}

describe('lidar tile URLs', () => {
  it('resolves the directory through the asset protocol and keeps the tile marker', () => {
    const url = lidarTileUrlTemplate(tileset('elevation'), (path) => `asset://test/${path}`)
    expect(url).toBe('asset://test//data/lidar/display/source/lyr-1/gen-1/elevation/{z}_{x}_{y}.png')
  })

  it('uses the windows asset host form', () => {
    const originalPlatform = navigator.platform
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
    try {
      const url = lidarTileUrlTemplate(tileset('elevation'))
      expect(url.startsWith('http://asset.localhost/')).toBe(true)
      expect(url.endsWith('/{z}_{x}_{y}.png')).toBe(true)
    } finally {
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true })
    }
  })
})

describe('lidar map layer projection', () => {
  const design = {
    lidar: {
      entries: [
        { kind: 'Source' as const, id: 'lyr-1', visible: true, opacity: 0.8, order: 0, style: null },
        { kind: 'Analysis' as const, id: 'adef-1', visible: true, opacity: 1, order: 1, style: null },
        { kind: 'Source' as const, id: 'lyr-gone', visible: true, opacity: 1, order: 2, style: null },
      ],
    },
  }

  it('joins entries with library tilesets in presentation order', () => {
    const layers = lidarMapLayers(readLidarPresentation(design, snapshot({
      analyses: [analysisSummary()],
    })))
    expect(layers.map((entry) => entry.id)).toEqual([
      'lidar-elevation-lyr-1',
      'lidar-slope-adef-1',
    ])
    expect(layers[0]?.opacity).toBe(0.8)
    expect(layers[1]?.urlTemplate).toContain('{z}_{x}_{y}.png')
  })

  it('keeps hidden entries and unavailable references out of the map band', () => {
    const hidden = readLidarPresentation({
      lidar: {
        entries: [
          { kind: 'Source', id: 'lyr-1', visible: false, opacity: 1, order: 0, style: null },
          { kind: 'Source', id: 'lyr-gone', visible: true, opacity: 1, order: 1, style: null },
        ],
      },
    }, snapshot())
    expect(lidarMapLayers(hidden)).toEqual([])
    // Unavailable entries stay visible in the presentation with a flag.
    expect(hidden.some((item) => item.state === 'unavailable')).toBe(true)
  })

  it('skips preparing entities without display tiles yet', () => {
    const preparing = readLidarPresentation(design, snapshot({
      layers: [layerSummary({ tilesets: [], state: 'Preparing' })],
      analyses: [analysisSummary()],
    }))
    expect(lidarMapLayers(preparing).map((entry) => entry.id)).toEqual(['lidar-slope-adef-1'])
  })
})

describe('lidar map sync classification', () => {
  const base: LidarMapLayer = {
    id: 'lidar-elevation-lyr-1',
    name: 'IGN ground',
    visible: true,
    opacity: 1,
    urlTemplate: 'asset://test/tiles/{z}_{x}_{y}.png',
    minZoom: 13,
    maxZoom: 17,
    bounds: [-0.43, 48.3, -0.41, 48.31],
  }

  it('adds new layers, removes vanished layers, and paints opacity only', () => {
    const previous: LidarMapLayer[] = [base]
    const next: LidarMapLayer[] = [
      { ...base, opacity: 0.4 },
      { ...base, id: 'lidar-slope-adef-1', name: 'Slope' },
    ]
    const actions = classifyLidarSync(previous, next)
    expect(actions).toEqual([
      { type: 'paint', id: 'lidar-elevation-lyr-1', opacity: 0.4 },
      { type: 'add', layer: next[1] },
    ])
  })

  it('rebuilds a layer when its tile template changes', () => {
    const actions = classifyLidarSync([base], [{ ...base, urlTemplate: 'asset://test/other/{z}_{x}_{y}.png' }])
    expect(actions).toEqual([
      { type: 'remove', id: base.id },
      { type: 'add', layer: { ...base, urlTemplate: 'asset://test/other/{z}_{x}_{y}.png' } },
    ])
  })

  it.each([
    ['minimum zoom', { minZoom: 12 }],
    ['maximum zoom', { maxZoom: 18 }],
    ['bounds', { bounds: [-0.43, 48.3, -0.4, 48.31] as [number, number, number, number] }],
  ])('rebuilds a layer when its raster source %s changes', (_field, change) => {
    expect(classifyLidarSync([base], [{ ...base, ...change }])).toEqual([
      { type: 'remove', id: base.id },
      { type: 'add', layer: { ...base, ...change } },
    ])
  })

  it('is a no-op for equal bands', () => {
    expect(classifyLidarSync([base], [base])).toEqual([])
  })
})
