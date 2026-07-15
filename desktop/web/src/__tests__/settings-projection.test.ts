import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BasemapStyle } from '../generated/contracts'
import type { Settings, Theme } from '../types/settings'
import type { SettingsProjectionInstallation } from '../app/settings/projection'
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
  installSettingsProjection,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

let originalMapTilerKey: string | undefined
let installation: SettingsProjectionInstallation
const saveSettings = vi.fn(async (_settings: Settings): Promise<void> => {})

beforeEach(() => {
  vi.useFakeTimers()
  originalMapTilerKey = import.meta.env.VITE_MAPTILER_KEY
  ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = undefined
  saveSettings.mockReset().mockResolvedValue(undefined)
  resetSettingsProjectionForTests()
  resetProjectionSignals()
  installation = installSettingsProjection({
    load: () => baseSettings(),
    save: saveSettings,
  })
})

afterEach(() => {
  installation.dispose()
  resetSettingsProjectionForTests()
  vi.clearAllTimers()
  vi.useRealTimers()
  ;(import.meta.env as { VITE_MAPTILER_KEY?: string }).VITE_MAPTILER_KEY = originalMapTilerKey
})

describe('settings projection', () => {
  it('hydrates platform settings into the frontend projection without persisting', () => {
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
    expect(basemapStyle.value).toBe('street')
    expect(layerVisibility.value.base).toBe(false)
    expect(layerOpacity.value.base).toBe(0.35)
    expect(layerVisibility.value.contours).toBe(true)
    expect(layerOpacity.value.contours).toBe(0.45)
    expect(contourIntervalMeters.value).toBe(12)
    expect(hillshadeVisible.value).toBe(true)
    expect(hillshadeOpacity.value).toBe(0.2)
    expect(plantSpacingIntervalM.value).toBe(0.75)
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('snapshots the projection back to the shared Settings contract', () => {
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
    expect(saveSettings).not.toHaveBeenCalled()
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

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(saveSettings).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await Promise.resolve()

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      theme: 'dark',
      map_opacity: 0.4,
    }))
  })

  it('flushes queued persistence immediately and waits for durable settlement', async () => {
    const pendingSave = deferred<void>()
    saveSettings.mockImplementationOnce(() => pendingSave.promise)
    hydrateSettingsProjection(baseSettings())

    mutateSettingsProjection((settings) => {
      settings.mapLayers.contourIntervalMeters = 24
    }, { persist: 'queued', delayMs: 250 })

    let settled = false
    const flush = flushSettingsProjection().then(() => {
      settled = true
    })
    await Promise.resolve()
    vi.runAllTimers()

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      contour_interval: 24,
    }))
    expect(settled).toBe(false)

    pendingSave.resolve()
    await flush

    expect(settled).toBe(true)
  })

  it('updates projection state but does not persist before settings bootstrap', () => {
    installation.dispose()
    resetSettingsProjectionForTests()

    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.locale = 'it'
    }, { persist: 'queued', delayMs: 10 })
    vi.runAllTimers()

    expect(theme.value).toBe('dark')
    expect(locale.value).toBe('it')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('avoids persistence when a mutation leaves the settings snapshot unchanged', () => {
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

    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('hydrates a synchronous adapter before installation returns', () => {
    installation.dispose()
    resetSettingsProjectionForTests()

    installation = installSettingsProjection({
      load: () => baseSettings({ locale: 'fr', theme: 'dark' }),
      save: saveSettings,
    })

    expect(locale.value).toBe('fr')
    expect(theme.value).toBe('dark')
  })

  it('ignores an asynchronous load after its installation is replaced', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    let resolveSlowLoad!: (settings: Settings) => void
    const slowLoad = new Promise<Settings>((resolve) => {
      resolveSlowLoad = resolve
    })

    const staleInstallation = installSettingsProjection({
      load: () => slowLoad,
      save: saveSettings,
    })
    installation = installSettingsProjection({
      load: () => baseSettings({ locale: 'de' }),
      save: saveSettings,
    })

    resolveSlowLoad(baseSettings({ locale: 'fr' }))
    await staleInstallation.ready

    expect(locale.value).toBe('de')
  })

  it('replays and persists a mutation made while asynchronous settings load', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const pendingLoad = deferred<Settings>()
    installation = installSettingsProjection({
      load: () => pendingLoad.promise,
      save: saveSettings,
    })

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })

    expect(locale.value).toBe('fr')
    expect(saveSettings).not.toHaveBeenCalled()

    pendingLoad.resolve(baseSettings({ locale: 'de', theme: 'dark' }))
    await installation.ready
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())

    expect(locale.value).toBe('fr')
    expect(theme.value).toBe('dark')
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      theme: 'dark',
    }))
  })

  it('makes flush wait for bootstrap before settling an early mutation', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const pendingLoad = deferred<Settings>()
    installation = installSettingsProjection({
      load: () => pendingLoad.promise,
      save: saveSettings,
    })
    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })

    let flushed = false
    const flush = flushSettingsProjection().then(() => {
      flushed = true
    })
    await Promise.resolve()

    expect(flushed).toBe(false)
    expect(saveSettings).not.toHaveBeenCalled()

    pendingLoad.resolve(baseSettings({ locale: 'de' }))
    await flush

    expect(flushed).toBe(true)
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ locale: 'fr' }))
  })

  it('keeps settings mutations persistable after adapter load fails', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const loadError = new Error('settings unavailable')
    installation = installSettingsProjection({
      load: () => Promise.reject(loadError),
      save: saveSettings,
    })

    await expect(installation.ready).rejects.toBe(loadError)
    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
    }, { persist: 'immediate' })
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())

    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }))
  })

  it('does not persist an unchanged fallback after an ordinary load failure', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const loadError = new Error('settings unavailable')
    installation = installSettingsProjection({
      load: () => Promise.reject(loadError),
      save: saveSettings,
    })

    await expect(installation.ready).rejects.toBe(loadError)
    await flushSettingsProjection()

    const replacement = installSettingsProjection({
      load: () => baseSettings({ locale: 'de' }),
      save: saveSettings,
    })
    installation = replacement
    await replacement.ready

    expect(locale.value).toBe('de')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('does not turn a pre-bootstrap no-op into persistence intent', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const pendingLoad = deferred<Settings>()
    const loadError = new Error('settings unavailable')
    installation = installSettingsProjection({
      load: () => pendingLoad.promise,
      save: saveSettings,
    })

    mutateSettingsProjection(() => {}, { persist: 'immediate' })
    pendingLoad.reject(loadError)

    await expect(installation.ready).rejects.toBe(loadError)
    await flushSettingsProjection()

    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('ignores a synchronous load that reentrantly replaces its installation', () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    let replacementInstallation: SettingsProjectionInstallation | null = null

    const staleInstallation = installSettingsProjection({
      load: () => {
        replacementInstallation = installSettingsProjection({
          load: () => baseSettings({ locale: 'de' }),
          save: saveSettings,
        })
        return baseSettings({ locale: 'fr' })
      },
      save: saveSettings,
    })
    installation = replacementInstallation ?? staleInstallation

    expect(locale.value).toBe('de')
  })

  it('uses the normalized hydrated snapshot as the durable no-op baseline', () => {
    hydrateSettingsProjection(baseSettings({
      map_opacity: 4,
      contour_interval: 12.7,
      saved_stamps_frame_height: 80,
    }))

    mutateSettingsProjection(() => {}, { persist: 'immediate' })

    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('serializes writes and coalesces overlapping mutations to the latest snapshot', async () => {
    let resolveFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve
    })
    saveSettings
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined)

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.locale = 'es'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.locale = 'de'
    }, { persist: 'immediate' })

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'fr' }))

    resolveFirstSave()
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2))

    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'de' }))
  })

  it('guards serialization when an adapter save synchronously reenters mutation', async () => {
    const firstSave = deferred<void>()
    let activeSaves = 0
    let maximumActiveSaves = 0
    saveSettings.mockImplementation((settings) => {
      activeSaves += 1
      maximumActiveSaves = Math.max(maximumActiveSaves, activeSaves)
      if (settings.locale === 'fr') {
        mutateSettingsProjection((next) => {
          next.locale = 'de'
        }, { persist: 'immediate' })
      }
      const settlement = settings.locale === 'fr'
        ? firstSave.promise
        : Promise.resolve()
      return settlement.finally(() => {
        activeSaves -= 1
      })
    })

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })

    expect(maximumActiveSaves).toBe(1)
    expect(saveSettings).toHaveBeenCalledTimes(1)

    firstSave.resolve()
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2))

    expect(maximumActiveSaves).toBe(1)
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'de' }))
  })

  it('settles pending writes before a replacement adapter loads', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    let stored = baseSettings()
    const firstSave = deferred<void>()
    const oldSave = vi.fn(async (settings: Settings) => {
      if (oldSave.mock.calls.length === 1) await firstSave.promise
      stored = settings
    })
    installation = installSettingsProjection({
      load: () => stored,
      save: oldSave,
    })

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
    }, { persist: 'queued', delayMs: 250 })

    const replacementLoad = vi.fn(() => stored)
    const replacement = installSettingsProjection({
      load: replacementLoad,
      save: saveSettings,
    })
    installation = replacement

    expect(replacementLoad).not.toHaveBeenCalled()
    expect(oldSave).toHaveBeenCalledTimes(1)

    firstSave.resolve()
    await replacement.ready

    expect(oldSave).toHaveBeenCalledTimes(2)
    expect(replacementLoad).toHaveBeenCalledOnce()
    expect(locale.value).toBe('fr')
    expect(theme.value).toBe('dark')
  })

  it('hands a failed predecessor write to the replacement adapter', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const saveFailure = deferred<void>()
    const error = new Error('old settings storage unavailable')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stored = baseSettings()
    installation = installSettingsProjection({
      load: () => stored,
      save: () => saveFailure.promise,
    })

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })

    const replacementSave = vi.fn(async (_settings: Settings): Promise<void> => {})
    const replacement = installSettingsProjection({
      load: () => stored,
      save: replacementSave,
    })
    installation = replacement

    saveFailure.reject(error)
    await replacement.ready
    await vi.waitFor(() => expect(replacementSave).toHaveBeenCalledOnce())

    expect(locale.value).toBe('fr')
    expect(replacementSave).toHaveBeenCalledWith(expect.objectContaining({ locale: 'fr' }))
    expect(logError).toHaveBeenCalledWith('Failed to persist settings:', error)
    logError.mockRestore()
  })

  it('persists handed-off intent when the replacement load also fails', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const predecessorSave = deferred<void>()
    const predecessorError = new Error('old settings storage unavailable')
    const replacementLoadError = new Error('replacement settings unavailable')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    installation = installSettingsProjection({
      load: () => baseSettings(),
      save: () => predecessorSave.promise,
    })

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })

    const replacementSave = vi.fn(async (_settings: Settings): Promise<void> => {})
    const replacement = installSettingsProjection({
      load: () => Promise.reject(replacementLoadError),
      save: replacementSave,
    })
    installation = replacement

    predecessorSave.reject(predecessorError)
    await expect(replacement.ready).rejects.toBe(replacementLoadError)
    await vi.waitFor(() => expect(replacementSave).toHaveBeenCalledOnce())

    expect(locale.value).toBe('fr')
    expect(replacementSave).toHaveBeenCalledWith(expect.objectContaining({ locale: 'fr' }))
    logError.mockRestore()
  })

  it('keeps flush pending until a replacement adapter is durable', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    let stored = baseSettings()
    const oldSaveSettlement = deferred<void>()
    installation = installSettingsProjection({
      load: () => stored,
      save: async (settings) => {
        await oldSaveSettlement.promise
        stored = settings
      },
    })

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })
    let flushed = false
    const flush = flushSettingsProjection().then(() => {
      flushed = true
    })

    const replacementSaveSettlement = deferred<void>()
    const replacementSave = vi.fn(() => replacementSaveSettlement.promise)
    const replacement = installSettingsProjection({
      load: () => stored,
      save: replacementSave,
    })
    installation = replacement
    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
    }, { persist: 'immediate' })

    oldSaveSettlement.resolve()
    await replacement.ready
    await vi.waitFor(() => expect(replacementSave).toHaveBeenCalledOnce())

    expect(flushed).toBe(false)

    replacementSaveSettlement.resolve()
    await flush

    expect(flushed).toBe(true)
    expect(replacementSave).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'fr',
      theme: 'dark',
    }))
  })

  it('extends an in-flight flush to include a newer queued mutation', async () => {
    const firstSave = deferred<void>()
    const secondSave = deferred<void>()
    saveSettings
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })
    let flushed = false
    const flush = flushSettingsProjection().then(() => {
      flushed = true
    })

    mutateSettingsProjection((settings) => {
      settings.theme = 'dark'
    }, { persist: 'queued', delayMs: 250 })

    firstSave.resolve()
    await flushMicrotasks()

    expect(saveSettings).toHaveBeenCalledTimes(2)
    expect(flushed).toBe(false)

    secondSave.resolve()
    await flush
    vi.advanceTimersByTime(250)

    expect(flushed).toBe(true)
    expect(saveSettings).toHaveBeenCalledTimes(2)
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      locale: 'fr',
      theme: 'dark',
    }))
  })

  it('stops waiting for an obsolete bootstrap after adapter replacement', async () => {
    installation.dispose()
    resetSettingsProjectionForTests()
    const obsoleteLoad = deferred<Settings>()
    installation = installSettingsProjection({
      load: () => obsoleteLoad.promise,
      save: saveSettings,
    })

    let flushed = false
    const flush = flushSettingsProjection().then(() => {
      flushed = true
    })

    const replacement = installSettingsProjection({
      load: () => baseSettings({ locale: 'de' }),
      save: saveSettings,
    })
    installation = replacement
    await replacement.ready

    await vi.waitFor(() => expect(flushed).toBe(true))
    await flush

    expect(locale.value).toBe('de')
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('persists a return to the durable value when an older write is still in flight', async () => {
    let resolveFirstSave!: () => void
    const firstSave = new Promise<void>((resolve) => {
      resolveFirstSave = resolve
    })
    saveSettings
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined)

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })
    mutateSettingsProjection((settings) => {
      settings.locale = 'en'
    }, { persist: 'immediate' })

    resolveFirstSave()
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2))

    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'en' }))
  })

  it('retries the latest snapshot after a failed write', async () => {
    const error = new Error('storage unavailable')
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
    saveSettings
      .mockRejectedValueOnce(error)
      .mockResolvedValue(undefined)

    mutateSettingsProjection((settings) => {
      settings.locale = 'fr'
    }, { persist: 'immediate' })
    await vi.waitFor(() => expect(logError).toHaveBeenCalledWith(
      'Failed to persist settings:',
      error,
    ))

    await flushSettingsProjection()
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2))

    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ locale: 'fr' }))
    logError.mockRestore()
  })

  it('keeps the projection independent from concrete platform storage', () => {
    const source = readSource('../app/settings/projection.ts')

    expect(source).not.toContain('../../ipc/settings')
    expect(source).not.toContain('browser-app-data')
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
