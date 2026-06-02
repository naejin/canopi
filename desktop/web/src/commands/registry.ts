import { getCurrentWindow } from '@tauri-apps/api/window'
import { signal } from '@preact/signals'
import { currentDesign, designDirty } from '../app/document-session/store'
import {
  newDesignAction,
  openDesign,
  saveAsCurrentDesign,
  saveCurrentDesign,
} from '../app/document-session/actions'
import { activePanel, navigateTo, type Panel } from '../app/shell/state'
import { problemReportDialogOpen } from '../app/problem-report/state'
import {
  diagnosticMessageFromError,
  recordFrontendDiagnostic,
} from '../app/problem-report/diagnostics'
import { mutateSettingsProjection } from '../app/settings/projection'
import {
  currentCanvasHasSelection,
  getCurrentCanvasCommandSurface,
  setCurrentCanvasTool,
} from '../canvas/session'
import type { CanvasCommandSurface } from '../canvas/runtime/runtime'
import { isEditableTarget } from '../canvas/runtime/interaction/pointer-utils'
import { t } from '../i18n'
import {
  COMMAND_PALETTE_SHORTCUT_KEY,
  EDIT_SHORTCUTS,
  FILE_SHORTCUTS,
  PANEL_SHORTCUTS,
  TOOL_SHORTCUTS,
  VIEW_SHORTCUTS,
  canvasToolKeys,
  panelKeys,
} from '../shortcuts/definitions'

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

type AppMenuId = 'file' | 'edit' | 'view' | 'help'

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
  | 'view.toggleTheme'
  | 'canvas.tool.select'
  | 'canvas.tool.hand'
  | 'canvas.tool.rectangle'
  | 'canvas.tool.ellipse'
  | 'canvas.tool.polygon'
  | 'canvas.tool.text'
  | 'canvas.tool.objectStamp'
  | 'canvas.tool.plantSpacing'
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

interface AppCommandState {
  readonly hasDesign: boolean
  readonly designDirty: boolean
  readonly canvas: CanvasCommandSurface | null
  readonly canvasHasSelection: boolean
}

interface AppCommandDefinition {
  readonly id: AppCommandId
  readonly label?: () => string
  readonly shortcut?: string
  readonly palette?: boolean
  readonly run: (state: AppCommandState) => void
  readonly disabled?: (state: AppCommandState) => boolean
}

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

function readAppCommandState(): AppCommandState {
  return {
    hasDesign: currentDesign.value !== null,
    designDirty: designDirty.value,
    canvas: getCurrentCanvasCommandSurface(),
    canvasHasSelection: currentCanvasHasSelection.value,
  }
}

function switchPanel(panel: Panel): void {
  navigateTo(panel)
}

function switchTool(tool: string): void {
  navigateTo('canvas')
  setCurrentCanvasTool(tool)
}

function cycleTheme(): void {
  mutateSettingsProjection((settings) => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
  }, { persist: 'immediate' })
}

function openProblemReportDialog(): void {
  problemReportDialogOpen.value = true
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

const APP_COMMANDS: readonly AppCommandDefinition[] = [
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
    run: (state) => runCanvas(state, (canvas) => canvas.undo()),
    disabled: (state) => !state.canvas || !state.canvas.canUndo.value,
  },
  {
    id: 'edit.redo',
    label: () => t('menu.edit.redo'),
    shortcut: EDIT_SHORTCUTS.redo,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.redo()),
    disabled: (state) => !state.canvas || !state.canvas.canRedo.value,
  },
  {
    id: 'view.zoomIn',
    label: () => t('menu.view.zoomIn'),
    shortcut: VIEW_SHORTCUTS.zoomIn,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.zoomIn()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'view.zoomOut',
    label: () => t('menu.view.zoomOut'),
    shortcut: VIEW_SHORTCUTS.zoomOut,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.zoomOut()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'view.fitToContent',
    label: () => t('menu.view.fitToContent'),
    shortcut: VIEW_SHORTCUTS.fitToContent,
    palette: true,
    run: (state) => runCanvas(state, (canvas) => canvas.zoomToFit()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'help.reportProblem',
    label: () => t('menu.help.reportProblem'),
    palette: true,
    run: openProblemReportDialog,
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
  },
  {
    id: 'nav.plantDb',
    label: () => t('commands.plantDb'),
    shortcut: PANEL_SHORTCUTS.plantDb,
    palette: true,
    run: () => switchPanel('plant-db'),
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
    id: 'canvas.copy',
    run: (state) => runCanvas(state, (canvas) => canvas.copy()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.paste',
    run: (state) => runCanvas(state, (canvas) => canvas.paste()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.duplicateSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.duplicateSelected()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.deleteSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.deleteSelected()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.selectAll',
    run: (state) => runCanvas(state, (canvas) => canvas.selectAll()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.bringToFront',
    run: (state) => runCanvas(state, (canvas) => canvas.bringToFront()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.sendToBack',
    run: (state) => runCanvas(state, (canvas) => canvas.sendToBack()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.lockOrUnlockSelected',
    run: (state) => runCanvas(state, (canvas) => {
      if (state.canvasHasSelection) canvas.lockSelected()
      else canvas.unlockSelected()
    }),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.groupSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.groupSelected()),
    disabled: (state) => !state.canvas,
  },
  {
    id: 'canvas.ungroupSelected',
    run: (state) => runCanvas(state, (canvas) => canvas.ungroupSelected()),
    disabled: (state) => !state.canvas,
  },
]

const commandById = new Map<AppCommandId, AppCommandDefinition>(
  APP_COMMANDS.map((command) => [command.id, command]),
)

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
  const command = commandById.get(id)
  if (!command?.label) return null
  return commandProjection(command)
}

export function isAppCommandDisabled(id: AppCommandId): boolean {
  const command = commandById.get(id)
  if (!command) return true
  const state = readAppCommandState()
  return command.disabled?.(state) ?? false
}

export function runAppCommand(id: AppCommandId): boolean {
  const command = commandById.get(id)
  if (!command) return false
  const state = readAppCommandState()
  if (command.disabled?.(state)) return false
  command.run(state)
  return true
}

export const commands: Command[] = APP_COMMANDS
  .filter((command) => command.palette && command.label)
  .map(commandProjection)

export function getMenuDefinitions(): MenuDefinition[] {
  const separator: MenuSeparator = { type: 'separator' }

  return MENU_ORDER.map((menuId): MenuDefinition => {
    return {
      id: menuId,
      label: MENU_LABELS[menuId](),
      items: MENU_COMMAND_ORDER[menuId].map((entry): MenuEntry => {
        if (entry === 'separator') return separator
        const command = commandById.get(entry)
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
