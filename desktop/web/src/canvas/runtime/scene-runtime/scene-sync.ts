import { batch } from '@preact/signals'
import {
  guides,
  layerLockState,
  layerOpacity,
  layerVisibility,
  lockedObjectIds,
  northBearingDeg,
  plantColorMenuOpen,
  plantColorByAttr,
  plantSizeMode,
  plantSpeciesColors,
} from '../../../state/canvas'
import type { CanopiFile } from '../../../types/design'
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
    plantSpeciesColors.value = { ...file.plant_species_colors }
    guides.value = Array.isArray(file.extra?.guides) ? file.extra.guides as never[] : []
    northBearingDeg.value = file.north_bearing_deg ?? 0
  })
}

export function syncPresentationSignalsFromSceneSession(sceneStore: SceneStore): void {
  const session = sceneStore.session
  plantSizeMode.value = session.plantSizeMode
  plantColorByAttr.value = session.plantColorByAttr
}

export function syncCanvasSignalsFromScene(sceneStore: SceneStore): void {
  syncCanvasSignalsFromDocument(sceneStore.toCanopiFile({
    now: new Date(sceneStore.persisted.updatedAt),
  }))
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
  const currentGuides = Array.isArray(persisted.extra?.guides) ? persisted.extra.guides as typeof nextGuides : []

  const layersChanged = JSON.stringify(nextLayers) !== JSON.stringify(persisted.layers)
  const guidesChanged = options.syncGuides && JSON.stringify(currentGuides) !== JSON.stringify(nextGuides)
  if (!layersChanged && !guidesChanged) return false

  const before = options.recordHistory ? deps.captureSnapshot() : null

  deps.sceneStore.updatePersisted((draft) => {
    if (layersChanged) draft.layers = nextLayers
    if (guidesChanged) {
      const nextExtra = { ...draft.extra }
      if (nextGuides.length > 0) nextExtra.guides = nextGuides
      else delete nextExtra.guides
      draft.extra = nextExtra
    }
  })

  if (before) deps.markDirty(before, 'scene-settings')
  return true
}
