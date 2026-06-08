import { computed, signal } from '@preact/signals'
import { activePanel, type Panel } from '../app/shell/state'
import {
  gridVisible,
  rulersVisible,
  snapToGridEnabled,
} from '../app/canvas-settings/signals'
import { locale } from '../app/settings/state'
import {
  currentCanvasTool,
  getCurrentCanvasCommandSurface,
} from '../canvas/session'
import { isEditableTarget } from '../canvas/runtime/interaction/pointer-utils'
import { t } from '../i18n'
import {
  COMMAND_PALETTE_SHORTCUT_KEY,
  canvasToolKeys,
  panelKeys,
} from '../shortcuts/definitions'
import {
  APP_COMMANDS,
  getAppCommandDefinition,
  isCatalogCommandDisabled,
  readAppCommandState,
  runCatalogCommand,
  type AppCommandDefinition,
  type AppCommandId,
  type AppCommandState,
} from './graph/catalog'

export type { AppCommandId } from './graph/catalog'

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

type AppMenuId = 'file' | 'edit' | 'view' | 'help'

interface ShortcutMatch {
  readonly commandId: AppCommandId
  readonly preventDefault: boolean
}

export const commandPaletteOpen = signal(false)

const TOOL_COMMAND_IDS: Record<string, AppCommandId> = {
  select: 'canvas.tool.select',
  hand: 'canvas.tool.hand',
  rectangle: 'canvas.tool.rectangle',
  ellipse: 'canvas.tool.ellipse',
  polygon: 'canvas.tool.polygon',
  text: 'canvas.tool.text',
  'object-stamp': 'canvas.tool.objectStamp',
  'plant-spacing': 'canvas.tool.plantSpacing',
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
    disabled: () => isAppCommandDisabled(command.id),
    action: () => {
      runAppCommand(command.id)
    },
  }
}

export function getAppCommand(id: AppCommandId): Command | null {
  const command = getAppCommandDefinition(id)
  if (!command?.label) return null
  return commandProjection(command)
}

export function isAppCommandDisabled(id: AppCommandId): boolean {
  return isCatalogCommandDisabled(id)
}

export function runAppCommand(id: AppCommandId): boolean {
  return runCatalogCommand(id)
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
      runAppCommand(entry.commandId)
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
      runAppCommand(entry.commandId)
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
      runAppCommand(entry.commandId)
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
      runAppCommand(entry.commandId)
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
            runAppCommand(command.id)
          },
          disabled: isAppCommandDisabled(command.id),
        }
      }),
    }
  })
}

export function handleAppCommandKeyDown(event: KeyboardEvent): boolean {
  const editable = isEditableTarget(event.target)

  if (
    (event.ctrlKey || event.metaKey)
    && event.shiftKey
    && event.key.toUpperCase() === COMMAND_PALETTE_SHORTCUT_KEY
  ) {
    event.preventDefault()
    commandPaletteOpen.value = !commandPaletteOpen.value
    return true
  }

  if (event.key === 'Escape' && commandPaletteOpen.value) {
    commandPaletteOpen.value = false
    return true
  }

  const match = shortcutMatchForEvent(event, editable)
  if (!match) return false
  if (match.preventDefault) event.preventDefault()
  runAppCommand(match.commandId)
  return true
}

function shortcutMatchForEvent(event: KeyboardEvent, editable: boolean): ShortcutMatch | null {
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && panelKeys[event.key]) {
    return {
      commandId: panelCommandId(panelKeys[event.key]!),
      preventDefault: true,
    }
  }

  if (!editable && !event.ctrlKey && !event.metaKey && !event.altKey && panelKeys[event.key]) {
    return {
      commandId: panelCommandId(panelKeys[event.key]!),
      preventDefault: false,
    }
  }

  if (
    !editable
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && activePanel.value === 'canvas'
    && canvasToolKeys[event.key]
  ) {
    return {
      commandId: TOOL_COMMAND_IDS[canvasToolKeys[event.key]!]!,
      preventDefault: true,
    }
  }

  if (activePanel.value === 'canvas') {
    const fileCommand = fileShortcutCommand(event)
    if (fileCommand) {
      return {
        commandId: fileCommand,
        preventDefault: true,
      }
    }
  }

  if (activePanel.value !== 'canvas' || editable || !getCurrentCanvasCommandSurface()) {
    return null
  }

  return canvasShortcutCommand(event)
}

function panelCommandId(panel: Panel): AppCommandId {
  if (panel === 'plant-db') return 'nav.plantDb'
  if (panel === 'location') return 'nav.location'
  if (panel === 'favorites') return 'nav.favorites'
  return 'nav.canvas'
}

function fileShortcutCommand(event: KeyboardEvent): AppCommandId | null {
  if (!(event.ctrlKey || event.metaKey)) return null
  if (!event.shiftKey && event.key.toLowerCase() === 's') return 'file.save'
  if (event.shiftKey && event.key.toLowerCase() === 's') return 'file.saveAs'
  if (!event.shiftKey && event.key.toLowerCase() === 'o') return 'file.open'
  if (!event.shiftKey && event.key.toLowerCase() === 'n') return 'file.new'
  return null
}

function canvasShortcutCommand(event: KeyboardEvent): ShortcutMatch | null {
  const key = event.key
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '=') {
    return { commandId: 'view.zoomIn', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '-') {
    return { commandId: 'view.zoomOut', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === '0') {
    return { commandId: 'view.fitToContent', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'z') {
    return { commandId: 'edit.undo', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key.toLowerCase() === 'z') {
    return { commandId: 'edit.redo', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'c') {
    return { commandId: 'canvas.copy', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'v') {
    return { commandId: 'canvas.paste', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'd') {
    return { commandId: 'canvas.duplicateSelected', preventDefault: true }
  }
  if (key === 'Delete' || key === 'Backspace') {
    return { commandId: 'canvas.deleteSelected', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'a') {
    return { commandId: 'canvas.selectAll', preventDefault: true }
  }
  if (!event.ctrlKey && !event.metaKey && key === ']') {
    return { commandId: 'canvas.bringToFront', preventDefault: false }
  }
  if (!event.ctrlKey && !event.metaKey && key === '[') {
    return { commandId: 'canvas.sendToBack', preventDefault: false }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'l') {
    return { commandId: 'canvas.lockOrUnlockSelected', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'g') {
    return { commandId: 'canvas.groupSelected', preventDefault: true }
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key.toLowerCase() === 'g') {
    return { commandId: 'canvas.ungroupSelected', preventDefault: true }
  }
  return null
}
