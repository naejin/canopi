export type SceneConcreteDesignObjectTarget =
  | { readonly kind: 'plant'; readonly id: string }
  | { readonly kind: 'zone'; readonly id: string }
  | { readonly kind: 'annotation'; readonly id: string }

export type SceneDesignObjectTarget =
  | SceneConcreteDesignObjectTarget
  | { readonly kind: 'measurement-guide'; readonly id: string }
  | { readonly kind: 'group'; readonly id: string }

export type SceneDesignObjectSelection = readonly SceneDesignObjectTarget[]

export function cloneSceneDesignObjectTarget<T extends SceneDesignObjectTarget>(
  target: T,
): T {
  return { ...target }
}

export function normalizeSceneDesignObjectTargets(
  targets: Iterable<SceneDesignObjectTarget>,
): SceneDesignObjectTarget[] {
  const normalized = new Map<string, SceneDesignObjectTarget>()
  for (const target of targets) {
    normalized.set(sceneTargetKey(target), cloneSceneDesignObjectTarget(target))
  }
  return [...normalized.values()]
}

export function sceneDesignObjectTargetsEqual(
  left: SceneDesignObjectSelection,
  right: SceneDesignObjectSelection,
): boolean {
  const leftKeys = new Set(left.map(sceneTargetKey))
  const rightKeys = new Set(right.map(sceneTargetKey))
  if (leftKeys.size !== rightKeys.size) return false
  return [...leftKeys].every((key) => rightKeys.has(key))
}

export function includesSceneDesignObjectTarget(
  targets: SceneDesignObjectSelection,
  target: SceneDesignObjectTarget,
): boolean {
  const key = sceneTargetKey(target)
  return targets.some((candidate) => sceneTargetKey(candidate) === key)
}

export function sceneTargetKey(target: SceneDesignObjectTarget): string {
  return `${target.kind}:${target.id}`
}
