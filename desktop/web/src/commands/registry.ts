import { signal } from '@preact/signals'
import {
  isCommandPaletteEscapeEvent,
  isCommandPaletteToggleEvent,
  runAppCommandShortcutForEvent,
} from './graph/shortcuts'

export type { AppCommandId } from './graph/catalog'
export {
  isCatalogCommandDisabled as isAppCommandDisabled,
  runCatalogCommand as runAppCommand,
} from './graph/catalog'
export {
  appCommandGraphChromeProjection,
  appCommandGraphPanelProjection,
  appCommandGraphToolbarProjection,
  commands,
  getAppCommand,
  getMenuDefinitions,
} from './graph/projections'
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
  MenuSeparator,
} from './graph/projections'

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
