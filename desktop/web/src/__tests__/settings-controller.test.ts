import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../app/updater/config', () => ({
  updaterEnabled: true,
}))

vi.mock('../app/updater/controller', () => ({
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  confirmUpdateChannelChange: vi.fn().mockResolvedValue(true),
  applyUpdateChannelChangeEffects: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../ipc/settings', () => ({
  setSettings: vi.fn().mockResolvedValue(undefined),
}))

import { currentDesign, designName, nonCanvasRevision } from '../state/design'
import {
  canSaveSettingsDraft,
  cancelSettingsSession,
  isSettingsDraftStale,
  openSettingsSession,
  saveSettingsSession,
  settingsDraft,
  updateCurrentDesignDraft,
  updatePreferencesDraft,
} from '../app/settings/controller'
import { settingsHydrated, setBootstrappedSettings } from '../app/settings/persistence'
import { checkUpdatesEnabled, locale, theme, updateChannel } from '../app/settings/state'
import { settingsModalOpen, settingsModalSection } from '../app/settings/modal-state'
import * as updaterController from '../app/updater/controller'
import { updaterState } from '../app/updater/state'

function bootstrapSettings(): void {
  setBootstrappedSettings({
    locale: 'en',
    theme: 'light',
    snap_to_grid: false,
    snap_to_guides: false,
    show_smart_guides: true,
    auto_save_interval_s: 60,
    confirm_destructive: true,
    default_currency: 'EUR',
    measurement_units: 'metric',
    show_botanical_names: true,
    debug_logging: false,
    check_updates: true,
    update_channel: 'stable',
    default_design_dir: '',
    recent_files_max: 20,
    last_active_panel: 'canvas',
    bottom_panel_open: false,
    bottom_panel_height: 200,
    bottom_panel_tab: 'budget',
    map_layer_visible: true,
    map_style: 'street',
    map_opacity: 1,
    contour_visible: false,
    contour_opacity: 1,
    contour_interval: 0,
    hillshade_visible: false,
    hillshade_opacity: 0.55,
  })
}

describe('settings controller', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bootstrapSettings()
    currentDesign.value = {
      version: 2,
      name: 'Demo Design',
      description: null,
      location: null,
      north_bearing_deg: null,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      created_at: '',
      updated_at: '',
      extra: {},
    }
    designName.value = 'Demo Design'
    nonCanvasRevision.value = 0
    settingsDraft.value = null
    settingsModalOpen.value = false
    settingsModalSection.value = 'preferences'
    updaterState.value = { status: 'idle' }
  })

  afterEach(() => {
    settingsDraft.value = null
    settingsModalOpen.value = false
    settingsModalSection.value = 'preferences'
    currentDesign.value = null
    designName.value = 'Untitled'
    nonCanvasRevision.value = 0
    settingsHydrated.value = false
  })

  it('opens a draft session from current preferences and design metadata', () => {
    openSettingsSession('currentDesign')

    expect(settingsModalOpen.value).toBe(true)
    expect(settingsModalSection.value).toBe('currentDesign')
    expect(settingsDraft.value).toMatchObject({
      preferences: {
        theme: 'light',
        locale: 'en',
        checkUpdatesEnabled: true,
        updateChannel: 'stable',
      },
      currentDesign: {
        enabled: true,
        name: 'Demo Design',
        description: '',
      },
    })
  })

  it('cancels without applying the draft', () => {
    openSettingsSession()
    updatePreferencesDraft('theme', 'dark')
    updateCurrentDesignDraft('name', 'Kitchen Garden')

    cancelSettingsSession()

    expect(settingsModalOpen.value).toBe(false)
    expect(settingsDraft.value).toBeNull()
    expect(theme.value).toBe('light')
    expect(designName.value).toBe('Demo Design')
  })

  it('saves preference and current design drafts together', async () => {
    openSettingsSession()
    updatePreferencesDraft('theme', 'dark')
    updatePreferencesDraft('locale', 'fr')
    updatePreferencesDraft('checkUpdatesEnabled', false)
    updatePreferencesDraft('updateChannel', 'beta')
    updateCurrentDesignDraft('name', 'Kitchen Garden')
    updateCurrentDesignDraft('description', 'South slope layout')

    const saved = await saveSettingsSession()

    expect(saved).toBe(true)
    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('fr')
    expect(checkUpdatesEnabled.value).toBe(false)
    expect(updateChannel.value).toBe('beta')
    expect(designName.value).toBe('Kitchen Garden')
    expect(currentDesign.value?.name).toBe('Kitchen Garden')
    expect(currentDesign.value?.description).toBe('South slope layout')
    expect(nonCanvasRevision.value).toBe(1)
    expect(settingsModalOpen.value).toBe(false)
    expect(settingsDraft.value).toBeNull()
    expect(vi.mocked(updaterController.confirmUpdateChannelChange)).toHaveBeenCalledWith('stable', 'beta')
    expect(vi.mocked(updaterController.checkForUpdates)).not.toHaveBeenCalled()
  })

  it('keeps the session open and applies nothing when the channel warning is cancelled', async () => {
    vi.mocked(updaterController.confirmUpdateChannelChange).mockResolvedValueOnce(false)

    openSettingsSession()
    updatePreferencesDraft('theme', 'dark')
    updatePreferencesDraft('updateChannel', 'beta')
    updateCurrentDesignDraft('name', 'Kitchen Garden')

    const saved = await saveSettingsSession()

    expect(saved).toBe(false)
    expect(theme.value).toBe('light')
    expect(updateChannel.value).toBe('stable')
    expect(designName.value).toBe('Demo Design')
    expect(settingsModalOpen.value).toBe(true)
    expect(settingsDraft.value).not.toBeNull()
    expect(nonCanvasRevision.value).toBe(0)
  })

  it('disables save when the open design changes while the modal is active', async () => {
    openSettingsSession('currentDesign')
    currentDesign.value = {
      ...currentDesign.value!,
      name: 'Replacement Design',
    }

    expect(isSettingsDraftStale()).toBe(true)
    expect(canSaveSettingsDraft()).toBe(false)

    const saved = await saveSettingsSession()

    expect(saved).toBe(false)
    expect(settingsModalOpen.value).toBe(true)
    expect(designName.value).toBe('Demo Design')
  })

  it('clears stale updater availability when saving a channel change with update checks off', async () => {
    vi.mocked(updaterController.applyUpdateChannelChangeEffects).mockImplementationOnce(async () => {
      updaterState.value = { status: 'idle' }
    })
    updaterState.value = {
      status: 'available',
      channel: 'stable',
      version: '0.5.0',
      body: null,
      date: null,
    }

    openSettingsSession()
    updatePreferencesDraft('checkUpdatesEnabled', false)
    updatePreferencesDraft('updateChannel', 'beta')

    const saved = await saveSettingsSession()

    expect(saved).toBe(true)
    expect(updaterState.value).toEqual({ status: 'idle' })
    expect(vi.mocked(updaterController.checkForUpdates)).not.toHaveBeenCalled()
  })
})
