import { beforeEach, describe, expect, it } from 'vitest'
import { bottomPanelOpen, bottomPanelTab } from '../state/canvas'
import { openBottomPanel, setBottomPanelTab } from '../state/canvas-actions'

beforeEach(() => {
  bottomPanelOpen.value = false
  bottomPanelTab.value = 'location'
})

describe('bottom panel actions', () => {
  it('opens the location tab directly from the launcher flow', () => {
    openBottomPanel('location')

    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelTab.value).toBe('location')
  })

  it('keeps the panel open when setting the same tab', () => {
    openBottomPanel('location')
    setBottomPanelTab('location')

    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelTab.value).toBe('location')
  })
})
