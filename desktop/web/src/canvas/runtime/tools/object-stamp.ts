// canvas/runtime/tools/object-stamp.ts
//
// Owns the Object stamp (K, spec §3.2). The first press on a plant, zone, note or group copies it: the pick, anchored where
// it was pressed (today's hitTestTopLevel: guides and object-locked objects are not picked, a group needs a member). Every
// later press places the pick with that anchor at the snapped point, turned by the held angle, as one
// 'interaction-object-stamp' edit that selects the copies, while the source is still unlocked on open layers. The ghost of
// what a press would place follows the pointer from the pick on and stays when the pointer leaves the map; the tool card
// names the pick. A pick starts at 0, so copies keep their source's orientation like Paste and Duplicate (spec §4.7); `[`
// and `]` turn it (rotate-held commands), and the tool card shows that turn; Esc leaves for Select at once under LEGACY
// (spec §3.7). A release and every cancellation (a blur, K again, overview) hide the ghost until the next hover and keep
// the pick, as today's pointerup and cancellation hid the preview; a re-origin hides it until the next hover (the host).

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
} from '../scene-runtime/arrangement-placement'
import type { WorldPoint } from '../view/types'
import { stampGhostShapes, stampTemplateAt, turnStampRotation } from './stamp-rotation'
import type { CanvasTool, HitTarget, ToolContext } from './tool'

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

const ORIGIN: WorldPoint = Object.freeze({ x: 0, y: 0 })

/** The layer a single picked object is placed on. */
const SOURCE_LAYER = { plant: 'plants', zone: 'zones', annotation: 'annotations' } as const

export function createObjectStampTool(): CanvasTool {
  let ctx: ToolContext | null = null
  let placement: SceneArrangementPlacement | null = null
  let objectStampSource: ObjectStampSource | null = null
  let rotationDeg = 0
  /** Where the ghost's anchor was last drawn: `[` and `]` redraw it there. */
  let lastAnchor: WorldPoint | null = null
  /** Whether the ghost is drawn now (a release or a cancellation hides it until the next hover). */
  let ghostShown = false

  function context(): ToolContext {
    if (!ctx) throw new Error('The Object stamp is not active.')
    return ctx
  }

  /** A press with nothing picked: `hit` is the host's unfiltered hit under the raw point (today's hitTestTopLevel). */
  function sampleObjectStampSource(world: WorldPoint, hit: HitTarget | null): void {
    rotationDeg = 0
    if (hit?.kind !== 'object') return
    const persisted = context().scene.persisted
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
      template: stampTemplateAt(objectStampArrangementTemplate(source), source.anchorWorld, anchorWorld, rotationDeg),
      translateBy: ORIGIN,
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
      hideGhost()
      return
    }
    const shapes = stampGhostShapes(stampTemplateAt(objectStampArrangementTemplate(source), source.anchorWorld, anchorWorld, rotationDeg))
    ghostShown = true
    context().effects.setDraft({ shapes })
  }

  function hideGhost(): void {
    ghostShown = false
    context().effects.setDraft(null)
  }

  function describeSource(): CanvasStampGuidance | null {
    const source = objectStampSource
    if (!source) return null
    const { scene } = context()
    const plantName = (plant: ScenePlantEntity): string => scene.plantPresentation(plant).commonName
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
    ghostShown = false
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
          else sampleObjectStampSource(g.point.world, g.hit)
          return 'handled'
        case 'hover':
        case 'drag-start':
        case 'drag-move':
          // While a pick is held the ghost is the hover: the passive hover stays off.
          if (!objectStampSource) return 'pass'
          showGhostAt(g.point.snapped)
          return 'handled'
        case 'tap':
        case 'drag-end':
          // The press acted; the release hides the ghost until the next hover (today's pointerup ran the cancellation).
          if (ghostShown) hideGhost()
          return 'pass'
        default:
          // The ghost stays when the pointer leaves the map, and a cancelled press leaves it too: today's stamp press let
          // go of the pointer gesture, so a pointercancel or a lost capture after it cancelled nothing.
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
    cancelTransient() {
      // The pick and its angle outlive every cancellation, as today; each hides the ghost until the next hover, as today's
      // cancellation and overview reset hid the preview element.
      if (ghostShown) hideGhost()
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
