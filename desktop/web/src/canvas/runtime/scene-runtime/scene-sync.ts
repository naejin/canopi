import { batch } from '@preact/signals'
import { plantColorMenuOpen } from '../../plant-color-menu-state'
import { plantSymbolMenuOpen } from '../../plant-symbol-menu-state'
import { syncPlantSpeciesColorDefaults } from '../../plant-species-color-defaults'
import type { CanopiFile } from '../../../types/design'
import { guides, northBearingAvailable, northBearingDeg } from '../../scene-metadata-state'
import { setCanvasSelection } from '../../session-state'
import type { SceneStateReader } from '../scene'
import type { CanvasRuntimeLayerProjectionAdapter } from '../app-adapter'

export function resetTransientRuntimeState(
  setTool: (name: string) => void,
): void {
  setTool('select')
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
  sceneStore: SceneStateReader,
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

export function syncCanvasSignalsFromScene(
  sceneStore: SceneStateReader,
  layerProjections: CanvasRuntimeLayerProjectionAdapter,
): void {
  syncCanvasSignalsFromPersistedScene(sceneStore, layerProjections)
  batch(() => {
    setCanvasSelection(sceneStore.session.selectedEntityIds)
  })
}
