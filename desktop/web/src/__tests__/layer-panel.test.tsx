import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LayersPanel as LayerPanel } from '../components/panels/LayersPanel'
import {
  activeLayerName,
  layerLockState,
  layerOpacity,
  layerVisibility,
} from '../app/canvas-settings/signals'
import { createDefaultMapLayers, mapLayers } from '../app/map-layers/state'
import { googleMapsApiKey } from '../app/settings/state'
import type { Settings } from '../types/settings'
import {
  designSessionFixture,
} from './support/design-session-state'
import { locale } from '../app/settings/state'
import { activePanel, sidePanel } from '../app/shell/state'
import {
  flushSettingsProjection,
  installSettingsProjection,
  resetSettingsProjectionForTests,
} from '../app/settings/projection'
import { setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

function baseSettings(): Settings {
  return {
    locale: 'en',
    theme: 'light',
    snap_to_grid: true,
    snap_to_guides: true,
    auto_save_interval_s: 60,
    side_panel_width: null,
    saved_stamps_frame_height: 220,
    basemap_style: 'liberty',
    basemap_visible: true,
    basemap_opacity: 1,
    satellite_provider: 'eox',
    satellite_visible: false,
    satellite_opacity: 1,
    google_maps_api_key: null,
    contour_visible: false,
    contour_opacity: 1,
    contour_interval: 0,
    hillshade_visible: false,
    hillshade_opacity: 0.55,
    plant_spacing_interval_m: 0.5,
    last_view: null,
  }
}

describe('LayerPanel', () => {
  let container: HTMLDivElement
  const saveSettings = vi.fn(async (_settings: Settings): Promise<void> => {})

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    saveSettings.mockReset().mockResolvedValue(undefined)
    resetSettingsProjectionForTests()
    designSessionFixture.file = {
      version: 7,
      name: 'Demo',
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
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    activeLayerName.value = 'basemap'
    layerVisibility.value = { plants: true, zones: true, annotations: true }
    layerLockState.value = { plants: false, zones: false, annotations: false }
    layerOpacity.value = { plants: 1, zones: 1, annotations: 1 }
    mapLayers.value = createDefaultMapLayers()
    googleMapsApiKey.value = null
    activePanel.value = 'canvas'
    sidePanel.value = 'favorites'
    installSettingsProjection({
      load: () => baseSettings(),
      save: saveSettings,
    })
    setCurrentCanvasSession(null)
    activePanel.value = 'canvas'
    sidePanel.value = null
  })

  afterEach(() => {
    flushSettingsProjection()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    resetSettingsProjectionForTests()
  })

  it('toggles the Basemap row through the map layer store', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const rows = Array.from(container.querySelectorAll('[role="listitem"]'))
    const basemapRow = rows.find((row) => row.textContent?.includes('Basemap'))
    expect(basemapRow).toBeTruthy()
    expect(container.querySelector('input[aria-label="Opacity: Basemap"]')).toBeTruthy()

    const basemapToggle = basemapRow?.querySelector('button')
    expect(basemapToggle).toBeTruthy()

    await act(async () => {
      basemapToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mapLayers.value.basemap.visible).toBe(false)
    await Promise.resolve()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ basemap_visible: false }))
  })

  it('updates mounted Layer chrome when only the locale changes', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('Layers')
    expect(container.textContent).toContain('Basemap')

    await act(async () => {
      locale.value = 'fr'
    })

    expect(container.querySelector('aside')?.getAttribute('aria-label')).toBe('Calques')
    expect(container.textContent).toContain('Fond de carte')
  })

  it('chooses the Basemap style from the Basemap row and persists it', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const styleTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Style"]')
    expect(styleTrigger?.textContent).toContain('Liberty')
    await act(async () => {
      styleTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    expect(options.map((option) => option.textContent)).toEqual(['Liberty', 'Positron', 'Bright', 'Dark'])

    await act(async () => {
      options.find((option) => option.textContent === 'Positron')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mapLayers.value.basemap.style).toBe('positron')
    await Promise.resolve()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ basemap_style: 'positron' }))
  })

  it('hides the Basemap while Satellite is on and restores it when Satellite is off', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const satelliteToggle = () => container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle visibility: Satellite"]',
    )
    expect(satelliteToggle()?.getAttribute('aria-pressed')).toBe('false')
    expect(container.textContent).not.toContain('Hidden while Satellite is on.')

    await act(async () => {
      satelliteToggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mapLayers.value.satellite.visible).toBe(true)
    expect(mapLayers.value.basemap.visible).toBe(true)
    expect(container.textContent).toContain('Hidden while Satellite is on.')

    await act(async () => {
      satelliteToggle()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mapLayers.value.satellite.visible).toBe(false)
    expect(mapLayers.value.basemap.visible).toBe(true)
    expect(container.textContent).not.toContain('Hidden while Satellite is on.')
  })

  it('asks for a Google key when Google is chosen and saves it trimmed without echoing it', async () => {
    await act(async () => {
      activeLayerName.value = 'satellite'
      render(<LayerPanel />, container)
    })

    expect(container.textContent).toContain('Sentinel-2 cloudless imagery')
    expect(container.querySelector('input[type="password"]')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Imagery"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]'))
        .find((option) => option.textContent === 'Google')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mapLayers.value.satellite.provider).toBe('google')
    expect(container.textContent).toContain("Without a key, Canopi uses Google's public satellite tiles.")

    const keyInput = container.querySelector<HTMLInputElement>('input[type="password"]')
    expect(keyInput).toBeTruthy()
    await act(async () => {
      if (!keyInput) return
      keyInput.value = '  device-key  '
      keyInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(googleMapsApiKey.value).toBe('device-key')
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
    expect(container.textContent).not.toContain('device-key')
    expect(container.textContent).not.toContain("Without a key, Canopi uses Google's public satellite tiles.")
    expect(container.textContent).toContain('Key saved on this device.')
    await Promise.resolve()
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      satellite_provider: 'google',
      google_maps_api_key: 'device-key',
    }))

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Clear key')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(googleMapsApiKey.value).toBeNull()
    expect(container.textContent).toContain("Without a key, Canopi uses Google's public satellite tiles.")
  })

  it('shows map layer detail controls without a Design Location action', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const hasLocationButton = () => Array.from(container.querySelectorAll('button'))
      .some((button) => button.textContent === 'Design Location')
    expect(hasLocationButton()).toBe(false)
    expect(container.querySelector('input[aria-label="Opacity: Basemap"]')).toBeTruthy()

    await act(async () => {
      activeLayerName.value = 'contours'
      await Promise.resolve()
    })

    expect(hasLocationButton()).toBe(false)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Contour interval"]')).toBeTruthy()

    await act(async () => {
      activeLayerName.value = 'hillshade'
      await Promise.resolve()
    })

    expect(hasLocationButton()).toBe(false)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Hillshade opacity"]')).toBeTruthy()
  })

  it('exposes scene Layer lock controls through Canvas Layer Presentation', async () => {
    const layerCommands = {
      setSceneLayerVisibility: vi.fn(() => true),
      setSceneLayerOpacity: vi.fn(() => true),
      setSceneLayerLocked: vi.fn(() => true),
    }
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ layers: layerCommands }),
      queries: createTestCanvasQuerySurface({
        scene: {
          plantSpeciesColors: {},
          plantSpeciesSymbols: {},
    plantSpeciesCodes: {},
          layers: [
            { kind: 'layer', name: 'annotations', visible: true, locked: false, opacity: 1 },
            { kind: 'layer', name: 'plants', visible: true, locked: true, opacity: 1 },
            { kind: 'layer', name: 'zones', visible: true, locked: false, opacity: 1 },
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

    await act(async () => {
      render(<LayerPanel />, container)
    })

    const plantsLock = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Unlock layer: Plants')
    expect(plantsLock).toBeTruthy()
    expect(plantsLock?.getAttribute('aria-pressed')).toBe('true')

    const basemapLock = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label')?.includes('layer: Basemap'))
    expect(basemapLock).toBeUndefined()

    await act(async () => {
      plantsLock?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(layerCommands.setSceneLayerLocked).toHaveBeenCalledWith('plants', false)
  })

  it('exposes terrain controls without coupling them to the basemap toggle', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    // Toggle contours visibility via eye button
    const contourToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Toggle visibility: Contour lines')
    expect(contourToggle).toBeTruthy()

    await act(async () => {
      contourToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mapLayers.value.contours.visible).toBe(true)
    expect(mapLayers.value.basemap.visible).toBe(true)

    // Click the contours name to make it active and reveal controls
    const contourName = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Contour lines')
    expect(contourName).toBeTruthy()
    await act(async () => {
      contourName?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const contourSlider = container.querySelector<HTMLInputElement>('input[aria-label="Contour interval"]')
    expect(contourSlider).toBeTruthy()
    await act(async () => {
      if (!contourSlider) return
      contourSlider.value = '25'
      contourSlider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mapLayers.value.contours.intervalMeters).toBe(25)
    vi.runAllTimers()
    await Promise.resolve()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      contour_visible: true,
      contour_interval: 25,
    }))

    // Toggle hillshade visibility
    const hillshadeToggle = Array.from(container.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Toggle visibility: Hillshading')
    expect(hillshadeToggle).toBeTruthy()
    await act(async () => {
      hillshadeToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(mapLayers.value.hillshade.visible).toBe(true)

    // Click hillshading name to make it active and reveal controls
    const hillshadeName = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Hillshading')
    expect(hillshadeName).toBeTruthy()
    await act(async () => {
      hillshadeName?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const hillshadeSlider = container.querySelector<HTMLInputElement>('input[aria-label="Hillshade opacity"]')
    expect(hillshadeSlider).toBeTruthy()
    await act(async () => {
      if (!hillshadeSlider) return
      hillshadeSlider.value = '30'
      hillshadeSlider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mapLayers.value.hillshade.opacity).toBe(0.3)
    vi.runAllTimers()
    await Promise.resolve()
    expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      hillshade_visible: true,
      hillshade_opacity: 0.3,
    }))
  })
})
