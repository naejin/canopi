import { SCENE_LAYER_NAMES, type ScenePersistedState, type SceneSessionState } from './types'

export function createDefaultSceneSessionState(overrides: Partial<SceneSessionState> = {}): SceneSessionState {
  return {
    selectedEntityIds: new Set(overrides.selectedEntityIds ?? []),
    hoveredEntityId: overrides.hoveredEntityId ?? null,
    activeEntityId: overrides.activeEntityId ?? null,
    activeLayerName: overrides.activeLayerName ?? 'zones',
    documentRevision: overrides.documentRevision ?? 0,
  }
}

export function createDefaultScenePersistedState(_now: Date = new Date()): ScenePersistedState {
  return {
    plantSpeciesColors: {},
    plantSpeciesSymbols: {},
    layers: SCENE_LAYER_NAMES.map((name) => ({
      kind: 'layer',
      name,
      visible: name === 'base'
        || name === 'zones'
        || name === 'plants'
        || name === 'measurement-guides'
        || name === 'annotations',
      locked: false,
      opacity: 1,
    })),
    plants: [],
    zones: [],
    annotations: [],
    measurementGuides: [],
    groups: [],
    guides: [],
  }
}
