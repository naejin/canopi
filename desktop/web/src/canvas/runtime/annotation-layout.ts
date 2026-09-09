import { getCanvasTextOpacity } from './text-visibility'
import type { SceneAnnotationEntity, SceneDesignObjectSelection, ScenePoint, SceneViewportState } from './scene'

export interface AnnotationTextMetrics {
  widthPx: number
  heightPx: number
  lineHeightPx: number
}

export interface AnnotationWorldBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AnnotationScreenFrame {
  origin: ScenePoint
  widthPx: number
  heightPx: number
  lineHeightPx: number
  rotationDeg: number
}

export const ANNOTATION_MARKER_SIZE_PX = 8
export const ANNOTATION_MARKER_STROKE_PX = 1.5
export const ANNOTATION_MARKER_PATHS: readonly (readonly ScenePoint[])[] = [
  [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }, { x: -4, y: -4 }],
  [{ x: -2, y: -1 }, { x: 2, y: -1 }],
  [{ x: -2, y: 1 }, { x: 1, y: 1 }],
]
const COMPACT_MARKER_PATHS = [ANNOTATION_MARKER_PATHS[0]!.map(({ x, y }) => ({ x: x / 2, y: y / 2 }))]

export function getRevealedAnnotationId(selection: SceneDesignObjectSelection): string | null {
  return selection.length === 1 && selection[0]?.kind === 'annotation' ? selection[0].id : null
}

export function getAnnotationPresentation(
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
  revealText = false,
  textAllowed = true,
) {
  const textOpacity = revealText ? 1 : textAllowed ? getCanvasTextOpacity(viewport.scale) : 0
  const textFrame = getAnnotationScreenFrame(annotation, viewport)
  const markerOwnsGeometry = textOpacity < 0.5
  const compact = !textAllowed && getCanvasTextOpacity(viewport.scale) > 0
  const markerSize = compact ? 4 : ANNOTATION_MARKER_SIZE_PX
  return {
    textOpacity,
    markerOpacity: (1 - textOpacity) * (compact ? 0.5 : 1),
    markerPaths: compact ? COMPACT_MARKER_PATHS : ANNOTATION_MARKER_PATHS,
    markerStrokePx: compact ? 1 : ANNOTATION_MARKER_STROKE_PX,
    markerOwnsGeometry,
    textFrame,
    frame: markerOwnsGeometry ? {
      origin: { x: textFrame.origin.x - markerSize / 2, y: textFrame.origin.y - markerSize / 2 },
      widthPx: markerSize,
      heightPx: markerSize,
      lineHeightPx: 0,
      rotationDeg: 0,
    } : textFrame,
  }
}

export function getAnnotationVisualWorldCorners(
  annotation: SceneAnnotationEntity,
  viewportScale: number,
  revealText = false,
  paddingPx: { x: number; y: number } = { x: 0, y: 0 },
  textAllowed = true,
): ScenePoint[] {
  const { frame } = getAnnotationPresentation(annotation, { x: 0, y: 0, scale: viewportScale }, revealText, textAllowed)
  const safeScale = Math.max(viewportScale, 0.001)
  return rotatedRectCorners({
    origin: { x: frame.origin.x / safeScale, y: frame.origin.y / safeScale },
    width: frame.widthPx / safeScale,
    height: frame.heightPx / safeScale,
    paddingX: paddingPx.x / safeScale,
    paddingY: paddingPx.y / safeScale,
    rotationDeg: frame.rotationDeg,
  })
}

export function getAnnotationVisualWorldBounds(
  annotation: SceneAnnotationEntity,
  viewportScale: number,
  revealText = false,
  textAllowed = true,
): AnnotationWorldBounds {
  return boundsForPoints(getAnnotationVisualWorldCorners(annotation, viewportScale, revealText, undefined, textAllowed))
}

export function isPointInAnnotationPresentation(
  annotation: SceneAnnotationEntity,
  point: ScenePoint,
  viewportScale: number,
  revealText = false,
  textAllowed = true,
): boolean {
  if (revealText || (textAllowed && getCanvasTextOpacity(viewportScale) >= 0.5)) {
    return isPointInAnnotationText(annotation, point, viewportScale)
  }
  // Pointer allowance follows the visible marker, including crowded notes.
  const { frame } = getAnnotationPresentation(annotation, { x: 0, y: 0, scale: viewportScale }, false, textAllowed)
  const radius = (frame.widthPx / 2 + 4) / Math.max(viewportScale, 0.001)
  return Math.abs(point.x - annotation.position.x) <= radius + HIT_EPSILON
    && Math.abs(point.y - annotation.position.y) <= radius + HIT_EPSILON
}

const CHARACTER_WIDTH_FACTOR = 0.6
const LINE_HEIGHT_FACTOR = 1.25
const HIT_EPSILON = 0.000001

export function getAnnotationTextMetrics(annotation: SceneAnnotationEntity): AnnotationTextMetrics {
  const lines = annotation.text.split('\n')
  const maxLineLength = Math.max(...lines.map((line) => line.length), 1)
  const lineHeightPx = annotation.fontSize * LINE_HEIGHT_FACTOR
  return {
    widthPx: maxLineLength * annotation.fontSize * CHARACTER_WIDTH_FACTOR,
    heightPx: Math.max(lines.length * lineHeightPx, annotation.fontSize),
    lineHeightPx,
  }
}

export function getAnnotationWorldBounds(
  annotation: SceneAnnotationEntity,
  viewportScale: number,
): AnnotationWorldBounds {
  return boundsForPoints(getAnnotationWorldCorners(annotation, viewportScale))
}

export function getAnnotationScreenFrame(
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
): AnnotationScreenFrame {
  const metrics = getAnnotationTextMetrics(annotation)
  return {
    origin: worldToScreen(annotation.position, viewport),
    widthPx: metrics.widthPx,
    heightPx: metrics.heightPx,
    lineHeightPx: metrics.lineHeightPx,
    rotationDeg: annotation.rotationDeg ?? 0,
  }
}

export function getAnnotationWorldCorners(
  annotation: SceneAnnotationEntity,
  viewportScale: number,
  paddingPx: { x: number; y: number } = { x: 0, y: 0 },
): ScenePoint[] {
  const safeScale = Math.max(viewportScale, 0.001)
  const metrics = getAnnotationTextMetrics(annotation)
  return rotatedRectCorners({
    origin: annotation.position,
    width: metrics.widthPx / safeScale,
    height: metrics.heightPx / safeScale,
    paddingX: paddingPx.x / safeScale,
    paddingY: paddingPx.y / safeScale,
    rotationDeg: annotation.rotationDeg ?? 0,
  })
}

export function isPointInAnnotationText(
  annotation: SceneAnnotationEntity,
  point: ScenePoint,
  viewportScale: number,
): boolean {
  const safeScale = Math.max(viewportScale, 0.001)
  const metrics = getAnnotationTextMetrics(annotation)
  const local = inverseRotatePoint(point, annotation.position, annotation.rotationDeg ?? 0)
  return (
    local.x >= -HIT_EPSILON &&
    local.x <= metrics.widthPx / safeScale + HIT_EPSILON &&
    local.y >= -HIT_EPSILON &&
    local.y <= metrics.heightPx / safeScale + HIT_EPSILON
  )
}

export function worldToScreen(point: ScenePoint, viewport: SceneViewportState): ScenePoint {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  }
}

function rotatedRectCorners(options: {
  origin: ScenePoint
  width: number
  height: number
  paddingX: number
  paddingY: number
  rotationDeg: number
}): ScenePoint[] {
  const localCorners = [
    { x: -options.paddingX, y: -options.paddingY },
    { x: options.width + options.paddingX, y: -options.paddingY },
    { x: options.width + options.paddingX, y: options.height + options.paddingY },
    { x: -options.paddingX, y: options.height + options.paddingY },
  ]
  return localCorners.map((point) => rotateLocalPoint(point, options.origin, options.rotationDeg))
}

function rotateLocalPoint(point: ScenePoint, origin: ScenePoint, rotationDeg: number): ScenePoint {
  const radians = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    x: origin.x + point.x * cos - point.y * sin,
    y: origin.y + point.x * sin + point.y * cos,
  }
}

function inverseRotatePoint(point: ScenePoint, origin: ScenePoint, rotationDeg: number): ScenePoint {
  const radians = (-rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  }
}

function boundsForPoints(points: readonly ScenePoint[]): AnnotationWorldBounds {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  return {
    x: minX,
    y: minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  }
}
