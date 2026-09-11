import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import { createSpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import { makeSpeciesListItem } from './support/species-catalog-workbench'

function setup(favoritesIncludeRecentlyViewed = false) {
  const locale = signal('en')
  const search = vi.fn(async () => ({ items: [], next_cursor: null, total_estimate: 0 }))
  const getFavorites = vi.fn(async (language: string) => [{ ...makeSpeciesListItem('Apple', true), common_name: language }])
  const getRecentlyViewed = vi.fn(async () => [])
  const getFilterOptions = vi.fn(async () => null)
  const workbench = createSpeciesCatalogWorkbench({ favoritesIncludeRecentlyViewed, locale, search, getFavorites, getRecentlyViewed, getFilterOptions, toggleFavorite: async () => false })
  return { locale, search, getFavorites, getRecentlyViewed, getFilterOptions, workbench }
}

describe('Species Catalog view demand', () => {
  it('loads only Favorites resources and owns locale refresh until its last view releases', async () => {
    const s = setup()
    expect(s.getFavorites).not.toHaveBeenCalled()
    const first = s.workbench.mount('favorites')
    const second = s.workbench.mount('favorites')
    await vi.waitFor(() => expect(s.workbench.favorites.value.items[0]?.common_name).toBe('en'))
    expect(s.getFavorites).toHaveBeenCalledOnce()
    expect(s.search).not.toHaveBeenCalled()
    expect(s.getFilterOptions).not.toHaveBeenCalled()
    expect(s.getRecentlyViewed).not.toHaveBeenCalled()
    first(); first()
    s.locale.value = 'fr'
    await vi.waitFor(() => expect(s.workbench.favorites.value.items[0]?.common_name).toBe('fr'))
    second()
    s.locale.value = 'de'
    expect(s.getFavorites).toHaveBeenCalledTimes(2)
    s.workbench.dispose()
  })

  it('refreshes selected detail on locale changes and explicit repeated selection', async () => {
    const locale = signal('en')
    const getSpeciesDetail = vi.fn(async () => null)
    const workbench = createSpeciesCatalogWorkbench({ locale, getSpeciesDetail })
    const stop = workbench.mount('favorites')
    workbench.selectSpecies('Apple')
    await vi.waitFor(() => expect(getSpeciesDetail).toHaveBeenCalledTimes(1))
    locale.value = 'fr'
    await vi.waitFor(() => expect(getSpeciesDetail).toHaveBeenLastCalledWith('Apple', 'fr'))
    workbench.selectSpecies('Apple')
    expect(getSpeciesDetail).toHaveBeenCalledTimes(3)
    stop(); workbench.dispose()
  })

  it('keeps the browser Favorites recently-viewed projection current without starting search', async () => {
    const s = setup(true)
    const stop = s.workbench.mount('favorites')
    await vi.waitFor(() => expect(s.getRecentlyViewed).toHaveBeenCalledOnce())
    s.locale.value = 'fr'
    await vi.waitFor(() => expect(s.getRecentlyViewed).toHaveBeenCalledTimes(2))
    expect(s.search).not.toHaveBeenCalled()
    stop(); s.workbench.dispose()
  })

  it('shares a favorites refresh across active Catalog and Favorites views and refreshes after a toggle', async () => {
    const s = setup()
    const catalog = s.workbench.mount('catalog')
    const favorites = s.workbench.mount('favorites')
    await vi.waitFor(() => expect(s.search).toHaveBeenCalledOnce())
    expect(s.getFavorites).toHaveBeenCalledOnce()
    expect(s.getRecentlyViewed).toHaveBeenCalledOnce()
    expect(s.getFilterOptions).toHaveBeenCalledOnce()
    await s.workbench.toggleFavorite('Apple')
    await vi.waitFor(() => expect(s.getFavorites).toHaveBeenCalledTimes(2))
    expect(s.workbench.sidebar.value.favoriteNames).toEqual([])
    expect(s.workbench.favorites.value.items).toEqual([])
    catalog()
    s.locale.value = 'fr'
    await vi.waitFor(() => expect(s.getFavorites).toHaveBeenCalledTimes(3))
    expect(s.getRecentlyViewed).toHaveBeenCalledOnce()
    expect(s.search).toHaveBeenCalledOnce()
    favorites(); s.workbench.dispose()
  })
})
