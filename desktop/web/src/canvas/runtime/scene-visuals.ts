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
  /** Drawn under the stroke so the zone edge reads on bright or dark imagery. */
  casing: string
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
  /** Drawn first, under the stroke, at the same alpha. */
  casingColor: string
  casingWidthPx: number
}

/** Light overlay strokes (zones, guides, drafts) sit on a casing this much wider. */
export const OVERLAY_CASING_EXTRA_PX = 2

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
    casing: getCanvasColor('overlay-casing'),
  }
}

/** Guides and drawing previews over the map: a light stroke on a dark casing. */
export function getGuideLineVisual(): { color: string; casing: string } {
  return { color: getCanvasColor('guide-line'), casing: getCanvasColor('overlay-casing') }
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
  // Selected: 2.5 px ochre over a 5.5 px casing; every state keeps its casing
  // so rings and outlines read on satellite imagery and plain basemaps alike.
  if (state === 'selected') return interactionStroke('selection-stroke', 2.5, 1, 5.5)
  if (state === 'locked-design-object') return interactionStroke('locked-object-stroke', 2.25, 0.86, 4.25)
  if (state === 'locked-layer') return interactionStroke('locked-layer-stroke', 2.25, 0.9, 4.25)
  return interactionStroke('hover-stroke', 2, 0.72, 4)
}

function interactionStroke(
  token: 'selection-stroke' | 'locked-object-stroke' | 'locked-layer-stroke' | 'hover-stroke',
  widthPx: number,
  alpha: number,
  casingWidthPx: number,
): CanvasInteractionStrokeVisual {
  return {
    color: getCanvasColor(token),
    widthPx,
    alpha,
    casingColor: getCanvasColor('interaction-casing'),
    casingWidthPx,
  }
}

export function getStackBadgeBackgroundColor(): string {
  return getCanvasColor('stack-badge-bg')
}

export function getStackBadgeTextColor(): string {
  return getCanvasColor('stack-badge-text')
}

/** A thin edge separates silhouettes from Zones without replacing authored color. */
export function getPlantSymbolEdgeColor(color: string): string {
  const background = getCanvasColor('background')
  const a = hexLuminance(color), b = hexLuminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 3
    ? getCanvasColor('plant-label') : background
}

export function getPlantSymbolEdgeWidth(diameterPx: number): number {
  return diameterPx < 10 ? .5 : .7
}

function hexLuminance(color: string): number {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  return rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722
}
