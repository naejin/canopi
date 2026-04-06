import { beforeEach, describe, expect, it } from 'vitest'
import { VISIBLE_BOTTOM_PANEL_TABS, bottomPanelOpen, bottomPanelTab } from '../state/canvas'
import { openBottomPanel, setBottomPanelTab } from '../state/canvas-actions'

beforeEach(() => {
  bottomPanelOpen.value = false
  bottomPanelTab.value = 'timeline'
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
    openBottomPanel('timeline')
    setBottomPanelTab('timeline')

    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelTab.value).toBe('timeline')
  })
})
