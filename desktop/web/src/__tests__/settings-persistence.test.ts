import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))

import { setSettings } from '../ipc/settings'
import {
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../state/canvas'
import { autoSaveIntervalMs, locale, theme } from '../app/settings/state'
import {
  flushQueuedSettingsPersist,
  queueSettingsPersist,
  setBootstrappedSettings,
} from '../app/settings/persistence'

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(setSettings).mockClear()
  locale.value = 'en'
  theme.value = 'light'
  autoSaveIntervalMs.value = 60_000
  snapToGridEnabled.value = false
  snapToGuidesEnabled.value = false
  bottomPanelOpen.value = false
  bottomPanelHeight.value = 200
  bottomPanelTab.value = 'budget'
  layerVisibility.value = { base: true, contours: false, plants: true, zones: true, annotations: true }
  layerOpacity.value = { base: 1, contours: 1, plants: 1, zones: 1, annotations: 1 }
  contourIntervalMeters.value = 0
  hillshadeVisible.value = false
  hillshadeOpacity.value = 0.55
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('settings persistence', () => {
  it('hydrates persisted settings into shell and canvas state', () => {
    setBootstrappedSettings({
      locale: 'fr',
      theme: 'dark',
      snap_to_grid: true,
      snap_to_guides: true,
      show_smart_guides: true,
      auto_save_interval_s: 45,
      confirm_destructive: true,
      default_currency: 'EUR',
      measurement_units: 'metric',
      show_botanical_names: true,
      debug_logging: false,
      check_updates: true,
      default_design_dir: '',
      recent_files_max: 20,
      last_active_panel: 'canvas',
      bottom_panel_open: true,
      bottom_panel_height: 320,
      bottom_panel_tab: 'timeline',
      map_layer_visible: false,
      map_style: 'street',
      map_opacity: 0.35,
      contour_visible: true,
      contour_opacity: 0.45,
      contour_interval: 12,
      hillshade_visible: true,
      hillshade_opacity: 0.2,
    })

    expect(locale.value).toBe('fr')
    expect(theme.value).toBe('dark')
    expect(autoSaveIntervalMs.value).toBe(45_000)
    expect(snapToGridEnabled.value).toBe(true)
    expect(snapToGuidesEnabled.value).toBe(true)
    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelHeight.value).toBe(320)
    expect(bottomPanelTab.value).toBe('timeline')
    expect(layerVisibility.value.base).toBe(false)
    expect(layerOpacity.value.base).toBe(0.35)
    expect(layerVisibility.value.contours).toBe(true)
    expect(layerOpacity.value.contours).toBe(0.45)
    expect(contourIntervalMeters.value).toBe(12)
    expect(hillshadeVisible.value).toBe(true)
    expect(hillshadeOpacity.value).toBe(0.2)
  })

  it('coalesces queued writes and flushes the latest settings snapshot', async () => {
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

    locale.value = 'de'
    layerOpacity.value = { ...layerOpacity.value, base: 0.6 }
    queueSettingsPersist(250)

    locale.value = 'it'
    hillshadeVisible.value = true
    queueSettingsPersist(250)

    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()

    flushQueuedSettingsPersist()
    await Promise.resolve()

    expect(vi.mocked(setSettings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'it',
      map_opacity: 0.6,
      hillshade_visible: true,
    }))
  })
})
