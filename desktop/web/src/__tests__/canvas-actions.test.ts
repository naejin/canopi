import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))
import { setSettings } from '../ipc/settings'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerLockState,
  layerOpacity,
  layerVisibility,
} from '../app/canvas-settings/signals'
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  bottomPanelHeights,
  bottomPanelOpen,
  bottomPanelTab,
} from '../app/canvas-settings/bottom-panel-state'
import {
  commitBottomPanelHeight,
  openBottomPanel,
  setBasemapStyle,
  setBottomPanelTab,
  setContourIntervalMeters,
  setHillshadeOpacity,
  setLayerOpacity,
  toggleHillshadeVisibility,
  toggleLayerLock,
  toggleLayerVisibility,
} from '../app/canvas-settings/controller'
import { basemapStyle } from '../app/settings/state'
import { flushSettingsProjection, hydrateSettingsProjection } from '../app/settings/projection'
import { setCurrentCanvasSession } from '../canvas/session'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

beforeEach(() => {
  vi.useFakeTimers()
  bottomPanelOpen.value = false
  bottomPanelTab.value = 'budget'
  contourIntervalMeters.value = 0
  hillshadeVisible.value = false
  hillshadeOpacity.value = 0.55
  basemapStyle.value = 'street'
  layerVisibility.value = { base: true, contours: false, plants: true, zones: true, annotations: true }
  layerLockState.value = { base: false, contours: false, plants: false, zones: false, annotations: false }
  layerOpacity.value = { base: 1, contours: 1, plants: 1, zones: 1, annotations: 1 }
  setCurrentCanvasSession(null)
  vi.mocked(setSettings).mockClear()
  hydrateSettingsProjection({
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
    side_panel_width: null,
    bottom_panel_open: false,
    bottom_panel_timeline_height: null,
    bottom_panel_budget_height: null,
    bottom_panel_consortium_height: null,
    bottom_panel_tab: 'budget',
    map_layer_visible: true,
    map_style: 'street',
    map_opacity: 1,
    contour_visible: false,
    contour_opacity: 1,
    contour_interval: 0,
    hillshade_visible: false,
    hillshade_opacity: 0.55,
    plant_spacing_interval_m: 0.5,
  })
})

afterEach(() => {
  setCurrentCanvasSession(null)
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

  it('commits height changes only to the active bottom panel tab', () => {
    openBottomPanel('timeline')
    commitBottomPanelHeight(260)
    setBottomPanelTab('budget')
    commitBottomPanelHeight(300)

    expect(bottomPanelHeights.value).toEqual({
      timeline: 260,
      budget: 300,
      consortium: null,
    })
  })

  it('ignores invalid contour intervals instead of persisting NaN', () => {
    contourIntervalMeters.value = 20

    setContourIntervalMeters(Number.NaN)

    expect(contourIntervalMeters.value).toBe(20)
  })

  it('hydrates persisted map settings into the independent canvas controls', () => {
    hydrateSettingsProjection({
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
      side_panel_width: null,
      bottom_panel_open: true,
      bottom_panel_timeline_height: 240,
      bottom_panel_budget_height: null,
      bottom_panel_consortium_height: null,
      bottom_panel_tab: 'timeline',
      map_layer_visible: false,
      map_style: 'street',
      map_opacity: 0.35,
      contour_visible: true,
      contour_opacity: 0.45,
      contour_interval: 12,
      hillshade_visible: true,
      hillshade_opacity: 0.2,
      plant_spacing_interval_m: 0.5,
    })

    expect(layerVisibility.value.base).toBe(false)
    expect(layerOpacity.value.base).toBe(0.35)
    expect(basemapStyle.value).toBe('street')
    expect(layerVisibility.value.contours).toBe(true)
    expect(layerOpacity.value.contours).toBe(0.45)
    expect(contourIntervalMeters.value).toBe(12)
    expect(hillshadeVisible.value).toBe(true)
    expect(hillshadeOpacity.value).toBe(0.2)
  })

  it('persists basemap, contour, and hillshade controls independently', async () => {
    const originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
    ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = 'test-maptiler-key'

    try {
      toggleLayerVisibility('base')
      setBasemapStyle('satellite')
      setLayerOpacity('contours', 0.4)
      setContourIntervalMeters(18)
      toggleHillshadeVisibility()
      setHillshadeOpacity(0.25)

      vi.runAllTimers()
      await Promise.resolve()

      expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
        map_layer_visible: false,
        map_style: 'satellite',
        map_opacity: 1,
        contour_visible: false,
        contour_opacity: 0.4,
        contour_interval: 18,
        hillshade_visible: true,
        hillshade_opacity: 0.25,
      }))
    } finally {
      ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
    }
  })

  it('flushes queued map-setting persistence immediately when requested', async () => {
    setLayerOpacity('base', 0.6)

    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()

    flushSettingsProjection()
    await Promise.resolve()

    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      map_opacity: 0.6,
    }))
  })

  it('routes scene layer controls through the mounted canvas command surface', () => {
    const commandSurface = {
      layers: {
        setSceneLayerVisibility: vi.fn(() => true),
        setSceneLayerOpacity: vi.fn(() => true),
        setSceneLayerLocked: vi.fn(() => true),
      },
    }
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface(commandSurface),
    }))

    toggleLayerVisibility('plants')
    setLayerOpacity('zones', 0.4)
    toggleLayerLock('annotations')

    expect(commandSurface.layers.setSceneLayerVisibility).toHaveBeenCalledWith('plants', false)
    expect(commandSurface.layers.setSceneLayerOpacity).toHaveBeenCalledWith('zones', 0.4)
    expect(commandSurface.layers.setSceneLayerLocked).toHaveBeenCalledWith('annotations', true)
    expect(layerVisibility.value.plants).toBe(true)
    expect(layerOpacity.value.zones).toBe(1)
    expect(layerLockState.value.annotations).toBe(false)
  })
})
