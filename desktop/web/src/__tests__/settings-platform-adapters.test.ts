import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_BASEMAP_STYLES,
  SETTINGS_LOCALES,
  SETTINGS_THEMES,
} from '../generated/settings'
import type { Settings } from '../types/settings'
import { createDesktopSettingsPlatformAdapter } from '../platform/settings.desktop'
import { createBrowserSettingsPlatformAdapter } from '../platform/settings.browser'
import {
  createBrowserAppDataStore,
  type BrowserStorageAdapter,
} from '../web/browser-app-data'

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  }
}

describe('settings platform adapters', () => {
  it('delegates Desktop settings load and save to the injected transport', async () => {
    const loaded = settings({ locale: 'fr' })
    const getSettings = vi.fn(async () => loaded)
    const setSettings = vi.fn(async (_settings: Settings) => undefined)
    const adapter = createDesktopSettingsPlatformAdapter({ getSettings, setSettings })

    await expect(adapter.load()).resolves.toBe(loaded)
    await expect(adapter.save(loaded)).resolves.toBeUndefined()

    expect(getSettings).toHaveBeenCalledOnce()
    expect(setSettings).toHaveBeenCalledOnce()
    expect(setSettings).toHaveBeenCalledWith(loaded)
  })

  it('loads the generated Rust default when browser settings are absent', async () => {
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => null,
      saveSettings: vi.fn(),
    })

    expect(await adapter.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('loads every valid browser settings field', async () => {
    const stored = settings({
      locale: 'fr',
      theme: 'dark',
      snap_to_grid: false,
      snap_to_guides: false,
      auto_save_interval_s: 15,
      side_panel_width: 420,
      saved_stamps_frame_height: 260,
      bottom_panel_open: true,
      bottom_panel_timeline_height: 280,
      bottom_panel_budget_height: 300,
      bottom_panel_consortium_height: 320,
      bottom_panel_tab: 'timeline',
      map_layer_visible: false,
      map_style: 'satellite',
      map_opacity: 0.4,
      contour_visible: true,
      contour_opacity: 0.6,
      contour_interval: 10,
      hillshade_visible: true,
      hillshade_opacity: 0.3,
      plant_spacing_interval_m: 0.75,
    })
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => stored,
      saveSettings: vi.fn(),
    })

    expect(await adapter.load()).toEqual(stored)
  })

  it('accepts every generated Rust settings enum value', async () => {
    for (const locale of SETTINGS_LOCALES) {
      const adapter = createBrowserSettingsPlatformAdapter({
        loadSettings: () => settings({ locale }),
        saveSettings: vi.fn(),
      })
      expect((await adapter.load()).locale).toBe(locale)
    }

    for (const theme of SETTINGS_THEMES) {
      const adapter = createBrowserSettingsPlatformAdapter({
        loadSettings: () => settings({ theme }),
        saveSettings: vi.fn(),
      })
      expect((await adapter.load()).theme).toBe(theme)
    }

    for (const mapStyle of SETTINGS_BASEMAP_STYLES) {
      const adapter = createBrowserSettingsPlatformAdapter({
        loadSettings: () => settings({ map_style: mapStyle }),
        saveSettings: vi.fn(),
      })
      expect((await adapter.load()).map_style).toBe(mapStyle)
    }
  })

  it('merges legacy locale and theme browser settings with complete defaults', async () => {
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => ({ locale: 'it', theme: 'dark' }),
      saveSettings: vi.fn(),
    })

    expect(await adapter.load()).toEqual(settings({ locale: 'it', theme: 'dark' }))
  })

  it('replaces malformed browser settings fields with Rust defaults', async () => {
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => ({
        locale: 'xx',
        theme: 'system',
        snap_to_grid: 'true',
        snap_to_guides: null,
        auto_save_interval_s: -1,
        side_panel_width: -10,
        saved_stamps_frame_height: 2.5,
        bottom_panel_open: 1,
        bottom_panel_timeline_height: '280',
        bottom_panel_budget_height: -1,
        bottom_panel_consortium_height: Number.POSITIVE_INFINITY,
        bottom_panel_tab: 7,
        map_layer_visible: 'false',
        map_style: 'terrain',
        map_opacity: '0.4',
        contour_visible: 1,
        contour_opacity: null,
        contour_interval: 1.5,
        hillshade_visible: 'yes',
        hillshade_opacity: Number.NaN,
        plant_spacing_interval_m: Number.NEGATIVE_INFINITY,
        unknown_setting: true,
      }),
      saveSettings: vi.fn(),
    })

    expect(await adapter.load()).toEqual(settings())
  })

  it('saves the complete browser settings snapshot through browser app data', async () => {
    const updated = settings({ locale: 'de', snap_to_grid: false })
    const saveSettings = vi.fn(() => ({
      ok: true as const,
      value: { ...updated },
    }))
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => null,
      saveSettings,
    })

    await expect(adapter.save(updated)).resolves.toBeUndefined()
    expect(saveSettings).toHaveBeenCalledOnce()
    expect(saveSettings).toHaveBeenCalledWith(updated)
  })

  it('rejects browser settings saves when browser app data reports failure', async () => {
    const storageError = new Error('browser storage unavailable')
    const adapter = createBrowserSettingsPlatformAdapter({
      loadSettings: () => null,
      saveSettings: () => ({ ok: false, error: storageError }),
    })

    await expect(adapter.save(settings())).rejects.toBe(storageError)
  })

  it('preserves unrelated browser app data while saving settings', async () => {
    const store = createBrowserAppDataStore({ storage: memoryStorage() })
    store.setFavoriteSpecies(['Malus domestica'])
    store.saveSavedObjectStamps([{
      id: 'stamp-1',
      name: 'Orchard pair',
      payload: { plants: 2 },
    }])
    const adapter = createBrowserSettingsPlatformAdapter(store)

    await adapter.save(settings({ locale: 'nl' }))

    expect(store.listFavoriteSpecies()).toEqual(['Malus domestica'])
    expect(store.listSavedObjectStamps()).toEqual([{
      id: 'stamp-1',
      name: 'Orchard pair',
      payload: { plants: 2 },
    }])
    expect(store.loadSettings()).toEqual(settings({ locale: 'nl' }))
  })
})

function memoryStorage(): BrowserStorageAdapter {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}
