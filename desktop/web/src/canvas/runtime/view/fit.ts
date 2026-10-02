// canvas/runtime/view/fit.ts  (pure)
//
// Owns framing: the screen rectangle the chrome leaves, and the oriented fits that place a PlanarCamera inside it (Fit to Design
// over a scale-dependent point set, temporary focus on a box). A fit projects its points onto the screen axes at the target bearing
// and fits that extent, never a world-axis box; at bearing 0 each fit is today's CameraController fit, bit for bit (INV-CAM-09,
// INV-CAM-10).

import { bearingCosSin, normaliseBearing } from './navigation-policy'
import type { PlanarCamera, SceneBounds, ScreenInsets, TemporaryBoundsFocusOptions, WorldPoint } from './types'

const FIT_PADDING = 0.1
const FIT_MAX_ROUNDS = 20
const FIT_CONVERGENCE_THRESHOLD = 0.0001
/** Below this visible width or height, framing ignores the insets and uses the whole screen. */
const MIN_FRAMING_EXTENT_CSS_PX = 120
const NO_INSETS: ScreenInsets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })

/** The screen rectangle fitting frames into, in CSS pixels. */
export interface FramingRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What a fit frames into and starts from. */
export interface FitFrame {
  readonly screen: { readonly width: number; readonly height: number }
  /** Screen edges covered by floating chrome (the visible-map-area seam). */
  readonly insets?: ScreenInsets
  /** The effective scale bounds at the target bearing (ViewFrame.scaleBounds). */
  readonly scaleBounds: { readonly min: number; readonly max: number }
  /** The live placement: its scale seeds the extent loop, and it is kept when there is nothing to fit. */
  readonly current: PlanarCamera
}

/** A scene's extent for Fit to Design: SceneBoundsOptions with the extent the runtime supplies (canvas/runtime/scene-extent.ts). */
export interface FitExtent {
  readonly extentPoints: (pixelsPerMetre: number) => readonly WorldPoint[]
  /** Scale that frames an empty Design, centred on the session plane origin. */
  readonly emptySceneScale?: number
}

/** Extent of a point set along the screen axes at a bearing: across = right, down = down. */
interface OrientedExtent {
  readonly minAcross: number
  readonly minDown: number
  readonly maxAcross: number
  readonly maxDown: number
}

/**
 * The part of the screen not covered by floating chrome. When the insets leave too little room (or are invalid), the whole
 * screen is the frame.
 */
export function framingRect(screen: { readonly width: number; readonly height: number }, insets: ScreenInsets = NO_INSETS): FramingRect {
  const width = screen.width - insets.left - insets.right
  const height = screen.height - insets.top - insets.bottom
  if (
    ![width, height].every(Number.isFinite)
    || width < MIN_FRAMING_EXTENT_CSS_PX
    || height < MIN_FRAMING_EXTENT_CSS_PX
  ) return { x: 0, y: 0, width: screen.width, height: screen.height }
  return { x: insets.left, y: insets.top, width, height }
}

/**
 * Fit to Design at a bearing. Notes and default-mode plants are screen-sized, so the extent depends on the scale: the fit
 * recomputes it at each candidate scale until the scale changes by less than 0.01 % (at most 20 rounds; typically 2–3).
 */
export function fitScene(frame: FitFrame, extent: FitExtent, bearingDeg: number): PlanarCamera {
  if (frame.screen.width <= 0 || frame.screen.height <= 0) return frame.current
  const rect = framingRect(frame.screen, frame.insets)
  const bearing = normaliseBearing(bearingDeg)

  let currentScale = frame.current.scale
  let bounds: OrientedExtent | null = null
  let scale = currentScale
  for (let round = 0; round < FIT_MAX_ROUNDS; round++) {
    bounds = orientedExtent(extent.extentPoints(currentScale), bearing)
    if (!bounds) return emptyScenePlacement(frame, extent.emptySceneScale, bearing)

    const contentWidth = Math.max(bounds.maxAcross - bounds.minAcross, 1)
    const contentHeight = Math.max(bounds.maxDown - bounds.minDown, 1)
    scale = clampScale(Math.min(
      (rect.width * (1 - FIT_PADDING * 2)) / contentWidth,
      (rect.height * (1 - FIT_PADDING * 2)) / contentHeight,
    ), frame.scaleBounds)

    if (Math.abs(scale - currentScale) / Math.max(scale, currentScale) < FIT_CONVERGENCE_THRESHOLD) break
    currentScale = scale
  }

  const finalBounds = bounds!
  const contentWidth = Math.max(finalBounds.maxAcross - finalBounds.minAcross, 1)
  const contentHeight = Math.max(finalBounds.maxDown - finalBounds.minDown, 1)
  return {
    x: rect.x + (rect.width - contentWidth * scale) / 2 - finalBounds.minAcross * scale,
    y: rect.y + (rect.height - contentHeight * scale) / 2 - finalBounds.minDown * scale,
    scale,
    bearingDeg: bearing,
  }
}

/**
 * Temporary focus (plant finder, LiDAR) at a bearing: the box's four corners are fitted, with symmetric CSS-pixel padding and
 * an optional scale ceiling. Null when the box, padding, ceiling or screen cannot frame it.
 */
export function fitTemporaryBounds(
  frame: FitFrame,
  bounds: SceneBounds,
  options: TemporaryBoundsFocusOptions,
  bearingDeg: number,
): PlanarCamera | null {
  const { width: screenWidth, height: screenHeight } = frame.screen
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight) || screenWidth <= 0 || screenHeight <= 0) return null
  const rect = framingRect(frame.screen, frame.insets)
  const { width, height } = rect
  const { minX, minY, maxX, maxY } = bounds
  const padding = options.paddingCssPx
  const maximumScale = options.maximumScale ?? frame.scaleBounds.max
  if (
    ![width, height, minX, minY, maxX, maxY, padding, maximumScale].every(Number.isFinite)
    || width <= 0
    || height <= 0
    || minX >= maxX
    || minY >= maxY
    || padding < 0
    || maximumScale < frame.scaleBounds.min
  ) return null

  const availableWidth = width - padding * 2
  const availableHeight = height - padding * 2
  if (availableWidth <= 0 || availableHeight <= 0) return null

  const bearing = normaliseBearing(bearingDeg)
  const box = orientedExtent([
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ], bearing)!
  const scale = clampScale(Math.min(
    availableWidth / (box.maxAcross - box.minAcross),
    availableHeight / (box.maxDown - box.minDown),
    maximumScale,
  ), frame.scaleBounds)
  if (!Number.isFinite(scale) || scale > maximumScale) return null

  return {
    x: rect.x + width / 2 - ((box.minAcross + box.maxAcross) / 2) * scale,
    y: rect.y + height / 2 - ((box.minDown + box.maxDown) / 2) * scale,
    scale,
    bearingDeg: bearing,
  }
}

/** Null for an empty or non-finite point set (today's computeSceneBounds returning null). */
function orientedExtent(points: readonly WorldPoint[], bearingDeg: number): OrientedExtent | null {
  const [cos, sin] = bearingCosSin(bearingDeg)
  const level = cos === 1 && sin === 0
  let minAcross = Number.POSITIVE_INFINITY
  let minDown = Number.POSITIVE_INFINITY
  let maxAcross = Number.NEGATIVE_INFINITY
  let maxDown = Number.NEGATIVE_INFINITY
  for (const point of points) {
    // The point's screen-axis components: turned counter-clockwise on screen by the bearing (the identity at bearing 0).
    const across = level ? point.x : cos * point.x + sin * point.y
    const down = level ? point.y : cos * point.y - sin * point.x
    minAcross = Math.min(minAcross, across)
    minDown = Math.min(minDown, down)
    maxAcross = Math.max(maxAcross, across)
    maxDown = Math.max(maxDown, down)
  }
  if (![minAcross, minDown, maxAcross, maxDown].every(Number.isFinite)) return null
  return { minAcross, minDown, maxAcross, maxDown }
}

/** An empty Design frames the session plane origin at the centre of the whole screen, or keeps the placement. */
function emptyScenePlacement(frame: FitFrame, emptySceneScale: number | undefined, bearingDeg: number): PlanarCamera {
  if (emptySceneScale === undefined || !(emptySceneScale > 0)) return frame.current
  const scale = clampScale(emptySceneScale, frame.scaleBounds)
  return { x: frame.screen.width / 2, y: frame.screen.height / 2, scale, bearingDeg }
}

function clampScale(scale: number, bounds: { readonly min: number; readonly max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, scale))
}
