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

const CHARACTER_WIDTH_FACTOR = 0.6
const LINE_HEIGHT_FACTOR = 1.25

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
  const safeScale = Math.max(viewportScale, 0.001)
  const metrics = getAnnotationTextMetrics(annotation)
  return {
    x: annotation.position.x,
    y: annotation.position.y,
    width: metrics.widthPx / safeScale,
    height: metrics.heightPx / safeScale,
  }
}

export function getAnnotationScreenBounds(
  annotation: SceneAnnotationEntity,
  viewport: SceneViewportState,
): AnnotationScreenBounds {
  const metrics = getAnnotationTextMetrics(annotation)
  const origin = worldToScreen(annotation.position, viewport)
  return {
    x: origin.x,
    y: origin.y,
    width: metrics.widthPx,
    height: metrics.heightPx,
  }
}

export function worldToScreen(point: ScenePoint, viewport: SceneViewportState): ScenePoint {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  }
}
