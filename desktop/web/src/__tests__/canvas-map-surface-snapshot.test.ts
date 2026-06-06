import { effect, signal } from '@preact/signals'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
} from '../app/canvas-settings/signals'
import {
  readCanvasMapSurfaceCoreSnapshot,
  readCanvasMapSurfaceSnapshot,
} from '../app/canvas-map-surface/snapshot'
import {
  hoveredPanelTargets,
  selectedPanelTargets,
} from '../app/panel-targets/state'
import { basemapStyle, theme } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { northBearingDeg } from '../canvas/scene-metadata-state'
import { currentDesign } from './support/design-session-state'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

describe('Canvas Map Surface snapshot seam', () => {
  beforeEach(() => {
    currentDesign.value = {
      version: 2,
      name: 'Map seam',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 18,
      plant_species_colors: {},
      layers: [],
      plants: [],
      zones: [],
      annotations: [],
      consortiums: [],
      groups: [],
      timeline: [],
      budget: [],
      budget_currency: 'EUR',
      created_at: '',
      updated_at: '',
      extra: {},
    }
    northBearingDeg.value = 18
    basemapStyle.value = 'satellite'
    theme.value = 'dark'
    layerVisibility.value = { base: false, contours: true, plants: true }
    layerOpacity.value = { base: 0.4, contours: 0.75, plants: 1 }
    contourIntervalMeters.value = 5
    hillshadeVisible.value = true
    hillshadeOpacity.value = 0.35
    hoveredPanelTargets.value = [{ kind: 'manual' }]
    selectedPanelTargets.value = [{ kind: 'none' }]
    setCurrentCanvasSession(null)
  })

  afterEach(() => {
    currentDesign.value = null
    northBearingDeg.value = 0
    basemapStyle.value = 'street'
    theme.value = 'light'
    layerVisibility.value = { base: true, contours: false }
    layerOpacity.value = { base: 1, contours: 1 }
    contourIntervalMeters.value = 0
    hillshadeVisible.value = false
    hillshadeOpacity.value = 0.55
    hoveredPanelTargets.value = []
    selectedPanelTargets.value = []
    setCurrentCanvasSession(null)
  })

  it('assembles core map inputs and tracks runtime viewport freshness', () => {
    const viewportRevision = signal(0)
    const runtime = {
      ...createTestCanvasQuerySurface(),
      revision: {
        scene: signal(0),
        plantNames: signal(0),
        viewport: viewportRevision,
      },
    }
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: runtime }))

    const snapshots: ReturnType<typeof readCanvasMapSurfaceCoreSnapshot>[] = []
    const dispose = effect(() => {
      snapshots.push(readCanvasMapSurfaceCoreSnapshot())
    })

    try {
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0]).toMatchObject({
        runtime,
        location: { lat: 48.8566, lon: 2.3522 },
        northBearingDeg: 18,
        basemapStyle: 'satellite',
        layerVisibility: { base: false, contours: true, plants: true },
        layerOpacity: { base: 0.4, contours: 0.75, plants: 1 },
        theme: 'dark',
      })

      viewportRevision.value += 1

      expect(snapshots).toHaveLength(2)
      expect(snapshots[1]?.runtime).toBe(runtime)
    } finally {
      dispose()
    }
  })

  it('assembles terrain and Target Presentation inputs into the full map snapshot', () => {
    const runtime = createTestCanvasQuerySurface()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries: runtime }))

    expect(readCanvasMapSurfaceSnapshot()).toMatchObject({
      runtime,
      terrain: {
        contourIntervalMeters: 5,
        contoursVisible: true,
        contoursOpacity: 0.75,
        hillshadeVisible: true,
        hillshadeOpacity: 0.35,
        isDark: true,
      },
      hoveredTargets: [{ kind: 'manual' }],
      selectedTargets: [{ kind: 'none' }],
    })
  })
})
