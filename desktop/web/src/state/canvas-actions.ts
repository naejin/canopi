import {
  type BottomPanelTab,
  activeLayerName,
  bottomPanelHeight,
  bottomPanelOpen,
  bottomPanelTab,
  layerLockState,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from './canvas'

export function setLayerPanelOpen(open: boolean): void {
  layerPanelOpen.value = open
}

export function toggleLayerPanel(): void {
  layerPanelOpen.value = !layerPanelOpen.value
}

export function setActiveLayer(name: string): void {
  activeLayerName.value = name
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
}

export function openBottomPanel(tab: BottomPanelTab): void {
  bottomPanelTab.value = tab
  bottomPanelOpen.value = true
}

export function setBottomPanelTab(tab: BottomPanelTab): void {
  bottomPanelTab.value = tab
}

export function setBottomPanelHeight(height: number): void {
  bottomPanelHeight.value = height
}
