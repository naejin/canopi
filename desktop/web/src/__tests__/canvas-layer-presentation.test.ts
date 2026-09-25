import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  activeLayerName,
  layerLockState,
  layerOpacity,
  layerVisibility,
} from '../app/canvas-settings/signals'
import { mapLayers } from '../app/map-layers/state'
import {
  readCanvasLayerPresentation,
  setCanvasLayerPresentationActiveLayer,
  setCanvasLayerPresentationContourIntervalMeters,
  setCanvasLayerPresentationLocked,
  setCanvasLayerPresentationOpacity,
  setCanvasLayerPresentationVisibility,
} from '../app/canvas-layer-presentation/presentation'
import { flushSettingsProjection, hydrateSettingsProjection } from '../app/settings/projection'
import { googleMapsApiKey, locale } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { designSessionFixture } from './support/design-session-state'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('Canvas Layer Presentation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    locale.value = 'en'
    activeLayerName.value = 'basemap'
    layerVisibility.value = {
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
      plants: 0.8,
      zones: 0.35,
      annotations: 1,
    }
    hydrateSettingsProjection({
      locale: 'en',
      theme: 'light',
      snap_to_grid: true,
      snap_to_guides: true,
      side_panel_width: null,
      saved_stamps_frame_height: 220,
      basemap_style: 'positron',
      basemap_visible: false,
      basemap_opacity: 0.65,
      satellite_visible: false,
      satellite_opacity: 0.9,
      google_maps_api_key: null,
      contour_visible: true,
      contour_opacity: 0.5,
      contour_interval: 12,
      hillshade_visible: true,
      hillshade_opacity: 0.45,
      plant_spacing_interval_m: 0.5,
      last_view: null,
    })
    designSessionFixture.file = {
      version: 7,
      name: 'Layer presentation',
      description: null,
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
    plantSpeciesCodes: {},
          layers: [
            { kind: 'layer', name: 'annotations', visible: true, locked: false, opacity: 1 },
            { kind: 'layer', name: 'plants', visible: true, locked: false, opacity: 0.8 },
            { kind: 'layer', name: 'measurement-guides', visible: true, locked: false, opacity: 0.6 },
            { kind: 'layer', name: 'zones', visible: false, locked: true, opacity: 0.35 },
          ],
          plants: [],
          zones: [],
          annotations: [],
          measurementGuides: [],
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
    designSessionFixture.file = null
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
        id: 'basemap',
        label: 'Basemap',
        authority: 'map-layers',
        active: true,
        visible: false,
        opacity: 0.65,
        locked: false,
        canLock: false,
        detail: {
          type: 'basemap',
          style: 'positron',
          styles: ['liberty', 'positron', 'bright', 'dark'],
          hiddenBySatellite: false,
        },
      },
      {
        id: 'satellite',
        label: 'Satellite',
        authority: 'map-layers',
        active: false,
        visible: false,
        opacity: 0.9,
        locked: false,
        canLock: false,
        detail: {
          type: 'satellite',
          hasGoogleKey: false,
        },
      },
      {
        id: 'contours',
        label: 'Contour lines',
        authority: 'map-layers',
        active: false,
        visible: true,
        opacity: 0.5,
        locked: false,
        canLock: false,
        detail: {
          type: 'contours',
          contourIntervalMeters: 12,
        },
      },
      {
        id: 'hillshade',
        label: 'Hillshading',
        authority: 'map-layers',
        active: false,
        visible: true,
        opacity: 0.45,
        locked: false,
        canLock: false,
        detail: { type: 'hillshade' },
      },
    ])
    expect(presentation.hasVisibleMapLayer).toBe(true)
  })

  it('reports Satellite hiding the Basemap and a saved Google key without exposing it', () => {
    googleMapsApiKey.value = 'secret-google-key'
    mapLayers.value = {
      ...mapLayers.value,
      basemap: { ...mapLayers.value.basemap, visible: true },
      satellite: { ...mapLayers.value.satellite, visible: true },
    }

    const presentation = readCanvasLayerPresentation()
    const basemap = presentation.rows.find((row) => row.id === 'basemap')
    const satellite = presentation.rows.find((row) => row.id === 'satellite')

    expect(basemap?.visible).toBe(true)
    expect(basemap?.detail).toEqual(expect.objectContaining({ type: 'basemap', hiddenBySatellite: true }))
    expect(satellite?.detail).toEqual({ type: 'satellite', hasGoogleKey: true })
    expect(JSON.stringify(presentation)).not.toContain('secret-google-key')
    googleMapsApiKey.value = null
  })

  it('routes Layer commands to the authority that owns each row', () => {
    const layerCommands = {
      setSceneLayerVisibility: vi.fn(() => true),
      setSceneLayerOpacity: vi.fn(() => true),
      setSceneLayerLocked: vi.fn(() => true),
    }

    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ layers: layerCommands }),
    }))

    expect(setCanvasLayerPresentationVisibility('basemap', true)).toBe(true)
    expect(setCanvasLayerPresentationVisibility('satellite', true)).toBe(true)
    expect(setCanvasLayerPresentationOpacity('satellite', 0.3)).toBe(true)
    expect(setCanvasLayerPresentationOpacity('contours', 0.25)).toBe(true)
    expect(setCanvasLayerPresentationVisibility('hillshade', false)).toBe(true)
    expect(setCanvasLayerPresentationOpacity('hillshade', 0.2)).toBe(true)
    expect(setCanvasLayerPresentationContourIntervalMeters(18)).toBe(true)
    setCanvasLayerPresentationActiveLayer('plants')

    expect(mapLayers.value.basemap.visible).toBe(true)
    expect(mapLayers.value.satellite.visible).toBe(true)
    expect(mapLayers.value.satellite.opacity).toBe(0.3)
    expect(mapLayers.value.contours.opacity).toBe(0.25)
    expect(mapLayers.value.hillshade.visible).toBe(false)
    expect(mapLayers.value.hillshade.opacity).toBe(0.2)
    expect(mapLayers.value.contours.intervalMeters).toBe(18)
    expect(activeLayerName.value).toBe('plants')

    expect(setCanvasLayerPresentationVisibility('plants', false)).toBe(true)
    expect(setCanvasLayerPresentationOpacity('zones', 0.4)).toBe(true)
    expect(setCanvasLayerPresentationLocked('annotations', true)).toBe(true)
    expect(setCanvasLayerPresentationLocked('basemap', true)).toBe(false)
    expect(setCanvasLayerPresentationLocked('satellite', true)).toBe(false)

    expect(layerCommands.setSceneLayerVisibility).toHaveBeenCalledWith('plants', false)
    expect(layerCommands.setSceneLayerOpacity).toHaveBeenCalledWith('zones', 0.4)
    expect(layerCommands.setSceneLayerLocked).toHaveBeenCalledWith('annotations', true)
    expect(layerCommands.setSceneLayerLocked).not.toHaveBeenCalledWith('basemap', true)
    expect(layerCommands.setSceneLayerVisibility).not.toHaveBeenCalledWith('satellite', true)
  })

  it('rejects invalid numeric Layer inputs without mutating state', () => {
    expect(setCanvasLayerPresentationContourIntervalMeters(Number.NaN)).toBe(false)
    expect(setCanvasLayerPresentationOpacity('basemap', Number.NaN)).toBe(false)

    expect(mapLayers.value.contours.intervalMeters).toBe(12)
    expect(mapLayers.value.basemap.opacity).toBe(0.65)
  })
})
