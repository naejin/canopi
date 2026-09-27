import { getCanvasColor, isThemeManagedZoneFill } from '../theme-refresh'
import { contrastRatio } from '../plant-colors'
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

/**
 * What shows under the Design on the map. The UI theme never decides label
 * ink: the basemap stays light in a dark UI and satellite imagery stays dark
 * in a light one, so text, halos, badges and the grid follow the backdrop.
 */
export type CanvasMapBackdrop = 'basemap' | 'dark-basemap' | 'satellite' | 'paper'

/**
 * A representative colour for each backdrop. `paper` equals the background
 * layer of the map's empty style (`maplibre/config.ts`), which does not
 * follow the UI theme.
 */
export const CANVAS_MAP_BACKDROP_COLORS: { readonly [K in CanvasMapBackdrop]: string } = {
  basemap: '#F8F4F0',
  'dark-basemap': '#1A1A1A',
  satellite: '#3B4232',
  paper: '#F3EFE4',
}

export interface CanvasBackdropInk {
  readonly text: string
  /** Drawn under text and markers so they read on busy imagery. */
  readonly halo: string
  readonly badgeBackground: string
  readonly badgeText: string
  readonly grid: string
  readonly gridMajor: string
}

// Dark ink on a cream halo for light backdrops; cream ink on a dark halo
// (the zone and guide stroke colours) for dark ones.
const INK_FOR_LIGHT_BACKDROP: CanvasBackdropInk = {
  text: '#27231D',
  halo: '#FFF8EC',
  badgeBackground: '#27231D',
  badgeText: '#FBF3E4',
  grid: 'rgba(39, 35, 29, 0.07)',
  gridMajor: 'rgba(39, 35, 29, 0.14)',
}

const INK_FOR_DARK_BACKDROP: CanvasBackdropInk = {
  text: '#FFF3D6',
  halo: '#14100A',
  badgeBackground: '#EFE8DA',
  badgeText: '#1D1A14',
  grid: 'rgba(239, 232, 218, 0.06)',
  gridMajor: 'rgba(239, 232, 218, 0.12)',
}

// The workspace map's backdrop, set by the runtime from its app adapter.
let mapBackdrop: CanvasMapBackdrop = 'basemap'

/** Returns true when the backdrop changed and the canvas must redraw. */
export function setCanvasMapBackdrop(backdrop: CanvasMapBackdrop): boolean {
  if (backdrop === mapBackdrop) return false
  mapBackdrop = backdrop
  return true
}

export function getCanvasMapBackdrop(): CanvasMapBackdrop {
  return mapBackdrop
}

/** The ink that contrasts more with `background` (a #RRGGBB colour). */
export function resolveBackdropInk(background: string): CanvasBackdropInk {
  return contrastRatio(INK_FOR_LIGHT_BACKDROP.text, background) >= contrastRatio(INK_FOR_DARK_BACKDROP.text, background)
    ? INK_FOR_LIGHT_BACKDROP
    : INK_FOR_DARK_BACKDROP
}

function mapBackdropColor(): string {
  return CANVAS_MAP_BACKDROP_COLORS[mapBackdrop]
}

/** The ink for text and chrome drawn over the workspace map. */
export function getMapBackdropInk(): CanvasBackdropInk {
  return resolveBackdropInk(mapBackdropColor())
}

export function getAnnotationTextColor(): string {
  return getMapBackdropInk().text
}

export function getPlantLabelColor(): string {
  return getMapBackdropInk().text
}

/** The halo stroked under map text of this size; the stroke is centred on the glyph edge. */
export function getLabelHalo(fontSizePx: number): { color: string; widthPx: number } {
  return { color: getMapBackdropInk().halo, widthPx: Math.max(3, Math.round(fontSizePx / 4)) }
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

export function getStackBadgeBackgroundColor(background = mapBackdropColor()): string {
  return resolveBackdropInk(background).badgeBackground
}

export function getStackBadgeTextColor(background = mapBackdropColor()): string {
  return resolveBackdropInk(background).badgeText
}

/**
 * The halo and cut-out colour of a plant symbol: the backdrop it sits on, or
 * the backdrop's ink when the plant colour is too close to the backdrop.
 */
export function getPlantSymbolEdgeColor(color: string, background = mapBackdropColor()): string {
  return contrastRatio(color, background) < 3 ? resolveBackdropInk(background).text : background
}

export function getPlantSymbolEdgeWidth(diameterPx: number): number {
  return diameterPx < 10 ? .5 : .7
}

