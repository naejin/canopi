import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import {
  clearCanvasPanelTargetOverlays,
  syncCanvasPanelTargetOverlays,
  type CanvasOverlayLocation,
} from '../../maplibre/canvas-overlays'
import type { MapLibreOverlayMap } from '../../maplibre/panel-target-overlay-sync'
import type { PanelTarget } from '../../types/design'

export interface CanvasMapSurfaceOverlaySnapshot {
  readonly runtime: Pick<CanvasQuerySurface, 'getSceneSnapshot'> | null
  readonly location: { readonly lat: number; readonly lon: number } | null
  readonly northBearingDeg: number | null
  readonly hoveredTargets: readonly PanelTarget[]
  readonly selectedTargets: readonly PanelTarget[]
}

export function clearCanvasMapSurfaceOverlays(map: MapLibreOverlayMap): void {
  clearCanvasPanelTargetOverlays(map)
}

export function syncCanvasMapSurfaceOverlays(
  map: MapLibreOverlayMap,
  snapshot: CanvasMapSurfaceOverlaySnapshot,
  enabled: boolean,
): void {
  syncCanvasPanelTargetOverlays(
    map,
    snapshot.runtime?.getSceneSnapshot() ?? null,
    toCanvasOverlayLocation(snapshot),
    snapshot.hoveredTargets,
    snapshot.selectedTargets,
    enabled,
  )
}

function toCanvasOverlayLocation(
  snapshot: CanvasMapSurfaceOverlaySnapshot,
): CanvasOverlayLocation | null {
  if (!snapshot.location) return null
  return {
    lat: snapshot.location.lat,
    lon: snapshot.location.lon,
    northBearingDeg: snapshot.northBearingDeg,
  }
}
