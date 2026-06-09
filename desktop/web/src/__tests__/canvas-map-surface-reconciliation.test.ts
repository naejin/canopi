import { describe, expect, it } from 'vitest'
import {
  reconcileCanvasMapSurface,
  type CanvasMapSurfaceReconciliationState,
} from '../app/canvas-map-surface/reconciliation'
import type { CanvasMapSurfaceSnapshot } from '../app/canvas-map-surface/types'
import type { CanvasQuerySurface } from '../canvas/runtime/runtime'

const IDLE_STATE: CanvasMapSurfaceReconciliationState = {
  hasContainer: true,
  hasMap: false,
  activeBasemapStyle: null,
  surfaceStatus: 'idle',
  terrainStatus: 'idle',
}

function snapshot(
  overrides: Partial<CanvasMapSurfaceSnapshot> = {},
): CanvasMapSurfaceSnapshot {
  return {
    runtime: {} as CanvasQuerySurface,
    location: { lat: 48.8566, lon: 2.3522 },
    northBearingDeg: 12,
    basemapStyle: 'street',
    hasVisibleMapLayer: true,
    layerVisibility: { base: true, contours: false },
    layerOpacity: { base: 1, contours: 1 },
    terrain: {
      contourIntervalMeters: 0,
      contoursVisible: false,
      contoursOpacity: 1,
      hillshadeVisible: false,
      hillshadeOpacity: 0.55,
      isDark: false,
    },
    hoveredTargets: [],
    selectedTargets: [],
    theme: 'light',
    ...overrides,
  }
}

function reconcile(
  snapshotOverride: CanvasMapSurfaceSnapshot | null,
  state: Partial<CanvasMapSurfaceReconciliationState> = {},
) {
  return reconcileCanvasMapSurface(snapshotOverride, {
    ...IDLE_STATE,
    ...state,
  })
}

describe('Canvas Map Surface reconciliation', () => {
  it.each([
    ['missing-snapshot', null, {}],
    ['missing-runtime', snapshot({ runtime: null }), {}],
    ['missing-location', snapshot({ location: null }), {}],
    ['hidden', snapshot({ hasVisibleMapLayer: false }), {}],
    ['missing-container', snapshot(), { hasContainer: false }],
  ] as const)('stays inactive when the map is already idle: %s', (reason, input, state) => {
    expect(reconcile(input, state)).toEqual({ type: 'inactive', reason })
  })

  it('destroys active or loading state when required inputs disappear', () => {
    expect(reconcile(snapshot({ location: null }), {
      hasMap: true,
      activeBasemapStyle: 'street',
    })).toEqual({ type: 'destroy', reason: 'missing-location' })

    expect(reconcile(snapshot({ runtime: null }), {
      surfaceStatus: 'loading',
    })).toEqual({ type: 'destroy', reason: 'missing-runtime' })
  })

  it('creates a map when required inputs are present and no map exists', () => {
    expect(reconcile(snapshot())).toEqual({
      type: 'create',
      basemapStyle: 'street',
    })
  })

  it.each([
    ['base only', snapshot({
      hasVisibleMapLayer: true,
      layerVisibility: { base: true, contours: false },
      terrain: {
        contourIntervalMeters: 0,
        contoursVisible: false,
        contoursOpacity: 1,
        hillshadeVisible: false,
        hillshadeOpacity: 0.55,
        isDark: false,
      },
    })],
    ['contours only', snapshot({
      hasVisibleMapLayer: true,
      layerVisibility: { base: false, contours: true },
      terrain: {
        contourIntervalMeters: 10,
        contoursVisible: true,
        contoursOpacity: 1,
        hillshadeVisible: false,
        hillshadeOpacity: 0.55,
        isDark: false,
      },
    })],
    ['hillshade only', snapshot({
      hasVisibleMapLayer: true,
      layerVisibility: { base: false, contours: false },
      terrain: {
        contourIntervalMeters: 0,
        contoursVisible: false,
        contoursOpacity: 1,
        hillshadeVisible: true,
        hillshadeOpacity: 0.55,
        isDark: false,
      },
    })],
  ] as const)('keeps a map eligible with visible %s', (_label, input) => {
    expect(reconcile(input)).toEqual({ type: 'create', basemapStyle: 'street' })
  })

  it('syncs an existing map when the normalized basemap style is unchanged', () => {
    expect(reconcile(snapshot(), {
      hasMap: true,
      activeBasemapStyle: 'street',
      surfaceStatus: 'ready',
    })).toEqual({
      type: 'sync',
      basemapStyle: 'street',
      reusesMap: true,
    })
  })

  it('rebuilds an existing map when the normalized basemap style changes', () => {
    expect(reconcile(snapshot(), {
      hasMap: true,
      activeBasemapStyle: 'satellite',
      surfaceStatus: 'ready',
    })).toEqual({
      type: 'rebuild',
      basemapStyle: 'street',
    })
  })
})
