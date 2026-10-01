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
import type { WorkspaceCameraFrameReader } from '../camera'
import type { PlantPresentationContext } from '../plant-presentation'
import type { SpeciesCacheEntry } from '../species-cache'
import {
  createSceneArrangementPlacement,
  type SceneArrangementTemplate,
  translatePoint,
  translateZonePoints,
} from '../scene-runtime/arrangement-placement'
import type { SceneEditCoordinator } from '../scene-runtime/transactions'
import { hitTestTopLevel } from '../tools/hit-testing'
import { isEditableTarget } from './pointer-utils'
import { clearSavedObjectStampGhosts, showStampGhosts } from './saved-object-stamp-tool'
import {
  rotateArrangementTemplate,
  rotateStampEntities,
  stampRotationStep,
  turnStampRotation,
  type StampEntities,
  type StampRotationKeys,
} from './stamp-rotation'
import type { SceneToolAdapter } from './tool-adapter'
import type { CanvasStampGuidance } from '../../session-state'

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
  readonly camera: WorkspaceCameraFrameReader
  readonly getSceneStore: () => SceneStateReader
  readonly getLocalizedCommonNames: () => ReadonlyMap<string, string | null>
  readonly getSpeciesCache: () => ReadonlyMap<string, SpeciesCacheEntry>
  readonly getPlantPresentationContext: (viewportScale: number) => PlantPresentationContext
  readonly sceneEdits: SceneEditCoordinator
  readonly applySnapping: (point: ScenePoint) => ScenePoint
}

export interface ObjectStampTool {
  readonly hasSource: () => boolean
  /** The picked object as the tool card names it, or null before a pick. */
  readonly describeSource: () => CanvasStampGuidance | null
  /** The held stamp's angle in degrees, clockwise; 0 for a new pick. */
  readonly rotationDeg: () => number
  /** Turns the held stamp and its preview by `degrees`. */
  readonly rotateBy: (degrees: number) => void
  readonly pointerDown: (world: ScenePoint) => void
  readonly updatePreview: (world: ScenePoint) => void
  readonly clear: () => void
  readonly dispose: () => void
}

export function createObjectStampTool(context: ObjectStampToolContext): ObjectStampTool {
  const arrangementPlacement = createSceneArrangementPlacement({ sceneEdits: context.sceneEdits })
  let objectStampSource: ObjectStampSource | null = null
  let rotationDeg = 0
  let lastPreviewWorld: ScenePoint | null = null

  function pointerDown(world: ScenePoint): void {
    if (!objectStampSource) {
      sampleObjectStampSource(world)
      return
    }

    placeObjectStamp(context.applySnapping(world))
  }

  function sampleObjectStampSource(world: ScenePoint): void {
    rotationDeg = 0
    const scene = context.getSceneStore().persisted
    const hit = hitTestTopLevel(
      scene,
      world,
      context.camera.viewport.scale,
      context.getSpeciesCache(),
      context.getPlantPresentationContext,
      context.getSceneStore().session.selectedTargets,
      context.getSceneStore().session.hoveredTarget,
    )
    if (!hit || isSceneDesignObjectLocked(scene, hit)) return

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
      const zone = scene.zones.find((entry) => entry.id === hit.id)
      if (!zone) return

      objectStampSource = {
        kind: 'zone',
        sourceId: zone.id,
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
      template: rotateArrangementTemplate(objectStampArrangementTemplate(source), source.anchorWorld, rotationDeg),
      translateBy: objectStampDelta(source, anchorWorld),
      historyType: 'interaction-object-stamp',
      onCommitted: () => previewAtAnchor(anchorWorld),
    })
  }

  function canUseObjectStampSource(source: ObjectStampSource): boolean {
    const scene = context.getSceneStore().persisted
    if (isSceneDesignObjectLocked(scene, { kind: source.kind, id: source.sourceId })) return false
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

  function rotateBy(degrees: number): void {
    if (!objectStampSource) return
    rotationDeg = turnStampRotation(rotationDeg, degrees)
    if (lastPreviewWorld) previewAtAnchor(lastPreviewWorld)
  }

  /** Ghosts of what a click would place, the stamp's anchor under the pointer, turned by the held angle. */
  function previewAtAnchor(anchorWorld: ScenePoint): void {
    lastPreviewWorld = anchorWorld
    const source = objectStampSource
    if (!source) {
      clearSavedObjectStampGhosts(context.preview)
      return
    }
    const entities = objectStampEntities(source, objectStampDelta(source, anchorWorld))
    showStampGhosts(context, rotateStampEntities(entities, anchorWorld, rotationDeg))
  }

  function clear(): void {
    objectStampSource = null
    rotationDeg = 0
    lastPreviewWorld = null
    clearSavedObjectStampGhosts(context.preview)
  }

  function describeSource(): CanvasStampGuidance | null {
    const source = objectStampSource
    if (!source) return null
    const plantName = (plant: ScenePlantEntity): string =>
      context.getLocalizedCommonNames().get(plant.canonicalName) ?? plant.commonName ?? plant.canonicalName
    if (source.kind === 'plant') {
      return { kind: 'plant', name: plantName(source.plant), plants: 1, species: 1 }
    }
    if (source.kind === 'group') {
      return {
        kind: 'group',
        name: source.group.name?.trim() || null,
        plants: source.plants.length,
        species: new Set(source.plants.map((plant) => plant.canonicalName)).size,
      }
    }
    return { kind: source.kind, name: null, plants: 0, species: 0 }
  }

  return {
    hasSource: () => objectStampSource !== null,
    describeSource,
    rotationDeg: () => rotationDeg,
    rotateBy,
    pointerDown,
    updatePreview,
    clear,
    dispose: clear,
  }
}

export interface ObjectStampToolAdapterContext {
  readonly switchTool: (name: string) => void
  readonly rotationKeys: StampRotationKeys
}

export function createObjectStampToolAdapter(
  tool: ObjectStampTool,
  context: ObjectStampToolAdapterContext,
): SceneToolAdapter {
  return {
    onDeactivate: tool.clear,
    shouldSuppressHover: tool.hasSource,
    describeGuidance: () => ({
      stamp: tool.describeSource(),
      stampRotationDeg: tool.hasSource() ? tool.rotationDeg() : null,
    }),
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
      const step = tool.hasSource() ? stampRotationStep(event, context.rotationKeys) : null
      if (step !== null) {
        // `[` and `]` otherwise send to back and bring to front; while a stamp is held they only turn it.
        event.preventDefault()
        event.stopPropagation()
        tool.rotateBy(step)
        return true
      }
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

    const zone = member.kind === 'zone' ? scene.zones.find((entry) => entry.id === member.id) : null
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
      sourceId: zone.id,
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


/** The stamp's objects moved by `delta`, as placement would add them. */
function objectStampEntities(source: ObjectStampSource, delta: ScenePoint): StampEntities {
  const plant = (entry: ScenePlantEntity): ScenePlantEntity => ({
    ...clonePlantForObjectStamp(entry),
    position: translatePoint(entry.position, delta),
  })
  const zone = (entry: SceneZoneEntity): SceneZoneEntity => ({
    ...cloneZoneForObjectStamp(entry),
    points: translateZonePoints(entry, delta),
  })
  const annotation = (entry: SceneAnnotationEntity): SceneAnnotationEntity => ({
    ...cloneAnnotationForObjectStamp(entry),
    position: translatePoint(entry.position, delta),
  })
  if (source.kind === 'plant') return { plants: [plant(source.plant)], zones: [], annotations: [] }
  if (source.kind === 'zone') return { plants: [], zones: [zone(source.zone)], annotations: [] }
  if (source.kind === 'annotation') return { plants: [], zones: [], annotations: [annotation(source.annotation)] }
  return {
    plants: source.plants.map(plant),
    zones: source.zones.map(zone),
    annotations: source.annotations.map(annotation),
  }
}
