import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpeciesCatalogWorkbench } from '../app/plant-browser/workbench'
import type { SpeciesListItem } from '../types/species'
import {
  createTestSpeciesCatalogWorkbench,
  makeSpeciesListItem,
} from './support/species-catalog-workbench'

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

async function flushEffects(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await Promise.resolve()
}

describe('FavoritesPanel', () => {
  let container: HTMLDivElement
  let FavoritesPanel: typeof import('../components/panels/FavoritesPanel').FavoritesPanel
  let locale: typeof import('../app/settings/state').locale
  let workbench: SpeciesCatalogWorkbench
  let getFavoritesMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    const settings = await import('../app/settings/state')
    locale = settings.locale
    locale.value = 'en'
    getFavoritesMock = vi.fn(async () => [
      makeSpeciesListItem('Malus domestica', true),
    ])
    workbench = await createTestSpeciesCatalogWorkbench({
      locale,
      getFavorites: getFavoritesMock as unknown as (locale: string) => Promise<SpeciesListItem[]>,
    })
    vi.doMock('../app/plant-browser', async () => {
      const actual = await vi.importActual<typeof import('../app/plant-browser')>('../app/plant-browser')
      return {
        ...actual,
        speciesCatalogWorkbench: workbench,
      }
    })
    ;({ FavoritesPanel } = await import('../components/panels/FavoritesPanel'))

    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    workbench.dispose()
    vi.doUnmock('../app/plant-browser')
  })

  it('requests favorites on mount and renders the current favorite list', async () => {
    await act(async () => {
      render(<FavoritesPanel />, container)
      await flushEffects()
    })

    expect(getFavoritesMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      await workbench.loadFavorites()
      await flushEffects()
    })

    expect(container.textContent).toContain('Favorites')
    expect(container.textContent).toContain('Malus domestica')
  })
})
