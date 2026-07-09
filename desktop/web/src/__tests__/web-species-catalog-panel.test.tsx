import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'
import {
  clearPlantStampSource,
  readPlantStampDragData,
  readPlantStampSource,
} from '../canvas/plant-stamp-source'
import type { PlantSearchResultState } from '../app/plant-browser/search-session'
import type { SpeciesFilter, SpeciesListItem } from '../types/species'

const mockCanvasSession = vi.hoisted(() => {
  const toolSurface = {
    setTool: vi.fn(),
  }
  return {
    toolSurface,
    currentToolCommandSurface: {
      value: toolSurface as typeof toolSurface | null,
    },
  }
})

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
    } as PlantSearchResultState,
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
      controls: supportedFilterControls(),
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
  clearFilters: vi.fn(),
  retrySearch: vi.fn(),
  selectSpecies: vi.fn(),
  closeSpeciesDetail: vi.fn(),
  toggleFavorite: vi.fn(async () => {}),
  loadNextPage: vi.fn(async () => {}),
  isSearchLoading: vi.fn(() => false),
}))

vi.mock('../app/plant-browser', () => ({
  speciesCatalogWorkbench: mockWorkbench,
}))

vi.mock('../canvas/session', () => ({
  currentCanvasToolCommandSurface: mockCanvasSession.currentToolCommandSurface,
}))

import { WebSpeciesCatalogPanel } from '../web/WebSpeciesCatalogPanel'

describe('Web Edition Species Catalog panel', () => {
  let container: HTMLDivElement
  let originalMatchMedia: typeof window.matchMedia | undefined

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    originalMatchMedia = window.matchMedia
    locale.value = 'en'
    resetWorkbench()
    clearPlantStampSource()
    mockCanvasSession.currentToolCommandSurface.value = mockCanvasSession.toolSurface
    mockCanvasSession.toolSurface.setTool.mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    if (originalMatchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      })
    } else {
      Reflect.deleteProperty(window, 'matchMedia')
    }
  })

  it('renders catalog search and supported filters through the Species Catalog Workbench', async () => {
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

    expect(container.querySelector('[data-testid="web-species-filter-woody"]')).toBeNull()
    expect(container.textContent).not.toContain('Woody')

    const climate = requiredElement<HTMLButtonElement>(
      '[data-testid="web-species-filter-climate_zones-Temperate"]',
    )
    await act(async () => {
      climate.click()
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

  it('renders active Web filter chips and clears them through Workbench patches', async () => {
    const filters = {
      ...emptyFilters(),
      climate_zones: ['Temperate'],
    }
    mockWorkbench.intent.value = {
      text: '',
      filters,
      extraFilters: [],
      sort: 'Name',
      locale: 'en',
    }
    mockWorkbench.filterStrip.value = {
      ...mockWorkbench.filterStrip.value,
      filters,
      hasActive: true,
      activeCount: 1,
    }

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    const activeChip = requiredElement<HTMLButtonElement>(
      '[data-testid="web-species-active-filter-climate_zones-Temperate"]',
    )
    expect(activeChip.textContent).toContain('Temperate')

    await act(async () => {
      activeChip.click()
    })
    expect(mockWorkbench.patchFilters).toHaveBeenCalledWith({ climate_zones: null })

    await act(async () => {
      requiredElement<HTMLButtonElement>('[data-testid="web-species-clear-filters"]').click()
    })
    expect(mockWorkbench.clearFilters).toHaveBeenCalledOnce()
  })

  it('collapses supported filters behind a mobile summary without hiding the Species list', async () => {
    setSmallScreenMatch(true)
    const filters = {
      ...emptyFilters(),
      climate_zones: ['Temperate'],
    }
    mockWorkbench.intent.value = {
      text: '',
      filters,
      extraFilters: [],
      sort: 'Name',
      locale: 'en',
    }
    mockWorkbench.filterStrip.value = {
      ...mockWorkbench.filterStrip.value,
      filters,
      hasActive: true,
      activeCount: 1,
    }

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 860px)')
    const summary = requiredElement<HTMLButtonElement>('[data-testid="web-species-filter-summary"]')
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(summary.textContent).toContain('Filters')
    expect(summary.textContent).toContain('1 active')
    expect(requiredElement<HTMLElement>('[data-testid="web-species-row"]').textContent).toContain('Apple')
    expect(container.querySelector('[data-testid="web-species-filter-climate_zones-Temperate"]')).toBeNull()

    await act(async () => {
      summary.click()
    })

    expect(summary.getAttribute('aria-expanded')).toBe('true')
    const climate = requiredElement<HTMLButtonElement>(
      '[data-testid="web-species-filter-climate_zones-Temperate"]',
    )
    expect(climate.getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      requiredElement<HTMLButtonElement>('[data-testid="web-species-active-filter-climate_zones-Temperate"]')
        .click()
    })
    expect(mockWorkbench.patchFilters).toHaveBeenCalledWith({ climate_zones: null })
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

  it('writes desktop Plant Stamp drag payloads from catalog rows', async () => {
    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    const row = requiredElement<HTMLElement>('[data-testid="web-species-row"]')
    const dataTransfer = fakeDataTransfer()
    expect(row.draggable).toBe(true)

    await act(async () => {
      dispatchDragStart(row, dataTransfer)
    })

    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(readPlantStampDragData(dataTransfer)).toEqual({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: null,
      width_max_m: null,
    })
  })

  it('starts Plant Stamp from a catalog Place action without opening detail', async () => {
    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    await act(async () => {
      requiredElement<HTMLButtonElement>('[data-testid="web-species-place"]').click()
    })

    expect(readPlantStampSource()).toEqual({
      canonical_name: 'Malus domestica',
      common_name: 'Apple',
      stratum: null,
      width_max_m: null,
    })
    expect(mockCanvasSession.toolSurface.setTool).toHaveBeenCalledWith('plant-stamp')
    expect(mockWorkbench.selectSpecies).not.toHaveBeenCalled()
    expect(mockWorkbench.toggleFavorite).not.toHaveBeenCalled()
  })

  it('surfaces catalog load failures with a retry action', async () => {
    mockWorkbench.results.value = {
      items: [],
      nextCursor: null,
      totalEstimate: 0,
      committedRevision: 1,
      status: 'error',
      error: 'Failed to load Web Edition Species Catalog manifest.',
    }

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    expect(requiredElement<HTMLElement>('[role="alert"]').textContent).toContain(
      'Failed to load Web Edition Species Catalog manifest.',
    )

    await act(async () => {
      requiredElement<HTMLButtonElement>('[data-testid="web-species-retry"]').click()
    })

    expect(mockWorkbench.retrySearch).toHaveBeenCalledOnce()
  })

  it('writes desktop Plant Stamp drag payloads from favorites and recently viewed rows', async () => {
    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="favorites" />, container)
    })

    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-testid="web-species-row"]'))
    expect(rows).toHaveLength(2)

    const favoriteTransfer = fakeDataTransfer()
    await act(async () => {
      dispatchDragStart(rows[0]!, favoriteTransfer)
    })
    expect(readPlantStampDragData(favoriteTransfer)?.canonical_name).toBe('Prunus persica')

    const recentTransfer = fakeDataTransfer()
    await act(async () => {
      dispatchDragStart(rows[1]!, recentTransfer)
    })
    expect(readPlantStampDragData(recentTransfer)?.canonical_name).toBe('Melissa officinalis')
  })

  it('starts Plant Stamp from favorite and recently viewed Place actions', async () => {
    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="favorites" />, container)
    })

    const placeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid="web-species-place"]'),
    )
    expect(placeButtons).toHaveLength(2)

    await act(async () => {
      placeButtons[0]!.click()
    })
    expect(readPlantStampSource()?.canonical_name).toBe('Prunus persica')
    expect(mockCanvasSession.toolSurface.setTool).toHaveBeenLastCalledWith('plant-stamp')

    await act(async () => {
      placeButtons[1]!.click()
    })
    expect(readPlantStampSource()?.canonical_name).toBe('Melissa officinalis')
    expect(mockCanvasSession.toolSurface.setTool).toHaveBeenLastCalledWith('plant-stamp')
    expect(mockWorkbench.selectSpecies).not.toHaveBeenCalled()
  })

  it('keeps Place safe when the canvas command surface is unavailable', async () => {
    mockCanvasSession.currentToolCommandSurface.value = null

    await act(async () => {
      render(<WebSpeciesCatalogPanel mode="catalog" />, container)
    })

    await act(async () => {
      requiredElement<HTMLButtonElement>('[data-testid="web-species-place"]').click()
    })

    expect(readPlantStampSource()?.canonical_name).toBe('Malus domestica')
    expect(mockCanvasSession.toolSurface.setTool).not.toHaveBeenCalled()
    expect(mockWorkbench.selectSpecies).not.toHaveBeenCalled()
  })

  it('renders reduced Species detail with a lazy hero image and only v1 fields', async () => {
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

    expect(container.querySelector('[data-testid="web-species-detail-source"]')).toBeNull()
    expect(container.textContent).not.toContain('Wikimedia Commons')
    expect(container.textContent).not.toContain('Jane Gardener')
    expect(container.textContent).not.toContain('CC BY-SA 4.0')
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
    controls: supportedFilterControls(),
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

function supportedFilterControls() {
  return [
    {
      kind: 'choice',
      filterKey: 'climate_zones',
      labelI18nKey: 'filters.climateZone',
      fallbackLabel: 'Climate zone',
      optionsKey: 'climate_zones',
      valueI18nPrefix: 'filters.climateZone_',
      color: '--color-sun',
      source: 'schema',
    },
    {
      kind: 'choice',
      filterKey: 'habit',
      labelI18nKey: 'filters.field.habit',
      fallbackLabel: 'Habit',
      optionsKey: 'habits',
      valueI18nPrefix: 'filters.habit_',
      color: '--color-family',
      source: 'schema',
    },
    {
      kind: 'choice',
      filterKey: 'life_cycle',
      labelI18nKey: 'filters.lifecycle',
      fallbackLabel: 'Life cycle',
      optionsKey: 'life_cycles',
      valueI18nPrefix: 'filters.lifeCycle_',
      color: '--color-family',
      source: 'adapter',
    },
  ] as const
}

function setSmallScreenMatch(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
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

function dispatchDragStart(element: HTMLElement, dataTransfer: FakeDataTransfer): void {
  const event = new Event('dragstart', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  element.dispatchEvent(event)
}

interface FakeDataTransfer {
  readonly types: string[]
  effectAllowed?: string
  setData(type: string, value: string): void
  getData(type: string): string
}

function fakeDataTransfer(): FakeDataTransfer {
  const values = new Map<string, string>()
  const types: string[] = []
  return {
    types,
    setData(type: string, value: string) {
      values.set(type, value)
      if (!types.includes(type)) types.push(type)
    },
    getData(type: string) {
      return values.get(type) ?? ''
    },
  }
}
