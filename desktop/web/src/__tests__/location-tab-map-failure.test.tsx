import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import { LocationTab } from '../components/canvas/LocationTab'
import { currentDesign } from './support/design-session-state'
import type { CanopiFile } from '../types/design'

const maplibreMock = vi.hoisted(() => ({
  mapConstructor: vi.fn(),
  navigationControlConstructor: vi.fn(),
}))

vi.mock('maplibre-gl', () => ({
  default: {
    Map: maplibreMock.mapConstructor,
    NavigationControl: maplibreMock.navigationControlConstructor,
  },
}))

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Location tab map failure test',
    description: null,
    location: null,
    north_bearing_deg: null,
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
    extra: {},
    created_at: '2026-04-08T00:00:00.000Z',
    updated_at: '2026-04-08T00:00:00.000Z',
    ...overrides,
  }
}

describe('LocationTab map failures', () => {
  let container: HTMLDivElement
  let consoleError: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    currentDesign.value = makeDesign()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    maplibreMock.mapConstructor.mockReset()
    maplibreMock.navigationControlConstructor.mockReset()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    currentDesign.value = null
    consoleError.mockRestore()
  })

  it('keeps the location panel mounted when MapLibre initialization throws', async () => {
    maplibreMock.mapConstructor.mockImplementation(function () {
      throw new Error('Worker blocked by CSP')
    })

    await act(async () => {
      render(<LocationTab />, container)
    })

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Map unavailable')
    })
    expect(container.querySelector('input')?.getAttribute('placeholder')).toBe('Search for a location...')
    expect(maplibreMock.navigationControlConstructor).not.toHaveBeenCalled()
  })
})
