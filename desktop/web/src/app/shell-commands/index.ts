import type { Panel, SidePanel } from '../shell/state'
import {
  ariaKeyShortcuts,
  formatShortcut,
  matchesShortcut,
  type ShortcutInput,
} from './shortcut-text'

export type ShellCommandIdByCapability = {
  readonly newDesign: 'file.new'
  readonly openDesign: 'file.open'
  readonly openCanopi: 'file.openCanopi'
  readonly renameDesign: 'file.rename'
  readonly saveDesign: 'file.save'
  readonly saveDesignAs: 'file.saveAs'
  readonly downloadCanopi: 'file.downloadCanopi'
  readonly revertDesign: 'file.revert'
  readonly importGeoJson: 'file.importGeoJson'
  readonly exportCanvasPdf: 'file.exportCanvasPdf'
  readonly exportGeoJson: 'file.exportGeoJson'
  readonly openSettings: 'app.settings'
  readonly findPlants: 'edit.findPlants'
  readonly exitApp: 'file.exit'
  readonly navigateCanvas: 'nav.canvas'
  readonly navigateTemplates: 'nav.templates'
  readonly navigateLayers: 'nav.layers'
  readonly navigateData: 'nav.data'
  readonly navigateSpeciesKey: 'nav.speciesKey'
  readonly navigatePlantDatabase: 'nav.plantDb'
  readonly navigateFavorites: 'nav.favorites'
  readonly navigateCalendar: 'nav.calendar'
  readonly navigateBudget: 'nav.budget'
  readonly navigateConsortium: 'nav.consortium'
  readonly navigateDesignNotebook: 'nav.designNotebook'
  readonly toggleToolNames: 'view.toggleToolNames'
  readonly showSatellite: 'view.backgroundSatellite'
  readonly showMap: 'view.backgroundMap'
  readonly showNoBackground: 'view.backgroundNone'
  readonly toggleTheme: 'view.toggleTheme'
  readonly showShortcuts: 'help.shortcuts'
  readonly reportProblem: 'help.reportProblem'
  readonly aboutCanopi: 'help.aboutCanopi'
}

export type ShellCommandCapabilityId = keyof ShellCommandIdByCapability
export type ShellCommandId = ShellCommandIdByCapability[ShellCommandCapabilityId]
export type ShellCommandIdForCapability<
  Capability extends ShellCommandCapabilityId,
> = ShellCommandIdByCapability[Capability]

export type ShellMenuId = 'file' | 'edit' | 'view' | 'help'
export type ShellSubmenuId = 'export' | 'background'
export type ShellPanelGroup = 'primary' | 'design' | 'planning'

export interface ShellCommandState {
  readonly hasDesign: boolean
  /** The current Design changed since it was opened or created. */
  readonly revertAvailable: boolean
  readonly activePanel: Panel
  readonly sidePanel: SidePanel | null
}

export interface ShellCommandCapability {
  execute(): void
  isExecutionDisabled?(state: ShellCommandState): boolean
  isProjectionDisabled?(state: ShellCommandState): boolean
  /** Current value of a checkable command (theme, tool names, background). */
  isChecked?(): boolean
}

export type ShellCommandShortcutInput = ShortcutInput

export type ShellCommandCapabilities = Partial<
  Record<ShellCommandCapabilityId, ShellCommandCapability>
>

interface ShellCommandMenuPlacement {
  readonly id: ShellMenuId
  readonly section: number
  readonly submenu?: ShellSubmenuId
}

export interface ShellCommandCatalogEntry<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly capabilityId: ShellCommandCapabilityId
  readonly id: Id
  readonly family: 'file' | 'navigation' | 'settings' | 'help'
  readonly labelKey: string
  /** Canonical shortcut (`Ctrl+Shift+S`); see `shortcut-text.ts`. */
  readonly shortcut?: string
  readonly palette: boolean
  readonly check?: 'checkbox' | 'radio'
  readonly menu?: ShellCommandMenuPlacement
  readonly panel?: {
    readonly panel: Panel
    readonly group: ShellPanelGroup
    readonly order: number
  }
  execute(): void
  isExecutionDisabled(state: ShellCommandState): boolean
  isProjectionDisabled(state: ShellCommandState): boolean
  isChecked(): boolean | undefined
}

export interface ProjectedShellCommand<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly id: Id
  readonly label: string
  /** Display text, e.g. "Ctrl Shift S". */
  readonly shortcut?: string
  readonly ariaShortcut?: string
  readonly disabled: boolean
  readonly active?: boolean
  readonly checked?: boolean
  readonly check?: 'checkbox' | 'radio'
  readonly submenu?: ShellSubmenuId
  readonly panel?: Panel
  action(): void
}

export interface ShellMenuProjection<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly id: ShellMenuId
  readonly label: string
  readonly sections: readonly (readonly ProjectedShellCommand<Id>[])[]
}

export interface ShellPanelBarProjection<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly primary: readonly ProjectedShellCommand<Id>[]
  readonly design: readonly ProjectedShellCommand<Id>[]
  readonly planning: readonly ProjectedShellCommand<Id>[]
}

export interface ShellChromeProjection<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly commands: ReadonlyMap<Id, ProjectedShellCommand<Id>>
  readonly menus: readonly ShellMenuProjection<Id>[]
  readonly panelBar: ShellPanelBarProjection<Id>
}

export interface ShellProjectionOptions {
  /** Shortcuts the edition cannot receive (a browser keeps Ctrl N or Ctrl 1 for itself). */
  readonly unavailableShortcuts?: ReadonlySet<string>
}

type ShellCommandDescriptor = {
  [Capability in ShellCommandCapabilityId]: Omit<
    ShellCommandCatalogEntry,
    | 'capabilityId'
    | 'id'
    | 'execute'
    | 'isExecutionDisabled'
    | 'isProjectionDisabled'
    | 'isChecked'
  > & {
    readonly capabilityId: Capability
    readonly id: ShellCommandIdByCapability[Capability]
  }
}[ShellCommandCapabilityId]

const file = (section: number, submenu?: ShellSubmenuId): ShellCommandMenuPlacement => ({ id: 'file', section, submenu })
const panel = (panelId: Panel, group: ShellPanelGroup, order: number) => ({ panel: panelId, group, order })

const SHELL_COMMAND_DESCRIPTORS: readonly ShellCommandDescriptor[] = [
  { capabilityId: 'newDesign', id: 'file.new', family: 'file', labelKey: 'menu.file.new', shortcut: 'Ctrl+N', palette: true, menu: file(0) },
  { capabilityId: 'openDesign', id: 'file.open', family: 'file', labelKey: 'menu.file.open', shortcut: 'Ctrl+O', palette: true, menu: file(0) },
  { capabilityId: 'openCanopi', id: 'file.openCanopi', family: 'file', labelKey: 'webShell.openCanopi', shortcut: 'Ctrl+O', palette: true, menu: file(0) },
  { capabilityId: 'renameDesign', id: 'file.rename', family: 'file', labelKey: 'menu.file.rename', shortcut: 'F2', palette: true, menu: file(1) },
  { capabilityId: 'saveDesign', id: 'file.save', family: 'file', labelKey: 'menu.file.save', shortcut: 'Ctrl+S', palette: true, menu: file(1) },
  { capabilityId: 'saveDesignAs', id: 'file.saveAs', family: 'file', labelKey: 'menu.file.saveAs', shortcut: 'Ctrl+Shift+S', palette: true, menu: file(1) },
  { capabilityId: 'downloadCanopi', id: 'file.downloadCanopi', family: 'file', labelKey: 'webShell.downloadCanopi', shortcut: 'Ctrl+S', palette: true, menu: file(1) },
  { capabilityId: 'revertDesign', id: 'file.revert', family: 'file', labelKey: 'menu.file.revert', palette: true, menu: file(1) },
  { capabilityId: 'importGeoJson', id: 'file.importGeoJson', family: 'file', labelKey: 'geojson.import', palette: true, menu: file(2) },
  { capabilityId: 'exportCanvasPdf', id: 'file.exportCanvasPdf', family: 'file', labelKey: 'menu.file.exportPlantingPlan', shortcut: 'Ctrl+P', palette: true, menu: file(2, 'export') },
  { capabilityId: 'exportGeoJson', id: 'file.exportGeoJson', family: 'file', labelKey: 'menu.file.exportGeoJson', palette: true, menu: file(2, 'export') },
  { capabilityId: 'openSettings', id: 'app.settings', family: 'settings', labelKey: 'menu.file.settings', shortcut: 'Ctrl+,', palette: true, menu: file(3) },
  { capabilityId: 'findPlants', id: 'edit.findPlants', family: 'settings', labelKey: 'menu.edit.findPlants', shortcut: 'Ctrl+F', palette: true, menu: { id: 'edit', section: 0 } },
  { capabilityId: 'exitApp', id: 'file.exit', family: 'file', labelKey: 'menu.file.exit', shortcut: 'Ctrl+Q', palette: false, menu: file(4) },
  { capabilityId: 'navigateCanvas', id: 'nav.canvas', family: 'navigation', labelKey: 'panelRail.canvas', palette: false, panel: panel('canvas', 'primary', 0) },
  { capabilityId: 'navigateTemplates', id: 'nav.templates', family: 'navigation', labelKey: 'worldMap.title', palette: false, panel: panel('templates', 'primary', 1) },
  { capabilityId: 'navigateLayers', id: 'nav.layers', family: 'navigation', labelKey: 'panelRail.layers', shortcut: 'Ctrl+1', palette: true, panel: panel('layers', 'design', 0) },
  { capabilityId: 'navigateData', id: 'nav.data', family: 'navigation', labelKey: 'panelRail.data', palette: true, panel: panel('data', 'design', 1) },
  { capabilityId: 'navigateSpeciesKey', id: 'nav.speciesKey', family: 'navigation', labelKey: 'panelRail.plants', shortcut: 'Ctrl+2', palette: true, panel: panel('species-key', 'design', 2) },
  { capabilityId: 'navigatePlantDatabase', id: 'nav.plantDb', family: 'navigation', labelKey: 'panelRail.catalog', shortcut: 'Ctrl+3', palette: true, panel: panel('plant-db', 'design', 3) },
  { capabilityId: 'navigateFavorites', id: 'nav.favorites', family: 'navigation', labelKey: 'panelRail.favorites', shortcut: 'Ctrl+4', palette: true, panel: panel('favorites', 'design', 4) },
  { capabilityId: 'navigateCalendar', id: 'nav.calendar', family: 'navigation', labelKey: 'panelRail.calendar', shortcut: 'Ctrl+5', palette: true, panel: panel('calendar', 'planning', 0) },
  { capabilityId: 'navigateBudget', id: 'nav.budget', family: 'navigation', labelKey: 'panelRail.budget', shortcut: 'Ctrl+6', palette: true, panel: panel('budget', 'planning', 1) },
  { capabilityId: 'navigateConsortium', id: 'nav.consortium', family: 'navigation', labelKey: 'panelRail.consortium', shortcut: 'Ctrl+7', palette: true, panel: panel('consortium', 'planning', 2) },
  { capabilityId: 'navigateDesignNotebook', id: 'nav.designNotebook', family: 'navigation', labelKey: 'panelRail.notebook', shortcut: 'Ctrl+8', palette: true, panel: panel('design-notebook', 'planning', 3) },
  { capabilityId: 'toggleToolNames', id: 'view.toggleToolNames', family: 'settings', labelKey: 'menu.view.toolNames', palette: true, check: 'checkbox', menu: { id: 'view', section: 0 } },
  { capabilityId: 'showSatellite', id: 'view.backgroundSatellite', family: 'settings', labelKey: 'menu.view.backgroundSatellite', palette: true, check: 'radio', menu: { id: 'view', section: 1, submenu: 'background' } },
  { capabilityId: 'showMap', id: 'view.backgroundMap', family: 'settings', labelKey: 'menu.view.backgroundMap', palette: true, check: 'radio', menu: { id: 'view', section: 1, submenu: 'background' } },
  { capabilityId: 'showNoBackground', id: 'view.backgroundNone', family: 'settings', labelKey: 'menu.view.backgroundNone', palette: true, check: 'radio', menu: { id: 'view', section: 1, submenu: 'background' } },
  { capabilityId: 'toggleTheme', id: 'view.toggleTheme', family: 'settings', labelKey: 'menu.view.darkTheme', palette: true, check: 'checkbox', menu: { id: 'view', section: 1 } },
  { capabilityId: 'showShortcuts', id: 'help.shortcuts', family: 'help', labelKey: 'menu.help.shortcuts', shortcut: 'F1', palette: true, menu: { id: 'help', section: 0 } },
  { capabilityId: 'reportProblem', id: 'help.reportProblem', family: 'help', labelKey: 'menu.help.reportProblem', palette: true, menu: { id: 'help', section: 1 } },
  { capabilityId: 'aboutCanopi', id: 'help.aboutCanopi', family: 'help', labelKey: 'menu.help.aboutCanopi', palette: true, menu: { id: 'help', section: 1 } },
]

const MENU_LABEL_KEYS: Record<ShellMenuId, string> = {
  file: 'menu.file',
  edit: 'menu.edit',
  view: 'menu.view',
  help: 'menu.help',
}

export function composeShellCommandCatalog<
  const Capabilities extends ShellCommandCapabilities,
>(
  capabilities: Capabilities,
): readonly ShellCommandCatalogEntry<
  ShellCommandIdForCapability<Extract<keyof Capabilities, ShellCommandCapabilityId>>
>[] {
  const entries: ShellCommandCatalogEntry[] = SHELL_COMMAND_DESCRIPTORS.flatMap((descriptor) => {
    const capability = capabilities[descriptor.capabilityId]
    if (!capability) return []
    return [{
      ...descriptor,
      execute: () => capability.execute(),
      isExecutionDisabled: (state: ShellCommandState) =>
        capability.isExecutionDisabled?.(state) ?? false,
      isProjectionDisabled: (state: ShellCommandState) =>
        capability.isProjectionDisabled?.(state)
          ?? capability.isExecutionDisabled?.(state)
          ?? false,
      isChecked: () => descriptor.check ? capability.isChecked?.() ?? false : undefined,
    }]
  })
  // Entries are emitted only when their descriptor's capability key exists.
  return entries as unknown as readonly ShellCommandCatalogEntry<
    ShellCommandIdForCapability<Extract<keyof Capabilities, ShellCommandCapabilityId>>
  >[]
}

export function projectShellCommandCatalog<Id extends ShellCommandId>(
  catalog: readonly ShellCommandCatalogEntry<Id>[],
  state: ShellCommandState,
  translate: (key: string) => string,
  options: ShellProjectionOptions = {},
): ShellChromeProjection<Id> {
  const commands = new Map<Id, ProjectedShellCommand<Id>>()
  for (const command of catalog) {
    const disabled = command.isProjectionDisabled(state)
    const shortcut = command.shortcut && !options.unavailableShortcuts?.has(command.shortcut)
      ? command.shortcut
      : undefined
    commands.set(command.id, {
      id: command.id,
      label: translate(command.labelKey),
      shortcut: shortcut ? formatShortcut(shortcut, translate) : undefined,
      ariaShortcut: shortcut ? ariaKeyShortcuts(shortcut) : undefined,
      disabled,
      active: command.panel ? isPanelCommandActive(command.panel, state) : undefined,
      checked: command.isChecked(),
      check: command.check,
      submenu: command.menu?.submenu,
      panel: command.panel?.panel,
      action: () => {
        if (!disabled) command.execute()
      },
    })
  }

  const menus: ShellMenuProjection<Id>[] = []
  for (const menuId of ['file', 'edit', 'view', 'help'] as const) {
    const sections = new Map<number, ProjectedShellCommand<Id>[]>()
    for (const command of catalog) {
      if (command.menu?.id !== menuId) continue
      const section = sections.get(command.menu.section) ?? []
      section.push(requireProjectedCommand(commands, command.id))
      sections.set(command.menu.section, section)
    }
    if (sections.size === 0) continue
    menus.push({
      id: menuId,
      label: translate(MENU_LABEL_KEYS[menuId]),
      sections: [...sections.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, section]) => section),
    })
  }

  const panelCommands = (group: ShellPanelGroup) => catalog
    .flatMap((command) => command.panel?.group === group
      ? [{ command, panel: command.panel }]
      : [])
    .sort((left, right) => left.panel.order - right.panel.order)
    .map(({ command }) => requireProjectedCommand(commands, command.id))

  return {
    commands,
    menus,
    panelBar: {
      primary: panelCommands('primary'),
      design: panelCommands('design'),
      planning: panelCommands('planning'),
    },
  }
}

export function matchShellCommandShortcut<Id extends ShellCommandId>(
  catalog: readonly ShellCommandCatalogEntry<Id>[],
  input: ShellCommandShortcutInput,
): ShellCommandCatalogEntry<Id> | null {
  return catalog.find((command) =>
    command.shortcut && matchesShortcut(command.shortcut, input)
  ) ?? null
}

function requireProjectedCommand<Id extends ShellCommandId>(
  commands: ReadonlyMap<Id, ProjectedShellCommand<Id>>,
  id: Id,
): ProjectedShellCommand<Id> {
  const command = commands.get(id)
  if (!command) throw new Error(`Missing projected shell command '${id}'`)
  return command
}

function isPanelCommandActive(
  panelPlacement: NonNullable<ShellCommandCatalogEntry['panel']>,
  state: ShellCommandState,
): boolean {
  if (panelPlacement.group !== 'primary') {
    return state.activePanel === 'canvas' && state.sidePanel === panelPlacement.panel
  }
  if (panelPlacement.panel === 'canvas') {
    return state.activePanel === 'canvas' && state.sidePanel === null
  }
  return state.activePanel === panelPlacement.panel
}
