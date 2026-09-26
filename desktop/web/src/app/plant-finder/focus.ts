import { saveProblem } from '../document-session/save-problem'

/**
 * Ctrl F (Cmd F) focuses the plant finder of the open panel. Each mounted finder
 * registers its focus action; the most recently mounted one wins, so a picker opened
 * inside a panel takes the shortcut until it closes.
 */
const finders: (() => void)[] = []

export function registerPlantFinder(focus: () => void): () => void {
  finders.push(focus)
  return () => {
    const index = finders.lastIndexOf(focus)
    if (index >= 0) finders.splice(index, 1)
  }
}

export function focusOpenPlantFinder(): boolean {
  const focus = finders.at(-1)
  if (!focus) return false
  focus()
  return true
}

export function isFindPlantsShortcut(event: {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}): boolean {
  return (event.ctrlKey !== event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f'
}

/** Shared by both editions' key routing; true when the shortcut focused a finder. */
export function runFindPlantsShortcut(event: KeyboardEvent): boolean {
  // The save dialog is modal: the finder under it must not take focus.
  if (!isFindPlantsShortcut(event) || saveProblem.peek() !== null) return false
  if (!focusOpenPlantFinder()) return false
  event.preventDefault()
  return true
}
