import { mapZoomToStageScale } from './projection'

export const WORKSPACE_MAP_MIN_ZOOM = 0
export const WORKSPACE_MAP_MAX_ZOOM = 27
export const WORKSPACE_OVERVIEW_SCALE_THRESHOLD = 0.1

const MAPLIBRE_WORLD_TILE_SIZE = 512

export interface WorkspaceCameraPolicy {
  readonly referenceLatitudeDeg: number
  readonly minimumMapZoom: number
  readonly maximumMapZoom: number
  readonly overviewScaleThreshold: number
}

export interface WorkspaceCameraScaleBounds {
  readonly minimum: number
  readonly maximum: number
}

export function createWorkspaceCameraPolicy(
  referenceLatitudeDeg = 0,
): WorkspaceCameraPolicy {
  if (!Number.isFinite(referenceLatitudeDeg) || referenceLatitudeDeg <= -90 || referenceLatitudeDeg >= 90) {
    throw new Error('Workspace camera policy requires a finite reference latitude between -90 and 90 degrees.')
  }
  return Object.freeze({
    referenceLatitudeDeg,
    minimumMapZoom: WORKSPACE_MAP_MIN_ZOOM,
    maximumMapZoom: WORKSPACE_MAP_MAX_ZOOM,
    overviewScaleThreshold: WORKSPACE_OVERVIEW_SCALE_THRESHOLD,
  })
}

export function cameraScaleBoundsForPolicy(
  policy: WorkspaceCameraPolicy,
  effectiveMinimumMapZoom = policy.minimumMapZoom,
  effectiveMaximumMapZoom = policy.maximumMapZoom,
): WorkspaceCameraScaleBounds {
  const minimumZoom = Math.min(
    effectiveMaximumMapZoom,
    Math.max(policy.minimumMapZoom, effectiveMinimumMapZoom),
  )
  const maximumZoom = Math.max(
    minimumZoom,
    Math.min(policy.maximumMapZoom, effectiveMaximumMapZoom),
  )
  return Object.freeze({
    minimum: mapZoomToStageScale(minimumZoom, policy.referenceLatitudeDeg),
    maximum: mapZoomToStageScale(maximumZoom, policy.referenceLatitudeDeg),
  })
}

/** Baseline for MapLibre 6.4.1's single-world viewport constraint. */
export function singleWorldEffectiveMinimumZoom(
  cssWidth: number,
  cssHeight: number,
  configuredMinimumZoom = WORKSPACE_MAP_MIN_ZOOM,
): number {
  const viewportExtent = Math.max(cssWidth, cssHeight)
  if (!Number.isFinite(viewportExtent) || viewportExtent <= 0) return configuredMinimumZoom
  return Math.max(configuredMinimumZoom, Math.log2(viewportExtent / MAPLIBRE_WORLD_TILE_SIZE))
}

export function isWorkspaceOverviewScale(
  scale: number,
  policy: Pick<WorkspaceCameraPolicy, 'overviewScaleThreshold'>,
): boolean {
  return Number.isFinite(scale) && scale < policy.overviewScaleThreshold
}
