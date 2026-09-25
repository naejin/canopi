import { worldToGeo } from '../canvas/projection'
import type { SceneViewportState } from '../canvas/runtime/scene'

export interface SharedMapPoint {
  readonly x: number
  readonly y: number
}

export interface SharedMapProjector {
  project(point: { readonly lng: number; readonly lat: number }): SharedMapPoint
}

export interface SharedMapSceneCameraTransformInput {
  readonly project: SharedMapProjector['project']
  // Session plane origin: plane (0, 0).
  readonly anchor: { readonly lat: number; readonly lon: number }
  readonly pitchDeg: number
  /** Largest local-coordinate distance covered by the active workspace. */
  readonly maximumWorldExtentMeters?: number
}

export type SharedMapSceneCameraTransform =
  | {
    readonly accepted: true
    readonly viewport: SceneViewportState
    readonly axisResidualPx: number
    readonly maximumScreenResidualPx: number
  }
  | {
    readonly accepted: false
    readonly reason: 'non-finite-projection' | 'pitched-camera' | 'non-positive-scale' | 'rotated-or-skewed-axes'
  }

/**
 * Derives the existing canvas viewport from MapLibre CSS-pixel projection.
 * The map is north-up, so plane x/y must project to right/down with a shared
 * scalar scale.
 */
export function deriveSharedMapSceneViewport(
  input: SharedMapSceneCameraTransformInput,
): SharedMapSceneCameraTransform {
  if (!Number.isFinite(input.pitchDeg) || Math.abs(input.pitchDeg) > 0.0001) {
    return { accepted: false, reason: 'pitched-camera' }
  }

  const origin = input.project(worldToGeo(0, 0, input.anchor.lat, input.anchor.lon))
  const xUnit = input.project(worldToGeo(1, 0, input.anchor.lat, input.anchor.lon))
  const yUnit = input.project(worldToGeo(0, 1, input.anchor.lat, input.anchor.lon))
  const values = [origin.x, origin.y, xUnit.x, xUnit.y, yUnit.x, yUnit.y]
  if (!values.every(Number.isFinite)) return { accepted: false, reason: 'non-finite-projection' }

  const xAxis = { x: xUnit.x - origin.x, y: xUnit.y - origin.y }
  const yAxis = { x: yUnit.x - origin.x, y: yUnit.y - origin.y }
  const xScale = Math.hypot(xAxis.x, xAxis.y)
  const yScale = Math.hypot(yAxis.x, yAxis.y)
  if (xAxis.x <= 0 || yAxis.y <= 0 || !Number.isFinite(xScale) || !Number.isFinite(yScale) || xScale <= 0 || yScale <= 0) {
    return { accepted: false, reason: 'non-positive-scale' }
  }

  const maximumWorldExtentMeters = input.maximumWorldExtentMeters ?? 10_000
  if (!Number.isFinite(maximumWorldExtentMeters) || maximumWorldExtentMeters <= 0) {
    return { accepted: false, reason: 'non-positive-scale' }
  }

  const scale = (xScale + yScale) / 2
  const axisResidualPx = Math.max(Math.abs(xAxis.y), Math.abs(yAxis.x), Math.abs(xScale - yScale))
  const maximumScreenResidualPx = maximumAffineResidualPx(
    xAxis,
    yAxis,
    scale,
    maximumWorldExtentMeters,
  )
  if (maximumScreenResidualPx > 1) return { accepted: false, reason: 'rotated-or-skewed-axes' }

  return {
    accepted: true,
    viewport: { x: origin.x, y: origin.y, scale },
    axisResidualPx,
    maximumScreenResidualPx,
  }
}

function maximumAffineResidualPx(
  xAxis: SharedMapPoint,
  yAxis: SharedMapPoint,
  scale: number,
  maximumWorldExtentMeters: number,
): number {
  let maximum = 0
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      const x = xSign * maximumWorldExtentMeters
      const y = ySign * maximumWorldExtentMeters
      const xError = (xAxis.x - scale) * x + yAxis.x * y
      const yError = xAxis.y * x + (yAxis.y - scale) * y
      maximum = Math.max(maximum, Math.hypot(xError, yError))
    }
  }
  return maximum
}
