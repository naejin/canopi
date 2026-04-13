import type { ColorByAttribute, PlantSizeMode } from '../../../state/canvas'
import { getAnnotationWorldBounds } from '../annotation-layout'
import type { SceneBounds } from '../camera'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from '../plant-presentation'
import { normalizeHexColor } from '../../plant-colors'
import type { SelectedPlantColorContext } from '../../plant-color-context'
import type {
  SceneObjectGroupEntity,
  ScenePersistedState,
  SceneStore,
} from '../scene'
import type { SceneCommandSnapshot } from '../scene-commands'
import {
  createClipboardPayload,
  pasteClipboardPayload,
  type SceneClipboardPayload,
} from './clipboard'
import {
  getSelectedPlantIds,
  getSelectedTopLevelTargets,
  getSelectionLayer,
  setsEqual,
} from './selection'

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
  locks: {
    get(): ReadonlySet<string>
    set(ids: Iterable<string>): void
  }
  history: {
    captureSnapshot(): SceneCommandSnapshot
    markDirty(before: SceneCommandSnapshot, type?: string): void
  }
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
  private readonly _locks: SceneRuntimeMutationControllerOptions['locks']
  private readonly _history: SceneRuntimeMutationControllerOptions['history']
  private readonly _presentation: SceneRuntimeMutationControllerOptions['presentation']
  private readonly _invalidateScene: () => void
  private _clipboard: SceneClipboardPayload | null = null

  constructor(options: SceneRuntimeMutationControllerOptions) {
    this._sceneStore = options.sceneStore
    this._selection = options.selection
    this._locks = options.locks
    this._history = options.history
    this._presentation = options.presentation
    this._invalidateScene = options.invalidateScene
  }

  copy(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    this._clipboard = createClipboardPayload(persisted, selected)
  }

  paste(): void {
    if (!this._clipboard) return

    const before = this._history.captureSnapshot()
    let nextSelection = new Set<string>()
    this._sceneStore.updatePersisted((draft) => {
      nextSelection = pasteClipboardPayload(this._clipboard!, draft)
    })

    if (nextSelection.size === 0) return
    this._selection.set(nextSelection)
    this._history.markDirty(before)
    this._invalidateScene()
  }

  duplicateSelected(): void {
    this.copy()
    this.paste()
  }

  deleteSelected(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length === 0) return

    const before = this._history.captureSnapshot()
    const deleted = resolveSelectedEntitySets(persisted, selected)

    this._sceneStore.updatePersisted((draft) => {
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

    const nextLocked = new Set(this._locks.get())
    for (const id of [
      ...deleted.plantIds,
      ...deleted.zoneIds,
      ...deleted.annotationIds,
      ...deleted.groupIds,
    ]) {
      nextLocked.delete(id)
    }
    this._locks.set(nextLocked)
    this._selection.set([])
    this._history.markDirty(before)
    this._invalidateScene()
  }

  selectAll(layerVisibility: Readonly<Record<string, boolean | undefined>>): void {
    const persisted = this._sceneStore.persisted
    const locked = this._locks.get()
    const ids = new Set<string>()
    const groupedMemberIds = new Set(persisted.groups.flatMap((group) => group.memberIds))

    if (layerVisibility.plants !== false) {
      for (const plant of persisted.plants) {
        if (groupedMemberIds.has(plant.id) || locked.has(plant.id)) continue
        ids.add(plant.id)
      }
    }

    if (layerVisibility.zones !== false) {
      for (const zone of persisted.zones) {
        if (groupedMemberIds.has(zone.name) || locked.has(zone.name)) continue
        ids.add(zone.name)
      }
    }

    if (layerVisibility.annotations !== false) {
      for (const annotation of persisted.annotations) {
        if (groupedMemberIds.has(annotation.id) || locked.has(annotation.id)) continue
        ids.add(annotation.id)
      }
    }

    for (const group of persisted.groups) {
      if (layerVisibility[group.layer] === false || locked.has(group.id)) continue
      ids.add(group.id)
    }

    if (setsEqual(ids, this._sceneStore.session.selectedEntityIds)) return
    this._selection.set(ids)
    this._invalidateScene()
  }

  bringToFront(): void {
    this._reorderSelected('end')
  }

  sendToBack(): void {
    this._reorderSelected('start')
  }

  lockSelected(): void {
    const selected = getSelectedTopLevelTargets(this._sceneStore.persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length === 0) return
    const before = this._history.captureSnapshot()
    const nextLocked = new Set(this._locks.get())
    for (const target of selected) nextLocked.add(target.id)
    this._locks.set(nextLocked)
    this._selection.set([])
    this._history.markDirty(before, 'lock-selected')
    this._invalidateScene()
  }

  unlockSelected(): void {
    if (this._locks.get().size === 0) return
    const before = this._history.captureSnapshot()
    this._locks.set([])
    this._history.markDirty(before, 'unlock-selected')
    this._invalidateScene()
  }

  groupSelected(): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length < 2 || selected.some((target) => target.kind === 'group')) return

    const layer = getSelectionLayer(selected[0]!)
    if (!selected.every((target) => getSelectionLayer(target) === layer)) return

    const before = this._history.captureSnapshot()
    const memberIds = selected.map((target) => target.id)
    const viewportScale = this._presentation.getViewportScale()
    const plantContext = this._presentation.createPlantPresentationContext(viewportScale)
    const bounds = memberIds
      .map((memberId) => getMemberBounds(memberId, persisted, viewportScale, plantContext))
      .filter((value): value is SceneBounds => value !== null)
    if (bounds.length === 0) return

    let minX = Infinity
    let minY = Infinity
    for (const boundsEntry of bounds) {
      if (boundsEntry.minX < minX) minX = boundsEntry.minX
      if (boundsEntry.minY < minY) minY = boundsEntry.minY
    }

    const nextGroup: SceneObjectGroupEntity = {
      kind: 'group',
      id: crypto.randomUUID(),
      name: null,
      layer,
      position: { x: minX, y: minY },
      rotationDeg: null,
      memberIds,
    }

    this._sceneStore.updatePersisted((draft) => {
      draft.groups.push(nextGroup)
    })
    this._selection.set([nextGroup.id])
    this._history.markDirty(before)
    this._invalidateScene()
  }

  ungroupSelected(): void {
    const persisted = this._sceneStore.persisted
    const selectedGroupIds = new Set(
      getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
        .filter((target) => target.kind === 'group')
        .map((target) => target.id),
    )
    if (selectedGroupIds.size === 0) return

    const before = this._history.captureSnapshot()
    const memberIds = persisted.groups
      .filter((group) => selectedGroupIds.has(group.id))
      .flatMap((group) => group.memberIds)

    this._sceneStore.updatePersisted((draft) => {
      draft.groups = draft.groups.filter((group) => !selectedGroupIds.has(group.id))
    })
    this._selection.set(memberIds)
    this._history.markDirty(before)
    this._invalidateScene()
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
    const selectedPlantIds = getSelectedPlantIds(this._sceneStore.persisted, this._sceneStore.session.selectedEntityIds)
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
    const selectedPlantIds = getSelectedPlantIds(this._sceneStore.persisted, this._sceneStore.session.selectedEntityIds)
    const nextColor = normalizeHexColor(color)
    let changed = 0
    const before = this._history.captureSnapshot()
    this._sceneStore.updatePersisted((persisted) => {
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
    if (changed > 0) {
      this._history.markDirty(before)
      this._invalidateScene()
    }
    return changed
  }

  setPlantColorForSpecies(canonicalName: string, color: string | null): number {
    const nextColor = normalizeHexColor(color)
    const previousSpeciesColor = normalizeHexColor(
      this._sceneStore.persisted.plantSpeciesColors[canonicalName] ?? null,
    )
    const speciesColorChanged = previousSpeciesColor !== nextColor
    let changed = 0
    const before = this._history.captureSnapshot()

    this._sceneStore.updatePersisted((persisted) => {
      persisted.plants = persisted.plants.map((plant) => {
        if (plant.canonicalName !== canonicalName) return plant
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

    if (changed > 0 || speciesColorChanged) {
      this._history.markDirty(before)
      this._invalidateScene()
    }

    return changed
  }

  clearPlantSpeciesColor(canonicalName: string): boolean {
    const hadColor = normalizeHexColor(this._sceneStore.persisted.plantSpeciesColors[canonicalName] ?? null) !== null
    if (!hadColor) return false
    const before = this._history.captureSnapshot()
    this._sceneStore.updatePersisted((persisted) => {
      const nextSpeciesColors = { ...persisted.plantSpeciesColors }
      delete nextSpeciesColors[canonicalName]
      persisted.plantSpeciesColors = nextSpeciesColors
    })
    this._presentation.syncPlantSpeciesColors()
    this._history.markDirty(before)
    this._invalidateScene()
    return true
  }

  private _reorderSelected(position: 'start' | 'end'): void {
    const persisted = this._sceneStore.persisted
    const selected = getSelectedTopLevelTargets(persisted, this._sceneStore.session.selectedEntityIds)
    if (selected.length === 0) return

    const before = this._history.captureSnapshot()
    const resolved = resolveSelectedEntitySets(persisted, selected)

    this._sceneStore.updatePersisted((draft) => {
      draft.plants = reorderSceneEntities(draft.plants, resolved.plantIds, position, (plant) => plant.id)
      draft.zones = reorderSceneEntities(draft.zones, resolved.zoneIds, position, (zone) => zone.name)
      draft.annotations = reorderSceneEntities(draft.annotations, resolved.annotationIds, position, (annotation) => annotation.id)
      draft.groups = reorderSceneEntities(draft.groups, resolved.groupIds, position, (group) => group.id)
    })
    this._history.markDirty(before)
    this._invalidateScene()
  }
}

function resolveSelectedEntitySets(
  persisted: ScenePersistedState,
  selected: ReturnType<typeof getSelectedTopLevelTargets>,
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

function getMemberBounds(
  memberId: string,
  persisted: ScenePersistedState,
  annotationViewportScale: number,
  plantContext: PlantPresentationContext,
): SceneBounds | null {
  const plant = persisted.plants.find((entry) => entry.id === memberId)
  if (plant) {
    const bounds = getPlantWorldBounds(plant, {
      ...plantContext,
      viewport: { x: 0, y: 0, scale: annotationViewportScale },
    })
    return {
      minX: bounds.x,
      minY: bounds.y,
      maxX: bounds.x + bounds.width,
      maxY: bounds.y + bounds.height,
    }
  }

  const zone = persisted.zones.find((entry) => entry.name === memberId)
  if (zone && zone.points.length > 0) {
    if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
      const center = zone.points[0]!
      const radii = zone.points[1]!
      return {
        minX: center.x - radii.x,
        minY: center.y - radii.y,
        maxX: center.x + radii.x,
        maxY: center.y + radii.y,
      }
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of zone.points) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    return { minX, minY, maxX, maxY }
  }

  const annotation = persisted.annotations.find((entry) => entry.id === memberId)
  if (!annotation) return null
  const bounds = getAnnotationWorldBounds(annotation, annotationViewportScale)
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  }
}
