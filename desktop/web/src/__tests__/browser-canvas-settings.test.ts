import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installSettingsProjection,
  resetSettingsProjectionForTests,
} from '../app/settings/projection'
import type { Settings } from '../types/settings'
import { createBrowserCanvasRuntimeAppAdapter } from '../web/browser-canvas-runtime'

describe('browser Canvas settings adapter', () => {
  const persistSettings = vi.fn<(settings: Settings) => Promise<void>>()

  beforeEach(() => {
    persistSettings.mockReset().mockResolvedValue(undefined)
    installSettingsProjection({
      load: () => baseSettings(),
      save: persistSettings,
    })
  })

  afterEach(() => {
    resetSettingsProjectionForTests()
  })

  it('persists Plant Spacing interval commits immediately', () => {
    const adapter = createBrowserCanvasRuntimeAppAdapter()

    adapter.settings.commitPlantSpacingIntervalMeters(0.75)

    expect(persistSettings).toHaveBeenCalledOnce()
    expect(persistSettings).toHaveBeenCalledWith(expect.objectContaining({
      plant_spacing_interval_m: 0.75,
    }))
  })

  it('persists the discrete snap-to-grid toggle immediately', () => {
    const adapter = createBrowserCanvasRuntimeAppAdapter()

    adapter.settings.toggleSnapToGrid()

    expect(adapter.settings.readSnapToGridEnabled()).toBe(false)
    expect(persistSettings).toHaveBeenCalledOnce()
    expect(persistSettings).toHaveBeenCalledWith(expect.objectContaining({
      snap_to_grid: false,
    }))
  })
})

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
    auto_save_interval_s: 60,
    side_panel_width: null,
    saved_stamps_frame_height: null,
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
    ...overrides,
  }
}
