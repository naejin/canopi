import { createUuid } from '../../../utils/ids'
import { getAnnotationWorldBounds } from '../annotation-layout'
import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneStore,
  SceneZoneEntity,
} from '../scene'
import { isSceneDesignObjectLocked } from '../scene'
import type { CameraController } from '../camera'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from '../plant-presentation'
import type { SpeciesCacheEntry } from '../species-cache'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { hitTestTopLevel } from './hit-testing'
import {
  hideInteractionPreview,
  showInteractionPreview,
} from './overlay-ui'
import { isEditableTarget } from './pointer-utils'
import type { SceneToolAdapter } from './tool-adapter'

interface ObjectStampPlantSource {
  kind: 'plant'
  sourceId: string
  plant: ScenePlantEntity
  anchorWorld: ScenePoint
}

interface ObjectStampZoneSource {
  kind: 'zone'
  sourceId: string
  zone: SceneZoneEntity
  anchorWorld: ScenePoint
}

interface ObjectStampAnnotationSource {
  kind: 'annotation'
  sourceId: string
  annotation: SceneAnnotationEntity
  anchorWorld: ScenePoint
}

interface ObjectStampGroupSource {
  kind: 'group'
  sourceId: string
  group: SceneObjectGroupEntity
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  anchorWorld: ScenePoint
}

type ObjectStampSource =
  | ObjectStampPlantSource
  | ObjectStampZoneSource
  | ObjectStampAnnotationSource
  | ObjectStampGroupSource

export interface ObjectStampToolContext {
  readonly preview: HTMLDivElement
  readonly camera: CameraController
  readonly getSceneStore: () => SceneStore
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

export interface ObjectStampTool {
  readonly hasSource: () => boolean
  readonly pointerDown: (world: ScenePoint) => void
  readonly updatePreview: (world: ScenePoint) => void
  readonly clear: () => void
  readonly dispose: () => void
}

export function createObjectStampTool(context: ObjectStampToolContext): ObjectStampTool {
  let objectStampSource: ObjectStampSource | null = null

  function pointerDown(world: ScenePoint): void {
    if (!objectStampSource) {
      sampleObjectStampSource(world)
      return
    }

    placeObjectStamp(context.applySnapping(world))
  }

  function sampleObjectStampSource(world: ScenePoint): void {
    const scene = context.getSceneStore().persisted
    const hit = hitTestTopLevel(
      scene,
      world,
      context.camera.viewport.scale,
      context.getSpeciesCache(),
      context.getPlantPresentationContext,
    )
    if (!hit || isSceneDesignObjectLocked(scene, hit.id)) return

    if (hit.kind === 'plant') {
      const plant = scene.plants.find((entry) => entry.id === hit.id)
      if (!plant) return

      objectStampSource = {
        kind: 'plant',
        sourceId: plant.id,
        plant: clonePlantForObjectStamp(plant),
        anchorWorld: { ...world },
      }
      previewAtAnchor(world)
      return
    }

    if (hit.kind === 'zone') {
      const zone = scene.zones.find((entry) => entry.name === hit.id)
      if (!zone) return

      objectStampSource = {
        kind: 'zone',
        sourceId: zone.name,
        zone: cloneZoneForObjectStamp(zone),
        anchorWorld: { ...world },
      }
      previewAtAnchor(world)
      return
    }

    if (hit.kind === 'annotation') {
      const annotation = scene.annotations.find((entry) => entry.id === hit.id)
      if (!annotation) return

      objectStampSource = {
        kind: 'annotation',
        sourceId: annotation.id,
        annotation: cloneAnnotationForObjectStamp(annotation),
        anchorWorld: { ...world },
      }
      previewAtAnchor(world)
      return
    }

    if (hit.kind === 'group') {
      const group = scene.groups.find((entry) => entry.id === hit.id)
      if (!group) return
      const members = cloneGroupMembersForObjectStamp(group, scene)
      if (members.plants.length + members.zones.length + members.annotations.length === 0) return

      objectStampSource = {
        kind: 'group',
        sourceId: group.id,
        group: cloneGroupForObjectStamp(group),
        plants: members.plants,
        zones: members.zones,
        annotations: members.annotations,
        anchorWorld: { ...world },
      }
      previewAtAnchor(world)
    }
  }

  function placeObjectStamp(anchorWorld: ScenePoint): void {
    const source = objectStampSource
    if (!source || !canUseObjectStampSource(source)) return
    const delta = objectStampDelta(source, anchorWorld)

    if (source.kind === 'plant') {
      let nextId = ''
      const committed = context.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const clone = clonePlantForObjectStamp(source.plant)
          clone.id = createUuid()
          clone.position = translatePoint(source.plant.position, delta)
          draft.plants = [...draft.plants, clone]
          nextId = clone.id
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) previewAtAnchor(anchorWorld)
      return
    }

    if (source.kind === 'zone') {
      let nextId = ''
      const committed = context.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const clone = cloneZoneForObjectStamp(source.zone)
          clone.name = uniqueZoneName(source.zone.name, new Set(draft.zones.map((zone) => zone.name)))
          clone.points = translateZonePoints(source.zone, delta)
          draft.zones = [...draft.zones, clone]
          nextId = clone.name
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) previewAtAnchor(anchorWorld)
      return
    }

    if (source.kind === 'annotation') {
      let nextId = ''
      const committed = context.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const clone = cloneAnnotationForObjectStamp(source.annotation)
          clone.id = createUuid()
          clone.position = translatePoint(source.annotation.position, delta)
          draft.annotations = [...draft.annotations, clone]
          nextId = clone.id
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) previewAtAnchor(anchorWorld)
      return
    }

    if (source.kind === 'group') {
      let nextId = ''
      const committed = context.sceneEdits.run('interaction-object-stamp', (tx) => {
        tx.mutate((draft) => {
          const sourceToCloneId = new Map<string, string>()
          const existingZoneNames = new Set(draft.zones.map((zone) => zone.name))

          const clonedPlants = source.plants.map((plant) => {
            const clone = clonePlantForObjectStamp(plant)
            clone.id = createUuid()
            clone.position = translatePoint(plant.position, delta)
            sourceToCloneId.set(plant.id, clone.id)
            return clone
          })

          const clonedZones = source.zones.map((zone) => {
            const clone = cloneZoneForObjectStamp(zone)
            clone.name = uniqueZoneName(zone.name, existingZoneNames)
            existingZoneNames.add(clone.name)
            clone.points = translateZonePoints(zone, delta)
            sourceToCloneId.set(zone.name, clone.name)
            return clone
          })

          const clonedAnnotations = source.annotations.map((annotation) => {
            const clone = cloneAnnotationForObjectStamp(annotation)
            clone.id = createUuid()
            clone.position = translatePoint(annotation.position, delta)
            sourceToCloneId.set(annotation.id, clone.id)
            return clone
          })

          const memberIds = source.group.memberIds
            .map((memberId) => sourceToCloneId.get(memberId) ?? null)
            .filter((memberId): memberId is string => memberId !== null)
          if (memberIds.length === 0) return

          const cloneGroup = cloneGroupForObjectStamp(source.group)
          cloneGroup.id = createUuid()
          cloneGroup.position = translatePoint(source.group.position, delta)
          cloneGroup.memberIds = memberIds

          draft.plants = [...draft.plants, ...clonedPlants]
          draft.zones = [...draft.zones, ...clonedZones]
          draft.annotations = [...draft.annotations, ...clonedAnnotations]
          draft.groups = [...draft.groups, cloneGroup]
          nextId = cloneGroup.id
        })
        if (nextId) tx.setSelection([nextId])
      })
      if (committed) previewAtAnchor(anchorWorld)
    }
  }

  function canUseObjectStampSource(source: ObjectStampSource): boolean {
    const scene = context.getSceneStore().persisted
    if (isSceneDesignObjectLocked(scene, source.sourceId)) return false
    if (source.kind === 'plant') {
      const layer = scene.layers.find((entry) => entry.name === 'plants')
      return layer?.visible !== false && layer?.locked !== true
    }
    if (source.kind === 'zone') {
      const layer = scene.layers.find((entry) => entry.name === 'zones')
      return layer?.visible !== false && layer?.locked !== true
    }
    if (source.kind === 'annotation') {
      const layer = scene.layers.find((entry) => entry.name === 'annotations')
      return layer?.visible !== false && layer?.locked !== true
    }
    if (source.kind === 'group') {
      const layer = scene.layers.find((entry) => entry.name === source.group.layer)
      return layer?.visible !== false && layer?.locked !== true
    }
    return false
  }

  function updatePreview(world: ScenePoint): void {
    previewAtAnchor(context.applySnapping(world))
  }

  function previewAtAnchor(anchorWorld: ScenePoint): void {
    const source = objectStampSource
    if (!source) {
      hideInteractionPreview(context.preview)
      return
    }

    if (source.kind === 'plant') {
      const delta = objectStampDelta(source, anchorWorld)
      const previewPlant = clonePlantForObjectStamp(source.plant)
      previewPlant.position = translatePoint(source.plant.position, delta)
      const bounds = getPlantWorldBounds(
        previewPlant,
        context.getPlantPresentationContext(context.camera.viewport.scale),
      )
      showInteractionPreview(
        context.preview,
        'ellipse',
        context.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        context.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
      return
    }

    if (source.kind === 'zone') {
      const previewZone = cloneZoneForObjectStamp(source.zone)
      previewZone.points = translateZonePoints(source.zone, objectStampDelta(source, anchorWorld))
      if (previewZone.zoneType === 'line' && previewZone.points.length >= 2) {
        showInteractionPreview(
          context.preview,
          'line',
          context.camera.worldToScreen(previewZone.points[0]!),
          context.camera.worldToScreen(previewZone.points[1]!),
        )
        return
      }
      const bounds = zoneWorldBounds(previewZone)
      if (!bounds) {
        hideInteractionPreview(context.preview)
        return
      }
      showInteractionPreview(
        context.preview,
        previewZone.zoneType === 'ellipse' ? 'ellipse' : 'rectangle',
        context.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        context.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
      return
    }

    if (source.kind === 'annotation') {
      const previewAnnotation = cloneAnnotationForObjectStamp(source.annotation)
      previewAnnotation.position = translatePoint(
        source.annotation.position,
        objectStampDelta(source, anchorWorld),
      )
      const bounds = getAnnotationWorldBounds(previewAnnotation, context.camera.viewport.scale)
      showInteractionPreview(
        context.preview,
        'rectangle',
        context.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        context.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
      return
    }

    if (source.kind === 'group') {
      const bounds = objectStampGroupBounds(
        source,
        objectStampDelta(source, anchorWorld),
        context.camera.viewport.scale,
        context.getPlantPresentationContext(context.camera.viewport.scale),
      )
      if (!bounds) {
        hideInteractionPreview(context.preview)
        return
      }
      showInteractionPreview(
        context.preview,
        'rectangle',
        context.camera.worldToScreen({ x: bounds.x, y: bounds.y }),
        context.camera.worldToScreen({
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        }),
      )
    }
  }

  function clear(): void {
    objectStampSource = null
    hideInteractionPreview(context.preview)
  }

  return {
    hasSource: () => objectStampSource !== null,
    pointerDown,
    updatePreview,
    clear,
    dispose: clear,
  }
}

export interface ObjectStampToolAdapterContext {
  readonly switchTool: (name: string) => void
}

export function createObjectStampToolAdapter(
  tool: ObjectStampTool,
  context: ObjectStampToolAdapterContext,
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
      context.switchTool('select')
      return true
    },
    dispose: tool.dispose,
  }
}

function clonePlantForObjectStamp(plant: ScenePlantEntity): ScenePlantEntity {
  return {
    ...plant,
    position: { ...plant.position },
  }
}

function cloneZoneForObjectStamp(zone: SceneZoneEntity): SceneZoneEntity {
  return {
    ...zone,
    points: zone.points.map((point) => ({ ...point })),
  }
}

function cloneAnnotationForObjectStamp(annotation: SceneAnnotationEntity): SceneAnnotationEntity {
  return {
    ...annotation,
    position: { ...annotation.position },
  }
}

function cloneGroupForObjectStamp(group: SceneObjectGroupEntity): SceneObjectGroupEntity {
  return {
    ...group,
    position: { ...group.position },
    memberIds: [...group.memberIds],
  }
}

function cloneGroupMembersForObjectStamp(
  group: SceneObjectGroupEntity,
  scene: ScenePersistedState,
): Pick<ObjectStampGroupSource, 'plants' | 'zones' | 'annotations'> {
  const plants: ScenePlantEntity[] = []
  const zones: SceneZoneEntity[] = []
  const annotations: SceneAnnotationEntity[] = []

  for (const memberId of group.memberIds) {
    const plant = scene.plants.find((entry) => entry.id === memberId)
    if (plant) {
      plants.push(clonePlantForObjectStamp(plant))
      continue
    }

    const zone = scene.zones.find((entry) => entry.name === memberId)
    if (zone) {
      zones.push(cloneZoneForObjectStamp(zone))
      continue
    }

    const annotation = scene.annotations.find((entry) => entry.id === memberId)
    if (annotation) annotations.push(cloneAnnotationForObjectStamp(annotation))
  }

  return { plants, zones, annotations }
}

function objectStampDelta(source: ObjectStampSource, anchorWorld: ScenePoint): ScenePoint {
  return {
    x: anchorWorld.x - source.anchorWorld.x,
    y: anchorWorld.y - source.anchorWorld.y,
  }
}

function translatePoint(point: ScenePoint, delta: ScenePoint): ScenePoint {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  }
}

function translateZonePoints(zone: SceneZoneEntity, delta: ScenePoint): ScenePoint[] {
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

function zoneWorldBounds(zone: SceneZoneEntity): { x: number; y: number; width: number; height: number } | null {
  if (zone.zoneType === 'ellipse' && zone.points.length >= 2) {
    const center = zone.points[0]!
    const radii = zone.points[1]!
    return {
      x: center.x - radii.x,
      y: center.y - radii.y,
      width: radii.x * 2,
      height: radii.y * 2,
    }
  }

  if (zone.points.length === 0) return null
  const xs = zone.points.map((point) => point.x)
  const ys = zone.points.map((point) => point.y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

function objectStampGroupBounds(
  source: ObjectStampGroupSource,
  delta: ScenePoint,
  viewportScale: number,
  plantContext: PlantPresentationContext,
): { x: number; y: number; width: number; height: number } | null {
  const bounds: Array<{ x: number; y: number; width: number; height: number }> = []

  for (const plant of source.plants) {
    const previewPlant = clonePlantForObjectStamp(plant)
    previewPlant.position = translatePoint(plant.position, delta)
    bounds.push(getPlantWorldBounds(previewPlant, plantContext))
  }

  for (const zone of source.zones) {
    const previewZone = cloneZoneForObjectStamp(zone)
    previewZone.points = translateZonePoints(zone, delta)
    const zoneBounds = zoneWorldBounds(previewZone)
    if (zoneBounds) bounds.push(zoneBounds)
  }

  for (const annotation of source.annotations) {
    const previewAnnotation = cloneAnnotationForObjectStamp(annotation)
    previewAnnotation.position = translatePoint(annotation.position, delta)
    bounds.push(getAnnotationWorldBounds(previewAnnotation, viewportScale))
  }

  if (bounds.length === 0) return null
  const minX = Math.min(...bounds.map((entry) => entry.x))
  const minY = Math.min(...bounds.map((entry) => entry.y))
  const maxX = Math.max(...bounds.map((entry) => entry.x + entry.width))
  const maxY = Math.max(...bounds.map((entry) => entry.y + entry.height))
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
