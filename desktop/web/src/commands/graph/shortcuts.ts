import {
  canvasCommandDefinitions,
  type CanvasCommandDefinition,
  type CanvasCommandId,
} from '../../app/canvas-commands'
import {
  CANVAS_KEYMAP_ROWS,
  shellKeymapRows,
  type CommandSink,
  type KeymapRow,
} from '../../app/keyboard/keymap'
import { closeCommandPalette, commandPaletteOpen } from '../../app/shell/dialogs'
import { getCurrentCanvasCommandSurface } from '../../canvas/session'
import {
  DESKTOP_SHELL_COMMAND_CATALOG,
  runCatalogCommand,
  type AppCommandId,
} from './catalog'

/** The Desktop keymap: its shell catalogue's rows, then both editions' canvas rows (spec §1.6). */
export const DESKTOP_KEYMAP: readonly KeymapRow[] = [
  ...shellKeymapRows(DESKTOP_SHELL_COMMAND_CATALOG),
  ...CANVAS_KEYMAP_ROWS,
]

const canvasDefinitionById = new Map<CanvasCommandId, CanvasCommandDefinition>(
  canvasCommandDefinitions.map((definition) => [definition.commandId, definition]),
)

/**
 * Where a Desktop keymap row runs. A shell shortcut takes its key even when its command is disabled; a canvas command
 * needs a canvas, except a tool key, which before the canvas mounts primes the tool it starts with. The palette's own
 * key is the one row that runs in a modal: it closes the open palette and opens none over another dialog.
 */
export function createDesktopCommandSink(isModalOpen: () => boolean): CommandSink {
  return {
    run(command) {
      if (command === 'help.commandPalette') {
        if (commandPaletteOpen.peek()) {
          closeCommandPalette()
          return true
        }
        if (isModalOpen()) return false
      }
      const canvas = canvasDefinitionById.get(command as CanvasCommandId)
      if (canvas && canvas.kind !== 'tool' && !getCurrentCanvasCommandSurface()) return false
      // The Desktop keymap names only Desktop commands: its own catalogue's and the canvas rows'.
      runCatalogCommand(command as AppCommandId, 'shortcut')
      return true
    },
  }
}
