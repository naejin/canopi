import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))

import {
  activeLayerName,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerLockState,
  layerOpacity,
  layerVisibility,
} from '../app/canvas-settings/signals'
import {
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationBasemapStyle,
  setCanvasLayerPresentationContourIntervalMeters,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationVisibility,
} from '../app/canvas-layer-presentation/presentation'
import { flushSettingsProjection, hydrateSettingsProjection } from '../app/settings/projection'
import { basemapStyle, locale } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { currentDesign } from './support/design-session-state'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('Canvas Layer Presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    locale.value = 'en'
    activeLayerName.value = 'base'
    basemapStyle.value = 'street'
    layerVisibility.value = {
      base: false,
      contours: true,
      plants: true,
      zones: false,
      annotations: true,
    }
    layerLockState.value = {
      plants: false,
      zones: true,
      annotations: false,
    }
    layerOpacity.value = {
      base: 0.65,
      contours: 0.5,
      plants: 0.8,
      zones: 0.35,
      annotations: 1,
    }
    contourIntervalMeters.value = 12
    hillshadeVisible.value = true
    hillshadeOpacity.value = 0.45
    hydrateSettingsProjection({
      locale: 'en',
      theme: 'light',
      snap_to_grid: true,
      snap_to_guides: true,
      show_smart_guides: true,
      auto_save_interval_s: 60,
      confirm_destructive: true,
      default_currency: 'EUR',
      measurement_units: 'metric',
      show_botanical_names: true,
      debug_logging: false,
      check_updates: true,
      default_design_dir: '',
      recent_files_max: 20,
      last_active_panel: 'canvas',
      side_panel_width: null,
      saved_stamps_frame_height: 220,
      bottom_panel_open: false,
      bottom_panel_timeline_height: null,
      bottom_panel_budget_height: null,
      bottom_panel_consortium_height: null,
      bottom_panel_tab: 'budget',
      map_layer_visible: false,
      map_style: 'street',
      map_opacity: 0.65,
      contour_visible: true,
      contour_opacity: 0.5,
      contour_interval: 12,
      hillshade_visible: true,
      hillshade_opacity: 0.45,
      plant_spacing_interval_m: 0.5,
    })
    currentDesign.value = {
      version: 2,
      name: 'Layer presentation',
      description: null,
      location: { lat: 48.8566, lon: 2.3522, altitude_m: null },
      north_bearing_deg: 0,
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
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      queries: createTestCanvasQuerySurface({
        scene: {
          plantSpeciesColors: {},
          plantSpeciesSymbols: {},
          layers: [
            { kind: 'layer', name: 'annotations', visible: true, locked: false, opacity: 1 },
            { kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 0.8 },
            { kind: 'layer', name: 'measurement-guides', visible: true, locked: false, opacity: 0.6 },
            { kind: 'layer', name: 'zones', visible: false, locked: true, opacity: 0.35 },
          ],
          plants: [],
          zones: [],
          annotations: [],
          groups: [],
          guides: [],
        },
      }),
    }))
  })

  afterEach(() => {
    flushSettingsProjection()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    currentDesign.value = null
    setCurrentCanvasSession(null)
  })

  it('builds a visible Layer catalog from scene, map, and terrain authorities', () => {
    const presentation = readCanvasLayerPresentation()

    expect(presentation.rows.map((row) => ({
      id: row.id,
      label: row.label,
      authority: row.authority,
      active: row.active,
      visible: row.visible,
      opacity: row.opacity,
      locked: row.locked,
      canLock: row.canLock,
      detail: row.detail,
    }))).toEqual([
      {
        id: 'annotations',
        label: 'Annotations',
        authority: 'scene',
        active: false,
        visible: true,
        opacity: 1,
        locked: false,
        canLock: true,
        detail: { type: 'scene' },
      },
      {
        id: 'plants',
        label: 'Plants',
        authority: 'scene',
        active: false,
        visible: true,
        opacity: 0.8,
        locked: false,
        canLock: true,
        detail: { type: 'scene' },
      },
      {
        id: 'measurement-guides',
        label: 'Measurement Guides',
        authority: 'scene',
        active: false,
        visible: true,
        opacity: 0.6,
        locked: false,
        canLock: true,
        detail: { type: 'scene' },
      },
      {
        id: 'zones',
        label: 'Zones',
        authority: 'scene',
        active: false,
        visible: false,
        opacity: 0.35,
        locked: true,
        canLock: true,
        detail: { type: 'scene' },
      },
      {
        id: 'base',
        label: 'Basemap',
        authority: 'map-settings',
        active: true,
        visible: false,
        opacity: 0.65,
        locked: false,
        canLock: false,
        detail: {
          type: 'location-map',
          hasLocation: true,
          locationSummary: '48.8566, 2.3522',
          opacityDisabled: false,
        },
      },
      {
        id: 'contours',
        label: 'Contour lines',
        authority: 'map-settings',
        active: false,
        visible: true,
        opacity: 0.5,
        locked: false,
        canLock: false,
        detail: {
          type: 'contours',
          contourIntervalMeters: 12,
          hasLocation: true,
        },
      },
      {
        id: 'hillshading',
        label: 'Hillshading',
        authority: 'terrain-settings',
        active: false,
        visible: true,
        opacity: 0.45,
        locked: false,
        canLock: false,
        detail: {
          type: 'hillshade',
          hasLocation: true,
        },
      },
    ])
    expect(presentation.hasVisibleMapLayer).toBe(true)
  })

  it('routes Layer commands to the authority that owns each row', () => {
    const originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
    ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = 'test-maptiler-key'
    const layerCommands = {
      setSceneLayerVisibility: vi.fn(() => true),
      setSceneLayerOpacity: vi.fn(() => true),
      setSceneLayerLocked: vi.fn(() => true),
    }

    try {
      setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
        commands: createTestCanvasCommandSurface({ layers: layerCommands }),
      }))

      expect(setCanvasLayerPresentationVisibility('base', true)).toBe(true)
      expect(setCanvasLayerPresentationOpacity('contours', 0.25)).toBe(true)
      expect(setCanvasLayerPresentationVisibility('hillshading', false)).toBe(true)
      expect(setCanvasLayerPresentationOpacity('hillshading', 0.2)).toBe(true)
      expect(setCanvasLayerPresentationContourIntervalMeters(18)).toBe(true)
      setCanvasLayerPresentationBasemapStyle('satellite')
      setCanvasLayerPresentationActiveLayer('plants')

      expect(layerVisibility.value.base).toBe(true)
      expect(layerOpacity.value.contours).toBe(0.25)
      expect(hillshadeVisible.value).toBe(false)
      expect(hillshadeOpacity.value).toBe(0.2)
      expect(contourIntervalMeters.value).toBe(18)
      expect(basemapStyle.value).toBe('satellite')
      expect(activeLayerName.value).toBe('plants')

      expect(setCanvasLayerPresentationVisibility('plants', false)).toBe(true)
      expect(setCanvasLayerPresentationOpacity('zones', 0.4)).toBe(true)
      expect(setCanvasLayerPresentationLocked('annotations', true)).toBe(true)
      expect(setCanvasLayerPresentationLocked('base', true)).toBe(false)

      expect(layerCommands.setSceneLayerVisibility).toHaveBeenCalledWith('plants', false)
      expect(layerCommands.setSceneLayerOpacity).toHaveBeenCalledWith('zones', 0.4)
      expect(layerCommands.setSceneLayerLocked).toHaveBeenCalledWith('annotations', true)
      expect(layerCommands.setSceneLayerLocked).not.toHaveBeenCalledWith('base', true)
    } finally {
      ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
    }
  })

  it('rejects invalid numeric Layer inputs without mutating state', () => {
    expect(setCanvasLayerPresentationContourIntervalMeters(Number.NaN)).toBe(false)
    expect(setCanvasLayerPresentationOpacity('base', Number.NaN)).toBe(false)

    expect(contourIntervalMeters.value).toBe(12)
    expect(layerOpacity.value.base).toBe(0.65)
  })
})
