import { signal } from '@preact/signals'

/** What Rotate… turns once the user gives an angle, and where focus goes afterwards. */
export interface RotateSelectionTarget {
  /** Turns the selection about its centre, clockwise on the map for positive degrees. */
  rotate(degrees: number): void
  /** Called after the dialog closes; the dialog otherwise returns focus to where it was opened. */
  returnFocus?(): void
}

/** The open Rotate… dialog's target, or null while it is closed. */
export const rotateSelectionDialog = signal<RotateSelectionTarget | null>(null)

/** Rotate… from the Edit menu, the right-click menu or Ctrl Alt R. */
export function openRotateSelectionDialog(target: RotateSelectionTarget): void {
  rotateSelectionDialog.value = target
}

export function closeRotateSelectionDialog(): void {
  const target = rotateSelectionDialog.peek()
  if (!target) return
  rotateSelectionDialog.value = null
  target.returnFocus?.()
}

/** Applies the angle and closes; false (and the dialog stays) when the text is not an angle. */
export function applyRotateSelection(text: string): boolean {
  const target = rotateSelectionDialog.peek()
  const degrees = parseRotationDegrees(text)
  if (!target || degrees === null) return false
  rotateSelectionDialog.value = null
  if (degrees % 360 !== 0) target.rotate(degrees)
  target.returnFocus?.()
  return true
}

/**
 * An angle in degrees as typed: "30", "-15", "−15", "12.5" or "12,5", with an
 * optional degree sign. Null for anything else.
 */
export function parseRotationDegrees(text: string): number | null {
  const normalized = text.trim().replace(/°$/, '').trim().replace('−', '-').replace(',', '.')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/** Steps a typed angle by `delta`; an empty or unreadable field counts as 0. */
export function stepRotationDegrees(text: string, delta: number): number {
  return (parseRotationDegrees(text) ?? 0) + delta
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    rotateSelectionDialog.value = null
  })
}
