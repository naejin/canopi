import type { CanvasDesignObjectSelectionModel } from '../runtime'
import { isRotatableSelection } from '../scene-runtime/selection-rotation'

/**
 * Which selection commands can run on a selection read model. Chrome that
 * offers these commands (the right-click menu, the stamp workbench) reads them
 * here so every entry point agrees with the runtime's own admission.
 */
export interface SelectionCommandAvailability {
  /** Cut, Copy and Delete: only editable objects, nothing locked or blocked. */
  readonly copy: boolean
  /** Duplicate, Bring to front, Send to back and Lock. */
  readonly edit: boolean
  readonly group: boolean
  readonly ungroup: boolean
  /** Rotate…: what the rotation handle turns (never a locked object or a lone plant). */
  readonly rotate: boolean
  readonly unlock: boolean
  readonly selectSameSpecies: boolean
  /** Editable plants whose colour, symbol and pinned name can change. */
  readonly plantAppearance: boolean
  /** Every editable plant already shows its name. */
  readonly plantNamesPinned: boolean
  readonly saveAsStamp: boolean
}

export function selectionCommandAvailability(
  selection: CanvasDesignObjectSelectionModel,
): SelectionCommandAvailability {
  const locked = selection.lockedTargets.length > 0
  const structurallyBlocked = hasStructuralSelectionBlocker(selection)
  const editable = selection.editableTargets.length > 0
  const unblocked = selection.blockedTargets.length === 0
  const { plantIds, allPinned } = selection.plantNamePinning
  return {
    copy: editable && !locked && unblocked,
    edit: editable && !locked && !structurallyBlocked,
    group: unblocked
      && selection.editableTargets.length >= 2
      && !selection.editableTargets.some((target) => target.kind === 'measurement-guide'),
    ungroup: unblocked && selection.editableTargets.some((target) => target.kind === 'group'),
    rotate: isRotatableSelection(selection),
    unlock: locked,
    selectSameSpecies: unblocked && selection.sameSpeciesReferenceCanonicalName !== null,
    plantAppearance: unblocked && plantIds.length > 0,
    plantNamesPinned: plantIds.length > 0 && allPinned,
    saveAsStamp: canSaveSelectionAsObjectStamp(selection),
  }
}

/** The selection holds plants, editable or locked, so plant commands belong in its menu. */
export function selectionIncludesPlants(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.some((target) => target.kind === 'plant')
    || selection.lockedTargets.some((target) => target.kind === 'plant')
}

export function canSaveSelectionAsObjectStamp(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.length + selection.lockedTargets.length > 0
    && !hasMeasurementGuideTarget(selection)
    && !hasStructuralSelectionBlocker(selection)
}

function hasStructuralSelectionBlocker(selection: CanvasDesignObjectSelectionModel): boolean {
  const lockedKeys = new Set(selection.lockedTargets.map(targetKey))
  return selection.blockedTargets.some((blocked) =>
    blocked.reason !== 'locked-design-object'
    || !lockedKeys.has(targetKey(blocked.target)),
  )
}

function hasMeasurementGuideTarget(selection: CanvasDesignObjectSelectionModel): boolean {
  return selection.editableTargets.some((target) => target.kind === 'measurement-guide')
    || selection.lockedTargets.some((target) => target.kind === 'measurement-guide')
}

function targetKey(target: { kind: string; id: string }): string {
  return `${target.kind}:${target.id}`
}
