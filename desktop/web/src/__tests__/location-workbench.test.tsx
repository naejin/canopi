import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentDesign, nonCanvasRevision } from './support/design-session-state'
import {
  getSavedLocationPresentation,
  useLocationWorkbench,
  type LocationWorkbench,
} from '../app/location'
import type { CanopiFile } from '../types/design'

function makeDesign(overrides: Partial<CanopiFile> = {}): CanopiFile {
  return {
    version: 2,
    name: 'Location workbench test',
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

function Probe({ onRender }: { onRender: (workbench: LocationWorkbench) => void }) {
  const workbench = useLocationWorkbench()
  onRender(workbench)
  return null
}

describe('Location Workbench', () => {
  let container: HTMLDivElement
  let workbench: LocationWorkbench | null

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    currentDesign.value = makeDesign()
    nonCanvasRevision.value = 0
    workbench = null
  })

  afterEach(() => {
    render(null, container)
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    container.remove()
    currentDesign.value = null
    nonCanvasRevision.value = 0
  })

  function renderProbe() {
    act(() => {
      render(<Probe onRender={(next) => { workbench = next }} />, container)
    })
  }

  function currentWorkbench(): LocationWorkbench {
    if (!workbench) throw new Error('Location workbench probe was not rendered')
    return workbench
  }

  it('presents saved location summary and stable location key', () => {
    const location = { lat: 48.8566, lon: 2.3522, altitude_m: 35 }

    expect(getSavedLocationPresentation(true, location)).toMatchObject({
      hasDesign: true,
      hasLocation: true,
      location,
      summary: '48.8566, 2.3522 (35 m)',
      key: '48.8566:2.3522:35',
    })
  })

  it('preserves saved altitude when committing a map result or map center', () => {
    currentDesign.value = makeDesign({
      location: { lat: 48.8566, lon: 2.3522, altitude_m: 35 },
    })
    renderProbe()

    act(() => {
      currentWorkbench().previewSearchResultOnMap({ displayName: 'Berlin', lat: 52.52, lon: 13.405 })
      currentWorkbench().commitMapLocation({ lat: 0, lon: 0 })
    })

    expect(currentDesign.value?.location).toEqual({ lat: 52.52, lon: 13.405, altitude_m: 35 })

    act(() => {
      currentWorkbench().previewSearchResultOnMap({ displayName: 'Ignored', lat: 1, lon: 1 })
      currentWorkbench().clearPendingMapResult()
      currentWorkbench().commitMapLocation({ lat: 40.7128, lon: -74.006 })
    })

    expect(currentDesign.value?.location).toEqual({ lat: 40.7128, lon: -74.006, altitude_m: 35 })
  })

  it('owns search dropdown outside-click close behavior and disposal', () => {
    renderProbe()
    const search = currentWorkbench().search
    const dropdown = document.createElement('div')
    const inside = document.createElement('button')
    dropdown.appendChild(inside)
    document.body.appendChild(dropdown)

    act(() => {
      search.setDropdownElement(dropdown)
      search.setQuery('paris')
    })
    expect(search.isSearching.value).toBe(true)

    act(() => {
      inside.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    expect(search.isSearching.value).toBe(true)

    act(() => {
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    expect(search.isSearching.value).toBe(false)
    expect(search.showDropdown.value).toBe(false)

    act(() => {
      search.setQuery('berlin')
    })
    expect(search.isSearching.value).toBe(true)

    act(() => {
      render(null, container)
    })
    expect(search.isSearching.value).toBe(false)
  })
})
