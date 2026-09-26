import { canvasPdf, canExportCanvasPdf } from '../app/canvas-pdf/live'
import { navigateTo, type Panel, type SidePanel } from '../app/shell/state'
import {
  composeShellCommandCatalog,
  projectShellCommandCatalog,
  type ProjectedShellCommand,
  type ShellChromeProjection,
  type ShellCommandCatalogEntry,
  type ShellCommandIdForCapability,
  type ShellCommandState,
} from '../app/shell-commands'
import { composeWorkspaceMenus, type MenuDefinition } from '../app/shell-commands/menus'
import { createWorkspaceShellCapabilities } from '../app/workspace-commands/capabilities'
import type { CanvasCommandProjection } from '../app/canvas-commands'
import { t } from '../i18n'
import type { DesignSaveStatus } from '../app/document-session/continuous-save'
import type { GeoJsonWorkflow } from '../app/geojson/workflow'

export type { MenuDefinition } from '../app/shell-commands/menus'

type BrowserShellCapabilityId =
  | 'newDesign'
  | 'openCanopi'
  | 'renameDesign'
  | 'downloadCanopi'
  | 'revertDesign'
  | 'importGeoJson'
  | 'exportCanvasPdf'
  | 'exportGeoJson'
  | 'openSettings'
  | 'findPlants'
  | 'navigateCanvas'
  | 'navigateTemplates'
  | 'navigateLayers'
  | 'navigateData'
  | 'navigateSpeciesKey'
  | 'navigatePlantDatabase'
  | 'navigateFavorites'
  | 'navigateCalendar'
  | 'navigateBudget'
  | 'navigateConsortium'
  | 'toggleToolNames'
  | 'showSatellite'
  | 'showMap'
  | 'showNoBackground'
  | 'toggleTheme'
  | 'showShortcuts'
  | 'aboutCanopi'

export type BrowserShellCommandId = ShellCommandIdForCapability<BrowserShellCapabilityId>

export type BrowserShellProjectedCommand = ProjectedShellCommand<BrowserShellCommandId>
export type BrowserShellCatalog = readonly ShellCommandCatalogEntry<BrowserShellCommandId>[]

export interface BrowserShellChromeProjection extends ShellChromeProjection<BrowserShellCommandId> {
  /** File, Edit, View, Tools and Help, ready to render. */
  readonly workspaceMenus: readonly MenuDefinition[]
}

export interface BrowserShellDesignIdentity {
  readonly name: string
  readonly saveStatus: DesignSaveStatus
  readonly saveFailureReason: string | null
}

export interface BrowserShellCapabilities {
  newDesign(): void
  openCanopi(): void
  downloadCanopi(): void
  revertDesign(): void
  importGeoJson(): void
  exportGeoJson(): void
  navigate(panel: Panel): void
}

export interface BrowserDesignShellCommands {
  newDesign(): Promise<void>
  openCanopi(): Promise<boolean>
  downloadCanopi(): Promise<void>
  revertDesign(): Promise<unknown>
}

/**
 * A browser keeps these for itself (new window, tab switching), so the Web
 * Edition neither shows nor listens for them.
 */
export const BROWSER_RESERVED_SHORTCUTS: ReadonlySet<string> = new Set([
  'Ctrl+N',
  'Ctrl+Q',
  'Ctrl+1',
  'Ctrl+2',
  'Ctrl+3',
  'Ctrl+4',
  'Ctrl+5',
  'Ctrl+6',
  'Ctrl+7',
  'Ctrl+8',
])

export function createBrowserShellCapabilities(
  commands: BrowserDesignShellCommands,
  onError: (error: unknown) => void,
  geoJson: Pick<GeoJsonWorkflow, 'importGeoJson' | 'exportGeoJson'>,
): BrowserShellCapabilities {
  return {
    newDesign: () => runBrowserDesignCommand(() => commands.newDesign(), onError),
    openCanopi: () => runBrowserDesignCommand(() => commands.openCanopi(), onError),
    downloadCanopi: () => runBrowserDesignCommand(() => commands.downloadCanopi(), onError),
    revertDesign: () => runBrowserDesignCommand(() => commands.revertDesign(), onError),
    importGeoJson: () => runBrowserDesignCommand(() => geoJson.importGeoJson(), onError),
    exportGeoJson: () => runBrowserDesignCommand(() => geoJson.exportGeoJson(), onError),
    navigate: navigateTo,
  }
}

export interface BrowserShellCatalogOptions {
  readonly templatesEnabled: boolean
  /** A Design is open in a mounted canvas runtime (GeoJSON needs one). */
  readonly canvasReady: () => boolean
}

/** The Web Edition command catalog; availability reads the live state it is given. */
export function createBrowserShellCatalog(
  capabilities: BrowserShellCapabilities,
  { templatesEnabled, canvasReady }: BrowserShellCatalogOptions,
): BrowserShellCatalog {
  const designPanel = (panel: SidePanel) => ({
    execute: () => capabilities.navigate(panel),
    isExecutionDisabled: (state: ShellCommandState) => !state.hasDesign && state.sidePanel !== panel,
  })
  const needsDesign = (state: ShellCommandState) => !state.hasDesign
  return composeShellCommandCatalog({
    ...createWorkspaceShellCapabilities(),
    newDesign: { execute: () => capabilities.newDesign() },
    openCanopi: { execute: () => capabilities.openCanopi() },
    downloadCanopi: {
      execute: () => capabilities.downloadCanopi(),
      isExecutionDisabled: needsDesign,
    },
    revertDesign: {
      execute: () => capabilities.revertDesign(),
      isExecutionDisabled: (state) => !state.hasDesign || !state.revertAvailable,
    },
    importGeoJson: {
      execute: () => capabilities.importGeoJson(),
      isExecutionDisabled: (state) => !state.hasDesign || !canvasReady(),
    },
    exportCanvasPdf: {
      execute: () => canvasPdf.show(),
      isExecutionDisabled: () => !canExportCanvasPdf(),
    },
    exportGeoJson: {
      execute: () => capabilities.exportGeoJson(),
      isExecutionDisabled: (state) => !state.hasDesign || !canvasReady(),
    },
    navigateCanvas: { execute: () => capabilities.navigate('canvas') },
    ...(templatesEnabled
      ? { navigateTemplates: { execute: () => capabilities.navigate('templates') } }
      : {}),
    navigateLayers: designPanel('layers'),
    navigateData: designPanel('data'),
    navigateSpeciesKey: designPanel('species-key'),
    navigatePlantDatabase: { execute: () => capabilities.navigate('plant-db') },
    navigateFavorites: { execute: () => capabilities.navigate('favorites') },
    navigateCalendar: designPanel('calendar'),
    navigateBudget: designPanel('budget'),
    navigateConsortium: designPanel('consortium'),
  })
}

export interface BrowserShellProjectionInput {
  readonly catalog: BrowserShellCatalog
  readonly state: ShellCommandState
  readonly canvas: CanvasCommandProjection
}

export function createBrowserShellCommandProjection({
  catalog,
  state,
  canvas,
}: BrowserShellProjectionInput): BrowserShellChromeProjection {
  const shell = projectShellCommandCatalog(catalog, state, t, {
    unavailableShortcuts: BROWSER_RESERVED_SHORTCUTS,
  })
  return {
    ...shell,
    workspaceMenus: composeWorkspaceMenus({ shell, canvas, translate: t }),
  }
}

function runBrowserDesignCommand(
  command: () => Promise<unknown>,
  onError: (error: unknown) => void,
): void {
  try {
    void command().catch(onError)
  } catch (error) {
    onError(error)
  }
}
