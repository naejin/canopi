import type { BasemapStyle, PlacementStatus } from '../generated/contracts'
import { createMapLibreEmptyStyle } from './config'
import type { MapLibreApi, MapLibreMapInstance } from './loader'

export interface WorkspaceMapSnapshot {
  readonly anchor: { readonly lat: number; readonly lon: number }
  readonly northBearingDeg: number
  readonly placementStatus: PlacementStatus
  readonly basemapStyle: BasemapStyle
  readonly basemapVisible: boolean
  readonly basemapOpacity: number
}

/**
 * Creates only the local map shell. Remote raster sources are intentionally
 * added by the workspace controls after `style.load` admits this map.
 */
export function createWorkspaceMapLibreMap(
  maplibre: MapLibreApi,
  container: HTMLElement,
  snapshot: WorkspaceMapSnapshot,
): MapLibreMapInstance {
  return new maplibre.Map({
    container,
    style: createMapLibreEmptyStyle(),
    center: [snapshot.anchor.lon, snapshot.anchor.lat],
    bearing: snapshot.northBearingDeg,
    attributionControl: { compact: true },
    interactive: false,
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: false,
  })
}
