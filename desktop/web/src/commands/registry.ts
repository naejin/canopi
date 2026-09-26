import { signal } from '@preact/signals'
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
