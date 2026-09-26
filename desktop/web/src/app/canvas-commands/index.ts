import {
  ariaKeyShortcuts,
  formatShortcut,
  matchesShortcut,
  type ShortcutInput,
} from '../shell-commands/shortcut-text'

export type CanvasToolId =
  | 'select'
  | 'hand'
  | 'plant-stamp'
  | 'plant-spacing'
  | 'object-stamp'
  | 'polygon'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'measurement-guide'

/** Tool rail groups, top to bottom. Only `zones` carries a heading. */
export type CanvasToolGroupId = 'navigate' | 'plant' | 'zones' | 'annotate'

export type CanvasEditAction =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'select-all'
  | 'select-same-species'
  | 'group'
  | 'ungroup'
  | 'bring-to-front'
  | 'send-to-back'
  | 'lock'
  | 'unlock'
  | 'save-as-stamp'

export type CanvasViewAction = 'zoom-in' | 'zoom-out' | 'fit-to-design' | 'search-place'

export type CanvasCommandId =
  | 'edit.undo'
  | 'edit.redo'
  | 'canvas.tool.select'
  | 'canvas.tool.hand'
  | 'canvas.tool.plantStamp'
  | 'canvas.tool.plantSpacing'
  | 'canvas.tool.objectStamp'
  | 'canvas.tool.polygon'
  | 'canvas.tool.rectangle'
  | 'canvas.tool.ellipse'
  | 'canvas.tool.line'
  | 'canvas.tool.text'
  | 'canvas.tool.measurementGuide'
  | 'canvas.toggleGrid'
  | 'canvas.toggleSnapToGrid'
  | 'canvas.toggleRulers'
  | 'canvas.cut'
  | 'canvas.copy'
  | 'canvas.paste'
  | 'canvas.duplicateSelected'
  | 'canvas.deleteSelected'
  | 'canvas.selectAll'
  | 'canvas.selectSameSpecies'
  | 'canvas.groupSelected'
  | 'canvas.ungroupSelected'
  | 'canvas.bringToFront'
  | 'canvas.sendToBack'
  | 'canvas.lockSelected'
  | 'canvas.unlockSelected'
  | 'canvas.saveSelectionAsStamp'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fitToDesign'
  | 'view.searchPlace'

export type CanvasCommandIntent =
  | { readonly type: 'select-tool', readonly tool: CanvasToolId }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'toggle-grid' }
  | { readonly type: 'toggle-snap-to-grid' }
  | { readonly type: 'toggle-rulers' }
  | { readonly type: 'edit', readonly action: CanvasEditAction }
  | { readonly type: 'view', readonly action: CanvasViewAction }

export interface CanvasCommandProjectionState {
  readonly activeTool: string
  /** A canvas runtime is mounted. */
  readonly canvasAvailable: boolean
  readonly toolSelectionAvailable: boolean
  /** False in overview, where Design objects are hidden and cannot change. */
  readonly spatialEditingAvailable: boolean
  readonly hasSelection: boolean
  /** The selection names one species, so "Select all of this species" can run. */
  readonly sameSpeciesSelectionAvailable: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly settingsAvailable: boolean
  readonly gridVisible: boolean
  readonly snapToGridEnabled: boolean
  readonly rulersVisible: boolean
}

export interface CanvasCommandIntentAdapter {
  selectTool(tool: CanvasToolId): void
  undo(): void
  redo(): void
  toggleGrid(): void
  toggleSnapToGrid(): void
  toggleRulers(): void
  edit(action: CanvasEditAction): void
  view(action: CanvasViewAction): void
}

/** A command as chrome shows it: menus, the tool rail, the view chip, the palette. */
export interface CanvasProjectedCommand {
  readonly commandId: CanvasCommandId
  readonly label: string
  /** Display text, e.g. "Ctrl Shift Z". */
  readonly shortcut?: string
  /** `aria-keyshortcuts` value. */
  readonly ariaShortcut?: string
  readonly disabled: boolean
  readonly action: () => void
}

export interface CanvasToolbarToolCommand extends CanvasProjectedCommand {
  readonly tool: CanvasToolId
  readonly group: CanvasToolGroupId
  readonly active: boolean
}

export interface CanvasToolbarActionCommand extends CanvasProjectedCommand {
  readonly id: string
  readonly pressed?: boolean
}

export interface CanvasToolGroupProjection {
  readonly id: CanvasToolGroupId
  /** Heading shown above the group while tool names are shown. */
  readonly heading?: string
  readonly tools: readonly CanvasToolbarToolCommand[]
}

export interface CanvasCommandProjection {
  readonly toolGroups: readonly CanvasToolGroupProjection[]
  readonly historyActions: readonly CanvasToolbarActionCommand[]
  readonly settingsToggles: readonly CanvasToolbarActionCommand[]
  readonly editActions: readonly CanvasToolbarActionCommand[]
  readonly viewActions: readonly CanvasToolbarActionCommand[]
}

interface CanvasCommandDefinitionBase {
  readonly commandId: CanvasCommandId
  readonly labelKey: string
  /** Canonical shortcuts; the first is shown, the rest are accepted aliases. */
  readonly shortcuts?: readonly string[]
  readonly palette: boolean
  readonly intent: CanvasCommandIntent
  /** The shortcut also works while a text field has focus. */
  readonly worksInTextFields?: boolean
}

export interface CanvasToolCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'tool'
  readonly group: CanvasToolGroupId
  readonly tool: CanvasToolId
}

export interface CanvasHistoryCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'history'
  readonly id: 'undo' | 'redo'
}

export interface CanvasSettingsCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'settings'
  readonly id: 'grid' | 'snap' | 'rulers'
  readonly stateKey: 'gridVisible' | 'snapToGridEnabled' | 'rulersVisible'
}

export interface CanvasEditCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'edit'
  readonly id: CanvasEditAction
}

export interface CanvasViewCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'view'
  readonly id: CanvasViewAction
}

export type CanvasCommandDefinition =
  | CanvasToolCommandDefinition
  | CanvasHistoryCommandDefinition
  | CanvasSettingsCommandDefinition
  | CanvasEditCommandDefinition
  | CanvasViewCommandDefinition

const CANVAS_TOOL_GROUP_HEADINGS: Partial<Record<CanvasToolGroupId, string>> = {
  zones: 'canvas.tools.zones',
}

const CANVAS_TOOL_GROUP_ORDER: readonly CanvasToolGroupId[] = ['navigate', 'plant', 'zones', 'annotate']

function tool(
  group: CanvasToolGroupId,
  toolId: CanvasToolId,
  commandId: CanvasCommandId,
  labelKey: string,
  shortcut: string,
): CanvasToolCommandDefinition {
  return {
    kind: 'tool',
    group,
    tool: toolId,
    commandId,
    labelKey,
    shortcuts: [shortcut],
    palette: true,
    intent: { type: 'select-tool', tool: toolId },
  }
}

function edit(
  id: CanvasEditAction,
  commandId: CanvasCommandId,
  labelKey: string,
  shortcuts?: readonly string[],
): CanvasEditCommandDefinition {
  return { kind: 'edit', id, commandId, labelKey, shortcuts, palette: true, intent: { type: 'edit', action: id } }
}

function view(
  id: CanvasViewAction,
  commandId: CanvasCommandId,
  labelKey: string,
  shortcuts: readonly string[],
  worksInTextFields = false,
): CanvasViewCommandDefinition {
  return {
    kind: 'view',
    id,
    commandId,
    labelKey,
    shortcuts,
    palette: true,
    intent: { type: 'view', action: id },
    worksInTextFields,
  }
}

export const canvasCommandDefinitions: readonly CanvasCommandDefinition[] = [
  tool('navigate', 'select', 'canvas.tool.select', 'canvas.tools.select', 'V'),
  tool('navigate', 'hand', 'canvas.tool.hand', 'canvas.tools.hand', 'H'),
  tool('plant', 'plant-stamp', 'canvas.tool.plantStamp', 'canvas.tools.plantStamp', 'P'),
  tool('plant', 'plant-spacing', 'canvas.tool.plantSpacing', 'canvas.tools.plantSpacing', 'W'),
  tool('plant', 'object-stamp', 'canvas.tool.objectStamp', 'canvas.tools.objectStamp', 'K'),
  tool('zones', 'polygon', 'canvas.tool.polygon', 'canvas.tools.polygon', 'Z'),
  tool('zones', 'rectangle', 'canvas.tool.rectangle', 'canvas.tools.rectangle', 'R'),
  tool('zones', 'ellipse', 'canvas.tool.ellipse', 'canvas.tools.ellipse', 'E'),
  tool('zones', 'line', 'canvas.tool.line', 'canvas.tools.line', 'L'),
  tool('annotate', 'text', 'canvas.tool.text', 'canvas.tools.text', 'T'),
  tool('annotate', 'measurement-guide', 'canvas.tool.measurementGuide', 'canvas.tools.measurementGuide', 'M'),
  {
    kind: 'history',
    id: 'undo',
    commandId: 'edit.undo',
    labelKey: 'menu.edit.undo',
    shortcuts: ['Ctrl+Z'],
    palette: true,
    intent: { type: 'undo' },
  },
  {
    kind: 'history',
    id: 'redo',
    commandId: 'edit.redo',
    labelKey: 'menu.edit.redo',
    shortcuts: ['Ctrl+Shift+Z', 'Ctrl+Y'],
    palette: true,
    intent: { type: 'redo' },
  },
  edit('cut', 'canvas.cut', 'menu.edit.cut', ['Ctrl+X']),
  edit('copy', 'canvas.copy', 'menu.edit.copy', ['Ctrl+C']),
  edit('paste', 'canvas.paste', 'menu.edit.paste', ['Ctrl+V']),
  edit('duplicate', 'canvas.duplicateSelected', 'menu.edit.duplicate', ['Ctrl+D']),
  edit('delete', 'canvas.deleteSelected', 'menu.edit.delete', ['Delete', 'Backspace']),
  edit('select-all', 'canvas.selectAll', 'menu.edit.selectAll', ['Ctrl+A']),
  edit('select-same-species', 'canvas.selectSameSpecies', 'menu.edit.selectSameSpecies', ['Ctrl+Shift+A']),
  edit('group', 'canvas.groupSelected', 'menu.edit.group', ['Ctrl+G']),
  edit('ungroup', 'canvas.ungroupSelected', 'menu.edit.ungroup', ['Ctrl+Shift+G']),
  edit('bring-to-front', 'canvas.bringToFront', 'menu.edit.bringToFront', [']']),
  edit('send-to-back', 'canvas.sendToBack', 'menu.edit.sendToBack', ['[']),
  edit('lock', 'canvas.lockSelected', 'menu.edit.lock', ['Ctrl+L']),
  edit('unlock', 'canvas.unlockSelected', 'menu.edit.unlock'),
  edit('save-as-stamp', 'canvas.saveSelectionAsStamp', 'menu.edit.saveAsStamp'),
  view('zoom-in', 'view.zoomIn', 'menu.view.zoomIn', ['Ctrl+Plus']),
  view('zoom-out', 'view.zoomOut', 'menu.view.zoomOut', ['Ctrl+Minus']),
  view('fit-to-design', 'view.fitToDesign', 'menu.view.fitToDesign', ['Shift+F', 'Ctrl+0']),
  view('search-place', 'view.searchPlace', 'menu.view.searchPlace', ['Ctrl+K'], true),
  {
    kind: 'settings',
    id: 'grid',
    commandId: 'canvas.toggleGrid',
    labelKey: 'canvas.grid.grid',
    shortcuts: ['Shift+G'],
    palette: true,
    intent: { type: 'toggle-grid' },
    stateKey: 'gridVisible',
  },
  {
    kind: 'settings',
    id: 'snap',
    commandId: 'canvas.toggleSnapToGrid',
    labelKey: 'canvas.grid.snapToGrid',
    shortcuts: ['Shift+S'],
    palette: true,
    intent: { type: 'toggle-snap-to-grid' },
    stateKey: 'snapToGridEnabled',
  },
  {
    kind: 'settings',
    id: 'rulers',
    commandId: 'canvas.toggleRulers',
    labelKey: 'canvas.grid.rulers',
    shortcuts: ['Shift+R'],
    palette: true,
    intent: { type: 'toggle-rulers' },
    stateKey: 'rulersVisible',
  },
]

export type CanvasCommandShortcutInput = ShortcutInput

/** The canvas command a key event names, or null. Callers decide whether the map has focus. */
export function canvasCommandDefinitionForShortcut(
  input: CanvasCommandShortcutInput,
): CanvasCommandDefinition | null {
  return canvasCommandDefinitions.find((definition) =>
    definition.shortcuts?.some((shortcut) => matchesShortcut(shortcut, input)),
  ) ?? null
}

export function canvasCommandIdForShortcut(
  input: CanvasCommandShortcutInput,
): CanvasCommandId | null {
  return canvasCommandDefinitionForShortcut(input)?.commandId ?? null
}

export function canvasCommandIntentForShortcut(
  input: CanvasCommandShortcutInput,
): CanvasCommandIntent | null {
  return canvasCommandDefinitionForShortcut(input)?.intent ?? null
}

export function canvasCommandIdForTool(toolId: CanvasToolId): CanvasCommandId {
  const definition = canvasCommandDefinitions.find(
    (candidate): candidate is CanvasToolCommandDefinition =>
      candidate.kind === 'tool' && candidate.tool === toolId,
  )
  if (!definition) throw new Error(`Missing Canvas command for tool '${toolId}'`)
  return definition.commandId
}

const SELECTION_EDITS: ReadonlySet<CanvasEditAction> = new Set([
  'cut',
  'copy',
  'duplicate',
  'delete',
  'group',
  'ungroup',
  'bring-to-front',
  'send-to-back',
  'lock',
  'unlock',
  'save-as-stamp',
])

/** Edits that change Design objects; overview hides objects, so they cannot run there. */
const MUTATING_EDITS: ReadonlySet<CanvasEditAction> = new Set([
  'cut',
  'paste',
  'duplicate',
  'delete',
  'group',
  'ungroup',
  'bring-to-front',
  'send-to-back',
  'lock',
  'unlock',
  'save-as-stamp',
])

export function isCanvasCommandDisabled(
  intent: CanvasCommandIntent,
  state: CanvasCommandProjectionState,
): boolean {
  switch (intent.type) {
    case 'select-tool':
      return !state.toolSelectionAvailable
        || (!state.spatialEditingAvailable && !isNavigationTool(intent.tool))
    case 'undo':
      return !state.canUndo
    case 'redo':
      return !state.canRedo
    case 'toggle-grid':
    case 'toggle-snap-to-grid':
    case 'toggle-rulers':
      return !state.settingsAvailable
    case 'view':
      return !state.canvasAvailable
    case 'edit': {
      if (!state.canvasAvailable) return true
      if (MUTATING_EDITS.has(intent.action) && !state.spatialEditingAvailable) return true
      if (intent.action === 'select-same-species') return !state.sameSpeciesSelectionAvailable
      return SELECTION_EDITS.has(intent.action) && !state.hasSelection
    }
  }
}

function isNavigationTool(toolId: CanvasToolId): boolean {
  return toolId === 'select' || toolId === 'hand'
}

export function dispatchCanvasCommandIntent(
  intent: CanvasCommandIntent,
  adapter: CanvasCommandIntentAdapter,
): void {
  switch (intent.type) {
    case 'select-tool':
      adapter.selectTool(intent.tool)
      return
    case 'undo':
      adapter.undo()
      return
    case 'redo':
      adapter.redo()
      return
    case 'toggle-grid':
      adapter.toggleGrid()
      return
    case 'toggle-snap-to-grid':
      adapter.toggleSnapToGrid()
      return
    case 'toggle-rulers':
      adapter.toggleRulers()
      return
    case 'edit':
      adapter.edit(intent.action)
      return
    case 'view':
      adapter.view(intent.action)
  }
}

interface CreateCanvasCommandProjectionOptions {
  readonly state: CanvasCommandProjectionState
  readonly intents: CanvasCommandIntentAdapter
  readonly translate: (key: string) => string
}

export function createCanvasCommandProjection({
  state,
  intents,
  translate,
}: CreateCanvasCommandProjectionOptions): CanvasCommandProjection {
  const project = (definition: CanvasCommandDefinition): CanvasProjectedCommand => {
    const disabled = isCanvasCommandDisabled(definition.intent, state)
    const shortcut = definition.shortcuts?.[0]
    return {
      commandId: definition.commandId,
      label: translate(definition.labelKey),
      shortcut: shortcut ? formatShortcut(shortcut, translate) : undefined,
      ariaShortcut: definition.shortcuts?.map(ariaKeyShortcuts).join(' '),
      disabled,
      action: () => {
        if (disabled) return
        dispatchCanvasCommandIntent(definition.intent, intents)
      },
    }
  }
  const projectAction = (
    definition: CanvasHistoryCommandDefinition
      | CanvasSettingsCommandDefinition
      | CanvasEditCommandDefinition
      | CanvasViewCommandDefinition,
  ): CanvasToolbarActionCommand => ({
    ...project(definition),
    id: definition.id,
    ...(definition.kind === 'settings' ? { pressed: state[definition.stateKey] } : {}),
  })
  const toolDefinitions = canvasCommandDefinitions.filter(
    (definition): definition is CanvasToolCommandDefinition => definition.kind === 'tool',
  )

  return {
    toolGroups: CANVAS_TOOL_GROUP_ORDER.map((group) => {
      const headingKey = CANVAS_TOOL_GROUP_HEADINGS[group]
      return {
        id: group,
        ...(headingKey ? { heading: translate(headingKey) } : {}),
        tools: toolDefinitions
          .filter((definition) => definition.group === group)
          .map((definition) => ({
            ...project(definition),
            tool: definition.tool,
            group: definition.group,
            active: state.activeTool === definition.tool,
          })),
      }
    }),
    historyActions: canvasCommandDefinitions
      .filter((definition): definition is CanvasHistoryCommandDefinition => definition.kind === 'history')
      .map(projectAction),
    settingsToggles: canvasCommandDefinitions
      .filter((definition): definition is CanvasSettingsCommandDefinition => definition.kind === 'settings')
      .map(projectAction),
    editActions: canvasCommandDefinitions
      .filter((definition): definition is CanvasEditCommandDefinition => definition.kind === 'edit')
      .map(projectAction),
    viewActions: canvasCommandDefinitions
      .filter((definition): definition is CanvasViewCommandDefinition => definition.kind === 'view')
      .map(projectAction),
  }
}

/** Every tool, in rail order. */
export function projectedCanvasTools(
  projection: CanvasCommandProjection,
): readonly CanvasToolbarToolCommand[] {
  return projection.toolGroups.flatMap((group) => group.tools)
}
