import { navigateTo, type Panel, type SidePanel } from '../app/shell/state'
import { mutateSettingsProjection } from '../app/settings/projection'
import {
  composeShellCommandCatalog,
  projectShellCommandCatalog,
  type ProjectedShellCommand,
  type ShellChromeProjection,
  type ShellCommandIdForCapability,
} from '../app/shell-commands'
import { t } from '../i18n'

type BrowserShellCapabilityId =
  | 'newDesign'
  | 'openCanopi'
  | 'downloadCanopi'
  | 'navigateCanvas'
  | 'navigateTemplates'
  | 'navigatePlantDatabase'
  | 'navigateFavorites'
  | 'toggleTheme'

type BrowserShellCommandId = ShellCommandIdForCapability<BrowserShellCapabilityId>

export type BrowserShellProjectedCommand = ProjectedShellCommand<BrowserShellCommandId>
export interface BrowserShellChromeProjection extends ShellChromeProjection<BrowserShellCommandId> {
  readonly theme: BrowserShellProjectedCommand
}

export interface BrowserShellDesignIdentity {
  readonly name: string
  readonly dirty: boolean
}

export interface BrowserShellCapabilities {
  newDesign(): void
  openCanopi(): void
  downloadCanopi(): void
  navigate(panel: Panel): void
  toggleTheme(): void
}

export interface BrowserDesignShellCommands {
  newDesign(): Promise<void>
  openCanopi(): Promise<boolean>
  downloadCanopi(): Promise<void>
}

export function createBrowserShellCapabilities(
  commands: BrowserDesignShellCommands,
  onError: (error: unknown) => void,
): BrowserShellCapabilities {
  return {
    newDesign: () => runBrowserDesignCommand(() => commands.newDesign(), onError),
    openCanopi: () => runBrowserDesignCommand(() => commands.openCanopi(), onError),
    downloadCanopi: () => runBrowserDesignCommand(() => commands.downloadCanopi(), onError),
    navigate: navigateTo,
    toggleTheme: () => {
      mutateSettingsProjection((settings) => {
        settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
      }, { persist: 'immediate' })
    },
  }
}

export interface BrowserShellProjectionInput {
  readonly currentPanel: Panel
  readonly currentSidePanel: SidePanel | null
  readonly downloadCanopiEnabled: boolean
  readonly templatesEnabled: boolean
  readonly capabilities: BrowserShellCapabilities
}

export function createBrowserShellCommandProjection({
  currentPanel,
  currentSidePanel,
  downloadCanopiEnabled,
  templatesEnabled,
  capabilities,
}: BrowserShellProjectionInput): BrowserShellChromeProjection {
  const catalog = composeShellCommandCatalog({
    newDesign: { execute: () => capabilities.newDesign() },
    openCanopi: { execute: () => capabilities.openCanopi() },
    downloadCanopi: {
      execute: () => capabilities.downloadCanopi(),
      isExecutionDisabled: () => !downloadCanopiEnabled,
      isProjectionDisabled: () => !downloadCanopiEnabled,
    },
    navigateCanvas: { execute: () => capabilities.navigate('canvas') },
    ...(templatesEnabled
      ? { navigateTemplates: { execute: () => capabilities.navigate('templates') } }
      : {}),
    navigatePlantDatabase: { execute: () => capabilities.navigate('plant-db') },
    navigateFavorites: { execute: () => capabilities.navigate('favorites') },
    toggleTheme: { execute: () => capabilities.toggleTheme() },
  })

  const projection = projectShellCommandCatalog(
    catalog,
    {
      hasDesign: downloadCanopiEnabled,
      designDirty: false,
      activePanel: currentPanel,
      sidePanel: currentSidePanel,
    },
    t,
  )
  const themeDefinition = catalog.find((command) => command.capabilityId === 'toggleTheme')
  const theme = themeDefinition
    ? projection.commands.get(themeDefinition.id)
    : undefined
  if (!theme) throw new Error('Browser shell projection requires the theme command')
  return { ...projection, theme }
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
