import type { CanvasDesignObjectSelectionModel } from '../runtime'

export function canSaveSelectionAsObjectStamp(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.length + lockedTargets(selection).length > 0
    && !hasMeasurementGuideTarget(selection)
    && !hasStructuralSelectionBlocker(selection)
}

function hasStructuralSelectionBlocker(selection: CanvasDesignObjectSelectionModel): boolean {
  const lockedKeys = new Set(lockedTargets(selection).map(targetKey))
  return selection.blockedTargets.some((blocked) =>
    blocked.reason !== 'locked-design-object'
    || !lockedKeys.has(targetKey(blocked.target)),
  )
}

function lockedTargets(selection: CanvasDesignObjectSelectionModel): readonly { kind: string; id: string }[] {
  return selection.lockedTargets ?? []
}

function hasMeasurementGuideTarget(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.some((target) => target.kind === 'measurement-guide')
    || lockedTargets(selection).some((target) => target.kind === 'measurement-guide')
}

function targetKey(target: { kind: string; id: string }): string {
  return `${target.kind}:${target.id}`
}
