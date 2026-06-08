import {
  gridVisible,
  layerPanelOpen,
} from './signals'
import {
  bottomPanelTab,
  type BottomPanelTab,
} from './bottom-panel-state'
import type { BasemapStyle } from '../../generated/contracts'
import { mutateSettingsProjection } from '../settings/projection'
import {
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationBasemapStyle,
  setCanvasLayerPresentationContourIntervalMeters,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationVisibility,
  toggleCanvasLayerPresentationVisibility,
} from '../canvas-layer-presentation/presentation'

export function setLayerPanelOpen(open: boolean): void {
  layerPanelOpen.value = open
}

export function toggleLayerPanel(): void {
  layerPanelOpen.value = !layerPanelOpen.value
}

export function setActiveLayer(name: string): void {
  setCanvasLayerPresentationActiveLayer(name)
}

export function setBasemapStyle(style: BasemapStyle): void {
  setCanvasLayerPresentationBasemapStyle(style)
}

export function toggleGridVisibility(): void {
  gridVisible.value = !gridVisible.value
}

export function toggleLayerVisibility(name: string): void {
  toggleCanvasLayerPresentationVisibility(name)
}

export function toggleLayerLock(name: string): void {
  const row = readCanvasLayerPresentation().rows.find((entry) => entry.id === name)
  if (!row?.canLock) return
  setCanvasLayerPresentationLocked(name, !row.locked)
}

export function setLayerOpacity(name: string, opacity: number): void {
  setCanvasLayerPresentationOpacity(name, opacity)
}

export function setContourIntervalMeters(interval: number): void {
  setCanvasLayerPresentationContourIntervalMeters(interval)
}

export function toggleHillshadeVisibility(): void {
  const row = readCanvasLayerPresentation().rows.find((entry) => entry.id === 'hillshading')
  setCanvasLayerPresentationVisibility('hillshading', !(row?.visible ?? false))
}

export function setHillshadeOpacity(opacity: number): void {
  setCanvasLayerPresentationOpacity('hillshading', opacity)
}

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

export function setBottomPanelTab(tab: BottomPanelTab): void {
  mutateSettingsProjection((settings) => {
    settings.bottomPanel.tab = tab
  }, { persist: 'immediate' })
}

export function commitBottomPanelHeight(height: number): void {
  const tab = bottomPanelTab.peek()
  mutateSettingsProjection((settings) => {
    settings.bottomPanel.heights[tab] = height
  }, { persist: 'immediate' })
}
