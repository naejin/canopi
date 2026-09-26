import { commandPaletteOpen, handleAppCommandKeyDown } from '../commands/registry'
import { runFindPlantsShortcut } from '../app/plant-finder/focus'

export { commandPaletteOpen } from '../commands/registry'

// Module-level reference so HMR can remove the old handler before re-adding.
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function initShortcuts() {
  // Remove any handler registered by a previous HMR execution.
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler)
  }

  _keydownHandler = (e: KeyboardEvent) => {
    // Ctrl F belongs to the open panel's plant finder, even while a field has focus.
    if (!commandPaletteOpen.peek() && runFindPlantsShortcut(e)) return
    handleAppCommandKeyDown(e)
  }

  window.addEventListener('keydown', _keydownHandler)
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_keydownHandler) {
      window.removeEventListener('keydown', _keydownHandler)
      _keydownHandler = null
    }
  })
}
