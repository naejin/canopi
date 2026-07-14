import { getAnnotationWorldBounds } from '../annotation-layout'
import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  ScenePoint,
  SceneStateReader,
  SceneZoneEntity,
} from '../scene'
import {
  cloneSceneObjectGroupMembers,
  isSceneDesignObjectLocked,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberLayerName,
} from '../scene'
import type { CameraController } from '../camera'
import {
  getPlantWorldBounds,
  type PlantPresentationContext,
} from '../plant-presentation'
import { getZoneWorldBounds } from '../zone-geometry'
import type { SpeciesCacheEntry } from '../species-cache'
import {
  createSceneArrangementPlacement,
  type SceneArrangementTemplate,
} from '../scene-runtime/arrangement-placement'
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
  readonly getSceneStore: () => SceneStateReader
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
  const arrangementPlacement = createSceneArrangementPlacement({ sceneEdits: context.sceneEdits })
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
    arrangementPlacement.place({
      template: objectStampArrangementTemplate(source),
      translateBy: objectStampDelta(source, anchorWorld),
      historyType: 'interaction-object-stamp',
      onCommitted: () => previewAtAnchor(anchorWorld),
    })
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
      const members = resolveSceneObjectGroupMembers(scene, source.group)
      return members.length > 0
        && members.every((member) => {
          const layer = scene.layers.find((entry) => entry.name === sceneObjectGroupMemberLayerName(member))
          return layer?.visible !== false && layer?.locked !== true
        })
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
      const bounds = getZoneWorldBounds(previewZone)
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
    pinnedName: false,
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
    members: cloneSceneObjectGroupMembers(group.members),
  }
}

function cloneGroupMembersForObjectStamp(
  group: SceneObjectGroupEntity,
  scene: ScenePersistedState,
): Pick<ObjectStampGroupSource, 'plants' | 'zones' | 'annotations'> {
  const plants: ScenePlantEntity[] = []
  const zones: SceneZoneEntity[] = []
  const annotations: SceneAnnotationEntity[] = []

  for (const member of resolveSceneObjectGroupMembers(scene, group)) {
    const plant = member.kind === 'plant' ? scene.plants.find((entry) => entry.id === member.id) : null
    if (plant) {
      plants.push(clonePlantForObjectStamp(plant))
      continue
    }

    const zone = member.kind === 'zone' ? scene.zones.find((entry) => entry.name === member.id) : null
    if (zone) {
      zones.push(cloneZoneForObjectStamp(zone))
      continue
    }

    const annotation = member.kind === 'annotation'
      ? scene.annotations.find((entry) => entry.id === member.id)
      : null
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

function objectStampArrangementTemplate(source: ObjectStampSource): SceneArrangementTemplate {
  if (source.kind === 'plant') {
    return emptySceneArrangementTemplate({
      plants: [{ sourceId: source.sourceId, entity: clonePlantForObjectStamp(source.plant) }],
    })
  }
  if (source.kind === 'zone') {
    return emptySceneArrangementTemplate({
      zones: [{ sourceId: source.sourceId, entity: cloneZoneForObjectStamp(source.zone) }],
    })
  }
  if (source.kind === 'annotation') {
    return emptySceneArrangementTemplate({
      annotations: [{
        sourceId: source.sourceId,
        entity: cloneAnnotationForObjectStamp(source.annotation),
      }],
    })
  }
  return {
    plants: source.plants.map((plant) => ({
      sourceId: plant.id,
      entity: clonePlantForObjectStamp(plant),
    })),
    zones: source.zones.map((zone) => ({
      sourceId: zone.name,
      entity: cloneZoneForObjectStamp(zone),
    })),
    annotations: source.annotations.map((annotation) => ({
      sourceId: annotation.id,
      entity: cloneAnnotationForObjectStamp(annotation),
    })),
    measurementGuides: [],
    groups: [{
      sourceId: source.sourceId,
      entity: cloneGroupForObjectStamp(source.group),
    }],
  }
}

function emptySceneArrangementTemplate(
  entries: Partial<SceneArrangementTemplate>,
): SceneArrangementTemplate {
  return {
    plants: entries.plants ?? [],
    zones: entries.zones ?? [],
    annotations: entries.annotations ?? [],
    measurementGuides: entries.measurementGuides ?? [],
    groups: entries.groups ?? [],
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
    const zoneBounds = getZoneWorldBounds(previewZone)
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
