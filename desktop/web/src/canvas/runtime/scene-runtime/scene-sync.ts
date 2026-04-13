import { batch } from '@preact/signals'
import { layerLockState, layerOpacity, layerVisibility } from '../../../app/canvas-settings/signals'
import { plantColorMenuOpen } from '../../plant-color-menu-state'
import { syncPlantSpeciesColorDefaults } from '../../plant-species-color-defaults'
import type { CanopiFile } from '../../../types/design'
import { plantColorByAttr, plantSizeMode } from '../../plant-display-state'
import { guides, northBearingDeg } from '../../scene-metadata-state'
import { lockedObjectIds } from '../../runtime-mirror-state'
import { clearCanvasSelection, setCanvasSelection, setCanvasTool } from '../../session-state'
import { cloneLayerWithSignals } from '../scene-visuals'
import type { SceneCommandSnapshot } from '../scene-commands'
import type { SceneStore } from '../scene'

interface ApplySignalBackedSceneStateOptions {
  recordHistory: boolean
  syncGuides: boolean
}

interface ApplySignalBackedSceneStateDeps {
  sceneStore: SceneStore
  captureSnapshot: () => SceneCommandSnapshot
  markDirty: (before: SceneCommandSnapshot, type: string) => void
}

export function resetTransientRuntimeState(
  setTool: (name: string) => void,
): void {
  setCanvasTool('select')
  setTool('select')
  clearCanvasSelection()
  lockedObjectIds.value = new Set()
  plantColorMenuOpen.value = false
}

function syncCanvasSignalsFromDocument(file: CanopiFile): void {
  const visibility: Record<string, boolean> = {}
  const locks: Record<string, boolean> = {}
  const opacities: Record<string, number> = {}
  for (const layer of file.layers) {
    visibility[layer.name] = layer.visible
    locks[layer.name] = layer.locked
    opacities[layer.name] = layer.opacity
  }

  batch(() => {
    layerVisibility.value = visibility
    layerLockState.value = locks
    layerOpacity.value = opacities
    syncPlantSpeciesColorDefaults(file.plant_species_colors)
    guides.value = Array.isArray(file.extra?.guides) ? file.extra.guides as never[] : []
    northBearingDeg.value = file.north_bearing_deg ?? 0
  })
}

function syncCanvasSignalsFromPersistedScene(sceneStore: SceneStore): void {
  const persisted = sceneStore.persisted
  const visibility: Record<string, boolean> = {}
  const locks: Record<string, boolean> = {}
  const opacities: Record<string, number> = {}
  for (const layer of persisted.layers) {
    visibility[layer.name] = layer.visible
    locks[layer.name] = layer.locked
    opacities[layer.name] = layer.opacity
  }

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

export function applySignalBackedSceneState(
  deps: ApplySignalBackedSceneStateDeps,
  options: ApplySignalBackedSceneStateOptions,
): boolean {
  const persisted = deps.sceneStore.persisted
  const nextLayers = persisted.layers.map((layer) => cloneLayerWithSignals(
    layer,
    layerVisibility.value,
    layerLockState.value,
    layerOpacity.value,
  ))
  const nextGuides = guides.value
  const currentGuides = persisted.guides

  const layersChanged = JSON.stringify(nextLayers) !== JSON.stringify(persisted.layers)
  const guidesChanged = options.syncGuides && JSON.stringify(currentGuides) !== JSON.stringify(nextGuides)
  if (!layersChanged && !guidesChanged) return false

  const before = options.recordHistory ? deps.captureSnapshot() : null

  deps.sceneStore.updatePersisted((draft) => {
    if (layersChanged) draft.layers = nextLayers
    if (guidesChanged) draft.guides = nextGuides.map((guide) => ({ ...guide }))
  })

  if (before) deps.markDirty(before, 'scene-settings')
  return true
}
