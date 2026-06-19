import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ipc/settings', () => ({ setSettings: vi.fn().mockResolvedValue(undefined) }))

import { LayerPanel } from '../components/canvas/LayerPanel'
import {
  activeLayerName,
  contourIntervalMeters,
  hillshadeOpacity,
  hillshadeVisible,
  layerLockState,
  layerOpacity,
  layerPanelOpen,
  layerVisibility,
} from '../app/canvas-settings/signals'
import { basemapStyle } from '../app/settings/state'
import { setSettings } from '../ipc/settings'
import { currentDesign } from './support/design-session-state'
import { locale } from '../app/settings/state'
import { activePanel, sidePanel } from '../app/shell/state'
import { flushSettingsProjection, hydrateSettingsProjection } from '../app/settings/projection'
import { setCurrentCanvasSession } from '../canvas/session'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import {
  createTestCanvasCommandSurface,
  createTestCanvasRuntimeSurfaces,
} from './support/canvas-runtime-surfaces'

describe('LayerPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    vi.mocked(setSettings).mockClear()
    currentDesign.value = {
      version: 2,
      name: 'Demo',
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
      created_at: '2026-04-12T00:00:00.000Z',
      updated_at: '2026-04-12T00:00:00.000Z',
      extra: {},
    }
    layerPanelOpen.value = true
    activeLayerName.value = 'base'
    basemapStyle.value = 'street'
    layerVisibility.value = { base: true, contours: false, plants: true, zones: true, annotations: true }
    layerLockState.value = { plants: false, zones: false, annotations: false }
    layerOpacity.value = { base: 1, contours: 1, plants: 1, zones: 1, annotations: 1 }
    contourIntervalMeters.value = 0
    hillshadeVisible.value = false
    hillshadeOpacity.value = 0.55
    activePanel.value = 'canvas'
    sidePanel.value = 'favorites'
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
      map_layer_visible: true,
      map_style: 'street',
      map_opacity: 1,
      contour_visible: false,
      contour_opacity: 1,
      contour_interval: 0,
      hillshade_visible: false,
      hillshade_opacity: 0.55,
      plant_spacing_interval_m: 0.5,
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
  })

  it('treats the base row as basemap visibility', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    const rows = Array.from(container.querySelectorAll('[role="listitem"]'))
    const basemapRow = rows.find((row) => row.textContent?.includes('Basemap'))
    expect(basemapRow).toBeTruthy()
    expect(container.textContent).toContain('Current')
    expect(container.textContent).toContain('48.8566, 2.3522')

    const basemapToggle = basemapRow?.querySelector('button')
    expect(basemapToggle).toBeTruthy()

    await act(async () => {
      basemapToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(layerVisibility.value.base).toBe(false)
  })

  it('does not expose basemap style selection in the base layer controls', async () => {
    await act(async () => {
      render(<LayerPanel />, container)
    })

    expect(container.querySelector('select')).toBeNull()
    expect(basemapStyle.value).toBe('street')
  })

  it('shows Design Location buttons in map layer details when no Location is saved', async () => {
    currentDesign.value = { ...currentDesign.value!, location: null }

    await act(async () => {
      render(<LayerPanel />, container)
    })

    expect(container.textContent).not.toContain('Set a design location first')
    expect(container.textContent).not.toContain('Set a design location to enable map layers')

    let locationButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Design Location')
    expect(locationButton).toBeTruthy()

    await act(async () => {
      locationButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(activePanel.value).toBe('location')
    expect(sidePanel.value).toBeNull()

    activePanel.value = 'canvas'
    sidePanel.value = 'favorites'
    await act(async () => {
      activeLayerName.value = 'contours'
      await Promise.resolve()
    })

    locationButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Design Location')
    expect(locationButton).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Contour interval"]')).toBeNull()

    await act(async () => {
      activeLayerName.value = 'hillshading'
      await Promise.resolve()
    })

    locationButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Design Location')
    expect(locationButton).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Hillshade opacity"]')).toBeNull()
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
          layers: [
            { kind: 'layer', name: 'annotations', visible: true, locked: false, opacity: 1 },
            { kind: 'layer', name: 'plants', visible: true, locked: true, opacity: 1 },
            { kind: 'layer', name: 'zones', visible: true, locked: false, opacity: 1 },
          ],
          plants: [],
          zones: [],
          annotations: [],
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

    expect(layerVisibility.value.contours).toBe(true)
    expect(layerVisibility.value.base).toBe(true)

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
    expect(contourIntervalMeters.value).toBe(25)
    vi.runAllTimers()
    await Promise.resolve()
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(hillshadeVisible.value).toBe(true)

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
    expect(hillshadeOpacity.value).toBe(0.3)
    vi.runAllTimers()
    await Promise.resolve()
    expect(vi.mocked(setSettings)).toHaveBeenCalledWith(expect.objectContaining({
      hillshade_visible: true,
      hillshade_opacity: 0.3,
    }))
  })
})
