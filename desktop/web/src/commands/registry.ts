import { signal } from '@preact/signals'
import { saveProblem } from '../app/document-session/save-problem'
import {
  isCommandPaletteEscapeEvent,
  isCommandPaletteToggleEvent,
  runAppCommandShortcutForEvent,
} from './graph'

export {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
} from './graph'
export type {
  AppCommandGraphPanelCommand,
  AppCommandGraphToolbarActionCommand,
  AppCommandGraphToolbarToolCommand,
  MenuAction,
  MenuDefinition,
  MenuEntry,
} from './graph'

export const commandPaletteOpen = signal(false)

export function handleAppCommandKeyDown(event: KeyboardEvent): boolean {
  // The save dialog is modal: while it asks, no command may change the Design under it.
  if (saveProblem.peek() !== null) return false

  if (isCommandPaletteToggleEvent(event)) {
    event.preventDefault()
    commandPaletteOpen.value = !commandPaletteOpen.value
    return true
  }

  if (isCommandPaletteEscapeEvent(event) && commandPaletteOpen.value) {
    commandPaletteOpen.value = false
    return true
  }

  return runAppCommandShortcutForEvent(event)
}
