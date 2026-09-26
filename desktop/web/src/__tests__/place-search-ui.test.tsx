import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => vi.fn(async () => [] as unknown))
vi.mock('#geocoding-transport', () => ({ geocodingTransport: transport }))

import { closePlaceSearch, placeSearchOpen, PLACE_SEARCH_ZOOM } from '../app/geocoding/place-search-ui'
import { resetPlaceSearchPacingForTests } from '../app/geocoding/place-search'
import { installPlaceSearchSession, placeSearch } from '../app/geocoding/place-search-session'
import { designSessionStore } from '../app/document-session/store'
import { CURRENT_CANOPI_FILE_VERSION } from '../generated/canopi-design-format'
import type { CanopiFile } from '../types/design'
import { lastView } from '../app/settings/state'
import { setCurrentCanvasSession } from '../canvas/session'
import { PlaceSearch } from '../components/canvas/PlaceSearch'
import { createTestCanvasCommandSurface, createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createSessionPlane, DEFAULT_NEW_DESIGN_VIEW } from '../canvas/session-plane'

describe('PlaceSearch', () => {
  let container: HTMLDivElement
  const showPlace = vi.fn(() => true)

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ viewport: { showPlace } }),
    }))
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    setCurrentCanvasSession(null)
    closePlaceSearch()
    lastView.value = null
    showPlace.mockClear()
    transport.mockClear()
    resetPlaceSearchPacingForTests()
  })

  const launcher = () => container.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  const input = () => container.querySelector<HTMLInputElement>('input[type="search"]')!

  async function submit(text: string) {
    await act(async () => {
      input().value = text
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('opens an icon-only pin, searches coordinates on Enter and moves only the view', async () => {
    await act(async () => { render(<PlaceSearch />, container) })
    expect([...launcher().childNodes].some((node) => node.nodeType === Node.TEXT_NODE)).toBe(false)
    expect(launcher().getAttribute('aria-label')).toBe('Search for a place')
    await act(async () => { launcher().click() })
    expect(document.activeElement).toBe(input())
    await submit('47.39, 0.69')
    expect(transport).not.toHaveBeenCalled()
    const result = container.querySelector<HTMLButtonElement>('ul button')!
    await act(async () => { result.click() })
    expect(showPlace).toHaveBeenCalledWith(expect.objectContaining({ lat: 47.39, lon: 0.69 }), PLACE_SEARCH_ZOOM)
    expect(placeSearchOpen.value).toBe(false)
  })

  it('does not search while typing and credits the geocoder with results', async () => {
    transport.mockImplementation(async () => [{ lat: '47.39', lon: '0.689', display_name: 'Tours, France' }])
    await act(async () => { render(<PlaceSearch />, container) })
    await act(async () => { launcher().click() })
    await act(async () => {
      input().value = 'Tours'
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(transport).not.toHaveBeenCalled()
    await submit('Tours')
    expect(transport).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Tours, France')
    expect(container.textContent).toContain('OpenStreetMap')
  })

  it('closes on Escape and returns focus to the pin', async () => {
    await act(async () => { render(<PlaceSearch />, container) })
    await act(async () => { launcher().click() })
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(placeSearchOpen.value).toBe(false)
    expect(document.activeElement).toBe(launcher())
  })

  it('closes and forgets the search when another Design replaces the open one', async () => {
    const uninstall = installPlaceSearchSession()
    try {
      await act(async () => { render(<PlaceSearch />, container) })
      await act(async () => { launcher().click() })
      await submit('47.39, 0.69')
      expect(placeSearch.results.value).toHaveLength(1)

      await act(async () => {
        designSessionStore.replaceCurrentDesignState(emptyDesign('Next'), null, 'Next')
      })

      expect(placeSearchOpen.value).toBe(false)
      expect(placeSearch.results.value).toEqual([])
      expect(container.querySelector('form')).toBeNull()
    } finally {
      uninstall()
    }
  })

  it('leaves the search alone after its Design session owner is disposed', async () => {
    installPlaceSearchSession()()
    await act(async () => { render(<PlaceSearch />, container) })
    await act(async () => { launcher().click() })
    await act(async () => {
      designSessionStore.replaceCurrentDesignState(emptyDesign('Other'), null, 'Other')
    })
    expect(placeSearchOpen.value).toBe(true)
  })

  it('invites a site search for an empty Design opened at the default world view, even after the view is remembered', async () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ viewport: { showPlace } }),
      queries: createTestCanvasQuerySurface({ sessionPlane: createSessionPlane(DEFAULT_NEW_DESIGN_VIEW) }),
    }))
    await act(async () => { render(<PlaceSearch />, container) })
    expect(container.textContent).toContain('Search your site')
    // The camera remembers its view as soon as it settles; the invitation stays.
    await act(async () => { lastView.value = { lon: 13, lat: 23, zoom: 4 } as typeof lastView.value })
    expect(container.textContent).toContain('Search your site')
  })

  it('does not invite a site search when the empty Design opened at a remembered view', async () => {
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({
      commands: createTestCanvasCommandSurface({ viewport: { showPlace } }),
      queries: createTestCanvasQuerySurface({ sessionPlane: createSessionPlane({ lon: 0.69, lat: 47.39 }) }),
    }))
    await act(async () => { render(<PlaceSearch />, container) })
    expect(container.textContent).not.toContain('Search your site')
  })
})

function emptyDesign(name: string): CanopiFile {
  return {
    version: CURRENT_CANOPI_FILE_VERSION,
    name,
    description: null,
    plant_species_colors: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    consortiums: [],
    groups: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '',
    updated_at: '',
    extra: {},
  }
}
