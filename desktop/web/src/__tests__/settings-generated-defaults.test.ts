import { describe, expect, it } from 'vitest'

import {
  bottomPanelHeights,
  bottomPanelOpen,
  bottomPanelTab,
} from '../app/canvas-settings/bottom-panel-state'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../app/canvas-settings/signals'
import { sidePanelWidth } from '../app/shell/state'
import {
  DEFAULT_SAVED_STAMPS_FRAME_HEIGHT,
  autoSaveIntervalMs,
  basemapStyle,
  locale,
  plantSpacingIntervalM,
  savedStampsFrameHeight,
  theme,
} from '../app/settings/state'
import { DEFAULT_SETTINGS } from '../generated/settings'

describe('generated settings defaults', () => {
  it('initialize every settings-backed projection signal', () => {
    expect(locale.value).toBe(DEFAULT_SETTINGS.locale)
    expect(theme.value).toBe(DEFAULT_SETTINGS.theme)
    expect(basemapStyle.value).toBe(DEFAULT_SETTINGS.map_style)
    expect(autoSaveIntervalMs.value).toBe(DEFAULT_SETTINGS.auto_save_interval_s * 1000)
    expect(plantSpacingIntervalM.value).toBe(DEFAULT_SETTINGS.plant_spacing_interval_m)
    expect(sidePanelWidth.value).toBe(DEFAULT_SETTINGS.side_panel_width)
    expect(savedStampsFrameHeight.value).toBe(
      DEFAULT_SETTINGS.saved_stamps_frame_height ?? DEFAULT_SAVED_STAMPS_FRAME_HEIGHT,
    )
    expect(bottomPanelOpen.value).toBe(DEFAULT_SETTINGS.bottom_panel_open)
    expect(bottomPanelTab.value).toBe(DEFAULT_SETTINGS.bottom_panel_tab)
    expect(bottomPanelHeights.value).toEqual({
      timeline: DEFAULT_SETTINGS.bottom_panel_timeline_height,
      budget: DEFAULT_SETTINGS.bottom_panel_budget_height,
      consortium: DEFAULT_SETTINGS.bottom_panel_consortium_height,
    })
    expect(snapToGridEnabled.value).toBe(DEFAULT_SETTINGS.snap_to_grid)
    expect(snapToGuidesEnabled.value).toBe(DEFAULT_SETTINGS.snap_to_guides)
    expect(layerVisibility.value.base).toBe(DEFAULT_SETTINGS.map_layer_visible)
    expect(layerVisibility.value.contours).toBe(DEFAULT_SETTINGS.contour_visible)
    expect(layerOpacity.value.base).toBe(DEFAULT_SETTINGS.map_opacity)
    expect(layerOpacity.value.contours).toBe(DEFAULT_SETTINGS.contour_opacity)
    expect(contourIntervalMeters.value).toBe(DEFAULT_SETTINGS.contour_interval)
    expect(hillshadeVisible.value).toBe(DEFAULT_SETTINGS.hillshade_visible)
    expect(hillshadeOpacity.value).toBe(DEFAULT_SETTINGS.hillshade_opacity)
  })
})
