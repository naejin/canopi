import type { ScenePersistedState } from '../canvas/runtime/scene'
import { panelTargets } from '../panel-targets'
import type { PanelTarget } from '../types/design'
import { createPanelTargetMapOverlayContract } from './panel-target-overlays'
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

  const targetIndex = panelTargets.indexScene(scene)
  const hoverOverlay = createPanelTargetMapOverlayContract(
    'hover',
    panelTargets.resolve(hoveredTargets, targetIndex).toMapFeatures(location),
  )
  const selectionOverlay = createPanelTargetMapOverlayContract(
    'selection',
    panelTargets.resolve(selectedTargets, targetIndex).toMapFeatures(location),
  )

  syncPanelTargetMapOverlay(map, selectionOverlay)
  syncPanelTargetMapOverlay(map, hoverOverlay)
}
