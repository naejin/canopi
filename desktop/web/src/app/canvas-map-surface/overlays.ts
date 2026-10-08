import type { CanvasQuerySurface } from '../../canvas/runtime/runtime'
import { createPanelTargetMapOverlayContract } from '../../maplibre/panel-target-overlays'
import {
  clearPanelTargetMapOverlay,
  syncMapOverlay,
  type MapLibreOverlayMap,
} from '../../maplibre/panel-target-overlay-sync'
import { projectTargetsToMapFeatures } from '../../target'
import type { PanelTarget } from '../../types/design'

/** The panel Targets the map highlights, and the Scene and plane origin they are projected from. */
export interface CanvasMapSurfaceOverlaySnapshot {
  readonly runtime: Pick<CanvasQuerySurface, 'getSceneSnapshot'>
  readonly location: { readonly lat: number; readonly lon: number }
  readonly hoveredTargets: readonly PanelTarget[]
  readonly selectedTargets: readonly PanelTarget[]
}

export function clearCanvasMapSurfaceOverlays(map: MapLibreOverlayMap): void {
  clearPanelTargetMapOverlay(map, 'hover')
  clearPanelTargetMapOverlay(map, 'selection')
}

/** Paints the hover and selection overlays; with no Targets it clears them without reading the Scene. */
export function syncCanvasMapSurfaceOverlays(map: MapLibreOverlayMap, snapshot: CanvasMapSurfaceOverlaySnapshot): void {
  const { hoveredTargets, selectedTargets, location } = snapshot
  if (hoveredTargets.length === 0 && selectedTargets.length === 0) {
    clearCanvasMapSurfaceOverlays(map)
    return
  }
  const scene = snapshot.runtime.getSceneSnapshot()
  syncMapOverlay(map, createPanelTargetMapOverlayContract(
    'selection',
    projectTargetsToMapFeatures(selectedTargets, scene, location),
  ))
  syncMapOverlay(map, createPanelTargetMapOverlayContract(
    'hover',
    projectTargetsToMapFeatures(hoveredTargets, scene, location),
  ))
}
