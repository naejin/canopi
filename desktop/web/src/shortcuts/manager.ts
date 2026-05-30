import { handleAppCommandKeyDown } from '../commands/registry'

export { commandPaletteOpen } from '../commands/registry'

// Module-level reference so HMR can remove the old handler before re-adding.
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null

export function initShortcuts() {
  // Remove any handler registered by a previous HMR execution.
  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler)
  }

  _keydownHandler = (e: KeyboardEvent) => {
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
