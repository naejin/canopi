import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  bottomPanelHeights,
  bottomPanelOpen,
  bottomPanelTab,
} from '../app/canvas-settings/bottom-panel-state'
import {
  commitBottomPanelHeight,
  openBottomPanel,
} from '../app/canvas-settings/controller'
import { hydrateSettingsProjection } from '../app/settings/projection'

beforeEach(() => {
  bottomPanelOpen.value = false
  bottomPanelTab.value = 'budget'
  hydrateSettingsProjection({
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
    auto_save_interval_s: 60,
    side_panel_width: null,
    saved_stamps_frame_height: 220,
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

describe('bottom panel actions', () => {
  it('supports every bottom panel tab internally when opened directly', () => {
    for (const tab of VISIBLE_BOTTOM_PANEL_TABS) {
      openBottomPanel(tab)

      expect(bottomPanelOpen.value).toBe(true)
      expect(bottomPanelTab.value).toBe(tab)
    }
  })

  it('commits height changes only to the active bottom panel tab', () => {
    openBottomPanel('timeline')
    commitBottomPanelHeight(260)
    openBottomPanel('budget')
    commitBottomPanelHeight(300)

    expect(bottomPanelHeights.value).toEqual({
      timeline: 260,
      budget: 300,
      consortium: null,
    })
  })
})
