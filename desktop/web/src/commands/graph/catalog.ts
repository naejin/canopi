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
  composeShellCommandCatalog,
  type ShellCommandCatalogEntry,
  type ShellCommandIdForCapability,
  type ShellCommandState,
} from '../../app/shell-commands'
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
import { activePanel, navigateTo, sidePanel, type Panel } from '../../app/shell/state'
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
import { VIEW_SHORTCUTS } from '../../shortcuts/definitions'

type NonToolbarAppCommandId =
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fitToContent'
  | 'help.aboutCanopi'
  | 'help.reportProblem'
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

type DesktopShellCapabilityId =
  | 'newDesign'
  | 'openDesign'
  | 'saveDesign'
  | 'saveDesignAs'
  | 'exitApp'
  | 'navigateCanvas'
  | 'navigateLocation'
  | 'navigatePlantDatabase'
  | 'navigateFavorites'
  | 'navigateDesignNotebook'
  | 'toggleTheme'

export type DesktopShellCommandId = ShellCommandIdForCapability<DesktopShellCapabilityId>

export type AppCommandId = NonToolbarAppCommandId | DesktopShellCommandId | CanvasCommandId

export interface AppCommandState extends ShellCommandState {
  readonly canvas: CanvasCommandSurface | null
  readonly canvasHasSelection: boolean
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
    shortcut: definition.displayShortcut,
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

export const DESKTOP_SHELL_COMMAND_CATALOG = composeShellCommandCatalog({
  newDesign: {
    execute: () => runAsyncCommand('New design', newDesignAction),
  },
  openDesign: {
    execute: () => runAsyncCommand('Open design', openDesign),
  },
  saveDesign: {
    execute: () => runAsyncCommand('Save design', saveCurrentDesign),
    isExecutionDisabled: (state) => !state.hasDesign || !state.designDirty,
  },
  saveDesignAs: {
    execute: () => runAsyncCommand('Save design as', saveAsCurrentDesign),
    isExecutionDisabled: (state) => !state.hasDesign,
  },
  exitApp: {
    execute: () => runAsyncCommand('Close window', () => getCurrentWindow().close()),
  },
  navigateCanvas: {
    execute: () => switchPanel('canvas'),
  },
  navigateLocation: {
    execute: () => switchPanel('location'),
    isExecutionDisabled: (state) => !state.hasDesign,
  },
  navigatePlantDatabase: {
    execute: () => switchPanel('plant-db'),
    isProjectionDisabled: (state) =>
      !(state.activePanel === 'canvas' && state.sidePanel === 'plant-db')
        && !state.hasDesign,
  },
  navigateFavorites: {
    execute: () => switchPanel('favorites'),
    isExecutionDisabled: (state) => !state.hasDesign,
  },
  navigateDesignNotebook: {
    execute: () => switchPanel('design-notebook'),
  },
  toggleTheme: {
    execute: cycleTheme,
  },
})

function shellAppCommandDefinition(
  command: ShellCommandCatalogEntry<DesktopShellCommandId>,
): AppCommandDefinition {
  return {
    id: command.id,
    label: () => t(command.labelKey),
    shortcut: command.shortcut,
    palette: command.palette,
    run: () => command.execute(),
    disabled: (state) => command.isExecutionDisabled(state),
  }
}

function desktopShellAppCommands(
  family: ShellCommandCatalogEntry['family'],
): readonly AppCommandDefinition[] {
  return DESKTOP_SHELL_COMMAND_CATALOG
    .filter((command) => command.family === family)
    .map(shellAppCommandDefinition)
}

const DESKTOP_FILE_COMMANDS = desktopShellAppCommands('file')
const DESKTOP_NAVIGATION_COMMANDS = desktopShellAppCommands('navigation')
const DESKTOP_SETTINGS_COMMANDS = desktopShellAppCommands('settings')

export const APP_COMMANDS: readonly AppCommandDefinition[] = [
  ...DESKTOP_FILE_COMMANDS,
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
  ...DESKTOP_NAVIGATION_COMMANDS,
  ...DESKTOP_SETTINGS_COMMANDS,
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
