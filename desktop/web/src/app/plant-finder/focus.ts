import type { KeyboardEventLike } from '../keyboard/key-chord'

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

/** Ctrl F (Cmd F), as an element handler sees it (the PDF dialog's key field). */
export function isFindPlantsShortcut(
  event: Pick<KeyboardEventLike, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): boolean {
  return (event.ctrlKey !== event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f'
}
