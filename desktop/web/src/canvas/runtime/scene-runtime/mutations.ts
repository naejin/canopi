import type { ColorByAttribute, PlantSizeMode } from '../../plant-display-state'
import { createUuid } from '../../../utils/ids'
import type { PlantPresentationContext } from '../plant-presentation'
import { normalizeHexColor } from '../../plant-colors'
import type { SelectedPlantColorContext } from '../../plant-color-context'
import type {
  SceneObjectGroupEntity,
  ScenePersistedState,
  SceneStore,
} from '../scene'
import {
  isSceneDesignObjectLocked,
  setSceneDesignObjectLocks,
} from '../scene'
import {
  createClipboardPayload,
  pasteClipboardPayload,
  type SceneClipboardPayload,
} from './clipboard'
import {
  getDesignObjectSelectionModel,
  getSelectedTopLevelTargets,
  getSelectionLayer,
  setsEqual,
  type SceneSelectionTarget,
} from './selection'
import {
  applySpeciesSelection,
  getSameSpeciesReferenceCanonicalName,
  getSelectablePlantIdsForSpecies,
} from './species-selection'
import type { SceneEditCoordinator } from './transactions'

const EMPTY_PLANT_COLOR_CONTEXT: SelectedPlantColorContext = {
  plantIds: [],
  singleSpeciesCanonicalName: null,
  singleSpeciesCommonName: null,
  sharedCurrentColor: null,
  suggestedColor: null,
  singleSpeciesDefaultColor: null,
}

interface SceneRuntimeMutationControllerOptions {
  sceneStore: SceneStore
  selection: {
    set(ids: Iterable<string>): void
  }
  sceneEdits: SceneEditCoordinator
  presentation: {
    syncSignals(): void
    syncPlantSpeciesColors(): void
    getViewportScale(): number
    createPlantPresentationContext(viewportScale?: number): PlantPresentationContext
    getSuggestedPlantColor(canonicalName: string): string | null
  }
  invalidateScene(): void
}

export class SceneRuntimeMutationController {
  private readonly _sceneStore: SceneStore
  private readonly _selection: SceneRuntimeMutationControllerOptions['selection']
  private readonly _sceneEdits: SceneEditCoordinator
  private readonly _presentation: SceneRuntimeMutationControllerOptions['presentation']
  private readonly _invalidateScene: () => void
  private _clipboard: SceneClipboardPayload | null = null

  constructor(options: SceneRuntimeMutationControllerOptions) {
    this._sceneStore = options.sceneStore
    this._selection = options.selection
    this._sceneEdits = options.sceneEdits
    this._presentation = options.presentation
    this._invalidateScene = options.invalidateScene
  }

  copy(): void {
    const persisted = this._sceneStore.persisted
    const selected = this._getEditableTopLevelTargets()
    this._clipboard = createClipboardPayload(persisted, selected)
  }

  paste(): void {
    if (!this._clipboard) return

    let nextSelection = new Set<string>()
    this._sceneEdits.run('paste', (tx) => {
      tx.mutate((draft) => {
        nextSelection = pasteClipboardPayload(this._clipboard!, draft)
      })
      if (nextSelection.size > 0) tx.setSelection(nextSelection)
    })
  }

  duplicateSelected(): void {
    this.copy()
    this.paste()
  }

  deleteSelected(): void {
    const persisted = this._sceneStore.persisted
    const selected = this._getEditableTopLevelTargets()
    if (selected.length === 0) return

    const deleted = resolveSelectedEntitySets(persisted, selected)

    this._sceneEdits.run('delete-selected', (tx) => {
      tx.mutate((draft) => {
        draft.plants = draft.plants.filter((plant) => !deleted.plantIds.has(plant.id))
        draft.zones = draft.zones.filter((zone) => !deleted.zoneIds.has(zone.name))
        draft.annotations = draft.annotations.filter((annotation) => !deleted.annotationIds.has(annotation.id))
        draft.groups = draft.groups
          .filter((group) => !deleted.groupIds.has(group.id))
          .map((group) => ({
            ...group,
            memberIds: group.memberIds.filter((memberId) =>
              !deleted.plantIds.has(memberId)
              && !deleted.zoneIds.has(memberId)
              && !deleted.annotationIds.has(memberId),
            ),
          }))
          .filter((group) => group.memberIds.length >= 2)
      })
      tx.setSelection([])
    })
  }

  selectAll(): void {
    const persisted = this._sceneStore.persisted
    const ids = new Set<string>()
    const groupedMemberIds = new Set(persisted.groups.flatMap((group) => group.memberIds))
    const layerState = sceneLayerState(persisted)

    if (isSceneLayerEditable(layerState.plants)) {
      for (const plant of persisted.plants) {
        if (groupedMemberIds.has(plant.id) || plant.locked) continue
        ids.add(plant.id)
      }
    }

    if (isSceneLayerEditable(layerState.zones)) {
      for (const zone of persisted.zones) {
        if (groupedMemberIds.has(zone.name) || zone.locked) continue
        ids.add(zone.name)
      }
    }

    if (isSceneLayerEditable(layerState.annotations)) {
      for (const annotation of persisted.annotations) {
        if (groupedMemberIds.has(annotation.id) || annotation.locked) continue
        ids.add(annotation.id)
      }
    }

    for (const group of persisted.groups) {
      if (!isSceneLayerEditable(layerState[group.layer]) || isSceneDesignObjectLocked(persisted, group.id)) continue
      ids.add(group.id)
    }

    if (setsEqual(ids, this._sceneStore.session.selectedEntityIds)) return
    this._selection.set(ids)
    this._invalidateScene()
  }

  selectSameSpecies(canonicalName?: string, options: { additive?: boolean } = {}): void {
    const persisted = this._sceneStore.persisted
    const referenceCanonicalName = canonicalName
      ?? getSameSpeciesReferenceCanonicalName(persisted, this._getSelectionModel().editableTargets)
    if (!referenceCanonicalName) return

    const speciesPlantIds = getSelectablePlantIdsForSpecies(persisted, referenceCanonicalName)
    if (speciesPlantIds.length === 0) return

    const nextSelection = applySpeciesSelection(
      this._sceneStore.session.selectedEntityIds,
      speciesPlantIds,
      options.additive === true,
    )
    if (setsEqual(nextSelection, this._sceneStore.session.selectedEntityIds)) return
    this._selection.set(nextSelection)
    this._invalidateScene()
  }

  bringToFront(): void {
    this._reorderSelected('end')
  }

  sendToBack(): void {
    this._reorderSelected('start')
  }

  lockSelected(): void {
    const selected = this._getEditableTopLevelTargets()
    if (selected.length === 0) return
    const selectedIds = selected.map((target) => target.id)
    this._sceneEdits.run('lock-selected', (tx) => {
      tx.mutate((draft) => {
        setSceneDesignObjectLocks(draft, selectedIds, true)
      })
      tx.setSelection([])
    })
  }

  unlockSelected(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    const selectedIds = selected.map((target) => target.id)
    if (selectedIds.length === 0) return
    this._sceneEdits.run('unlock-selected', (tx) => {
      tx.mutate((draft) => {
        setSceneDesignObjectLocks(draft, selectedIds, false)
      })
    })
  }

  groupSelected(): void {
    const selectionModel = this._getSelectionModel()
    const selected = selectionModel.editableTargets
    if (selected.length < 2 || selected.some((target) => target.kind === 'group')) return

    const layer = getSelectionLayer(selected[0]!)
    if (!selected.every((target) => getSelectionLayer(target) === layer)) return

    const memberIds = selected.map((target) => target.id)
    const bounds = selectionModel.bounds
    if (!bounds) return

    const nextGroup: SceneObjectGroupEntity = {
      kind: 'group',
      id: createUuid(),
      locked: false,
      name: null,
      layer,
      position: { x: bounds.minX, y: bounds.minY },
      rotationDeg: null,
      memberIds,
    }

    this._sceneEdits.run('group-selected', (tx) => {
      tx.mutate((draft) => {
        draft.groups.push(nextGroup)
      })
      tx.setSelection([nextGroup.id])
    })
  }

  ungroupSelected(): void {
    const persisted = this._sceneStore.persisted
    const selectedGroupIds = new Set(
      this._getEditableTopLevelTargets()
        .filter((target) => target.kind === 'group')
        .map((target) => target.id),
    )
    if (selectedGroupIds.size === 0) return

    const memberIds = persisted.groups
      .filter((group) => selectedGroupIds.has(group.id))
      .flatMap((group) => group.memberIds)

    this._sceneEdits.run('ungroup-selected', (tx) => {
      tx.mutate((draft) => {
        draft.groups = draft.groups.filter((group) => !selectedGroupIds.has(group.id))
      })
      tx.setSelection(memberIds)
    })
  }

  getPlantSizeMode(): PlantSizeMode {
    return this._sceneStore.session.plantSizeMode
  }

  setPlantSizeMode(mode: PlantSizeMode): void {
    if (this._sceneStore.session.plantSizeMode === mode) return
    this._sceneStore.updateSession((session) => {
      session.plantSizeMode = mode
    })
    this._presentation.syncSignals()
    this._invalidateScene()
  }

  getPlantColorByAttr(): ColorByAttribute | null {
    return this._sceneStore.session.plantColorByAttr
  }

  setPlantColorByAttr(attr: ColorByAttribute | null): void {
    if (this._sceneStore.session.plantColorByAttr === attr) return
    this._sceneStore.updateSession((session) => {
      session.plantColorByAttr = attr
    })
    this._presentation.syncSignals()
    this._invalidateScene()
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    const selectedPlantIds = this._getEditableSelectedPlantIds()
    const selectedPlants = this._sceneStore.persisted.plants.filter((plant) => selectedPlantIds.has(plant.id))
    if (selectedPlants.length === 0) return EMPTY_PLANT_COLOR_CONTEXT

    const plantIds = selectedPlants.map((plant) => plant.id)
    const canonicalNames = new Set(selectedPlants.map((plant) => plant.canonicalName))
    const commonNames = new Set(
      selectedPlants
        .map((plant) => plant.commonName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    )
    const colors = new Set(
      selectedPlants
        .map((plant) => normalizeHexColor(plant.color))
        .filter((value): value is string => value !== null),
    )
    const hasUncolored = selectedPlants.some((plant) => normalizeHexColor(plant.color) === null)
    const singleSpeciesCanonicalName = canonicalNames.size === 1 ? [...canonicalNames][0]! : null
    const singleSpeciesCommonName = singleSpeciesCanonicalName && commonNames.size === 1
      ? [...commonNames][0]!
      : null
    const sharedCurrentColor =
      colors.size > 1 || (colors.size === 1 && hasUncolored)
        ? 'mixed'
        : colors.size === 1
          ? [...colors][0]!
          : null
    const singleSpeciesDefaultColor = singleSpeciesCanonicalName
      ? normalizeHexColor(this._sceneStore.persisted.plantSpeciesColors[singleSpeciesCanonicalName] ?? null)
      : null

    return {
      plantIds,
      singleSpeciesCanonicalName,
      singleSpeciesCommonName,
      sharedCurrentColor,
      suggestedColor: singleSpeciesCanonicalName
        ? this._presentation.getSuggestedPlantColor(singleSpeciesCanonicalName)
        : null,
      singleSpeciesDefaultColor,
    }
  }

  setSelectedPlantColor(color: string | null): number {
    const selectedPlantIds = this._getEditableSelectedPlantIds()
    const nextColor = normalizeHexColor(color)
    let changed = 0
    this._sceneEdits.run('set-selected-plant-color', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!selectedPlantIds.has(plant.id)) return plant
          const currentColor = normalizeHexColor(plant.color)
          if (currentColor === nextColor) return plant
          changed += 1
          return {
            ...plant,
            color: nextColor,
          }
        })
      })
    })
    return changed
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    const nextColor = normalizeHexColor(color)
    const editablePlantIds = getEditableSpeciesPlantIds(this._sceneStore.persisted, canonicalName)
    if (editablePlantIds.size === 0) return 0
    let changed = 0

    this._sceneEdits.run('set-plant-color-for-species', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!editablePlantIds.has(plant.id)) return plant
          const currentColor = normalizeHexColor(plant.color)
          if (currentColor === nextColor) return plant
          changed += 1
          return {
            ...plant,
            color: nextColor,
          }
        })
        const nextSpeciesColors = { ...persisted.plantSpeciesColors }
        if (nextColor) nextSpeciesColors[canonicalName] = nextColor
        else delete nextSpeciesColors[canonicalName]
        persisted.plantSpeciesColors = nextSpeciesColors
      })
      this._presentation.syncPlantSpeciesColors()
    })

    return changed
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    const hadColor = normalizeHexColor(this._sceneStore.persisted.plantSpeciesColors[canonicalName] ?? null) !== null
    if (!hadColor) return false
    this._sceneEdits.run('clear-plant-species-color', (tx) => {
      tx.mutate((persisted) => {
        const nextSpeciesColors = { ...persisted.plantSpeciesColors }
        delete nextSpeciesColors[canonicalName]
        persisted.plantSpeciesColors = nextSpeciesColors
      })
      this._presentation.syncPlantSpeciesColors()
    })
    return true
  }

  private _reorderSelected(position: 'start' | 'end'): void {
    const persisted = this._sceneStore.persisted
    const selected = this._getEditableTopLevelTargets()
    if (selected.length === 0) return

    const resolved = resolveSelectedEntitySets(persisted, selected)

    this._sceneEdits.run(position === 'start' ? 'send-to-back' : 'bring-to-front', (tx) => {
      tx.mutate((draft) => {
        draft.plants = reorderSceneEntities(draft.plants, resolved.plantIds, position, (plant) => plant.id)
        draft.zones = reorderSceneEntities(draft.zones, resolved.zoneIds, position, (zone) => zone.name)
        draft.annotations = reorderSceneEntities(draft.annotations, resolved.annotationIds, position, (annotation) => annotation.id)
        draft.groups = reorderSceneEntities(draft.groups, resolved.groupIds, position, (group) => group.id)
      })
    })
  }

  private _getEditableTopLevelTargets(): readonly SceneSelectionTarget[] {
    return this._getSelectionModel().editableTargets
  }

  private _getEditableSelectedPlantIds(): Set<string> {
    return resolveSelectedEntitySets(this._sceneStore.persisted, this._getEditableTopLevelTargets()).plantIds
  }

  private _getSelectionModel() {
    const viewportScale = this._presentation.getViewportScale()
    return getDesignObjectSelectionModel(
      this._sceneStore.persisted,
      this._sceneStore.session.selectedEntityIds,
      {
        annotationViewportScale: viewportScale,
        plantContext: this._presentation.createPlantPresentationContext(viewportScale),
      },
    )
  }
}

function sceneLayerState(
  persisted: ScenePersistedState,
): Readonly<Record<string, { visible: boolean; locked: boolean } | undefined>> {
  return Object.fromEntries(
    persisted.layers.map((layer) => [layer.name, { visible: layer.visible, locked: layer.locked }]),
  )
}

function isSceneLayerEditable(
  layer: { visible: boolean; locked: boolean } | undefined,
): boolean {
  return layer?.visible !== false && layer?.locked !== true
}

function getEditableSpeciesPlantIds(persisted: ScenePersistedState, canonicalName: string): Set<string> {
  const ids = new Set<string>()
  const layerState = sceneLayerState(persisted)
  if (!isSceneLayerEditable(layerState.plants)) return ids
  for (const plant of persisted.plants) {
    if (plant.canonicalName !== canonicalName || plant.locked) continue
    ids.add(plant.id)
  }
  return ids
}

function resolveSelectedEntitySets(
  persisted: ScenePersistedState,
  selected: readonly SceneSelectionTarget[],
): {
  plantIds: Set<string>
  zoneIds: Set<string>
  annotationIds: Set<string>
  groupIds: Set<string>
} {
  const plantIds = new Set<string>()
  const zoneIds = new Set<string>()
  const annotationIds = new Set<string>()
  const groupIds = new Set<string>()

  for (const target of selected) {
    if (target.kind === 'plant') {
      plantIds.add(target.id)
      continue
    }
    if (target.kind === 'zone') {
      zoneIds.add(target.id)
      continue
    }
    if (target.kind === 'annotation') {
      annotationIds.add(target.id)
      continue
    }

    groupIds.add(target.id)
    const group = persisted.groups.find((entry) => entry.id === target.id)
    if (!group) continue
    for (const memberId of group.memberIds) {
      if (persisted.plants.some((plant) => plant.id === memberId)) plantIds.add(memberId)
      else if (persisted.zones.some((zone) => zone.name === memberId)) zoneIds.add(memberId)
      else if (persisted.annotations.some((annotation) => annotation.id === memberId)) annotationIds.add(memberId)
    }
  }

  return { plantIds, zoneIds, annotationIds, groupIds }
}

function reorderSceneEntities<T>(
  items: T[],
  selectedIds: Set<string>,
  position: 'start' | 'end',
  getId: (item: T) => string,
): T[] {
  if (selectedIds.size === 0) return items
  const selected: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (selectedIds.has(getId(item))) selected.push(item)
    else rest.push(item)
  }
  return position === 'start'
    ? [...selected, ...rest]
    : [...rest, ...selected]
}
