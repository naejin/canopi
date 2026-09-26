import { openAboutCanopiDialog } from '../about/state'
import { focusOpenPlantFinder } from '../plant-finder/focus'
import { selectPanel } from '../shell/state'
import { setMapBackground } from '../map-layers/actions'
import { mapBackgroundOf, mapLayers } from '../map-layers/state'
import { mutateSettingsProjection } from '../settings/projection'
import { theme } from '../settings/state'
import { openKeyboardShortcutsDialog, openSettingsDialog } from '../shell/dialogs'
import { requestDesignRename } from '../shell/requests'
import type { ShellCommandCapabilities } from '../shell-commands'
import { toggleToolNames, toolRailShowsNames } from '../tool-rail/learning'

/**
 * Shell capabilities both editions share: they act on app state only (title
 * bar, dialogs, device settings, map background), never on files or IPC.
 */
export function createWorkspaceShellCapabilities() {
  return {
    renameDesign: {
      execute: requestDesignRename,
      isExecutionDisabled: (state) => !state.hasDesign,
    },
    openSettings: { execute: openSettingsDialog },
    findPlants: { execute: findPlants },
    toggleToolNames: {
      execute: toggleToolNames,
      isChecked: () => toolRailShowsNames.value,
    },
    showSatellite: {
      execute: () => setMapBackground('satellite'),
      isChecked: () => mapBackgroundOf(mapLayers.value) === 'satellite',
    },
    showMap: {
      execute: () => setMapBackground('basemap'),
      isChecked: () => mapBackgroundOf(mapLayers.value) === 'basemap',
    },
    showNoBackground: {
      execute: () => setMapBackground('none'),
      isChecked: () => mapBackgroundOf(mapLayers.value) === 'none',
    },
    toggleTheme: {
      execute: toggleTheme,
      isChecked: () => theme.value === 'dark',
    },
    showShortcuts: { execute: openKeyboardShortcutsDialog },
    aboutCanopi: { execute: openAboutCanopiDialog },
  } satisfies ShellCommandCapabilities
}

/** Edit › Find plants (Ctrl F): the open panel's finder, else the Plant catalog's. */
function findPlants(): void {
  if (focusOpenPlantFinder()) return
  selectPanel('plant-db')
  requestAnimationFrame(() => { focusOpenPlantFinder() })
}

export function toggleTheme(): void {
  mutateSettingsProjection((settings) => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark'
  }, { persist: 'immediate' })
}
