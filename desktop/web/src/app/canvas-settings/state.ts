import { computed } from '@preact/signals'
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  bottomPanelHeights,
  bottomPanelOpen,
  bottomPanelTab,
  resolveBottomPanelHeight,
} from './bottom-panel-state'

export const bottomPanelView = computed(() => ({
  height: resolveBottomPanelHeight(bottomPanelTab.value, bottomPanelHeights.value),
  open: bottomPanelOpen.value,
  tab: bottomPanelTab.value,
  visibleTabs: VISIBLE_BOTTOM_PANEL_TABS,
}))
