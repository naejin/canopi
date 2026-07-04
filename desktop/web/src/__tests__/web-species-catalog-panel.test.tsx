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
  detail: {
    value: {
      canonicalName: null,
      detail: null,
      loading: false,
      error: null,
    } as import('../app/plant-browser/workbench').SpeciesCatalogDetailView,
  },
  mount: vi.fn(() => vi.fn()),
  ensureInitialSearch: vi.fn(),
  loadFilterOptions: vi.fn(async () => {}),
  reloadSidebarLists: vi.fn(async () => {}),
  loadFavorites: vi.fn(async () => {}),
  setSearchText: vi.fn(),
  patchFilters: vi.fn(),
  selectSpecies: vi.fn(),
  closeSpeciesDetail: vi.fn(),
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

  it('renders reduced Species detail with lazy hero image metadata and only v1 fields', async () => {
    mockWorkbench.detail.value = {
      canonicalName: 'Malus domestica',
      detail: {
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        common_names: ['Apple', 'Paradise apple'],
        climate_zones: ['Temperate'],
        habit: 'Tree',
        growth_form: 'Woody perennial',
        life_cycles: ['Perennial'],
        image: {
          url: 'https://images.example.test/apple.jpg',
          source: 'Wikimedia Commons',
          source_page_url: 'https://commons.example.test/apple',
          credit: 'Jane Gardener',
          license: 'CC BY-SA 4.0',
        },
      },
      loading: false,
      error: null,
    }

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    const image = requiredElement<HTMLImageElement>('[data-testid="web-species-detail-image"]')
    expect(image.getAttribute('src')).toBe('https://images.example.test/apple.jpg')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(container.textContent).toContain('Apple')
    expect(container.textContent).toContain('Malus domestica')
    expect(container.textContent).toContain('Paradise apple')
    expect(container.textContent).toContain('Temperate')
    expect(container.textContent).toContain('Tree')
    expect(container.textContent).toContain('Woody perennial')
    expect(container.textContent).toContain('Perennial')

    const sourceLink = requiredElement<HTMLAnchorElement>('[data-testid="web-species-detail-source"]')
    expect(sourceLink.href).toBe('https://commons.example.test/apple')
    expect(container.textContent).toContain('Wikimedia Commons')
    expect(container.textContent).toContain('Jane Gardener')
    expect(container.textContent).toContain('CC BY-SA 4.0')
    expect(container.textContent).not.toContain('Dimensions')
    expect(container.textContent).not.toContain('Hardiness')
    expect(container.textContent).not.toContain('Uses')
    expect(container.textContent).not.toContain('Soil')
    expect(container.textContent).not.toContain('Ecology')
    expect(container.textContent).not.toContain('Propagation')
    expect(container.textContent).not.toContain('Risk')
    expect(container.textContent).not.toContain('Related species')
  })

  it('renders a clean fallback when image metadata is missing', async () => {
    mockWorkbench.detail.value = {
      canonicalName: 'Malus domestica',
      detail: {
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        common_names: ['Apple'],
        climate_zones: ['Temperate'],
        habit: 'Tree',
        growth_form: null,
        life_cycles: ['Perennial'],
        image: null,
      },
      loading: false,
      error: null,
    }

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    expect(container.querySelector('[data-testid="web-species-detail-image"]')).toBeNull()
    expect(container.textContent).toContain('No photos available')
  })

  it('renders a clean fallback when the remote hero image fails to load', async () => {
    mockWorkbench.detail.value = {
      canonicalName: 'Malus domestica',
      detail: {
        canonical_name: 'Malus domestica',
        common_name: 'Apple',
        common_names: ['Apple'],
        climate_zones: ['Temperate'],
        habit: 'Tree',
        growth_form: null,
        life_cycles: ['Perennial'],
        image: {
          url: 'https://images.example.test/missing-apple.jpg',
          source: null,
          source_page_url: null,
          credit: null,
          license: null,
        },
      },
      loading: false,
      error: null,
    }

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    await act(async () => {
      requiredElement<HTMLImageElement>('[data-testid="web-species-detail-image"]')
        .dispatchEvent(new Event('error'))
    })

    expect(container.querySelector('[data-testid="web-species-detail-image"]')).toBeNull()
    expect(container.textContent).toContain('No photos available')
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
  mockWorkbench.detail.value = {
    canonicalName: null,
    detail: null,
    loading: false,
    error: null,
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
