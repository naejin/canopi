import type { SceneAnnotationEntity, ScenePoint, SceneViewportState } from './scene'

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

export interface AnnotationScreenBounds {
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

export function getAnnotationScreenBounds(
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
): AnnotationScreenBounds {
  return boundsForPoints(getAnnotationScreenCorners(annotation, viewport))
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

export function getAnnotationScreenCorners(
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
  paddingPx: { x: number; y: number } = { x: 0, y: 0 },
): ScenePoint[] {
  const metrics = getAnnotationTextMetrics(annotation)
  return rotatedRectCorners({
    origin: worldToScreen(annotation.position, viewport),
    width: metrics.widthPx,
    height: metrics.heightPx,
    paddingX: paddingPx.x,
    paddingY: paddingPx.y,
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
