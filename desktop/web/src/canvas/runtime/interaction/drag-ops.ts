import { resolveSceneObjectGroupMembers, type ScenePersistedState, type ScenePoint, type SceneStore } from '../scene'

export interface SceneDragState {
  plantStarts: Map<string, ScenePoint>
  zoneStarts: Map<string, ScenePoint[]>
  annotationStarts: Map<string, ScenePoint>
}

export function createSceneDragState(): SceneDragState {
  return {
    plantStarts: new Map(),
    zoneStarts: new Map(),
    annotationStarts: new Map(),
  }
}

export function resetSceneDragState(state: SceneDragState): void {
  state.plantStarts.clear()
  state.zoneStarts.clear()
  state.annotationStarts.clear()
}

export function captureSceneDragState(
  state: SceneDragState,
  scene: ScenePersistedState,
  selection: ReadonlySet<string>,
): void {
  resetSceneDragState(state)

  for (const plant of scene.plants) {
    if (selection.has(plant.id)) {
      state.plantStarts.set(plant.id, { ...plant.position })
    }
  }

  for (const zone of scene.zones) {
    if (selection.has(zone.name)) {
      state.zoneStarts.set(zone.name, zone.points.map((point) => ({ ...point })))
    }
  }

  for (const annotation of scene.annotations) {
    if (selection.has(annotation.id)) {
      state.annotationStarts.set(annotation.id, { ...annotation.position })
    }
  }

  for (const group of scene.groups) {
    if (!selection.has(group.id)) continue
    for (const member of resolveSceneObjectGroupMembers(scene, group)) {
      const plant = member.kind === 'plant' ? scene.plants.find((entry) => entry.id === member.id) : null
      if (plant) state.plantStarts.set(plant.id, { ...plant.position })
      const zone = member.kind === 'zone' ? scene.zones.find((entry) => entry.name === member.id) : null
      if (zone) state.zoneStarts.set(zone.name, zone.points.map((point) => ({ ...point })))
      const annotation = member.kind === 'annotation'
        ? scene.annotations.find((entry) => entry.id === member.id)
        : null
      if (annotation) state.annotationStarts.set(annotation.id, { ...annotation.position })
    }
  }
}

export function applySceneDragDelta(
  store: SceneStore,
  state: SceneDragState,
  delta: ScenePoint,
): void {
  store.updatePersisted((draft) => {
    applySceneDragDeltaToDraft(draft, state, delta)
  })
}

export function applySceneDragDeltaToDraft(
  draft: ScenePersistedState,
  state: SceneDragState,
  delta: ScenePoint,
): void {
  draft.plants = draft.plants.map((plant) => {
    const start = state.plantStarts.get(plant.id)
    if (!start) return plant
    return {
      ...plant,
      position: {
        x: start.x + delta.x,
        y: start.y + delta.y,
      },
    }
  })
  draft.zones = draft.zones.map((zone) => {
    const start = state.zoneStarts.get(zone.name)
    if (!start) return zone
    if (zone.zoneType === 'ellipse' && start.length >= 2) {
      // Elliptical Zones store center + radii, not drawable vertices.
      const center = start[0]!
      const radii = start[1]!
      return {
        ...zone,
        points: [
          {
            x: center.x + delta.x,
            y: center.y + delta.y,
          },
          { ...radii },
        ],
      }
    }
    return {
      ...zone,
      points: start.map((point) => ({
        x: point.x + delta.x,
        y: point.y + delta.y,
      })),
    }
  })
  draft.annotations = draft.annotations.map((annotation) => {
    const start = state.annotationStarts.get(annotation.id)
    if (!start) return annotation
    return {
      ...annotation,
      position: {
        x: start.x + delta.x,
        y: start.y + delta.y,
      },
    }
  })
}
