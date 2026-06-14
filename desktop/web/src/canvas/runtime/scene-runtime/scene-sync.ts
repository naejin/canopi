import { batch } from '@preact/signals'
import { plantColorMenuOpen } from '../../plant-color-menu-state'
import { plantSymbolMenuOpen } from '../../plant-symbol-menu-state'
import { syncPlantSpeciesColorDefaults } from '../../plant-species-color-defaults'
import type { CanopiFile } from '../../../types/design'
import { plantColorByAttr, plantSizeMode } from '../../plant-display-state'
import { guides, northBearingAvailable, northBearingDeg } from '../../scene-metadata-state'
import { clearCanvasSelection, setCanvasSelection, setCanvasTool } from '../../session-state'
import type { SceneStore } from '../scene'
import type { CanvasRuntimeLayerProjectionAdapter } from '../app-adapter'

export function resetTransientRuntimeState(
  setTool: (name: string) => void,
): void {
  setCanvasTool('select')
  setTool('select')
  clearCanvasSelection()
  plantColorMenuOpen.value = false
  plantSymbolMenuOpen.value = false
}

function syncCanvasSignalsFromDocument(
  file: CanopiFile,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  batch(() => {
    layerProjections.syncFromLayers(file.layers)
    syncPlantSpeciesColorDefaults(file.plant_species_colors)
    guides.value = Array.isArray(file.extra?.guides) ? file.extra.guides as never[] : []
    northBearingDeg.value = file.north_bearing_deg ?? 0
    northBearingAvailable.value = file.north_bearing_deg != null
  })
}

function syncCanvasSignalsFromPersistedScene(
  sceneStore: SceneStore,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  const persisted = sceneStore.persisted

  batch(() => {
    layerProjections.syncFromLayers(persisted.layers)
    syncPlantSpeciesColorDefaults(persisted.plantSpeciesColors)
    guides.value = persisted.guides.map((guide) => ({ ...guide }))
  })
}

export { syncCanvasSignalsFromDocument }

export function syncPresentationSignalsFromSceneSession(sceneStore: SceneStore): void {
  const session = sceneStore.session
  plantSizeMode.value = session.plantSizeMode
  plantColorByAttr.value = session.plantColorByAttr
}

export function syncCanvasSignalsFromScene(
  sceneStore: SceneStore,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  syncCanvasSignalsFromPersistedScene(sceneStore, layerProjections)
  batch(() => {
    syncPresentationSignalsFromSceneSession(sceneStore)
    setCanvasSelection(sceneStore.session.selectedEntityIds)
  })
}

export function syncSceneLayerSignalsFromScene(
  sceneStore: SceneStore,
  layerName: string,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  if (layerProjections.isAppOwnedLayerProjection(layerName)) return
  const layer = sceneStore.persisted.layers.find((entry) => entry.name === layerName)
  if (!layer) return
  layerProjections.syncLayer(layer)
}

export function syncGuideSignalsFromScene(sceneStore: SceneStore): void {
  guides.value = sceneStore.persisted.guides.map((guide) => ({ ...guide }))
}
