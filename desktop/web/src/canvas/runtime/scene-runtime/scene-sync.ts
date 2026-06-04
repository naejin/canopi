import { batch } from '@preact/signals'
import { layerLockState, layerOpacity, layerVisibility } from '../../../app/canvas-settings/signals'
import { plantColorMenuOpen } from '../../plant-color-menu-state'
import { syncPlantSpeciesColorDefaults } from '../../plant-species-color-defaults'
import type { CanopiFile } from '../../../types/design'
import { plantColorByAttr, plantSizeMode } from '../../plant-display-state'
import { guides, northBearingAvailable, northBearingDeg } from '../../scene-metadata-state'
import { clearCanvasSelection, setCanvasSelection, setCanvasTool } from '../../session-state'
import type { SceneStore } from '../scene'

const APP_OWNED_LAYER_PROJECTIONS = new Set(['base', 'contours'])

interface SceneLayerProjectionSource {
  name: string
  visible: boolean
  locked: boolean
  opacity: number
}

export function isAppOwnedLayerProjection(name: string): boolean {
  return APP_OWNED_LAYER_PROJECTIONS.has(name)
}

export function resetTransientRuntimeState(
  setTool: (name: string) => void,
): void {
  setCanvasTool('select')
  setTool('select')
  clearCanvasSelection()
  plantColorMenuOpen.value = false
}

function syncCanvasSignalsFromDocument(file: CanopiFile): void {
  const { visibility, locks, opacities } = sceneLayerProjectionFromLayers(file.layers)

  batch(() => {
    layerVisibility.value = visibility
    layerLockState.value = locks
    layerOpacity.value = opacities
    syncPlantSpeciesColorDefaults(file.plant_species_colors)
    guides.value = Array.isArray(file.extra?.guides) ? file.extra.guides as never[] : []
    northBearingDeg.value = file.north_bearing_deg ?? 0
    northBearingAvailable.value = file.north_bearing_deg != null
  })
}

function syncCanvasSignalsFromPersistedScene(sceneStore: SceneStore): void {
  const persisted = sceneStore.persisted
  const { visibility, locks, opacities } = sceneLayerProjectionFromLayers(persisted.layers)

  batch(() => {
    layerVisibility.value = visibility
    layerLockState.value = locks
    layerOpacity.value = opacities
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

export function syncCanvasSignalsFromScene(sceneStore: SceneStore): void {
  syncCanvasSignalsFromPersistedScene(sceneStore)
  batch(() => {
    syncPresentationSignalsFromSceneSession(sceneStore)
    setCanvasSelection(sceneStore.session.selectedEntityIds)
  })
}

export function syncSceneLayerSignalsFromScene(sceneStore: SceneStore, layerName: string): void {
  if (isAppOwnedLayerProjection(layerName)) return
  const layer = sceneStore.persisted.layers.find((entry) => entry.name === layerName)
  if (!layer) return

  batch(() => {
    layerVisibility.value = {
      ...layerVisibility.value,
      [layer.name]: layer.visible,
    }
    layerLockState.value = {
      ...layerLockState.value,
      [layer.name]: layer.locked,
    }
    layerOpacity.value = {
      ...layerOpacity.value,
      [layer.name]: layer.opacity,
    }
  })
}

export function syncGuideSignalsFromScene(sceneStore: SceneStore): void {
  guides.value = sceneStore.persisted.guides.map((guide) => ({ ...guide }))
}

function sceneLayerProjectionFromLayers(
  layers: ReadonlyArray<SceneLayerProjectionSource>,
): {
  visibility: Record<string, boolean>
  locks: Record<string, boolean>
  opacities: Record<string, number>
} {
  const visibility = { ...layerVisibility.value }
  const locks = { ...layerLockState.value }
  const opacities = { ...layerOpacity.value }

  for (const layer of layers) {
    if (isAppOwnedLayerProjection(layer.name)) continue
    visibility[layer.name] = layer.visible
    locks[layer.name] = layer.locked
    opacities[layer.name] = layer.opacity
  }

  return { visibility, locks, opacities }
}
