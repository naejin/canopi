import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))
import { setSettings } from '../ipc/settings'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
} from '../app/canvas-settings/signals'
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  bottomPanelOpen,
  bottomPanelTab,
} from '../app/canvas-settings/bottom-panel-state'
import {
  openBottomPanel,
  setBottomPanelTab,
  setContourIntervalMeters,
  setHillshadeOpacity,
  setLayerOpacity,
  toggleHillshadeVisibility,
  toggleLayerVisibility,
} from '../app/canvas-settings/controller'
import { flushQueuedSettingsPersist, setBootstrappedSettings } from '../app/settings/persistence'

beforeEach(() => {
  vi.useFakeTimers()
  bottomPanelOpen.value = false
  bottomPanelTab.value = 'budget'
  contourIntervalMeters.value = 0
  hillshadeVisible.value = false
  hillshadeOpacity.value = 0.55
  layerVisibility.value = { base: true, contours: false, plants: true, zones: true, annotations: true }
  layerOpacity.value = { base: 1, contours: 1, plants: 1, zones: 1, annotations: 1 }
  vi.mocked(setSettings).mockClear()
  setBootstrappedSettings({
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
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
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('bottom panel actions', () => {
  it('supports every bottom panel tab internally when opened directly', () => {
    for (const tab of VISIBLE_BOTTOM_PANEL_TABS) {
      openBottomPanel(tab)

      expect(bottomPanelOpen.value).toBe(true)
      expect(bottomPanelTab.value).toBe(tab)
    }
  })

  it('keeps the panel open when switching tabs after opening', () => {
    openBottomPanel('budget')
    setBottomPanelTab('consortium')

    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelTab.value).toBe('consortium')
  })

  it('ignores invalid contour intervals instead of persisting NaN', () => {
    contourIntervalMeters.value = 20

    setContourIntervalMeters(Number.NaN)

    expect(contourIntervalMeters.value).toBe(20)
  })

  it('hydrates persisted map settings into the independent canvas controls', () => {
    setBootstrappedSettings({
      locale: 'fr',
      theme: 'dark',
      snap_to_grid: false,
      snap_to_guides: false,
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
      bottom_panel_height: 240,
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

    expect(layerVisibility.value.base).toBe(false)
    expect(layerOpacity.value.base).toBe(0.35)
    expect(layerVisibility.value.contours).toBe(true)
    expect(layerOpacity.value.contours).toBe(0.45)
    expect(contourIntervalMeters.value).toBe(12)
    expect(hillshadeVisible.value).toBe(true)
    expect(hillshadeOpacity.value).toBe(0.2)
  })

  it('persists basemap, contour, and hillshade controls independently', async () => {
    toggleLayerVisibility('base')
    setLayerOpacity('contours', 0.4)
    setContourIntervalMeters(18)
    toggleHillshadeVisibility()
    setHillshadeOpacity(0.25)

    vi.runAllTimers()
    await Promise.resolve()

    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      map_layer_visible: false,
      map_opacity: 1,
      contour_visible: false,
      contour_opacity: 0.4,
      contour_interval: 18,
      hillshade_visible: true,
      hillshade_opacity: 0.25,
    }))
  })

  it('flushes queued map-setting persistence immediately when requested', async () => {
    setLayerOpacity('base', 0.6)

    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()

    flushQueuedSettingsPersist()
    await Promise.resolve()

    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      map_opacity: 0.6,
    }))
  })
})
