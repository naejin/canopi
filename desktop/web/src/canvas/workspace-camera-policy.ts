// canvas/workspace-camera-policy.ts  (pure)
//
// The workspace camera's limits: the map's zoom range, the overview threshold and the single-world zoom floor. The navigation
// policy (canvas/runtime/view/navigation-policy.ts) carries them to both camera drivers.

import { MAPLIBRE_WORLD_TILE_SIZE, scaleReaches } from './projection'

export const WORKSPACE_MAP_MIN_ZOOM = 0
export const WORKSPACE_MAP_MAX_ZOOM = 27
/** Overview starts below this many pixels per metre, the same at every latitude. */
export const WORKSPACE_OVERVIEW_SCALE_THRESHOLD = 0.1

/** Baseline for MapLibre 6.10.0's single-world viewport constraint. */
export function singleWorldEffectiveMinimumZoom(
  cssWidth: number,
  cssHeight: number,
  configuredMinimumZoom = WORKSPACE_MAP_MIN_ZOOM,
): number {
  const viewportExtent = Math.max(cssWidth, cssHeight)
  if (!Number.isFinite(viewportExtent) || viewportExtent <= 0) return configuredMinimumZoom
  return Math.max(configuredMinimumZoom, Math.log2(viewportExtent / MAPLIBRE_WORLD_TILE_SIZE))
}

export function isWorkspaceOverviewScale(scale: number): boolean {
  return !scaleReaches(scale, WORKSPACE_OVERVIEW_SCALE_THRESHOLD)
}
