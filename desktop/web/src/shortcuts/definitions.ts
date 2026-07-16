import {
  CANVAS_HISTORY_SHORTCUTS,
  CANVAS_TOOL_SHORTCUTS,
  canvasToolShortcutKeys,
} from '../app/canvas-commands'

export const COMMAND_PALETTE_SHORTCUT_KEY = 'P'

export const EDIT_SHORTCUTS = CANVAS_HISTORY_SHORTCUTS

export const VIEW_SHORTCUTS = {
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  fitToContent: 'Ctrl+0',
} as const

export const TOOL_SHORTCUTS = CANVAS_TOOL_SHORTCUTS

export const canvasToolKeys = canvasToolShortcutKeys
