// __tests__/support/tool-harness.ts  (test support)
//
// The ToolHarness (spec §1.8): how tool and ToolHost tests build a scene and the ToolScene over it. Scenes are real
// SceneStores in session-plane metres; the scene source reads the frame scale, the species cache and the localised
// names through injected functions, as interaction-session.ts passes the runtime's.

import { signal } from '@preact/signals'
import type { ToolSceneSource } from '../../canvas/runtime/interaction-ports'
import type { PlantPresentationContext } from '../../canvas/runtime/plant-presentation'
import type { SpeciesCacheEntry } from '../../canvas/runtime/presentation-data'
import {
  SceneStore,
  type SceneAnnotationEntity,
  type SceneMeasurementGuideEntity,
  type ScenePersistedState,
  type ScenePlantEntity,
  type ScenePoint,
  type SceneZoneEntity,
} from '../../canvas/runtime/scene'
import { getDesignObjectSelectionModel } from '../../canvas/runtime/scene-runtime/selection'

export function plantEntity(
  id: string,
  canonicalName: string,
  position: ScenePoint,
  overrides: Partial<ScenePlantEntity> = {},
): ScenePlantEntity {
  return {
    kind: 'plant',
    id,
    locked: false,
    canonicalName,
    commonName: canonicalName,
    color: null,
    stratum: null,
    canopySpreadM: 2,
    position,
    rotationDeg: null,
    notes: null,
    plantedDate: null,
    quantity: 1,
    ...overrides,
  }
}

export function rectZone(
  id: string,
  points: SceneZoneEntity['points'],
  overrides: Partial<SceneZoneEntity> = {},
): SceneZoneEntity {
  return {
    kind: 'zone',
    id,
    name: null,
    locked: false,
    zoneType: 'rect',
    points,
    rotationDeg: 0,
    fillColor: null,
    notes: null,
    ...overrides,
  }
}

export function textNote(
  id: string,
  position: ScenePoint,
  text: string,
  overrides: Partial<SceneAnnotationEntity> = {},
): SceneAnnotationEntity {
  return {
    kind: 'annotation',
    id,
    locked: false,
    annotationType: 'text',
    position,
    text,
    fontSize: 16,
    rotationDeg: null,
    ...overrides,
  }
}

export function measurementGuide(
  id: string,
  start: ScenePoint,
  end: ScenePoint,
  overrides: Partial<SceneMeasurementGuideEntity> = {},
): SceneMeasurementGuideEntity {
  return { kind: 'measurement-guide', id, locked: false, start, end, ...overrides }
}

/** A scene store holding `scene` (on the default new-Design layers unless it names its own). */
export function sceneStoreWith(scene: Partial<ScenePersistedState>): SceneStore {
  const store = new SceneStore()
  store.updatePersisted((draft) => {
    Object.assign(draft, scene)
  })
  return store
}

export interface ToolSceneSourceOptions {
  /** The frame's pixelsPerMetre; default 1 (the split suites' camera). */
  readonly pixelsPerMetre?: () => number
  readonly speciesCache?: ReadonlyMap<string, SpeciesCacheEntry>
  readonly localizedCommonNames?: ReadonlyMap<string, string | null>
  readonly isLayerOpenForCreation?: ToolSceneSource['isLayerOpenForCreation']
}

/** The ToolScene source over a scene store, read live as the runtime's is. */
export function createToolSceneSource(store: SceneStore, options: ToolSceneSourceOptions = {}): ToolSceneSource {
  const speciesCache = options.speciesCache ?? new Map<string, SpeciesCacheEntry>()
  const plantContext = (pixelsPerMetre: number): PlantPresentationContext => ({
    viewport: { x: 0, y: 0, scale: pixelsPerMetre },
    speciesCache,
    ...(options.localizedCommonNames ? { localizedCommonNames: options.localizedCommonNames } : {}),
  })
  const pixelsPerMetre = options.pixelsPerMetre ?? (() => 1)
  return {
    store,
    sceneRevision: signal(0),
    selection: () => store.session.selectedTargets,
    isLayerOpenForCreation: options.isLayerOpenForCreation ?? ((layer) => {
      const entry = store.persisted.layers.find((candidate) => candidate.name === layer)
      return entry?.visible !== false && entry?.locked !== true
    }),
    pixelsPerMetre,
    speciesCache: () => speciesCache,
    plantContext,
    selectionModel: () => {
      const scale = pixelsPerMetre()
      return getDesignObjectSelectionModel(store.persisted, store.session.selectedTargets, {
        annotationViewportScale: scale,
        plantContext: { ...plantContext(scale), plants: store.persisted.plants },
      })
    },
  }
}
