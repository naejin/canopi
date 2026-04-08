import { SCENE_LAYER_NAMES, type ScenePersistedState, type SceneSessionState, type SceneViewportState } from './types'

export function createDefaultSceneViewportState(): SceneViewportState {
  return {
    x: 0,
    y: 0,
    scale: 1,
  }
}

export function createDefaultSceneSessionState(overrides: Partial<SceneSessionState> = {}): SceneSessionState {
  return {
    selectedEntityIds: new Set(overrides.selectedEntityIds ?? []),
    hoveredEntityId: overrides.hoveredEntityId ?? null,
    activeEntityId: overrides.activeEntityId ?? null,
    activeLayerName: overrides.activeLayerName ?? 'zones',
    plantSizeMode: overrides.plantSizeMode ?? 'default',
    plantColorByAttr: overrides.plantColorByAttr ?? null,
    viewport: {
      ...createDefaultSceneViewportState(),
      ...(overrides.viewport ?? {}),
    },
    documentRevision: overrides.documentRevision ?? 0,
  }
}

export function createDefaultScenePersistedState(now: Date = new Date()): ScenePersistedState {
  const timestamp = now.toISOString()

  return {
    version: 2,
    name: 'Untitled',
    description: null,
    location: null,
    northBearingDeg: 0,
    plantSpeciesColors: {},
    layers: SCENE_LAYER_NAMES.map((name) => ({
      kind: 'layer',
      name,
      visible: name === 'base' || name === 'zones' || name === 'plants' || name === 'annotations',
      locked: false,
      opacity: 1,
    })),
    plants: [],
    zones: [],
    annotations: [],
    groups: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    extra: {},
  }
}
