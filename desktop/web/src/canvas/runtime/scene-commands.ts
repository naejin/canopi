import type { ScenePersistedState, SceneSessionState, SceneStore } from './scene'

export type SceneDiffKind =
  | 'layers'
  | 'plants'
  | 'zones'
  | 'annotations'
  | 'groups'
  | 'plantSpeciesColors'
  | 'guides'
  | 'selection'
  | 'locks'

type PersistedPatchKey =
  | 'plantSpeciesColors'
  | 'layers'
  | 'plants'
  | 'zones'
  | 'annotations'
  | 'groups'
  | 'guides'

export interface SceneCommandRuntime {
  readonly sceneStore: SceneStore
  setSelection(ids: Iterable<string>): void
  setLockedIds(ids: Iterable<string>): void
}

export interface SceneCommandSnapshot {
  persisted: ScenePersistedState
  session: SceneSessionState
  lockedIds: ReadonlySet<string>
}

interface ScenePatch {
  persisted?: Partial<ScenePersistedState>
  selection?: string[]
  lockedIds?: string[]
}

export interface SceneCommand {
  readonly type: string
  readonly diffs: readonly SceneDiffKind[]
  execute(runtime: SceneCommandRuntime): void
  undo(runtime: SceneCommandRuntime): void
}

const PATCH_KEYS: PersistedPatchKey[] = [
  'plantSpeciesColors',
  'layers',
  'plants',
  'zones',
  'annotations',
  'groups',
  'guides',
]

const DIFF_BY_KEY: Record<PersistedPatchKey, SceneDiffKind> = {
  plantSpeciesColors: 'plantSpeciesColors',
  layers: 'layers',
  plants: 'plants',
  zones: 'zones',
  annotations: 'annotations',
  groups: 'groups',
  guides: 'guides',
}

export function createScenePatchCommand(
  type: string,
  before: SceneCommandSnapshot,
  after: SceneCommandSnapshot,
): SceneCommand | null {
  const beforePatch: ScenePatch = {}
  const afterPatch: ScenePatch = {}
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

  const beforeSelection = [...before.session.selectedEntityIds].sort()
  const afterSelection = [...after.session.selectedEntityIds].sort()
  if (stableStringify(beforeSelection) !== stableStringify(afterSelection)) {
    beforePatch.selection = beforeSelection
    afterPatch.selection = afterSelection
    diffs.add('selection')
  }

  const beforeLockedIds = [...before.lockedIds].sort()
  const afterLockedIds = [...after.lockedIds].sort()
  if (stableStringify(beforeLockedIds) !== stableStringify(afterLockedIds)) {
    beforePatch.lockedIds = beforeLockedIds
    afterPatch.lockedIds = afterLockedIds
    diffs.add('locks')
  }

  if (diffs.size === 0) return null

  return {
    type,
    diffs: [...diffs],
    execute(runtime) {
      applyScenePatch(runtime, afterPatch)
    },
    undo(runtime) {
      applyScenePatch(runtime, beforePatch)
    },
  }
}

function applyScenePatch(runtime: SceneCommandRuntime, patch: ScenePatch): void {
  if (patch.persisted) {
    runtime.sceneStore.updatePersisted((draft) => {
      Object.assign(draft, cloneValue(patch.persisted))
    })
  }
  if (patch.selection) runtime.setSelection(patch.selection)
  if (patch.lockedIds) runtime.setLockedIds(patch.lockedIds)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value)
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}
