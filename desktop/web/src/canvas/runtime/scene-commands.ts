import {
  normalizeSceneDesignObjectTargets,
  sceneDesignObjectTargetsEqual,
  type SceneDesignObjectTarget,
  type ScenePersistedState,
} from './scene'

type PersistedPatchKey =
  | 'plantSpeciesColors'
  | 'plantSpeciesSymbols'
  | 'plantSpeciesCodes'
  | 'layers'
  | 'plants'
  | 'zones'
  | 'annotations'
  | 'measurementGuides'
  | 'groups'
  | 'guides'

export interface SceneCommandSnapshot {
  persisted: ScenePersistedState
  selectedTargets: readonly SceneDesignObjectTarget[]
}

export interface SceneCommandPatch {
  readonly persisted?: Partial<ScenePersistedState>
  readonly selection?: readonly SceneDesignObjectTarget[]
}

export interface SceneCommand {
  readonly type: string
  readonly before: SceneCommandPatch
  readonly after: SceneCommandPatch
}

const PATCH_KEYS: PersistedPatchKey[] = [
  'plantSpeciesColors',
  'plantSpeciesSymbols',
  'plantSpeciesCodes',
  'layers',
  'plants',
  'zones',
  'annotations',
  'measurementGuides',
  'groups',
  'guides',
]

export function createScenePatchCommand(
  type: string,
  before: SceneCommandSnapshot,
  after: SceneCommandSnapshot,
): SceneCommand | null {
  const beforePatch: MutableSceneCommandPatch = {}
  const afterPatch: MutableSceneCommandPatch = {}

  for (const key of PATCH_KEYS) {
    const beforeValue = before.persisted[key]
    const afterValue = after.persisted[key]
    if (stableStringify(beforeValue) === stableStringify(afterValue)) continue
    beforePatch.persisted ??= {}
    afterPatch.persisted ??= {}
    ;(beforePatch.persisted as Record<PersistedPatchKey, unknown>)[key] = cloneValue(beforeValue)
    ;(afterPatch.persisted as Record<PersistedPatchKey, unknown>)[key] = cloneValue(afterValue)
  }

  const beforeSelection = normalizeSceneDesignObjectTargets(before.selectedTargets)
  const afterSelection = normalizeSceneDesignObjectTargets(after.selectedTargets)
  if (!sceneDesignObjectTargetsEqual(beforeSelection, afterSelection)) {
    beforePatch.selection = beforeSelection
    afterPatch.selection = afterSelection
  }

  if (!afterPatch.persisted && !afterPatch.selection) return null

  return {
    type,
    before: beforePatch,
    after: afterPatch,
  }
}

interface MutableSceneCommandPatch {
  persisted?: Partial<ScenePersistedState>
  selection?: SceneDesignObjectTarget[]
}

export function applySceneCommandPersistedPatch(
  draft: ScenePersistedState,
  patch: SceneCommandPatch,
): void {
  if (patch.persisted) {
    Object.assign(draft, cloneValue(patch.persisted))
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
