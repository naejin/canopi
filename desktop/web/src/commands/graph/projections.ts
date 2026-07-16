import { computed } from '@preact/signals'
import type {
  CanvasCommandProjection,
  CanvasToolbarActionCommand,
  CanvasToolbarToolCommand,
} from '../../app/canvas-commands'
import {
  projectShellCommandCatalog,
  type ProjectedShellCommand,
} from '../../app/shell-commands'
import type { Panel } from '../../app/shell/state'
import { designNotebookWorkbench } from '../../app/design-notebook'
import { t } from '../../i18n'
import {
  APP_COMMANDS,
  createDesktopCanvasCommandProjection,
  DESKTOP_SHELL_COMMAND_CATALOG,
  getAppCommandDefinition,
  isCatalogCommandDisabled,
  readAppCommandState,
  runCatalogCommand,
  type AppCommandDefinition,
  type AppCommandId,
  type DesktopShellCommandId,
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
const MENU_COMMAND_ORDER = {
  edit: ['edit.undo', 'edit.redo'],
  view: ['view.zoomIn', 'view.zoomOut', 'view.fitToContent'],
  help: ['help.aboutCanopi', 'separator', 'help.reportProblem'],
} as const satisfies Record<Exclude<AppMenuId, 'file'>, readonly (AppCommandId | 'separator')[]>

const MENU_LABELS: Record<Exclude<AppMenuId, 'file'>, () => string> = {
  edit: () => t('menu.edit'),
  view: () => t('menu.view'),
  help: () => t('menu.help'),
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
  command: ProjectedShellCommand<DesktopShellCommandId>,
): AppCommandGraphPanelCommand {
  if (!command.panel) {
    throw new Error(`Missing panel identity for navigation command '${command.id}'`)
  }
  return {
    panel: command.panel,
    commandId: command.id,
    label: command.label,
    shortcut: command.shortcut,
    disabled: command.disabled,
    active: command.active ?? false,
    action: () => {
      runCatalogCommand(command.id)
    },
  }
}

export const appCommandGraphPanelProjection = computed<AppCommandGraphPanelProjection>(() => {
  const state = readAppCommandState()
  const shell = projectShellCommandCatalog(DESKTOP_SHELL_COMMAND_CATALOG, state, t)

  return {
    primary: shell.panelBar.primary.map(panelCommandProjection),
    side: shell.panelBar.side.map(panelCommandProjection),
  }
})

export const appCommandGraphToolbarProjection = computed<AppCommandGraphToolbarProjection>(() => {
  const state = readAppCommandState()
  return createDesktopCanvasCommandProjection(state)
})

export function getMenuDefinitions(): MenuDefinition[] {
  const separator: MenuSeparator = { type: 'separator' }

  return MENU_ORDER.map((menuId): MenuDefinition => {
    if (menuId === 'file') return getFileMenuDefinition(separator)
    return {
      id: menuId,
      label: MENU_LABELS[menuId](),
      items: MENU_COMMAND_ORDER[menuId].map((entry) =>
        staticMenuEntry(menuId, entry, separator)
      ),
    }
  })
}

function getFileMenuDefinition(separator: MenuSeparator): MenuDefinition {
  const shell = projectShellCommandCatalog(
    DESKTOP_SHELL_COMMAND_CATALOG,
    readAppCommandState(),
    t,
  )
  const staticEntries: MenuEntry[] = []
  const fileMenu = shell.menus.find((menu) => menu.id === 'file')
  if (!fileMenu) throw new Error('Desktop shell catalog requires the File menu')
  for (const [sectionIndex, section] of fileMenu.sections.entries()) {
    if (sectionIndex > 0) staticEntries.push(separator)
    for (const command of section) {
      staticEntries.push({
        type: 'action',
        id: command.id,
        label: command.label,
        shortcut: command.shortcut,
        action: () => {
          runCatalogCommand(command.id)
        },
        disabled: command.disabled,
      })
    }
  }
  const recentEntries = designNotebookWorkbench.view.value.recentEntries

  const openDesignCommand = DESKTOP_SHELL_COMMAND_CATALOG.find(
    (command) => command.capabilityId === 'openDesign',
  )
  const openIndex = staticEntries.findIndex((entry) =>
    entry.type === 'action' && entry.id === openDesignCommand?.id
  )
  if (openIndex < 0) {
    return { id: 'file', label: fileMenu.label, items: staticEntries }
  }

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

  return {
    id: 'file',
    label: fileMenu.label,
    items: [
      ...staticEntries.slice(0, openIndex + 1),
      openRecent,
      ...staticEntries.slice(openIndex + 1),
    ],
  }
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
