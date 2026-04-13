import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadFavoriteItems: vi.fn(),
}))

vi.mock('../components/plant-db/PlantRow', () => ({
  PlantRow: ({ plant }: { plant: { canonical_name: string } }) => (
    <div data-testid="favorite-row">{plant.canonical_name}</div>
  ),
}))

vi.mock('../components/plant-detail/PlantDetailCard', () => ({
  PlantDetailCard: ({ canonicalName }: { canonicalName: string }) => (
    <div data-testid="favorite-detail">{canonicalName}</div>
  ),
}))

vi.mock('../app/plant-browser', async () => {
  const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
  return {
    ...actual,
    loadFavoriteItems: mocks.loadFavoriteItems,
  }
})

import { FavoritesPanel } from '../components/panels/FavoritesPanel'
import { locale } from '../app/settings/state'
import {
  favoriteItems,
  favoriteItemsLoading,
  favoriteItemsRevision,
  selectedCanonicalName,
} from '../app/plant-browser'

describe('FavoritesPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    favoriteItems.value = []
    favoriteItemsLoading.value = false
    favoriteItemsRevision.value = 0
    selectedCanonicalName.value = null
    mocks.loadFavoriteItems.mockReset()
    mocks.loadFavoriteItems.mockImplementation(async () => {
      favoriteItems.value = [
        {
          canonical_name: 'Malus domestica',
          is_favorite: true,
        } as any,
      ]
    })
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('requests favorites on mount and renders the current favorite list', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await Promise.resolve()
    })

    expect(mocks.loadFavoriteItems).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Favorites')
    expect(container.querySelectorAll('[data-testid="favorite-row"]')).toHaveLength(1)
  })
})
