import { NEW_DESIGN_LAYER_DEFAULTS } from '../../../generated/new-design-defaults'
import type { ScenePersistedState, SceneSessionState } from './types'
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
    layers: NEW_DESIGN_LAYER_DEFAULTS.map((layer) => ({
      kind: 'layer',
      ...layer,
    })),
    plants: [],
    zones: [],
    annotations: [],
    measurementGuides: [],
    groups: [],
    guides: [],
  }
}
