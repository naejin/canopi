import {
  canvasCommandDefinitionForShortcut,
  type CanvasCommandShortcutInput,
} from '../../app/canvas-commands'
import { matchShellCommandShortcut } from '../../app/shell-commands'
import { singleKeyShortcuts } from '../../app/settings/state'
import { getCurrentCanvasCommandSurface } from '../../canvas/session'
import { isEditableTarget } from '../../canvas/runtime/input/editable-target'
import { matchesShortcut } from '../../app/shell-commands/shortcut-text'
import {
  DESKTOP_SHELL_COMMAND_CATALOG,
  runCatalogCommand,
  type AppCommandId,
} from './catalog'

interface AppCommandShortcutMatch {
  readonly commandId: AppCommandId
  readonly preventDefault: boolean
}

const COMMAND_PALETTE_SHORTCUT = DESKTOP_SHELL_COMMAND_CATALOG
  .find((command) => command.id === 'help.commandPalette')?.shortcut

/** The palette's own key: the only shortcut that reaches the open palette, to close it. */
export function isCommandPaletteToggleEvent(event: KeyboardEvent): boolean {
  return COMMAND_PALETTE_SHORTCUT !== undefined && matchesShortcut(COMMAND_PALETTE_SHORTCUT, event)
}

export function runAppCommandShortcutForEvent(event: KeyboardEvent): boolean {
  // A key an earlier listener consumed (the active tool, a menu) is no shortcut.
  if (event.defaultPrevented) return false
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
function matchAppCommandShortcut(event: KeyboardEvent): AppCommandShortcutMatch | null {
  const input = shortcutInput(event)
  const shellCommand = matchShellCommandShortcut(DESKTOP_SHELL_COMMAND_CATALOG, input)
  if (shellCommand) return { commandId: shellCommand.id, preventDefault: true }

  const canvasCommand = canvasCommandDefinitionForShortcut(input, { characterKeys: singleKeyShortcuts.peek() })
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
    code: event.code,
  }
}
