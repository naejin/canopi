import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))
import { VISIBLE_BOTTOM_PANEL_TABS, bottomPanelOpen, bottomPanelTab } from '../state/canvas'
import { openBottomPanel, setBottomPanelTab } from '../state/canvas-actions'

beforeEach(() => {
  bottomPanelOpen.value = false
  bottomPanelTab.value = 'budget'
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
})
