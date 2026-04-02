import { getCanvasColor, isThemeManagedZoneFill } from '../theme-refresh'
import type {
  SceneLayerEntity,
  ScenePersistedState,
  SceneZoneEntity,
} from './scene'

export interface SceneLayerStyle {
  visible: boolean
  locked: boolean
  opacity: number
}

export interface SceneZoneVisual {
  fill: string
  stroke: string
}

export function getSceneLayerStyle(
  scene: ScenePersistedState,
  layerName: string,
): SceneLayerStyle {
  const layer = scene.layers.find((entry) => entry.name === layerName)
  return {
    visible: layer?.visible ?? true,
    locked: layer?.locked ?? false,
    opacity: layer?.opacity ?? 1,
  }
}

export function cloneLayerWithSignals(
  layer: SceneLayerEntity,
  visibility: Record<string, boolean>,
  locks: Record<string, boolean>,
  opacities: Record<string, number>,
): SceneLayerEntity {
  return {
    ...layer,
    visible: visibility[layer.name] ?? layer.visible,
    locked: locks[layer.name] ?? layer.locked,
    opacity: opacities[layer.name] ?? layer.opacity,
  }
}

export function resolveZoneVisual(zone: SceneZoneEntity): SceneZoneVisual {
  const fill = zone.fillColor && !isThemeManagedZoneFill(zone.fillColor)
    ? zone.fillColor
    : getCanvasColor('zone-fill')

  return {
    fill,
    stroke: getCanvasColor('zone-stroke'),
  }
}

export function getAnnotationTextColor(): string {
  return getCanvasColor('annotation-text')
}

export function getPlantLabelColor(): string {
  return getCanvasColor('plant-label')
}

export function getSelectionStrokeColor(): string {
  return getCanvasColor('selection-stroke')
}

export function getStackBadgeBackgroundColor(): string {
  return getCanvasColor('stack-badge-bg')
}

export function getStackBadgeTextColor(): string {
  return getCanvasColor('stack-badge-text')
}
