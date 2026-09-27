import { commandPaletteOpen, handleAppCommandKeyDown } from '../commands/registry'
import { isFindPlantsShortcut, runFindPlantsShortcut } from '../app/plant-finder/focus'
import { runStoryUndoShortcut } from '../app/stories/actions'

export { commandPaletteOpen } from '../commands/registry'

// Module-level reference so HMR can remove the old handler before re-adding.
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function initShortcuts() {
  // Remove any handler registered by a previous HMR execution.
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler)
  }

  _keydownHandler = (e: KeyboardEvent) => {
    // Ctrl F belongs to the open panel's plant finder, even while a field has
    // focus; with no finder open, Edit › Find plants opens the catalog's.
    if (isFindPlantsShortcut(e)) {
      if (commandPaletteOpen.peek()) return
      if (runFindPlantsShortcut(e)) return
    }
    // Ctrl Z answers a Stories Undo toast on screen before the map's history.
    if (!commandPaletteOpen.peek() && runStoryUndoShortcut(e)) return
    handleAppCommandKeyDown(e)
  }

  window.addEventListener('keydown', _keydownHandler)
}

export function disposeShortcuts(): void {
  if (!_keydownHandler) return
  window.removeEventListener('keydown', _keydownHandler)
  _keydownHandler = null
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeShortcuts)
}
