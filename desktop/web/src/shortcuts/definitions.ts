import type { Panel } from '../app/shell/state'
import {
  CANVAS_HISTORY_SHORTCUTS,
  CANVAS_TOOL_SHORTCUTS,
  canvasToolShortcutKeys,
} from '../app/canvas-commands'

export const FILE_SHORTCUTS = {
  newDesign: 'Ctrl+N',
  openDesign: 'Ctrl+O',
  saveDesign: 'Ctrl+S',
  saveDesignAs: 'Ctrl+Shift+S',
  commandPalette: 'Ctrl+Shift+P',
} as const

export const COMMAND_PALETTE_SHORTCUT_KEY = 'P'

export const PANEL_SHORTCUTS = {
  canvas: 'Ctrl+1',
  plantDb: 'Ctrl+2',
} as const

export const EDIT_SHORTCUTS = CANVAS_HISTORY_SHORTCUTS

export const VIEW_SHORTCUTS = {
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  fitToContent: 'Ctrl+0',
} as const

export const TOOL_SHORTCUTS = CANVAS_TOOL_SHORTCUTS

export const panelKeys: Record<string, Panel> = {
  '1': 'canvas',
  '2': 'plant-db',
}

export const canvasToolKeys = canvasToolShortcutKeys
