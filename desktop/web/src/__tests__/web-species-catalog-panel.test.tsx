import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import type { SpeciesFilter, SpeciesListItem } from '../types/species'

const mockWorkbench = vi.hoisted(() => ({
  intent: { value: { text: '', filters: emptyFilters(), extraFilters: [], sort: 'Name', locale: 'en' } },
  results: {
    value: {
      items: [makeSpeciesListItem('Malus domestica', 'Apple')],
      nextCursor: 'offset:1',
      totalEstimate: 2,
      committedRevision: 1,
      status: 'idle',
      error: null,
    },
  },
  filterStrip: {
    value: {
      options: {
        families: [],
        growth_rates: [],
        climate_zones: ['Temperate'],
        habits: ['Tree'],
        life_cycles: ['Perennial'],
        sun_tolerances: [],
        soil_tolerances: [],
      },
      filters: emptyFilters(),
      hasActive: false,
      activeCount: 0,
      controls: [],
    },
  },
  favorites: {
    value: {
      items: [makeSpeciesListItem('Prunus persica', 'Peach', true)],
      loading: false,
      revision: 0,
    },
  },
  sidebar: {
    value: {
      favoriteNames: ['Prunus persica'],
      recentlyViewed: [makeSpeciesListItem('Melissa officinalis', 'Lemon balm')],
    },
  },
  mount: vi.fn(() => vi.fn()),
  ensureInitialSearch: vi.fn(),
  loadFilterOptions: vi.fn(async () => {}),
  reloadSidebarLists: vi.fn(async () => {}),
  loadFavorites: vi.fn(async () => {}),
  setSearchText: vi.fn(),
  patchFilters: vi.fn(),
  selectSpecies: vi.fn(),
  toggleFavorite: vi.fn(async () => {}),
  loadNextPage: vi.fn(async () => {}),
  isSearchLoading: vi.fn(() => false),
}))

vi.mock('../app/plant-browser', () => ({
  speciesCatalogWorkbench: mockWorkbench,
}))

import { WebSpeciesCatalogPanel } from '../web/WebSpeciesCatalogPanel'

describe('Web Edition Species Catalog panel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    resetWorkbench()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders catalog search and limited v1 filters through the Species Catalog Workbench', async () => {
    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    expect(container.querySelector('[data-testid="web-species-catalog-panel"]')).not.toBeNull()
    expect(mockWorkbench.mount).toHaveBeenCalledOnce()
    expect(mockWorkbench.ensureInitialSearch).toHaveBeenCalledOnce()
    expect(mockWorkbench.loadFilterOptions).toHaveBeenCalledOnce()
    expect(mockWorkbench.reloadSidebarLists).toHaveBeenCalledOnce()

    const search = requiredElement<HTMLInputElement>('[data-testid="web-species-search"]')
    await act(async () => {
      search.value = 'apple'
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mockWorkbench.setSearchText).toHaveBeenCalledWith('apple')

    const climate = requiredElement<HTMLSelectElement>('[data-testid="web-species-filter-climate_zones"]')
    await act(async () => {
      climate.value = 'Temperate'
      climate.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mockWorkbench.patchFilters).toHaveBeenCalledWith({ climate_zones: ['Temperate'] })

    await act(async () => {
      requiredElement<HTMLElement>('[data-testid="web-species-row"]').click()
    })
    expect(mockWorkbench.selectSpecies).toHaveBeenCalledWith('Malus domestica')

    await act(async () => {
      requiredElement<HTMLButtonElement>('[aria-label="Add to favorites"]').click()
    })
    expect(mockWorkbench.toggleFavorite).toHaveBeenCalledWith('Malus domestica')

    await act(async () => {
      requiredElement<HTMLButtonElement>('[data-testid="web-species-load-more"]').click()
    })
    expect(mockWorkbench.loadNextPage).toHaveBeenCalledOnce()
  })

  it('renders browser-local favorites and recently viewed Species', async () => {
    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="favorites" />, container)
    })

    expect(container.querySelector('[data-testid="web-species-favorites-panel"]')).not.toBeNull()
    expect(mockWorkbench.loadFavorites).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Peach')
    expect(container.textContent).toContain('Lemon balm')
  })

  function requiredElement<T extends Element>(selector: string): T {
    const element = container.querySelector<T>(selector)
    if (!element) throw new Error(`Missing element ${selector}`)
    return element
  }
})

function resetWorkbench(): void {
  vi.clearAllMocks()
  mockWorkbench.intent.value = { text: '', filters: emptyFilters(), extraFilters: [], sort: 'Name', locale: 'en' }
  mockWorkbench.results.value = {
    items: [makeSpeciesListItem('Malus domestica', 'Apple')],
    nextCursor: 'offset:1',
    totalEstimate: 2,
    committedRevision: 1,
    status: 'idle',
    error: null,
  }
  mockWorkbench.filterStrip.value = {
    options: {
      families: [],
      growth_rates: [],
      climate_zones: ['Temperate'],
      habits: ['Tree'],
      life_cycles: ['Perennial'],
      sun_tolerances: [],
      soil_tolerances: [],
    },
    filters: emptyFilters(),
    hasActive: false,
    activeCount: 0,
    controls: [],
  }
  mockWorkbench.favorites.value = {
    items: [makeSpeciesListItem('Prunus persica', 'Peach', true)],
    loading: false,
    revision: 0,
  }
  mockWorkbench.sidebar.value = {
    favoriteNames: ['Prunus persica'],
    recentlyViewed: [makeSpeciesListItem('Melissa officinalis', 'Lemon balm')],
  }
  mockWorkbench.mount.mockReturnValue(vi.fn())
  mockWorkbench.isSearchLoading.mockReturnValue(false)
}

function emptyFilters(): SpeciesFilter {
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

function makeSpeciesListItem(
  canonicalName: string,
  commonName: string,
  isFavorite = false,
): SpeciesListItem {
  return {
    canonical_name: canonicalName,
    slug: canonicalName.toLowerCase().replace(/\s+/g, '-'),
    common_name: commonName,
    common_name_2: null,
    matched_common_name: null,
    is_name_fallback: false,
    family: null,
    genus: null,
    height_max_m: null,
    hardiness_zone_min: null,
    hardiness_zone_max: null,
    growth_rate: null,
    stratum: null,
    climate_zones: ['Temperate'],
    life_cycles: ['Perennial'],
    edibility_rating: null,
    medicinal_rating: null,
    width_max_m: null,
    is_favorite: isFavorite,
  }
}
