import { batch } from '@preact/signals'
import {
  type BottomPanelTab,
  activeLayerName,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
  gridVisible,
  layerLockState,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from './canvas'
import { persistCurrentSettings } from './app'

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
  layerVisibility.value = {
    ...layerVisibility.value,
    [name]: !(layerVisibility.value[name] ?? true),
  }
}

export function toggleLayerLock(name: string): void {
  layerLockState.value = {
    ...layerLockState.value,
    [name]: !(layerLockState.value[name] ?? false),
  }
}

export function setLayerOpacity(name: string, opacity: number): void {
  layerOpacity.value = {
    ...layerOpacity.value,
    [name]: opacity,
  }
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

/** Commit final height on mouse-up and persist to Rust settings. */
export function commitBottomPanelHeight(height: number): void {
  if (bottomPanelHeight.value === height) return
  bottomPanelHeight.value = height
  persistCurrentSettings()
}
