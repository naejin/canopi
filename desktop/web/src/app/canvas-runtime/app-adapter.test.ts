import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasRuntimePresentationDataAdapter,
  CanvasRuntimeSavedObjectStampAdapter,
} from '../../canvas/runtime/app-adapter'
import { CanvasPlantLabelResolver } from '../../canvas/runtime/plant-labels'
import { CanvasSpeciesCache } from '../../canvas/runtime/species-cache'
import { t } from '../../i18n'
import type { Settings } from '../../types/settings'
import {
  createDefaultLayerLockState,
  createDefaultLayerOpacity,
  createDefaultLayerVisibility,
  gridVisible,
  layerLockState,
  layerOpacity,
  layerVisibility,
  rulersVisible,
} from '../canvas-settings/signals'
import { composeDocumentForSave } from '../contracts/document'
import { setCanvasClean } from '../document-session/store'
import {
  installSettingsProjection,
  resetSettingsProjectionForTests,
} from '../settings/projection'
import { locale, theme } from '../settings/state'
import { createAppCanvasRuntimeAppAdapter } from './app-adapter'
import { createDesktopCanvasRuntimeAppAdapter } from './desktop-adapter'

describe('Canvas Runtime app adapter composition', () => {
  const persistSettings = vi.fn<(settings: Settings) => Promise<void>>()

  beforeEach(() => {
    persistSettings.mockReset().mockResolvedValue(undefined)
    installSettingsProjection({
      load: () => baseSettings(),
      save: persistSettings,
    })
    resetLayerSignals()
  })

  afterEach(() => {
    resetSettingsProjectionForTests()
    resetLayerSignals()
  })

  it('preserves the edition capabilities supplied by its composition root', () => {
    const presentationData: CanvasRuntimePresentationDataAdapter = {}
    const savedObjectStamps: CanvasRuntimeSavedObjectStampAdapter = {
      saveCurrentSelection: vi.fn(),
    }

    const adapter = createAppCanvasRuntimeAppAdapter({
      presentationData,
      savedObjectStamps,
    })

    expect(adapter.presentationData).toBe(presentationData)
    expect(adapter.savedObjectStamps).toBe(savedObjectStamps)
  })

  it('does not manufacture an optional capability that the edition omits', () => {
    const adapter = createAppCanvasRuntimeAppAdapter({
      presentationData: {},
    })

    expect(adapter.savedObjectStamps).toBeUndefined()
    expect('savedObjectStamps' in adapter).toBe(false)
  })

  it('delegates clean state, document composition, and translation to app authorities', () => {
    const adapter = createAdapter()

    expect(adapter.cleanState.setCanvasClean).toBe(setCanvasClean)
    expect(adapter.document.composeDocumentForSave).toBe(composeDocumentForSave)
    expect(adapter.translate).toBe(t)
  })

  it('persists Plant Spacing interval commits immediately', () => {
    const adapter = createAdapter()

    adapter.settings.commitPlantSpacingIntervalMeters(0.75)

    expect(persistSettings).toHaveBeenCalledOnce()
    expect(persistSettings).toHaveBeenCalledWith(expect.objectContaining({
      plant_spacing_interval_m: 0.75,
    }))
  })

  it('persists the discrete snap-to-grid toggle immediately', () => {
    const adapter = createAdapter()

    adapter.settings.toggleSnapToGrid()

    expect(adapter.settings.readSnapToGridEnabled()).toBe(false)
    expect(persistSettings).toHaveBeenCalledOnce()
    expect(persistSettings).toHaveBeenCalledWith(expect.objectContaining({
      snap_to_grid: false,
    }))
  })

  it('subscribes to the exact app signals owned by the adapter', () => {
    const adapter = createAdapter()
    const onTheme = vi.fn()
    const onLocale = vi.fn()
    const onChromeOverlay = vi.fn()
    const disposeTheme = adapter.settings.subscribeTheme(onTheme)
    const disposeLocale = adapter.settings.subscribeLocale(onLocale)
    const disposeChromeOverlay = adapter.settings.subscribeChromeOverlay(onChromeOverlay)

    try {
      expect([onTheme, onLocale, onChromeOverlay].map((callback) => callback.mock.calls.length))
        .toEqual([1, 1, 1])

      theme.value = 'dark'
      locale.value = 'fr'
      gridVisible.value = false
      rulersVisible.value = false

      expect(onTheme).toHaveBeenCalledTimes(2)
      expect(onLocale).toHaveBeenCalledTimes(2)
      expect(onChromeOverlay).toHaveBeenCalledTimes(3)

      disposeTheme()
      disposeLocale()
      disposeChromeOverlay()
      theme.value = 'light'
      locale.value = 'en'
      gridVisible.value = true

      expect(onTheme).toHaveBeenCalledTimes(2)
      expect(onLocale).toHaveBeenCalledTimes(2)
      expect(onChromeOverlay).toHaveBeenCalledTimes(3)
    } finally {
      disposeTheme()
      disposeLocale()
      disposeChromeOverlay()
    }
  })

  it('projects scene-owned Layers while preserving app-owned map Layers', () => {
    const adapter = createAdapter()

    adapter.settings.layerProjections.syncFromLayers([
      { name: 'base', visible: false, locked: true, opacity: 0.2 },
      { name: 'plants', visible: false, locked: true, opacity: 0.45 },
    ])

    expect(layerVisibility.value.base).toBe(true)
    expect(layerLockState.value.base).toBe(false)
    expect(layerOpacity.value.base).toBe(1)
    expect(layerVisibility.value.plants).toBe(false)
    expect(layerLockState.value.plants).toBe(true)
    expect(layerOpacity.value.plants).toBe(0.45)

    adapter.settings.layerProjections.syncLayer({
      name: 'zones',
      visible: false,
      locked: true,
      opacity: 0.6,
    })

    expect(layerVisibility.value.zones).toBe(false)
    expect(layerLockState.value.zones).toBe(true)
    expect(layerOpacity.value.zones).toBe(0.6)
    expect(adapter.settings.layerProjections.isAppOwnedLayerProjection('contours')).toBe(true)
  })

  it('lets the Desktop root supply native presentation and Saved Stamp capture', () => {
    const adapter = createDesktopCanvasRuntimeAppAdapter()

    expect(adapter.presentationData?.plantLabels).toBeInstanceOf(CanvasPlantLabelResolver)
    expect(adapter.presentationData?.speciesCache).toBeInstanceOf(CanvasSpeciesCache)
    expect(adapter.savedObjectStamps?.saveCurrentSelection).toBeTypeOf('function')
  })
})

function createAdapter() {
  return createAppCanvasRuntimeAppAdapter({ presentationData: {} })
}

function resetLayerSignals(): void {
  layerVisibility.value = createDefaultLayerVisibility()
  layerLockState.value = createDefaultLayerLockState()
  layerOpacity.value = createDefaultLayerOpacity()
  gridVisible.value = true
  rulersVisible.value = true
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
    auto_save_interval_s: 60,
    side_panel_width: null,
    saved_stamps_frame_height: null,
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
    ...overrides,
  }
}
