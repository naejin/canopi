import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))

import { setSettings } from '../ipc/settings'
import type { BasemapStyle } from '../generated/contracts'
import type { Settings, Theme } from '../types/settings'
import {
  bottomPanelHeights,
  bottomPanelOpen,
  bottomPanelTab,
  createDefaultBottomPanelHeights,
  resolveBottomPanelHeight,
} from '../app/canvas-settings/bottom-panel-state'
import {
  contourIntervalMeters,
  createDefaultLayerOpacity,
  createDefaultLayerVisibility,
  hillshadeOpacity,
  hillshadeVisible,
  layerOpacity,
  layerVisibility,
  snapToGridEnabled,
  snapToGuidesEnabled,
} from '../app/canvas-settings/signals'
import { sidePanelWidth } from '../app/shell/state'
import {
  autoSaveIntervalMs,
  basemapStyle,
  locale,
  plantSpacingIntervalM,
  savedStampsFrameHeight,
  theme,
} from '../app/settings/state'
import {
  flushSettingsProjection,
  hydrateSettingsProjection,
  mutateSettingsProjection,
  resetSettingsProjectionForTests,
  snapshotSettingsProjection,
} from '../app/settings/projection'

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: 'en',
    theme: 'light',
    snap_to_grid: false,
    snap_to_guides: true,
    auto_save_interval_s: 60,
    side_panel_width: null,
    bottom_panel_open: false,
    bottom_panel_timeline_height: null,
    bottom_panel_budget_height: null,
    bottom_panel_consortium_height: null,
    bottom_panel_tab: 'budget',
    map_layer_visible: true,
    map_style: 'street',
    map_opacity: 1,
    contour_visible: false,
    contour_opacity: 1,
    contour_interval: 0,
    hillshade_visible: false,
    hillshade_opacity: 0.55,
    plant_spacing_interval_m: 0.5,
    saved_stamps_frame_height: 220,
    ...overrides,
  }
}

function resetProjectionSignals(): void {
  locale.value = 'en'
  theme.value = 'light'
  basemapStyle.value = 'street'
  autoSaveIntervalMs.value = 60_000
  snapToGridEnabled.value = false
  snapToGuidesEnabled.value = true
  bottomPanelOpen.value = false
  bottomPanelHeights.value = createDefaultBottomPanelHeights()
  bottomPanelTab.value = 'budget'
  sidePanelWidth.value = null
  layerVisibility.value = createDefaultLayerVisibility()
  layerOpacity.value = createDefaultLayerOpacity()
  contourIntervalMeters.value = 0
  hillshadeVisible.value = false
  hillshadeOpacity.value = 0.55
  plantSpacingIntervalM.value = 0.5
  savedStampsFrameHeight.value = 220
}

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

let originalMapTilerKey: string | undefined

beforeEach(() => {
  vi.useFakeTimers()
  originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
  ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = undefined
  vi.mocked(setSettings).mockClear()
  resetSettingsProjectionForTests(setSettings)
  resetProjectionSignals()
})

afterEach(() => {
  resetSettingsProjectionForTests()
  vi.clearAllTimers()
  vi.useRealTimers()
  ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
})

describe('settings projection', () => {
  it('hydrates Rust settings into the frontend projection without persisting', () => {
    hydrateSettingsProjection(baseSettings({
      locale: 'fr',
      theme: 'dark',
      snap_to_grid: true,
      snap_to_guides: false,
      auto_save_interval_s: 45,
      side_panel_width: 460,
      saved_stamps_frame_height: 280,
      bottom_panel_open: true,
      bottom_panel_timeline_height: 320,
      bottom_panel_budget_height: null,
      bottom_panel_consortium_height: 260,
      bottom_panel_tab: 'timeline',
      map_layer_visible: false,
      map_opacity: 0.35,
      contour_visible: true,
      contour_opacity: 0.45,
      contour_interval: 12,
      hillshade_visible: true,
      hillshade_opacity: 0.2,
      plant_spacing_interval_m: 0.75,
    }))

    expect(locale.value).toBe('fr')
    expect(theme.value).toBe('dark')
    expect(autoSaveIntervalMs.value).toBe(45_000)
    expect(snapToGridEnabled.value).toBe(true)
    expect(snapToGuidesEnabled.value).toBe(false)
    expect(sidePanelWidth.value).toBe(460)
    expect(savedStampsFrameHeight.value).toBe(280)
    expect(bottomPanelOpen.value).toBe(true)
    expect(bottomPanelHeights.value).toEqual({
      timeline: 320,
      budget: null,
      consortium: 260,
    })
    expect(resolveBottomPanelHeight('budget')).toBe(224)
    expect(bottomPanelTab.value).toBe('timeline')
    expect(layerVisibility.value.base).toBe(false)
    expect(layerOpacity.value.base).toBe(0.35)
    expect(layerVisibility.value.contours).toBe(true)
    expect(layerOpacity.value.contours).toBe(0.45)
    expect(contourIntervalMeters.value).toBe(12)
    expect(hillshadeVisible.value).toBe(true)
    expect(hillshadeOpacity.value).toBe(0.2)
    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()
  })

  it('snapshots the projection back to Rust settings', () => {
    hydrateSettingsProjection(baseSettings())

    mutateSettingsProjection((settings) => {
      settings.locale = 'de'
      settings.theme = 'dark'
      settings.snapToGrid = true
      settings.snapToGuides = false
      settings.autoSaveIntervalMs = 15_000
      settings.sidePanel.width = 440
      settings.savedStamps.frameHeight = 260
      settings.bottomPanel.open = true
      settings.bottomPanel.heights.timeline = 280
      settings.bottomPanel.heights.budget = 300
      settings.bottomPanel.heights.consortium = 260
      settings.bottomPanel.tab = 'consortium'
      settings.mapLayers.baseVisible = false
      settings.mapLayers.baseOpacity = 0.6
      settings.mapLayers.contoursVisible = true
      settings.mapLayers.contoursOpacity = 0.3
      settings.mapLayers.contourIntervalMeters = 18
      settings.mapLayers.hillshadeVisible = true
      settings.mapLayers.hillshadeOpacity = 0.25
      settings.plantSpacingIntervalM = 0.25
    }, { persist: 'none' })

    expect(snapshotSettingsProjection()).toEqual({
      locale: 'de',
      theme: 'dark',
      snap_to_grid: true,
      snap_to_guides: false,
      auto_save_interval_s: 15,
      side_panel_width: 440,
      saved_stamps_frame_height: 260,
      bottom_panel_open: true,
      bottom_panel_timeline_height: 280,
      bottom_panel_budget_height: 300,
      bottom_panel_consortium_height: 260,
      bottom_panel_tab: 'consortium',
      map_layer_visible: false,
      map_style: 'street',
      map_opacity: 0.6,
      contour_visible: true,
      contour_opacity: 0.3,
      contour_interval: 18,
      hillshade_visible: true,
      hillshade_opacity: 0.25,
      plant_spacing_interval_m: 0.25,
    })
    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()
  })

  it('normalizes theme, map style, opacities, and contour interval at the seam', () => {
    hydrateSettingsProjection(baseSettings({
      theme: 'neon' as Theme,
      map_style: 'terrain' as BasemapStyle,
      map_opacity: 2,
      contour_opacity: -1,
      contour_interval: 12.7,
      hillshade_opacity: Number.NaN,
      plant_spacing_interval_m: 0,
      side_panel_width: Number.NaN,
      saved_stamps_frame_height: 80,
      bottom_panel_timeline_height: 120,
      bottom_panel_budget_height: Number.NaN,
    }))

    expect(theme.value).toBe('light')
    expect(basemapStyle.value).toBe('street')
    expect(layerOpacity.value.base).toBe(1)
    expect(layerOpacity.value.contours).toBe(0)
    expect(contourIntervalMeters.value).toBe(13)
    expect(hillshadeOpacity.value).toBe(0.55)
    expect(plantSpacingIntervalM.value).toBe(0.5)
    expect(sidePanelWidth.value).toBe(null)
    expect(savedStampsFrameHeight.value).toBe(120)
    expect(bottomPanelHeights.value).toEqual({
      timeline: 140,
      budget: null,
      consortium: null,
    })

    mutateSettingsProjection((settings) => {
      settings.mapLayers.baseOpacity = -2
      settings.mapLayers.contoursOpacity = Number.POSITIVE_INFINITY
      settings.mapLayers.contourIntervalMeters = 7.6
      settings.mapLayers.hillshadeOpacity = 3
      settings.plantSpacingIntervalM = Number.POSITIVE_INFINITY
      settings.sidePanel.width = 120
      settings.savedStamps.frameHeight = Number.POSITIVE_INFINITY
      settings.bottomPanel.heights.consortium = 139.6
    }, { persist: 'none' })

    expect(snapshotSettingsProjection()).toEqual(expect.objectContaining({
      theme: 'light',
      map_style: 'street',
      map_opacity: 0,
      contour_opacity: 1,
      contour_interval: 8,
      hillshade_opacity: 1,
      plant_spacing_interval_m: 0.5,
      side_panel_width: 320,
      saved_stamps_frame_height: 220,
      bottom_panel_consortium_height: 140,
    }))
  })

  it('persists immediate mutations against the latest normalized snapshot', async () => {
    hydrateSettingsProjection(baseSettings())

    mutateSettingsProjection((settings) => {
      settings.locale = 'es'
      settings.sidePanel.width = 480
      settings.bottomPanel.open = true
    }, { persist: 'immediate' })
    await Promise.resolve()

    expect(vi.mocked(setSettings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'es',
      side_panel_width: 480,
      bottom_panel_open: true,
    }))
  })

  it('debounces queued persistence and writes the latest projection', async () => {
    hydrateSettingsProjection(baseSettings())

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'queued', delayMs: 250 })
    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
      settings.mapLayers.baseOpacity = 0.4
    }, { persist: 'queued', delayMs: 250 })

    vi.advanceTimersByTime(249)
    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()

    expect(vi.mocked(setSettings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      theme: 'dark',
      map_opacity: 0.4,
    }))
  })

  it('flushes queued persistence immediately and clears the pending debounce', async () => {
    hydrateSettingsProjection(baseSettings())

    mutateSettingsProjection((settings) => {
      settings.mapLayers.contourIntervalMeters = 24
    }, { persist: 'queued', delayMs: 250 })

    flushSettingsProjection()
    await Promise.resolve()
    vi.runAllTimers()

    expect(vi.mocked(setSettings)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      contour_interval: 24,
    }))
  })

  it('updates projection state but does not persist before Rust settings bootstrap', () => {
    resetSettingsProjectionForTests(setSettings)

    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.locale = 'it'
    }, { persist: 'queued', delayMs: 10 })
    vi.runAllTimers()

    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('it')
    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()
  })

  it('avoids IPC when a mutation leaves the Rust settings snapshot unchanged', () => {
    hydrateSettingsProjection(baseSettings())

    mutateSettingsProjection((settings) => {
      settings.locale = 'en'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'queued', delayMs: 250 })
    mutateSettingsProjection((settings) => {
      settings.locale = 'en'
    }, { persist: 'queued', delayMs: 250 })
    vi.runAllTimers()

    expect(vi.mocked(setSettings)).not.toHaveBeenCalled()
  })

  it('keeps production settings-backed callers on the projection mutation seam', () => {
    const sources = [
      '../app/canvas-settings/controller.ts',
      '../app/canvas-layer-presentation/presentation.ts',
      '../app/canvas-runtime/app-adapter.ts',
      '../app/favorites/controller.ts',
      '../app/shell/controller.ts',
      '../components/shared/TitleBar.tsx',
      '../commands/graph/catalog.ts',
      '../utils/theme.ts',
    ].map(readSource)

    for (const source of sources) {
      expect(source).toContain('settings/projection')
      expect(source).not.toContain('settings/persistence')
      expect(source).not.toMatch(/\b(?:locale|theme|basemapStyle|snapToGridEnabled|snapToGuidesEnabled|autoSaveIntervalMs|sidePanelWidth|bottomPanelOpen|bottomPanelHeights|bottomPanelTab|contourIntervalMeters|hillshadeVisible|hillshadeOpacity)\.value\s*=(?!=)/)
    }

    const runtimeSource = readSource('../canvas/runtime/scene-runtime.ts')

    expect(runtimeSource).not.toContain('settings/projection')
    expect(runtimeSource).not.toContain('settings/persistence')
  })
})
