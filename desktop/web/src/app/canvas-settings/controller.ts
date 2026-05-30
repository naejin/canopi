import {
  activeLayerName,
  gridVisible,
  layerLockState,
  layerPanelOpen,
  layerVisibility,
} from './signals'
import { type BottomPanelTab } from './bottom-panel-state'
import type { BasemapStyle } from '../../generated/contracts'
import { mutateSettingsProjection } from '../settings/projection'
import { getCurrentCanvasCommandSurface } from '../../canvas/session'

const MAP_SETTING_LAYERS = new Set(['base', 'contours'])

function isMapSettingLayer(name: string): boolean {
  return MAP_SETTING_LAYERS.has(name)
}

export function setLayerPanelOpen(open: boolean): void {
  layerPanelOpen.value = open
}

export function toggleLayerPanel(): void {
  layerPanelOpen.value = !layerPanelOpen.value
}

export function setActiveLayer(name: string): void {
  activeLayerName.value = name
}

export function setBasemapStyle(style: BasemapStyle): void {
  mutateSettingsProjection((settings) => {
    settings.basemapStyle = style
  }, { persist: 'queued' })
}

export function toggleGridVisibility(): void {
  gridVisible.value = !gridVisible.value
}

export function toggleLayerVisibility(name: string): void {
  if (name === 'base') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.baseVisible = !settings.mapLayers.baseVisible
    }, { persist: 'queued' })
    return
  }
  if (name === 'contours') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.contoursVisible = !settings.mapLayers.contoursVisible
    }, { persist: 'queued' })
    return
  }

  const next = !(layerVisibility.value[name] ?? true)
  getCurrentCanvasCommandSurface()?.setSceneLayerVisibility(name, next)
}

export function toggleLayerLock(name: string): void {
  if (isMapSettingLayer(name)) return
  const next = !(layerLockState.value[name] ?? false)
  getCurrentCanvasCommandSurface()?.setSceneLayerLocked(name, next)
}

export function setLayerOpacity(name: string, opacity: number): void {
  const next = Math.min(1, Math.max(0, opacity))
  if (name === 'base') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.baseOpacity = next
    }, { persist: 'queued' })
    return
  }
  if (name === 'contours') {
    mutateSettingsProjection((settings) => {
      settings.mapLayers.contoursOpacity = next
    }, { persist: 'queued' })
    return
  }

  getCurrentCanvasCommandSurface()?.setSceneLayerOpacity(name, next)
}

export function setContourIntervalMeters(interval: number): void {
  if (!Number.isFinite(interval)) return
  mutateSettingsProjection((settings) => {
    settings.mapLayers.contourIntervalMeters = interval
  }, { persist: 'queued' })
}

export function toggleHillshadeVisibility(): void {
  mutateSettingsProjection((settings) => {
    settings.mapLayers.hillshadeVisible = !settings.mapLayers.hillshadeVisible
  }, { persist: 'queued' })
}

export function setHillshadeOpacity(opacity: number): void {
  mutateSettingsProjection((settings) => {
    settings.mapLayers.hillshadeOpacity = opacity
  }, { persist: 'queued' })
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
  mutateSettingsProjection((settings) => {
    settings.bottomPanel.height = height
  }, { persist: 'immediate' })
}
