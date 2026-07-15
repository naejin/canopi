import { createUuid } from '../../../utils/ids'
import type { PlantPresentationContext } from '../plant-presentation'
import { normalizeHexColor } from '../../plant-colors'
import type { SelectedPlantColorContext } from '../../plant-color-context'
import type { SelectedPlantSymbolContext } from '../../plant-symbol-context'
import type {
  PlantSymbolId,
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePoint,
  ScenePersistedState,
  SceneStateReader,
} from '../scene'
import {
  dedupeSceneObjectGroupMembers,
  getSceneGroupedMemberKeys,
  isSceneDesignObjectLocked,
  normalizeSceneDesignObjectTargets,
  resolveSceneObjectGroupMembers,
  resolvePlantSymbolForPlant,
  resolvePlantSymbolId,
  sceneDesignObjectTargetsEqual,
  sceneObjectGroupMemberFromTarget,
  sceneObjectGroupMemberKey,
  sceneObjectGroupMemberLayerName,
  sceneTargetKey,
  setSceneDesignObjectLocks,
  type SceneConcreteDesignObjectTarget,
  type SceneDesignObjectTarget,
} from '../scene'
import {
  createClipboardArrangementTemplate,
  createClipboardPayload,
  type SceneClipboardPayload,
} from './clipboard'
import {
  createSceneArrangementPlacement,
  type SceneArrangementPlacement,
} from './arrangement-placement'
import {
  getCombinedTargetBounds,
  getDesignObjectSelectionModel,
  getSelectedTopLevelTargets,
  type SceneSelectionReadModelOptions,
  type SceneSelectionTarget,
} from './selection'
import {
  applySpeciesSelection,
  getSameSpeciesReferenceCanonicalName,
  getSelectablePlantIdsForSpecies,
} from './species-selection'
import type {
  SceneCommandAdmission,
  SceneEditCoordinator,
  SettledSceneReader,
} from './transactions'

const EMPTY_PLANT_COLOR_CONTEXT: SelectedPlantColorContext = {
  plantIds: [],
  singleSpeciesCanonicalName: null,
  singleSpeciesCommonName: null,
  sharedCurrentColor: null,
  suggestedColor: null,
  singleSpeciesDefaultColor: null,
}

const EMPTY_PLANT_SYMBOL_CONTEXT: SelectedPlantSymbolContext = {
  plantIds: [],
  singleSpeciesCanonicalName: null,
  singleSpeciesCommonName: null,
  sharedCurrentSymbol: null,
  sharedEffectiveSymbol: 'round',
  inheritedSymbol: null,
  singleSpeciesDefaultSymbol: null,
  canClearSelectedSymbol: false,
}

const NORMAL_PASTE_OFFSET_M: ScenePoint = { x: 1, y: 0 }

interface SceneRuntimeMutationControllerOptions {
  sceneStore: SceneStateReader
  selection: {
    set(targets: Iterable<SceneDesignObjectTarget>): void
  }
  sceneEdits: SceneEditCoordinator
  commandAdmission: SceneCommandAdmission
  settledReader: SettledSceneReader
  presentation: {
    getViewportScale(): number
    createPlantPresentationContext(viewportScale?: number): PlantPresentationContext
    getLocalizedCommonNames(): ReadonlyMap<string, string | null>
    getSuggestedPlantColor(canonicalName: string): string | null
  }
  invalidateScene(): void
}

export class SceneRuntimeMutationController {
  private readonly _sceneStore: SceneStateReader
  private readonly _selection: SceneRuntimeMutationControllerOptions['selection']
  private readonly _sceneEdits: SceneEditCoordinator
  private readonly _commandAdmission: SceneCommandAdmission
  private readonly _settledReader: SettledSceneReader
  private readonly _arrangementPlacement: SceneArrangementPlacement
  private readonly _presentation: SceneRuntimeMutationControllerOptions['presentation']
  private readonly _invalidateScene: () => void
  private _clipboard: SceneClipboardPayload | null = null
  private _normalPasteCount = 0

  constructor(options: SceneRuntimeMutationControllerOptions) {
    this._sceneStore = options.sceneStore
    this._selection = options.selection
    this._sceneEdits = options.sceneEdits
    this._commandAdmission = options.commandAdmission
    this._settledReader = options.settledReader
    this._arrangementPlacement = createSceneArrangementPlacement({ sceneEdits: options.sceneEdits })
    this._presentation = options.presentation
    this._invalidateScene = options.invalidateScene
  }

  copy(): void {
    this._runCommandWhenSettled(() => this._copyWhenSettled(), undefined)
  }

  paste(): void {
    this._runCommandWhenSettled(() => this._pasteWhenSettled(), undefined)
  }

  pasteAt(point: ScenePoint): void {
    this._runCommandWhenSettled(() => this._pasteAtWhenSettled(point), undefined)
  }

  canPaste(): boolean {
    return this._settledReader.readWhenSettled(() => this._canPasteWhenSettled(), false)
  }

  duplicateSelected(): void {
    this._runCommandWhenSettled(() => this._duplicateSelectedWhenSettled(), undefined)
  }

  toggleSelectedPlantNamePins(): void {
    this._runCommandWhenSettled(
      () => this._toggleSelectedPlantNamePinsWhenSettled(),
      undefined,
    )
  }

  deleteSelected(): void {
    this._runCommandWhenSettled(() => this._deleteSelectedWhenSettled(), undefined)
  }

  selectAll(): void {
    this._runCommandWhenSettled(() => this._selectAllWhenSettled(), undefined)
  }

  selectSameSpecies(canonicalName?: string, options: { additive?: boolean } = {}): void {
    this._runCommandWhenSettled(
      () => this._selectSameSpeciesWhenSettled(canonicalName, options),
      undefined,
    )
  }

  bringToFront(): void {
    this._runCommandWhenSettled(() => this._bringToFrontWhenSettled(), undefined)
  }

  sendToBack(): void {
    this._runCommandWhenSettled(() => this._sendToBackWhenSettled(), undefined)
  }

  lockSelected(): void {
    this._runCommandWhenSettled(() => this._lockSelectedWhenSettled(), undefined)
  }

  unlockSelected(): void {
    this._runCommandWhenSettled(() => this._unlockSelectedWhenSettled(), undefined)
  }

  groupSelected(): void {
    this._runCommandWhenSettled(() => this._groupSelectedWhenSettled(), undefined)
  }

  ungroupSelected(): void {
    this._runCommandWhenSettled(() => this._ungroupSelectedWhenSettled(), undefined)
  }

  setSelectedPlantColor(color: string | null): number {
    return this._runCommandWhenSettled(
      () => this._setSelectedPlantColorWhenSettled(color),
      0,
    )
  }

  setSelectedPlantSymbol(symbol: PlantSymbolId | null): number {
    return this._runCommandWhenSettled(
      () => this._setSelectedPlantSymbolWhenSettled(symbol),
      0,
    )
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    return this._runCommandWhenSettled(
      () => this._setPlantColorForSpeciesWhenSettled(canonicalName, color),
      0,
    )
  }

  setPlantSymbolForSpecies(canonicalName: string, symbol: PlantSymbolId): number {
    return this._runCommandWhenSettled(
      () => this._setPlantSymbolForSpeciesWhenSettled(canonicalName, symbol),
      0,
    )
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    return this._runCommandWhenSettled(
      () => this._clearPlantSpeciesColorWhenSettled(canonicalName),
      false,
    )
  }

  clearPlantSpeciesSymbol(canonicalName: string): boolean {
    return this._runCommandWhenSettled(
      () => this._clearPlantSpeciesSymbolWhenSettled(canonicalName),
      false,
    )
  }

  private _runCommandWhenSettled<T>(operation: () => T, busyResult: T): T {
    return this._commandAdmission.runWhenSettled(
      operation,
      busyResult,
      { resumePending: true },
    )
  }

  private _copyWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const selectionOptions = this._getSelectionReadModelOptions()
    const selected = this._getSelectionModel(selectionOptions).editableTargets
    this._clipboard = createClipboardPayload(persisted, selected)
    this._normalPasteCount = 0
  }

  private _pasteWhenSettled(): void {
    if (!this._clipboard) return

    const offset = normalPasteOffset(this._normalPasteCount + 1)
    this._arrangementPlacement.place({
      template: createClipboardArrangementTemplate(this._clipboard),
      translateBy: offset,
      historyType: 'paste',
      onCommitted: () => {
        this._normalPasteCount += 1
      },
    })
  }

  private _pasteAtWhenSettled(point: ScenePoint): void {
    if (!this._clipboard) return
    const sourceCenter = this._getClipboardSourceCenter(this._clipboard)
    if (!sourceCenter) return

    const offset = {
      x: point.x - sourceCenter.x,
      y: point.y - sourceCenter.y,
    }
    this._arrangementPlacement.place({
      template: createClipboardArrangementTemplate(this._clipboard),
      translateBy: offset,
      historyType: 'paste',
    })
  }

  private _canPasteWhenSettled(): boolean {
    return this._clipboard !== null
  }

  private _duplicateSelectedWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const selectionOptions = this._getSelectionReadModelOptions()
    const selected = this._getSelectionModel(selectionOptions).editableTargets
    const payload = createClipboardPayload(persisted, selected)
    if (!payload) return

    this._arrangementPlacement.place({
      template: createClipboardArrangementTemplate(payload, { preservePinnedNames: true }),
      translateBy: NORMAL_PASTE_OFFSET_M,
      historyType: 'duplicate-selected',
    })
  }

  private _toggleSelectedPlantNamePinsWhenSettled(): void {
    const selectedPlantIds = this._getEditableSelectedPlantIds()
    if (selectedPlantIds.size === 0) return

    const selectedPlants = this._sceneStore.persisted.plants.filter((plant) => selectedPlantIds.has(plant.id))
    const shouldPin = selectedPlants.some((plant) => !plant.pinnedName)

    this._sceneEdits.run(shouldPin ? 'pin-plant-names' : 'unpin-plant-names', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!selectedPlantIds.has(plant.id) || plant.pinnedName === shouldPin) return plant
          return {
            ...plant,
            pinnedName: shouldPin,
          }
        })
      })
    })
  }

  private _deleteSelectedWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const selected = this._getEditableTopLevelTargets()
    if (selected.length === 0) return

    const deleted = resolveSelectedEntitySets(persisted, selected)

    this._sceneEdits.run('delete-selected', (tx) => {
      tx.mutate((draft) => {
        draft.plants = draft.plants.filter((plant) => !deleted.plantIds.has(plant.id))
        draft.zones = draft.zones.filter((zone) => !deleted.zoneIds.has(zone.name))
        draft.annotations = draft.annotations.filter((annotation) => !deleted.annotationIds.has(annotation.id))
        draft.measurementGuides = draft.measurementGuides
          .filter((guide) => !deleted.measurementGuideIds.has(guide.id))
        draft.groups = draft.groups
          .filter((group) => !deleted.groupIds.has(group.id))
          .map((group) => ({
            ...group,
            members: group.members.filter((member) =>
              !(
                (member.kind === 'plant' && deleted.plantIds.has(member.id))
                || (member.kind === 'zone' && deleted.zoneIds.has(member.id))
                || (member.kind === 'annotation' && deleted.annotationIds.has(member.id))
              ),
            ),
          }))
          .filter((group) => group.members.length >= 2)
      })
      tx.setSelection([])
    })
  }

  private _selectAllWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const targets: SceneDesignObjectTarget[] = []
    const groupedMemberKeys = getSceneGroupedMemberKeys(persisted)
    const layerState = sceneLayerState(persisted)

    if (isSceneLayerEditable(layerState.plants)) {
      for (const plant of persisted.plants) {
        if (groupedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id })) || plant.locked) continue
        targets.push({ kind: 'plant', id: plant.id })
      }
    }

    if (isSceneLayerEditable(layerState.zones)) {
      for (const zone of persisted.zones) {
        if (groupedMemberKeys.has(sceneTargetKey({ kind: 'zone', id: zone.name })) || zone.locked) continue
        targets.push({ kind: 'zone', id: zone.name })
      }
    }

    if (isSceneLayerEditable(layerState.annotations)) {
      for (const annotation of persisted.annotations) {
        if (groupedMemberKeys.has(sceneTargetKey({ kind: 'annotation', id: annotation.id })) || annotation.locked) continue
        targets.push({ kind: 'annotation', id: annotation.id })
      }
    }

    if (isSceneLayerEditable(layerState['measurement-guides'])) {
      for (const guide of persisted.measurementGuides) {
        if (guide.locked) continue
        targets.push({ kind: 'measurement-guide', id: guide.id })
      }
    }

    for (const group of persisted.groups) {
      if (
        !isSceneObjectGroupLayerEditable(persisted, group, layerState)
        || isSceneDesignObjectLocked(persisted, { kind: 'group', id: group.id })
      ) continue
      targets.push({ kind: 'group', id: group.id })
    }

    const selection = normalizeSceneDesignObjectTargets(targets)
    if (sceneDesignObjectTargetsEqual(selection, this._sceneStore.session.selectedTargets)) return
    this._selection.set(selection)
    this._invalidateScene()
  }

  private _selectSameSpeciesWhenSettled(
    canonicalName?: string,
    options: { additive?: boolean } = {},
  ): void {
    const persisted = this._sceneStore.persisted
    const referenceCanonicalName = canonicalName
      ?? getSameSpeciesReferenceCanonicalName(persisted, this._getSelectionModel().editableTargets)
    if (!referenceCanonicalName) return

    const speciesPlantIds = getSelectablePlantIdsForSpecies(persisted, referenceCanonicalName)
    if (speciesPlantIds.length === 0) return

    const nextSelection = applySpeciesSelection(
      this._sceneStore.session.selectedTargets,
      speciesPlantIds,
      options.additive === true,
    )
    if (sceneDesignObjectTargetsEqual(nextSelection, this._sceneStore.session.selectedTargets)) return
    this._selection.set(nextSelection)
    this._invalidateScene()
  }

  private _bringToFrontWhenSettled(): void {
    this._reorderSelected('end')
  }

  private _sendToBackWhenSettled(): void {
    this._reorderSelected('start')
  }

  private _lockSelectedWhenSettled(): void {
    const selected = this._getEditableTopLevelTargets()
    if (selected.length === 0) return
    this._sceneEdits.run('lock-selected', (tx) => {
      tx.mutate((draft) => {
        setSceneDesignObjectLocks(draft, selected, true)
      })
      tx.setSelection([])
    })
  }

  private _unlockSelectedWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedTargets)
    if (selected.length === 0) return
    this._sceneEdits.run('unlock-selected', (tx) => {
      tx.mutate((draft) => {
        setSceneDesignObjectLocks(draft, selected, false)
      })
    })
  }

  private _groupSelectedWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const selectionModel = this._getSelectionModel()
    const plan = createGroupSelectedPlan(persisted, selectionModel.editableTargets)
    if (!plan) return

    this._sceneEdits.run('group-selected', (tx) => {
      tx.mutate((draft) => {
        if (plan.survivorGroupId) {
          draft.groups = draft.groups
            .filter((group) => group.id === plan.survivorGroupId || !plan.removedGroupIds.has(group.id))
            .map((group) => group.id === plan.survivorGroupId
              ? { ...group, members: plan.members.map((member) => ({ ...member })) }
              : group)
          return
        }
        draft.groups.push({
          kind: 'group',
          id: plan.nextGroupId,
          locked: false,
          name: null,
          members: plan.members.map((member) => ({ ...member })),
        })
      })
      tx.setSelection([{ kind: 'group', id: plan.nextGroupId }])
    })
  }

  private _ungroupSelectedWhenSettled(): void {
    const persisted = this._sceneStore.persisted
    const selectedGroupIds = new Set(
      this._getEditableTopLevelTargets()
        .filter((target) => target.kind === 'group')
        .map((target) => target.id),
    )
    if (selectedGroupIds.size === 0) return

    const layerState = sceneLayerState(persisted)
    const memberTargets = persisted.groups
      .filter((group) => selectedGroupIds.has(group.id))
      .flatMap((group) => resolveSceneObjectGroupMembers(persisted, group))
      .filter((target) =>
        isSceneLayerEditable(layerState[sceneObjectGroupMemberLayerName(target)])
        && !isConcreteDesignObjectTargetLocked(persisted, target),
      )

    this._sceneEdits.run('ungroup-selected', (tx) => {
      tx.mutate((draft) => {
        draft.groups = draft.groups.filter((group) => !selectedGroupIds.has(group.id))
      })
      tx.setSelection(memberTargets)
    })
  }

  getSelectedPlantColorContext(): SelectedPlantColorContext {
    const selectedPlantIds = this._getEditableSelectedPlantIds()
    const selectedPlants = this._sceneStore.persisted.plants.filter((plant) => selectedPlantIds.has(plant.id))
    if (selectedPlants.length === 0) return EMPTY_PLANT_COLOR_CONTEXT

    const plantIds = selectedPlants.map((plant) => plant.id)
    const canonicalNames = new Set(selectedPlants.map((plant) => plant.canonicalName))
    const colors = new Set(
      selectedPlants
        .map((plant) => normalizeHexColor(plant.color))
        .filter((value): value is string => value !== null),
    )
    const hasUncolored = selectedPlants.some((plant) => normalizeHexColor(plant.color) === null)
    const singleSpeciesCanonicalName = canonicalNames.size === 1 ? [...canonicalNames][0]! : null
    const singleSpeciesCommonName = singleSpeciesCanonicalName
      ? this._singleSpeciesCommonName(singleSpeciesCanonicalName, selectedPlants)
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

  getSelectedPlantSymbolContext(): SelectedPlantSymbolContext {
    const selectedPlantIds = this._getEditableSelectedPlantIds()
    const selectedPlants = this._sceneStore.persisted.plants.filter((plant) => selectedPlantIds.has(plant.id))
    if (selectedPlants.length === 0) return EMPTY_PLANT_SYMBOL_CONTEXT

    const plantIds = selectedPlants.map((plant) => plant.id)
    const canonicalNames = new Set(selectedPlants.map((plant) => plant.canonicalName))
    const explicitSymbols = selectedPlants.map((plant) =>
      plant.symbol == null ? null : resolvePlantSymbolId(plant.symbol),
    )
    const effectiveSymbols = selectedPlants.map((plant) =>
      resolvePlantSymbolForPlant(plant, this._sceneStore.persisted.plantSpeciesSymbols),
    )
    const uniqueExplicitSymbols = new Set(explicitSymbols)
    const uniqueEffectiveSymbols = new Set(effectiveSymbols)
    const singleSpeciesCanonicalName = canonicalNames.size === 1 ? [...canonicalNames][0]! : null
    const singleSpeciesCommonName = singleSpeciesCanonicalName
      ? this._singleSpeciesCommonName(singleSpeciesCanonicalName, selectedPlants)
      : null
    const singleSpeciesDefaultSymbol = singleSpeciesCanonicalName
      ? this._sceneStore.persisted.plantSpeciesSymbols[singleSpeciesCanonicalName]
      : undefined
    const normalizedSingleSpeciesDefaultSymbol = singleSpeciesDefaultSymbol == null
      ? null
      : resolvePlantSymbolId(singleSpeciesDefaultSymbol)

    return {
      plantIds,
      singleSpeciesCanonicalName,
      singleSpeciesCommonName,
      sharedCurrentSymbol: uniqueExplicitSymbols.size === 1
        ? [...uniqueExplicitSymbols][0]!
        : 'mixed',
      sharedEffectiveSymbol: uniqueEffectiveSymbols.size === 1
        ? [...uniqueEffectiveSymbols][0]!
        : 'mixed',
      inheritedSymbol: singleSpeciesCanonicalName
        ? resolvePlantSymbolId(singleSpeciesDefaultSymbol)
        : null,
      singleSpeciesDefaultSymbol: normalizedSingleSpeciesDefaultSymbol,
      canClearSelectedSymbol: selectedPlants.some((plant) => plant.symbol != null),
    }
  }

  private _singleSpeciesCommonName(
    canonicalName: string,
    plants: ReadonlyArray<{ commonName: string | null }>,
  ): string | null {
    const localizedName = this._presentation.getLocalizedCommonNames().get(canonicalName)
    if (localizedName && localizedName.length > 0) return localizedName
    const commonNames = new Set(
      plants
        .map((plant) => plant.commonName)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    )
    return commonNames.size === 1 ? [...commonNames][0]! : null
  }

  private _setSelectedPlantColorWhenSettled(color: string | null): number {
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

  private _setSelectedPlantSymbolWhenSettled(symbol: PlantSymbolId | null): number {
    const selectedPlantIds = this._getEditableSelectedPlantIds()
    const nextSymbol = symbol === null ? null : resolvePlantSymbolId(symbol)
    let changed = 0
    this._sceneEdits.run('set-selected-plant-symbol', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!selectedPlantIds.has(plant.id)) return plant
          if ((plant.symbol ?? null) === nextSymbol) return plant
          changed += 1
          return {
            ...plant,
            symbol: nextSymbol,
          }
        })
      })
    })
    return changed
  }

  private _setPlantColorForSpeciesWhenSettled(canonicalName: string, color: string | null): number {
    const nextColor = normalizeHexColor(color)
    const speciesTargets = getSpeciesPlantEditTargets(this._sceneStore.persisted, canonicalName)
    if (speciesTargets.plantIds.size > 0 && speciesTargets.editablePlantIds.size === 0) return 0
    let changed = 0

    const committed = this._sceneEdits.run('set-plant-color-for-species', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!speciesTargets.editablePlantIds.has(plant.id)) return plant
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
    })

    return committed ? changed : 0
  }

  private _setPlantSymbolForSpeciesWhenSettled(canonicalName: string, symbol: PlantSymbolId): number {
    const nextSymbol = resolvePlantSymbolId(symbol)
    const speciesTargets = getSpeciesPlantEditTargets(this._sceneStore.persisted, canonicalName)
    if (speciesTargets.plantIds.size > 0 && speciesTargets.editablePlantIds.size === 0) return 0
    let changed = 0

    this._sceneEdits.run('set-plant-symbol-for-species', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!speciesTargets.plantIds.has(plant.id)) return plant
          if (!speciesTargets.editablePlantIds.has(plant.id)) {
            if (plant.symbol != null) return plant
            const currentEffectiveSymbol = resolvePlantSymbolForPlant(plant, persisted.plantSpeciesSymbols)
            if (currentEffectiveSymbol === nextSymbol) return plant
            return {
              ...plant,
              symbol: currentEffectiveSymbol,
            }
          }

          const currentSymbol = getExplicitPlantSymbol(plant)
          if (currentSymbol === nextSymbol) return plant
          changed += 1
          return {
            ...plant,
            symbol: nextSymbol,
          }
        })
        persisted.plantSpeciesSymbols = {
          ...persisted.plantSpeciesSymbols,
          [canonicalName]: nextSymbol,
        }
      })
    })

    return changed
  }

  private _clearPlantSpeciesColorWhenSettled(canonicalName: string): boolean {
    const hadColor = normalizeHexColor(this._sceneStore.persisted.plantSpeciesColors[canonicalName] ?? null) !== null
    if (!hadColor) return false
    const committed = this._sceneEdits.run('clear-plant-species-color', (tx) => {
      tx.mutate((persisted) => {
        const nextSpeciesColors = { ...persisted.plantSpeciesColors }
        delete nextSpeciesColors[canonicalName]
        persisted.plantSpeciesColors = nextSpeciesColors
      })
    })
    return committed
  }

  private _clearPlantSpeciesSymbolWhenSettled(canonicalName: string): boolean {
    const hadSymbol = Object.prototype.hasOwnProperty.call(this._sceneStore.persisted.plantSpeciesSymbols, canonicalName)
    if (!hadSymbol) return false
    const speciesTargets = getSpeciesPlantEditTargets(this._sceneStore.persisted, canonicalName)
    this._sceneEdits.run('clear-plant-species-symbol', (tx) => {
      tx.mutate((persisted) => {
        persisted.plants = persisted.plants.map((plant) => {
          if (!speciesTargets.plantIds.has(plant.id)) return plant
          if (speciesTargets.editablePlantIds.has(plant.id) || plant.symbol != null) return plant
          const currentEffectiveSymbol = resolvePlantSymbolForPlant(plant, persisted.plantSpeciesSymbols)
          if (currentEffectiveSymbol === resolvePlantSymbolId(null)) return plant
          return {
            ...plant,
            symbol: currentEffectiveSymbol,
          }
        })
        const nextSpeciesSymbols = { ...persisted.plantSpeciesSymbols }
        delete nextSpeciesSymbols[canonicalName]
        persisted.plantSpeciesSymbols = nextSpeciesSymbols
      })
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
        draft.measurementGuides = reorderSceneEntities(
          draft.measurementGuides,
          resolved.measurementGuideIds,
          position,
          (guide) => guide.id,
        )
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

  private _getSelectionModel(options = this._getSelectionReadModelOptions()) {
    return getDesignObjectSelectionModel(
      this._sceneStore.persisted,
      this._sceneStore.session.selectedTargets,
      options,
    )
  }

  private _getSelectionReadModelOptions(): SceneSelectionReadModelOptions {
    const viewportScale = this._presentation.getViewportScale()
    return {
      annotationViewportScale: viewportScale,
      plantContext: this._presentation.createPlantPresentationContext(viewportScale),
    }
  }

  private _getClipboardSourceCenter(payload: SceneClipboardPayload): ScenePoint | null {
    const clipboardScene: ScenePersistedState = {
      ...this._sceneStore.persisted,
      plants: payload.plants,
      zones: payload.zones,
      annotations: payload.annotations,
      measurementGuides: payload.measurementGuides,
      groups: payload.groups,
    }
    return centerOfBounds(getCombinedTargetBounds(
      clipboardScene,
      payload.sourceTargets,
      this._getSelectionReadModelOptions(),
    ))
  }
}

function normalPasteOffset(step: number): ScenePoint {
  return {
    x: NORMAL_PASTE_OFFSET_M.x * step,
    y: NORMAL_PASTE_OFFSET_M.y * step,
  }
}

function centerOfBounds(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
): ScenePoint | null {
  if (!bounds) return null
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) / 2,
    y: bounds.minY + (bounds.maxY - bounds.minY) / 2,
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

function isSceneObjectGroupLayerEditable(
  persisted: ScenePersistedState,
  group: SceneObjectGroupEntity,
  layerState: Readonly<Record<string, { visible: boolean; locked: boolean } | undefined>>,
): boolean {
  const members = resolveSceneObjectGroupMembers(persisted, group)
  if (members.length === 0) return false
  return members.every((member) => isSceneLayerEditable(layerState[sceneObjectGroupMemberLayerName(member)]))
}

interface GroupSelectedPlan {
  nextGroupId: string
  survivorGroupId: string | null
  removedGroupIds: Set<string>
  members: SceneObjectGroupMember[]
}

function createGroupSelectedPlan(
  persisted: ScenePersistedState,
  selected: readonly SceneSelectionTarget[],
): GroupSelectedPlan | null {
  if (selected.length < 2) return null
  const selectedGroupIds = new Set<string>()
  const members: SceneObjectGroupMember[] = []

  for (const target of selected) {
    if (target.kind === 'group') {
      const group = persisted.groups.find((entry) => entry.id === target.id)
      if (!group) continue
      selectedGroupIds.add(group.id)
      for (const member of resolveSceneObjectGroupMembers(persisted, group)) {
        members.push({ kind: member.kind, id: member.id })
      }
      continue
    }

    const member = sceneObjectGroupMemberFromTarget(target)
    if (member) members.push(member)
  }

  const dedupedMembers = dedupeSceneObjectGroupMembers(members)
  if (dedupedMembers.length < 2) return null

  const survivor = [...persisted.groups]
    .reverse()
    .find((group) => selectedGroupIds.has(group.id)) ?? null
  const removedGroupIds = new Set(selectedGroupIds)
  if (survivor) removedGroupIds.delete(survivor.id)

  return {
    nextGroupId: survivor?.id ?? createUuid(),
    survivorGroupId: survivor?.id ?? null,
    removedGroupIds,
    members: dedupedMembers,
  }
}

function getSpeciesPlantEditTargets(
  persisted: ScenePersistedState,
  canonicalName: string,
): { plantIds: Set<string>; editablePlantIds: Set<string> } {
  const plantIds = new Set<string>()
  const editablePlantIds = new Set<string>()
  const layerState = sceneLayerState(persisted)
  const groupLockedMemberKeys = getEffectivelyLockedGroupMemberKeys(persisted)
  for (const plant of persisted.plants) {
    if (plant.canonicalName !== canonicalName) continue
    plantIds.add(plant.id)
    if (
      isSceneLayerEditable(layerState.plants)
      && !plant.locked
      && !groupLockedMemberKeys.has(sceneTargetKey({ kind: 'plant', id: plant.id }))
    ) {
      editablePlantIds.add(plant.id)
    }
  }
  return { plantIds, editablePlantIds }
}

function getExplicitPlantSymbol(plant: { symbol?: string | null }): PlantSymbolId | null {
  return plant.symbol == null ? null : resolvePlantSymbolId(plant.symbol)
}

function getEffectivelyLockedGroupMemberKeys(persisted: ScenePersistedState): Set<string> {
  const memberKeys = new Set<string>()
  for (const group of persisted.groups) {
    if (!isSceneDesignObjectLocked(persisted, { kind: 'group', id: group.id })) continue
    for (const member of group.members) memberKeys.add(sceneObjectGroupMemberKey(member))
  }
  return memberKeys
}

function resolveSelectedEntitySets(
  persisted: ScenePersistedState,
  selected: readonly SceneSelectionTarget[],
): {
  plantIds: Set<string>
  zoneIds: Set<string>
  annotationIds: Set<string>
  measurementGuideIds: Set<string>
  groupIds: Set<string>
} {
  const plantIds = new Set<string>()
  const zoneIds = new Set<string>()
  const annotationIds = new Set<string>()
  const measurementGuideIds = new Set<string>()
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
    if (target.kind === 'measurement-guide') {
      measurementGuideIds.add(target.id)
      continue
    }

    groupIds.add(target.id)
    const group = persisted.groups.find((entry) => entry.id === target.id)
    if (!group) continue
    for (const member of resolveSceneObjectGroupMembers(persisted, group)) {
      if (member.kind === 'plant') plantIds.add(member.id)
      else if (member.kind === 'zone') zoneIds.add(member.id)
      else annotationIds.add(member.id)
    }
  }

  return { plantIds, zoneIds, annotationIds, measurementGuideIds, groupIds }
}

function isConcreteDesignObjectTargetLocked(
  persisted: ScenePersistedState,
  target: SceneConcreteDesignObjectTarget,
): boolean {
  if (target.kind === 'plant') {
    return persisted.plants.some((plant) => plant.id === target.id && plant.locked)
  }
  if (target.kind === 'zone') {
    return persisted.zones.some((zone) => zone.name === target.id && zone.locked)
  }
  return persisted.annotations.some((annotation) => annotation.id === target.id && annotation.locked)
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
