import { saveProblem } from '../app/document-session/save-problem'
import { savedViewDialogOpen } from '../app/saved-views'
import { closeCommandPalette, commandPaletteOpen } from '../app/shell/dialogs'
import { modalLayerOpen } from '../app/shell/modal-layer'
import { isCommandPaletteToggleEvent, runAppCommandShortcutForEvent } from './graph'

export {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
} from './graph'
export type {
  MenuAction,
  MenuDefinition,
  MenuEntry,
} from './graph'

export { commandPaletteOpen }

export function handleAppCommandKeyDown(event: KeyboardEvent): boolean {
  // The open palette holds the modal layer; only its own toggle reaches it here.
  if (commandPaletteOpen.peek()) {
    if (!isCommandPaletteToggleEvent(event)) return false
    event.preventDefault()
    closeCommandPalette()
    return true
  }

  // Modal dialogs: while one asks, no command may change the Design under it.
  if (saveProblem.peek() !== null || savedViewDialogOpen.peek() || modalLayerOpen.peek()) return false

  // Opening the palette is Help › Command palette, matched like any shell shortcut.
  return runAppCommandShortcutForEvent(event)
}
