import { signal } from '@preact/signals'
import type { CanvasDesignObjectSelectionModel } from '../../canvas/runtime/runtime'

/** The zone Rename zone… names, its current name and where focus goes afterwards. */
export interface RenameZoneTarget {
  readonly zoneId: string
  /** The zone's display name; null while it has none. */
  readonly name: string | null
  /** Runs the runtime's undoable rename; a blank name clears the display name. */
  rename(zoneId: string, name: string | null): void
  /** Called after the dialog closes; the dialog otherwise returns focus to where it was opened. */
  returnFocus?(): void
}

/** The open Rename zone… dialog's target, or null while it is closed. */
export const renameZoneDialog = signal<RenameZoneTarget | null>(null)

/** Rename zone… from the right-click menu or the selection chip. */
export function openRenameZoneDialog(target: RenameZoneTarget): void {
  renameZoneDialog.value = target
}

export function closeRenameZoneDialog(): void {
  const target = renameZoneDialog.peek()
  if (!target) return
  renameZoneDialog.value = null
  target.returnFocus?.()
}

/** Renames the zone to the typed text and closes; an empty field clears the name. */
export function applyRenameZone(text: string): void {
  const target = renameZoneDialog.peek()
  if (!target) return
  renameZoneDialog.value = null
  const name = text.trim()
  target.rename(target.zoneId, name.length > 0 ? name : null)
  target.returnFocus?.()
}

/**
 * The one editable zone the selection holds, or null: Rename zone… names a
 * lone, unlocked zone on an unlocked layer.
 */
export function loneEditableZoneId(selection: CanvasDesignObjectSelectionModel | null): string | null {
  if (!selection || selection.lockedTargets.length > 0 || selection.blockedTargets.length > 0) return null
  const [only] = selection.editableTargets
  return selection.editableTargets.length === 1 && only?.kind === 'zone' ? only.id : null
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    renameZoneDialog.value = null
  })
}
