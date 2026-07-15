export type CanvasToolId =
  | 'select'
  | 'hand'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'text'
  | 'measurement-guide'
  | 'object-stamp'
  | 'plant-spacing'

export type CanvasCommandId =
  | 'edit.undo'
  | 'edit.redo'
  | 'canvas.tool.select'
  | 'canvas.tool.hand'
  | 'canvas.tool.line'
  | 'canvas.tool.rectangle'
  | 'canvas.tool.ellipse'
  | 'canvas.tool.polygon'
  | 'canvas.tool.text'
  | 'canvas.tool.measurementGuide'
  | 'canvas.tool.objectStamp'
  | 'canvas.tool.plantSpacing'
  | 'canvas.toggleGrid'
  | 'canvas.toggleSnapToGrid'
  | 'canvas.toggleRulers'

export type CanvasCommandIntent =
  | { readonly type: 'select-tool', readonly tool: CanvasToolId }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'toggle-grid' }
  | { readonly type: 'toggle-snap-to-grid' }
  | { readonly type: 'toggle-rulers' }

export interface CanvasCommandProjectionState {
  readonly activeTool: string
  readonly toolSelectionAvailable: boolean
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
}

export interface CanvasToolbarToolCommand {
  readonly tool: CanvasToolId
  readonly commandId: CanvasCommandId
  readonly label: string
  readonly description: string
  readonly shortcut?: string
  readonly active: boolean
  readonly disabled: boolean
  readonly action: () => void
}

export interface CanvasToolbarActionCommand {
  readonly id: string
  readonly commandId: CanvasCommandId
  readonly label: string
  readonly description?: string
  readonly shortcut?: string
  readonly disabled: boolean
  readonly pressed?: boolean
  readonly action: () => void
}

export interface CanvasCommandProjection {
  readonly primaryTools: CanvasToolbarToolCommand[]
  readonly creationTools: CanvasToolbarToolCommand[]
  readonly reuseTools: CanvasToolbarToolCommand[]
  readonly historyActions: CanvasToolbarActionCommand[]
  readonly settingsToggles: CanvasToolbarActionCommand[]
}

interface CanvasCommandDefinitionBase {
  readonly commandId: CanvasCommandId
  readonly labelKey: string
  readonly shortcut?: string
  readonly palette: boolean
  readonly intent: CanvasCommandIntent
}

export interface CanvasToolCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'tool'
  readonly group: 'primary' | 'creation' | 'reuse'
  readonly tool: CanvasToolId
  readonly descriptionKey: string
}

export interface CanvasHistoryCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'history'
  readonly id: 'undo' | 'redo'
}

export interface CanvasSettingsCommandDefinition extends CanvasCommandDefinitionBase {
  readonly kind: 'settings'
  readonly id: 'grid' | 'snap' | 'rulers'
  readonly descriptionKey: string
  readonly stateKey: 'gridVisible' | 'snapToGridEnabled' | 'rulersVisible'
}

export type CanvasCommandDefinition =
  | CanvasToolCommandDefinition
  | CanvasHistoryCommandDefinition
  | CanvasSettingsCommandDefinition

export const CANVAS_TOOL_SHORTCUTS = {
  select: 'V',
  hand: 'H',
  line: 'L',
  rectangle: 'R',
  ellipse: 'E',
  polygon: 'P',
  text: 'T',
  plantSpacing: 'S',
} as const

export const CANVAS_HISTORY_SHORTCUTS = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
} as const

export const canvasCommandDefinitions: readonly CanvasCommandDefinition[] = [
  {
    kind: 'tool',
    group: 'primary',
    tool: 'select',
    commandId: 'canvas.tool.select',
    labelKey: 'canvas.tools.select',
    descriptionKey: 'canvas.tools.selectDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.select,
    palette: true,
    intent: { type: 'select-tool', tool: 'select' },
  },
  {
    kind: 'tool',
    group: 'primary',
    tool: 'hand',
    commandId: 'canvas.tool.hand',
    labelKey: 'canvas.tools.hand',
    descriptionKey: 'canvas.tools.handDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.hand,
    palette: true,
    intent: { type: 'select-tool', tool: 'hand' },
  },
  {
    kind: 'tool',
    group: 'creation',
    tool: 'line',
    commandId: 'canvas.tool.line',
    labelKey: 'canvas.tools.line',
    descriptionKey: 'canvas.tools.lineDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.line,
    palette: true,
    intent: { type: 'select-tool', tool: 'line' },
  },
  {
    kind: 'tool',
    group: 'creation',
    tool: 'rectangle',
    commandId: 'canvas.tool.rectangle',
    labelKey: 'canvas.tools.rectangle',
    descriptionKey: 'canvas.tools.rectangleDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.rectangle,
    palette: true,
    intent: { type: 'select-tool', tool: 'rectangle' },
  },
  {
    kind: 'tool',
    group: 'creation',
    tool: 'ellipse',
    commandId: 'canvas.tool.ellipse',
    labelKey: 'canvas.tools.ellipse',
    descriptionKey: 'canvas.tools.ellipseDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.ellipse,
    palette: true,
    intent: { type: 'select-tool', tool: 'ellipse' },
  },
  {
    kind: 'tool',
    group: 'creation',
    tool: 'polygon',
    commandId: 'canvas.tool.polygon',
    labelKey: 'canvas.tools.polygon',
    descriptionKey: 'canvas.tools.polygonDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.polygon,
    palette: true,
    intent: { type: 'select-tool', tool: 'polygon' },
  },
  {
    kind: 'tool',
    group: 'creation',
    tool: 'text',
    commandId: 'canvas.tool.text',
    labelKey: 'canvas.tools.text',
    descriptionKey: 'canvas.tools.textDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.text,
    palette: true,
    intent: { type: 'select-tool', tool: 'text' },
  },
  {
    kind: 'tool',
    group: 'creation',
    tool: 'measurement-guide',
    commandId: 'canvas.tool.measurementGuide',
    labelKey: 'canvas.tools.measurementGuide',
    descriptionKey: 'canvas.tools.measurementGuideDesc',
    palette: true,
    intent: { type: 'select-tool', tool: 'measurement-guide' },
  },
  {
    kind: 'tool',
    group: 'reuse',
    tool: 'object-stamp',
    commandId: 'canvas.tool.objectStamp',
    labelKey: 'canvas.tools.objectStamp',
    descriptionKey: 'canvas.tools.objectStampDesc',
    palette: true,
    intent: { type: 'select-tool', tool: 'object-stamp' },
  },
  {
    kind: 'tool',
    group: 'reuse',
    tool: 'plant-spacing',
    commandId: 'canvas.tool.plantSpacing',
    labelKey: 'canvas.tools.plantSpacing',
    descriptionKey: 'canvas.tools.plantSpacingDesc',
    shortcut: CANVAS_TOOL_SHORTCUTS.plantSpacing,
    palette: true,
    intent: { type: 'select-tool', tool: 'plant-spacing' },
  },
  {
    kind: 'history',
    id: 'undo',
    commandId: 'edit.undo',
    labelKey: 'menu.edit.undo',
    shortcut: CANVAS_HISTORY_SHORTCUTS.undo,
    palette: true,
    intent: { type: 'undo' },
  },
  {
    kind: 'history',
    id: 'redo',
    commandId: 'edit.redo',
    labelKey: 'menu.edit.redo',
    shortcut: CANVAS_HISTORY_SHORTCUTS.redo,
    palette: true,
    intent: { type: 'redo' },
  },
  {
    kind: 'settings',
    id: 'grid',
    commandId: 'canvas.toggleGrid',
    labelKey: 'canvas.grid.grid',
    descriptionKey: 'canvas.grid.gridDesc',
    palette: false,
    intent: { type: 'toggle-grid' },
    stateKey: 'gridVisible',
  },
  {
    kind: 'settings',
    id: 'snap',
    commandId: 'canvas.toggleSnapToGrid',
    labelKey: 'canvas.grid.snapToGrid',
    descriptionKey: 'canvas.grid.snapToGridDesc',
    palette: false,
    intent: { type: 'toggle-snap-to-grid' },
    stateKey: 'snapToGridEnabled',
  },
  {
    kind: 'settings',
    id: 'rulers',
    commandId: 'canvas.toggleRulers',
    labelKey: 'canvas.grid.rulers',
    descriptionKey: 'canvas.grid.rulersDesc',
    palette: false,
    intent: { type: 'toggle-rulers' },
    stateKey: 'rulersVisible',
  },
]

export const canvasToolShortcutKeys: Readonly<Record<string, CanvasToolId>> = Object.freeze(
  Object.fromEntries(
    canvasCommandDefinitions
      .filter((definition): definition is CanvasToolCommandDefinition =>
        definition.kind === 'tool' && definition.shortcut !== undefined)
      .flatMap((definition) => [
        [definition.shortcut!.toLowerCase(), definition.tool],
        [definition.shortcut!, definition.tool],
      ]),
  ),
)

export interface CanvasCommandShortcutInput {
  readonly key: string
  readonly primaryModifier: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

export function canvasToolCommandIdForShortcut(
  input: CanvasCommandShortcutInput,
): CanvasCommandId | null {
  if (input.primaryModifier || input.altKey) return null
  const tool = canvasToolShortcutKeys[input.key]
  return tool ? canvasCommandIdForTool(tool) : null
}

export function canvasHistoryCommandIdForShortcut(
  input: CanvasCommandShortcutInput,
): CanvasCommandId | null {
  const definition = canvasCommandDefinitions.find(
    (candidate): candidate is CanvasHistoryCommandDefinition =>
      candidate.kind === 'history'
      && candidate.shortcut !== undefined
      && matchesCommandShortcut(input, candidate.shortcut),
  )
  return definition?.commandId ?? null
}

function matchesCommandShortcut(
  input: CanvasCommandShortcutInput,
  shortcut: string,
): boolean {
  const parts = shortcut.split('+')
  const shortcutKey = parts.at(-1)
  if (!shortcutKey) return false
  return input.primaryModifier === parts.includes('Ctrl')
    && input.shiftKey === parts.includes('Shift')
    && (!parts.includes('Alt') || input.altKey)
    && input.key.toLowerCase() === shortcutKey.toLowerCase()
}

export function canvasCommandIdForTool(tool: CanvasToolId): CanvasCommandId {
  const definition = canvasCommandDefinitions.find(
    (candidate): candidate is CanvasToolCommandDefinition =>
      candidate.kind === 'tool' && candidate.tool === tool,
  )
  if (!definition) throw new Error(`Missing Canvas command for tool '${tool}'`)
  return definition.commandId
}

export function isCanvasCommandDisabled(
  intent: CanvasCommandIntent,
  state: CanvasCommandProjectionState,
): boolean {
  switch (intent.type) {
    case 'select-tool':
      return !state.toolSelectionAvailable
    case 'undo':
      return !state.canUndo
    case 'redo':
      return !state.canRedo
    case 'toggle-grid':
    case 'toggle-snap-to-grid':
    case 'toggle-rulers':
      return !state.settingsAvailable
  }
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
  const projectAction = (definition: CanvasCommandDefinition): (() => void) => () => {
    if (isCanvasCommandDisabled(definition.intent, state)) return
    dispatchCanvasCommandIntent(definition.intent, intents)
  }
  const toolDefinitions = canvasCommandDefinitions.filter(
    (definition): definition is CanvasToolCommandDefinition => definition.kind === 'tool',
  )
  const projectTool = (definition: CanvasToolCommandDefinition): CanvasToolbarToolCommand => ({
    tool: definition.tool,
    commandId: definition.commandId,
    label: translate(definition.labelKey),
    description: translate(definition.descriptionKey),
    shortcut: definition.shortcut,
    active: state.activeTool === definition.tool,
    disabled: isCanvasCommandDisabled(definition.intent, state),
    action: projectAction(definition),
  })

  return {
    primaryTools: toolDefinitions
      .filter((definition) => definition.group === 'primary')
      .map(projectTool),
    creationTools: toolDefinitions
      .filter((definition) => definition.group === 'creation')
      .map(projectTool),
    reuseTools: toolDefinitions
      .filter((definition) => definition.group === 'reuse')
      .map(projectTool),
    historyActions: canvasCommandDefinitions
      .filter((definition): definition is CanvasHistoryCommandDefinition => definition.kind === 'history')
      .map((definition) => ({
        id: definition.id,
        commandId: definition.commandId,
        label: translate(definition.labelKey),
        shortcut: definition.shortcut,
        disabled: isCanvasCommandDisabled(definition.intent, state),
        action: projectAction(definition),
      })),
    settingsToggles: canvasCommandDefinitions
      .filter((definition): definition is CanvasSettingsCommandDefinition => definition.kind === 'settings')
      .map((definition) => ({
        id: definition.id,
        commandId: definition.commandId,
        label: translate(definition.labelKey),
        description: translate(definition.descriptionKey),
        disabled: isCanvasCommandDisabled(definition.intent, state),
        pressed: state[definition.stateKey],
        action: projectAction(definition),
      })),
  }
}
