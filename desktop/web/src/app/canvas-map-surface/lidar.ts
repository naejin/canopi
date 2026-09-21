import type { LidarTileset } from '../../ipc/lidar'
import type { LidarPresentationItem } from '../lidar/library-store'
import { lidarTileUrlTemplate, tileEntityKind } from '../lidar/tile-urls'
import { styleForKind } from '../lidar/library-store'

import type { LidarMapLayer } from './lidar-sync'
export * from './lidar-sync'

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
      urlTemplate: lidarTileUrlTemplate(tileset, {
        entityKind: tileEntityKind(item.kind),
        entityId: item.id,
      }),
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
