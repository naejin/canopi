import type { Panel, SidePanel } from '../shell/state'

export type ShellCommandIdByCapability = {
  readonly newDesign: 'file.new'
  readonly openDesign: 'file.open'
  readonly openCanopi: 'file.openCanopi'
  readonly saveDesign: 'file.save'
  readonly saveDesignAs: 'file.saveAs'
  readonly downloadCanopi: 'file.downloadCanopi'
  readonly exitApp: 'file.exit'
  readonly navigateCanvas: 'nav.canvas'
  readonly navigateLocation: 'nav.location'
  readonly navigateTemplates: 'nav.templates'
  readonly navigatePlantDatabase: 'nav.plantDb'
  readonly navigateDesignNotebook: 'nav.designNotebook'
  readonly navigateFavorites: 'nav.favorites'
  readonly toggleTheme: 'view.toggleTheme'
}

export type ShellCommandCapabilityId = keyof ShellCommandIdByCapability
export type ShellCommandId = ShellCommandIdByCapability[ShellCommandCapabilityId]
export type ShellCommandIdForCapability<
  Capability extends ShellCommandCapabilityId,
> = ShellCommandIdByCapability[Capability]

const SHELL_FILE_SHORTCUTS = {
  newDesign: 'Ctrl+N',
  openDesign: 'Ctrl+O',
  saveDesign: 'Ctrl+S',
  saveDesignAs: 'Ctrl+Shift+S',
} as const

const SHELL_PANEL_SHORTCUTS = {
  canvas: 'Ctrl+1',
  plantDb: 'Ctrl+2',
} as const

export interface ShellCommandState {
  readonly hasDesign: boolean
  readonly designDirty: boolean
  readonly activePanel: Panel
  readonly sidePanel: SidePanel | null
}

export interface ShellCommandCapability {
  execute(): void
  isExecutionDisabled?(state: ShellCommandState): boolean
  isProjectionDisabled?(state: ShellCommandState): boolean
}

export interface ShellCommandShortcutInput {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

export type ShellCommandCapabilities = Partial<
  Record<ShellCommandCapabilityId, ShellCommandCapability>
>

export interface ShellCommandCatalogEntry<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly capabilityId: ShellCommandCapabilityId
  readonly id: Id
  readonly family: 'file' | 'navigation' | 'settings'
  readonly labelKey: string
  readonly chromeLabelKey: string
  readonly shortcut?: string
  readonly palette: boolean
  readonly menu?: {
    readonly id: 'file'
    readonly section: number
  }
  readonly panel?: {
    readonly panel: Panel
    readonly group: 'primary' | 'side'
    readonly order: number
  }
  execute(): void
  isExecutionDisabled(state: ShellCommandState): boolean
  isProjectionDisabled(state: ShellCommandState): boolean
}

export interface ProjectedShellCommand<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly id: Id
  readonly label: string
  readonly shortcut?: string
  readonly disabled: boolean
  readonly active?: boolean
  readonly panel?: Panel
  action(): void
}

export interface ShellMenuProjection<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly id: 'file'
  readonly label: string
  readonly items: readonly ProjectedShellCommand<Id>[]
  readonly sections: readonly (readonly ProjectedShellCommand<Id>[])[]
}

export interface ShellPanelBarProjection<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly primary: readonly ProjectedShellCommand<Id>[]
  readonly side: readonly ProjectedShellCommand<Id>[]
}

export interface ShellChromeProjection<
  Id extends ShellCommandId = ShellCommandId,
> {
  readonly commands: ReadonlyMap<Id, ProjectedShellCommand<Id>>
  readonly menus: readonly ShellMenuProjection<Id>[]
  readonly panelBar: ShellPanelBarProjection<Id>
}

type ShellCommandDescriptor = {
  [Capability in ShellCommandCapabilityId]: Omit<
    ShellCommandCatalogEntry,
    | 'capabilityId'
    | 'id'
    | 'execute'
    | 'isExecutionDisabled'
    | 'isProjectionDisabled'
  > & {
    readonly capabilityId: Capability
    readonly id: ShellCommandIdByCapability[Capability]
  }
}[ShellCommandCapabilityId]

const SHELL_COMMAND_DESCRIPTORS: readonly ShellCommandDescriptor[] = [
  {
    capabilityId: 'newDesign',
    id: 'file.new',
    family: 'file',
    labelKey: 'canvas.file.new',
    chromeLabelKey: 'canvas.file.new',
    shortcut: SHELL_FILE_SHORTCUTS.newDesign,
    palette: true,
    menu: { id: 'file', section: 0 },
  },
  {
    capabilityId: 'openDesign',
    id: 'file.open',
    family: 'file',
    labelKey: 'canvas.file.open',
    chromeLabelKey: 'canvas.file.open',
    shortcut: SHELL_FILE_SHORTCUTS.openDesign,
    palette: true,
    menu: { id: 'file', section: 0 },
  },
  {
    capabilityId: 'openCanopi',
    id: 'file.openCanopi',
    family: 'file',
    labelKey: 'webShell.openCanopi',
    chromeLabelKey: 'webShell.openCanopi',
    palette: false,
    menu: { id: 'file', section: 0 },
  },
  {
    capabilityId: 'saveDesign',
    id: 'file.save',
    family: 'file',
    labelKey: 'canvas.file.save',
    chromeLabelKey: 'canvas.file.save',
    shortcut: SHELL_FILE_SHORTCUTS.saveDesign,
    palette: true,
    menu: { id: 'file', section: 1 },
  },
  {
    capabilityId: 'saveDesignAs',
    id: 'file.saveAs',
    family: 'file',
    labelKey: 'canvas.file.saveAs',
    chromeLabelKey: 'canvas.file.saveAs',
    shortcut: SHELL_FILE_SHORTCUTS.saveDesignAs,
    palette: true,
    menu: { id: 'file', section: 1 },
  },
  {
    capabilityId: 'downloadCanopi',
    id: 'file.downloadCanopi',
    family: 'file',
    labelKey: 'webShell.downloadCanopi',
    chromeLabelKey: 'webShell.downloadCanopi',
    palette: false,
    menu: { id: 'file', section: 1 },
  },
  {
    capabilityId: 'exitApp',
    id: 'file.exit',
    family: 'file',
    labelKey: 'menu.file.exit',
    chromeLabelKey: 'menu.file.exit',
    palette: false,
    menu: { id: 'file', section: 2 },
  },
  {
    capabilityId: 'navigateCanvas',
    id: 'nav.canvas',
    family: 'navigation',
    labelKey: 'commands.canvas',
    chromeLabelKey: 'nav.canvas',
    shortcut: SHELL_PANEL_SHORTCUTS.canvas,
    palette: true,
    panel: { panel: 'canvas', group: 'primary', order: 0 },
  },
  {
    capabilityId: 'navigateLocation',
    id: 'nav.location',
    family: 'navigation',
    labelKey: 'canvas.location.title',
    chromeLabelKey: 'canvas.location.title',
    palette: true,
    panel: { panel: 'location', group: 'primary', order: 1 },
  },
  {
    capabilityId: 'navigateTemplates',
    id: 'nav.templates',
    family: 'navigation',
    labelKey: 'worldMap.title',
    chromeLabelKey: 'worldMap.title',
    palette: false,
    panel: { panel: 'templates', group: 'primary', order: 1 },
  },
  {
    capabilityId: 'navigatePlantDatabase',
    id: 'nav.plantDb',
    family: 'navigation',
    labelKey: 'commands.plantDb',
    chromeLabelKey: 'nav.plantDb',
    shortcut: SHELL_PANEL_SHORTCUTS.plantDb,
    palette: true,
    panel: { panel: 'plant-db', group: 'side', order: 1 },
  },
  {
    capabilityId: 'navigateFavorites',
    id: 'nav.favorites',
    family: 'navigation',
    labelKey: 'nav.favorites',
    chromeLabelKey: 'nav.favorites',
    palette: true,
    panel: { panel: 'favorites', group: 'side', order: 2 },
  },
  {
    capabilityId: 'navigateDesignNotebook',
    id: 'nav.designNotebook',
    family: 'navigation',
    labelKey: 'nav.designNotebook',
    chromeLabelKey: 'nav.designNotebook',
    palette: true,
    panel: { panel: 'design-notebook', group: 'side', order: 0 },
  },
  {
    capabilityId: 'toggleTheme',
    id: 'view.toggleTheme',
    family: 'settings',
    labelKey: 'commands.toggleTheme',
    chromeLabelKey: 'status.theme',
    palette: true,
  },
]

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
): ShellChromeProjection<Id> {
  const commands = new Map<Id, ProjectedShellCommand<Id>>()
  for (const command of catalog) {
    const disabled = command.isProjectionDisabled(state)
    commands.set(command.id, {
      id: command.id,
      label: translate(command.chromeLabelKey),
      shortcut: command.shortcut,
      disabled,
      active: command.panel ? isPanelCommandActive(command.panel, state) : undefined,
      panel: command.panel?.panel,
      action: () => {
        if (!disabled) command.execute()
      },
    })
  }

  const fileSectionsById = new Map<number, ProjectedShellCommand<Id>[]>()
  for (const command of catalog) {
    if (command.menu?.id !== 'file') continue
    const section = fileSectionsById.get(command.menu.section) ?? []
    section.push(requireProjectedCommand(commands, command.id))
    fileSectionsById.set(command.menu.section, section)
  }
  const fileSections = [...fileSectionsById.values()]
  const fileItems = fileSections.flat()
  const panelCommands = (group: 'primary' | 'side') => catalog
    .flatMap((command) => command.panel?.group === group
      ? [{ command, panel: command.panel }]
      : [])
    .sort((left, right) => left.panel.order - right.panel.order)
    .map(({ command }) => requireProjectedCommand(commands, command.id))

  return {
    commands,
    menus: fileItems.length > 0
      ? [{
          id: 'file',
          label: translate('menu.file'),
          items: fileItems,
          sections: fileSections,
        }]
      : [],
    panelBar: {
      primary: panelCommands('primary'),
      side: panelCommands('side'),
    },
  }
}

export function matchShellCommandShortcut<Id extends ShellCommandId>(
  catalog: readonly ShellCommandCatalogEntry<Id>[],
  input: ShellCommandShortcutInput,
): ShellCommandCatalogEntry<Id> | null {
  return catalog.find((command) =>
    command.shortcut && matchesShellShortcut(command.shortcut, input)
  ) ?? null
}

function matchesShellShortcut(
  shortcut: string,
  input: ShellCommandShortcutInput,
): boolean {
  const parts = shortcut.split('+')
  const key = parts.at(-1)
  if (!key) return false

  const requiresPrimaryModifier = parts.includes('Ctrl')
  const requiresShift = parts.includes('Shift')
  const requiresAlt = parts.includes('Alt')
  const primaryModifierMatches = requiresPrimaryModifier
    ? input.ctrlKey !== input.metaKey
    : !input.ctrlKey && !input.metaKey
  return primaryModifierMatches
    && input.shiftKey === requiresShift
    && input.altKey === requiresAlt
    && input.key.toLowerCase() === key.toLowerCase()
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
  panel: NonNullable<ShellCommandCatalogEntry['panel']>,
  state: ShellCommandState,
): boolean {
  if (panel.group === 'side') {
    return state.activePanel === 'canvas' && state.sidePanel === panel.panel
  }
  if (panel.panel === 'canvas') {
    return state.activePanel === 'canvas' && state.sidePanel === null
  }
  return state.activePanel === panel.panel
}
