import type { ScenePersistedState, ScenePoint, SceneStore } from '../scene'

export interface SceneDragState {
  plantStarts: Map<string, ScenePoint>
  zoneStarts: Map<string, ScenePoint[]>
  annotationStarts: Map<string, ScenePoint>
  groupStarts: Map<string, ScenePoint>
}

export function createSceneDragState(): SceneDragState {
  return {
    plantStarts: new Map(),
    zoneStarts: new Map(),
    annotationStarts: new Map(),
    groupStarts: new Map(),
  }
}

export function resetSceneDragState(state: SceneDragState): void {
  state.plantStarts.clear()
  state.zoneStarts.clear()
  state.annotationStarts.clear()
  state.groupStarts.clear()
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
    state.groupStarts.set(group.id, { ...group.position })
    for (const memberId of group.memberIds) {
      const plant = scene.plants.find((entry) => entry.id === memberId)
      if (plant) state.plantStarts.set(plant.id, { ...plant.position })
      const zone = scene.zones.find((entry) => entry.name === memberId)
      if (zone) state.zoneStarts.set(zone.name, zone.points.map((point) => ({ ...point })))
      const annotation = scene.annotations.find((entry) => entry.id === memberId)
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
    draft.groups = draft.groups.map((group) => {
      const start = state.groupStarts.get(group.id)
      if (!start) return group
      return {
        ...group,
        position: {
          x: start.x + delta.x,
          y: start.y + delta.y,
        },
      }
    })
  })
}
