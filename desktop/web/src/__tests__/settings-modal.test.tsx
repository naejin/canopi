import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../app/updater/config', () => ({
  updaterControlsVisible: true,
}))

import { SettingsModal } from '../components/shared/SettingsModal'
import { currentDesign, designName } from '../state/design'
import {
  openSettingsSession,
  settingsDraft,
  updateCurrentDesignDraft,
} from '../app/settings/controller'
import { settingsHydrated, setBootstrappedSettings } from '../app/settings/persistence'
import { settingsModalOpen, settingsModalSection } from '../app/settings/modal-state'

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

describe('settings modal', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    bootstrapSettings()
    settingsDraft.value = null
    settingsModalOpen.value = false
    settingsModalSection.value = 'preferences'
    currentDesign.value = null
    designName.value = 'Untitled'
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    settingsDraft.value = null
    settingsModalOpen.value = false
    settingsModalSection.value = 'preferences'
    currentDesign.value = null
    designName.value = 'Untitled'
    settingsHydrated.value = false
  })

  it('shows an explanatory disabled state when no design is open', async () => {
    openSettingsSession('currentDesign')

    await act(async () => {
      render(<SettingsModal />, container)
    })

    expect(container.textContent).toContain('No design is open')
    expect(container.textContent).toContain('Current Design')
  })

  it('disables save when the current design name draft is blank', async () => {
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
    openSettingsSession('currentDesign')
    updateCurrentDesignDraft('name', '   ')

    await act(async () => {
      render(<SettingsModal />, container)
    })

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.type === 'button' && button.disabled)

    expect(saveButton?.disabled).toBe(true)
    expect(container.textContent).toContain('Design name is required')
  })

  it('keeps tab focus inside the modal surface', async () => {
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
    openSettingsSession()

    await act(async () => {
      render(<SettingsModal />, container)
    })

    const buttons = Array.from(container.querySelectorAll('button'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    last?.focus()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
    })

    expect(document.activeElement).toBe(first)
  })
})
