import type { ScenePersistedState } from '../canvas/runtime/scene'
import { projectPanelTargetsToMapFeatures } from '../panel-target-map-projection'
import type { PanelTarget } from '../types/design'
import {
  buildPanelTargetProjectionScene,
  createPanelTargetMapOverlayContract,
} from './panel-target-overlays'
import {
  clearPanelTargetMapOverlay,
  syncPanelTargetMapOverlay,
  type MapLibreOverlayMap,
} from './panel-target-overlay-sync'

export interface CanvasOverlayLocation {
  readonly lat: number
  readonly lon: number
  readonly northBearingDeg: number | null
}

export function syncCanvasPanelTargetOverlays(
  map: MapLibreOverlayMap,
  scene: ScenePersistedState | null,
  location: CanvasOverlayLocation | null,
  hoveredTargets: readonly PanelTarget[],
  selectedTargets: readonly PanelTarget[],
  enabled: boolean,
): void {
  if (!enabled || !scene || !location) {
    clearPanelTargetMapOverlay(map, 'hover')
    clearPanelTargetMapOverlay(map, 'selection')
    return
  }

  const projectionScene = buildPanelTargetProjectionScene(scene)
  const hoverOverlay = createPanelTargetMapOverlayContract(
    'hover',
    projectPanelTargetsToMapFeatures(hoveredTargets, projectionScene, location),
  )
  const selectionOverlay = createPanelTargetMapOverlayContract(
    'selection',
    projectPanelTargetsToMapFeatures(selectedTargets, projectionScene, location),
  )

  syncPanelTargetMapOverlay(map, selectionOverlay)
  syncPanelTargetMapOverlay(map, hoverOverlay)
}
