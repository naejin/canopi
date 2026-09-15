import type { LidarTileset } from '../../ipc/lidar'
import type { LidarPresentationItem } from '../lidar/library-store'
import { lidarTileUrlTemplate } from '../lidar/tile-urls'
import { styleForKind } from '../lidar/library-store'

/**
 * Map-facing description of one LiDAR band entry. Sources and results are
 * ordered together; lower order renders further back.
 */
export interface LidarMapLayer {
  id: string
  name: string
  visible: boolean
  opacity: number
  urlTemplate: string
  minZoom: number
  maxZoom: number
  bounds: [number, number, number, number]
}

export function lidarMapLayers(items: LidarPresentationItem[]): LidarMapLayer[] {
  const layers: LidarMapLayer[] = []
  for (const item of items) {
    if (!item.visible || item.state === 'unavailable') {
      continue
    }
    const style = styleForKind(item.kind)
    const tileset = item.tilesets.find((candidate) => candidate.style === style)
    if (!tileset || !tilesetOk(tileset)) {
      // Passive display degradation: entities without tiles render nothing
      // while the rest of the band keeps working.
      continue
    }
    layers.push({
      id: lidarLayerId(item.id, style),
      name: item.name,
      visible: item.visible,
      opacity: item.opacity,
      urlTemplate: lidarTileUrlTemplate(tileset),
      minZoom: tileset.min_zoom,
      maxZoom: tileset.max_zoom,
      bounds: tileset.bounds,
    })
  }
  return layers
}

function tilesetOk(tileset: LidarTileset): boolean {
  return (
    tileset.max_zoom >= tileset.min_zoom &&
    tileset.bounds.every((value) => Number.isFinite(value))
  )
}

export function lidarLayerId(entityId: string, style: string): string {
  return `lidar-${style}-${entityId}`
}

/**
 * Pure sync classification for one surface update. Adding and removing
 * sources/layers changes source shape; opacity-only changes stay paint-only
 * so opacity drags never reload tiles.
 */
export type LidarSyncAction =
  | { type: 'add'; layer: LidarMapLayer }
  | { type: 'remove'; id: string }
  | { type: 'paint'; id: string; opacity: number }

export function classifyLidarSync(
  previous: LidarMapLayer[],
  next: LidarMapLayer[],
): LidarSyncAction[] {
  const actions: LidarSyncAction[] = []
  const previousById = new Map(previous.map((layer) => [layer.id, layer]))
  const nextById = new Map(next.map((layer) => [layer.id, layer]))
  for (const layer of previous) {
    if (!nextById.has(layer.id)) {
      actions.push({ type: 'remove', id: layer.id })
    }
  }
  for (const layer of next) {
    const before = previousById.get(layer.id)
    if (!before) {
      actions.push({ type: 'add', layer })
      continue
    }
    if (before.urlTemplate !== layer.urlTemplate) {
      actions.push({ type: 'remove', id: layer.id })
      actions.push({ type: 'add', layer })
      continue
    }
    if (before.opacity !== layer.opacity) {
      actions.push({ type: 'paint', id: layer.id, opacity: layer.opacity })
    }
  }
  return actions
}

// ---------------------------------------------------------------------------
// MapLibre application (low-level, typed through MapLibreMapInstance)
// ---------------------------------------------------------------------------

const FIRST_NON_LIDAR_LAYER_CANDIDATES = [
  'panel-target-hover-zones-fill',
  'panel-target-selection-zones-fill',
  'contour-minor',
  'contour-major',
  'hillshade-layer',
] as const

/**
 * Known overlay/terrain layer ids act as the insertion boundary so a LiDAR
 * layer added after the map already carries overlays still lands between the
 * basemap and those overlays.
 */
export function firstNonLidarLayerId(map: LidarMapLike): string | undefined {
  return FIRST_NON_LIDAR_LAYER_CANDIDATES.find((id) => map.getLayer(id) != null)
}

export interface LidarMapLike {
  addSource(id: string, source: Record<string, unknown>): void
  getSource(id: string): unknown
  removeSource(id: string): void
  addLayer(layer: Record<string, unknown>): void
  getLayer(id: string): unknown
  removeLayer(id: string): void
  setPaintProperty?(layerId: string, name: string, value: unknown): void
}

export function applyLidarSync(map: LidarMapLike, actions: LidarSyncAction[]): void {
  for (const action of actions) {
    if (action.type === 'paint') {
      map.setPaintProperty?.(action.id, 'raster-opacity', action.opacity)
      continue
    }
    if (action.type === 'remove') {
      removeLidarLayer(map, action.id)
      continue
    }
    addLidarLayer(map, action.layer)
  }
}

function addLidarLayer(map: LidarMapLike, layer: LidarMapLayer): void {
  if (map.getSource(layer.id) == null) {
    map.addSource(layer.id, {
      type: 'raster',
      tiles: [layer.urlTemplate],
      tileSize: 256,
      minzoom: layer.minZoom,
      maxzoom: layer.maxZoom + 1,
      bounds: layer.bounds,
    })
  }
  if (map.getLayer(layer.id) == null) {
    const beforeId = firstNonLidarLayerId(map)
    if (beforeId != null) {
      ;(map.addLayer as (layer: Record<string, unknown>, beforeId?: string) => void)(
        {
          id: layer.id,
          type: 'raster',
          source: layer.id,
          paint: { 'raster-opacity': layer.opacity },
        },
        beforeId,
      )
    } else {
      map.addLayer({
        id: layer.id,
        type: 'raster',
        source: layer.id,
        paint: { 'raster-opacity': layer.opacity },
      })
    }
  } else {
    map.setPaintProperty?.(layer.id, 'raster-opacity', layer.opacity)
  }
}

function removeLidarLayer(map: LidarMapLike, id: string): void {
  if (map.getLayer(id) != null) {
    map.removeLayer(id)
  }
  if (map.getSource(id) != null) {
    map.removeSource(id)
  }
}

/** Remove every applied LiDAR layer/source from a map being torn down. */
export function clearLidarSync(map: LidarMapLike, layers: LidarMapLayer[]): void {
  for (const layer of layers) {
    removeLidarLayer(map, layer.id)
  }
}
