import type { BasemapStyle } from '../../generated/contracts'
import { normalizeBasemapStyle } from '../../maplibre/config'
import type { MapLibreCanvasSurfaceStatus } from '../../maplibre/canvas-surface-state'
import type { CanvasMapSurfaceSnapshot } from './types'

export type CanvasMapSurfaceInactiveReason =
  | 'missing-snapshot'
  | 'missing-runtime'
  | 'missing-location'
  | 'hidden'
  | 'missing-container'

export type CanvasMapSurfaceReconciliation =
  | {
      readonly type: 'inactive'
      readonly reason: CanvasMapSurfaceInactiveReason
    }
  | {
      readonly type: 'destroy'
      readonly reason: CanvasMapSurfaceInactiveReason
    }
  | {
      readonly type: 'create'
      readonly basemapStyle: BasemapStyle
    }
  | {
      readonly type: 'rebuild'
      readonly basemapStyle: BasemapStyle
    }
  | {
      readonly type: 'sync'
      readonly basemapStyle: BasemapStyle
      readonly reusesMap: true
    }

export interface CanvasMapSurfaceReconciliationState {
  readonly hasContainer: boolean
  readonly hasMap: boolean
  readonly activeBasemapStyle: BasemapStyle | null
  readonly surfaceStatus: MapLibreCanvasSurfaceStatus
  readonly terrainStatus: MapLibreCanvasSurfaceStatus
}

export function reconcileCanvasMapSurface(
  snapshot: CanvasMapSurfaceSnapshot | null,
  state: CanvasMapSurfaceReconciliationState,
): CanvasMapSurfaceReconciliation {
  if (!snapshot) return reconcileInactiveCanvasMapSurface('missing-snapshot', state)
  if (!snapshot.runtime) return reconcileInactiveCanvasMapSurface('missing-runtime', state)
  if (!snapshot.location) return reconcileInactiveCanvasMapSurface('missing-location', state)
  if (!snapshot.hasVisibleMapLayer) {
    return reconcileInactiveCanvasMapSurface('hidden', state)
  }
  if (!state.hasContainer) return reconcileInactiveCanvasMapSurface('missing-container', state)

  const basemapStyle = normalizeBasemapStyle(snapshot.basemapStyle)
  if (!state.hasMap) return { type: 'create', basemapStyle }
  if (state.activeBasemapStyle !== basemapStyle) return { type: 'rebuild', basemapStyle }
  return { type: 'sync', basemapStyle, reusesMap: true }
}

function reconcileInactiveCanvasMapSurface(
  reason: CanvasMapSurfaceInactiveReason,
  state: CanvasMapSurfaceReconciliationState,
): CanvasMapSurfaceReconciliation {
  return state.hasMap || !surfaceStateIsIdle(state)
    ? { type: 'destroy', reason }
    : { type: 'inactive', reason }
}

function surfaceStateIsIdle(state: CanvasMapSurfaceReconciliationState): boolean {
  return state.surfaceStatus === 'idle' && state.terrainStatus === 'idle'
}
