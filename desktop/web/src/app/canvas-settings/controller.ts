import { batch } from '@preact/signals'
import {
  type BottomPanelTab,
  activeLayerName,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
  contourIntervalMeters,
  gridVisible,
  hillshadeOpacity,
  hillshadeVisible,
  layerLockState,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../../state/canvas'
import { persistCurrentSettings, queueSettingsPersist } from '../settings/persistence'

export function setLayerPanelOpen(open: boolean): void {
  layerPanelOpen.value = open
}

export function toggleLayerPanel(): void {
  layerPanelOpen.value = !layerPanelOpen.value
}

export function setActiveLayer(name: string): void {
  activeLayerName.value = name
}

export function toggleGridVisibility(): void {
  gridVisible.value = !gridVisible.value
}

export function toggleLayerVisibility(name: string): void {
  const next = !(layerVisibility.value[name] ?? true)
  layerVisibility.value = {
    ...layerVisibility.value,
    [name]: next,
  }
  if (name === 'base' || name === 'contours') {
    queueSettingsPersist()
  }
}

export function toggleLayerLock(name: string): void {
  layerLockState.value = {
    ...layerLockState.value,
    [name]: !(layerLockState.value[name] ?? false),
  }
}

export function setLayerOpacity(name: string, opacity: number): void {
  const next = Math.min(1, Math.max(0, opacity))
  layerOpacity.value = {
    ...layerOpacity.value,
    [name]: next,
  }
  if (name === 'base' || name === 'contours') {
    queueSettingsPersist()
  }
}

export function setContourIntervalMeters(interval: number): void {
  if (!Number.isFinite(interval)) return
  contourIntervalMeters.value = Math.max(0, Math.round(interval))
  queueSettingsPersist()
}

export function toggleHillshadeVisibility(): void {
  hillshadeVisible.value = !hillshadeVisible.value
  queueSettingsPersist()
}

export function setHillshadeOpacity(opacity: number): void {
  hillshadeOpacity.value = Math.min(1, Math.max(0, opacity))
  queueSettingsPersist()
}

export function setBottomPanelOpen(open: boolean): void {
  bottomPanelOpen.value = open
  persistCurrentSettings()
}

export function openBottomPanel(tab: BottomPanelTab): void {
  batch(() => {
    bottomPanelTab.value = tab
    bottomPanelOpen.value = true
  })
  persistCurrentSettings()
}

export function setBottomPanelTab(tab: BottomPanelTab): void {
  bottomPanelTab.value = tab
  persistCurrentSettings()
}

export function commitBottomPanelHeight(height: number): void {
  if (bottomPanelHeight.value === height) return
  bottomPanelHeight.value = height
  persistCurrentSettings()
}
