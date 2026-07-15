import {
  normalizeSceneDesignObjectTargets,
  sceneDesignObjectTargetsEqual,
  type SceneDesignObjectTarget,
  type ScenePersistedState,
} from './scene'

export type SceneDiffKind =
  | 'layers'
  | 'plants'
  | 'zones'
  | 'annotations'
  | 'measurementGuides'
  | 'groups'
  | 'plantSpeciesColors'
  | 'plantSpeciesSymbols'
  | 'guides'
  | 'selection'

type PersistedPatchKey =
  | 'plantSpeciesColors'
  | 'plantSpeciesSymbols'
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
  readonly diffs: readonly SceneDiffKind[]
  readonly before: SceneCommandPatch
  readonly after: SceneCommandPatch
}

const PATCH_KEYS: PersistedPatchKey[] = [
  'plantSpeciesColors',
  'plantSpeciesSymbols',
  'layers',
  'plants',
  'zones',
  'annotations',
  'measurementGuides',
  'groups',
  'guides',
]

const DIFF_BY_KEY: Record<PersistedPatchKey, SceneDiffKind> = {
  plantSpeciesColors: 'plantSpeciesColors',
  plantSpeciesSymbols: 'plantSpeciesSymbols',
  layers: 'layers',
  plants: 'plants',
  zones: 'zones',
  annotations: 'annotations',
  measurementGuides: 'measurementGuides',
  groups: 'groups',
  guides: 'guides',
}

export function createScenePatchCommand(
  type: string,
  before: SceneCommandSnapshot,
  after: SceneCommandSnapshot,
): SceneCommand | null {
  const beforePatch: MutableSceneCommandPatch = {}
  const afterPatch: MutableSceneCommandPatch = {}
  const diffs = new Set<SceneDiffKind>()

  for (const key of PATCH_KEYS) {
    const beforeValue = before.persisted[key]
    const afterValue = after.persisted[key]
    if (stableStringify(beforeValue) === stableStringify(afterValue)) continue
    beforePatch.persisted ??= {}
    afterPatch.persisted ??= {}
    ;(beforePatch.persisted as Record<PersistedPatchKey, unknown>)[key] = cloneValue(beforeValue)
    ;(afterPatch.persisted as Record<PersistedPatchKey, unknown>)[key] = cloneValue(afterValue)
    diffs.add(DIFF_BY_KEY[key])
  }

  const beforeSelection = normalizeSceneDesignObjectTargets(before.selectedTargets)
  const afterSelection = normalizeSceneDesignObjectTargets(after.selectedTargets)
  if (!sceneDesignObjectTargetsEqual(beforeSelection, afterSelection)) {
    beforePatch.selection = beforeSelection
    afterPatch.selection = afterSelection
    diffs.add('selection')
  }

  if (diffs.size === 0) return null

  return {
    type,
    diffs: [...diffs],
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
