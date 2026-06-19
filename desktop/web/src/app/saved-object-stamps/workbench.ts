import { batch, computed, signal, type ReadonlySignal } from '@preact/signals'
import type { CanvasDesignObjectSelectionTarget, CanvasQuerySurface } from '../../canvas/runtime/runtime'
import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePersistedState,
  ScenePlantEntity,
  SceneZoneEntity,
} from '../../canvas/runtime/scene'
import { currentCanvasQuerySurface } from '../../canvas/session'
import { beginSavedObjectStampPlacement } from '../../canvas/saved-object-stamp-source'
import {
  createSavedObjectStamp as createSavedObjectStampIpc,
  deleteSavedObjectStamp as deleteSavedObjectStampIpc,
  getSavedObjectStamps as getSavedObjectStampsIpc,
  renameSavedObjectStamp as renameSavedObjectStampIpc,
  reorderSavedObjectStamps as reorderSavedObjectStampsIpc,
} from '../../ipc/saved-object-stamps'
import type { SavedObjectStamp } from '../../types/saved-object-stamps'
import type {
  SavedObjectStampAnnotation,
  SavedObjectStampPayload,
  SavedObjectStampPlant,
  SavedObjectStampZone,
} from '../../canvas/saved-object-stamp-payload'

export interface SavedObjectStampLibraryView {
  readonly items: readonly SavedObjectStamp[]
  readonly loading: boolean
  readonly revision: number
}

export interface SavedObjectStampSelectionView {
  readonly canSave: boolean
  readonly reason: 'no-canvas' | 'empty-selection' | 'structural-blocker' | null
  readonly selectedCount: number
}

export interface SavedObjectStampWorkbench {
  readonly library: ReadonlySignal<SavedObjectStampLibraryView>
  readonly selection: ReadonlySignal<SavedObjectStampSelectionView>
  loadLibrary(): Promise<void>
  saveCurrentSelection(): Promise<SavedObjectStamp | null>
  renameStamp(id: string, name: string): Promise<SavedObjectStamp | null>
  deleteStamp(id: string): Promise<boolean>
  reorderStamps(ids: string[]): Promise<void>
  placeStamp(stamp: SavedObjectStamp): boolean
}

interface SavedObjectStampWorkbenchOptions {
  readonly getSavedObjectStamps?: () => Promise<SavedObjectStamp[]>
  readonly createSavedObjectStamp?: (name: string, payloadJson: string) => Promise<SavedObjectStamp>
  readonly renameSavedObjectStamp?: (id: string, name: string) => Promise<SavedObjectStamp>
  readonly deleteSavedObjectStamp?: (id: string) => Promise<boolean>
  readonly reorderSavedObjectStamps?: (ids: string[]) => Promise<SavedObjectStamp[]>
  readonly getCanvasQuerySurface?: () => CanvasQuerySurface | null
  readonly beginPlacement?: (stamp: SavedObjectStamp) => boolean
}

interface NormalizedSelection {
  readonly name: string
  readonly payload: SavedObjectStampPayload
}

export function createSavedObjectStampWorkbench({
  getSavedObjectStamps = getSavedObjectStampsIpc,
  createSavedObjectStamp = createSavedObjectStampIpc,
  renameSavedObjectStamp = renameSavedObjectStampIpc,
  deleteSavedObjectStamp = deleteSavedObjectStampIpc,
  reorderSavedObjectStamps = reorderSavedObjectStampsIpc,
  getCanvasQuerySurface = () => currentCanvasQuerySurface.value,
  beginPlacement = beginSavedObjectStampPlacement,
}: SavedObjectStampWorkbenchOptions = {}): SavedObjectStampWorkbench {
  const items = signal<SavedObjectStamp[]>([])
  const loading = signal(false)
  const revision = signal(0)
  const selectionRevision = signal(0)

  const library = computed<SavedObjectStampLibraryView>(() => ({
    items: items.value,
    loading: loading.value,
    revision: revision.value,
  }))

  const selection = computed<SavedObjectStampSelectionView>(() => {
    selectionRevision.value
    const query = getCanvasQuerySurface()
    if (!query) {
      return { canSave: false, reason: 'no-canvas', selectedCount: 0 }
    }
    void query.revision.scene.value
    void query.revision.plantNames.value
    return readSelectionView(query)
  })

  async function loadLibrary(): Promise<void> {
    loading.value = true
    try {
      items.value = await getSavedObjectStamps()
    } finally {
      loading.value = false
    }
  }

  async function saveCurrentSelection(): Promise<SavedObjectStamp | null> {
    const query = getCanvasQuerySurface()
    if (!query) return null

    const normalized = normalizeCurrentSelection(query)
    if (!normalized) {
      selectionRevision.value += 1
      return null
    }

    const saved = await createSavedObjectStamp(
      normalized.name,
      JSON.stringify(normalized.payload),
    )
    batch(() => {
      items.value = [...items.value, saved].sort(compareSavedObjectStamps)
      revision.value += 1
      selectionRevision.value += 1
    })
    return saved
  }

  async function renameStamp(id: string, name: string): Promise<SavedObjectStamp | null> {
    const nextName = name.trim()
    if (nextName.length === 0) return null
    const renamed = await renameSavedObjectStamp(id, nextName)
    batch(() => {
      items.value = items.value.map((stamp) => stamp.id === id ? renamed : stamp)
      revision.value += 1
    })
    return renamed
  }

  async function deleteStamp(id: string): Promise<boolean> {
    const deleted = await deleteSavedObjectStamp(id)
    if (deleted) {
      batch(() => {
        items.value = items.value.filter((stamp) => stamp.id !== id)
        revision.value += 1
      })
    }
    return deleted
  }

  async function reorderStamps(ids: string[]): Promise<void> {
    const reordered = await reorderSavedObjectStamps(ids)
    batch(() => {
      items.value = [...reordered].sort(compareSavedObjectStamps)
      revision.value += 1
    })
  }

  function placeStamp(stamp: SavedObjectStamp): boolean {
    return beginPlacement(stamp)
  }

  return {
    library,
    selection,
    loadLibrary,
    saveCurrentSelection,
    renameStamp,
    deleteStamp,
    reorderStamps,
    placeStamp,
  }
}

function readSelectionView(query: CanvasQuerySurface): SavedObjectStampSelectionView {
  const selection = query.getDesignObjectSelection()
  const selectedCount = selection.editableTargets.length + selection.lockedTargets.length
  if (selection.blockedTargets.length > 0) {
    return { canSave: false, reason: 'structural-blocker', selectedCount }
  }
  if (selectedCount === 0) {
    return { canSave: false, reason: 'empty-selection', selectedCount }
  }
  return { canSave: true, reason: null, selectedCount }
}

function normalizeCurrentSelection(query: CanvasQuerySurface): NormalizedSelection | null {
  const selectionView = readSelectionView(query)
  if (!selectionView.canSave) return null

  const scene = query.getSceneSnapshot()
  const selection = query.getDesignObjectSelection()
  const selectedTargets = [...selection.editableTargets, ...selection.lockedTargets]
  const selected = collectSelectedConcreteTargets(scene, selectedTargets)
  const selectedGroups = collectSelectedGroups(scene, selectedTargets)
  const idMap = new Map<string, string>()

  const plants = scene.plants
    .filter((plant) => selected.plants.has(plant.id))
    .map((plant, index) => {
      const id = `plant-${index + 1}`
      idMap.set(concreteKey({ kind: 'plant', id: plant.id }), id)
      return savedPlantFromScene(plant, id)
    })
  const zones = scene.zones
    .filter((zone) => selected.zones.has(zone.name))
    .map((zone, index) => {
      const id = `zone-${index + 1}`
      idMap.set(concreteKey({ kind: 'zone', id: zone.name }), id)
      return savedZoneFromScene(zone, id)
    })
  const annotations = scene.annotations
    .filter((annotation) => selected.annotations.has(annotation.id))
    .map((annotation, index) => {
      const id = `annotation-${index + 1}`
      idMap.set(concreteKey({ kind: 'annotation', id: annotation.id }), id)
      return savedAnnotationFromScene(annotation, id)
    })
  const groups = selectedGroups.map((group, index) => ({
    id: `group-${index + 1}`,
    name: group.name,
    members: group.members
      .map((member) => remapGroupMember(member, idMap))
      .filter((member): member is SceneObjectGroupMember => member !== null),
  }))

  const payload: SavedObjectStampPayload = {
    version: 1,
    anchor: selection.bounds
      ? {
          x: (selection.bounds.minX + selection.bounds.maxX) / 2,
          y: (selection.bounds.minY + selection.bounds.maxY) / 2,
        }
      : { x: 0, y: 0 },
    plants,
    zones,
    annotations,
    groups,
  }
  return {
    name: defaultStampName(payload, query.getLocalizedCommonNames()),
    payload,
  }
}

function collectSelectedConcreteTargets(
  scene: ScenePersistedState,
  targets: readonly CanvasDesignObjectSelectionTarget[],
): { plants: Set<string>; zones: Set<string>; annotations: Set<string> } {
  const plants = new Set<string>()
  const zones = new Set<string>()
  const annotations = new Set<string>()
  const groupById = new Map(scene.groups.map((group) => [group.id, group]))

  for (const target of targets) {
    if (target.kind === 'plant') plants.add(target.id)
    if (target.kind === 'zone') zones.add(target.id)
    if (target.kind === 'annotation') annotations.add(target.id)
    if (target.kind === 'group') {
      for (const member of groupById.get(target.id)?.members ?? []) {
        if (member.kind === 'plant') plants.add(member.id)
        if (member.kind === 'zone') zones.add(member.id)
        if (member.kind === 'annotation') annotations.add(member.id)
      }
    }
  }

  return { plants, zones, annotations }
}

function collectSelectedGroups(
  scene: ScenePersistedState,
  targets: readonly CanvasDesignObjectSelectionTarget[],
): SceneObjectGroupEntity[] {
  const selectedGroupIds = new Set(targets.filter((target) => target.kind === 'group').map((target) => target.id))
  return scene.groups.filter((group) => selectedGroupIds.has(group.id))
}

function savedPlantFromScene(plant: ScenePlantEntity, id: string): SavedObjectStampPlant {
  return {
    id,
    canonicalName: plant.canonicalName,
    commonName: plant.commonName,
    color: plant.color,
    symbol: plant.symbol ?? null,
    position: { ...plant.position },
    rotationDeg: plant.rotationDeg,
    scale: plant.scale,
  }
}

function savedZoneFromScene(zone: SceneZoneEntity, id: string): SavedObjectStampZone {
  return {
    id,
    name: zone.name,
    zoneType: zone.zoneType,
    points: zone.points.map((point) => ({ ...point })),
    rotationDeg: zone.rotationDeg,
    fillColor: zone.fillColor,
  }
}

function savedAnnotationFromScene(annotation: SceneAnnotationEntity, id: string): SavedObjectStampAnnotation {
  return {
    id,
    annotationType: annotation.annotationType,
    position: { ...annotation.position },
    text: annotation.text,
    fontSize: annotation.fontSize,
    rotationDeg: annotation.rotationDeg,
  }
}

function remapGroupMember(
  member: SceneObjectGroupMember,
  idMap: ReadonlyMap<string, string>,
): SceneObjectGroupMember | null {
  const id = idMap.get(concreteKey(member))
  if (!id) return null
  return { kind: member.kind, id }
}

function concreteKey(member: SceneObjectGroupMember): string {
  return `${member.kind}:${member.id}`
}

function defaultStampName(
  payload: SavedObjectStampPayload,
  localizedNames: ReadonlyMap<string, string | null>,
): string {
  if (payload.plants.length > 0) {
    const counts = new Map<string, { count: number; firstIndex: number }>()
    payload.plants.forEach((plant, index) => {
      const name = localizedNames.get(plant.canonicalName) ?? plant.commonName ?? plant.canonicalName
      const current = counts.get(name)
      counts.set(name, current
        ? { ...current, count: current.count + 1 }
        : { count: 1, firstIndex: index })
    })
    return [...counts.entries()]
      .sort(([, left], [, right]) => right.count - left.count || left.firstIndex - right.firstIndex)
      .slice(0, 3)
      .map(([name]) => name)
      .join(', ')
  }

  const zonePart = payload.zones.length === 1 ? '1 zone' : `${payload.zones.length} zones`
  const annotationPart = payload.annotations.length === 1
    ? '1 annotation'
    : `${payload.annotations.length} annotations`
  return `${zonePart}, ${annotationPart}`
}

function compareSavedObjectStamps(left: SavedObjectStamp, right: SavedObjectStamp): number {
  return left.sort_order - right.sort_order || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id)
}

export const savedObjectStampWorkbench = createSavedObjectStampWorkbench()
