import { signal } from '@preact/signals'
import { saveProblem } from '../app/document-session/save-problem'
import { savedViewDialogOpen } from '../app/saved-views'
import { modalLayerOpen } from '../app/shell/modal-layer'
import { isCommandPaletteToggleEvent, runAppCommandShortcutForEvent } from './graph'

export {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
} from './graph'
export type {
  AppCommandGraphPanelCommand,
  AppCommandGraphTitleBarCommand,
  AppCommandGraphToolbarActionCommand,
  AppCommandGraphToolbarToolCommand,
  MenuAction,
  MenuDefinition,
  MenuEntry,
} from './graph'

export const commandPaletteOpen = signal(false)

export function handleAppCommandKeyDown(event: KeyboardEvent): boolean {
  // The open palette holds the modal layer; only its own toggle reaches it here.
  if (commandPaletteOpen.peek()) {
    if (!isCommandPaletteToggleEvent(event)) return false
    event.preventDefault()
    commandPaletteOpen.value = false
    return true
  }

  // Modal dialogs: while one asks, no command may change the Design under it.
  if (saveProblem.peek() !== null || savedViewDialogOpen.peek() || modalLayerOpen.peek()) return false

  if (isCommandPaletteToggleEvent(event)) {
    event.preventDefault()
    commandPaletteOpen.value = true
    return true
  }

  return runAppCommandShortcutForEvent(event)
}
