import type { BasemapStyle, PlacementStatus } from '../generated/contracts'
import { createMapLibreEmptyStyle, normalizeBasemapStyle } from './config'
import type { MapLibreApi, MapLibreMapInstance } from './loader'
import {
  WORKSPACE_MAP_MAX_ZOOM,
  WORKSPACE_MAP_MIN_ZOOM,
} from '../canvas/workspace-camera-policy'
import { maplibreBearingFromNorthBearing } from '../canvas/maplibre-camera'

export interface WorkspaceMapSnapshot {
  readonly anchor: { readonly lat: number; readonly lon: number }
  readonly northBearingDeg: number
  readonly placementStatus: PlacementStatus
  readonly basemapStyle: BasemapStyle
  readonly basemapVisible: boolean
  readonly basemapOpacity: number
}

/** Live, map-owned presentation. Spatial placement remains generation-fixed. */
export interface WorkspaceBasemapPresentation {
  readonly basemapStyle: BasemapStyle
  readonly basemapVisible: boolean
  readonly basemapOpacity: number
}

export function captureWorkspaceBasemapPresentation(
  presentation: WorkspaceBasemapPresentation,
): WorkspaceBasemapPresentation {
  return Object.freeze({
    basemapStyle: normalizeBasemapStyle(presentation.basemapStyle),
    basemapVisible: presentation.basemapVisible,
    basemapOpacity: Number.isFinite(presentation.basemapOpacity)
      ? Math.min(1, Math.max(0, presentation.basemapOpacity))
      : 0,
  })
}

export function workspaceBasemapPresentationFromSnapshot(
  snapshot: WorkspaceMapSnapshot,
): WorkspaceBasemapPresentation {
  return captureWorkspaceBasemapPresentation(snapshot)
}

/**
 * Creates only the local map shell. Remote raster sources are intentionally
 * added by the workspace controls after `style.load` admits this map.
 */
export function createWorkspaceMapLibreMap(
  maplibre: MapLibreApi,
  container: HTMLElement,
  snapshot: WorkspaceMapSnapshot,
  transformRequest?: (url: string) => { url: string },
): MapLibreMapInstance {
  return new maplibre.Map({
    container,
    style: createMapLibreEmptyStyle(),
    center: [snapshot.anchor.lon, snapshot.anchor.lat],
    bearing: maplibreBearingFromNorthBearing(snapshot.northBearingDeg),
    minZoom: WORKSPACE_MAP_MIN_ZOOM,
    maxZoom: WORKSPACE_MAP_MAX_ZOOM,
    renderWorldCopies: false,
    canvasContextAttributes: { antialias: true },
    attributionControl: { compact: true },
    interactive: false,
    pitchWithRotate: false,
    dragRotate: false,
    touchZoomRotate: false,
    ...(transformRequest ? { transformRequest } : {}),
  })
}
