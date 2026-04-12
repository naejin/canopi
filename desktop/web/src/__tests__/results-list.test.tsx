import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesListItem } from '../types/species'

const virtualCoreMocks = vi.hoisted(() => {
  const instances: Array<{
    cleanup: ReturnType<typeof vi.fn>
    setOptions: ReturnType<typeof vi.fn>
    _didMount: ReturnType<typeof vi.fn>
    _willUpdate: ReturnType<typeof vi.fn>
    getVirtualItems: ReturnType<typeof vi.fn>
    getTotalSize: ReturnType<typeof vi.fn>
    options: {
      count: number
      onChange?: (instance: unknown) => void
    }
  }> = []

  class MockVirtualizer {
    cleanup = vi.fn()
    options: {
      count: number
      onChange?: (instance: unknown) => void
    }

    constructor(options: { count: number; onChange?: (instance: unknown) => void }) {
      this.options = options
      instances.push(this)
    }

    setOptions = vi.fn((nextOptions: { count: number; onChange?: (instance: unknown) => void }) => {
      this.options = nextOptions
    })

    _didMount = vi.fn(() => this.cleanup)

    _willUpdate = vi.fn(() => {
      this.options.onChange?.(this)
    })

    getVirtualItems = vi.fn(() => (
      Array.from({ length: Math.min(this.options.count, 3) }, (_, index) => ({
        index,
        key: `row-${index}`,
        size: 38,
        start: index * 38,
      }))
    ))

    getTotalSize = vi.fn(() => this.options.count * 38)
  }

  return {
    instances,
    MockVirtualizer,
    observeElementRect: vi.fn(),
    observeElementOffset: vi.fn(),
    elementScroll: vi.fn(),
  }
})

vi.mock('@tanstack/virtual-core', () => ({
  Virtualizer: virtualCoreMocks.MockVirtualizer,
  observeElementRect: virtualCoreMocks.observeElementRect,
  observeElementOffset: virtualCoreMocks.observeElementOffset,
  elementScroll: virtualCoreMocks.elementScroll,
}))

vi.mock('../components/plant-db/PlantRow', () => ({
  PlantRow: ({ plant }: { plant: SpeciesListItem }) => <div>{plant.canonical_name}</div>,
}))

vi.mock('../components/plant-db/PlantCard', () => ({
  PlantCard: ({ plant }: { plant: SpeciesListItem }) => <div>{plant.canonical_name}</div>,
}))

import { ResultsList } from '../components/plant-db/ResultsList'
import {
  activeFilters,
  extraFilters,
  isSearching,
  nextCursor,
  searchError,
  searchResults,
  searchText,
  sortField,
  viewMode,
} from '../state/plant-db'
import { locale } from '../state/app'

function defaultFilters() {
  return {
    sun_tolerances: null,
    soil_tolerances: null,
    growth_rate: null,
    life_cycle: null,
    edible: null,
    edibility_min: null,
    nitrogen_fixer: null,
    climate_zones: null,
    habit: null,
    woody: null,
    family: null,
    extra: null,
  }
}

function makePlant(canonicalName: string): SpeciesListItem {
  return {
    canonical_name: canonicalName,
    slug: canonicalName.toLowerCase().replace(/\s+/g, '-'),
    common_name: canonicalName,
    common_name_2: null,
    is_name_fallback: false,
    family: null,
    genus: null,
    height_max_m: null,
    hardiness_zone_min: null,
    hardiness_zone_max: null,
    growth_rate: null,
    stratum: null,
    edibility_rating: null,
    medicinal_rating: null,
    width_max_m: null,
    is_favorite: false,
  }
}

describe('ResultsList', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)

    virtualCoreMocks.instances.length = 0

    locale.value = 'en'
    viewMode.value = 'list'
    searchText.value = ''
    activeFilters.value = defaultFilters()
    extraFilters.value = []
    sortField.value = 'Name'
    searchResults.value = [
      makePlant('Achillea millefolium'),
      makePlant('Aegopodium podagraria'),
      makePlant('Allium angulosum'),
    ]
    nextCursor.value = null
    isSearching.value = false
    searchError.value = null
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('recreates the virtualizer when the search signature changes', async () => {
    await act(async () => {
      render(<ResultsList />, container)
    })

    expect(virtualCoreMocks.instances).toHaveLength(1)
    const firstVirtualizer = virtualCoreMocks.instances[0]

    await act(async () => {
      activeFilters.value = {
        ...defaultFilters(),
        habit: ['Herbaceous'],
      }
    })

    expect(virtualCoreMocks.instances).toHaveLength(2)
    expect(firstVirtualizer?.cleanup).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing virtualizer when only more rows are appended', async () => {
    await act(async () => {
      render(<ResultsList />, container)
    })

    expect(virtualCoreMocks.instances).toHaveLength(1)
    const firstVirtualizer = virtualCoreMocks.instances[0]

    await act(async () => {
      searchResults.value = [
        ...searchResults.value,
        makePlant('Allium carinatum'),
      ]
    })

    expect(virtualCoreMocks.instances).toHaveLength(1)
    expect(firstVirtualizer?.setOptions).toHaveBeenCalled()
    expect(firstVirtualizer?.cleanup).not.toHaveBeenCalled()
  })
})
