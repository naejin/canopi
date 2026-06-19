import { clearSavedObjectStampSource, readSavedObjectStampSource } from '../../saved-object-stamp-source'
import type { SavedObjectStampPayload } from '../../saved-object-stamp-payload'
import { createUuid } from '../../../utils/ids'
import { getAnnotationWorldBounds } from '../annotation-layout'
import type { CameraController } from '../camera'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from '../plant-presentation'
import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  SceneObjectGroupMember,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneStore,
  SceneZoneEntity,
} from '../scene'
import {
  sceneObjectGroupMemberKey,
} from '../scene'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { getZoneWorldBounds } from '../zone-geometry'
import { isSceneLayerOpenForCreation, type SceneCreationLayerName } from './layer-guards'
import { isEditableTarget } from './pointer-utils'
import type { SceneToolAdapter } from './tool-adapter'

export interface SavedObjectStampToolContext {
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
  readonly switchTool: (name: string) => void
}

export interface SavedObjectStampTool {
  readonly hasSource: () => boolean
  readonly pointerDown: (world: ScenePoint) => void
  readonly updatePreview: (world: ScenePoint) => void
  readonly clear: () => void
  readonly dispose: () => void
}

export function createSavedObjectStampTool(context: SavedObjectStampToolContext): SavedObjectStampTool {
  function hasSource(): boolean {
    return readSavedObjectStampSource() !== null
  }

  function pointerDown(world: ScenePoint): void {
    const source = readSavedObjectStampSource()
    if (!source || !canPlaceSavedObjectStamp(context.getSceneStore().persisted, source)) return
    const anchor = context.applySnapping(world)
    const committed = placeSavedObjectStamp(source, anchor)
    if (committed) {
      clear()
      context.switchTool('select')
    }
  }

  function placeSavedObjectStamp(source: SavedObjectStampPayload, anchorWorld: ScenePoint): boolean {
    const delta = stampDelta(source, anchorWorld)
    let selection: string[] = []
    return context.sceneEdits.run('interaction-saved-object-stamp', (tx) => {
      tx.mutate((draft) => {
        const copied = copySavedObjectStampToDraft(draft, source, delta)
        selection = copied.selection
      })
      if (selection.length > 0) tx.setSelection(selection)
    })
  }

  function updatePreview(world: ScenePoint): void {
    const source = readSavedObjectStampSource()
    if (!source || !canPlaceSavedObjectStamp(context.getSceneStore().persisted, source)) {
      hideSavedObjectStampGhosts(context.preview)
      return
    }
    showSavedObjectStampGhosts(context, source, stampDelta(source, context.applySnapping(world)))
  }

  function clear(): void {
    clearSavedObjectStampSource()
    hideSavedObjectStampGhosts(context.preview)
  }

  return {
    hasSource,
    pointerDown,
    updatePreview,
    clear,
    dispose: clear,
  }
}

export function createSavedObjectStampToolAdapter(
  tool: SavedObjectStampTool,
  context: Pick<SavedObjectStampToolContext, 'switchTool'>,
): SceneToolAdapter {
  return {
    onDeactivate: tool.clear,
    shouldSuppressHover: tool.hasSource,
    pointerDown({ event, rawWorld, clearPointerGesture }) {
      event.preventDefault()
      tool.pointerDown(rawWorld)
      clearPointerGesture()
      return true
    },
    pointerMoveWithoutCapture({ rawWorld }) {
      if (!tool.hasSource()) return false
      tool.updatePreview(rawWorld)
      return true
    },
    keyDown(event) {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return false
      event.preventDefault()
      tool.clear()
      context.switchTool('select')
      return true
    },
    dispose: tool.dispose,
  }
}

function copySavedObjectStampToDraft(
  draft: ScenePersistedState,
  source: SavedObjectStampPayload,
  delta: ScenePoint,
): { selection: string[] } {
  const sourceToCloneId = new Map<string, string>()
  const existingZoneNames = new Set(draft.zones.map((zone) => zone.name))

  const plants = source.plants.map((plant): ScenePlantEntity => {
    const clone: ScenePlantEntity = {
      kind: 'plant',
      id: createUuid(),
      locked: false,
      canonicalName: plant.canonicalName,
      commonName: plant.commonName,
      color: plant.color,
      symbol: plant.symbol ?? null,
      stratum: null,
      canopySpreadM: plant.scale,
      position: translatePoint(plant.position, delta),
      rotationDeg: plant.rotationDeg,
      scale: plant.scale,
      notes: null,
      plantedDate: null,
      quantity: null,
    }
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }), clone.id)
    return clone
  })

  const zones = source.zones.map((zone): SceneZoneEntity => {
    const name = uniqueZoneName(zone.name, existingZoneNames)
    existingZoneNames.add(name)
    const clone: SceneZoneEntity = {
      kind: 'zone',
      name,
      locked: false,
      zoneType: zone.zoneType,
      points: translateZonePoints(zone, delta),
      rotationDeg: zone.rotationDeg,
      fillColor: zone.fillColor,
      notes: null,
    }
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.id }), clone.name)
    return clone
  })

  const annotations = source.annotations.map((annotation): SceneAnnotationEntity => {
    const clone: SceneAnnotationEntity = {
      kind: 'annotation',
      id: createUuid(),
      locked: false,
      annotationType: annotation.annotationType,
      position: translatePoint(annotation.position, delta),
      text: annotation.text,
      fontSize: annotation.fontSize,
      rotationDeg: annotation.rotationDeg,
    }
    sourceToCloneId.set(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }), clone.id)
    return clone
  })

  const groupedMemberKeys = new Set<string>()
  const groups = source.groups
    .map((group): SceneObjectGroupEntity | null => {
      const members = group.members
        .map((member): SceneObjectGroupMember | null => {
          const cloneId = sourceToCloneId.get(sceneObjectGroupMemberKey(member))
          return cloneId ? { kind: member.kind, id: cloneId } : null
        })
        .filter((member): member is SceneObjectGroupMember => member !== null)
      if (members.length < 2) return null
      for (const member of members) {
        groupedMemberKeys.add(sceneObjectGroupMemberKey(member))
      }
      return {
        kind: 'group',
        id: createUuid(),
        locked: false,
        name: group.name,
        members,
      }
    })
    .filter((group): group is SceneObjectGroupEntity => group !== null)

  draft.plants = [...draft.plants, ...plants]
  draft.zones = [...draft.zones, ...zones]
  draft.annotations = [...draft.annotations, ...annotations]
  draft.groups = [...draft.groups, ...groups]

  return {
    selection: selectedTopLevelIds(plants, zones, annotations, groups, groupedMemberKeys),
  }
}

function selectedTopLevelIds(
  plants: readonly ScenePlantEntity[],
  zones: readonly SceneZoneEntity[],
  annotations: readonly SceneAnnotationEntity[],
  groups: readonly SceneObjectGroupEntity[],
  groupedMemberKeys: ReadonlySet<string>,
): string[] {
  const selection = groups.map((group) => group.id)
  for (const plant of plants) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'plant', id: plant.id }))) {
      selection.push(plant.id)
    }
  }
  for (const zone of zones) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'zone', id: zone.name }))) {
      selection.push(zone.name)
    }
  }
  for (const annotation of annotations) {
    if (!groupedMemberKeys.has(sceneObjectGroupMemberKey({ kind: 'annotation', id: annotation.id }))) {
      selection.push(annotation.id)
    }
  }
  return selection
}

function canPlaceSavedObjectStamp(scene: ScenePersistedState, source: SavedObjectStampPayload): boolean {
  if (source.plants.length + source.zones.length + source.annotations.length === 0) return false
  return requiredLayers(source).every((layerName) => isSceneLayerOpenForCreation(scene, layerName))
}

function requiredLayers(source: SavedObjectStampPayload): SceneCreationLayerName[] {
  const layers: SceneCreationLayerName[] = []
  if (source.plants.length > 0) layers.push('plants')
  if (source.zones.length > 0) layers.push('zones')
  if (source.annotations.length > 0) layers.push('annotations')
  return layers
}

function showSavedObjectStampGhosts(
  context: SavedObjectStampToolContext,
  source: SavedObjectStampPayload,
  delta: ScenePoint,
): void {
  const preview = context.preview
  preview.replaceChildren()
  Object.assign(preview.style, {
    display: 'block',
    left: '0',
    top: '0',
    width: '0',
    height: '0',
    border: '0',
    borderRadius: '0',
    background: 'transparent',
    transform: 'none',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    zIndex: '2',
  })

  const plantContext = context.getPlantPresentationContext(context.camera.viewport.scale)
  for (const plant of source.plants) {
    const ghostPlant = scenePlantFromSavedPlant(plant, delta)
    const bounds = getPlantWorldBounds(ghostPlant, plantContext)
    const ghost = document.createElement('div')
    ghost.dataset.savedObjectStampGhost = 'plant'
    Object.assign(ghost.style, {
      position: 'absolute',
      borderRadius: '50%',
      border: '1px solid var(--canvas-selection-stroke)',
      background: ghostPlant.color ?? 'var(--canvas-selection)',
      opacity: '0.38',
    })
    positionGhost(context, ghost, bounds)
    preview.appendChild(ghost)
  }

  for (const zone of source.zones) {
    const ghostZone = sceneZoneFromSavedZone(zone, delta)
    const bounds = getZoneWorldBounds(ghostZone)
    if (!bounds) continue
    const ghost = document.createElement('div')
    ghost.dataset.savedObjectStampGhost = 'zone'
    Object.assign(ghost.style, {
      position: 'absolute',
      border: '1px solid var(--canvas-selection-stroke)',
      borderRadius: ghostZone.zoneType === 'ellipse' ? '50%' : '0',
      background: ghostZone.fillColor ?? 'var(--canvas-selection)',
      opacity: '0.28',
    })
    positionGhost(context, ghost, bounds)
    preview.appendChild(ghost)
  }

  for (const annotation of source.annotations) {
    const ghostAnnotation = sceneAnnotationFromSavedAnnotation(annotation, delta)
    const bounds = getAnnotationWorldBounds(ghostAnnotation, context.camera.viewport.scale)
    const ghost = document.createElement('div')
    ghost.dataset.savedObjectStampGhost = 'annotation'
    ghost.textContent = ghostAnnotation.text
    Object.assign(ghost.style, {
      position: 'absolute',
      color: 'var(--canvas-annotation-text)',
      fontSize: `${Math.max(8, ghostAnnotation.fontSize * context.camera.viewport.scale)}px`,
      lineHeight: '1.2',
      opacity: '0.42',
      whiteSpace: 'pre',
    })
    positionGhost(context, ghost, bounds)
    preview.appendChild(ghost)
  }
}

function hideSavedObjectStampGhosts(preview: HTMLElement): void {
  preview.replaceChildren()
  preview.style.display = 'none'
}

function positionGhost(
  context: SavedObjectStampToolContext,
  ghost: HTMLElement,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const start = context.camera.worldToScreen({ x: bounds.x, y: bounds.y })
  const end = context.camera.worldToScreen({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  Object.assign(ghost.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${Math.max(1, Math.abs(end.x - start.x))}px`,
    height: `${Math.max(1, Math.abs(end.y - start.y))}px`,
  })
}

function scenePlantFromSavedPlant(
  plant: SavedObjectStampPayload['plants'][number],
  delta: ScenePoint,
): ScenePlantEntity {
  return {
    kind: 'plant',
    id: plant.id,
    locked: false,
    canonicalName: plant.canonicalName,
    commonName: plant.commonName,
    color: plant.color,
    symbol: plant.symbol ?? null,
    stratum: null,
    canopySpreadM: plant.scale,
    position: translatePoint(plant.position, delta),
    rotationDeg: plant.rotationDeg,
    scale: plant.scale,
    notes: null,
    plantedDate: null,
    quantity: null,
  }
}

function sceneZoneFromSavedZone(
  zone: SavedObjectStampPayload['zones'][number],
  delta: ScenePoint,
): SceneZoneEntity {
  return {
    kind: 'zone',
    name: zone.name,
    locked: false,
    zoneType: zone.zoneType,
    points: translateZonePoints(zone, delta),
    rotationDeg: zone.rotationDeg,
    fillColor: zone.fillColor,
    notes: null,
  }
}

function sceneAnnotationFromSavedAnnotation(
  annotation: SavedObjectStampPayload['annotations'][number],
  delta: ScenePoint,
): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id: annotation.id,
    locked: false,
    annotationType: annotation.annotationType,
    position: translatePoint(annotation.position, delta),
    text: annotation.text,
    fontSize: annotation.fontSize,
    rotationDeg: annotation.rotationDeg,
  }
}

function stampDelta(source: SavedObjectStampPayload, anchorWorld: ScenePoint): ScenePoint {
  return {
    x: anchorWorld.x - source.anchor.x,
    y: anchorWorld.y - source.anchor.y,
  }
}

function translatePoint(point: ScenePoint, delta: ScenePoint): ScenePoint {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  }
}

function translateZonePoints(
  zone: Pick<SavedObjectStampPayload['zones'][number], 'zoneType' | 'points'>,
  delta: ScenePoint,
): ScenePoint[] {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    return [
      translatePoint(zone.points[0]!, delta),
      { ...zone.points[1]! },
    ]
  }
  return zone.points.map((point) => translatePoint(point, delta))
}

function uniqueZoneName(baseName: string, existingNames: Set<string>): string {
  if (!existingNames.has(baseName)) return baseName
  let index = 2
  let candidate = `${baseName} copy`
  while (existingNames.has(candidate)) {
    candidate = `${baseName} copy ${index}`
    index += 1
  }
  return candidate
}
