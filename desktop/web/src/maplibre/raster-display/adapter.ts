/**
 * Canopi raster display adapter: one upstream `LayerManager` per live map.
 *
 * This is the only owner of `maplibre-gl-raster` objects. It selects the
 * `cog-tiler-wasm` engine and injects Canopi collaborators through the public
 * `LayerManagerDeps` seam:
 *
 * - `loadCogTiler` returns a client of the shared worker pool, so decoding,
 *   reprojection and colorizing run off the UI thread;
 * - `loadMosaic` resolves an in-memory ordered asset list for a multi-source
 *   library item, instead of fetching a manifest;
 * - `computeAutoStats` is refused: the library supplies one layer-wide stretch,
 *   so speculative main-thread statistics never run.
 *
 * Layer identity is caller-owned and must change with the displayed immutable
 * generation, so a stale tile can never be served for newer data under the
 * same MapLibre source. Opacity is a paint change; visibility, style and asset
 * changes rebuild only the affected layer. `dispose()` destroys the manager
 * (its MapLibre layers, sources, protocol and listeners) and releases the pool
 * client, which rejects queued work and closes worker sources.
 */
import type { RasterPoolClient, RasterTileRequest, RasterWorkerPool } from './pool'
import { rasterWorkerPool } from './pool'
import { recordRaster } from './diagnostics'

type RasterModule = typeof import('maplibre-gl-raster')
type LayerManager = InstanceType<RasterModule['LayerManager']>
type LayerManagerMap = ConstructorParameters<RasterModule['LayerManager']>[0]

export type RasterBounds = readonly [west: number, south: number, east: number, north: number]

export interface RasterDisplayAsset {
  /** Range-readable URL of one immutable display COG. */
  readonly url: string
  /** WGS84 footprint used to cull the asset per tile. */
  readonly bbox: RasterBounds
}

export interface RasterDisplayLayer {
  /** MapLibre layer id; must change when the displayed generation changes. */
  readonly id: string
  readonly name: string
  /** Display COGs, first listed on top where they overlap. */
  readonly assets: readonly RasterDisplayAsset[]
  readonly bounds: RasterBounds
  readonly opacity: number
  /** One layer-wide stretch in the stored units. */
  readonly rescale: readonly [number, number]
  readonly colormap: string
  readonly reversed: boolean
}

export type RasterDisplayLayerState = 'loading' | 'ready' | 'error'

export interface RasterDisplayOptions {
  /** The engine added, replaced or removed map layers after an async load. */
  readonly onLayersChanged?: () => void
  readonly onLayerStateChange?: (id: string, state: RasterDisplayLayerState, error?: Error) => void
  readonly loadRasterModule?: () => Promise<RasterModule>
  readonly pool?: RasterWorkerPool
}

/** Map surface the adapter reads for viewport relevance. */
export interface RasterDisplayMap {
  getBounds?(): { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }
  getZoom?(): number
  getLayersOrder?(): string[]
  getLayer?(id: string): unknown
  isStyleLoaded?(): boolean
  on?(type: 'idle' | 'sourcedata', listener: () => void): void
  off?(type: 'idle' | 'sourcedata', listener: () => void): void
}

export interface RasterDisplay {
  /** Replace the desired layers, bottom first, placed beneath `beforeId`. */
  sync(layers: readonly RasterDisplayLayer[], beforeId: string | undefined): void
  /** Layer ids the manager currently owns, bottom first. */
  layerIds(): string[]
  state(id: string): RasterDisplayLayerState | undefined
  readonly disposed: boolean
  dispose(): void
}

const MOSAIC_SCHEME = 'canopi-display-mosaic'

interface Applied {
  readonly layer: RasterDisplayLayer
  readonly styleKey: string
  readonly sourceKey: string
}

export function createRasterDisplay(
  map: RasterDisplayMap,
  options: RasterDisplayOptions = {},
): RasterDisplay {
  const client = (options.pool ?? rasterWorkerPool()).acquire()
  client.setRelevance((tile) => tileIsRelevant(map, tile))
  const mosaics = new Map<string, RasterDisplayLayer>()
  const applied = new Map<string, Applied>()
  const states = new Map<string, RasterDisplayLayerState>()
  let manager: LayerManager | null = null
  let desired: readonly RasterDisplayLayer[] = []
  let desiredBeforeId: string | undefined
  let disposed = false
  let nudging = false

  /**
   * The engine gates its first map mutation on `isStyleLoaded()`, which is
   * false while any source (the basemap) is still loading, and then waits for
   * a style event that a settled style never emits. Until every desired layer
   * reaches the map, re-apply once the style reports loaded.
   */
  const nudge = () => {
    if (disposed || !manager) return stopNudging()
    const missing = desired.some((layer) => applied.has(layer.id) && map.getLayer?.(layer.id) == null)
    if (!missing) return stopNudging()
    if (!map.isStyleLoaded?.()) return
    const first = desired.find((layer) => applied.has(layer.id) && map.getLayer?.(layer.id) == null)
    if (first) manager.setState(first.id, {})
  }
  const startNudging = () => {
    if (nudging || !map.on || !map.getLayer) return
    nudging = true
    map.on('idle', nudge)
    map.on('sourcedata', nudge)
  }
  function stopNudging(): void {
    if (!nudging) return
    nudging = false
    map.off?.('idle', nudge)
    map.off?.('sourcedata', nudge)
  }

  const setState = (id: string, next: RasterDisplayLayerState, error?: Error) => {
    if (states.get(id) === next) return
    states.set(id, next)
    recordRaster({ kind: `layer-${next}`, id, detail: error?.message })
    options.onLayerStateChange?.(id, next, error)
  }

  const load = options.loadRasterModule ?? (() => import('maplibre-gl-raster'))
  void load().then((module) => {
    if (disposed) return
    // The published declaration types `loadCogTiler` through a symbol the
    // pinned `cog-tiler-wasm` does not export, so the deps are cast once here.
    const deps = {
      loadCogTiler: async () => client,
      loadMosaic: async (url: string) => mosaicFor(mosaics, url),
      computeAutoStats: () => Promise.reject(new Error('display statistics come from the library')),
    }
    manager = new module.LayerManager(map as unknown as LayerManagerMap, { engine: 'cog-tiler-wasm' }, deps as never)
    manager.on('rasterchange', (event) => {
      recordRaster({ kind: 'rasterchange', id: event.layerId, detail: map.getLayersOrder?.().filter((id) => id.startsWith('lidar-')).join(',') })
      if (!event.layerId) return
      const layer = manager?.getLayer(event.layerId)
      if (!layer) return
      if (layer.error) setState(event.layerId, 'error', layer.error)
      else if (!layer.loading) setState(event.layerId, 'ready')
      options.onLayersChanged?.()
    })
    manager.on('error', (event) => {
      if (event.layerId) setState(event.layerId, 'error', event.error)
    })
    reconcile()
  }, (error: unknown) => {
    if (disposed) return
    for (const layer of desired) setState(layer.id, 'error', error instanceof Error ? error : new Error(String(error)))
  })

  function reconcile(): void {
    const current = manager
    if (!current || disposed) return
    const wanted = new Map(desired.map((layer) => [layer.id, layer]))
    for (const id of [...applied.keys()]) {
      const next = wanted.get(id)
      if (next && applied.get(id)!.sourceKey === sourceKey(next)) continue
      current.removeRaster(id)
      recordRaster({ kind: 'remove', id })
      applied.delete(id)
      mosaics.delete(id)
      states.delete(id)
    }
    desired.forEach((layer, index) => {
      const previous = applied.get(layer.id)
      const styleKey = styleKeyOf(layer)
      if (!previous) {
        const url = layer.assets.length === 1
          ? layer.assets[0]!.url
          : registerMosaic(mosaics, layer)
        setState(layer.id, 'loading')
        recordRaster({ kind: 'add', id: layer.id, detail: `${layer.assets.length} asset(s)` })
        applied.set(layer.id, { layer, styleKey, sourceKey: sourceKey(layer) })
        current.addRaster(url, {
          id: layer.id,
          name: layer.name,
          zoomTo: false,
          beforeId: desiredBeforeId,
          state: stateFor(layer),
        }).catch((error: unknown) => {
          if (disposed || applied.get(layer.id)?.layer !== layer) return
          setState(layer.id, 'error', error instanceof Error ? error : new Error(String(error)))
        })
      } else {
        if (previous.styleKey !== styleKey) {
          current.setState(layer.id, stateFor(layer))
        } else if (previous.layer.opacity !== layer.opacity) {
          current.setState(layer.id, { opacity: layer.opacity })
        }
        applied.set(layer.id, { layer, styleKey, sourceKey: previous.sourceKey })
        current.setBeforeId(layer.id, desiredBeforeId ?? null)
      }
      const order = current.getLayers().findIndex((candidate) => candidate.id === layer.id)
      if (order !== index && order >= 0) current.reorder(layer.id, index)
    })
    if (desired.length > 0) startNudging()
    options.onLayersChanged?.()
  }

  return {
    sync(layers, beforeId) {
      if (disposed) return
      recordRaster({ kind: 'sync', detail: `${layers.map((layer) => layer.id).join(',')} before ${beforeId ?? '-'}` })
      desired = layers
      desiredBeforeId = beforeId
      reconcile()
    },
    layerIds() {
      return manager ? manager.getLayers().map((layer) => layer.id) : []
    },
    state: (id) => states.get(id),
    get disposed() {
      return disposed
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopNudging()
      try {
        manager?.destroy()
      } finally {
        manager = null
        applied.clear()
        mosaics.clear()
        states.clear()
        client.dispose()
      }
    },
  }
}

function stateFor(layer: RasterDisplayLayer) {
  return {
    mode: 'single' as const,
    bands: [1],
    colormap: layer.colormap,
    reversed: layer.reversed,
    rescale: [[layer.rescale[0], layer.rescale[1]]] as [number, number][],
    // Each derivative carries its own validity tag; one override value could
    // not describe sources with different NoData markers.
    nodata: 'auto' as const,
    opacity: layer.opacity,
    visible: true,
  }
}

function styleKeyOf(layer: RasterDisplayLayer): string {
  return JSON.stringify([layer.colormap, layer.reversed, layer.rescale])
}

function sourceKey(layer: RasterDisplayLayer): string {
  return JSON.stringify(layer.assets.map((asset) => asset.url))
}

function registerMosaic(mosaics: Map<string, RasterDisplayLayer>, layer: RasterDisplayLayer): string {
  mosaics.set(layer.id, layer)
  return `${MOSAIC_SCHEME}://layer/${encodeURIComponent(layer.id)}.json`
}

function mosaicFor(mosaics: Map<string, RasterDisplayLayer>, url: string) {
  const match = url.match(new RegExp(`^${MOSAIC_SCHEME}://layer/(.+)\\.json$`))
  const layer = match ? mosaics.get(decodeURIComponent(match[1]!)) : undefined
  if (!layer) throw new Error(`Unknown display mosaic ${url}`)
  const [west, south, east, north] = layer.bounds
  return {
    kind: 'mosaicjson' as const,
    assets: layer.assets.map((asset) => ({ url: asset.url, bbox: [...asset.bbox] as [number, number, number, number] })),
    bounds: { west, south, east, north },
    minzoom: null,
    maxzoom: null,
  }
}

/**
 * Whether a queued tile still intersects the live viewport (padded by one
 * tile) at a zoom MapLibre could still want. Tiles MapLibre has already
 * abandoned are dropped before they reach a worker.
 */
export function tileIsRelevant(map: RasterDisplayMap, tile: RasterTileRequest): boolean {
  const bounds = map.getBounds?.()
  const zoom = map.getZoom?.()
  if (!bounds || zoom === undefined) return true
  if (tile.z < Math.floor(zoom) - 2 || tile.z > Math.ceil(zoom) + 1) return false
  const n = 2 ** tile.z
  const tileWest = (tile.x / n) * 360 - 180
  const tileEast = ((tile.x + 1) / n) * 360 - 180
  const lat = (row: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI
  const tileNorth = lat(tile.y)
  const tileSouth = lat(tile.y + 1)
  const padX = 360 / n
  const padY = Math.max(tileNorth - tileSouth, 1e-9)
  const west = bounds.getWest() - padX
  const east = bounds.getEast() + padX
  const south = bounds.getSouth() - padY
  const north = bounds.getNorth() + padY
  // Longitudes may be unwrapped past ±180 around world copies; compare modulo.
  const wraps = east - west >= 360
  const overlapsX = wraps || [0, -360, 360].some((shift) => tileEast + shift >= west && tileWest + shift <= east)
  return overlapsX && tileNorth >= south && tileSouth <= north
}

export type { RasterPoolClient }
