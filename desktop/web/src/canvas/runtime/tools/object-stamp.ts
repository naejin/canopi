// canvas/runtime/tools/object-stamp.ts
//
// Owns the Object stamp (K, spec §3.2). The first press on a plant, zone, note or group copies it: the pick, anchored where
// it was pressed (today's hitTestTopLevel: guides and object-locked objects are not picked, a group needs a member). Every
// later press places the pick with that anchor at the snapped point, turned by the held angle, as one
// 'interaction-object-stamp' edit that selects the copies, while the source is still unlocked on open layers. The ghost of
// what a press would place follows the pointer from the pick on and stays when the pointer leaves the map; the tool card
// names the pick. A pick starts level (today's rule; phase 1 starts it at the bearing); `[` and `]` turn it (rotate-held
// commands); Esc leaves for Select at once under LEGACY (spec §3.7).

import type { CanvasStampGuidance } from '../../session-state'
import type { SceneDesignObjectTarget } from '../scene/design-object-targets'
import {
  cloneSceneObjectGroupMembers,
  resolveSceneObjectGroupMembers,
  sceneObjectGroupMemberLayerName,
} from '../scene/group-members'
import { isSceneDesignObjectLocked } from '../scene/locks'
import type {
  SceneAnnotationEntity,
  SceneObjectGroupEntity,
  ScenePersistedState,
  ScenePlantEntity,
  SceneZoneEntity,
} from '../scene/types'
import {
  createSceneArrangementPlacement,
  type SceneArrangementPlacement,
  type SceneArrangementTemplate,
  translatePoint,
  translateZonePoints,
} from '../scene-runtime/arrangement-placement'
import type { WorldPoint } from '../view/types'
import { stampGhostShapes } from './saved-object-stamp'
import {
  rotateArrangementTemplate,
  rotateStampEntities,
  turnStampRotation,
  type StampEntities,
} from './stamp-rotation'
import type { CanvasTool, ToolContext } from './tool'

interface ObjectStampPlantSource {
  kind: 'plant'
  sourceId: string
  plant: ScenePlantEntity
  anchorWorld: WorldPoint
}

interface ObjectStampZoneSource {
  kind: 'zone'
  sourceId: string
  zone: SceneZoneEntity
  anchorWorld: WorldPoint
}

interface ObjectStampAnnotationSource {
  kind: 'annotation'
  sourceId: string
  annotation: SceneAnnotationEntity
  anchorWorld: WorldPoint
}

interface ObjectStampGroupSource {
  kind: 'group'
  sourceId: string
  group: SceneObjectGroupEntity
  plants: ScenePlantEntity[]
  zones: SceneZoneEntity[]
  annotations: SceneAnnotationEntity[]
  anchorWorld: WorldPoint
}

type ObjectStampSource =
  | ObjectStampPlantSource
  | ObjectStampZoneSource
  | ObjectStampAnnotationSource
  | ObjectStampGroupSource

/** The layer a single picked object is placed on. */
const SOURCE_LAYER = { plant: 'plants', zone: 'zones', annotation: 'annotations' } as const

export function createObjectStampTool(): CanvasTool {
  let ctx: ToolContext | null = null
  let placement: SceneArrangementPlacement | null = null
  let objectStampSource: ObjectStampSource | null = null
  let rotationDeg = 0
  /** Where the ghost's anchor was last drawn: `[` and `]` redraw it there. */
  let lastAnchor: WorldPoint | null = null

  function context(): ToolContext {
    if (!ctx) throw new Error('The Object stamp is not active.')
    return ctx
  }

  function sampleObjectStampSource(world: WorldPoint): void {
    rotationDeg = 0
    const { scene } = context()
    const hit = scene.hitAt(world)
    if (hit?.kind !== 'object') return
    const persisted = scene.persisted
    if (isSceneDesignObjectLocked(persisted, hit.target)) return
    const source = objectStampSourceAt(persisted, hit.target, world)
    if (!source) return
    objectStampSource = source
    showGhostAt(world)
    publishGuidance()
  }

  function placeObjectStamp(anchorWorld: WorldPoint): void {
    const source = objectStampSource
    if (!source || !placement || !canUseObjectStampSource(source)) return
    placement.place({
      template: rotateArrangementTemplate(objectStampArrangementTemplate(source), source.anchorWorld, rotationDeg),
      translateBy: objectStampDelta(source, anchorWorld),
      historyType: 'interaction-object-stamp',
      onCommitted: () => showGhostAt(anchorWorld),
    })
  }

  /** Today's check at each placement: the source is not locked now and every layer it adds to is open. */
  function canUseObjectStampSource(source: ObjectStampSource): boolean {
    const { scene } = context()
    const persisted = scene.persisted
    if (isSceneDesignObjectLocked(persisted, { kind: source.kind, id: source.sourceId })) return false
    if (source.kind !== 'group') return scene.isLayerOpenForCreation(SOURCE_LAYER[source.kind])
    const members = resolveSceneObjectGroupMembers(persisted, source.group)
    return members.length > 0
      && members.every((member) => scene.isLayerOpenForCreation(sceneObjectGroupMemberLayerName(member)))
  }

  /** Ghosts of what a press would place, the stamp's anchor at `anchorWorld`, turned by the held angle. */
  function showGhostAt(anchorWorld: WorldPoint): void {
    lastAnchor = anchorWorld
    const source = objectStampSource
    if (!source) {
      context().effects.setDraft(null)
      return
    }
    const entities = objectStampEntities(source, objectStampDelta(source, anchorWorld))
    const shapes = stampGhostShapes(rotateStampEntities(entities, anchorWorld, rotationDeg), anchorWorld, rotationDeg)
    context().effects.setDraft({ shapes })
  }

  function describeSource(): CanvasStampGuidance | null {
    const source = objectStampSource
    if (!source) return null
    const { scene } = context()
    const plantName = (plant: ScenePlantEntity): string =>
      scene.plantPresentation(plant)?.commonName ?? plant.commonName ?? plant.canonicalName
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

  function publishGuidance(): void {
    context().effects.setGuidance({
      stamp: describeSource(),
      stampRotationDeg: objectStampSource ? rotationDeg : null,
    })
  }

  function clear(): void {
    objectStampSource = null
    rotationDeg = 0
    lastAnchor = null
  }

  return {
    id: 'object-stamp',
    activate(next) {
      ctx = next
      placement = createSceneArrangementPlacement({ sceneEdits: next.effects.edits })
      clear()
    },
    gesture(g) {
      switch (g.kind) {
        case 'press':
          // Every press acts, so a double-click places twice (today).
          if (objectStampSource) placeObjectStamp(g.point.snapped)
          else sampleObjectStampSource(g.point.world)
          return 'handled'
        case 'hover':
        case 'drag-start':
        case 'drag-move':
          // While a pick is held the ghost is the hover: the passive hover stays off.
          if (!objectStampSource) return 'pass'
          showGhostAt(g.point.snapped)
          return 'handled'
        default:
          // The press acted; the ghost stays when the pointer leaves the map or a gesture is cancelled.
          return 'pass'
      }
    },
    command(c) {
      if (c.kind === 'rotate-held') {
        if (!objectStampSource) return 'pass'
        rotationDeg = turnStampRotation(rotationDeg, c.stepDeg)
        if (lastAnchor) showGhostAt(lastAnchor)
        publishGuidance()
        return 'handled'
      }
      if (c.kind === 'escape') {
        // Under LEGACY Esc leaves for Select at once, pick and all, even mid-press (spec §3.7; phase 2 drops the pick first).
        context().effects.requestTool('select')
        return 'handled'
      }
      return 'pass'
    },
    sceneChanged() {
      // The tool card names the pick in the scene's current language.
      if (objectStampSource) publishGuidance()
    },
    hasTransient: () => false,
    escapeHint: () => 'leave-tool',
    cancelTransient() {
      // The pick and its angle outlive every cancellation, as today; overview hides the ghost until the map comes back.
      if (context().view.mode === 'overview') context().effects.setDraft(null)
    },
    deactivate() {
      clear()
      ctx?.effects.setDraft(null)
    },
  }
}

function objectStampSourceAt(
  scene: ScenePersistedState,
  target: SceneDesignObjectTarget,
  world: WorldPoint,
): ObjectStampSource | null {
  const anchorWorld = { x: world.x, y: world.y }
  if (target.kind === 'plant') {
    const plant = scene.plants.find((entry) => entry.id === target.id)
    return plant ? { kind: 'plant', sourceId: plant.id, plant: clonePlantForObjectStamp(plant), anchorWorld } : null
  }
  if (target.kind === 'zone') {
    const zone = scene.zones.find((entry) => entry.id === target.id)
    return zone ? { kind: 'zone', sourceId: zone.id, zone: cloneZoneForObjectStamp(zone), anchorWorld } : null
  }
  if (target.kind === 'annotation') {
    const annotation = scene.annotations.find((entry) => entry.id === target.id)
    return annotation
      ? { kind: 'annotation', sourceId: annotation.id, annotation: cloneAnnotationForObjectStamp(annotation), anchorWorld }
      : null
  }
  if (target.kind === 'group') {
    const group = scene.groups.find((entry) => entry.id === target.id)
    if (!group) return null
    const members = cloneGroupMembersForObjectStamp(group, scene)
    if (members.plants.length + members.zones.length + members.annotations.length === 0) return null
    return { kind: 'group', sourceId: group.id, group: cloneGroupForObjectStamp(group), ...members, anchorWorld }
  }
  // A measurement guide is not stamped.
  return null
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

function objectStampDelta(source: ObjectStampSource, anchorWorld: WorldPoint): WorldPoint {
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
function objectStampEntities(source: ObjectStampSource, delta: WorldPoint): StampEntities {
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
