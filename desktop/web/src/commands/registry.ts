import { signal } from '@preact/signals'
import {
  isCommandPaletteEscapeEvent,
  isCommandPaletteToggleEvent,
  runAppCommandShortcutForEvent,
} from './graph'

export type { AppCommandId } from './graph'
export {
  isAppCommandDisabled,
  runAppCommand,
} from './graph'
export {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
  commands,
  getAppCommand,
  getMenuDefinitions,
} from './graph'
export type {
  AppCommandGraphChromeProjection,
  AppCommandGraphPanelCommand,
  AppCommandGraphPanelProjection,
  AppCommandGraphToolbarActionCommand,
  AppCommandGraphToolbarProjection,
  AppCommandGraphToolbarToolCommand,
  Command,
  MenuAction,
  MenuDefinition,
  MenuEntry,
  MenuLabel,
  MenuSeparator,
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
