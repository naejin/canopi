import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  canvasCommandDefinitions,
  createCanvasCommandProjection,
  dispatchCanvasCommandIntent,
  isCanvasCommandDisabled,
  type CanvasCommandDefinition,
  type CanvasCommandId,
  type CanvasCommandIntent,
  type CanvasCommandIntentAdapter,
  type CanvasCommandProjection,
  type CanvasCommandProjectionState,
  type CanvasToolId,
} from '../../app/canvas-commands'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../../app/canvas-settings/signals'
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
import { openAboutCanopiDialog } from '../../app/about/state'
import { mutateSettingsProjection } from '../../app/settings/projection'
import {
  currentCanvasHasSelection,
  currentCanvasTool,
  getCurrentCanvasCommandSurface,
  setCurrentCanvasTool,
} from '../../canvas/session'
import type { CanvasCommandSurface } from '../../canvas/runtime/runtime'
import { t } from '../../i18n'
import {
  FILE_SHORTCUTS,
  PANEL_SHORTCUTS,
  VIEW_SHORTCUTS,
} from '../../shortcuts/definitions'

type NonToolbarAppCommandId =
  | 'file.new'
  | 'file.open'
  | 'file.save'
  | 'file.saveAs'
  | 'file.exit'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fitToContent'
  | 'help.aboutCanopi'
  | 'help.reportProblem'
  | 'nav.canvas'
  | 'nav.location'
  | 'nav.plantDb'
  | 'nav.favorites'
  | 'nav.designNotebook'
  | 'view.toggleTheme'
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

export type AppCommandId = NonToolbarAppCommandId | CanvasCommandId

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

function switchTool(tool: CanvasToolId): void {
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

function showAboutCanopiDialog(): void {
  openAboutCanopiDialog()
}

function runCanvas(
  state: AppCommandState,
  command: (canvas: CanvasCommandSurface) => void,
): void {
  if (state.canvas) command(state.canvas)
}

function canvasProjectionState(state: AppCommandState): CanvasCommandProjectionState {
  return {
    activeTool: currentCanvasTool.value,
    toolSelectionAvailable: true,
    canUndo: state.canvas?.history.canUndo.value ?? false,
    canRedo: state.canvas?.history.canRedo.value ?? false,
    settingsAvailable: state.canvas !== null,
    gridVisible: gridVisible.value,
    snapToGridEnabled: snapToGridEnabled.value,
    rulersVisible: rulersVisible.value,
  }
}

function desktopCanvasIntentAdapter(state: AppCommandState): CanvasCommandIntentAdapter {
  return {
    selectTool: switchTool,
    undo: () => runCanvas(state, (canvas) => canvas.history.undo()),
    redo: () => runCanvas(state, (canvas) => canvas.history.redo()),
    toggleGrid: () => runCanvas(state, (canvas) => canvas.chrome.toggleGrid()),
    toggleSnapToGrid: () => runCanvas(state, (canvas) => canvas.chrome.toggleSnapToGrid()),
    toggleRulers: () => runCanvas(state, (canvas) => canvas.chrome.toggleRulers()),
  }
}

function dispatchCurrentDesktopCanvasIntent(intent: CanvasCommandIntent): void {
  const state = readAppCommandState()
  if (isCanvasCommandDisabled(intent, canvasProjectionState(state))) return
  dispatchCanvasCommandIntent(intent, desktopCanvasIntentAdapter(state))
}

function liveDesktopCanvasIntentAdapter(): CanvasCommandIntentAdapter {
  return {
    selectTool: (tool) => dispatchCurrentDesktopCanvasIntent({ type: 'select-tool', tool }),
    undo: () => dispatchCurrentDesktopCanvasIntent({ type: 'undo' }),
    redo: () => dispatchCurrentDesktopCanvasIntent({ type: 'redo' }),
    toggleGrid: () => dispatchCurrentDesktopCanvasIntent({ type: 'toggle-grid' }),
    toggleSnapToGrid: () => dispatchCurrentDesktopCanvasIntent({ type: 'toggle-snap-to-grid' }),
    toggleRulers: () => dispatchCurrentDesktopCanvasIntent({ type: 'toggle-rulers' }),
  }
}

function canvasAppCommandDefinition(
  definition: CanvasCommandDefinition,
): AppCommandDefinition {
  return {
    id: definition.commandId,
    label: () => t(definition.labelKey),
    shortcut: definition.shortcut,
    palette: definition.palette,
    run: (state) => dispatchCanvasCommandIntent(
      definition.intent,
      desktopCanvasIntentAdapter(state),
    ),
    disabled: (state) => isCanvasCommandDisabled(
      definition.intent,
      canvasProjectionState(state),
    ),
  }
}

const CANVAS_HISTORY_COMMANDS = canvasCommandDefinitions
  .filter((definition) => definition.kind === 'history')
  .map(canvasAppCommandDefinition)

const CANVAS_TOOL_AND_SETTINGS_COMMANDS = canvasCommandDefinitions
  .filter((definition) => definition.kind !== 'history')
  .map(canvasAppCommandDefinition)

export function createDesktopCanvasCommandProjection(
  state: AppCommandState,
): CanvasCommandProjection {
  return createCanvasCommandProjection({
    state: canvasProjectionState(state),
    intents: liveDesktopCanvasIntentAdapter(),
    translate: t,
  })
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
  ...CANVAS_HISTORY_COMMANDS,
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
    id: 'help.aboutCanopi',
    label: () => t('menu.help.aboutCanopi'),
    palette: true,
    run: showAboutCanopiDialog,
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
    id: 'nav.designNotebook',
    label: () => t('nav.designNotebook'),
    palette: true,
    run: () => switchPanel('design-notebook'),
  },
  {
    id: 'view.toggleTheme',
    label: () => t('commands.toggleTheme'),
    palette: true,
    run: cycleTheme,
  },
  ...CANVAS_TOOL_AND_SETTINGS_COMMANDS,
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
    run: (state) => runCanvas(state, (canvas) => canvas.sceneEdits.lockSelected()),
    disabled: (state) => !state.canvas || !state.canvasHasSelection,
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
