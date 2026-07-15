import { SCENE_LAYER_NAMES, type ScenePersistedState, type SceneSessionState } from './types'
import {
  cloneSceneDesignObjectTarget,
  normalizeSceneDesignObjectTargets,
} from './design-object-targets'

export function createDefaultSceneSessionState(overrides: Partial<SceneSessionState> = {}): SceneSessionState {
  return {
    selectedTargets: normalizeSceneDesignObjectTargets(overrides.selectedTargets ?? []),
    hoveredTarget: overrides.hoveredTarget
      ? cloneSceneDesignObjectTarget(overrides.hoveredTarget)
      : null,
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
