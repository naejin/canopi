import { activePanel, type Panel } from '../../app/shell/state'
import {
  canvasHistoryCommandIdForShortcut,
  canvasToolCommandIdForShortcut,
  type CanvasCommandShortcutInput,
} from '../../app/canvas-commands'
import { getCurrentCanvasCommandSurface } from '../../canvas/session'
import { isEditableTarget } from '../../canvas/runtime/interaction/pointer-utils'
import {
  COMMAND_PALETTE_SHORTCUT_KEY,
  panelKeys,
} from '../../shortcuts/definitions'
import { runCatalogCommand, type AppCommandId } from './catalog'

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

export function matchAppCommandShortcut(event: KeyboardEvent): AppCommandShortcutMatch | null {
  return shortcutMatchForEvent(event, isEditableTarget(event.target))
}

function shortcutMatchForEvent(event: KeyboardEvent, editable: boolean): AppCommandShortcutMatch | null {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && panelKeys[event.key]) {
    return {
      commandId: panelCommandId(panelKeys[event.key]!),
      preventDefault: true,
    }
  }

  if (!editable && !event.ctrlKey && !event.metaKey && !event.altKey && panelKeys[event.key]) {
    return {
      commandId: panelCommandId(panelKeys[event.key]!),
      preventDefault: false,
    }
  }

  const canvasToolCommandId = canvasToolCommandIdForShortcut(shortcutInput(event))
  if (
    !editable
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && activePanel.value === 'canvas'
    && canvasToolCommandId
  ) {
    return {
      commandId: canvasToolCommandId,
      preventDefault: true,
    }
  }

  if (activePanel.value === 'canvas') {
    const fileCommand = fileShortcutCommand(event)
    if (fileCommand) {
      return {
        commandId: fileCommand,
        preventDefault: true,
      }
    }
  }

  if (activePanel.value !== 'canvas' || editable || !getCurrentCanvasCommandSurface()) {
    return null
  }

  return canvasShortcutCommand(event)
}

function panelCommandId(panel: Panel): AppCommandId {
  if (panel === 'plant-db') return 'nav.plantDb'
  if (panel === 'location') return 'nav.location'
  if (panel === 'favorites') return 'nav.favorites'
  return 'nav.canvas'
}

function fileShortcutCommand(event: KeyboardEvent): AppCommandId | null {
  if (!(event.ctrlKey || event.metaKey)) return null
  if (!event.shiftKey && event.key.toLowerCase() === 's') return 'file.save'
  if (event.shiftKey && event.key.toLowerCase() === 's') return 'file.saveAs'
  if (!event.shiftKey && event.key.toLowerCase() === 'o') return 'file.open'
  if (!event.shiftKey && event.key.toLowerCase() === 'n') return 'file.new'
  return null
}

function canvasShortcutCommand(event: KeyboardEvent): AppCommandShortcutMatch | null {
  const key = event.key
  const historyCommandId = canvasHistoryCommandIdForShortcut(shortcutInput(event))
  if (historyCommandId) {
    return { commandId: historyCommandId, preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '=') {
    return { commandId: 'view.zoomIn', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '-') {
    return { commandId: 'view.zoomOut', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '0') {
    return { commandId: 'view.fitToContent', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'c') {
    return { commandId: 'canvas.copy', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'v') {
    return { commandId: 'canvas.paste', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'd') {
    return { commandId: 'canvas.duplicateSelected', preventDefault: true }
  }
  if (key === 'Delete' || key === 'Backspace') {
    return { commandId: 'canvas.deleteSelected', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'a') {
    return { commandId: 'canvas.selectAll', preventDefault: true }
  }
  if (!event.ctrlKey && !event.metaKey && key === ']') {
    return { commandId: 'canvas.bringToFront', preventDefault: false }
  }
  if (!event.ctrlKey && !event.metaKey && key === '[') {
    return { commandId: 'canvas.sendToBack', preventDefault: false }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'l') {
    return { commandId: 'canvas.lockOrUnlockSelected', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'g') {
    return { commandId: 'canvas.groupSelected', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key.toLowerCase() === 'g') {
    return { commandId: 'canvas.ungroupSelected', preventDefault: true }
  }
  return null
}

function shortcutInput(event: KeyboardEvent): CanvasCommandShortcutInput {
  return {
    key: event.key,
    primaryModifier: event.ctrlKey || event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  }
}
