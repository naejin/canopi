import {
  bottomPanelTab,
  type BottomPanelTab,
} from './bottom-panel-state'
import { mutateSettingsProjection } from '../settings/projection'

export function setBottomPanelOpen(open: boolean): void {
  mutateSettingsProjection((settings) => {
    settings.bottomPanel.open = open
  }, { persist: 'immediate' })
}

export function openBottomPanel(tab: BottomPanelTab): void {
  mutateSettingsProjection((settings) => {
    settings.bottomPanel.tab = tab
    settings.bottomPanel.open = true
  }, { persist: 'immediate' })
}

export function commitBottomPanelHeight(height: number): void {
  const tab = bottomPanelTab.peek()
  mutateSettingsProjection((settings) => {
    settings.bottomPanel.heights[tab] = height
  }, { persist: 'immediate' })
}
