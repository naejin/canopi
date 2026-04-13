import { computed } from '@preact/signals'
import {
  VISIBLE_BOTTOM_PANEL_TABS,
  activeLayerName,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../../state/canvas'

export const bottomPanelView = computed(() => ({
  height: bottomPanelHeight.value,
  open: bottomPanelOpen.value,
  tab: bottomPanelTab.value,
  visibleTabs: VISIBLE_BOTTOM_PANEL_TABS,
}))

export const layerPanelView = computed(() => ({
  activeLayerName: activeLayerName.value,
  contourIntervalMeters: contourIntervalMeters.value,
  hillshadeOpacity: hillshadeOpacity.value,
  hillshadeVisible: hillshadeVisible.value,
  layerOpacity: layerOpacity.value,
  layerPanelOpen: layerPanelOpen.value,
  layerVisibility: layerVisibility.value,
}))
