import type { Panel } from '../state/app'

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

export const EDIT_SHORTCUTS = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
} as const

export const VIEW_SHORTCUTS = {
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  fitToContent: 'Ctrl+0',
} as const

export const TOOL_SHORTCUTS = {
  select: 'V',
  hand: 'H',
  rectangle: 'R',
  text: 'T',
} as const

export const panelKeys: Record<string, Panel> = {
  '1': 'canvas',
  '2': 'plant-db',
}

export const canvasToolKeys: Record<string, string> = {
  v: 'select',
  V: 'select',
  h: 'hand',
  H: 'hand',
  r: 'rectangle',
  R: 'rectangle',
  t: 'text',
  T: 'text',
}
