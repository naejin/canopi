import { getCanvasColor, isThemeManagedZoneFill } from '../theme-refresh'
import type {
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

export type CanvasInteractionVisualState =
  | 'hover'
  | 'selected'
  | 'locked-design-object'
  | 'locked-layer'

export interface CanvasInteractionStrokeVisual {
  color: string
  widthPx: number
  alpha: number
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

export function getCanvasInteractionStrokeVisual(
  state: CanvasInteractionVisualState,
): CanvasInteractionStrokeVisual {
  if (state === 'selected') {
    return {
      color: getCanvasColor('selection-stroke'),
      widthPx: 4.5,
      alpha: 1,
    }
  }

  if (state === 'locked-design-object') {
    return {
      color: getCanvasColor('locked-object-stroke'),
      widthPx: 2.75,
      alpha: 0.86,
    }
  }

  if (state === 'locked-layer') {
    return {
      color: getCanvasColor('locked-layer-stroke'),
      widthPx: 2.75,
      alpha: 0.9,
    }
  }

  return {
    color: getCanvasColor('hover-stroke'),
    widthPx: 2.5,
    alpha: 0.72,
  }
}

export function getStackBadgeBackgroundColor(): string {
  return getCanvasColor('stack-badge-bg')
}

export function getStackBadgeTextColor(): string {
  return getCanvasColor('stack-badge-text')
}
