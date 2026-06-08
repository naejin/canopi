import { computed } from '@preact/signals'
import type { Panel } from '../../app/shell/state'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../../app/canvas-settings/signals'
import { locale } from '../../app/settings/state'
import { currentCanvasTool } from '../../canvas/session'
import { t } from '../../i18n'
import {
  APP_COMMANDS,
  getAppCommandDefinition,
  isCatalogCommandDisabled,
  readAppCommandState,
  runCatalogCommand,
  type AppCommandDefinition,
  type AppCommandId,
  type AppCommandState,
} from './catalog'

type AppMenuId = 'file' | 'edit' | 'view' | 'help'

export interface Command {
  id: AppCommandId
  label: () => string
  shortcut?: string
  disabled: () => boolean
  action: () => void
}

export interface MenuAction {
  type: 'action'
  id: AppCommandId
  label: string
  shortcut?: string
  action: () => void
  disabled: boolean
}

export interface MenuSeparator {
  type: 'separator'
}

export type MenuEntry = MenuAction | MenuSeparator

export interface MenuDefinition {
  id: AppMenuId
  label: string
  items: MenuEntry[]
}

export interface AppCommandGraphChromeProjection {
  readonly menus: MenuDefinition[]
  readonly paletteCommands: Command[]
}

export interface AppCommandGraphPanelCommand {
  readonly panel: Panel
  readonly commandId: AppCommandId
  readonly label: string
  readonly shortcut?: string
  readonly disabled: boolean
  readonly active: boolean
  readonly action: () => void
}

export interface AppCommandGraphPanelProjection {
  readonly primary: AppCommandGraphPanelCommand[]
  readonly side: AppCommandGraphPanelCommand[]
}

export interface AppCommandGraphToolbarToolCommand {
  readonly tool: string
  readonly commandId: AppCommandId
  readonly label: string
  readonly description: string
  readonly shortcut?: string
  readonly active: boolean
  readonly disabled: boolean
  readonly action: () => void
}

export interface AppCommandGraphToolbarActionCommand {
  readonly id: string
  readonly commandId: AppCommandId
  readonly label: string
  readonly description?: string
  readonly shortcut?: string
  readonly disabled: boolean
  readonly pressed?: boolean
  readonly action: () => void
}

export interface AppCommandGraphToolbarProjection {
  readonly primaryTools: AppCommandGraphToolbarToolCommand[]
  readonly shapeTools: AppCommandGraphToolbarToolCommand[]
  readonly historyActions: AppCommandGraphToolbarActionCommand[]
  readonly settingsToggles: AppCommandGraphToolbarActionCommand[]
}

const MENU_ORDER: readonly AppMenuId[] = ['file', 'edit', 'view', 'help']
const MENU_COMMAND_ORDER: Record<AppMenuId, readonly (AppCommandId | 'separator')[]> = {
  file: [
    'file.new',
    'file.open',
    'separator',
    'file.save',
    'file.saveAs',
    'separator',
    'file.exit',
  ],
  edit: ['edit.undo', 'edit.redo'],
  view: ['view.zoomIn', 'view.zoomOut', 'view.fitToContent'],
  help: ['help.reportProblem'],
}

const MENU_LABELS: Record<AppMenuId, () => string> = {
  file: () => t('menu.file'),
  edit: () => t('menu.edit'),
  view: () => t('menu.view'),
  help: () => t('menu.help'),
}

const PANEL_COMMAND_GROUPS = {
  primary: [
    { panel: 'canvas', commandId: 'nav.canvas' },
    { panel: 'location', commandId: 'nav.location' },
  ],
  side: [
    { panel: 'plant-db', commandId: 'nav.plantDb' },
    { panel: 'favorites', commandId: 'nav.favorites' },
  ],
} as const satisfies Record<string, readonly { panel: Panel, commandId: AppCommandId }[]>

const PANEL_LABELS: Record<Panel, () => string> = {
  canvas: () => t('nav.canvas'),
  location: () => t('canvas.location.title'),
  'plant-db': () => t('nav.plantDb'),
  favorites: () => t('nav.favorites'),
}

const TOOLBAR_PRIMARY_TOOLS = [
  { tool: 'select', commandId: 'canvas.tool.select', description: () => t('canvas.tools.selectDesc') },
  { tool: 'hand', commandId: 'canvas.tool.hand', description: () => t('canvas.tools.handDesc') },
  { tool: 'object-stamp', commandId: 'canvas.tool.objectStamp', description: () => t('canvas.tools.objectStampDesc') },
  { tool: 'plant-spacing', commandId: 'canvas.tool.plantSpacing', description: () => t('canvas.tools.plantSpacingDesc') },
] as const satisfies readonly {
  readonly tool: string
  readonly commandId: AppCommandId
  readonly description: () => string
}[]

const TOOLBAR_SHAPE_TOOLS = [
  { tool: 'rectangle', commandId: 'canvas.tool.rectangle', description: () => t('canvas.tools.rectangleDesc') },
  { tool: 'ellipse', commandId: 'canvas.tool.ellipse', description: () => t('canvas.tools.ellipseDesc') },
  { tool: 'polygon', commandId: 'canvas.tool.polygon', description: () => t('canvas.tools.polygonDesc') },
  { tool: 'text', commandId: 'canvas.tool.text', description: () => t('canvas.tools.textDesc') },
] as const satisfies readonly {
  readonly tool: string
  readonly commandId: AppCommandId
  readonly description: () => string
}[]

const TOOLBAR_HISTORY_ACTIONS = [
  { id: 'undo', commandId: 'edit.undo' },
  { id: 'redo', commandId: 'edit.redo' },
] as const satisfies readonly { readonly id: string, readonly commandId: AppCommandId }[]

const TOOLBAR_SETTINGS_TOGGLES = [
  {
    id: 'grid',
    commandId: 'canvas.toggleGrid',
    description: () => t('canvas.grid.gridDesc'),
    pressed: () => gridVisible.value,
  },
  {
    id: 'snap',
    commandId: 'canvas.toggleSnapToGrid',
    description: () => t('canvas.grid.snapToGridDesc'),
    pressed: () => snapToGridEnabled.value,
  },
  {
    id: 'rulers',
    commandId: 'canvas.toggleRulers',
    description: () => t('canvas.grid.rulersDesc'),
    pressed: () => rulersVisible.value,
  },
] as const satisfies readonly {
  readonly id: string
  readonly commandId: AppCommandId
  readonly description: () => string
  readonly pressed: () => boolean
}[]

function isPanelChromeDisabled(panel: Panel, state: AppCommandState): boolean {
  if (panel === 'canvas') return false
  if (isPanelCommandActive(panel, state)) return false
  return !state.hasDesign
}

function isPanelCommandActive(panel: Panel, state: AppCommandState): boolean {
  if (panel === 'canvas') return state.activePanel === 'canvas' && state.sidePanel === null
  if (panel === 'location') return state.activePanel === 'location'
  return state.activePanel === 'canvas' && state.sidePanel === panel
}

function commandProjection(command: AppCommandDefinition): Command {
  return {
    id: command.id,
    label: command.label!,
    shortcut: command.shortcut,
    disabled: () => isCatalogCommandDisabled(command.id),
    action: () => {
      runCatalogCommand(command.id)
    },
  }
}

export function getAppCommand(id: AppCommandId): Command | null {
  const command = getAppCommandDefinition(id)
  if (!command?.label) return null
  return commandProjection(command)
}

export const commands: Command[] = APP_COMMANDS
  .filter((command) => command.palette && command.label)
  .map(commandProjection)

export const appCommandGraphChromeProjection = computed<AppCommandGraphChromeProjection>(() => {
  void locale.value
  const state = readAppCommandState()
  for (const command of APP_COMMANDS) {
    void (command.disabled?.(state) ?? false)
  }

  return {
    menus: getMenuDefinitions(),
    paletteCommands: commands,
  }
})

function panelCommandProjection(
  entry: { readonly panel: Panel, readonly commandId: AppCommandId },
  state: AppCommandState,
): AppCommandGraphPanelCommand {
  const command = getAppCommandDefinition(entry.commandId)
  if (!command?.label) {
    throw new Error(`Missing panel navigation command '${entry.commandId}'`)
  }
  return {
    panel: entry.panel,
    commandId: entry.commandId,
    label: PANEL_LABELS[entry.panel](),
    shortcut: command.shortcut,
    disabled: isPanelChromeDisabled(entry.panel, state) || (command.disabled?.(state) ?? false),
    active: isPanelCommandActive(entry.panel, state),
    action: () => {
      runCatalogCommand(entry.commandId)
    },
  }
}

export const appCommandGraphPanelProjection = computed<AppCommandGraphPanelProjection>(() => {
  void locale.value
  const state = readAppCommandState()

  return {
    primary: PANEL_COMMAND_GROUPS.primary.map((entry) => panelCommandProjection(entry, state)),
    side: PANEL_COMMAND_GROUPS.side.map((entry) => panelCommandProjection(entry, state)),
  }
})

function toolbarToolProjection(
  entry: {
    readonly tool: string
    readonly commandId: AppCommandId
    readonly description: () => string
  },
  state: AppCommandState,
): AppCommandGraphToolbarToolCommand {
  const command = getAppCommandDefinition(entry.commandId)
  if (!command?.label) {
    throw new Error(`Missing toolbar tool command '${entry.commandId}'`)
  }
  return {
    tool: entry.tool,
    commandId: entry.commandId,
    label: command.label(),
    description: entry.description(),
    shortcut: command.shortcut,
    active: currentCanvasTool.value === entry.tool,
    disabled: command.disabled?.(state) ?? false,
    action: () => {
      runCatalogCommand(entry.commandId)
    },
  }
}

function toolbarActionProjection(
  entry: { readonly id: string, readonly commandId: AppCommandId },
  state: AppCommandState,
): AppCommandGraphToolbarActionCommand {
  const command = getAppCommandDefinition(entry.commandId)
  if (!command?.label) {
    throw new Error(`Missing toolbar action command '${entry.commandId}'`)
  }
  return {
    id: entry.id,
    commandId: entry.commandId,
    label: command.label(),
    shortcut: command.shortcut,
    disabled: command.disabled?.(state) ?? false,
    action: () => {
      runCatalogCommand(entry.commandId)
    },
  }
}

function toolbarToggleProjection(
  entry: {
    readonly id: string
    readonly commandId: AppCommandId
    readonly description: () => string
    readonly pressed: () => boolean
  },
  state: AppCommandState,
): AppCommandGraphToolbarActionCommand {
  const command = getAppCommandDefinition(entry.commandId)
  if (!command?.label) {
    throw new Error(`Missing toolbar toggle command '${entry.commandId}'`)
  }
  return {
    id: entry.id,
    commandId: entry.commandId,
    label: command.label(),
    description: entry.description(),
    disabled: command.disabled?.(state) ?? false,
    pressed: entry.pressed(),
    action: () => {
      runCatalogCommand(entry.commandId)
    },
  }
}

export const appCommandGraphToolbarProjection = computed<AppCommandGraphToolbarProjection>(() => {
  void locale.value
  const state = readAppCommandState()

  return {
    primaryTools: TOOLBAR_PRIMARY_TOOLS.map((entry) => toolbarToolProjection(entry, state)),
    shapeTools: TOOLBAR_SHAPE_TOOLS.map((entry) => toolbarToolProjection(entry, state)),
    historyActions: TOOLBAR_HISTORY_ACTIONS.map((entry) => toolbarActionProjection(entry, state)),
    settingsToggles: TOOLBAR_SETTINGS_TOGGLES.map((entry) => toolbarToggleProjection(entry, state)),
  }
})

export function getMenuDefinitions(): MenuDefinition[] {
  const separator: MenuSeparator = { type: 'separator' }

  return MENU_ORDER.map((menuId): MenuDefinition => {
    return {
      id: menuId,
      label: MENU_LABELS[menuId](),
      items: MENU_COMMAND_ORDER[menuId].map((entry): MenuEntry => {
        if (entry === 'separator') return separator
        const command = getAppCommandDefinition(entry)
        if (!command || !command.label) {
          throw new Error(`Missing app command '${entry}' for menu '${menuId}'`)
        }
        return {
          type: 'action',
          id: command.id,
          label: command.label(),
          shortcut: command.shortcut,
          action: () => {
            runCatalogCommand(command.id)
          },
          disabled: isCatalogCommandDisabled(command.id),
        }
      }),
    }
  })
}
