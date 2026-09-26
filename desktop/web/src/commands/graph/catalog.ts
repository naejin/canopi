import { canvasPdf, canExportCanvasPdf } from '../../app/canvas-pdf/live'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  canvasCommandDefinitions,
  dispatchCanvasCommandIntent,
  isCanvasCommandDisabled,
  type CanvasCommandDefinition,
  type CanvasCommandId,
  type CanvasCommandProjection,
} from '../../app/canvas-commands'
import {
  composeShellCommandCatalog,
  type ShellCommandCatalogEntry,
  type ShellCommandIdForCapability,
  type ShellCommandState,
} from '../../app/shell-commands'
import { formatShortcut } from '../../app/shell-commands/shortcut-text'
import { currentDesign } from '../../app/document-session/store'
import { desktopGeoJsonWorkflow as desktopGeoJson } from '../../platform/geojson.desktop'
import {
  designRevertAvailable,
  newDesignAction,
  openDesign,
  revertDesign,
  saveAsCurrentDesign,
  saveCurrentDesign,
} from '../../app/document-session/actions'
import { activePanel, navigateTo, sidePanel, type Panel } from '../../app/shell/state'
import {
  diagnosticMessageFromError,
  recordFrontendDiagnostic,
} from '../../app/problem-report/diagnostics'
import { openProblemReportDialog } from '../../app/problem-report/submission'
import { createWorkspaceShellCapabilities } from '../../app/workspace-commands/capabilities'
import {
  readWorkspaceCanvasProjectionState,
  workspaceCanvasCommandProjection,
  workspaceCanvasIntentAdapter,
} from '../../app/workspace-commands/canvas-actions'
import { t } from '../../i18n'

type DesktopShellCapabilityId =
  | 'newDesign'
  | 'openDesign'
  | 'renameDesign'
  | 'saveDesign'
  | 'saveDesignAs'
  | 'revertDesign'
  | 'importGeoJson'
  | 'exportCanvasPdf'
  | 'exportGeoJson'
  | 'openSettings'
  | 'findPlants'
  | 'exitApp'
  | 'navigateCanvas'
  | 'navigateLayers'
  | 'navigateData'
  | 'navigateSpeciesKey'
  | 'navigatePlantDatabase'
  | 'navigateFavorites'
  | 'navigateCalendar'
  | 'navigateBudget'
  | 'navigateConsortium'
  | 'navigateDesignNotebook'
  | 'toggleToolNames'
  | 'showSatellite'
  | 'showMap'
  | 'showNoBackground'
  | 'toggleTheme'
  | 'showShortcuts'
  | 'reportProblem'
  | 'aboutCanopi'

export type DesktopShellCommandId = ShellCommandIdForCapability<DesktopShellCapabilityId>

export type AppCommandId = DesktopShellCommandId | CanvasCommandId

export interface AppCommandState extends ShellCommandState {}

export interface AppCommandDefinition {
  readonly id: AppCommandId
  readonly label: () => string
  /** Display text, e.g. "Ctrl Shift S". */
  readonly shortcut?: string
  readonly palette: boolean
  readonly run: (state: AppCommandState) => void
  readonly disabled?: (state: AppCommandState) => boolean
}

export function readAppCommandState(): AppCommandState {
  return {
    hasDesign: currentDesign.value !== null,
    revertAvailable: designRevertAvailable.value,
    activePanel: activePanel.value,
    sidePanel: sidePanel.value,
  }
}

function canvasAppCommandDefinition(
  definition: CanvasCommandDefinition,
): AppCommandDefinition {
  const shortcut = definition.shortcuts?.[0]
  return {
    id: definition.commandId,
    label: () => t(definition.labelKey),
    shortcut: shortcut ? formatShortcut(shortcut, t) : undefined,
    palette: definition.palette,
    run: () => dispatchCanvasCommandIntent(definition.intent, workspaceCanvasIntentAdapter),
    disabled: () => isCanvasCommandDisabled(definition.intent, readWorkspaceCanvasProjectionState()),
  }
}

export function createDesktopCanvasCommandProjection(): CanvasCommandProjection {
  return workspaceCanvasCommandProjection.value
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

function isGeoJsonTransferDisabled(state: { readonly hasDesign: boolean }): boolean {
  return !state.hasDesign || !desktopGeoJson.isAvailable()
}

function designPanel(panel: Panel) {
  return {
    execute: () => navigateTo(panel),
    // An open panel can always close, even after its Design went away.
    isExecutionDisabled: (state: ShellCommandState) => !state.hasDesign && state.sidePanel !== panel,
  }
}

export const DESKTOP_SHELL_COMMAND_CATALOG = composeShellCommandCatalog({
  ...createWorkspaceShellCapabilities(),
  newDesign: {
    execute: () => runAsyncCommand('New design', newDesignAction),
  },
  openDesign: {
    execute: () => runAsyncCommand('Open design', openDesign),
  },
  saveDesign: {
    execute: () => runAsyncCommand('Save design', saveCurrentDesign),
    isExecutionDisabled: (state) => !state.hasDesign,
  },
  saveDesignAs: {
    execute: () => runAsyncCommand('Save design as', saveAsCurrentDesign),
    isExecutionDisabled: (state) => !state.hasDesign,
  },
  revertDesign: {
    execute: () => runAsyncCommand('Revert design', revertDesign),
    isExecutionDisabled: (state) => !state.hasDesign || !state.revertAvailable,
  },
  importGeoJson: {
    execute: () => runAsyncCommand('Import GeoJSON', desktopGeoJson.importGeoJson),
    isExecutionDisabled: isGeoJsonTransferDisabled,
  },
  exportCanvasPdf: {
    execute: () => canvasPdf.show(),
    isExecutionDisabled: () => !canExportCanvasPdf(),
  },
  exportGeoJson: {
    execute: () => runAsyncCommand('Export GeoJSON', desktopGeoJson.exportGeoJson),
    isExecutionDisabled: isGeoJsonTransferDisabled,
  },
  exitApp: {
    execute: () => runAsyncCommand('Close window', () => getCurrentWindow().close()),
  },
  navigateCanvas: {
    execute: () => navigateTo('canvas'),
  },
  navigateLayers: designPanel('layers'),
  navigateData: designPanel('data'),
  navigateSpeciesKey: designPanel('species-key'),
  navigatePlantDatabase: {
    // The catalog runs from the start screen; the rail offers it with a Design.
    execute: () => navigateTo('plant-db'),
    isProjectionDisabled: (state) => !state.hasDesign && state.sidePanel !== 'plant-db',
  },
  navigateFavorites: designPanel('favorites'),
  navigateCalendar: designPanel('calendar'),
  navigateBudget: designPanel('budget'),
  navigateConsortium: designPanel('consortium'),
  navigateDesignNotebook: {
    execute: () => navigateTo('design-notebook'),
  },
  reportProblem: { execute: openProblemReportDialog },
})

function shellAppCommandDefinition(
  command: ShellCommandCatalogEntry<DesktopShellCommandId>,
): AppCommandDefinition {
  return {
    id: command.id,
    label: () => t(command.labelKey),
    shortcut: command.shortcut ? formatShortcut(command.shortcut, t) : undefined,
    palette: command.palette,
    run: () => command.execute(),
    disabled: (state) => command.isExecutionDisabled(state),
  }
}

export const APP_COMMANDS: readonly AppCommandDefinition[] = [
  ...DESKTOP_SHELL_COMMAND_CATALOG.map(shellAppCommandDefinition),
  ...canvasCommandDefinitions.map(canvasAppCommandDefinition),
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
