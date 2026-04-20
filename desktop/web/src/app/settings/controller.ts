import { batch, signal } from '@preact/signals'
import { currentDesign, designName } from '../../state/design'
import { updateCurrentDesignMetadata } from '../document/controller'
import { checkUpdatesEnabled, locale, theme, updateChannel } from './state'
import { persistCurrentSettings, settingsHydrated } from './persistence'
import {
  closeSettingsModal,
  openSettingsModal,
  settingsModalOpen,
  type SettingsSection,
} from './modal-state'
import type { UpdateChannel } from '../../types/settings'
import {
  applyUpdateChannelChangeEffects,
  confirmUpdateChannelChange,
} from '../updater/controller'
import { updaterEnabled } from '../updater/config'
import type { CanopiFile } from '../../types/design'

type PreferencesDraft = {
  theme: typeof theme.value
  locale: typeof locale.value
  checkUpdatesEnabled: boolean
  updateChannel: UpdateChannel
}

type CurrentDesignDraft = {
  enabled: boolean
  sourceDesign: CanopiFile | null
  name: string
  description: string
}

export type SettingsDraft = {
  preferences: PreferencesDraft
  currentDesign: CurrentDesignDraft
}

export const settingsDraft = signal<SettingsDraft | null>(null)
export const settingsSavePending = signal(false)

function createSettingsDraft(): SettingsDraft {
  const design = currentDesign.peek()

  return {
    preferences: {
      theme: theme.peek(),
      locale: locale.peek(),
      checkUpdatesEnabled: checkUpdatesEnabled.peek(),
      updateChannel: updateChannel.peek(),
    },
    currentDesign: {
      enabled: design !== null,
      sourceDesign: design,
      name: designName.peek(),
      description: design?.description ?? '',
    },
  }
}

function resetSettingsSession(): void {
  settingsDraft.value = null
  settingsSavePending.value = false
}

function normalizeDescription(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function openSettingsSession(section: SettingsSection = 'preferences'): void {
  if (!settingsHydrated.peek()) return

  settingsDraft.value = createSettingsDraft()
  openSettingsModal(section)
}

export function cancelSettingsSession(): void {
  if (!settingsModalOpen.peek()) return

  resetSettingsSession()
  closeSettingsModal()
}

export function updatePreferencesDraft<K extends keyof PreferencesDraft>(
  key: K,
  value: PreferencesDraft[K],
): void {
  const draft = settingsDraft.peek()
  if (!draft) return

  settingsDraft.value = {
    ...draft,
    preferences: {
      ...draft.preferences,
      [key]: value,
    },
  }
}

export function updateCurrentDesignDraft<K extends keyof CurrentDesignDraft>(
  key: K,
  value: CurrentDesignDraft[K],
): void {
  const draft = settingsDraft.peek()
  if (!draft) return

  settingsDraft.value = {
    ...draft,
    currentDesign: {
      ...draft.currentDesign,
      [key]: value,
    },
  }
}

export function canSaveSettingsDraft(): boolean {
  const draft = settingsDraft.peek()
  if (!draft) return false
  if (isSettingsDraftStale()) return false
  if (!draft.currentDesign.enabled) return true
  return draft.currentDesign.name.trim().length > 0
}

export function isSettingsDraftStale(): boolean {
  const draft = settingsDraft.peek()
  if (!draft || !draft.currentDesign.enabled) return false

  return currentDesign.peek() !== draft.currentDesign.sourceDesign
}

export async function saveSettingsSession(): Promise<boolean> {
  const draft = settingsDraft.peek()
  if (!draft || settingsSavePending.peek()) return false
  if (!canSaveSettingsDraft()) return false

  const previousCheckUpdates = checkUpdatesEnabled.peek()
  const previousChannel = updateChannel.peek()
  const nextChannel = draft.preferences.updateChannel
  const channelChanged = previousChannel !== nextChannel

  settingsSavePending.value = true

  try {
    if (channelChanged) {
      const confirmed = await confirmUpdateChannelChange(previousChannel, nextChannel)
      if (!confirmed) return false
    }

    batch(() => {
      theme.value = draft.preferences.theme
      locale.value = draft.preferences.locale
      checkUpdatesEnabled.value = draft.preferences.checkUpdatesEnabled
      updateChannel.value = nextChannel
    })
    persistCurrentSettings()

    if (draft.currentDesign.enabled) {
      updateCurrentDesignMetadata({
        name: draft.currentDesign.name.trim(),
        description: normalizeDescription(draft.currentDesign.description),
      })
    }

    resetSettingsSession()
    closeSettingsModal()

    if (channelChanged) {
      await applyUpdateChannelChangeEffects(nextChannel, {
        shouldRecheck: updaterEnabled && draft.preferences.checkUpdatesEnabled,
      })
    } else if (updaterEnabled && draft.preferences.checkUpdatesEnabled && !previousCheckUpdates) {
      await applyUpdateChannelChangeEffects(nextChannel, {
        shouldRecheck: true,
      })
    }

    return true
  } finally {
    settingsSavePending.value = false
  }
}
