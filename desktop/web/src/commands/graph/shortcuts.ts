import {
  canvasCommandDefinitionForShortcut,
  type CanvasCommandShortcutInput,
} from '../../app/canvas-commands'
import { matchShellCommandShortcut } from '../../app/shell-commands'
import { getCurrentCanvasCommandSurface } from '../../canvas/session'
import { isEditableTarget } from '../../canvas/runtime/interaction/pointer-utils'
import { COMMAND_PALETTE_SHORTCUT_KEY } from '../../shortcuts/definitions'
import {
  DESKTOP_SHELL_COMMAND_CATALOG,
  runCatalogCommand,
  type AppCommandId,
} from './catalog'

interface AppCommandShortcutMatch {
  readonly commandId: AppCommandId
  readonly preventDefault: boolean
}

export function isCommandPaletteToggleEvent(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey)
    && event.shiftKey
    && event.key.toUpperCase() === COMMAND_PALETTE_SHORTCUT_KEY
}

export function isCommandPaletteEscapeEvent(event: KeyboardEvent): boolean {
  return event.key === 'Escape'
}

export function runAppCommandShortcutForEvent(event: KeyboardEvent): boolean {
  const match = matchAppCommandShortcut(event)
  if (!match) return false
  if (match.preventDefault) event.preventDefault()
  runCatalogCommand(match.commandId)
  return true
}

/**
 * Shell shortcuts (File, panels, Settings, Help) work everywhere. Canvas
 * shortcuts need a canvas and never steal keys from a text field, except
 * the few that are meant to (Ctrl K).
 */
export function matchAppCommandShortcut(event: KeyboardEvent): AppCommandShortcutMatch | null {
  const input = shortcutInput(event)
  const shellCommand = matchShellCommandShortcut(DESKTOP_SHELL_COMMAND_CATALOG, input)
  if (shellCommand) return { commandId: shellCommand.id, preventDefault: true }

  const canvasCommand = canvasCommandDefinitionForShortcut(input)
  if (!canvasCommand) return null
  // A tool key before the canvas mounts primes the tool it starts with.
  if (canvasCommand.kind !== 'tool' && !getCurrentCanvasCommandSurface()) return null
  if (isEditableTarget(event.target) && !canvasCommand.worksInTextFields) return null
  return { commandId: canvasCommand.commandId, preventDefault: true }
}

function shortcutInput(event: KeyboardEvent): CanvasCommandShortcutInput {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  }
}
