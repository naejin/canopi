import { computed } from '@preact/signals'
import type {
  CanvasCommandProjection,
  CanvasToolbarActionCommand,
  CanvasToolbarToolCommand,
} from '../../app/canvas-commands'
import type { Panel } from '../../app/shell/state'
import { designNotebookWorkbench } from '../../app/design-notebook'
import { locale } from '../../app/settings/state'
import { t } from '../../i18n'
import {
  APP_COMMANDS,
  createDesktopCanvasCommandProjection,
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
  id: string
  label: string
  shortcut?: string
  action: () => void
  disabled: boolean
}

export interface MenuLabel {
  type: 'label'
  label: string
}

export interface MenuSeparator {
  type: 'separator'
}

export interface MenuSubmenu {
  type: 'submenu'
  id: string
  label: string
  disabled: boolean
  items: MenuAction[]
}

export type MenuEntry = MenuAction | MenuLabel | MenuSeparator | MenuSubmenu

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

export type AppCommandGraphToolbarToolCommand = CanvasToolbarToolCommand
export type AppCommandGraphToolbarActionCommand = CanvasToolbarActionCommand
export type AppCommandGraphToolbarProjection = CanvasCommandProjection

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
  help: ['help.aboutCanopi', 'separator', 'help.reportProblem'],
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
    { panel: 'design-notebook', commandId: 'nav.designNotebook' },
    { panel: 'plant-db', commandId: 'nav.plantDb' },
    { panel: 'favorites', commandId: 'nav.favorites' },
  ],
} as const satisfies Record<string, readonly { panel: Panel, commandId: AppCommandId }[]>

const PANEL_LABELS: Record<Panel, () => string> = {
  canvas: () => t('nav.canvas'),
  location: () => t('canvas.location.title'),
  templates: () => t('worldMap.title'),
  'plant-db': () => t('nav.plantDb'),
  'design-notebook': () => t('nav.designNotebook'),
  favorites: () => t('nav.favorites'),
}

function isPanelChromeDisabled(panel: Panel, state: AppCommandState): boolean {
  if (panel === 'canvas') return false
  if (panel === 'design-notebook') return false
  if (panel === 'templates') return false
  if (isPanelCommandActive(panel, state)) return false
  return !state.hasDesign
}

function isPanelCommandActive(panel: Panel, state: AppCommandState): boolean {
  if (panel === 'canvas') return state.activePanel === 'canvas' && state.sidePanel === null
  if (panel === 'location') return state.activePanel === 'location'
  if (panel === 'templates') return state.activePanel === 'templates'
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

export const appCommandGraphToolbarProjection = computed<AppCommandGraphToolbarProjection>(() => {
  void locale.value
  const state = readAppCommandState()
  return createDesktopCanvasCommandProjection(state)
})

export function getMenuDefinitions(): MenuDefinition[] {
  const separator: MenuSeparator = { type: 'separator' }

  return MENU_ORDER.map((menuId): MenuDefinition => {
    return {
      id: menuId,
      label: MENU_LABELS[menuId](),
      items: menuId === 'file'
        ? getFileMenuEntries(separator)
        : MENU_COMMAND_ORDER[menuId].map((entry) => staticMenuEntry(menuId, entry, separator)),
    }
  })
}

function getFileMenuEntries(separator: MenuSeparator): MenuEntry[] {
  const staticEntries = MENU_COMMAND_ORDER.file.map((entry) => staticMenuEntry('file', entry, separator))
  const recentEntries = designNotebookWorkbench.view.value.recentEntries

  const openIndex = staticEntries.findIndex((entry) => entry.type === 'action' && entry.id === 'file.open')
  if (openIndex < 0) return staticEntries

  const openRecent: MenuSubmenu = {
    type: 'submenu',
    id: 'file.openRecent',
    label: t('designNotebook.openRecent'),
    disabled: recentEntries.length === 0,
    items: recentEntries.slice(0, 5).map((entry): MenuAction => ({
      type: 'action',
      id: `recent:${entry.path}`,
      label: entry.name,
      action: () => {
        void designNotebookWorkbench.openEntry(entry.path)
      },
      disabled: false,
    })),
  }

  return [
    ...staticEntries.slice(0, openIndex + 1),
    openRecent,
    ...staticEntries.slice(openIndex + 1),
  ]
}

function staticMenuEntry(
  menuId: AppMenuId,
  entry: AppCommandId | 'separator',
  separator: MenuSeparator,
): MenuEntry {
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
}
