import { getCurrentWindow } from '@tauri-apps/api/window'
import { currentDesign, designDirty } from '../../app/document-session/store'
import {
  newDesignAction,
  openDesign,
  saveAsCurrentDesign,
  saveCurrentDesign,
} from '../../app/document-session/actions'
import { activePanel, navigateTo, sidePanel, type Panel, type SidePanel } from '../../app/shell/state'
import {
  diagnosticMessageFromError,
  recordFrontendDiagnostic,
} from '../../app/problem-report/diagnostics'
import { openProblemReportDialog } from '../../app/problem-report/submission'
import { mutateSettingsProjection } from '../../app/settings/projection'
import {
  currentCanvasHasSelection,
  getCurrentCanvasCommandSurface,
  setCurrentCanvasTool,
} from '../../canvas/session'
import type { CanvasCommandSurface } from '../../canvas/runtime/runtime'
import { t } from '../../i18n'
import {
  EDIT_SHORTCUTS,
  FILE_SHORTCUTS,
  PANEL_SHORTCUTS,
  TOOL_SHORTCUTS,
  VIEW_SHORTCUTS,
} from '../../shortcuts/definitions'

export type AppCommandId =
  | 'file.new'
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'file.exit'
  | 'edit.undo'
  | 'edit.redo'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fitToContent'
  | 'help.reportProblem'
  | 'nav.canvas'
  | 'nav.location'
  | 'nav.plantDb'
  | 'nav.favorites'
  | 'view.toggleTheme'
  | 'canvas.tool.select'
  | 'canvas.tool.hand'
  | 'canvas.tool.line'
  | 'canvas.tool.rectangle'
  | 'canvas.tool.ellipse'
  | 'canvas.tool.polygon'
  | 'canvas.tool.text'
  | 'canvas.tool.objectStamp'
  | 'canvas.tool.plantSpacing'
  | 'canvas.toggleGrid'
  | 'canvas.toggleSnapToGrid'
  | 'canvas.toggleRulers'
  | 'canvas.copy'
  | 'canvas.paste'
  | 'canvas.duplicateSelected'
  | 'canvas.deleteSelected'
  | 'canvas.selectAll'
  | 'canvas.bringToFront'
  | 'canvas.sendToBack'
  | 'canvas.lockOrUnlockSelected'
  | 'canvas.groupSelected'
  | 'canvas.ungroupSelected'

export interface AppCommandState {
  readonly hasDesign: boolean
  readonly designDirty: boolean
  readonly canvas: CanvasCommandSurface | null
  readonly canvasHasSelection: boolean
  readonly activePanel: Panel
  readonly sidePanel: SidePanel | null
}

export interface AppCommandDefinition {
  readonly id: AppCommandId
  readonly label?: () => string
  readonly shortcut?: string
  readonly palette?: boolean
  readonly run: (state: AppCommandState) => void
  readonly disabled?: (state: AppCommandState) => boolean
}

export function readAppCommandState(): AppCommandState {
  return {
    hasDesign: currentDesign.value !== null,
    designDirty: designDirty.value,
    canvas: getCurrentCanvasCommandSurface(),
    canvasHasSelection: currentCanvasHasSelection.value,
    activePanel: activePanel.value,
    sidePanel: sidePanel.value,
  }
}

function switchPanel(panel: Panel): void {
  navigateTo(panel)
}

function switchTool(tool: string): void {
  if (activePanel.value !== 'canvas') {
    navigateTo('canvas')
  }
  setCurrentCanvasTool(tool)
}

function cycleTheme(): void {
  mutateSettingsProjection((settings) => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
  }, { persist: 'immediate' })
}

function showProblemReportDialog(): void {
  openProblemReportDialog()
}

function runCanvas(
  state: AppCommandState,
  command: (canvas: CanvasCommandSurface) => void,
): void {
  if (state.canvas) command(state.canvas)
}

function logCommandFailure(label: string, error: unknown): void {
  console.error(`${label} failed:`, error)
  recordFrontendDiagnostic({
    level: 'error',
    source: `command:${label}`,
    message: diagnosticMessageFromError(error),
  })
}

function runAsyncCommand(label: string, action: () => Promise<unknown>): void {
  void action().catch((error) => logCommandFailure(label, error))
}

export const APP_COMMANDS: readonly AppCommandDefinition[] = [
  {
    id: 'file.new',
    label: () => t('canvas.file.new'),
    shortcut: FILE_SHORTCUTS.newDesign,
    palette: true,
    run: () => runAsyncCommand('New design', newDesignAction),
  },
  {
    id: 'file.open',
    label: () => t('canvas.file.open'),
    shortcut: FILE_SHORTCUTS.openDesign,
    palette: true,
    run: () => runAsyncCommand('Open design', openDesign),
  },
  {
    id: 'file.save',
    label: () => t('canvas.file.save'),
    shortcut: FILE_SHORTCUTS.saveDesign,
    palette: true,
    run: () => runAsyncCommand('Save design', saveCurrentDesign),
    disabled: (state) => !state.hasDesign || !state.designDirty,
  },
  {
    id: 'file.saveAs',
    label: () => t('canvas.file.saveAs'),
    shortcut: FILE_SHORTCUTS.saveDesignAs,
    palette: true,
    run: () => runAsyncCommand('Save design as', saveAsCurrentDesign),
    disabled: (state) => !state.hasDesign,
  },
  {
    id: 'file.exit',
    label: () => t('menu.file.exit'),
    run: () => runAsyncCommand('Close window', () => getCurrentWindow().close()),
  },
  {
    id: 'edit.undo',
    label: () => t('menu.edit.undo'),
    shortcut: EDIT_SHORTCUTS.undo,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.history.undo()),
    disabled: (state) => !state.canvas || !state.canvas.history.canUndo.value,
  },
  {
    id: 'edit.redo',
    label: () => t('menu.edit.redo'),
    shortcut: EDIT_SHORTCUTS.redo,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.history.redo()),
    disabled: (state) => !state.canvas || !state.canvas.history.canRedo.value,
  },
  {
    id: 'view.zoomIn',
    label: () => t('menu.view.zoomIn'),
    shortcut: VIEW_SHORTCUTS.zoomIn,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.viewport.zoomIn()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'view.zoomOut',
    label: () => t('menu.view.zoomOut'),
    shortcut: VIEW_SHORTCUTS.zoomOut,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.viewport.zoomOut()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'view.fitToContent',
    label: () => t('menu.view.fitToContent'),
    shortcut: VIEW_SHORTCUTS.fitToContent,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.viewport.zoomToFit()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'help.reportProblem',
    label: () => t('menu.help.reportProblem'),
    palette: true,
    run: showProblemReportDialog,
  },
  {
    id: 'nav.canvas',
    label: () => t('commands.canvas'),
    shortcut: PANEL_SHORTCUTS.canvas,
    palette: true,
    run: () => switchPanel('canvas'),
  },
  {
    id: 'nav.location',
    label: () => t('canvas.location.title'),
    palette: true,
    run: () => switchPanel('location'),
    disabled: (state) => !state.hasDesign,
  },
  {
    id: 'nav.plantDb',
    label: () => t('commands.plantDb'),
    shortcut: PANEL_SHORTCUTS.plantDb,
    palette: true,
    run: () => switchPanel('plant-db'),
  },
  {
    id: 'nav.favorites',
    label: () => t('nav.favorites'),
    palette: true,
    run: () => switchPanel('favorites'),
    disabled: (state) => !state.hasDesign,
  },
  {
    id: 'view.toggleTheme',
    label: () => t('commands.toggleTheme'),
    palette: true,
    run: cycleTheme,
  },
  {
    id: 'canvas.tool.select',
    label: () => t('canvas.tools.select'),
    shortcut: TOOL_SHORTCUTS.select,
    palette: true,
    run: () => switchTool('select'),
  },
  {
    id: 'canvas.tool.hand',
    label: () => t('canvas.tools.hand'),
    shortcut: TOOL_SHORTCUTS.hand,
    palette: true,
    run: () => switchTool('hand'),
  },
  {
    id: 'canvas.tool.line',
    label: () => t('canvas.tools.line'),
    shortcut: TOOL_SHORTCUTS.line,
    palette: true,
    run: () => switchTool('line'),
  },
  {
    id: 'canvas.tool.rectangle',
    label: () => t('canvas.tools.rectangle'),
    shortcut: TOOL_SHORTCUTS.rectangle,
    palette: true,
    run: () => switchTool('rectangle'),
  },
  {
    id: 'canvas.tool.ellipse',
    label: () => t('canvas.tools.ellipse'),
    shortcut: TOOL_SHORTCUTS.ellipse,
    palette: true,
    run: () => switchTool('ellipse'),
  },
  {
    id: 'canvas.tool.polygon',
    label: () => t('canvas.tools.polygon'),
    shortcut: TOOL_SHORTCUTS.polygon,
    palette: true,
    run: () => switchTool('polygon'),
  },
  {
    id: 'canvas.tool.text',
    label: () => t('canvas.tools.text'),
    shortcut: TOOL_SHORTCUTS.text,
    palette: true,
    run: () => switchTool('text'),
  },
  {
    id: 'canvas.tool.objectStamp',
    label: () => t('canvas.tools.objectStamp'),
    palette: true,
    run: () => switchTool('object-stamp'),
  },
  {
    id: 'canvas.tool.plantSpacing',
    label: () => t('canvas.tools.plantSpacing'),
    shortcut: TOOL_SHORTCUTS.plantSpacing,
    palette: true,
    run: () => switchTool('plant-spacing'),
  },
  {
    id: 'canvas.toggleGrid',
    label: () => t('canvas.grid.grid'),
    run: (state) => runCanvas(state, (canvas) => canvas.chrome.toggleGrid()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.toggleSnapToGrid',
    label: () => t('canvas.grid.snapToGrid'),
    run: (state) => runCanvas(state, (canvas) => canvas.chrome.toggleSnapToGrid()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.toggleRulers',
    label: () => t('canvas.grid.rulers'),
    run: (state) => runCanvas(state, (canvas) => canvas.chrome.toggleRulers()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.copy',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.copy()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.paste',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.paste()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.duplicateSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.duplicateSelected()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.deleteSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.deleteSelected()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.selectAll',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.selectAll()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.bringToFront',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.bringToFront()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.sendToBack',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.sendToBack()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.lockOrUnlockSelected',
    run: (state) => runCanvas(state, (canvas) => {
      if (state.canvasHasSelection) canvas.sceneEdits.lockSelected()
      else canvas.sceneEdits.unlockSelected()
    }),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.groupSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.groupSelected()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.ungroupSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.ungroupSelected()),
    disabled: (state) => !state.canvas,
  },
]

const commandById = new Map<AppCommandId, AppCommandDefinition>(
  APP_COMMANDS.map((command) => [command.id, command]),
)

export function getAppCommandDefinition(id: AppCommandId): AppCommandDefinition | null {
  return commandById.get(id) ?? null
}

export function isCatalogCommandDisabled(id: AppCommandId): boolean {
  const command = getAppCommandDefinition(id)
  if (!command) return true
  const state = readAppCommandState()
  return command.disabled?.(state) ?? false
}

export function runCatalogCommand(id: AppCommandId): boolean {
  const command = getAppCommandDefinition(id)
  if (!command) return false
  const state = readAppCommandState()
  if (command.disabled?.(state)) return false
  command.run(state)
  return true
}
